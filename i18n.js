// ═══════════════════════════════════════════════════════════════
//  i18n.js — Sistema de Tradução (PT-PT ↔ EN)
//  Jogos com Eles
//
//  • Default: Português de Portugal (pt-PT)
//  • Strings UI estáticas: dicionário hardcoded (rápido, offline)
//  • Conteúdo dinâmico (summaries, géneros, etc.): Google Translate
//    via backend proxy /api/translate (com cache em memória)
//  • Persistência: localStorage (jce_lang)
//  • API pública exposta em window.i18n
// ═══════════════════════════════════════════════════════════════

(function () {
  "use strict";

  // ─────────────────────────────────────────────
  //  CONFIG
  // ─────────────────────────────────────────────
  const LANG_KEY = "jce_lang";
  const SUPPORTED = ["pt", "en"];
  const DEFAULT_LANG = "en"; // English é o idioma padrão

  // ─────────────────────────────────────────────
  //  DICT — UI strings (PT-PT ↔ EN)
  //  Keys são em PT-PT; o valor é a tradução EN.
  //  Em modo EN: t() devolve o valor (tradução EN).
  //  Em modo PT: t() devolve a key (PT original).
  //
  //  Em modo EN não há chamadas ao Google Translate:
  //  os dados do IGDB já vêm em inglês, e as strings
  //  estáticas usam este dicionário (lookup instantâneo).
  // ─────────────────────────────────────────────
  const DICT = {
    // ── Título & meta ───────────────────────────
    "Jogos com Eles": "Games with Them",

    // ── Loader ──────────────────────────────────
    "A carregar jogos...": "Loading games...",
    "A iniciar...": "Starting up...",
    "A preparar...": "Preparing...",
    "Quase...": "Almost there...",

    // ── Empty / loading states ──────────────────
    "Ainda não há jogos na lista.": "No games in the list yet.",

    // ── Admin panel ─────────────────────────────
    "Modo Administrador": "Administrator Mode",
    "Pesquisar Jogo": "Search Game",
    "Nome do jogo...": "Game name...",
    "Na lista": "In the list",
    "Nenhum jogo adicionado ainda.": "No games added yet.",
    "Forçar Loading": "Force Loading",
    "A Forçar Loading...": "Forcing Loading...",
    "Nenhum resultado encontrado.": "No results found.",
    "Erro ao pesquisar. Verifica as credenciais IGDB.":
      "Search failed. Check the IGDB credentials.",
    "A pesquisar...": "Searching...",
    "+ Adicionar": "+ Add",
    "✓ Adicionado": "✓ Added",
    "A adicionar...": "Adding...",
    "Jogo adicionado com sucesso!": "Game added successfully!",
    "Erro ao adicionar jogo.": "Failed to add game.",
    "Jogo removido.": "Game removed.",
    "Erro ao remover jogo.": "Failed to remove game.",
    "Key art atualizada.": "Key art updated.",
    "Erro ao atualizar key art.": "Failed to update key art.",
    "Sem imagens disponíveis.": "No images available.",
    "Remover": "Remove",
    "Erro ao criar tab.": "Failed to create tab.",
    "Erro ao apagar tab.": "Failed to delete tab.",
    "Erro ao guardar jogos da tab:": "Failed to save tab games:",

    // ── Tabs ────────────────────────────────────
    "Todos": "All",
    "Criar_Tab": "Create_Tab",
    "Nome da tab...": "Tab name...",
    "Apagar tab": "Delete tab",

    // ── Tag filter ──────────────────────────────
    "Filtrar": "Filter",
    "Géneros & Temas": "Genres & Themes",
    "Estado de Lançamento": "Release Status",
    "Limpar": "Clear",

    // ── Discover button ─────────────────────────
    "Descobre": "Discover",
    "Novidade": "New",

    // ── Settings (gear menu) ────────────────────
    "Aspeto": "Appearance",
    "Fundo": "Background",
    "Desfoque de fundo": "Background blur",
    "Idioma": "Language",
    "Português": "Portuguese",
    "Inglês": "English",
    "Off": "Off",

    // ── Sort buttons ────────────────────────────
    "Aleatório": "Random",
    "A–Z": "A–Z",
    "Nota": "Rating",
    "Ordem aleatória": "Random order",
    "Ordenar por nome": "Sort by name",
    "Ordenar por nota": "Sort by rating",

    // ── View modes ──────────────────────────────
    "Grelha (4 col)": "Grid (4 cols)",
    "Grelha (5 col)": "Grid (5 cols)",
    "Compacto (6 col)": "Compact (6 cols)",

    // ── Card / modal ────────────────────────────
    "Ver detalhes de": "View details of",
    "Remover jogo": "Remove game",
    "Adicionar a tab": "Add to tab",
    "Editar key art": "Edit key art",
    "Anterior": "Previous",
    "Próximo": "Next",
    "Screenshot": "Screenshot",
    "Copiar nome do jogo": "Copy game name",
    "Expandir descrição": "Expand description",
    "Sem descrição disponível.": "No description available.",
    "Escolher Key Art": "Choose Key Art",
    "Adicionar a Tab": "Add to Tab",

    // ── Extra info labels (modal) ───────────────
    "Estúdio": "Studio",
    "Desenvolvedor": "Developer",
    "Data de lançamento": "Release date",
    "Estado de lançamento": "Release status",
    "Engine": "Engine",
    "Linguagem": "Language",
    "Géneros": "Genres",
    "Não disponível": "Not available",

    // ── Add-to-tab modal ────────────────────────
    "Nenhuma tab criada ainda.\nCria uma tab primeiro.":
      "No tabs created yet.\nCreate a tab first.",

    // ── Registration & Search (header) ──────────
    "Registar": "Sign Up",
    "Pesquisar jogos...": "Search games...",
    "Regista-te primeiro para pesquisar.": "Sign up first to search.",
    "Regista-te primeiro para votar.": "Sign up first to vote.",
    "Nome (máx 8)...": "Name (max 8)...",
    "Nome já existe.": "Name already exists.",
    "Código admin já utilizado.": "Admin code already used.",
    "Nome muito curto (mín 2 caracteres).": "Name too short (min 2 chars).",
    "Nome muito curto.": "Name too short.",
    "Bem-vindo,": "Welcome,",
    "Erro ao atualizar nome.": "Failed to update name.",
    "Erro ao registar.": "Registration failed.",
    "Servidor não responde.": "Server not responding.",
    "Erro ao criar tab.": "Failed to create tab.",
    "Erro ao apagar tab.": "Failed to delete tab.",
    "Erro ao guardar jogos da tab:": "Failed to save tab games:",
    "A pesquisar...": "Searching...",
    "Nenhum resultado.": "No results.",
    "Nenhum resultado encontrado.": "No results found.",
    "Erro ao pesquisar. Verifica as credenciais IGDB.": "Search failed. Check the IGDB credentials.",
    "+ Adicionar": "+ Add",
    "✓ Adicionado": "✓ Added",
    "A adicionar...": "Adding...",
    "Jogo adicionado com sucesso!": "Game added successfully!",
    "Erro ao adicionar jogo.": "Failed to add game.",
    "Jogo removido.": "Game removed.",
    "Erro ao remover jogo.": "Failed to remove game.",
    "Key art atualizada.": "Key art updated.",
    "Erro ao atualizar key art.": "Failed to update key art.",
    "Sem imagens disponíveis.": "No images available.",
    "Tab criada (modo demo).": "Tab created (demo mode).",
    "Demo: não é possível adicionar jogos sem Firebase.": "Demo: cannot add games without Firebase.",
    "Já na lista": "Already in list",
    "Enter para confirmar": "Enter to confirm",
    "Conta": "Account",
    "Editar nome": "Edit name",
    "Nome atualizado!": "Name updated!",
    "Novo nome...": "New name...",
    "Guardar": "Save",
    "Jogo adicionado por": "Game added by",
    "Jogo não encontrado.": "Game not found.",
    "Jogo adicionado!": "Game added!",
    "Erro ao adicionar.": "Failed to add.",
    "Erro ao votar.": "Failed to vote.",
    "Remover": "Remove",

    // ── Admin / Trash ───────────────────────────
    "Apenas o admin pode limpar o lixo.": "Only admin can clear trash.",
    "Não há lixo para limpar.": "No trash to clear.",
    "O lixo está vazio.": "Trash is empty.",
    "Lixo limpo!": "Trash cleared!",
    "Erro ao limpar lixo.": "Failed to clear trash.",
    "Apenas o admin pode criar o lixo.": "Only admin can create trash.",
    "O lixo já existe.": "Trash already exists.",
    "Lixo criado!": "Trash created!",
    "Erro ao criar lixo.": "Failed to create trash.",

    // ── Game approval (online play) ─────────────
    "Jogo rejeitado:": "Game rejected:",
    "Este jogo não tem multiplayer online.": "This game has no online multiplayer.",
    "Apenas jogos com online play são permitidos.": "Only online play games are allowed.",

    // ── Down-vote & Up-vote system ──────────────
    "Reprovados": "Rejected",
    "Aprovados": "Approved",
    "Criar Reprovados": "Create Rejected",
    "Limpar Reprovados": "Clear Rejected",
    "Confirmar limpeza do lixo?": "Confirm cleanup?",
    "Lixo": "Rejected",
    "Votar a favor": "Up-vote",
    "Votar contra": "Down-vote",

    // ── Jogados (played) system ─────────────────
    "Jogados": "Played",
    "Marcar como jogado": "Mark as played",
    "Reverter": "Revert",
    "Marcado como jogado.": "Marked as played.",
    "Jogo revertido.": "Game reverted.",
    "Erro ao criar Jogados.": "Failed to create Played.",

    "Remover voto": "Remove vote",
    "votos contra": "down-votes",
    "votos a favor": "up-votes",
    "Upvotes": "Upvotes",
    "Downvotes": "Downvotes",
    "Movido para o lixo.": "Moved to trash.",
    "Grupo completo": "Group full",
    "Mais votados": "Most up-votes",
    "Menos votados": "Most down-votes",
    "Mais up-votes": "Most up-votes",
    "Mais down-votes": "Most down-votes",
    "Votos": "Votes",
    "Nenhum voto": "No votes",
    "Jogos em comum": "Games in common",
    "Nenhum outro utilizador registado.": "No other users registered.",
    "Opções": "Options",
    "Mostrar jogos escondidos": "Show hidden games",
    "YouTube autoplay": "YouTube autoplay",

    // ── Release statuses (IGDB status enum) ─────
    "Lançado": "Released",
    "Alpha": "Alpha",
    "Beta": "Beta",
    "Acesso Antecipado": "Early Access",
    "Offline": "Offline",
    "Cancelado": "Cancelled",
    "Rumor": "Rumoured",
    "Removido de venda": "Delisted",
    "Por lançar": "Unreleased",

    // ── Confirm dialogs ─────────────────────────
    "Apagar a tab": "Delete tab",
    "?": "?",
  };

  // ─────────────────────────────────────────────
  //  GLOSSÁRIO — termos IGDB frequentes
  //  (tradução instantânea, sem chamada à API)
  //  PT-PT primeiro; valor EN.
  //  Nota: para PT-PT, mantemos o original IGDB (que é EN) só se
  //  a tradução PT fizer sentido; caso contrário fica EN.
  // ─────────────────────────────────────────────
  const GLOSSARY = {
    // Géneros comuns
    "Role-playing (RPG)": { pt: "Role-playing (RPG)", en: "Role-playing (RPG)" },
    "Real Time Strategy (RTS)": { pt: "Estratégia em tempo real (RTS)", en: "Real Time Strategy (RTS)" },
    "Turn-based strategy (TBS)": { pt: "Estratégia por turnos (TBS)", en: "Turn-based strategy (TBS)" },
    "Shooter": { pt: "Tiro", en: "Shooter" },
    "Adventure": { pt: "Aventura", en: "Adventure" },
    "Platform": { pt: "Plataformas", en: "Platform" },
    "Puzzle": { pt: "Puzzle", en: "Puzzle" },
    "Racing": { pt: "Corrida", en: "Racing" },
    "Simulator": { pt: "Simulador", en: "Simulator" },
    "Sport": { pt: "Desporto", en: "Sport" },
    "Strategy": { pt: "Estratégia", en: "Strategy" },
    "Tactical": { pt: "Tático", en: "Tactical" },
    "Hack and slash/Beat 'em up": { pt: "Hack and slash/Beat 'em up", en: "Hack and slash/Beat 'em up" },
    "Indie": { pt: "Indie", en: "Indie" },
    "Arcade": { pt: "Arcada", en: "Arcade" },
    "Point-and-click": { pt: "Apontar e clicar", en: "Point-and-click" },
    "Music": { pt: "Música", en: "Music" },
    "Quiz/Trivia": { pt: "Quiz/Trivial", en: "Quiz/Trivia" },
    "MOBA": { pt: "MOBA", en: "MOBA" },
    "Card & Board Game": { pt: "Cartas e Tabuleiro", en: "Card & Board Game" },
    "Visual Novel": { pt: "Novela Visual", en: "Visual Novel" },

    // Temas
    "Action": { pt: "Ação", en: "Action" },
    "Fantasy": { pt: "Fantasia", en: "Fantasy" },
    "Science fiction": { pt: "Ficção científica", en: "Science fiction" },
    "Horror": { pt: "Terror", en: "Horror" },
    "Thriller": { pt: "Suspense", en: "Thriller" },
    "Survival": { pt: "Sobrevivência", en: "Survival" },
    "Historical": { pt: "Histórico", en: "Historical" },
    "Stealth": { pt: "Furtividade", en: "Stealth" },
    "Comedy": { pt: "Comédia", en: "Comedy" },
    "Business": { pt: "Negócios", en: "Business" },
    "Drama": { pt: "Drama", en: "Drama" },
    "Erotic": { pt: "Erótico", en: "Erotic" },
    "Mystery": { pt: "Mistério", en: "Mystery" },
    "Romance": { pt: "Romance", en: "Romance" },
    "Sandbox": { pt: "Sandbox", en: "Sandbox" },
    "Open world": { pt: "Mundo aberto", en: "Open world" },
    "Warfare": { pt: "Guerra", en: "Warfare" },
    "4X (explore, expand, exploit, and exterminate)": {
      pt: "4X (explorar, expandir, explorar e exterminar)",
      en: "4X (explore, expand, exploit, and exterminate)",
    },
    "Educational": { pt: "Educativo", en: "Educational" },
    "Kids": { pt: "Infantil", en: "Kids" },
    "Mature": { pt: "Adulto", en: "Mature" },
    "Party": { pt: "Festa", en: "Party" },
    "Trivia": { pt: "Trivial", en: "Trivia" },
    "Turn-based": { pt: "Por turnos", en: "Turn-based" },
    "Side view": { pt: "Vista lateral", en: "Side view" },
    "Top-down": { pt: "Vista de cima", en: "Top-down" },

    // Modos de jogo
    "Single player": { pt: "Um jogador", en: "Single player" },
    "Multiplayer": { pt: "Multijogador", en: "Multiplayer" },
    "Co-operative": { pt: "Cooperativo", en: "Co-operative" },
    "Split screen": { pt: "Ecrã dividido", en: "Split screen" },
    "Massively Multiplayer Online (MMO)": {
      pt: "Massivamente Multijogador Online (MMO)",
      en: "Massively Multiplayer Online (MMO)",
    },
    "Battle Royale": { pt: "Battle Royale", en: "Battle Royale" },
  };

  // ─────────────────────────────────────────────
  //  STATE
  // ─────────────────────────────────────────────
  let currentLang = DEFAULT_LANG;
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved && SUPPORTED.includes(saved)) currentLang = saved;
  } catch (_) {}

  // Cache de traduções dinâmicas (Google Translate)
  // chave: `${lang}::${text}` → tradução
  const translateCache = new Map();

  // Callbacks a chamar quando o idioma muda (para re-render)
  const langChangeCallbacks = new Set();

  // ─────────────────────────────────────────────
  //  HELPERS
  // ─────────────────────────────────────────────
  function isPt() { return currentLang === "pt"; }

  function applyHtmlLang() {
    document.documentElement.lang = currentLang === "pt" ? "pt-PT" : "en";
  }

  // Traduz uma string estática (procura no DICT; fallback = própria string)
  function t(key) {
    if (key == null) return "";
    const k = String(key);
    if (isPt()) return k;
    return DICT[k] != null ? DICT[k] : k;
  }

  // Traduz um termo do glossário; devolve null se não estiver no glossário
  function glossaryLookup(text) {
    if (text == null) return null;
    const entry = GLOSSARY[String(text).trim()];
    if (!entry) return null;
    return entry[currentLang] || entry.en || text;
  }

  // ─────────────────────────────────────────────
  //  APLICAR TRADUÇÕES AO DOM (data-i18n attrs)
  // ─────────────────────────────────────────────
  function applyTranslations(root) {
    const scope = root || document;

    scope.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      const val = t(key);
      // Preserva filhos SVG/IMG: substitui só o primeiro text node
      // ou, se o elemento só tiver texto, substitui tudo.
      const firstChild = el.firstChild;
      if (firstChild && firstChild.nodeType === Node.TEXT_NODE && el.childNodes.length === 1) {
        firstChild.nodeValue = val;
      } else if (el.childNodes.length === 0) {
        el.textContent = val;
      } else {
        // Tem filhos não-texto: substitui só o texto leading/trailing
        // Caso típico: <button><svg/>Texto</button>
        let replaced = false;
        for (let i = 0; i < el.childNodes.length; i++) {
          const node = el.childNodes[i];
          if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim()) {
            node.nodeValue = val;
            replaced = true;
            break;
          }
        }
        if (!replaced) {
          // Sem text node — acrescenta no fim
          el.appendChild(document.createTextNode(val));
        }
      }
    });

    scope.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      el.placeholder = t(el.getAttribute("data-i18n-placeholder"));
    });

    scope.querySelectorAll("[data-i18n-title]").forEach((el) => {
      el.title = t(el.getAttribute("data-i18n-title"));
    });

    scope.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
      el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria-label")));
    });

    scope.querySelectorAll("[data-i18n-aria-label-template]").forEach((el) => {
      // Template com variável: usar data-i18n-var="valor"
      const tmpl = el.getAttribute("data-i18n-aria-label-template");
      const variable = el.getAttribute("data-i18n-var") || "";
      el.setAttribute("aria-label", `${t(tmpl)} ${variable}`);
    });
  }

  // ─────────────────────────────────────────────
  //  TRADUÇÃO DINÂMICA (Google Translate)
  //  Usada para summaries, géneros fora do glossário, etc.
  //
  //  Estratégia com fallback em cascata:
  //    1. Glossário (instantâneo, offline)
  //    2. Cache local (evita chamadas repetidas)
  //    3. Backend proxy /api/translate (quando corre via Next.js)
  //    4. Google Translate via proxy CORS (quando corre standalone)
  //    5. MyMemory API directa (CORS-friendly, último recurso)
  //
  //  ⚠️  Em modo EN: NÃO há chamadas ao Google Translate.
  //      Os dados do IGDB já vêm em inglês, e as strings estáticas
  //      usam o DICT (lookup instantâneo). O Google Translate só é
  //      usado para traduzir sumários/tags do EN → PT.
  // ─────────────────────────────────────────────
  async function translateText(text, targetLang) {
    if (text == null) return "";
    const trimmed = String(text);
    if (!trimmed.trim()) return trimmed;

    const lang = targetLang || currentLang;

    // ⚠️  Em EN: os dados do IGDB já vêm em inglês — devolve as-is.
    //     Zero chamadas a APIs externas.
    if (lang === "en") {
      return trimmed;
    }

    // 1. Glossário (instantâneo) — só para PT
    const glossary = glossaryLookup(trimmed);
    if (glossary != null) return glossary;

    // 2. Cache
    const cacheKey = `${lang}::${trimmed}`;
    if (translateCache.has(cacheKey)) {
      return translateCache.get(cacheKey);
    }

    // 3. Backend proxy (Next.js API route)
    //    Só funciona quando o site corre através do Next.js dev server.
    //    Em servidores estáticos (Python http.server, etc.) devolve 404.
    let translated = null;
    try {
      const url = `/api/translate?target=${encodeURIComponent(lang)}&text=${encodeURIComponent(trimmed)}`;
      const res = await fetch(url, { method: "GET" });
      if (res.ok) {
        const data = await res.json();
        if (data && data.translatedText) {
          translated = data.translatedText;
        }
      }
      // Se 404 ou outro erro, cai para o método directo
    } catch (_) { /* rede — tenta método directo */ }

    // 4. Google Translate via proxy CORS
    //    O endpoint free do Google não envia headers CORS, por isso
    //    usamos um proxy CORS público. Tentamos vários por ordem.
    if (!translated) {
      translated = await translateViaCorsProxy(trimmed, lang);
    }

    // 5. MyMemory API directa (CORS-friendly, último recurso)
    //    Requer idioma de origem; assumimos EN (maioria dos summaries IGDB).
    if (!translated) {
      translated = await translateViaMyMemory(trimmed, lang);
    }

    if (translated) {
      translateCache.set(cacheKey, translated);
      return translated;
    }

    console.warn("[i18n] translateText falhou (todos os métodos):", trimmed.slice(0, 60));
    return trimmed;
  }

  // Google Translate free endpoint via proxy CORS.
  // Tenta vários proxies por ordem até um funcionar.
  async function translateViaCorsProxy(text, lang) {
    const gtUrl =
      "https://translate.googleapis.com/translate_a/single" +
      `?client=gtx&sl=auto&tl=${encodeURIComponent(lang)}&dt=t` +
      `&q=${encodeURIComponent(text)}`;

    const proxies = [
      (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
      (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
      (u) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}`,
    ];

    for (const makeProxyUrl of proxies) {
      try {
        const res = await fetch(makeProxyUrl(gtUrl), { method: "GET" });
        if (!res.ok) continue;
        const data = await res.json();
        // Resposta: [ [ ["tradução","original",...], ... ], null, "en", ... ]
        if (Array.isArray(data) && Array.isArray(data[0])) {
          const result = data[0]
            .map((seg) =>
              Array.isArray(seg) && typeof seg[0] === "string" ? seg[0] : ""
            )
            .join("");
          if (result && result.trim()) return result;
        }
      } catch (_) { /* tenta próximo proxy */ }
    }
    return null;
  }

  // MyMemory API — gratuita e CORS-friendly.
  // Requer langpair=SOURCE|TARGET; assumimos EN como origem.
  async function translateViaMyMemory(text, lang) {
    try {
      const url =
        `https://api.mymemory.translated.net/get` +
        `?q=${encodeURIComponent(text)}` +
        `&langpair=en|${encodeURIComponent(lang)}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      if (data && data.responseData && data.responseData.translatedText) {
        const t = data.responseData.translatedText;
        // Filtra mensagens de erro/quota do MyMemory
        if (
          t.startsWith("MYMEMORY WARNING") ||
          t === "PLEASE SELECT TWO DISTINCT LANGUAGES" ||
          t.startsWith("INVALID LANGUAGE PAIR")
        ) {
          return null;
        }
        return t;
      }
    } catch (_) { /* falha */ }
    return null;
  }

  // Traduz um lote de textos em paralelo (mais eficiente)
  async function translateBatch(texts, targetLang) {
    if (!texts || texts.length === 0) return [];
    const lang = targetLang || currentLang;
    return Promise.all(
      texts.map((txt) => translateText(txt, lang))
    );
  }

  // ─────────────────────────────────────────────
  //  MUDANÇA DE IDIOMA
  // ─────────────────────────────────────────────

  // Actualiza o estado "active" dos botões do selector de idioma
  // para reflectir o idioma actual. Chamada no init e no setLang.
  function updateLangButtonsActive() {
    document.querySelectorAll(".lang-option").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.lang === currentLang);
    });
  }

  function setLang(lang) {
    if (!SUPPORTED.includes(lang)) lang = DEFAULT_LANG;
    if (lang === currentLang) return;
    currentLang = lang;
    try { localStorage.setItem(LANG_KEY, lang); } catch (_) {}
    applyHtmlLang();
    applyTranslations();
    updateLangButtonsActive();
    // Notifica listeners (app.js re-renderiza)
    langChangeCallbacks.forEach((cb) => {
      try { cb(lang); } catch (e) { console.error("[i18n] listener erro:", e); }
    });
  }

  function onLanguageChange(cb) {
    if (typeof cb === "function") langChangeCallbacks.add(cb);
  }

  function getCurrentLang() { return currentLang; }

  // ─────────────────────────────────────────────
  //  INIT
  // ─────────────────────────────────────────────
  applyHtmlLang();

  // Expõe API global
  window.i18n = {
    t,
    translateText,
    translateBatch,
    setLang,
    getCurrentLang,
    onLanguageChange,
    applyTranslations,
    glossaryLookupSync: glossaryLookup,
    updateLangButtonsActive,
    isPt,
    SUPPORTED,
    DEFAULT_LANG,
  };

  // Aplica traduções + actualiza botões quando o DOM estiver pronto
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      applyTranslations();
      updateLangButtonsActive();
    });
  } else {
    applyTranslations();
    updateLangButtonsActive();
  }

  // Liga botões de selector de idioma (delegação de eventos)
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".lang-option");
    if (btn && btn.dataset.lang) {
      e.preventDefault();
      e.stopPropagation();
      setLang(btn.dataset.lang);
    }
  });
})();
