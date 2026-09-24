// Chargé sur toutes les pages, mais ne fait rien tant que l'extension ne lui
// dit pas que la page appartient à un scan suivi. Il surveille alors le chapitre
// affiché (menu déroulant, titre…) et prévient l'extension dès qu'il change,
// même si le site change de chapitre sans changer d'adresse (ex : anime-sama).

if (!window.__mesScansWatching) {
  window.__mesScansWatching = true;

  let last = null;
  let lastLatest = null;
  let started = false;

  // Plus grand chapitre proposé dans les menus déroulants = dernier chapitre sorti
  const latestInPage = () => {
    const nums = [...document.querySelectorAll('select option')].map((o) => chapterFromText(o.textContent)).filter((n) => n !== null);
    return nums.length ? Math.max(...nums) : null;
  };

  const check = () => {
    const num = chapterFromTexts(collectChapterTexts());
    if (num !== null && num !== last) {
      last = num;
      browser.runtime.sendMessage({ type: 'chapter', num }).catch(() => {});
    }
    const latest = latestInPage();
    if (latest !== null && latest !== lastLatest) {
      lastLatest = latest;
      browser.runtime.sendMessage({ type: 'latest', num: latest }).catch(() => {});
    }
  };

  const start = () => {
    if (started) return;
    started = true;
    check();
    document.addEventListener('change', check, true); // choix dans le menu déroulant
    document.addEventListener('click', () => setTimeout(check, 300), true); // boutons « chapitre suivant / précédent »
    setInterval(check, 2000); // filet de sécurité si le site change le chapitre autrement
  };

  // L'extension peut aussi nous réveiller plus tard (scan ajouté depuis le popup,
  // navigation interne vers un chapitre suivi…)
  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'watch') start();
  });

  browser.runtime.sendMessage({ type: 'isTracked' }).then((tracked) => tracked && start()).catch(() => {});
}
