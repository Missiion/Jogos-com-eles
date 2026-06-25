// ═══════════════════════════════════════════════════════════════
//  loader.js — Ecrã de carregamento inicial
//
//  • Animação typewriter no #loader-text
//  • Aplica backdrop-filter blur ao #loader-bg (igual ao body)
//  • Expõe window.dismissLoader() e window.forceShowLoader()
//  • Mostra mensagens rotativas enquanto carrega
//  • Usa .loader-out (transição opacity) — igual ao comportamento original
//
//  Animação: recursive setTimeout (NÃO setInterval) para evitar overlap.
//  Cada frase: typewriter → hold → próxima frase. Loop smooth sem reinícios.
// ═══════════════════════════════════════════════════════════════

(function () {
  "use strict";

  // ── Frases rotativas (mais variadas para loads longos) ──
  // O cycleTimeout (abaixo) ajusta-se ao tamanho de cada frase.
  const PHRASES = {
    pt: [
      "A iniciar...",
      "A carregar jogos...",
      "A preparar a biblioteca...",
      "A sincronizar com a Steam...",
      "A otimizar imagens...",
      "A buscar análises...",
      "A finalizar...",
      "Quase lá...",
    ],
    en: [
      "Starting up...",
      "Loading games...",
      "Preparing library...",
      "Syncing with Steam...",
      "Optimizing images...",
      "Fetching reviews...",
      "Finalizing...",
      "Almost there...",
    ],
  };

  const TYPE_SPEED_MS = 55;    // velocidade do typewriter (ms por char)
  const HOLD_AFTER_TYPE_MS = 900; // pausa depois de escrever a frase completa

  const loader = document.getElementById("page-loader");
  const loaderText = document.getElementById("loader-text");
  const loaderBg = document.getElementById("loader-bg");

  let dismissed = false;
  let forced = false;
  let phraseIdx = 0;
  let charIdx = 0;
  let typingTimer = null;
  let cycleTimer = null;   // setTimeout para a próxima frase (recursive)
  let animationRunning = false;

  function currentPhrases() {
    const lang = (window.i18n && window.i18n.getCurrentLang()) || "pt";
    return PHRASES[lang] || PHRASES.pt;
  }

  // Typewriter: escreve a frase char a char, chama onComplete quando terminar.
  function typeText(text, onComplete) {
    if (!loaderText) return;
    loaderText.textContent = "";
    charIdx = 0;
    clearInterval(typingTimer);
    typingTimer = setInterval(() => {
      if (charIdx < text.length) {
        loaderText.textContent += text[charIdx];
        charIdx++;
      } else {
        clearInterval(typingTimer);
        typingTimer = null;
        if (typeof onComplete === "function") onComplete();
      }
    }, TYPE_SPEED_MS);
  }

  // Ciclo de animação: escreve frase → hold → próxima frase (recursive).
  // Usa setTimeout (NÃO setInterval) para que o timing se ajuste ao tamanho
  // de cada frase e nunca haja overlap entre frases.
  function runCycle() {
    if (!animationRunning) return;
    const phrases = currentPhrases();
    const phrase = phrases[phraseIdx % phrases.length];
    phraseIdx++;

    typeText(phrase, () => {
      // Depois de escrever, espera HOLD_AFTER_TYPE_MS e passa à próxima.
      if (!animationRunning) return;
      cycleTimer = setTimeout(runCycle, HOLD_AFTER_TYPE_MS);
    });
  }

  // Inicia a animação. IDEMPOTENTE — pode ser chamada várias vezes sem
  // criar intervals/timers duplicados (era o bug anterior).
  function startAnimation() {
    if (animationRunning) return; // já está a correr — não faz nada
    animationRunning = true;
    runCycle();
  }

  function stopAnimation() {
    animationRunning = false;
    clearInterval(typingTimer);
    clearTimeout(cycleTimer);
    typingTimer = null;
    cycleTimer = null;
  }

  function dismissLoader() {
    if (forced) return; // se forçado, não dispensa
    if (dismissed) return;
    dismissed = true;
    stopAnimation();
    if (loader) {
      // Usa a classe .loader-out (transição opacity 0.65s no CSS)
      loader.classList.add("loader-out");
      // Remove do DOM após a transição CSS terminar
      setTimeout(() => {
        if (loader && loader.parentNode) {
          loader.parentNode.removeChild(loader);
        }
      }, 700);
    }
  }

  function forceShowLoader(state) {
    forced = !!state;
    if (state) {
      dismissed = false;
      if (loader) {
        loader.classList.remove("loader-out");
      }
      // startAnimation é idempotente — não cria timers duplicados
      startAnimation();
    } else {
      // Ao parar o force, dispensa normalmente
      dismissLoader();
    }
  }

  // Expõe globalmente (app.js chama estas funções)
  window.dismissLoader = dismissLoader;
  window.forceShowLoader = forceShowLoader;

  // Arranque — inicia animação
  if (loader) {
    startAnimation();
  }

  // Safety net: se algo correr mal e o loader não for dispensado em 30s,
  // dispensa automaticamente para não bloquear a UI.
  // NOTA: 30s (era 15s) para dar tempo aos fetches IGDB+Steam completarem.
  // O forceShowLoader(true) no init() impede o dismiss prematuro; este safety
  // net só dispara se algo correr muito mal (Firebase em baixo, etc.).
  setTimeout(() => {
    if (!dismissed && !forced) {
      console.warn("[loader.js] Safety net: a forçar dismiss após 30s.");
      dismissLoader();
    }
  }, 30000);
})();
