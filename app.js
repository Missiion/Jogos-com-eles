// app.js — Jogos com Eles
// Importa o db do firebase.js
import { db } from "./firebase.js";
import {
  collection, doc, getDocs, addDoc, deleteDoc, updateDoc, setDoc,
  onSnapshot, query, orderBy, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ─────────────────────────────────────────────
//  i18n — atalhos para o sistema de tradução
//  (carregado em i18n.js, exposto em window.i18n)
// ─────────────────────────────────────────────
const t = (k) => (window.i18n ? window.i18n.t(k) : k);
const tf = (k, ...args) => (window.i18n ? window.i18n.tf(k, ...args) : k);
const isPt = () => (window.i18n ? window.i18n.isPt() : true);
const translateText = (txt, lang) =>
  window.i18n ? window.i18n.translateText(txt, lang) : Promise.resolve(txt);
const applyTranslations = (root) => {
  if (window.i18n) window.i18n.applyTranslations(root);
};

// ─────────────────────────────────────────────
//  USER STATE — registo + sessão
//  Coleção Firebase "users": { name, isAdmin, tabId, createdAt }
//  Sessão persistida em localStorage (jce_user_id)
// ─────────────────────────────────────────────
let currentUser = null;       // { id, name, isAdmin, tabId } ou null
let allUsers = [];            // array de { id, name, isAdmin, tabId }
const USER_ID_KEY = "jce_user_id";

// Capitaliza: primeira letra uppercase, resto lowercase
function capitalizeName(name) {
  if (!name) return name;
  const trimmed = String(name).trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

// ─────────────────────────────────────────────
//  TOAST — aviso flutuante
// ─────────────────────────────────────────────
let _toastTimer = null;
function showToast(message, duration = 3000) {
  const toast = document.getElementById("toast");
  const toastText = document.getElementById("toast-text");
  if (!toast || !toastText) return;
  toastText.textContent = message;
  toast.classList.add("show");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toast.classList.remove("show"), duration);
}

// ─────────────────────────────────────────────
//  FUZZY MATCH — para encontrar jogos já na lista
//  com nomes parecidos ou com erros de escrita
//
//  Sistema de matching tolerante a erros com 3 estratégias:
//    1. Matching por tokens: cada palavra da pesquisa é comparada com
//       cada palavra do título (permite pesquisar "mario" e encontrar
//       "Super Mario Bros").
//    2. Matching parcial fuzzy: se a pesquisa é substring de um token,
//       ou se um token começa com a pesquisa → match.
//    3. Levenshtein por token: tolera erros de escrita em palavras
//       individuais (1-3 erros consoante o tamanho).
//
//  normalizeStr (sem espaços) é mantido para outros usos (ex: normalizar
//  nomes de utilizador para comparação).
// ─────────────────────────────────────────────
function normalizeStr(str) {
  if (!str) return "";
  return String(str)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/[^a-z0-9]/g, "");      // remove caracteres especiais
}

// Normaliza preservando espaços — para dividir em tokens (palavras).
function normalizeTokens(str) {
  if (!str) return "";
  return String(str)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")   // caracteres especiais → espaço
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

// Tolerância de erros por palavra (Levenshtein), escalada por tamanho.
// 1-2 letras: 0 erros (exato), 3-4: 1 erro, 5-7: 2 erros, 8+: 3 erros.
function tokenTolerance(len) {
  if (len <= 2) return 0;
  if (len <= 4) return 1;
  if (len <= 7) return 2;
  return 3;
}

// Verifica se um token da pesquisa corresponde a um token do título.
// Estratégias (por ordem de custo computacional):
//   1. Igualdade exata
//   2. Token do título começa com o token da pesquisa (prefix match)
//   3. Token da pesquisa é substring do token do título
//   4. Levenshtein com tolerância escalada (com guarda de rácio de tamanho
//      para evitar falsos positivos entre tokens de tamanhos muito diferentes)
function tokenMatches(queryToken, titleToken) {
  if (!queryToken || !titleToken) return false;
  if (queryToken === titleToken) return true;
  if (titleToken.startsWith(queryToken)) return true;
  if (titleToken.includes(queryToken)) return true;
  // Levenshtein só para tokens com >= 3 chars (evita falsos positivos curtos)
  if (queryToken.length >= 3 && titleToken.length >= 3) {
    // Guarda de rácio: o token menor tem de ter pelo menos 65% do tamanho
    // do maior. Isto evita falsos positivos entre tokens de tamanhos muito
    // diferentes (ex: "theve" vs "the" → rácio 0.6 → rejeitado).
    const minLen = Math.min(queryToken.length, titleToken.length);
    const maxLen = Math.max(queryToken.length, titleToken.length);
    if (minLen / maxLen < 0.65) return false;
    const tol = tokenTolerance(queryToken.length);
    const dist = levenshtein(queryToken, titleToken);
    if (dist <= tol) return true;
  }
  return false;
}

// Verifica se um jogo da lista corresponde à pesquisa (fuzzy).
// Todas as palavras da pesquisa devem encontrar match em algum token do título.
// Isto permite pesquisar "mario bros" e encontrar "Super Mario Bros",
// ou "the last" e encontrar "The Last of Us".
function fuzzyMatchGame(query, game) {
  if (!query || !game || !game.name) return false;

  const queryTokens = normalizeTokens(query).split(" ").filter(Boolean);
  if (queryTokens.length === 0) return false;

  const titleTokens = normalizeTokens(game.name).split(" ").filter(Boolean);
  if (titleTokens.length === 0) return false;

  // Cada token da pesquisa tem de fazer match com pelo menos um token do título
  return queryTokens.every(qToken =>
    titleTokens.some(tToken => tokenMatches(qToken, tToken))
  );
}

// ─────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────

// Cloudflare Worker proxy — faz a ponte com as APIs do IGDB e da Steam sem erros de CORS.
// A partir da Etapa 2, o MESMO worker faz proxy de ambas as APIs:
//   - IGDB:  POST /<endpoint>                 (comportamento original, retrocompatível)
//   - Steam: GET  /steam/api/appdetails?...   (Etapa 2)
//            GET  /steam/appreviews/<id>?...  (Etapa 2)
// Ver cloudflare-worker/worker.js para o código do worker atualizado.
const IGDB_PROXY  = "https://igdb-proxy.dr-mx-droid.workers.dev";
const STEAM_PROXY = IGDB_PROXY + "/steam"; // mesmo worker, prefixo /steam
const STEAM_API_PROXY = IGDB_PROXY + "/steamapi"; // rota para api.steampowered.com (News API)

const IGDB_CLIENT_ID     = "m079gokvukuokos50mw73b4qluwskc";
const IGDB_ACCESS_TOKEN  = "6d3x70gthrbk8ag7p06kyxfzu9v1r4";

// ⚠️  Versão do cache bumped v3 → v4 na Etapa 1 da integração Steam.
// Motivo: o objeto normalizado ganhou o campo `steamAppId`. Caches antigos
// (v3) não têm este campo e foram invalidados. A limpeza das chaves v3
// acontece mais abaixo (one-time migration) para não deixar lixo no localStorage.
const CACHE_KEY     = "jce_games_cache_v4";
const CACHE_TS_KEY  = "jce_games_cache_ts_v4";

// ── OTIMIZAÇÃO DE LOADINGS ──
// O cache IGDB tem 2 TTLs (estratégia stale-while-revalidate):
//   - CACHE_STALE_MS (30 min): se o cache for mais recente, é usado SEM revalidação.
//     O site carrega instantaneamente. (Dados IGDB raramente mudam: nome, cover,
//     screenshots são estáticos. 30 min é seguro.)
//   - CACHE_MAX_MS (24h): se o cache tiver menos de 24h, é usado IMEDIATAMENTE
//     para render (stale), MAS revalida em background (fetch fresco).
//     Isto dá load instantâneo + dados atualizados sem bloquear a UI.
//   - Após 24h: o cache é ignorado, força fetch fresco (load normal).
//
// Antes era 5 min único TTL — o que explicava o "carregar tudo outra vez"
// após algum tempo. Agora: revisitas em <30min = instantâneo; 30min-24h =
// instantâneo + revalidação silenciosa; >24h = load normal.
const CACHE_STALE_MS = 30 * 60 * 1000;       // 30 min — fresco, sem revalidar
const CACHE_MAX_MS   = 24 * 60 * 60 * 1000;  // 24h — stale mas usável + revalida

// One-time migration: remove chaves de cache antigas (v3) para evitar lixo.
try {
  localStorage.removeItem("jce_games_cache_v3");
  localStorage.removeItem("jce_games_cache_ts_v3");
} catch (_) {}

// ─────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────
let gamesData   = [];   // [{id, igdbId, name, cover, screenshots, videos, genres, modes, rating, summary, steamUrl, steamAppId, addedAt, preferredKeyArt, playlistUrl}]
let gamesLoaded  = false; // true após o primeiro carregamento completo do onSnapshot (listenToGames)
let adminOpen     = false; // true enquanto o "modo editor" está ativo (cards mostram botões de admin)
let adminExpanded = false; // true quando o painel de admin (canto inferior direito) está descolapsado
let testsExpanded = false; // true quando o painel de testes (ao lado da pesquisa) está descolapsado
let adminActiveTab = "games"; // tab ativa no painel de admin: "games" | "accounts"
let forcedLoadingActive = false; // true enquanto o loading é forçado a aparecer indefinidamente (debug)
let modalOpen   = false;
let modalIndex  = 0;    // índice de media no modal
let modalMediaList = []; // [{type:'img'|'video', src, thumb, videoId?, ageRestricted?}]
let _modalCurrentGame = null; // referência ao jogo actualmente no modal
let infoExpanded = false; // estado do painel modal-info expandido
let modalAutoTimer = null; // setTimeout do auto-advance (screenshots: 5s; vídeos: 'ended')

// Cache de vídeos age-restricted do YouTube (persistida entre sessões).
// Chave: videoId → true (age-restricted). Evita voltar a testar vídeos já
// identificados como não-embebíveis (onError 101/150).
const YT_AGE_RESTRICTED_KEY = "jce_yt_age_restricted";
let ytAgeRestrictedCache = new Set();
try {
  const raw = localStorage.getItem(YT_AGE_RESTRICTED_KEY);
  if (raw) ytAgeRestrictedCache = new Set(JSON.parse(raw));
} catch (_) {}

function markVideoAgeRestricted(videoId) {
  if (!videoId || ytAgeRestrictedCache.has(videoId)) return;
  ytAgeRestrictedCache.add(videoId);
  try { localStorage.setItem(YT_AGE_RESTRICTED_KEY, JSON.stringify([...ytAgeRestrictedCache])); } catch (_) {}
}

function isVideoAgeRestricted(videoId) {
  return videoId ? ytAgeRestrictedCache.has(videoId) : false;
}

// ── Tabs, sort, view ─────────────────────────
// Tabs: [{id, label}] — persisted in localStorage
let tabsData    = [];    // lista de tabs criadas em admin
let activeTab   = "all"; // "all" | tabId

// tabId → Set of firebaseIds
let tabGamesMap = {};    // {tabId: Set<firebaseId>}

// Down-votes: { firebaseId: Set<userId> }
// Quando um jogo tem >=2 down-votes, é movido para a tab "Lixo".
let downvotesMap = {};   // {firebaseId: Set<userId>}
let upvotesMap = {};     // {firebaseId: Set<userId>}
let trashTabId = null;   // ID da tab "Reprovados" (criada automaticamente)
let approvedTabId = null; // ID da tab "Aprovados" (criada automaticamente)
let playedTabId = null;   // ID da tab "Jogados" (criada automaticamente)
const DOWNVOTE_THRESHOLD = 2;
const APPROVED_UPVOTE_COUNT = 3; // exatamente 3 upvotes = aprovado

// ── Helpers para identificar tabs especiais pelo label ──────────
// As tabs especiais (Reprovados/Aprovados/Jogados) podem ter labels em PT
// ou EN (dependendo do idioma ativo quando foram criadas). Estes helpers
// centralizam a verificação para evitar duplicação de conjuntos de labels.
const TRASH_LABELS    = ["Reprovados", "Lixo", "Trash", "Rejected"];
const APPROVED_LABELS = ["Aprovados", "Approved"];
const PLAYED_LABELS   = ["Jogados", "Played"];
const isTrashLabel    = (label) => TRASH_LABELS.includes(label);
const isApprovedLabel = (label) => APPROVED_LABELS.includes(label);
const isPlayedLabel   = (label) => PLAYED_LABELS.includes(label);

// Sort: "random" | "name" | "upvotes" | "downvotes" | "rating"
const SORT_KEY  = "jce_sort";
let currentSort = localStorage.getItem(SORT_KEY) || "random";
// Migração: "upvotes-rev" foi renomeado para "downvotes" (nome mais claro —
// ordena por downvotes, não por upvotes reversos).
if (currentSort === "upvotes-rev") { currentSort = "downvotes"; localStorage.setItem(SORT_KEY, "downvotes"); }

// random seed per session — ensures same order within a session but different each load
let randomSeed  = Math.random();
function seededRandom(seed, idx) {
  // Simple deterministic pseudo-random based on seed + index
  const x = Math.sin(seed * 9301 + idx * 49297 + 233720) * 19301;
  return x - Math.floor(x);
}

// View: "grid" | "five" | "compact"
const VIEW_KEY  = "jce_view";
let currentView = localStorage.getItem(VIEW_KEY) || "grid";
// Migrate legacy "list" view (removed) to "grid"
if (currentView === "list") { currentView = "grid"; localStorage.setItem(VIEW_KEY, "grid"); }

// Add-to-tab modal state
let addTabTargetGame = null;

// ── Tag filter state ──────────────────────────
let activeTagFilters = new Set(); // set of tag strings currently active
let activeStatusFilters = new Set(); // set of release-status strings currently active
let currentTagSubtab = "tags"; // "tags" | "status" | "common"
let commonGamesFilterUserId = null; // userId para filtro "Jogos em comum"

// Jogos escondidos localmente (pelo user actual dar down-vote)
// Persistido em localStorage. Quando o user dá down-vote, o jogo é escondido.
// Pode ser revertido via "Mostrar jogos escondidos" no menu da engrenagem.
const HIDDEN_GAMES_KEY = "jce_hidden_games";
let hiddenGames = new Set();
let showHiddenGames = false; // default: não mostrar
let youtubeAutoplay = true; // default: autoplay on

// Carrega jogos escondidos do localStorage
function loadHiddenGames() {
  try {
    const raw = localStorage.getItem(HIDDEN_GAMES_KEY);
    if (raw) hiddenGames = new Set(JSON.parse(raw));
  } catch (_) { hiddenGames = new Set(); }
}

// Guarda jogos escondidos no localStorage
function saveHiddenGames() {
  try { localStorage.setItem(HIDDEN_GAMES_KEY, JSON.stringify([...hiddenGames])); } catch (_) {}
}

// ─────────────────────────────────────────────
//  VISITED GAMES — jogos já vistos pelo utilizador
//  Persistido em localStorage. Usado para:
//  - Label "Novidade" no modo Descoberta
//  - Ordenar jogos não-visitados primeiro na queue
// ─────────────────────────────────────────────
const VISITED_KEY = "jce_visited_games";
let visitedGames = new Set();

function loadVisitedGames() {
  try {
    const raw = localStorage.getItem(VISITED_KEY);
    if (raw) visitedGames = new Set(JSON.parse(raw));
  } catch (_) { visitedGames = new Set(); }
}

function saveVisitedGames() {
  try { localStorage.setItem(VISITED_KEY, JSON.stringify([...visitedGames])); } catch (_) {}
}

// Marca um jogo como visitado (se ainda não estava)
function markGameVisited(firebaseId) {
  if (!firebaseId || visitedGames.has(firebaseId)) return;
  visitedGames.add(firebaseId);
  saveVisitedGames();
}

// Verifica se um jogo já foi visitado
function isGameVisited(firebaseId) {
  return visitedGames.has(firebaseId);
}

// Carrega preferências do localStorage
function loadPreferences() {
  try {
    showHiddenGames = localStorage.getItem("jce_show_hidden") === "1";
  } catch (_) {}
  try {
    youtubeAutoplay = localStorage.getItem("jce_yt_autoplay") !== "0";
  } catch (_) {}
  // BUG #5 fix: carregar notificationsMuted aqui (em vez de em loadNotifications)
  // porque initSettings() corre ANTES de initNotifications() e precisa do valor.
  try {
    notificationsMuted = localStorage.getItem("jce_mute_notifications") === "1";
  } catch (_) {}
}

// ─────────────────────────────────────────────
//  DOM REFS
// ─────────────────────────────────────────────
const $gameList      = document.getElementById("game-list");
const $loadingState  = document.getElementById("loading-state");
const $emptyState    = document.getElementById("empty-state");
const $adminOverlay  = document.getElementById("admin-overlay");
const $adminPanel    = document.getElementById("admin-panel");
const $adminFab      = document.getElementById("admin-fab");
const $adminClose    = document.getElementById("admin-close");
const $adminSearch   = document.getElementById("admin-search-input");
const $adminSearchBtn= document.getElementById("admin-search-btn");
const $adminResults  = document.getElementById("admin-search-results");
const $adminTestsBtn = document.getElementById("admin-tests-btn");
const $adminTestsPanel = document.getElementById("admin-tests-panel");
const $adminForceLoadingBtn = document.getElementById("admin-force-loading-btn");
const $adminForceLoadingLabel = document.getElementById("admin-force-loading-label");
const $adminCreateTrashBtn = document.getElementById("admin-create-trash-btn");
const $adminClearTrashBtn = document.getElementById("admin-clear-trash-btn");
const $adminGameList = document.getElementById("admin-game-list");
const $adminStatus   = document.getElementById("admin-status");
const $adminHint     = document.getElementById("admin-hint");
const $adminHintText = document.getElementById("admin-hint-text");
// ── Admin tabs (Jogos | Contas) ──
const $adminTabs       = document.getElementById("admin-tabs");
const $adminTabGames   = document.getElementById("admin-tab-games");
const $adminTabAccounts= document.getElementById("admin-tab-accounts");
const $adminAccountsList = document.getElementById("admin-accounts-list");
const $gameModal     = document.getElementById("game-modal");
const $modalBackdrop = document.getElementById("modal-backdrop");
const $modalClose    = document.getElementById("modal-close");
const $modalMedia    = document.getElementById("modal-media");
const $modalInfo     = document.getElementById("modal-info");
const $modalExtraInfo = document.getElementById("modal-extra-info");
const $modalBanner   = document.getElementById("modal-banner");
const $keyartModal   = document.getElementById("keyart-modal");
const $keyartBackdrop= document.getElementById("keyart-backdrop");
const $keyartClose   = document.getElementById("keyart-close");
const $keyartGrid    = document.getElementById("keyart-grid");
const $keyartTitle   = document.getElementById("keyart-title");

// Toolbar
const $tabsDropdown       = document.getElementById("tabs-dropdown");
const $tabsDropdownTrigger= document.getElementById("tabs-dropdown-trigger");
const $tabsDropdownLabel  = document.getElementById("tabs-dropdown-label");
const $tabsDropdownCount  = document.getElementById("tabs-dropdown-count");
const $tabsDropdownMenu   = document.getElementById("tabs-dropdown-menu");
const $createTabWrap   = document.getElementById("create-tab-wrap");
const $createTabBtn    = document.getElementById("create-tab-btn");
const $createTabInputWrap = document.getElementById("create-tab-input-wrap");
const $createTabInput  = document.getElementById("create-tab-input");
const $createTabConfirm= document.getElementById("create-tab-confirm");

// --- Filter ---
const $tagFilter        = document.getElementById("tag-filter");
const $tagFilterTrigger = document.getElementById("tag-filter-trigger");
const $tagFilterLabel   = document.getElementById("tag-filter-label");
const $tagFilterCount   = document.getElementById("tag-filter-count");
const $tagFilterClear   = document.getElementById("tag-filter-clear");
const $tagFilterQuickClear = document.getElementById("tag-filter-quick-clear");
const $tagFilterList    = document.getElementById("tag-filter-list");
const $tagFilterListStatus   = document.getElementById("tag-filter-list-status");
const $tagFilterHeaderLabel  = document.getElementById("tag-filter-header-label");
const $tagFilterSubtabTags   = document.getElementById("tag-filter-subtab-tags");
const $tagFilterSubtabStatus = document.getElementById("tag-filter-subtab-status");
// ------------------------------------

// --- Discover ---
const $discoverWrap    = document.getElementById("discover-wrap");
const $discoverTrigger = document.getElementById("discover-trigger");
const $discoverLabel   = document.getElementById("discover-label");
const $discoverNavPrev = document.getElementById("discover-nav-prev");
const $discoverNavNext = document.getElementById("discover-nav-next");
// ------------------------------------

// Add-to-tab modal
const $addtabModal     = document.getElementById("addtab-modal");
const $addtabBackdrop  = document.getElementById("addtab-backdrop");
const $addtabClose     = document.getElementById("addtab-close");
const $addtabTitle     = document.getElementById("addtab-title");

// ─────────────────────────────────────────────
//  IGDB API HELPER
//  Nota: em produção, este call deve ir para o teu backend/proxy
// ─────────────────────────────────────────────
async function igdbRequest(endpoint, body) {
  const res = await fetch(`${IGDB_PROXY}/${endpoint}`, {
    method: "POST",
    headers: {
      "Client-ID": IGDB_CLIENT_ID,
      "Authorization": `Bearer ${IGDB_ACCESS_TOKEN}`,
      "Content-Type": "text/plain",
    },
    body,
  });
  if (!res.ok) throw new Error(`IGDB error: ${res.status}`);
  return res.json();
}

// ─────────────────────────────────────────────
//  STEAM API HELPERS (Etapa 2)
//
//  A Steam Storefront API não suporta CORS — todos os pedidos passam
//  pelo Cloudflare Worker (STEAM_PROXY). As credenciais não são necessárias
//  (a storefront API é pública, sem API key).
//
//  Importante sobre linguagem:
//   - appdetails usa o parâmetro `l=` para localização de nomes/descrições.
//     PT-PT = "portuguese", EN = "english" (ver steamLangCode()).
//   - appreviews usa `language=`. Para totais estáveis e representativos,
//     usamos SEMPRE "english" independentemente do idioma da UI — os totais
//     em PT são muito mais baixos e enviesados (só reviews em português).
//
//  Importante sobre reviews "recentes":
//   - A Steam API NÃO expõe um sumário de apenas reviews recentes.
//     `filter=recent` só muda a ordenação; `query_summary.total_reviews`
//     reflete sempre o total global. Por acordo com o user, mostramos o
//     sumário global (review_score_desc + total).
// ─────────────────────────────────────────────

// Mapeia o idioma da UI para o código aceito pela Steam Storefront API.
// PT-PT → "portuguese" (Europeu); EN → "english".
// NOTA: "portuguese-brazil" NÃO funciona — cai para inglês. Para PT-BR usar "brazilian".
function steamLangCode() {
  return isPt() ? "portuguese" : "english";
}

// Busca os detalhes da app na Steam Storefront API.
// Retorna o objeto `data` da resposta, ou null se:
//   - o appId for inválido/vazio
//   - a Steam retornar success=false (jogo removido/privado)
//   - houver erro de rede ou rate-limit (429) — não lança, retorna null
// Parâmetro `lang`: código Steam (default = idioma da UI).
async function steamAppDetails(appId, lang) {
  if (!appId) return null;
  const l = lang || steamLangCode();
  const url = `${STEAM_PROXY}/api/appdetails?appids=${encodeURIComponent(appId)}&l=${encodeURIComponent(l)}`;

  // Cache check — a key inclui o idioma porque o conteúdo (nome, descrição,
  // data de lançamento) é localizado pela Steam. Sem isto, trocar de idioma
  // serviria a versão em cache no idioma antigo.
  const cacheKey = `${appId}::${l}`;
  const cached = getCachedSteam(STEAM_DETAILS_CACHE_KEY, cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      // 429 = rate limit; não lançar — o caller faz fallback IGDB
      if (res.status === 429) return null;
      throw new Error(`Steam appdetails HTTP ${res.status}`);
    }
    const json = await res.json();
    // A resposta tem a forma { "<appId>": { success: bool, data: {...} } }
    const entry = json[String(appId)];
    if (!entry || !entry.success || !entry.data) return null;
    const data = entry.data;
    setCachedSteam(STEAM_DETAILS_CACHE_KEY, cacheKey, data);
    return data;
  } catch (e) {
    console.warn("[steamAppDetails] erro para appId", appId, e.message);
    return null;
  }
}

// Busca o sumário de reviews da Steam (totals globais + review_score_desc).
// Sempre em inglês para totais representativos (ver nota acima).
// Retorna { review_score, review_score_desc, total_positive, total_negative, total_reviews }
// ou null em caso de erro / appId inválido.
async function steamReviewSummary(appId) {
  if (!appId) return null;
  const url = `${STEAM_PROXY}/appreviews/${encodeURIComponent(appId)}?json=1&filter=recent&language=english&purchase_type=all&num_per_page=0`;

  // Cache check
  const cached = getCachedSteam(STEAM_REVIEWS_CACHE_KEY, appId);
  if (cached) return cached;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 429) return null;
      throw new Error(`Steam appreviews HTTP ${res.status}`);
    }
    const json = await res.json();
    if (!json || json.success !== 1 || !json.query_summary) return null;
    const summary = json.query_summary;
    setCachedSteam(STEAM_REVIEWS_CACHE_KEY, appId, summary);
    return summary;
  } catch (e) {
    console.warn("[steamReviewSummary] erro para appId", appId, e.message);
    return null;
  }
}

// ─────────────────────────────────────────────
//  STEAM NEWS API — último update (Etapa Updates)
//
//  Busca a data do último patch/update do jogo via Steam News API.
//  Endpoint: ISteamNews/GetNewsForApp/v2/?appid=<ID>&count=1&maxlength=1&tags=patchnotes
//  - tags=patchnotes filtra só patch notes (ignora anúncios/marketing)
//  - count=1 + maxlength=1 = payload mínimo (só precisamos da data)
//  - Não precisa de API key (endpoint público)
//  - Passa pelo Worker (rota /steamapi/) por causa de CORS
//
//  Retorna { date, title, gid, url } ou null se:
//    - appId invazio
//    - jogo sem patch notes (newsitems vazio)
//    - erro de rede/rate-limit (429)
// ─────────────────────────────────────────────
async function fetchSteamLastUpdate(appId) {
  if (!appId) return null;

  // Cache check (1h TTL — os updates não mudam frequentemente)
  const cached = getCachedSteam(STEAM_UPDATES_CACHE_KEY, appId);
  if (cached) return cached;

  const url = `${STEAM_API_PROXY}/ISteamNews/GetNewsForApp/v2/?appid=${encodeURIComponent(appId)}&count=1&maxlength=1&tags=patchnotes`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 429) return null; // rate-limit — fallback IGDB
      throw new Error(`Steam News HTTP ${res.status}`);
    }
    const json = await res.json();
    const item = json?.appnews?.newsitems?.[0];
    if (!item || !item.date) return null;

    const result = {
      date: item.date,                                              // Unix seconds
      title: item.title || null,
      gid: item.gid || null,
      // URL canónico da página de updates do jogo.
      // Nota: testámos /view/<gid> (deep-link para patch note específico) mas
      // não funciona para todos os jogos — gids com 19+ dígitos retornam
      // "Erro: o evento não existe" na Steam. A página geral de updates é
      // fiável e mostra o patch note mais recente logo no topo.
      url: `https://store.steampowered.com/news/app/${appId}`,
    };
    setCachedSteam(STEAM_UPDATES_CACHE_KEY, appId, result);
    return result;
  } catch (e) {
    console.warn("[fetchSteamLastUpdate] erro para appId", appId, e.message);
    return null;
  }
}

// Devolve info do último update do jogo, preferindo Steam sobre IGDB.
// Retorna { source: "steam"|"igdb", date, title, url } ou null.
// - Steam: data do último patch note (fiável) + URL para página de updates
// - IGDB: updated_at (data de edição do registo — menos fiável, sem URL)
async function computeLastUpdate(game) {
  if (!game) return null;

  // 1. Tentar Steam (se jogo tem steamAppId e foi enriched)
  if (game.steamAppId) {
    const steamUpdate = await fetchSteamLastUpdate(game.steamAppId);
    if (steamUpdate) {
      return {
        source: "steam",
        date: steamUpdate.date,        // Unix seconds
        title: steamUpdate.title,
        url: steamUpdate.url,
      };
    }
  }

  // 2. Fallback: IGDB updated_at (data de edição do registo)
  if (game.igdbUpdatedAt) {
    return {
      source: "igdb",
      date: game.igdbUpdatedAt,        // Unix seconds
      title: null,
      url: null,                       // IGDB não tem página de updates canónica
    };
  }

  return null;
}

// Versão SÍNCRONA de computeLastUpdate para uso no render (renderModalExtraInfo).
// Usa os dados já em cache no objeto do jogo (steamLastUpdate populado pelo
// enrichment). Não faz fetches — se steamLastUpdate for null, usa igdbUpdatedAt.
function computeLastUpdateSync(game) {
  if (!game) return null;

  // 1. Steam (se já enriched com steamLastUpdate)
  if (game.steamLastUpdate) {
    return {
      source: "steam",
      date: game.steamLastUpdate.date,
      title: game.steamLastUpdate.title,
      url: game.steamLastUpdate.url,
    };
  }

  // 2. Fallback: IGDB updated_at
  if (game.igdbUpdatedAt) {
    return {
      source: "igdb",
      date: game.igdbUpdatedAt,
      title: null,
      url: null,
    };
  }

  return null;
}

// Formata a data do último update para exibição.
// Usa o locale consoante o idioma activo (pt-PT ou en-GB).
// Formato: "24 de junho de 2026" (PT) / "24 June 2026" (EN)
function formatLastUpdateDate(unixTs) {
  if (!unixTs) return null;
  try {
    const locale = isPt() ? "pt-PT" : "en-GB";
    return new Date(unixTs * 1000).toLocaleDateString(locale, {
      day: "2-digit", month: "long", year: "numeric"
    });
  } catch (e) { return null; }
}

async function searchGames(term) {
  return igdbRequest("games", `
    search "${term}";
    fields name, cover.url, first_release_date, summary, rating,
           genres.name, themes.name, game_modes.name,
           screenshots.url, videos.video_id, artworks.url,
           websites.url, websites.category,
           involved_companies.company.name, involved_companies.developer, involved_companies.publisher,
           game_engines.name, status, updated_at,
           language_supports.language.locale, language_supports.language_support_type.name;
    limit 8;
  `);
}

async function fetchGameById(igdbId) {
  const results = await igdbRequest("games", `
    fields name, cover.url, first_release_date, summary, rating,
           genres.name, themes.name, game_modes.name,
           screenshots.url, videos.video_id, artworks.url,
           websites.url, websites.category,
           involved_companies.company.name, involved_companies.developer, involved_companies.publisher,
           game_engines.name, status, updated_at,
           language_supports.language.locale, language_supports.language_support_type.name;
    where id = ${igdbId};
    limit 1;
  `);
  return results[0] || null;
}

// fetchGameById com retry automático (3 tentativas, backoff exponencial).
// Evita que jogos desapareçam da lista devido a falhas temporárias do
// proxy IGDB (rate limit, rede, etc.).
async function fetchGameByIdWithRetry(igdbId, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const game = await fetchGameById(igdbId);
      if (game) return game;
      // IGDB devolveu array vazio — jogo pode ter sido removido; não retentar
      return null;
    } catch (e) {
      if (attempt === maxRetries) throw e;
      // Backoff exponencial: 500ms, 1000ms, 2000ms
      const delay = 500 * Math.pow(2, attempt);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  return null;
}

// ─────────────────────────────────────────────
//  IGDB DATA HELPERS
// ─────────────────────────────────────────────
function coverUrl(url) {
  if (!url) return null;
  return url.replace("t_thumb", "t_cover_big").replace("//", "https://");
}

function screenshotUrl(url) {
  if (!url) return null;
  return url.replace("t_thumb", "t_screenshot_big").replace("//", "https://");
}

function artworkUrl(url) {
  if (!url) return null;
  return url.replace("t_thumb", "t_1080p").replace("//", "https://");
}

function youtubeEmbed(videoId) {
  const autoplay = youtubeAutoplay ? "1" : "0";
  return `https://www.youtube.com/embed/${videoId}?autoplay=${autoplay}&mute=0&controls=1&modestbranding=1&rel=0&iv_load_policy=3&playsinline=1&enablejsapi=1`;
}

function youtubeThumbnail(videoId) {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

// Extrai o playlist ID de uma URL de playlist do YouTube.
// Aceita formatos:
//   https://www.youtube.com/playlist?list=PLxxxx
//   https://youtube.com/watch?v=xxx&list=PLxxxx
//   https://youtu.be/xxx?list=PLxxxx
// Retorna o playlist ID ou null se não for válido.
function extractPlaylistId(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const u = new URL(url.trim());
    return u.searchParams.get("list") || null;
  } catch (_) {
    return null;
  }
}

// Cria o embed URL para uma playlist do YouTube (videoseries).
// Este URL carrega o player da playlist completa, permitindo navegação
// entre vídeos via postMessage (nextVideo/previousVideo).
function youtubePlaylistEmbed(playlistId) {
  const autoplay = youtubeAutoplay ? "1" : "0";
  return `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(playlistId)}&autoplay=${autoplay}&mute=0&controls=1&modestbranding=1&rel=0&iv_load_policy=3&playsinline=1&enablejsapi=1`;
}

function steamUrl(websites) {
  if (!websites) return null;
  // Category 13 = Steam on IGDB; fallback: any URL containing steampowered.com
  const steam = websites.find(w => w.category === 13)
             || websites.find(w => w.url && w.url.includes("steampowered.com"));
  return steam ? steam.url : null;
}

// Extrai o Steam App ID (numérico) de uma URL da Steam Store.
// Aceita os formatos:
//   https://store.steampowered.com/app/<APPID>/<slug>/
//   https://store.steampowered.com/app/<APPID>/
//   https://store.steampowered.com/agecheck/app/<APPID>/   (age-gate interstitial)
// Retorna o App ID como string (preserva leading zeros caso existam) ou null.
// Não match bundle/sub URLs — esses não são app IDs.
function steamAppId(url) {
  if (!url) return null;
  const m = String(url).match(/\/(?:agecheck\/)?app\/(\d+)/);
  return m ? m[1] : null;
}

function genreTags(genres) {
  return (genres || []).map(g => g.name || g).slice(0, 3);
}

function modeTags(modes) {
  return (modes || []).map(m => m.name || m);
}

function modeClass(name) {
  const n = (name || "").toLowerCase();
  if (n.includes("mmo")) return "mmo";
  if (n.includes("co-op") || n.includes("coop") || n.includes("cooperative")) return "coop";
  if (n.includes("multi")) return "multiplayer";
  return "";
}

function ratingStr(r) {
  if (!r) return null;
  return (r / 10).toFixed(1);
}

// ─────────────────────────────────────────────
//  STEAM REVIEW BADGE (Etapa 4)
//
//  Devolve HTML para o badge de reviews da Steam, com fallback para o
//  rating do IGDB quando não houver dados Steam.
//
//  Lógica de fallback:
//   1. Se game.steamReviewDesc existe E total_reviews > 0 → badge Steam
//   2. Se game.steamReviewDesc === "No user reviews" → badge "Sem análises"
//   3. Caso contrário (sem Steam, ou enrich falhou) → null (caller mostra rating IGDB)
//
//  O badge Steam mostra:
//   - review_score_desc traduzido (ex: "Muito Positivas")
//   - percentagem positiva (ex: "87%")
//   - total de reviews abreviado (ex: "2.5M", "12K")
//
//  Cores (definidas no CSS via classe steam-review-{positive|mixed|negative|none}):
//   - Positive (score 6-9): verde
//   - Mixed (score 5): amarelo
//   - Negative (score 1-4): vermelho
//   - No reviews: cinzento
// ─────────────────────────────────────────────

// Abrevia um número grande: 2560529 → "2.6M", 12345 → "12K", 999 → "999"
function abbreviateNumber(n) {
  if (!n || n < 1000) return String(n || 0);
  if (n < 10000) return (n / 1000).toFixed(1).replace(".0", "") + "K";
  if (n < 1000000) return Math.round(n / 1000) + "K";
  return (n / 1000000).toFixed(1).replace(".0", "") + "M";
}

