// ═══════════════════════════════════════════════════════════════
//  computer.js — CRT Computer Overlay
//  Jogos com Eles
//
//  Etapa 1: shell do monitor + open/close + sons ambient
//  Etapa 2: animação de boot temática 90s
//  • Botão na toolbar abre o monitor CRT ao centro do ecrã
//  • Backdrop posteriza o website visível atrás (não blur)
//  • Sons ambient via Web Audio API:
//    - Ventoinha: white noise lowpass (contínuo)
//    - Hum: 60Hz + 120Hz sine (mains hum)
//    - Hard drive seeks: noise bursts aleatórios (2-8s)
//    - Power click on/off
//  • Boot sequence (Etapa 2) — boot limpo, sem estática inicial:
//    - Terminal log estilo systemd/dmesg com tags [ OK ] (verde fósforo)
//    - Drive spin-up sound (whine ascendente) sincronizado com o fim do log
//    - Splash logo CASA•NORTE com fade-in + scale
//    - Estado "ready" com desktop + taskbar (Etapa 3)
//  • AudioContext criado lazy (política autoplay)
//  • Respeita o mute do site (jce_sound_muted)
//  • API pública: window.computer.open() / close() / toggle()
//
//  Etapas futuras:
//    3 — desktop + atalhos
// ═══════════════════════════════════════════════════════════════

