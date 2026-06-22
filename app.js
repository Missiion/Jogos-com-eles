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
const isPt = () => (window.i18n ? window.i18n.isPt() : true);
const translateText = (txt, lang) =>
  window.i18n ? window.i18n.translateText(txt, lang) : Promise.resolve(txt);
const applyTranslations = (root) => {
  if (window.i18n) window.i18n.applyTranslations(root);
};

// Traduz um termo (género/tema/modo) — usa glossário ou API
async function translateTag(tag) {
  if (!tag) return tag;
  return translateText(tag);
}

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
// ─────────────────────────────────────────────
function normalizeStr(str) {
  if (!str) return "";
  return String(str)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/[^a-z0-9]/g, "");      // remove caracteres especiais
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

// Verifica se um jogo da lista corresponde à pesquisa (fuzzy)
function fuzzyMatchGame(query, game) {
  const nq = normalizeStr(query);
  if (!nq) return false;
  const nn = normalizeStr(game.name);
  if (nn.includes(nq)) return true;
  if (nq.length >= 3 && nn.length >= 3) {
    const dist = levenshtein(nq, nn);
    // Tolerância: 1 erro para nomes curtos, 2 para médios, 3 para longos
    const tolerance = nn.length <= 6 ? 1 : nn.length <= 12 ? 2 : 3;
    if (dist <= tolerance) return true;
  }
  return false;
}

// ─────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────

// Cloudflare Worker proxy — faz a ponte com a API do IGDB sem erros de CORS
const IGDB_PROXY = "https://igdb-proxy.dr-mx-droid.workers.dev";

const IGDB_CLIENT_ID     = "m079gokvukuokos50mw73b4qluwskc";
const IGDB_ACCESS_TOKEN  = "6d3x70gthrbk8ag7p06kyxfzu9v1r4";

const CACHE_KEY     = "jce_games_cache_v3";
const CACHE_TS_KEY  = "jce_games_cache_ts_v3";
const CACHE_TTL_MS  = 5 * 60 * 1000; // 5 min TTL (Firebase real-time sobrepõe isto)

// ─────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────
let gamesData   = [];   // [{id, igdbId, name, cover, screenshots, videos, genres, modes, rating, summary, steamUrl, addedAt, preferredKeyArt}]
let adminOpen     = false; // true enquanto o "modo editor" está ativo (cards mostram botões de admin)
let adminExpanded = false; // true quando o painel de admin (canto inferior direito) está descolapsado
let testsExpanded = false; // true quando o painel de testes (ao lado da pesquisa) está descolapsado
let forcedLoadingActive = false; // true enquanto o loading é forçado a aparecer indefinidamente (debug)
let modalOpen   = false;
let modalIndex  = 0;    // índice de media no modal
let modalMediaList = []; // [{type:'img'|'video', src, thumb}]
let _modalCurrentGame = null; // referência ao jogo actualmente no modal
let infoExpanded = false; // estado do painel modal-info expandido
let modalAutoTimer = null; // setTimeout do auto-advance (screenshots: 5s; vídeos: 'ended')

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
let trashTabId = null;   // ID da tab "Lixo" (criada automaticamente)
let approvedTabId = null; // ID da tab "Aprovados" (criada automaticamente)
const DOWNVOTE_THRESHOLD = 2;
const APPROVED_UPVOTE_COUNT = 3; // exatamente 3 upvotes = aprovado

// Sort: "random" | "name" | "upvotes" | "upvotes-rev" | "rating"
const SORT_KEY  = "jce_sort";
let currentSort = localStorage.getItem(SORT_KEY) || "random";

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

