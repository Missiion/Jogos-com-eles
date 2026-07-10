// ═══════════════════════════════════════════════════════════════
//  apps.js — Apps Win95 + Start Menu (data-driven)
//  Jogos com Eles · CRT Computer
//
//  Apps disponíveis (cada uma abre numa janela via window.wm):
//    • Notepad — bloco de notas funcional (textarea)
//    • MS-DOS — prompt com comandos básicos (dir, cls, echo, help, ver, date, time)
//    • My Computer — explorador de ficheiros simples (drives A:, C:, D:)
//    • About / Casa·Norte — janela "Sobre" com info do sistema
//    • Recycle Bin — janela vazia com botão Empty
//
//  Start Menu (data-driven + escalável):
//    Estrutura de items que pode ser extendida no futuro.
//    Cada item: { label, icon, action, submenu? }
//    Submenu recursivo suportado.
//
//  API: window.apps.open(appId), window.startmenu.toggle()
// ═══════════════════════════════════════════════════════════════

(function () {
  "use strict";

  // ─────────────────────────────────────────────
  //  i18n helper — traduz strings visíveis ao utilizador.
  //  Em modo PT devolve a key (string original em PT);
  //  em modo EN devolve a tradução do DICT (em i18n.js).
  //  Fallback: se o i18n ainda não estiver carregado,
  //  devolve a própria key (PT).
  // ─────────────────────────────────────────────
  function t(key) {
    if (window.i18n && typeof window.i18n.t === "function") return window.i18n.t(key);
    return key;
  }

  // ─────────────────────────────────────────────
  //  FICHEIROS DO LIXO (Recycle Bin)
  //  Definidos no top-level para que possam ser pré-carregados assim
  //  que o computador abre (não só quando o utilizador abre o lixo).
  //  Isto evita que as fotos apareçam em branco enquanto carregam.
  //
  //  Cada ficheiro: { name, iconType, iconSrc?, iconSvg?, fullSrc? }
  //    • iconType "img"  → foto como ícone (32px no lixo, grande no viewer)
  //    • iconType "svg"  → ícone SVG desenhado (ZIP)
  //    • fullSrc → URL da imagem em tamanho grande (para o visualizador)
  // ─────────────────────────────────────────────
  const TRASH_FILES = [
    { name: "Claudio.u", iconType: "img",
      iconSrc: "https://github.com/Missiion/Jogos-com-eles/blob/main/claudio.png?raw=true",
      fullSrc: "https://github.com/Missiion/Jogos-com-eles/blob/main/claudio.png?raw=true" },
    { name: "Miguel.u", iconType: "img",
      iconSrc: "https://github.com/Missiion/Jogos-com-eles/blob/main/miguel.png?raw=true",
      fullSrc: "https://github.com/Missiion/Jogos-com-eles/blob/main/miguel.png?raw=true" },
    { name: "Leo.u", iconType: "img",
      iconSrc: "https://github.com/Missiion/Jogos-com-eles/blob/main/leo.png?raw=true",
      fullSrc: "https://github.com/Missiion/Jogos-com-eles/blob/main/leo.png?raw=true" },
    { name: "Nudes_do_Claudio.zip", iconType: "zip" },
  ];

  // Pré-carrega as imagens do lixo em cache do browser.
  // Chamado quando o computador CRT abre (computer.js open()) para que,
  // ao abrir o lixo, as fotos já estejam em cache e apareçam instantaneamente.
  // As imagens são guardadas num Map para reuso imediato no visualizador.
  const trashImageCache = new Map();
  let trashPreloaded = false;
  function preloadTrashImages() {
    if (trashPreloaded) return;
    trashPreloaded = true;
    TRASH_FILES.forEach(function (f) {
      if (f.iconType !== "img" || !f.iconSrc) return;
      const img = new Image();
      img.onload = function () { trashImageCache.set(f.iconSrc, img); };
      img.onerror = function () { /* fallback SVG trata */ };
      img.src = f.iconSrc;
    });
  }

  // ─────────────────────────────────────────────
  //  VISUALIZADOR DE IMAGENS (image viewer)
  //  Abre uma janela Win95 com a imagem em ponto grande.
  //  Estilo "Windows 98 Image Preview" — fundo cinza, imagem centrada,
  //  título com o nome do ficheiro.
  // ─────────────────────────────────────────────
  function openImageViewer(src, name) {
    if (!window.wm) return;
    const content = document.createElement("div");
    content.className = "app-imageviewer";
    content.innerHTML =
      '<div class="app-imageviewer-toolbar">' +
        '<span class="app-imageviewer-filename">' + escapeHtml(name) + '</span>' +
      '</div>' +
      '<div class="app-imageviewer-stage">' +
        '<img class="app-imageviewer-img" alt="' + escapeHtml(name) + '" />' +
        '<div class="app-imageviewer-loading">' + t("A carregar...") + '</div>' +
        '<div class="app-imageviewer-error hidden">' + t("Não foi possível carregar a imagem.") + '</div>' +
      '</div>';
    const img = content.querySelector(".app-imageviewer-img");
    const loading = content.querySelector(".app-imageviewer-loading");
    const errorEl = content.querySelector(".app-imageviewer-error");
    img.style.display = "none";
    img.onload = function () {
      img.style.display = "";
      if (loading) loading.style.display = "none";
    };
    img.onerror = function () {
      if (loading) loading.style.display = "none";
      if (errorEl) errorEl.classList.remove("hidden");
      img.style.display = "none";
    };
    img.src = src;
    window.wm.open({
      id: "imageviewer-" + Date.now(),
      title: name,
      icon: ICONS.media,
      width: 520, height: 440,
      content: content,
    });
  }

  // ─────────────────────────────────────────────
  //  ÍCONES SVG (partilhados)
  // ─────────────────────────────────────────────
  const ICONS = {
    notepad: '<svg width="16" height="16" viewBox="0 0 32 32"><rect x="6" y="8" width="20" height="18" rx="1" fill="#c8c8c8" stroke="#000"/><rect x="6" y="8" width="20" height="3" fill="#000080"/><rect x="8" y="13" width="16" height="11" fill="#fff"/><circle cx="16" cy="18" r="2" fill="#000080"/><rect x="12" y="22" width="8" height="2" fill="#808080"/></svg>',
    dos: '<svg width="16" height="16" viewBox="0 0 32 32"><rect x="4" y="6" width="24" height="20" rx="1" fill="#c8c8c8" stroke="#000"/><rect x="6" y="8" width="20" height="3" fill="#000080"/><rect x="6" y="12" width="20" height="12" fill="#000"/><text x="16" y="21" font-size="7" text-anchor="middle" fill="#fff" font-family="monospace">C:\\</text></svg>',
    mycomputer: '<svg width="16" height="16" viewBox="0 0 32 32"><rect x="3" y="5" width="26" height="20" rx="1" fill="#c8c8c8" stroke="#000"/><rect x="5" y="7" width="22" height="14" fill="#000080"/><rect x="12" y="25" width="8" height="2" fill="#c8c8c8"/><rect x="10" y="27" width="12" height="2" rx="1" fill="#c8c8c8"/></svg>',
    about: '<svg width="16" height="16" viewBox="0 0 32 32"><rect x="4" y="4" width="24" height="24" rx="1" fill="#c8c8c8" stroke="#000"/><rect x="6" y="6" width="20" height="20" fill="#008080"/><path d="M16 9l5 4-5 4-5-4z" fill="#fff"/><path d="M16 14l5 4-5 4-5-4z" fill="#ffb347"/></svg>',
    recycle: '<svg width="16" height="16" viewBox="0 0 32 32"><path d="M16 4l12 6v12l-12 6L4 22V10z" fill="#c8c8c8" stroke="#000"/><path d="M16 4l12 6-12 6L4 10z" fill="#000080"/><path d="M4 10v12l12 6V16z" fill="#808080"/></svg>',
    programs: '<svg width="16" height="16" viewBox="0 0 16 16"><rect x="1" y="2" width="14" height="12" rx="1" fill="#ffc030" stroke="#000"/><rect x="3" y="4" width="10" height="2" fill="#fff"/><rect x="3" y="7" width="10" height="2" fill="#fff"/><rect x="3" y="10" width="7" height="2" fill="#fff"/></svg>',
    run: '<svg width="16" height="16" viewBox="0 0 16 16"><rect x="1" y="3" width="14" height="10" rx="1" fill="#c8c8c8" stroke="#000"/><rect x="2" y="6" width="12" height="6" fill="#000"/><text x="8" y="11" font-size="5" text-anchor="middle" fill="#0f0" font-family="monospace">&gt;_</text></svg>',
    shutdown: '<svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="#c00" stroke-width="2"/><rect x="7" y="2" width="2" height="6" fill="#c00"/></svg>',
    help: '<svg width="16" height="16" viewBox="0 0 16 16"><rect x="1" y="2" width="14" height="12" rx="1" fill="#ffc030" stroke="#000"/><text x="8" y="11" font-size="9" text-anchor="middle" fill="#000" font-family="serif" font-weight="bold">?</text></svg>',
    settings: '<svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.5" fill="none" stroke="#000" stroke-width="1.2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M3 13l1.4-1.4M11.6 4.4L13 3" stroke="#000" stroke-width="1.2" stroke-linecap="round"/></svg>',
    display: '<svg width="16" height="16" viewBox="0 0 16 16"><rect x="1" y="2" width="14" height="10" rx="1" fill="#c8c8c8" stroke="#000"/><rect x="2" y="3" width="12" height="8" fill="#008080"/><rect x="6" y="12" width="4" height="1" fill="#000"/><rect x="5" y="13" width="6" height="1" fill="#c8c8c8"/></svg>',
    sound: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M2 6h3l3-2v8l-3-2H2z" fill="#c8c8c8" stroke="#000"/><path d="M10 5a3 3 0 010 6" fill="none" stroke="#000" stroke-width="1.2"/><path d="M12 3a5 5 0 010 10" fill="none" stroke="#000" stroke-width="1.2"/></svg>',
    media: '<svg width="16" height="16" viewBox="0 0 32 32"><rect x="4" y="6" width="24" height="20" rx="1" fill="#c8c8c8" stroke="#000"/><rect x="6" y="8" width="20" height="3" fill="#000080"/><rect x="8" y="13" width="16" height="10" fill="#fff"/><path d="M11 22V14l8 4z" fill="#ff3030"/></svg>',
    // ── Ícones de controlo do media player (estilo retro monocromático) ──
    // Desenhados para combinar com botões Win95: traço preto, simples.
    mpPlay:  '<svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 2 L11 7 L3 12 Z" fill="#000"/></svg>',
    mpPause: '<svg width="14" height="14" viewBox="0 0 14 14"><rect x="3" y="2" width="3" height="10" fill="#000"/><rect x="8" y="2" width="3" height="10" fill="#000"/></svg>',
    mpPrev:  '<svg width="14" height="14" viewBox="0 0 14 14"><rect x="2" y="2" width="2" height="10" fill="#000"/><path d="M11 2 L4 7 L11 12 Z" fill="#000"/></svg>',
    mpNext:  '<svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 2 L10 7 L3 12 Z" fill="#000"/><rect x="10" y="2" width="2" height="10" fill="#000"/></svg>',
    mpShuffle: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#000" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4 H3 L9 10 H13"/><path d="M1 10 H3 L9 4 H13"/><path d="M11 8 L13 10 L11 12"/><path d="M11 2 L13 4 L11 6"/></svg>',
    mpRepeat: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#000" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5 H10 L8 3"/><path d="M11 9 H4 L6 11"/></svg>',
    mpRepeatOne: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#000" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5 H10 L8 3"/><path d="M11 9 H4 L6 11"/><text x="7" y="8.5" font-size="4" font-family="Tahoma, sans-serif" font-weight="bold" text-anchor="middle" fill="#000" stroke="none">1</text></svg>',
    mpPlaylist: '<svg width="14" height="14" viewBox="0 0 14 14" fill="#000"><rect x="1" y="2" width="12" height="1.4"/><rect x="1" y="5" width="12" height="1.4"/><rect x="1" y="8" width="8" height="1.4"/><rect x="1" y="11" width="8" height="1.4"/></svg>',
    mpVolumeHigh: '<svg width="14" height="14" viewBox="0 0 14 14" fill="#000"><path d="M1 5 H3 L6 2 V12 L3 9 H1 Z" stroke="#000" stroke-width="0.5" stroke-linejoin="round"/><path d="M8 4 Q10 7 8 10" fill="none" stroke="#000" stroke-width="1.2" stroke-linecap="round"/><path d="M9.5 2.5 Q13 7 9.5 11.5" fill="none" stroke="#000" stroke-width="1.2" stroke-linecap="round"/></svg>',
    mpVolumeLow: '<svg width="14" height="14" viewBox="0 0 14 14" fill="#000"><path d="M1 5 H3 L6 2 V12 L3 9 H1 Z" stroke="#000" stroke-width="0.5" stroke-linejoin="round"/><path d="M8 4 Q10 7 8 10" fill="none" stroke="#000" stroke-width="1.2" stroke-linecap="round"/></svg>',
    mpVolumeMute: '<svg width="14" height="14" viewBox="0 0 14 14"><path d="M1 5 H3 L6 2 V12 L3 9 H1 Z" fill="#000" stroke="#000" stroke-width="0.5" stroke-linejoin="round"/><path d="M8.5 4.5 L12 8 M12 4.5 L8.5 8" stroke="#c00" stroke-width="1.5" stroke-linecap="round"/></svg>',
    mpNote: '<svg width="22" height="22" viewBox="0 0 22 22" fill="#000"><path d="M9 3 H16 V4.5 H10.5 V13.2 A2.5 2.5 0 1 1 9 11 Z"/><circle cx="7.5" cy="14.5" r="2.5"/></svg>',
    // ── Brick Breaker (CN Arcade) — ícone retro 16×16 ──
    brickbreaker: '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="16" height="16" rx="1" fill="#000080"/><rect x="2" y="3" width="3.2" height="2.2" fill="#ff4040"/><rect x="6" y="3" width="3.2" height="2.2" fill="#ffd23f"/><rect x="10" y="3" width="3.2" height="2.2" fill="#4dd964"/><rect x="2" y="6" width="3.2" height="2.2" fill="#3fb8d4"/><rect x="6" y="6" width="3.2" height="2.2" fill="#b06be0"/><rect x="10" y="6" width="3.2" height="2.2" fill="#ff8c1a"/><rect x="5.5" y="12" width="5" height="1.6" rx="0.3" fill="#c8c8c8"/><circle cx="8" cy="10" r="1.2" fill="#fff"/></svg>',
    // ── CN Browser — ícone retro 16×16 (monitor com globo centrado, sem barra azul) ──
    browser: '<svg width="16" height="16" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="3" width="28" height="22" rx="1" fill="#c8c8c8" stroke="#000"/><rect x="4" y="5" width="24" height="18" fill="#008080"/><circle cx="16" cy="14" r="7" fill="#3fb8d4" stroke="#fff" stroke-width="1"/><path d="M9 14 H23 M16 7 V21 M12 10 Q16 14 12 18 M20 10 Q16 14 20 18" fill="none" stroke="#fff" stroke-width="0.8"/><rect x="11" y="25" width="10" height="2" fill="#c8c8c8"/><rect x="8" y="27" width="16" height="3" rx="1" fill="#c8c8c8"/></svg>',
  };

  // ─────────────────────────────────────────────
  //  YouTube helpers (partilhados por todas as
  //  instâncias do Media Player).
  //
  //  • parseYouTubeURL(url) → { type:"video", videoId } |
  //    { type:"playlist", playlistId } | null
  //  • loadYouTubeIframeAPI() → Promise<YT>  (singleton —
  //    só injecta o script uma vez e encadeia callbacks
  //    onYouTubeIframeAPIReady caso já existam outros)
  // ─────────────────────────────────────────────
  function parseYouTubeURL(url) {
    if (!url || typeof url !== "string") return null;
    url = url.trim();
    try { url = decodeURIComponent(url); } catch (_) {}
    // 1) ?list=PLAYLIST_ID (em qualquer URL do YouTube)
    let m = url.match(/[?&]list=([A-Za-z0-9_-]{6,})/);
    if (m) return { type: "playlist", playlistId: m[1] };
    // 2) youtu.be/VIDEO_ID
    m = url.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/);
    if (m) return { type: "video", videoId: m[1] };
    // 3) watch?v=VIDEO_ID
    m = url.match(/[?&]v=([A-Za-z0-9_-]{6,})/);
    if (m) return { type: "video", videoId: m[1] };
    // 4) /embed/VIDEO_ID
    m = url.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/);
    if (m) return { type: "video", videoId: m[1] };
    // 5) /live/VIDEO_ID
    m = url.match(/youtube\.com\/live\/([A-Za-z0-9_-]{6,})/);
    if (m) return { type: "video", videoId: m[1] };
    // 6) /shorts/VIDEO_ID
    m = url.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/);
    if (m) return { type: "video", videoId: m[1] };
    return null;
  }

  let ytApiPromise = null;
  function loadYouTubeIframeAPI() {
    if (ytApiPromise) return ytApiPromise;
    ytApiPromise = new Promise(function (resolve, reject) {
      // Se a API já está carregada, resolve imediatamente.
      if (window.YT && window.YT.Player) { resolve(window.YT); return; }
      // Encadeia qualquer callback anterior (suporta múltiplos callers).
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () {
        if (typeof prev === "function") { try { prev(); } catch (_) {} }
        if (window.YT && window.YT.Player) resolve(window.YT);
        else reject(new Error("YouTube IFrame API unavailable"));
      };
      // Injecta o script uma única vez.
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.async = true;
      s.onerror = function () { reject(new Error("Failed to load YouTube IFrame API")); };
      document.head.appendChild(s);
      // Safety net: alguns browsers demoram a disparar o callback.
      setTimeout(function () {
        if (window.YT && window.YT.Player) resolve(window.YT);
      }, 6000);
    });
    return ytApiPromise;
  }

  // ─────────────────────────────────────────────
  //  APPS — registo de apps
  //  Cada app: { id, title, icon, width, height, render() → retorna conteúdo }
  // ─────────────────────────────────────────────
  const APPS = {
    notepad: {
      title: "Sem título - Bloco de Notas",
      icon: ICONS.notepad,
      width: 340, height: 240,
      render: function () {
        const wrap = document.createElement("div");
        wrap.className = "app-notepad";
        wrap.innerHTML =
          '<div class="app-notepad-menu">' + t("Ficheiro  Editar  Procurar  Ajuda") + '</div>' +
          '<textarea class="app-notepad-textarea" spellcheck="false" placeholder=""></textarea>';
        return wrap;
      },
    },

    dos: {
      title: "Linha de comandos CN-DOS",
      icon: ICONS.dos,
      width: 380, height: 260,
      render: function () {
        const wrap = document.createElement("div");
        wrap.className = "app-dos";
        wrap.innerHTML =
          '<div class="app-dos-output" id="dos-output"></div>' +
          '<div class="app-dos-inputline">' +
            '<span class="app-dos-prompt">C:\\&gt;</span>' +
            '<input type="text" class="app-dos-input" id="dos-input" autocomplete="off" spellcheck="false"/>' +
          '</div>';
        // Boot output
        setTimeout(function () {
          const out = wrap.querySelector("#dos-output");
          if (out) {
            out.innerHTML =
              t("Versão CN-DOS 3.11") + "<br>" +
              t("(c) Copyright CASA•NORTE Systems Inc. 1995") + "<br><br>" +
              "C:\\&gt; <br>";
          }
          const inp = wrap.querySelector("#dos-input");
          if (inp) inp.focus();
        }, 50);

        // Command handler
        wrap.addEventListener("keydown", function (e) {
          if (e.key === "Enter" && e.target.id === "dos-input") {
            const inp = e.target;
            const out = wrap.querySelector("#dos-output");
            const cmd = inp.value.trim();
            inp.value = "";
            if (!out) return;
            out.innerHTML += "C:\\&gt; " + escapeHtml(cmd) + "<br>";
            out.innerHTML += runDosCommand(cmd);
            out.scrollTop = out.scrollHeight;
          }
        });
        return wrap;
      },
    },

    mycomputer: {
      title: "O Meu Computador",
      icon: ICONS.mycomputer,
      width: 340, height: 220,
      render: function () {
        const wrap = document.createElement("div");
        wrap.className = "app-mycomputer";
        wrap.innerHTML =
          '<div class="app-explorer-toolbar">' + t("Ficheiro  Editar  Ver  Ajuda") + '</div>' +
          '<div class="app-explorer-body">' +
            '<div class="explorer-item" data-drive="a">' +
              '<svg width="32" height="32" viewBox="0 0 32 32"><rect x="4" y="8" width="24" height="16" rx="1" fill="#c8c8c8" stroke="#000"/><rect x="6" y="10" width="14" height="12" fill="#000080"/><circle cx="24" cy="16" r="1.5" fill="#808080"/><rect x="22" y="20" width="4" height="1" fill="#808080"/></svg>' +
              '<div class="explorer-item-label">' + t("Disquete 3½ (A:)") + '</div>' +
            '</div>' +
            '<div class="explorer-item" data-drive="c">' +
              '<svg width="32" height="32" viewBox="0 0 32 32"><rect x="4" y="10" width="24" height="14" rx="1" fill="#c8c8c8" stroke="#000"/><rect x="6" y="12" width="20" height="10" fill="#000080"/><rect x="22" y="14" width="2" height="2" fill="#30c030"/><rect x="22" y="18" width="2" height="2" fill="#808080"/></svg>' +
              '<div class="explorer-item-label">' + t("Disco Local (C:)") + '</div>' +
            '</div>' +
            '<div class="explorer-item" data-drive="d">' +
              '<svg width="32" height="32" viewBox="0 0 32 32"><rect x="4" y="10" width="24" height="14" rx="1" fill="#c8c8c8" stroke="#000"/><rect x="6" y="12" width="20" height="10" fill="#000080"/><rect x="22" y="14" width="2" height="2" fill="#ffc030"/></svg>' +
              '<div class="explorer-item-label">' + t("CD-ROM (D:)") + '</div>' +
            '</div>' +
            '<div class="explorer-item" data-drive="control">' +
              '<svg width="32" height="32" viewBox="0 0 32 32"><rect x="6" y="6" width="20" height="20" rx="2" fill="#c8c8c8" stroke="#000"/><rect x="9" y="9" width="14" height="14" fill="#000080"/><circle cx="16" cy="16" r="4" fill="#c8c8c8"/></svg>' +
              '<div class="explorer-item-label">' + t("Painel de Controlo") + '</div>' +
            '</div>' +
          '</div>';
        return wrap;
      },
    },

    about: {
      title: "Sobre CASA•NORTE",
      icon: ICONS.about,
      width: 300, height: 200,
      render: function () {
        const wrap = document.createElement("div");
        wrap.className = "app-about";
        wrap.innerHTML =
          '<div class="app-about-logo">' +
            '<svg width="48" height="48" viewBox="0 0 32 32"><rect x="4" y="4" width="24" height="24" rx="1" fill="#c8c8c8" stroke="#000"/><rect x="6" y="6" width="20" height="20" fill="#008080"/><path d="M16 9l5 4-5 4-5-4z" fill="#fff"/><path d="M16 14l5 4-5 4-5-4z" fill="#ffb347"/></svg>' +
          '</div>' +
          '<div class="app-about-info">' +
            '<div class="app-about-title">' + t("Sistema CN-DOS CASA•NORTE") + '</div>' +
            '<div class="app-about-version">' + t("Versão 3.11") + '</div>' +
            '<div class="app-about-copyright">' + t("© 1995 CASA•NORTE Systems Inc.") + '</div>' +
            '<div class="app-about-spacer"></div>' +
            '<div class="app-about-row">' + t("CPU: Pentium-MMX 200MHz") + '</div>' +
            '<div class="app-about-row">' + t("Memória: 65.536 KB") + '</div>' +
            '<div class="app-about-row">' + t("Ecrã: ColorMonitor CN-1530") + '</div>' +
          '</div>';
        return wrap;
      },
    },

    recycle: {
      title: "Reciclagem",
      icon: ICONS.recycle,
      width: 440, height: 320,
      render: function () {
        const wrap = document.createElement("div");
        wrap.className = "app-recycle";

        // Ícone SVG de ficheiro ZIP clássico (estilo Win95/Win98).
        // Página branca com dobra, faixa lateral com "pixels" azuis (o
        // padrão clássico do ícone de ZIP/compressão), e 3 X vermelhos
        // em LINHA HORIZONTAL (XXX) sobrepostos a indicar NSFW.
        const ZIP_ICON_SVG =
          '<svg width="48" height="48" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">' +
            // Página com dobra (canto sup. direito)
            '<path d="M7 2 H20 L25 7 V28 a2 2 0 0 1-2 2 H7 a2 2 0 0 1-2-2 V4 a2 2 0 0 1 2-2 z" fill="#fff" stroke="#404040" stroke-width="1"/>' +
            '<path d="M20 2 V7 H25 z" fill="#c0c0c0" stroke="#404040" stroke-width="1"/>' +
            // Faixa lateral esquerda — padrão de "compressão" clássico de ZIP
            '<rect x="7" y="9" width="5" height="19" fill="#5a78e8"/>' +
            '<rect x="8" y="10" width="3" height="2" fill="#3fb8d4"/>' +
            '<rect x="8" y="13" width="3" height="2" fill="#3fb8d4"/>' +
            '<rect x="8" y="16" width="3" height="2" fill="#3fb8d4"/>' +
            '<rect x="8" y="19" width="3" height="2" fill="#3fb8d4"/>' +
            '<rect x="8" y="22" width="3" height="2" fill="#3fb8d4"/>' +
            '<rect x="8" y="25" width="3" height="2" fill="#3fb8d4"/>' +
            // 3 X vermelhos em LINHA HORIZONTAL (XXX) — NSFW warning
            '<text x="14" y="22" font-size="6" font-family="Tahoma, Arial, sans-serif" font-weight="bold" text-anchor="start" fill="#c00">X</text>' +
            '<text x="18" y="22" font-size="6" font-family="Tahoma, Arial, sans-serif" font-weight="bold" text-anchor="start" fill="#c00">X</text>' +
            '<text x="22" y="22" font-size="6" font-family="Tahoma, Arial, sans-serif" font-weight="bold" text-anchor="start" fill="#c00">X</text>' +
          '</svg>';

        let itemsHtml = "";
        TRASH_FILES.forEach(function (f) {
          let iconHtml;
          if (f.iconType === "img") {
            // Foto como ícone (48px) com fallback SVG se o load falhar.
            iconHtml =
              '<img class="recycle-item-img" src="' + f.iconSrc + '" alt="' + f.name +
              '" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'\'" />' +
              '<svg class="recycle-item-fallback" width="48" height="48" viewBox="0 0 32 32" style="display:none">' +
                '<rect x="5" y="4" width="22" height="24" rx="1" fill="#c8c8c8" stroke="#000"/>' +
                '<rect x="5" y="4" width="22" height="4" fill="#000080"/>' +
                '<circle cx="16" cy="16" r="5" fill="#ffd23f"/>' +
                '<circle cx="16" cy="16" r="3" fill="#b8860b"/>' +
              '</svg>';
          } else if (f.iconType === "zip") {
            iconHtml = ZIP_ICON_SVG;
          }
          itemsHtml +=
            '<div class="explorer-item recycle-item" data-trash-name="' + f.name + '"' +
              (f.iconType === "img" && f.fullSrc ? ' data-trash-img="' + f.fullSrc + '"' : "") + '>' +
              '<div class="recycle-item-icon">' + iconHtml + '</div>' +
              '<div class="explorer-item-label">' + f.name + '</div>' +
            '</div>';
        });

        wrap.innerHTML =
          '<div class="app-explorer-toolbar">' + t("Ficheiro  Editar  Ver  Ajuda") + '</div>' +
          '<div class="app-recycle-body">' + itemsHtml + '</div>' +
          '<div class="app-recycle-status">' + TRASH_FILES.length + " " + t("objeto(s)") + '</div>';

        // Duplo-clique num ficheiro de imagem abre o visualizador.
        wrap.querySelectorAll(".recycle-item[data-trash-img]").forEach(function (item) {
          item.addEventListener("dblclick", function (e) {
            e.stopPropagation();
            openImageViewer(item.dataset.trashImg, item.dataset.trashName);
          });
        });

        return wrap;
      },
    },

    // ── CN Browser ── browser fake estilo Win95 com homepage de atalhos.
    // Os atalhos abrem websites reais numa nova aba. 3 atalhos default
    // + atalhos personalizados (localStorage). Menu Edit: dropdown de
    // colunas (3/4/5). Botão "Restaurar" com confirmação.
    browser: {
      title: "CN Browser",
      icon: ICONS.browser,
      width: 560, height: 440,
      render: function () {
        const wrap = document.createElement("div");
        wrap.className = "app-browser";

        const STORAGE_KEY = "jce_browser_bookmarks";
        const SETTINGS_KEY = "jce_browser_settings";

        // ── Settings: apenas colunas por linha (3 default) ──
        function loadSettings() {
          try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            if (raw) { const s = JSON.parse(raw); return { columns: s.columns || 3 }; }
          } catch (_) {}
          return { columns: 3 };
        }
        function saveSettings(s) {
          try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (_) {}
        }
        let settings = loadSettings();

        // ── Bookmarks ──
        function loadBookmarks() {
          try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) return JSON.parse(raw);
          } catch (_) {}
          saveBookmarks(DEFAULT_BROWSER_BOOKMARKS);
          return DEFAULT_BROWSER_BOOKMARKS.slice();
        }
        function saveBookmarks(bm) {
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(bm)); } catch (_) {}
        }
        let bookmarks = loadBookmarks();

        // ── Helper: obter favicon do Google ──
        // Para bookmarks sem imagem, usa o favicon do site via Google.
        function faviconUrl(url) {
          try {
            const u = new URL(url);
            return "https://www.google.com/s2/favicons?domain=" + u.hostname + "&sz=128";
          } catch (_) { return ""; }
        }

        // ── Toolbar do browser ──
        wrap.innerHTML =
          '<div class="app-browser-menubar">' +
            '<span class="app-browser-menuitem" data-menu="file">' + t("Ficheiro") + '</span>' +
            '<span class="app-browser-menuitem" data-menu="edit">' + t("Editar") + '</span>' +
            '<span class="app-browser-menuitem">' + t("Ver") + '</span>' +
            '<span class="app-browser-menuitem">' + t("Favoritos") + '</span>' +
            '<span class="app-browser-menuitem">' + t("Ajuda") + '</span>' +
          '</div>' +
          '<div class="app-browser-toolbar">' +
            '<button class="app-browser-btn" type="button" data-act="back" title="' + t("Voltar") + '">' +
              '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#000" stroke-width="1.5"><path d="M9 2 L4 7 L9 12"/></svg></button>' +
            '<button class="app-browser-btn" type="button" data-act="forward" title="' + t("Avançar") + '">' +
              '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#000" stroke-width="1.5"><path d="M5 2 L10 7 L5 12"/></svg></button>' +
            '<button class="app-browser-btn" type="button" data-act="reload" title="' + t("Recarregar") + '">' +
              '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#000" stroke-width="1.5"><path d="M11 4 A4 4 0 1 0 12 8 M11 2 V5 H8"/></svg></button>' +
            '<button class="app-browser-btn" type="button" data-act="home" title="' + t("Início") + '">' +
              '<svg width="14" height="14" viewBox="0 0 14 14" fill="#000"><path d="M7 1 L1 6 V12 H5 V8 H9 V12 H13 V6 Z"/></svg></button>' +
            '<div class="app-browser-urlwrap">' +
              '<span class="app-browser-urlprefix">' + t("Endereço:") + '</span>' +
              '<input type="text" class="app-browser-url" value="cn://home" readonly />' +
            '</div>' +
            '<button class="app-browser-btn app-browser-add" type="button" data-act="add" title="' + t("Adicionar atalho") + '">' +
              '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#000" stroke-width="1.8"><line x1="7" y1="2" x2="7" y2="12"/><line x1="2" y1="7" x2="12" y2="7"/></svg></button>' +
            '<button class="app-browser-btn app-browser-restore" type="button" data-act="restore" title="' + t("Restaurar padrão") + '">' +
              '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#000" stroke-width="1.3"><path d="M2 7 A5 5 0 1 1 7 12 M2 3 V7 H6"/></svg></button>' +
          '</div>' +
          '<div class="app-browser-content">' +
            '<div class="app-browser-homepage" data-hud="browser-homepage"></div>' +
          '</div>' +
          '<div class="app-browser-statusbar">' +
            '<span class="app-browser-status" data-hud="browser-status">' + t("Pronto") + '</span>' +
          '</div>';

        const homepageEl = wrap.querySelector('[data-hud="browser-homepage"]');
        const statusEl = wrap.querySelector('[data-hud="browser-status"]');
        const urlInput = wrap.querySelector(".app-browser-url");

        function setStatus(msg) { if (statusEl) statusEl.textContent = msg; }

        // ── Renderiza a homepage com os tiles dos bookmarks ──
        function renderHomepage() {
          if (!homepageEl) return;
          if (bookmarks.length === 0) {
            homepageEl.innerHTML =
              '<div class="app-browser-empty">' + t("Sem atalhos. Clica em + para adicionar ou em ↺ para restaurar os padrão.") + '</div>';
            return;
          }
          let html = '<div class="app-browser-tiles">';
          bookmarks.forEach(function (bm, idx) {
            const initial = (bm.name || "?").charAt(0).toUpperCase();
            // Lógica de imagem:
            //   1. Se o bookmark tem img (URL do utilizador) → usa essa
            //   2. Se não tem img → tenta favicon do Google
            //   3. Se o favicon falha → mostra a inicial do nome
            const hasUserImg = bm.img && bm.img.length > 0;
            const favUrl = hasUserImg ? bm.img : faviconUrl(bm.url);
            html +=
              '<div class="app-browser-tile" data-idx="' + idx + '">' +
                '<div class="app-browser-tile-thumb">' +
                  '<img src="' + escapeHtml(favUrl) + '" alt="' + escapeHtml(bm.name) + '"' +
                  ' onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'" />' +
                  '<div class="app-browser-tile-fallback" style="display:none">' + initial + '</div>' +
                  '<button class="app-browser-tile-remove" data-remove="' + idx + '" title="' + t("Remover") + '" type="button">' +
                    '<svg width="8" height="8" viewBox="0 0 8 8"><line x1="1" y1="1" x2="7" y2="7" stroke="#000" stroke-width="1.2"/><line x1="7" y1="1" x2="1" y2="7" stroke="#000" stroke-width="1.2"/></svg>' +
                  '</button>' +
                '</div>' +
                '<div class="app-browser-tile-name">' + escapeHtml(bm.name) + '</div>' +
                '<div class="app-browser-tile-url">' + escapeHtml(bm.url.replace(/^https?:\/\//, "").replace(/\/$/, "")) + '</div>' +
              '</div>';
          });
          html += '</div>';
          homepageEl.innerHTML = html;
          // Aplica as colunas via JS inline
          const tiles = homepageEl.querySelector(".app-browser-tiles");
          if (tiles) {
            tiles.style.gridTemplateColumns = "repeat(" + settings.columns + ", 1fr)";
          }

          // Click num tile → abre o URL
          homepageEl.querySelectorAll(".app-browser-tile").forEach(function (tile) {
            tile.addEventListener("click", function (e) {
              if (e.target.closest(".app-browser-tile-remove")) return;
              const idx = parseInt(tile.dataset.idx, 10);
              const bm = bookmarks[idx];
              if (!bm || !bm.url) return;
              setStatus(t("A abrir...") + " " + bm.url);
              try { window.open(bm.url, "_blank", "noopener,noreferrer"); } catch (_) {}
              setTimeout(function () { setStatus(t("Pronto")); }, 1500);
            });
          });

          // Remove bookmark
          homepageEl.querySelectorAll(".app-browser-tile-remove").forEach(function (btn) {
            btn.addEventListener("click", function (e) {
              e.stopPropagation();
              const idx = parseInt(btn.dataset.remove, 10);
              bookmarks.splice(idx, 1);
              saveBookmarks(bookmarks);
              renderHomepage();
              setStatus(t("Atalho removido."));
            });
          });
        }

        // ── Adicionar atalho (form inline) ──
        function showAddForm() {
          const existing = homepageEl.querySelector(".app-browser-addform");
          if (existing) { existing.remove(); return; }
          const form = document.createElement("div");
          form.className = "app-browser-addform";
          form.innerHTML =
            '<div class="app-browser-addform-title">' + t("Adicionar atalho") + '</div>' +
            '<label>' + t("Nome") + '</label>' +
            '<input type="text" class="app-browser-add-name" placeholder="' + t("Nome do site") + '" />' +
            '<label>' + t("URL") + '</label>' +
            '<input type="text" class="app-browser-add-url" placeholder="https://..." />' +
            '<label>' + t("Imagem (URL) — opcional") + '</label>' +
            '<input type="text" class="app-browser-add-img" placeholder="' + t("Deixa vazio para usar o logo do site") + '" />' +
            '<div class="app-browser-addform-buttons">' +
              '<button class="app-browser-addform-save" type="button">' + t("Guardar") + '</button>' +
              '<button class="app-browser-addform-cancel" type="button">' + t("Cancelar") + '</button>' +
            '</div>';
          homepageEl.insertBefore(form, homepageEl.firstChild);
          const nameInput = form.querySelector(".app-browser-add-name");
          const urlInput2 = form.querySelector(".app-browser-add-url");
          const imgInput = form.querySelector(".app-browser-add-img");
          nameInput.focus();
          form.querySelector(".app-browser-addform-save").addEventListener("click", function () {
            const name = nameInput.value.trim();
            const url = urlInput2.value.trim();
            const img = imgInput.value.trim();
            if (!name || !url) { setStatus(t("Nome e URL são obrigatórios.")); return; }
            let finalUrl = url;
            if (!/^https?:\/\//.test(finalUrl)) finalUrl = "https://" + finalUrl;
            // img vazia = "" → o render usa favicon do Google
            bookmarks.push({ name: name, url: finalUrl, img: img || "" });
            saveBookmarks(bookmarks);
            renderHomepage();
            setStatus(t("Atalho adicionado."));
          });
          form.querySelector(".app-browser-addform-cancel").addEventListener("click", function () {
            form.remove();
          });
        }

        // ── Pop-up de confirmação (modal Win95) ──
        function showConfirmDialog(title, message, onConfirm) {
          const backdrop = document.createElement("div");
          backdrop.className = "app-browser-modal-backdrop";
          const dialog = document.createElement("div");
          dialog.className = "app-browser-modal";
          dialog.innerHTML =
            '<div class="app-browser-modal-titlebar">' +
              '<span class="app-browser-modal-title">' + escapeHtml(title) + '</span>' +
              '<button class="app-browser-modal-close" type="button" title="' + t("Cancelar") + '" style="background:#c0c0c0;border:1px solid;border-color:#dfdfdf #808080 #808080 #dfdfdf;width:18px;height:18px;font-size:11px;font-weight:bold;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;line-height:1;color:#000;">×</button>' +
            '</div>' +
            '<div class="app-browser-modal-body">' +
              '<div class="app-browser-modal-icon">' +
                '<svg width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="none" stroke="#ffd23f" stroke-width="3"/><line x1="16" y1="8" x2="16" y2="18" stroke="#ffd23f" stroke-width="3" stroke-linecap="round"/><circle cx="16" cy="23" r="1.5" fill="#ffd23f"/></svg>' +
              '</div>' +
              '<div class="app-browser-modal-msg">' + escapeHtml(message) + '</div>' +
            '</div>' +
            '<div class="app-browser-modal-buttons">' +
              '<button class="app-browser-modal-yes" type="button" style="background:#c0c0c0;border:1px solid;border-color:#dfdfdf #808080 #808080 #dfdfdf;font-size:12px;font-family:Tahoma,sans-serif;padding:4px 20px;cursor:pointer;min-width:70px;font-weight:bold;color:#000;">' + t("Sim") + '</button>' +
              '<button class="app-browser-modal-no" type="button" style="background:#c0c0c0;border:1px solid;border-color:#dfdfdf #808080 #808080 #dfdfdf;font-size:12px;font-family:Tahoma,sans-serif;padding:4px 20px;cursor:pointer;min-width:70px;color:#000;">' + t("Não") + '</button>' +
            '</div>';
          backdrop.appendChild(dialog);
          wrap.appendChild(backdrop);
          function close() { backdrop.remove(); }
          backdrop.addEventListener("click", function (e) { if (e.target === backdrop) close(); });
          dialog.querySelector(".app-browser-modal-close").addEventListener("click", close);
          dialog.querySelector(".app-browser-modal-no").addEventListener("click", close);
          dialog.querySelector(".app-browser-modal-yes").addEventListener("click", function () {
            close();
            if (typeof onConfirm === "function") onConfirm();
          });
        }

        // ── Restaurar padrão (com confirmação) ──
        function restoreDefaults() {
          showConfirmDialog(
            t("Restaurar padrão"),
            t("Isto vai apagar todos os teus atalhos personalizados e restaurar apenas os 3 websites padrão. Queres continuar?"),
            function () {
              bookmarks = DEFAULT_BROWSER_BOOKMARKS.slice();
              saveBookmarks(bookmarks);
              renderHomepage();
              setStatus(t("Atalhos restaurados para o padrão."));
            }
          );
        }

        // ── Menu Edit: dropdown de colunas (estilo Win95) ──
        // Abre um dropdown abaixo do menu "Editar" com as opções 3/4/5.
        // Ao clicar numa opção, aplica imediatamente (sem botão Aplicar).
        function showEditDropdown(anchorEl) {
          // Se já existe um dropdown aberto, fecha
          const existing = wrap.querySelector(".app-browser-edit-dropdown");
          if (existing) { existing.remove(); return; }
          const dd = document.createElement("div");
          dd.className = "app-browser-edit-dropdown";
          dd.innerHTML =
            '<div class="app-browser-edit-dropdown-label">' + t("Websites por linha") + '</div>' +
            [3, 4, 5].map(function (n) {
              return '<div class="app-browser-edit-dropdown-item' + (settings.columns === n ? " active" : "") + '" data-cols="' + n + '">' +
                (settings.columns === n ? "✓ " : "&nbsp;&nbsp;") + n +
              '</div>';
            }).join("");
          // Posiciona o dropdown abaixo do menu item
          const rect = anchorEl.getBoundingClientRect();
          const wrapRect = wrap.getBoundingClientRect();
          dd.style.position = "absolute";
          dd.style.left = (rect.left - wrapRect.left) + "px";
          dd.style.top = (rect.bottom - wrapRect.top) + "px";
          dd.style.zIndex = "50";
          wrap.appendChild(dd);
          // Click numa opção → aplica imediatamente
          dd.querySelectorAll(".app-browser-edit-dropdown-item").forEach(function (item) {
            item.addEventListener("click", function () {
              settings.columns = parseInt(item.dataset.cols, 10);
              saveSettings(settings);
              renderHomepage();
              dd.remove();
              setStatus(t("Definições aplicadas."));
            });
          });
          // Fecha ao clicar fora
          setTimeout(function () {
            document.addEventListener("mousedown", function closeDD(e) {
              if (!dd.contains(e.target)) {
                dd.remove();
                document.removeEventListener("mousedown", closeDD);
              }
            });
          }, 0);
        }

        // ── Menu items ──
        wrap.querySelectorAll(".app-browser-menuitem[data-menu]").forEach(function (item) {
          item.addEventListener("click", function (e) {
            e.stopPropagation();
            const menu = item.dataset.menu;
            if (menu === "edit") { showEditDropdown(item); }
          });
        });

        // ── Toolbar buttons ──
        wrap.querySelectorAll(".app-browser-btn").forEach(function (btn) {
          btn.addEventListener("click", function () {
            const act = btn.dataset.act;
            if (act === "add") { showAddForm(); }
            else if (act === "restore") { restoreDefaults(); }
            else if (act === "home") { urlInput.value = "cn://home"; renderHomepage(); setStatus(t("Pronto")); }
            else if (act === "back" || act === "forward" || act === "reload") {
              setStatus(t("Pronto"));
            }
          });
        });

        // Render inicial
        renderHomepage();
        return wrap;
      },
    },

    media: {
      title: "Reprodutor CN Media",
      icon: ICONS.media,
      width: 520, height: 460,
      render: function () {
        const wrap = document.createElement("div");
        wrap.className = "app-media";

        // ── Tracklist (carregada do musicas.json) ──
        // name amigável: título com "_" → espaço e sem extensão .mp3.
        // IMPORTANTE: usar raw.githubusercontent.com (não github.com/.../raw/) para que
        // o servidor envie headers CORS (Access-Control-Allow-Origin: *) — sem isto o
        // AnalyserNode retorna zeros (MediaElementAudioSource tainted) e o audio pode
        // ser silenciado por políticas CORS.
        function toFriendly(title) {
          return title.replace(/\.mp3$/i, "").replace(/_/g, " ").trim();
        }
        function toRaw(url) {
          // Converte github.com/USER/REPO/raw/refs/heads/BRANCH/FILE
          // para raw.githubusercontent.com/USER/REPO/BRANCH/FILE
          return url.replace(
            /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/raw\/refs\/heads\/([^/]+)\//,
            "https://raw.githubusercontent.com/$1/$2/$3/"
          );
        }
        const defaultTracks = [
          { title: "A Cry 4 Love", cover: "https://raw.githubusercontent.com/Missiion/Caravela/main/A%20Cry%204%20Love.png", src: "https://raw.githubusercontent.com/Missiion/Caravela/main/A%20Cry%204%20Love.mp3" },
          { title: "Aiue Urusei Yatsura (2022)", cover: "https://raw.githubusercontent.com/Missiion/Caravela/main/Aiue%20Urusei%20Yatsura%20%282022%29.png", src: "https://raw.githubusercontent.com/Missiion/Caravela/main/Aiue%20Urusei%20Yatsura%20%282022%29.mp3" },
          { title: "Art_deco", cover: "https://raw.githubusercontent.com/Missiion/Caravela/main/Art_deco.png", src: "https://raw.githubusercontent.com/Missiion/Caravela/main/Art_deco.mp3" },
          { title: "Dance With Somebody (CH4YN & Chris El Greco)", cover: "https://raw.githubusercontent.com/Missiion/Caravela/main/Dance%20With%20Somebody%20%28CH4YN%20%26%20Chris%20El%20Greco%29.png", src: "https://raw.githubusercontent.com/Missiion/Caravela/main/Dance%20With%20Somebody%20%28CH4YN%20%26%20Chris%20El%20Greco%29.mp3" },
          { title: "Distant_dreamer", cover: "https://raw.githubusercontent.com/Missiion/Caravela/main/Distant_dreamer.png", src: "https://raw.githubusercontent.com/Missiion/Caravela/main/Distant_dreamer.mp3" },
          { title: "Dragonfly", cover: "https://raw.githubusercontent.com/Missiion/Caravela/main/Dragonfly.png", src: "https://raw.githubusercontent.com/Missiion/Caravela/main/Dragonfly.mp3" },
          { title: "Ella Baila Sola", cover: "https://raw.githubusercontent.com/Missiion/Caravela/main/Ella%20Baila%20Sola.png", src: "https://raw.githubusercontent.com/Missiion/Caravela/main/Ella%20Baila%20Sola.mp3" },
          { title: "Fantasy", cover: "https://raw.githubusercontent.com/Missiion/Caravela/main/Fantasy.png", src: "https://raw.githubusercontent.com/Missiion/Caravela/main/Fantasy.mp3" },
          { title: "Fly-day Chinatown", cover: "https://raw.githubusercontent.com/Missiion/Caravela/main/Fly-day%20Chinatown.png", src: "https://raw.githubusercontent.com/Missiion/Caravela/main/Fly-day%20Chinatown.mp3" },
          { title: "Guarda-me Esta Noite", cover: "https://raw.githubusercontent.com/Missiion/Caravela/main/Guarda-me%20Esta%20Noite.png", src: "https://raw.githubusercontent.com/Missiion/Caravela/main/Guarda-me%20Esta%20Noite.mp3" },
          { title: "Hecha_pa_mi_Bochi", cover: "https://raw.githubusercontent.com/Missiion/Caravela/main/Hecha_pa_mi_Bochi.png", src: "https://raw.githubusercontent.com/Missiion/Caravela/main/Hecha_pa_mi_Bochi.mp3" },
          { title: "INVISIBLE", cover: "https://raw.githubusercontent.com/Missiion/Caravela/main/INVISIBLE.png", src: "https://raw.githubusercontent.com/Missiion/Caravela/main/INVISIBLE.mp3" },
          { title: "Like a Stone", cover: "https://raw.githubusercontent.com/Missiion/Caravela/main/Like%20a%20Stone.png", src: "https://raw.githubusercontent.com/Missiion/Caravela/main/Like%20a%20Stone.mp3" },
          { title: "Loop", cover: "https://raw.githubusercontent.com/Missiion/Caravela/main/Loop.png", src: "https://raw.githubusercontent.com/Missiion/Caravela/main/Loop.mp3" },
          { title: "Me_gustas_tu", cover: "https://raw.githubusercontent.com/Missiion/Caravela/main/Me_gustas_tu.png", src: "https://raw.githubusercontent.com/Missiion/Caravela/main/Me_gustas_tu.mp3" },
          { title: "Mirage (Yofukashi no Uta)", cover: "https://raw.githubusercontent.com/Missiion/Caravela/main/Mirage%20%28Yofukashi%20no%20Uta%29.png", src: "https://raw.githubusercontent.com/Missiion/Caravela/main/Mirage%20%28Yofukashi%20no%20Uta%29.mp3" },
          { title: "Remember Summer Days", cover: "https://raw.githubusercontent.com/Missiion/Caravela/main/Remember%20Summer%20Days.png", src: "https://raw.githubusercontent.com/Missiion/Caravela/main/Remember%20Summer%20Days.mp3" },
          { title: "Stay with me", cover: "https://raw.githubusercontent.com/Missiion/Caravela/main/Stay%20with%20me.png", src: "https://raw.githubusercontent.com/Missiion/Caravela/main/Stay%20with%20me.mp3" },
          { title: "Só Eu Sei", cover: "https://raw.githubusercontent.com/Missiion/Caravela/main/S%C3%B3%20Eu%20Sei.png", src: "https://raw.githubusercontent.com/Missiion/Caravela/main/S%C3%B3%20Eu%20Sei.mp3" },
          { title: "Until I Found You", cover: "https://raw.githubusercontent.com/Missiion/Caravela/main/Until%20I%20Found%20You.png", src: "https://raw.githubusercontent.com/Missiion/Caravela/main/Until%20I%20Found%20You.mp3" },
          { title: "Wham Bam Shang-A-Lang", cover: "https://raw.githubusercontent.com/Missiion/Caravela/main/Wham%20Bam%20Shang-A-Lang.png", src: "https://raw.githubusercontent.com/Missiion/Caravela/main/Wham%20Bam%20Shang-A-Lang.mp3" },
          { title: "Wicked_game", cover: "https://raw.githubusercontent.com/Missiion/Caravela/main/Wicked_game.png", src: "https://raw.githubusercontent.com/Missiion/Caravela/main/Wicked_game.mp3" },
          { title: "Wie？ (UNDA Techno Remix)", cover: "https://raw.githubusercontent.com/Missiion/Caravela/main/Wie%EF%BC%9F%20%28UNDA%20Techno%20Remix%29.png", src: "https://raw.githubusercontent.com/Missiion/Caravela/main/Wie%EF%BC%9F%20%28UNDA%20Techno%20Remix%29.mp3" },
        ].map(function (trk) {
          return { name: toFriendly(trk.title), cover: trk.cover, src: trk.src };
        });
        // tracks: tracklist ativa (mutável). Inicialmente = defaultTracks.
        // Em modo YouTube-videos é substituída pelos vídeos da playlist.
        // Em modo YouTube-playlist fica vazia (o YouTube gere a fila).
        let tracks = defaultTracks.slice();

        // ── Estado do queue ──
        // queueOrder: array de indices em tracks, pela ordem a tocar
        // queueIdx: posição atual em queueOrder
        let queueOrder = tracks.map(function (_, i) { return i; });
        let queueIdx = 0;
        let shuffle = false;
        let repeat = "off"; // "off" | "all" | "one"
        let isPlaying = false;
        let currentVizId = "neon";
        let vizState = null;
        let rafId = null;
        let lastTs = 0;

        // ── YouTube mode + custom playlists state ──
        // mode: "mp3" (default tracklist, usa <audio>) | "youtube" (IFrame API)
        // currentPlaylist: null = default tracklist; ou entry de customPlaylists
        // customPlaylists/activePlaylistId persistidos em localStorage (jce_mp_playlists)
        let mode = "mp3";
        let currentPlaylist = null;
        const MP_PLAYLISTS_KEY = "jce_mp_playlists";
        let customPlaylists = [];
        let activePlaylistId = null;
        let ytPlayer = null;
        let ytPlayerReady = false;
        let ytPlayerInitializing = false;
        let ytPendingReady = null; // callback a chamar quando o player ficar pronto
        let ytPollId = null; // setInterval para atualizar tempo/progresso
        // ── Volume do media player (0-1), persistido em localStorage ──
        const MEDIA_VOL_KEY = "jce_media_volume";
        let mediaVolume = 0.2; // default (Etapa 6: 20% — era 0.8)
        try { mediaVolume = parseFloat(localStorage.getItem(MEDIA_VOL_KEY)); if (isNaN(mediaVolume)) mediaVolume = 0.2; } catch (_) {}

        // ── HTML structure (Win7 Now Playing layout) ──
        const vizList = window.VISUALIZERS ? window.VISUALIZERS.list : [];
        wrap.innerHTML =
          '<div class="mp-viz-wrap">' +
            '<canvas class="mp-viz"></canvas>' +
            '<div class="mp-viz-badge"></div>' +
            '<div class="mp-playlist">' +
              '<div class="mp-playlist-header">' + t("Lista de reprodução") + '</div>' +
              '<div class="mp-pl-switcher">' +
                '<div class="mp-pl-list"></div>' +
                '<button class="mp-pl-add-btn" type="button">+ ' + t("Adicionar Playlist") + '</button>' +
                '<div class="mp-pl-form hidden">' +
                  '<input class="mp-pl-name-input" type="text" placeholder="' + t("Nome da playlist") + '" />' +
                  '<input class="mp-pl-url-input" type="text" placeholder="' + t("URL do YouTube (playlist ou vídeo)") + '" />' +
                  '<div class="mp-pl-form-buttons">' +
                    '<button class="mp-pl-form-add" type="button">' + t("Adicionar") + '</button>' +
                    '<button class="mp-pl-form-cancel" type="button" title="' + t("Cancelar") + '">\u00d7</button>' +
                  '</div>' +
                '</div>' +
              '</div>' +
              '<div class="mp-playlist-items"></div>' +
            '</div>' +
          '</div>' +
          '<div class="mp-info">' +
            '<div class="mp-cover-wrap">' +
              '<img class="mp-cover" alt="" />' +
              '<div class="mp-cover-placeholder">' + ICONS.mpNote + '</div>' +
            '</div>' +
            '<div class="mp-titles">' +
              '<div class="mp-track">' + t("Sem faixa") + '</div>' +
              '<div class="mp-next">' + t("Próxima:") + ' —</div>' +
            '</div>' +
          '</div>' +
          '<div class="mp-progress-row">' +
            '<div class="mp-progress-bar"><div class="mp-progress-fill"></div></div>' +
            '<div class="mp-time">0:00 / 0:00</div>' +
          '</div>' +
          '<div class="mp-controls">' +
            '<div class="mp-transport">' +
              '<button class="mp-btn" type="button" data-act="prev" aria-label="' + t("Anterior") + '" title="' + t("Anterior") + '">' + ICONS.mpPrev + '</button>' +
              '<button class="mp-btn mp-play" type="button" data-act="play" aria-label="' + t("Tocar") + '" title="' + t("Tocar") + '">' + ICONS.mpPlay + '</button>' +
              '<button class="mp-btn" type="button" data-act="next" aria-label="' + t("Seguinte") + '" title="' + t("Seguinte") + '">' + ICONS.mpNext + '</button>' +
            '</div>' +
            '<div class="mp-modes">' +
              '<button class="mp-btn" type="button" data-act="shuffle" aria-label="' + t("Aleatório") + '" title="' + t("Aleatório (fila random)") + '">' + ICONS.mpShuffle + '</button>' +
              '<button class="mp-btn" type="button" data-act="repeat" aria-label="' + t("Repetir") + '" title="' + t("Repetir") + '">' + ICONS.mpRepeat + '</button>' +
              '<button class="mp-btn" type="button" data-act="playlist" aria-label="' + t("Lista de reprodução") + '" title="' + t("Lista de reprodução") + '">' + ICONS.mpPlaylist + '</button>' +
            '</div>' +
            '<div class="mp-volume">' +
              '<span class="mp-volume-icon" title="' + t("Volume") + '">' + ICONS.mpVolumeHigh + '</span>' +
              '<input type="range" class="mp-volume-slider" min="0" max="100" value="' + Math.round(mediaVolume * 100) + '" aria-label="' + t("Volume") + '" title="' + t("Volume") + '"/>' +
            '</div>' +
            '<select class="mp-viz-select" title="Visualizer">' +
              vizList.map(function (v) {
                return '<option value="' + v.id + '"' + (v.id === currentVizId ? ' selected' : '') + '>' + v.name + '</option>';
              }).join('') +
            '</select>' +
          '</div>' +
          '<audio class="mp-audio" crossorigin="anonymous" preload="metadata"></audio>' +
          '<div class="mp-yt-player"></div>';

        // ── Element refs ──
        const audio = wrap.querySelector(".mp-audio");
        const canvas = wrap.querySelector(".mp-viz");
        const ctx2d = canvas.getContext("2d");
        const cover = wrap.querySelector(".mp-cover");
        const coverPlaceholder = wrap.querySelector(".mp-cover-placeholder");
        const trackEl = wrap.querySelector(".mp-track");
        const nextEl = wrap.querySelector(".mp-next");
        const timeEl = wrap.querySelector(".mp-time");
        const progressFill = wrap.querySelector(".mp-progress-fill");
        const progressBar = wrap.querySelector(".mp-progress-bar");
        const playBtn = wrap.querySelector('.mp-btn[data-act="play"]');
        const shuffleBtn = wrap.querySelector('.mp-btn[data-act="shuffle"]');
        const repeatBtn = wrap.querySelector('.mp-btn[data-act="repeat"]');
        const playlistBtn = wrap.querySelector('.mp-btn[data-act="playlist"]');
        const playlistPanel = wrap.querySelector(".mp-playlist");
        const playlistItems = wrap.querySelector(".mp-playlist-items");
        const vizSelect = wrap.querySelector(".mp-viz-select");
        const vizBadge = wrap.querySelector(".mp-viz-badge");
        const volumeSlider = wrap.querySelector(".mp-volume-slider");
        const volumeIcon = wrap.querySelector(".mp-volume-icon");
        // ── Refs novos: switcher de playlists, form, YouTube player ──
        const ytWrap = wrap.querySelector(".mp-yt-player");
        const plList = wrap.querySelector(".mp-pl-list");
        const plAddBtn = wrap.querySelector(".mp-pl-add-btn");
        const plForm = wrap.querySelector(".mp-pl-form");
        const plNameInput = wrap.querySelector(".mp-pl-name-input");
        const plUrlInput = wrap.querySelector(".mp-pl-url-input");
        const plFormAdd = wrap.querySelector(".mp-pl-form-add");
        const plFormCancel = wrap.querySelector(".mp-pl-form-cancel");
        const progressRow = wrap.querySelector(".mp-progress-row");

        // ── Web Audio: AnalyserNode para os visualizadores ──
        let audioCtx = null, analyser = null, mediaGain = null, source = null;
        let freqData = null, waveData = null;
        let analyserReady = false;
        let useSyntheticFallback = false; // true se CORS bloquear o analyser
        let syntheticT = 0;

        function setupAnalyser() {
          if (analyserReady) return;
          try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            audioCtx = new AC();
            source = audioCtx.createMediaElementSource(audio);
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 2048;
            analyser.smoothingTimeConstant = 0.8;
            mediaGain = audioCtx.createGain();
            source.connect(analyser);
            analyser.connect(mediaGain);
            mediaGain.connect(audioCtx.destination);
            freqData = new Uint8Array(analyser.frequencyBinCount);
            waveData = new Uint8Array(analyser.frequencyBinCount);
            analyserReady = true;
            // Aplica o volume atual ao mediaGain assim que o analyser fica pronto.
            applyVolume();
          } catch (e) {
            // createMediaElementSource só pode ser chamado UMA vez por elemento.
            // Se falhar (ex: já foi chamado), limpa o estado para que o fallback
            // sintético seja usado — o visualizer continua a funcionar.
            audioCtx = null; source = null; analyser = null; mediaGain = null;
            analyserReady = false;
          }
        }

        // Pré-aquece o AudioContext no primeiro gesto do utilizador dentro
        // do media player. Isto é necessário porque os browsers bloqueiam
        // AudioContext até haver user activation. Sem isto, o setupAnalyser
        // cria o contexto em estado "suspended" e o analyser não devolve
        // dados reais até ao resume() — que só acontecia no play().
        // Agora o contexto fica ready cedo, e o analyser passa a ter dados
        // reais assim que o audio começa a tocar.
        function primeAudioContext() {
          if (analyserReady) {
            if (audioCtx && audioCtx.state === "suspended") {
              audioCtx.resume().catch(function () {});
            }
            return;
          }
          // Cria o AudioContext (suspended) no primeiro gesto. O
          // createMediaElementSource pode ser feito agora — o audio
          // ainda não está a tocar, mas a ligação fica estabelecida.
          try {
            setupAnalyser();
            if (audioCtx && audioCtx.state === "suspended") {
              audioCtx.resume().catch(function () {});
            }
          } catch (_) {}
          // Só remove os listeners se o analyser ficou pronto. Se falhou
          // (ex: browser bloqueou), mantém os listeners para tentar novamente
          // no próximo gesto — o browser pode permitir na 2ª tentativa.
          if (analyserReady) {
            wrap.removeEventListener("pointerdown", primeAudioContext);
            wrap.removeEventListener("keydown", primeAudioContext);
          }
        }
        wrap.addEventListener("pointerdown", primeAudioContext);
        wrap.addEventListener("keydown", primeAudioContext);

        // Tenta criar o AudioContext imediatamente (alguns browsers permitem
        // criar em estado suspended sem user gesture). Se falhar, o
        // primeAudioContext tenta novamente no primeiro gesto.
        try { setupAnalyser(); } catch (_) {}

        // Verifica se o analyser está a devolver dados reais (CORS pode bloquear)
        // — verificação feita inline no vizFrame para evitar chamada duplicada.

        // Aplica volume + mute global do site ao mediaGain (se analyser ativo)
        // ou ao audio.volume (fallback). Combina mediaVolume com jce_sound_muted.
        function applyVolume() {
          let muted = false;
          try { muted = localStorage.getItem("jce_sound_muted") === "1"; } catch (_) {}
          const effective = muted ? 0 : mediaVolume;
          // YouTube IFrame Player usa setVolume(0-100); não passa por Web Audio.
          if (mode === "youtube" && ytPlayerReady && ytPlayer) {
            try { ytPlayer.setVolume(Math.round(effective * 100)); } catch (_) {}
          }
          // <audio> continua com o seu próprio volume (para quando voltarmos ao modo MP3)
          if (mediaGain) {
            mediaGain.gain.value = effective;
            audio.volume = 1; // mediaGain controla o nível
          } else {
            audio.volume = effective;
          }
          // Atualiza ícone SVG consoante o nível
          if (volumeIcon) {
            if (muted || mediaVolume === 0) volumeIcon.innerHTML = ICONS.mpVolumeMute;
            else if (mediaVolume < 0.5) volumeIcon.innerHTML = ICONS.mpVolumeLow;
            else volumeIcon.innerHTML = ICONS.mpVolumeHigh;
          }
        }

        // ── Helpers ──
        function friendlyName(filename) {
          return filename.replace(/\.mp3$/i, "").replace(/_/g, " ").trim();
        }
        function formatTime(s) {
          if (!s || isNaN(s)) return "0:00";
          const m = Math.floor(s / 60);
          const sec = Math.floor(s % 60);
          return m + ":" + String(sec).padStart(2, "0");
        }
        function currentTrack() { return tracks[queueOrder[queueIdx]] || null; }
        function nextTrackInfo() {
          if (repeat === "one") return currentTrack();
          if (queueIdx + 1 < queueOrder.length) return tracks[queueOrder[queueIdx + 1]] || null;
          if (repeat === "all" && queueOrder.length > 0) return tracks[queueOrder[0]] || null;
          return null;
        }

        // ── Carregar faixa pelo índice do queue ──
        // Dispatch: em modo "mp3" usa o <audio>; em modo "youtube"
        // (apenas para playlists de vídeos individuais) usa loadVideoById.
        // Para youtube-playlist o YouTube gere a fila automaticamente.
        function loadCurrent(autoplay) {
          if (mode === "youtube") {
            // Só faz sentido para youtube-videos: youtube-playlist é gerido pelo YT.
            if (!currentPlaylist || currentPlaylist.type !== "youtube-videos") {
              // YouTube playlist — mostra nome e capa da playlist (se disponível)
              trackEl.textContent = currentPlaylist ? currentPlaylist.name : "YouTube";
              timeEl.textContent = "0:00 / 0:00";
              progressFill.style.width = "0%";
              if (currentPlaylist && currentPlaylist.cover) {
                cover.src = currentPlaylist.cover;
                cover.style.display = "";
                coverPlaceholder.style.display = "none";
              } else {
                cover.style.display = "none";
                coverPlaceholder.style.display = "";
              }
              updateNextDisplay();
              updatePlaylistUI();
              return;
            }
            const trk = currentTrack();
            if (!trk || !trk.videoId) return;
            trackEl.textContent = trk.name || currentPlaylist.name || "YouTube";
            timeEl.textContent = "0:00 / 0:00";
            progressFill.style.width = "0%";
            // Mostra a capa do vídeo (thumbnail do YouTube) se disponível
            if (trk.cover) {
              cover.src = trk.cover;
              cover.style.display = "";
              coverPlaceholder.style.display = "none";
            } else if (currentPlaylist && currentPlaylist.cover) {
              cover.src = currentPlaylist.cover;
              cover.style.display = "";
              coverPlaceholder.style.display = "none";
            } else {
              cover.style.display = "none";
              coverPlaceholder.style.display = "";
            }
            updateNextDisplay();
            updatePlaylistUI();
            // loadVideoById autotoca; cueVideoById apenas prepara (não toca).
            if (ytPlayerReady && ytPlayer) {
              try {
                if (autoplay) ytPlayer.loadVideoById(trk.videoId);
                else ytPlayer.cueVideoById(trk.videoId);
              } catch (_) {}
            } else {
              // Player ainda não está pronto — enfileira a ação.
              const vid = trk.videoId;
              ytPendingReady = (function (prev, v, ap) {
                return function () {
                  if (prev) try { prev(); } catch (_) {}
                  try {
                    if (ap) ytPlayer.loadVideoById(v);
                    else ytPlayer.cueVideoById(v);
                  } catch (_) {}
                };
              })(ytPendingReady, vid, autoplay);
              ensureYTPlayer();
            }
            return;
          }
          // ── Modo MP3 (default) ──
          const trk = currentTrack();
          if (!trk) return;
          audio.src = trk.src;
          if (trk.cover) {
            cover.src = trk.cover;
            cover.style.display = "";
            coverPlaceholder.style.display = "none";
          } else {
            cover.style.display = "none";
            coverPlaceholder.style.display = "";
          }
          trackEl.textContent = trk.name || friendlyName(decodeURIComponent(trk.src.split("/").pop() || ""));
          timeEl.textContent = "0:00 / 0:00";
          progressFill.style.width = "0%";
          updateNextDisplay();
          updatePlaylistUI();
          if (autoplay) play();
        }

        function updateNextDisplay() {
          // Em youtube-playlist o YouTube gere a fila — não sabemos a próxima.
          if (mode === "youtube" && currentPlaylist && currentPlaylist.type === "youtube-playlist") {
            nextEl.textContent = "YouTube \u00b7 " + (currentPlaylist.name || "");
            return;
          }
          const n = nextTrackInfo();
          if (n) {
            const label = n.videoId ? (n.name || "YouTube")
                                   : (n.name || friendlyName(decodeURIComponent((n.src || "").split("/").pop() || "")));
            nextEl.textContent = t("Próxima:") + " " + label;
          } else {
            nextEl.textContent = t("Próxima: — (fim da lista)");
          }
        }

        function updatePlayBtn() {
          playBtn.innerHTML = isPlaying ? ICONS.mpPause : ICONS.mpPlay;
          playBtn.setAttribute("aria-label", isPlaying ? t("Pausa") : t("Tocar"));
          playBtn.setAttribute("title", isPlaying ? t("Pausa") : t("Tocar"));
        }

        // ── Transport ──
        // Dispatch consoante o modo: "mp3" usa <audio>; "youtube" usa IFrame API.
        function play() {
          if (mode === "youtube") {
            // Se não há música carregada (estado inicial), carrega uma
            if (!currentTrack() && queueOrder.length > 0) {
              // Shuffle ativo → escolhe random em vez da primeira
              if (shuffle) queueIdx = randomQueueIdx();
              loadCurrent(true); return;
            }
            if (ytPlayerReady && ytPlayer) {
              applyVolume();
              try { ytPlayer.playVideo(); } catch (_) {}
              // onStateChange trata de isPlaying/updatePlayBtn/startVizLoop
              // Refresh da lista de vídeos da playlist (caso ainda não tenha carregado)
              refreshYTPlaylistVideos();
            } else {
              ensureYTPlayer(function () {
                applyVolume();
                try { ytPlayer.playVideo(); } catch (_) {}
                refreshYTPlaylistVideos();
              });
            }
            startVizLoop();
            return;
          }
          // MP3: se não há src carregada (estado inicial), carrega uma faixa
          if (!audio.src && queueOrder.length > 0) {
            // Shuffle ativo → escolhe random em vez da primeira
            if (shuffle) queueIdx = randomQueueIdx();
            loadCurrent(true); return;
          }
          setupAnalyser();
          applyVolume();
          // Garante que o audioCtx está running ANTES de tocar. Se estiver
          // suspenso, o som passa pelo mediaGain (suspenso) e não se ouve,
          // e o analyser não recebe dados reais. O resume() é async.
          const startPlay = function () {
            audio.play().then(function () { isPlaying = true; updatePlayBtn(); startVizLoop(); })
              .catch(function () { /* autoplay bloqueado */ });
          };
          if (audioCtx && audioCtx.state === "suspended") {
            audioCtx.resume().then(startPlay).catch(startPlay);
          } else {
            startPlay();
          }
        }
        function pause() {
          if (mode === "youtube") {
            if (ytPlayerReady && ytPlayer) try { ytPlayer.pauseVideo(); } catch (_) {}
            isPlaying = false; updatePlayBtn();
            return;
          }
          audio.pause(); isPlaying = false; updatePlayBtn();
        }
        function togglePlay() {
          if (mode === "youtube") {
            if (!ytPlayerReady || !ytPlayer) { play(); return; }
            const YT = window.YT;
            try {
              const st = ytPlayer.getPlayerState();
              if (YT && st === YT.PlayerState.PLAYING) pause();
              else play();
            } catch (_) { play(); }
            return;
          }
          if (audio.paused) play(); else pause();
        }
        function next() {
          // botão next: avança sempre (ignora repeat one)
          if (mode === "youtube") {
            // youtube-playlist: se shuffle, escolhe random; senão delega no YouTube.
            if (currentPlaylist && currentPlaylist.type === "youtube-playlist") {
              if (shuffle) {
                // Usa getPlaylist() diretamente (mais fiável que ytPlaylistVideos)
                if (ytPlayerReady && ytPlayer) {
                  try {
                    const pl = ytPlayer.getPlaylist();
                    const curIdx = ytPlayer.getPlaylistIndex();
                    if (pl && pl.length > 1 && curIdx >= 0) {
                      let r;
                      do { r = Math.floor(Math.random() * pl.length); } while (r === curIdx);
                      ytPlayer.playVideoAt(r);
                      return;
                    }
                  } catch (_) {}
                }
                // Fallback: nextVideo normal
                if (ytPlayerReady && ytPlayer) try { ytPlayer.nextVideo(); } catch (_) {}
              } else {
                if (ytPlayerReady && ytPlayer) try { ytPlayer.nextVideo(); } catch (_) {}
              }
              return;
            }
            // youtube-videos: se shuffle, escolhe random; senão avança na queue.
            if (shuffle) { queueIdx = randomQueueIdx(); loadCurrent(true); return; }
            if (queueIdx + 1 < queueOrder.length) { queueIdx++; loadCurrent(true); return; }
            if (repeat === "all" && queueOrder.length > 0) { queueIdx = 0; loadCurrent(true); return; }
            if (ytPlayerReady && ytPlayer) try { ytPlayer.pauseVideo(); } catch (_) {}
            isPlaying = false; updatePlayBtn();
            return;
          }
          // MP3: se shuffle, escolhe random; senão avança na queue.
          if (shuffle) { queueIdx = randomQueueIdx(); loadCurrent(true); return; }
          if (queueIdx + 1 < queueOrder.length) { queueIdx++; loadCurrent(true); return; }
          if (repeat === "all" && queueOrder.length > 0) { queueIdx = 0; loadCurrent(true); return; }
          // fim do queue, repeat off → para
          pause();
        }
        function prev() {
          if (mode === "youtube") {
            if (currentPlaylist && currentPlaylist.type === "youtube-playlist") {
              if (ytPlayerReady && ytPlayer) try { ytPlayer.previousVideo(); } catch (_) {}
              return;
            }
            // youtube-videos: se >3s, reinicia; senão retrocede na queue.
            if (ytPlayerReady && ytPlayer) {
              try { if ((ytPlayer.getCurrentTime() || 0) > 3) { ytPlayer.seekTo(0, true); return; } } catch (_) {}
            }
            if (queueIdx > 0) queueIdx--;
            else if (repeat === "all" && queueOrder.length > 0) queueIdx = queueOrder.length - 1;
            loadCurrent(true);
            return;
          }
          if (audio.currentTime > 3) { audio.currentTime = 0; return; }
          if (queueIdx > 0) queueIdx--;
          else if (repeat === "all" && queueOrder.length > 0) queueIdx = queueOrder.length - 1;
          loadCurrent(true);
        }
        function onEnded() {
          if (mode === "youtube") {
            // youtube-playlist em single-video mode (repeat "one"):
            // O YouTube NÃO auto-avança (é um vídeo isolado), então seekTo funciona.
            if (ytSingleMode && repeat === "one") {
              if (ytPlayerReady && ytPlayer) try { ytPlayer.seekTo(0, true); ytPlayer.playVideo(); } catch (_) {}
              return;
            }
            // youtube-playlist normal (não single mode):
            if (currentPlaylist && currentPlaylist.type === "youtube-playlist" && !ytSingleMode) {
              // Repeat "all": o YouTube já faz loop se setLoop(true) foi chamado.
              // Repeat "off": o YouTube para no fim.
              // Shuffle: o preempt no polling já tratou de saltar 2s antes do fim.
              // Se chegamos aqui, não há repeat "one" nem shuffle ativo.
              if (repeat === "off") {
                try {
                  const idx = ytPlayer.getPlaylistIndex();
                  const pl = ytPlayer.getPlaylist();
                  if (pl && idx >= 0 && idx >= pl.length - 1) {
                    isPlaying = false; updatePlayBtn();
                    return;
                  }
                } catch (_) {}
              }
              // Deixa o YouTube avançar normalmente
              return;
            }
            // youtube-videos: gerir queue manualmente.
            if (currentPlaylist && currentPlaylist.type === "youtube-videos") {
              if (repeat === "one") {
                const trk = currentTrack();
                if (trk && ytPlayerReady) try { ytPlayer.loadVideoById(trk.videoId); } catch (_) {}
                return;
              }
              if (shuffle) { queueIdx = randomQueueIdx(); loadCurrent(true); return; }
              if (queueIdx + 1 < queueOrder.length) { queueIdx++; loadCurrent(true); return; }
              if (repeat === "all" && queueOrder.length > 0) { queueIdx = 0; loadCurrent(true); return; }
              isPlaying = false; updatePlayBtn();
            }
            return;
          }
          // MP3: repeat "one" é tratado por audio.loop (não chega aqui).
          next();
        }

        // ── Shuffle (Scramble) ──
        // Em vez de baralhar a queue, o shuffle escolhe uma música random
        // quando next() é chamado ou quando a música acaba.
        // MUTUAMENTE EXCLUSIVO com repeat: ativar shuffle desativa repeat.
        function setShuffle(on) {
          if (on === shuffle) return;
          shuffle = on;
          shuffleBtn.classList.toggle("active", shuffle);
          // Se a ativar shuffle, desativa repeat (mutuamente exclusivos)
          if (on && repeat !== "off") {
            repeat = "off";
            repeatBtn.classList.remove("active");
            repeatBtn.innerHTML = ICONS.mpRepeat;
            repeatBtn.title = "Repeat: Off";
            audio.loop = false;
            // Se estava em single-video mode (repeat one), sai e recarrega a playlist
            if (ytSingleMode && mode === "youtube" && currentPlaylist && currentPlaylist.type === "youtube-playlist") {
              ytSingleMode = false;
              if (ytPlayerReady && ytPlayer) {
                try {
                  ytPlayer.loadPlaylist({
                    list: currentPlaylist.youtubePlaylistId,
                    listType: "playlist",
                    index: 0,
                    startSeconds: 0
                  });
                } catch (_) {}
              }
            }
            if (mode === "youtube" && currentPlaylist && currentPlaylist.type === "youtube-playlist") {
              if (ytPlayerReady && ytPlayer) try { ytPlayer.setLoop(false); } catch (_) {}
            }
          }
          ytPreempted = false; // reset preempt flag ao mudar shuffle
          // YouTube playlist: o YouTube gere a fila — usa setShuffle do player
          if (mode === "youtube" && currentPlaylist && currentPlaylist.type === "youtube-playlist") {
            if (ytPlayerReady && ytPlayer) try { ytPlayer.setShuffle(on); } catch (_) {}
            return;
          }
          updateNextDisplay();
          updatePlaylistUI();
        }

        // Escolhe um índice random da queue (diferente do atual se possível)
        function randomQueueIdx() {
          if (queueOrder.length <= 1) return queueIdx;
          let r;
          do { r = Math.floor(Math.random() * queueOrder.length); } while (r === queueIdx);
          return r;
        }

        // ── Repeat (cycle off → all → one) ──
        // MUTUAMENTE EXCLUSIVO com shuffle: ativar repeat desativa shuffle.
        function cycleRepeat() {
          const prevRepeat = repeat;
          if (repeat === "off") repeat = "all";
          else if (repeat === "all") repeat = "one";
          else repeat = "off";
          repeatBtn.classList.toggle("active", repeat !== "off");
          repeatBtn.innerHTML = repeat === "one" ? ICONS.mpRepeatOne : ICONS.mpRepeat;
          repeatBtn.title = "Repeat: " + (repeat === "off" ? "Off" : repeat === "all" ? "All" : "One");
          // Se ativar repeat, desativa shuffle (mutuamente exclusivos)
          if (repeat !== "off" && shuffle) {
            shuffle = false;
            shuffleBtn.classList.remove("active");
            if (mode === "youtube" && currentPlaylist && currentPlaylist.type === "youtube-playlist") {
              if (ytPlayerReady && ytPlayer) try { ytPlayer.setShuffle(false); } catch (_) {}
            }
          }
          // MP3: repeat "one" usa audio.loop nativo
          audio.loop = (mode === "mp3" && repeat === "one");

          // YouTube playlist: repeat "one" usa single-video mode (loadVideoById).
          // Isto remove o auto-avanço do YouTube — o onEnded repete o vídeo.
          // Repeat "all" usa setLoop(true) do YouTube.
          // Se mudar de "one" para outro, recarrega a playlist.
          if (mode === "youtube" && currentPlaylist && currentPlaylist.type === "youtube-playlist") {
            if (ytPlayerReady && ytPlayer) {
              try {
                if (repeat === "one") {
                  // Entra em single-video mode: obtém o videoId atual e toca isolado
                  const data = ytPlayer.getVideoData();
                  if (data && data.video_id) {
                    ytSingleMode = true;
                    ytPlayer.loadVideoById(data.video_id);
                  }
                } else {
                  // Sai de single-video mode: recarrega a playlist
                  if (ytSingleMode || prevRepeat === "one") {
                    ytSingleMode = false;
                    ytPlayer.loadPlaylist({
                      list: currentPlaylist.youtubePlaylistId,
                      listType: "playlist",
                      index: 0,
                      startSeconds: 0
                    });
                  }
                  ytPlayer.setLoop(repeat === "all");
                }
              } catch (_) {}
            }
          }
          updateNextDisplay();
        }

        // ── Playlist panel ──
        function togglePlaylist() {
          const willOpen = !playlistPanel.classList.contains("open");
          playlistPanel.classList.toggle("open", willOpen);
          playlistBtn.classList.toggle("active", willOpen);
          // Quando a playlist abre, o canvas encolhe para dar espaço.
          // A classe no viz-wrap faz o canvas reduzir (right: 170px) e o
          // ResizeObserver disca resizeCanvas() automaticamente.
          const vizWrap = wrap.querySelector(".mp-viz-wrap");
          if (vizWrap) vizWrap.classList.toggle("playlist-open", willOpen);
        }
        // Cache de títulos de vídeos YouTube (videoId → title)
        // Para não chamar oEmbed repetidamente para o mesmo vídeo.
        const ytTitleCache = {};
        let ytPlaylistVideos = [];  // [{ videoId, name }] da playlist YouTube atual
        let ytPlaylistIdx = -1;     // índice atual na playlist YouTube

        // Busca o título de um vídeo via oEmbed (com cache).
        async function fetchYTTitle(videoId) {
          if (ytTitleCache[videoId]) return ytTitleCache[videoId];
          try {
            const url = "https://www.youtube.com/oembed?url=" + encodeURIComponent("https://www.youtube.com/watch?v=" + videoId) + "&format=json";
            const res = await fetch(url);
            if (!res.ok) return null;
            const data = await res.json();
            const title = data.title || "";
            ytTitleCache[videoId] = title;
            return title;
          } catch (_) { return null; }
        }

        // Lê a playlist atual do YouTube IFrame player (array de video IDs)
        // e atualiza ytPlaylistVideos com títulos (via oEmbed em background).
        function refreshYTPlaylistVideos() {
          if (!ytPlayerReady || !ytPlayer || mode !== "youtube" || !currentPlaylist || currentPlaylist.type !== "youtube-playlist") return;
          try {
            const ids = ytPlayer.getPlaylist();  // array de video IDs ou null
            const idx = ytPlayer.getPlaylistIndex();  // índice atual ou -1
            if (!ids || !ids.length) return;
            // Constrói a lista (com nomes em cache ou "A carregar...")
            ytPlaylistVideos = ids.map(function (vid) {
              return { videoId: vid, name: ytTitleCache[vid] || ("YouTube (" + vid + ")") };
            });
            ytPlaylistIdx = idx >= 0 ? idx : -1;
            // Re-renderiza a lista da playlist
            updatePlaylistUI();
            // Busca títulos em background (um a um, para não spamar)
            ids.forEach(function (vid, i) {
              if (!ytTitleCache[vid]) {
                fetchYTTitle(vid).then(function (title) {
                  if (title && ytPlaylistVideos[i]) {
                    ytPlaylistVideos[i].name = title;
                    updatePlaylistUI();
                  }
                });
              }
            });
          } catch (_) {}
        }

        function updatePlaylistUI() {
          playlistItems.innerHTML = "";
          // youtube-playlist: mostra os vídeos reais da playlist do YouTube.
          if (mode === "youtube" && currentPlaylist && currentPlaylist.type === "youtube-playlist") {
            if (ytPlaylistVideos.length === 0) {
              const row = document.createElement("div");
              row.className = "mp-playlist-info";
              row.textContent = "\u25b6 " + (currentPlaylist.name || "YouTube Playlist");
              playlistItems.appendChild(row);
              return;
            }
            ytPlaylistVideos.forEach(function (v, i) {
              const row = document.createElement("div");
              row.className = "mp-playlist-item" + (i === ytPlaylistIdx ? " current" : "");
              row.innerHTML = '<span class="mp-pl-num">' + (i + 1) + '</span><span class="mp-pl-name">' + escapeHtml(v.name) + '</span>';
              // Click → salta para esse vídeo na playlist do YouTube
              row.addEventListener("click", function () {
                if (ytPlayerReady && ytPlayer) {
                  try { ytPlayer.playVideoAt(i); } catch (_) {}
                }
              });
              playlistItems.appendChild(row);
            });
            return;
          }
          queueOrder.forEach(function (ti, qi) {
            const trk = tracks[ti];
            if (!trk) return;
            const row = document.createElement("div");
            row.className = "mp-playlist-item" + (qi === queueIdx ? " current" : "");
            // youtube-videos não têm .src; MP3 sim.
            const label = trk.name || (trk.src ? friendlyName(decodeURIComponent(trk.src.split("/").pop() || "")) : "YouTube");
            row.innerHTML = '<span class="mp-pl-num">' + (qi + 1) + '</span><span class="mp-pl-name">' + escapeHtml(label) + '</span>';
            row.addEventListener("click", function () { queueIdx = qi; loadCurrent(true); });
            playlistItems.appendChild(row);
          });
        }

        // ── YouTube IFrame Player (lazy init) ──
        // ensureYTPlayer(cb): carrega a YouTube IFrame API (uma única vez),
        // cria o player no div .mp-yt-player e chama cb quando estiver pronto.
        // Se o player já estiver pronto, chama cb imediatamente.
        function ensureYTPlayer(cb) {
          if (ytPlayerReady && ytPlayer) { if (cb) try { cb(); } catch (_) {} return; }
          // Enfileira o callback (pode haver vários callers antes do ready).
          if (cb) {
            const prev = ytPendingReady;
            ytPendingReady = function () { if (prev) try { prev(); } catch (_) {} try { cb(); } catch (_) {} };
          }
          if (ytPlayerInitializing) return;
          ytPlayerInitializing = true;
          loadYouTubeIframeAPI().then(function (YT) {
            try {
              ytPlayer = new YT.Player(ytWrap, {
                height: "100%",
                width: "100%",
                playerVars: {
                  autoplay: 0,
                  controls: 1,
                  disablekb: 0,
                  fs: 0,
                  rel: 0,
                  modestbranding: 1,
                  playsinline: 1
                },
                events: {
                  onReady: function () {
                    ytPlayerReady = true;
                    ytPlayerInitializing = false;
                    applyVolume();
                    // Dispara callback(s) pendentes.
                    if (ytPendingReady) {
                      const fn = ytPendingReady;
                      ytPendingReady = null;
                      try { fn(); } catch (_) {}
                    }
                  },
                  onStateChange: function (e) {
                    const YTS = window.YT ? window.YT.PlayerState : null;
                    if (!YTS) return;
                    if (e.data === YTS.PLAYING) {
                      isPlaying = true;
                      updatePlayBtn();
                      startVizLoop();
                      applyVolume();
                      // Reset do flag preempt — um novo vídeo começou
                      ytPreempted = false;
                      updateYTTrackInfo();
                      startYTPoll();
                      refreshYTPlaylistVideos();
                    } else if (e.data === YTS.PAUSED) {
                      isPlaying = false;
                      updatePlayBtn();
                    } else if (e.data === YTS.ENDED) {
                      // Para youtube-playlist com repeat "one" ou shuffle:
                      // o YouTube auto-avança imediatamente após o ENDED.
                      // Usamos setTimeout(0) para interceptar APÓS o auto-avanço
                      // e forçar o nosso comportamento (repetir ou random).
                      if (mode === "youtube" && currentPlaylist && currentPlaylist.type === "youtube-playlist" && (repeat === "one" || shuffle)) {
                        setTimeout(function () { onEnded(); }, 100);
                      } else {
                        onEnded();
                      }
                    }
                  },
                  onError: function () {
                    // Erro de carregamento (vídeo privado/removed) → avança.
                    if (mode === "youtube") onEnded();
                  }
                }
              });
            } catch (e) {
              ytPlayerInitializing = false;
            }
          }).catch(function () {
            ytPlayerInitializing = false;
          });
        }

        // Atualiza o nome e capa do vídeo YouTube atual.
        // Usa player.getVideoData() para obter o título real do vídeo,
        // e constrói a thumbnail URL a partir do videoId.
        let lastYTVideoId = null;
        let ytSingleMode = false;      // true quando repeat "one" está ativo em youtube-playlist
        let ytPreempted = false;        // true quando já saltámos para o próximo (shuffle preempt)
        function updateYTTrackInfo() {
          if (!ytPlayerReady || !ytPlayer || mode !== "youtube") return;
          try {
            const data = ytPlayer.getVideoData();
            if (!data) return;
            const vid = data.video_id || "";
            const title = data.title || "";
            if (vid && vid !== lastYTVideoId) {
              lastYTVideoId = vid;
              // Atualiza o nome da faixa com o título real do vídeo
              // (se título vazio, mantém o nome atual — pode ainda não estar disponível)
              if (title) trackEl.textContent = title;
              // Constrói a thumbnail do YouTube a partir do videoId
              const thumb = "https://i.ytimg.com/vi/" + vid + "/hqdefault.jpg";
              cover.src = thumb;
              cover.style.display = "";
              coverPlaceholder.style.display = "none";
            } else if (vid === lastYTVideoId && title && trackEl.textContent !== title) {
              // Mesmo vídeo mas título agora disponível — atualiza
              trackEl.textContent = title;
            }
          } catch (_) {}
        }

        // Polling de tempo/progresso para o YouTube (getCurrentTime/getDuration).
        // Também deteta mudanças de vídeo (em playlists) e atualiza nome/capa/lista.
        // SHUFFLE PREEMPT: salta para um vídeo random 2s antes do fim (evita
        // que o YouTube auto-avançe linearmente).
        function startYTPoll() {
          if (ytPollId) return;
          ytPollId = setInterval(function () {
            if (!ytPlayerReady || !ytPlayer) return;
            try {
              const ct = ytPlayer.getCurrentTime() || 0;
              const dur = ytPlayer.getDuration() || 0;
              timeEl.textContent = formatTime(ct) + " / " + formatTime(dur);
              if (dur) progressFill.style.width = (ct / dur * 100) + "%";
              // Deteta mudança de vídeo (em playlists YouTube gere a fila)
              updateYTTrackInfo();
              // SHUFFLE PREEMPT: se shuffle ativo em youtube-playlist e faltam ≤2s
              // para o fim, salta para um vídeo random ANTES do YouTube auto-avançar.
              if (mode === "youtube" && currentPlaylist && currentPlaylist.type === "youtube-playlist"
                  && shuffle && !ytSingleMode && dur > 5 && !ytPreempted) {
                if (dur - ct <= 2) {
                  ytPreempted = true;
                  try {
                    const pl = ytPlayer.getPlaylist();
                    const curIdx = ytPlayer.getPlaylistIndex();
                    if (pl && pl.length > 1 && curIdx >= 0) {
                      let r;
                      do { r = Math.floor(Math.random() * pl.length); } while (r === curIdx);
                      ytPlayer.playVideoAt(r);
                    }
                  } catch (_) {}
                }
              }
              // Deteta mudança de índice na playlist (vídeo seguinte)
              if (mode === "youtube" && currentPlaylist && currentPlaylist.type === "youtube-playlist" && !ytSingleMode) {
                try {
                  const idx = ytPlayer.getPlaylistIndex();
                  if (idx >= 0 && idx !== ytPlaylistIdx) {
                    ytPlaylistIdx = idx;
                    updatePlaylistUI();
                  }
                } catch (_) {}
              }
            } catch (_) {}
          }, 500);
        }
        function stopYTPoll() {
          if (ytPollId) { clearInterval(ytPollId); ytPollId = null; }
        }

        // ── Persistência de playlists personalizadas (localStorage) ──
        function loadCustomPlaylists() {
          try {
            const raw = localStorage.getItem(MP_PLAYLISTS_KEY);
            if (!raw) return { playlists: [], activePlaylistId: null };
            const data = JSON.parse(raw);
            if (!data || !Array.isArray(data.playlists)) return { playlists: [], activePlaylistId: null };
            return { playlists: data.playlists, activePlaylistId: data.activePlaylistId || null };
          } catch (_) {
            return { playlists: [], activePlaylistId: null };
          }
        }
        function saveCustomPlaylists() {
          try {
            // Não guarda activePlaylistId — o leitor começa sempre no estado default.
            localStorage.setItem(MP_PLAYLISTS_KEY, JSON.stringify({
              playlists: customPlaylists
            }));
          } catch (_) {}
        }
        function genId() {
          return "pl_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
        }

        // ── Render da lista de playlists no switcher ──
        // Cada item: [nome] (+ [×] se for personalizada). Default não tem remove.
        function renderPlaylists() {
          if (!plList) return;
          plList.innerHTML = "";
          // 1) Default (Caravela)
          const def = document.createElement("div");
          def.className = "mp-pl-tab" + (activePlaylistId === null ? " active" : "");
          def.setAttribute("data-id", "");
          def.innerHTML = '<span class="mp-pl-tab-name">' + escapeHtml(t("Playlist padrão")) + '</span>';
          def.addEventListener("click", function () { setCurrentPlaylist(null); });
          plList.appendChild(def);
          // 2) Playlists personalizadas
          customPlaylists.forEach(function (pl) {
            const row = document.createElement("div");
            row.className = "mp-pl-tab" + (activePlaylistId === pl.id ? " active" : "");
            row.setAttribute("data-id", pl.id);
            const nameSpan = document.createElement("span");
            nameSpan.className = "mp-pl-tab-name";
            nameSpan.textContent = pl.name;
            row.appendChild(nameSpan);
            // Botão remover
            const rm = document.createElement("button");
            rm.className = "mp-pl-tab-rm";
            rm.type = "button";
            rm.setAttribute("aria-label", t("Remover playlist"));
            rm.setAttribute("title", t("Remover playlist"));
            rm.textContent = "\u00d7";
            rm.addEventListener("click", function (e) {
              e.stopPropagation();
              removeCustomPlaylist(pl.id);
            });
            row.appendChild(rm);
            row.addEventListener("click", function () { setCurrentPlaylist(pl.id); });
            plList.appendChild(row);
          });
        }

        // ── Toggle do form de adicionar playlist ──
        function toggleAddForm(show) {
          if (show) {
            plForm.classList.remove("hidden");
            plAddBtn.style.display = "none";
            plNameInput.focus();
          } else {
            plForm.classList.add("hidden");
            plAddBtn.style.display = "";
            plNameInput.value = "";
            plUrlInput.value = "";
          }
        }

        // ── Adicionar playlist personalizada ──
        // Busca título e thumbnail via YouTube oEmbed API (CORS-enabled, sem API key).
        // Para vídeos individuais: busca o título e thumbnail do vídeo.
        // Para playlists: busca o título e thumbnail da playlist.
        async function fetchYouTubeOEmbed(url) {
          try {
            const apiUrl = "https://www.youtube.com/oembed?url=" + encodeURIComponent(url) + "&format=json";
            const res = await fetch(apiUrl);
            if (!res.ok) return null;
            const data = await res.json();
            return { title: data.title || "", thumbnail: data.thumbnail_url || "", author: data.author_name || "" };
          } catch (_) { return null; }
        }

        async function addCustomPlaylist(name, parsed, originalUrl) {
          let pl;
          // Busca metadados via oEmbed (título real + thumbnail)
          // NOTA: oEmbed só funciona para vídeos individuais, NÃO para playlists.
          let oembed = null;
          if (parsed.type === "video" && originalUrl) {
            oembed = await fetchYouTubeOEmbed(originalUrl);
          }
          const finalName = oembed && oembed.title ? oembed.title : name;
          const cover = oembed && oembed.thumbnail ? oembed.thumbnail : "";

          if (parsed.type === "playlist") {
            pl = {
              id: genId(),
              name: name,  // playlists: usa o nome do utilizador (oEmbed não funciona)
              type: "youtube-playlist",
              youtubePlaylistId: parsed.playlistId,
              cover: ""  // sem capa inicial — aparece quando o 1º vídeo toca
            };
          } else {
            pl = {
              id: genId(),
              name: finalName,
              type: "youtube-videos",
              cover: cover,
              videos: [{ videoId: parsed.videoId, name: finalName, cover: cover }]
            };
          }
          customPlaylists.push(pl);
          saveCustomPlaylists();
          renderPlaylists();
          // Torna a nova playlist ativa automaticamente.
          setCurrentPlaylist(pl.id);
          return true;
        }

        // ── Remover playlist personalizada ──
        function removeCustomPlaylist(id) {
          customPlaylists = customPlaylists.filter(function (p) { return p.id !== id; });
          if (activePlaylistId === id) {
            // Vai para a default se a ativa foi removida.
            saveCustomPlaylists();
            setCurrentPlaylist(null);
          } else {
            saveCustomPlaylists();
            renderPlaylists();
          }
        }

        // ── Trocar de playlist ativa ──
        // playlistId === null → default MP3 tracklist.
        // Caso contrário → playlist YouTube (playlist ou vídeos).
        function setCurrentPlaylist(playlistId) {
          // Pára o playback atual.
          stopYTPoll();
          if (mode === "mp3") {
            try { audio.pause(); } catch (_) {}
            try { audio.src = ""; } catch (_) {}
          } else if (ytPlayer) {
            try { ytPlayer.stopVideo(); } catch (_) {}
          }
          activePlaylistId = playlistId;
          saveCustomPlaylists();
          isPlaying = false;
          updatePlayBtn();

          if (playlistId === null) {
            // ── Default MP3 ──
            mode = "mp3";
            currentPlaylist = null;
            tracks = defaultTracks.slice();
            queueOrder = tracks.map(function (_, i) { return i; });
            queueIdx = 0;
            useSyntheticFallback = false;
            corsZeroStreak = 0; // reset: dá nova oportunidade ao analyser real
            progressRow.style.display = "";
            renderPlaylists();
            loadCurrent(false);
            return;
          }

          const pl = customPlaylists.find(function (p) { return p.id === playlistId; });
          if (!pl) {
            // Não existe — volta à default.
            activePlaylistId = null;
            saveCustomPlaylists();
            setCurrentPlaylist(null);
            return;
          }
          currentPlaylist = pl;
          mode = "youtube";
          useSyntheticFallback = true; // força fallback sintético (sem AnalyserNode)
          // A <audio> fica parada; o YouTube IFrame toca em paralelo (hidden).
          try { audio.pause(); } catch (_) {}
          progressRow.style.display = ""; // mantém para tempo/progresso via poll
          // Limpa a capa anterior (pode ser do MP3 default)
          lastYTVideoId = null;
          ytPlaylistVideos = [];
          ytPlaylistIdx = -1;
          ytSingleMode = false;
          ytPreempted = false;
          if (pl.cover) {
            cover.src = pl.cover;
            cover.style.display = "";
            coverPlaceholder.style.display = "none";
          } else {
            cover.src = "";
            cover.style.display = "none";
            coverPlaceholder.style.display = "";
          }
          renderPlaylists();

          ensureYTPlayer(function () {
            try {
              if (pl.type === "youtube-playlist") {
                // loadPlaylist autotoca; o YouTube gere a fila completa.
                ytPlayer.loadPlaylist({
                  list: pl.youtubePlaylistId,
                  listType: "playlist",
                  index: 0,
                  startSeconds: 0
                });
                trackEl.textContent = pl.name;
                // Mostra a capa da playlist (thumbnail do oEmbed) enquanto o 1º vídeo não carrega
                if (pl.cover) {
                  cover.src = pl.cover;
                  cover.style.display = "";
                  coverPlaceholder.style.display = "none";
                } else {
                  cover.style.display = "none";
                  coverPlaceholder.style.display = "";
                }
                updateNextDisplay();
                updatePlaylistUI();
              } else if (pl.type === "youtube-videos") {
                // Constrói tracks[] a partir dos vídeos e carrega o primeiro.
                tracks = pl.videos.map(function (v) {
                  return { name: v.name, videoId: v.videoId, cover: v.cover || null, src: null };
                });
                queueOrder = tracks.map(function (_, i) { return i; });
                queueIdx = 0;
                // Em modo YouTube, shuffle não é persistido entre trocas (reset).
                loadCurrent(true);
              }
              startYTPoll();
            } catch (_) {}
          });
        }

        // ── Visualizer ──
        function resizeCanvas() {
          const r = canvas.getBoundingClientRect();
          canvas.width = Math.max(1, Math.floor(r.width));
          canvas.height = Math.max(1, Math.floor(r.height));
          // reinicia state do visualizer ao redimensionar
          const v = window.VISUALIZERS.get(currentVizId);
          if (v && v.init) vizState = v.init(ctx2d, canvas.width, canvas.height);
        }
        function setVisualizer(id) {
          currentVizId = id;
          const v = window.VISUALIZERS.get(id);
          if (v && v.init) vizState = v.init(ctx2d, canvas.width, canvas.height);
          vizBadge.textContent = v ? v.name : "";
          vizSelect.value = id;
        }
        function startVizLoop() {
          if (rafId) return;
          lastTs = performance.now();
          rafId = requestAnimationFrame(vizFrame);
        }
        // Gera dados sintéticos realistas quando o analyser está bloqueado por CORS.
        // Simula bass/mid/treble com diferentes frequências e amplitude moderada.
        function fillSynthetic() {
          syntheticT += 0.016;
          if (!freqData) freqData = new Uint8Array(1024);
          if (!waveData) waveData = new Uint8Array(1024);
          const playing = isPlaying ? 1 : 0.15; // idle motion muito subtil
          for (let i = 0; i < freqData.length; i++) {
            // bass (low i) tem mais energia, treble (high i) menos
            const bass = Math.sin(syntheticT * 2.2 + i * 0.05) * 0.5 + 0.5;
            const mid = Math.sin(syntheticT * 4.5 + i * 0.12) * 0.4 + 0.4;
            const fall = Math.exp(-i / (freqData.length * 0.3));
            const v = (bass * 0.7 + mid * 0.3) * fall * 220 * playing;
            freqData[i] = Math.max(0, Math.min(255, v));
          }
          for (let i = 0; i < waveData.length; i++) {
            const v = 128 + Math.sin(syntheticT * 8 + i * 0.1) * 30 * playing
                          + Math.sin(syntheticT * 3 + i * 0.05) * 15 * playing;
            waveData[i] = Math.max(0, Math.min(255, v));
          }
        }
        // Contador de frames consecutivos com freqData tudo zero enquanto toca.
        // Só ativa o fallback sintético se houver muitos zeros seguidos (CORS
        // taint real) — não basta um frame de silêncio (início/mudança de faixa).
        let corsZeroStreak = 0;

        function vizFrame(ts) {
          rafId = requestAnimationFrame(vizFrame);
          const dt = Math.min(0.05, (ts - lastTs) / 1000);
          lastTs = ts;
          const w = canvas.width, h = canvas.height;
          // Em modo MP3 (playlist default) usamos SEMPRE o AnalyserNode real.
          // O CORS do raw.githubusercontent.com envia Access-Control-Allow-Origin: *,
          // e o <audio> tem crossorigin="anonymous", pelo que o analyser funciona.
          // Não ativamos fallback sintético em modo MP3 — mesmo que haja silêncio
          // legítimo (início de faixa, pausa), o visualizer mostra zeros reais.
          //
          // Em modo YouTube (playlists customizadas) o <audio> não está a tocar
          // (o YouTube IFrame é que produz som), por isso usamos fallback sintético.
          if (mode === "mp3" && analyserReady && analyser) {
            analyser.getByteFrequencyData(freqData);
            analyser.getByteTimeDomainData(waveData);
          } else if (mode === "youtube" || !analyserReady || useSyntheticFallback) {
            // Fallback sintético: YouTube, analyser não pronto, ou CORS bloqueado.
            fillSynthetic();
          } else {
            if (freqData) freqData.fill(0);
            if (waveData) waveData.fill(128);
          }
          const v = window.VISUALIZERS.get(currentVizId);
          if (v && vizState) v.draw(ctx2d, w, h, freqData, waveData, vizState, dt);
        }

        // ── Event wiring ──
        playBtn.addEventListener("click", togglePlay);
        wrap.querySelector('.mp-btn[data-act="prev"]').addEventListener("click", prev);
        wrap.querySelector('.mp-btn[data-act="next"]').addEventListener("click", next);
        shuffleBtn.addEventListener("click", function () { setShuffle(!shuffle); });
        repeatBtn.addEventListener("click", cycleRepeat);
        playlistBtn.addEventListener("click", togglePlaylist);
        vizSelect.addEventListener("change", function () { setVisualizer(vizSelect.value); });

        // Volume slider → aplica volume live (0-100 → 0-1) e persiste
        volumeSlider.addEventListener("input", function () {
          mediaVolume = parseInt(volumeSlider.value, 10) / 100;
          try { localStorage.setItem(MEDIA_VOL_KEY, String(mediaVolume)); } catch (_) {}
          applyVolume();
        });

        // ── Playlist switcher (adicionar / remover / trocar) ──
        plAddBtn.addEventListener("click", function () { toggleAddForm(true); });
        plFormCancel.addEventListener("click", function () { toggleAddForm(false); });
        plFormAdd.addEventListener("click", function () {
          const name = (plNameInput.value || "").trim();
          const url = (plUrlInput.value || "").trim();
          if (!name || !url) return;
          const parsed = parseYouTubeURL(url);
          if (!parsed) { alert(t("URL inválida")); return; }
          // Mostra feedback visual no botão enquanto busca metadados do YouTube
          plFormAdd.textContent = "...";
          plFormAdd.disabled = true;
          addCustomPlaylist(name, parsed, url).then(function (ok) {
            plFormAdd.textContent = t("Adicionar");
            plFormAdd.disabled = false;
            if (ok) {
              plNameInput.value = "";
              plUrlInput.value = "";
              toggleAddForm(false);
            } else {
              alert(t("Erro ao adicionar playlist"));
            }
          }).catch(function () {
            plFormAdd.textContent = t("Adicionar");
            plFormAdd.disabled = false;
            alert(t("Erro ao adicionar playlist"));
          });
        });
        // Enter em qualquer input do form também submete.
        plNameInput.addEventListener("keydown", function (e) {
          if (e.key === "Enter") { e.preventDefault(); plFormAdd.click(); }
          else if (e.key === "Escape") { toggleAddForm(false); }
        });
        plUrlInput.addEventListener("keydown", function (e) {
          if (e.key === "Enter") { e.preventDefault(); plFormAdd.click(); }
          else if (e.key === "Escape") { toggleAddForm(false); }
        });

        audio.addEventListener("loadedmetadata", function () { timeEl.textContent = "0:00 / " + formatTime(audio.duration); });
        audio.addEventListener("timeupdate", function () {
          timeEl.textContent = formatTime(audio.currentTime) + " / " + formatTime(audio.duration);
          if (audio.duration) progressFill.style.width = (audio.currentTime / audio.duration * 100) + "%";
        });
        audio.addEventListener("ended", onEnded);
        audio.addEventListener("error", function () { /* CORS/load fail — silencioso */ });

        progressBar.addEventListener("click", function (e) {
          const rect = progressBar.getBoundingClientRect();
          const pct = (e.clientX - rect.left) / rect.width;
          if (mode === "youtube") {
            if (ytPlayerReady && ytPlayer) {
              try {
                const dur = ytPlayer.getDuration() || 0;
                if (dur) ytPlayer.seekTo(pct * dur, true);
              } catch (_) {}
            }
            return;
          }
          if (audio.duration) audio.currentTime = pct * audio.duration;
        });

        // Resize observer para o canvas
        const ro = new ResizeObserver(function () { resizeCanvas(); });
        ro.observe(canvas);

        // Storage event: respeita mute global do site (atualiza volume)
        window.addEventListener("storage", applyVolume);

        // Cleanup quando a janela fecha (window.js chama onClose)
        wrap._onClose = function () {
          if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
          stopYTPoll();
          if (ytPlayer) {
            try { ytPlayer.stopVideo(); } catch (_) {}
            try { ytPlayer.destroy(); } catch (_) {}
            ytPlayer = null;
            ytPlayerReady = false;
            ytPlayerInitializing = false;
            ytPendingReady = null;
          }
          audio.pause();
          audio.src = "";
          ro.disconnect();
          try { if (audioCtx && audioCtx.state !== "closed") audioCtx.close(); } catch (_) {}
        };

        // ── Inicialização ──
        resizeCanvas();
        setVisualizer(currentVizId);
        applyVolume(); // aplica volume inicial + ícone correto
        // Carrega playlists personalizadas do localStorage (apenas a lista,
        // NÃO restaura a playlist ativa — o leitor começa sempre no default).
        const loaded = loadCustomPlaylists();
        customPlaylists = loaded.playlists;
        activePlaylistId = null;  // sempre começa no default
        renderPlaylists();
        // Default MP3 tracklist — sem música selecionada, sem autoplay
        updatePlaylistUI();
        // NÃO chama loadCurrent() — não há música selecionada até o user clicar Play
        trackEl.textContent = t("Sem faixa");
        timeEl.textContent = "0:00 / 0:00";
        progressFill.style.width = "0%";
        cover.style.display = "none";
        coverPlaceholder.style.display = "";
        // Abre a aba de playlist por defeito (visível ao abrir o media player)
        playlistPanel.classList.add("open");
        playlistBtn.classList.add("active");
        const initVizWrap = wrap.querySelector(".mp-viz-wrap");
        if (initVizWrap) initVizWrap.classList.add("playlist-open");
        // Inicia o loop do visualizador (idle motion)
        startVizLoop();
        return wrap;
      },
    },

    "settings-display": {
      title: "Propriedades de Visualização",
      icon: ICONS.display,
      width: 340, height: 280,
      render: function () {
        const wrap = document.createElement("div");
        wrap.className = "app-settings";

        // ── PADRÕES DE FUNDO ──
        // As keys servem de ID persistido em localStorage e de label no select.
        // NOTA: os nomes antigos ("Hexagons", "Bricks") são migrados para os
        // novos ("Aurora", "Meadow") automaticamente no load.
        const BG_PATTERNS = {
          "Teal (Default)": "#008080",
          "Clouds": "linear-gradient(180deg, #4a90d9, #b0d8f0)",
          "Aurora": "linear-gradient(180deg, #020210, #061830)",
          "Stars": "linear-gradient(180deg, #000510, #000515)",
          "Meadow": "linear-gradient(180deg, #5ba8e0 0%, #5ba8e0 55%, #5aa030 55%, #387018 100%)",
          "Matrix": "linear-gradient(180deg, #000800, #000300)",
        };
        // Migração de nomes antigos
        const BG_NAME_MIGRATION = {
          "Hexagons": "Aurora",
          "Bricks": "Meadow",
        };
        const DESKTOP_BG_KEY = "jce_desktop_bg";
        let savedBg = "Teal (Default)";
        try { savedBg = localStorage.getItem(DESKTOP_BG_KEY) || "Teal (Default)"; } catch (_) {}
        // Migra nomes antigos para os novos
        if (BG_NAME_MIGRATION[savedBg]) {
          savedBg = BG_NAME_MIGRATION[savedBg];
          try { localStorage.setItem(DESKTOP_BG_KEY, savedBg); } catch (_) {}
        }
        const prevBg = savedBg;

        wrap.innerHTML =
          '<div class="app-settings-tabs">' +
            '<div class="app-settings-tab active" data-tab="background">' + t("Fundo de ecrã") + '</div>' +
            '<div class="app-settings-tab" data-tab="screensaver">' + t("Proteção de ecrã") + '</div>' +
            '<div class="app-settings-tab" data-tab="appearance">' + t("Aparência") + '</div>' +
            '<div class="app-settings-tab" data-tab="settings">' + t("Definições") + '</div>' +
          '</div>' +
          '<div class="app-settings-body" data-panel="background">' +
            '<div class="app-settings-row">' +
              '<label>' + t("Padrão:") + '</label>' +
              '<select class="app-settings-select">' +
                Object.keys(BG_PATTERNS).map(function (c) {
                  return '<option value="' + c + '"' + (c === savedBg ? ' selected' : '') + '>' + c + '</option>';
                }).join('') +
              '</select>' +
            '</div>' +
            '<div class="app-settings-preview">' + t("Antevisão") + '</div>' +
          '</div>' +
          '<div class="app-settings-body hidden" data-panel="screensaver">' +
            '<div class="app-settings-row">' +
              '<label>' + t("Proteção de ecrã:") + '</label>' +
              '<select class="app-settings-saver-select">' +
                '<option value="starfield">' + t("3D Starfield") + '</option>' +
                '<option value="windows">' + t("Janelas Voadoras") + '</option>' +
                '<option value="blank">' + t("Ecrã vazio") + '</option>' +
              '</select>' +
            '</div>' +
            '<div class="app-settings-row">' +
              '<label>' + t("Esperar:") + '</label>' +
              '<input type="number" min="1" max="60" value="' + (window.screensaver ? window.screensaver.getWaitMinutes() : 5) + '" class="app-settings-wait"/>' +
              '<span>' + t("minutos") + '</span>' +
            '</div>' +
            '<div class="app-settings-row">' +
              '<button class="app-settings-btn app-settings-preview-btn" type="button">' + t("Antevisão") + '</button>' +
            '</div>' +
          '</div>' +
          '<div class="app-settings-body hidden" data-panel="appearance">' +
            '<div class="app-settings-placeholder">' + t("Definições de aparência") + '</div>' +
          '</div>' +
          '<div class="app-settings-body hidden" data-panel="settings">' +
            '<div class="app-settings-placeholder">' + t("Definições avançadas") + '</div>' +
          '</div>' +
          '<div class="app-settings-buttons">' +
            '<button class="app-settings-btn" data-action="ok">' + t("OK") + '</button>' +
            '<button class="app-settings-btn" data-action="cancel">' + t("Cancelar") + '</button>' +
            '<button class="app-settings-btn" data-action="apply">' + t("Aplicar") + '</button>' +
          '</div>';

        // ── TAB SWITCHING ──
        const tabs = wrap.querySelectorAll(".app-settings-tab");
        const panels = wrap.querySelectorAll("[data-panel]");
        tabs.forEach(function (tabEl) {
          tabEl.addEventListener("click", function () {
            const name = tabEl.dataset.tab;
            tabs.forEach(function (other) { other.classList.toggle("active", other === tabEl); });
            panels.forEach(function (p) { p.classList.toggle("hidden", p.dataset.panel !== name); });
          });
        });

        // ── BACKGROUND TAB ──
        const select = wrap.querySelector(".app-settings-select");
        const preview = wrap.querySelector(".app-settings-preview");

        function applyBg(name) {
          // Usa Canvas 2D API para desenhar o background (muito mais qualidade
          // que CSS gradients). Converte para data URL e aplica como background-image.
          if (window.renderDesktopBg) {
            const dataUrl = window.renderDesktopBg(name);
            // Preview (miniatura na janela de settings)
            preview.style.backgroundImage = "url(" + dataUrl + ")";
            preview.style.backgroundSize = "100% 100%";
            preview.style.backgroundRepeat = "no-repeat";
            // Só aplica ao desktop se o computador já estiver ligado
            const content = document.getElementById("crt-content");
            if (content && content.classList.contains("on")) {
              const desktop = document.getElementById("crt-desktop");
              if (desktop) {
                desktop.style.backgroundImage = "url(" + dataUrl + ")";
                desktop.style.backgroundSize = "100% 100%";
                desktop.style.backgroundRepeat = "no-repeat";
              }
            }
          } else {
            // Fallback: CSS gradient (se renderDesktopBg não estiver disponível)
            const bg = BG_PATTERNS[name] || "#008080";
            preview.style.background = bg;
          }
        }
        applyBg(savedBg);

        select.addEventListener("change", function () {
          applyBg(select.value);
        });

        // ── SCREEN SAVER TAB ──
        const saverSelect = wrap.querySelector(".app-settings-saver-select");
        const waitInput = wrap.querySelector(".app-settings-wait");
        const previewBtn = wrap.querySelector(".app-settings-preview-btn");

        if (window.screensaver) {
          saverSelect.value = window.screensaver.getType();
          waitInput.value = window.screensaver.getWaitMinutes();
        }
        saverSelect.addEventListener("change", function () {
          if (window.screensaver) window.screensaver.setType(saverSelect.value);
        });
        waitInput.addEventListener("change", function () {
          if (window.screensaver) window.screensaver.setWaitMinutes(waitInput.value);
        });
        previewBtn.addEventListener("click", function () {
          if (window.screensaver) window.screensaver.start(saverSelect.value);
        });

        // ── BOTÕES OK/Apply/Cancel ──
        function persist() {
          try { localStorage.setItem(DESKTOP_BG_KEY, select.value); } catch (_) {}
        }
        function revert() { applyBg(prevBg); }
        wrap.querySelectorAll(".app-settings-buttons .app-settings-btn").forEach(function (btn) {
          btn.addEventListener("click", function () {
            const action = btn.dataset.action;
            if (action === "ok") {
              persist();
              if (window.wm) window.wm.close("settings-display");
            } else if (action === "apply") {
              persist();
            } else if (action === "cancel") {
              revert();
              if (window.wm) window.wm.close("settings-display");
            }
          });
        });

        return wrap;
      },
    },

    "settings-sound": {
      title: "Propriedades de Som",
      icon: ICONS.sound,
      width: 320, height: 260,
      render: function () {
        const wrap = document.createElement("div");
        wrap.className = "app-settings";

        // Estado atual (lido do computer.js)
        const curVol = window.computer ? window.computer.getAmbientVolume() : 0.55;
        const curMuted = window.computer ? window.computer.getAmbientMuted() : false;
        const curClickMuted = window.computer ? window.computer.getClickMuted() : false;
        // Valores anteriores (para Cancel reverter)
        const prevVol = curVol;
        const prevMuted = curMuted;
        const prevClickMuted = curClickMuted;

        wrap.innerHTML =
          '<div class="app-settings-tabs">' +
            '<div class="app-settings-tab active">' + t("Volume") + '</div>' +
            '<div class="app-settings-tab">' + t("Sons") + '</div>' +
            '<div class="app-settings-tab">' + t("Áudio") + '</div>' +
          '</div>' +
          '<div class="app-settings-body">' +
            '<div class="app-settings-row">' +
              '<label>' + t("Volume principal:") + '</label>' +
              '<input type="range" min="0" max="100" value="' + Math.round(curVol * 100) + '" class="app-settings-slider"/>' +
              '<span class="app-settings-vol-label">' + Math.round(curVol * 100) + '%</span>' +
            '</div>' +
            '<div class="app-settings-row">' +
              '<label><input type="checkbox" class="app-settings-mute"' + (curMuted ? ' checked' : '') + '> ' + t("Silenciar sons ambiente") + '</label>' +
            '</div>' +
            '<div class="app-settings-row">' +
              '<label><input type="checkbox" class="app-settings-click-mute"' + (curClickMuted ? ' checked' : '') + '> ' + t("Silenciar som de click de fundo") + '</label>' +
            '</div>' +
          '</div>' +
          '<div class="app-settings-buttons">' +
            '<button class="app-settings-btn" data-action="ok">' + t("OK") + '</button>' +
            '<button class="app-settings-btn" data-action="cancel">' + t("Cancelar") + '</button>' +
            '<button class="app-settings-btn" data-action="apply">' + t("Aplicar") + '</button>' +
          '</div>';

        const slider = wrap.querySelector(".app-settings-slider");
        const volLabel = wrap.querySelector(".app-settings-vol-label");
        const muteChk = wrap.querySelector(".app-settings-mute");
        const clickMuteChk = wrap.querySelector(".app-settings-click-mute");

        // Slider → aplica volume live (0-100 → 0-1)
        slider.addEventListener("input", function () {
          const v = parseInt(slider.value, 10) / 100;
          volLabel.textContent = slider.value + "%";
          if (window.computer) window.computer.setAmbientVolume(v);
        });

        // Checkbox → aplica mute live
        muteChk.addEventListener("change", function () {
          if (window.computer) window.computer.setAmbientMuted(muteChk.checked);
        });

        // Checkbox → aplica mute isolado do click de fundo live
        clickMuteChk.addEventListener("change", function () {
          if (window.computer) window.computer.setClickMuted(clickMuteChk.checked);
        });

        // Reverte para valores anteriores (Cancel)
        function revert() {
          if (window.computer) {
            window.computer.setAmbientVolume(prevVol);
            window.computer.setAmbientMuted(prevMuted);
            window.computer.setClickMuted(prevClickMuted);
          }
        }

        // Botões (valores já estão aplicados live; OK/Apply apenas persistem via setAmbient*/setClickMuted que já guardam)
        wrap.querySelectorAll(".app-settings-btn").forEach(function (btn) {
          btn.addEventListener("click", function () {
            const action = btn.dataset.action;
            if (action === "ok") {
              if (window.wm) window.wm.close("settings-sound");
            } else if (action === "apply") {
              // Já persistido live pelo setAmbientVolume/setAmbientMuted/setClickMuted
            } else if (action === "cancel") {
              revert();
              if (window.wm) window.wm.close("settings-sound");
            }
          });
        });

        return wrap;
      },
    },
    brickbreaker: {
      title: "Brick Breaker",
      icon: (window.BrickBreaker && window.BrickBreaker.icon) || ICONS.brickbreaker,
      // Janela responsiva: mantém aspect 4:3 e escala com o desktop CRT.
      // width/height são ignorados quando responsive=true (window.js calcula).
      width: 0, height: 0,
      responsive: true,
      aspect: (window.BrickBreaker && window.BrickBreaker.aspect) || (4 / 3),
      render: function () {
        if (window.BrickBreaker) return window.BrickBreaker.create();
        const d = document.createElement("div");
        d.textContent = "Brick Breaker failed to load.";
        return d;
      },
    },
  };

  // ─────────────────────────────────────────────
  //  MS-DOS command interpreter
  // ─────────────────────────────────────────────
  function runDosCommand(cmd) {
    const parts = cmd.toLowerCase().split(/\s+/);
    const c = parts[0];
    const args = parts.slice(1).join(" ");
    switch (c) {
      case "": return "";
      case "help":
        return t("Comandos disponíveis:") + "<br>" +
               t("  DIR      Listar conteúdo do diretório") + "<br>" +
               t("  CLS      Limpar ecrã") + "<br>" +
               t("  ECHO     Mostrar mensagem") + "<br>" +
               t("  VER      Mostrar versão CN-DOS") + "<br>" +
               t("  DATE     Mostrar data atual") + "<br>" +
               t("  TIME     Mostrar hora atual") + "<br>" +
               t("  HELP     Mostrar esta ajuda") + "<br>";
      case "ver":
        return t("Versão CN-DOS 3.11") + "<br>";
      case "dir":
        return t("Unidade C é CN-HDD") + "<br>" +
               t("Diretório de C:\\") + "<br><br>" +
               "CN-DOS   &lt;DIR&gt;        01-01-1995  12:00<br>" +
               "GAMES    &lt;DIR&gt;        01-01-1995  12:00<br>" +
               "SYSTEM   &lt;DIR&gt;        01-01-1995  12:00<br>" +
               "AUTOEXEC BAT         128  01-01-1995  12:00<br>" +
               "CONFIG   SYS          64  01-01-1995  12:00<br>" +
               "        5 file(s)    192 bytes<br>" +
               "   4,194,304 bytes free<br>";
      case "cls":
        // Limpa (retorna marcador especial)
        setTimeout(function () {
          const out = document.querySelector("#dos-output");
          if (out) out.innerHTML = "C:\\&gt; ";
        }, 0);
        return "";
      case "echo":
        return escapeHtml(args) + "<br>";
      case "date":
        return "Current date is " + new Date().toLocaleDateString("en-US") + "<br>";
      case "time":
        return "Current time is " + new Date().toLocaleTimeString("en-US") + "<br>";
      case "gajas":
        // Easter egg — abre o link externo numa nova aba do browser do utilizador.
        try { window.open("https://chaturbate.com/female-cams/", "_blank", "noopener,noreferrer"); } catch (_) {}
        return "Opening browser...<br>";
      default:
        return t("Comando inválido ou ficheiro não existe") + "<br>";
    }
  }

  // ─────────────────────────────────────────────
  //  Abrir app por id
  //  Passa wrap._onClose (se definido pela app) ao window manager para
  //  cleanup quando a janela fecha (ex.: parar audio do media player).
  // ─────────────────────────────────────────────
  function openApp(appId) {
    const app = APPS[appId];
    if (!app) return;
    const content = app.render();
    if (window.wm) {
      window.wm.open({
        id: appId,
        // O title de cada app é guardado como PT key; é traduzido no
        // momento de abertura (não no carregamento do script) para que
        // respeite o idioma ativo quando o utilizador abre a janela.
        title: t(app.title),
        icon: app.icon,
        width: app.width,
        height: app.height,
        // Apps responsivas (ex.: Brick Breaker) dimensionam-se pelo desktop
        responsive: !!app.responsive,
        aspect: app.aspect,
        content: content,
        onClose: (content && typeof content._onClose === "function") ? content._onClose : undefined,
        // Hooks de minimize/restore (ex.: Brick Breaker pausa ao minimizar)
        onMinimize: (content && typeof content._onMinimize === "function") ? content._onMinimize : undefined,
        onRestore: (content && typeof content._onRestore === "function") ? content._onRestore : undefined,
      });
    }
  }

  // ─────────────────────────────────────────────
  //  START MENU — data-driven, escalável
  //  Estrutura de items. Cada item:
  //    { label, icon, action: fn | appId, submenu: [items], separator: true }
  //  Submenu recursivo suportado.
  //  Para adicionar opções no futuro, basta editar este array.
  // ─────────────────────────────────────────────
  const START_MENU = {
    label: "CASA•NORTE",
    items: [
      {
        label: "Programas",
        icon: ICONS.programs,
        submenu: [
          { label: "Linha de comandos CN-DOS", icon: ICONS.dos, action: function () { openApp("dos"); } },
          { label: "Reprodutor CN Media", icon: ICONS.media, action: function () { openApp("media"); } },
          { label: "Brick Breaker", icon: ICONS.brickbreaker, action: function () { openApp("brickbreaker"); } },
          { label: "CN Browser", icon: ICONS.browser, action: function () { openApp("browser"); } },
          { label: "Bloco de Notas", icon: ICONS.notepad, action: function () { openApp("notepad"); } },
          { label: "O Meu Computador", icon: ICONS.mycomputer, action: function () { openApp("mycomputer"); } },
        ],
      },
      {
        label: "Definições",
        icon: ICONS.settings,
        submenu: [
          { label: "Propriedades de Visualização", icon: ICONS.display, action: function () { openApp("settings-display"); } },
          { label: "Propriedades de Som", icon: ICONS.sound, action: function () { openApp("settings-sound"); } },
        ],
      },
      {
        label: "Executar...",
        icon: ICONS.run,
        action: function () { openApp("dos"); },
      },
      { separator: true },
      {
        label: "Sobre CASA•NORTE",
        icon: ICONS.about,
        action: function () { openApp("about"); },
      },
      { separator: true },
      {
        label: "Desligar...",
        icon: ICONS.shutdown,
        action: function () {
          if (window.computer) window.computer.close();
        },
      },
    ],
  };

  // ─────────────────────────────────────────────
  //  START MENU — render + interação
  // ─────────────────────────────────────────────
  let startMenuEl = null;
  let startBtn = null;

  function buildMenu(items, parentLabel) {
    const ul = document.createElement("div");
    ul.className = "start-menu-submenu";
    items.forEach(function (item) {
      if (item.separator) {
        const sep = document.createElement("div");
        sep.className = "start-menu-separator";
        ul.appendChild(sep);
        return;
      }
      const li = document.createElement("div");
      li.className = "start-menu-item";
      if (item.submenu) li.classList.add("has-submenu");
      li.innerHTML =
        '<div class="start-menu-item-icon">' + (item.icon || "") + '</div>' +
        '<div class="start-menu-item-label">' + escapeHtml(t(item.label)) + '</div>' +
        (item.submenu ? '<div class="start-menu-arrow">▶</div>' : '');
      if (item.submenu) {
        const sub = buildMenu(item.submenu, item.label);
        sub.classList.add("start-menu-submenu-nested");
        li.appendChild(sub);
      } else if (item.action) {
        li.addEventListener("click", function (e) {
          e.stopPropagation();
          try { item.action(); } catch (err) {}
          closeStartMenu();
        });
      }
      ul.appendChild(li);
    });
    return ul;
  }

  function openStartMenu() {
    if (startMenuEl) { closeStartMenu(); return; }
    startBtn = document.querySelector(".taskbar-start-btn");
    if (!startBtn) return;
    startBtn.classList.add("active");

    startMenuEl = document.createElement("div");
    startMenuEl.className = "start-menu";

    // Sidebar com "CASA•NORTE" vertical
    const sidebar = document.createElement("div");
    sidebar.className = "start-menu-sidebar";
    sidebar.innerHTML = '<span class="start-menu-sidebar-text">CASA<span class="start-menu-sidebar-dot">·</span>NORTE</span>';
    startMenuEl.appendChild(sidebar);

    // Items
    const itemsWrap = document.createElement("div");
    itemsWrap.className = "start-menu-items";
    const menuList = buildMenu(START_MENU.items, START_MENU.label);
    menuList.classList.remove("start-menu-submenu");
    menuList.classList.add("start-menu-list");
    itemsWrap.appendChild(menuList);
    startMenuEl.appendChild(itemsWrap);

    const desktopEl = document.getElementById("crt-desktop");
    if (!desktopEl) return;
    desktopEl.appendChild(startMenuEl);

    // Fecha ao clicar fora
    setTimeout(function () {
      document.addEventListener("mousedown", outsideClickHandler);
    }, 0);
  }

  function closeStartMenu() {
    if (startMenuEl) {
      startMenuEl.remove();
      startMenuEl = null;
    }
    if (startBtn) startBtn.classList.remove("active");
    document.removeEventListener("mousedown", outsideClickHandler);
  }

  function toggleStartMenu() {
    if (startMenuEl) closeStartMenu();
    else openStartMenu();
  }

  function outsideClickHandler(e) {
    if (!startMenuEl) return;
    if (startMenuEl.contains(e.target)) return;
    if (startBtn && startBtn.contains(e.target)) return;
    closeStartMenu();
  }

  // ─────────────────────────────────────────────
  //  Ligar ícones do desktop (double-click abre app)
  // ─────────────────────────────────────────────
  function bindDesktopIcons() {
    document.querySelectorAll(".desktop-icon[data-app]").forEach(function (icon) {
      icon.addEventListener("dblclick", function (e) {
        e.stopPropagation();
        const appId = icon.dataset.app;
        openApp(appId);
      });
      // Single click também abre (mobile-friendly + mais simples)
      let clickTimer = null;
      icon.addEventListener("click", function (e) {
        e.stopPropagation();
        if (clickTimer) {
          clearTimeout(clickTimer);
          clickTimer = null;
          return; // dblclick handler trata
        }
        clickTimer = setTimeout(function () {
          clickTimer = null;
          // single click apenas seleciona (já tratado no computer.js)
        }, 200);
      });
    });
  }

  document.addEventListener("DOMContentLoaded", bindDesktopIcons);
  // Também liga imediatamente caso o DOM já esteja pronto
  if (document.readyState !== "loading") bindDesktopIcons();

  // ─────────────────────────────────────────────
  //  Ligar Start button
  // ─────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", function () {
    const sb = document.querySelector(".taskbar-start-btn");
    if (sb) {
      sb.addEventListener("click", function (e) {
        e.stopPropagation();
        toggleStartMenu();
      });
    }
  });

  // ─────────────────────────────────────────────
  //  Helpers
  // ─────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ─────────────────────────────────────────────
  //  API pública
  // ─────────────────────────────────────────────
  window.apps = { open: openApp, APPS: APPS };
  window.startmenu = { toggle: toggleStartMenu, open: openStartMenu, close: closeStartMenu };
  // Pré-carregamento das imagens do lixo — chamado pelo computer.js
  // quando o CRT abre, para que as fotos apareçam instantaneamente.
  window.trashPreload = preloadTrashImages;
  window.browserPreload = preloadBrowserImages;

  // ─────────────────────────────────────────────
  //  DESKTOP BACKGROUNDS — Canvas 2D API
  //  Desenha cada padrão proceduralmente num canvas offscreen,
  //  converte para data URL e aplica como background-image.
  //  Isto dá controlo total ao nível do pixel: formas reais,
  //  texturas, profundidade, ruído, etc.
  //  API: window.renderDesktopBg(patternName) → dataURL
  // ─────────────────────────────────────────────
  function renderDesktopBg(name) {
    const W = 512, H = 384; // 4:3 ratio, good balance of quality/performance
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const c = cv.getContext("2d");

    if (name === "Teal (Default)" || !name) {
      c.fillStyle = "#008080";
      c.fillRect(0, 0, W, H);
      return cv.toDataURL();
    }

    if (name === "Clouds") {
      // Céu gradient
      const sky = c.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, "#3a7bd5");
      sky.addColorStop(0.4, "#5b9be8");
      sky.addColorStop(0.7, "#8ec5ef");
      sky.addColorStop(1, "#b8d8f0");
      c.fillStyle = sky;
      c.fillRect(0, 0, W, H);

      // Nuvens: cada nuvem é um cluster de círculos sobrepostos com gradient
      function drawCloud(cx, cy, scale) {
        const puffs = [
          { dx: 0, dy: 0, r: 30 },
          { dx: 25, dy: -8, r: 25 },
          { dx: -25, dy: -5, r: 22 },
          { dx: 45, dy: 5, r: 20 },
          { dx: -45, dy: 8, r: 18 },
          { dx: 15, dy: -18, r: 20 },
          { dx: -15, dy: -15, r: 18 },
          { dx: 35, dy: -15, r: 16 },
        ];
        puffs.forEach(function (p) {
          const x = cx + p.dx * scale, y = cy + p.dy * scale, r = p.r * scale;
          const g = c.createRadialGradient(x, y - r * 0.3, 0, x, y, r);
          g.addColorStop(0, "rgba(255,255,255,0.95)");
          g.addColorStop(0.6, "rgba(255,255,255,0.6)");
          g.addColorStop(1, "rgba(255,255,255,0)");
          c.fillStyle = g;
          c.beginPath();
          c.arc(x, y, r, 0, Math.PI * 2);
          c.fill();
        });
        // Sombra na base
        c.save();
        c.globalCompositeOperation = "multiply";
        puffs.forEach(function (p) {
          const r = p.r * scale;
          const x = cx + p.dx * scale;
          const y = cy + p.dy * scale + r * 0.3;
          const g = c.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, "rgba(180,200,220,0.3)");
          g.addColorStop(1, "rgba(180,200,220,0)");
          c.fillStyle = g;
          c.beginPath();
          c.arc(x, y, r, 0, Math.PI * 2);
          c.fill();
        });
        c.restore();
      }

      drawCloud(80, 80, 1.2);
      drawCloud(280, 60, 1.5);
      drawCloud(420, 120, 1.0);
      drawCloud(150, 200, 1.3);
      drawCloud(380, 250, 1.1);
      drawCloud(60, 300, 0.9);
      drawCloud(250, 320, 1.0);
      drawCloud(450, 180, 0.8);

      // Sol difuso
      const sun = c.createRadialGradient(400, 50, 0, 400, 50, 80);
      sun.addColorStop(0, "rgba(255,250,200,0.4)");
      sun.addColorStop(1, "rgba(255,250,200,0)");
      c.fillStyle = sun;
      c.fillRect(0, 0, W, H);

      return cv.toDataURL();
    }

    if (name === "Aurora") {
      // AURORA BOREALIS — céu noturno com auroras verde/roxo/cyan sobre
      // montanhas silhueta e lago reflexivo. Canvas 2D pixel-a-pixel.

      // Céu noturno
      const sky = c.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, "#020210");
      sky.addColorStop(0.4, "#041020");
      sky.addColorStop(0.7, "#061830");
      sky.addColorStop(1, "#020812");
      c.fillStyle = sky;
      c.fillRect(0, 0, W, H);

      // Estrelas (50 subtis)
      for (let i = 0; i < 80; i++) {
        const sx = Math.random() * W;
        const sy = Math.random() * H * 0.55;
        const sr = Math.random() * 1.2 + 0.3;
        c.fillStyle = "rgba(255,255,255," + (0.3 + Math.random() * 0.5) + ")";
        c.beginPath();
        c.arc(sx, sy, sr, 0, Math.PI * 2);
        c.fill();
      }

      // Auroras: 4 faixas que ondulam, cada com cor diferente
      const auroraBands = [
        { hue: 140, baseY: 60, amp: 40, alpha: 0.18, freq: 0.012, phase: 0 },
        { hue: 180, baseY: 90, amp: 50, alpha: 0.15, freq: 0.009, phase: 1.5 },
        { hue: 280, baseY: 50, amp: 35, alpha: 0.12, freq: 0.015, phase: 3 },
        { hue: 160, baseY: 120, amp: 45, alpha: 0.10, freq: 0.008, phase: 4.5 },
      ];
      auroraBands.forEach(function (band) {
        c.save();
        c.globalCompositeOperation = "screen";
        // Desenha a faixa com gradiente vertical (topo transparente → meio brilhante → base transparente)
        for (let x = 0; x <= W; x += 2) {
          const wave = Math.sin(x * band.freq + band.phase) * band.amp;
          const wave2 = Math.sin(x * band.freq * 2.3 + band.phase) * band.amp * 0.3;
          const yTop = band.baseY + wave + wave2 - 60;
          const yMid = band.baseY + wave + wave2;
          const yBot = band.baseY + wave + wave2 + 60;
          // Coluna vertical com gradiente
          const g = c.createLinearGradient(x, yTop, x, yBot);
          g.addColorStop(0, "hsla(" + band.hue + ",90%,55%,0)");
          g.addColorStop(0.4, "hsla(" + band.hue + ",90%,60%," + band.alpha + ")");
          g.addColorStop(0.6, "hsla(" + band.hue + ",90%,60%," + band.alpha + ")");
          g.addColorStop(1, "hsla(" + band.hue + ",90%,55%,0)");
          c.fillStyle = g;
          c.fillRect(x, yTop, 2, yBot - yTop);
        }
        c.restore();
      });

      // Montanhas silhueta (3 camadas: fundo, meio, frente)
      function drawMountainRange(baseY, peaks, color) {
        c.fillStyle = color;
        c.beginPath();
        c.moveTo(0, H);
        c.lineTo(0, baseY);
        for (let i = 0; i < peaks.length; i++) {
          c.lineTo(peaks[i].x, peaks[i].y);
        }
        c.lineTo(W, baseY);
        c.lineTo(W, H);
        c.closePath();
        c.fill();
      }

      // Montanha de fundo (mais clara)
      drawMountainRange(H * 0.55, [
        { x: 0, y: H * 0.55 }, { x: 60, y: H * 0.42 }, { x: 120, y: H * 0.50 },
        { x: 180, y: H * 0.38 }, { x: 250, y: H * 0.48 }, { x: 320, y: H * 0.35 },
        { x: 390, y: H * 0.45 }, { x: 460, y: H * 0.40 }, { x: W, y: H * 0.50 },
      ], "#0a1525");

      // Montanha do meio
      drawMountainRange(H * 0.68, [
        { x: 0, y: H * 0.68 }, { x: 50, y: H * 0.55 }, { x: 110, y: H * 0.62 },
        { x: 170, y: H * 0.50 }, { x: 230, y: H * 0.60 }, { x: 300, y: H * 0.48 },
        { x: 370, y: H * 0.58 }, { x: 440, y: H * 0.52 }, { x: W, y: H * 0.62 },
      ], "#050d18");

      // Montanha da frente (mais escura)
      drawMountainRange(H * 0.78, [
        { x: 0, y: H * 0.78 }, { x: 40, y: H * 0.68 }, { x: 90, y: H * 0.75 },
        { x: 150, y: H * 0.65 }, { x: 210, y: H * 0.72 }, { x: 280, y: H * 0.62 },
        { x: 350, y: H * 0.70 }, { x: 420, y: H * 0.66 }, { x: W, y: H * 0.74 },
      ], "#020610");

      // Lago reflexivo (base do ecrã)
      const lake = c.createLinearGradient(0, H * 0.78, 0, H);
      lake.addColorStop(0, "#020610");
      lake.addColorStop(0.5, "#031018");
      lake.addColorStop(1, "#010408");
      c.fillStyle = lake;
      c.fillRect(0, H * 0.78, W, H * 0.22);

      // Reflexo da aurora no lago (subtil)
      c.save();
      c.globalCompositeOperation = "screen";
      for (let x = 0; x <= W; x += 4) {
        const wave = Math.sin(x * 0.012) * 40;
        const g = c.createLinearGradient(x, H * 0.78, x, H);
        g.addColorStop(0, "rgba(0,255,100,0.04)");
        g.addColorStop(0.5, "rgba(0,180,120,0.02)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        c.fillStyle = g;
        c.fillRect(x, H * 0.78, 4, H * 0.22);
      }
      c.restore();

      return cv.toDataURL();
    }

    if (name === "Stars") {
      // Espaço profundo
      const space = c.createLinearGradient(0, 0, 0, H);
      space.addColorStop(0, "#000208");
      space.addColorStop(0.5, "#000a18");
      space.addColorStop(1, "#000510");
      c.fillStyle = space;
      c.fillRect(0, 0, W, H);

      // Nebulosa (roxo/azul)
      const neb1 = c.createRadialGradient(W * 0.3, H * 0.35, 0, W * 0.3, H * 0.35, 180);
      neb1.addColorStop(0, "rgba(80,30,120,0.25)");
      neb1.addColorStop(0.5, "rgba(40,20,80,0.15)");
      neb1.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = neb1;
      c.fillRect(0, 0, W, H);

      const neb2 = c.createRadialGradient(W * 0.75, H * 0.6, 0, W * 0.75, H * 0.6, 150);
      neb2.addColorStop(0, "rgba(20,60,120,0.2)");
      neb2.addColorStop(0.5, "rgba(10,30,60,0.1)");
      neb2.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = neb2;
      c.fillRect(0, 0, W, H);

      // Estrelas: 300+ com tamanhos e brilhos variados
      for (let i = 0; i < 350; i++) {
        const x = Math.random() * W;
        const y = Math.random() * H;
        const size = Math.random();
        let r, alpha, color;

        if (size > 0.97) {
          // Estrelas brilhantes com diffraction spikes
          r = 2 + Math.random();
          alpha = 0.9 + Math.random() * 0.1;
          color = Math.random() > 0.5 ? "255,255,255" : "200,220,255";

          // Glow
          const g = c.createRadialGradient(x, y, 0, x, y, r * 4);
          g.addColorStop(0, "rgba(" + color + "," + (alpha * 0.5) + ")");
          g.addColorStop(1, "rgba(" + color + ",0)");
          c.fillStyle = g;
          c.beginPath();
          c.arc(x, y, r * 4, 0, Math.PI * 2);
          c.fill();

          // Spike horizontal
          c.strokeStyle = "rgba(" + color + "," + (alpha * 0.4) + ")";
          c.lineWidth = 0.5;
          c.beginPath();
          c.moveTo(x - r * 5, y);
          c.lineTo(x + r * 5, y);
          c.stroke();
          // Spike vertical
          c.beginPath();
          c.moveTo(x, y - r * 5);
          c.lineTo(x, y + r * 5);
          c.stroke();
        } else if (size > 0.7) {
          r = 1.2 + Math.random() * 0.8;
          alpha = 0.6 + Math.random() * 0.3;
          color = Math.random() > 0.5 ? "255,255,255" : (Math.random() > 0.5 ? "200,220,255" : "255,250,200");
        } else {
          r = 0.5 + Math.random() * 0.7;
          alpha = 0.3 + Math.random() * 0.4;
          color = "255,255,255";
        }

        c.fillStyle = "rgba(" + color + "," + alpha + ")";
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.fill();
      }

      // Galáxia espiral (subtil)
      c.save();
      c.translate(W * 0.5, H * 0.5);
      c.rotate(0.3);
      for (let arm = 0; arm < 2; arm++) {
        for (let i = 0; i < 80; i++) {
          const t = i / 80;
          const ang = t * Math.PI * 2 + arm * Math.PI;
          const r = t * 120;
          const x = Math.cos(ang) * r;
          const y = Math.sin(ang) * r * 0.4;
          c.fillStyle = "rgba(200,180,255," + (0.04 * (1 - t)) + ")";
          c.beginPath();
          c.arc(x, y, 2, 0, Math.PI * 2);
          c.fill();
        }
      }
      c.restore();

      return cv.toDataURL();
    }

    if (name === "Meadow") {
      // MEADOW — campo de relva simples com flores coloridas.
      // Simples e limpo: céu azul claro, relva verde, flores espalhadas.

      // Céu
      const sky = c.createLinearGradient(0, 0, 0, H * 0.55);
      sky.addColorStop(0, "#5ba8e0");
      sky.addColorStop(1, "#a0d0f0");
      c.fillStyle = sky;
      c.fillRect(0, 0, W, H * 0.55);

      // Relva
      const grass = c.createLinearGradient(0, H * 0.55, 0, H);
      grass.addColorStop(0, "#5aa030");
      grass.addColorStop(0.5, "#4a9020");
      grass.addColorStop(1, "#387018");
      c.fillStyle = grass;
      c.fillRect(0, H * 0.55, W, H * 0.45);

      // Linha do horizonte suave
      const horizon = c.createLinearGradient(0, H * 0.52, 0, H * 0.58);
      horizon.addColorStop(0, "rgba(255,255,255,0)");
      horizon.addColorStop(0.5, "rgba(255,255,255,0.15)");
      horizon.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = horizon;
      c.fillRect(0, H * 0.52, W, H * 0.06);

      // Flores: simples, 5 pétalas + centro amarelo
      const flowerColors = [
        ["#ff6080", "#ffe040"], // rosa + amarelo
        ["#8050ff", "#ffe040"], // roxo + amarelo
        ["#ff8030", "#ffe040"], // laranja + amarelo
        ["#40b0ff", "#ffe040"], // azul + amarelo
        ["#ff4040", "#ffe040"], // vermelho + amarelo
        ["#ffffff", "#ffe040"], // branco + amarelo
      ];

      for (let i = 0; i < 40; i++) {
        const fx = Math.random() * W;
        const fy = H * 0.58 + Math.random() * H * 0.38;
        const fr = 3 + Math.random() * 3;
        const col = flowerColors[Math.floor(Math.random() * flowerColors.length)];

        // Caule (linha verde fina)
        c.strokeStyle = "#2a6010";
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(fx, fy + fr);
        c.lineTo(fx + (Math.random() - 0.5) * 4, fy + fr + 8 + Math.random() * 6);
        c.stroke();

        // 5 pétalas
        c.fillStyle = col[0];
        for (let p = 0; p < 5; p++) {
          const ang = (p / 5) * Math.PI * 2;
          const px = fx + Math.cos(ang) * fr;
          const py = fy + Math.sin(ang) * fr;
          c.beginPath();
          c.arc(px, py, fr * 0.7, 0, Math.PI * 2);
          c.fill();
        }

        // Centro amarelo
        c.fillStyle = col[1];
        c.beginPath();
        c.arc(fx, fy, fr * 0.5, 0, Math.PI * 2);
        c.fill();
      }

      // Tufos de relva (pequenos traços verdes escuros)
      c.strokeStyle = "rgba(30,80,10,0.4)";
      c.lineWidth = 1;
      for (let i = 0; i < 60; i++) {
        const gx = Math.random() * W;
        const gy = H * 0.57 + Math.random() * H * 0.4;
        const gh = 3 + Math.random() * 5;
        c.beginPath();
        c.moveTo(gx, gy);
        c.lineTo(gx + (Math.random() - 0.5) * 3, gy - gh);
        c.stroke();
      }

      // Sol simples no céu
      c.fillStyle = "rgba(255,250,200,0.5)";
      c.beginPath();
      c.arc(W * 0.8, H * 0.15, 20, 0, Math.PI * 2);
      c.fill();

      return cv.toDataURL();
    }

    if (name === "Matrix") {
      // Fundo preto
      c.fillStyle = "#000300";
      c.fillRect(0, 0, W, H);

      // Caracteres katakana
      const katakana = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝ0123456789";
      const fontSize = 14;
      c.font = "bold " + fontSize + "px monospace";
      c.textAlign = "center";
      c.textBaseline = "middle";

      const colW = fontSize;
      const cols = Math.floor(W / colW);

      for (let col = 0; col < cols; col++) {
        const x = col * colW + colW / 2;
        // Cada coluna tem um comprimento aleatório
        const colLen = 5 + Math.floor(Math.random() * 25);
        const colStart = Math.random() * H - colLen * fontSize;

        for (let i = 0; i < colLen; i++) {
          const y = colStart + i * fontSize;
          if (y < -fontSize || y > H + fontSize) continue;

          const char = katakana[Math.floor(Math.random() * katakana.length)];
          const isLead = i === colLen - 1; // último caractere = brilhante

          if (isLead) {
            // Caractere líder: branco com glow verde
            c.shadowColor = "#00ff41";
            c.shadowBlur = 8;
            c.fillStyle = "#e0ffe0";
          } else {
            c.shadowBlur = 0;
            // Fade de verde brilhante para verde escuro
            const fade = i / colLen;
            const green = Math.floor(255 * (1 - fade * 0.7));
            c.fillStyle = "rgb(0," + green + ",65)";
          }

          c.fillText(char, x, y);
        }
      }
      c.shadowBlur = 0;

      // Glow geral subtil
      const glow = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.7);
      glow.addColorStop(0, "rgba(0,255,65,0.02)");
      glow.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = glow;
      c.fillRect(0, 0, W, H);

      return cv.toDataURL();
    }

    // Fallback
    c.fillStyle = "#008080";
    c.fillRect(0, 0, W, H);
    return cv.toDataURL();
  }
  window.renderDesktopBg = renderDesktopBg;

  // ─────────────────────────────────────────────
  //  BROWSER BOOKMARKS DEFAULTS + pré-carregamento
  //  Definidos no top-level para poderem ser pré-carregados quando
  //  o computador abre (não só quando o browser abre).
  // ─────────────────────────────────────────────
  const DEFAULT_BROWSER_BOOKMARKS = [
    { name: "Rafael caravela",
      url: "https://www.youtube.com/@RafaelDeCaravela/videos",
      img: "https://github.com/Missiion/Jogos-com-eles/blob/main/youtube.jpg?raw=true" },
    { name: "Caravela HUB",
      url: "https://missiion.github.io/Caravela/",
      img: "https://github.com/Missiion/Jogos-com-eles/blob/main/paginadoleo.png?raw=true" },
    { name: "Chaturbate",
      url: "https://chaturbate.com/female-cams/",
      img: "https://github.com/Missiion/Jogos-com-eles/blob/main/Chatturbate.jpg?raw=true" },
  ];
  // Pré-carrega as imagens dos bookmarks do browser em cache do browser.
  let browserPreloaded = false;
  function preloadBrowserImages() {
    if (browserPreloaded) return;
    browserPreloaded = true;
    // Lê os bookmarks do localStorage (inclui os do utilizador)
    let bms = DEFAULT_BROWSER_BOOKMARKS.slice();
    try {
      const raw = localStorage.getItem("jce_browser_bookmarks");
      if (raw) bms = JSON.parse(raw);
    } catch (_) {}
    bms.forEach(function (bm) {
      if (!bm.img) return; // sem imagem = usa logo/letra
      const img = new Image();
      img.src = bm.img;
    });
  }
})();