(function () {
  "use strict";

  // ─────────────────────────────────────────────
  //  ELEMENTS
  // ─────────────────────────────────────────────
  const overlay = document.getElementById("computer-overlay");
  const trigger = document.getElementById("computer-trigger");
  const backdrop = document.getElementById("computer-backdrop");
  const powerLed = document.getElementById("crt-power-led");
  const content = document.getElementById("crt-content");
  const termEl = document.getElementById("crt-terminal");
  const logoEl = document.getElementById("crt-logo");
  const readyEl = document.getElementById("crt-ready");

  if (!overlay || !trigger) return;

  let isOpen = false;
  let bootTimers = [];  // timeouts da sequência de boot (para cancelar no close)

  // ─────────────────────────────────────────────
  //  AUDIO — lazy init + ambient loop
  //  Estado de volume/mute controlável via Sound Properties (apps.js)
  // ─────────────────────────────────────────────
  let audioCtx = null;
  let masterAmbient = null;   // gain node master do ambient
  let ambientNodes = null;    // { noiseSrc, humOsc1, humOsc2, driveTimeout }
  let driveSchedulerActive = false;

  // Volume do ambient (0-1) + mute — persistidos em localStorage
  const AMBIENT_VOL_KEY = "jce_ambient_volume";
  const AMBIENT_MUTE_KEY = "jce_ambient_muted";
  let ambientVolume = 0.55;   // default
  let ambientMuted = false;   // default
  try { ambientVolume = parseFloat(localStorage.getItem(AMBIENT_VOL_KEY)); if (isNaN(ambientVolume)) ambientVolume = 0.55; } catch (_) {}
  try { ambientMuted = localStorage.getItem(AMBIENT_MUTE_KEY) === "1"; } catch (_) {}

  // Mute isolado do som de "click" de fundo (power click on/off + drive seeks).
  // Permite silenciar apenas os clicks mecânicos sem mutar o ambient
  // (ventoinha + hum) — persistido em localStorage.
  const CLICK_MUTE_KEY = "jce_click_muted";
  let clickMuted = false;   // default
  try { clickMuted = localStorage.getItem(CLICK_MUTE_KEY) === "1"; } catch (_) {}

  function isMuted() {
    try { return localStorage.getItem("jce_sound_muted") === "1"; } catch (_) { return false; }
  }
  // Verifica se o som de click de fundo está mutado (mute global OU mute isolado)
  function isClickMuted() {
    return isMuted() || clickMuted;
  }

  // Aplica o volume/mute ao masterAmbient em tempo real (se estiver a tocar)
  function applyAmbientState() {
    if (!masterAmbient || !audioCtx) return;
    const t = audioCtx.currentTime;
    const target = ambientMuted ? 0 : ambientVolume;
    masterAmbient.gain.cancelScheduledValues(t);
    masterAmbient.gain.setValueAtTime(masterAmbient.gain.value, t);
    masterAmbient.gain.linearRampToValueAtTime(target, t + 0.15);
  }

  // API para Sound Properties (apps.js)
  function setAmbientVolume(v) {
    ambientVolume = Math.max(0, Math.min(1, v));
    try { localStorage.setItem(AMBIENT_VOL_KEY, String(ambientVolume)); } catch (_) {}
    applyAmbientState();
  }
  function setAmbientMuted(m) {
    ambientMuted = !!m;
    try { localStorage.setItem(AMBIENT_MUTE_KEY, ambientMuted ? "1" : "0"); } catch (_) {}
    applyAmbientState();
  }
  function getAmbientVolume() { return ambientVolume; }
  function getAmbientMuted() { return ambientMuted; }

  // API para mutar isoladamente o som de "click" de fundo (Sound Properties)
  function setClickMuted(m) {
    clickMuted = !!m;
    try { localStorage.setItem(CLICK_MUTE_KEY, clickMuted ? "1" : "0"); } catch (_) {}
  }
  function getClickMuted() { return clickMuted; }

  function ensureAudio() {
    if (audioCtx) return audioCtx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    } catch (e) { audioCtx = null; }
    return audioCtx;
  }

  function resumeAudio() {
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume().catch(function () {});
    }
  }

  // ── Power click (mechanical switch) ──
  // Respeita o mute isolado de click de fundo (isClickMuted).
  function playPowerClick() {
    if (isClickMuted()) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const t = ctx.currentTime;
    // Mechanical click: very short noise burst, highpass
    const len = Math.ceil(ctx.sampleRate * 0.02);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = "highpass"; filt.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
    src.connect(filt); filt.connect(g); g.connect(ctx.destination);
    src.start(t); src.stop(t + 0.03);
  }

  // ── Power down (descending tone + click) ──
  // Respeita o mute isolado de click de fundo (isClickMuted).
  function playPowerDown() {
    if (isClickMuted()) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.35);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(t); osc.stop(t + 0.40);
  }

  // ── Hard drive spin-up (whine ascendente) ──
  // Som de HDD a arrancar: sweep de frequência grave para agudo.
  function playDriveSpinUp() {
    if (isMuted()) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(60, t);
    osc.frequency.exponentialRampToValueAtTime(420, t + 1.2);
    const filt = ctx.createBiquadFilter();
    filt.type = "bandpass"; filt.frequency.value = 280; filt.Q.value = 2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.035, t + 0.3);
    g.gain.linearRampToValueAtTime(0.0001, t + 1.3);
    osc.connect(filt); filt.connect(g); g.connect(ctx.destination);
    osc.start(t); osc.stop(t + 1.35);
  }

  // ── Hard drive seek (random read/write click) ──
  // Respeita o mute isolado de click de fundo (isClickMuted).
  function playDriveSeek() {
    if (!audioCtx || !masterAmbient) return;
    if (isClickMuted()) return;
    const t = audioCtx.currentTime;
    // Seek: short noise burst bandpass ~2500Hz + lower thud
    const len = Math.ceil(audioCtx.sampleRate * 0.09);
    const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = audioCtx.createBufferSource(); src.buffer = buf;
    const filt = audioCtx.createBiquadFilter();
    filt.type = "bandpass"; filt.frequency.value = 2600; filt.Q.value = 3;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    src.connect(filt); filt.connect(g); g.connect(masterAmbient);
    src.start(t); src.stop(t + 0.10);
  }

  // ── Schedule random drive seeks ──
  function scheduleNextSeek() {
    if (!driveSchedulerActive) return;
    const delay = 2500 + Math.random() * 5500; // 2.5–8s
    ambientNodes.driveTimeout = setTimeout(function () {
      if (!driveSchedulerActive) return;
      playDriveSeek();
      // Sometimes a double-seek (read multiple sectors)
      if (Math.random() < 0.3) {
        setTimeout(playDriveSeek, 180 + Math.random() * 200);
      }
      scheduleNextSeek();
    }, delay);
  }

  // ── Start ambient loop (fan + hum + drive) ──
  function startAmbient() {
    if (isMuted()) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    resumeAudio();
    if (ambientNodes) return; // já está a correr

    // Master gain com fade-in (1.5s) — usa ambientVolume (controlável via Sound Properties)
    // Se estiver muted, o target é 0 (applyAmbientState trata disso após fade-in)
    masterAmbient = ctx.createGain();
    masterAmbient.gain.value = 0;
    const fadeTarget = ambientMuted ? 0 : ambientVolume;
    masterAmbient.gain.linearRampToValueAtTime(fadeTarget, ctx.currentTime + 1.5);
    masterAmbient.connect(ctx.destination);

    // 1. FAN: white noise → lowpass (180Hz) → gain (contínuo, sussurro grave)
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const noiseData = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuf;
    noiseSrc.loop = true;
    const fanFilter = ctx.createBiquadFilter();
    fanFilter.type = "lowpass";
    fanFilter.frequency.value = 180;
    fanFilter.Q.value = 0.8;
    const fanGain = ctx.createGain();
    fanGain.gain.value = 0.08;
    noiseSrc.connect(fanFilter); fanFilter.connect(fanGain); fanGain.connect(masterAmbient);
    noiseSrc.start();

    // 2. HUM: 60Hz + 120Hz sine (mains hum, como um transformador)
    const humOsc1 = ctx.createOscillator();
    humOsc1.type = "sine"; humOsc1.frequency.value = 60;
    const humOsc2 = ctx.createOscillator();
    humOsc2.type = "sine"; humOsc2.frequency.value = 120;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.022;
    humOsc1.connect(humGain); humOsc2.connect(humGain); humGain.connect(masterAmbient);
    humOsc1.start(); humOsc2.start();

    // 3. DRIVE SEEKS: scheduled random clicks
    ambientNodes = { noiseSrc, humOsc1, humOsc2, driveTimeout: null };
    driveSchedulerActive = true;
    scheduleNextSeek();
  }

  // ── Stop ambient loop (fade out + cleanup) ──
  function stopAmbient() {
    driveSchedulerActive = false;
    if (ambientNodes && ambientNodes.driveTimeout) {
      clearTimeout(ambientNodes.driveTimeout);
    }
    if (!masterAmbient || !audioCtx) {
      ambientNodes = null;
      return;
    }
    // Fade out (0.4s) depois para os nodes
    const t = audioCtx.currentTime;
    masterAmbient.gain.cancelScheduledValues(t);
    masterAmbient.gain.setValueAtTime(masterAmbient.gain.value, t);
    masterAmbient.gain.linearRampToValueAtTime(0, t + 0.4);
    const nodesToStop = ambientNodes;
    const masterToDisconnect = masterAmbient;
    setTimeout(function () {
      if (!nodesToStop) return;
      try { nodesToStop.noiseSrc.stop(); } catch (_) {}
      try { nodesToStop.humOsc1.stop(); } catch (_) {}
      try { nodesToStop.humOsc2.stop(); } catch (_) {}
      try { masterToDisconnect.disconnect(); } catch (_) {}
    }, 500);
    ambientNodes = null;
    masterAmbient = null;
  }

  // ─────────────────────────────────────────────
  //  BOOT SEQUENCE (Etapa 2)
  //  Orquestra as 3 fases (boot limpo, sem estática inicial):
  //    Terminal log → logo → ready (desktop)
  //  Cada fase tem timing coordenado com os sons (drive spin-up).
  // ─────────────────────────────────────────────

  // Linhas do terminal log (estilo systemd/dmesg, adaptado ao tema CASA•NORTE)
  // Cada linha começa com a tag [ OK ] que é destacada a verde brilhante.
  const TERMINAL_LINES = [
    "[ OK ] Starting CASA-NORTE System",
    "[ OK ] Mounting CN-HDD (C:)",
    "[ OK ] Starting CN-DOS v3.11",
    "[ OK ] Loading Display Driver (CN-1530)",
    "[ OK ] Starting Sound Daemon (SB16)",
    "[ OK ] Reached target Boot",
  ];
  // Delay entre cada linha do terminal (ms) — ritmo de leitura confortável
  const TERMINAL_LINE_INTERVAL = 300;

  function clearBootTimers() {
    bootTimers.forEach(function (id) { clearTimeout(id); });
    bootTimers = [];
  }

  function scheduleBoot(fn, delay) {
    const id = setTimeout(fn, delay);
    bootTimers.push(id);
    return id;
  }

  // Preenche o terminal linha a linha com pequeno delay entre cada.
  // Cada linha é um <div> (display: block) para garantir empilhamento vertical.
  // A tag [ OK ] é separada num <span> destacada a verde brilhante.
  // A última linha recebe um cursor a piscar no fim.
  function typeTerminalLines(startDelay) {
    if (!termEl) return;
    termEl.innerHTML = "";
    let cumDelay = startDelay;
    TERMINAL_LINES.forEach(function (line, idx) {
      const delay = cumDelay;
      const isLast = idx === TERMINAL_LINES.length - 1;
      scheduleBoot(function () {
        const lineEl = document.createElement("div");
        lineEl.className = "crt-terminal-line";
        // Separa a tag [ OK ] do resto para destacar a verde brilhante
        const match = line.match(/^(\[ OK \])\s*(.*)$/);
        if (match) {
          const okSpan = document.createElement("span");
          okSpan.className = "crt-terminal-ok";
          okSpan.textContent = match[1];
          const rest = document.createTextNode("  " + match[2]);
          lineEl.appendChild(okSpan);
          lineEl.appendChild(rest);
        } else {
          lineEl.textContent = line || "\u00A0"; // nbsp para linhas vazias
        }
        // Cursor a piscar no fim da última linha
        if (isLast) {
          const cursor = document.createElement("span");
          cursor.className = "crt-terminal-cursor";
          lineEl.appendChild(cursor);
        }
        termEl.appendChild(lineEl);
        // Auto-scroll para baixo
        termEl.scrollTop = termEl.scrollHeight;
      }, delay);
      cumDelay += TERMINAL_LINE_INTERVAL;
    });
    return cumDelay; // retorna o tempo total para a próxima fase
  }

  function startBootSequence() {
    if (!content) return;
    clearBootTimers();
    // Reset estado: remove classes de boot anteriores
    content.classList.remove("booting", "on");
    // Repõe layers (reinicia animações CSS)
    if (termEl) termEl.innerHTML = "";
    if (termEl) termEl.style.display = "";
    if (logoEl) logoEl.classList.remove("logo-active");
    // Força reflow para reiniciar animações CSS
    void content.offsetWidth;
    // Inicia boot — boot limpo, sem estática inicial.
    // O ecrã liga diretamente no terminal log com fade-in suave.
    content.classList.add("booting");

    // Fase 1: Terminal log — linhas [ OK ] surgem com fade-in + typing.
    // Sem flash prévio: o terminal aparece assim que o ecrã liga (~250ms).
    const termStartDelay = 250;
    const termEndDelay = typeTerminalLines(termStartDelay);

    // Som: drive spin-up (whine ascendente) — sincronizado com o fim do
    // terminal log, criando a ponte sonora para o splash logo.
    scheduleBoot(playDriveSpinUp, termEndDelay - 100);

    // Fase 2: Logo (após o terminal completar + breve leitura).
    // O logo aparece com fade-in + scale no momento em que o drive arranca,
    // criando uma transição natural do terminal para o splash screen.
    const logoDelay = termEndDelay + 400;
    scheduleBoot(function () {
      if (logoEl) {
        // Esconde terminal, mostra logo com fade-in
        if (termEl) termEl.style.display = "none";
        logoEl.classList.add("logo-active");
      }
    }, logoDelay);

    // Fase 3: Ready (após logo visível ~2s — fade-in + leitura).
    // Transição para o desktop com taskbar.
    const readyDelay = logoDelay + 2000;
    scheduleBoot(function () {
      if (!content) return;
      content.classList.remove("booting");
      content.classList.add("on");
    }, readyDelay);
  }

  function stopBootSequence() {
    clearBootTimers();
    if (content) {
      content.classList.remove("booting", "on", "logo-phase");
    }
    if (logoEl) {
      logoEl.classList.remove("logo-active");
      logoEl.style.animationDelay = "";
    }
    if (termEl) termEl.style.display = "";
  }
  function open() {
    if (isOpen) return;
    isOpen = true;
    overlay.classList.add("open");
    trigger.setAttribute("aria-expanded", "true");
    if (powerLed) powerLed.classList.add("on");
    // Sons: power click + ambient loop (após pequeno delay para o click)
    ensureAudio();
    resumeAudio();
    playPowerClick();
    setTimeout(startAmbient, 250);
    // Boot sequence: começa após o overlay abrir (escala do monitor)
    setTimeout(startBootSequence, 350);
    // Pré-carrega as imagens do lixo para que apareçam instantaneamente
    // quando o utilizador abrir o Recycle Bin (sem ficar em branco).
    if (window.trashPreload) { try { window.trashPreload(); } catch (_) {} }
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    overlay.classList.remove("open");
    trigger.setAttribute("aria-expanded", "false");
    if (powerLed) powerLed.classList.remove("on");
    // Para boot sequence + sons ambient + power down
    stopBootSequence();
    stopAmbient();
    playPowerDown();
  }

  function toggle() {
    if (isOpen) close(); else open();
  }

  // ─────────────────────────────────────────────
  //  EVENTS
  // ─────────────────────────────────────────────

  // Botão — abre/fecha (stopPropagation para não fechar imediatamente)
  trigger.addEventListener("click", function (e) {
    e.stopPropagation();
    toggle();
  });

  // Helper (Etapa 6): verifica se o Brick Breaker está aberto e em jogo ativo.
  // Se sim, cliques fora do computador (backdrop/toolbar) PAUSAM o jogo em vez
  // de fechar o computador — evita perder o progresso por clique acidental.
  function isBrickBreakerPlaying() {
    const w = window.wm;
    if (!w) return false;
    // Procura a janela do brickbreaker no DOM
    const win = document.querySelector('[data-win-id="brickbreaker"]');
    if (!win) return false;
    // Pergunta à app se está em ecrã de jogo (via API exposta no wrap)
    const app = win.querySelector(".app-brickbreaker");
    if (!app || !app._bbIsPlaying) return false;
    return app._bbIsPlaying();
  }

  // Pausa o Brick Breaker se estiver em jogo (chamado antes de fechar/interagir)
  function pauseBrickBreakerIfPlaying() {
    const win = document.querySelector('[data-win-id="brickbreaker"]');
    if (!win) return;
    const app = win.querySelector(".app-brickbreaker");
    if (app && typeof app._bbPause === "function") app._bbPause();
  }

  // Backdrop — click: se Brick Breaker em jogo, pausa; senão fecha (comportamento normal)
  if (backdrop) {
    backdrop.addEventListener("click", function () {
      if (isBrickBreakerPlaying()) {
        pauseBrickBreakerIfPlaying();
        return; // não fecha o computador
      }
      close();
    });
  }

  // ESC — fecha (mas se Brick Breaker em jogo, deixa o ESC chegar à app para pausar)
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && isOpen) {
      if (isBrickBreakerPlaying()) {
        // Deixa o ESC propagar para o brickbreaker pausar (não fecha o computador)
        return;
      }
      e.stopPropagation();
      close();
    }
  });

  // Click na toolbar enquanto aberto — se Brick Breaker em jogo, pausa; senão fecha
  document.addEventListener("click", function (e) {
    if (!isOpen) return;
    if (overlay.contains(e.target)) return;
    if (trigger.contains(e.target)) return;
    const toolbar = document.getElementById("toolbar");
    if (toolbar && toolbar.contains(e.target)) {
      if (isBrickBreakerPlaying()) {
        pauseBrickBreakerIfPlaying();
        return; // não fecha o computador
      }
      close();
    }
  }, true);

  // Pré-aquece o AudioContext no primeiro gesto (política autoplay)
  function primeOnce() {
    ensureAudio();
    resumeAudio();
    document.removeEventListener("pointerdown", primeOnce, true);
    document.removeEventListener("keydown", primeOnce, true);
  }
  document.addEventListener("pointerdown", primeOnce, true);
  document.addEventListener("keydown", primeOnce, true);

  // ─────────────────────────────────────────────
  //  DESKTOP (Etapa 3)
  //  Relógio da taskbar + seleção de ícones (placeholders, não funcionais)
  // ─────────────────────────────────────────────
  const clockEl = document.getElementById("taskbar-clock");
  let clockInterval = null;

  function updateClock() {
    if (!clockEl) return;
    const now = new Date();
    const h = String(now.getHours()).padStart(2, "0");
    const m = String(now.getMinutes()).padStart(2, "0");
    clockEl.textContent = h + ":" + m;
  }

  function startClock() {
    updateClock();
    if (clockInterval) clearInterval(clockInterval);
    clockInterval = setInterval(updateClock, 10000); // atualiza a cada 10s
  }

  function stopClock() {
    if (clockInterval) { clearInterval(clockInterval); clockInterval = null; }
  }

  // Seleção de ícones (click para selecionar, double-click placeholder)
  const desktopIcons = document.querySelectorAll(".desktop-icon");
  desktopIcons.forEach(function (icon) {
    icon.addEventListener("click", function (e) {
      e.stopPropagation();
      // Remove selected de todos, adiciona ao clicado
      desktopIcons.forEach(function (i) { i.classList.remove("selected"); });
      icon.classList.add("selected");
    });
  });

  // ── Marquee selection (selection rectangle) ──
  // Clicar e arrastar no fundo do desktop cria um retângulo de seleção
  // que seleciona todos os ícones que intersecta. Estilo Win95 clássico.
  // Click simples (sem arrastar) desseleciona todos os ícones.
  const desktopEl = document.getElementById("crt-desktop");
  let marqueeEl = null;
  let marqueeStart = null;
  let marqueeActive = false;
  let marqueeMoved = false;

  if (desktopEl) {
    desktopEl.addEventListener("mousedown", function (e) {
      // Só inicia marquee se o clique foi no próprio desktop (não num ícone/janela)
      if (e.target !== desktopEl && !e.target.classList.contains("desktop-icons")) return;
      // Só botão esquerdo
      if (e.button !== 0) return;
      const rect = desktopEl.getBoundingClientRect();
      marqueeStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      marqueeActive = true;
      marqueeMoved = false;
      // Cria o elemento do retângulo (só visível quando se arrasta)
      marqueeEl = document.createElement("div");
      marqueeEl.className = "desktop-marquee";
      marqueeEl.style.display = "none";
      marqueeEl.style.left = marqueeStart.x + "px";
      marqueeEl.style.top = marqueeStart.y + "px";
      marqueeEl.style.width = "0px";
      marqueeEl.style.height = "0px";
      desktopEl.appendChild(marqueeEl);
      // Limpa seleção anterior ao iniciar novo marquee
      desktopIcons.forEach(function (i) { i.classList.remove("selected"); });
      e.preventDefault();
    });

    document.addEventListener("mousemove", function (e) {
      if (!marqueeActive || !marqueeStart || !desktopEl) return;
      const rect = desktopEl.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      // Só mostra o retângulo se houver movimento significativo (>3px)
      const dx = cx - marqueeStart.x, dy = cy - marqueeStart.y;
      if (!marqueeMoved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      marqueeMoved = true;
      if (marqueeEl) marqueeEl.style.display = "";
      // Calcula retângulo (funciona em qualquer direção)
      const x = Math.min(marqueeStart.x, cx);
      const y = Math.min(marqueeStart.y, cy);
      const w = Math.abs(dx);
      const h = Math.abs(dy);
      if (marqueeEl) {
        marqueeEl.style.left = x + "px";
        marqueeEl.style.top = y + "px";
        marqueeEl.style.width = w + "px";
        marqueeEl.style.height = h + "px";
      }
      // Seleciona ícones que intersectam o retângulo
      const marqueeRect = { x: x, y: y, w: w, h: h };
      desktopIcons.forEach(function (icon) {
        const ir = icon.getBoundingClientRect();
        const iconRect = {
          x: ir.left - rect.left, y: ir.top - rect.top,
          w: ir.width, h: ir.height,
        };
        // Teste de interseção AABB
        const intersects = iconRect.x < marqueeRect.x + marqueeRect.w &&
                           iconRect.x + iconRect.w > marqueeRect.x &&
                           iconRect.y < marqueeRect.y + marqueeRect.h &&
                           iconRect.y + iconRect.h > marqueeRect.y;
        icon.classList.toggle("selected", intersects);
      });
    });

    document.addEventListener("mouseup", function () {
      if (!marqueeActive) return;
      // Se não houve movimento (click simples), desseleciona tudo
      if (!marqueeMoved) {
        desktopIcons.forEach(function (i) { i.classList.remove("selected"); });
      }
      marqueeActive = false;
      marqueeMoved = false;
      if (marqueeEl && marqueeEl.parentNode) marqueeEl.parentNode.removeChild(marqueeEl);
      marqueeEl = null;
      marqueeStart = null;
    });
  }

  // Start button: o handler real está em apps.js (abre Start menu).
  // Aqui apenas guardamos a referência para reset no close.
  const startBtn = document.querySelector(".taskbar-start-btn");

  // Inicia/para relógio com open/close
  const originalOpen = open;
  const originalClose = close;
  open = function () {
    originalOpen();
    startClock();
    // Carrega padrão de fundo guardado (Display Properties)
    try {
      const savedBg = localStorage.getItem("jce_desktop_bg");
      if (savedBg) {
        const BG_PATTERNS = {
          "Teal (Default)": "#008080",
          "Clouds": "radial-gradient(ellipse 60px 30px at 15% 25%, #fff 0%, transparent 70%), radial-gradient(ellipse 80px 40px at 65% 55%, #fff 0%, transparent 70%), radial-gradient(ellipse 50px 25px at 85% 15%, #fff 0%, transparent 70%), radial-gradient(ellipse 70px 35px at 40% 80%, #fff 0%, transparent 70%), #008080",
          "Hexagons": "radial-gradient(circle at 50% 0%, transparent 12px, #006060 13px, #006060 14px, transparent 15px), #008080",
          "Stars": "radial-gradient(2px 2px at 20px 30px, #fff, transparent), radial-gradient(2px 2px at 60px 70px, #fff, transparent), radial-gradient(1px 1px at 90px 40px, #fff, transparent), radial-gradient(2px 2px at 130px 80px, #fff, transparent), radial-gradient(1px 1px at 170px 30px, #fff, transparent), #004040",
          "Bricks": "repeating-linear-gradient(0deg, #704020 0px, #704020 20px, #80502a 20px, #80502a 22px), repeating-linear-gradient(90deg, transparent 0px, transparent 40px, #603010 40px, #603010 42px)",
          "Matrix": "repeating-linear-gradient(0deg, transparent 0px, transparent 18px, rgba(0,255,0,0.15) 18px, rgba(0,255,0,0.15) 20px), #001000",
        };
        const bg = BG_PATTERNS[savedBg];
        const desktop = document.getElementById("crt-desktop");
        if (desktop && bg) {
          desktop.style.background = bg;
          let size = "auto";
          if (savedBg === "Stars" || savedBg === "Matrix") size = "200px 200px";
          else if (savedBg === "Hexagons") size = "60px 60px";
          else if (savedBg === "Bricks") size = "42px 42px";
          desktop.style.backgroundSize = size;
        }
      }
    } catch (_) {}
  };
  close = function () {
    originalClose();
    stopClock();
    if (startBtn) startBtn.classList.remove("active");
    if (window.startmenu) window.startmenu.close();
    desktopIcons.forEach(function (i) { i.classList.remove("selected"); });
    // Fecha todas as janelas abertas (pára a música do media player via onClose,
    // fecha notepad/dos/etc.) — ao desligar o PC o estado é reiniciado.
    if (window.wm) window.wm.closeAll();
  };

  // ─────────────────────────────────────────────
  //  API PÚBLICA
  // ─────────────────────────────────────────────
  window.computer = {
    open: open, close: close, toggle: toggle,
    setAmbientVolume: setAmbientVolume,
    setAmbientMuted: setAmbientMuted,
    getAmbientVolume: getAmbientVolume,
    getAmbientMuted: getAmbientMuted,
    setClickMuted: setClickMuted,
    getClickMuted: getClickMuted,
  };
})();
