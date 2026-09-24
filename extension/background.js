// Surveille les pages visitées : si c'est un chapitre d'un scan suivi,
// on enregistre ce chapitre (en avant comme en arrière) et la date de lecture.
//
// Le chapitre est cherché, dans l'ordre :
//   1. dans l'adresse (…/chapitre/63)
//   2. dans le titre de l'onglet (« Solo Leveling - Chapitre 63 »)
//   3. dans la page elle-même, grâce à content.js, qui prévient dès que le
//      chapitre affiché change (même quand l'adresse ne change pas)

async function findTracked(tab) {
  if (!tab?.url || !/^https?:/.test(tab.url)) return null;
  const scans = await loadScans();
  const hit = matchScan(scans, tab.url) || matchByPageTitle(scans, tab);
  return hit ? { scans, ...hit } : null;
}

// num : chapitre trouvé dans la page (ou null) ; visited : true si c'est une nouvelle page
async function recordChapter(tab, num, visited) {
  const hit = await findTracked(tab);
  if (!hit) return;

  const { scans, scan } = hit;
  num = num ?? hit.num ?? chapterFromText(tab.title);

  // Le site a changé de domaine : on corrige tous ses liens
  let link = hit.link;
  if (hit.moved) {
    renameHost(scans, hit.moved.from, hit.moved.to);
    link = withHost(link, hit.moved.to);
  }
  // Tu lis sur ce site-là : « Lire » l'ouvrira désormais
  const switchedSite = link !== scan.url;
  promoteLink(scan, link);

  const changed = num !== null && num !== scan.chapter;
  if (changed) scan.chapter = num;
  if (changed || visited || hit.moved || switchedSite) {
    scan.lastRead = new Date().toISOString();
    if (scan.status === 'plan') scan.status = 'reading';
    await saveScans(scans);
  }

  // Page d'un scan suivi : on demande à content.js de surveiller le chapitre
  browser.tabs.sendMessage(tab.id, { type: 'watch' }).catch(() => {});

  // Badge sur l'icône : vert = chapitre détecté, bleu = scan reconnu mais chapitre introuvable
  browser.action.setBadgeText({ tabId: tab.id, text: formatChapter(num ?? scan.chapter) });
  browser.action.setBadgeBackgroundColor({ tabId: tab.id, color: num !== null ? '#4cc38a' : '#5b9cff' });
}

// Les événements arrivent en rafale (adresse, titre, page) : on les traite un
// par un pour ne pas écraser une mise à jour avec une autre.
let queue = Promise.resolve();
const enqueue = (fn) => (queue = queue.then(fn).catch(console.error));

browser.tabs.onUpdated.addListener(
  (tabId, changeInfo, tab) => enqueue(() => recordChapter(tab, null, Boolean(changeInfo.url))),
  { properties: ['url', 'title'] }
);

browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'isTracked') return findTracked(sender.tab).then(Boolean);
  if (msg.type === 'chapter' && sender.tab) enqueue(() => recordChapter(sender.tab, msg.num, false));
  if (msg.type === 'latest' && sender.tab) enqueue(() => recordLatestFromPage(sender.tab, msg.num));
  if (msg.type === 'checkNow') return Promise.all([checkNewChapters(), refreshPublications()]);
  if (msg.type === 'backupNow') return backupIfNeeded(true);
});

// Extension installée / rechargée, ou permission accordée après coup (bouton du
// popup) : on lance content.js dans les onglets déjà ouverts, sans attendre
// qu'ils soient rechargés.
async function injectIntoOpenTabs() {
  for (const tab of await browser.tabs.query({ url: ['*://*/*'] })) {
    browser.scripting.executeScript({ target: { tabId: tab.id }, files: ['shared.js', 'content.js'] }).catch(() => {});
  }
}
browser.runtime.onInstalled.addListener(injectIntoOpenTabs);
browser.permissions.onAdded.addListener(injectIntoOpenTabs);

// ---------- Nouveaux chapitres ----------
// Toutes les heures, on demande à chaque site (voir sources.js) son dernier
// chapitre. scan.latest sert à afficher « X à lire » et à prévenir des sorties.

const CHECK_EVERY_MINUTES = 60;
let checking = null;

