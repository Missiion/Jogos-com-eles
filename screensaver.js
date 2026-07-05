// ═══════════════════════════════════════════════════════════════
//  screensaver.js — Screensavers Win95-style
//  Jogos com Eles · CRT Computer
//
//  Ativa uma animação de screensaver após X segundos de inatividade
//  dentro do desktop do CRT.
//
//  Screensavers disponíveis:
//    • starfield  — estrelas a voar em perspectiva (3D starfield clássico)
//    • windows    — logos Win95 a voar em grid (Flying Windows)
//    • blank      — ecrã preto
//
//  Configuração (Display Properties → Screen Saver):
//    • Tempo de inatividade (1-30 min)
//    • Selector de screensaver
//    • Persistência em localStorage
//
//  API: window.screensaver.start(type), window.screensaver.stop(),
//        window.screensaver.setWaitMinutes(m), window.screensaver.setType(t)
// ═══════════════════════════════════════════════════════════════

(function () {
  "use strict";

  // ─────────────────────────────────────────────
  //  CONFIG + ESTADO
  // ─────────────────────────────────────────────
  const WAIT_KEY = "jce_screensaver_wait";
  const TYPE_KEY = "jce_screensaver_type";

  let waitMinutes = 5;     // default: 5 min
  let saverType = "starfield"; // default: starfield
  try { waitMinutes = parseInt(localStorage.getItem(WAIT_KEY), 10) || 5; } catch (_) {}
  try { saverType = localStorage.getItem(TYPE_KEY) || "starfield"; } catch (_) {}

  let overlay = null;       // div que cobre o desktop
  let raf = null;           // requestAnimationFrame id
  let lastActivity = Date.now();
  let isActive = false;
  let activityHandler = null;
  let gracePeriodUntil = 0; // timestamp até onde resetTimer ignora atividade

  // ─────────────────────────────────────────────
  //  DETEÇÃO DE INATIVIDADE
  // ─────────────────────────────────────────────
  function resetTimer() {
    lastActivity = Date.now();
    // Grace period: ignora atividade nos primeiros 500ms após start()
    // (previne que o clique do botão Preview pare o screensaver)
    if (isActive && Date.now() < gracePeriodUntil) return;
    if (isActive) stop();
  }

  function checkInactivity() {
    if (isActive) return;
    // Só ativa se o computador estiver aberto
    if (!window.computer) return;
    const overlay = document.getElementById("computer-overlay");
    if (!overlay || !overlay.classList.contains("open")) return;
    // Só ativa se o desktop estiver visível (não durante boot)
    const content = document.getElementById("crt-content");
    if (!content || !content.classList.contains("on")) return;

    const elapsed = Date.now() - lastActivity;
    if (elapsed >= waitMinutes * 60 * 1000) {
      start(saverType);
    }
  }

  function bindActivityTracking() {
    if (activityHandler) return;
    activityHandler = true;
    // Eventos que resetam o timer
    ["mousemove", "mousedown", "keydown", "click"].forEach(function (evt) {
      document.addEventListener(evt, resetTimer, { passive: true });
    });
    // Check a cada 2s
    setInterval(checkInactivity, 2000);
  }

  // ─────────────────────────────────────────────
  //  INICIAR / PARAR
  // ─────────────────────────────────────────────
  function start(type) {
    if (isActive) return;
    isActive = true;
    type = type || saverType;
    const desktop = document.getElementById("crt-desktop");
    if (!desktop) { isActive = false; return; }

    // Grace period de 500ms: o resetTimer ignora atividade neste período.
    // Isto previne que o mousedown/click do botão Preview (que disparou
    // o start) pare imediatamente o screensaver.
    gracePeriodUntil = Date.now() + 500;

    // Cria overlay que cobre o desktop
    overlay = document.createElement("div");
    overlay.className = "screensaver-overlay";
    overlay.style.position = "absolute";
    overlay.style.inset = "0";
    overlay.style.zIndex = "9000";
    overlay.style.background = "#000";
    overlay.style.overflow = "hidden";
    overlay.style.cursor = "none";

    if (type === "blank") {
      // Blank: apenas ecrã preto
    } else if (type === "windows") {
      startWindows(overlay);
    } else {
      startStarfield(overlay);
    }

    desktop.appendChild(overlay);

    // Click ou tecla para sair
    overlay.addEventListener("mousedown", stop);
    document.addEventListener("keydown", stop);
  }

  function stop() {
    if (!isActive) return;
    isActive = false;
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    document.removeEventListener("keydown", stop);
    // Restaura resetTimer original (caso tenha sido substituído pelo grace period)
    lastActivity = Date.now();
  }

  // ─────────────────────────────────────────────
  //  SCREENSAVER 1: STARFIELD (pontos que aparecem/desaparecem)
  //  Estrelas como pontos no ecrã que emergem e desaparecem — simples e sereno.
  //  Cada estrela tem posição fixa + ciclo de vida (fade-in, brilho, fade-out).
  // ─────────────────────────────────────────────
  function startStarfield(container) {
    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    container.appendChild(canvas);
    const ctx = canvas.getContext("2d");

    function resize() {
      const r = container.getBoundingClientRect();
      canvas.width = r.width;
      canvas.height = r.height;
    }
    resize();

    const NUM_STARS = 120;
    const STARS = [];

    function spawnStar() {
      return {
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        size: 1 + Math.random() * 2,        // 1-3px
        life: 0,                             // 0 = nasceu, 1 = no pico, >1 = a desaparecer
        maxLife: 2 + Math.random() * 4,      // duração total em segundos
        fadeIn: 0.3 + Math.random() * 0.4,   // tempo de fade-in
        peakBright: 0.5 + Math.random() * 0.5, // brilho máximo
      };
    }

    // Inicializa todas as estrelas em estados aleatórios do ciclo de vida
    for (let i = 0; i < NUM_STARS; i++) {
      const s = spawnStar();
      s.life = Math.random() * s.maxLife;
      STARS.push(s);
    }

    let lastTime = performance.now();

    function draw(now) {
      if (!isActive) return;
      const dt = (now - lastTime) / 1000; // segundos
      lastTime = now;

      // Fundo preto
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      for (let i = 0; i < STARS.length; i++) {
        const s = STARS[i];
        s.life += dt;
        // Reset se chegou ao fim do ciclo
        if (s.life >= s.maxLife) {
          Object.assign(s, spawnStar());
          s.life = 0;
        }

        // Calcula brilho: fade-in → pico → fade-out
        let bright;
        if (s.life < s.fadeIn) {
          // Fade-in
          bright = (s.life / s.fadeIn) * s.peakBright;
        } else if (s.life < s.maxLife - s.fadeIn) {
          // Pico
          bright = s.peakBright;
        } else {
          // Fade-out
          const remaining = s.maxLife - s.life;
          bright = (remaining / s.fadeIn) * s.peakBright;
        }
        bright = Math.max(0, Math.min(1, bright));

        // Desenha ponto (branco com alpha = bright)
        ctx.fillStyle = "rgba(255, 255, 255, " + bright.toFixed(3) + ")";
        ctx.fillRect(s.x, s.y, s.size, s.size);
      }
      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);

    // Resize handler
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    // Guarda referência para cleanup
    container._resizeObserver = ro;
  }

  // ─────────────────────────────────────────────
  //  SCREENSAVER 2: FLYING WINDOWS
  //  Logos Win95 a voar em grid (perspetiva) — icónico.
  // ─────────────────────────────────────────────
  function startWindows(container) {
    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    container.appendChild(canvas);
    const ctx = canvas.getContext("2d");

    function resize() {
      const r = container.getBoundingClientRect();
      canvas.width = r.width;
      canvas.height = r.height;
    }
    resize();

    const LOGOS = [];
    const NUM_LOGOS = 30;
    const GRID = 5; // colunas

    function newLogo(col) {
      return {
        col: col,
        x: (col / GRID) * canvas.width,
        y: canvas.height + Math.random() * 200,
        speed: 1 + Math.random() * 2,
        size: 20 + Math.random() * 40,
      };
    }

    function initLogos() {
      LOGOS.length = 0;
      for (let i = 0; i < NUM_LOGOS; i++) {
        const col = i % GRID;
        LOGOS.push(newLogo(col));
      }
    }
    initLogos();

    function drawLogo(logo) {
      const x = logo.x;
      const y = logo.y;
      const s = logo.size;
      // Janela Win95 stylizada: 4 quadrados coloridos
      const colors = ["#ff3030", "#30c030", "#3070ff", "#ffc030"];
      ctx.save();
      ctx.translate(x, y);
      const half = s / 2;
      ctx.fillStyle = colors[0]; ctx.fillRect(-half, -half, half, half);
      ctx.fillStyle = colors[1]; ctx.fillRect(0, -half, half, half);
      ctx.fillStyle = colors[2]; ctx.fillRect(-half, 0, half, half);
      ctx.fillStyle = colors[3]; ctx.fillRect(0, 0, half, half);
      // Haste (flag pole)
      ctx.fillStyle = "#808080";
      ctx.fillRect(-1, -half, 2, s);
      ctx.restore();
    }

    function draw() {
      if (!isActive) return;
      ctx.fillStyle = "#000080"; // fundo navy clássico
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      for (let i = 0; i < LOGOS.length; i++) {
        const l = LOGOS[i];
        l.y -= l.speed;
        if (l.y < -l.size) {
          Object.assign(l, newLogo(l.col));
          l.y = canvas.height + Math.random() * 100;
        }
        drawLogo(l);
      }
      raf = requestAnimationFrame(draw);
    }
    draw();

    const ro = new ResizeObserver(resize);
    ro.observe(container);
    container._resizeObserver = ro;
  }

  // ─────────────────────────────────────────────
  //  API pública
  // ─────────────────────────────────────────────
  function setWaitMinutes(m) {
    waitMinutes = Math.max(1, Math.min(60, parseInt(m, 10) || 5));
    try { localStorage.setItem(WAIT_KEY, String(waitMinutes)); } catch (_) {}
  }
  function setType(t) {
    if (["starfield", "windows", "blank"].indexOf(t) >= 0) {
      saverType = t;
      try { localStorage.setItem(TYPE_KEY, t); } catch (_) {}
    }
  }
  function getWaitMinutes() { return waitMinutes; }
  function getType() { return saverType; }

  // Inicia tracking quando o DOM estiver pronto
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindActivityTracking);
  } else {
    bindActivityTracking();
  }

  window.screensaver = {
    start: start,
    stop: stop,
    setWaitMinutes: setWaitMinutes,
    setType: setType,
    getWaitMinutes: getWaitMinutes,
    getType: getType,
  };
})();
