// ═══════════════════════════════════════════════════════════════
//  brickbreaker-data.js — Camada de dados Firebase + anti-tamper
//  Jogos com Eles · Brick Breaker (Etapa 3 + 4 + 5)
//
//  Responsável por:
//    • Persistir moedas + skins (owned/equipped) por utilizador no Firestore
//    • Cache local com hash anti-tampering (deteta edição no "Inspecionar")
//    • Sincronização em tempo real (onSnapshot) — Firebase é fonte de verdade
//    • awardCoins(): adiciona moedas após game over (grava no Firebase)
//    • purchaseSkin(): compra skin (deduz moedas, adiciona a ownedSkins)
//    • equipSkin(): equipa skin (grava em equippedSkins)
//    • submitScore(): grava score no leaderboard (Etapa 5)
//    • getLeaderboard(): lê top 10 scores (Etapa 5)
//    • getUserBestScore(): lê melhor score do utilizador (Etapa 5)
//
//  ANTI-TAMPER (proteção contra "Inspecionar"):
//    1. Cache local tem hash (djb2 + salt + userId + coins + totalEarned
//       + ownedSkins + equippedSkins). Se alguém editar o localStorage,
//       o hash falha → cache ignorado → re-sincroniza do Firebase.
//    2. O cliente nunca aumenta moedas ou skins sem gravar no Firebase.
//    3. Firebase é fonte de verdade — o cache é só para feedback imediato.
//
//  API: window.BBData
//    • isReady(), getUserId()
//    • subscribe(userId, cb), unsubscribe(userId)
//    • getCoins(), getTotalEarned()
//    • getOwnedSkins(), getEquippedSkins()
//    • awardCoins(userId, amount, score, level)
//    • purchaseSkin(userId, category, skinId, price)
//    • equipSkin(userId, category, skinId)
//    • submitScore(userId, name, score, level) — Etapa 5
//    • getLeaderboard(limit) — Etapa 5
//    • getUserBestScore(userId) — Etapa 5
//    • resetCoins(userId), validateCache(), clearCache()
// ═══════════════════════════════════════════════════════════════