function checkNewChapters() {
  // Une seule vérification à la fois (alarme + bouton « Vérifier » en même temps…)
  checking ??= runCheck().finally(() => (checking = null));
  return checking;
}

async function runCheck() {
  for (const scan of await loadScans()) {
    if (scan.status === 'done' || scan.status === 'dropped' || !hasSource(scan)) continue;
    try {
      const latest = await fetchLatestChapter(scan);
      if (latest !== null) await enqueue(() => updateLatest(scan.id, latest));
    } catch (err) {
      console.warn(`Vérification impossible pour « ${scan.title} »`, err);
    }
  }
  await browser.storage.local.set({ lastCheck: new Date().toISOString() });
}

async function updateLatest(id, latest) {
  const scans = await loadScans();
  const scan = scans.find((s) => s.id === id);
  if (!scan || scan.latest === latest) return;
  const previous = scan.latest;
  scan.latest = latest;
  await saveScans(scans);
  if (previous != null && latest > previous) notifyNewChapter(scan, latest - previous);
}

// Quand tu visites la page, content.js nous donne le plus grand chapitre de la
// liste affichée : utile pour les sites que la vérification n'arrive pas à lire
// (protection anti-robots…), ou pour voir une sortie avant la prochaine vérification.
async function recordLatestFromPage(tab, num) {
  const hit = await findTracked(tab);
  if (hit && num > (hit.scan.latest ?? 0)) await updateLatest(hit.scan.id, num);
}

async function notifyNewChapter(scan, count) {
  if (scan.status !== 'reading' || !(await loadSettings()).notify) return;
  browser.notifications.create(`scan:${scan.id}`, {
    type: 'basic',
    iconUrl: 'icons/icon-96.png',
    title: count > 1 ? `${count} nouveaux chapitres` : 'Nouveau chapitre',
    message: `${scan.title} : chapitre ${formatChapter(scan.latest)} disponible (tu en es au ${formatChapter(scan.chapter)})`,
  });
}

// Clic sur la notification : on ouvre le scan là où tu en es
browser.notifications.onClicked.addListener(async (id) => {
  if (!id.startsWith('scan:')) return;
  const scan = (await loadScans()).find((s) => `scan:${s.id}` === id);
  if (scan?.url) browser.tabs.create({ url: chapterUrl(scan) });
  browser.notifications.clear(id);
});

function scheduleChecks() {
  browser.alarms.create('check-new-chapters', { delayInMinutes: 1, periodInMinutes: CHECK_EVERY_MINUTES });
}
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'check-new-chapters') checkNewChapters();
});
browser.runtime.onInstalled.addListener(scheduleChecks);
browser.runtime.onStartup.addListener(scheduleChecks);

// Compteur rouge sur l'icône : nombre de scans « En cours » avec des chapitres à lire
async function updateGlobalBadge() {
  const count = (await loadScans()).filter((s) => s.status === 'reading' && unreadCount(s) > 0).length;
  browser.action.setBadgeText({ text: count ? String(count) : '' });
  browser.action.setBadgeBackgroundColor({ color: '#ff5c7a' });
}
browser.storage.onChanged.addListener((changes) => {
  if (changes[STORAGE_KEY]) updateGlobalBadge();
});
updateGlobalBadge();

// ---------- État de parution (AniList) ----------
// Cherché dès qu'un scan est ajouté (ou que tu changes sa fiche AniList),
// puis rafraîchi une fois par semaine.

const PUB_REFRESH_DAYS = 7;
let refreshingPub = null;

function needsPublication(scan) {
  if (!scan.pub?.checkedAt) return true;
  return Date.now() - new Date(scan.pub.checkedAt) > PUB_REFRESH_DAYS * 86400000;
}

function refreshPublications() {
  refreshingPub ??= runPublicationRefresh().finally(() => (refreshingPub = null));
  return refreshingPub;
}

async function runPublicationRefresh() {
  for (const scan of (await loadScans()).filter(needsPublication)) {
    try {
      const pub = await fetchPublication(scan);
      await enqueue(async () => {
        const scans = await loadScans();
        const s = scans.find((x) => x.id === scan.id);
        if (!s) return;
        s.pub = pub;
        if (!s.cover && pub.cover) s.cover = pub.cover; // couverture officielle si tu n'en as pas mis
        await saveScans(scans);
      });
    } catch (err) {
      console.warn(`AniList indisponible pour « ${scan.title} »`, err);
      return; // on réessaiera à la prochaine vérification
    }
    await new Promise((r) => setTimeout(r, 2500)); // AniList limite le nombre de requêtes par minute
  }
}