// Mapeia review_score (int 0-9) → classe CSS para cor do badge
function steamReviewClass(score, desc) {
  if (desc === "No user reviews" || score === 0) return "none";
  if (score == null) return "none";
  if (score >= 6) return "positive"; // Positive, Very Positive, Overwhelmingly Positive
  if (score === 5) return "mixed";   // Mixed
  return "negative";                 // Negative, Mostly Negative, Very Negative, Overwhelmingly Negative
}

// Traduz o review_score_desc da Steam (EN) para o idioma da UI.
// O DICT tem as keys em PT; precisamos de inverter a lookup quando estamos
// em modo PT (desc vem em EN da Steam, mas em PT queremos a nossa tradução).
function translateSteamReviewDesc(desc) {
  if (!desc) return null;
  // Mapa inverso: EN → PT (para modo PT)
  const EN_TO_PT = {
    "Overwhelmingly Positive": "Esmagadoramente Positivas",
    "Very Positive":           "Muito Positivas",
    "Mostly Positive":         "Maioritariamente Positivas",
    "Positive":                "Positivas",
    "Mixed":                   "Misturadas",
    "Negative":                "Negativas",
    "Mostly Negative":         "Maioritariamente Negativas",
    "Very Negative":           "Muito Negativas",
    "Overwhelmingly Negative": "Esmagadoramente Negativas",
    "No user reviews":         "Sem análises",
  };
  if (isPt()) {
    return EN_TO_PT[desc] || desc; // fallback: mostra o EN se não houver tradução
  }
  return desc; // modo EN: mostra o desc original da Steam
}

// Devolve HTML do badge de review Steam, ou null se não houver dados Steam.
// O caller (card/modal/discover) usa isto; se retorn null, mostra o rating IGDB.
function steamReviewBadgeHtml(game) {
  if (!game || !game.steamEnriched) return null;
  const desc = game.steamReviewDesc;
  if (!desc) return null;

  const cls = steamReviewClass(game.steamReviewScore, desc);
  const descTranslated = translateSteamReviewDesc(desc);

  // Badge: apenas o descritor traduzido (sem % nem total visíveis).
  // O total fica disponível no tooltip (title) para quem quiser detalhe.
  const total = game.steamReviewTotal > 0 ? abbreviateNumber(game.steamReviewTotal) : null;
  const reviewsLabel = t("análises");
  const title = total
    ? `${descTranslated} • ${total} ${reviewsLabel}`
    : descTranslated;

  return `<span class="steam-review-badge steam-review-${cls}" title="${escHtml(title)}">${escHtml(descTranslated)}</span>`;
}

// Nomes de empresas envolvidas, filtrados por papel ("developer" ou "publisher")
function companyNames(involvedCompanies, roleKey) {
  return (involvedCompanies || [])
    .filter(ic => ic && ic[roleKey] && ic.company && ic.company.name)
    .map(ic => ic.company.name);
}

function engineNames(engines) {
  return (engines || []).map(e => e && e.name).filter(Boolean);
}

// Detecta PT-PT / PT-BR / EN-US a partir de language_supports (locale IGDB).
// Mostra sempre EN-US; PT-PT e/ou PT-BR só se existirem. Mais nenhuma língua.
function languageStr(languageSupports) {
  const locales = new Set((languageSupports || []).map(ls => ls.language && ls.language.locale).filter(Boolean));
  const out = [];
  if (locales.has("pt-PT")) out.push("PT-PT");
  if (locales.has("pt-BR")) out.push("PT-BR");
  out.push("EN-US");
  return out.join(" / ");
}

function themeNames(themes) {
  return (themes || []).map(t => t && t.name).filter(Boolean);
}

// Estado de lançamento — usa o enum "status" da IGDB; se não existir,
// infere "Lançado" / "Por lançar" a partir da data de lançamento.
const RELEASE_STATUS_MAP = {
  0: "Lançado",
  2: "Alpha",
  3: "Beta",
  4: "Acesso Antecipado",
  5: "Offline",
  6: "Cancelado",
  7: "Rumor",
  8: "Removido de venda",
};

function releaseStatusStr(status, firstReleaseTs) {
  const mapped = (status != null) ? RELEASE_STATUS_MAP[status] : null;

  // Acesso Antecipado (status 4) sem data, ou com data no futuro:
  // o jogo ainda não lançou de facto — substitui por "Por lançar"
  if (mapped === "Acesso Antecipado") {
    if (!firstReleaseTs || firstReleaseTs * 1000 > Date.now()) {
      return "Por lançar";
    }
  }

  if (mapped) return mapped;

  if (firstReleaseTs) {
    return (firstReleaseTs * 1000 <= Date.now()) ? "Lançado" : "Por lançar";
  }

  // Sem status e sem data — sem informação, assume por lançar
  return "Por lançar";
}

// CSS class for release status badge colour
// Compares directly against the known values from RELEASE_STATUS_MAP
// and the inferred strings from releaseStatusStr — avoids accent issues.
function releaseStatusClass(statusStr) {
  if (!statusStr) return "unknown";
  switch (statusStr) {
    case "Lançado":           return "released";
    case "Acesso Antecipado": return "early";
    case "Por lançar":
    case "Alpha":
    case "Beta":
    case "Offline":
    case "Cancelado":
    case "Rumor":
    case "Removido de venda": return "pending";
    default:                  return "unknown";
  }
}

// Data de lançamento completa e legível (ex: "23 de dezembro de 2020" ou "23 December 2020")
// Usa o locale consoante o idioma activo (pt-PT ou en-GB).
function fullReleaseDateStr(unixTs) {
  if (!unixTs) return null;
  try {
    const locale = isPt() ? "pt-PT" : "en-GB";
    return new Date(unixTs * 1000).toLocaleDateString(locale, {
      day: "2-digit", month: "long", year: "numeric"
    });
  } catch(e) { return null; }
}

// ─────────────────────────────────────────────
//  RELEASE STATUS & DATE — Steam + IGDB crossover (Etapa 5)
//
//  A Steam pode ter informação mais atualizada que o IGDB sobre o estado
//  de lançamento (ex: jogo que saiu de Early Access mas o IGDB ainda marca
//  como status=4). Esta função cruza as duas fontes com fallback graceful.
//
//  PRIORIDADE:
//   1. Steam coming_soon === true → "Por lançar" (a Steam é a fonte mais
//      fiável para "ainda não lançou")
//   2. Steam coming_soon === false E IGDB status=4 (Early Access) com data
//      no passado → "Lançado" (saiu de early access; Steam atualizou, IGDB não)
//   3. Steam coming_soon === false (sem status IGDB) → "Lançado"
//   4. Caso contrário → lógica IGDB original (releaseStatusStr)
//
//  Nota: mantemos os labels PT como identificadores internos (igual ao IGDB)
//  para que as notificações (detectGameChanges) continuem a funcionar.
// ─────────────────────────────────────────────
function computeReleaseStatus(game) {
  if (!game) return "Por lançar";

  const steamComingSoon = game.steamComingSoon;
  const igdbStatus = game.releaseStatus; // já calculado por releaseStatusStr no normalizeGame

  // 1. Steam diz que ainda vai lançar — é a fonte mais fiável
  if (steamComingSoon === true) {
    // Mas se o IGDB tem status mais específico (Alpha/Beta/Early Access),
    // respeita-o — a Steam não distingue estes estados
    if (igdbStatus === "Alpha" || igdbStatus === "Beta" || igdbStatus === "Acesso Antecipado") {
      // Early Access com data futura → mantém "Por lançar" (lógica IGDB original)
      if (!game.firstReleaseTs || game.firstReleaseTs * 1000 > Date.now()) {
        return "Por lançar";
      }
      return igdbStatus;
    }
    return "Por lançar";
  }

  // 2. Steam diz que já lançou (coming_soon === false)
  if (steamComingSoon === false) {
    // Se o IGDB marca como Early Access mas a Steam diz que já lançou,
    // o jogo saiu de early access → "Lançado"
    if (igdbStatus === "Acesso Antecipado") {
      return "Lançado";
    }
    // Se o IGDB marca como "Por lançar" mas a Steam diz que já lançou,
    // confia na Steam → "Lançado"
    if (igdbStatus === "Por lançar") {
      return "Lançado";
    }
    // Senão, mantém o estado do IGDB (que pode ser mais específico:
    // Offline, Cancelado, Removido de venda, etc.)
    return igdbStatus || "Lançado";
  }

  // 3. Sem dados Steam (steamComingSoon === null) — fallback IGDB
  return igdbStatus || "Por lançar";
}

// Devolve a data de lançamento formatada, preferindo a data da Steam se disponível.
// A Steam devolve uma string localizada ("21 Aug, 2012" em EN, "21 ago, 2012" em PT)
// que já vem no idioma correto — usamo-la diretamente.
// Se não houver data Steam, usa o timestamp IGDB formatado via fullReleaseDateStr.
function computeReleaseDateFull(game) {
  if (!game) return null;
  // Steam tem data e está no idioma correto (vinda com l=portuguese ou l=english)
  if (game.steamReleaseDate && game.steamEnriched) {
    return game.steamReleaseDate;
  }
  // Fallback: timestamp IGDB
  if (game.firstReleaseTs) {
    return fullReleaseDateStr(game.firstReleaseTs);
  }
  // Último recurso: data em cache (pode estar null)
  return game.releaseDateFull || null;
}

// Normaliza dados do IGDB para o nosso formato
function normalizeGame(igdbGame) {
  const screenshots = (igdbGame.screenshots || []).map(s => screenshotUrl(s.url)).filter(Boolean);
  const artworks    = (igdbGame.artworks    || []).map(a => artworkUrl(a.url)).filter(Boolean);
  const videos = (igdbGame.videos || []).map(v => v.video_id).filter(Boolean);
  const year = igdbGame.first_release_date
    ? new Date(igdbGame.first_release_date * 1000).getFullYear()
    : null;

  // Steam URL + App ID extraídos do array `websites` do IGDB.
  // O App ID é derivado da URL (regex) — é a chave para a Steam Storefront API.
  const steam = steamUrl(igdbGame.websites);

  return {
    igdbId:      igdbGame.id,
    name:        igdbGame.name,
    cover:       coverUrl(igdbGame.cover?.url),
    screenshots,
    artworks,
    videos,
    genres:      genreTags(igdbGame.genres),
    themes:      themeNames(igdbGame.themes),
    modes:       modeTags(igdbGame.game_modes),
    rating:      igdbGame.rating || null,
    summary:     igdbGame.summary || "",
    steamUrl:    steam,
    steamAppId:  steamAppId(steam),
    // ── Steam enrichment (Etapa 3 + 4) ──
    // Populados async por fetchSteamImageFields() em paralelo com o IGDB.
    // Quando vazios (null/[]), o UI faz fallback para os dados IGDB acima.
    steamHeaderImage:  null,             // 460×215 — usado como fallback de cover
    steamScreenshots:  [],               // [{src, thumb}] — 1920×1080 (qualidade superior ao IGDB)
    steamBackground:   null,             // background_raw — hero opcional
    steamEnriched:     false,            // true após fetchSteamImageFields() completar
    // ── Steam reviews (Etapa 4) ──
    // review_score_desc da Steam (em EN); traduzido no render via t().
    // Se null após enrich, o UI mostra o rating IGDB (fallback).
    steamReviewDesc:     null,           // "Very Positive" / "No user reviews" / null
    steamReviewScore:    null,           // int 0-9 (escala Steam)
    steamReviewTotal:    0,              // int (total de reviews)
    steamReviewPositive: 0,              // int
    steamReviewNegative: 0,              // int
    steamReviewPct:      null,           // int 0-100 (percentagem positiva)
    // ── Steam release date (Etapa 5) ──
    // Populados por fetchSteamImageFields(). Usados por computeReleaseStatus()
    // e computeReleaseDateFull() para cruzar com os dados IGDB.
    steamReleaseDate:    null,           // string localizada da Steam ("21 Aug, 2012") ou null
    steamComingSoon:     null,           // bool da Steam (true = por lançar) ou null se sem Steam
    // ── Last update (Etapa Updates) ──
    // steamLastUpdate: populado async por fetchSteamImageFields() (data do último patch)
    // igdbUpdatedAt: data de edição do registo IGDB (fallback quando não há Steam)
    steamLastUpdate:     null,           // { date, title, url } ou null — populado por enrichment
    igdbUpdatedAt:       igdbGame.updated_at || null, // Unix seconds — fallback IGDB
    year,
    studios:        companyNames(igdbGame.involved_companies, "publisher"),
    developers:     companyNames(igdbGame.involved_companies, "developer"),
    engines:        engineNames(igdbGame.game_engines),
    releaseStatus:  releaseStatusStr(igdbGame.status, igdbGame.first_release_date),
    firstReleaseTs:  igdbGame.first_release_date || null, // timestamp unix (segundos)
    releaseDateFull: fullReleaseDateStr(igdbGame.first_release_date), // cache; re-computado on-render
    language:        languageStr(igdbGame.language_supports),
  };
}

// ─────────────────────────────────────────────
//  CACHE (estratégia stale-while-revalidate)
// ─────────────────────────────────────────────
function saveCache(games) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(games));
    localStorage.setItem(CACHE_TS_KEY, Date.now().toString());
  } catch(e) { /* storage full */ }
}

// Devolve o cache SE for fresco (idade < CACHE_STALE_MS).
// Cache fresco = usado sem revalidação (load instantâneo, sem fetches).
function loadCache() {
  try {
    const ts = parseInt(localStorage.getItem(CACHE_TS_KEY) || "0");
    if (Date.now() - ts > CACHE_STALE_MS) return null;
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch(e) { return null; }
}

// Devolve o cache stale (idade entre CACHE_STALE_MS e CACHE_MAX_MS).
// Usado para render IMEDIATO enquanto revalida em background.
// Retorna null se o cache não existir ou tiver mais de CACHE_MAX_MS (expirado).
function loadStaleCache() {
  try {
    const ts = parseInt(localStorage.getItem(CACHE_TS_KEY) || "0");
    const age = Date.now() - ts;
    if (age > CACHE_MAX_MS) return null; // demasiado velho, ignora
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch(e) { return null; }
}

// Verifica se o cache atual é stale (precisa de revalidação em background).
function isCacheStale() {
  try {
    const ts = parseInt(localStorage.getItem(CACHE_TS_KEY) || "0");
    const age = Date.now() - ts;
    return age > CACHE_STALE_MS && age <= CACHE_MAX_MS;
  } catch(e) { return false; }
}

function clearCache() {
  localStorage.removeItem(CACHE_KEY);
  localStorage.removeItem(CACHE_TS_KEY);
}

// ─────────────────────────────────────────────
//  STEAM CACHE (Etapa 2)
//
//  Cache SEPARADO do cache de jogos IGDB. Razões:
//   - TTLs diferentes: appdetails = 1h (alinhado com Steam CDN),
//     reviews = 10min (mais volátil).
//   - Shape diferente: mapas appId → { data, ts }, não arrays.
//   - Não precisa de ser invalidado quando se adiciona/remove jogos
//     (ao contrário do cache IGDB que é limpo em clearCache()).
//
//  Estrutura: localStorage guarda um JSON { "<appId>": { data, ts }, ... }
//  por cada tipo de cache. Se a quota estourar, falha silenciosamente
//  (os dados são re-buscados — sem quebrar a UI).
// ─────────────────────────────────────────────
const STEAM_DETAILS_CACHE_KEY  = "jce_steam_details_v1";
const STEAM_REVIEWS_CACHE_KEY  = "jce_steam_reviews_v1";
const STEAM_UPDATES_CACHE_KEY  = "jce_steam_updates_v1"; // último update (Etapa Updates)
const STEAM_DETAILS_TTL_MS     = 60 * 60 * 1000;  // 1 hora
const STEAM_REVIEWS_TTL_MS     = 10 * 60 * 1000;  // 10 minutos
const STEAM_UPDATES_TTL_MS     = 60 * 60 * 1000;  // 1 hora (updates não mudam frequentemente)

// Lê o mapa de cache (appId → { data, ts }) do localStorage.
function _loadSteamCacheMap(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch (_) { return {}; }
}

// Guarda o mapa de cache no localStorage (silencioso em caso de quota).
function _saveSteamCacheMap(key, map) {
  try { localStorage.setItem(key, JSON.stringify(map)); } catch (_) {}
}

// Devolve o dado em cache se existir e não tiver expirado, ou null.
// `ttlMs` controla a validade temporal — passado o TTL, o entry é ignorado
// (mas não removido do mapa para evitar writes desnecessários; será
// sobreescrito na próxima chamada a setCachedSteam).
function getCachedSteam(key, appId) {
  if (!appId) return null;
  const map = _loadSteamCacheMap(key);
  const entry = map[appId];
  if (!entry) return null;
  // Seleciona o TTL consoante o tipo de cache
  let ttl;
  if (key === STEAM_DETAILS_CACHE_KEY) ttl = STEAM_DETAILS_TTL_MS;
  else if (key === STEAM_REVIEWS_CACHE_KEY) ttl = STEAM_REVIEWS_TTL_MS;
  else if (key === STEAM_UPDATES_CACHE_KEY) ttl = STEAM_UPDATES_TTL_MS;
  else ttl = STEAM_DETAILS_TTL_MS; // default
  if (Date.now() - entry.ts > ttl) return null; // expirado
  return entry.data;
}

// Guarda um dado no cache com timestamp atual.
function setCachedSteam(key, appId, data) {
  if (!appId || !data) return;
  const map = _loadSteamCacheMap(key);
  map[appId] = { data, ts: Date.now() };
  _saveSteamCacheMap(key, map);
}

// Limpa todo o cache Steam (appdetails + reviews).
// Útil para debugging ou para forçar refresh. Expor em window para testes.
function clearSteamCache() {
  localStorage.removeItem(STEAM_DETAILS_CACHE_KEY);
  localStorage.removeItem(STEAM_REVIEWS_CACHE_KEY);
  localStorage.removeItem(STEAM_UPDATES_CACHE_KEY);
}
window.clearSteamCache = clearSteamCache;

// ─────────────────────────────────────────────
//  USERS — Listener em tempo real (Firebase "users" collection)
//  Sincroniza todos os utilizadores registados.
//  Cada user: { name, isAdmin, tabId, createdAt }
// ─────────────────────────────────────────────

// Snapshot anterior de users — para detectar remoções (cascade delete)
let prevUserIds = new Set();

function listenToUsers() {
  if (!db) return;
  const q = query(collection(db, "users"), orderBy("createdAt", "asc"));
  onSnapshot(q, (snapshot) => {
    const newUserIds = new Set(snapshot.docs.map(d => d.id));

    // Detecta users removidos desde o último snapshot
    // (só após o primeiro snapshot, para não disparar no arranque)
    if (prevUserIds.size > 0) {
      for (const oldId of prevUserIds) {
        if (!newUserIds.has(oldId)) {
          // User foi removido — cascade delete dos seus down-votes E up-votes
          deleteUserDownvotes(oldId);
          deleteUserUpvotes(oldId);
        }
      }
    }
    prevUserIds = newUserIds;

    allUsers = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    // Se há um currentUser guardado em localStorage, tenta restaurar a sessão
    restoreSession();
    // Actualiza UI (botão de registo / nome)
    updateUserUI();
    // Re-renderiza a lista de contas no painel de admin (recoveryMode pode
    // ter mudado remotamente noutro dispositivo).
    renderAdminAccounts();
  }, (err) => {
    console.warn("[app.js] Erro no listener de users:", err);
  });
}

// Apaga todos os down-votes de um user removido do Firebase.
// Isto garante que votos "órfãos" não afectam a contagem nem mantêm
// jogos no lixo que já não deveriam estar.
async function deleteUserDownvotes(userId) {
  if (!db) return;
  try {
    const q = query(
      collection(db, "downvotes"),
      where("userId", "==", userId)
    );
    const snap = await getDocs(q);
    const promises = snap.docs.map(d => deleteDoc(doc(db, "downvotes", d.id)));
    await Promise.all(promises);
    if (snap.size > 0) {
      console.log(`[cascade] Removidos ${snap.size} down-votes do user ${userId}`);
    }
  } catch (err) {
    console.error("[deleteUserDownvotes] erro:", err);
  }
}

// Restaura a sessão a partir de localStorage (jce_user_id)
function restoreSession() {
  if (currentUser) return; // já tem sessão
  let savedId = null;
  try { savedId = localStorage.getItem(USER_ID_KEY); } catch (_) {}
  if (!savedId) return;
  const user = allUsers.find(u => u.id === savedId);
  if (user) {
    currentUser = { id: user.id, name: user.name, isAdmin: !!user.isAdmin, tabId: user.tabId || null };
  } else {
    // User foi removido do Firebase — limpa localStorage
    try { localStorage.removeItem(USER_ID_KEY); } catch (_) {}
  }
}

// Actualiza a UI consoante o estado de currentUser
function updateUserUI() {
  const $btn = document.getElementById("register-btn");
  const $input = document.getElementById("register-input");
  const $searchInput = document.getElementById("header-search-input");
  const $accountSection = document.getElementById("account-section");
  const $accountInput = document.getElementById("account-name-input");
  const $btnText = document.getElementById("register-btn")
    ? document.getElementById("register-btn").querySelector(".register-btn-text")
    : null;

  if (!$btn) return;

  if (currentUser) {
    // Registado: botão mostra o nome, search desbloqueada
    if ($btnText) $btnText.textContent = currentUser.name;
    $btn.classList.add("registered");
    $btn.classList.remove("registering");
    $btn.style.display = "";
    $input.classList.add("hidden");
    if ($searchInput) $searchInput.disabled = false;
    // Mostra a secção "Conta" no settings
    if ($accountSection) $accountSection.style.display = "";
    if ($accountInput) $accountInput.value = currentUser.name;
  } else {
    // Não registado: botão "Registar" (traduzido), search bloqueada
    if ($btnText) $btnText.textContent = t("Registar");
    $btn.classList.remove("registered", "registering");
    $input.classList.add("hidden");
    // Esconde o botão de registo se já houver 3 ou mais utilizadores
    // (incluindo o admin). Sinaliza que o grupo está completo.
    // EXCEÇÃO: se houver algum utilizador marcado para recuperação
    // (recoveryMode === true), o botão continua visível para que o amigo
    // possa reclamar a sua sessão noutro browser com o mesmo nome.
    const recoveryActive = allUsers.some(u => u.recoveryMode === true);
    if (allUsers.length >= 3 && !recoveryActive) {
      $btn.style.display = "none";
    } else {
      $btn.style.display = "";
    }
    if ($searchInput) {
      $searchInput.disabled = true;
      $searchInput.value = "";
    }
    // Esconde a secção "Conta"
    if ($accountSection) $accountSection.style.display = "none";
    // Esconde resultados de pesquisa
    const $results = document.getElementById("header-search-results");
    if ($results) $results.classList.add("hidden");
  }
}

// Verifica se já existe um admin registado
function adminExists() {
  return allUsers.some(u => u.isAdmin);
}

// Verifica se um nome já está a ser usado
function nameExists(name) {
  const normalized = normalizeStr(name);
  return allUsers.some(u => normalizeStr(u.name) === normalized);
}

// Regista um novo utilizador
// - Cria doc em "users"
// - Cria tab com o nome capitalizado
// - Associa tabId ao user
//
//  MODO DE RECUPERAÇÃO:
//  Se houver utilizadores com recoveryMode === true, o registo normal é
//  suspenso. Apenas o nome exato de um utilizador marcado pode reclamar
//  a sessão existente (preservando todos os dados: votos, tabs, scores
//  do Brick Breaker, etc.). Nomes errados são bloqueados com notificação.
//  O código admin ("admin1") continua a funcionar como backdoor do admin.
async function registerUser(rawName) {
  const ADMIN_CODE = "admin1";
  let name, isAdmin = false;

  if (rawName.trim().toLowerCase() === ADMIN_CODE) {
    // Código admin — se já houver admin (Leo), restaura a sessão em vez de bloquear
    if (adminExists()) {
      const adminUser = allUsers.find(u => u.isAdmin);
      if (adminUser) {
        // Restaura a sessão do admin
        currentUser = { id: adminUser.id, name: adminUser.name, isAdmin: true, tabId: adminUser.tabId || null };
        try { localStorage.setItem(USER_ID_KEY, adminUser.id); } catch (_) {}
        // Se o admin estava marcado para recuperação, limpa a flag — a
        // sessão foi reclamada via código admin, já não precisa de
        // recuperação (evita que outra pessoa reclame "Leo" depois).
        if (adminUser.recoveryMode === true && db) {
          try {
            await updateDoc(doc(db, "users", adminUser.id), { recoveryMode: false });
          } catch (err) {
            console.warn("[registerUser] erro ao limpar recovery do admin:", err);
          }
        }
        updateUserUI();
        showToast(`${t("Bem-vindo de volta,")} ${adminUser.name}!`);
        return true;
      }
      showToast(t("Código admin já utilizado."));
      return false;
    }
    name = "Leo";
    isAdmin = true;
  } else {
    name = capitalizeName(rawName);

    // ── Modo de recuperação ──────────────────────────────────────
    // Se houver utilizadores marcados para recuperação (recoveryMode ===
    // true), o registo normal é suspenso: SÓ o nome exato (normalizado)
    // de um utilizador marcado pode reclamar a sessão. Qualquer outro
    // nome é bloqueado com a notificação de modo recuperação.
    const recoveryUsers = allUsers.filter(u => u.recoveryMode === true);
    if (recoveryUsers.length > 0) {
      const match = recoveryUsers.find(u => normalizeStr(u.name) === normalizeStr(name));
      if (match) {
        // Nome correto → reclama a sessão existente (sem criar novo
        // user/tab). Todos os dados associados ao userId são preservados.
        currentUser = {
          id: match.id,
          name: match.name,
          isAdmin: !!match.isAdmin,
          tabId: match.tabId || null
        };
        try { localStorage.setItem(USER_ID_KEY, match.id); } catch (_) {}
        // Limpa a flag de recuperação — sessão reclamada com sucesso.
        // O onSnapshot de users re-renderiza a UI e volta ao normal.
        if (db) {
          try {
            await updateDoc(doc(db, "users", match.id), { recoveryMode: false });
          } catch (err) {
            console.warn("[registerUser] erro ao limpar recovery:", err);
          }
        }
        updateUserUI();
        showToast(`${t("Bem-vindo de volta,")} ${match.name}!`);
        return true;
      } else {
        // Nome errado — bloqueia e mostra a notificação de modo recuperação.
        showToast(t("Em modo recuperação de utilizador, escreve o teu nome corretamente."));
        return false;
      }
    }

    // ── Registo normal (sem recuperação ativa) ───────────────────
    if (name.length < 2) {
      showToast(t("Nome muito curto (mín 2 caracteres)."));
      return false;
    }
    if (nameExists(name)) {
      showToast(t("Nome já existe."));
      return false;
    }
  }

  // Desabilita o input enquanto processa
  const $input = document.getElementById("register-input");
  if ($input) $input.disabled = true;

  try {
    // Timeout: se Firebase não responder em 10s, aborta
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), 10000)
    );

    // 1. Cria a tab com o nome do utilizador
    const tabPromise = addDoc(collection(db, "tabs"), {
      label: name,
      createdAt: serverTimestamp(),
    });

    const tabRef = await Promise.race([tabPromise, timeout]);

    // 2. Cria o user com tabId associado
    const userRef = await addDoc(collection(db, "users"), {
      name: name,
      isAdmin: isAdmin,
      tabId: tabRef.id,
      createdAt: serverTimestamp(),
    });

    // 3. Inicializa tabGames vazio para a tab do user
    await setDoc(doc(db, "tabGames", tabRef.id), { gameIds: [] });

    // 4. Guarda sessão localmente
    currentUser = { id: userRef.id, name, isAdmin, tabId: tabRef.id };
    try { localStorage.setItem(USER_ID_KEY, userRef.id); } catch (_) {}

    updateUserUI();
    showToast(`${t("Bem-vindo,")} ${name}!`);
    return true;
  } catch (err) {
    console.error("[registerUser] erro:", err);
    const msg = err.message === "timeout"
      ? t("Servidor não responde.")
      : t("Erro ao registar.");
    showToast(msg);
    // Restaura o input para tentar de novo
    if ($input) {
      $input.disabled = false;
      $input.classList.add("hidden");
      const $btn = document.getElementById("register-btn");
      if ($btn) $btn.style.display = "";
    }
    return false;
  }
}

// Edita o nome do utilizador actual
// - Actualiza o doc em "users"
// - Actualiza o label da tab correspondente
async function editUserName(newRawName) {
  if (!currentUser) return false;
  const newName = capitalizeName(newRawName);
  if (newName.length < 2) {
    showToast(t("Nome muito curto."));
    return false;
  }
  // Verifica se o nome já existe (excluindo o próprio)
  const normalized = normalizeStr(newName);
  const taken = allUsers.some(u => u.id !== currentUser.id && normalizeStr(u.name) === normalized);
  if (taken) {
    showToast(t("Nome já existe."));
    return false;
  }
  try {
    // Actualiza o user
    await updateDoc(doc(db, "users", currentUser.id), { name: newName });
    // Actualiza a tab
    if (currentUser.tabId) {
      await updateDoc(doc(db, "tabs", currentUser.tabId), { label: newName });
    }
    currentUser.name = newName;
    updateUserUI();
    showToast(t("Nome atualizado!"));
    return true;
  } catch (err) {
    console.error("[editUserName] erro:", err);
    showToast(t("Erro ao atualizar nome."));
    return false;
  }
}

// ─────────────────────────────────────────────
//  FIREBASE — Real-time listener
// ─────────────────────────────────────────────

// Cria um objeto de jogo "fallback" quando o IGDB falha, para que o jogo
// não desapareça da lista. Tem dados mínimos (igdbId, name placeholder,
// sem cover/screenshots). Marcado com _needsRetry para retry posterior.
function createFallbackGame(fsDoc) {
  return {
    igdbId:         fsDoc.igdbId,
    name:           `${t("Jogo #")}${fsDoc.igdbId}`,
    cover:          null,
    screenshots:    [],
    artworks:       [],
    videos:         [],
    genres:         [],
    themes:         [],
    modes:          [],
    rating:         null,
    summary:        "",
    steamUrl:       null,
    steamAppId:     fsDoc.steamAppId || null, // preserva App ID do Firestore mesmo sem IGDB
    // ── Steam enrichment (Etapa 3 + 4) ──
    // Fallback games não têm dados Steam (IGDB falhou); ficam a null.
    // Se o fetchSteamImageFields() correr mais tarde e tiver steamAppId,
    // estes campos serão populados nessa altura.
    steamHeaderImage:  null,
    steamScreenshots:  [],
    steamBackground:   null,
    steamEnriched:     false,
    // ── Steam reviews (Etapa 4) ──
    steamReviewDesc:     null,
    steamReviewScore:    null,
    steamReviewTotal:    0,
    steamReviewPositive: 0,
    steamReviewNegative: 0,
    steamReviewPct:      null,
    // ── Steam release date (Etapa 5) ──
    steamReleaseDate:    null,
    steamComingSoon:     null,
    // ── Last update (Etapa Updates) ──
    steamLastUpdate:     null,
    igdbUpdatedAt:       null,
    year:           null,
    studios:        [],
    developers:     [],
    engines:        [],
    releaseStatus:  "Por lançar",
    firstReleaseTs: null,
    releaseDateFull: null,
    language:       "",
    firebaseId:     fsDoc.firebaseId,
    preferredKeyArt: fsDoc.preferredKeyArt || null,
    playlistUrl:    fsDoc.playlistUrl || null,
    _needsRetry:    true, // sinaliza que precisa de retry do IGDB
  };
}

// Retry em background para jogos que ficaram em fallback (IGDB falhou).
// Procura jogos com _needsRetry e tenta buscar os dados reais do IGDB.
// Se conseguir, substitui o fallback pelos dados reais e re-renderiza.
let _bgRetryInProgress = false;
async function retryFailedGames() {
  if (_bgRetryInProgress) return;
  const failedGames = gamesData.filter(g => g._needsRetry);
  if (failedGames.length === 0) return;

  _bgRetryInProgress = true;
  let updated = false;

  for (const game of failedGames) {
    try {
      const igdbGame = await fetchGameByIdWithRetry(game.igdbId, 2);
      if (igdbGame) {
        // Substitui o fallback pelos dados reais
        const idx = gamesData.findIndex(g => g.firebaseId === game.firebaseId);
        if (idx >= 0) {
          const normalized = normalizeGame(igdbGame);
          // STEAM ENRICHMENT (Etapa 3): também enricha jogos que recuperaram
          // de fallback, para que ganhem imagens Steam assim que o IGDB retoma.
          let enrichedFields = null;
          const appId = normalized.steamAppId || game.steamAppId;
          if (appId && !normalized.steamEnriched) {
            try {
              enrichedFields = await fetchSteamImageFields(appId);
            } catch (_) { enrichedFields = null; }
          }
          gamesData[idx] = {
            ...normalized,
            ...(enrichedFields || {}),
            firebaseId: game.firebaseId,
            preferredKeyArt: game.preferredKeyArt || null,
            playlistUrl: game.playlistUrl || null,
          };
          updated = true;
        }
      }
    } catch (_) {
      // Ainda falhou — mantém o fallback, tentará novamente depois
    }
  }

  _bgRetryInProgress = false;
  if (updated) {
    saveCache(gamesData);
    renderGameList(gamesData);
    renderAdminList(gamesData);
    renderTagFilter();
  }
}

// Backfill silencioso: grava o `steamAppId` no Firestore se o doc ainda não o tiver.
// Isto é uma migração one-time — jogos adicionados antes da Etapa 1 da integração
// Steam não têm este campo. O backfill corre quando o IGDB (ou o cache) produz um
// steamAppId válido e o doc Firestore não o tem.
// Fire-and-forget: não bloqueia o render; erros são silenciosos (haverá retry no
// próximo snapshot do Firebase).
async function backfillSteamAppId(firebaseId, appId) {
  if (!firebaseId || !appId) return;
  try {
    await updateDoc(doc(db, "games", firebaseId), { steamAppId: appId });
  } catch (e) {
    // Silencioso — will retry on next snapshot
  }
}

// ─────────────────────────────────────────────
//  STEAM ENRICHMENT (Etapa 3)
//
//  Busca os appdetails da Steam para um jogo e devolve os campos de imagem
//  (steamHeaderImage, steamScreenshots, steamBackground). Estes campos são
//  mergeados no objeto normalizado do jogo.
//
//  Estratégia: INTEGRADO no listenToGames (Etapa 3 v2).
//   - O fetch Steam corre EM PARALELO com o fetch IGDB dentro de cada batch.
//   - O cache Steam (TTL 1h) torna a maioria dos fetches instantânea (cache hit).
//   - A Steam API é muito tolerante a paralelismo (10 calls paralelas = ~0.6s,
//     sem 429), ao contrário do IGDB (4 req/s).
//   - Resultado: as imagens Steam aparecem JÁ NO PRIMEIRO RENDER, sem delay.
//
//  Fallback: se o fetch Steam falhar (rede, rate-limit, jogo removido), retorna
//  null — o jogo mantém os dados IGDB (fallback graceful).
// ─────────────────────────────────────────────

