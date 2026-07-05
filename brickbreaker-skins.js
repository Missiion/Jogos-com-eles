// ═══════════════════════════════════════════════════════════════
//  brickbreaker-skins.js — Catálogo de skins + render procedural
//  Jogos com Eles · Brick Breaker (Etapa 4)
//
//  4 categorias, 5 skins cada (20 total), tiers 1-5:
//    • Bricks:  Classic, Neon, Ice, Lava, Circuit
//    • Ball:    Classic, Fire, Ice, Plasma, Void
//    • Paddle:  Classic, Chrome, Wood, Neon, Royal
//    • BG:      Void, Starfield, Grid, Sunset, Matrix
//
//  Render 100% procedural (Canvas2D) — sem imagens externas.
//  Cada skin tem funções draw otimizadas para 60fps.
//
//  API: window.BBSkins
//    • CATALOG — { bricks: [...], ball: [...], paddle: [...], bg: [...] }
//    • TIER_PRICES — { 1: 0, 2: 30, 3: 80, 4: 200, 5: 500 }
//    • DEFAULT_OWNED / DEFAULT_EQUIPPED
//    • drawBrick(ctx, x, y, w, h, row, skinId)
//    • drawBall(ctx, x, y, r, skinId)
//    • drawPaddle(ctx, x, y, w, h, skinId, laserActive)
//    • drawBackground(ctx, w, h, skinId, t)
//    • renderPreview(canvas, category, skinId) — preview pequeno para a loja
// ═══════════════════════════════════════════════════════════════