// Carrega preferências do localStorage
function loadPreferences() {
  try {
    showHiddenGames = localStorage.getItem("jce_show_hidden") === "1";
  } catch (_) {}
  try {
    youtubeAutoplay = localStorage.getItem("jce_yt_autoplay") !== "0";
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
const $addtabList      = document.getElementById("addtab-list");

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

async function searchGames(term) {
  return igdbRequest("games", `
    search "${term}";
    fields name, cover.url, first_release_date, summary, rating,
           genres.name, themes.name, game_modes.name,
           screenshots.url, videos.video_id, artworks.url,
           websites.url, websites.category,
           involved_companies.company.name, involved_companies.developer, involved_companies.publisher,
           game_engines.name, status,
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
           game_engines.name, status,
           language_supports.language.locale, language_supports.language_support_type.name;
    where id = ${igdbId};
    limit 1;
  `);
  return results[0] || null;
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

function steamUrl(websites) {
  if (!websites) return null;
  // Category 13 = Steam on IGDB; fallback: any URL containing steampowered.com
  const steam = websites.find(w => w.category === 13)
             || websites.find(w => w.url && w.url.includes("steampowered.com"));
  return steam ? steam.url : null;
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

// Normaliza dados do IGDB para o nosso formato
function normalizeGame(igdbGame) {
  const screenshots = (igdbGame.screenshots || []).map(s => screenshotUrl(s.url)).filter(Boolean);
  const artworks    = (igdbGame.artworks    || []).map(a => artworkUrl(a.url)).filter(Boolean);
  const videos = (igdbGame.videos || []).map(v => v.video_id).filter(Boolean);
  const year = igdbGame.first_release_date
    ? new Date(igdbGame.first_release_date * 1000).getFullYear()
    : null;

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
    steamUrl:    steamUrl(igdbGame.websites),
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
//  CACHE
// ─────────────────────────────────────────────
function saveCache(games) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(games));
    localStorage.setItem(CACHE_TS_KEY, Date.now().toString());
  } catch(e) { /* storage full */ }
}

function loadCache() {
  try {
    const ts = parseInt(localStorage.getItem(CACHE_TS_KEY) || "0");
    if (Date.now() - ts > CACHE_TTL_MS) return null;
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch(e) { return null; }
}

function clearCache() {
  localStorage.removeItem(CACHE_KEY);
  localStorage.removeItem(CACHE_TS_KEY);
}

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
    if (allUsers.length >= 3) {
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
        updateUserUI();
        showToast(isPt() ? `Bem-vindo de volta, ${adminUser.name}!` : `Welcome back, ${adminUser.name}!`);
        return true;
      }
      showToast(t("Código admin já utilizado."));
      return false;
    }
    name = "Leo";
    isAdmin = true;
  } else {
    name = capitalizeName(rawName);
    if (name.length < 2) {
      showToast(isPt() ? "Nome muito curto (mín 2 caracteres)." : "Name too short (min 2 chars).");
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
    showToast(isPt() ? `Bem-vindo, ${name}!` : `Welcome, ${name}!`);
    return true;
  } catch (err) {
    console.error("[registerUser] erro:", err);
    const msg = err.message === "timeout"
      ? (isPt() ? "Servidor não responde." : "Server not responding.")
      : (isPt() ? "Erro ao registar." : "Registration failed.");
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
    showToast(isPt() ? "Nome muito curto." : "Name too short.");
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
    showToast(isPt() ? "Erro ao atualizar nome." : "Failed to update name.");
    return false;
  }
}

// ─────────────────────────────────────────────
//  FIREBASE — Real-time listener
// ─────────────────────────────────────────────
function listenToGames() {
  const q = query(collection(db, "games"), orderBy("addedAt", "asc"));

  onSnapshot(q, async (snapshot) => {
    const firestoreDocs = snapshot.docs.map(d => ({ firebaseId: d.id, ...d.data() }));

    // Se lista vazia
    if (firestoreDocs.length === 0) {
      gamesData = [];
      saveCache([]);
      renderGameList([]);
      renderAdminList([]);
      return;
    }

    // Fetch dados do IGDB para cada jogo (se não estiver já em cache)
    const cached = loadCache() || [];
    const cachedMap = Object.fromEntries(cached.map(g => [g.igdbId, g]));

    const resolved = await Promise.all(
      firestoreDocs.map(async (fsDoc) => {
        if (cachedMap[fsDoc.igdbId]) {
          return { ...cachedMap[fsDoc.igdbId], firebaseId: fsDoc.firebaseId, preferredKeyArt: fsDoc.preferredKeyArt || null };
        }
        try {
          const igdbGame = await fetchGameById(fsDoc.igdbId);
          if (!igdbGame) return null;
          return { ...normalizeGame(igdbGame), firebaseId: fsDoc.firebaseId, preferredKeyArt: fsDoc.preferredKeyArt || null };
        } catch(e) {
          console.warn("Falha ao buscar jogo", fsDoc.igdbId, e);
          return null;
        }
      })
    );

    gamesData = resolved.filter(Boolean);
    saveCache(gamesData);
    renderGameList(gamesData);
    renderAdminList(gamesData);
    renderTagFilter(); // refresh available tags after new game data
    // Processa up-votes pendentes (jogos adicionados por users → up-vote automático)
    processPendingUpvotes();
  }, (err) => {
    console.warn("[app.js] Erro no listener do Firebase:", err);
    // Em caso de erro (permissões, config inválida, etc.), mostra estado
    // vazio e dispensa o loader para não bloquear a UI.
    gamesData = [];
    renderGameList([]);
    renderAdminList([]);
    renderTagFilter();
  });
}

// ─────────────────────────────────────────────
//  RENDER — Game List
// ─────────────────────────────────────────────
function getFilteredSortedGames() {
  // 1. Filter by active tab
  let list = gamesData.slice();
  if (activeTab !== "all") {
    const allowed = tabGamesMap[activeTab] || new Set();
    list = list.filter(g => allowed.has(g.firebaseId));
  } else {
    // Na tab "all", exclui jogos que estão no lixo (>= threshold down-votes)
    list = list.filter(g => !isInTrash(g.firebaseId));
    // 1b. Esconde jogos que o user actual deu down-vote (localmente)
    // Apenas na lista "Todos". Outras tabs (users, lixo) mostram tudo.
    if (!showHiddenGames) {
      list = list.filter(g => !hiddenGames.has(g.firebaseId));
    }
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
  } else if (currentSort === "upvotes-rev") {
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
  $loadingState.classList.add("hidden");

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

  const addTabBtn = card.querySelector(".card-addtab-btn");
  if (addTabBtn) {
    addTabBtn.addEventListener("click", e => {
      e.stopPropagation();
      openAddTabModal(game);
    });
  }
}

function buildCard(game, globalIdx) {
  const screenshots = game.screenshots || [];
  const artworks    = game.artworks    || [];
  const videos      = game.videos || [];

  // card-bg: preferência global de admin → key-art do IGDB → fallback para screenshot → fallback para cover
  const coverSrc = game.preferredKeyArt || artworks[0] || screenshots[0] || game.cover || "";

  const ratingVal   = ratingStr(game.rating);

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

  const ratingHtml = ratingVal
    ? `<div class="card-rating">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="#ffb347" stroke="none"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>
        ${ratingVal}
        <span class="rating-count">/10</span>
      </div>`
    : "";

  // Sumário: mostra o original (EN) imediatamente; a tradução é feita
  // async depois do render (translateCardSummaries).
  const summaryText = game.summary || t("Sem descrição disponível.");
  // Estado de lançamento traduzido para exibição
  const releaseStatusDisplay = game.releaseStatus ? t(game.releaseStatus) : "";

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
        <button class="card-addtab-btn" data-idx="${globalIdx}" aria-label="${escHtml(t("Adicionar a tab"))}" title="${escHtml(t("Adicionar a tab"))}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
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
        ${releaseStatusDisplay ? `<span class="card-release-status card-release-status--${releaseStatusClass(game.releaseStatus)}">${escHtml(releaseStatusDisplay)}</span>` : ""}
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

  // 1) Trailer principal primeiro
  if (videos.length > 0) {
    modalMediaList.push({ type: "video", src: youtubeEmbed(videos[0]), thumb: youtubeThumbnail(videos[0]) });
  }

  // 2) Screenshots
  screenshots.forEach(url => {
    modalMediaList.push({ type: "img", src: url });
  });

  // 3) Restantes trailers, pela mesma ordem
  videos.slice(1).forEach(vid => {
    modalMediaList.push({ type: "video", src: youtubeEmbed(vid), thumb: youtubeThumbnail(vid) });
  });
}

function renderModalMedia(idx) {
  modalIndex = Math.max(0, Math.min(idx, modalMediaList.length - 1));
  const item = modalMediaList[modalIndex];

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

  const mediaContent = item.type === "img"
    ? `<img src="${escHtml(item.src)}" alt="${escHtml(t("Screenshot"))}" onload="this.classList.add('loaded')"/>`
    : `<iframe src="${escHtml(item.src)}" allowfullscreen allow="autoplay; encrypted-media" onload="this.classList.add('loaded')"></iframe>`;

  $modalMedia.innerHTML = `
    <div class="modal-media-skeleton"></div>
    ${prevHtml}
    ${nextHtml}
    ${mediaContent}
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

  scheduleModalAutoAdvance(item);
}

// ─────────────────────────────────────────────
//  Auto-advance do modal-media:
//  - screenshot: avança após 5s idle
//  - vídeo: avança quando o YouTube reporta 'ended' (postMessage API)
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
  // YT IFrame API: event "infoDelivery", info.playerState === 0 → ended
  if (data && data.event === "infoDelivery" && data.info && data.info.playerState === 0) {
    goToNextModalMedia();
  }
}

function scheduleModalAutoAdvance(item) {
  clearModalAutoAdvance();
  if (!item) return;
  if (item.type === "img") {
    modalAutoTimer = setTimeout(goToNextModalMedia, 10000);
  } else {
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
  // Data: calculada on-the-fly a partir do timestamp, para usar o locale
  // do idioma activo (pt-PT ou en-GB).
  const dateStr = game.firstReleaseTs
    ? fullReleaseDateStr(game.firstReleaseTs)
    : (game.releaseDateFull || fallbackDisplay);
  // Release status: o valor interno é PT (identificador); traduz para exibição
  const statusStr = game.releaseStatus ? t(game.releaseStatus) : fallbackDisplay;
  const engineStr = (game.engines && game.engines.length)
    ? game.engines.join(", ") : fallbackDisplay;
  const languageStrVal = game.language || fallbackDisplay;

  // Modos de jogo (multiplayer, co-op, etc.) são mostrados nos tags — excluir daqui
  // Géneros substituem os themes no extra-info
  // (em PT, traduz tags via glossário; em EN, mantém original)
  const genresStr = (game.genres && game.genres.length)
    ? game.genres.map(translateTagSync).join(", ") : fallbackDisplay;

  const rows = [
    [t("Estúdio"), studioStr],
    [t("Desenvolvedor"), devStr],
    [t("Data de lançamento"), dateStr],
    [t("Estado de lançamento"), statusStr],
    [t("Engine"), engineStr],
    [t("Linguagem"), languageStrVal],
    [t("Géneros"), genresStr],
  ];

  $modalExtraInfo.innerHTML = rows.map(([label, value]) => `
    <div class="extra-info-row">
      <span class="extra-info-label">${escHtml(label)}</span>
      <span class="extra-info-value${value === fallbackDisplay ? " unknown" : ""}">${escHtml(value)}</span>
    </div>
  `).join("");
}

function openModal(gameIdx) {
  const game = gamesData[gameIdx];
  if (!game) return;
  modalOpen = true;
  _modalCurrentGame = game;

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

  $modalInfo.innerHTML = `
    <div class="modal-info-actions">
      ${modalQuickLinksHtml}
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
    <div class="modal-meta">${ratingHtml}</div>
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
  if (!$addtabModal.classList.contains("hidden")) closeAddTabModal();
  // Hide criar tab input if open
  $createTabBtn.classList.remove("hidden");
  $createTabInputWrap.classList.add("hidden");
  $createTabWrap.classList.add("hidden");
}

function toggleAdminPanel() {
  adminExpanded = !adminExpanded;
  $adminPanel.classList.toggle("expanded", adminExpanded);
  if (adminExpanded) setTimeout(() => $adminSearch.focus(), 150);
}

$adminFab.addEventListener("click", toggleAdminPanel);
$adminClose.addEventListener("click", closeAdmin);
$adminOverlay.addEventListener("keydown", e => {
  if (e.key === "Escape") closeAdmin();
});

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
    showToast(isPt() ? "Apenas o admin pode limpar Reprovados." : "Only admin can clear Reprovados.");
    return;
  }
  if (!trashTabId) {
    showToast(isPt() ? "Não há Reprovados para limpar." : "No Reprovados to clear.");
    return;
  }
  const trashSet = tabGamesMap[trashTabId] || new Set();
  if (trashSet.size === 0) {
    showToast(isPt() ? "Reprovados está vazio." : "Reprovados is empty.");
    return;
  }
  // Confirmação
  const confirmMsg = isPt()
    ? `${t("Confirmar limpeza do lixo?")} (${trashSet.size} ${isPt() ? "jogos" : "games"})`
    : `${t("Confirm trash cleanup?")} (${trashSet.size} games)`;
  if (!confirm(confirmMsg)) return;

  try {
    await saveTabGames(trashTabId, new Set());
    showToast(isPt() ? "Reprovados limpo!" : "Reprovados cleared!");
  } catch (err) {
    console.error("[clearTrash] erro:", err);
    showToast(isPt() ? "Erro ao limpar Reprovados." : "Failed to clear Reprovados.");
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
    clearCache();
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
    clearCache();
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

  // Fecha resultados ao fazer scroll fora do header-search-results
  // Isto evita que os resultados fiquem abertos enquanto a pessoa
  // navega na página. Reabre ao clicar na pesquisa novamente.
  let _searchScrollClosed = false;
  window.addEventListener("scroll", () => {
    if (!$results.classList.contains("hidden")) {
      $results.classList.add("hidden");
      _searchScrollClosed = true;
    }
  }, { passive: true, capture: true });

  // Reabre os resultados ao clicar no input (se foram fechados por scroll)
  $input.addEventListener("focus", () => {
    if (_searchScrollClosed && $input.value.trim()) {
      _searchScrollClosed = false;
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
                    ${added ? "disabled" : ""}>
              ${added ? "✓" : t("+ Adicionar")}
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
      btn.textContent = "...";
      const success = await addGameForUser(igdbId);
      if (success) {
        btn.classList.add("added");
        btn.textContent = "✓";
      } else {
        btn.disabled = false;
        btn.textContent = t("+ Adicionar");
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

    // 3. Adiciona à colecção "games" (aparece em "all")
    await addDoc(collection(db, "games"), {
      igdbId,
      addedAt: serverTimestamp(),
      addedBy: currentUser.name,
    });

    // 4. Up-vote automático do user que adicionou.
    //    O up-vote fará com que o jogo apareça na tab do user
    //    (processado pelo listener de upvotes).
    pendingUpvotes.push({ igdbId, userId: currentUser.id, userName: currentUser.name });

    clearCache();
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
    clearCache();
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
      const confirmMsg = isPt() ? `Remover "${name}"?` : `Remove "${name}"?`;
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
    // Encontra a tab "Lixo" (se existir)
    const trashTab = tabsData.find(t => t.label === "Reprovados" || t.label === "Lixo" || t.label === "Trash" || t.label === "Rejected");
    trashTabId = trashTab ? trashTab.id : null;
    // Encontra a tab "Aprovados" (se existir)
    const approvedTab = tabsData.find(t => t.label === "Aprovados" || t.label === "Approved");
    approvedTabId = approvedTab ? approvedTab.id : null;
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
  onSnapshot(collection(db, "downvotes"), (snapshot) => {
    downvotesMap = {};
    snapshot.docs.forEach(d => {
      const data = d.data();
      if (!data.gameId) return;
      if (!downvotesMap[data.gameId]) downvotesMap[data.gameId] = new Set();
      downvotesMap[data.gameId].add(data.userId || d.id);
    });
    // Verifica se algum jogo atingiu o threshold e deve ser movido para o lixo
    processDownvoteThresholds();
    renderGameList(gamesData);
    // Se o modal estiver aberto, actualiza os contadores
    if (modalOpen && _modalCurrentGame) {
      updateModalVoteButtons(_modalCurrentGame);
    }
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
      // Remove o jogo da lista de escondidos (já não tem down-vote)
      hiddenGames.delete(firebaseId);
      saveHiddenGames();
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
  onSnapshot(collection(db, "upvotes"), (snapshot) => {
    upvotesMap = {};
    snapshot.docs.forEach(d => {
      const data = d.data();
      if (!data.gameId) return;
      if (!upvotesMap[data.gameId]) upvotesMap[data.gameId] = new Set();
      upvotesMap[data.gameId].add(data.userId || d.id);
    });
    // Processa jogos que devem ir para / sair da lista "Aprovados"
    processApprovedThresholds();
    renderGameList(gamesData);
    // Se o modal estiver aberto, actualiza os contadores
    if (modalOpen && _modalCurrentGame) {
      updateModalVoteButtons(_modalCurrentGame);
    }
  });
}

// Verifica quais jogos têm exatamente APPROVED_UPVOTE_COUNT (3) upvotes
// e garante que estão na lista "Aprovados". Remove os que já não têm.
// Cria a lista "Aprovados" automaticamente se não existir.
async function processApprovedThresholds() {
  if (!db) return;

  // Garante que approvedTabId está actualizado (procura em tabsData)
  if (!approvedTabId) {
    const approvedTab = tabsData.find(t => t.label === "Aprovados" || t.label === "Approved");
    if (approvedTab) approvedTabId = approvedTab.id;
  }

  // Garante que a tab "Aprovados" existe (só cria se realmente não existir)
  if (!approvedTabId) {
    // Verificação dupla em tabsData para evitar criar duplicados
    const existing = tabsData.find(t => t.label === "Aprovados" || t.label === "Approved");
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
        // Remove o jogo da lista de escondidos (tinha down-vote → agora tem up-vote)
        hiddenGames.delete(firebaseId);
        saveHiddenGames();
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
    showToast(isPt() ? "Apenas o admin pode criar Reprovados." : "Only admin can create Reprovados.");
    return;
  }

  // 1. Verifica em tabsData (estado local)
  const existingLocal = tabsData.find(t =>
    t.label === "Reprovados" || t.label === "Reprovados" || t.label === "Lixo" || t.label === "Trash" || t.label === "Rejected" || t.label === "Rejected"
  );
  if (existingLocal) {
    trashTabId = existingLocal.id;
    showToast(isPt() ? "Reprovados já existe." : "Reprovados already exists.");
    return;
  }

  // 2. Verifica no Firebase (para evitar duplicados se tabsData ainda não carregou)
  try {
    const snap = await getDocs(collection(db, "tabs"));
    const existingFb = snap.docs.find(d => {
      const label = d.data().label;
      return label === "Reprovados" || label === "Lixo" || label === "Trash" || label === "Rejected";
    });
    if (existingFb) {
      trashTabId = existingFb.id;
      showToast(isPt() ? "Reprovados já existe." : "Reprovados already exists.");
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
    showToast(isPt() ? "Reprovados criado!" : "Reprovados created!");
    processDownvoteThresholds();
  } catch (err) {
    console.error("[createTrashTab] erro:", err);
    showToast(isPt() ? "Erro ao criar Reprovados." : "Failed to create Reprovados.");
  }
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
  // Ordenação: "Aprovados" em 2º (sempre abaixo de Todos), "Lixo" em último.
  const sortedTabs = [...tabsData].sort((a, b) => {
    const aIsApproved = (a.label === "Aprovados" || a.label === "Approved") ? 1 : 0;
    const bIsApproved = (b.label === "Aprovados" || b.label === "Approved") ? 1 : 0;
    const aIsTrash = (a.label === "Reprovados" || a.label === "Lixo" || a.label === "Trash" || a.label === "Rejected") ? 1 : 0;
    const bIsTrash = (b.label === "Reprovados" || b.label === "Lixo" || b.label === "Trash" || b.label === "Rejected") ? 1 : 0;

    // Aprovados tem prioridade 0 (vem primeiro entre as tabs)
    // Outras tabs têm prioridade 1
    // Lixo tem prioridade 2 (vem sempre em último)
    const aPriority = aIsTrash ? 2 : (aIsApproved ? 0 : 1);
    const bPriority = bIsTrash ? 2 : (bIsApproved ? 0 : 1);
    if (aPriority !== bPriority) return aPriority - bPriority;
    return 0; // mantém ordem original (createdAt)
  });

  const options = [
    { id: "all", label: t("Todos"), count: gamesData.filter(g => !isInTrash(g.firebaseId)).length, deletable: false },
    ...sortedTabs.map(tab => {
      const set = tabGamesMap[tab.id] || new Set();
      const isTrash = (tab.label === "Reprovados" || tab.label === "Lixo" || tab.label === "Trash" || tab.label === "Rejected");
      const isApproved = (tab.label === "Aprovados" || tab.label === "Approved");
      return {
        id: tab.id,
        label: isTrash ? t("Reprovados") : (isApproved ? t("Aprovados") : tab.label),
        count: gamesData.filter(g => set.has(g.firebaseId)).length,
        deletable: !isTrash && !isApproved, // lixo e aprovados não são apagáveis
      };
    }),
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
      const confirmMsg = isPt()
        ? `Apagar a tab "${tabLabel}"?`
        : `Delete tab "${tabLabel}"?`;
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
//  O botão de upvotes tem 3 estados: off → upvotes (mais votados) → upvotes-rev (menos votados) → off
// ─────────────────────────────────────────────
function updateSortButtonsUI() {
  document.querySelectorAll(".sort-btn").forEach(b => {
    b.classList.remove("active", "reverse");
    if (b.dataset.sort === currentSort) {
      b.classList.add("active");
    } else if (b.dataset.sort === "upvotes" && currentSort === "upvotes-rev") {
      // Estado reverso: mesmo botão, mas com classe "reverse" (mostra downvote icon)
      b.classList.add("active", "reverse");
    }
  });
  // Toggle visibilidade dos icones up/down no botão de upvotes
  const votesBtn = document.querySelector(".sort-btn-votes");
  if (votesBtn) {
    const upIcon = votesBtn.querySelector(".sort-icon-up");
    const downIcon = votesBtn.querySelector(".sort-icon-down");
    const isReverse = currentSort === "upvotes-rev";
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
      // 3-state cycle: off → upvotes → upvotes-rev → off
      if (currentSort === "upvotes") {
        currentSort = "upvotes-rev";
      } else if (currentSort === "upvotes-rev") {
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
  if (isOpen) renderTagFilter();
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
//  ADD-TO-TAB MODAL
// ─────────────────────────────────────────────
function openAddTabModal(game) {
  addTabTargetGame = game;
  // Título: "Adicionar "{name}" a Tab" / "Add "{name}" to Tab"
  const titlePrefix = isPt() ? "Adicionar" : "Add";
  const titleSuffix = isPt() ? "a Tab" : "to Tab";
  $addtabTitle.textContent = `${titlePrefix} "${game.name}" ${titleSuffix}`;

  if (tabsData.length === 0) {
    const emptyMsg = isPt()
      ? "Nenhuma tab criada ainda.<br>Cria uma tab primeiro."
      : "No tabs created yet.<br>Create a tab first.";
    $addtabList.innerHTML = `<div class="addtab-empty">${emptyMsg}</div>`;
  } else {
    $addtabList.innerHTML = tabsData.map(tab => {
      const set = tabGamesMap[tab.id] || new Set();
      const inTab = set.has(game.firebaseId);
      return `
        <button class="addtab-item${inTab ? " in-tab" : ""}" data-tabid="${escHtml(tab.id)}">
          ${escHtml(tab.label)}
          ${inTab ? `<span class="addtab-check">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          </span>` : ""}
        </button>
      `;
    }).join("");

    $addtabList.querySelectorAll(".addtab-item").forEach(btn => {
      btn.addEventListener("click", async () => {
        const tabId = btn.dataset.tabid;
        if (!tabGamesMap[tabId]) tabGamesMap[tabId] = new Set();
        const set = tabGamesMap[tabId];
        if (set.has(game.firebaseId)) {
          set.delete(game.firebaseId);
        } else {
          set.add(game.firebaseId);
        }
        // Persiste no Firestore (global); o listener onSnapshot re-renderiza
        await saveTabGames(tabId, set);
        // Re-render imediato do modal para feedback visual
        openAddTabModal(game);
      });
    });
  }

  $addtabModal.classList.remove("hidden");
}

function closeAddTabModal() {
  $addtabModal.classList.add("hidden");
  addTabTargetGame = null;
}

$addtabClose.addEventListener("click", closeAddTabModal);
$addtabBackdrop.addEventListener("click", closeAddTabModal);
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !$addtabModal.classList.contains("hidden")) closeAddTabModal();
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
    });

    // Fecha ao clicar fora
    document.addEventListener("click", ev => {
      if (!wrap.contains(ev.target)) {
        wrap.classList.remove("open");
        trigger.setAttribute("aria-expanded", "false");
      }
    });
  }

  // 5. Ligar checkboxes de opções
  const showHiddenChk = document.getElementById("option-show-hidden");
  if (showHiddenChk) {
    showHiddenChk.checked = showHiddenGames;
    showHiddenChk.addEventListener("change", e => {
      e.stopPropagation();
      showHiddenGames = showHiddenChk.checked;
      try { localStorage.setItem("jce_show_hidden", showHiddenGames ? "1" : "0"); } catch (_) {}
      renderGameList(gamesData);
    });
  }

  const ytAutoplayChk = document.getElementById("option-yt-autoplay");
  if (ytAutoplayChk) {
    ytAutoplayChk.checked = youtubeAutoplay;
    ytAutoplayChk.addEventListener("change", e => {
      e.stopPropagation();
      youtubeAutoplay = ytAutoplayChk.checked;
      try { localStorage.setItem("jce_yt_autoplay", youtubeAutoplay ? "1" : "0"); } catch (_) {}
    });
  }
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
    showToast(isPt() ? "Nenhum jogo disponível para descobrir." : "No games available to discover.");
    return;
  }

  // Criar queue aleatória independente
  discoverQueue = shuffleArray([...availableGames]);
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
    $modalInfo.innerHTML = `
      <div class="modal-info-actions">
        ${modalQuickLinksHtml}
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
      <div class="modal-meta">${ratingHtml}</div>
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
  const releaseStatusDisplay = game.releaseStatus ? t(game.releaseStatus) : "";

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
        ${releaseStatusDisplay ? `<span class="card-release-status card-release-status--${releaseStatusClass(game.releaseStatus)}">${escHtml(releaseStatusDisplay)}</span>` : ""}
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
  // Restore sort/view button state
  updateSortButtonsUI();
  applyViewButtons();

  // Carrega preferências e jogos escondidos do localStorage
  loadPreferences();
  loadHiddenGames();

  // Init settings panel (bg carousel + blur + options)
  initSettings();

  // Render tabs (vazio até o Firestore responder)
  renderTabs();

  // Try to show games from cache immediately
  const cached = loadCache();
  if (cached && cached.length > 0) {
    gamesData = cached;
    renderGameList(cached);
    renderAdminList(cached);
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

  // Safety net: se o Firebase não responder em 6s (config inválida,
  // permissões, rede, etc.), dispensa o loader para não bloquear a UI.
  // O listener onSnapshot continuará activo e actualizará quando receber dados.
  setTimeout(() => {
    if (gamesData.length === 0 && typeof window.dismissLoader === "function") {
      window.dismissLoader();
    }
  }, 6000);

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
      renderTagFilter();
      renderTabs();
      // Re-renderiza as miniaturas de fundo (títulos traduzidos)
      renderCarousel();
      // Atualiza o label do blur (Off / Desligado)
      const blurLabel = document.getElementById("blur-value-label");
      if (blurLabel) {
        blurLabel.textContent = currentBlur === 0 ? t("Off") : `${currentBlur}px`;
      }
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

init();