// Busca os dados de imagem da Steam para um appId e devolve os campos enriched,
// ou null se não for possível enrichar.
// Não muta gamesData — o caller faz o merge no objeto normalizado.
//
// Etapa 4: também busca o sumário de reviews em paralelo (Promise.all).
// Etapa Updates: também busca o último update (Steam News API) em paralelo.
async function fetchSteamImageFields(appId) {
  if (!appId) return null;
  // Busca appdetails + reviews + último update EM PARALELO (3 calls simultâneas).
  // A Steam tolera paralelismo massivo, pelo que 3 calls em paralelo não causam 429.
  const [data, reviewSummary, lastUpdate] = await Promise.all([
    steamAppDetails(appId),
    steamReviewSummary(appId),
    fetchSteamLastUpdate(appId),
  ]);
  if (!data) return null; // Steam falhou ou jogo não existe — fallback IGDB

  const steamScreenshots = (data.screenshots || [])
    .map(s => ({
      src:   s.path_full,       // 1920×1080 — qualidade superior ao IGDB
      thumb: s.path_thumbnail,  // 600×338 — para scrub dots no card
    }))
    .filter(s => s.src && s.thumb);

  // ── Reviews (Etapa 4) ──
  // review_score_desc vem em inglês da Steam ("Very Positive", etc.).
  // Guardamos o original para referência + a percentagem positiva calculada.
  // A tradução PT/EN acontece no render via t() — usamos o desc PT como key.
  let steamReviewDesc       = null;
  let steamReviewScore      = null;
  let steamReviewTotal      = 0;
  let steamReviewPositive   = 0;
  let steamReviewNegative   = 0;
  let steamReviewPct        = null; // percentagem positiva (0-100)

  if (reviewSummary && reviewSummary.total_reviews > 0) {
    steamReviewDesc     = reviewSummary.review_score_desc || null;
    steamReviewScore    = reviewSummary.review_score ?? null;
    steamReviewTotal    = reviewSummary.total_reviews || 0;
    steamReviewPositive = reviewSummary.total_positive || 0;
    steamReviewNegative = reviewSummary.total_negative || 0;
    steamReviewPct      = Math.round(
      (steamReviewPositive / steamReviewTotal) * 100
    );
  } else if (reviewSummary && reviewSummary.total_reviews === 0) {
    // Jogo existe na Steam mas não tem reviews → marcador explícito
    steamReviewDesc = "No user reviews"; // será traduzido via t("Sem análises")
  }

  return {
    steamHeaderImage: data.header_image || null,
    steamScreenshots,
    steamBackground:  data.background_raw || data.background || null,
    steamEnriched:    true,
    // ── Reviews ──
    steamReviewDesc,       // string EN da Steam ("Very Positive") ou "No user reviews" ou null
    steamReviewScore,      // int 0-9 (escala Steam) ou null
    steamReviewTotal,      // int (total de reviews)
    steamReviewPositive,   // int
    steamReviewNegative,   // int
    steamReviewPct,        // int 0-100 (percentagem positiva) ou null
    // ── Release date (Etapa 5) ──
    // A Steam devolve release_date como { coming_soon: bool, date: "DD MMM, YYYY" }.
    // `date` é uma string LOCALIZADA (depende do parâmetro `l=`) — não é ISO.
    // Guardamos para exibição direta (já localizada pela Steam) e para cruzar
    // com o coming_soon no cálculo do estado de lançamento.
    steamReleaseDate:    data.release_date?.date || null,       // ex: "21 Aug, 2012" (localizada)
    steamComingSoon:     data.release_date?.coming_soon === true, // bool
    // ── Last update (Etapa Updates) ──
    // steamLastUpdate: { date, title, url } do último patch note da Steam.
    // null se o jogo não tem patch notes (fallback para igdbUpdatedAt no computeLastUpdate).
    steamLastUpdate:     lastUpdate || null,
  };
}

function listenToGames() {
  const q = query(collection(db, "games"), orderBy("addedAt", "asc"));

  onSnapshot(q, async (snapshot) => {
    const firestoreDocs = snapshot.docs.map(d => ({ firebaseId: d.id, ...d.data() }));

    // Se lista vazia
    if (firestoreDocs.length === 0) {
      gamesData = [];
      gamesLoaded = true; // carregamento completo (mesmo que vazio)
      saveCache([]);
      renderGameList([]);
      renderAdminList([]);
      return;
    }

    // ── OTIMIZAÇÃO: stale-while-revalidate ──
    // Carrega cache (fresco OU stale). O cache stale é usado para render
    // IMEDIATO enquanto revalida em background.
    const cachedFresh = loadCache();
    const cachedStale = cachedFresh ? null : loadStaleCache();
    const cached = cachedFresh || cachedStale || [];
    const cacheIsFresh = !!cachedFresh;
    const cacheIsStale = !!cachedStale;
    const cachedMap = Object.fromEntries(cached.map(g => [g.igdbId, g]));

    // ── RENDER IMEDIATO com cache stale ──
    // Se o cache é stale, faz render dos jogos IMEDIATAMENTE (para a UI não
    // estar vazia), mas NÃO dispensa o loader — este só sai quando a
    // revalidação completa (mais abaixo). Isto evita o utilizador interagir
    // com dados meio-carregados.
    if (cacheIsStale) {
      const immediateGames = firestoreDocs.map(fsDoc => {
        const cachedGame = cachedMap[fsDoc.igdbId];
        if (cachedGame) {
          return {
            ...cachedGame,
            firebaseId: fsDoc.firebaseId,
            preferredKeyArt: fsDoc.preferredKeyArt || null,
            playlistUrl: fsDoc.playlistUrl || null,
          };
        }
        // Jogo novo no Firestore que não está no cache — usa fallback temporário
        return createFallbackGame(fsDoc);
      }).filter(Boolean);
      gamesData = immediateGames;
      gamesLoaded = true;
      renderGameList(gamesData);
      renderAdminList(gamesData);
      renderTagFilter();
      // NOTA: não dispensa o loader aqui — espera pela revalidação completa
    }

    // ── Se o cache é FRESCO, mostra jogos imediatamente e NÃO revalida ──
    // Dados IGDB raramente mudam (nome, cover, screenshots). 30 min de cache
    // fresco é seguro — poupa todos os fetches IGDB.
    if (cacheIsFresh) {
      const freshGames = firestoreDocs.map(fsDoc => {
        const cachedGame = cachedMap[fsDoc.igdbId];
        if (cachedGame) {
          // Backfill steamAppId se necessário
          if (fsDoc.steamAppId == null && cachedGame.steamAppId) {
            backfillSteamAppId(fsDoc.firebaseId, cachedGame.steamAppId);
          }
          return {
            ...cachedGame,
            firebaseId: fsDoc.firebaseId,
            preferredKeyArt: fsDoc.preferredKeyArt || null,
            playlistUrl: fsDoc.playlistUrl || null,
          };
        }
        // Jogo novo (não estava no cache fresco) — marca para fetch IGDB
        return null; // será fetched abaixo
      });
      const needFetch = freshGames.filter(g => g === null).length > 0;
      if (!needFetch) {
        // Tudo no cache fresco — não precisa de nenhum fetch IGDB!
        gamesData = freshGames;
        gamesLoaded = true;
        saveCache(gamesData); // atualiza timestamp
        renderGameList(gamesData);
        renderAdminList(gamesData);
        renderTagFilter();
        processPendingUpvotes();
        // ── Dispensa o loader: tudo carregado (cache fresco, sem fetches) ──
        if (typeof window.forceShowLoader === "function") {
          window.forceShowLoader(false); // dispensa o loader forçado
        } else if (typeof window.dismissLoader === "function") {
          window.dismissLoader();
        }
        // Notificações
        if (Object.keys(gamesSnapshot).length > 0) {
          detectGameChanges();
        } else {
          saveGamesSnapshot();
        }
        return; // ← SKIP de todos os fetches IGDB!
      }
      // Se há jogos novos, faz render dos que temos + fetch só dos novos
      const haveGames = freshGames.filter(Boolean);
      if (haveGames.length > 0) {
        gamesData = haveGames;
        gamesLoaded = true;
        renderGameList(gamesData);
        renderAdminList(gamesData);
        renderTagFilter();
        // NOTA: não dispensa o loader aqui — ainda há jogos novos para fetch
      }
    }

    // ── OTIMIZAÇÃO: só fazer fetch dos jogos que NÃO estão no cache ──
    // Se o cache é stale, os jogos em cache já foram renderizados imediatamente
    // acima. Aqui só buscamos IGDB para jogos NOVOS (não no cache) ou em fallback.
    // Isto reduz drasticamente o número de fetches: 71 jogos com cache stale =
    // 0 fetches IGDB (revalidação só seria necessária se os dados mudassem, o
    // que é raro para nome/cover/screenshots).
    //
    // Para revalidação verdadeira em background (opcional, dados atualizados),
    // poderíamos fazer fetch de alguns jogos stale, mas os dados IGDB são tão
    // estáticos que não vale a pena o custo de rate-limit. O cache stale é
    // usado como definitivo até expirar (24h).
    //
    // ⚠️  IGDB free tier = máx. 4 requests por segundo.
    //   - CONCURRENCY = 4: dentro do limite (3 era demasiado conservador).
    //   - BATCH_DELAY_MS = 280: pausa curta entre batches (4 reqs / 280ms =
    //     ~14 req/s teórico, mas limitado pela latência real de ~500ms/req).
    //   - Com cache, a maioria dos loads faz 0 fetches IGDB.
    //
    //  STEAM ENRICHMENT (Etapa 3 v2):
    //   - O fetch Steam corre EM PARALELO com o fetch IGDB dentro de cada batch.
    //   - O cache Steam (TTL 1h) torna a maioria dos fetches instantânea.
    const CONCURRENCY = 4;
    const BATCH_DELAY_MS = 280;
    const failedIgdbIds = [];

    // Filtra jogos que precisam de fetch IGDB (não no cache, ou cache expirou)
    const docsNeedingFetch = firestoreDocs.filter(fsDoc => !cachedMap[fsDoc.igdbId]);
    // Jogos que estão no cache — não precisam de fetch, só overlay do Firestore
    const cachedResolved = firestoreDocs
      .filter(fsDoc => cachedMap[fsDoc.igdbId])
      .map(fsDoc => {
        const cachedGame = cachedMap[fsDoc.igdbId];
        if (fsDoc.steamAppId == null && cachedGame.steamAppId) {
          backfillSteamAppId(fsDoc.firebaseId, cachedGame.steamAppId);
        }
        return {
          ...cachedGame,
          firebaseId: fsDoc.firebaseId,
          preferredKeyArt: fsDoc.preferredKeyArt || null,
          playlistUrl: fsDoc.playlistUrl || null,
        };
      });

    const resolved = [...cachedResolved];

    for (let i = 0; i < docsNeedingFetch.length; i += CONCURRENCY) {
      const batch = docsNeedingFetch.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (fsDoc) => {
          // (já não está no cache — foi filtrado acima)
          try {
            const igdbGame = await fetchGameByIdWithRetry(fsDoc.igdbId);
            if (!igdbGame) {
              // IGDB devolveu vazio — cria fallback para não perder o jogo
              failedIgdbIds.push(fsDoc.igdbId);
              return createFallbackGame(fsDoc);
            }
            const normalized = normalizeGame(igdbGame);
            // Backfill: se o doc Firestore não tem steamAppId mas o IGDB produziu
            // um, grava-o silenciosamente (migração one-time).
            if (fsDoc.steamAppId == null && normalized.steamAppId) {
              backfillSteamAppId(fsDoc.firebaseId, normalized.steamAppId);
            }
            // STEAM ENRICHMENT: busca imagens Steam em paralelo com o resto do batch.
            // fallback graceful: se falhar, o jogo fica só com dados IGDB.
            let enrichedFields = null;
            const appId = normalized.steamAppId || fsDoc.steamAppId;
            if (appId && !normalized.steamEnriched) {
              try {
                enrichedFields = await fetchSteamImageFields(appId);
              } catch (_) { enrichedFields = null; }
            }
            return {
              ...normalized,
              ...(enrichedFields || {}),
              firebaseId: fsDoc.firebaseId,
              preferredKeyArt: fsDoc.preferredKeyArt || null,
              playlistUrl: fsDoc.playlistUrl || null,
            };
          } catch(e) {
            console.warn("Falha ao buscar jogo", fsDoc.igdbId, e);
            failedIgdbIds.push(fsDoc.igdbId);
            return createFallbackGame(fsDoc);
          }
        })
      );
      resolved.push(...batchResults);
      // Pausa entre batches para respeitar o rate limit do IGDB (4 req/s).
      if (i + CONCURRENCY < docsNeedingFetch.length) {
        await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
      }
    }

    gamesData = resolved.filter(Boolean);
    gamesLoaded = true; // carregamento completo do Firebase + IGDB
    // Guarda em cache apenas jogos que NÃO estão em fallback (sem _needsRetry).
    // Jogos em fallback não são guardados em cache para que sejam re-tentados
    // no próximo carregamento.
    const cacheableGames = gamesData.filter(g => !g._needsRetry);
    saveCache(cacheableGames);
    renderGameList(gamesData);
    renderAdminList(gamesData);
    renderTagFilter(); // refresh available tags after new game data
    // Processa up-votes pendentes (jogos adicionados por users → up-vote automático)
    processPendingUpvotes();

    // ── Dispensa o loader: TUDO carregado (Firebase + IGDB + Steam enrichment) ──
    // Este é o único sítio (além do cache fresco sem fetches) onde o loader
    // deve ser dispensado. Garante que o utilizador só vê a UI quando está
    // totalmente pronta, sem estados meio-carregados.
    if (typeof window.forceShowLoader === "function") {
      window.forceShowLoader(false); // dispensa o loader forçado
    } else if (typeof window.dismissLoader === "function") {
      window.dismissLoader();
    }

    // Retry em background para jogos que ficaram em fallback (IGDB falhou)
    // — tenta buscar os dados reais após 3 segundos
    if (gamesData.some(g => g._needsRetry)) {
      setTimeout(retryFailedGames, 3000);
    }

    // ── Steam Enrichment (Etapa 3 v2) ──
    // O enrichment agora corre INLINE no listenToGames (em paralelo com cada
    // batch IGDB via Promise.all). Não é preciso um pass separado em background.

    // ── Deteção de mudanças para notificações ──
    // Compara o estado atual com o snapshot anterior. Se for o primeiro
    // carregamento (snapshot vazio), apenas guarda o snapshot sem gerar
    // notificações (para não spamar no arranque inicial).
    if (Object.keys(gamesSnapshot).length > 0) {
      detectGameChanges();
    } else {
      // Primeiro carregamento — guarda snapshot inicial sem notificar
      saveGamesSnapshot();
    }
  }, (err) => {
    console.warn("[app.js] Erro no listener do Firebase:", err);
    gamesLoaded = true; // mesmo com erro, consideramos "carregado" para não bloquear
    // Em caso de erro (permissões, config inválida, etc.), mostra estado
    // vazio e dispensa o loader para não bloquear a UI.
    gamesData = [];
    renderGameList([]);
    renderAdminList([]);
    renderTagFilter();
    // Dispensa o loader mesmo em caso de erro (não bloquear a UI indefinidamente)
    if (typeof window.forceShowLoader === "function") {
      window.forceShowLoader(false);
    } else if (typeof window.dismissLoader === "function") {
      window.dismissLoader();
    }
  });
}

// ─────────────────────────────────────────────
//  RENDER — Game List
// ─────────────────────────────────────────────
function getFilteredSortedGames() {
  // 1. Filter by active tab
  let list = gamesData.slice();
  if (activeTab === "escondidos") {
    // Tab "Escondidos": mostra apenas jogos que o utilizador deu down-vote.
    // Usa hasUserDownvoted() (Firebase downvotesMap) em vez de hiddenGames
    // (localStorage) — o hiddenGames pode ter lixo acumulado de versões
    // anteriores ou de syncs antigos. hasUserDownvoted é a fonte de verdade.
    // NÃO inclui jogos marcados como jogados — esses estão na tab "Jogados".
    list = list.filter(g => hasUserDownvoted(g.firebaseId) && !isPlayed(g.firebaseId));
  } else if (activeTab !== "all") {
    const allowed = tabGamesMap[activeTab] || new Set();
    list = list.filter(g => allowed.has(g.firebaseId));
    // ⚠️  Tabs específicas (Jogados, Reprovados, Aprovados, tabs de users)
    //    ignoram SEMPRE o filtro de hidden games — mostram todos os jogos
    //    que pertencem a essa tab, independentemente do toggle
    //    "Mostrar jogos escondidos". Isto é especialmente importante para
    //    a tab "Jogados", onde os jogos estão escondidos da lista principal
    //    mas devem ser sempre visíveis na sua própria tab.
  } else {
    // Na tab "all", exclui jogos que estão no lixo (>= threshold down-votes)
    list = list.filter(g => !isInTrash(g.firebaseId));
    // 1b. Esconde jogos que o user actual deu down-vote (localmente)
    // ou que foram marcados como "jogados" (também ficam escondidos da
    // lista principal — só visíveis na tab "Jogados" e "Escondidos").
    // Apenas na lista "Todos". Outras tabs mostram tudo.
    list = list.filter(g => !hiddenGames.has(g.firebaseId));
  }

  // 1c. Filtro "Jogos em comum" — mostra apenas jogos em que o user actual
  // e o user seleccionado deram ambos up-vote.
  if (commonGamesFilterUserId) {
    list = list.filter(g => {
      const myUp = hasUserUpvoted(g.firebaseId);
      const theirUp = upvotesMap[g.firebaseId] && upvotesMap[g.firebaseId].has(commonGamesFilterUserId);
      return myUp && theirUp;
    });
  }

  // 2. Tag filter (genres + themes, OR logic)
  if (activeTagFilters.size > 0) {
    list = list.filter(g => {
      const tags = [...(g.genres || []), ...(g.themes || [])];
      return tags.some(t => activeTagFilters.has(t));
    });
  }

  // 2b. Release-status filter (OR logic)
  if (activeStatusFilters.size > 0) {
    list = list.filter(g => activeStatusFilters.has(g.releaseStatus));
  }

  // 3. Sort
  if (currentSort === "name") {
    list.sort((a, b) => (a.name || "").localeCompare(b.name || "", isPt() ? "pt" : "en"));
  } else if (currentSort === "upvotes") {
    // Mais upvotes primeiro > menos upvotes segundo
    // Sort secundário por nome para ordem consistente
    list.sort((a, b) => {
      const diff = getUpvoteCount(b.firebaseId) - getUpvoteCount(a.firebaseId);
      if (diff !== 0) return diff;
      return (a.name || "").localeCompare(b.name || "", isPt() ? "pt" : "en");
    });
  } else if (currentSort === "downvotes") {
    // ⚠️  Estado reverse = ordenar por DOWNVOTES (mais downvotes primeiro)
    // O ícone mostra uma seta para baixo (downvote), por isso o utilizador
    // espera que ordene por downvotes, não por "menos upvotes".
    list.sort((a, b) => {
      const diff = getDownvoteCount(b.firebaseId) - getDownvoteCount(a.firebaseId);
      if (diff !== 0) return diff;
      return (a.name || "").localeCompare(b.name || "", isPt() ? "pt" : "en");
    });
  } else if (currentSort === "rating") {
    list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  } else {
    // random — stable within session via seed
    list.sort((a, b) => seededRandom(randomSeed, gamesData.indexOf(a)) - seededRandom(randomSeed, gamesData.indexOf(b)));
  }
  return list;
}

// Detects which cards are on the last row of the grid and marks them,
// so their expand panel can be flipped to open upward via CSS.
function markLastRowCards() {
  const grid = $gameList.querySelector(".game-grid");
  if (!grid) return;
  const cards = Array.from(grid.querySelectorAll(".game-card"));
  cards.forEach(c => c.classList.remove("last-row"));
  if (!cards.length) return;

  // Conta o número de colunas da grelha (cards com o mesmo top = mesma linha)
  const tops = cards.map(c => c.getBoundingClientRect().top);
  const uniqueTops = [...new Set(tops.map(t => Math.round(t)))];
  const rowCount = uniqueTops.length;

  // Se só há uma linha, NÃO marca como "last-row" — o card-expand
  // deve abrir para baixo (default), não para cima.
  if (rowCount <= 1) return;

  // Find the maximum top offset among all cards — cards sharing that value are on the last row
  const maxTop = Math.max(...tops);
  cards.forEach((c, i) => {
    if (Math.abs(tops[i] - maxTop) < 2) c.classList.add("last-row");
  });
}

function renderGameList(games) {
  // Se os jogos ainda não foram carregados do Firebase/IGDB (primeiro load),
  // mantém o loading spinner visível em vez de mostrar "Sem jogos".
  // Isto evita que o utilizador veja o empty state durante o retry do IGDB.
  if (!gamesLoaded) {
    // Não limpa o innerHTML para preservar o #loading-state que lá está
    // desde o carregamento inicial do HTML.
    if ($loadingState) $loadingState.classList.remove("hidden");
    if ($emptyState) $emptyState.classList.add("hidden");
    return;
  }

  if ($loadingState) $loadingState.classList.add("hidden");

  const filtered = getFilteredSortedGames();

  if (filtered.length === 0) {
    $gameList.innerHTML = "";
    $emptyState.classList.remove("hidden");
    // Mesmo sem jogos, dispensa o loader
    if (typeof window.dismissLoader === "function") window.dismissLoader();
    return;
  }

  $emptyState.classList.add("hidden");

  const viewClass = currentView === "list" ? "view-list"
    : currentView === "five" ? "view-five"
    : currentView === "compact" ? "view-compact"
    : "";

  $gameList.innerHTML = `
    <div class="game-grid${viewClass ? " " + viewClass : ""}">
      ${filtered.map((game, idx) => buildCard(game, gamesData.indexOf(game))).join("")}
    </div>
  `;

  // Attach scrub + admin events
  $gameList.querySelectorAll(".game-card").forEach(card => {
    attachScrubEvents(card);
    attachAdminCardEvents(card);
  });

  // Mark last-row cards so their expand panel opens upward
  markLastRowCards();

  // Update tab counts
  renderTabs();

  // Dispensar o ecrã de carregamento na primeira renderização com conteúdo
  if (typeof window.dismissLoader === "function") window.dismissLoader();

  // Traduz assíncronamente os sumários dos cards (Google Translate API)
  // Fire-and-forget — não bloqueia o render.
  translateCardSummaries().catch(() => {});
}

// ─────────────────────────────────────────────
//  ADMIN — Botões nos cards (editar key-art / remover)
//  Só ficam clicáveis visualmente quando body.editor-mode está activo,
//  mas os listeners existem sempre — stopPropagation evita abrir o modal.
// ─────────────────────────────────────────────
function attachAdminCardEvents(card) {
  const idx = parseInt(card.dataset.idx);
  const game = gamesData[idx];
  if (!game) return;

  const editBtn = card.querySelector(".card-edit-btn");
  if (editBtn) {
    editBtn.addEventListener("click", e => {
      e.stopPropagation();
      openKeyArtPicker(game);
    });
  }

  const delBtn = card.querySelector(".card-delete-btn");
  if (delBtn) {
    delBtn.addEventListener("click", e => {
      e.stopPropagation();
      removeGame(game.firebaseId);
    });
  }

  const playedBtn = card.querySelector(".card-played-btn");
  if (playedBtn) {
    playedBtn.addEventListener("click", e => {
      e.stopPropagation();
      if (isPlayed(game.firebaseId)) {
        unmarkAsPlayed(game.firebaseId);
      } else {
        markAsPlayed(game.firebaseId);
      }
    });
  }

  const addTabBtn = card.querySelector(".card-addtab-btn");
  if (addTabBtn) {
    addTabBtn.addEventListener("click", e => {
      e.stopPropagation();
      openPlaylistModal(game);
    });
  }
}

function buildCard(game, globalIdx) {
  const screenshots = game.screenshots || [];
  const artworks    = game.artworks    || [];
  const videos      = game.videos || [];

  // card-bg: preferência global de admin → key-art do IGDB → screenshot Steam (1920×1080)
  //          → screenshot IGDB → header Steam → cover IGDB
  // Etapa 3: screenshots Steam (steamScreenshots[0].src) entram na cadeia de fallback
  // antes das do IGDB por terem qualidade superior. O header_image da Steam (460×215,
  // landscape) é o último recurso — é landscape, menos ideal para card portrait,
  // mas melhor que nada se o IGDB não tiver cover.
  const steamFirstShot = (game.steamScreenshots && game.steamScreenshots[0]?.src) || null;
  const coverSrc = game.preferredKeyArt
    || artworks[0]
    || steamFirstShot
    || screenshots[0]
    || game.steamHeaderImage
    || game.cover
    || "";

  const ratingVal   = ratingStr(game.rating);

  // ── Etapa 4: Badge de reviews Steam com fallback IGDB ──
  // Se o jogo tem reviews Steam (enriched + desc), mostra o badge Steam.
  // Senão (sem Steam, enrich falhou, ou sem reviews), mostra o rating IGDB.
  const steamBadge = steamReviewBadgeHtml(game);
  const ratingHtml = steamBadge
    ? steamBadge
    : (ratingVal
        ? `<div class="card-rating">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="#ffb347" stroke="none"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>
            ${ratingVal}
            <span class="rating-count">/10</span>
          </div>`
        : "");

  // Tags: traduz via glossário (síncrono); se não estiver no glossário,
  // mantém o original (EN) — a tradução via API seria demais para cada render.
  const themeTagsHtml = (game.themes || []).map(tag =>
    `<span class="tag">${escHtml(translateTagSync(tag))}</span>`
  ).join("");

  const modeTagsHtml = game.modes.map(m =>
    `<span class="tag ${modeClass(m)}">${escHtml(translateTagSync(m))}</span>`
  ).join("");

  // Scrub dots: screenshots only (videos are modal-only now)
  const dotCount = Math.min(screenshots.length, 5);
  const dotsHtml = Array.from({ length: dotCount }, () =>
    `<div class="scrub-dot"></div>`
  ).join("");

  const steamBtnHtml = game.steamUrl
    ? `<a class="card-steam-btn"
          href="${escHtml(game.steamUrl)}"
          target="_blank" rel="noopener"
          onclick="event.stopPropagation()">
        <img src="https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://store.steampowered.com/t&size=128" width="11" height="11" alt="Steam" style="object-fit:contain;display:block;"/>
        Steam
      </a>`
    : "";

  const cardQuickLinksHtml = `
    <a class="card-quicklink-btn" href="https://online-fix.me/" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="Online-Fix">
      <img src="https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://online-fix.me/t&size=128" width="11" height="11" alt="OF" style="object-fit:contain;display:block;"/>
    </a>
    <a class="card-quicklink-btn" href="https://cs.rin.ru/forum/index.php" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="cs.rin.ru">
      <img src="https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://cs.rin.ru/forum/index.phpt&size=128" width="11" height="11" alt="CS" style="object-fit:contain;display:block;"/>
    </a>
  `;

  // Botão "Gravações" — só aparece em jogos jogados que tenham playlistUrl configurada
  const recordingsBtnHtml = (isPlayed(game.firebaseId) && game.playlistUrl)
    ? `<a class="card-steam-btn card-recordings-btn" href="${escHtml(game.playlistUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">
        <img src="https://www.youtube.com/s/desktop/61baa440/img/favicon_32x32.png" width="11" height="11" alt="YouTube" style="object-fit:contain;display:block;"/>
        ${escHtml(t("Gravações"))}
      </a>`
    : "";

  // (ratingHtml já foi definido acima com fallback Steam → IGDB)

  // Sumário: mostra o original (EN) imediatamente; a tradução é feita
  // async depois do render (translateCardSummaries).
  const summaryText = game.summary || t("Sem descrição disponível.");
  // Estado de lançamento — Etapa 5: cruza Steam + IGDB via computeReleaseStatus
  const computedStatus = computeReleaseStatus(game);
  const releaseStatusDisplay = computedStatus ? t(computedStatus) : "";

  return `
    <div class="game-card"
         data-idx="${globalIdx}"
         data-fbid="${escHtml(game.firebaseId || "")}"
         tabindex="0"
         role="button"
         aria-label="${escHtml(t("Ver detalhes de"))} ${escHtml(game.name)}">

      <!-- Image area -->
      <div class="card-top">
        <img class="card-bg"
             src="${escHtml(coverSrc)}"
             alt="${escHtml(game.name)}"
             loading="lazy"
             data-screenshots='${JSON.stringify(screenshots)}'
             data-videos='${JSON.stringify(videos)}'/>
        <div class="card-image-gradient"></div>
        <div class="card-scrub-bar">${dotsHtml}</div>

        <!-- Botões de admin — só visíveis em modo editor (body.editor-mode) -->
        <button class="card-delete-btn" data-fbid="${escHtml(game.firebaseId || "")}" aria-label="${escHtml(t("Remover jogo"))}" title="${escHtml(t("Remover jogo"))}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <button class="card-played-btn${isPlayed(game.firebaseId) ? " played" : ""}" data-fbid="${escHtml(game.firebaseId || "")}" aria-label="${escHtml(isPlayed(game.firebaseId) ? t("Reverter") : t("Marcar como jogado"))}" title="${escHtml(isPlayed(game.firebaseId) ? t("Reverter") : t("Marcar como jogado"))}">
          ${isPlayed(game.firebaseId)
            ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>`
            : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
          }
        </button>
        <button class="card-addtab-btn${isPlayed(game.firebaseId) ? " playable" : ""}${game.playlistUrl ? " has-playlist" : ""}" data-fbid="${escHtml(game.firebaseId || "")}" data-idx="${globalIdx}" aria-label="${escHtml(t("Gravações"))}" title="${escHtml(t("Gravações"))}">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M8.051 1.999h.089c.822.003 4.987.033 6.11.335a2.01 2.01 0 0 1 1.415 1.42c.101.38.172.883.22 1.402l.01.104.022.26.008.104c.065.914.073 1.77.074 1.957v.075c-.001.194-.01 1.108-.082 2.06l-.008.105-.009.104c-.05.572-.124 1.14-.235 1.558a2.01 2.01 0 0 1-1.415 1.42c-1.16.312-5.569.334-6.18.335h-.142c-.309 0-1.587-.006-2.927-.052l-.17-.006-.087-.004-.171-.007-.171-.007c-1.11-.049-2.167-.128-2.654-.26a2.01 2.01 0 0 1-1.415-1.419c-.111-.417-.185-.986-.235-1.558L.09 9.82l-.008-.104A31 31 0 0 1 0 7.68v-.123c.002-.215.01-.958.064-1.778l.007-.103.003-.052.008-.104.022-.26.01-.104c.048-.519.119-1.023.22-1.402a2.01 2.01 0 0 1 1.415-1.42c.487-.13 1.544-.21 2.654-.26l.17-.007.172-.006.086-.003.171-.007A100 100 0 0 1 7.858 2zM6.4 5.209v4.818l4.157-2.408z"/></svg>
        </button>
        <button class="card-edit-btn" data-idx="${globalIdx}" aria-label="${escHtml(t("Editar key art"))}" title="${escHtml(t("Editar key art"))}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
        </button>

        <!-- Banner badge: cover art + title, bottom-left -->
        <div class="card-banner-badge">
          ${game.cover
            ? `<img class="card-banner-cover" src="${escHtml(game.cover)}" alt="" loading="lazy"/>`
            : `<div class="card-banner-cover card-banner-cover--empty"></div>`}
          <span class="card-banner-title">${escHtml(game.name)}</span>
        </div>

        <!-- Release status label — bottom-right of card-top -->
        ${releaseStatusDisplay ? `<span class="card-release-status card-release-status--${releaseStatusClass(computedStatus)}">${escHtml(releaseStatusDisplay)}</span>` : ""}
      </div>

      <!-- Expand panel — drops below image on hover -->
      <div class="card-expand">
        <div class="expand-tags">
          ${themeTagsHtml}
          ${modeTagsHtml}
        </div>
        <div class="expand-desc" data-game-fbid="${escHtml(game.firebaseId || "")}">${escHtml(summaryText)}</div>
        <div class="expand-footer">
          ${ratingHtml}
          <div class="expand-footer-links">
            ${cardQuickLinksHtml}
            ${recordingsBtnHtml}
            ${steamBtnHtml}
          </div>
        </div>
      </div>

    </div>
  `;
}

// Traduz síncronamente um tag via glossário (se existir).
// Para tags fora do glossário, devolve o original (EN) — a tradução
// via API seria demasiado pesada para cada render.
function translateTagSync(tag) {
  if (!tag) return tag;
  // Em EN, os tags IGDB já vêm em EN — devolve as-is.
  if (!isPt()) return tag;
  // Em PT, tenta glossário; se não estiver, devolve o original (EN).
  if (window.i18n && window.i18n.glossaryLookupSync) {
    const looked = window.i18n.glossaryLookupSync(tag);
    if (looked != null) return looked;
  }
  return tag;
}

// Traduz assíncronamente os sumários de todos os cards visíveis.
// Mostra o banner "A traduzir..." enquanto decorre.
// Usa cache interna (por firebaseId + lang) para evitar retraduzir.
const _summaryTranslated = new Map(); // chave: `${fbid}::${lang}` → texto traduzido

async function translateCardSummaries() {
  const lang = isPt() ? "pt" : "en";
  const descEls = document.querySelectorAll('.expand-desc[data-game-fbid]');
  if (descEls.length === 0) return;

  let pendingCount = 0;
  const promises = [];
  descEls.forEach(el => {
    const fbid = el.dataset.gameFbid;
    const game = gamesData.find(g => g.firebaseId === fbid);
    if (!game || !game.summary) return;

    const cacheKey = `${fbid}::${lang}`;
    // Se já temos a tradução em cache para este idioma, aplica-a
    const cached = _summaryTranslated.get(cacheKey);
    if (cached != null) {
      el.textContent = cached;
      return;
    }

    pendingCount++;
    promises.push(
      translateText(game.summary, lang).then(translated => {
        if (translated) {
          el.textContent = translated;
          _summaryTranslated.set(cacheKey, translated);
        }
      }).catch(() => {})
    );
  });

  if (pendingCount > 0) {
    await Promise.all(promises);
  }
}

// ─────────────────────────────────────────────
//  SCRUB MECHANIC
// ─────────────────────────────────────────────
function attachScrubEvents(card) {
  const img      = card.querySelector(".card-bg");
  const cardTop  = card.querySelector(".card-top");
  const dots     = card.querySelectorAll(".scrub-dot");

  let screenshots = [];

  try {
    screenshots = JSON.parse(img.dataset.screenshots || "[]");
  } catch(e) {}

  // Only screenshots for scrub — videos are modal-only
  const allMedia = screenshots.slice(0, 5);

  if (allMedia.length <= 1) {
    // Still attach click handler even with no scrub
    card.addEventListener("click", () => openModal(parseInt(card.dataset.idx)));
    card.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openModal(parseInt(card.dataset.idx));
      }
    });
    return;
  }

  let currentIdx = 0;
  let isHovering = false;

  function showMedia(idx) {
    currentIdx = idx;
    const item = allMedia[idx];
    img.style.opacity = "1";
    if (item) img.src = item;
    dots.forEach((dot, i) => dot.classList.toggle("active", i === idx));
  }

  function onMouseMove(e) {
    if (!isHovering) return;
    const rect = cardTop.getBoundingClientRect();
    const pct  = (e.clientX - rect.left) / rect.width;
    const idx  = Math.min(Math.floor(pct * allMedia.length), allMedia.length - 1);
    if (idx !== currentIdx) showMedia(idx);
  }

  function onMouseEnter() {
    isHovering = true;
    showMedia(0);
  }

  function onMouseLeave() {
    isHovering = false;
    img.src = img.dataset.cover || allMedia[0] || img.src;
    img.style.opacity = "1";
    dots.forEach(d => d.classList.remove("active"));
  }

  // Store original cover src
  img.dataset.cover = img.src;

  card.addEventListener("mouseenter", onMouseEnter);
  card.addEventListener("mouseleave", onMouseLeave);
  card.addEventListener("mousemove",  onMouseMove);

  // Click → open modal
  card.addEventListener("click", () => {
    const idx = parseInt(card.dataset.idx);
    openModal(idx);
  });

  card.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openModal(parseInt(card.dataset.idx));
    }
  });
}

// ─────────────────────────────────────────────
//  MODAL
// ─────────────────────────────────────────────
function buildModalMedia(game) {
  modalMediaList = [];
  const screenshots = game.screenshots || [];
  const videos = game.videos || [];

  // ── Modo "Gravações" ──
  // Se o jogo está marcado como jogado E tem playlistUrl configurada,
  // o modal-media mostra APENAS a playlist do YouTube (gravações).
  // As setas modal-prev/modal-next navegam entre os vídeos da playlist
  // via postMessage (nextVideo/previousVideo) em vez de trocar de media.
  if (isPlayed(game.firebaseId) && game.playlistUrl) {
    const playlistId = extractPlaylistId(game.playlistUrl);
    if (playlistId) {
      modalMediaList = [{
        type: "playlist",
        src: youtubePlaylistEmbed(playlistId),
        playlistId: playlistId,
        playlistUrl: game.playlistUrl,
      }];
      return;
    }
    // playlistUrl inválida — cai para o comportamento normal
  }

  // Constrói a lista de vídeos com metadados (videoId, ageRestricted da cache)
  const videoItems = videos.map(vid => ({
    type: "video",
    src: youtubeEmbed(vid),
    thumb: youtubeThumbnail(vid),
    videoId: vid,
    ageRestricted: isVideoAgeRestricted(vid),
  }));

  // ── Screenshots: Steam como fonte PRIMÁRIA, IGDB só como fallback ──
  // Etapa 3 (revisão): se o jogo tem screenshots Steam (enriched), usa APENAS
  // essas (1920×1080, qualidade superior). As do IGDB só aparecem se a Steam
  // não estiver disponível (jogo sem Steam, ou enrich falhou).
  // Isto também acelera o carregamento — menos imagens para carregar no modal.
  const steamImgItems = (game.steamScreenshots || []).map(s => ({
    type: "img",
    src: s.src,        // 1920×1080
    steam: true,       // marca para debugging/estilos se necessário
  }));
  // Fallback: se há screenshots Steam, NÃO inclui as do IGDB (evita duplicados
  // e reduz o número de imagens). Só usa IGDB se Steam estiver vazio.
  const igdbImgItems = steamImgItems.length > 0
    ? []
    : screenshots.map(url => ({ type: "img", src: url, steam: false }));
  const imageItems = [...steamImgItems, ...igdbImgItems];

  // ── Ordenação dos vídeos ──
  // Vídeos NÃO age-restricted primeiro (pela ordem original),
  // seguidos dos vídeos age-restricted (mantidos no fim da lista).
  const playableVideos = videoItems.filter(v => !v.ageRestricted);
  const restrictedVideos = videoItems.filter(v => v.ageRestricted);

  // ── Ordem final do modalMediaList ──
  // 1) PRIMEIRO vídeo embebível (trailer principal) — é o que abre o modal.
  //    Se o 1º vídeo da lista for age-restricted, o "trailer principal" passa
  //    a ser o 1º vídeo embebível disponível.
  // 2) Screenshots (pela ordem original do IGDB)
  // 3) Restantes vídeos embebíveis (a partir do 2º)
  // 4) Vídeos age-restricted no fim (mantidos para acesso manual)
  //
  // Isto preserva a ordem original do site para jogos normais:
  // [trailer principal] → [screenshots] → [restantes trailers] → [age-restricted]
  const mainVideo = playableVideos.length > 0 ? [playableVideos[0]] : [];
  const remainingPlayableVideos = playableVideos.slice(1);

  // 1) Trailer principal (primeiro vídeo embebível)
  mainVideo.forEach(item => modalMediaList.push(item));

  // 2) Screenshots
  imageItems.forEach(item => modalMediaList.push(item));

  // 3) Restantes vídeos embebíveis
  remainingPlayableVideos.forEach(item => modalMediaList.push(item));

  // 4) Vídeos age-restricted no fim (mantidos para acesso manual)
  restrictedVideos.forEach(item => modalMediaList.push(item));
}

function renderModalMedia(idx) {
  modalIndex = Math.max(0, Math.min(idx, modalMediaList.length - 1));
  const item = modalMediaList[modalIndex];

  // ── Modo Playlist (Gravações) ──
  // Quando o item é do tipo "playlist", as setas prev/next não trocam de media
  // — em vez disso, enviam comandos nextVideo/previousVideo ao iframe do YouTube
  // via postMessage. O iframe é o player da playlist completa.
  if (item.type === "playlist") {
    $modalMedia.innerHTML = `
      <div class="modal-media-skeleton"></div>
      <button class="modal-prev" id="modal-prev" aria-label="${escHtml(t("Anterior"))}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <button class="modal-next" id="modal-next" aria-label="${escHtml(t("Próximo"))}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
      <iframe src="${escHtml(item.src)}" allowfullscreen allow="autoplay; encrypted-media" onload="this.classList.add('loaded')"></iframe>
    `;

    // Prev/Next enviam postMessage para o iframe do YouTube
    const prevBtn = document.getElementById("modal-prev");
    const nextBtn = document.getElementById("modal-next");
    const iframe = $modalMedia.querySelector("iframe");

    if (prevBtn) {
      prevBtn.addEventListener("click", () => {
        if (!iframe) return;
        try {
          iframe.contentWindow.postMessage('{"event":"command","func":"previousVideo","args":""}', "*");
        } catch(_) {}
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener("click", () => {
        if (!iframe) return;
        try {
          iframe.contentWindow.postMessage('{"event":"command","func":"nextVideo","args":""}', "*");
        } catch(_) {}
      });
    }

    // Subscreve ao evento 'onStateChange' do player assim que o iframe carregar
    scheduleModalAutoAdvance(item);
    return;
  }

  const dotsHtml = modalMediaList.map((m, i) => {
    const isTrailer = m.type === "video";
    return `<div class="modal-media-dot${isTrailer ? " trailer-dot" : ""}${i === modalIndex ? " active" : ""}"
                 data-mid="${i}"></div>`;
  }).join("");

  const prevHtml = modalIndex > 0
    ? `<button class="modal-prev" id="modal-prev" aria-label="${escHtml(t("Anterior"))}">
         <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
       </button>` : "";

  const nextHtml = modalIndex < modalMediaList.length - 1
    ? `<button class="modal-next" id="modal-next" aria-label="${escHtml(t("Próximo"))}">
         <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
       </button>` : "";

  // ── Renderização do conteúdo de media ──
  // - Imagem: <img> normal + botão de fullscreen (zoom/pan)
  // - Vídeo embebível: <iframe> do YouTube
  // - Vídeo age-restricted (já confirmado pela cache): placeholder com
  //   thumbnail + botão "Ver no YouTube", em vez de tentar embeber.
  let mediaContent;
  let fullscreenBtnHtml = "";
  if (item.type === "img") {
    mediaContent = `<img src="${escHtml(item.src)}" alt="${escHtml(t("Screenshot"))}" onload="this.classList.add('loaded')"/>`;
    // Botão minimalista de fullscreen — só em imagens (vídeos têm o próprio player)
    const fsLabel = t("Ecrã inteiro");
    fullscreenBtnHtml = `<button class="modal-media-fullscreen-btn" id="modal-media-fullscreen-btn" type="button" aria-label="${escHtml(fsLabel)}" title="${escHtml(fsLabel)}">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 3H5a2 2 0 0 0-2 2v3"/>
        <path d="M21 8V5a2 2 0 0 0-2-2h-3"/>
        <path d="M3 16v3a2 2 0 0 0 2 2h3"/>
        <path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
      </svg>
    </button>`;
  } else if (item.ageRestricted) {
    mediaContent = renderAgeRestrictedPlaceholder(item);
  } else {
    mediaContent = `<iframe src="${escHtml(item.src)}" allowfullscreen allow="autoplay; encrypted-media" onload="this.classList.add('loaded')"></iframe>`;
  }

  $modalMedia.innerHTML = `
    <div class="modal-media-skeleton"></div>
    ${prevHtml}
    ${nextHtml}
    ${mediaContent}
    ${fullscreenBtnHtml}
    ${modalMediaList.length > 1 ? `<div class="modal-media-nav">${dotsHtml}</div>` : ""}
  `;

  // Nav events
  $modalMedia.querySelectorAll(".modal-media-dot").forEach(dot => {
    dot.addEventListener("click", () => renderModalMedia(parseInt(dot.dataset.mid)));
  });

  const prevBtn = document.getElementById("modal-prev");
  const nextBtn = document.getElementById("modal-next");
  if (prevBtn) prevBtn.addEventListener("click", () => renderModalMedia(modalIndex - 1));
  if (nextBtn) nextBtn.addEventListener("click", () => renderModalMedia(modalIndex + 1));

  // ── Fullscreen image viewer (Etapa extra) ──
  // Botão de fullscreen só existe em imagens (fullscreenBtnHtml não vazio).
  // Abre um overlay com a imagem em tamanho real, zoom (scroll) e pan (drag).
  const fsBtn = document.getElementById("modal-media-fullscreen-btn");
  if (fsBtn && item.type === "img") {
    fsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openImageFullscreen(item.src);
    });
    // Duplo clique na imagem também abre fullscreen (UX comum em galerias)
    const img = $modalMedia.querySelector("img");
    if (img) {
      img.addEventListener("dblclick", () => openImageFullscreen(item.src));
    }
  }

  scheduleModalAutoAdvance(item);
}

// ─────────────────────────────────────────────
//  Placeholder para vídeos age-restricted
//  Mostra a thumbnail do vídeo + botão "Ver no YouTube".
//  Não tenta embeber o iframe (que mostraria "Sign in to confirm your age").
// ─────────────────────────────────────────────
function renderAgeRestrictedPlaceholder(item) {
  const thumb = item.thumb || youtubeThumbnail(item.videoId);
  const watchUrl = `https://www.youtube.com/watch?v=${escHtml(item.videoId)}`;
  const label = t("Conteúdo com restrição de idade");
  const btnLabel = t("Ver no YouTube");
  return `
    <div class="modal-media-agegate">
      <img src="${escHtml(thumb)}" alt="" class="modal-media-agegate-thumb" onload="this.classList.add('loaded')"/>
      <div class="modal-media-agegate-overlay">
        <svg class="modal-media-agegate-icon" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 8v4"/>
          <path d="M12 16h.01"/>
        </svg>
        <span class="modal-media-agegate-label">${escHtml(label)}</span>
        <a class="modal-media-agegate-btn" href="${escHtml(watchUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
          ${escHtml(btnLabel)}
        </a>
      </div>
    </div>
  `;
}

