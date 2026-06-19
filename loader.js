// ═══════════════════════════════════════════════════════════════
//  loader.js — Ecrã de carregamento inicial
//
//  • Animação typewriter no #loader-text
//  • Aplica backdrop-filter blur ao #loader-bg (igual ao body)
//  • Expõe window.dismissLoader() e window.forceShowLoader()
//  • Mostra mensagens rotativas enquanto carrega
//  • Usa .loader-out (transição opacity) — igual ao comportamento original
// ═══════════════════════════════════════════════════════════════

(function () {
  "use strict";

  const PHRASES = {
    pt: ["A iniciar...", "A carregar jogos...", "A preparar...", "Quase..."],
    en: ["Starting up...", "Loading games...", "Preparing...", "Almost there..."],
  };

  const loader = document.getElementById("page-loader");
  const loaderText = document.getElementById("loader-text");
  const loaderBg = document.getElementById("loader-bg");

  let dismissed = false;
  let forced = false;
  let phraseIdx = 0;
  let charIdx = 0;
  let typingTimer = null;
  let phraseTimer = null;

  function currentPhrases() {
    const lang = (window.i18n && window.i18n.getCurrentLang()) || "pt";
    return PHRASES[lang] || PHRASES.pt;
  }

  function typeText(text) {
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
      }
    }, 55);
  }

  function nextPhrase() {
    const phrases = currentPhrases();
    typeText(phrases[phraseIdx % phrases.length]);
    phraseIdx++;
  }

  function startAnimation() {
    nextPhrase();
    phraseTimer = setInterval(nextPhrase, 2200);
  }

  function stopAnimation() {
    clearInterval(typingTimer);
    clearInterval(phraseTimer);
    typingTimer = null;
    phraseTimer = null;
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
      startAnimation();
    } else {
      // Ao parar o force, dispensa normalmente
      dismissLoader();
    }
  }

  // Expõe globalmente (app.js chama estas funções)
  window.dismissLoader = dismissLoader;
  window.forceShowLoader = forceShowLoader;

  // Arranque — inicia animação e sincroniza o blur do loader com o do body
  if (loader) {
    startAnimation();
  }

  // Safety net: se algo correr mal e o loader não for dispensado em 15s,
  // dispensa automaticamente para não bloquear a UI.
  setTimeout(() => {
    if (!dismissed && !forced) {
      console.warn("[loader.js] Safety net: a forçar dismiss após 15s.");
      dismissLoader();
    }
  }, 15000);
})();
