// Chargé sur toutes les pages, mais ne fait rien tant que l'extension ne lui
// dit pas que la page appartient à un scan suivi. Il surveille alors :
//  - le chapitre affiché (menu déroulant, titre…), même si le site change de
//    chapitre sans changer d'adresse (ex : anime-sama) ;
//  - la progression dans le chapitre, pour savoir quand il est lu jusqu'au bout
//    et proposer de reprendre à la bonne page la fois suivante.

if (!window.__mesScansWatching) {
  window.__mesScansWatching = true;

  let last = null; // chapitre affiché
  let lastLatest = null;
  let started = false;
  let savedPosition = null; // { chapter, progress } enregistrée la dernière fois
  let resumeOffered = false;
  let sentProgress = { chapter: null, progress: -1 };

  // Plus grand chapitre proposé dans les menus déroulants = dernier chapitre sorti
  const latestInPage = () => {
    const nums = [...document.querySelectorAll('select option')].map((o) => chapterFromText(o.textContent)).filter((n) => n !== null);
    return nums.length ? Math.max(...nums) : null;
  };

  const send = (message) => browser.runtime.sendMessage(message).catch(() => {});

  const check = () => {
    const num = chapterFromTexts(collectChapterTexts());
    if (num !== null && num !== last) {
      last = num;
      sentProgress = { chapter: num, progress: -1 };
      send({ type: 'chapter', num });
      setTimeout(offerResume, 1500); // laisser les images du chapitre se placer
    }
    const latest = latestInPage();
    if (latest !== null && latest !== lastLatest) {
      lastLatest = latest;
      send({ type: 'latest', num: latest });
    }
  };

  // ---------- Progression ----------

  const trackProgress = () => {
    if (last === null) return;
    const progress = readingProgress();
    if (progress === null) return;
    const finishedNow = progress >= FINISHED_AT && sentProgress.progress < FINISHED_AT;
    // On prévient tous les 5 %, et tout de suite quand le chapitre est fini
    if (finishedNow || Math.abs(progress - sentProgress.progress) >= 0.05) {
      sentProgress = { chapter: last, progress };
      send({ type: 'progress', num: last, progress });
    }
  };

  let scrollTimer = null;
  const onScroll = () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(trackProgress, 400);
  };

  // ---------- Reprendre la lecture ----------

  function offerResume() {
    if (resumeOffered || !savedPosition || savedPosition.chapter !== last) return;
    const { progress } = savedPosition;
    if (progress < 0.05 || progress >= FINISHED_AT) return;
    if ((readingProgress() ?? 0) > 0.1) return; // déjà plus loin dans la page
    resumeOffered = true;
    showResumeBanner(progress);
  }

  function showResumeBanner(progress) {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;';
    // Shadow DOM fermé : les styles du site ne touchent pas le bandeau, et inversement
    const root = host.attachShadow({ mode: 'closed' });
    const el = (tag, props) => Object.assign(document.createElement(tag), props);
    const style = el('style', {
      textContent: `
        .box { display:flex; align-items:center; gap:10px; padding:10px 12px 10px 16px; border-radius:12px;
               background:#181b22; color:#e8eaf0; border:1px solid #2c313c; box-shadow:0 10px 30px rgba(0,0,0,.5);
               font:600 14px/1.3 system-ui, sans-serif; }
        button { font:inherit; border:none; border-radius:8px; padding:7px 14px; cursor:pointer; }
        .go { background:#ff5c7a; color:#fff; }
        .x { background:transparent; color:#8b92a3; padding:7px 9px; }`,
    });
    const go = el('button', { className: 'go', textContent: 'Reprendre' });
    const x = el('button', { className: 'x', textContent: '✕', ariaLabel: 'Fermer' });
    const box = el('div', { className: 'box' });
    box.append(el('span', { textContent: `📖 Tu t'étais arrêté à ${Math.round(progress * 100)} % de ce chapitre` }), go, x);
    root.append(style, box);

    const close = () => host.remove();
    x.addEventListener('click', close);
    go.addEventListener('click', () => {
      close();
      resumeAt(progress);
    });
    document.documentElement.appendChild(host);
    setTimeout(close, 15000);
  }

  // Les images continuent parfois de se charger : on réajuste deux fois,
  // sauf si tu as fait défiler la page toi-même entre-temps
  function resumeAt(progress) {
    let userScrolled = false;
    const stop = () => (userScrolled = true);
    addEventListener('wheel', stop, { once: true, passive: true });
    addEventListener('touchmove', stop, { once: true, passive: true });
    const jump = () => !userScrolled && scrollTo({ top: scrollTargetFor(progress), behavior: 'instant' });
    jump();
    setTimeout(jump, 800);
    setTimeout(jump, 2000);
  }

  // ---------- Démarrage ----------

  const start = () => {
    if (started) return;
    started = true;
    check();
    document.addEventListener('change', check, true); // choix dans le menu déroulant
    document.addEventListener('click', () => setTimeout(check, 300), true); // boutons « chapitre suivant / précédent »
    addEventListener('scroll', onScroll, { passive: true });
    setInterval(check, 2000); // filet de sécurité si le site change le chapitre autrement
  };

  // L'extension peut aussi nous réveiller plus tard (scan ajouté depuis le popup,
  // navigation interne vers un chapitre suivi…)
  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'watch') {
      savedPosition ??= msg.position || null;
      start();
    }
  });

  browser.runtime.sendMessage({ type: 'isTracked' }).then((tracked) => {
    if (!tracked) return;
    savedPosition = tracked.position || null;
    start();
  }).catch(() => {});
}