// ─────────────────────────────────────────────
//  Auto-advance do modal-media:
//  - screenshot: avança após 5s idle
//  - vídeo: avança quando o YouTube reporta 'ended' (postMessage API)
//
//  Deteção de vídeos age-restricted / não-embebíveis:
//  - O YouTube IFrame API dispara onError com código 101 ou 150 quando um
//    vídeo não pode ser embebido (inclui age-restriction, embed-disabled,
//    privado, etc.).
//  - Quando detetado: marca o vídeo na cache persistente, move-o para o fim
//    da lista, e avança para o próximo media disponível.
//  - Se não houver outros media, mostra o placeholder de age-restriction.
// ─────────────────────────────────────────────
function clearModalAutoAdvance() {
  if (modalAutoTimer) { clearTimeout(modalAutoTimer); modalAutoTimer = null; }
  window.removeEventListener("message", onYoutubeStateMessage);
}

function goToNextModalMedia() {
  if (!modalOpen) return;
  const nextIdx = modalIndex + 1 < modalMediaList.length ? modalIndex + 1 : 0;
  renderModalMedia(nextIdx);
}

function onYoutubeStateMessage(e) {
  let data;
  try { data = JSON.parse(e.data); } catch(_) { return; }
  if (!data) return;

  // YT IFrame API: event "infoDelivery", info.playerState === 0 → ended
  if (data.event === "infoDelivery" && data.info && data.info.playerState === 0) {
    goToNextModalMedia();
    return;
  }

  // Deteção de vídeo age-restricted / não-embebível:
  // onError com código 101 ou 150 = o vídeo não pode ser reproduzido no embed.
  // 101 = vídeo não embebível (embed disabled pelo dono)
  // 150 = o mesmo, mas devolvido pelo player de embed (inclui age-restriction)
  if (data.event === "onError" && (data.info === 101 || data.info === 150)) {
    handleAgeRestrictedVideo();
  }
}

// Processa um vídeo detetado como age-restricted / não-embebível:
// 1. Marca o videoId na cache persistente (não volta a tentar embeber)
// 2. Reconstrói o modalMediaList mantendo a ordem original do site:
//    [próximo vídeo embebível (novo trailer principal)] → [screenshots]
//    → [restantes vídeos embebíveis] → [vídeos age-restricted no fim]
// 3. Re-renderiza para mostrar o novo trailer principal (se houver vídeo
//    embebível) ou a primeira screenshot. Se só houver vídeos age-restricted,
//    mostra o placeholder no lugar do iframe.
function handleAgeRestrictedVideo() {
  const currentItem = modalMediaList[modalIndex];
  if (!currentItem || currentItem.type !== "video") return;
  // Playlists não são afectadas por age-restriction de vídeos individuais
  if (currentItem.type === "playlist") return;

  // 1. Marca na cache
  if (currentItem.videoId) {
    markVideoAgeRestricted(currentItem.videoId);
  }
  currentItem.ageRestricted = true;

  // 2. Reconstrói a lista na ordem original do site:
  //    - Vídeos embebíveis (não-restricted) e screenshots, separados
  //    - Primeiro vídeo embebível → screenshots → restantes vídeos embebíveis
  //    - Vídeos age-restricted no fim
  const playableVideos = [];
  const restrictedVideos = [];
  const images = [];
  modalMediaList.forEach(m => {
    if (m.type === "video") {
      if (m.ageRestricted) restrictedVideos.push(m);
      else playableVideos.push(m);
    } else {
      images.push(m);
    }
  });

  // Reconstrói: [1º vídeo embebível] → [screenshots] → [restantes vídeos] → [restritos]
  const mainVideo = playableVideos.length > 0 ? [playableVideos[0]] : [];
  const remainingPlayable = playableVideos.slice(1);
  modalMediaList = [...mainVideo, ...images, ...remainingPlayable, ...restrictedVideos];

  // 3. Determina o que mostrar a seguir:
  //    - Se há media jogável (vídeo embebível ou screenshot), mostra o primeiro
  //    - Se só há vídeos age-restricted, mostra o placeholder do primeiro
  const hasPlayable = playableVideos.length > 0 || images.length > 0;
  if (hasPlayable) {
    // Mostra o novo primeiro media (vídeo embebível ou screenshot)
    renderModalMedia(0);
  } else {
    // Não há media jogável — mostra o placeholder do primeiro age-restricted
    const newIdx = modalMediaList.indexOf(currentItem);
    renderModalMedia(newIdx >= 0 ? newIdx : 0);
  }
}

function scheduleModalAutoAdvance(item) {
  clearModalAutoAdvance();
  if (!item) return;

  // Placeholder de age-restriction: comporta-se como imagem (avança após 10s)
  if (item.type === "img" || (item.type === "video" && item.ageRestricted)) {
    modalAutoTimer = setTimeout(goToNextModalMedia, 10000);
    return;
  }

  // Playlist (Gravações): o player do YouTube avança automaticamente para o
  // próximo vídeo da playlist — não é necessário auto-advance nem listener.
  if (item.type === "playlist") {
    return;
  }

  // Vídeo embebível: escuta mensagens do YouTube para detetar 'ended' e onError
  if (item.type === "video") {
    window.addEventListener("message", onYoutubeStateMessage);
    // Subscreve ao evento 'onStateChange' do player assim que o iframe carregar
    const iframe = $modalMedia.querySelector("iframe");
    if (iframe) {
      iframe.addEventListener("load", () => {
        try {
          iframe.contentWindow.postMessage('{"event":"listening","id":1}', "*");
        } catch(_) {}
      });
    }
  }
}

// ─────────────────────────────────────────────
//  MODAL — Banner do jogo (capa), fora do modal-media,
//  do lado esquerdo. Fallback discreto se não houver capa.
//  Inclui os botões de up-vote (bottom-left) e down-vote (bottom-right),
//  com os nomes dos votantes acima de cada botão (sem background).
// ─────────────────────────────────────────────
function renderModalBanner(game) {
  const upCount = getUpvoteCount(game.firebaseId);
  const downCount = getDownvoteCount(game.firebaseId);
  const upVoted = hasUserUpvoted(game.firebaseId);
  const downVoted = hasUserDownvoted(game.firebaseId);
  const upNames = getUpvoterNames(game.firebaseId);
  const downNames = getDownvoterNames(game.firebaseId);

  $modalBanner.innerHTML = `
    ${game.cover
      ? `<img src="${escHtml(game.cover)}" alt="${escHtml(game.name)}" loading="lazy"/>`
      : `<div class="modal-banner-empty"></div>`}
    ${discoverMode && !isGameVisited(game.firebaseId) ? `<span class="modal-new-badge">${escHtml(t("Novidade"))}</span>` : ""}
    <button class="modal-vote-btn modal-upvote-btn${upVoted ? " voted" : ""}" data-fbid="${escHtml(game.firebaseId || "")}" aria-label="${escHtml(t("Votar a favor"))}" title="${escHtml(t("Votar a favor"))}">
      <svg class="vote-arrow" width="16" height="16" viewBox="0 0 20 20" fill="currentColor" fill-rule="evenodd" stroke="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 19a3.966 3.966 0 01-3.96-3.962V10.98H2.838c-.706 0-1.335-.42-1.605-1.073-.27-.652-.122-1.396.377-1.895l7.754-7.759a.925.925 0 011.272 0l7.754 7.76a1.734 1.734 0 01.376 1.894c-.27.652-.9 1.073-1.605 1.073h-3.202v4.058A3.965 3.965 0 0110 19zm-7.01-9.82h4.85v4.73c0 1.13.81 2.163 1.934 2.278a2.163 2.163 0 002.386-2.15V9.18h4.85L10 2.164 2.99 9.18z"/></svg>
      <span class="vote-count">${upCount}</span>
    </button>
    <button class="modal-vote-btn modal-downvote-btn${downVoted ? " voted" : ""}" data-fbid="${escHtml(game.firebaseId || "")}" aria-label="${escHtml(t("Votar contra"))}" title="${escHtml(t("Votar contra"))} (${downCount}/${DOWNVOTE_THRESHOLD})">
      <svg class="vote-arrow" width="16" height="16" viewBox="0 0 20 20" fill="currentColor" fill-rule="evenodd" stroke="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 1a3.966 3.966 0 013.96 3.962V9.02h3.202c.706 0 1.335.42 1.605 1.073.27.652.122 1.396-.377 1.895l-7.754 7.759a.925.925 0 01-1.272 0l-7.754-7.76a1.734 1.734 0 01-.376-1.894c.27-.652.9-1.073 1.605-1.073h3.202V4.962A3.965 3.965 0 0110 1zm7.01 9.82h-4.85V5.09c0-1.13-.81-2.163-1.934-2.278a2.163 2.163 0 00-2.386 2.15v5.859H2.989l7.01 7.016 7.012-7.016z"/></svg>
      <span class="vote-count">${downCount}</span>
    </button>
    <div class="modal-vote-names modal-upvote-names" data-fbid="${escHtml(game.firebaseId || "")}"></div>
    <div class="modal-vote-names modal-downvote-names" data-fbid="${escHtml(game.firebaseId || "")}"></div>
  `;

  // Liga os handlers dos botões de voto
  const upBtn = $modalBanner.querySelector(".modal-upvote-btn");
  const downBtn = $modalBanner.querySelector(".modal-downvote-btn");
  if (upBtn) {
    upBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleUpvote(game.firebaseId);
    });
    // Fallback para browsers sem :has() — mostra nomes independentemente no hover de cada botão
    upBtn.addEventListener("mouseenter", () => $modalBanner.classList.add("show-upvote-names"));
    upBtn.addEventListener("mouseleave", () => $modalBanner.classList.remove("show-upvote-names"));
  }
  if (downBtn) {
    downBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      // No modo Descoberta: down-vote novo → auto-avançar para o próximo jogo
      if (discoverMode && !hasUserDownvoted(game.firebaseId)) {
        toggleDownvote(game.firebaseId).then(() => {
          navigateDiscover("next");
        });
      } else {
        toggleDownvote(game.firebaseId);
      }
    });
    downBtn.addEventListener("mouseenter", () => $modalBanner.classList.add("show-downvote-names"));
    downBtn.addEventListener("mouseleave", () => $modalBanner.classList.remove("show-downvote-names"));
  }

  // Renderiza os nomes dos votantes acima de cada botão (com animação)
  renderVoteNames($modalBanner.querySelector(".modal-upvote-names"), upNames, "up");
  renderVoteNames($modalBanner.querySelector(".modal-downvote-names"), downNames, "down");
}

// Renderiza os nomes dos votantes numa zona acima do botão.
// Animação: cada nome aparece de baixo para cima, um de cada vez, rápido.
function renderVoteNames(container, names, type) {
  if (!container) return;
  container.innerHTML = "";
  if (!names || names.length === 0) return;

  names.forEach((name, i) => {
    const span = document.createElement("span");
    span.className = `vote-name vote-name-${type}`;
    span.textContent = name;
    span.style.animationDelay = `${i * 60}ms`;
    container.appendChild(span);
  });
  // Força reflow para a animação disparar
  void container.offsetHeight;
}

// Actualiza apenas os contadores, estados dos botões e nomes dos votantes no modal
// (chamada quando os upvotes/downvotes mudam, sem re-renderizar todo o modal)
function updateModalVoteButtons(game) {
  if (!game) return;
  const upBtn = $modalBanner.querySelector(".modal-upvote-btn");
  const downBtn = $modalBanner.querySelector(".modal-downvote-btn");
  if (upBtn) {
    const count = getUpvoteCount(game.firebaseId);
    upBtn.querySelector(".vote-count").textContent = count;
    upBtn.classList.toggle("voted", hasUserUpvoted(game.firebaseId));
  }
  if (downBtn) {
    const count = getDownvoteCount(game.firebaseId);
    downBtn.querySelector(".vote-count").textContent = count;
    downBtn.classList.toggle("voted", hasUserDownvoted(game.firebaseId));
    downBtn.title = `${t("Votar contra")} (${count}/${DOWNVOTE_THRESHOLD})`;
  }
  // Actualiza os nomes dos votantes acima de cada botão
  renderVoteNames(
    $modalBanner.querySelector(".modal-upvote-names"),
    getUpvoterNames(game.firebaseId),
    "up"
  );
  renderVoteNames(
    $modalBanner.querySelector(".modal-downvote-names"),
    getDownvoterNames(game.firebaseId),
    "down"
  );
}

// ─────────────────────────────────────────────
//  MODAL — Aba extra: estúdio, desenvolvedor,
//  data de lançamento, estado de lançamento, engine.
//  Mostra um valor de fallback quando o dado
//  não existe na IGDB.
// ─────────────────────────────────────────────
const EXTRA_INFO_FALLBACK = "Não disponível";

function renderModalExtraInfo(game) {
  const fallbackDisplay = t(EXTRA_INFO_FALLBACK);
  const studioStr = (game.studios && game.studios.length)
    ? game.studios.join(", ") : fallbackDisplay;
  const devStr = (game.developers && game.developers.length)
    ? game.developers.join(", ") : fallbackDisplay;
  // Data: Etapa 5 — prefere a data da Steam (localizada), fallback IGDB
  const dateStr = computeReleaseDateFull(game) || fallbackDisplay;
  // Release status: Etapa 5 — cruza Steam + IGDB via computeReleaseStatus
  const computedStatus = computeReleaseStatus(game);
  const statusStr = computedStatus ? t(computedStatus) : fallbackDisplay;
  const engineStr = (game.engines && game.engines.length)
    ? game.engines.join(", ") : fallbackDisplay;
  const languageStrVal = game.language || fallbackDisplay;

  // Modos de jogo (multiplayer, co-op, etc.) são mostrados nos tags — excluir daqui
  // Géneros substituem os themes no extra-info
  // (em PT, traduz tags via glossário; em EN, mantém original)
  const genresStr = (game.genres && game.genres.length)
    ? game.genres.map(translateTagSync).join(", ") : fallbackDisplay;

  // ── Último update (Etapa Updates) ──
  // computeLastUpdate devolve { source, date, title, url } ou null.
  // Se source === "steam": o valor é clicável (link para a página de updates)
  //   com seta SVG a apontar ao canto superior direito + hover com zoom.
  // Se source === "igdb": texto normal, não clicável, sem seta.
  // Se null: mostra o fallback "Não disponível".
  const lastUpdate = computeLastUpdateSync(game);
  let lastUpdateHtml;
  if (!lastUpdate) {
    lastUpdateHtml = `<span class="extra-info-value unknown">${escHtml(fallbackDisplay)}</span>`;
  } else {
    const dateText = formatLastUpdateDate(lastUpdate.date);
    if (lastUpdate.source === "steam" && lastUpdate.url) {
      // Steam: link clicável com seta + hover zoom
      lastUpdateHtml = `<a class="extra-info-value extra-info-update" href="${escHtml(lastUpdate.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="${escHtml(lastUpdate.title || '')}">
        <span class="extra-info-update-text">${escHtml(dateText)}</span>
        <svg class="extra-info-update-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M7 17L17 7"/>
          <path d="M8 7h9v9"/>
        </svg>
      </a>`;
    } else {
      // IGDB: texto normal, não clicável
      lastUpdateHtml = `<span class="extra-info-value">${escHtml(dateText)}</span>`;
    }
  }

  const rows = [
    [t("Estúdio"), studioStr, false],
    [t("Desenvolvedor"), devStr, false],
    [t("Data de lançamento"), dateStr, false],
    [t("Estado de lançamento"), statusStr, false],
    [t("Último update"), lastUpdateHtml, true],  // ← HTML raw (não escapar)
    [t("Engine"), engineStr, false],
    [t("Linguagem"), languageStrVal, false],
    [t("Géneros"), genresStr, false],
  ];

  $modalExtraInfo.innerHTML = rows.map(([label, value, isHtml]) => `
    <div class="extra-info-row">
      <span class="extra-info-label">${escHtml(label)}</span>
      ${isHtml ? value : `<span class="extra-info-value${value === fallbackDisplay ? " unknown" : ""}">${escHtml(value)}</span>`}
    </div>
  `).join("");
}

function openModal(gameIdx) {
  const game = gamesData[gameIdx];
  if (!game) return;
  modalOpen = true;
  _modalCurrentGame = game;

  // Nota: markGameVisited é chamado no fim, após renderModalBanner,
  // para que o label "Novidade" possa aparecer correctamente.

  buildModalMedia(game);
  const ratingVal = ratingStr(game.rating);

  const themeTagsHtml = (game.themes || []).map(tag =>
    `<span class="tag">${escHtml(translateTagSync(tag))}</span>`
  ).join("");

  const modeTagsHtml = game.modes.map(m =>
    `<span class="tag ${modeClass(m)}">${escHtml(translateTagSync(m))}</span>`
  ).join("");

  const ratingHtml = ratingVal
    ? `<div class="modal-rating">
         <svg width="16" height="16" viewBox="0 0 24 24" fill="#ffc86a"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>
         ${ratingVal} / 10
       </div>` : "";

  // ── Etapa 4: Badge de reviews Steam com fallback IGDB ──
  // Comportamento igual ao card: badge Steam SUBSTITUI rating IGDB quando há
  // reviews Steam. Se não houver Steam (ou enrich falhou), mostra rating IGDB.
  // Isto evita o bug de aparecerem ambas as reviews em simultâneo.
  const steamBadgeModal = steamReviewBadgeHtml(game);
  const modalRatingHtml = steamBadgeModal || ratingHtml;

  const infoSteamHtml = game.steamUrl
    ? `<a class="modal-info-steam" href="${escHtml(game.steamUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">
        <img src="https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://store.steampowered.com/t&size=128" width="11" height="11" alt="Steam" style="object-fit:contain;display:block;"/>
        Steam
      </a>`
    : "";

  const modalQuickLinksHtml = `
    <a class="modal-info-quicklink" href="https://online-fix.me/" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="Online-Fix">
      <img class="quicklink-icon" src="https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://online-fix.me/t&size=128" alt="" loading="lazy"/>
      Online-Fix
    </a>
    <a class="modal-info-quicklink" href="https://cs.rin.ru/forum/index.php" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="cs.rin.ru">
      <img class="quicklink-icon" src="https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://cs.rin.ru/forum/index.phpt&size=128" alt="" loading="lazy"/>
      cs.rin.ru
    </a>
  `;

  // Botão "Gravações" no modal-info — só aparece em jogos jogados com playlistUrl
  const modalRecordingsHtml = (isPlayed(game.firebaseId) && game.playlistUrl)
    ? `<a class="modal-info-quicklink modal-info-recordings" href="${escHtml(game.playlistUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="${escHtml(t("Gravações"))}">
        <img class="quicklink-icon" src="https://www.youtube.com/s/desktop/61baa440/img/favicon_32x32.png" alt="" loading="lazy"/>
        ${escHtml(t("Gravações"))}
      </a>`
    : "";

  $modalInfo.innerHTML = `
    <div class="modal-info-actions">
      ${modalQuickLinksHtml}
      ${modalRecordingsHtml}
      ${infoSteamHtml}
      <button class="modal-info-expand-btn" id="modal-info-expand-btn" aria-label="${escHtml(t("Expandir descrição"))}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
          <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
          <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
        </svg>
      </button>
    </div>
    <div class="modal-title-row">
      <h2 class="modal-title">${escHtml(game.name)}</h2>
      <button class="modal-copy-btn" id="modal-copy-btn" aria-label="${escHtml(t("Copiar nome"))}" title="${escHtml(t("Copiar nome do jogo"))}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      </button>
    </div>
    <div class="modal-tags">${themeTagsHtml}${modeTagsHtml}</div>
    <div class="modal-meta">${modalRatingHtml}</div>
    <p class="modal-desc" id="modal-desc">${escHtml(game.summary || t("Sem descrição disponível."))}</p>
  `;

  document.getElementById("modal-info-expand-btn")
    .addEventListener("click", (e) => { e.stopPropagation(); toggleInfoExpand(); });

  const copyBtn = document.getElementById("modal-copy-btn");
  if (copyBtn) {
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(game.name).then(() => {
        copyBtn.classList.add("copied");
        setTimeout(() => copyBtn.classList.remove("copied"), 1400);
      }).catch(() => {});
    });
  }

  renderModalExtraInfo(game);
  renderModalBanner(game);

  // Start with first screenshot (index 0)
  renderModalMedia(0);

  $gameModal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  $modalClose.focus();

  // Parallax 3D subtil — segue o rato dentro da zona de media
  $modalMedia.addEventListener("mousemove", onModalMediaParallax);
  $modalMedia.addEventListener("mouseleave", resetModalMediaParallax);

  // Traduz assíncronamente o sumário do jogo (Google Translate API)
  // Usa a mesma cache do translateCardSummaries para consistência.
  // Em modo EN, translateText devolve o texto as-is (sem chamadas à API).
  if (game.summary) {
    const descEl = document.getElementById("modal-desc");
    if (descEl) {
      const lang = isPt() ? "pt" : "en";
      const cacheKey = `${game.firebaseId}::${lang}`;
      const cached = _summaryTranslated.get(cacheKey);

      if (cached != null) {
        // Já temos a tradução em cache — aplica imediatamente
        descEl.textContent = cached;
      } else {
        // Traduz em background e actualiza quando estiver pronto
        translateText(game.summary, lang).then(translated => {
          if (translated) {
            descEl.textContent = translated;
            _summaryTranslated.set(cacheKey, translated);
          }
        }).catch(() => {});
      }
    }
  }

  // Marca o jogo como visitado (depois de renderModalBanner,
  // para que o label "Novidade" possa aparecer correctamente)
  markGameVisited(game.firebaseId);
}

// ─────────────────────────────────────────────
//  Parallax 3D subtil no visualizador de media
//  (só para screenshots — o iframe do YouTube
//  fica a 100% para não cortar a UI do player)
// ─────────────────────────────────────────────
function onModalMediaParallax(e) {
  const el = $modalMedia.querySelector("img");
  if (!el) return;
  const rect = $modalMedia.getBoundingClientRect();
  const px = (e.clientX - rect.left) / rect.width  - 0.5; // -0.5 a 0.5
  const py = (e.clientY - rect.top)  / rect.height - 0.5;

  const maxShift = 10;   // px de translação
  const maxTilt  = 2.5;  // graus de rotação

  el.style.transform =
    `translate3d(${(-px * maxShift).toFixed(2)}px, ${(-py * maxShift).toFixed(2)}px, 0) ` +
    `rotateX(${(py * maxTilt).toFixed(2)}deg) rotateY(${(-px * maxTilt).toFixed(2)}deg) scale(1.02)`;
}

function resetModalMediaParallax() {
  const el = $modalMedia.querySelector("img");
  if (el) el.style.transform = "translate3d(0,0,0) rotateX(0) rotateY(0) scale(1)";
}

function closeModal() {
  modalOpen = false;
  if (infoExpanded) collapseInfo();
  clearModalAutoAdvance();
  // Stop any iframe from playing
  $modalMedia.removeEventListener("mousemove", onModalMediaParallax);
  $modalMedia.removeEventListener("mouseleave", resetModalMediaParallax);
  $modalMedia.innerHTML = "";
  $modalExtraInfo.innerHTML = "";
  $modalBanner.innerHTML = "";
  $gameModal.classList.add("hidden");
  document.body.style.overflow = "";
  // Sair do modo Descoberta ao fechar o modal
  if (discoverMode) exitDiscover();
}

$modalClose.addEventListener("click", closeModal);
$modalBackdrop.addEventListener("click", () => {
  // No modo Descoberta, clicar fora do modal não faz nada
  if (discoverMode) return;
  if (infoExpanded) { collapseInfo(); } else { closeModal(); }
});

// ─────────────────────────────────────────────
//  MODAL — Info panel expand (texto completo)
//  Centra e amplia o modal-info; sai com ESC
//  ou clique fora da zona.
// ─────────────────────────────────────────────
function pauseModalYoutube() {
  const iframe = $modalMedia.querySelector("iframe");
  if (iframe) {
    // postMessage API do YouTube player — pausa sem recarregar o src
    try { iframe.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}', "*"); } catch(e) {}
  }
}

function expandInfo() {
  infoExpanded = true;
  pauseModalYoutube();
  clearModalAutoAdvance();
  $modalInfo.classList.add("expanded");
}

function collapseInfo() {
  infoExpanded = false;
  $modalInfo.classList.remove("expanded");
  scheduleModalAutoAdvance(modalMediaList[modalIndex]);
}

function toggleInfoExpand() {
  if (infoExpanded) collapseInfo(); else expandInfo();
}

// Keyboard nav in modal
document.addEventListener("keydown", e => {
  if (!modalOpen) return;
  if (e.key === "Escape") {
    // No modo Descoberta, ESC não fecha o modal (só o botão X fecha)
    if (discoverMode) return;
    if (infoExpanded) { collapseInfo(); } else { closeModal(); }
    return;
  }
  if (infoExpanded) return;
  if (e.key === "ArrowRight") renderModalMedia(modalIndex + 1);
  if (e.key === "ArrowLeft")  renderModalMedia(modalIndex - 1);
});

// ─────────────────────────────────────────────
//  ADMIN MODE — Typing "admin"
// ─────────────────────────────────────────────
let adminBuffer = "";
let adminHintTimer = null;

const ADMIN_WORD = "qdmin";

document.addEventListener("keydown", e => {
  // Ignore enquanto um modal está aberto, ou enquanto se escreve num input/textarea
  // (mas continua a ouvir mesmo com adminOpen=true, para permitir fechar o admin)
  if (modalOpen) return;
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

  const char = e.key.toLowerCase();
  if (!/^[a-z]$/.test(char)) {
    adminBuffer = "";
    return;
  }

  adminBuffer += char;

  // Show hint
  if (ADMIN_WORD.startsWith(adminBuffer)) {
    $adminHintText.textContent = adminBuffer;
    $adminHint.classList.add("show");
    clearTimeout(adminHintTimer);
    adminHintTimer = setTimeout(() => {
      $adminHint.classList.remove("show");
      adminBuffer = "";
    }, 1500);
  } else {
    adminBuffer = "";
    $adminHint.classList.remove("show");
  }

  // Check if complete
  if (adminBuffer === ADMIN_WORD) {
    adminBuffer = "";
    clearTimeout(adminHintTimer);
    $adminHint.classList.remove("show");
    // ⚠️  Só o admin (Leo) pode usar o comando "qdmin".
    // Se não houver currentUser ou não for admin, ignora silenciosamente.
    if (!currentUser || !currentUser.isAdmin) {
      return;
    }
    // Se o admin já está aberto, a mesma palavra fecha-o (e tudo o que
    // depende dele); caso contrário, abre o modo admin como antes.
    if (adminOpen) {
      closeAdmin();
    } else {
      openAdmin();
    }
  }
});

function openAdmin() {
  // Activa o "modo editor": mostra o botão flutuante no canto inferior
  // direito (colapsado) e revela os botões de admin nos cards.
  adminOpen = true;
  $adminOverlay.classList.remove("hidden");
  document.body.classList.add("editor-mode");
  $createTabWrap.classList.remove("hidden");
}

