// Chargé sur toutes les pages, mais ne fait rien tant que l'extension ne lui
// dit pas que la page appartient à un scan suivi. Il surveille alors :
//  - le chapitre affiché (menu déroulant, titre…), même si le site change de
//    chapitre sans changer d'adresse (ex : anime-sama) ;
//  - la position dans le chapitre (numéro de page + endroit dans la page), pour
//    savoir quand il est lu jusqu'au bout et y revenir tout seul la fois suivante.

if (!window.__mesScansWatching) {
  window.__mesScansWatching = true;

  let last = null; // chapitre affiché
  let lastLatest = null;
  let started = false;
  let savedPosition = null; // { chapter, page, offset, progress } enregistrée la dernière fois
  let resumedChapter = null; // chapitre pour lequel la reprise a déjà eu lieu
  let sent = { chapter: null, progress: -1, page: -1 };

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
      sent = { chapter: num, progress: -1, page: -1 };
      send({ type: 'chapter', num });
      setTimeout(resume, 800); // laisser le site créer les pages du chapitre
    }
    const latest = latestInPage();
    if (latest !== null && latest !== lastLatest) {
      lastLatest = latest;
      send({ type: 'latest', num: latest });
    }
  };

  // ---------- Position dans le chapitre ----------

  const trackPosition = () => {
    if (last === null || resuming) return;
    const pos = readingPosition();
    if (!pos) return;
    const finishedNow = pos.progress >= FINISHED_AT && sent.progress < FINISHED_AT;
    // On prévient à chaque changement de page, et tout de suite quand le chapitre est fini
    if (finishedNow || pos.page !== sent.page || Math.abs(pos.progress - sent.progress) >= 0.05) {
      sent = { chapter: last, ...pos };
      savedPosition = { chapter: last, ...pos };
      send({ type: 'progress', num: last, ...pos });
    }
  };

  let scrollTimer = null;
  const onScroll = () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(trackPosition, 400);
  };

  // ---------- Reprise automatique ----------
  // En revenant sur un chapitre commencé, on se replace directement à la page où
  // tu t'étais arrêté. Les pages se chargent parfois au fil du défilement et
  // décalent la suite : on réajuste pendant quelques secondes, et on s'arrête dès
  // que tu fais défiler toi-même.

  let resuming = false;

  function resume() {
    const pos = savedPosition;
    if (!pos || pos.chapter !== last || resumedChapter === last) return;
    const begun = (pos.page ?? 0) >= 1 || (pos.offset ?? 0) > 0.3 || (pos.progress ?? 0) >= 0.05;
    if (!begun || pos.progress >= FINISHED_AT) return;
    if (scrollY > 400) return; // tu es déjà descendu dans la page
    resumedChapter = last;

    resuming = true;
    let userMoved = false;
    const stop = () => (userMoved = true);
    for (const ev of ['wheel', 'touchmove', 'keydown', 'mousedown']) addEventListener(ev, stop, { once: true, passive: true });

    let tries = 0;
    const tick = () => {
      if (userMoved || tries++ > 20) {
        resuming = false;
        return;
      }
      scrollToPosition(pos);
      setTimeout(tick, 300);
    };
    tick();
    showResumeToast(pos);
  }

  // Petit message discret en bas de la page, avec « Revenir au début »
  function showResumeToast(pos) {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;';
    // Shadow DOM fermé : les styles du site ne touchent pas le message, et inversement
    const root = host.attachShadow({ mode: 'closed' });
    const el = (tag, props) => Object.assign(document.createElement(tag), props);
    const style = el('style', {
      textContent: `
        .box { display:flex; align-items:center; gap:10px; padding:9px 10px 9px 16px; border-radius:12px;
               background:#181b22; color:#e8eaf0; border:1px solid #2c313c; box-shadow:0 10px 30px rgba(0,0,0,.5);
               font:600 14px/1.3 system-ui, sans-serif; transition:opacity .4s; }
        button { font:inherit; font-weight:600; border:none; border-radius:8px; padding:6px 12px; cursor:pointer;
                 background:#2c313c; color:#e8eaf0; }
        button:hover { background:#3a404d; }`,
    });
    const where = pos.page != null && pos.pages ? `page ${pos.page + 1}/${pos.pages}` : `${Math.round(pos.progress * 100)} %`;
    const top = el('button', { textContent: 'Revenir au début' });
    const box = el('div', { className: 'box' });
    box.append(el('span', { textContent: `📖 Repris où tu t'étais arrêté (${where})` }), top);
    root.append(style, box);
    document.documentElement.appendChild(host);

    top.addEventListener('click', () => {
      resuming = false;
      scrollTo({ top: 0, behavior: 'instant' });
      host.remove();
    });
    setTimeout(() => (box.style.opacity = '0'), 6000);
    setTimeout(() => host.remove(), 6500);
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