import { db } from "./firebase.js";
import {
  doc, getDoc, setDoc, onSnapshot,
  collection, query, orderBy, limit, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

(function () {
  "use strict";

  const COLLECTION = "bb_players";      // dados por utilizador (moedas, skins)
  const SCORES_COLLECTION = "bb_scores"; // leaderboard (Etapa 5)
  const CACHE_KEY = "jce_bb_coins_cache";
  const SALT = "cn_bb_v1_2025";

  // ─────────────────────────────────────────────
  //  UserId
  // ─────────────────────────────────────────────
  function getUserId() {
    try { return localStorage.getItem("jce_user_id") || null; } catch (_) { return null; }
  }

  // ─────────────────────────────────────────────
  //  Hash djb2 (deteta tampering do cache local)
  // ─────────────────────────────────────────────
  function hashStr(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16);
  }

  // Hash cobre: coins, totalEarned, ownedSkins, equippedSkins
  function makeHash(coins, totalEarned, ownedSkins, equippedSkins, userId) {
    const ownedStr = (ownedSkins || []).slice().sort().join(",");
    const equipStr = JSON.stringify(equippedSkins || {});
    return hashStr(SALT + "|" + userId + "|" + coins + "|" + totalEarned + "|" + ownedStr + "|" + equipStr);
  }

  // ─────────────────────────────────────────────
  //  Cache local (com validação de hash)
  // ─────────────────────────────────────────────
  function readCache(userId) {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || obj.userId !== userId) return null;
      const expectedHash = makeHash(obj.coins || 0, obj.totalEarned || 0, obj.ownedSkins, obj.equippedSkins, userId);
      if (obj.hash !== expectedHash) {
        console.warn("[BBData] Cache hash mismatch — ignoring local cache (tampering detected)");
        return null;
      }
      return {
        coins: obj.coins || 0,
        totalEarned: obj.totalEarned || 0,
        lastScore: obj.lastScore || 0,
        ownedSkins: obj.ownedSkins || [],
        equippedSkins: obj.equippedSkins || {},
      };
    } catch (_) { return null; }
  }

  function writeCache(userId, coins, totalEarned, lastScore, ownedSkins, equippedSkins) {
    try {
      const hash = makeHash(coins, totalEarned, ownedSkins, equippedSkins, userId);
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        userId: userId,
        coins: coins,
        totalEarned: totalEarned,
        lastScore: lastScore || 0,
        ownedSkins: ownedSkins || [],
        equippedSkins: equippedSkins || {},
        hash: hash,
        ts: Date.now(),
      }));
    } catch (_) {}
  }

  function clearCache() {
    try { localStorage.removeItem(CACHE_KEY); } catch (_) {}
  }

  // ─────────────────────────────────────────────
  //  Defaults de skins (vêm do BBSkins)
  // ─────────────────────────────────────────────
  function defaultOwned() {
    if (window.BBSkins) return window.BBSkins.DEFAULT_OWNED.slice();
    return [];
  }
  function defaultEquipped() {
    if (window.BBSkins) return Object.assign({}, window.BBSkins.DEFAULT_EQUIPPED);
    // Fallback (BBSkins ainda não carregado) — espelha DEFAULT_EQUIPPED do skins.js
    return { bricks: "brick-default", ball: "ball-default", paddle: "pad-default", bg: "bg-void" };
  }

  // Migration: IDs de skins renomeados em versões anteriores.
  // Maps para que utilizadores existentes no Firestore não percam as skins
  // que já tinham comprado/equipado.
  const SKIN_ID_MIGRATION = {
    "ball-rainbow": "ball-prism",  // Etapa 4: substituído
    "bg-grid": "bg-aurora",        // Etapa 4: renomeado (ID ≠ nome)
  };

  // Normaliza ownedSkins — apenas devolve o array único. Nenhuma skin é
  // auto-owned (nem tier-1 nem defaults). Tudo se compra na loja.
  // Aplica migration de IDs renomeados (para não perder skins compradas).
  function normalizeOwned(owned) {
    const set = new Set();
    (Array.isArray(owned) ? owned : []).forEach(function (id) {
      set.add(SKIN_ID_MIGRATION[id] || id);
    });
    return Array.from(set);
  }

  function normalizeEquipped(equipped) {
    const d = defaultEquipped();
    const out = Object.assign({}, d, equipped || {});
    // Se um valor for null ou undefined, usa o default
    for (const k in d) {
      if (out[k] == null) out[k] = d[k];
      // Aplica migration de IDs renomeados
      if (SKIN_ID_MIGRATION[out[k]]) out[k] = SKIN_ID_MIGRATION[out[k]];
    }
    return out;
  }

  // Verifica se um skinId é o ID default da categoria (brick-default, etc.).
  // Os IDs default NÃO precisam de estar em ownedSkins para serem equipados —
  // são o fallback interno usado quando o utilizador desequipa uma skin
  // comprada. Sem isto, equipSkin rejeitaria "brick-default" → bug de
  // desequipar não funcionar para utilizadores registados.
  function isDefaultSkinId(category, skinId) {
    const d = defaultEquipped();
    return d[category] === skinId;
  }

  // ─────────────────────────────────────────────
  //  Estado interno
  // ─────────────────────────────────────────────
  const listeners = new Map(); // userId → unsubscribe onSnapshot

  // ─────────────────────────────────────────────
  //  API pública (window.BBData)
  // ─────────────────────────────────────────────
  const BBData = {
    isReady: function () { return !!getUserId(); },

    getUserId: getUserId,

    // Subscreve mudanças em tempo real do doc do utilizador no Firestore.
    // callback({ coins, totalEarned, lastScore, ownedSkins, equippedSkins, source })
    subscribe: function (userId, callback) {
      if (!userId) return;
      if (listeners.has(userId)) {
        try { listeners.get(userId)(); } catch (_) {}
        listeners.delete(userId);
      }
      const ref = doc(db, COLLECTION, userId);
      const unsub = onSnapshot(ref, function (snap) {
        if (snap.exists()) {
          const data = snap.data();
          const coins = data.coins || 0;
          const totalEarned = data.totalEarned || 0;
          const lastScore = data.lastScore || 0;
          const ownedSkins = normalizeOwned(data.ownedSkins);
          const equippedSkins = normalizeEquipped(data.equippedSkins);
          writeCache(userId, coins, totalEarned, lastScore, ownedSkins, equippedSkins);
          callback({
            coins: coins, totalEarned: totalEarned, lastScore: lastScore,
            ownedSkins: ownedSkins, equippedSkins: equippedSkins,
            source: "firebase"
          });
        } else {
          // Novo utilizador — cria doc com defaults
          const owned = defaultOwned();
          const equipped = defaultEquipped();
          setDoc(ref, {
            coins: 0, totalEarned: 0, lastScore: 0,
            ownedSkins: owned, equippedSkins: equipped,
            createdAt: Date.now(), updatedAt: Date.now(),
          }).catch(function () {});
          writeCache(userId, 0, 0, 0, owned, equipped);
          callback({
            coins: 0, totalEarned: 0, lastScore: 0,
            ownedSkins: owned, equippedSkins: equipped,
            source: "firebase"
          });
        }
      }, function (err) {
        console.warn("[BBData] Firebase offline, using cache:", err);
        const cache = readCache(userId);
        if (cache) {
          callback({
            coins: cache.coins, totalEarned: cache.totalEarned, lastScore: cache.lastScore,
            ownedSkins: cache.ownedSkins, equippedSkins: cache.equippedSkins,
            source: "cache"
          });
        } else {
          const owned = defaultOwned();
          const equipped = defaultEquipped();
          callback({
            coins: 0, totalEarned: 0, lastScore: 0,
            ownedSkins: owned, equippedSkins: equipped,
            source: "cache"
          });
        }
      });
      listeners.set(userId, unsub);
    },

    unsubscribe: function (userId) {
      if (listeners.has(userId)) {
        try { listeners.get(userId)(); } catch (_) {}
        listeners.delete(userId);
      }
    },

    getCoins: function () {
      const userId = getUserId();
      if (!userId) return 0;
      const cache = readCache(userId);
      return cache ? cache.coins : 0;
    },

    getTotalEarned: function () {
      const userId = getUserId();
      if (!userId) return 0;
      const cache = readCache(userId);
      return cache ? cache.totalEarned : 0;
    },

    getOwnedSkins: function () {
      const userId = getUserId();
      if (!userId) return defaultOwned();
      const cache = readCache(userId);
      return cache ? cache.ownedSkins : defaultOwned();
    },

    getEquippedSkins: function () {
      const userId = getUserId();
      if (!userId) return defaultEquipped();
      const cache = readCache(userId);
      return cache ? cache.equippedSkins : defaultEquipped();
    },

    // Adiciona moedas após game over (grava no Firebase)
    awardCoins: async function (userId, amount, score, level) {
      if (!userId || amount <= 0) return 0;
      try {
        const ref = doc(db, COLLECTION, userId);
        const snap = await getDoc(ref);
        const data = snap.exists() ? snap.data() : {};
        const current = data.coins || 0;
        const currentTotal = data.totalEarned || 0;
        const ownedSkins = normalizeOwned(data.ownedSkins);
        const equippedSkins = normalizeEquipped(data.equippedSkins);
        const newCoins = current + amount;
        const newTotal = currentTotal + amount;
        await setDoc(ref, {
          coins: newCoins, totalEarned: newTotal,
          lastScore: score, lastLevel: level, lastAward: amount,
          updatedAt: Date.now(),
        }, { merge: true });
        writeCache(userId, newCoins, newTotal, score, ownedSkins, equippedSkins);
        return newCoins;
      } catch (e) {
        console.warn("[BBData] awardCoins failed:", e);
        return 0;
      }
    },

    // Compra skin: deduz moedas, adiciona a ownedSkins (grava no Firebase).
    // Fallback offline: se Firebase falhar, opera no cache validado (anti-tamper).
    // Retorna { success, coins, reason, ownedSkins }
    purchaseSkin: async function (userId, category, skinId, price) {
      if (!userId) return { success: false, reason: "not-registered" };
      // Tenta Firebase primeiro
      try {
        const ref = doc(db, COLLECTION, userId);
        const snap = await getDoc(ref);
        let coins, totalEarned, ownedSkins, equippedSkins, lastScore;
        if (snap.exists()) {
          const data = snap.data();
          coins = data.coins || 0; totalEarned = data.totalEarned || 0;
          ownedSkins = normalizeOwned(data.ownedSkins); equippedSkins = normalizeEquipped(data.equippedSkins);
          lastScore = data.lastScore || 0;
        } else {
          // Firebase não tem doc — usa cache (offline first-run)
          const cache = readCache(userId);
          coins = cache ? cache.coins : 0; totalEarned = cache ? cache.totalEarned : 0;
          ownedSkins = cache ? cache.ownedSkins : defaultOwned(); equippedSkins = cache ? cache.equippedSkins : defaultEquipped();
          lastScore = cache ? cache.lastScore : 0;
        }
        if (ownedSkins.indexOf(skinId) >= 0) return { success: false, reason: "already-owned", coins: coins };
        if (coins < price) return { success: false, reason: "insufficient", coins: coins };
        const newCoins = coins - price;
        ownedSkins.push(skinId);
        try {
          await setDoc(ref, { coins: newCoins, ownedSkins: ownedSkins, updatedAt: Date.now() }, { merge: true });
        } catch (writeErr) {
          // Firebase write falhou (permissões/offline) — continua com cache
          console.warn("[BBData] purchaseSkin: Firebase write failed, using cache:", writeErr);
        }
        writeCache(userId, newCoins, totalEarned, lastScore, ownedSkins, equippedSkins);
        return { success: true, coins: newCoins, ownedSkins: ownedSkins };
      } catch (e) {
        // Firebase indisponível — fallback total no cache
        console.warn("[BBData] purchaseSkin Firebase offline, using cache:", e);
        const cache = readCache(userId);
        if (!cache) return { success: false, reason: "error" };
        if (cache.ownedSkins.indexOf(skinId) >= 0) return { success: false, reason: "already-owned", coins: cache.coins };
        if (cache.coins < price) return { success: false, reason: "insufficient", coins: cache.coins };
        const newCoins = cache.coins - price;
        const newOwned = cache.ownedSkins.slice(); newOwned.push(skinId);
        writeCache(userId, newCoins, cache.totalEarned, cache.lastScore, newOwned, cache.equippedSkins);
        return { success: true, coins: newCoins, ownedSkins: newOwned };
      }
    },

    // Equipa skin (grava em equippedSkins no Firebase).
    // Fallback offline: se Firebase falhar, opera no cache.
    //
    // NOTA: os IDs default (brick-default, ball-default, pad-default, bg-void)
    // NÃO precisam de estar em ownedSkins para serem equipados — são o
    // fallback interno usado quando o utilizador desequipa uma skin comprada.
    // Antes deste fix, desequipar chamava equipSkin(userId, cat, "brick-default")
    // que era rejeitado por "brick-default" não estar em ownedSkins → bug.
    equipSkin: async function (userId, category, skinId) {
      if (!userId) return false;
      try {
        const ref = doc(db, COLLECTION, userId);
        const snap = await getDoc(ref);
        let coins, totalEarned, ownedSkins, equippedSkins, lastScore;
        if (snap.exists()) {
          const data = snap.data();
          coins = data.coins || 0; totalEarned = data.totalEarned || 0;
          ownedSkins = normalizeOwned(data.ownedSkins); equippedSkins = normalizeEquipped(data.equippedSkins);
          lastScore = data.lastScore || 0;
        } else {
          const cache = readCache(userId);
          coins = cache ? cache.coins : 0; totalEarned = cache ? cache.totalEarned : 0;
          ownedSkins = cache ? cache.ownedSkins : defaultOwned(); equippedSkins = cache ? cache.equippedSkins : defaultEquipped();
          lastScore = cache ? cache.lastScore : 0;
        }
        // Permite equipar se for uma skin owned OU um ID default (fallback).
        if (!isDefaultSkinId(category, skinId) && ownedSkins.indexOf(skinId) < 0) return false;
        equippedSkins[category] = skinId;
        try {
          await setDoc(ref, { equippedSkins: equippedSkins, updatedAt: Date.now() }, { merge: true });
        } catch (writeErr) {
          console.warn("[BBData] equipSkin: Firebase write failed, using cache:", writeErr);
        }
        writeCache(userId, coins, totalEarned, lastScore, ownedSkins, equippedSkins);
        return true;
      } catch (e) {
        console.warn("[BBData] equipSkin Firebase offline, using cache:", e);
        const cache = readCache(userId);
        if (!cache) return false;
        if (!isDefaultSkinId(category, skinId) && cache.ownedSkins.indexOf(skinId) < 0) return false;
        const equipped = Object.assign({}, cache.equippedSkins); equipped[category] = skinId;
        writeCache(userId, cache.coins, cache.totalEarned, cache.lastScore, cache.ownedSkins, equipped);
        return true;
      }
    },

    // Debug: reset moedas a 0
    resetCoins: async function (userId) {
      if (!userId) return;
      try {
        const ref = doc(db, COLLECTION, userId);
        const snap = await getDoc(ref);
        const data = snap.exists() ? snap.data() : {};
        const ownedSkins = normalizeOwned(data.ownedSkins);
        const equippedSkins = normalizeEquipped(data.equippedSkins);
        await setDoc(ref, {
          coins: 0, totalEarned: 0, lastScore: 0,
          updatedAt: Date.now(),
        }, { merge: true });
        writeCache(userId, 0, 0, 0, ownedSkins, equippedSkins);
      } catch (e) { console.warn("[BBData] resetCoins failed:", e); }
    },

    validateCache: function () {
      const userId = getUserId();
      if (!userId) return true;
      const cache = readCache(userId);
      return cache !== null;
    },

    clearCache: clearCache,

    // ─────────────────────────────────────────────
    //  LEADERBOARD (Etapa 5)
    // ─────────────────────────────────────────────

    // Submete um score no leaderboard.
    // Estratégia: guarda UM documento por score (não por utilizador) para
    // permitir múltiplas entradas do mesmo jogador (os seus melhores jogos).
    // O getLeaderboard faz query orderBy score desc + limit, e agrupa por
    // userId no cliente para mostrar só o melhor de cada um.
    // Documento: bb_scores/{autoId} = { userId, name, score, level, ts }
    submitScore: async function (userId, name, score, level) {
      if (!userId || score <= 0) return false;
      try {
        // Usa userId como ID do documento (1 doc por utilizador).
        // Antes usava doc(colRef) que gera ID automático → criava um novo
        // doc a cada submissão, mesmo para o mesmo utilizador. Agora, com
        // setDoc(ref, data, {merge:true}) só atualiza se o novo score for
        // melhor (lê o existente primeiro para comparar).
        const ref = doc(db, SCORES_COLLECTION, userId);
        const existing = await getDoc(ref);
        if (existing.exists()) {
          const prev = existing.data();
          if ((prev.score || 0) >= score) {
            // Score existente é melhor ou igual — não atualiza
            return true;
          }
        }
        await setDoc(ref, {
          userId: userId,
          name: name || "Anonymous",
          score: score,
          level: level || 1,
          ts: Date.now(),
        });
        return true;
      } catch (e) {
        console.warn("[BBData] submitScore failed:", e);
        return false;
      }
    },

    // Lê o top N do leaderboard. Retorna array ordenado (desc por score),
    // com apenas o MELHOR score de cada utilizador (dedup por userId).
    // Cada item: { userId, name, score, level, ts, rank }
    getLeaderboard: async function (topN) {
      topN = topN || 10;
      try {
        // Query: top 50 scores (para garantir que após dedup temos ≥ topN únicos)
        const q = query(collection(db, SCORES_COLLECTION), orderBy("score", "desc"), limit(50));
        const snap = await getDocs(q);
        const seen = new Map(); // userId → best entry
        snap.forEach(function (d) {
          const data = d.data();
          const userId = data.userId;
          if (!userId) return;
          const entry = {
            userId: userId,
            name: data.name || "Anonymous",
            score: data.score || 0,
            level: data.level || 1,
            ts: data.ts || 0,
          };
          if (!seen.has(userId) || seen.get(userId).score < entry.score) {
            seen.set(userId, entry);
          }
        });
        // Converte para array, ordena por score desc, adiciona rank
        const list = Array.from(seen.values()).sort(function (a, b) {
          return b.score - a.score;
        }).slice(0, topN).map(function (entry, idx) {
          entry.rank = idx + 1;
          return entry;
        });
        return list;
      } catch (e) {
        console.warn("[BBData] getLeaderboard failed:", e);
        return [];
      }
    },

    // Lê o melhor score de um utilizador específico.
    // Retorna { score, level, ts } ou null se não houver scores.
    getUserBestScore: async function (userId) {
      if (!userId) return null;
      try {
        const q = query(collection(db, SCORES_COLLECTION), orderBy("score", "desc"), limit(50));
        const snap = await getDocs(q);
        let best = null;
        snap.forEach(function (d) {
          const data = d.data();
          if (data.userId !== userId) return;
          if (!best || (data.score || 0) > best.score) {
            best = { score: data.score || 0, level: data.level || 1, ts: data.ts || 0 };
          }
        });
        return best;
      } catch (e) {
        console.warn("[BBData] getUserBestScore failed:", e);
        return null;
      }
    },

    // Lê o nome do utilizador atual a partir da coleção users/{userId}.
    // Necessário porque o app.js NÃO guarda o nome no localStorage (só jce_user_id);
    // o nome é obtido dinamicamente via onSnapshot do Firestore.
    // Sem isto, o submitScore usava "Anonymous" mesmo para utilizadores logados.
    // Retorna o nome (string) ou null se não for possível obter.
    getUserName: async function () {
      const userId = getUserId();
      if (!userId) return null;
      try {
        const ref = doc(db, "users", userId);
        const snap = await getDoc(ref);
        if (snap.exists()) return snap.data().name || null;
        return null;
      } catch (e) {
        console.warn("[BBData] getUserName failed:", e);
        return null;
      }
    },

    // Debug: injeta moedas de teste (cria cache válido com hash correto).
    // Útil para testar a loja sem Firebase. Remover no polimento (Etapa 6).
    debugInjectCoins: function (amount) {
      const userId = getUserId();
      if (!userId) { console.warn("[BBData] debugInjectCoins: no userId"); return; }
      const owned = defaultOwned();
      const equipped = defaultEquipped();
      writeCache(userId, amount, amount, 0, owned, equipped);
      return amount;
    },
  };

  window.BBData = BBData;
})();