function closeAdmin() {
  // Sai por completo do modo editor.
  adminOpen = false;
  adminExpanded = false;
  $adminOverlay.classList.add("hidden");
  $adminPanel.classList.remove("expanded");
  document.body.classList.remove("editor-mode");
  $adminResults.classList.add("hidden");
  $adminResults.innerHTML = "";
  $adminSearch.value = "";
  hideStatus();
  // Colapsa o painel de testes e para o loading forçado, se estiver activo
  closeTestsPanel();
  if (forcedLoadingActive) {
    if (typeof window.forceShowLoader === "function") window.forceShowLoader(false);
    setForcedLoadingUI(false);
  }
  // Fecha quaisquer modais dependentes do modo admin (key-art picker,
  // adicionar a tab) que possam estar abertos
  if (!$keyartModal.classList.contains("hidden")) closeKeyArtPicker();
  if (!$addtabModal.classList.contains("hidden")) closePlaylistModal();
  // Hide criar tab input if open
  $createTabBtn.classList.remove("hidden");
  $createTabInputWrap.classList.add("hidden");
  $createTabWrap.classList.add("hidden");
}

function toggleAdminPanel() {
  adminExpanded = !adminExpanded;
  $adminPanel.classList.toggle("expanded", adminExpanded);
  if (adminExpanded && adminActiveTab === "games") {
    setTimeout(() => $adminSearch.focus(), 150);
  }
}

$adminFab.addEventListener("click", toggleAdminPanel);
$adminClose.addEventListener("click", closeAdmin);
$adminOverlay.addEventListener("keydown", e => {
  if (e.key === "Escape") closeAdmin();
});

// ─────────────────────────────────────────────
//  ADMIN — Tabs internas (Jogos | Contas)
//
//  • "Jogos"    → administração de jogos (pesquisa IGDB + lista)
//  • "Contas"   → gerenciamento de contas (recuperação de sessão)
//
//  A tab "Contas" lista os utilizadores registados e permite ao admin
//  ativar/desativar o modo de recuperação para cada um. Quando ativo,
//  o utilizador marcado pode re-registar-se noutro browser com o MESMO
//  nome, reclamando a sua sessão (e todos os dados associados: votos,
//  tabs, scores do Brick Breaker, etc.) sem perder nada.
// ─────────────────────────────────────────────
function switchAdminTab(tab) {
  if (tab !== "games" && tab !== "accounts") return;
  adminActiveTab = tab;

  // Atualiza os botões das tabs
  if ($adminTabs) {
    $adminTabs.querySelectorAll(".admin-tab").forEach(btn => {
      const isActive = btn.dataset.adminTab === tab;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    });
  }

  // Mostra/esconde o conteúdo das tabs
  if ($adminTabGames)    $adminTabGames.classList.toggle("hidden",    tab !== "games");
  if ($adminTabAccounts) $adminTabAccounts.classList.toggle("hidden", tab !== "accounts");

  // Se abriu a tab das contas, (re)renderiza a lista para refletir o
  // estado mais recente do Firebase (recoveryMode pode ter mudado).
  if (tab === "accounts") renderAdminAccounts();
}

// Delegação de cliques nos botões das tabs do painel de admin.
if ($adminTabs) {
  $adminTabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".admin-tab");
    if (!btn || !btn.dataset.adminTab) return;
    switchAdminTab(btn.dataset.adminTab);
  });
}

// ─────────────────────────────────────────────
//  ADMIN — Render da lista de contas (tab "Contas")
//
//  Cada utilizador aparece numa linha com:
//    • Nome (capitalizado)
//    • Badge "Admin" se for admin
//    • Badge "Recuperação ativa" se recoveryMode === true
//    • Botão para ativar/cancelar a recuperação
//
//  O estado recoveryMode é lido do Firestore (campo boolean no doc do
//  user). Quando ativo, o botão de registo volta a aparecer (mesmo com
//  3+ utilizadores) e só o nome exato do utilizador marcado pode
//  reclamar a sessão.
// ─────────────────────────────────────────────
function renderAdminAccounts() {
  if (!$adminAccountsList) return;

  if (allUsers.length === 0) {
    $adminAccountsList.innerHTML =
      `<div class="admin-empty">${escHtml(t("Nenhum utilizador registado."))}</div>`;
    return;
  }

  $adminAccountsList.innerHTML = allUsers.map(u => {
    const inRecovery = u.recoveryMode === true;
    const isAdmin = !!u.isAdmin;
    const isSelf = currentUser && currentUser.id === u.id;

    const badges = [];
    if (isAdmin) {
      badges.push(`<span class="admin-account-badge admin">${escHtml(t("Admin"))}</span>`);
    }
    if (inRecovery) {
      badges.push(`<span class="admin-account-badge recovery">${escHtml(t("Recuperação ativa"))}</span>`);
    }
    if (isSelf) {
      badges.push(`<span class="admin-account-badge self">${escHtml(t("Tu"))}</span>`);
    }

    const btnLabel = inRecovery
      ? t("Cancelar recuperação")
      : t("Ativar recuperação");
    const btnClass = inRecovery
      ? "admin-account-recovery-btn cancel"
      : "admin-account-recovery-btn";

    return `
      <div class="admin-account-row${inRecovery ? " recovery-active" : ""}" data-user-id="${escHtml(u.id)}">
        <div class="admin-account-info">
          <span class="admin-account-name">${escHtml(u.name || "")}</span>
          <div class="admin-account-badges">${badges.join("")}</div>
        </div>
        <button class="${btnClass}" data-user-id="${escHtml(u.id)}" type="button">
          ${escHtml(btnLabel)}
        </button>
      </div>
    `;
  }).join("");

  // Liga os botões de toggle de recuperação
  $adminAccountsList.querySelectorAll(".admin-account-recovery-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      toggleRecovery(btn.dataset.userId);
    });
  });
}

// ─────────────────────────────────────────────
//  ADMIN — Toggle do modo de recuperação de um utilizador
//
//  • Pede confirmação (sim/não) antes de alterar o estado.
//  • Se ativar: define recoveryMode = true no doc do user no Firestore.
//    O registo volta a aparecer (mesmo com 3+ users) e só o nome exato
//    pode reclamar a sessão.
//  • Se cancelar: define recoveryMode = false.
//  • O estado persiste no Firestore (sobrevive a fecho de página).
//  • Apenas o admin pode usar esta função.
// ─────────────────────────────────────────────
async function toggleRecovery(userId) {
  if (!currentUser || !currentUser.isAdmin) {
    showToast(t("Apenas o admin pode gerir contas."));
    return;
  }
  if (!db) return;

  const user = allUsers.find(u => u.id === userId);
  if (!user) return;

  const userName = user.name || "";
  const currentlyActive = user.recoveryMode === true;

  if (currentlyActive) {
    // Cancelar recuperação
    const confirmMsg = `${t("Queres cancelar a recuperação para")} "${userName}"?`;
    if (!confirm(confirmMsg)) return;
    try {
      await updateDoc(doc(db, "users", userId), { recoveryMode: false });
      showToast(`${t("Recuperação cancelada para")} ${userName}.`);
    } catch (err) {
      console.error("[toggleRecovery] erro ao cancelar:", err);
      showToast(t("Erro ao cancelar recuperação."));
    }
  } else {
    // Ativar recuperação
    const confirmMsg =
      `${t("Queres ativar a recuperação para")} "${userName}"?\n` +
      t("A recuperação permite que um utilizador recupere a sua sessão noutro browser usando o mesmo nome.");
    if (!confirm(confirmMsg)) return;
    try {
      await updateDoc(doc(db, "users", userId), { recoveryMode: true });
      showToast(`${t("Recuperação ativada para")} ${userName}.`);
    } catch (err) {
      console.error("[toggleRecovery] erro ao ativar:", err);
      showToast(t("Erro ao ativar recuperação."));
    }
  }
  // O onSnapshot de users re-renderiza a lista automaticamente.
}

// ─────────────────────────────────────────────
//  ADMIN — Painel de Testes (fab ao lado do admin-fab)
//  Funciona como um menu colapsado, igual em comportamento ao
//  botão do admin, mas guarda botões de teste para uso futuro.
// ─────────────────────────────────────────────
function toggleTestsPanel() {
  testsExpanded = !testsExpanded;
  $adminTestsBtn.classList.toggle("active", testsExpanded);
  $adminTestsPanel.classList.toggle("open", testsExpanded);
}

function closeTestsPanel() {
  testsExpanded = false;
  $adminTestsBtn.classList.remove("active");
  $adminTestsPanel.classList.remove("open");
}

$adminTestsBtn.addEventListener("click", toggleTestsPanel);

// ─────────────────────────────────────────────
//  ADMIN — Forçar Loading (dentro do painel de testes)
//  Reexibe o ecrã de loading e mantém a animação a correr
//  indefinidamente, até se clicar de novo para desligar.
// ─────────────────────────────────────────────
function setForcedLoadingUI(active) {
  forcedLoadingActive = active;
  $adminForceLoadingBtn.classList.toggle("active", active);
  $adminForceLoadingLabel.textContent = active ? t("A Forçar Loading...") : t("Forçar Loading");
}

$adminForceLoadingBtn.addEventListener("click", () => {
  const next = !forcedLoadingActive;
  if (typeof window.forceShowLoader === "function") {
    window.forceShowLoader(next);
  }
  setForcedLoadingUI(next);
});

// Botão "Criar Lixo" — só admin. Cria a pasta lixo manualmente.
$adminCreateTrashBtn.addEventListener("click", () => {
  createTrashTab();
});

// Botão "Limpar Reprovados" — só admin. Remove todos os jogos que estão nos Reprovados.
// Pede confirmação antes de executar.
$adminClearTrashBtn.addEventListener("click", async () => {
  if (!currentUser || !currentUser.isAdmin) {
    showToast(t("Apenas o admin pode limpar Reprovados."));
    return;
  }
  if (!trashTabId) {
    showToast(t("Não há Reprovados para limpar."));
    return;
  }
  const trashSet = tabGamesMap[trashTabId] || new Set();
  if (trashSet.size === 0) {
    showToast(t("Reprovados está vazio."));
    return;
  }
  // Confirmação
  const confirmMsg = `${t("Confirmar limpeza do lixo?")} (${trashSet.size} ${t("jogos")})`;
  if (!confirm(confirmMsg)) return;

  try {
    await saveTabGames(trashTabId, new Set());
    showToast(t("Reprovados limpo!"));
  } catch (err) {
    console.error("[clearTrash] erro:", err);
    showToast(t("Erro ao limpar Reprovados."));
  }
});

// ─────────────────────────────────────────────
//  ADMIN — Search IGDB
// ─────────────────────────────────────────────
let searchDebounce = null;
const SEARCH_DEBOUNCE_MS = 350;

$adminSearch.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    clearTimeout(searchDebounce);
    doSearch();
  }
});

$adminSearch.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  const term = $adminSearch.value.trim();
  if (!term) {
    $adminResults.classList.add("hidden");
    $adminResults.innerHTML = "";
    return;
  }
  searchDebounce = setTimeout(doSearch, SEARCH_DEBOUNCE_MS);
});

$adminSearchBtn.addEventListener("click", () => {
  clearTimeout(searchDebounce);
  doSearch();
});

async function doSearch() {
  const term = $adminSearch.value.trim();
  if (!term) return;

  $adminResults.classList.remove("hidden");
  $adminResults.innerHTML = `
    <div class="search-loading">
      <div class="loading-spinner"></div>
      ${escHtml(t("A pesquisar..."))}
    </div>`;

  try {
    const results = await searchGames(term);

    if (!results || results.length === 0) {
      $adminResults.innerHTML = `<div class="search-loading">${escHtml(t("Nenhum resultado encontrado."))}</div>`;
      return;
    }

    const alreadyAdded = new Set(gamesData.map(g => g.igdbId));

    $adminResults.innerHTML = results.map(game => {
      const cover = coverUrl(game.cover?.url);
      const year  = game.first_release_date
        ? new Date(game.first_release_date * 1000).getFullYear()
        : "";
      const added = alreadyAdded.has(game.id);

      return `
        <div class="search-result-item">
          ${cover
            ? `<img class="search-result-cover" src="${escHtml(cover)}" alt="" loading="lazy"/>`
            : `<div class="search-result-cover" style="background:var(--surface2)"></div>`}
          <div class="search-result-info">
            <div class="search-result-name">${escHtml(game.name)}</div>
            <div class="search-result-year">${year}</div>
          </div>
          <button class="search-result-add${added ? " added" : ""}"
                  data-igdb="${game.id}"
                  ${added ? "disabled" : ""}>
            ${added ? t("✓ Adicionado") : t("+ Adicionar")}
          </button>
        </div>
      `;
    }).join("");

    // Attach add buttons
    $adminResults.querySelectorAll(".search-result-add:not(.added)").forEach(btn => {
      btn.addEventListener("click", () => addGame(parseInt(btn.dataset.igdb), btn));
    });

  } catch(err) {
    console.error(err);
    $adminResults.innerHTML = `<div class="search-loading" style="color:#ff9a9a">${escHtml(t("Erro ao pesquisar. Verifica as credenciais IGDB."))}</div>`;
  }
}

// ─────────────────────────────────────────────
//  ADMIN — Add / Remove games
// ─────────────────────────────────────────────
async function addGame(igdbId, btn) {
  btn.disabled = true;
  btn.textContent = t("A adicionar...");

  try {
    await addDoc(collection(db, "games"), {
      igdbId,
      addedAt: serverTimestamp(),
    });
    btn.textContent = t("✓ Adicionado");
    btn.classList.add("added");
    // OTIMIZAÇÃO: não chamar clearCache() — o onSnapshot do Firebase vai
    // disparar e o listenToGames busca só o jogo novo ao IGDB. Os outros
    // jogos continuam válidos no cache (dados IGDB não mudam ao adicionar).
    showStatus(t("Jogo adicionado com sucesso!"), "success");
  } catch(err) {
    console.error(err);
    btn.disabled = false;
    btn.textContent = t("+ Adicionar");
    showStatus(t("Erro ao adicionar jogo."), "error");
  }
}

async function removeGame(firebaseId) {
  try {
    await deleteDoc(doc(db, "games", firebaseId));
    // OTIMIZAÇÃO: não chamar clearCache() — o onSnapshot do Firebase vai
    // disparar com a lista atualizada (sem o jogo removido). Os outros jogos
    // continuam válidos no cache.
    showStatus(t("Jogo removido."), "success");
  } catch(err) {
    console.error(err);
    showStatus(t("Erro ao remover jogo."), "error");
  }
}

// ─────────────────────────────────────────────
//  HEADER SEARCH — pesquisa de jogos (após registo)
//  Mostra primeiro jogos já na lista (fuzzy match),
//  depois resultados do IGDB em tempo real.
//  Permite adicionar jogos → vão para "all" + tab do user.
// ─────────────────────────────────────────────
let headerSearchDebounce = null;
const HEADER_SEARCH_DEBOUNCE_MS = 350;

function initHeaderSearch() {
  const $input = document.getElementById("header-search-input");
  const $btn = document.getElementById("header-search-btn");
  const $results = document.getElementById("header-search-results");
  const $wrap = document.getElementById("header-search-wrap");

  if (!$input) return;

  // Click no botão de pesquisa
  if ($btn) {
    $btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!currentUser) {
        showToast(t("Regista-te primeiro para pesquisar."));
        return;
      }
      doHeaderSearch();
    });
  }

  // Click no input desabilitado → avisa para se registar
  $input.addEventListener("click", () => {
    if (!currentUser) {
      showToast(t("Regista-te primeiro para pesquisar."));
    }
  });
  // Click no wrap (área da pesquisa) → também avisa
  if ($wrap) {
    $wrap.addEventListener("click", (e) => {
      if (!currentUser && e.target !== $input) {
        // Só mostra se não foi click no input (que já tem o seu handler)
        // Actually, deixar o handler do input tratar — mas para o botão já tratado acima
      }
    });
  }

  // Input com debounce (só funciona se registado)
  $input.addEventListener("input", () => {
    if (!currentUser) {
      showToast(t("Regista-te primeiro para pesquisar."));
      $input.value = "";
      return;
    }
    clearTimeout(headerSearchDebounce);
    const term = $input.value.trim();
    if (!term) {
      $results.classList.add("hidden");
      $results.innerHTML = "";
      return;
    }
    headerSearchDebounce = setTimeout(doHeaderSearch, HEADER_SEARCH_DEBOUNCE_MS);
  });

  // Enter para pesquisar
  $input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      clearTimeout(headerSearchDebounce);
      doHeaderSearch();
    }
    if (e.key === "Escape") {
      $results.classList.add("hidden");
      $input.blur();
    }
  });

  // Fecha resultados ao clicar fora
  document.addEventListener("click", (e) => {
    const wrap = document.getElementById("header-search-wrap");
    if (wrap && !wrap.contains(e.target)) {
      $results.classList.add("hidden");
    }
  });

  // Fecha resultados ao fazer scroll — mas APENAS quando o rato NÃO está
  // sobre a área de pesquisa (input + botão + dropdown de resultados).
  // Isto permite ao utilizador fazer scroll dentro do dropdown de resultados
  // sem que este se feche, mantendo o comportamento de fechar ao navegar
  // na página quando a pesquisa não está a ser usada.
  let _searchScrollClosed = false;
  let _mouseOverSearch = false;

  if ($wrap) {
    $wrap.addEventListener("mouseenter", () => { _mouseOverSearch = true; });
    $wrap.addEventListener("mouseleave", () => { _mouseOverSearch = false; });
  }

  window.addEventListener("scroll", () => {
    if (!_mouseOverSearch && !$results.classList.contains("hidden")) {
      $results.classList.add("hidden");
      _searchScrollClosed = true;
    }
  }, { passive: true, capture: true });

  // ── Scroll containment no dropdown de resultados ──
  // Impede o "scroll chaining": quando o utilizador faz scroll dentro do
  // dropdown e chega ao limite (topo ou fundo), o scroll NÃO propaga para
  // a página. Reutiliza trapScroll() (partilhado com notificações e settings).
  if ($results) {
    trapScroll($results);
  }

  // Reabre os resultados ao focar o input — se ainda houver texto escrito,
  // re-executa a pesquisa automaticamente. Isto funciona para qualquer caso
  // onde os resultados foram fechados (scroll, click fora, etc.), mantendo
  // o texto no input para que o utilizador não tenha de reescrever.
  $input.addEventListener("focus", () => {
    _searchScrollClosed = false; // reset do flag em qualquer caso
    if ($input.value.trim() && $results.classList.contains("hidden")) {
      doHeaderSearch();
    }
  });
}

async function doHeaderSearch() {
  if (!currentUser) {
    showToast(t("Regista-te primeiro para pesquisar."));
    return;
  }

  const $input = document.getElementById("header-search-input");
  const $results = document.getElementById("header-search-results");
  const term = $input.value.trim();
  if (!term) {
    $results.classList.add("hidden");
    return;
  }

  $results.classList.remove("hidden");
  $results.innerHTML = `<div class="header-search-loading"><div class="loading-spinner"></div>${escHtml(t("A pesquisar..."))}</div>`;

  // 1. Procura jogos já na lista (fuzzy match)
  const localMatches = gamesData.filter(g => fuzzyMatchGame(term, g));

  let localHtml = "";
  if (localMatches.length > 0) {
    localHtml = `<div class="search-section-label">${escHtml(t("Já na lista"))}</div>`;
    localHtml += localMatches.map(game => {
      const cover = game.cover || "";
      const year = game.year || "";
      return `
        <div class="header-search-result-item" data-game-idx="${gamesData.indexOf(game)}">
          ${cover
            ? `<img class="header-search-result-cover" src="${escHtml(cover)}" alt="" loading="lazy"/>`
            : `<div class="header-search-result-cover" style="background:var(--surface2)"></div>`}
          <div class="header-search-result-info">
            <div class="header-search-result-name">${escHtml(game.name)}</div>
            ${year ? `<div class="header-search-result-year">${year}</div>` : ""}
          </div>
          <span class="header-search-result-badge">${escHtml(t("Já na lista"))}</span>
        </div>
      `;
    }).join("");
  }

  // 2. Procura no IGDB em tempo real
  let igdbHtml = "";
  try {
    const results = await searchGames(term);
    if (results && results.length > 0) {
      const alreadyAdded = new Set(gamesData.map(g => g.igdbId));
      igdbHtml = `<div class="search-section-label">IGDB</div>`;
      igdbHtml += results.map(game => {
        const cover = coverUrl(game.cover?.url);
        const year = game.first_release_date
          ? new Date(game.first_release_date * 1000).getFullYear()
          : "";
        const added = alreadyAdded.has(game.id);
        return `
          <div class="header-search-result-item">
            ${cover
              ? `<img class="header-search-result-cover" src="${escHtml(cover)}" alt="" loading="lazy"/>`
              : `<div class="header-search-result-cover" style="background:var(--surface2)"></div>`}
            <div class="header-search-result-info">
              <div class="header-search-result-name">${escHtml(game.name)}</div>
              ${year ? `<div class="header-search-result-year">${year}</div>` : ""}
            </div>
            <button class="header-search-result-add${added ? " added" : ""}"
                    data-igdb="${game.id}"
                    ${added ? "disabled" : ""}
                    aria-label="${escHtml(t("+ Adicionar"))}"
                    title="${escHtml(t("+ Adicionar"))}">
              ${added
                ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
                : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`
              }
            </button>
          </div>
        `;
      }).join("");
    }
  } catch (err) {
    console.error("[headerSearch] IGDB erro:", err);
    igdbHtml = `<div class="header-search-loading" style="color:#ff9a9a">${escHtml(t("Nenhum resultado."))}</div>`;
  }

  if (!localHtml && !igdbHtml) {
    $results.innerHTML = `<div class="header-search-loading">${escHtml(t("Nenhum resultado."))}</div>`;
    return;
  }

  $results.innerHTML = localHtml + igdbHtml;

  // Click em "Já na lista" → abre o modal do jogo
  $results.querySelectorAll(".header-search-result-item[data-game-idx]").forEach(item => {
    item.addEventListener("click", () => {
      const idx = parseInt(item.dataset.gameIdx);
      $results.classList.add("hidden");
      $input.value = "";
      openModal(idx);
    });
  });

  // Click em "Adicionar" (IGDB)
  $results.querySelectorAll(".header-search-result-add:not(.added)").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const igdbId = parseInt(btn.dataset.igdb);
      btn.disabled = true;
      // Mostra spinner enquanto adiciona
      btn.innerHTML = `<svg class="header-search-add-spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`;
      const success = await addGameForUser(igdbId);
      if (success) {
        btn.classList.add("added");
        // Ícone de checkmark
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
      } else {
        btn.disabled = false;
        // Restaura ícone "+"
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
      }
    });
  });
}

// Verifica se um jogo do IGDB tem multiplayer online.
// Procura em game_modes, genres, themes e keywords por menções a online/multiplayer/co-op.
function hasOnlinePlay(igdbGame) {
  if (!igdbGame) return false;

  const modes = (igdbGame.game_modes || []).map(m => (m.name || "").toLowerCase());
  const genres = (igdbGame.genres || []).map(g => (g.name || "").toLowerCase());
  const themes = (igdbGame.themes || []).map(t => (t.name || "").toLowerCase());
  const keywords = (igdbGame.keywords || []).map(k => (k.name || "").toLowerCase());
  const summary = (igdbGame.summary || "").toLowerCase();

  // Termos que indicam online play
  const onlineTerms = [
    "multiplayer", "co-op", "cooperative", "cooperative",
    "online", "massively multiplayer", "mmo",
    "battle royale", "pvp", "versus",
    "split screen", "cross-platform", "cross-platform multiplayer",
    "online co-op", "online multiplayer", "multi-player",
  ];

  // Procura em game_modes (mais fiável)
  const modeMatch = modes.some(m =>
    onlineTerms.some(term => m.includes(term))
  );
  if (modeMatch) return true;

  // Procura em genres
  const genreMatch = genres.some(g =>
    onlineTerms.some(term => g.includes(term))
  );
  if (genreMatch) return true;

  // Procura em themes
  const themeMatch = themes.some(th =>
    onlineTerms.some(term => th.includes(term))
  );
  if (themeMatch) return true;

  // Procura em keywords
  const keywordMatch = keywords.some(k =>
    onlineTerms.some(term => k.includes(term))
  );
  if (keywordMatch) return true;

  // Procura no summary (último recurso — menos fiável)
  const summaryMatch = onlineTerms.some(term => summary.includes(term));
  if (summaryMatch) return true;

  return false;
}

// Adiciona um jogo do IGDB → "all" (games collection) + tab do user
// Antes de adicionar, verifica se o jogo tem online play.
async function addGameForUser(igdbId) {
  if (!currentUser) {
    showToast(t("Regista-te primeiro para pesquisar."));
    return false;
  }
  try {
    // 1. Busca os dados completos do jogo no IGDB para verificar online play
    const igdbGame = await fetchGameById(igdbId);
    if (!igdbGame) {
      showToast(t("Jogo não encontrado."));
      return false;
    }

    // 2. Verifica se tem online play
    if (!hasOnlinePlay(igdbGame)) {
      showToast(
        `${t("Jogo rejeitado:")} ${igdbGame.name}\n${t("Apenas jogos com online play são permitidos.")}`,
        5000
      );
      return false;
    }

    // 3. Adiciona à colecção "games" (aparece em "all").
    //    Aproveita o fetch IGDB já feito para extrair e persistir o steamAppId
    //    — evita um backfill posterior.
    const steam = steamUrl(igdbGame.websites);
    await addDoc(collection(db, "games"), {
      igdbId,
      addedAt: serverTimestamp(),
      addedBy: currentUser.name,
      steamAppId: steamAppId(steam) || null,
    });

    // 4. Up-vote automático do user que adicionou.
    //    O up-vote fará com que o jogo apareça na tab do user
    //    (processado pelo listener de upvotes).
    pendingUpvotes.push({ igdbId, userId: currentUser.id, userName: currentUser.name });

    // OTIMIZAÇÃO: não chamar clearCache() — o onSnapshot do Firebase busca só
    // o jogo novo. Outros jogos mantêm-se válidos no cache.
    showToast(t("Jogo adicionado!"));
    return true;
  } catch (err) {
    console.error("[addGameForUser] erro:", err);
    showToast(t("Erro ao adicionar."));
    return false;
  }
}

// Fila de up-votes pendentes: quando um user adiciona um jogo,
// precisamos do firebaseId (que só vem no snapshot) para fazer up-vote.
// O up-vote adiciona automaticamente o jogo à tab do user.
const pendingUpvotes = [];

// Processa up-votes pendentes após cada snapshot de games
function processPendingUpvotes() {
  if (pendingUpvotes.length === 0) return;
  const remaining = [];
  for (const pending of pendingUpvotes) {
    const game = gamesData.find(g => g.igdbId === pending.igdbId);
    if (game && game.firebaseId) {
      // Faz up-vote (adiciona à colecção "upvotes")
      addDoc(collection(db, "upvotes"), {
        gameId: game.firebaseId,
        userId: pending.userId,
        userName: pending.userName,
        createdAt: serverTimestamp(),
      }).catch(err => console.error("[pendingUpvotes] erro:", err));

      // ⚠️ Adiciona o jogo à tab do user (igual ao toggleUpvote)
      // Encontra o user para obter o tabId
      const user = allUsers.find(u => u.id === pending.userId);
      if (user && user.tabId) {
        const set = new Set(tabGamesMap[user.tabId] || []);
        set.add(game.firebaseId);
        saveTabGames(user.tabId, set);
      }
    } else {
      // Ainda não chegou — mantém na fila
      remaining.push(pending);
    }
  }
  pendingUpvotes.length = 0;
  pendingUpvotes.push(...remaining);
}

// ─────────────────────────────────────────────
//  REGISTRATION UI — flow do botão "Regista-te"
// ─────────────────────────────────────────────
function initRegisterButton() {
  const $btn = document.getElementById("register-btn");
  const $input = document.getElementById("register-input");

  if (!$btn || !$input) return;

  // Flag anti-duplo-submit: enquanto um registo está em curso,
  // ignora novos Enter/clicks para não criar duplicados.
  let registering = false;

  // Click no botão "Regista-te" → mostra input
  $btn.addEventListener("click", () => {
    if (currentUser) return; // já registado — não faz nada
    if (registering) return;
    $btn.style.display = "none";
    $input.classList.remove("hidden");
    $input.value = "";
    $input.focus();
  });

  // Enter no input → regista
  $input.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (registering) return; // já em curso — ignora
      const name = $input.value.trim();
      if (!name) {
        $input.classList.add("hidden");
        $btn.style.display = "";
        return;
      }
      registering = true;
      $input.disabled = true;
      const success = await registerUser(name);
      registering = false;
      if (!success) {
        // Falha — volta a mostrar o botão e habilita input
        $input.disabled = false;
        $input.classList.add("hidden");
        $btn.style.display = "";
      }
      // Em caso de sucesso, updateUserUI() já esconde o input e mostra o nome
    }
    if (e.key === "Escape") {
      if (registering) return;
      $input.classList.add("hidden");
      $btn.style.display = "";
    }
  });

  // Blur sem texto → volta ao botão
  $input.addEventListener("blur", () => {
    setTimeout(() => {
      if (!$input.value.trim()) {
        $input.classList.add("hidden");
        $btn.style.display = "";
      }
    }, 200);
  });
}

// ─────────────────────────────────────────────
//  ACCOUNT — editar nome no settings menu
// ─────────────────────────────────────────────
function initAccountEdit() {
  const $input = document.getElementById("account-name-input");
  const $btn = document.getElementById("account-save-btn");

  if (!$input || !$btn) return;

  $btn.addEventListener("click", async () => {
    const newName = $input.value.trim();
    if (!newName) return;
    $btn.disabled = true;
    $btn.textContent = "...";
    await editUserName(newName);
    $btn.disabled = false;
    $btn.textContent = t("Guardar");
  });

  $input.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      $btn.click();
    }
  });
}

// ─────────────────────────────────────────────
//  ADMIN — Key Art Picker (preferência global, gravada no Firestore)
// ─────────────────────────────────────────────
function openKeyArtPicker(game) {
  const candidates = [];
  const seen = new Set();
  const pushAll = (arr) => (arr || []).forEach(url => {
    if (url && !seen.has(url)) { seen.add(url); candidates.push(url); }
  });

  pushAll(game.artworks);
  pushAll(game.screenshots);
  if (game.cover && !seen.has(game.cover)) candidates.push(game.cover);

  const current = game.preferredKeyArt
    || (game.artworks && game.artworks[0])
    || (game.screenshots && game.screenshots[0])
    || game.cover;

  $keyartTitle.textContent = `Key Art — ${game.name}`;

  if (candidates.length === 0) {
    $keyartGrid.innerHTML = `<div class="keyart-empty">${escHtml(t("Sem imagens disponíveis."))}</div>`;
  } else {
    $keyartGrid.innerHTML = candidates.map(url => `
      <button class="keyart-thumb${url === current ? " selected" : ""}" data-url="${escHtml(url)}">
        <img src="${escHtml(url)}" alt="" loading="lazy"/>
      </button>
    `).join("");

    $keyartGrid.querySelectorAll(".keyart-thumb").forEach(btn => {
      btn.addEventListener("click", () => setPreferredKeyArt(game, btn.dataset.url));
    });
  }

  $keyartModal.classList.remove("hidden");
}

function closeKeyArtPicker() {
  $keyartModal.classList.add("hidden");
  $keyartGrid.innerHTML = "";
}

async function setPreferredKeyArt(game, url) {
  try {
    await updateDoc(doc(db, "games", game.firebaseId), { preferredKeyArt: url });
    game.preferredKeyArt = url;
    // OTIMIZAÇÃO: saveCache re-escreve o cache com dados atualizados.
    // clearCache() era redundante (logo a seguir saveCache re-popula).
    saveCache(gamesData);
    closeKeyArtPicker();
    renderGameList(gamesData);
    showStatus(t("Key art atualizada."), "success");
  } catch(err) {
    console.error(err);
    showStatus(t("Erro ao atualizar key art."), "error");
  }
}

$keyartClose.addEventListener("click", closeKeyArtPicker);
$keyartBackdrop.addEventListener("click", closeKeyArtPicker);
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !$keyartModal.classList.contains("hidden")) closeKeyArtPicker();
});

// ─────────────────────────────────────────────
//  ADMIN — Render list
// ─────────────────────────────────────────────
function renderAdminList(games) {
  if (games.length === 0) {
    $adminGameList.innerHTML = `<div class="admin-empty">${escHtml(t("Nenhum jogo adicionado ainda."))}</div>`;
    return;
  }

  $adminGameList.innerHTML = games.map(game => `
    <div class="admin-game-item">
      ${game.cover
        ? `<img class="admin-game-cover" src="${escHtml(game.cover)}" alt="" loading="lazy"/>`
        : `<div class="admin-game-cover" style="background:var(--surface2);border-radius:4px"></div>`}
      <span class="admin-game-name">${escHtml(game.name)}</span>
      <button class="admin-game-remove" data-fbid="${escHtml(game.firebaseId)}">${escHtml(t("Remover"))}</button>
    </div>
  `).join("");

  $adminGameList.querySelectorAll(".admin-game-remove").forEach(btn => {
    btn.addEventListener("click", () => {
      const name = btn.closest(".admin-game-item").querySelector(".admin-game-name").textContent;
      const confirmMsg = `${t("Remover")} "${name}"?`;
      if (confirm(confirmMsg)) {
        removeGame(btn.dataset.fbid);
      }
    });
  });
}

// ─────────────────────────────────────────────
//  STATUS MESSAGES
// ─────────────────────────────────────────────
let statusTimer = null;

function showStatus(msg, type = "success") {
  $adminStatus.textContent = msg;
  $adminStatus.className = `admin-status ${type}`;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => hideStatus(), 3000);
}

function hideStatus() {
  $adminStatus.className = "admin-status hidden";
}

// ─────────────────────────────────────────────
//  UTILS
// ─────────────────────────────────────────────
function escHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ─────────────────────────────────────────────
//  TABS — Persistence (Firestore, global)
//  Colecções: "tabs" (lista) e "tabGames" (atribuições)
// ─────────────────────────────────────────────

// Listener em tempo real das tabs — actualiza tabsData e re-renderiza
function listenToTabs() {
  const q = query(collection(db, "tabs"), orderBy("createdAt", "asc"));
  onSnapshot(q, (snapshot) => {
    tabsData = snapshot.docs.map(d => ({ id: d.id, label: d.data().label }));
    renderTabs();
    renderGameList(gamesData);
  });
}

// Listener em tempo real das atribuições tab→jogos
function listenToTabGames() {
  onSnapshot(collection(db, "tabGames"), (snapshot) => {
    tabGamesMap = {};
    snapshot.docs.forEach(d => {
      tabGamesMap[d.id] = new Set(d.data().gameIds || []);
    });
    // Encontra a tab "Reprovados" (se existir)
    const trashTab = tabsData.find(t => isTrashLabel(t.label));
    trashTabId = trashTab ? trashTab.id : null;
    // Encontra a tab "Aprovados" (se existir)
    const approvedTab = tabsData.find(t => isApprovedLabel(t.label));
    approvedTabId = approvedTab ? approvedTab.id : null;
    // Encontra a tab "Jogados" (se existir)
    const playedTab = tabsData.find(t => isPlayedLabel(t.label));
    playedTabId = playedTab ? playedTab.id : null;

    // ⚠️  Sincroniza hiddenGames com a tab "Jogados" do Firebase.
    //    Jogos marcados como jogados (por qualquer utilizador, noutro dispositivo
    //    ou sessão) devem estar escondidos da lista principal localmente.
    //    Só adiciona (nunca remove via sync — a remoção é feita explicitamente
    //    pelo unmarkAsPlayed ou pelo toggleDownvote quando revertido).
    //    Isto evita race conditions com o carregamento dos downvotes.
    if (playedTabId) {
      const playedSet = tabGamesMap[playedTabId] || new Set();
      let hiddenChanged = false;
      playedSet.forEach(fbid => {
        if (!hiddenGames.has(fbid)) {
          hiddenGames.add(fbid);
          hiddenChanged = true;
        }
      });
      if (hiddenChanged) saveHiddenGames();
    }

    renderTabs();
    renderGameList(gamesData);
    // ⚠️  Processa thresholds após actualizar trashTabId — resolve race condition
    // onde listenToDownvotes corre antes de trashTabId estar definido.
    processDownvoteThresholds();
  });
}

