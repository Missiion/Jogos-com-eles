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
      width: 300, height: 180,
      render: function () {
        const wrap = document.createElement("div");
        wrap.className = "app-recycle";
        wrap.innerHTML =
          '<div class="app-explorer-toolbar">' + t("Ficheiro  Editar  Ver  Ajuda") + '</div>' +
          '<div class="app-recycle-empty">' + t("A Reciclagem está vazia.") + '</div>' +
          '<div class="app-recycle-status">' + t("0 objeto(s)") + '</div>';
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
        let currentVizId = "ambience";
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
          } catch (e) { /* contexto indisponível — fallback sintético */ }
        }

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
          if (audioCtx && audioCtx.state === "suspended") audioCtx.resume().catch(function () {});
          applyVolume();
          audio.play().then(function () { isPlaying = true; updatePlayBtn(); startVizLoop(); })
            .catch(function () { /* autoplay bloqueado */ });
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
        function vizFrame(ts) {
          rafId = requestAnimationFrame(vizFrame);
          const dt = Math.min(0.05, (ts - lastTs) / 1000);
          lastTs = ts;
          const w = canvas.width, h = canvas.height;
          // Tenta dados reais; se bloqueados por CORS, usa fallback sintético
          if (analyserReady && analyser && !useSyntheticFallback) {
            analyser.getByteFrequencyData(freqData);
            analyser.getByteTimeDomainData(waveData);
            // Deteta CORS taint: se a tocar mas freqData tudo zero, ativa fallback
            if (isPlaying) {
              let sum = 0;
              for (let i = 0; i < freqData.length; i++) sum += freqData[i];
              if (sum === 0) useSyntheticFallback = true;
            }
          } else if (useSyntheticFallback || !analyserReady) {
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

        // ── PADRÕES DE FUNDO (temáticos, não cores sólidas) ──
        // As keys dos padrões servem simultaneamente de ID persistido em
        // localStorage (DESKTOP_BG_KEY) e de label visível no <select>.
        // Por isso NÃO são traduzidas (traduzir quebraria prefs guardadas).
        const BG_PATTERNS = {
          "Teal (Default)": "#008080",
          "Clouds": "radial-gradient(ellipse 60px 30px at 15% 25%, #fff 0%, transparent 70%), radial-gradient(ellipse 80px 40px at 65% 55%, #fff 0%, transparent 70%), radial-gradient(ellipse 50px 25px at 85% 15%, #fff 0%, transparent 70%), radial-gradient(ellipse 70px 35px at 40% 80%, #fff 0%, transparent 70%), #008080",
          "Hexagons": "radial-gradient(circle at 50% 0%, transparent 12px, #006060 13px, #006060 14px, transparent 15px), #008080",
          "Stars": "radial-gradient(2px 2px at 20px 30px, #fff, transparent), radial-gradient(2px 2px at 60px 70px, #fff, transparent), radial-gradient(1px 1px at 90px 40px, #fff, transparent), radial-gradient(2px 2px at 130px 80px, #fff, transparent), radial-gradient(1px 1px at 170px 30px, #fff, transparent), #004040",
          "Bricks": "repeating-linear-gradient(0deg, #704020 0px, #704020 20px, #80502a 20px, #80502a 22px), repeating-linear-gradient(90deg, transparent 0px, transparent 40px, #603010 40px, #603010 42px)",
          "Matrix": "repeating-linear-gradient(0deg, transparent 0px, transparent 18px, rgba(0,255,0,0.15) 18px, rgba(0,255,0,0.15) 20px), #001000",
        };
        const DESKTOP_BG_KEY = "jce_desktop_bg";
        let savedBg = "Teal (Default)";
        try { savedBg = localStorage.getItem(DESKTOP_BG_KEY) || "Teal (Default)"; } catch (_) {}
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
          const bg = BG_PATTERNS[name] || "#008080";
          preview.style.background = bg;
          let size = "auto";
          if (name === "Stars" || name === "Matrix") size = "200px 200px";
          else if (name === "Hexagons") size = "60px 60px";
          else if (name === "Bricks") size = "42px 42px";
          preview.style.backgroundSize = size;
          const desktop = document.getElementById("crt-desktop");
          if (desktop) {
            desktop.style.background = bg;
            desktop.style.backgroundSize = size;
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
})();
