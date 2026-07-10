// ═══════════════════════════════════════════════════════════════
//  visualizers.js — Visualizadores de áudio (CN Media Player)
//  Jogos com Eles
//
//  5 visualizadores, PURAMENTE REATIVOS à música:
//    • Neon      — barras neon com estrelas + cometas + partículas (default)
//    • Mountain  — 3 camadas de área preenchida do espectro
//    • Retro Cool— 3 osciloscópios sobrepostos (bass/mid/treble)
//    • Radio     — grelha de LEDs estilo VU meter
//    • 3D Bars   — barras em perspetiva isométrica 3D
//
//  API: window.VISUALIZERS.list / .get(id)
//  Cada visualizador: { id, name, init(ctx,w,h)->state, draw(ctx,w,h,freq,wave,state,dt) }
//
//  Nota: freq e wave são Uint8Array(0-255) já preenchidos pelo player.
//  Todos puramente reativos — pausar a música = visualizer para.
// ═══════════════════════════════════════════════════════════════

(function () {
  "use strict";

  // ── Helpers partilhados ──
  function bandAvg(freq, from, to) {
    let s = 0, n = 0;
    for (let i = from; i < to && i < freq.length; i++) { s += freq[i]; n++; }
    return n ? s / n : 0;
  }
  function levels(freq) {
    const n = freq.length;
    const raw = {
      bass: bandAvg(freq, 0, Math.floor(n * 0.06)) / 255,
      low:  bandAvg(freq, Math.floor(n * 0.06), Math.floor(n * 0.2)) / 255,
      mid:  bandAvg(freq, Math.floor(n * 0.2), Math.floor(n * 0.5)) / 255,
      treb: bandAvg(freq, Math.floor(n * 0.5), n) / 255,
    };
    // Power curve + gain para amplificar a reatividade
    const gain = 1.5;
    function boost(v) { return Math.min(1, Math.pow(v, 0.6) * gain); }
    return {
      bass: boost(raw.bass), low: boost(raw.low), mid: boost(raw.mid), treb: boost(raw.treb),
      _rawBass: raw.bass, _rawLow: raw.low, _rawMid: raw.mid, _rawTreble: raw.treb,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  1. NEON — barras neon com estrelas + cometas (default)
  //     Barras mais altas no meio. O efeito de splash (partículas) foi
  //     removido — causava lag com músicas de muitos beats.
  // ═══════════════════════════════════════════════════════════════
  const neon = {
    id: "neon", name: "Neon",
    init: function (ctx, w, h) {
      const stars = [];
      for (let i = 0; i < 80; i++) {
        stars.push({
          x: Math.random() * w, y: Math.random() * h,
          size: 1 + Math.random() * 2.2,
          alpha: Math.random(),
          alphaSpeed: 0.3 + Math.random() * 0.8,
          alphaDir: Math.random() < 0.5 ? 1 : -1,
        });
      }
      return { stars: stars, comets: [], t: 0, nextComet: 2 + Math.random() * 4 };
    },
    draw: function (ctx, w, h, freq, wave, state, dt) {
      state.t += dt;
      // Fundo: céu noturno
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, "#040414");
      bg.addColorStop(0.6, "#08081e");
      bg.addColorStop(1, "#040410");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Estrelas: twinkle subtil + respawn em sítios aleatórios
      for (let i = 0; i < state.stars.length; i++) {
        const s = state.stars[i];
        s.alpha += s.alphaDir * s.alphaSpeed * dt;
        if (s.alpha >= 1) { s.alpha = 1; s.alphaDir = -1; }
        if (s.alpha <= 0) {
          s.x = Math.random() * w; s.y = Math.random() * h;
          s.size = 1 + Math.random() * 2.2; s.alpha = 0; s.alphaDir = 1;
        }
        ctx.fillStyle = "rgba(255,255,255," + (s.alpha * 0.7).toFixed(2) + ")";
        ctx.shadowBlur = s.size * 2;
        ctx.shadowColor = "rgba(200,220,255,0.6)";
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;

      // Cometas a passar de maneira random
      state.nextComet -= dt;
      if (state.nextComet <= 0) {
        state.nextComet = 3 + Math.random() * 6;
        const fromLeft = Math.random() < 0.5;
        state.comets.push({
          x: fromLeft ? -50 : w + 50,
          y: Math.random() * h * 0.5,
          vx: (fromLeft ? 1 : -1) * (150 + Math.random() * 150),
          vy: 20 + Math.random() * 40,
          trail: [], hue: 180 + Math.random() * 60,
        });
      }
      for (let i = state.comets.length - 1; i >= 0; i--) {
        const c = state.comets[i];
        c.trail.unshift({ x: c.x, y: c.y });
        if (c.trail.length > 20) c.trail.pop();
        c.x += c.vx * dt; c.y += c.vy * dt;
        ctx.globalCompositeOperation = "lighter";
        for (let t = 0; t < c.trail.length; t++) {
          const p = c.trail[t];
          const alpha = (1 - t / c.trail.length) * 0.5;
          const sz = (1 - t / c.trail.length) * 3 + 0.5;
          ctx.fillStyle = "hsla(" + c.hue + ",90%,75%," + alpha.toFixed(3) + ")";
          ctx.beginPath();
          ctx.arc(p.x, p.y, sz, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "hsla(" + c.hue + ",100%,90%,1)";
        ctx.shadowBlur = 15;
        ctx.shadowColor = "hsl(" + c.hue + ",100%,70%)";
        ctx.beginPath();
        ctx.arc(c.x, c.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.globalCompositeOperation = "source-over";
        if (c.x < -100 || c.x > w + 100 || c.y > h + 50) state.comets.splice(i, 1);
      }

      // Barras: mais altas NO MEIO (mirror), 3 centrais com efeitos
      const N = 41;
      const barW = w / N;
      const usable = Math.floor(freq.length * 0.5);
      const centerIdx = Math.floor(N / 2);
      for (let i = 0; i < N; i++) {
        const distFromCenter = Math.abs(i - centerIdx);
        const weight = 1 - (distFromCenter / centerIdx) * 0.7;
        const freqFrac = 0.1 + (distFromCenter / centerIdx) * 0.7;
        const fi = Math.floor(freqFrac * usable);
        const v = freq[fi] / 255;
        const ampV = Math.pow(v, 0.6) * 1.4 * weight;
        const barH = ampV * h * 0.55;
        const x = i * barW;
        const y = h - barH;
        const hue = 300 - distFromCenter * 8;
        ctx.shadowBlur = 10 + ampV * 16;
        ctx.shadowColor = "hsl(" + hue + ",100%,60%)";
        const grad = ctx.createLinearGradient(0, y, 0, h);
        grad.addColorStop(0, "hsl(" + hue + ",100%,75%)");
        grad.addColorStop(0.5, "hsl(" + hue + ",100%,55%)");
        grad.addColorStop(1, "hsl(" + hue + ",100%,30%)");
        ctx.fillStyle = grad;
        ctx.fillRect(x + 1, y, barW - 2, barH);
        ctx.shadowBlur = 0;
        ctx.fillStyle = "hsla(" + hue + ",100%,85%,0.9)";
        ctx.fillRect(x + 1, y, barW - 2, 2);
      }
      // NOTA: o efeito de splash (partículas) das 3 barras centrais foi
      // removido — causava lag quando uma música gerava muitos splashes
      // seguidos. As barras mantêm o glow e o cap brilhante.
    },
  };

  // ═══════════════════════════════════════════════════════════════
  //  2. MOUNTAIN — 3 camadas de área preenchida do espectro
  //     Ondas suaves (curvas quadráticas) com SENSIBILIDADES DIFERENTES
  //     por camada. Ordem: grande atrás, média no meio, pequena à frente.
  //     Flocos de neve a cair no fundo.
  // ═══════════════════════════════════════════════════════════════
  const mountain = {
    id: "mountain", name: "Mountain",
    init: function (ctx, w, h) {
      // Flocos de neve: posições aleatórias, velocidades variadas
      const flakes = [];
      for (let i = 0; i < 60; i++) {
        flakes.push({
          x: Math.random() * w,
          y: Math.random() * h,
          size: 1 + Math.random() * 2.5,
          vy: 8 + Math.random() * 20,
          vx: (Math.random() - 0.5) * 4,
          wobble: Math.random() * Math.PI * 2,
          wobbleSpeed: 0.5 + Math.random() * 1.5,
          alpha: 0.4 + Math.random() * 0.5,
        });
      }
      return { t: 0, smoothBuf: [new Array(129), new Array(129), new Array(129)], flakes: flakes };
    },
    draw: function (ctx, w, h, freq, wave, state, dt) {
      state.t += dt;
      ctx.fillStyle = "#040408";
      ctx.fillRect(0, 0, w, h);
      const N = 128;
      const usable = Math.floor(freq.length * 0.5);
      const baseY = h * 0.92;
      // 3 camadas com SENSIBILIDADES DIFERENTES (ordem: grande→média→pequena):
      //   Camada de trás  → BASS band, escala GRANDE (0.85), onda alta — verde
      //   Camada do meio   → MID band, escala MÉDIA (0.6), onda média — cyan
      //   Camada da frente → HIGH band, escala PEQUENA (0.4), onda baixinha — roxo
      // Offsets JUNTOS (0.78/0.66/0.54) para reduzir o espaçamento vertical.
      // Gains ALTOS + powers BAIXOS para máxima sensibilidade (todas mexem).
      const layers = [
        // fundo: bass band, escala grande — verde
        { offset: 0.78, alpha: 0.5, hueShift: 120, scale: 0.85, smoothK: 0.72,
          bandStart: 0.0, bandEnd: 0.08, gain: 1.6, power: 0.5 },
        // meio: mid band, escala média — cyan
        { offset: 0.66, alpha: 0.5, hueShift: 190, scale: 0.6, smoothK: 0.75,
          bandStart: 0.08, bandEnd: 0.25, gain: 1.8, power: 0.55 },
        // frente: high band, escala pequena — roxo (gain alto para compensar
        // a pouca energia do high band — assim também mexe)
        { offset: 0.54, alpha: 0.75, hueShift: 280, scale: 0.4, smoothK: 0.78,
          bandStart: 0.25, bandEnd: 0.45, gain: 2.5, power: 0.6 },
      ];
      layers.forEach(function (layer, layerIdx) {
        const hue = (state.t * 15 + layer.hueShift) % 360;
        const buf = state.smoothBuf[layerIdx];
        const bandStartI = Math.floor(freq.length * layer.bandStart);
        const bandEndI = Math.max(bandStartI + 1, Math.floor(freq.length * layer.bandEnd));
        const points = [];
        for (let i = 0; i <= N; i++) {
          const fi = bandStartI + Math.floor((i / N) * (bandEndI - bandStartI));
          const v = freq[fi] / 255;
          // Moving average para suavizar picos
          let sum = 0, cnt = 0;
          for (let k = -2; k <= 2; k++) {
            const ni = fi + k;
            if (ni >= 0 && ni < freq.length) { sum += freq[ni] / 255; cnt++; }
          }
          const avgV = cnt ? sum / cnt : v;
          // Amplitude com gain ALTO + power BAIXO = máxima sensibilidade
          const ampV = Math.pow(avgV, layer.power) * layer.gain;
          // Smoothing temporal
          const prev = (buf[i] !== undefined) ? buf[i] : 0;
          buf[i] = prev * layer.smoothK + ampV * (1 - layer.smoothK);
          const x = (i / N) * w;
          // Espaçamento vertical reduzido: fator 0.12 (era 0.25)
          const peakY = baseY - buf[i] * h * 0.4 * layer.scale - h * (1 - layer.offset) * 0.12;
          points.push({ x: x, y: peakY });
        }
        // Área preenchida com curvas quadráticas
        ctx.fillStyle = "hsla(" + hue + ",70%,40%," + layer.alpha + ")";
        ctx.beginPath();
        ctx.moveTo(0, h);
        ctx.lineTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length - 1; i++) {
          const xc = (points[i].x + points[i + 1].x) / 2;
          const yc = (points[i].y + points[i + 1].y) / 2;
          ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
        }
        ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();
        // Contorno do topo
        ctx.strokeStyle = "hsla(" + hue + ",90%,60%," + (layer.alpha + 0.15) + ")";
        ctx.lineWidth = 2;
        ctx.shadowBlur = 6;
        ctx.shadowColor = "hsl(" + hue + ",90%,60%)";
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length - 1; i++) {
          const xc = (points[i].x + points[i + 1].x) / 2;
          const yc = (points[i].y + points[i + 1].y) / 2;
          ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
        }
        ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
        ctx.stroke();
        ctx.shadowBlur = 0;
      });

      // ── Flocos de neve a cair no fundo ──
      const L = levels(freq);
      const snowSpeedMul = 1 + L.bass * 0.5; // leve aceleração com o bass
      ctx.fillStyle = "rgba(255,255,255,1)";
      ctx.shadowBlur = 3;
      ctx.shadowColor = "rgba(200,220,255,0.6)";
      for (let i = 0; i < state.flakes.length; i++) {
        const f = state.flakes[i];
        f.y += f.vy * snowSpeedMul * dt;
        f.wobble += f.wobbleSpeed * dt;
        f.x += Math.sin(f.wobble) * f.vx * dt;
        // Respawn no topo quando sai pelo fundo
        if (f.y > h + 5) {
          f.y = -5;
          f.x = Math.random() * w;
        }
        // Wrap horizontal
        if (f.x < -5) f.x = w + 5;
        if (f.x > w + 5) f.x = -5;
        ctx.globalAlpha = f.alpha;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    },
  };

  // ═══════════════════════════════════════════════════════════════
  //  3. RETRO COOL — 3 osciloscópios sobrepostos (bass/mid/treble)
  //     CORREÇÃO: smoothing alto + amplitude reduzida para as linhas
  //     serem distinguíveis (não tudo a mover-se igual).
  // ═══════════════════════════════════════════════════════════════
  const retroCool = {
    id: "retro-cool", name: "Retro Cool",
    init: function () { return { t: 0, smooth: [{}, {}, {}] }; },
    draw: function (ctx, w, h, freq, wave, state, dt) {
      state.t += dt;
      ctx.fillStyle = "rgba(4,4,10,0.35)";
      ctx.fillRect(0, 0, w, h);
      const midY = h / 2;
      const N = wave.length;
      // 3 bandas com cores distintas e amplitudes DIFERENTES para serem distinguíveis.
      // Bass = amplitude grande + vermelho (grossa)
      // Mid  = amplitude média + verde (média)
      // Treble = amplitude pequena + cyan (fina)
      // Isto faz com que cada linha tenha o seu "espaço" próprio.
      const bands = [
        { color: "#ff4060", glow: "#ff2040", start: 0, end: Math.floor(N * 0.15), width: 4, scale: 1.0, label: "BASS" },
        { color: "#4dd964", glow: "#20c040", start: Math.floor(N * 0.15), end: Math.floor(N * 0.5), width: 3, scale: 0.55, label: "MID" },
        { color: "#3fb8d4", glow: "#2090b0", start: Math.floor(N * 0.5), end: N, width: 2, scale: 0.3, label: "TREBLE" },
      ];
      bands.forEach(function (b, idx) {
        ctx.strokeStyle = b.color;
        ctx.lineWidth = b.width;
        ctx.shadowBlur = 12;
        ctx.shadowColor = b.glow;
        ctx.lineCap = "round";
        ctx.beginPath();
        const len = b.end - b.start;
        // Amplitude MENOR para cada banda — assim as linhas não se sobrepõem
        // e cada uma é distinguível. Bass move mais, mid menos, treble quase nada.
        const amp = h * 0.22 * b.scale;
        for (let i = 0; i <= w; i += 2) {
          const wi = b.start + Math.floor((i / w) * len);
          const raw = ((wave[wi] || 128) - 128) / 128;
          // Smoothing temporal: mantém os valores anteriores para reduzir o jitter
          if (!state.smooth[idx][i]) state.smooth[idx][i] = raw;
          state.smooth[idx][i] = state.smooth[idx][i] * 0.7 + raw * 0.3;
          const y = midY + state.smooth[idx][i] * amp;
          if (i === 0) ctx.moveTo(i, y); else ctx.lineTo(i, y);
        }
        ctx.stroke();
      });
      ctx.shadowBlur = 0;
      // Linha central
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, midY);
      ctx.lineTo(w, midY);
      ctx.stroke();
    },
  };

  // ═══════════════════════════════════════════════════════════════
  //  4. RADIO — grelha de LEDs estilo VU meter (verde→amarelo→vermelho)
  //     MENOS sensível: curva íngreme (v^1.8) para que só sons fortes
  //     acendam muitos LEDs. Sons fracos/médios = poucos LEDs acesos.
  // ═══════════════════════════════════════════════════════════════
  const radio = {
    id: "radio", name: "Radio",
    init: function () { return { t: 0 }; },
    draw: function (ctx, w, h, freq, wave, state, dt) {
      state.t += dt;
      ctx.fillStyle = "#080404";
      ctx.fillRect(0, 0, w, h);
      const cols = 28;
      const rows = 14;
      const ledSize = Math.min(w / (cols + 2), h / (rows + 2)) * 0.7;
      const gapX = (w - cols * ledSize) / (cols + 1);
      const gapY = (h - rows * ledSize) / (rows + 1);
      const usable = Math.floor(freq.length * 0.5);
      for (let c = 0; c < cols; c++) {
        const fi = Math.floor((c / cols) * usable);
        const v = freq[fi] / 255;
        // Curva ÍNGREME (v^1.8 * 0.85): sons fracos = poucos LEDs,
        // só sons fortes acendem tudo. Era v^0.6 * 1.4 (muito sensível).
        const ampV = Math.pow(v, 1.8) * 0.85;
        const litRows = Math.floor(ampV * rows);
        for (let r = 0; r < rows; r++) {
          const x = gapX + c * (ledSize + gapX);
          const y = h - gapY - (r + 1) * ledSize - r * gapY;
          const isLit = r < litRows;
          const frac = r / rows;
          let hue;
          if (frac < 0.6) hue = 120;
          else if (frac < 0.85) hue = 50;
          else hue = 0;
          if (isLit) {
            ctx.fillStyle = "hsl(" + hue + ",100%,55%)";
            ctx.shadowBlur = ledSize * 0.8;
            ctx.shadowColor = "hsl(" + hue + ",100%,50%)";
          } else {
            ctx.fillStyle = "hsla(" + hue + ",40%,15%,0.5)";
            ctx.shadowBlur = 0;
          }
          ctx.fillRect(x, y, ledSize, ledSize);
        }
      }
      ctx.shadowBlur = 0;
    },
  };

  // ═══════════════════════════════════════════════════════════════
  //  5. 3D BARS — barras em perspetiva isométrica 3D
  //     CORREÇÃO: topo SÓLIDO (não transparente) + baseY encostado ao
  //     fundo + largura RESPONSIVA (não corta laterais).
  // ═══════════════════════════════════════════════════════════════
  const bars3d = {
    id: "3d-bars", name: "3D Bars",
    init: function () { return { t: 0 }; },
    draw: function (ctx, w, h, freq, wave, state, dt) {
      state.t += dt;
      ctx.fillStyle = "#040410";
      ctx.fillRect(0, 0, w, h);
      const N = 18;
      const usable = Math.floor(freq.length * 0.5);
      // Largura RESPONSIVA: calcula barW e gap com base no canvas real.
      // Inclui o depth na largura total para que a última barra não corte.
      const depth = 8;
      const margin = 10;
      const slotW = (w - 2 * margin - depth) / N;
      const barW = Math.max(6, slotW * 0.72);
      const gap = slotW - barW;
      const totalW = N * (barW + gap) - gap + depth;
      const startX = (w - totalW) / 2;
      // baseY encostado à extremidade inferior (deixa 4px para a linha do chão)
      const baseY = h - 4;
      // Altura máxima disponível para as barras (deixa espaço para o topo 3D)
      const maxBarH = baseY - depth - 8;
      for (let i = 0; i < N; i++) {
        const fi = Math.floor((i / N) * usable);
        const v = freq[fi] / 255;
        // MENOS sensível: v^0.8 * 1.0 (era v^0.6 * 1.4 — demasiado sensível)
        // v=0.5: antes ~0.91, agora ~0.57
        // v=0.8: antes ~1.0, agora ~0.84
        const ampV = Math.pow(v, 0.8);
        // barH limitado a maxBarH para NUNCA sair da janela
        const barH = Math.min(maxBarH, ampV * maxBarH);
        const x = startX + i * (barW + gap);
        const hue = (i / N) * 280 + 180;
        // Face frontal (mais escura)
        ctx.fillStyle = "hsl(" + hue + ",80%,30%)";
        ctx.beginPath();
        ctx.moveTo(x, baseY);
        ctx.lineTo(x + barW, baseY);
        ctx.lineTo(x + barW, baseY - barH);
        ctx.lineTo(x, baseY - barH);
        ctx.closePath();
        ctx.fill();
        // Topo 3D (losango) — SÓLIDO, não transparente
        ctx.fillStyle = "hsl(" + hue + ",85%,55%)";
        ctx.beginPath();
        ctx.moveTo(x, baseY - barH);
        ctx.lineTo(x + barW, baseY - barH);
        ctx.lineTo(x + barW + depth, baseY - barH - depth);
        ctx.lineTo(x + depth, baseY - barH - depth);
        ctx.closePath();
        ctx.fill();
        // Lado direito 3D
        ctx.fillStyle = "hsl(" + hue + ",80%,40%)";
        ctx.beginPath();
        ctx.moveTo(x + barW, baseY);
        ctx.lineTo(x + barW + depth, baseY - depth);
        ctx.lineTo(x + barW + depth, baseY - barH - depth);
        ctx.lineTo(x + barW, baseY - barH);
        ctx.closePath();
        ctx.fill();
        // Glow no topo (linha brilhante, sólida)
        ctx.shadowBlur = 6 + ampV * 10;
        ctx.shadowColor = "hsl(" + hue + ",90%,60%)";
        ctx.fillStyle = "hsl(" + hue + ",100%,70%)";
        ctx.beginPath();
        ctx.moveTo(x + depth, baseY - barH - depth);
        ctx.lineTo(x + barW + depth, baseY - barH - depth);
        ctx.lineTo(x + barW, baseY - barH);
        ctx.lineTo(x, baseY - barH);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      // Linha do chão
      ctx.strokeStyle = "rgba(63,184,212,0.2)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, baseY);
      ctx.lineTo(w, baseY);
      ctx.stroke();
    },
  };

  // ── Registo ──
  // Neon primeiro (é o default)
  const list = [neon, mountain, retroCool, radio, bars3d];
  const map = {};
  list.forEach(function (v) { map[v.id] = v; });

  window.VISUALIZERS = {
    list: list,
    get: function (id) { return map[id] || list[0]; },
  };
})();
