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
//    • drawPaddle(ctx, x, y, w, h, skinId, laserActive, hitTime)
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
      { id: "ball-comet",    name: "Tadpole Egg", tier: 1, desc: "Living egg" },
      { id: "ball-blackhole",name: "Black Hole", tier: 2, desc: "Event horizon" },
      { id: "ball-frost",    name: "Ice Sphere", tier: 3, desc: "Frozen crystal" },
      { id: "ball-plasma",   name: "Plasma Core",tier: 4, desc: "Purple energy" },
      { id: "ball-fire",     name: "Fireball",   tier: 5, desc: "Living flames" },
      { id: "ball-prism",    name: "Prism",      tier: 6, desc: "Refracting crystal" },
    ],
    paddle: [
      { id: "pad-iron",    name: "Stone Bar", tier: 1, desc: "Mossy stone" },
      { id: "pad-chrome",  name: "Chrome",    tier: 2, desc: "Polished metal" },
      { id: "pad-wood",    name: "Oak Wood",  tier: 3, desc: "Varnished timber" },
      { id: "pad-neon",    name: "Neon Edge", tier: 4, desc: "Glowing strip" },
      { id: "pad-royal",   name: "Royal Gold",tier: 5, desc: "Crowned with gems" },
      { id: "pad-circuit", name: "Circuit",   tier: 6, desc: "Tech platform" },
    ],
    bg: [
      { id: "bg-arcade",    name: "River Meadow",  tier: 1, desc: "Nature retreat" },
      { id: "bg-matrix",    name: "Matrix Rain",   tier: 2, desc: "Digital rain" },
      { id: "bg-ocean",     name: "Deep Ocean",    tier: 3, desc: "Underwater abyss" },
      { id: "bg-aurora",    name: "Aurora",        tier: 4, desc: "Boreal lights" },
      { id: "bg-crystal",   name: "Crystal Cave",  tier: 5, desc: "Living geode" },
      { id: "bg-nebula",    name: "Neon Metropolis", tier: 6, desc: "Cyberpunk city" },
    ],
  };

  // Preços por tier (em moedas). Tier 1 = mais barata (entrada); tier 6 = mythic.
  // Antes tier 1 era 0 (grátis) — agora é 10 para que todas as skins sejam
  // compradas (nenhuma é auto-owned), mas tier 1 continua acessível cedo.
  // Tier 6 (Etapa 4 fix): as segundas skins de cada categoria (antes duplicadas
  // como tier 5) passam a tier 6 — preço premium, cor distinta (coral/rosa).
  const TIER_PRICES = { 1: 20, 2: 60, 3: 80, 4: 200, 5: 500, 6: 1000 };
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

  // Helper: retorna a cor dominante de um tijolo para uma dada row/skin.
  // Usado para as partículas de explosão (cor das partículas = cor do bloco).
  // Para skins de uma só cor (stone, ice, lava, circuit, gold), retorna essa cor.
  // Para skins multi-cor (default, neon), retorna ROW_COLORS[row].
  function getBrickColor(row, skinId) {
    const r = row % ROW_COLORS.length;
    switch (skinId) {
      case "brick-default":
      case "brick-neon":
        return ROW_COLORS[r];
      case "brick-stone": return "#707078";
      case "brick-ice":   return "#b0dcf0";
      case "brick-lava":  return "#ff6a1a";
      case "brick-circuit": return "#3fd96a";
      case "brick-gold":  return "#ffd23f";
      default:            return ROW_COLORS[r];
    }
  }

  // Helper: gradiente vertical
  function vgrad(ctx, x, y, w, h, c1, c2) {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, c1); g.addColorStop(1, c2);
    return g;
  }

  // Helper: flor pequena de 4 pétalas com centro amarelo (usada em brick-stone e pad-iron)
  function drawTinyFlower(ctx, cx, cy, r, col) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(cx, cy - r, r * 0.7, 0, Math.PI * 2);
    ctx.arc(cx, cy + r, r * 0.7, 0, Math.PI * 2);
    ctx.arc(cx - r, cy, r * 0.7, 0, Math.PI * 2);
    ctx.arc(cx + r, cy, r * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffe040";
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2); ctx.fill();
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
      // Tijolo de pedra talhada — cinza com textura.
      // 7 padrões de NATUREZA completamente diferentes por row (row % 7):
      //   0 = pedra limpa (só fissuras)
      //   1 = patches de musgo
      //   2 = flores pequenas a crescer das fissuras
      //   3 = calhaus (mini-rocks) embebidos na pedra
      //   4 = inseto (beetle) a rastejar
      //   5 = musgo + flores combinados
      //   6 = fissuras com trepadeiras (vines)
      ctx.fillStyle = vgrad(ctx, x, y, w, h, "#707078", "#48484e");
      ctx.fillRect(x, y, w, h);
      const v = row % 7;
      // Offsets variados por row (base para vines e flores)
      const vx = [0.30, 0.50, 0.20, 0.70, 0.40, 0.60, 0.35][v];
      const vy = [0.40, 0.45, 0.55, 0.35, 0.50, 0.40, 0.60][v];
      const dx = [0.80, 0.20, 0.60, 0.30, 0.75, 0.15, 0.50][v];
      const dy = [0.70, 0.20, 0.80, 0.50, 0.30, 0.75, 0.15][v];
      // Fissuras básicas (em todos os padrões)
      ctx.strokeStyle = "rgba(40,40,45,0.4)";
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(x + w * vx, y); ctx.lineTo(x + w * (vx + 0.05), y + h);
      ctx.moveTo(x, y + h * vy); ctx.lineTo(x + w, y + h * (vy + 0.05));
      ctx.stroke();
      // ── Decorações por padrão (row % 7) ──
      switch (v) {
        case 0: // Pedra limpa — só fissuras + pequena marca (o "clean")
          ctx.fillStyle = "rgba(30,30,35,0.5)";
          ctx.fillRect(x + w * dx, y + h * dy, 1.5, 1.5);
          break;
        case 1: // Patches de musgo (tufos verde-escuro + highlight)
          ctx.fillStyle = "#3a6a30";
          ctx.beginPath(); ctx.arc(x + w * 0.20, y + h * 0.30, Math.max(2, w * 0.06), 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(x + w * 0.75, y + h * 0.70, Math.max(2, w * 0.07), 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "#5a8a40";
          ctx.beginPath(); ctx.arc(x + w * 0.20, y + h * 0.30, Math.max(1, w * 0.03), 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(x + w * 0.75, y + h * 0.70, Math.max(1, w * 0.035), 0, Math.PI * 2); ctx.fill();
          break;
        case 2: // Flores pequenas (4 pétalas) a crescer das fissuras
          drawTinyFlower(ctx, x + w * vx, y + h * 0.20, Math.max(1.5, w * 0.045), "#e84040");
          drawTinyFlower(ctx, x + w * 0.85, y + h * (vy + 0.05), Math.max(1.5, w * 0.045), "#ffd040");
          drawTinyFlower(ctx, x + w * 0.10, y + h * 0.85, Math.max(1.3, w * 0.040), "#ffffff");
          break;
        case 3: // Mini-rocks (calhaus) — pedras pequenas embebidas
          ctx.fillStyle = "#5a5a62";
          ctx.beginPath(); ctx.arc(x + w * 0.25, y + h * 0.65, 1.8, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(x + w * 0.70, y + h * 0.40, 1.5, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(x + w * 0.55, y + h * 0.80, 1.3, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(x + w * 0.40, y + h * 0.30, 1.2, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "rgba(180,180,190,0.5)";
          ctx.fillRect(x + w * 0.25 - 0.5, y + h * 0.65 - 0.5, 1, 1);
          ctx.fillRect(x + w * 0.70 - 0.5, y + h * 0.40 - 0.5, 1, 1);
          break;
        case 4: { // Inseto (beetle) — corpo oval escuro + patas
          const bs = Math.max(2, Math.min(w, h) * 0.10);
          const bx = x + w * 0.45, by = y + h * 0.55;
          ctx.fillStyle = "#1a0a20";
          ctx.beginPath(); ctx.ellipse(bx, by, bs, bs * 0.6, 0, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = "#3a1a30";
          ctx.lineWidth = 0.5;
          ctx.beginPath(); ctx.moveTo(bx, by - bs * 0.5); ctx.lineTo(bx, by + bs * 0.5); ctx.stroke();
          ctx.fillStyle = "#0a0510";
          ctx.beginPath(); ctx.arc(bx, by - bs * 0.7, bs * 0.35, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = "#0a0510";
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          for (let p = -1; p <= 1; p++) {
            ctx.moveTo(bx - bs * 0.8, by + p * bs * 0.3);
            ctx.lineTo(bx - bs * 1.3, by + p * bs * 0.5);
            ctx.moveTo(bx + bs * 0.8, by + p * bs * 0.3);
            ctx.lineTo(bx + bs * 1.3, by + p * bs * 0.5);
          }
          ctx.stroke();
          break;
        }
        case 5: // Musgo + flores combinados
          ctx.fillStyle = "#3a6a30";
          ctx.beginPath(); ctx.arc(x + w * 0.15, y + h * 0.75, Math.max(2, w * 0.05), 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(x + w * 0.80, y + h * 0.25, Math.max(2, w * 0.06), 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "#5a8a40";
          ctx.beginPath(); ctx.arc(x + w * 0.15, y + h * 0.75, Math.max(1, w * 0.025), 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(x + w * 0.80, y + h * 0.25, Math.max(1, w * 0.03), 0, Math.PI * 2); ctx.fill();
          drawTinyFlower(ctx, x + w * 0.45, y + h * 0.50, Math.max(1.5, w * 0.045), "#ffffff");
          drawTinyFlower(ctx, x + w * 0.65, y + h * 0.85, Math.max(1.3, w * 0.040), "#ffd040");
          break;
        case 6: // Fissuras com trepadeiras (vines verdes)
          ctx.strokeStyle = "#4a8a3a";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x + w * vx, y);
          ctx.lineTo(x + w * (vx + 0.05), y + h * 0.4);
          ctx.lineTo(x + w * vx, y + h * 0.6);
          ctx.lineTo(x + w * (vx + 0.05), y + h);
          ctx.moveTo(x, y + h * vy);
          ctx.lineTo(x + w * 0.3, y + h * (vy + 0.02));
          ctx.lineTo(x + w * 0.6, y + h * (vy - 0.02));
          ctx.lineTo(x + w, y + h * (vy + 0.05));
          ctx.stroke();
          ctx.fillStyle = "#5a9a4a";
          ctx.beginPath(); ctx.ellipse(x + w * (vx + 0.05), y + h * 0.4, 1.5, 1, 0.4, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.ellipse(x + w * 0.3, y + h * (vy + 0.02), 1.5, 1, -0.3, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.ellipse(x + w * 0.6, y + h * (vy - 0.02), 1.5, 1, 0.3, 0, Math.PI * 2); ctx.fill();
          break;
      }
      // Edge highlight + shadow (mantém o mesmo acabamento em todos os padrões)
      ctx.fillStyle = "rgba(160,160,170,0.4)";
      ctx.fillRect(x, y, w, 1.5);
      ctx.fillRect(x, y, 1.5, h);
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
      // Frosted Ice — gelo cristalino com 7 variações de facetas.
      // Cada row tem um padrão de facetas diferente: linhas diagonais, cruzes,
      // losangos, etc. Mantém a mesma cor base azul-branca.
      ctx.fillStyle = vgrad(ctx, x, y, w, h, "#d4ecf7", "#8ec5db");
      ctx.fillRect(x, y, w, h);
      const v = row % 7;
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      switch (v) {
        case 0: // X de facetas (duas diagonais)
          ctx.moveTo(x, y); ctx.lineTo(x + w, y + h);
          ctx.moveTo(x + w, y); ctx.lineTo(x, y + h);
          break;
        case 1: // Cruz (vertical + horizontal)
          ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h);
          ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w, y + h / 2);
          break;
        case 2: // V invertido (duas linhas do topo para o centro)
          ctx.moveTo(x, y); ctx.lineTo(x + w / 2, y + h / 2);
          ctx.moveTo(x + w, y); ctx.lineTo(x + w / 2, y + h / 2);
          break;
        case 3: // Triângulo (3 linhas do centro)
          ctx.moveTo(x + w / 2, y + h / 2); ctx.lineTo(x, y);
          ctx.moveTo(x + w / 2, y + h / 2); ctx.lineTo(x + w, y);
          ctx.moveTo(x + w / 2, y + h / 2); ctx.lineTo(x + w / 2, y + h);
          break;
        case 4: // Ziguezague
          ctx.moveTo(x, y); ctx.lineTo(x + w * 0.3, y + h * 0.5);
          ctx.lineTo(x + w * 0.7, y + h * 0.5); ctx.lineTo(x + w, y + h);
          break;
        case 5: // Losango (4 linhas do centro)
          ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h);
          ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w, y + h / 2);
          ctx.moveTo(x, y); ctx.lineTo(x + w, y + h);
          break;
        case 6: // Estrela (6 linhas do centro)
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            ctx.moveTo(x + w / 2, y + h / 2);
            ctx.lineTo(x + w / 2 + Math.cos(a) * w * 0.4, y + h / 2 + Math.sin(a) * h * 0.4);
          }
          break;
      }
      ctx.stroke();
      // Brilho specular (varia por row — simula reflexo de luz em ângulos diferentes)
      const sparkX = [0.30, 0.70, 0.50, 0.25, 0.75, 0.50, 0.40][v];
      const sparkY = [0.25, 0.35, 0.20, 0.50, 0.30, 0.25, 0.30][v];
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.beginPath(); ctx.arc(x + w * sparkX, y + h * sparkY, 1.5, 0, Math.PI * 2); ctx.fill();
      // Pequenos cristais nos cantos (varia por row)
      ctx.fillStyle = "rgba(200,230,255,0.5)";
      const cx = [0.85, 0.15, 0.80, 0.20, 0.90, 0.10, 0.85][v];
      const cy = [0.80, 0.75, 0.20, 0.85, 0.75, 0.80, 0.75][v];
      ctx.beginPath(); ctx.arc(x + w * cx, y + h * cy, 1, 0, Math.PI * 2); ctx.fill();
      // edge highlight
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fillRect(x, y, w, 1.5);
      ctx.fillRect(x, y, 1.5, h);
      // shadow
      ctx.fillStyle = "rgba(40,80,120,0.4)";
      ctx.fillRect(x, y + h - 1.5, w, 1.5);
      ctx.fillRect(x + w - 1.5, y, 1.5, h);
    },
    "brick-lava": function (ctx, x, y, w, h, row) {
      // Lava Rock — rocha vulcânica com fissuras de lava brilhante.
      // 7 variações de padrões de fissura: cada row tem um padrão completamente
      // diferente (linhas, curvas, ziguezagues, estrelas, etc.).
      ctx.fillStyle = vgrad(ctx, x, y, w, h, "#3a1010", "#1a0505");
      ctx.fillRect(x, y, w, h);
      // Textura de rocha: pontos escuros aleatórios (simula pedra porosa)
      const v = row % 7;
      ctx.fillStyle = "rgba(10,0,0,0.5)";
      const dots = [[0.15, 0.20], [0.80, 0.30], [0.30, 0.75], [0.70, 0.80], [0.50, 0.25]];
      dots.forEach(function (d) { ctx.fillRect(x + w * d[0], y + h * d[1], 1.5, 1.5); });
      // Fissuras de lava — 7 padrões completamente diferentes
      ctx.strokeStyle = "#ff6a1a";
      ctx.shadowColor = "#ff6a1a";
      ctx.shadowBlur = 6;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      switch (v) {
        case 0: // Fissura vertical sinuosa
          ctx.moveTo(x + w * 0.3, y); ctx.lineTo(x + w * 0.4, y + h * 0.3);
          ctx.lineTo(x + w * 0.25, y + h * 0.6); ctx.lineTo(x + w * 0.35, y + h);
          break;
        case 1: // Cruz de fissuras
          ctx.moveTo(x + w * 0.5, y); ctx.lineTo(x + w * 0.5, y + h);
          ctx.moveTo(x, y + h * 0.5); ctx.lineTo(x + w, y + h * 0.5);
          break;
        case 2: // Fissura em Z
          ctx.moveTo(x + w * 0.2, y); ctx.lineTo(x + w * 0.7, y + h * 0.3);
          ctx.lineTo(x + w * 0.3, y + h * 0.7); ctx.lineTo(x + w * 0.8, y + h);
          break;
        case 3: // Estrela (4 fissuras do centro)
          ctx.moveTo(x + w * 0.5, y + h * 0.5); ctx.lineTo(x, y);
          ctx.moveTo(x + w * 0.5, y + h * 0.5); ctx.lineTo(x + w, y);
          ctx.moveTo(x + w * 0.5, y + h * 0.5); ctx.lineTo(x, y + h);
          ctx.moveTo(x + w * 0.5, y + h * 0.5); ctx.lineTo(x + w, y + h);
          break;
        case 4: // Duas fissuras paralelas
          ctx.moveTo(x + w * 0.25, y); ctx.lineTo(x + w * 0.30, y + h);
          ctx.moveTo(x + w * 0.70, y); ctx.lineTo(x + w * 0.65, y + h);
          break;
        case 5: // Fissura circular (arco) — raio baseado na dimensão menor para não sair do bloco
          ctx.arc(x + w * 0.5, y + h * 0.5, Math.min(w, h) * 0.3, 0, Math.PI * 2);
          break;
        case 6: // Fissura em espiral (4 segmentos)
          ctx.moveTo(x + w * 0.5, y + h * 0.2);
          ctx.lineTo(x + w * 0.7, y + h * 0.4);
          ctx.lineTo(x + w * 0.5, y + h * 0.7);
          ctx.lineTo(x + w * 0.3, y + h * 0.5);
          ctx.lineTo(x + w * 0.5, y + h * 0.2);
          break;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      // Lava interior brilhante (preenche parte das fissuras com amarelo)
      ctx.strokeStyle = "rgba(255,220,80,0.6)";
      ctx.lineWidth = 0.7;
      ctx.stroke();
      // Ember dots (varia por row — brasa incandescente)
      ctx.fillStyle = "#ffaa33";
      const e1 = [[0.45, 0.30], [0.20, 0.70], [0.50, 0.50], [0.50, 0.50],
                  [0.50, 0.40], [0.50, 0.50], [0.60, 0.30]][v];
      const e2 = [[0.80, 0.70], [0.75, 0.25], [0.25, 0.25], [0.50, 0.50],
                  [0.50, 0.70], [0.50, 0.50], [0.30, 0.70]][v];
      ctx.fillRect(x + w * e1[0] - 0.5, y + h * e1[1] - 0.5, 2, 2);
      ctx.fillRect(x + w * e2[0] - 0.5, y + h * e2[1] - 0.5, 2, 2);
      // Borda de rocha (highlight + sombra)
      ctx.fillStyle = "rgba(60,20,10,0.6)";
      ctx.fillRect(x, y, w, 1.5);
      ctx.fillStyle = "rgba(10,0,0,0.7)";
      ctx.fillRect(x, y + h - 1.5, w, 1.5);
    },
    "brick-circuit": function (ctx, x, y, w, h, row) {
      // dark green PCB — 7 padrões de trilhos por row (mesma cor base)
      ctx.fillStyle = vgrad(ctx, x, y, w, h, "#0a3a18", "#062a12");
      ctx.fillRect(x, y, w, h);
      const v = row % 7;
      // 7 padrões de trilhos (varia a posição do bend e da linha vertical)
      const bx  = [0.40, 0.30, 0.50, 0.35, 0.45, 0.25, 0.55][v];
      const by1 = [0.30, 0.35, 0.25, 0.40, 0.30, 0.45, 0.20][v];
      const by2 = [0.70, 0.65, 0.75, 0.60, 0.70, 0.55, 0.80][v];
      const vx  = [0.60, 0.70, 0.50, 0.55, 0.65, 0.45, 0.75][v];
      // traces (light green lines)
      ctx.strokeStyle = "#3fd96a";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x + 3, y + h * by1); ctx.lineTo(x + w * bx, y + h * by1);
      ctx.lineTo(x + w * bx, y + h * by2); ctx.lineTo(x + w - 3, y + h * by2);
      ctx.moveTo(x + w * vx, y + 2); ctx.lineTo(x + w * vx, y + h - 2);
      ctx.stroke();
      // solder pads (bright dots) — posições variam com o trilho
      ctx.fillStyle = "#7dfca0";
      ctx.fillRect(x + 2.5, y + h * by1 - 1, 2, 2);
      ctx.fillRect(x + w - 4, y + h * by2 - 1, 2, 2);
      ctx.fillRect(x + w * vx - 1, y + 1, 2, 2);
      // edge
      ctx.fillStyle = "rgba(63,217,106,0.2)";
      ctx.fillRect(x, y, w, 1);
    },
    "brick-gold": function (ctx, x, y, w, h, row) {
      // Solid Gold — tijolo dourado com rubi SEMPRE no centro.
      // 7 variações: cada row tem um detalhe DIFERENTE (diamantes, pérolas,
      // esmeraldas, safiras, etc.) nos cantos, mas o rubi central é igual.
      const v = row % 7;
      // Base: gradiente dourado com profundidade
      ctx.fillStyle = vgrad(ctx, x, y, w, h, "#fff0a0", "#c89010");
      ctx.fillRect(x, y, w, h);
      // Textura metálica: linhas horizontais subtis
      ctx.fillStyle = "rgba(180,130,30,0.18)";
      for (let ly = y + 3; ly < y + h - 2; ly += 3) {
        ctx.fillRect(x + 1, ly, w - 2, 0.6);
      }
      // Highlight + sombra
      ctx.fillStyle = "rgba(255,255,220,0.7)";
      ctx.fillRect(x, y, w, 2); ctx.fillRect(x, y, 2, h);
      ctx.fillStyle = "rgba(80,50,0,0.55)";
      ctx.fillRect(x, y + h - 2, w, 2); ctx.fillRect(x + w - 2, y, 2, h);

      // ── Rubi central (SEMPRE igual em todas as variações) ──
      const gx = x + w / 2, gy = y + h / 2, gr = Math.min(w, h) * 0.20;
      ctx.fillStyle = "rgba(255,80,120,0.25)";
      ctx.beginPath(); ctx.arc(gx, gy, gr + 2, 0, Math.PI * 2); ctx.fill();
      const gg = ctx.createRadialGradient(gx - gr * 0.3, gy - gr * 0.3, 0, gx, gy, gr);
      gg.addColorStop(0, "#ffb0c8"); gg.addColorStop(0.5, "#e0204a"); gg.addColorStop(1, "#800010");
      ctx.fillStyle = gg;
      ctx.beginPath();
      ctx.moveTo(gx, gy - gr); ctx.lineTo(gx + gr, gy);
      ctx.lineTo(gx, gy + gr); ctx.lineTo(gx - gr, gy);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.beginPath(); ctx.arc(gx - gr * 0.3, gy - gr * 0.3, gr * 0.25, 0, Math.PI * 2); ctx.fill();

      // ── 7 variações de detalhes nos cantos ──
      const cr = Math.min(w, h) * 0.10; // raio dos detalhes nos cantos
      function drawGem(cx, cy, r, c1, c2, c3) {
        const dg = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 0, cx, cy, r);
        dg.addColorStop(0, c1); dg.addColorStop(0.5, c2); dg.addColorStop(1, c3);
        ctx.fillStyle = dg;
        ctx.beginPath();
        ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy);
        ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.beginPath(); ctx.arc(cx - r * 0.3, cy - r * 0.3, r * 0.25, 0, Math.PI * 2); ctx.fill();
      }
      function drawPearl(cx, cy, r) {
        const pg = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 0, cx, cy, r);
        pg.addColorStop(0, "#fff"); pg.addColorStop(0.6, "#e8e8f0"); pg.addColorStop(1, "#a0a0b0");
        ctx.fillStyle = pg;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      }
      switch (v) {
        case 0: // 2 diamantes (esmeralda + safira) nos cantos
          drawGem(x + w * 0.20, y + h * 0.30, cr, "#a0f0c0", "#40c080", "#106030");
          drawGem(x + w * 0.80, y + h * 0.70, cr, "#a0c0f0", "#4080c0", "#103060");
          break;
        case 1: // 2 pérolas nos cantos
          drawPearl(x + w * 0.20, y + h * 0.30, cr);
          drawPearl(x + w * 0.80, y + h * 0.70, cr);
          break;
        case 2: // 4 pérolas pequenas nos cantos
          drawPearl(x + w * 0.15, y + h * 0.25, cr * 0.7);
          drawPearl(x + w * 0.85, y + h * 0.25, cr * 0.7);
          drawPearl(x + w * 0.15, y + h * 0.75, cr * 0.7);
          drawPearl(x + w * 0.85, y + h * 0.75, cr * 0.7);
          break;
        case 3: // 2 diamantes amarelos (topázio)
          drawGem(x + w * 0.25, y + h * 0.25, cr, "#fff0a0", "#ffd040", "#806010");
          drawGem(x + w * 0.75, y + h * 0.75, cr, "#fff0a0", "#ffd040", "#806010");
          break;
        case 4: // 1 diamante roxo (ametista) + 1 pérola
          drawGem(x + w * 0.20, y + h * 0.30, cr, "#e0a0f0", "#a040c0", "#400060");
          drawPearl(x + w * 0.80, y + h * 0.70, cr);
          break;
        case 5: // 2 diamantes laranja + 2 pérolas
          drawGem(x + w * 0.15, y + h * 0.30, cr * 0.8, "#ffc080", "#ff8030", "#804010");
          drawGem(x + w * 0.85, y + h * 0.30, cr * 0.8, "#ffc080", "#ff8030", "#804010");
          drawPearl(x + w * 0.15, y + h * 0.75, cr * 0.7);
          drawPearl(x + w * 0.85, y + h * 0.75, cr * 0.7);
          break;
        case 6: // Coroa de 6 pérolas à volta do rubi
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            drawPearl(gx + Math.cos(a) * gr * 2.2, gy + Math.sin(a) * gr * 2.2, cr * 0.6);
          }
          break;
      }
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
    // ball-comet: ovo translúcido com girino dentro (substitui o antigo cometa)
    // Casca semi-transparente (oval, mais alto que largo), girino que se mexe com t.
    "ball-comet": function (ctx, x, y, r, t) {
      // t é opcional: undefined em jogo → usa performance.now() (animado);
      // passado como 0 no preview da loja → girino em posição default.
      if (t === undefined) t = performance.now() / 1000;
      const eggRX = r * 0.85, eggRY = r * 1.05;  // oval ligeiramente mais alto que largo
      // ── Halo subtil à volta do ovo ──
      ctx.fillStyle = "rgba(220,255,230,0.10)";
      ctx.beginPath(); ctx.ellipse(x, y, eggRX + 2, eggRY + 2, 0, 0, Math.PI * 2); ctx.fill();
      // ── Casca translúcida (gradiente pálido branco-verde iridescente) ──
      const shell = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, 0, x, y, eggRY);
      shell.addColorStop(0, "rgba(245,255,250,0.55)");
      shell.addColorStop(0.5, "rgba(200,240,220,0.40)");
      shell.addColorStop(1, "rgba(160,210,190,0.45)");
      ctx.fillStyle = shell;
      ctx.beginPath(); ctx.ellipse(x, y, eggRX, eggRY, 0, 0, Math.PI * 2); ctx.fill();
      // ── Girino dentro do ovo (clipped à casca para não sair) ──
      // Posição do girino: wobble subtil dentro do ovo usando t
      const wobble = Math.sin(t * 2) * r * 0.12;
      const headX = x + wobble;
      const headY = y + Math.cos(t * 1.5) * r * 0.10 - r * 0.15;
      const headR = r * 0.32;
      const tailBaseX = headX;
      const tailBaseY = headY + headR * 0.8;
      const tailEndX = headX + Math.sin(t * 6) * r * 0.15;
      const tailEndY = headY + r * 0.55;
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(x, y, eggRX * 0.92, eggRY * 0.92, 0, 0, Math.PI * 2);
      ctx.clip();
      // Cauda do girino (curva bezier com wiggle)
      ctx.strokeStyle = "#2a3038";
      ctx.lineWidth = Math.max(1, r * 0.10);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(tailBaseX, tailBaseY);
      const wiggle1 = Math.sin(t * 5) * r * 0.10;
      const wiggle2 = Math.sin(t * 5 + 1) * r * 0.12;
      ctx.bezierCurveTo(
        tailBaseX + wiggle1, tailBaseY + r * 0.18,
        tailEndX - wiggle2, tailEndY - r * 0.15,
        tailEndX, tailEndY
      );
      ctx.stroke();
      // Cabeça do girino (redonda, escura, com gradiente)
      const headGrad = ctx.createRadialGradient(
        headX - headR * 0.3, headY - headR * 0.3, 0,
        headX, headY, headR
      );
      headGrad.addColorStop(0, "#3a4048");
      headGrad.addColorStop(0.7, "#1a2028");
      headGrad.addColorStop(1, "#0a1018");
      ctx.fillStyle = headGrad;
      ctx.beginPath(); ctx.arc(headX, headY, headR, 0, Math.PI * 2); ctx.fill();
      // Olho do girino (ponto brilhante)
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath(); ctx.arc(headX + headR * 0.3, headY - headR * 0.2, headR * 0.15, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#000";
      ctx.beginPath(); ctx.arc(headX + headR * 0.35, headY - headR * 0.2, headR * 0.07, 0, Math.PI * 2); ctx.fill();
      ctx.restore();  // remove clip
      // ── Brilho specular na casca (mostra 3D) ──
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.beginPath();
      ctx.ellipse(x - r * 0.35, y - r * 0.45, r * 0.18, r * 0.10, -0.4, 0, Math.PI * 2);
      ctx.fill();
      // ── Contorno subtil do ovo ──
      ctx.strokeStyle = "rgba(200,230,220,0.45)";
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.ellipse(x, y, eggRX, eggRY, 0, 0, Math.PI * 2); ctx.stroke();
    },
    "ball-fire": function (ctx, x, y, r, t) {
      // Fireball — bola de fogo com chamas dinâmicas (Tier 5)
      // Melhorada: 5 chamas maiores com 2 camadas, glow flicker, núcleo pulsante.
      if (t === undefined) t = performance.now() / 1000;
      // Glow exterior (flicker)
      const flicker = 0.25 + 0.12 * Math.sin(t * 10);
      ctx.fillStyle = "rgba(255,80,0," + flicker.toFixed(2) + ")";
      ctx.beginPath(); ctx.arc(x, y, r + 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,140,20," + (flicker * 0.6).toFixed(2) + ")";
      ctx.beginPath(); ctx.arc(x, y, r + 3, 0, Math.PI * 2); ctx.fill();
      // Body — gradiente radial branco→amarelo→laranja→vermelho
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
      g.addColorStop(0, "#ffffe0"); g.addColorStop(0.3, "#ffd040"); g.addColorStop(0.6, "#ff8c1a"); g.addColorStop(1, "#c03000");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      // 5 chamas que orbitam (maiores, com 2 camadas: laranja + amarela)
      for (let i = 0; i < 5; i++) {
        const ang = (i / 5) * Math.PI * 2 + t * 3;
        const dist = r * (0.9 + 0.15 * Math.sin(t * 6 + i));
        const fx = x + Math.cos(ang) * dist;
        const fy = y + Math.sin(ang) * dist;
        const fsz = r * (0.25 + 0.1 * Math.sin(t * 8 + i * 1.5));
        ctx.fillStyle = "rgba(255,140,30,0.5)";
        ctx.beginPath(); ctx.arc(fx, fy, fsz, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(255,220,80,0.6)";
        ctx.beginPath(); ctx.arc(fx, fy, fsz * 0.6, 0, Math.PI * 2); ctx.fill();
      }
      // Núcleo brilhante pulsante
      const pulse = 0.6 + 0.3 * Math.sin(t * 5);
      ctx.fillStyle = "rgba(255,255,220," + pulse.toFixed(2) + ")";
      ctx.beginPath(); ctx.arc(x - r * 0.2, y - r * 0.2, r * 0.3, 0, Math.PI * 2); ctx.fill();
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
      // Prism — cristal prismático supremo (Tier 6, 1000 moedas).
      // A bola mais impressionante do jogo. Features:
      //   • Halo arco-íris pulsante com 3 camadas (expande e contrai)
      //   • 6 facetas hexagonais coloridas que rodam (cada uma com cor única do espectro)
      //   • 6 linhas de faceta brilhantes (contornos do prisma)
      //   • 2 brilhos speculars que orbitam (pontos de luz em lados opostos)
      //   • Núcleo branco brilhante pulsante (coração do prisma)
      //   • Trail de partículas arco-íris (sparkles que aparecem atrás da bola)
      //   • Borda exterior arco-íris que roda (ring de luz)
      if (t === undefined) t = performance.now() / 1000;

      // ── 1. Halo arco-íris pulsante (3 camadas, expande e contrai) ──
      const pulse = 0.5 + 0.5 * Math.sin(t * 4);
      for (let i = 0; i < 3; i++) {
        const hue = (t * 80 + i * 120) % 360;
        const layerR = r + 4 + i * 3 + pulse * 4;
        const alpha = (0.15 - i * 0.04) * (0.5 + pulse * 0.5);
        ctx.fillStyle = "hsla(" + hue + ",90%,60%," + alpha.toFixed(3) + ")";
        ctx.beginPath(); ctx.arc(x, y, layerR, 0, Math.PI * 2); ctx.fill();
      }

      // ── 2. Ring exterior arco-íris (roda à volta da bola) ──
      const ringHue = (t * 120) % 360;
      ctx.strokeStyle = "hsla(" + ringHue + ",100%,70%,0.5)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, r + 1.5, t * 2, t * 2 + Math.PI * 1.5);
      ctx.stroke();
      ctx.strokeStyle = "hsla(" + ((ringHue + 180) % 360) + ",100%,70%,0.3)";
      ctx.beginPath();
      ctx.arc(x, y, r + 1.5, t * 2 + Math.PI, t * 2 + Math.PI * 2.5);
      ctx.stroke();

      // ── 3. Body — cristal translúcido com profundidade ──
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
      g.addColorStop(0, "rgba(250,250,255,0.9)");
      g.addColorStop(0.4, "rgba(200,210,240,0.7)");
      g.addColorStop(0.8, "rgba(120,140,180,0.5)");
      g.addColorStop(1, "rgba(60,80,120,0.3)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();

      // ── 4. 6 facetas hexagonais coloridas (rodam) ──
      // Cada faceta é um triângulo do centro à borda, com cor única do espectro
      const rot = t * 0.8;
      for (let i = 0; i < 6; i++) {
        const fhue = (i * 60 + t * 60) % 360;
        const a1 = rot + (i / 6) * Math.PI * 2;
        const a2 = rot + ((i + 1) / 6) * Math.PI * 2;
        ctx.fillStyle = "hsla(" + fhue + ",85%,60%,0.20)";
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a1) * r, y + Math.sin(a1) * r);
        ctx.lineTo(x + Math.cos(a2) * r, y + Math.sin(a2) * r);
        ctx.closePath();
        ctx.fill();
      }

      // ── 5. 6 linhas de faceta brilhantes (contornos do prisma) ──
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 0.7;
      for (let i = 0; i < 6; i++) {
        const ang = rot + (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(ang) * r, y + Math.sin(ang) * r);
        ctx.stroke();
      }

      // ── 6. 2 brilhos speculars que orbitam (lados opostos) ──
      const sa = t * 1.8;
      const sx1 = x + Math.cos(sa) * r * 0.4;
      const sy1 = y + Math.sin(sa) * r * 0.4;
      const sx2 = x + Math.cos(sa + Math.PI) * r * 0.4;
      const sy2 = y + Math.sin(sa + Math.PI) * r * 0.4;
      // Brilho 1 — branco
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath(); ctx.arc(sx1, sy1, r * 0.18, 0, Math.PI * 2); ctx.fill();
      // Brilho 2 — arco-íris (cor muda com o tempo)
      const s2hue = (t * 100) % 360;
      ctx.fillStyle = "hsla(" + s2hue + ",100%,70%,0.8)";
      ctx.beginPath(); ctx.arc(sx2, sy2, r * 0.14, 0, Math.PI * 2); ctx.fill();

      // ── 7. Núcleo branco brilhante pulsante (coração do prisma) ──
      const corePulse = 0.5 + 0.5 * Math.sin(t * 6);
      ctx.fillStyle = "rgba(255,255,255," + (0.4 + corePulse * 0.4).toFixed(2) + ")";
      ctx.beginPath(); ctx.arc(x, y, r * 0.2 + corePulse * r * 0.08, 0, Math.PI * 2); ctx.fill();
      // Flash arco-íris no núcleo
      const coreHue = (t * 200) % 360;
      ctx.fillStyle = "hsla(" + coreHue + ",100%,70%," + (corePulse * 0.3).toFixed(2) + ")";
      ctx.beginPath(); ctx.arc(x, y, r * 0.12, 0, Math.PI * 2); ctx.fill();
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
    // pad-iron (agora STONE): plataforma de pedra com musgo e flores (redesenhado)
    // Mesma cor base que brick-stone. Center strip é pedra mais escura (não cyan/vermelho).
    // hitTime (recente) → glow subtil de pedra (não flash neon).
    "pad-iron": function (ctx, x, y, w, h, laserActive, hitTime) {
      const now = Date.now();
      const hitAge = hitTime ? (now - hitTime) : 9999;
      const hit = hitAge < 300 ? (1 - hitAge / 300) : 0;  // 1=just hit, 0=no hit
      // Base: gradiente de pedra (igual ao brick-stone)
      ctx.fillStyle = vgrad(ctx, x, y, w, h, "#707078", "#48484e");
      ctx.fillRect(x, y, w, h);
      // Textura de pedra: fissuras/cracks
      ctx.strokeStyle = "rgba(40,40,45,0.4)";
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(x + w * 0.20, y); ctx.lineTo(x + w * 0.25, y + h);
      ctx.moveTo(x, y + h * 0.45); ctx.lineTo(x + w * 0.45, y + h * 0.48);
      ctx.moveTo(x + w * 0.75, y); ctx.lineTo(x + w * 0.72, y + h);
      ctx.moveTo(x + w * 0.55, y + h * 0.50); ctx.lineTo(x + w, y + h * 0.46);
      ctx.stroke();
      // Patches de musgo (tufos verde)
      ctx.fillStyle = "#3a6a30";
      ctx.beginPath(); ctx.arc(x + w * 0.12, y + h * 0.30, Math.max(1.5, h * 0.10), 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + w * 0.88, y + h * 0.70, Math.max(1.5, h * 0.12), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#5a8a40";
      ctx.beginPath(); ctx.arc(x + w * 0.12, y + h * 0.30, Math.max(0.8, h * 0.05), 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + w * 0.88, y + h * 0.70, Math.max(0.8, h * 0.06), 0, Math.PI * 2); ctx.fill();
      // 1-2 flores pequenas (vermelho + amarelo)
      drawTinyFlower(ctx, x + w * 0.30, y + h * 0.75, Math.max(1.2, h * 0.08), "#e84040");
      drawTinyFlower(ctx, x + w * 0.70, y + h * 0.25, Math.max(1.2, h * 0.08), "#ffd040");
      // Highlight + shadow edges (igual a brick-stone)
      ctx.fillStyle = "rgba(160,160,170,0.4)";
      ctx.fillRect(x, y, w, 1.5);
      ctx.fillRect(x, y, 1.5, h);
      ctx.fillStyle = "rgba(20,20,25,0.5)";
      ctx.fillRect(x, y + h - 1.5, w, 1.5);
      ctx.fillRect(x + w - 1.5, y, 1.5, h);
      // Center strip — pedra mais escura (não cyan/vermelho como ferro antigo)
      const centerCol = laserActive ? "#ff4040" : "#5a5a62";
      ctx.fillStyle = centerCol;
      ctx.fillRect(x + w / 2 - 10, y + 3, 20, h - 6);
      // Hit glow (subtle stone glow — não flash neon)
      if (hit > 0) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = "rgba(200,180,140," + (hit * 0.35).toFixed(2) + ")";
        ctx.fillRect(x, y, w, h);
        ctx.restore();
      }
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
    "pad-royal": function (ctx, x, y, w, h, laserActive, hitTime) {
      // Royal Gold — plataforma real com coroa e gemas (Tier 5 premium)
      // Hit animation (300ms decay): gems flash/pulse when ball hits paddle.
      const now = Date.now();
      const hitAge = hitTime ? (now - hitTime) : 9999;
      const hit = hitAge < 300 ? (1 - hitAge / 300) : 0;  // 1=just hit, 0=no hit
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
      // ── Hit animation (300ms): gems flash/pulse with halos ──
      if (hit > 0) {
        const pulse = 0.5 + 0.5 * Math.sin(now / 30);  // 0..1 fast flicker
        const haloA = hit * (0.45 + 0.30 * pulse);
        ctx.save();
        ctx.globalCompositeOperation = "lighter";  // additive glow
        // Central ruby halo
        ctx.fillStyle = "rgba(255,150,180," + haloA.toFixed(2) + ")";
        ctx.beginPath(); ctx.arc(cx, cy - 5, 4 + hit * 3, 0, Math.PI * 2); ctx.fill();
        // Left emerald halo
        ctx.fillStyle = "rgba(140,255,170," + haloA.toFixed(2) + ")";
        ctx.beginPath(); ctx.arc(x + 6, cy, 3.5 + hit * 3, 0, Math.PI * 2); ctx.fill();
        // Right sapphire halo
        ctx.fillStyle = "rgba(140,180,255," + haloA.toFixed(2) + ")";
        ctx.beginPath(); ctx.arc(x + w - 6, cy, 3.5 + hit * 3, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    },
    "pad-circuit": function (ctx, x, y, w, h, laserActive, hitTime) {
      // Plataforma tech com PCB verde e trilhos luminosos
      // Hit animation (300ms decay): traces light up brightly when ball hits paddle.
      const now = Date.now();
      const hitAge = hitTime ? (now - hitTime) : 9999;
      const hit = hitAge < 300 ? (1 - hitAge / 300) : 0;  // 1=just hit, 0=no hit
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
      // ── Hit animation (300ms): traces light up brightly ──
      if (hit > 0) {
        ctx.save();
        ctx.shadowColor = "#a0ffd0";
        ctx.shadowBlur = 10 * hit;
        // Bright white-cyan overlay on the traces
        ctx.strokeStyle = "rgba(220,255,240," + hit.toFixed(2) + ")";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x + 3, y + h * 0.35); ctx.lineTo(x + w * 0.4, y + h * 0.35);
        ctx.lineTo(x + w * 0.4, y + h * 0.65); ctx.lineTo(x + w - 3, y + h * 0.65);
        ctx.moveTo(x + w * 0.6, y + 2); ctx.lineTo(x + w * 0.6, y + h - 2);
        ctx.stroke();
        // Flash pads (white burst)
        ctx.fillStyle = "rgba(255,255,255," + (hit * 0.9).toFixed(2) + ")";
        ctx.fillRect(x + 2, y + h * 0.35 - 1, 2, 2);
        ctx.fillRect(x + w - 4, y + h * 0.65 - 1, 2, 2);
        // Top edge bright flash
        ctx.fillStyle = "rgba(220,255,240," + (hit * 0.7).toFixed(2) + ")";
        ctx.fillRect(x, y, w, 1.5);
        ctx.restore();
      }
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
      // River Meadow — cena da natureza animada (substitui o antigo bg-arcade CRT).
      // Céu azul claro + sol pulsante + nuvens a derivar + colinas verdes +
      // rio com ondulações/cintilações + relva com flores + casa de pedra +
      // rochas junto ao rio + patches de musgo. Performance ~30 draw calls.
      const horizonY = h * 0.58;
      const riverTop = h * 0.62;
      const riverH = h * 0.12;
      const riverBot = riverTop + riverH;
      const grassTop = riverBot;
      // ── Céu (gradiente azul claro) ──
      const sky = ctx.createLinearGradient(0, 0, 0, horizonY);
      sky.addColorStop(0, "#87CEEB");
      sky.addColorStop(1, "#B0E0E6");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, horizonY);
      // ── Sol (canto superior direito, pulsante) ──
      const sunX = w * 0.85, sunY = h * 0.15, sunR = Math.max(14, h * 0.06);
      const sunPulse = 0.85 + 0.15 * Math.sin(t * 1.5);
      const halo = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR * 3);
      halo.addColorStop(0, "rgba(255,240,150," + (0.35 * sunPulse).toFixed(2) + ")");
      halo.addColorStop(0.4, "rgba(255,220,120," + (0.15 * sunPulse).toFixed(2) + ")");
      halo.addColorStop(1, "rgba(255,220,120,0)");
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(sunX, sunY, sunR * 3, 0, Math.PI * 2); ctx.fill();
      const sun = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR);
      sun.addColorStop(0, "#fff8c0"); sun.addColorStop(0.6, "#ffe070"); sun.addColorStop(1, "#ffc030");
      ctx.fillStyle = sun;
      ctx.beginPath(); ctx.arc(sunX, sunY, sunR * sunPulse, 0, Math.PI * 2); ctx.fill();
      // ── Nuvens brancas a derivar (4, tamanhos/velocidades diferentes) ──
      function drawCloud(cx, cy, scale) {
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.beginPath();
        ctx.arc(cx, cy, 12 * scale, 0, Math.PI * 2);
        ctx.arc(cx + 14 * scale, cy + 2 * scale, 15 * scale, 0, Math.PI * 2);
        ctx.arc(cx + 28 * scale, cy, 11 * scale, 0, Math.PI * 2);
        ctx.arc(cx + 14 * scale, cy - 6 * scale, 10 * scale, 0, Math.PI * 2);
        ctx.fill();
      }
      const cloudData = [
        { y: h * 0.12, sp: 6, sc: 1.0, off: 0 },
        { y: h * 0.22, sp: 4, sc: 0.75, off: 200 },
        { y: h * 0.30, sp: 8, sc: 1.15, off: 400 },
        { y: h * 0.16, sp: 5, sc: 0.6, off: 600 },
      ];
      cloudData.forEach(function (c) {
        const cx = ((t * c.sp + c.off) % (w + 160)) - 80;
        drawCloud(cx, c.y, c.sc);
      });
      // ── Colinas verde-escuras (silhuetas onduladas, 2 camadas) ──
      ctx.fillStyle = "#3a6a3a";
      ctx.beginPath();
      ctx.moveTo(0, horizonY);
      for (let hx = 0; hx <= w; hx += 8) {
        const yy = horizonY - Math.sin(hx * 0.012) * 14 - Math.sin(hx * 0.025) * 8;
        ctx.lineTo(hx, yy);
      }
      ctx.lineTo(w, horizonY + 4); ctx.lineTo(0, horizonY + 4);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#4a8a4a";
      ctx.beginPath();
      ctx.moveTo(0, horizonY);
      for (let hx = 0; hx <= w; hx += 8) {
        const yy = horizonY - Math.sin(hx * 0.018 + 1.2) * 10 - Math.sin(hx * 0.035 + 0.5) * 6;
        ctx.lineTo(hx, yy);
      }
      ctx.lineTo(w, horizonY + 4); ctx.lineTo(0, horizonY + 4);
      ctx.closePath(); ctx.fill();
      // ── Rio (banda horizontal com ondulações + cintilações) ──
      const river = ctx.createLinearGradient(0, riverTop, 0, riverBot);
      river.addColorStop(0, "#3a8ac8");
      river.addColorStop(0.5, "#2a6aa8");
      river.addColorStop(1, "#1a5088");
      ctx.fillStyle = river;
      ctx.fillRect(0, riverTop, w, riverH);
      ctx.strokeStyle = "rgba(220,240,255,0.35)";
      ctx.lineWidth = 1;
      for (let row = 0; row < 4; row++) {
        const wy = riverTop + 3 + row * (riverH / 5);
        ctx.beginPath();
        for (let rx = 0; rx <= w; rx += 4) {
          const yy = wy + Math.sin(rx * 0.04 + t * 1.5 + row) * 1.5;
          if (rx === 0) ctx.moveTo(rx, yy); else ctx.lineTo(rx, yy);
        }
        ctx.stroke();
      }
      // Cintilações (pontos brilhantes que piscam)
      for (let i = 0; i < 18; i++) {
        const sx = (i * 67 + Math.sin(t + i) * 10) % w;
        const sy = riverTop + (i * 37) % riverH;
        const sp = 0.5 + 0.5 * Math.sin(t * 4 + i * 1.7);
        if (sp > 0.55) {
          ctx.fillStyle = "rgba(255,255,255," + (sp * 0.6).toFixed(2) + ")";
          ctx.fillRect(sx, sy, 1.5, 1);
        }
      }
      // ── Relva (verde, com flores pequenas) ──
      const grass = ctx.createLinearGradient(0, grassTop, 0, h);
      grass.addColorStop(0, "#4d9a3a");
      grass.addColorStop(1, "#2f6a25");
      ctx.fillStyle = grass;
      ctx.fillRect(0, grassTop, w, h - grassTop);
      // Textura de relva (linha senoidal subtil no topo)
      ctx.fillStyle = "#5aaa45";
      for (let gx = 0; gx < w; gx += 3) {
        const yy = grassTop + Math.sin(gx * 0.2 + t * 0.5) * 0.6;
        ctx.fillRect(gx, yy, 2, 1);
      }
      // Flores (4 cores, balançam ligeiramente)
      const flowerColors = ["#e84040", "#ffd040", "#ffffff", "#a060c0"];
      for (let i = 0; i < 24; i++) {
        const fx = (i * 73 + 13) % w;
        const fy = grassTop + 6 + ((i * 29) % Math.max(1, h - grassTop - 8));
        const sway = Math.sin(t * 1.2 + i) * 1.2;
        const col = flowerColors[i % flowerColors.length];
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(fx + sway, fy - 1, 1.4, 0, Math.PI * 2);
        ctx.arc(fx + sway + 1.5, fy, 1.4, 0, Math.PI * 2);
        ctx.arc(fx + sway - 1.5, fy, 1.4, 0, Math.PI * 2);
        ctx.arc(fx + sway, fy + 1, 1.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffe040";
        ctx.fillRect(fx + sway - 0.5, fy - 0.5, 1, 1);
      }
      // ── Casa de pedra (lado direito da relva) ──
      const houseW = Math.max(40, w * 0.13), houseH = Math.max(34, h * 0.16);
      const houseX = w * 0.70 - houseW / 2;
      const houseY = grassTop + (h - grassTop) * 0.45 - houseH / 2;
      // Telhado (castanho, triângulo)
      ctx.fillStyle = "#6a3818";
      ctx.beginPath();
      ctx.moveTo(houseX - 4, houseY + houseH * 0.45);
      ctx.lineTo(houseX + houseW / 2, houseY - 2);
      ctx.lineTo(houseX + houseW + 4, houseY + houseH * 0.45);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(255,200,150,0.3)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(houseX - 4, houseY + houseH * 0.45);
      ctx.lineTo(houseX + houseW / 2, houseY - 2);
      ctx.stroke();
      // Paredes de pedra (cinzento)
      ctx.fillStyle = "#7a7a82";
      ctx.fillRect(houseX, houseY + houseH * 0.45, houseW, houseH * 0.55);
      // Textura de pedra (linhas subtis)
      ctx.strokeStyle = "rgba(40,40,45,0.4)";
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(houseX, houseY + houseH * 0.65); ctx.lineTo(houseX + houseW, houseY + houseH * 0.65);
      ctx.moveTo(houseX + houseW * 0.5, houseY + houseH * 0.45); ctx.lineTo(houseX + houseW * 0.5, houseY + houseH * 0.65);
      ctx.moveTo(houseX + houseW * 0.25, houseY + houseH * 0.65); ctx.lineTo(houseX + houseW * 0.25, houseY + houseH);
      ctx.moveTo(houseX + houseW * 0.75, houseY + houseH * 0.65); ctx.lineTo(houseX + houseW * 0.75, houseY + houseH);
      ctx.stroke();
      // Janela com luz quente (pisca ligeiramente)
      const winPulse = 0.7 + 0.3 * Math.sin(t * 2.5);
      ctx.fillStyle = "rgba(255,200,80," + winPulse.toFixed(2) + ")";
      ctx.fillRect(houseX + houseW * 0.35, houseY + houseH * 0.55, houseW * 0.3, houseH * 0.18);
      ctx.strokeStyle = "#3a2810";
      ctx.lineWidth = 1;
      ctx.strokeRect(houseX + houseW * 0.35, houseY + houseH * 0.55, houseW * 0.3, houseH * 0.18);
      ctx.beginPath();
      ctx.moveTo(houseX + houseW * 0.5, houseY + houseH * 0.55); ctx.lineTo(houseX + houseW * 0.5, houseY + houseH * 0.73);
      ctx.moveTo(houseX + houseW * 0.35, houseY + houseH * 0.64); ctx.lineTo(houseX + houseW * 0.65, houseY + houseH * 0.64);
      ctx.stroke();
      // ── Rochas junto ao rio (margem esquerda + direita) ──
      function drawRock(rx, ry, rs) {
        ctx.fillStyle = "#6a6a72";
        ctx.beginPath(); ctx.ellipse(rx, ry, rs, rs * 0.7, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(160,160,170,0.5)";
        ctx.beginPath(); ctx.ellipse(rx - rs * 0.3, ry - rs * 0.3, rs * 0.4, rs * 0.2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(20,20,25,0.4)";
        ctx.beginPath(); ctx.ellipse(rx, ry + rs * 0.4, rs * 0.8, rs * 0.15, 0, 0, Math.PI * 2); ctx.fill();
      }
      drawRock(w * 0.08, riverBot - 2, Math.max(6, w * 0.018));
      drawRock(w * 0.16, riverBot + 1, Math.max(4, w * 0.012));
      drawRock(w * 0.24, riverBot - 1, Math.max(5, w * 0.015));
      drawRock(w * 0.50, riverBot + 1, Math.max(6, w * 0.016));
      drawRock(w * 0.58, riverBot - 1, Math.max(4, w * 0.012));
      // ── Patches de musgo (verde-escuros nas rochas) ──
      ctx.fillStyle = "rgba(40,90,30,0.7)";
      ctx.beginPath(); ctx.ellipse(w * 0.08, riverBot - 4, Math.max(5, w * 0.014), 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(w * 0.24, riverBot - 4, Math.max(4, w * 0.010), 2.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(w * 0.50, riverBot - 3, Math.max(5, w * 0.012), 2.5, 0, 0, Math.PI * 2); ctx.fill();
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
      // Neon Metropolis — cidade cyberpunk à noite (Tier 6).
      // Retoques v2: estrada + carros, janelas até 90%, estrelas, lua crescente.

      const horizonY = h * 0.62;  // horizonte um pouco mais alto para dar espaço à estrada
      const roadH = 10;            // altura da estrada
      const roadY = horizonY;      // estrada começa no horizonte
      const neonColors = ["#00e5ff", "#ff00aa", "#00ff88", "#ff6600", "#aa00ff"];

      // ── Céu ──
      const sky = ctx.createLinearGradient(0, 0, 0, horizonY);
      sky.addColorStop(0, "#050518");
      sky.addColorStop(0.5, "#0a0a2a");
      sky.addColorStop(1, "#1a0a2e");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, horizonY);

      // ── Estrelas no céu (deterministic, cintilam) ──
      for (let i = 0; i < 40; i++) {
        const sx = (i * 137 + 13) % w;
        const sy = (i * 71 + 7) % (horizonY * 0.55);
        const tw = 0.3 + 0.7 * Math.sin(t * 1.5 + i * 0.5);
        ctx.fillStyle = "rgba(200,210,255," + (0.2 + tw * 0.3).toFixed(2) + ")";
        ctx.fillRect(sx, sy, 1, 1);
      }
      // Algumas estrelas mais brilhantes
      for (let i = 0; i < 8; i++) {
        const sx = (i * 211 + 30) % w;
        const sy = (i * 97 + 15) % (horizonY * 0.4);
        const tw = 0.5 + 0.5 * Math.sin(t * 2 + i);
        ctx.fillStyle = "rgba(220,230,255," + (0.4 + tw * 0.4).toFixed(2) + ")";
        ctx.fillRect(sx - 0.5, sy - 0.5, 2, 2);
      }

      // ── Lua crescente (formato de C) ──
      const moonX = w * 0.82;
      const moonY = h * 0.14;
      const moonR = 10;
      // Halo da lua
      ctx.fillStyle = "rgba(200,210,255,0.08)";
      ctx.beginPath(); ctx.arc(moonX, moonY, moonR + 5, 0, Math.PI * 2); ctx.fill();
      // Lua cheia (branca-amarelada)
      ctx.fillStyle = "#e8e8d0";
      ctx.beginPath(); ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2); ctx.fill();
      // Sombra para criar crescente — gradiente radial (borda suave, sem corte redondo)
      const moonShadow = ctx.createRadialGradient(
        moonX + moonR * 0.45, moonY - moonR * 0.1, 0,
        moonX + moonR * 0.45, moonY - moonR * 0.1, moonR * 0.95
      );
      moonShadow.addColorStop(0, "#1a0a2e");  // centro da sombra = cor do céu no horizonte
      moonShadow.addColorStop(0.7, "#1a0a2e");
      moonShadow.addColorStop(1, "rgba(26,10,46,0)");  // fade para transparente na borda
      ctx.fillStyle = moonShadow;
      ctx.beginPath(); ctx.arc(moonX + moonR * 0.45, moonY - moonR * 0.1, moonR * 0.95, 0, Math.PI * 2); ctx.fill();

      // ── Nuvens ──
      for (let i = 0; i < 4; i++) {
        const cx = ((i * 200 + t * 8) % (w + 100)) - 50;
        const cy = h * 0.06 + i * 12;
        ctx.fillStyle = "rgba(20,15,40," + (0.3 - i * 0.05).toFixed(2) + ")";
        ctx.beginPath();
        ctx.ellipse(cx, cy, 80 + i * 20, 10 + i * 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── Prédios com espaçamento ──
      const buildings = [
        { x: 0.00, w: 0.07, h: 0.35 }, { x: 0.09, w: 0.05, h: 0.28 },
        { x: 0.16, w: 0.08, h: 0.42 }, { x: 0.26, w: 0.06, h: 0.30 },
        { x: 0.34, w: 0.08, h: 0.38 }, { x: 0.44, w: 0.05, h: 0.25 },
        { x: 0.51, w: 0.09, h: 0.46 }, { x: 0.62, w: 0.06, h: 0.32 },
        { x: 0.70, w: 0.08, h: 0.40 }, { x: 0.80, w: 0.06, h: 0.30 },
        { x: 0.88, w: 0.07, h: 0.36 }, { x: 0.97, w: 0.03, h: 0.26 },
      ];
      buildings.forEach(function (b, idx) {
        const bx = b.x * w;
        const bw = b.w * w;
        const bh = b.h * h;
        const by = horizonY - bh;
        // Silhueta
        ctx.fillStyle = "#080820";
        ctx.fillRect(bx, by, bw, bh);
        // Borda superior neon
        const nc = neonColors[idx % neonColors.length];
        ctx.fillStyle = nc + "40";
        ctx.fillRect(bx, by, bw, 1.5);
        // Janelas — 90% da altura, com espaço para a estrada em baixo
        const winW = 2, winH = 2;
        const winGapX = 5, winGapY = 5;
        const winStartY = by + 5;
        const winEndY = by + bh * 0.90; // 90% da altura do prédio
        for (let wy = winStartY; wy < winEndY; wy += winGapY) {
          for (let wx = bx + 3; wx < bx + bw - 3; wx += winGapX) {
            const seed = idx * 100 + Math.floor(wy) * 7 + Math.floor(wx) * 13;
            const phase = (t * 0.5 + seed * 0.1) % (Math.PI * 2);
            const on = Math.sin(phase) > 0.3;
            if (on) {
              const brightness = 0.3 + 0.4 * Math.sin(phase);
              ctx.fillStyle = "rgba(255,230,150," + brightness.toFixed(2) + ")";
              ctx.fillRect(wx, wy, winW, winH);
            }
          }
        }
        // Antena
        if (idx % 3 === 0) {
          ctx.strokeStyle = "#0a0a20";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(bx + bw / 2, by);
          ctx.lineTo(bx + bw / 2, by - 8);
          ctx.stroke();
          if (Math.sin(t * 2 + idx) > 0) {
            ctx.fillStyle = "#ff2020";
            ctx.fillRect(bx + bw / 2 - 1, by - 9, 2, 2);
          }
        }
      });

      // ── Estrada (substitui a linha azul + água) ──
      // Asfalto escuro
      ctx.fillStyle = "#0c0c18";
      ctx.fillRect(0, roadY, w, roadH);
      // Linhas da estrada (tracejado amarelo estático — só os carros se movem)
      ctx.fillStyle = "rgba(200,180,60,0.5)";
      const dashLen = 8, dashGap = 6;
      for (let dx = 0; dx < w; dx += dashLen + dashGap) {
        ctx.fillRect(dx, roadY + roadH / 2 - 0.5, dashLen, 1);
      }
      // Bordas da estrada (neon cyan)
      ctx.fillStyle = "rgba(0,229,255,0.3)";
      ctx.fillRect(0, roadY, w, 1);
      ctx.fillRect(0, roadY + roadH - 1, w, 1);

      // ── Carros a passar (faróis à direita, luzes de presença à esquerda) ──
      // Carros que vão da esquerda para a direita (faróis brancos/azul)
      for (let i = 0; i < 3; i++) {
        const carX = ((t * (80 + i * 30) + i * 200) % (w + 40)) - 20;
        const carY = roadY + 2;
        // Faróis (brancos, à frente = direita)
        ctx.fillStyle = "rgba(255,255,220,0.7)";
        ctx.fillRect(carX + 3, carY, 2, 1);
        ctx.fillStyle = "rgba(255,255,220,0.3)";
        ctx.fillRect(carX + 5, carY, 6, 1); // feixe de luz
        // Luz traseira (vermelha, atrás = esquerda)
        ctx.fillStyle = "rgba(255,40,40,0.6)";
        ctx.fillRect(carX, carY, 1.5, 1);
      }
      // Carros que vão da direita para a esquerda (faróis à esquerda)
      for (let i = 0; i < 2; i++) {
        const carX = w - ((t * (60 + i * 25) + i * 150) % (w + 40)) + 20;
        const carY = roadY + roadH - 4;
        // Faróis (brancos, à frente = esquerda)
        ctx.fillStyle = "rgba(255,255,220,0.7)";
        ctx.fillRect(carX, carY, 2, 1);
        ctx.fillStyle = "rgba(255,255,220,0.3)";
        ctx.fillRect(carX - 6, carY, 6, 1); // feixe de luz
        // Luz traseira (vermelha, atrás = direita)
        ctx.fillStyle = "rgba(255,40,40,0.6)";
        ctx.fillRect(carX + 2.5, carY, 1.5, 1);
      }

      // ── Chão abaixo da estrada (graduação escura + água) ──
      const groundTop = roadY + roadH;
      const groundH = h - groundTop;
      const ground = ctx.createLinearGradient(0, groundTop, 0, h);
      ground.addColorStop(0, "#08081a");
      ground.addColorStop(0.4, "#050515");
      ground.addColorStop(1, "#020208");
      ctx.fillStyle = ground;
      ctx.fillRect(0, groundTop, w, groundH);
      // Ondas de água (subtis, abaixo da estrada)
      ctx.strokeStyle = "rgba(0,100,150,0.10)";
      ctx.lineWidth = 1;
      for (let row = 0; row < 4; row++) {
        const waveY = groundTop + 4 + row * (groundH / 5);
        const amp = 1.5 + row * 0.4;
        ctx.beginPath();
        for (let wx = 0; wx <= w; wx += 4) {
          const wy = waveY + Math.sin(wx * 0.03 + t * (1.2 + row * 0.2)) * amp;
          if (wx === 0) ctx.moveTo(wx, wy); else ctx.lineTo(wx, wy);
        }
        ctx.stroke();
      }

      // ── Chuva neon ──
      ctx.strokeStyle = "rgba(100,200,255,0.20)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 25; i++) {
        const rx = (i * 47 + t * 200) % w;
        const ry = (i * 83 + t * 600) % (h + 20) - 10;
        const rlen = 6 + (i % 3) * 3;
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx - 1, ry + rlen);
        ctx.stroke();
      }

      // ── Luzes neon estáticas (só flicker) ──
      const staticLights = [
        { x: 0.20, y: 0.12, col: "#00e5ff" },
        { x: 0.50, y: 0.10, col: "#ff00aa" },
        { x: 0.70, y: 0.15, col: "#00ff88" },
      ];
      staticLights.forEach(function (l, i) {
        const fx = w * l.x;
        const fy = h * l.y;
        const flicker = 0.4 + 0.3 * Math.sin(t * 3 + i * 1.7);
        ctx.fillStyle = l.col;
        ctx.globalAlpha = flicker * 0.3;
        ctx.beginPath(); ctx.arc(fx, fy, 3, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = flicker * 0.15;
        ctx.beginPath(); ctx.arc(fx, fy, 8, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      });

      // ── Relâmpagos com fade-out curto ──
      const lightningCycle = 8;
      const lightningPhase = (t % lightningCycle) / lightningCycle;
      let lightningAlpha = 0;
      if (lightningPhase < 0.04) {
        const flashProgress = lightningPhase / 0.04;
        lightningAlpha = Math.sin(flashProgress * Math.PI) * 0.12;
      }
      if (lightningAlpha > 0) {
        ctx.fillStyle = "rgba(150,180,255," + lightningAlpha.toFixed(3) + ")";
        ctx.fillRect(0, 0, w, horizonY);
      }
    },
    "bg-crystal": function (ctx, w, h, t) {
      // Crystal Cave — caverna mística com cristais gigantes (Tier 5).
      // Cristais facetados (5 cores diferentes) pulsam com luz interior,
      // feixes de luz refração arco-íris das pontas, partículas a subir,
      // brilho quente ao fundo, estalactites no teto.
      // ── Paredes da caverna (gradiente roxo-escuro radial) ──
      const cave = ctx.createRadialGradient(w * 0.5, h * 0.55, w * 0.1, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
      cave.addColorStop(0, "#1a0830");
      cave.addColorStop(0.5, "#0a0418");
      cave.addColorStop(1, "#02010a");
      ctx.fillStyle = cave;
      ctx.fillRect(0, 0, w, h);
      // ── Brilho quente ao fundo da caverna (laranja/âmbar pulsante) ──
      const deepPulse = 0.7 + 0.3 * Math.sin(t * 1.2);
      const deepGlow = ctx.createRadialGradient(w * 0.5, h * 0.85, 0, w * 0.5, h * 0.85, w * 0.5);
      deepGlow.addColorStop(0, "rgba(255,140,40," + (0.20 * deepPulse).toFixed(2) + ")");
      deepGlow.addColorStop(0.5, "rgba(180,60,20," + (0.08 * deepPulse).toFixed(2) + ")");
      deepGlow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = deepGlow;
      ctx.fillRect(0, 0, w, h);
      // ── Estalactites no teto (14 triangulares, determinísticas) ──
      ctx.fillStyle = "#0a0418";
      for (let i = 0; i < 14; i++) {
        const sx = (i * w / 14 + (i * 37) % 20) % w;
        const sh = 12 + (i * 13) % 28;
        ctx.beginPath();
        ctx.moveTo(sx - 3, 0);
        ctx.lineTo(sx + 3, 0);
        ctx.lineTo(sx, sh);
        ctx.closePath(); ctx.fill();
      }
      // ── Cristais gigantes (7, cores diferentes) ──
      // dir = -1 → cresce do chão (para cima); dir = 1 → cresce do teto (para baixo)
      const crystals = [
        { x: 0.10, y: 0.95, dir: -1, len: 0.32, cw: 0.06, c1: "#d0a0ff", c2: "#8040c0", c3: "#400080" }, // purple floor
        { x: 0.22, y: 0.00, dir:  1, len: 0.22, cw: 0.05, c1: "#a0f0e0", c2: "#40c0a0", c3: "#108070" }, // cyan ceiling
        { x: 0.36, y: 0.96, dir: -1, len: 0.38, cw: 0.07, c1: "#c0f0a0", c2: "#60c040", c3: "#208020" }, // green floor
        { x: 0.50, y: 0.00, dir:  1, len: 0.18, cw: 0.04, c1: "#fff0c0", c2: "#ffc040", c3: "#a06010" }, // amber ceiling
        { x: 0.62, y: 0.95, dir: -1, len: 0.28, cw: 0.06, c1: "#ffffff", c2: "#c0c0e0", c3: "#6060a0" }, // white floor
        { x: 0.76, y: 0.00, dir:  1, len: 0.26, cw: 0.055, c1: "#e0a0ff", c2: "#9040d0", c3: "#400070" }, // purple ceiling
        { x: 0.88, y: 0.96, dir: -1, len: 0.30, cw: 0.06, c1: "#a0e0ff", c2: "#4080c0", c3: "#104070" }, // cyan floor
      ];
      const pulse = 0.5 + 0.5 * Math.sin(t * 2);
      crystals.forEach(function (cr, idx) {
        const cx = cr.x * w;
        const baseY = cr.y * h;
        const halfW = cr.cw * w * 0.5;
        const tipY = baseY + cr.dir * cr.len * h;
        const midY = baseY + cr.dir * cr.len * h * 0.3;
        // ── Luz interior pulsante (radial na ponta do cristal) ──
        const glow = ctx.createRadialGradient(cx, tipY, 0, cx, tipY, halfW * 2.8);
        glow.addColorStop(0, "rgba(255,255,255," + (0.30 * pulse).toFixed(2) + ")");
        glow.addColorStop(0.4, cr.c1);
        glow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(cx, tipY, halfW * 2.8, 0, Math.PI * 2); ctx.fill();
        // ── Cristal facetado (polígono com gradiente) ──
        const grad = ctx.createLinearGradient(cx - halfW, baseY, cx + halfW, tipY);
        grad.addColorStop(0, cr.c3);
        grad.addColorStop(0.4, cr.c2);
        grad.addColorStop(0.7, cr.c1);
        grad.addColorStop(1, "#ffffff");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(cx - halfW, baseY);
        ctx.lineTo(cx - halfW * 0.4, midY);
        ctx.lineTo(cx, tipY);
        ctx.lineTo(cx + halfW * 0.4, midY);
        ctx.lineTo(cx + halfW, baseY);
        ctx.closePath(); ctx.fill();
        // ── Linhas de faceta brilhantes (contornos) ──
        ctx.strokeStyle = "rgba(255,255,255," + (0.3 + pulse * 0.3).toFixed(2) + ")";
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(cx - halfW, baseY); ctx.lineTo(cx, tipY);
        ctx.moveTo(cx + halfW, baseY); ctx.lineTo(cx, tipY);
        ctx.moveTo(cx - halfW * 0.4, midY); ctx.lineTo(cx + halfW * 0.4, midY);
        ctx.stroke();
      });
      // ── Feixes de luz refração (arco-íris das pontas, rodam com t) ──
      ctx.globalCompositeOperation = "lighter";
      crystals.forEach(function (cr, idx) {
        const cx = cr.x * w;
        const baseY = cr.y * h;
        const tipY = baseY + cr.dir * cr.len * h;
        for (let b = 0; b < 2; b++) {
          const ang = t * 0.7 + idx * 1.3 + b * Math.PI;
          const len = w * 0.4;
          const ex = cx + Math.cos(ang) * len;
          const ey = tipY + Math.sin(ang) * len;
          const beamGrad = ctx.createLinearGradient(cx, tipY, ex, ey);
          const hue = (t * 50 + idx * 60 + b * 120) % 360;
          beamGrad.addColorStop(0, "hsla(" + hue + ",100%,70%,0.40)");
          beamGrad.addColorStop(0.6, "hsla(" + hue + ",100%,70%,0.12)");
          beamGrad.addColorStop(1, "hsla(" + hue + ",100%,70%,0)");
          ctx.strokeStyle = beamGrad;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(cx, tipY); ctx.lineTo(ex, ey);
          ctx.stroke();
        }
      });
      ctx.globalCompositeOperation = "source-over";
      // ── Partículas de cristal a subir (sparkles coloridos) ──
      for (let i = 0; i < 30; i++) {
        const px = (i * 89 + 13) % w;
        const py = h - ((t * (15 + i % 5 * 4) + i * 37) % (h + 20));
        const ps = 0.8 + (i % 3) * 0.6;
        const a = 0.3 + 0.4 * Math.sin(t * 3 + i);
        const hue = (i * 47 + t * 30) % 360;
        ctx.fillStyle = "hsla(" + hue + ",80%,70%," + a.toFixed(2) + ")";
        ctx.fillRect(px, py, ps, ps);
        if (a > 0.5) {
          ctx.fillStyle = "rgba(255,255,255," + (a * 0.4).toFixed(2) + ")";
          ctx.fillRect(px - 0.5, py - 0.5, ps + 1, ps + 1);
        }
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
  function drawPaddle(ctx, x, y, w, h, skinId, laserActive, hitTime) {
    const fn = paddleRenderers[skinId] || paddleRenderers["pad-default"];
    if (fn) fn(ctx, x, y, w, h, laserActive, hitTime);
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
    getBrickColor: getBrickColor,
  };
})();
