// ═══════════════════════════════════════════════════════════════
//  sound.js — Sistema de SFX (Sound Effects)
//  Jogos com Eles
//
//  • Sons gerados via Web Audio API — SEM ficheiros externos
//    (funciona em GitHub Pages, zero payloads, zero requests)
//  • Toggle de mute persistido em localStorage (jce_sound_muted)
//  • API pública exposta em window.sfx
//
//  NOTA (Etapa final): Os sons de hover foram REMOVIDOS.
//  Os browsers modernos exigem "user activation" (clique/toque/tecla)
//  antes de poderem produzir som via Web Audio API. O mousemove/hover
//  NÃO conta como user activation em nenhum browser moderno (Chrome,
//  Firefox, Safari), pelo que os sons de hover nunca tocavam sem que
//  o utilizador clicasse primeiro no site. Como não há forma de
//  contornar esta limitação técnica, os sons de hover foram removidos.
//
//  O catálogo SOUNDS fica vazio — a API window.sfx mantém-se para o
//  toggle de mute (que continua a funcionar para o Brick Breaker e
//  outros sons que tocam após interação do utilizador).
// ═══════════════════════════════════════════════════════════════

(function () {
  "use strict";

  const MUTE_KEY = "jce_sound_muted";

  let muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === "1"; } catch (_) {}

  let ctx = null;
  let masterGain = null;

  function ensureCtx() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      masterGain = ctx.createGain();
      masterGain.gain.value = 0.20;
      masterGain.connect(ctx.destination);
    } catch (e) {
      ctx = null;
    }
    return ctx;
  }

  function resumeCtx() {
    if (ctx && ctx.state === "suspended") {
      ctx.resume().catch(function () {});
    }
  }

  // Catálogo vazio — sons de hover removidos (limitação de user activation)
  const SOUNDS = {};

  function play(name) {
    if (muted) return;
    if (!SOUNDS[name]) return;
    if (!ensureCtx()) return;
    resumeCtx();
    try { SOUNDS[name](); } catch (e) { /* falha silenciosa */ }
  }

  function setMuted(m) {
    muted = !!m;
    try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch (_) {}
  }

  function isMuted() { return muted; }

  function prime() {
    ensureCtx();
    resumeCtx();
  }

  window.sfx = { play: play, setMuted: setMuted, isMuted: isMuted, prime: prime };
})();