// ─────────────────────────────────────────────
//  DOWNVOTES — Listener em tempo real
//  Coleção "downvotes": { gameId, userId, userName, createdAt }
//  Quando um jogo atinge DOWNVOTE_THRESHOLD (2) down-votes,
//  é movido para a tab "Lixo" (criada automaticamente se não existir).
// ─────────────────────────────────────────────
function listenToDownvotes() {
  if (!db) return;
  // Snapshot anterior de downvotes para deteção de novos votos
  // Estrutura: { [docId]: { gameId, userId, userName } }
  let prevDownvoteDocs = {};

  onSnapshot(collection(db, "downvotes"), (snapshot) => {
    downvotesMap = {};
    const currDownvoteDocs = {};
    const newDownvotes = []; // votos novos desde o último snapshot

    snapshot.docs.forEach(d => {
      const data = d.data();
      if (!data.gameId) return;
      const voteInfo = {
        gameId: data.gameId,
        userId: data.userId || d.id,
        userName: data.userName || "",
      };
      currDownvoteDocs[d.id] = voteInfo;

      if (!downvotesMap[data.gameId]) downvotesMap[data.gameId] = new Set();
      downvotesMap[data.gameId].add(data.userId || d.id);

      // Se este voto não existia no snapshot anterior → é novo
      if (!prevDownvoteDocs[d.id]) {
        newDownvotes.push(voteInfo);
      }
    });

    // Verifica se algum jogo atingiu o threshold e deve ser movido para o lixo
    processDownvoteThresholds();
    renderGameList(gamesData);
    // Se o modal estiver aberto, actualiza os contadores
    if (modalOpen && _modalCurrentGame) {
      updateModalVoteButtons(_modalCurrentGame);
    }

    // ── Notificações de down-votes ──
    // Agrupa novos down-votes por jogo e notifica o utilizador atual
    // se o voto for num jogo que ELE adicionou (addedBy === currentUser.name).
    // Ignora o próprio voto do utilizador (não notificar a si próprio).
    if (newDownvotes.length > 0 && Object.keys(prevDownvoteDocs).length > 0) {
      detectVoteNotifications(newDownvotes, "downvote");
    }

    prevDownvoteDocs = currDownvoteDocs;
  });
}

// Conta os down-votes de um jogo
function getDownvoteCount(firebaseId) {
  const set = downvotesMap[firebaseId];
  return set ? set.size : 0;
}

// Verifica se o user actual já votou contra este jogo
function hasUserDownvoted(firebaseId) {
  if (!currentUser) return false;
  const set = downvotesMap[firebaseId];
  return set ? set.has(currentUser.id) : false;
}

// Verifica se um jogo está no lixo (tem >= threshold down-votes)
function isInTrash(firebaseId) {
  return getDownvoteCount(firebaseId) >= DOWNVOTE_THRESHOLD;
}

// Adiciona ou remove um down-vote
async function toggleDownvote(firebaseId) {
  if (!currentUser) {
    showToast(t("Regista-te primeiro para votar."));
    return;
  }
  try {
    if (hasUserDownvoted(firebaseId)) {
      // Remove o down-vote existente
      const q = query(
        collection(db, "downvotes"),
        where("gameId", "==", firebaseId),
        where("userId", "==", currentUser.id)
      );
      const snap = await getDocs(q);
      for (const d of snap.docs) {
        await deleteDoc(doc(db, "downvotes", d.id));
      }
      // Remove o jogo da lista de escondidos (já não tem down-vote),
      // a menos que esteja marcado como "jogado" (que também o esconde)
      if (!isPlayed(firebaseId)) {
        hiddenGames.delete(firebaseId);
        saveHiddenGames();
      }
    } else {
      // ⚠️ Mutual exclusivity: ao dar down-vote, remove o up-vote se existir
      if (hasUserUpvoted(firebaseId)) {
        const uq = query(
          collection(db, "upvotes"),
          where("gameId", "==", firebaseId),
          where("userId", "==", currentUser.id)
        );
        const usnap = await getDocs(uq);
        for (const d of usnap.docs) {
          await deleteDoc(doc(db, "upvotes", d.id));
        }
        // ⚠️ Remove o jogo da tab do user (tinha up-vote → agora tem down-vote)
        if (currentUser.tabId) {
          const set = new Set(tabGamesMap[currentUser.tabId] || []);
          set.delete(firebaseId);
          await saveTabGames(currentUser.tabId, set);
        }
      }
      // Adiciona down-vote
      await addDoc(collection(db, "downvotes"), {
        gameId: firebaseId,
        userId: currentUser.id,
        userName: currentUser.name,
        createdAt: serverTimestamp(),
      });
      // ⚠️ Esconde o jogo localmente (só para este user)
      hiddenGames.add(firebaseId);
      saveHiddenGames();
    }
    // ⚠️ Força re-render final (depois de TODAS as operações async terminarem)
    renderGameList(gamesData);
    if (modalOpen && _modalCurrentGame) {
      updateModalVoteButtons(_modalCurrentGame);
    }
  } catch (err) {
    console.error("[toggleDownvote] erro:", err);
    showToast(t("Erro ao votar."));
  }
}

// ─────────────────────────────────────────────
//  UPVOTES — Listener em tempo real
//  Coleção "upvotes": { gameId, userId, userName, createdAt }
//  Os up-votes não movem jogos para lado nenhum — servem apenas
//  para ordenação (Mais votados / Menos votados) e exibição no modal.
// ─────────────────────────────────────────────
function listenToUpvotes() {
  if (!db) return;
  // Snapshot anterior de upvotes para deteção de novos votos
  let prevUpvoteDocs = {};

  onSnapshot(collection(db, "upvotes"), (snapshot) => {
    upvotesMap = {};
    const currUpvoteDocs = {};
    const newUpvotes = []; // votos novos desde o último snapshot

    snapshot.docs.forEach(d => {
      const data = d.data();
      if (!data.gameId) return;
      const voteInfo = {
        gameId: data.gameId,
        userId: data.userId || d.id,
        userName: data.userName || "",
      };
      currUpvoteDocs[d.id] = voteInfo;

      if (!upvotesMap[data.gameId]) upvotesMap[data.gameId] = new Set();
      upvotesMap[data.gameId].add(data.userId || d.id);

      // Se este voto não existia no snapshot anterior → é novo
      if (!prevUpvoteDocs[d.id]) {
        newUpvotes.push(voteInfo);
      }
    });
    // Processa jogos que devem ir para / sair da lista "Aprovados"
    processApprovedThresholds();
    renderGameList(gamesData);
    // Se o modal estiver aberto, actualiza os contadores
    if (modalOpen && _modalCurrentGame) {
      updateModalVoteButtons(_modalCurrentGame);
    }

    // ── Notificações de up-votes ──
    // Agrupa novos up-votes por jogo e notifica o utilizador atual
    // se o voto for num jogo que ELE adicionou (addedBy === currentUser.name).
    // Ignora o próprio voto do utilizador (não notificar a si próprio).
    if (newUpvotes.length > 0 && Object.keys(prevUpvoteDocs).length > 0) {
      detectVoteNotifications(newUpvotes, "upvote");
    }

    prevUpvoteDocs = currUpvoteDocs;
  });
}

// Verifica quais jogos têm exatamente APPROVED_UPVOTE_COUNT (3) upvotes
// e garante que estão na lista "Aprovados". Remove os que já não têm.
// Cria a lista "Aprovados" automaticamente se não existir.
async function processApprovedThresholds() {
  if (!db) return;

  // Garante que approvedTabId está actualizado (procura em tabsData)
  if (!approvedTabId) {
    const approvedTab = tabsData.find(t => isApprovedLabel(t.label));
    if (approvedTab) approvedTabId = approvedTab.id;
  }

  // Garante que a tab "Aprovados" existe (só cria se realmente não existir)
  if (!approvedTabId) {
    // Verificação dupla em tabsData para evitar criar duplicados
    const existing = tabsData.find(t => isApprovedLabel(t.label));
    if (existing) {
      approvedTabId = existing.id;
    } else {
      try {
        const ref = await addDoc(collection(db, "tabs"), {
          label: "Aprovados",
          createdAt: serverTimestamp(),
        });
        await setDoc(doc(db, "tabGames", ref.id), { gameIds: [] });
        approvedTabId = ref.id;
      } catch (err) {
        console.error("[processApprovedThresholds] erro ao criar tab:", err);
        return;
      }
    }
  }

  const approvedSet = tabGamesMap[approvedTabId] || new Set();
  let changed = false;
  const newSet = new Set(approvedSet);

  // 1. Adiciona jogos que têm exatamente 3 upvotes
  for (const [fbid, voters] of Object.entries(upvotesMap)) {
    if (voters.size === APPROVED_UPVOTE_COUNT) {
      if (!newSet.has(fbid)) {
        newSet.add(fbid);
        changed = true;
      }
    }
  }

  // 2. Remove jogos que já não têm exatamente 3 upvotes
  for (const fbid of approvedSet) {
    const count = getUpvoteCount(fbid);
    if (count !== APPROVED_UPVOTE_COUNT) {
      newSet.delete(fbid);
      changed = true;
    }
  }

  if (changed) {
    await saveTabGames(approvedTabId, newSet);
  }
}

function getUpvoteCount(firebaseId) {
  const set = upvotesMap[firebaseId];
  return set ? set.size : 0;
}

function hasUserUpvoted(firebaseId) {
  if (!currentUser) return false;
  const set = upvotesMap[firebaseId];
  return set ? set.has(currentUser.id) : false;
}

// Devolve os nomes dos users que deram up-vote a um jogo
function getUpvoterNames(firebaseId) {
  const userIds = upvotesMap[firebaseId];
  if (!userIds) return [];
  return Array.from(userIds).map(uid => {
    const u = allUsers.find(usr => usr.id === uid);
    return u ? u.name : null;
  }).filter(Boolean);
}

// Devolve os nomes dos users que deram down-vote a um jogo
function getDownvoterNames(firebaseId) {
  const userIds = downvotesMap[firebaseId];
  if (!userIds) return [];
  return Array.from(userIds).map(uid => {
    const u = allUsers.find(usr => usr.id === uid);
    return u ? u.name : null;
  }).filter(Boolean);
}

// Adiciona ou remove um up-vote
async function toggleUpvote(firebaseId) {
  if (!currentUser) {
    showToast(t("Regista-te primeiro para votar."));
    return;
  }
  try {
    if (hasUserUpvoted(firebaseId)) {
      // Remove o up-vote existente
      const q = query(
        collection(db, "upvotes"),
        where("gameId", "==", firebaseId),
        where("userId", "==", currentUser.id)
      );
      const snap = await getDocs(q);
      for (const d of snap.docs) {
        await deleteDoc(doc(db, "upvotes", d.id));
      }
      // Remove o jogo da tab do user (já não tem up-vote)
      if (currentUser.tabId) {
        const set = new Set(tabGamesMap[currentUser.tabId] || []);
        set.delete(firebaseId);
        await saveTabGames(currentUser.tabId, set);
      }
    } else {
      // ⚠️ Mutual exclusivity: ao dar up-vote, remove o down-vote se existir
      if (hasUserDownvoted(firebaseId)) {
        const dq = query(
          collection(db, "downvotes"),
          where("gameId", "==", firebaseId),
          where("userId", "==", currentUser.id)
        );
        const dsnap = await getDocs(dq);
        for (const d of dsnap.docs) {
          await deleteDoc(doc(db, "downvotes", d.id));
        }
        // Remove o jogo da lista de escondidos (tinha down-vote → agora tem up-vote),
        // a menos que esteja marcado como "jogado" (que também o esconde)
        if (!isPlayed(firebaseId)) {
          hiddenGames.delete(firebaseId);
          saveHiddenGames();
        }
      }
      // Adiciona o up-vote
      await addDoc(collection(db, "upvotes"), {
        gameId: firebaseId,
        userId: currentUser.id,
        userName: currentUser.name,
        createdAt: serverTimestamp(),
      });
      // Adiciona o jogo à tab do user (up-vote = quer jogar)
      if (currentUser.tabId) {
        const set = new Set(tabGamesMap[currentUser.tabId] || []);
        set.add(firebaseId);
        await saveTabGames(currentUser.tabId, set);
      }
    }
    // ⚠️ Força re-render final (depois de TODAS as operações async terminarem)
    // para garantir que a lista reflecte o estado actual dos hiddenGames
    renderGameList(gamesData);
    if (modalOpen && _modalCurrentGame) {
      updateModalVoteButtons(_modalCurrentGame);
    }
  } catch (err) {
    console.error("[toggleUpvote] erro:", err);
    showToast(t("Erro ao votar."));
  }
}

// Apaga todos os up-votes de um user removido (cascade delete)
async function deleteUserUpvotes(userId) {
  if (!db) return;
  try {
    const q = query(
      collection(db, "upvotes"),
      where("userId", "==", userId)
    );
    const snap = await getDocs(q);
    const promises = snap.docs.map(d => deleteDoc(doc(db, "upvotes", d.id)));
    await Promise.all(promises);
    if (snap.size > 0) {
      console.log(`[cascade] Removidos ${snap.size} up-votes do user ${userId}`);
    }
  } catch (err) {
    console.error("[deleteUserUpvotes] erro:", err);
  }
}

// Verifica se algum jogo atingiu o threshold e deve ser movido para o lixo.
// ⚠️  NÃO cria a pasta lixo automaticamente — o admin tem de a criar
// manualmente através do botão no painel de testes (admin-tests-fab).
// Se não houver pasta lixo, os jogos continuam com down-votes mas
// não são movidos (aparecem apenas com o indicador vermelho).
async function processDownvoteThresholds() {
  if (!db) return;
  if (!trashTabId) return; // sem lixo → não processa

  // Cópia mutável do set actual do lixo
  let trashSet = new Set(tabGamesMap[trashTabId] || []);

  // 1. Move jogos que atingiram o threshold para o lixo
  let added = false;
  for (const [fbid, voters] of Object.entries(downvotesMap)) {
    if (voters.size >= DOWNVOTE_THRESHOLD) {
      if (trashSet.has(fbid)) continue;
      trashSet.add(fbid);
      added = true;
    }
  }
  if (added) {
    await saveTabGames(trashTabId, trashSet);
  }

  // 2. Remove do lixo jogos que já não têm threshold suficiente
  //    (alguém removeu o down-vote e o jogo voltou a ter < 2)
  if (trashSet.size > 0) {
    let removed = false;
    for (const fbid of [...trashSet]) {
      const count = getDownvoteCount(fbid);
      if (count < DOWNVOTE_THRESHOLD) {
        trashSet.delete(fbid);
        removed = true;
      }
    }
    if (removed || added) {
      await saveTabGames(trashTabId, trashSet);
    }
  }
}

// Cria a pasta "Reprovados" (chamada pelo botão no painel de testes do admin).
// Só funciona se o user for admin e se ainda não existir.
// ⚠️  Anti-duplicado: verifica tabsData E Firebase antes de criar.
async function createTrashTab() {
  if (!currentUser || !currentUser.isAdmin) {
    showToast(t("Apenas o admin pode criar Reprovados."));
    return;
  }

  // 1. Verifica em tabsData (estado local)
  const existingLocal = tabsData.find(t => isTrashLabel(t.label));
  if (existingLocal) {
    trashTabId = existingLocal.id;
    showToast(t("Reprovados já existe."));
    return;
  }

  // 2. Verifica no Firebase (para evitar duplicados se tabsData ainda não carregou)
  try {
    const snap = await getDocs(collection(db, "tabs"));
    const existingFb = snap.docs.find(d => {
      const label = d.data().label;
      return isTrashLabel(label);
    });
    if (existingFb) {
      trashTabId = existingFb.id;
      showToast(t("Reprovados já existe."));
      return;
    }
  } catch (e) {
    console.error("[createTrashTab] erro ao verificar Firebase:", e);
  }

  // 3. Cria a tab
  try {
    const trashRef = await addDoc(collection(db, "tabs"), {
      label: "Reprovados",
      createdAt: serverTimestamp(),
    });
    await setDoc(doc(db, "tabGames", trashRef.id), { gameIds: [] });
    trashTabId = trashRef.id;
    showToast(t("Reprovados criado!"));
    processDownvoteThresholds();
  } catch (err) {
    console.error("[createTrashTab] erro:", err);
    showToast(t("Erro ao criar Reprovados."));
  }
}

// ─────────────────────────────────────────────
//  TAB "JOGADOS" — jogos marcados como já jogados pelo grupo
//  Tab especial (como Reprovados/Aprovados): criada automaticamente,
//  não é apagável, e fica sempre acima de Reprovados na lista de tabs.
//  Marcar um jogo como jogado também o esconde da lista principal
//  (mesmo comportamento dos hidden games — só visível se o toggle
//  "Mostrar jogos escondidos" estiver activo, ou na própria tab Jogados).
// ─────────────────────────────────────────────

// Verifica se um jogo está marcado como jogado
function isPlayed(firebaseId) {
  if (!playedTabId) return false;
  const set = tabGamesMap[playedTabId];
  return set ? set.has(firebaseId) : false;
}

// Cria a tab "Jogados" no Firebase (se ainda não existir).
// Retorna o ID da tab (existente ou recém-criada).
async function ensurePlayedTab() {
  // 1. Já temos em memória?
  if (playedTabId) return playedTabId;

  // 2. Procura em tabsData (estado local)
  const existingLocal = tabsData.find(t => isPlayedLabel(t.label));
  if (existingLocal) {
    playedTabId = existingLocal.id;
    return playedTabId;
  }

  // 3. Procura no Firebase (evita duplicados se tabsData ainda não carregou)
  try {
    const snap = await getDocs(collection(db, "tabs"));
    const existingFb = snap.docs.find(d => {
      const label = d.data().label;
      return isPlayedLabel(label);
    });
    if (existingFb) {
      playedTabId = existingFb.id;
      return playedTabId;
    }
  } catch (e) {
    console.error("[ensurePlayedTab] erro ao verificar Firebase:", e);
  }

  // 4. Cria a tab
  try {
    const playedRef = await addDoc(collection(db, "tabs"), {
      label: "Jogados",
      createdAt: serverTimestamp(),
    });
    await setDoc(doc(db, "tabGames", playedRef.id), { gameIds: [] });
    playedTabId = playedRef.id;
    return playedTabId;
  } catch (err) {
    console.error("[ensurePlayedTab] erro:", err);
    showToast(t("Erro ao criar Jogados."));
    return null;
  }
}

// Marca um jogo como jogado: adiciona à tab "Jogados" + esconde localmente
async function markAsPlayed(firebaseId) {
  if (!firebaseId) return;
  const tabId = await ensurePlayedTab();
  if (!tabId) return;

  const set = new Set(tabGamesMap[tabId] || []);
  if (set.has(firebaseId)) return; // já está marcado
  set.add(firebaseId);
  await saveTabGames(tabId, set);

  // Esconde o jogo da lista principal (igual ao comportamento de down-vote)
  hiddenGames.add(firebaseId);
  saveHiddenGames();

  showToast(t("Marcado como jogado."));
  renderGameList(gamesData);
}

// Remove um jogo do estado "jogado": remove da tab "Jogados" + mostra novamente
async function unmarkAsPlayed(firebaseId) {
  if (!firebaseId || !playedTabId) return;

  const set = new Set(tabGamesMap[playedTabId] || []);
  if (!set.has(firebaseId)) return; // não estava marcado
  set.delete(firebaseId);
  await saveTabGames(playedTabId, set);

  // Mostra o jogo novamente na lista principal
  hiddenGames.delete(firebaseId);
  saveHiddenGames();

  showToast(t("Jogo revertido."));
  renderGameList(gamesData);
}

async function createTab(label) {
  try {
    await addDoc(collection(db, "tabs"), {
      label,
      createdAt: serverTimestamp(),
    });
    // O listener onSnapshot actualiza tabsData e re-renderiza automaticamente
  } catch(e) {
    console.error("Erro ao criar tab:", e);
    showStatus(t("Erro ao criar tab."), "error");
  }
}

async function deleteTab(id) {
  try {
    await deleteDoc(doc(db, "tabs", id));
    await deleteDoc(doc(db, "tabGames", id));
    if (activeTab === id) activeTab = "all";
    // O listener onSnapshot trata do re-render
  } catch(e) {
    console.error("Erro ao apagar tab:", e);
    showStatus(t("Erro ao apagar tab."), "error");
  }
}

async function saveTabGames(tabId, gameIdsSet) {
  try {
    await setDoc(doc(db, "tabGames", tabId), {
      gameIds: [...gameIdsSet],
    });
  } catch(e) {
    console.error("Erro ao guardar jogos da tab:", e);
    showStatus(t("Erro ao guardar jogos da tab:"), "error");
  }
}

// ─────────────────────────────────────────────
//  TABS — Render
// ─────────────────────────────────────────────
function renderTabs() {
  // Opções do menu: "Todos" + tabs criadas
  // Ordenação: "Aprovados" em 2º (sempre abaixo de Todos), "Jogados" acima de
  // "Reprovados", "Reprovados" em último.
  const sortedTabs = [...tabsData].sort((a, b) => {
    const aIsApproved = isApprovedLabel(a.label) ? 1 : 0;
    const bIsApproved = isApprovedLabel(b.label) ? 1 : 0;
    const aIsPlayed = isPlayedLabel(a.label) ? 1 : 0;
    const bIsPlayed = isPlayedLabel(b.label) ? 1 : 0;
    const aIsTrash = isTrashLabel(a.label) ? 1 : 0;
    const bIsTrash = isTrashLabel(b.label) ? 1 : 0;

    // Aprovados tem prioridade 0 (vem primeiro entre as tabs)
    // Outras tabs têm prioridade 1
    // Jogados tem prioridade 2 (acima do lixo)
    // Lixo tem prioridade 3 (vem sempre em último)
    const aPriority = aIsTrash ? 3 : (aIsPlayed ? 2 : (aIsApproved ? 0 : 1));
    const bPriority = bIsTrash ? 3 : (bIsPlayed ? 2 : (bIsApproved ? 0 : 1));
    if (aPriority !== bPriority) return aPriority - bPriority;
    return 0; // mantém ordem original (createdAt)
  });

  const options = [
    { id: "all", label: t("Todos"), count: gamesData.filter(g => !isInTrash(g.firebaseId) && !hiddenGames.has(g.firebaseId)).length, deletable: false },
    ...sortedTabs.map(tab => {
      const set = tabGamesMap[tab.id] || new Set();
      const isTrash = isTrashLabel(tab.label);
      const isApproved = isApprovedLabel(tab.label);
      const isPlayedTab = isPlayedLabel(tab.label);
      return {
        id: tab.id,
        label: isTrash ? t("Reprovados") : (isApproved ? t("Aprovados") : (isPlayedTab ? t("Jogados") : tab.label)),
        count: gamesData.filter(g => set.has(g.firebaseId)).length,
        deletable: !isTrash && !isApproved && !isPlayedTab, // lixo, aprovados e jogados não são apagáveis
      };
    }),
    // Pseudo-tab "Escondidos" — client-side, não está no Firebase.
    // Fica sempre em último (abaixo de Reprovados). Só aparece se o
    // utilizador estiver logado. Mostra apenas jogos que o utilizador
    // deu down-vote (verificado via Firebase downvotesMap, não localStorage
    // que pode ter lixo acumulado). NÃO inclui jogos marcados como jogados.
    // Reprovados é global (>= 2 down-votes); Escondidos é pessoal (down-votes do próprio).
    ...(currentUser ? [{
      id: "escondidos",
      label: t("Escondidos"),
      count: gamesData.filter(g => hasUserDownvoted(g.firebaseId) && !isPlayed(g.firebaseId)).length,
      deletable: false,
    }] : []),
  ];

  const activeOption = options.find(o => o.id === activeTab) || options[0];

  // Trigger (pill activa)
  $tabsDropdownLabel.textContent = activeOption.label;
  $tabsDropdownCount.textContent = activeOption.count;

  // Menu — todas as opções (incluindo a activa, para se poder ver o contexto)
  $tabsDropdownMenu.innerHTML = options.map(opt => `
    <div class="tabs-dropdown-item${opt.id === activeTab ? " active" : ""}" data-tabid="${escHtml(opt.id)}" role="option" tabindex="0" aria-selected="${opt.id === activeTab}">
      <span class="tabs-dropdown-item-label">${escHtml(opt.label)}</span>
      <span class="tab-count">${opt.count}</span>
      ${opt.deletable ? `
        <button class="tab-delete" data-tabid="${escHtml(opt.id)}" aria-label="${escHtml(t("Apagar tab"))}" title="${escHtml(t("Apagar tab"))}" tabindex="-1">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      ` : ""}
    </div>
  `).join("");

  // Selecionar tab
  $tabsDropdownMenu.querySelectorAll(".tabs-dropdown-item").forEach(item => {
    item.addEventListener("click", e => {
      if (e.target.closest(".tab-delete")) return;
      activeTab = item.dataset.tabid;
      // Reset tag/status filters when switching tabs
      activeTagFilters.clear();
      activeStatusFilters.clear();
      renderTagFilter();
      $tabsDropdown.classList.remove("open");
      renderTabs();
      renderGameList(gamesData);
    });
  });

  // Apagar tab (apenas visível em modo admin via CSS)
  $tabsDropdownMenu.querySelectorAll(".tab-delete").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const tabLabel = tabsData.find(tt => tt.id === btn.dataset.tabid)?.label || "";
      const confirmMsg = tf("Apagar a tab \"{0}\"?", tabLabel);
      if (confirm(confirmMsg)) {
        deleteTab(btn.dataset.tabid);
      }
    });
  });
}

// ─────────────────────────────────────────────
//  TABS — Dropdown open/close (clique, para touch/teclado;
//  o hover já é tratado via CSS)
// ─────────────────────────────────────────────
$tabsDropdownTrigger.addEventListener("click", () => {
  const isOpen = $tabsDropdown.classList.toggle("open");
  $tabsDropdownTrigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
  if (isOpen) closeAllDropdowns("tabs-dropdown");
});

document.addEventListener("click", e => {
  if (!$tabsDropdown.contains(e.target)) {
    $tabsDropdown.classList.remove("open");
    $tabsDropdownTrigger.setAttribute("aria-expanded", "false");
  }
});

// ─────────────────────────────────────────────
//  CRIAR TAB — Admin toolbar button
// ─────────────────────────────────────────────
$createTabBtn.addEventListener("click", () => {
  $createTabBtn.classList.add("hidden");
  $createTabInputWrap.classList.remove("hidden");
  $createTabInput.value = "";
  $createTabInput.focus();
});

function confirmCreateTab() {
  const label = $createTabInput.value.trim();
  if (label) {
    createTab(label);
  }
  $createTabBtn.classList.remove("hidden");
  $createTabInputWrap.classList.add("hidden");
  $createTabInput.value = "";
}

$createTabConfirm.addEventListener("click", confirmCreateTab);
$createTabInput.addEventListener("keydown", e => {
  if (e.key === "Enter") confirmCreateTab();
  if (e.key === "Escape") {
    $createTabBtn.classList.remove("hidden");
    $createTabInputWrap.classList.add("hidden");
  }
});

// ─────────────────────────────────────────────
//  SORT — toolbar buttons
//  O botão de upvotes tem 3 estados: off → upvotes (mais votados) → downvotes (menos votados) → off
// ─────────────────────────────────────────────
function updateSortButtonsUI() {
  document.querySelectorAll(".sort-btn").forEach(b => {
    b.classList.remove("active", "reverse");
    if (b.dataset.sort === currentSort) {
      b.classList.add("active");
    } else if (b.dataset.sort === "upvotes" && currentSort === "downvotes") {
      // Estado reverso: mesmo botão, mas com classe "reverse" (mostra downvote icon)
      b.classList.add("active", "reverse");
    }
  });
  // Toggle visibilidade dos icones up/down no botão de upvotes
  const votesBtn = document.querySelector(".sort-btn-votes");
  if (votesBtn) {
    const upIcon = votesBtn.querySelector(".sort-icon-up");
    const downIcon = votesBtn.querySelector(".sort-icon-down");
    const isReverse = currentSort === "downvotes";
    if (upIcon) upIcon.style.display = isReverse ? "none" : "";
    if (downIcon) downIcon.style.display = isReverse ? "" : "none";
    // Actualiza o title consoante o estado
    if (isReverse) {
      votesBtn.title = t("Mais down-votes");
    } else if (currentSort === "upvotes") {
      votesBtn.title = t("Mais up-votes");
    } else {
      votesBtn.title = t("Mais up-votes");
    }
  }
}

document.querySelectorAll(".sort-btn").forEach(btn => {
  btn.classList.toggle("active", btn.dataset.sort === currentSort);
  btn.addEventListener("click", () => {
    const sortType = btn.dataset.sort;

    if (sortType === "upvotes") {
      // 3-state cycle: off → upvotes → downvotes → off
      if (currentSort === "upvotes") {
        currentSort = "downvotes";
      } else if (currentSort === "downvotes") {
        currentSort = "random";
      } else {
        currentSort = "upvotes";
      }
    } else {
      currentSort = sortType;
    }

    localStorage.setItem(SORT_KEY, currentSort);
    updateSortButtonsUI();
    renderGameList(gamesData);
  });
});

// ─────────────────────────────────────────────
//  VIEW — toolbar buttons
// ─────────────────────────────────────────────
function applyViewButtons() {
  document.querySelectorAll(".view-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === currentView);
  });
}

document.querySelectorAll(".view-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    currentView = btn.dataset.view;
    localStorage.setItem(VIEW_KEY, currentView);
    applyViewButtons();
    renderGameList(gamesData);
  });
});

applyViewButtons();

// ─────────────────────────────────────────────
//  TAG FILTER
// ─────────────────────────────────────────────

// Collect all unique genres + themes across loaded games, sorted A-Z
function getAllTags() {
  const set = new Set();
  gamesData.forEach(g => {
    (g.genres || []).forEach(t => set.add(t));
    (g.themes || []).forEach(t => set.add(t));
  });
  return [...set].sort((a, b) => a.localeCompare(b, isPt() ? "pt" : "en"));
}

// Collect all release-status strings actually present in the loaded games,
// ordered to match RELEASE_STATUS_MAP's natural progression.
function getAllReleaseStatuses() {
  const STATUS_ORDER = ["Lançado", "Acesso Antecipado", "Por lançar", "Alpha", "Beta", "Offline", "Rumor", "Cancelado", "Removido de venda"];
  const present = new Set();
  gamesData.forEach(g => { if (g.releaseStatus) present.add(g.releaseStatus); });
  return STATUS_ORDER.filter(s => present.has(s));
}

function renderTagFilter() {
  const tags = getAllTags();
  const statuses = getAllReleaseStatuses();

  // Update trigger appearance (count reflects all filter kinds combined)
  const totalActive = activeTagFilters.size + activeStatusFilters.size + (commonGamesFilterUserId ? 1 : 0);
  const hasActive = totalActive > 0;
  $tagFilterTrigger.classList.toggle("has-active", hasActive);
  $tagFilterCount.textContent = totalActive;
  $tagFilterCount.classList.toggle("hidden", !hasActive);
  $tagFilterClear.classList.toggle("hidden", !hasActive);
  if ($tagFilterQuickClear) $tagFilterQuickClear.classList.toggle("hidden", !hasActive);

  // Build genre/theme tag pill list — em PT, traduz via glossário
  $tagFilterList.innerHTML = tags.map(tag => {
    const active = activeTagFilters.has(tag);
    const display = translateTagSync(tag);
    return `<button class="tag-filter-item${active ? " active" : ""}" data-tag="${escHtml(tag)}" role="option" aria-selected="${active}">${escHtml(display)}</button>`;
  }).join("");

  $tagFilterList.querySelectorAll(".tag-filter-item").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const tag = btn.dataset.tag;
      if (activeTagFilters.has(tag)) {
        activeTagFilters.delete(tag);
      } else {
        activeTagFilters.add(tag);
      }
      renderTagFilter();
      renderGameList(gamesData);
    });
  });

  // Build release-status pill list — traduz para exibição
  $tagFilterListStatus.innerHTML = statuses.map(status => {
    const active = activeStatusFilters.has(status);
    const display = t(status);
    return `<button class="tag-filter-item${active ? " active" : ""}" data-status="${escHtml(status)}" role="option" aria-selected="${active}">${escHtml(display)}</button>`;
  }).join("");

  $tagFilterListStatus.querySelectorAll(".tag-filter-item").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const status = btn.dataset.status;
      if (activeStatusFilters.has(status)) {
        activeStatusFilters.delete(status);
      } else {
        activeStatusFilters.add(status);
      }
      renderTagFilter();
      renderGameList(gamesData);
    });
  });

  // Build "Jogos em comum" — lista de outros utilizadores
  const $commonList = document.getElementById("tag-filter-list-common");
  if ($commonList) {
    // Filtra utilizadores que não são o currentUser
    const otherUsers = allUsers.filter(u => u.id !== (currentUser ? currentUser.id : null));
    if (otherUsers.length === 0) {
      $commonList.innerHTML = `<div style="padding:12px;color:var(--muted);font-size:0.75rem;text-align:center;">${escHtml(t("Nenhum outro utilizador registado."))}</div>`;
    } else {
      $commonList.innerHTML = otherUsers.map(u => {
        const active = commonGamesFilterUserId === u.id;
        return `<button class="tag-filter-item${active ? " active" : ""}" data-commonuid="${escHtml(u.id)}" role="option" aria-selected="${active}">${escHtml(u.name)}</button>`;
      }).join("");

      $commonList.querySelectorAll(".tag-filter-item").forEach(btn => {
        btn.addEventListener("click", e => {
          e.stopPropagation();
          const uid = btn.dataset.commonuid;
          if (commonGamesFilterUserId === uid) {
            commonGamesFilterUserId = null; // toggle off
          } else {
            commonGamesFilterUserId = uid;
          }
          renderTagFilter();
          renderGameList(gamesData);
        });
      });
    }
  }
}

// Switch between the "Géneros & Temas", "Estado de Lançamento" and "Jogos em comum" sub-tabs
function setTagFilterSubtab(subtab) {
  currentTagSubtab = subtab;
  const $subtabCommon = document.getElementById("tag-filter-subtab-common");
  const $commonList = document.getElementById("tag-filter-list-common");
  $tagFilterSubtabTags.classList.toggle("active", subtab === "tags");
  $tagFilterSubtabStatus.classList.toggle("active", subtab === "status");
  if ($subtabCommon) $subtabCommon.classList.toggle("active", subtab === "common");
  $tagFilterList.classList.toggle("hidden", subtab !== "tags");
  $tagFilterListStatus.classList.toggle("hidden", subtab !== "status");
  if ($commonList) $commonList.classList.toggle("hidden", subtab !== "common");
  $tagFilterHeaderLabel.textContent = subtab === "tags" ? t("Géneros & Temas")
    : subtab === "status" ? t("Estado de Lançamento")
    : t("Jogos em comum");
}

$tagFilterSubtabTags.addEventListener("click", e => {
  e.stopPropagation();
  setTagFilterSubtab("tags");
});
$tagFilterSubtabStatus.addEventListener("click", e => {
  e.stopPropagation();
  setTagFilterSubtab("status");
});
const $tagFilterSubtabCommon = document.getElementById("tag-filter-subtab-common");
if ($tagFilterSubtabCommon) {
  $tagFilterSubtabCommon.addEventListener("click", e => {
    e.stopPropagation();
    setTagFilterSubtab("common");
  });
}
setTagFilterSubtab("tags"); // ensure initial sync with markup

// Toggle open/close (click, for touch/keyboard; hover is handled via CSS)
$tagFilterTrigger.addEventListener("click", e => {
  e.stopPropagation();
  const isOpen = $tagFilter.classList.toggle("open");
  $tagFilterTrigger.setAttribute("aria-expanded", isOpen);
  if (isOpen) {
    closeAllDropdowns("tag-filter");
    renderTagFilter();
  }
});

// Refresh list content on hover too, since the menu can open via CSS :hover
// without going through the click handler above.
$tagFilter.addEventListener("mouseenter", () => renderTagFilter());

