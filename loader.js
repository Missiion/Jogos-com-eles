// loader.js — Ecrã de carregamento inicial
// Carregado antes do app.js (non-module, síncrono ao parse)

(function () {
  "use strict";

  let $loader  = document.getElementById("page-loader");
  let $loaderBg= document.getElementById("loader-bg");
  let $text    = document.getElementById("loader-text");

  if (!$loader || !$loaderBg || !$text) return;

  // ─────────────────────────────────────────────
  //  FLAG de visibilidade pública — app.js chama
  //  window.dismissLoader() quando os jogos ficam prontos
  // ─────────────────────────────────────────────
  let dismissed = false;

  // Guarda o markup original antes de qualquer remoção, para que o loader
  // possa ser recriado mais tarde (ex: modo de teste "Forçar Loading")
  const loaderMarkup = $loader.outerHTML;
  const loaderParent  = $loader.parentNode;
  const loaderNextSibling = $loader.nextSibling;

  window.dismissLoader = function () {
    if (forced) return; // modo de teste "Forçar Loading" tem prioridade
    if (dismissed) return;
    dismissed = true;
    stopPulse();
    stopTypewriter();
    $loader.classList.add("loader-out");
    // Remover do DOM após a transição para não bloquear cliques
    $loader.addEventListener("transitionend", () => {
      $loader.remove();
    }, { once: true });
  };

  // ─────────────────────────────────────────────
  //  FORÇAR LOADING — modo de teste/debug, usado pelo
  //  painel de admin. Reexibe o loader (recriando-o se já
  //  tiver sido removido do DOM) e mantém a animação a correr
  //  indefinidamente, ignorando o estado "dismissed".
  // ─────────────────────────────────────────────
  let forced = false;
  let forcedLoaderEl = null;

  window.forceShowLoader = function (active) {
    if (active) {
      if (forced) return;
      forced = true;

      // Se o loader original ainda está no DOM (ainda não foi dispensado),
      // reusa-o; caso contrário recria-o a partir do markup guardado.
      let el = document.getElementById("page-loader");
      if (!el) {
        const wrapper = document.createElement("div");
        wrapper.innerHTML = loaderMarkup;
        el = wrapper.firstElementChild;
        if (loaderNextSibling) {
          loaderParent.insertBefore(el, loaderNextSibling);
        } else {
          loaderParent.appendChild(el);
        }
      }
      forcedLoaderEl = el;
      el.classList.remove("loader-out");

      // Reatribui as referências DOM para o (possivelmente novo) elemento
      $loader   = el;
      $loaderBg = el.querySelector("#loader-bg");
      $text     = el.querySelector("#loader-text");

      // Reinicia pulso + typewriter sobre as novas referências
      dismissed = false;
      stopPulse();
      stopTypewriter();
      $loaderBg.style.backdropFilter        = `blur(22px) saturate(120%) brightness(0.68)`;
      $loaderBg.style.webkitBackdropFilter  = `blur(22px) saturate(120%) brightness(0.68)`;
      schedulePulse();
      twRunning = true;
      currentMsgIdx = 0;
      runTypewriterCycle();
    } else {
      if (!forced) return;
      forced = false;
      stopPulse();
      stopTypewriter();
      if (forcedLoaderEl) {
        forcedLoaderEl.classList.add("loader-out");
        const elToRemove = forcedLoaderEl;
        elToRemove.addEventListener("transitionend", () => {
          // Só remove se entretanto não foi novamente forçado a aparecer
          if (!forced) elToRemove.remove();
        }, { once: true });
      }
      forcedLoaderEl = null;
    }
  };

  window.isForcedLoaderActive = function () {
    return forced;
  };

  // ─────────────────────────────────────────────
  //  PULSING BLUR — intervalo aleatório, velocidade aleatória,
  //  nunca demasiado rápido (min 900ms de transição)
  // ─────────────────────────────────────────────
  // Limites do blur (px)
  const BLUR_MIN  = 14;
  const BLUR_MAX  = 38;
  // Limites da duração da transição (ms) — nunca abaixo de 900ms
  const TRANS_MIN = 900;
  const TRANS_MAX = 3400;
  // Limites do intervalo entre pulsações (ms)
  const PAUSE_MIN = 400;
  const PAUSE_MAX = 2800;

  let pulseTimer = null;

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function nextBlur() {
    return Math.round(rand(BLUR_MIN, BLUR_MAX));
  }

  function schedulePulse() {
    const blur     = nextBlur();
    const duration = Math.round(rand(TRANS_MIN, TRANS_MAX));
    const pause    = Math.round(rand(PAUSE_MIN, PAUSE_MAX));

    // Aplica a transição de duração aleatória e o novo valor de blur
    $loaderBg.style.transition =
      `backdrop-filter ${duration}ms ease, -webkit-backdrop-filter ${duration}ms ease`;
    $loaderBg.style.backdropFilter =
      `blur(${blur}px) saturate(130%) brightness(0.65)`;
    $loaderBg.style.webkitBackdropFilter =
      `blur(${blur}px) saturate(130%) brightness(0.65)`;

    pulseTimer = setTimeout(schedulePulse, duration + pause);
  }

  // Arranca imediatamente com um valor inicial
  $loaderBg.style.backdropFilter        = `blur(22px) saturate(120%) brightness(0.68)`;
  $loaderBg.style.webkitBackdropFilter  = `blur(22px) saturate(120%) brightness(0.68)`;
  schedulePulse();

  function stopPulse() {
    clearTimeout(pulseTimer);
  }

  // ─────────────────────────────────────────────
  //  TYPEWRITER — 3 mensagens, typewriter in/out,
  //  "..." no fim fazem loop enquanto o texto está visível
  // ─────────────────────────────────────────────
  const MESSAGES = [
    "A carregar os jogos aguarda...",
    "Só demora muito á primeira vez...",
    "A fazer o website perfeito...",
  ];

  // Velocidades (ms por carácter)
  const TYPE_SPEED   = 38;  // velocidade de escrita
  const DELETE_SPEED = 22;  // velocidade de apagamento
  // Tempo que cada mensagem fica visível completa (antes de apagar) — em ms
  // A mensagem muda ao fim de 5 s desde que aparece (incluindo o tempo de escrita)
  const DISPLAY_DURATIONS = [5000, 5000, 5000];

  // Separador: tudo antes de "..." é o corpo fixo; "..." é o loop animado
  // Se a mensagem não terminar em "...", trata-se como texto simples
  function splitDots(msg) {
    if (msg.endsWith("...")) {
      return { body: msg.slice(0, -3), dots: "..." };
    }
    return { body: msg, dots: "" };
  }

  let twTimer = null;
  let twLoopTimer = null;
  let currentMsgIdx = 0;
  let twRunning = true;

  // Injeta o conteúdo no span de texto
  function setContent(bodyStr, dotsStr, cursorVisible) {
    let html = escHtml(bodyStr);
    if (dotsStr) html += `<span class="loader-dots">${escHtml(dotsStr)}</span>`;
    if (cursorVisible) html += `<span class="loader-cursor"></span>`;
    $text.innerHTML = html;
  }

  function escHtml(s) {
    return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  // Typewriter: escreve char a char, resolve com Promise
  function typeIn(body, dots) {
    return new Promise(resolve => {
      let i = 0;
      function step() {
        if (!twRunning) { resolve(); return; }
        i++;
        setContent(body.slice(0, i), "", true);
        if (i < body.length) {
          twTimer = setTimeout(step, TYPE_SPEED);
        } else {
          // corpo escrito — resolve para arrancar o loop de "..."
          twTimer = setTimeout(resolve, 80);
        }
      }
      step();
    });
  }

  // Loop dos "..." enquanto a mensagem está visível
  // Cicla "." → ".." → "..." → "" em loop durante `duration` ms
  function dotsLoop(body, duration) {
    return new Promise(resolve => {
      const DOT_SPEED = 340; // ms entre cada estado do loop
      const states    = [".", "..", "...", ""];
      let si = 2; // começa em "..."
      let elapsed = 0;

      // Mostra "..." imediatamente
      setContent(body, states[si], false);

      function tick() {
        if (!twRunning) { resolve(); return; }
        elapsed += DOT_SPEED;
        if (elapsed >= duration) { resolve(); return; }
        si = (si + 1) % states.length;
        setContent(body, states[si], false);
        twLoopTimer = setTimeout(tick, DOT_SPEED);
      }
      twLoopTimer = setTimeout(tick, DOT_SPEED);
    });
  }

  // Typewriter: apaga char a char de trás para a frente
  function typeOut(body) {
    return new Promise(resolve => {
      let full = body;
      function step() {
        if (!twRunning) { resolve(); return; }
        full = full.slice(0, -1);
        setContent(full, "", true);
        if (full.length > 0) {
          twTimer = setTimeout(step, DELETE_SPEED);
        } else {
          setContent("", "", false);
          twTimer = setTimeout(resolve, 120);
        }
      }
      step();
    });
  }

  async function runTypewriterCycle() {
    while (twRunning) {
      const msg       = MESSAGES[currentMsgIdx];
      const duration  = DISPLAY_DURATIONS[currentMsgIdx];
      const { body, dots } = splitDots(msg);

      // 1. Escreve o corpo
      await typeIn(body, dots);
      if (!twRunning) break;

      // 2. Loop dos "..." pelo tempo de display (menos o tempo de escrita já passado)
      // Calcula o tempo restante após typeIn (aprox)
      const timeSpentTyping = body.length * TYPE_SPEED + 80;
      const loopDuration = Math.max(600, duration - timeSpentTyping);
      await dotsLoop(body, loopDuration);
      if (!twRunning) break;

      // 3. Apaga tudo (corpo + dots desaparecem juntos via typeOut do corpo completo)
      setContent(body + (dots || ""), "", true);
      await typeOut(body + (dots || ""));
      if (!twRunning) break;

      // 4. Próxima mensagem
      currentMsgIdx = (currentMsgIdx + 1) % MESSAGES.length;

      // Pequena pausa entre mensagens
      await new Promise(r => { twTimer = setTimeout(r, 200); });
    }
  }

  function stopTypewriter() {
    twRunning = false;
    clearTimeout(twTimer);
    clearTimeout(twLoopTimer);
    $text.innerHTML = "";
  }

  // Arranca o ciclo
  runTypewriterCycle();

})();
