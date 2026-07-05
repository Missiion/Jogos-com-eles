// ═══════════════════════════════════════════════════════════════
//  brickbreaker.js — Brick Breaker (arcade clone, Win95 CRT)
//  Jogos com Eles · CN Computer
//
//  Etapa 1: núcleo jogável (menu, motor, 8 layouts, sons retro)
//  Etapa 2: 6 power-ups temporários (Wide/Slow/Sticky/Laser/Pierce/Multi)
//  Etapa 2.5: velocidade progressiva (cap nível 5), drop 10%, debug panel
//  Etapa 3: sistema de moedas + Firebase (window.BBData) + anti-tamper
//  Etapa 4: loja de skins (20 skins, 4 categorias, tiers 1-5)
//
//  API: window.BrickBreaker.create() → devolve nó DOM da app.
// ═══════════════════════════════════════════════════════════════

(function () {
  "use strict";

  // ─────────────────────────────────────────────
  //  i18n helper — PT↔EN translation
  //  (em modo PT devolve a key; em modo EN devolve a tradução do DICT)
  // ─────────────────────────────────────────────
  function t(key) {
    if (window.i18n && typeof window.i18n.t === "function") return window.i18n.t(key);
    return key;
  }

  // ─────────────────────────────────────────────
  //  CONFIG
  // ─────────────────────────────────────────────
  const W = 640, H = 480;
  const ASPECT = W / H;

  const PADDLE_W = 94, PADDLE_H = 12;
  const PADDLE_Y = H - 30;
  const PADDLE_SPEED = 8;

  const BALL_R = 7;
  // Velocidade progressiva (Etapa 4 — aumentada novamente):
  //   Nível 1: 7.0 → Nível 2: 7.65 → Nível 3: 8.3 → Nível 4: 8.95 → Nível 5: 9.6
  //   A partir do nível 5: fica em 11.04 (BALL_SPEED_MAX) — equilibrado, controlável.
  const BALL_SPEED_START = 8.05;      // +15% (era 7.0)
  const BALL_SPEED_MAX = 11.04;        // +15% (era 9.6), atingida no nível 5 (8.05 + 0.75×4)
  const BALL_SPEED_INC = 0.75;         // +15% (era 0.65)

  const BRICK_COLS = 11;
  const BRICK_ROWS = 7;
  const BRICK_GAP = 3;
  const BRICK_TOP = 46;
  const BRICK_H = 18;
  const BRICK_W = Math.floor((W - BRICK_GAP) / BRICK_COLS - BRICK_GAP);
  const BRICK_GRID_W = BRICK_COLS * BRICK_W + (BRICK_COLS - 1) * BRICK_GAP;
  const BRICK_GRID_LEFT = Math.floor((W - BRICK_GRID_W) / 2);

  const LIVES = 3;

  // ── Power-ups ──
  const POWERUP_DROP_CHANCE = 0.10;
  const POWERUP_FALL_SPEED = 2.3;
  const POWERUP_RADIUS = 11;
  const POWERUPS = {
    wide:   { color: "#3fb8d4", label: "W", name: "Wide Paddle", duration: 12000, weight: 25 },
    slow:   { color: "#5a78e8", label: "S", name: "Slow Ball",   duration: 7000,  weight: 20 },
    sticky: { color: "#ff8c1a", label: "K", name: "Sticky",      duration: 12000, weight: 18 },
    laser:  { color: "#ff4040", label: "L", name: "Laser",       duration: 10000, weight: 15 },
    through:{ color: "#b06be0", label: "T", name: "Pierce",      duration: 5000,  weight: 12 },
    multi:  { color: "#4dd964", label: "M", name: "Multi-Ball",  duration: 0,     weight: 10 },
  };
  const POWERUP_WEIGHT_TOTAL = (function () { let s = 0; for (const k in POWERUPS) s += POWERUPS[k].weight; return s; })();

  const LASER_SPEED = 9;
  const LASER_COOLDOWN_MS = 600;  // auto-fire ritmo balanceado (era 220 manual)
  const LASER_W = 2, LASER_H = 12;

  const COIN_DIVISOR = 25;

  // ─────────────────────────────────────────────
  //  ÍCONE SVG
  // ─────────────────────────────────────────────
  const ICON_INNER =
    '<rect x="0" y="0" width="16" height="16" rx="1" fill="#000080"/>' +
    '<rect x="2" y="3" width="3.2" height="2.2" fill="#ff4040"/>' +
    '<rect x="6" y="3" width="3.2" height="2.2" fill="#ffd23f"/>' +
    '<rect x="10" y="3" width="3.2" height="2.2" fill="#4dd964"/>' +
    '<rect x="2" y="6" width="3.2" height="2.2" fill="#3fb8d4"/>' +
    '<rect x="6" y="6" width="3.2" height="2.2" fill="#b06be0"/>' +
    '<rect x="10" y="6" width="3.2" height="2.2" fill="#ff8c1a"/>' +
    '<rect x="5.5" y="12" width="5" height="1.6" rx="0.3" fill="#c8c8c8"/>' +
    '<circle cx="8" cy="10" r="1.2" fill="#ffffff"/>';
  const ICON_16 = '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">' + ICON_INNER + "</svg>";
  const ICON_32 = '<svg width="32" height="32" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">' + ICON_INNER + "</svg>";

  // ─────────────────────────────────────────────
  //  SFX
  // ─────────────────────────────────────────────
  const sfx = (function () {
    let ctx = null;
    function ensure() {
      if (ctx) return ctx;
      try { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; ctx = new AC(); } catch (e) { ctx = null; }
      return ctx;
    }
    function resume() { if (ctx && ctx.state === "suspended") ctx.resume().catch(function () {}); }
    function globalMuted() { try { return localStorage.getItem("jce_sound_muted") === "1"; } catch (_) { return false; } }
    let localMuted = false;
    try { localMuted = localStorage.getItem("jce_bb_sound") === "0"; } catch (_) {}
    function tone(freq, dur, type, vol, slideTo) {
      if (globalMuted() || localMuted) return;
      const c = ensure(); if (!c) return; resume();
      const t = c.currentTime;
      const osc = c.createOscillator(), g = c.createGain();
      osc.type = type || "square"; osc.frequency.setValueAtTime(freq, t);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.14, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(c.destination); osc.start(t); osc.stop(t + dur + 0.02);
    }
    function noise(dur, vol, hp) {
      if (globalMuted() || localMuted) return;
      const c = ensure(); if (!c) return; resume();
      const t = c.currentTime; const len = Math.ceil(c.sampleRate * dur);
      const buf = c.createBuffer(1, len, c.sampleRate); const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = c.createBufferSource(); src.buffer = buf;
      const filt = c.createBiquadFilter(); filt.type = "highpass"; filt.frequency.value = hp || 700;
      const g = c.createGain(); g.gain.setValueAtTime(vol || 0.10, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(filt); filt.connect(g); g.connect(c.destination); src.start(t); src.stop(t + dur + 0.02);
    }
    return {
      paddle: function () { tone(440, 0.05, "square", 0.12); },
      brick:  function (row) { tone(520 + row * 45, 0.06, "square", 0.13); noise(0.03, 0.06, 1200); },
      wall:   function () { tone(300, 0.03, "square", 0.07); },
      lose:   function () { tone(330, 0.14, "sawtooth", 0.15, 110); },
      over:   function () { tone(220, 0.5, "sawtooth", 0.16, 70); },
      clear:  function () { [523, 659, 784, 1046].forEach(function (f, i) { setTimeout(function () { tone(f, 0.10, "square", 0.13); }, i * 70); }); },
      menu:   function () { tone(660, 0.04, "square", 0.10); },
      launch: function () { tone(523, 0.06, "square", 0.12, 880); },
      powerup: function () { [523, 659, 784, 1046].forEach(function (f, i) { setTimeout(function () { tone(f, 0.08, "square", 0.13); }, i * 50); }); },
      laser:   function () { tone(1200, 0.04, "sawtooth", 0.08, 600); },
      expire:  function () { tone(400, 0.06, "sine", 0.08, 300); },
      coin:    function () { [988, 1318].forEach(function (f, i) { setTimeout(function () { tone(f, 0.07, "square", 0.12); }, i * 50); }); },
      buy:     function () { [659, 784, 988, 1318].forEach(function (f, i) { setTimeout(function () { tone(f, 0.09, "square", 0.13); }, i * 55); }); },
      equip:   function () { tone(784, 0.06, "square", 0.12, 1046); },
      deny:    function () { tone(200, 0.15, "sawtooth", 0.12, 120); },
      prime:  function () { ensure(); resume(); },
      setLocalMuted: function (m) { localMuted = !!m; try { localStorage.setItem("jce_bb_sound", m ? "0" : "1"); } catch (_) {} },
      isLocalMuted:  function () { return localMuted; }
    };
  })();

  // ─────────────────────────────────────────────
  //  LAYOUTS — 8 organizações
  // ─────────────────────────────────────────────
  const LAYOUTS = [
    function () { const g = []; for (let r = 0; r < BRICK_ROWS; r++) { const row = []; for (let c = 0; c < BRICK_COLS; c++) row.push(1); g.push(row); } return g; },
    function () { const g = []; const mid = (BRICK_COLS - 1) / 2; for (let r = 0; r < BRICK_ROWS; r++) { const row = []; for (let c = 0; c < BRICK_COLS; c++) row.push(Math.abs(c - mid) <= (BRICK_ROWS - 1 - r) ? 1 : 0); g.push(row); } return g; },
    function () { const g = []; const cx = (BRICK_COLS - 1) / 2, cy = (BRICK_ROWS - 1) / 2, rad = Math.max(cx, cy); for (let r = 0; r < BRICK_ROWS; r++) { const row = []; for (let c = 0; c < BRICK_COLS; c++) row.push((Math.abs(c - cx) + Math.abs(r - cy)) <= rad ? 1 : 0); g.push(row); } return g; },
    function () { const g = []; for (let r = 0; r < BRICK_ROWS; r++) { const row = []; for (let c = 0; c < BRICK_COLS; c++) row.push((r + c) % 2 ? 1 : 0); g.push(row); } return g; },
    function () { const g = []; for (let r = 0; r < BRICK_ROWS; r++) { const row = []; for (let c = 0; c < BRICK_COLS; c++) row.push(c % 2 ? 1 : 0); g.push(row); } return g; },
    function () { const g = []; for (let r = 0; r < BRICK_ROWS; r++) { const row = []; for (let c = 0; c < BRICK_COLS; c++) row.push((r === 0 || r === BRICK_ROWS - 1 || c === 0 || c === BRICK_COLS - 1) ? 1 : 0); g.push(row); } return g; },
    function () { const g = []; const mid = (BRICK_COLS - 1) / 2; for (let r = 0; r < BRICK_ROWS; r++) { const row = []; for (let c = 0; c < BRICK_COLS; c++) row.push(Math.abs(c - mid) === r ? 1 : 0); g.push(row); } return g; },
    function () { const g = []; const mid = (BRICK_COLS - 1) / 2, cmid = Math.floor(BRICK_ROWS / 2); for (let r = 0; r < BRICK_ROWS; r++) { const row = []; for (let c = 0; c < BRICK_COLS; c++) row.push((c === Math.floor(mid) || c === Math.ceil(mid) || r === cmid) ? 1 : 0); g.push(row); } return g; },
  ];

  // ─────────────────────────────────────────────
  //  Estado
  // ─────────────────────────────────────────────
  function createBall() { return { x: W / 2, y: PADDLE_Y - BALL_R - 1, vx: 0, vy: 0, attached: true, r: BALL_R }; }

  function defaultEquipped() {
    return window.BBSkins ? Object.assign({}, window.BBSkins.DEFAULT_EQUIPPED) : { bricks: "brick-default", ball: "ball-default", paddle: "pad-default", bg: "bg-void" };
  }
  function defaultOwned() {
    return window.BBSkins ? window.BBSkins.DEFAULT_OWNED.slice() : [];
  }

  function newState() {
    return {
      screen: "menu",
      paddle: { x: W / 2 - PADDLE_W / 2, y: PADDLE_Y, w: PADDLE_W, h: PADDLE_H, baseW: PADDLE_W },
      balls: [createBall()],
      bricks: [],
      capsules: [],
      lasers: [],
      effects: { wide: 0, slow: 0, sticky: 0, laser: 0, through: 0 },
      speedMul: 1.0,
      laserCooldown: 0,
      lives: LIVES,
      score: 0,
      level: 1,
      speed: BALL_SPEED_START,
      running: false,
      raf: null,
      lastTs: 0,
      keys: { left: false, right: false },
      mouseX: null,
      layoutIdx: 0,
      coins: 0,
      coinsReady: false,
      lastAward: 0,
      awarded: false,
      ownedSkins: defaultOwned(),
      equippedSkins: defaultEquipped(),
      shopCategory: "bricks",
      bgTime: 0,
      debugAllUnlocked: false,  // Etapa 6: flag session-only (não persiste no Firebase)
    };
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function buildBricks(state, layoutFn) {
    const grid = layoutFn();
    const bricks = [];
    for (let r = 0; r < BRICK_ROWS; r++) {
      for (let c = 0; c < BRICK_COLS; c++) {
        if (!grid[r] || !grid[r][c]) continue;
        bricks.push({ x: BRICK_GRID_LEFT + c * (BRICK_W + BRICK_GAP), y: BRICK_TOP + r * (BRICK_H + BRICK_GAP), w: BRICK_W, h: BRICK_H, row: r, points: 10 + r * 2, alive: true });
      }
    }
    state.bricks = bricks;
  }

  function resetBalls(state) {
    state.balls = [createBall()];
    const b = state.balls[0]; b.x = state.paddle.x + state.paddle.w / 2; b.y = state.paddle.y - b.r - 1;
  }

  function launchBalls(state) {
    let launched = false;
    state.balls.forEach(function (b) {
      if (b.attached) {
        b.attached = false; const sp = state.speed;
        let vx = (Math.random() - 0.5) * sp * 0.4, vy = -Math.sqrt(Math.max(0.01, sp * sp - vx * vx));
        b.vx = vx; b.vy = vy; launched = true;
      }
    });
    if (launched) sfx.launch();
  }

  function bricksLeft(state) { for (let i = 0; i < state.bricks.length; i++) if (state.bricks[i].alive) return true; return false; }

  // ─────────────────────────────────────────────
  //  POWER-UPS
  // ─────────────────────────────────────────────
  function spawnPowerup(state, x, y) {
    let r = Math.random() * POWERUP_WEIGHT_TOTAL, type = "wide";
    for (const k in POWERUPS) { r -= POWERUPS[k].weight; if (r <= 0) { type = k; break; } }
    state.capsules.push({ x: x, y: y, type: type, vy: POWERUP_FALL_SPEED, r: POWERUP_RADIUS });
  }
  function updatePowerups(state, k) {
    for (let i = state.capsules.length - 1; i >= 0; i--) {
      const c = state.capsules[i]; c.y += c.vy * k;
      if (c.y - c.r > H) { state.capsules.splice(i, 1); continue; }
      const p = state.paddle;
      if (c.x + c.r > p.x && c.x - c.r < p.x + p.w && c.y + c.r > p.y && c.y - c.r < p.y + p.h) {
        activateEffect(state, c.type); state.capsules.splice(i, 1);
      }
    }
  }
  function activateEffect(state, type) {
    sfx.powerup(); const pu = POWERUPS[type];
    if (type === "multi") {
      const src = state.balls.find(function (b) { return !b.attached; }) || state.balls[0];
      for (let i = 0; i < 2; i++) {
        const nb = { x: src.x, y: src.y, vx: 0, vy: 0, attached: false, r: BALL_R };
        const sp = state.speed, ang = -Math.PI / 2 + (i === 0 ? -0.5 : 0.5);
        nb.vx = Math.cos(ang) * sp; nb.vy = Math.sin(ang) * sp; state.balls.push(nb);
      }
      return;
    }
    state.effects[type] = Date.now() + pu.duration;
    if (type === "slow") state.speedMul = 0.6;
    if (type === "wide") state.paddle.w = PADDLE_W * 1.7;
  }
  function tickEffects(state) {
    const now = Date.now();
    for (const k in state.effects) {
      if (!state.effects[k]) continue;
      if (now >= state.effects[k]) {
        state.effects[k] = 0; sfx.expire();
        if (k === "slow") state.speedMul = 1.0;
        if (k === "wide") state.paddle.w = PADDLE_W;
        if (k === "sticky") {
          state.balls.forEach(function (b) { if (b.attached) { b.attached = false; const sp = state.speed; let vx = (Math.random() - 0.5) * sp * 0.4, vy = -Math.sqrt(Math.max(0.01, sp * sp - vx * vx)); b.vx = vx; b.vy = vy; } });
        }
      }
    }
  }

  // ─────────────────────────────────────────────
  //  LASER — auto-fire (Etapa 6: dispara sozinho em ritmo balanceado)
  // ─────────────────────────────────────────────
  function fireLaser(state) {
    if (!state.effects.laser) return; if (Date.now() < state.laserCooldown) return;
    state.laserCooldown = Date.now() + LASER_COOLDOWN_MS;
    const p = state.paddle; state.lasers.push({ x: p.x + 6, y: p.y }); state.lasers.push({ x: p.x + p.w - 6, y: p.y });
    sfx.laser();
  }
  function updateLasers(state, k) {
    for (let i = state.lasers.length - 1; i >= 0; i--) {
      const l = state.lasers[i]; l.y -= LASER_SPEED * k;
      if (l.y + LASER_H < 0) { state.lasers.splice(i, 1); continue; }
      for (let j = 0; j < state.bricks.length; j++) {
        const br = state.bricks[j]; if (!br.alive) continue;
        if (l.x >= br.x && l.x <= br.x + br.w && l.y + LASER_H >= br.y && l.y <= br.y + br.h) {
          br.alive = false; state.score += br.points; sfx.brick(br.row); state.lasers.splice(i, 1); updateHud(state); break;
        }
      }
    }
  }

  // ─────────────────────────────────────────────
  //  FÍSICA
  // ─────────────────────────────────────────────
  function step(state, dt) {
    const k = dt * 60;
    state.bgTime += dt;
    tickEffects(state);
    // Auto-fire laser se o efeito estiver ativo (Etapa 6: dispara sozinho)
    if (state.effects.laser) fireLaser(state);
    if (state.keys.left) state.paddle.x -= PADDLE_SPEED * k;
    if (state.keys.right) state.paddle.x += PADDLE_SPEED * k;
    if (state.mouseX != null) state.paddle.x = state.mouseX - state.paddle.w / 2;
    state.paddle.x = clamp(state.paddle.x, 0, W - state.paddle.w);
    updateLasers(state, k);
    updatePowerups(state, k);

    for (let bi = state.balls.length - 1; bi >= 0; bi--) {
      const b = state.balls[bi];
      if (b.attached) { b.x = state.paddle.x + state.paddle.w / 2; b.y = state.paddle.y - b.r - 1; continue; }
      b.x += b.vx * k * state.speedMul; b.y += b.vy * k * state.speedMul;
      if (b.x - b.r < 0) { b.x = b.r; b.vx = -b.vx; sfx.wall(); }
      if (b.x + b.r > W) { b.x = W - b.r; b.vx = -b.vx; sfx.wall(); }
      if (b.y - b.r < 0) { b.y = b.r; b.vy = -b.vy; sfx.wall(); }
      if (b.y - b.r > H) { state.balls.splice(bi, 1); continue; }
      const p = state.paddle;
      if (b.vy > 0 && b.x + b.r > p.x && b.x - b.r < p.x + p.w && b.y + b.r > p.y && b.y - b.r < p.y + p.h) {
        if (state.effects.sticky) { b.attached = true; b.vx = 0; b.vy = 0; b.y = p.y - b.r; }
        else {
          b.y = p.y - b.r;
          const rel = clamp((b.x - (p.x + p.w / 2)) / (p.w / 2), -1, 1), sp = state.speed;
          let nvx = rel * sp * 0.85, nvy = -Math.sqrt(Math.max(0.01, sp * sp - nvx * nvx));
          if (Math.abs(nvy) < sp * 0.35) { nvy = -sp * 0.35; nvx = (nvx < 0 ? -1 : 1) * Math.sqrt(Math.max(0.01, sp * sp - nvy * nvy)); }
          b.vx = nvx; b.vy = nvy;
        }
        sfx.paddle();
      }
      for (let i = 0; i < state.bricks.length; i++) {
        const br = state.bricks[i]; if (!br.alive) continue;
        if (b.x + b.r > br.x && b.x - b.r < br.x + br.w && b.y + b.r > br.y && b.y - b.r < br.y + br.h) {
          br.alive = false; state.score += br.points; sfx.brick(br.row);
          if (Math.random() < POWERUP_DROP_CHANCE) spawnPowerup(state, br.x + br.w / 2, br.y + br.h / 2);
          if (state.effects.through) { /* pierce: no bounce */ }
          else {
            const oL = (b.x + b.r) - br.x, oR = (br.x + br.w) - (b.x - b.r), oT = (b.y + b.r) - br.y, oB = (br.y + br.h) - (b.y - b.r);
            const minH = Math.min(oL, oR), minV = Math.min(oT, oB);
            if (minH < minV) { b.vx = -b.vx; if (oL < oR) b.x = br.x - b.r; else b.x = br.x + br.w + b.r; }
            else { b.vy = -b.vy; if (oT < oB) b.y = br.y - b.r; else b.y = br.y + br.h + b.r; }
            updateHud(state); break;
          }
          updateHud(state);
        }
      }
    }
    if (state.balls.length === 0) { loseLife(state); return; }
    if (!bricksLeft(state)) {
      state.level++;
      state.speed = Math.min(BALL_SPEED_MAX, state.speed + BALL_SPEED_INC);
      sfx.clear();
      state.layoutIdx = Math.floor(Math.random() * LAYOUTS.length);
      buildBricks(state, LAYOUTS[state.layoutIdx]);
      resetBalls(state); state.capsules = []; state.lasers = []; updateHud(state);
    }
  }

  // ─────────────────────────────────────────────
  //  RENDER — usa BBSkins para tijolos/bola/paddle/fundo
  // ─────────────────────────────────────────────
  function draw(ctx, state) {
    const skins = window.BBSkins;
    // Fundo (com animação)
    if (skins) skins.drawBackground(ctx, W, H, state.equippedSkins.bg, state.bgTime);
    else { ctx.fillStyle = "#000010"; ctx.fillRect(0, 0, W, H); }

    // Tijolos
    const brickSkin = state.equippedSkins.bricks;
    for (let i = 0; i < state.bricks.length; i++) {
      const br = state.bricks[i]; if (!br.alive) continue;
      if (skins) skins.drawBrick(ctx, br.x, br.y, br.w, br.h, br.row, brickSkin);
    }

    // Cápsulas
    for (let i = 0; i < state.capsules.length; i++) {
      const c = state.capsules[i], pu = POWERUPS[c.type];
      ctx.fillStyle = pu.color + "33"; ctx.beginPath(); ctx.arc(c.x, c.y, c.r + 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = pu.color; ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.45)"; ctx.beginPath(); ctx.arc(c.x - 3, c.y - 3, c.r * 0.35, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "bold 11px 'Courier New', monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(pu.label, c.x, c.y + 1);
    }

    // Lasers
    for (let i = 0; i < state.lasers.length; i++) {
      const l = state.lasers[i];
      ctx.fillStyle = "#ff4040"; ctx.fillRect(l.x - LASER_W / 2, l.y, LASER_W, LASER_H);
      ctx.fillStyle = "#ffaaaa"; ctx.fillRect(l.x - 0.5, l.y, 1, LASER_H);
    }

    // Paddle
    const p = state.paddle;
    if (skins) skins.drawPaddle(ctx, p.x, p.y, p.w, p.h, state.equippedSkins.paddle, !!state.effects.laser);
    // Canhões laser (independente da skin)
    if (state.effects.laser) { ctx.fillStyle = "#ff4040"; ctx.fillRect(p.x + 3, p.y - 3, 5, 3); ctx.fillRect(p.x + p.w - 8, p.y - 3, 5, 3); }

    // Bolas (Pierce = roxa com glow sobrepõe-se à skin)
    const through = !!state.effects.through;
    const ballSkin = through ? "ball-plasma" : state.equippedSkins.ball;
    for (let i = 0; i < state.balls.length; i++) {
      const b = state.balls[i];
      if (through) { ctx.fillStyle = "rgba(176,107,224,0.35)"; ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 4, 0, Math.PI * 2); ctx.fill(); }
      if (skins) skins.drawBall(ctx, b.x, b.y, b.r, ballSkin);
    }
  }

  // ─────────────────────────────────────────────
  //  VIDA / GAME OVER
  // ─────────────────────────────────────────────
  function loseLife(state) {
    state.lives--; sfx.lose(); flashHud(state);
    if (state.lives <= 0) gameOver(state);
    else {
      resetBalls(state); state.capsules = []; state.lasers = [];
      state.effects = { wide: 0, slow: 0, sticky: 0, laser: 0, through: 0 };
      state.speedMul = 1.0; state.paddle.w = PADDLE_W; updateHud(state);
    }
  }
  function gameOver(state) {
    const ui = state._ui; stopLoop(state); sfx.over(); state.screen = "gameover";
    if (ui && ui.finalScore) ui.finalScore.textContent = String(state.score);
    awardCoinsOnGameOver(state);
    showScreen(state, "gameover");
  }

  // ─────────────────────────────────────────────
  //  MOEDAS
  // ─────────────────────────────────────────────
  function computeCoins(score) { return Math.floor(score / COIN_DIVISOR); }

  async function awardCoinsOnGameOver(state) {
    if (state.awarded) return;
    state.awarded = true;
    const award = computeCoins(state.score);
    state.lastAward = award;
    const ui = state._ui;
    if (ui && ui.coinsEarned) ui.coinsEarned.textContent = "+" + award;
    // Submete score no leaderboard (Etapa 5) — em paralelo com as moedas
    submitScoreOnGameOver(state);
    if (award <= 0) return;
    sfx.coin();
    if (window.BBData && window.BBData.isReady()) {
      const userId = window.BBData.getUserId();
      const newTotal = await window.BBData.awardCoins(userId, award, state.score, state.level);
      state.coins = newTotal; updateCoinsHud(state);
    } else {
      if (ui && ui.coinsEarned) ui.coinsEarned.textContent = "+" + award + " " + t("(regista-te para guardar)");
    }
  }

  // Etapa 5 — submete score no leaderboard (Firebase)
  // Só submete se o user estiver registado. Não bloqueia as moedas.
  async function submitScoreOnGameOver(state) {
    if (!window.BBData || !window.BBData.isReady()) return;
    if (state.score <= 0) return;
    const userId = window.BBData.getUserId();
    // Lê o nome do utilizador da coleção users/{userId} no Firestore.
    // Antes usava localStorage["jce_user_name"] que NUNCA é definido pelo app.js
    // (o app.js só guarda jce_user_id), pelo que o nome ficava sempre "Anonymous".
    let name = null;
    try {
      if (window.BBData.getUserName) name = await window.BBData.getUserName();
    } catch (_) {}
    // Fallback: se não conseguir obter o nome, usa "Anonymous"
    if (!name) name = "Anonymous";
    try {
      await window.BBData.submitScore(userId, name, state.score, state.level);
    } catch (e) { /* silencioso — não bloqueia o fluxo */ }
  }

  function updateCoinsHud(state) {
    const ui = state._ui; if (!ui || !ui.coins) return;
    if (window.BBData && window.BBData.isReady()) { ui.coins.textContent = String(state.coins); ui.coinsWrap.classList.remove("bb-hidden"); }
    else { ui.coins.textContent = "—"; ui.coinsWrap.classList.remove("bb-hidden"); }
  }

  // ─────────────────────────────────────────────
  //  HUD
  // ─────────────────────────────────────────────
  function updateHud(state) {
    const ui = state._ui; if (!ui) return;
    if (ui.score) ui.score.textContent = String(state.score);
    if (ui.level) ui.level.textContent = String(state.level);
    if (ui.lives) {
      ui.lives.innerHTML = "";
      for (let i = 0; i < state.lives; i++) {
        const s = document.createElement("span"); s.className = "bb-life";
        s.innerHTML = '<svg width="11" height="11" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5" fill="#fff"/><circle cx="6" cy="6" r="1.5" fill="rgba(255,255,255,0.6)"/></svg>';
        ui.lives.appendChild(s);
      }
    }
  }
  function updateEffectsHud(state) {
    const ui = state._ui; if (!ui || !ui.effects) return;
    const now = Date.now(); let html = "";
    for (const k in state.effects) {
      if (!state.effects[k]) continue;
      const pu = POWERUPS[k], remain = state.effects[k] - now; if (remain <= 0) continue;
      const pct = Math.max(0, (remain / pu.duration) * 100);
      html += '<span class="bb-effect-pill" style="--c:' + pu.color + '"><span class="bb-effect-letter">' + pu.label + '</span><span class="bb-effect-bar"><span class="bb-effect-bar-fill" style="width:' + pct.toFixed(0) + '%"></span></span></span>';
    }
    ui.effects.innerHTML = html;
  }
  function flashHud(state) {
    const ui = state._ui; if (!ui || !ui.gameScreen) return;
    ui.gameScreen.classList.add("bb-flash");
    setTimeout(function () { if (ui.gameScreen) ui.gameScreen.classList.remove("bb-flash"); }, 220);
  }

  // ─────────────────────────────────────────────
  //  ECRÃS
  // ─────────────────────────────────────────────
  function showScreen(state, name) {
    const ui = state._ui; state.screen = name;
    const map = { menu: ui.menuScreen, howto: ui.howtoScreen, options: ui.optionsScreen, shop: ui.shopScreen, leaderboard: ui.leaderboardScreen, game: ui.gameScreen, gameover: ui.gameoverScreen };
    Object.keys(map).forEach(function (k) { if (map[k]) map[k].classList.toggle("bb-hidden", k !== name && k !== "game"); });
    if (name === "game" || name === "pause" || name === "gameover") { if (ui.gameScreen) ui.gameScreen.classList.remove("bb-hidden"); }
    else { if (ui.gameScreen) ui.gameScreen.classList.add("bb-hidden"); }
    if (ui.pauseOverlay) ui.pauseOverlay.classList.toggle("bb-hidden", name !== "pause");
    if (name === "shop") renderShop(state);
    if (name === "leaderboard") renderLeaderboard(state);
    // Etapa 2: controlar o RAF do background do menu — só corre no menu.
    // Poupa CPU/GPU quando se está noutros ecrãs (loja, jogo, pausa, etc.).
    if (name === "menu") { if (state.startMenuBg) state.startMenuBg(); }
    else { if (state.stopMenuBg) state.stopMenuBg(); }
  }

  // ─────────────────────────────────────────────
  //  LOOP
  // ─────────────────────────────────────────────
  function loop(ts, state, ui) {
    if (!state.running) return;
    state.raf = requestAnimationFrame(function (t) { loop(t, state, ui); });
    let dt = (ts - state.lastTs) / 1000; state.lastTs = ts; if (dt > 0.05) dt = 0.05;
    try { step(state, dt); } catch (e) { console.error("[bb] step:", e); }
    try { draw(ui.ctx, state); } catch (e) { console.error("[bb] draw:", e); }
    updateEffectsHud(state);
  }
  function startLoop(state, ui) { if (state.running) return; state.running = true; state.lastTs = performance.now(); state.raf = requestAnimationFrame(function (t) { loop(t, state, ui); }); }
  function stopLoop(state) { state.running = false; if (state.raf) { cancelAnimationFrame(state.raf); state.raf = null; } }
  function pauseGame(state) { const ui = state._ui; if (state.screen !== "game") return; stopLoop(state); state.screen = "pause"; if (ui && ui.pauseOverlay) ui.pauseOverlay.classList.remove("bb-hidden"); }
  function resumeGame(state) { const ui = state._ui; if (state.screen !== "pause") return; state.screen = "game"; if (ui && ui.pauseOverlay) ui.pauseOverlay.classList.add("bb-hidden"); startLoop(state, ui); }

  function startGame(state, ui) {
    // Preserva meta-state (coins, skins, debug) através do reset de gameplay
    const prevCoins = state.coins;
    const prevCoinsReady = state.coinsReady;
    const prevOwned = state.ownedSkins;
    const prevEquipped = state.equippedSkins;
    const prevDebugUnlocked = state.debugAllUnlocked;
    const fresh = newState(); Object.assign(state, fresh); state._ui = ui;
    // Restaura meta-state preservado
    state.coins = prevCoins; state.coinsReady = prevCoinsReady;
    state.ownedSkins = prevOwned; state.equippedSkins = prevEquipped;
    state.debugAllUnlocked = prevDebugUnlocked;
    // Re-sincroniza do BBData se disponível (sobre-escreve com dados authoritative)
    // MAS só se NÃO estiver em modo debug unlock (session-only prevalece)
    if (!prevDebugUnlocked && window.BBData && window.BBData.isReady()) { state.coins = window.BBData.getCoins(); state.coinsReady = true; state.ownedSkins = window.BBData.getOwnedSkins(); state.equippedSkins = window.BBData.getEquippedSkins(); }
    state.layoutIdx = Math.floor(Math.random() * LAYOUTS.length);
    buildBricks(state, LAYOUTS[state.layoutIdx]); resetBalls(state); updateHud(state); updateCoinsHud(state);
    showScreen(state, "game"); draw(ui.ctx, state); if (ui.wrap) ui.wrap.focus(); startLoop(state, ui);
  }

  // ─────────────────────────────────────────────
  //  DEBUG PANEL (comando "test")
  // ─────────────────────────────────────────────
  function toggleDebugPanel(state, ui) { if (!ui.debugPanel) return; const isOpen = !ui.debugPanel.classList.contains("bb-hidden"); ui.debugPanel.classList.toggle("bb-hidden", isOpen); if (!isOpen) sfx.menu(); }
  function debugAction(state, action) {
    const p = state.paddle;
    switch (action) {
      case "wide":    state.capsules.push({ x: p.x + p.w / 2, y: p.y - 14, type: "wide", vy: POWERUP_FALL_SPEED, r: POWERUP_RADIUS }); break;
      case "slow":    state.capsules.push({ x: p.x + p.w / 2, y: p.y - 14, type: "slow", vy: POWERUP_FALL_SPEED, r: POWERUP_RADIUS }); break;
      case "sticky":  state.capsules.push({ x: p.x + p.w / 2, y: p.y - 14, type: "sticky", vy: POWERUP_FALL_SPEED, r: POWERUP_RADIUS }); break;
      case "laser":   state.capsules.push({ x: p.x + p.w / 2, y: p.y - 14, type: "laser", vy: POWERUP_FALL_SPEED, r: POWERUP_RADIUS }); break;
      case "through": state.capsules.push({ x: p.x + p.w / 2, y: p.y - 14, type: "through", vy: POWERUP_FALL_SPEED, r: POWERUP_RADIUS }); break;
      case "multi":   state.capsules.push({ x: p.x + p.w / 2, y: p.y - 14, type: "multi", vy: POWERUP_FALL_SPEED, r: POWERUP_RADIUS }); break;
      case "score":   state.score += 500; updateHud(state); break;
      case "level":   state.bricks.forEach(function (b) { b.alive = false; }); break;
      case "kill":    state.lives = 1; state.balls.forEach(function (b) { b.attached = false; b.y = H + 20; b.vy = 8; }); break;
      case "resetcoins":
        // Session-only: não grava no Firebase, só em memória
        state.coins = 0; updateCoinsHud(state);
        break;
      case "unlock":
        // UNLOCK ALL — session-only: adiciona todas as skins ao state em memória.
        // NÃO grava no Firebase nem no cache. Em refresh, tudo sai.
        if (window.BBSkins) {
          const all = [];
          for (const cat in window.BBSkins.CATALOG) {
            window.BBSkins.CATALOG[cat].forEach(function (s) { all.push(s.id); });
          }
          // Merge com owned existente (preserva o que já tinha)
          const set = new Set(state.ownedSkins);
          all.forEach(function (id) { set.add(id); });
          state.ownedSkins = Array.from(set);
          state.debugAllUnlocked = true;
          // Se a loja estiver aberta, re-renderiza
          if (state.screen === "shop") renderShop(state);
        }
        break;
      case "close":   toggleDebugPanel(state, state._ui); break;
    }
    sfx.menu();
  }

  // ─────────────────────────────────────────────
  //  LOJA (Etapa 4)
  // ─────────────────────────────────────────────
  function renderShop(state) {
    const ui = state._ui; if (!ui || !ui.shopGrid) return;
    const skins = window.BBSkins; if (!skins) return;
    const cat = state.shopCategory;
    const list = skins.CATALOG[cat] || [];
    const owned = state.ownedSkins;
    const equipped = state.equippedSkins[cat];
    const coins = state.coins;

    // Atualiza tabs
    if (ui.shopTabs) {
      ui.shopTabs.querySelectorAll(".bb-shop-tab").forEach(function (t) {
        t.classList.toggle("active", t.dataset.cat === cat);
      });
    }
    // Atualiza contador de moedas na loja
    if (ui.shopCoins) ui.shopCoins.textContent = String(coins);

    // Renderiza grid
    ui.shopGrid.innerHTML = "";
    list.forEach(function (skin) {
      const card = document.createElement("div");
      card.className = "bb-shop-card";
      const price = skins.TIER_PRICES[skin.tier] || 0;
      // isOwned = skin está em ownedSkins. Tier-1 (preço 0) NÃO são auto-owned —
      // o utilizador tem de as "comprar" (grátis) para ficarem owned e poder
      // equipá-las. Antes deste fix, price === 0 tornava tier-1 sempre owned,
      // pelo que o botão mostrava EQUIPAR sem terem sido compradas.
      const isOwned = owned.indexOf(skin.id) >= 0;
      const isEquipped = equipped === skin.id;
      const tierColor = skins.TIER_COLORS[skin.tier] || "#888";
      if (isEquipped) card.classList.add("equipped");
      else if (isOwned) card.classList.add("owned");

      // Preview canvas
      const cv = document.createElement("canvas");
      cv.className = "bb-shop-preview";
      cv.width = 96; cv.height = 56;
      skins.renderPreview(cv, cat, skin.id);
      card.appendChild(cv);

      // Info
      const info = document.createElement("div");
      info.className = "bb-shop-info";
      info.innerHTML =
        '<div class="bb-shop-name">' + skin.name + '</div>' +
        '<div class="bb-shop-tier" style="color:' + tierColor + '">TIER ' + skin.tier + '</div>' +
        '<div class="bb-shop-desc">' + skin.desc + '</div>';
      card.appendChild(info);

      // Action button
      // Os defaults (brick-default etc.) NÃO aparecem na loja, pelo que
      // qualquer skin equipada visível aqui é uma skin comprada → faz sentido
      // mostrar sempre "DESEQUIPAR" (que volta ao default interno).
      const btn = document.createElement("button");
      btn.className = "bb-btn bb-shop-btn";
      btn.type = "button";
      if (isEquipped) { btn.textContent = t("DESEQUIPAR"); btn.dataset.skin = skin.id; btn.dataset.act2 = "unequip"; }
      else if (isOwned) { btn.textContent = t("EQUIPAR"); btn.dataset.skin = skin.id; btn.dataset.act2 = "equip"; }
      else {
        btn.textContent = price + " $";
        btn.dataset.skin = skin.id;
        btn.dataset.act2 = "buy";
        if (coins < price) { btn.classList.add("bb-shop-btn-locked"); btn.disabled = true; btn.textContent = price + " $"; }
      }
      btn.dataset.cat = cat;
      card.appendChild(btn);

      ui.shopGrid.appendChild(card);
    });
  }

  async function shopAction(state, action, category, skinId) {
    const skins = window.BBSkins; if (!skins) return;
    const skin = skins.getSkin(category, skinId); if (!skin) return;
    const price = skins.TIER_PRICES[skin.tier] || 0;

    // Modo debug (session-only): tudo em memória, NÃO grava no Firebase nem cache
    if (state.debugAllUnlocked) {
      if (action === "equip") {
        sfx.equip();
        state.equippedSkins[category] = skinId;
        renderShop(state);
      } else if (action === "unequip") {
        // Desequipa — volta ao default interno (brick-default etc.)
        sfx.equip();
        const def = defaultEquipped();
        state.equippedSkins[category] = def[category];
        renderShop(state);
      }
      // "buy" não acontece em modo unlock (tudo já é owned)
      return;
    }

    if (action === "buy") {
      if (!window.BBData || !window.BBData.isReady()) { sfx.deny(); return; }
      if (state.coins < price) { sfx.deny(); return; }
      const res = await window.BBData.purchaseSkin(window.BBData.getUserId(), category, skinId, price);
      if (res.success) {
        sfx.buy();
        state.coins = res.coins;
        state.ownedSkins = res.ownedSkins;
        // Auto-equipa após compra
        await window.BBData.equipSkin(window.BBData.getUserId(), category, skinId);
        state.equippedSkins[category] = skinId;
        renderShop(state);
        updateCoinsHud(state);
      } else { sfx.deny(); }
    } else if (action === "equip") {
      if (window.BBData && window.BBData.isReady()) {
        const ok = await window.BBData.equipSkin(window.BBData.getUserId(), category, skinId);
        if (ok) { sfx.equip(); state.equippedSkins[category] = skinId; renderShop(state); }
        else sfx.deny();
      } else {
        // Modo offline (não registado) — equipa só em memória (não persiste)
        sfx.equip(); state.equippedSkins[category] = skinId; renderShop(state);
      }
    } else if (action === "unequip") {
      // Desequipa — volta ao default (não gravado na loja)
      const def = defaultEquipped();
      const defaultId = def[category];
      if (state.debugAllUnlocked || !window.BBData || !window.BBData.isReady()) {
        sfx.equip(); state.equippedSkins[category] = defaultId; renderShop(state);
      } else {
        const ok = await window.BBData.equipSkin(window.BBData.getUserId(), category, defaultId);
        if (ok) { sfx.equip(); state.equippedSkins[category] = defaultId; renderShop(state); }
        else sfx.deny();
      }
    }
  }

  function setShopCategory(state, cat) {
    state.shopCategory = cat; sfx.menu(); renderShop(state);
  }

  // ─────────────────────────────────────────────
  //  LEADERBOARD (Etapa 5)
  // ─────────────────────────────────────────────
  async function renderLeaderboard(state) {
    const ui = state._ui; if (!ui || !ui.lbList) return;
    // Estado de loading
    ui.lbList.innerHTML = '<div class="bb-lb-loading">' + t("A carregar...") + '</div>';
    if (ui.lbMyBest) ui.lbMyBest.textContent = "—";
    let entries = [];
    let myBest = null;
    if (window.BBData && window.BBData.isReady()) {
      try {
        entries = await window.BBData.getLeaderboard(10);
        myBest = await window.BBData.getUserBestScore(window.BBData.getUserId());
      } catch (e) { /* fallback vazio */ }
    }
    if (!entries || entries.length === 0) {
      ui.lbList.innerHTML = '<div class="bb-lb-empty">' + t("Sem pontuações ainda. Sê o primeiro!") + '</div>';
      if (ui.lbMyBest) ui.lbMyBest.textContent = "—";
      return;
    }
    // Renderiza top 10
    const currentUserId = (window.BBData && window.BBData.isReady()) ? window.BBData.getUserId() : null;
    ui.lbList.innerHTML = "";
    entries.forEach(function (entry) {
      const row = document.createElement("div");
      row.className = "bb-lb-row" + (entry.userId === currentUserId ? " bb-lb-row-me" : "");
      const medal = entry.rank === 1 ? "#ffd23f" : entry.rank === 2 ? "#c0c0c0" : entry.rank === 3 ? "#cd7f32" : null;
      row.innerHTML =
        '<span class="bb-lb-rank"' + (medal ? ' style="color:' + medal + '"' : "") + '>' + entry.rank + '</span>' +
        '<span class="bb-lb-name">' + escapeHtml(entry.name) + '</span>' +
        '<span class="bb-lb-level">LV ' + entry.level + '</span>' +
        '<span class="bb-lb-score">' + entry.score + '</span>';
      ui.lbList.appendChild(row);
    });
    // Meu melhor
    if (ui.lbMyBest) {
      ui.lbMyBest.textContent = myBest ? (myBest.score + " (LV " + myBest.level + ")") : "—";
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ─────────────────────────────────────────────
  //  CREATE
  // ─────────────────────────────────────────────
  function create() {
    const wrap = document.createElement("div");
    wrap.className = "app-brickbreaker";
    wrap.setAttribute("tabindex", "0");
    wrap.innerHTML =
      '<div class="bb-screen bb-menu-screen">' +
        '<canvas class="bb-menu-bg-canvas" width="' + W + '" height="' + H + '"></canvas>' +
        '<div class="bb-title">' +
          '<div class="bb-title-main">BRICK•BREAKER</div>' +
          '<div class="bb-title-sub">CN ARCADE · 1995</div>' +
        '</div>' +
        '<div class="bb-menu-buttons">' +
          '<button class="bb-btn bb-btn-primary" type="button" data-act="play">' + t("JOGAR") + '</button>' +
          '<button class="bb-btn" type="button" data-act="shop">' + t("LOJA") + '</button>' +
          '<button class="bb-btn" type="button" data-act="leaderboard">' + t("TABELA DE PONTUAÇÕES") + '</button>' +
          '<button class="bb-btn" type="button" data-act="howto">' + t("COMO JOGAR") + '</button>' +
          '<button class="bb-btn" type="button" data-act="options">' + t("OPÇÕES") + '</button>' +
        '</div>' +
        '<div class="bb-menu-footer">v1.5 · © CASA•NORTE SYSTEMS</div>' +
      '</div>' +

      '<div class="bb-screen bb-howto-screen bb-hidden">' +
        '<div class="bb-panel">' +
          '<div class="bb-panel-title">' + t("COMO JOGAR") + '</div>' +
          '<ul class="bb-howto-list">' +
            '<li><b>' + t("Mover plataforma:") + '</b> ' + t("Rato ou setas ← →") + '</li>' +
            '<li><b>' + t("Lançar bola:") + '</b> ' + t("Espaço ou Clique") + '</li>' +
            '<li><b>' + t("Pausa:") + '</b> P &nbsp;·&nbsp; <b>' + t("Sair:") + '</b> ' + t("Esc (em pausa)") + '</li>' +
            '<li><b>' + t("Vidas:") + '</b> 3 — ' + t("Não deixes todas as bolas cair!") + '</li>' +
            '<li><b>' + t("Power-ups:") + '</b> ' + t("Apanha cápsulas que caem — drops raros dos tijolos") + '</li>' +
            '<li><b>W</b> ' + t("Alargar · Lento · Pegajoso · Laser · Atravessar · Multi") + '</li>' +
            '<li><b>' + t("Velocidade:") + '</b> ' + t("Aumenta a cada nível, cap no nível 5") + '</li>' +
            '<li><b>' + t("Moedas:") + '</b> ' + t("Ganhas com a pontuação (25 pts = 1 moeda) — gasta na LOJA") + '</li>' +
            '<li><b>' + t("Loja:") + '</b> ' + t("Compra e equipa skins para tijolos, bola, plataforma e fundo") + '</li>' +
            '<li><b>' + t("Limpa todos os tijolos") + '</b> ' + t("para avançar — 8 padrões") + '</li>' +
          '</ul>' +
          '<button class="bb-btn bb-btn-primary" type="button" data-act="back">' + t("VOLTAR") + '</button>' +
        '</div>' +
      '</div>' +

      '<div class="bb-screen bb-options-screen bb-hidden">' +
        '<div class="bb-panel">' +
          '<div class="bb-panel-title">' + t("OPÇÕES") + '</div>' +
          '<label class="bb-option-row"><input type="checkbox" id="bb-opt-sound" /><span>' + t("Efeitos sonoros") + '</span></label>' +
          '<button class="bb-btn bb-btn-primary" type="button" data-act="back">' + t("VOLTAR") + '</button>' +
        '</div>' +
      '</div>' +

      '<div class="bb-screen bb-shop-screen bb-hidden">' +
        '<div class="bb-shop-header">' +
          '<span class="bb-shop-title">' + t("LOJA") + '</span>' +
          '<span class="bb-shop-coins">' +
            '<svg class="bb-coin-icon" width="13" height="13" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="#ffd23f" stroke="#b8860b" stroke-width="1.5"/><text x="8" y="11" font-size="8" text-anchor="middle" fill="#8b6914" font-family="serif" font-weight="bold">$</text></svg>' +
            '<span data-hud="shop-coins">0</span>' +
          '</span>' +
        '</div>' +
        '<div class="bb-shop-tabs" data-hud="shop-tabs">' +
          '<button class="bb-shop-tab active" type="button" data-cat="bricks">' + t("TIJOLOS") + '</button>' +
          '<button class="bb-shop-tab" type="button" data-cat="ball">' + t("BOLA") + '</button>' +
          '<button class="bb-shop-tab" type="button" data-cat="paddle">' + t("PLATAFORMA") + '</button>' +
          '<button class="bb-shop-tab" type="button" data-cat="bg">' + t("FUNDO") + '</button>' +
        '</div>' +
        '<div class="bb-shop-grid" data-hud="shop-grid"></div>' +
        '<button class="bb-btn bb-btn-primary bb-shop-back" type="button" data-act="back">' + t("VOLTAR") + '</button>' +
      '</div>' +

      '<div class="bb-screen bb-game-screen bb-hidden">' +
        '<canvas class="bb-canvas" width="' + W + '" height="' + H + '"></canvas>' +
        '<div class="bb-hud">' +
          '<div class="bb-hud-score">' + t("PONTOS") + '&nbsp;<span class="bb-hud-num" data-hud="score">0</span></div>' +
          '<div class="bb-hud-level">' + t("NÍVEL") + '&nbsp;<span class="bb-hud-num" data-hud="level">1</span></div>' +
          '<div class="bb-hud-coins" data-hud="coins-wrap">' +
            '<svg class="bb-coin-icon" width="11" height="11" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="#ffd23f" stroke="#b8860b" stroke-width="1.5"/><text x="8" y="11" font-size="8" text-anchor="middle" fill="#8b6914" font-family="serif" font-weight="bold">$</text></svg>' +
            '<span class="bb-hud-num bb-hud-coins-num" data-hud="coins">0</span>' +
          '</div>' +
          '<div class="bb-hud-lives" data-hud="lives"></div>' +
        '</div>' +
        '<div class="bb-hud-effects" data-hud="effects"></div>' +
        '<div class="bb-hint">' + t("RATO / ← → MOVER · ESPAÇO LANÇAR · P PAUSA") + '</div>' +
        '<div class="bb-pause bb-hidden">' +
          '<div class="bb-pause-title">' + t("EM PAUSA") + '</div>' +
          '<button class="bb-btn bb-btn-primary" type="button" data-act="resume">' + t("RETOMAR") + '</button>' +
          '<button class="bb-btn" type="button" data-act="quit">' + t("SAIR PARA O MENU") + '</button>' +
        '</div>' +
      '</div>' +

      '<div class="bb-screen bb-gameover-screen bb-hidden">' +
        '<div class="bb-go-title">' + t("FIM DE JOGO") + '</div>' +
        '<div class="bb-go-score">' + t("PONTUAÇÃO FINAL") + '&nbsp;<span class="bb-hud-num" data-hud="final">0</span></div>' +
        '<div class="bb-go-coins">' + t("MOEDAS GANHAS") + '&nbsp;<span class="bb-hud-num bb-go-coins-num" data-hud="coins-earned">+0</span></div>' +
        '<div class="bb-go-buttons">' +
          '<button class="bb-btn bb-btn-primary" type="button" data-act="retry">' + t("JOGAR DE NOVO") + '</button>' +
          '<button class="bb-btn" type="button" data-act="leaderboard">' + t("TABELA DE PONTUAÇÕES") + '</button>' +
          '<button class="bb-btn" type="button" data-act="shop">' + t("LOJA") + '</button>' +
          '<button class="bb-btn" type="button" data-act="menu">' + t("MENU PRINCIPAL") + '</button>' +
        '</div>' +
      '</div>' +

      '<div class="bb-screen bb-leaderboard-screen bb-hidden">' +
        '<div class="bb-lb-header">' +
          '<span class="bb-lb-title">' + t("TABELA DE PONTUAÇÕES") + '</span>' +
          '<span class="bb-lb-mybest-wrap">' + t("MELHOR:") + ' <span class="bb-lb-mybest" data-hud="lb-mybest">—</span></span>' +
        '</div>' +
        '<div class="bb-lb-listhead">' +
          '<span class="bb-lb-h-rank">#</span>' +
          '<span class="bb-lb-h-name">' + t("NOME") + '</span>' +
          '<span class="bb-lb-h-level">' + t("NÍVEL") + '</span>' +
          '<span class="bb-lb-h-score">' + t("PONTUAÇÃO") + '</span>' +
        '</div>' +
        '<div class="bb-lb-list" data-hud="lb-list"></div>' +
        '<button class="bb-btn bb-btn-primary bb-lb-back" type="button" data-act="back">' + t("VOLTAR") + '</button>' +
      '</div>' +

      '<div class="bb-debug bb-hidden" data-hud="debug">' +
        '<div class="bb-debug-title">' + t("DEBUG · escreve \"test\" para alternar") + '</div>' +
        '<div class="bb-debug-buttons">' +
          '<button class="bb-btn" type="button" data-dbg="wide">' + t("LARGO") + '</button>' +
          '<button class="bb-btn" type="button" data-dbg="slow">' + t("LENTO") + '</button>' +
          '<button class="bb-btn" type="button" data-dbg="sticky">' + t("PEGAJOSO") + '</button>' +
          '<button class="bb-btn" type="button" data-dbg="laser">LASER</button>' +
          '<button class="bb-btn" type="button" data-dbg="through">' + t("PIERCE") + '</button>' +
          '<button class="bb-btn" type="button" data-dbg="multi">MULTI</button>' +
          '<button class="bb-btn" type="button" data-dbg="score">+500 PTS</button>' +
          '<button class="bb-btn" type="button" data-dbg="level">' + t("SALTAR NÍVEL") + '</button>' +
          '<button class="bb-btn" type="button" data-dbg="kill">' + t("MORRER") + '</button>' +
          '<button class="bb-btn" type="button" data-dbg="unlock">' + t("DESBLOQUEAR TUDO") + '</button>' +
          '<button class="bb-btn" type="button" data-dbg="resetcoins">' + t("RESET $") + '</button>' +
          '<button class="bb-btn bb-btn-primary" type="button" data-dbg="close">' + t("FECHAR") + '</button>' +
        '</div>' +
      '</div>';

    const ui = {
      wrap: wrap,
      menuScreen: wrap.querySelector(".bb-menu-screen"),
      menuBgCanvas: wrap.querySelector(".bb-menu-bg-canvas"),
      howtoScreen: wrap.querySelector(".bb-howto-screen"),
      optionsScreen: wrap.querySelector(".bb-options-screen"),
      shopScreen: wrap.querySelector(".bb-shop-screen"),
      leaderboardScreen: wrap.querySelector(".bb-leaderboard-screen"),
      gameScreen: wrap.querySelector(".bb-game-screen"),
      gameoverScreen: wrap.querySelector(".bb-gameover-screen"),
      pauseOverlay: wrap.querySelector(".bb-pause"),
      debugPanel: wrap.querySelector('[data-hud="debug"]'),
      canvas: wrap.querySelector(".bb-canvas"),
      score: wrap.querySelector('[data-hud="score"]'),
      level: wrap.querySelector('[data-hud="level"]'),
      lives: wrap.querySelector('[data-hud="lives"]'),
      effects: wrap.querySelector('[data-hud="effects"]'),
      coinsWrap: wrap.querySelector('[data-hud="coins-wrap"]'),
      coins: wrap.querySelector('[data-hud="coins"]'),
      coinsEarned: wrap.querySelector('[data-hud="coins-earned"]'),
      finalScore: wrap.querySelector('[data-hud="final"]'),
      shopGrid: wrap.querySelector('[data-hud="shop-grid"]'),
      shopTabs: wrap.querySelector('[data-hud="shop-tabs"]'),
      shopCoins: wrap.querySelector('[data-hud="shop-coins"]'),
      lbList: wrap.querySelector('[data-hud="lb-list"]'),
      lbMyBest: wrap.querySelector('[data-hud="lb-mybest"]'),
      soundChk: wrap.querySelector("#bb-opt-sound"),
    };
    ui.ctx = ui.canvas.getContext("2d");
    ui.ctx.imageSmoothingEnabled = false;

    const state = newState();
    state._ui = ui;

    if (ui.soundChk) { ui.soundChk.checked = !sfx.isLocalMuted(); ui.soundChk.addEventListener("change", function () { sfx.setLocalMuted(!ui.soundChk.checked); }); }

    // ── BBData: subscreve moedas + skins em tempo real ──
    // Retry: brickbreaker-data.js é um módulo ESM (async). Se o utilizador
    // abrir o jogo antes do módulo carregar, window.BBData ainda é undefined.
    // Tentamos de novo a cada 200ms até BBData estar disponível (ou até a
    // janela fechar — guardamos o timer para cleanup no _onClose).
    let bbdataSetupTimer = null;
    let bbdataSubscribed = false;
    function setupBBData() {
      if (!window.BBData) {
        // Retry — módulo ESM ainda não carregou
        bbdataSetupTimer = setTimeout(setupBBData, 200);
        return;
      }
      bbdataSetupTimer = null;
      const userId = window.BBData.getUserId();
      if (!userId) return;
      if (bbdataSubscribed) return; // já subscrito (idempotente)
      bbdataSubscribed = true;
      state.coinsReady = true;
      state.coins = window.BBData.getCoins();
      state.ownedSkins = window.BBData.getOwnedSkins();
      state.equippedSkins = window.BBData.getEquippedSkins();
      updateCoinsHud(state);
      window.BBData.subscribe(userId, function (data) {
        // Modo debug (session-only): NÃO sobre-escrever com dados do Firestore.
        // O state.ownedSkins/equippedSkins em memória contém as skins de debug
        // (UNLOCK ALL) que não devem ser clobbered por updates do Firestore.
        if (state.debugAllUnlocked) {
          // Apenas atualiza as moedas (que o debug não mexe — o RESET $ é em memória)
          state.coins = data.coins; state.coinsReady = true;
          updateCoinsHud(state);
          if (state.screen === "shop") renderShop(state);
          return;
        }
        state.coins = data.coins; state.coinsReady = true;
        state.ownedSkins = data.ownedSkins; state.equippedSkins = data.equippedSkins;
        updateCoinsHud(state);
        // Se a loja estiver aberta, re-renderiza para refletir mudanças
        if (state.screen === "shop") renderShop(state);
      });
    }
    setupBBData();

    // ── Animação de fundo do menu — "Falling Bricks" (simples, temático) ──
    // Tijolos coloridos caem do topo ao fundo, em colunas fixas.
    // Sem física, sem colisões — puramente visual e leve.
    //
    // Otimização (Etapa 2): o RAF só corre quando o ecrã de menu está visível.
    // Antes, o menuBgLoop pedia RAF sempre, mesmo noutros ecrãs (loja, jogo,
    // pausa, etc.) — desperdício de CPU/GPU. Agora startMenuBg()/stopMenuBg()
    // controlam o ciclo de vida. O showScreen() chama-os ao mudar de ecrã.
    let menuBgRaf = null;
    let menuBgLastTs = 0;
    let menuBgBricks = [];
    const MENU_BG_COLORS = ["#ff4040", "#ff8c1a", "#ffd23f", "#4dd964", "#3fb8d4", "#5a78e8", "#b06be0"];
    function initMenuBg() {
      if (!ui.menuBgCanvas) return;
      menuBgBricks = [];
      const cols = 12;
      for (let i = 0; i < cols; i++) {
        menuBgBricks.push({
          x: (i + 0.5) * (W / cols) - 22,
          y: -50 - Math.random() * 300,
          // Velocidade aumentada (Etapa 2): 40-80 px/s (era 15-40) — mais dinâmico
          speed: 40 + Math.random() * 40,
          color: MENU_BG_COLORS[i % MENU_BG_COLORS.length],
          w: 44, h: 14,
          // Alpha mantém-se baixo para não competir com o texto; o overlay CSS
          // (.bb-menu-screen::before) garante a legibilidade do conteúdo.
          alpha: 0.10 + Math.random() * 0.08,
        });
      }
    }
    function drawMenuBg(ts) {
      if (!ui.menuBgCanvas) return;
      const ctx = ui.menuBgCanvas.getContext("2d");
      ctx.imageSmoothingEnabled = false;
      if (!menuBgLastTs) menuBgLastTs = ts;
      const dt = Math.min(0.05, (ts - menuBgLastTs) / 1000);
      menuBgLastTs = ts;

      // Fundo preto
      ctx.fillStyle = "#000006";
      ctx.fillRect(0, 0, W, H);

      // Tijolos a cair
      for (let i = 0; i < menuBgBricks.length; i++) {
        const b = menuBgBricks[i];
        b.y += b.speed * dt;
        if (b.y > H + 20) {
          b.y = -30 - Math.random() * 100;
          b.speed = 40 + Math.random() * 40;
          b.color = MENU_BG_COLORS[Math.floor(Math.random() * MENU_BG_COLORS.length)];
          b.alpha = 0.10 + Math.random() * 0.08;
        }
        ctx.globalAlpha = b.alpha;
        ctx.fillStyle = b.color;
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.fillStyle = "rgba(255,255,255,0.2)";
        ctx.fillRect(b.x, b.y, b.w, 1.5);
        ctx.fillStyle = "rgba(0,0,0,0.2)";
        ctx.fillRect(b.x, b.y + b.h - 1.5, b.w, 1.5);
      }
      ctx.globalAlpha = 1;

      // Vinheta
      const vign = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.8);
      vign.addColorStop(0, "rgba(0,0,0,0)");
      vign.addColorStop(1, "rgba(0,0,0,0.5)");
      ctx.fillStyle = vign;
      ctx.fillRect(0, 0, W, H);
    }
    function menuBgLoop(ts) {
      // Safety: só desenha se o menu estiver visível. Se não estiver, para o RAF.
      if (!ui.menuScreen || ui.menuScreen.classList.contains("bb-hidden")) {
        menuBgRaf = null;
        return;
      }
      drawMenuBg(ts);
      menuBgRaf = requestAnimationFrame(menuBgLoop);
    }
    function startMenuBg() {
      if (menuBgRaf) return; // já está a correr
      menuBgLastTs = 0;
      menuBgRaf = requestAnimationFrame(menuBgLoop);
    }
    function stopMenuBg() {
      if (menuBgRaf) { cancelAnimationFrame(menuBgRaf); menuBgRaf = null; }
    }
    // Expõe startMenuBg/stopMenuBg no state para showScreen() poder controlar
    // o RAF do background do menu (só corre quando o menu está visível).
    state.startMenuBg = startMenuBg;
    state.stopMenuBg = stopMenuBg;
    initMenuBg();
    // Inicia o background do menu ao criar a app (ecrã inicial = menu)
    startMenuBg();

    // ── Delegação de cliques [data-act] ──
    wrap.addEventListener("click", function (e) {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const act = btn.dataset.act;
      sfx.menu();
      if (act === "play") { startGame(state, ui); }
      else if (act === "shop") { showScreen(state, "shop"); }
      else if (act === "leaderboard") { showScreen(state, "leaderboard"); }
      else if (act === "howto") { showScreen(state, "howto"); }
      else if (act === "options") { showScreen(state, "options"); }
      else if (act === "back") { showScreen(state, "menu"); }
      else if (act === "resume") { resumeGame(state); }
      else if (act === "quit") { stopLoop(state); showScreen(state, "menu"); }
      else if (act === "retry") { startGame(state, ui); }
      else if (act === "menu") { stopLoop(state); showScreen(state, "menu"); }
    });

    // ── Delegação de cliques [data-act2] (shop buy/equip) ──
    wrap.addEventListener("click", function (e) {
      const btn = e.target.closest("[data-act2]");
      if (!btn) return;
      e.stopPropagation();
      shopAction(state, btn.dataset.act2, btn.dataset.cat, btn.dataset.skin);
    });

    // ── Delegação de cliques [data-dbg] (debug panel) ──
    wrap.addEventListener("click", function (e) {
      const btn = e.target.closest("[data-dbg]");
      if (!btn) return;
      e.stopPropagation();
      debugAction(state, btn.dataset.dbg);
    });

    // ── Shop tabs ──
    if (ui.shopTabs) {
      ui.shopTabs.addEventListener("click", function (e) {
        const tab = e.target.closest(".bb-shop-tab");
        if (!tab) return;
        setShopCategory(state, tab.dataset.cat);
      });
    }

    // ── Input: rato no canvas ──
    ui.canvas.addEventListener("mousemove", function (e) {
      const rect = ui.canvas.getBoundingClientRect();
      state.mouseX = clamp((e.clientX - rect.left) * (W / rect.width), 0, W);
    });
    ui.canvas.addEventListener("mouseleave", function () { state.mouseX = null; });
    ui.canvas.addEventListener("pointerdown", function (e) {
      e.preventDefault(); wrap.focus();
      if (state.screen === "game") { launchBalls(state); }
    });

    // ── Input: teclado ──
    // Listener no wrap (requer foco) para teclas de jogo (arrows, space, P, Esc)
    wrap.addEventListener("keydown", function (e) {
      const k = e.key;
      if (k === "Escape") {
        if (ui.debugPanel && !ui.debugPanel.classList.contains("bb-hidden")) { toggleDebugPanel(state, ui); e.stopPropagation(); return; }
        if (state.screen === "game") { e.stopPropagation(); pauseGame(state); return; }
        if (state.screen === "pause") { e.stopPropagation(); resumeGame(state); return; }
        return;
      }
      if (state.screen === "game" || state.screen === "pause") e.stopPropagation();
      if (state.screen !== "game") return;
      if (k === "ArrowLeft" || k === "a" || k === "A") { state.keys.left = true; e.preventDefault(); }
      else if (k === "ArrowRight" || k === "d" || k === "D") { state.keys.right = true; e.preventDefault(); }
      else if (k === " " || k === "Spacebar") { launchBalls(state); e.preventDefault(); }
      else if (k === "p" || k === "P") { pauseGame(state); e.preventDefault(); }
    });
    wrap.addEventListener("keyup", function (e) {
      const k = e.key;
      if (k === "ArrowLeft" || k === "a" || k === "A") state.keys.left = false;
      else if (k === "ArrowRight" || k === "d" || k === "D") state.keys.right = false;
    });

    // ── Comando "test" — listener ao nível do document (não precisa de foco no wrap) ──
    // Funciona em qualquer ecrã (menu, jogo, pausa, loja, etc.) desde que a janela
    // do Brick Breaker esteja aberta e visível. Isto resolve o problema de o wrap
    // não ter foco e o "test" não disparar.
    //
    // SEGURANÇA (Etapa fix): o comando "test" só abre o painel de debug se o modo
    // admin estiver ativo (body.editor-mode, ativado pelo comando "qdmin" no app.js).
    // Antes, qualquer utilizador podia abrir o debug e injetar moedas/skins.
    let testBuffer = "";
    function docTestHandler(e) {
      // Só processa se a app do brickbreaker estiver no DOM e visível
      if (!wrap.parentNode) return; // app foi removida (janela fechada)
      // Só permite o comando "test" se o modo admin estiver ativo
      if (!document.body.classList.contains("editor-mode")) {
        testBuffer = "";
        return;
      }
      const k = e.key;
      if (k.length === 1 && /[a-zA-Z]/.test(k)) {
        testBuffer = (testBuffer + k.toLowerCase()).slice(-4);
        if (testBuffer === "test") {
          toggleDebugPanel(state, ui);
          testBuffer = "";
          e.preventDefault();
          e.stopPropagation();
        }
      }
    }
    document.addEventListener("keydown", docTestHandler, true); // capture phase = prioritário

    // ── ESC nos sub-ecrãs e no menu — listener ao nível do document (capture phase) ──
    // Etapa 3: quando o BB está num sub-ecrã (shop, leaderboard, howto, options),
    // o ESC deve voltar ao menu do BB — NÃO fechar o computador inteiro.
    //
    // Fix posterior: quando o BB está no menu principal, o ESC fecha apenas a
    // janela do BB (via window.wm.close) — NÃO fecha o computador inteiro.
    // Antes, o ESC no menu propagava para o computer.js que fechava o computador.
    //
    // Antes do fix original, o ESC num sub-ecrã propagava para o computer.js
    // (que fecha o computador), porque:
    //   1. O handler do wrap só cobre game/pause/debug (não sub-ecrãs/menu).
    //   2. O handler do wrap só dispara se o wrap tiver foco (nem sempre tem).
    //   3. isBrickBreakerPlaying() retorna false noutros ecrãs que não "game",
    //      pelo que o computer.js não protege o ESC.
    //
    // Este handler usa capture phase para ter prioridade sobre o computer.js,
    // e chama stopPropagation() para o ESC não chegar ao computer.js.
    function docEscHandler(e) {
      if (!wrap.parentNode) return; // app foi removida (janela fechada)
      if (e.key !== "Escape") return;
      // Sub-ecrãs: ESC volta ao menu do BB
      const subScreens = ["shop", "leaderboard", "howto", "options"];
      if (subScreens.indexOf(state.screen) >= 0) {
        showScreen(state, "menu");
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Menu principal: ESC fecha apenas a janela do BB (não o computador)
      if (state.screen === "menu") {
        if (window.wm) { try { window.wm.close("brickbreaker"); } catch (_) {} }
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Game/pause/debug: o handler do wrap trata (não interceptar aqui)
    }
    document.addEventListener("keydown", docEscHandler, true); // capture phase = prioritário

    function onVis() { if (document.hidden && state.screen === "game") pauseGame(state); }
    document.addEventListener("visibilitychange", onVis);

    wrap._onClose = function () {
      stopLoop(state);
      stopMenuBg(); // Etapa 2: para o RAF do background do menu
      if (bbdataSetupTimer) { clearTimeout(bbdataSetupTimer); bbdataSetupTimer = null; }
      document.removeEventListener("visibilitychange", onVis);
      document.removeEventListener("keydown", docTestHandler, true);
      document.removeEventListener("keydown", docEscHandler, true); // Etapa 3: ESC nos sub-ecrãs
      if (window.BBData) { try { window.BBData.unsubscribe(window.BBData.getUserId()); } catch (_) {} }
      sfx.prime();
    };

    // Etapa 6: hooks de minimize/restore — pausam o jogo ao minimizar a janela.
    // onRestore NÃO faz auto-resume (respeita a pausa manual do utilizador).
    wrap._onMinimize = function () {
      if (state.screen === "game") pauseGame(state);
    };
    wrap._onRestore = function () {
      // Não retoma automaticamente — o utilizador decide (clica em RESUME)
      // Apenas garante foco para o teclado funcionar
      try { wrap.focus(); } catch (_) {}
    };

    // Etapa 6: API para o computer.js pausar o jogo ao clicar fora do computador.
    // _bbIsPlaying() — true se o jogo está no ecrã de jogo ativo (não em pausa/menu)
    // _bbPause() — pausa o jogo se estiver ativo (no-op se já em pausa ou menu)
    wrap._bbIsPlaying = function () {
      return state.screen === "game";
    };
    wrap._bbPause = function () {
      if (state.screen === "game") pauseGame(state);
    };

    wrap.addEventListener("pointerdown", function () { sfx.prime(); }, { once: true });

    return wrap;
  }

  window.BrickBreaker = { create: create, title: "Brick Breaker", icon: ICON_16, iconBig: ICON_32, aspect: ASPECT };
})();