// Clear all (genre/theme tags, release-status filters, and common-games filter)
$tagFilterClear.addEventListener("click", e => {
  e.stopPropagation();
  activeTagFilters.clear();
  activeStatusFilters.clear();
  commonGamesFilterUserId = null;
  renderTagFilter();
  renderGameList(gamesData);
});

// Quick clear (botão "X" fora do menu)
if ($tagFilterQuickClear) {
  $tagFilterQuickClear.addEventListener("click", e => {
    e.stopPropagation();
    activeTagFilters.clear();
    activeStatusFilters.clear();
    commonGamesFilterUserId = null;
    renderTagFilter();
    renderGameList(gamesData);
  });
  // Hover no quick-clear NÃO abre o menu do filtro
  $tagFilterQuickClear.addEventListener("mouseenter", e => {
    e.stopPropagation();
    $tagFilter.classList.remove("hover-open");
  });
}

// Hover no trigger ou menu abre o menu (com delay via CSS .hover-open)
// Removido apenas quando o rato sai do container inteiro (.tag-filter)
$tagFilterTrigger.addEventListener("mouseenter", () => {
  $tagFilter.classList.add("hover-open");
});

const $tagFilterMenuEl = document.getElementById("tag-filter-menu");
if ($tagFilterMenuEl) {
  $tagFilterMenuEl.addEventListener("mouseenter", () => {
    $tagFilter.classList.add("hover-open");
  });
}

// Remove hover-open apenas quando o rato sai do container inteiro
$tagFilter.addEventListener("mouseleave", () => {
  $tagFilter.classList.remove("hover-open");
});

// Close on outside click
document.addEventListener("click", e => {
  if (!$tagFilter.contains(e.target)) {
    $tagFilter.classList.remove("open");
    $tagFilterTrigger.setAttribute("aria-expanded", false);
  }
});

// ─────────────────────────────────────────────
//  PLAYLIST MODAL — adicionar/remover link de playlist do YouTube
//  (gravações de gameplays do grupo)
//  Reaproveita o markup do antigo addtab-modal (agora #addtab-modal
//  serve apenas de contentor; o conteúdo é o formulário de playlist).
// ─────────────────────────────────────────────

// Valida se uma string é um URL válido de playlist do YouTube.
// Aceita formatos:
//   https://www.youtube.com/playlist?list=PLxxxx
//   https://youtube.com/playlist?list=PLxxxx
//   https://www.youtube.com/watch?v=xxx&list=PLxxxx
function isValidYoutubePlaylistUrl(url) {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  try {
    const u = new URL(trimmed);
    const host = u.hostname.replace(/^www\./, "");
    if (host !== "youtube.com" && host !== "youtu.be") return false;
    // Tem de ter parâmetro list=
    const list = u.searchParams.get("list");
    if (!list) return false;
    return true;
  } catch (_) {
    return false;
  }
}

function openPlaylistModal(game) {
  addTabTargetGame = game;
  // Título: "Gravações — {name}"
  $addtabTitle.textContent = `${t("Gravações")} — ${game.name}`;

  // Pré-preenche o input se já existir playlistUrl
  const input = document.getElementById("playlist-url-input");
  const removeBtn = document.getElementById("playlist-remove-btn");
  if (input) {
    input.value = game.playlistUrl || "";
  }
  // Mostra o botão "Remover" apenas se já existe uma playlist
  if (removeBtn) {
    removeBtn.classList.toggle("hidden", !game.playlistUrl);
  }

  $addtabModal.classList.remove("hidden");
  // Foca o input para inserção rápida
  if (input) setTimeout(() => input.focus(), 50);
}

function closePlaylistModal() {
  $addtabModal.classList.add("hidden");
  addTabTargetGame = null;
}

// Guarda a URL da playlist no Firebase (campo playlistUrl do documento do jogo)
async function setPlaylistUrl(game, url) {
  if (!game || !game.firebaseId) return;
  try {
    await updateDoc(doc(db, "games", game.firebaseId), { playlistUrl: url || "" });
    game.playlistUrl = url || null;
    // OTIMIZAÇÃO: saveCache re-escreve o cache com dados atualizados.
    // clearCache() era redundante (logo a seguir saveCache re-popula).
    saveCache(gamesData);
    closePlaylistModal();
    renderGameList(gamesData);
    // Se o modal estiver aberto, atualiza os botões de quicklink
    if (modalOpen && _modalCurrentGame && _modalCurrentGame.firebaseId === game.firebaseId) {
      updateModalRecordingsButton(game);
    }
    showToast(url
      ? t("Gravações guardadas.")
      : t("Gravações removidas.")
    );
  } catch (err) {
    console.error("[setPlaylistUrl] erro:", err);
    showToast(t("Erro ao guardar gravações."));
  }
}

// Atualiza apenas o botão "Gravações" no modal-info (sem re-render completo)
function updateModalRecordingsButton(game) {
  if (!modalOpen || !_modalCurrentGame) return;
  const actions = document.querySelector(".modal-info-actions");
  if (!actions) return;
  // Remove botão existente
  const existing = actions.querySelector(".modal-info-recordings");
  if (existing) existing.remove();
  // Adiciona se aplicável
  if (isPlayed(game.firebaseId) && game.playlistUrl) {
    const btn = document.createElement("a");
    btn.className = "modal-info-quicklink modal-info-recordings";
    btn.href = game.playlistUrl;
    btn.target = "_blank";
    btn.rel = "noopener";
    btn.onclick = (e) => e.stopPropagation();
    btn.innerHTML = `<img class="quicklink-icon" src="https://www.youtube.com/s/desktop/61baa440/img/favicon_32x32.png" alt="" loading="lazy"/>${escHtml(t("Gravações"))}`;
    // Insere antes do botão Steam (se existir) ou do expand-btn
    const steamBtn = actions.querySelector(".modal-info-steam");
    const expandBtn = actions.querySelector(".modal-info-expand-btn");
    if (steamBtn) {
      actions.insertBefore(btn, steamBtn);
    } else if (expandBtn) {
      actions.insertBefore(btn, expandBtn);
    } else {
      actions.appendChild(btn);
    }
  }
}

$addtabClose.addEventListener("click", closePlaylistModal);
$addtabBackdrop.addEventListener("click", closePlaylistModal);
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !$addtabModal.classList.contains("hidden")) closePlaylistModal();
});

// Handler do botão "Guardar" no modal de playlist
document.addEventListener("DOMContentLoaded", () => {
  const saveBtn = document.getElementById("playlist-save-btn");
  const removeBtn = document.getElementById("playlist-remove-btn");
  const input = document.getElementById("playlist-url-input");

  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      if (!addTabTargetGame) return;
      const url = input ? input.value.trim() : "";
      if (!url) {
        showToast(t("Insere um link de playlist."));
        return;
      }
      if (!isValidYoutubePlaylistUrl(url)) {
        showToast(t("Link de playlist inválido."));
        return;
      }
      setPlaylistUrl(addTabTargetGame, url);
    });
  }

  if (removeBtn) {
    removeBtn.addEventListener("click", () => {
      if (!addTabTargetGame) return;
      setPlaylistUrl(addTabTargetGame, "");
    });
  }

  // Enter no input = Guardar
  if (input) {
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (saveBtn) saveBtn.click();
      }
    });
  }
});

// ─────────────────────────────────────────────
//  SETTINGS — Fundo (carrossel) + Desfoque (slider)
// ─────────────────────────────────────────────

const BG_IMAGES = [
  "./Imagem_de_fundo.jpg",
  "./Imagem_de_fundo_2.png",
  "./Imagem_de_fundo_3.jpg",
  "./Imagem_de_fundo_4.jpg",
  "./Imagem_de_fundo_5.jpg",
];

const BG_KEY   = "jce_bg_index";
const BLUR_KEY = "jce_bg_blur";

let currentBgIndex = Math.min(
  parseInt(localStorage.getItem(BG_KEY) ?? "0"),
  BG_IMAGES.length - 1
);
let currentBlur = parseFloat(localStorage.getItem(BLUR_KEY) ?? "2");

// Aplica o fundo ao body (e ao loader enquanto ainda existe)
function applyBackground() {
  const url = BG_IMAGES[currentBgIndex] ?? BG_IMAGES[0];
  document.body.style.backgroundImage = `url("${url}")`;
  const loader = document.getElementById("page-loader");
  if (loader) loader.style.backgroundImage = `url("${url}")`;
}

// Aplica o valor de blur via custom property e actualiza o track do slider
function applyBlur(val) {
  document.documentElement.style.setProperty("--bg-blur", `${val}px`);
  const slider = document.getElementById("blur-slider");
  if (slider) {
    const pct = ((val / 20) * 100).toFixed(1);
    slider.style.background = `linear-gradient(to right,
      rgba(255,179,71,0.75) 0%,
      rgba(255,179,71,0.75) ${pct}%,
      rgba(255,255,255,0.1) ${pct}%,
      rgba(255,255,255,0.1) 100%)`;
  }
}

// (Re)constrói as miniaturas do carrossel de fundos
function renderCarousel() {
  const grid = document.getElementById("bg-carousel-grid");
  if (!grid) return;

  grid.innerHTML = BG_IMAGES.map((url, i) => `
    <button class="bg-carousel-thumb${i === currentBgIndex ? " active" : ""}"
            data-idx="${i}"
            title="${escHtml(t("Fundo"))} ${i + 1}">
      <img src="${url}" alt="${escHtml(t("Fundo"))} ${i + 1}" loading="lazy"/>
    </button>
  `).join("");

  grid.querySelectorAll(".bg-carousel-thumb").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      currentBgIndex = parseInt(btn.dataset.idx);
      localStorage.setItem(BG_KEY, currentBgIndex);
      applyBackground();
      // Actualiza o estado activo sem re-render completo
      grid.querySelectorAll(".bg-carousel-thumb").forEach((b, i) =>
        b.classList.toggle("active", i === currentBgIndex)
      );
    });
  });
}

// ─────────────────────────────────────────────
//  NOTIFICATIONS — Sistema de notificações
//  Notifica os seguintes eventos:
//    1. Jogos que saíram de acesso antecipado (Acesso Antecipado → Lançado)
//    2. Jogos que foram lançados (Por lançar → Acesso Antecipado/Lançado)
//    3. Mudanças de Release Date ou Release status (informações do jogo)
//    4. Up-votes e down-votes recebidos
//
//  Nota: outros campos (estúdio, desenvolvedor, engine, descrição, géneros,
//  temas, modos, nota, capa) NÃO geram notificação — removido a pedido do user.
//
//  Persistência: localStorage (jce_notifications). Se perdido, notificações
//  são perdidas (comportamento intencional).
//  Toggle "Mutar notificações" no settings-menu desativa novas notificações.
//
//  Snapshot do estado dos jogos: guardado em localStorage separado
//  (jce_games_snapshot) para comparação entre carregamentos. Contém apenas
//  os campos relevantes (releaseStatus, firstReleaseTs).
// ─────────────────────────────────────────────
const NOTIFICATIONS_KEY = "jce_notifications";
const NOTIFICATIONS_MAX = 50; // máximo de notificações guardadas
const GAMES_SNAPSHOT_KEY = "jce_games_snapshot_v2";
// Migração one-time: remove o snapshot v1 (raw IGDB status). O v2 usa
// computeReleaseStatus() (IGDB + Steam), pelo que snapshots v1 são incompatíveis —
// compará-los geraria falsas notificações na primeira carga pós-update.
// Ao remover, a primeira carga com o novo código trata tudo como "primeiro load"
// (snapshot vazio → apenas guarda, sem gerar notificações).
try { localStorage.removeItem("jce_games_snapshot"); } catch (_) {}

let notifications = [];        // array de {id, type, text, gameId, gameName, timestamp, read}
let notificationsMuted = false;

// Snapshot anterior dos jogos para deteção de mudanças.
// Estrutura: { [firebaseId]: { releaseStatus, studios, developers, engines, summary, ... } }
let gamesSnapshot = {};

// Carrega notificações e snapshot do localStorage
function loadNotifications() {
  try {
    const raw = localStorage.getItem(NOTIFICATIONS_KEY);
    if (raw) notifications = JSON.parse(raw);
  } catch (_) { notifications = []; }
  try {
    notificationsMuted = localStorage.getItem("jce_mute_notifications") === "1";
  } catch (_) {}
  try {
    const rawSnap = localStorage.getItem(GAMES_SNAPSHOT_KEY);
    if (rawSnap) gamesSnapshot = JSON.parse(rawSnap);
  } catch (_) { gamesSnapshot = {}; }
}

// Extrai os campos relevantes de um jogo para o snapshot (para comparação).
// OTIMIZAÇÃO: apenas os campos que geram notificação:
//   - Release Date + Release status (Etapa 5)
//   - Last update Steam + IGDB updated_at (Etapa Updates)
// Os outros campos (estúdio, desenvolvedor, engine, etc.) não geram notificação.
//
// ⚠️  CORREÇÃO — Status de lançamento no snapshot:
//   Usa computeReleaseStatus() (IGDB + Steam combinados) em vez de
//   game.releaseStatus (raw IGDB). Isto alinha o snapshot com o estado
//   EXIBIDO ao utilizador, evitando falsas notificações de "lançado" quando:
//     - O IGDB infere "Lançado" de uma first_release_date no passado, MAS
//     - A Steam diz coming_soon=true (jogo ainda por lançar), pelo que o
//       display mostra "Por lançar".
//   Sem esta correção, o snapshot (raw IGDB "Lançado") diverge do display
//   ("Por lançar"), e uma re-fetch do IGDB que actualize a data dispara uma
//   falsa notificação "lançado" — exatamente o bug do "Online 404".
//
//   Para jogos COM steamAppId mas NÃO enriched (Steam fetch falhou),
//   armazena null — o status IGDB-only é impreciso para jogos não lançados
//   com datas no passado, e compará-lo entre snapshots poderia gerar falsas
//   notificações devido à instabilidade intermitente do enrichment.
//   Para jogos SEM steamAppId, IGDB é a fonte única → game.releaseStatus.
function extractGameSnapshot(game) {
  let releaseStatus;
  if (game.steamAppId && game.steamEnriched === true) {
    // Jogo com Steam enriquecido → status combinado (alinhado com o display)
    releaseStatus = computeReleaseStatus(game) || null;
  } else if (!game.steamAppId) {
    // Jogo sem Steam → IGDB é a fonte única
    releaseStatus = game.releaseStatus || null;
  } else {
    // Tem steamAppId mas enrichment falhou → status não fiável (não comparar)
    releaseStatus = null;
  }
  return {
    releaseStatus,
    firstReleaseTs: game.firstReleaseTs || null,
    // Last update: usa o timestamp do último patch (Steam) ou IGDB updated_at.
    // steamLastUpdate é { date, title, url } — só guardamos o date para comparar.
    steamLastUpdateTs: game.steamLastUpdate?.date || null,
    igdbUpdatedAt: game.igdbUpdatedAt || null,
  };
}

// Guarda o snapshot atual de todos os jogos no localStorage E em memória.
// CRÍTICO: sem atualizar gamesSnapshot em memória, detectGameChanges compara
// sempre contra um snapshot stale → notificações perdidas ou duplicadas.
function saveGamesSnapshot() {
  try {
    const snap = {};
    gamesData.forEach(g => {
      if (g.firebaseId) {
        // BUG #4 fix: NÃO salvar no snapshot jogos que o utilizador escondeu
        // (hiddenGames) ou marcou como jogados (isPlayed). Se salvarmos, quando
        // o utilizador un-hide/un-play, prev===curr e a notificação é perdida
        // permanentemente. Ao não salvar, o snapshot retém o estado ANTIGO
        // e a mudança será detetada quando o jogo voltar a ser visível.
        if (hiddenGames.has(g.firebaseId)) return;
        if (isPlayed(g.firebaseId)) return;
        // BUG #7 fix: salvar TAMBÉM jogos em fallback (_needsRetry). Sem isto,
        // quando um jogo fallback recupera (retryFailedGames), o snapshot não
        // o tem e detectGameChanges gera uma falsa notificação "added".
        // O fallback já tem releaseStatus/firstReleaseTs/etc (de createFallbackGame).
        snap[g.firebaseId] = extractGameSnapshot(g);
      }
    });
    gamesSnapshot = snap; // ← CRÍTICO: atualiza em memória (BUG #1 fix)
    localStorage.setItem(GAMES_SNAPSHOT_KEY, JSON.stringify(snap));
  } catch (_) {}
}

// Compara o estado atual dos jogos com o snapshot anterior e gera notificações.
// Tipos de mudanças detetadas:
//   - "added": jogo novo adicionado à lista
//   - "released": Acesso Antecipado → Lançado (jogo saiu de early access)
//   - "early-access": Por lançar → Acesso Antecipado/Lançado (jogo foi lançado)
//   - "patch": último update mudou (jogo recebeu um patch)
//   - "updated": release date mudou
//
// FILTRO PER-USER (Etapa 5):
//   - Jogos que o utilizador DEU DOWN-VOTE (hiddenGames) → NÃO notifica
//   - Jogos na tab "Jogados" (isPlayed) → NÃO notifica
//   - Jogos na tab "Aprovados" → MANTÉM notificações
//   Isto é per-user porque hiddenGames é local (localStorage por utilizador).
function detectGameChanges() {
  if (notificationsMuted) return;

  let hasChanges = false;

  gamesData.forEach(game => {
    if (!game.firebaseId || game._needsRetry) return; // ignora jogos em fallback

    // ── FILTRO PER-USER (Etapa 5) ──
    // Não notifica jogos que o utilizador escondeu (down-vote) ou marcou como jogados.
    // hiddenGames é local (localStorage) — cada utilizador só vê as suas próprias
    // notificações. Jogos na tab "Aprovados" NÃO são filtrados (continuam a notificar).
    if (hiddenGames.has(game.firebaseId)) return;
    if (isPlayed(game.firebaseId)) return;

    const prev = gamesSnapshot[game.firebaseId];

    // 0. Jogo NOVO (não estava no snapshot anterior) → notifica "added"
    // Só notifica jogos novos se o snapshot já existia (não é o primeiro load).
    // Isto evita spamar notificações no arranque inicial.
    if (!prev) {
      // Verifica se o snapshot já tinha jogos (se não, é primeiro load — skip)
      if (Object.keys(gamesSnapshot).length > 0) {
        const text = tf('"{0}" foi adicionado à lista!', game.name);
        addNotification("added", text, game.firebaseId, game.name);
        hasChanges = true;
      }
      return; // jogo novo não tem prev para comparar — não cai nas secções abaixo
    }

    const curr = extractGameSnapshot(game);
    const prevStatus = prev.releaseStatus;
    const currStatus = curr.releaseStatus;

    // 1. Acesso Antecipado → Lançado (saiu de early access)
    if (prevStatus === "Acesso Antecipado" && currStatus === "Lançado") {
      const text = tf('"{0}" saiu de acesso antecipado e foi lançado!', game.name);
      addNotification("released", text, game.firebaseId, game.name);
      hasChanges = true;
      return;
    }

    // 2. Por lançar → Acesso Antecipado ou Lançado (jogo foi lançado)
    if (prevStatus === "Por lançar" && (currStatus === "Acesso Antecipado" || currStatus === "Lançado")) {
      const eaSuffix = currStatus === "Acesso Antecipado" ? t(" em acesso antecipado") : "";
      const text = tf('"{0}" foi lançado{1}!', game.name, eaSuffix);
      addNotification("early-access", text, game.firebaseId, game.name);
      hasChanges = true;
      return;
    }

    // 3. Último update mudou (Etapa Updates)
    // Deteta se a data do último patch (Steam) ou updated_at (IGDB) mudou.
    // PROTEÇÃO contra notificações espúrias: só notifica se o valor ANTERIOR
    // não era null (primeiro enrichment não gera notificação — evita spamar
    // todos os jogos quando o steamLastUpdate é populado pela primeira vez).
    const prevUpdateTs = prev.steamLastUpdateTs;
    const currUpdateTs = curr.steamLastUpdateTs;
    if (prevUpdateTs !== null && currUpdateTs !== null && prevUpdateTs !== currUpdateTs) {
      // A data do último update mudou — notifica!
      const prevDate = formatLastUpdateDate(prevUpdateTs);
      const currDate = formatLastUpdateDate(currUpdateTs);
      const text = tf('"{0}" recebeu um update! ({1})', game.name, currDate);
      addNotification("patch", text, game.firebaseId, game.name);
      hasChanges = true;
      return; // já notificámos o update — não cai na secção 4
    }

    // 4. Outras mudanças de informação — APENAS Release Date
    // (Release status já é tratado nas secções 1 e 2 acima)
    // Outros campos (estúdio, desenvolvedor, engine, descrição, géneros, temas,
    // modos, nota, capa) NÃO geram notificação — removido a pedido do user.
    const changedFields = [];
    if (prev.firstReleaseTs !== curr.firstReleaseTs) {
      changedFields.push(t("data de lançamento"));
    }

    if (changedFields.length > 0) {
      const fieldsText = changedFields.join(", ");
      const text = tf('"{0}" teve informações atualizadas: {1}.', game.name, fieldsText);
      addNotification("updated", text, game.firebaseId, game.name);
      hasChanges = true;
    }
  });

  // Atualiza o snapshot com o estado atual
  saveGamesSnapshot();
}

// ─────────────────────────────────────────────
//  Detecção de notificações de votos (up-votes e down-votes)
//  Agrupa novos votos por jogo e gera uma notificação por jogo.
//  Apenas notifica o utilizador atual sobre votos em jogos que ELE adicionou
//  (addedBy === currentUser.name). Ignora o próprio voto do utilizador.
//
//  newVotes: array de { gameId, userId, userName }
//  voteType: "upvote" | "downvote"
// ─────────────────────────────────────────────
function detectVoteNotifications(newVotes, voteType) {
  if (notificationsMuted || !currentUser) return;
  if (!newVotes || newVotes.length === 0) return;

  // Filtra votos do próprio utilizador (não notificar a si próprio)
  const externalVotes = newVotes.filter(v => v.userId !== currentUser.id);
  if (externalVotes.length === 0) return;

  // Agrupa votos por gameId
  const votesByGame = {};
  externalVotes.forEach(v => {
    if (!votesByGame[v.gameId]) votesByGame[v.gameId] = [];
    votesByGame[v.gameId].push(v);
  });

  // Para cada jogo, verifica se foi adicionado pelo utilizador atual
  Object.entries(votesByGame).forEach(([gameId, votes]) => {
    // Procura o jogo em gamesData para verificar addedBy
    const game = gamesData.find(g => g.firebaseId === gameId);
    if (!game) return;

    // BUG #6 fix: aplicar filtro per-user (igual a detectGameChanges)
    // Não notificar sobre votos em jogos que o utilizador escondeu ou jogou.
    if (hiddenGames.has(gameId)) return;
    if (isPlayed(gameId)) return;

    const count = votes.length;
    const voterNames = votes.map(v => v.userName).filter(Boolean);
    const gameName = game.name || t("Jogo desconhecido");

    let text;
    if (voteType === "upvote") {
      if (count === 1) {
        const voter = voterNames[0] || t("Alguém");
        text = tf('{0} deu um up-vote em "{1}".', voter, gameName);
      } else {
        text = tf('Recebeste {0} up-votes em "{1}".', count, gameName);
      }
    } else {
      if (count === 1) {
        const voter = voterNames[0] || t("Alguém");
        text = tf('{0} deu um down-vote em "{1}".', voter, gameName);
      } else {
        text = tf('Recebeste {0} down-votes em "{1}".', count, gameName);
      }
    }

    addNotification(voteType, text, gameId, gameName);
  });
}

// Guarda notificações no localStorage (exclui notificações de teste _test)
function saveNotifications() {
  try {
    const persistable = notifications.filter(n => !n._test);
    localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(persistable));
  } catch (_) {}
}

// Adiciona uma notificação (se não estiver mutado)
// type: "added" | "released" | "early-access" | "updated" | "patch" | "upvote" | "downvote"
// text: mensagem a mostrar
// gameId: firebaseId do jogo (para abrir o modal ao clicar)
// gameName: nome do jogo (para mostrar na notificação)
function addNotification(type, text, gameId, gameName) {
  if (notificationsMuted) return;

  // BUG #8 fix: dedup — se já existe uma notificação com o mesmo type+gameId
  // nos últimos 5 segundos, não adiciona duplicada. Previne spam quando
  // detectGameChanges é chamado múltiplas vezes rapidamente.
  const now = Date.now();
  const DEDUP_WINDOW_MS = 5000;
  const isDuplicate = notifications.some(n =>
    n.type === type &&
    n.gameId === gameId &&
    (now - n.timestamp) < DEDUP_WINDOW_MS
  );
  if (isDuplicate) return;

  const notif = {
    id: now + "-" + Math.random().toString(36).substr(2, 9),
    type,
    text,
    gameId: gameId || null,
    gameName: gameName || null,
    timestamp: now,
    read: false,
  };
  notifications.unshift(notif); // adiciona no início (mais recente primeiro)
  // Limita o número de notificações guardadas
  if (notifications.length > NOTIFICATIONS_MAX) {
    notifications = notifications.slice(0, NOTIFICATIONS_MAX);
  }
  saveNotifications();
  renderNotifications();
}

// Marca todas as notificações como lidas
function markAllNotificationsRead() {
  let changed = false;
  notifications.forEach(n => {
    if (!n.read) { n.read = true; changed = true; }
  });
  if (changed) {
    saveNotifications();
    renderNotifications();
  }
}

// Limpa todas as notificações
function clearAllNotifications() {
  notifications = [];
  saveNotifications();
  renderNotifications();
}

// Formata timestamp relativo (ex: "há 5 min", "há 2 h", "ontem")
function formatNotifTime(ts) {
  const now = Date.now();
  const diff = now - ts;
  const sec = Math.floor(diff / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);

  if (isPt()) {
    if (sec < 60) return "agora";
    if (min < 60) return `há ${min} min`;
    if (hr < 24) return `há ${hr} h`;
    if (day === 1) return "ontem";
    if (day < 7) return `há ${day} dias`;
    return new Date(ts).toLocaleDateString("pt-PT");
  } else {
    if (sec < 60) return "now";
    if (min < 60) return `${min}m ago`;
    if (hr < 24) return `${hr}h ago`;
    if (day === 1) return "yesterday";
    if (day < 7) return `${day}d ago`;
    return new Date(ts).toLocaleDateString("en-US");
  }
}

// ─────────────────────────────────────────────
//  Simulação de notificações para teste (Etapa 4b)
//  Gera notificações falsas com todos os tipos, APENAS em memória
//  (não persistidas no localStorage). Limpas no refresh.
//  Usa jogos reais de gamesData quando possível para que o clique funcione.
// ─────────────────────────────────────────────
let _testNotificationsActive = false; // flag: notificações de teste estão ativas

function simulateTestNotifications() {
  // Pega 3 jogos reais para usar nas notificações de teste
  const realGames = gamesData.filter(g => !g._needsRetry).slice(0, 3);
  const game1 = realGames[0] || { firebaseId: null, name: "Game Alpha" };
  const game2 = realGames[1] || { firebaseId: null, name: "Game Beta" };
  const game3 = realGames[2] || { firebaseId: null, name: "Game Gamma" };

  // Notificações de teste (não persistidas)
  const testNotifs = [
    {
      id: "test-released-" + Date.now(),
      type: "released",
      text: tf('"{0}" saiu de acesso antecipado e foi lançado!', game1.name),
      gameId: game1.firebaseId,
      gameName: game1.name,
      timestamp: Date.now() - 60000, // 1 min ago
      read: false,
      _test: true,
    },
    {
      id: "test-early-" + Date.now(),
      type: "early-access",
      text: tf('"{0}" foi lançado em acesso antecipado!', game2.name),
      gameId: game2.firebaseId,
      gameName: game2.name,
      timestamp: Date.now() - 3600000, // 1 hour ago
      read: false,
      _test: true,
    },
    {
      id: "test-updated-" + Date.now(),
      type: "updated",
      text: tf('"{0}" teve informações atualizadas: {1}.', game3.name, t("estúdio, engine")),
      gameId: game3.firebaseId,
      gameName: game3.name,
      timestamp: Date.now() - 7200000, // 2 hours ago
      read: false,
      _test: true,
    },
    {
      id: "test-upvote-1-" + Date.now(),
      type: "upvote",
      text: tf('{0} deu um up-vote em "{1}".', "Leo", game1.name),
      gameId: game1.firebaseId,
      gameName: game1.name,
      timestamp: Date.now() - 1800000, // 30 min ago
      read: false,
      _test: true,
    },
    {
      id: "test-upvote-2-" + Date.now(),
      type: "upvote",
      text: tf('Recebeste {0} up-votes em "{1}".', 2, game2.name),
      gameId: game2.firebaseId,
      gameName: game2.name,
      timestamp: Date.now() - 10800000, // 3 hours ago
      read: true,
      _test: true,
    },
    {
      id: "test-downvote-" + Date.now(),
      type: "downvote",
      text: tf('{0} deu um down-vote em "{1}".', "M1guel", game3.name),
      gameId: game3.firebaseId,
      gameName: game3.name,
      timestamp: Date.now() - 86400000, // 1 day ago
      read: true,
      _test: true,
    },
  ];

  // Adiciona as notificações de teste ao array (no início, mais recentes primeiro)
  // sem persistir no localStorage
  notifications = [...testNotifs, ...notifications];
  _testNotificationsActive = true;
  renderNotifications();
  // Feedback
  showToast(t("Notificações de teste adicionadas."));
}

// Renderiza o dropdown de notificações
function renderNotifications() {
  const $list = document.getElementById("notifications-list");
  const $badge = document.getElementById("notifications-badge");
  const $clearBtn = document.getElementById("notifications-clear-btn");
  if (!$list) return;

  const unreadCount = notifications.filter(n => !n.read).length;

  // Atualiza badge
  if ($badge) {
    if (unreadCount > 0) {
      $badge.textContent = unreadCount > 99 ? "99+" : unreadCount;
      $badge.classList.remove("hidden");
    } else {
      $badge.classList.add("hidden");
    }
  }

  // Botão limpar
  if ($clearBtn) {
    $clearBtn.classList.toggle("hidden", notifications.length === 0);
  }

  // Lista
  if (notifications.length === 0) {
    $list.innerHTML = `<div class="notifications-empty">${escHtml(t("Sem notificações."))}</div>`;
    return;
  }

  $list.innerHTML = notifications.map(n => {
    // Todos os tipos usam o cover do jogo (sem ícone circular)
    let coverHtml = "";
    if (n.gameId) {
      const game = gamesData.find(g => g.firebaseId === n.gameId);
      const cover = game ? (game.cover || game.preferredKeyArt) : null;
      if (cover) {
        coverHtml = `<img class="notification-cover" src="${escHtml(cover)}" alt="" loading="lazy"/>`;
      }
    }
    // Fallback: placeholder se não houver cover
    if (!coverHtml) {
      coverHtml = `<div class="notification-cover notification-cover--empty"></div>`;
    }

    return `
    <div class="notification-item${n.read ? "" : " unread"}" data-notif-id="${escHtml(n.id)}" data-game-id="${escHtml(n.gameId || "")}">
      ${coverHtml}
      <div class="notification-content">
        <div class="notification-text">
          ${escHtml(n.text)}
          <span class="notification-type-dot type-${escHtml(n.type)}" title="${escHtml(n.type)}"></span>
        </div>
        <div class="notification-time">${escHtml(formatNotifTime(n.timestamp))}</div>
      </div>
    </div>
  `;
  }).join("");

  // Click numa notificação → marca como lida + abre o modal do jogo
  $list.querySelectorAll(".notification-item").forEach(item => {
    item.addEventListener("click", () => {
      const notifId = item.dataset.notifId;
      const gameId = item.dataset.gameId;
      // Marca como lida
      const notif = notifications.find(n => n.id === notifId);
      if (notif && !notif.read) {
        notif.read = true;
        saveNotifications();
        renderNotifications();
      }
      // Abre o modal do jogo (se aplicável)
      if (gameId) {
        const gameIdx = gamesData.findIndex(g => g.firebaseId === gameId);
        if (gameIdx >= 0) {
          // Fecha o dropdown de notificações
          const $notifWrap = document.getElementById("notifications-wrap");
          if ($notifWrap) $notifWrap.classList.remove("open");
          openModal(gameIdx);
        }
      }
    });
  });
}

// Inicializa o botão de notificações (trigger + dropdown)
function initNotifications() {
  loadNotifications();
  renderNotifications();

  const $wrap = document.getElementById("notifications-wrap");
  const $trigger = document.getElementById("notifications-trigger");

  // Scroll trapping: impede que o scroll propague para a página quando
  // se chega ao limite da lista de notificações.
  // NOTA: aplicado à .notifications-list (que tem overflow-y:auto), NÃO ao
  // .notifications-menu (que tem overflow:hidden). Aplicar ao menu quebrava
  // o scroll para cima porque menu.scrollTop é sempre 0.
  const $notifList = document.getElementById("notifications-list");
  if ($notifList) trapScroll($notifList);

  if ($trigger) {
    $trigger.addEventListener("click", e => {
      e.stopPropagation();
      const isOpen = $wrap.classList.toggle("open");
      $trigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
      if (isOpen) {
        closeAllDropdowns("notifications-wrap");
        // Marca como lidas após abrir (com pequeno delay para o utilizador ver o badge)
        // BUG #11 fix: só marca se o menu ainda estiver aberto (utilizador pode
        // ter fechado entretanto)
        setTimeout(() => {
          if ($wrap.classList.contains("open")) {
            markAllNotificationsRead();
          }
        }, 1500);
      }
    });
  }

  // Fecha ao clicar fora
  document.addEventListener("click", e => {
    if ($wrap && !$wrap.contains(e.target)) {
      $wrap.classList.remove("open");
      if ($trigger) $trigger.setAttribute("aria-expanded", "false");
    }
  });

  // Botão limpar tudo
  const $clearBtn = document.getElementById("notifications-clear-btn");
  if ($clearBtn) {
    $clearBtn.addEventListener("click", e => {
      e.stopPropagation();
      clearAllNotifications();
    });
  }

  // Botão de teste de notificações (no admin-tests-panel)
  const $testNotifBtn = document.getElementById("admin-test-notifications-btn");
  if ($testNotifBtn) {
    $testNotifBtn.addEventListener("click", e => {
      e.stopPropagation();
      simulateTestNotifications();
    });
  }
}

// Inicializa o painel de settings: aplica valores guardados + liga eventos
function initSettings() {
  // 1. Aplicar imediatamente os valores guardados
  applyBackground();
  applyBlur(currentBlur);

  // 2. Construir miniaturas do carrossel
  renderCarousel();

  // 3. Ligar o slider de blur
  const slider = document.getElementById("blur-slider");
  const label  = document.getElementById("blur-value-label");
  if (slider && label) {
    slider.value = currentBlur;
    label.textContent = currentBlur === 0 ? t("Off") : `${currentBlur}px`;
    applyBlur(currentBlur); // garante que o track está correcto no arranque

    slider.addEventListener("input", e => {
      e.stopPropagation();
      const val = parseFloat(slider.value);
      currentBlur = val;
      localStorage.setItem(BLUR_KEY, val);
      label.textContent = val === 0 ? t("Off") : `${val}px`;
      applyBlur(val);
    });
  }

  // 4. Ligar o trigger — abre/fecha apenas por click (sem hover)
  const wrap    = document.getElementById("settings-wrap");
  const trigger = document.getElementById("settings-trigger");
  if (wrap && trigger) {
    trigger.addEventListener("click", e => {
      e.stopPropagation();
      const isOpen = wrap.classList.toggle("open");
      trigger.setAttribute("aria-expanded", isOpen);
      if (isOpen) closeAllDropdowns("settings-wrap");
    });

    // Fecha ao clicar fora
    document.addEventListener("click", ev => {
      if (!wrap.contains(ev.target)) {
        wrap.classList.remove("open");
        trigger.setAttribute("aria-expanded", "false");
      }
    });
  }

  // Scroll trapping: impede que o scroll propague para a página quando
  // se chega ao limite do menu de definições.
  const $settingsMenu = document.getElementById("settings-menu");
  if ($settingsMenu) trapScroll($settingsMenu);

  // 5. Ligar checkboxes de opções
  // NOTA: "Mostrar jogos escondidos" foi removido — agora existe a pseudo-tab
  // "Escondidos" que mostra os jogos escondidos. A variável showHiddenGames
  // fica sempre false (jogos escondidos não aparecem na lista "Todos").
  showHiddenGames = false;

  const ytAutoplayChk = document.getElementById("option-yt-autoplay");
  if (ytAutoplayChk) {
    ytAutoplayChk.checked = youtubeAutoplay;
    ytAutoplayChk.addEventListener("change", e => {
      e.stopPropagation();
      youtubeAutoplay = ytAutoplayChk.checked;
      try { localStorage.setItem("jce_yt_autoplay", youtubeAutoplay ? "1" : "0"); } catch (_) {}
    });
  }

  // 6. Checkbox mutar notificações
  const muteNotifChk = document.getElementById("option-mute-notifications");
  if (muteNotifChk) {
    muteNotifChk.checked = notificationsMuted;
    muteNotifChk.addEventListener("change", e => {
      e.stopPropagation();
      notificationsMuted = muteNotifChk.checked;
      try { localStorage.setItem("jce_mute_notifications", notificationsMuted ? "1" : "0"); } catch (_) {}
    });
  }

  // 7. Checkbox mutar sons (SFX)
  const muteSoundsChk = document.getElementById("option-mute-sounds");
  if (muteSoundsChk) {
    muteSoundsChk.checked = window.sfx ? window.sfx.isMuted() : false;
    muteSoundsChk.addEventListener("change", e => {
      e.stopPropagation();
      if (window.sfx) window.sfx.setMuted(muteSoundsChk.checked);
    });
  }
}