(function () {
  "use strict";

  // ─────────────────────────────────────────────
  //  CATÁLOGO
  // ─────────────────────────────────────────────
  const CATALOG = {
    bricks: [
      { id: "brick-stone",   name: "Stone",         tier: 1, desc: "Carved rock" },
      { id: "brick-neon",    name: "Neon Glow",     tier: 2, desc: "Bright neon" },
      { id: "brick-ice",     name: "Frosted Ice",   tier: 3, desc: "Cold crystal" },
      { id: "brick-lava",    name: "Lava Rock",     tier: 4, desc: "Molten cracks" },
      { id: "brick-circuit", name: "Circuit Board", tier: 5, desc: "Green PCB" },
      { id: "brick-gold",    name: "Solid Gold",    tier: 6, desc: "Gilded with ruby" },
    ],
    ball: [
      { id: "ball-comet",    name: "Comet",      tier: 1, desc: "Icy trail" },
      { id: "ball-fire",     name: "Fireball",   tier: 2, desc: "Living flames" },
      { id: "ball-frost",    name: "Ice Sphere", tier: 3, desc: "Frozen crystal" },
      { id: "ball-plasma",   name: "Plasma Core",tier: 4, desc: "Purple energy" },
      { id: "ball-blackhole",name: "Black Hole", tier: 5, desc: "Event horizon" },
      { id: "ball-prism",    name: "Prism",      tier: 6, desc: "Refracting crystal" },
    ],
    paddle: [
      { id: "pad-iron",    name: "Iron Bar",  tier: 1, desc: "Forged iron" },
      { id: "pad-chrome",  name: "Chrome",    tier: 2, desc: "Polished metal" },
      { id: "pad-wood",    name: "Oak Wood",  tier: 3, desc: "Varnished timber" },
      { id: "pad-neon",    name: "Neon Edge", tier: 4, desc: "Glowing strip" },
      { id: "pad-royal",   name: "Royal Gold",tier: 5, desc: "Crowned with gems" },
      { id: "pad-circuit", name: "Circuit",   tier: 6, desc: "Tech platform" },
    ],
    bg: [
      { id: "bg-arcade",    name: "Arcade",       tier: 1, desc: "CRT scanlines" },
      { id: "bg-starfield", name: "Starfield",    tier: 2, desc: "Distant stars" },
      { id: "bg-aurora",    name: "Aurora",       tier: 3, desc: "Boreal lights" },
      { id: "bg-ocean",     name: "Deep Ocean",   tier: 4, desc: "Underwater abyss" },
      { id: "bg-matrix",    name: "Matrix Rain",  tier: 5, desc: "Digital rain" },
      { id: "bg-nebula",    name: "Nebula",       tier: 6, desc: "Cosmic clouds" },
    ],
  };

  // Preços por tier (em moedas). Tier 1 = mais barata (entrada); tier 6 = mythic.
  // Antes tier 1 era 0 (grátis) — agora é 10 para que todas as skins sejam
  // compradas (nenhuma é auto-owned), mas tier 1 continua acessível cedo.
  // Tier 6 (Etapa 4 fix): as segundas skins de cada categoria (antes duplicadas
  // como tier 5) passam a tier 6 — preço premium, cor distinta (coral/rosa).
  const TIER_PRICES = { 1: 10, 2: 30, 3: 80, 4: 200, 5: 500, 6: 1000 };
  const TIER_COLORS = { 1: "#888", 2: "#4dd964", 3: "#3fb8d4", 4: "#b06be0", 5: "#ffd23f", 6: "#ff5e7a" };

  // Defaults NÃO aparecem na loja — são skins internas usadas quando o
  // utilizador desequipa todas as skins compradas. São distintos dos tier-1
  // do catálogo (que são skins normais, compráveis como qualquer outra).
  //   • brick-default / ball-default / pad-default / bg-void: renderers
  //     internos de fallback (visuais clássicos simples).
  //   • Qualquer skin do catálogo (incluindo tier-1) tem de ser comprada.
  const DEFAULT_OWNED = [];  // nada é auto-owned — tudo se compra
  const DEFAULT_EQUIPPED = { bricks: "brick-default", ball: "ball-default", paddle: "pad-default", bg: "bg-void" };

  const ROW_COLORS = ["#ff4040", "#ff8c1a", "#ffd23f", "#4dd964", "#3fb8d4", "#5a78e8", "#b06be0"];

  // Helper: gradiente vertical
  function vgrad(ctx, x, y, w, h, c1, c2) {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, c1); g.addColorStop(1, c2);
    return g;
  }

  // ─────────────────────────────────────────────
  //  BRICKS — drawBrick(ctx, x, y, w, h, row, skinId)
  // ─────────────────────────────────────────────
  const brickRenderers = {
    // brick-default: NÃO aparece na loja — usado quando o utilizador desequipa.
    "brick-default": function (ctx, x, y, w, h, row) {
      const col = ROW_COLORS[row % ROW_COLORS.length];
      ctx.fillStyle = col;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillRect(x, y, w, 2);
      ctx.fillRect(x, y, 2, h);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(x, y + h - 2, w, 2);
      ctx.fillRect(x + w - 2, y, 2, h);
    },
    "brick-stone": function (ctx, x, y, w, h, row) {
      // Tijolo de pedra talhada — cinza com textura
      ctx.fillStyle = vgrad(ctx, x, y, w, h, "#707078", "#48484e");
      ctx.fillRect(x, y, w, h);
      // fissuras subtis
      ctx.strokeStyle = "rgba(40,40,45,0.4)";
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(x + w * 0.3, y); ctx.lineTo(x + w * 0.35, y + h);
      ctx.moveTo(x, y + h * 0.4); ctx.lineTo(x + w, y + h * 0.45);
      ctx.stroke();
      // highlight
      ctx.fillStyle = "rgba(160,160,170,0.4)";
      ctx.fillRect(x, y, w, 1.5);
      ctx.fillRect(x, y, 1.5, h);
      // sombra
      ctx.fillStyle = "rgba(20,20,25,0.5)";
      ctx.fillRect(x, y + h - 1.5, w, 1.5);
      ctx.fillRect(x + w - 1.5, y, 1.5, h);
    },
    "brick-neon": function (ctx, x, y, w, h, row) {
      const col = ROW_COLORS[row % ROW_COLORS.length];
      // glow
      ctx.shadowColor = col;
      ctx.shadowBlur = 10;
      ctx.fillStyle = col;
      ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
      ctx.shadowBlur = 0;
      // bright inner
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillRect(x + 2, y + 2, w - 4, 2);
      // dark core line
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(x, y + h - 3, w, 1);
    },
    "brick-ice": function (ctx, x, y, w, h, row) {
      // frosted blue-white
      ctx.fillStyle = vgrad(ctx, x, y, w, h, "#d4ecf7", "#8ec5db");
      ctx.fillRect(x, y, w, h);
      // crystal facets (diagonal lines)
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + w * 0.3, y); ctx.lineTo(x, y + h * 0.6);
      ctx.moveTo(x + w * 0.7, y); ctx.lineTo(x + w, y + h * 0.5);
      ctx.stroke();
      // edge highlight
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fillRect(x, y, w, 1.5);
      // shadow
      ctx.fillStyle = "rgba(40,80,120,0.4)";
      ctx.fillRect(x, y + h - 1.5, w, 1.5);
    },
    "brick-lava": function (ctx, x, y, w, h, row) {
      // dark rock base
      ctx.fillStyle = vgrad(ctx, x, y, w, h, "#3a1010", "#1a0505");
      ctx.fillRect(x, y, w, h);
      // molten cracks (glow orange)
      ctx.strokeStyle = "#ff6a1a";
      ctx.shadowColor = "#ff6a1a";
      ctx.shadowBlur = 6;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + w * 0.2, y); ctx.lineTo(x + w * 0.35, y + h * 0.5); ctx.lineTo(x + w * 0.15, y + h);
      ctx.moveTo(x + w * 0.6, y); ctx.lineTo(x + w * 0.75, y + h * 0.4); ctx.lineTo(x + w * 0.55, y + h);
      ctx.stroke();
      ctx.shadowBlur = 0;
      // ember dots
      ctx.fillStyle = "#ffaa33";
      ctx.fillRect(x + w * 0.45, y + h * 0.3, 1.5, 1.5);
      ctx.fillRect(x + w * 0.8, y + h * 0.7, 1.5, 1.5);
    },
    "brick-circuit": function (ctx, x, y, w, h, row) {
      // dark green PCB
      ctx.fillStyle = vgrad(ctx, x, y, w, h, "#0a3a18", "#062a12");
      ctx.fillRect(x, y, w, h);
      // traces (light green lines)
      ctx.strokeStyle = "#3fd96a";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x + 3, y + h * 0.3); ctx.lineTo(x + w * 0.4, y + h * 0.3);
      ctx.lineTo(x + w * 0.4, y + h * 0.7); ctx.lineTo(x + w - 3, y + h * 0.7);
      ctx.moveTo(x + w * 0.6, y + 2); ctx.lineTo(x + w * 0.6, y + h * 0.4);
      ctx.stroke();
      // solder pads (bright dots)
      ctx.fillStyle = "#7dfca0";
      ctx.fillRect(x + 2.5, y + h * 0.3 - 1, 2, 2);
      ctx.fillRect(x + w - 4, y + h * 0.7 - 1, 2, 2);
      ctx.fillRect(x + w * 0.6 - 1, y + 1, 2, 2);
      // edge
      ctx.fillStyle = "rgba(63,217,106,0.2)";
      ctx.fillRect(x, y, w, 1);
    },
    "brick-gold": function (ctx, x, y, w, h, row) {
      // Solid gold brick — rico e detalhado (Tier 5 premium)
      // Base: gradiente dourado com profundidade
      ctx.fillStyle = vgrad(ctx, x, y, w, h, "#fff0a0", "#c89010");
      ctx.fillRect(x, y, w, h);
      // Textura metálica: linhas horizontais subtis (simula ouro batido)
      ctx.fillStyle = "rgba(180,130,30,0.18)";
      for (let ly = y + 3; ly < y + h - 2; ly += 3) {
        ctx.fillRect(x + 1, ly, w - 2, 0.6);
      }
      // Highlight superior brilhante (reflexo de luz)
      ctx.fillStyle = "rgba(255,255,220,0.7)";
      ctx.fillRect(x, y, w, 2);
      ctx.fillRect(x, y, 2, h);
      // Sombra inferior
      ctx.fillStyle = "rgba(80,50,0,0.55)";
      ctx.fillRect(x, y + h - 2, w, 2);
      ctx.fillRect(x + w - 2, y, 2, h);
      // Gema central (rubi) com brilho
      const gx = x + w / 2, gy = y + h / 2, gr = Math.min(w, h) * 0.22;
      // halo da gema
      ctx.fillStyle = "rgba(255,80,120,0.25)";
      ctx.beginPath(); ctx.arc(gx, gy, gr + 2, 0, Math.PI * 2); ctx.fill();
      // gema
      const gg = ctx.createRadialGradient(gx - gr * 0.3, gy - gr * 0.3, 0, gx, gy, gr);
      gg.addColorStop(0, "#ffb0c8"); gg.addColorStop(0.5, "#e0204a"); gg.addColorStop(1, "#800010");
      ctx.fillStyle = gg;
      ctx.beginPath();
      ctx.moveTo(gx, gy - gr);
      ctx.lineTo(gx + gr, gy);
      ctx.lineTo(gx, gy + gr);
      ctx.lineTo(gx - gr, gy);
      ctx.closePath();
      ctx.fill();
      // brilho na gema
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.beginPath(); ctx.arc(gx - gr * 0.3, gy - gr * 0.3, gr * 0.25, 0, Math.PI * 2); ctx.fill();
    },
  };

  // ─────────────────────────────────────────────
  //  BALL — drawBall(ctx, x, y, r, skinId)
  // ─────────────────────────────────────────────
  const ballRenderers = {
    // ball-default: NÃO aparece na loja — usado quando o utilizador desequipa.
    "ball-default": function (ctx, x, y, r) {
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.4, 0, Math.PI * 2); ctx.fill();
    },
    // ball-comet: bola azul-escura com núcleo brilhante (cometa)
    "ball-comet": function (ctx, x, y, r) {
      // glow azul
      ctx.fillStyle = "rgba(100,180,255,0.2)";
      ctx.beginPath(); ctx.arc(x, y, r + 3, 0, Math.PI * 2); ctx.fill();
      // corpo azul-escuro
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "#c0e0ff"); g.addColorStop(0.4, "#4080c0"); g.addColorStop(1, "#102040");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      // núcleo brilhante
      ctx.fillStyle = "rgba(220,240,255,0.7)";
      ctx.beginPath(); ctx.arc(x - r * 0.2, y - r * 0.2, r * 0.35, 0, Math.PI * 2); ctx.fill();
    },
    "ball-fire": function (ctx, x, y, r, t) {
      // Fireball — bola de fogo com chamas (Tier 2)
      // Otimizado: reduzi draw calls (5→3 chamas), removi flicker/pulse
      // (Math.sin por frame é caro quando há várias bolas em jogo).
      // t opcional: se undefined (jogo), usa performance.now() (animado).
      // Se passado (preview da loja), usa esse valor (estático — evita "saltos"
      // de frame quando a loja re-renderiza ao equipar).
      if (t === undefined) t = performance.now() / 1000;
      // Glow exterior (static)
      ctx.fillStyle = "rgba(255,100,0,0.3)";
      ctx.beginPath(); ctx.arc(x, y, r + 3, 0, Math.PI * 2); ctx.fill();
      // Body — gradiente radial amarelo→laranja→vermelho
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
      g.addColorStop(0, "#fff8b0"); g.addColorStop(0.4, "#ff8c1a"); g.addColorStop(1, "#c03000");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      // 3 chamas que orbitam (simplificado de 5 para 3 — menos draw calls)
      ctx.fillStyle = "rgba(255,160,40,0.55)";
      for (let i = 0; i < 3; i++) {
        const ang = (i / 3) * Math.PI * 2 + t * 2;
        const fx = x + Math.cos(ang) * r * 0.85;
        const fy = y + Math.sin(ang) * r * 0.85;
        ctx.beginPath(); ctx.arc(fx, fy, r * 0.22, 0, Math.PI * 2); ctx.fill();
      }
      // Núcleo brilhante (static)
      ctx.fillStyle = "rgba(255,255,200,0.7)";
      ctx.beginPath(); ctx.arc(x - r * 0.2, y - r * 0.2, r * 0.25, 0, Math.PI * 2); ctx.fill();
    },
    "ball-frost": function (ctx, x, y, r) {
      ctx.fillStyle = "rgba(150,220,255,0.3)";
      ctx.beginPath(); ctx.arc(x, y, r + 2, 0, Math.PI * 2); ctx.fill();
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
      g.addColorStop(0, "#ffffff"); g.addColorStop(0.5, "#c4ecff"); g.addColorStop(1, "#6ab8e0");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      // facet line
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(x, y, r * 0.6, Math.PI * 0.2, Math.PI * 0.8); ctx.stroke();
    },
    "ball-plasma": function (ctx, x, y, r) {
      ctx.fillStyle = "rgba(176,107,224,0.35)";
      ctx.beginPath(); ctx.arc(x, y, r + 4, 0, Math.PI * 2); ctx.fill();
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "#f0c0ff"); g.addColorStop(0.4, "#b06be0"); g.addColorStop(1, "#4a1a70");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      // energy swirl
      ctx.strokeStyle = "rgba(255,200,255,0.5)";
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(x, y, r * 0.5, 0, Math.PI * 1.5); ctx.stroke();
    },
    "ball-blackhole": function (ctx, x, y, r) {
      // accretion ring
      ctx.strokeStyle = "rgba(180,80,220,0.6)";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, r + 4, 0, Math.PI * 2); ctx.stroke();
      // black hole body
      ctx.fillStyle = "#0a0010";
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      // event horizon glow
      ctx.strokeStyle = "rgba(200,100,255,0.8)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, r - 1, 0, Math.PI * 2); ctx.stroke();
    },
    "ball-prism": function (ctx, x, y, r, t) {
      // Prism — cristal facetado que refrata luz em arco-íris (Tier 6)
      // Otimizado: removi clip() (muito caro), reduzi facetas (6→3 triângulos),
      // reduzi brilho specular para 1 ponto estático. Mantém o visual de prisma
      // com shimmer arco-íris mas com metade das draw calls.
      // t opcional: se undefined (jogo), usa performance.now() (animado).
      // Se passado (preview da loja), usa esse valor (estático — evita "saltos"
      // de frame quando a loja re-renderiza ao equipar).
      if (t === undefined) t = performance.now() / 1000;
      const hue = (t * 60) % 360;
      // Halo arco-íris (static alpha)
      ctx.fillStyle = "hsla(" + hue + ",90%,60%,0.12)";
      ctx.beginPath(); ctx.arc(x, y, r + 4, 0, Math.PI * 2); ctx.fill();
      // Body — cristal translúcido
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
      g.addColorStop(0, "rgba(240,245,255,0.85)"); g.addColorStop(0.5, "rgba(180,200,230,0.6)"); g.addColorStop(1, "rgba(80,100,140,0.4)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      // 3 facetas coloridas (arcos pequenos dentro da bola — sem clip)
      for (let i = 0; i < 3; i++) {
        const fhue = (i * 120 + t * 80) % 360;
        const ang = (i / 3) * Math.PI * 2 + t * 0.3;
        const fx = x + Math.cos(ang) * r * 0.35;
        const fy = y + Math.sin(ang) * r * 0.35;
        ctx.fillStyle = "hsla(" + fhue + ",85%,60%,0.22)";
        ctx.beginPath(); ctx.arc(fx, fy, r * 0.35, 0, Math.PI * 2); ctx.fill();
      }
      // 3 linhas de faceta (diâmetros a 60° — dá look de prisma hexagonal)
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = 0.6;
      for (let i = 0; i < 3; i++) {
        const ang = (i / 3) * Math.PI + t * 0.4;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(ang) * r, y + Math.sin(ang) * r);
        ctx.lineTo(x + Math.cos(ang + Math.PI) * r, y + Math.sin(ang + Math.PI) * r);
        ctx.stroke();
      }
      // Brilho specular (static)
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.16, 0, Math.PI * 2); ctx.fill();
    },
  };

  // ─────────────────────────────────────────────
  //  PADDLE — drawPaddle(ctx, x, y, w, h, skinId, laserActive)
  // ─────────────────────────────────────────────
  const paddleRenderers = {
    // pad-default: NÃO aparece na loja — usado quando o utilizador desequipa.
    "pad-default": function (ctx, x, y, w, h, laserActive) {
      ctx.fillStyle = "#c8c8c8";
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x, y, w, 2);
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillRect(x, y + h - 2, w, 2);
      ctx.fillStyle = laserActive ? "#ff4040" : "#3fb8d4";
      ctx.fillRect(x + w / 2 - 10, y + 3, 20, h - 6);
    },
    // pad-iron: barra de ferro forjado — escuro com brilho metálico
    "pad-iron": function (ctx, x, y, w, h, laserActive) {
      ctx.fillStyle = vgrad(ctx, x, y, w, h, "#4a4a52", "#2a2a30");
      ctx.fillRect(x, y, w, h);
      // rebites (pontos metálicos)
      ctx.fillStyle = "#6a6a72";
      ctx.fillRect(x + 5, y + h / 2 - 1.5, 3, 3);
      ctx.fillRect(x + w - 8, y + h / 2 - 1.5, 3, 3);
      // highlight superior
      ctx.fillStyle = "rgba(120,120,130,0.5)";
      ctx.fillRect(x, y, w, 1.5);
      // sombra inferior
      ctx.fillStyle = "rgba(10,10,15,0.6)";
      ctx.fillRect(x, y + h - 1.5, w, 1.5);
      // center
      ctx.fillStyle = laserActive ? "#ff4040" : "#3a3a42";
      ctx.fillRect(x + w / 2 - 10, y + 3, 20, h - 6);
    },
    "pad-chrome": function (ctx, x, y, w, h, laserActive) {
      // Chrome — metal polido com reflexos dinâmicos (Tier 2)
      // Base: gradiente metálico com 3 bandas (highlight, mid, shadow)
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, "#e8e8f0");
      g.addColorStop(0.3, "#c0c0c8");
      g.addColorStop(0.5, "#f8f8fc");
      g.addColorStop(0.7, "#a0a0a8");
      g.addColorStop(1, "#707078");
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
      // Reflexo horizontal brilhante (banda fina no terço superior)
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.fillRect(x, y + Math.floor(h * 0.2), w, 1.5);
      // Linha de sombra no terço inferior
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(x, y + Math.floor(h * 0.75), w, 1);
      // Bordas (highlight esquerda/superior, sombra direita/inferior)
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillRect(x, y, 1.5, h);
      ctx.fillRect(x, y, w, 1.5);
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillRect(x + w - 1.5, y, 1.5, h);
      ctx.fillRect(x, y + h - 1.5, w, 1.5);
      // Center detail — insert metálico com brilho
      const cx = x + w / 2, cy = y + h / 2;
      const insCol = laserActive ? "#ff4040" : "#5a78e8";
      // halo do insert
      ctx.fillStyle = laserActive ? "rgba(255,64,64,0.3)" : "rgba(90,120,232,0.25)";
      ctx.beginPath(); ctx.ellipse(cx, cy, 12, h * 0.35, 0, 0, Math.PI * 2); ctx.fill();
      // insert
      ctx.fillStyle = insCol;
      ctx.beginPath(); ctx.ellipse(cx, cy, 9, h * 0.28, 0, 0, Math.PI * 2); ctx.fill();
      // brilho no insert
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.beginPath(); ctx.ellipse(cx - 2, cy - 1, 4, h * 0.12, 0, 0, Math.PI * 2); ctx.fill();
    },
    "pad-wood": function (ctx, x, y, w, h, laserActive) {
      ctx.fillStyle = vgrad(ctx, x, y, w, h, "#a0682a", "#6a3e15");
      ctx.fillRect(x, y, w, h);
      // wood grain lines
      ctx.strokeStyle = "rgba(60,30,10,0.4)";
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(x, y + h * 0.35); ctx.lineTo(x + w, y + h * 0.35);
      ctx.moveTo(x, y + h * 0.65); ctx.lineTo(x + w, y + h * 0.65);
      ctx.stroke();
      // highlight
      ctx.fillStyle = "rgba(255,220,160,0.3)";
      ctx.fillRect(x, y, w, 1.5);
      // center
      ctx.fillStyle = laserActive ? "#ff4040" : "#3fb8d4";
      ctx.fillRect(x + w / 2 - 10, y + 3, 20, h - 6);
    },
    "pad-neon": function (ctx, x, y, w, h, laserActive) {
      // dark base
      ctx.fillStyle = "#1a1a2a";
      ctx.fillRect(x, y, w, h);
      // neon edge glow
      const col = laserActive ? "#ff4040" : "#3fb8d4";
      ctx.shadowColor = col;
      ctx.shadowBlur = 8;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, w, 2);
      ctx.fillRect(x, y + h - 2, w, 2);
      ctx.fillRect(x, y, 2, h);
      ctx.fillRect(x + w - 2, y, 2, h);
      ctx.shadowBlur = 0;
      // center strip
      ctx.fillStyle = col;
      ctx.fillRect(x + w / 2 - 12, y + 3, 24, h - 6);
    },
    "pad-royal": function (ctx, x, y, w, h, laserActive) {
      // Royal Gold — plataforma real com coroa e gemas (Tier 5 premium)
      // Base: ouro rico com profundidade
      ctx.fillStyle = vgrad(ctx, x, y, w, h, "#ffe890", "#b8860b");
      ctx.fillRect(x, y, w, h);
      // Textura metálica (linhas subtis)
      ctx.fillStyle = "rgba(140,90,10,0.2)";
      for (let lx = x + 4; lx < x + w - 4; lx += 5) {
        ctx.fillRect(lx, y + 1, 0.6, h - 2);
      }
      // Highlight superior brilhante
      ctx.fillStyle = "rgba(255,250,200,0.6)";
      ctx.fillRect(x, y, w, 2);
      // Sombra inferior
      ctx.fillStyle = "rgba(80,50,0,0.5)";
      ctx.fillRect(x, y + h - 2, w, 2);
      // Bordas
      ctx.fillStyle = "rgba(255,240,160,0.5)";
      ctx.fillRect(x, y, 1.5, h);
      ctx.fillStyle = "rgba(80,50,0,0.4)";
      ctx.fillRect(x + w - 1.5, y, 1.5, h);
      // Coroa central (3 picos com gemas)
      const cx = x + w / 2, cy = y + h / 2;
      const crownCol = laserActive ? "#ff4040" : "#ffd23f";
      // base da coroa (retângulo)
      ctx.fillStyle = crownCol;
      ctx.fillRect(cx - 11, cy + 2, 22, 5);
      // 3 picos (triângulos)
      ctx.beginPath();
      ctx.moveTo(cx - 11, cy + 2); ctx.lineTo(cx - 8, cy - 6); ctx.lineTo(cx - 5, cy + 2);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - 3, cy + 2); ctx.lineTo(cx, cy - 9); ctx.lineTo(cx + 3, cy + 2);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + 5, cy + 2); ctx.lineTo(cx + 8, cy - 6); ctx.lineTo(cx + 11, cy + 2);
      ctx.closePath(); ctx.fill();
      // Gema central no pico do meio (rubi)
      ctx.fillStyle = laserActive ? "#ff8080" : "#e0204a";
      ctx.beginPath(); ctx.arc(cx, cy - 5, 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,200,220,0.7)";
      ctx.beginPath(); ctx.arc(cx - 0.5, cy - 5.5, 0.8, 0, Math.PI * 2); ctx.fill();
      // Gemas laterais (esmeralda e safira)
      const gemSide = laserActive ? "#ff8080" : "#4dd964";
      ctx.fillStyle = gemSide;
      ctx.beginPath(); ctx.arc(x + 6, cy, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = laserActive ? "#ff8080" : "#5a78e8";
      ctx.beginPath(); ctx.arc(x + w - 6, cy, 2.5, 0, Math.PI * 2); ctx.fill();
      // Brilhos nas gemas laterais
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.beginPath(); ctx.arc(x + 5.3, cy - 0.7, 0.8, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + w - 6.7, cy - 0.7, 0.8, 0, Math.PI * 2); ctx.fill();
    },
    "pad-circuit": function (ctx, x, y, w, h, laserActive) {
      // Plataforma tech com PCB verde e trilhos luminosos
      ctx.fillStyle = vgrad(ctx, x, y, w, h, "#0a3a18", "#062a12");
      ctx.fillRect(x, y, w, h);
      // trilhos de circuito (linhas verde brilhante)
      ctx.strokeStyle = laserActive ? "#ff4040" : "#3fd96a";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x + 3, y + h * 0.35); ctx.lineTo(x + w * 0.4, y + h * 0.35);
      ctx.lineTo(x + w * 0.4, y + h * 0.65); ctx.lineTo(x + w - 3, y + h * 0.65);
      ctx.moveTo(x + w * 0.6, y + 2); ctx.lineTo(x + w * 0.6, y + h - 2);
      ctx.stroke();
      // pads luminosos
      ctx.fillStyle = laserActive ? "#ff4040" : "#7dfca0";
      ctx.fillRect(x + 2, y + h * 0.35 - 1, 2, 2);
      ctx.fillRect(x + w - 4, y + h * 0.65 - 1, 2, 2);
      // borda superior brilhante
      ctx.fillStyle = laserActive ? "#ff6060" : "#3fd96a";
      ctx.fillRect(x, y, w, 1.5);
      ctx.shadowColor = laserActive ? "#ff4040" : "#3fd96a";
      ctx.shadowBlur = 6;
      ctx.fillRect(x, y, w, 1.5);
      ctx.shadowBlur = 0;
    },
  };

  // ─────────────────────────────────────────────
  //  BACKGROUND — drawBackground(ctx, w, h, skinId, t)
  //  t = tempo em segundos (para animações)
  // ─────────────────────────────────────────────
  const bgRenderers = {
    // bg-void: NÃO é uma skin — é o default usado quando não há skin equipada.
    // Mantém-se como fallback mas não aparece no catálogo da loja.
    "bg-void": function (ctx, w, h, t) {
      ctx.fillStyle = "#000010";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(80,120,200,0.06)";
      ctx.lineWidth = 1;
      for (let x = 0; x <= w; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = 0; y <= h; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    },
    "bg-arcade": function (ctx, w, h, t) {
      // CRT Arcade — fundo preto com scanlines subtis e glow verde/ciano
      ctx.fillStyle = "#000005";
      ctx.fillRect(0, 0, w, h);
      // Scanlines horizontais (efeito CRT)
      ctx.fillStyle = "rgba(0,255,200,0.03)";
      for (let y = 0; y < h; y += 2) {
        ctx.fillRect(0, y, w, 1);
      }
      // Glow canto superior esquerdo (como um CRT aceso)
      const glow = ctx.createRadialGradient(w * 0.3, h * 0.2, 0, w * 0.3, h * 0.2, w * 0.6);
      glow.addColorStop(0, "rgba(0,200,180,0.06)");
      glow.addColorStop(1, "rgba(0,200,180,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
      // Linha de scan brilhante que se move (efeito CRT refresh)
      const scanY = (t * 80) % (h + 40) - 20;
      const scanGrad = ctx.createLinearGradient(0, scanY - 10, 0, scanY + 10);
      scanGrad.addColorStop(0, "rgba(0,255,200,0)");
      scanGrad.addColorStop(0.5, "rgba(0,255,200,0.04)");
      scanGrad.addColorStop(1, "rgba(0,255,200,0)");
      ctx.fillStyle = scanGrad;
      ctx.fillRect(0, scanY - 10, w, 20);
    },
    "bg-starfield": function (ctx, w, h, t) {
      ctx.fillStyle = "#000005";
      ctx.fillRect(0, 0, w, h);
      // deterministic stars (hash of position)
      for (let i = 0; i < 80; i++) {
        const sx = ((i * 37) % w);
        const sy = ((i * 71) % h);
        const tw = 0.5 + 0.5 * Math.sin(t * 2 + i);
        ctx.fillStyle = "rgba(255,255,255," + (0.3 + tw * 0.5).toFixed(2) + ")";
        ctx.fillRect(sx, sy, 1.5, 1.5);
      }
      // a few brighter stars
      for (let i = 0; i < 12; i++) {
        const sx = ((i * 113) % w);
        const sy = ((i * 197) % h);
        ctx.fillStyle = "rgba(180,200,255," + (0.5 + 0.5 * Math.sin(t * 3 + i)).toFixed(2) + ")";
        ctx.fillRect(sx - 0.5, sy - 0.5, 2.5, 2.5);
      }
    },
    "bg-aurora": function (ctx, w, h, t) {
      // Aurora — ondas de luz a fluir (estilo aurora boreal retro)
      // Fundo: noite profunda azul-esverdeada
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "#020812"); g.addColorStop(0.6, "#04141c"); g.addColorStop(1, "#020a0e");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      // Estrelas fixas subtis (deterministic)
      for (let i = 0; i < 50; i++) {
        const sx = (i * 53) % w, sy = (i * 97) % (h * 0.5);
        const tw = 0.4 + 0.6 * Math.sin(t * 1.5 + i);
        ctx.fillStyle = "rgba(220,240,255," + (0.2 + tw * 0.3).toFixed(2) + ")";
        ctx.fillRect(sx, sy, 1, 1);
      }
      // 3 ondas de aurora (cores verde/ciano/roxo) com curvas senoidais animadas
      const waves = [
        { col1: "rgba(80,255,180,0.35)", col2: "rgba(80,255,180,0)", yBase: h * 0.22, amp: 22, freq: 0.018, sp: 0.6 },
        { col1: "rgba(100,200,255,0.30)", col2: "rgba(100,200,255,0)", yBase: h * 0.34, amp: 26, freq: 0.014, sp: 0.8 },
        { col1: "rgba(180,120,255,0.25)", col2: "rgba(180,120,255,0)", yBase: h * 0.46, amp: 20, freq: 0.022, sp: 0.5 },
      ];
      waves.forEach(function (wv, idx) {
        const grad = ctx.createLinearGradient(0, wv.yBase - 40, 0, wv.yBase + 50);
        grad.addColorStop(0, wv.col2);
        grad.addColorStop(0.5, wv.col1);
        grad.addColorStop(1, wv.col2);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let x = 0; x <= w; x += 6) {
          const y = wv.yBase + Math.sin(x * wv.freq + t * wv.sp + idx) * wv.amp
                          + Math.sin(x * wv.freq * 2.3 + t * wv.sp * 1.3) * (wv.amp * 0.4);
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();
      });
      // Reflexo subtil no fundo (aurora espelhada, muito ténue)
      ctx.globalAlpha = 0.15;
      waves.forEach(function (wv, idx) {
        const grad = ctx.createLinearGradient(0, h - wv.yBase - 40, 0, h - wv.yBase + 50);
        grad.addColorStop(0, wv.col2);
        grad.addColorStop(0.5, wv.col1);
        grad.addColorStop(1, wv.col2);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        for (let x = 0; x <= w; x += 6) {
          const y = (h - wv.yBase) - Math.sin(x * wv.freq + t * wv.sp + idx) * wv.amp;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, 0);
        ctx.closePath();
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    },
    "bg-ocean": function (ctx, w, h, t) {
      // Deep Ocean — abismo submarino com raios de luz e partículas
      // Fundo: gradiente azul profundo → escuro
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "#001830"); g.addColorStop(0.5, "#000a18"); g.addColorStop(1, "#000208");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      // Raios de luz a descer do topo (caustics)
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 5; i++) {
        const rayX = w * (0.15 + i * 0.18) + Math.sin(t * 0.3 + i) * 20;
        const rayW = 40 + Math.sin(t * 0.5 + i * 1.3) * 15;
        const ray = ctx.createLinearGradient(rayX, 0, rayX + rayW, h);
        ray.addColorStop(0, "rgba(60,140,200,0.06)");
        ray.addColorStop(0.5, "rgba(40,100,160,0.03)");
        ray.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = ray;
        ctx.beginPath();
        ctx.moveTo(rayX, 0); ctx.lineTo(rayX + rayW, 0);
        ctx.lineTo(rayX + rayW + 30, h); ctx.lineTo(rayX - 30, h);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
      // Partículas a flutuar (plâncton/bolhas)
      for (let i = 0; i < 30; i++) {
        const px = (i * 53 + Math.sin(t * 0.5 + i) * 15) % w;
        const py = (i * 97 + t * (10 + (i % 5) * 3)) % h;
        const ps = 1 + (i % 3);
        const a = 0.15 + 0.15 * Math.sin(t * 2 + i);
        ctx.fillStyle = "rgba(100,180,220," + a.toFixed(2) + ")";
        ctx.fillRect(px, py, ps, ps);
      }
      // Brilho subtil do fundo (bioluminescência)
      const bio = ctx.createRadialGradient(w * 0.5, h * 0.8, 0, w * 0.5, h * 0.8, w * 0.4);
      bio.addColorStop(0, "rgba(0,80,120,0.08)");
      bio.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = bio;
      ctx.fillRect(0, 0, w, h);
    },
    "bg-matrix": function (ctx, w, h, t) {
      ctx.fillStyle = "#000800";
      ctx.fillRect(0, 0, w, h);
      // falling green characters (deterministic, no state)
      const chars = "01ｱｲｳｴｵｶｷｸｹｺ01";
      const colW = 14;
      const cols = Math.floor(w / colW);
      const speed = 60;
      for (let c = 0; c < cols; c++) {
        const seed = c * 7919;
        const colSpeed = 40 + (seed % 30);
        const offset = ((t * colSpeed + seed) % (h + 100)) - 50;
        for (let r = 0; r < 14; r++) {
          const y = offset - r * 14;
          if (y < 0 || y > h) continue;
          const ch = chars.charAt((seed + r * 13) % chars.length);
          const alpha = r === 0 ? 1 : Math.max(0, 1 - r * 0.12);
          ctx.fillStyle = r === 0 ? "rgba(220,255,220," + alpha + ")" : "rgba(0,255,80," + alpha.toFixed(2) + ")";
          ctx.font = "14px 'VT323', 'Courier New', monospace";
          ctx.textAlign = "center";
          ctx.fillText(ch, c * colW + colW / 2, y);
        }
      }
    },
    "bg-nebula": function (ctx, w, h, t) {
      // Nebulosa cósmica — nuvens de gás vibrantes a rodar (DOMINANTE),
      // poucas estrelas brilhantes grandes (diferente da Starfield que tem
      // muitas estrelas pequenas e fundo simples).
      // Fundo: espaço profundo roxo-escuro
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, "#080014"); g.addColorStop(1, "#10001a");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      // 5 nuvens de gás grandes e vibrantes (mais que Starfield)
      const clouds = [
        { x: w * 0.25 + Math.sin(t * 0.08) * 35, y: h * 0.3 + Math.cos(t * 0.06) * 25, r: 140, col1: "rgba(180,40,220,0.25)", col2: "rgba(180,40,220,0)" },
        { x: w * 0.7 + Math.cos(t * 0.1) * 30, y: h * 0.45 + Math.sin(t * 0.08) * 35, r: 120, col1: "rgba(40,120,255,0.22)", col2: "rgba(40,120,255,0)" },
        { x: w * 0.45 + Math.sin(t * 0.12) * 45, y: h * 0.65 + Math.cos(t * 0.1) * 20, r: 110, col1: "rgba(255,60,140,0.18)", col2: "rgba(255,60,140,0)" },
        { x: w * 0.85 + Math.cos(t * 0.07) * 20, y: h * 0.2 + Math.sin(t * 0.11) * 30, r: 80, col1: "rgba(255,180,40,0.15)", col2: "rgba(255,180,40,0)" },
        { x: w * 0.15 + Math.sin(t * 0.09) * 25, y: h * 0.75 + Math.cos(t * 0.07) * 30, r: 90, col1: "rgba(40,255,180,0.12)", col2: "rgba(40,255,180,0)" },
      ];
      clouds.forEach(function (c) {
        const grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.r);
        grad.addColorStop(0, c.col1);
        grad.addColorStop(0.6, c.col1.replace(/[\d.]+\)$/, "0.08)"));
        grad.addColorStop(1, c.col2);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      });
      // Poucas estrelas brilhantes grandes (diferente da Starfield)
      for (let i = 0; i < 12; i++) {
        const sx = (i * 137 + 50) % w, sy = (i * 211 + 30) % h;
        const tw = 0.5 + 0.5 * Math.sin(t * 2.5 + i * 0.7);
        const a = 0.5 + tw * 0.5;
        // cruz de luz (star burst)
        ctx.fillStyle = "rgba(255,240,220," + a.toFixed(2) + ")";
        ctx.fillRect(sx - 2, sy, 5, 1);
        ctx.fillRect(sx, sy - 2, 1, 5);
        ctx.fillRect(sx, sy, 1, 1);
      }
    },
  };

  // ─────────────────────────────────────────────
  //  HELPERS
  // ─────────────────────────────────────────────
  function getSkin(category, id) {
    const list = CATALOG[category] || [];
    return list.find(function (s) { return s.id === id; }) || list[0];
  }

  function getCategory(category) {
    return CATALOG[category] || [];
  }

  function drawBrick(ctx, x, y, w, h, row, skinId) {
    // Fallback para "brick-default" (renderer interno) se o skinId for desconhecido.
    // Antes este fallback usava brickRenderers.classic (chave inexistente) → TypeError.
    const fn = brickRenderers[skinId] || brickRenderers["brick-default"];
    if (fn) fn(ctx, x, y, w, h, row);
  }
  function drawBall(ctx, x, y, r, skinId, t) {
    const fn = ballRenderers[skinId] || ballRenderers["ball-default"];
    // t é opcional: se for undefined, o renderer usa performance.now() (animado em jogo).
    // Se for passado (ex.: 0 no preview da loja), o renderer usa esse valor (estático).
    if (fn) fn(ctx, x, y, r, t);
  }
  function drawPaddle(ctx, x, y, w, h, skinId, laserActive) {
    const fn = paddleRenderers[skinId] || paddleRenderers["pad-default"];
    if (fn) fn(ctx, x, y, w, h, laserActive);
  }
  function drawBackground(ctx, w, h, skinId, t) {
    const fn = bgRenderers[skinId] || bgRenderers["bg-void"];
    if (fn) fn(ctx, w, h, t || 0);
  }

  // ─────────────────────────────────────────────
  //  PREVIEW — renderiza um canvas pequeno para a loja
  // ─────────────────────────────────────────────
  function renderPreview(canvas, category, skinId) {
    const ctx = canvas.getContext("2d");
    const pw = canvas.width, ph = canvas.height;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, pw, ph);

    if (category === "bricks") {
      // mostra 3 tijolos numa fila
      const bw = Math.floor(pw / 3) - 2, bh = Math.floor(ph * 0.5);
      const by = Math.floor((ph - bh) / 2);
      for (let i = 0; i < 3; i++) {
        drawBrick(ctx, i * (bw + 2) + 1, by, bw, bh, i, skinId);
      }
    } else if (category === "ball") {
      drawBackground(ctx, pw, ph, "bg-void", 0);
      // t = 0 (tempo fixo) para que as bolas animadas (fire, prism) renderizem
      // sempre na mesma posição no preview. Sem isto, cada re-render da loja
      // (ex.: ao equipar) mostrava a bola numa frame de animação diferente.
      drawBall(ctx, pw / 2, ph / 2, Math.min(pw, ph) * 0.28, skinId, 0);
    } else if (category === "paddle") {
      drawBackground(ctx, pw, ph, "bg-void", 0);
      const ph2 = Math.floor(ph * 0.25);
      drawPaddle(ctx, Math.floor(pw * 0.15), Math.floor(ph * 0.55), Math.floor(pw * 0.7), ph2, skinId, false);
    } else if (category === "bg") {
      drawBackground(ctx, pw, ph, skinId, 1.5);
    }
  }

  // ─────────────────────────────────────────────
  //  API pública
  // ─────────────────────────────────────────────
  window.BBSkins = {
    CATALOG: CATALOG,
    TIER_PRICES: TIER_PRICES,
    TIER_COLORS: TIER_COLORS,
    DEFAULT_OWNED: DEFAULT_OWNED,
    DEFAULT_EQUIPPED: DEFAULT_EQUIPPED,
    drawBrick: drawBrick,
    drawBall: drawBall,
    drawPaddle: drawPaddle,
    drawBackground: drawBackground,
    renderPreview: renderPreview,
    getSkin: getSkin,
    getCategory: getCategory,
  };
})();
