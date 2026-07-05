// ═══════════════════════════════════════════════════════════════
//  window.js — Window Manager Win95-style
//  Jogos com Eles · CRT Computer
//
//  Cria janelas Win95 programaticamente dentro do desktop do CRT.
//  • Title bar com título + botões minimize/close
//  • Arrastável pela title bar
//  • Foco/z-index management (click traz para a frente)
//  • Minimize/remove da taskbar
//  • API: window.wm.open({ title, icon, width, height, content, onClose })
//         window.wm.closeAll()
//
//  Estrutura de uma janela:
//    .crt-window
//      .crt-window-titlebar
//        .crt-window-icon (SVG)
//        .crt-window-title (text)
//        .crt-window-buttons
//          .crt-window-btn.minimize
//          .crt-window-btn.close
//      .crt-window-body (conteúdo da app)
// ═══════════════════════════════════════════════════════════════

(function () {
  "use strict";

  function t(key) {
    if (window.i18n && typeof window.i18n.t === "function") return window.i18n.t(key);
    return key;
  }

  const desktop = document.getElementById("crt-desktop");
  if (!desktop) return;

  let zCounter = 100;
  const openWindows = new Map(); // id → { el, taskbarItem, isMinimized }

  // ─────────────────────────────────────────────
  //  Cria uma janela Win95
  //  opts: { id, title, icon (svg string), width, height, content (html string or node), onClose }
  // ─────────────────────────────────────────────
  function open(opts) {
    opts = opts || {};
    const id = opts.id || ("win-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7));

    // Se já existe uma janela com este id, traz para a frente
    if (openWindows.has(id)) {
      focus(id);
      if (openWindows.get(id).isMinimized) restore(id);
      return id;
    }

    const win = document.createElement("div");
    win.className = "crt-window";
    win.dataset.winId = id;
    win.style.width = (opts.width || 320) + "px";
    win.style.height = (opts.height || 200) + "px";

    // Posição inicial (cascata simples)
    const offset = (openWindows.size % 6) * 24;
    win.style.left = (40 + offset) + "px";
    win.style.top = (20 + offset) + "px";
    win.style.zIndex = ++zCounter;

    // ── Responsive sizing (Etapa Brick Breaker) ──
    // Se opts.responsive, a janela dimensiona-se em função do desktop do
    // CRT, mantendo o aspect ratio do conteúdo. Reage a redimensionamentos
    // via ResizeObserver. Isto garante que jogos como o Brick Breaker sejam
    // justos em qualquer resolução (incl. 1440p) — o playfield lógico é
    // fixo, só a escala de apresentação muda.
    let responsiveRO = null;
    if (opts.responsive) {
      const aspect = opts.aspect || (4 / 3);
      function applyResp() {
        const dw = desktop.clientWidth, dh = desktop.clientHeight;
        const titlebar = win.querySelector(".crt-window-titlebar");
        const th = titlebar ? titlebar.offsetHeight : 20;
        const availW = Math.max(220, dw * 0.88);
        const availH = Math.max(170, (dh - 34) * 0.92); // -34 pela taskbar
        let bodyW = availW;
        let bodyH = bodyW / aspect;
        if (bodyH + th > availH) { bodyH = Math.max(130, availH - th); bodyW = bodyH * aspect; }
        win.style.width = bodyW + "px";
        win.style.height = (bodyH + th) + "px";
        win.style.left = Math.max(0, (dw - bodyW) / 2) + "px";
        win.style.top = Math.max(0, (dh - (bodyH + th)) / 2 - 6) + "px";
      }
      applyResp();
      responsiveRO = new ResizeObserver(applyResp);
      responsiveRO.observe(desktop);
    }

    win.innerHTML =
      '<div class="crt-window-titlebar">' +
        '<div class="crt-window-icon">' + (opts.icon || "") + '</div>' +
        '<div class="crt-window-title">' + escapeHtml(opts.title || t("Janela")) + '</div>' +
        '<div class="crt-window-buttons">' +
          '<button class="crt-window-btn crt-window-minimize" type="button" aria-label="' + t("Minimizar") + '"></button>' +
          '<button class="crt-window-btn crt-window-close" type="button" aria-label="' + t("Fechar") + '"></button>' +
        '</div>' +
      '</div>' +
      '<div class="crt-window-body"></div>';

    // Conteúdo
    const body = win.querySelector(".crt-window-body");
    if (typeof opts.content === "string") {
      body.innerHTML = opts.content;
    } else if (opts.content) {
      body.appendChild(opts.content);
    }

    desktop.appendChild(win);

    // Taskbar item
    const taskbarTasks = desktop.querySelector(".taskbar-tasks");
    let taskbarItem = null;
    if (taskbarTasks) {
      taskbarItem = document.createElement("div");
      taskbarItem.className = "taskbar-task active";
      taskbarItem.textContent = opts.title || t("Janela");
      taskbarTasks.appendChild(taskbarItem);
    }

    openWindows.set(id, {
      el: win,
      taskbarItem: taskbarItem,
      isMinimized: false,
      onClose: opts.onClose,
      onMinimize: opts.onMinimize,
      onRestore: opts.onRestore,
      title: opts.title || t("Janela"),
      responsiveRO: responsiveRO,
    });

    // ── Eventos ──
    // Focus on click
    win.addEventListener("mousedown", function () { focus(id); });

    // Title bar drag
    const titlebar = win.querySelector(".crt-window-titlebar");
    let dragOffset = null;
    titlebar.addEventListener("mousedown", function (e) {
      if (e.target.closest(".crt-window-buttons")) return; // não arrasta ao clicar botões
      const rect = win.getBoundingClientRect();
      const deskRect = desktop.getBoundingClientRect();
      dragOffset = {
        x: e.clientX - rect.left + deskRect.left,
        y: e.clientY - rect.top + deskRect.top,
      };
      e.preventDefault();
    });
    document.addEventListener("mousemove", function (e) {
      if (!dragOffset) return;
      const deskRect = desktop.getBoundingClientRect();
      let x = e.clientX - dragOffset.x;
      let y = e.clientY - dragOffset.y;
      // Clamp dentro do desktop
      x = Math.max(0, Math.min(x, deskRect.width - win.offsetWidth));
      y = Math.max(0, Math.min(y, deskRect.height - win.offsetHeight - 30)); // -30 pela taskbar
      win.style.left = x + "px";
      win.style.top = y + "px";
    });
    document.addEventListener("mouseup", function () { dragOffset = null; });

    // Close button
    win.querySelector(".crt-window-close").addEventListener("click", function (e) {
      e.stopPropagation();
      close(id);
    });

    // Minimize button
    win.querySelector(".crt-window-minimize").addEventListener("click", function (e) {
      e.stopPropagation();
      minimize(id);
    });

    // Taskbar item click → toggle minimize
    if (taskbarItem) {
      taskbarItem.addEventListener("click", function () {
        const w = openWindows.get(id);
        if (!w) return;
        if (w.isMinimized) restore(id);
        else minimize(id);
      });
    }

    focus(id);
    return id;
  }

  function focus(id) {
    const w = openWindows.get(id);
    if (!w) return;
    w.el.style.zIndex = ++zCounter;
    // Atualiza taskbar: apenas a janela ativa tem .active
    openWindows.forEach(function (win, winId) {
      if (win.taskbarItem) win.taskbarItem.classList.toggle("active", winId === id && !win.isMinimized);
    });
  }

  function close(id) {
    const w = openWindows.get(id);
    if (!w) return;
    if (w.responsiveRO) { try { w.responsiveRO.disconnect(); } catch (e) {} }
    if (typeof w.onClose === "function") {
      try { w.onClose(); } catch (e) {}
    }
    w.el.remove();
    if (w.taskbarItem) w.taskbarItem.remove();
    openWindows.delete(id);
  }

  function closeAll() {
    [...openWindows.keys()].forEach(close);
  }

  function minimize(id) {
    const w = openWindows.get(id);
    if (!w) return;
    w.isMinimized = true;
    w.el.style.display = "none";
    if (w.taskbarItem) w.taskbarItem.classList.remove("active");
    // Hook onMinimize (ex.: pausar o Brick Breaker ao minimizar)
    if (typeof w.onMinimize === "function") {
      try { w.onMinimize(); } catch (e) {}
    }
  }

  function restore(id) {
    const w = openWindows.get(id);
    if (!w) return;
    w.isMinimized = false;
    w.el.style.display = "";
    focus(id);
    // Hook onRestore (ex.: retomar o Brick Breaker ao restaurar — só se não estiver em pausa manual)
    if (typeof w.onRestore === "function") {
      try { w.onRestore(); } catch (e) {}
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // API pública
  window.wm = { open: open, close: close, closeAll: closeAll, focus: focus };
})();