// ─────────────────────────────────────────────
//  DROPDOWN MUTUAL EXCLUSION — apenas um menu aberto de cada vez
//  Fecha todos os menus dropdown exceto o que está a ser aberto.
//  Menus: tabs-dropdown, tag-filter, notifications-wrap, settings-wrap
// ─────────────────────────────────────────────

// Impede o "scroll chaining": quando o utilizador faz scroll dentro de um
// elemento scrollable (menu, dropdown, lista) e chega ao limite (topo ou
// fundo), o scroll NÃO propaga para a página. Isto evita que a página role
// quando se está a navegar num menu.
// Reutilizado por: notifications-menu, settings-menu (e outros no futuro).
function trapScroll($el) {
  if (!$el) return;
  $el.addEventListener("wheel", (e) => {
    // Só contém o scroll se o elemento tiver conteúdo scrollable
    const hasScrollableContent = $el.scrollHeight > $el.clientHeight;
    if (!hasScrollableContent) {
      // Sem scroll possível — bloqueia para não propagar à página
      e.preventDefault();
      return;
    }
    const scrollTop = $el.scrollTop;
    const maxScroll = $el.scrollHeight - $el.clientHeight;
    const scrollingUp = e.deltaY < 0;
    const scrollingDown = e.deltaY > 0;
    // No limite superior + scroll para cima → bloqueia
    if (scrollingUp && scrollTop <= 0) {
      e.preventDefault();
      return;
    }
    // No limite inferior + scroll para baixo → bloqueia
    if (scrollingDown && scrollTop >= maxScroll) {
      e.preventDefault();
      return;
    }
    // Caso contrário: deixa o scroll ocorrer dentro do elemento
  }, { passive: false });
}

function closeAllDropdowns(exceptId) {
  const dropdownIds = ["tabs-dropdown", "tag-filter", "notifications-wrap", "settings-wrap"];
  dropdownIds.forEach(id => {
    if (id === exceptId) return;
    const el = document.getElementById(id);
    if (el) el.classList.remove("open");
  });
}

// ─────────────────────────────────────────────
//  DISCOVER MODE — Botão "Descobre"
//  Queue aleatória + modal de descoberta + nav cards
// ─────────────────────────────────────────────
let discoverMode = false;       // true enquanto o modo Descoberta está activo
let discoverQueue = [];         // array de jogos embaralhados (refs para gamesData)
let discoverIndex = 0;          // índice actual na queue

// Fisher-Yates shuffle — embaralha array in-place
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Inicia o modo Descoberta:
// 1. Cria uma queue aleatória com todos os jogos disponíveis
//    (excluindo jogos escondidos pelo utilizador)
// 2. Abre o modal com o primeiro jogo da queue
function startDiscover() {
  // Filtrar jogos disponíveis (exclui escondidos)
  const availableGames = gamesData.filter(g => !hiddenGames.has(g.firebaseId));

  if (availableGames.length === 0) {
    showToast(t("Nenhum jogo disponível para descobrir."));
    return;
  }

  // Separar jogos não-visitados (Novidade) dos já visitados
  const unvisited = availableGames.filter(g => !isGameVisited(g.firebaseId));
  const visited = availableGames.filter(g => isGameVisited(g.firebaseId));

  // Shuffle ambos os grupos independentemente
  const shuffledNew = shuffleArray([...unvisited]);
  const shuffledOld = shuffleArray([...visited]);

  // Não-visitados primeiro, depois os restantes
  discoverQueue = [...shuffledNew, ...shuffledOld];
  discoverIndex = 0;
  discoverMode = true;

  // Abrir modal com o primeiro jogo da queue
  openDiscoverGame(0);
}

// Abre o modal para um jogo na posição da queue de descoberta.
// NÃO abre um novo modal — reutiliza o modal existente.
function openDiscoverGame(queueIdx) {
  if (queueIdx < 0 || queueIdx >= discoverQueue.length) return;
  discoverIndex = queueIdx;
  const game = discoverQueue[queueIdx];
  const gameIdx = gamesData.indexOf(game);
  if (gameIdx < 0) return;

  // Nota: markGameVisited é chamado no fim, após renderModalBanner,
  // para que o label "Novidade" possa aparecer correctamente.

  // Se o modal já está aberto no modo descoberta, só atualiza o conteúdo
  // (não fecha/reabre — evita flicker e mantém o estado)
  if (modalOpen && discoverMode) {
    // Re-renderiza o conteúdo do modal para o novo jogo
    _modalCurrentGame = game;
    buildModalMedia(game);
    renderModalMedia(0);
    renderModalBanner(game);
    renderModalExtraInfo(game);

    // Re-renderiza o modal-info
    const ratingVal = ratingStr(game.rating);
    const themeTagsHtml = (game.themes || []).map(tag =>
      `<span class="tag">${escHtml(translateTagSync(tag))}</span>`
    ).join("");
    const modeTagsHtml = game.modes.map(m =>
      `<span class="tag ${modeClass(m)}">${escHtml(translateTagSync(m))}</span>`
    ).join("");
    const ratingHtml = ratingVal
      ? `<div class="modal-rating">
           <svg width="16" height="16" viewBox="0 0 24 24" fill="#ffc86a"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>
           ${ratingVal} / 10
         </div>` : "";
    // ── Etapa 4: Badge Steam + fallback IGDB (igual ao openModal) ──
    // Badge Steam SUBSTITUI rating IGDB (não mostra ambos) — corrige bug
    // de aparecerem duas reviews em simultâneo no modal.
    const steamBadgeModal = steamReviewBadgeHtml(game);
    const modalRatingHtml = steamBadgeModal || ratingHtml;
    const infoSteamHtml = game.steamUrl
      ? `<a class="modal-info-steam" href="${escHtml(game.steamUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">
          <img src="https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://store.steampowered.com/t&size=128" width="11" height="11" alt="Steam" style="object-fit:contain;display:block;"/>
          Steam
        </a>` : "";
    const modalQuickLinksHtml = `
      <a class="modal-info-quicklink" href="https://online-fix.me/" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="Online-Fix">
        <img class="quicklink-icon" src="https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://online-fix.me/t&size=128" alt="" loading="lazy"/>
        Online-Fix
      </a>
      <a class="modal-info-quicklink" href="https://cs.rin.ru/forum/index.php" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="cs.rin.ru">
        <img class="quicklink-icon" src="https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://cs.rin.ru/forum/index.phpt&size=128" alt="" loading="lazy"/>
        cs.rin.ru
      </a>`;
    // Botão "Gravações" no modal-info (modo descoberta) — só em jogos jogados com playlistUrl
    const modalRecordingsHtml = (isPlayed(game.firebaseId) && game.playlistUrl)
      ? `<a class="modal-info-quicklink modal-info-recordings" href="${escHtml(game.playlistUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="${escHtml(t("Gravações"))}">
          <img class="quicklink-icon" src="https://www.youtube.com/s/desktop/61baa440/img/favicon_32x32.png" alt="" loading="lazy"/>
          ${escHtml(t("Gravações"))}
        </a>`
      : "";
    $modalInfo.innerHTML = `
      <div class="modal-info-actions">
        ${modalQuickLinksHtml}
        ${modalRecordingsHtml}
        ${infoSteamHtml}
        <button class="modal-info-expand-btn" id="modal-info-expand-btn" aria-label="${escHtml(t("Expandir descrição"))}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
            <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
          </svg>
        </button>
      </div>
      <div class="modal-title-row">
        <h2 class="modal-title">${escHtml(game.name)}</h2>
        <button class="modal-copy-btn" id="modal-copy-btn" aria-label="${escHtml(t("Copiar nome"))}" title="${escHtml(t("Copiar nome do jogo"))}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
      </div>
      <div class="modal-tags">${themeTagsHtml}${modeTagsHtml}</div>
      <div class="modal-meta">${modalRatingHtml}</div>
      <p class="modal-desc" id="modal-desc">${escHtml(game.summary || t("Sem descrição disponível."))}</p>
    `;
    document.getElementById("modal-info-expand-btn")
      .addEventListener("click", (e) => { e.stopPropagation(); toggleInfoExpand(); });
    const copyBtn = document.getElementById("modal-copy-btn");
    if (copyBtn) {
      copyBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(game.name).then(() => {
          copyBtn.classList.add("copied");
          setTimeout(() => copyBtn.classList.remove("copied"), 1400);
        }).catch(() => {});
      });
    }

    // Traduz o sumário async
    if (game.summary) {
      const descEl = document.getElementById("modal-desc");
      if (descEl) {
        const lang = isPt() ? "pt" : "en";
        const cacheKey = `${game.firebaseId}::${lang}`;
        const cached = _summaryTranslated.get(cacheKey);
        if (cached != null) {
          descEl.textContent = cached;
        } else {
          translateText(game.summary, lang).then(translated => {
            if (translated) {
              descEl.textContent = translated;
              _summaryTranslated.set(cacheKey, translated);
            }
          }).catch(() => {});
        }
      }
    }

    // Re-attach parallax and auto-advance for the new content
    $modalMedia.removeEventListener("mousemove", onModalMediaParallax);
    $modalMedia.removeEventListener("mouseleave", resetModalMediaParallax);
    $modalMedia.addEventListener("mousemove", onModalMediaParallax);
    $modalMedia.addEventListener("mouseleave", resetModalMediaParallax);
    if (infoExpanded) collapseInfo();
  } else {
    // Primeira abertura — abre o modal normalmente
    openModal(gameIdx);
  }

  // Atualiza os navigation cards
  renderDiscoverNavCards();

  // Re-align após o modal estar totalmente renderizado
  // (necessário na primeira abertura porque o layout ainda não está estável)
  // Quando chamado de navigateDiscover, skipRafAlign é true — o alinhamento
  // final é feito pelo navigateDiscover depois da animação whoosh terminar.
  if (!_discoverNavigating) {
    requestAnimationFrame(() => {
      alignDiscoverNavCards();
    });
  }

  // Marca o jogo como visitado (depois de renderModalBanner,
  // para que o label "Novidade" possa aparecer correctamente)
  markGameVisited(game.firebaseId);
}

// Navega na queue de descoberta com animação whoosh estilo carrossel.
// direction: "next" (para o próximo jogo, whoosh para a direita)
//            "prev" (para o jogo anterior, whoosh para a esquerda)
let _discoverNavigating = false; // previne cliques rápidos durante animação

function navigateDiscover(direction) {
  if (!discoverMode || _discoverNavigating) return;
  if (discoverQueue.length < 2) return;

  const targetIdx = direction === "next"
    ? (discoverIndex + 1) % discoverQueue.length
    : (discoverIndex - 1 + discoverQueue.length) % discoverQueue.length;

  // Não anima se for o mesmo jogo (queue de 1)
  if (targetIdx === discoverIndex) return;

  _discoverNavigating = true;

  // Elementos que vão animar
  const $content = document.querySelector('.modal-content');

  // Classes de animação: out
  const outClass = direction === "next" ? "discover-whoosh-out-left" : "discover-whoosh-out-right";
  const navOutClass = direction === "next" ? "discover-nav-out-left" : "discover-nav-out-right";

  // Aplica slide-out
  $content.classList.add(outClass);
  $discoverNavPrev.classList.add(navOutClass);
  $discoverNavNext.classList.add(navOutClass);

  // Depois da animação out (250ms), actualiza o conteúdo e faz slide-in
  setTimeout(() => {
    // Remove classes out
    $content.classList.remove(outClass);
    $discoverNavPrev.classList.remove(navOutClass);
    $discoverNavNext.classList.remove(navOutClass);

    // Actualiza o conteúdo do modal para o novo jogo (sem animação)
    openDiscoverGame(targetIdx);

    // Força reflow — o browser precisa de calcular o layout estável
    // antes de iniciarmos a animação slide-in, para que as posições
    // do alignDiscoverNavCards() estejam correctas.
    void $discoverNavPrev.offsetHeight;

    // Classes de animação: in
    const inClass = direction === "next" ? "discover-whoosh-in-right" : "discover-whoosh-in-left";
    const navInClass = direction === "next" ? "discover-nav-in-right" : "discover-nav-in-left";

    // Aplica slide-in
    $content.classList.add(inClass);
    $discoverNavPrev.classList.add(navInClass);
    $discoverNavNext.classList.add(navInClass);

    // Limpa classes após animação in (280ms)
    setTimeout(() => {
      $content.classList.remove(inClass);
      $discoverNavPrev.classList.remove(navInClass);
      $discoverNavNext.classList.remove(navInClass);
      // Alinhamento final — agora que a animação terminou e o layout está estável
      alignDiscoverNavCards();
      _discoverNavigating = false;
    }, 300);
  }, 260);
}

// Sai do modo Descoberta (chamado ao fechar o modal via X)
function exitDiscover() {
  discoverMode = false;
  discoverQueue = [];
  discoverIndex = 0;
  _discoverNavigating = false;
  // Limpa classes de animação que possam ter ficado
  const $content = document.querySelector('.modal-content');
  const whooshClasses = [
    "discover-whoosh-out-left", "discover-whoosh-out-right",
    "discover-whoosh-in-left", "discover-whoosh-in-right",
    "discover-nav-out-left", "discover-nav-out-right",
    "discover-nav-in-left", "discover-nav-in-right"
  ];
  whooshClasses.forEach(cls => {
    $content?.classList.remove(cls);
    $discoverNavPrev.classList.remove(cls);
    $discoverNavNext.classList.remove(cls);
  });
  // Esconde os nav cards
  $discoverNavPrev.classList.add("hidden");
  $discoverNavNext.classList.add("hidden");
}

// Constrói o HTML de um mini game-card para navegação no modo Descoberta.
// Cover + title + release status. Sem expand, sem scrub, sem admin buttons.
// Hover = zoom (scale), como os cards normais.
function buildDiscoverNavCard(game, direction) {
  const screenshots = game.screenshots || [];
  const artworks = game.artworks || [];
  const coverSrc = game.preferredKeyArt || artworks[0] || screenshots[0] || game.cover || "";
  // Etapa 5: cruza Steam + IGDB para o estado de lançamento
  const computedStatus = computeReleaseStatus(game);
  const releaseStatusDisplay = computedStatus ? t(computedStatus) : "";

  return `
    <div class="game-card discover-card--${direction}" tabindex="0" role="button"
         aria-label="${escHtml(t("Ver detalhes de"))} ${escHtml(game.name)}">
      <div class="card-top">
        <img class="card-bg" src="${escHtml(coverSrc)}" alt="${escHtml(game.name)}" loading="lazy"/>
        <div class="card-image-gradient"></div>
        <div class="card-banner-badge">
          ${game.cover
            ? `<img class="card-banner-cover" src="${escHtml(game.cover)}" alt="" loading="lazy"/>`
            : `<div class="card-banner-cover card-banner-cover--empty"></div>`}
          <span class="discover-nav-text">
            <span class="discover-nav-arrows discover-nav-arrows--${direction}">
              <span class="discover-arrow">‹</span>
              <span class="discover-arrow">‹</span>
              <span class="discover-arrow">‹</span>
            </span>
            <span class="card-banner-title">${escHtml(game.name)}</span>
          </span>
        </div>
        ${releaseStatusDisplay ? `<span class="card-release-status card-release-status--${releaseStatusClass(computedStatus)}">${escHtml(releaseStatusDisplay)}</span>` : ""}
      </div>
    </div>
  `;
}

// Renderiza os dois navigation cards (prev/next) no modo Descoberta.
// Circular: se estiver no primeiro jogo, o prev mostra o último da queue.
// Os cards são posicionados ao nível vertical do modal-info.
function renderDiscoverNavCards() {
  if (!discoverMode || discoverQueue.length < 2) {
    $discoverNavPrev.classList.add("hidden");
    $discoverNavNext.classList.add("hidden");
    return;
  }

  // Previous game (circular)
  const prevIdx = (discoverIndex - 1 + discoverQueue.length) % discoverQueue.length;
  const prevGame = discoverQueue[prevIdx];
  $discoverNavPrev.innerHTML = buildDiscoverNavCard(prevGame, "prev");
  $discoverNavPrev.classList.remove("hidden");

  // Next game
  const nextIdx = (discoverIndex + 1) % discoverQueue.length;
  const nextGame = discoverQueue[nextIdx];
  $discoverNavNext.innerHTML = buildDiscoverNavCard(nextGame, "next");
  $discoverNavNext.classList.remove("hidden");

  // Alinha os nav cards verticalmente com o modal-info
  alignDiscoverNavCards();

  // Attach click handlers — navega na queue de descoberta com whoosh
  const prevCard = $discoverNavPrev.querySelector(".game-card");
  const nextCard = $discoverNavNext.querySelector(".game-card");

  if (prevCard) {
    prevCard.addEventListener("click", (e) => {
      e.stopPropagation();
      navigateDiscover("prev");
    });
  }
  if (nextCard) {
    nextCard.addEventListener("click", (e) => {
      e.stopPropagation();
      navigateDiscover("next");
    });
  }
}

// Alinha os nav cards com o modal-info: centrados verticalmente
// e centrados horizontalmente no espaço entre a parede e o modal-info.
// A largura do card escala com o rem base (260px @ 16px) e adapta-se
// ao espaço disponível — encolhe se não houver espaço suficiente.
function alignDiscoverNavCards() {
  const info = document.querySelector('.modal-info');
  if (!info) return;
  const infoRect = info.getBoundingClientRect();

  // Espaço horizontal disponível de cada lado do modal-info
  const leftSpace = infoRect.left;
  const rightSpace = window.innerWidth - infoRect.right;

  // Largura do card escala com o rem base (como o resto do site)
  // 260px @ 16px base → cresce proporcionalmente em resoluções maiores
  const currentRem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const scale = currentRem / 16;
  const idealCardWidth = Math.round(260 * scale);

  // Limites: mínimo 120px, gap mínimo 1rem de cada lado
  const minCardWidth = Math.round(120 * scale);
  const minGap = Math.round(16 * scale);
  const maxFittingWidth = Math.min(leftSpace - minGap * 2, rightSpace - minGap * 2);
  const cardWidth = Math.max(minCardWidth, Math.min(idealCardWidth, maxFittingWidth));

  // Aplica a largura calculada
  $discoverNavPrev.style.width = `${cardWidth}px`;
  $discoverNavNext.style.width = `${cardWidth}px`;

  const cardHeight = $discoverNavPrev.querySelector('.game-card')?.getBoundingClientRect().height || 140;

  // Vertical: center card relative to modal-info
  const top = infoRect.top + (infoRect.height / 2) - (cardHeight / 2);
  $discoverNavPrev.style.top = `${top}px`;
  $discoverNavNext.style.top = `${top}px`;

  // Horizontal: center each card in its available space
  const prevLeft = (leftSpace - cardWidth) / 2;
  $discoverNavPrev.style.left = `${Math.max(minGap, prevLeft)}px`;

  const nextLeft = infoRect.right + (rightSpace - cardWidth) / 2;
  $discoverNavNext.style.left = `${Math.min(window.innerWidth - cardWidth - minGap, nextLeft)}px`;
}

if ($discoverTrigger) {
  $discoverTrigger.addEventListener("click", () => {
    startDiscover();
  });
}

// Re-align discover nav cards when viewport is resized
window.addEventListener("resize", () => {
  if (discoverMode && modalOpen) {
    alignDiscoverNavCards();
  }
});


function init() {
  // ── Loader: forçar a ficar visível até TUDO estar carregado ──
  // O loader só deve dispensar quando gamesLoaded === true (Firebase + IGDB
  // completos). Isto evita que o utilizador interaja com a UI antes de tudo
  // estar pronto (causando estados meio-carregados/feios).
  // forceShowLoader(true) impede o safety net de 15s do loader.js de dispensar.
  if (typeof window.forceShowLoader === "function") {
    window.forceShowLoader(true);
  }

  // Restore sort/view button state
  updateSortButtonsUI();
  applyViewButtons();

  // Carrega preferências e jogos escondidos do localStorage
  loadPreferences();
  loadHiddenGames();
  loadVisitedGames();

  // Init settings panel (bg carousel + blur + options)
  initSettings();

  // Init notifications (bell button + dropdown)
  initNotifications();

  // Render tabs (vazio até o Firestore responder)
  renderTabs();

  // ── OTIMIZAÇÃO: stale-while-revalidate ──
  // Render IMEDIATO com cache (fresco OU stale), sem esperar pelo Firebase.
  // - Cache fresco (< 30min): render instantâneo, sem revalidação.
  // - Cache stale (30min-24h): render instantâneo + revalidação em background.
  // - Sem cache: loading normal (Firebase + IGDB fetches).
  const cachedFresh = loadCache();
  const cachedStale = cachedFresh ? null : loadStaleCache();
  const cached = cachedFresh || cachedStale;
  if (cached && cached.length > 0) {
    gamesData = cached;
    // Marca como carregado para que o renderGameList mostre os jogos do cache
    // em vez do loading spinner. O onSnapshot do Firebase atualizará quando
    // receber dados frescos (e gamesLoaded continuará true).
    gamesLoaded = true;
    renderGameList(cached);
    renderAdminList(cached);
    // Se o cache é stale, dispensa o loader imediatamente (dados já visíveis).
    // O listenToGames fará a revalidação em background silenciosamente.
    if (cachedStale && typeof window.dismissLoader === "function") {
      window.dismissLoader();
    }
  }

  // Re-mark last-row cards when the window is resized (column count may change)
  window.addEventListener("resize", () => markLastRowCards(), { passive: true });

  // Listeners Firestore em tempo real
  listenToTabs();       // tabs PRIMEIRO (popula tabsData para listenToTabGames poder encontrar Reprovados/Aprovados)
  listenToTabGames();   // tab→jogos (usa tabsData para encontrar trashTabId e approvedTabId)
  listenToGames();      // jogos
  listenToUsers();      // users — registo + sessão
  listenToDownvotes();  // down-votes — sistema de votação
  listenToUpvotes();    // up-votes — sistema de votação + ordenação

  // Init registo + pesquisa + conta
  initRegisterButton();
  initHeaderSearch();
  initAccountEdit();
  updateUserUI();

  // ⚠️  Garante que as traduções estáticas são aplicadas após init().
  // Isto resolve um bug no GitHub Pages onde o i18n.js (script regular)
  // pode não ter aplicado as traduções antes do app.js (módulo deferred)
  // re-renderizar elementos dinâmicos da toolbar.
  if (window.i18n) {
    window.i18n.applyTranslations();
    window.i18n.updateLangButtonsActive();
    updateUserUI(); // garantir que o botão de registo mostra o texto correcto
  }

  // ⚠️  Fix: garante que os botões de idioma funcionam mesmo se o
  // listener de delegação do i18n.js não estiver a disparar (race condition
  // em GitHub Pages). Adiciona listeners directos a cada botão.
  document.querySelectorAll(".lang-option").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (window.i18n && btn.dataset.lang) {
        window.i18n.setLang(btn.dataset.lang);
      }
    });
  });

  // Safety net: se o Firebase não responder em 30s (config inválida,
  // permissões, rede, etc.), dispensa o loader forçado para não bloquear
  // a UI indefinidamente. O listener onSnapshot continuará activo e
  // actualizará quando receber dados.
  // NOTA: 30s (era 6s) porque o forceShowLoader(true) impede dismiss prematuro.
  // O Firebase normalmente responde em < 2s; 30s é apenas para casos extremos.
  setTimeout(() => {
    if (!gamesLoaded && typeof window.forceShowLoader === "function") {
      console.warn("[app.js] Safety net: Firebase não respondeu em 30s, a dispensar loader.");
      window.forceShowLoader(false);
    }
  }, 30000);

  // ── i18n: handler de mudança de idioma ─────────────────────────
  // Quando o utilizador muda de idioma, re-renderiza tudo para que
  // as strings estáticas (data-i18n) e o conteúdo dinâmico (tags,
  // estados, datas, sumários) sejam traduzidos.
  if (window.i18n) {
    window.i18n.onLanguageChange((newLang) => {
      // Re-aplica traduções estáticas (data-i18n attrs no HTML)
      applyTranslations();
      // ⚠️  Importante: chamar updateUserUI() DEPOIS de applyTranslations()
      // para que o nome do utilizador (se registado) não seja sobrescrito
      // pela tradução "Sign Up" / "Regista-te".
      updateUserUI();
      // Re-renderiza a lista de jogos (cards com tags traduzidos,
      // datas com locale correcto, etc.)
      renderGameList(gamesData);
      renderAdminList(gamesData);
      renderAdminAccounts();
      renderTagFilter();
      renderTabs();
      // Re-renderiza as miniaturas de fundo (títulos traduzidos)
      renderCarousel();
      // Atualiza o label do blur (Off / Desligado)
      const blurLabel = document.getElementById("blur-value-label");
      if (blurLabel) {
        blurLabel.textContent = currentBlur === 0 ? t("Off") : `${currentBlur}px`;
      }
      // ── Etapa 5: Re-enrich Steam quando o idioma muda ──
      // A data de lançamento da Steam é localizada (vem em PT ou EN consoante l=).
      // O cache agora é keyed por appId+lang, pelo que mudar de idioma requer
      // re-buscar os appdetails no novo idioma. Marcamos os jogos como não-enriched
      // para que o próximo render os re-busque (com cache hit se já existir no novo lang).
      // Corre em background — não bloqueia o render imediato (que usa fallback IGDB).
      setTimeout(() => {
        let reEnriched = 0;
        gamesData.forEach(g => {
          if (g.steamAppId && g.steamEnriched) {
            // Tenta buscar no novo idioma (cache hit se já existir)
            fetchSteamImageFields(g.steamAppId).then(fields => {
              if (fields) {
                const idx = gamesData.findIndex(x => x.firebaseId === g.firebaseId);
                if (idx >= 0) {
                  gamesData[idx] = { ...gamesData[idx], ...fields };
                  reEnriched++;
                  // Re-render periódico para mostrar datas atualizadas
                  renderGameList(gamesData);
                  if (modalOpen && _modalCurrentGame?.firebaseId === g.firebaseId) {
                    const gi = gamesData.indexOf(_modalCurrentGame);
                    if (gi >= 0) {
                      _modalCurrentGame = gamesData[gi];
                      renderModalExtraInfo(_modalCurrentGame);
                    }
                  }
                }
              }
            }).catch(() => {});
          }
        });
      }, 100);
      // Se o modal estiver aberto, re-renderiza o conteúdo traduzido
      if (modalOpen && _modalCurrentGame) {
        const gameIdx = gamesData.indexOf(_modalCurrentGame);
        if (gameIdx >= 0) {
          // Re-renderiza o modal sem alterar o indice de media
          const savedMediaIdx = modalIndex;
          openModal(gameIdx);
          if (savedMediaIdx < modalMediaList.length) {
            renderModalMedia(savedMediaIdx);
          }
        }
      }
      // Atualiza o estado activo do selector de idioma
      document.querySelectorAll(".lang-option").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.lang === newLang);
      });
    });
  }
}

// ═══════════════════════════════════════════════════════════════
//  FULLSCREEN IMAGE VIEWER (Etapa extra)
//
//  Overlay fullscreen para imagens do modal-media com:
//   - Zoom com scroll do rato (wheel) — 1x a 5x
//   - Pan arrastando a imagem (drag) — só quando zoom > 1x
//   - Reset do zoom com duplo clique
//   - Fechar com Esc, clique no backdrop, ou botão X
//
//  O overlay é criado dinamicamente (1 único elemento reutilizado).
//  Estilo: fundo preto quase opaco (95%), imagem centrada, botão X
//  minimalista no canto superior direito.
// ═══════════════════════════════════════════════════════════════

let _fsOverlay = null;       // elemento do overlay (reutilizado)
let _fsImg = null;           // elemento <img> dentro do overlay
let _fsScale = 1;            // zoom atual (1 = sem zoom)
let _fsMinScale = 1;
let _fsMaxScale = 5;
let _fsX = 0;                // offset X do pan (px)
let _fsY = 0;                // offset Y do pan (px)
let _fsIsDragging = false;
let _fsDragStartX = 0;
let _fsDragStartY = 0;
let _fsPanStartX = 0;
let _fsPanStartY = 0;

// Aplica a transformação (scale + translate) à imagem
function _fsApplyTransform() {
  if (!_fsImg) return;
  _fsImg.style.transform = `translate(${_fsX}px, ${_fsY}px) scale(${_fsScale})`;
  // Cursor: sempre grab (pode arrastar mesmo sem zoom), grabbing durante o drag
  _fsImg.style.cursor = _fsIsDragging ? "grabbing" : "grab";
  // Classe .dragging desativa a transition CSS para a imagem seguir o cursor 1:1
  // (sem efeito "ímã" / lag). Sem isto, a transition de 0.15s faz a imagem
  // "perseguir" o cursor em vez de o seguir instantaneamente.
  _fsImg.classList.toggle("dragging", _fsIsDragging);
}

// Cria o overlay (uma só vez; reutilizado nas aberturas seguintes)
function _fsCreateOverlay() {
  if (_fsOverlay) return _fsOverlay;
  _fsOverlay = document.createElement("div");
  _fsOverlay.className = "image-fs-overlay";
  _fsOverlay.setAttribute("role", "dialog");
  _fsOverlay.setAttribute("aria-modal", "true");
  // Sem botão X — fecha ao clicar fora da imagem (no backdrop/container)
  _fsOverlay.innerHTML = `
    <div class="image-fs-container">
      <img class="image-fs-img" alt=""/>
    </div>
    <div class="image-fs-hint">${escHtml(t("Scroll: zoom · Arrastar: mover · Duplo clique: reset · Esc: fechar"))}</div>
  `;
  document.body.appendChild(_fsOverlay);

  _fsImg = _fsOverlay.querySelector(".image-fs-img");
  const container = _fsOverlay.querySelector(".image-fs-container");

  // ── Close handler: clique no backdrop (container) fecha ──
  // Clique na imagem NÃO fecha (para permitir drag sem fechar acidentalmente).
  // Usamos mousedown + mouseup no mesmo sítio para distinguir click de drag.
  let _downTarget = null;
  let _downX = 0, _downY = 0;
  container.addEventListener("mousedown", (e) => {
    _downTarget = e.target;
    _downX = e.clientX;
    _downY = e.clientY;
  });
  container.addEventListener("mouseup", (e) => {
    // Só fecha se: o mousedown foi no backdrop (não na imagem) E o mouseup
    // está perto do mousedown (não foi um drag acidental).
    if (_downTarget === container && e.target === container) {
      const dx = Math.abs(e.clientX - _downX);
      const dy = Math.abs(e.clientY - _downY);
      if (dx < 5 && dy < 5) closeImageFullscreen();
    }
    _downTarget = null;
  });

  // ── Zoom com scroll ──
  // Zoom em direção ao cursor para UX natural.
  _fsOverlay.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (!_fsImg) return;
    const delta = -e.deltaY;
    const factor = delta > 0 ? 1.15 : 1 / 1.15;
    const newScale = Math.max(_fsMinScale, Math.min(_fsMaxScale, _fsScale * factor));
    if (newScale === _fsScale) return;

    // Zoom em direção ao cursor: ajusta o translate para o ponto sob o cursor
    // ficar fixo. Usa as coordenadas relativas ao centro da imagem.
    const rect = _fsImg.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const ratio = newScale / _fsScale;
    _fsX = dx - (dx - _fsX) * ratio;
    _fsY = dy - (dy - _fsY) * ratio;
    _fsScale = newScale;
    _fsApplyTransform();
  }, { passive: false });

  // ── Pan com drag ──
  // Permitido SEMPRE (mesmo sem zoom) — o utilizador pode reposicionar a imagem.
  _fsImg.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation(); // não propaga para o container (senão fecha no mouseup)
    _fsIsDragging = true;
    _fsDragStartX = e.clientX;
    _fsDragStartY = e.clientY;
    _fsPanStartX = _fsX;
    _fsPanStartY = _fsY;
    _fsApplyTransform();
  });
  window.addEventListener("mousemove", (e) => {
    if (!_fsIsDragging) return;
    _fsX = _fsPanStartX + (e.clientX - _fsDragStartX);
    _fsY = _fsPanStartY + (e.clientY - _fsDragStartY);
    _fsApplyTransform();
  });
  window.addEventListener("mouseup", () => {
    if (!_fsIsDragging) return;
    _fsIsDragging = false;
    _fsApplyTransform();
  });

  // ── Touch support (mobile) ──
  // Pan com 1 dedo sempre (mesmo sem zoom).
  let _touchStartX = 0, _touchStartY = 0, _touchPanX = 0, _touchPanY = 0;
  _fsImg.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    _touchStartX = e.touches[0].clientX;
    _touchStartY = e.touches[0].clientY;
    _touchPanX = _fsX;
    _touchPanY = _fsY;
  }, { passive: true });
  _fsImg.addEventListener("touchmove", (e) => {
    if (e.touches.length !== 1) return;
    e.preventDefault();
    _fsX = _touchPanX + (e.touches[0].clientX - _touchStartX);
    _fsY = _touchPanY + (e.touches[0].clientY - _touchStartY);
    _fsApplyTransform();
  }, { passive: false });

  // ── Duplo clique = reset do zoom ──
  _fsImg.addEventListener("dblclick", (e) => {
    e.preventDefault();
    e.stopPropagation();
    _fsScale = 1;
    _fsX = 0;
    _fsY = 0;
    _fsApplyTransform();
  });

  return _fsOverlay;
}

// Abre o overlay fullscreen com a imagem dada
function openImageFullscreen(src) {
  if (!src) return;
  const overlay = _fsCreateOverlay();
  // Reset state a cada abertura
  _fsScale = 1;
  _fsX = 0;
  _fsY = 0;
  _fsIsDragging = false;
  _fsImg.src = src;
  _fsImg.style.transform = "";
  _fsImg.style.cursor = "grab";
  overlay.classList.add("open");
  document.body.style.overflow = "hidden";

  // ── Pausar o auto-advance do modal-media ──
  // Enquanto o fullscreen está aberto, a rotação automática de imagens
  // fica em pausa (não avança para a próxima screenshot). O utilizador
  // pode navegar manualmente após fechar o fullscreen.
  if (modalAutoTimer) {
    clearTimeout(modalAutoTimer);
    modalAutoTimer = null;
  }
}

// Fecha o overlay fullscreen
function closeImageFullscreen() {
  if (!_fsOverlay) return;
  _fsOverlay.classList.remove("open");
  document.body.style.overflow = "";
  // Limpa o src para libertar memória (a imagem volta a carregar se reabrir)
  if (_fsImg) _fsImg.src = "";
}

// Listener global para Esc fechar o fullscreen
document.addEventListener("keydown", (e) => {
  if (!_fsOverlay || !_fsOverlay.classList.contains("open")) return;
  if (e.key === "Escape") {
    e.stopPropagation();
    closeImageFullscreen();
  }
});

init();