// Nouveau scan (ou fiche modifiée) : on va chercher son état sans attendre
browser.storage.onChanged.addListener((changes) => {
  const scans = changes[STORAGE_KEY]?.newValue;
  if (scans?.some((s) => !s.pub?.checkedAt)) refreshPublications();
});
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'check-new-chapters') refreshPublications();
});

// ---------- Raccourcis clavier ----------
// Alt+Maj+↑ / Alt+Maj+↓ sur la page d'un scan : chapitre suivant / précédent.
// (Modifiables dans about:addons > roue dentée > Gérer les raccourcis.)

browser.commands.onCommand.addListener(async (command) => {
  const delta = { 'chapter-next': 1, 'chapter-prev': -1 }[command];
  if (!delta) return;
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  enqueue(async () => {
    const hit = await findTracked(tab);
    if (!hit) return;
    hit.scan.chapter = Math.max(0, hit.scan.chapter + delta);
    hit.scan.lastRead = new Date().toISOString();
    await saveScans(hit.scans);
    browser.action.setBadgeText({ tabId: tab.id, text: formatChapter(hit.scan.chapter) });
    browser.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#4cc38a' });
  });
});

// ---------- Historique de lecture (statistiques) ----------
// À chaque fois que le chapitre d'un scan avance, on note combien de chapitres
// ont été lus ce jour-là : history = { '2026-09-25': { idDuScan: 3, … }, … }.
// Un bond de plus de 10 chapitres d'un coup est une correction (import,
// chapitre tapé à la main), pas une lecture : on ne le compte pas.

const MAX_READ_JUMP = 10;
const HISTORY_DAYS = 400;

function todayKey() {
  return new Date().toLocaleDateString('sv'); // AAAA-MM-JJ, à l'heure locale
}

browser.storage.onChanged.addListener((changes) => {
  const { oldValue, newValue } = changes[STORAGE_KEY] || {};
  if (!oldValue || !newValue) return;
  const before = new Map(oldValue.map((s) => [s.id, s.chapter]));
  const reads = [];
  for (const scan of newValue) {
    const delta = scan.chapter - (before.get(scan.id) ?? scan.chapter);
    if (delta > 0 && delta <= MAX_READ_JUMP) reads.push([scan.id, Math.ceil(delta)]);
  }
  if (reads.length) enqueue(() => addToHistory(reads));
});

async function addToHistory(reads) {
  const { history = {} } = await browser.storage.local.get('history');
  const day = (history[todayKey()] ??= {});
  for (const [id, n] of reads) day[id] = (day[id] || 0) + n;
  // On ne garde qu'un peu plus d'un an
  const oldest = new Date(Date.now() - HISTORY_DAYS * 86400000).toLocaleDateString('sv');
  for (const key of Object.keys(history)) if (key < oldest) delete history[key];
  await browser.storage.local.set({ history });
}

// ---------- Sauvegarde automatique ----------
// Une fois par semaine, un fichier de sauvegarde est enregistré dans
// Téléchargements/MesScans/ (le même format que le bouton « Exporter »).

const BACKUP_EVERY_DAYS = 7;

async function backupIfNeeded(force = false) {
  const settings = await loadSettings();
  if (!force && !settings.backup) return;
  const { lastBackup, history } = await browser.storage.local.get(['lastBackup', 'history']);
  if (!force && lastBackup && Date.now() - new Date(lastBackup) < BACKUP_EVERY_DAYS * 86400000) return;

  const scans = await loadScans();
  if (!scans.length) return;
  const blob = new Blob([JSON.stringify({ scans, history: history || {} }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    await browser.downloads.download({
      url,
      filename: `MesScans/mes-scans-${todayKey()}.json`,
      conflictAction: 'overwrite',
      saveAs: false,
    });
    await browser.storage.local.set({ lastBackup: new Date().toISOString() });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'check-new-chapters') backupIfNeeded();
});
