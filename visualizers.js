// ═══════════════════════════════════════════════════════════════
//  visualizers.js — Visualizadores de áudio (estilo Windows Media Player)
//  Jogos com Eles · CN Media Player
//
//  4 visualizadores, cada um com rendering distinto:
//    • Alchemy   — partículas líquidas que swirl com o bass
//    • Ambience  — bandas senoidais suaves com hue-shift (default)
//    • Plenoptic — feixes de luz convergentes (prisma)
//    • Spikes    — espigões radiais do centro
//
//  API: window.VISUALIZERS.list / .get(id)
//  Cada visualizador: { id, name, init(ctx,w,h)->state, draw(ctx,w,h,freq,wave,state,dt) }
//
//  Nota: freq e wave são Uint8Array(0-255) já preenchidos pelo player.
//  Todos têm baseline idle motion para não parecerem quebrados com silêncio.
// ═══════════════════════════════════════════════════════════════

(function () {
  "use strict";

  // ── Helpers partilhados ──
  // Média de uma banda de frequência [from, to)
  function bandAvg(freq, from, to) {
    let s = 0, n = 0;
    for (let i = from; i < to && i < freq.length; i++) { s += freq[i]; n++; }
    return n ? s / n : 0;
  }
  // Bass / mid / treble normalizados 0-1
  function levels(freq) {
    const n = freq.length;
    return {
      bass:  bandAvg(freq, 0, Math.floor(n * 0.08)) / 255,
      low:   bandAvg(freq, Math.floor(n * 0.08), Math.floor(n * 0.25)) / 255,
      mid:   bandAvg(freq, Math.floor(n * 0.25), Math.floor(n * 0.6)) / 255,
      treb:  bandAvg(freq, Math.floor(n * 0.6), n) / 255,
    };
  }

  // ─────────────────────────────────────────────
  //  1. ALCHEMY — partículas líquidas que swirl
  // ─────────────────────────────────────────────
  const alchemy = {
    id: "alchemy", name: "Alchemy",
    init: function (ctx, w, h) {
      const ps = [];
      for (let i = 0; i < 160; i++) {
        ps.push({ a: Math.random() * Math.PI * 2, r: Math.random() * Math.min(w, h) * 0.4,
                  s: 0.3 + Math.random() * 0.7, sz: 1 + Math.random() * 2.5 });
      }
      return { ps: ps, t: 0, cx: w / 2, cy: h / 2 };
    },
    draw: function (ctx, w, h, freq, wave, state, dt) {
      state.t += dt;
      const L = levels(freq);
      // Trail fade
      ctx.fillStyle = "rgba(8,6,16,0.18)";
      ctx.fillRect(0, 0, w, h);
      state.cx = w / 2; state.cy = h / 2;
      const swirl = 0.6 + L.bass * 2.2;
      const push = L.low * 1.5;
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < state.ps.length; i++) {
        const p = state.ps[i];
        p.a += (p.s * 0.02 + swirl * 0.01) * (1 + L.mid);
        p.r += Math.sin(state.t * p.s + i) * 0.4 + push;
        // reposiciona se sair muito
        const maxR = Math.min(w, h) * 0.55;
        if (p.r > maxR || p.r < 0) p.r = Math.random() * maxR * 0.5;
        const x = state.cx + Math.cos(p.a) * p.r;
        const y = state.cy + Math.sin(p.a) * p.r * 0.85;
        const hue = (state.t * 30 + i * 4) % 360;
        const sz = p.sz * (1 + L.bass * 2);
        ctx.fillStyle = "hsla(" + hue + ",90%,60%," + (0.5 + L.mid * 0.5) + ")";
        ctx.beginPath();
        ctx.arc(x, y, sz, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    },
  };

  // ─────────────────────────────────────────────
  //  2. AMBIENCE — bandas senoidais suaves
  // ─────────────────────────────────────────────
  const ambience = {
    id: "ambience", name: "Ambience",
    init: function () { return { t: 0 }; },
    draw: function (ctx, w, h, freq, wave, state, dt) {
      state.t += dt;
      // fundo
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, "rgba(15,8,25,0.35)");
      bg.addColorStop(1, "rgba(5,5,15,0.5)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      const bands = 5;
      const bandFreqs = [0.04, 0.12, 0.3, 0.5, 0.75];
      for (let b = 0; b < bands; b++) {
        const amp = bandAvg(freq, Math.floor(freq.length * bandFreqs[b]), Math.floor(freq.length * bandFreqs[b] + 8)) / 255;
        const hue = (state.t * 20 + b * 60) % 360;
        ctx.strokeStyle = "hsla(" + hue + ",80%,60%,0.7)";
        ctx.lineWidth = 2;
        ctx.shadowBlur = 14;
        ctx.shadowColor = "hsl(" + hue + ",80%,55%)";
        ctx.beginPath();
        const baseY = h / 2 + (b - 2) * 10;
        for (let x = 0; x <= w; x += 4) {
          const phase = state.t * (0.8 + b * 0.2) + x * 0.02;
          const y = baseY + Math.sin(phase) * (amp * h * 0.3 + 6);
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    },
  };

  // ─────────────────────────────────────────────
  //  3. PLENOPTIC — feixes de luz convergentes (prisma)
  // ─────────────────────────────────────────────
  const plenoptic = {
    id: "plenoptic", name: "Plenoptic",
    init: function () { return { t: 0 }; },
    draw: function (ctx, w, h, freq, wave, state, dt) {
      state.t += dt;
      ctx.fillStyle = "rgba(4,4,12,0.3)";
      ctx.fillRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2;
      const beams = 64;
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < beams; i++) {
        const bin = Math.floor((i / beams) * freq.length * 0.6);
        const v = freq[bin] / 255;
        const a = (i / beams) * Math.PI * 2 + state.t * 0.3;
        const len = 20 + v * Math.min(w, h) * 0.6;
        const hue = (i / beams) * 360 + state.t * 20;
        ctx.strokeStyle = "hsla(" + hue + ",90%,60%," + (0.25 + v * 0.6) + ")";
        ctx.lineWidth = 1 + v * 2;
        ctx.beginPath();
        // feixe de cima para baixo, passando perto do centro
        const x1 = cx + Math.cos(a) * len;
        const y1 = cy + Math.sin(a) * len;
        const x2 = cx - Math.cos(a) * len * 0.4;
        const y2 = cy - Math.sin(a) * len * 0.4;
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      // núcleo central
      const L = levels(freq);
      ctx.fillStyle = "rgba(255,255,255," + (0.3 + L.bass * 0.5) + ")";
      ctx.beginPath();
      ctx.arc(cx, cy, 4 + L.bass * 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
    },
  };

  // ─────────────────────────────────────────────
  //  4. SPIKES — espigões radiais do centro
  // ─────────────────────────────────────────────
  const spikes = {
    id: "spikes", name: "Spikes",
    init: function () { return { t: 0 }; },
    draw: function (ctx, w, h, freq, wave, state, dt) {
      state.t += dt;
      ctx.fillStyle = "rgba(8,8,16,0.4)";
      ctx.fillRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2;
      const N = 96;
      const baseR = Math.min(w, h) * 0.12;
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < N; i++) {
        const bin = Math.floor((i / N) * freq.length * 0.6);
        const v = freq[bin] / 255;
        const a = (i / N) * Math.PI * 2 + state.t * 0.2;
        const r1 = baseR;
        const r2 = baseR + v * Math.min(w, h) * 0.4;
        const hue = (state.t * 50 + i * (360 / N)) % 360;
        const grad = ctx.createLinearGradient(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        grad.addColorStop(0, "hsla(" + hue + ",90%,55%,0.9)");
        grad.addColorStop(1, "hsla(" + hue + ",90%,65%,0)");
        ctx.strokeStyle = grad;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
    },
  };

  // ── Helper: rounded rectangle path ──
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ── Registo ──
  // Ambience primeiro (é o default — aparece selecionado por defeito no dropdown)
  const list = [ambience, alchemy, plenoptic, spikes];
  const map = {};
  list.forEach(function (v) { map[v.id] = v; });

  window.VISUALIZERS = {
    list: list,
    get: function (id) { return map[id] || list[0]; },
  };
})();
