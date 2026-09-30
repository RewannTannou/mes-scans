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
  browser.tabs.sendMessage(tab.id, { type: 'watch', position: scan.position || null }).catch(() => {});

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
  // Réponse : false, ou la position enregistrée (pour proposer de reprendre la lecture)
  if (msg.type === 'isTracked') return findTracked(sender.tab).then((hit) => hit && { position: hit.scan.position || null });
  if (msg.type === 'progress' && sender.tab) enqueue(() => recordProgress(sender.tab, msg.num, msg.progress));
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
  const outcomes = {}; // site -> a répondu au moins une fois pendant cette vérification ?
  const report = (link, ok) => {
    const host = siteName(link);
    outcomes[host] = outcomes[host] || ok;
  };
  for (const scan of await loadScans()) {
    if (scan.status === 'done' || scan.status === 'dropped' || !hasSource(scan)) continue;
    try {
      const latest = await fetchLatestChapter(scan, report);
      if (latest !== null) await enqueue(() => updateLatest(scan.id, latest.num, latest.link));
    } catch (err) {
      console.warn(`Vérification impossible pour « ${scan.title} »`, err);
    }
  }
  await recordSiteHealth(outcomes);
  await browser.storage.local.set({ lastCheck: new Date().toISOString() });
}

// État de santé des sites : siteHealth = { 'phenix-scans.co': { lastOk, lastFail, failures }, … }
// failures = vérifications ratées d'affilée (la bibliothèque prévient à partir de 3).
async function recordSiteHealth(outcomes) {
  if (!Object.keys(outcomes).length) return;
  const { siteHealth = {} } = await browser.storage.local.get('siteHealth');
  const now = new Date().toISOString();
  for (const [host, ok] of Object.entries(outcomes)) {
    const h = (siteHealth[host] ??= { failures: 0 });
    if (ok) Object.assign(h, { lastOk: now, failures: 0 });
    else Object.assign(h, { lastFail: now, failures: h.failures + 1 });
  }
  await browser.storage.local.set({ siteHealth });
}

// link : le lien (site) où le chapitre est sorti
async function updateLatest(id, latest, link) {
  const scans = await loadScans();
  const scan = scans.find((s) => s.id === id);
  if (!scan || scan.latest === latest) return;
  const previous = scan.latest;
  scan.latest = latest;
  await saveScans(scans);
  // Première vérification (previous inconnu) : ce n'est pas une sortie, juste l'état actuel
  if (previous != null && latest > previous) {
    await logRelease({ id, from: previous, to: latest, link: link || scan.url });
    notifyNewChapter(scan, latest - previous);
  }
}

// Journal des sorties, du plus récent au plus ancien :
// releases = [{ id, from: 268, to: 270, link, at }, …] (« chapitres 269 à 270 sortis »)
const MAX_RELEASES = 300;

async function logRelease(release) {
  const { releases = [] } = await browser.storage.local.get('releases');
  releases.unshift({ ...release, at: new Date().toISOString() });
  await browser.storage.local.set({ releases: releases.slice(0, MAX_RELEASES) });
}

// Quand tu visites la page, content.js nous donne le plus grand chapitre de la
// liste affichée : utile pour les sites que la vérification n'arrive pas à lire
// (protection anti-robots…), ou pour voir une sortie avant la prochaine vérification.
async function recordLatestFromPage(tab, num) {
  const hit = await findTracked(tab);
  if (hit && num > (hit.scan.latest ?? 0)) await updateLatest(hit.scan.id, num, hit.link);
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
  if (scan.pub.id && !scan.pub.genres) return true; // fiches d'avant l'ajout des genres
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

// ---------- Progression dans le chapitre ----------
// content.js envoie la progression (0 à 1) dans le chapitre affiché : on garde la
// position pour proposer de reprendre, et on note le chapitre comme terminé
// quand il est lu jusqu'au bout.

async function recordProgress(tab, num, progress) {
  const hit = await findTracked(tab);
  if (!hit || hit.scan.chapter !== num) return; // position seulement pour le chapitre en cours
  const { scans, scan } = hit;
  scan.position = { chapter: num, progress: Math.round(progress * 100) / 100, at: new Date().toISOString() };
  if (progress >= FINISHED_AT && num > (scan.lastFinished ?? -Infinity)) scan.lastFinished = num;
  await saveScans(scans);
}

// ---------- Historique de lecture (statistiques) ----------
// Un chapitre compte comme lu quand il est terminé : lu jusqu'au bout, ou quand
// on passe au suivant (voir finishedChapters). On note combien de chapitres ont
// été terminés chaque jour : history = { '2026-09-25': { idDuScan: 3, … }, … }.
// Relire un ancien chapitre ne compte pas, et un bond de plus de 10 chapitres
// d'un coup est une correction (import, chapitre tapé à la main), pas une lecture.

const MAX_READ_JUMP = 10;
const HISTORY_DAYS = 400;

function todayKey() {
  return new Date().toLocaleDateString('sv'); // AAAA-MM-JJ, à l'heure locale
}

browser.storage.onChanged.addListener((changes) => {
  const { oldValue, newValue } = changes[STORAGE_KEY] || {};
  if (!oldValue || !newValue) return;
  const before = new Map(oldValue.map((s) => [s.id, finishedChapters(s)]));
  const reads = [];
  for (const scan of newValue) {
    if (!before.has(scan.id)) continue; // scan qui vient d'être ajouté
    const delta = finishedChapters(scan) - before.get(scan.id);
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

// ---------- Trouver un site pour les scans sans lien ----------
// Mangas ajoutés depuis « Découvrir » ou importés d'AniList : on les cherche
// sur anime-sama, un par un. Chaque scan n'est cherché qu'une fois
// (scan.sourceSearchedAt), pour ne pas insister quand il n'y est pas.

let findingSources = null;

function findMissingSources() {
  findingSources ??= runFindSources().finally(() => (findingSources = null));
  return findingSources;
}

async function runFindSources() {
  const scans = await loadScans();
  const host = animeSamaHost(scans);
  for (const scan of scans.filter((s) => !s.url && !s.sourceSearchedAt)) {
    let url = null;
    try {
      url = await findOnAnimeSama([scan.title, ...(scan.pub?.titles || [])], host);
    } catch (err) {
      console.warn(`anime-sama indisponible pour « ${scan.title} »`, err);
      return; // on réessaiera plus tard
    }
    await enqueue(async () => {
      const fresh = await loadScans();
      const s = fresh.find((x) => x.id === scan.id);
      if (!s || s.url) return;
      s.sourceSearchedAt = new Date().toISOString();
      if (url) s.url = url;
      await saveScans(fresh);
    });
    await new Promise((r) => setTimeout(r, 1500)); // ne pas surcharger le site
  }
}

browser.storage.onChanged.addListener((changes) => {
  const scans = changes[STORAGE_KEY]?.newValue;
  if (scans?.some((s) => !s.url && !s.sourceSearchedAt)) findMissingSources();
});
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'check-new-chapters') findMissingSources();
});

// ---------- Clic droit « Ajouter à Mes Scans » ----------

function createMenus() {
  browser.menus.removeAll().then(() => {
    browser.menus.create({ id: 'add-link', title: 'Ajouter ce lien à Mes Scans', contexts: ['link'] });
    browser.menus.create({ id: 'add-page', title: 'Ajouter cette page à Mes Scans', contexts: ['page'] });
  });
}
browser.runtime.onInstalled.addListener(createMenus);
browser.runtime.onStartup.addListener(createMenus);

browser.menus.onClicked.addListener((info, tab) => {
  const isLink = info.menuItemId === 'add-link';
  if (!isLink && info.menuItemId !== 'add-page') return;
  const url = isLink ? info.linkUrl : tab.url;
  const title = isLink ? info.linkText : tab.title;
  enqueue(() => addScanFromPage(url, title));
});

// Ajoute (ou retrouve) le scan d'une adresse et prévient par une notification
async function addScanFromPage(url, rawTitle) {
  if (!/^https?:/.test(url || '')) return;
  const scans = await loadScans();
  const existing = matchScan(scans, url)?.scan || findByTitle(scans, cleanTitle(rawTitle, url));
  if (existing) {
    notify('Déjà dans ta liste', `${existing.title} — chapitre ${formatChapter(existing.chapter)}`);
    return;
  }
  const detected = detectChapter(url);
  const scan = {
    id: crypto.randomUUID(),
    title: cleanTitle(rawTitle, url) || siteName(url),
    url: detected ? detected.template : url,
    altUrls: [],
    chapter: detected ? detected.num : 0,
    status: detected ? 'reading' : 'plan',
    cover: '', // la couverture AniList sera ajoutée automatiquement
    lastRead: detected ? new Date().toISOString() : null,
    createdAt: new Date().toISOString(),
  };
  scans.push(scan);
  await saveScans(scans);
  notify('Ajouté à Mes Scans', detected ? `${scan.title} — chapitre ${formatChapter(scan.chapter)}` : scan.title);
}

function notify(title, message) {
  browser.notifications.create({ type: 'basic', iconUrl: 'icons/icon-96.png', title, message });
}

// ---------- Résumé de la semaine ----------
// Une fois par semaine, une notification résume les sorties et tes lectures.
// (La première fois, on ne fait que noter la date : le résumé arrive 7 jours après.)

const DIGEST_EVERY_DAYS = 7;

async function weeklyDigestIfNeeded() {
  const { lastDigest, releases = [], history = {} } = await browser.storage.local.get(['lastDigest', 'releases', 'history']);
  const now = Date.now();
  if (!lastDigest) {
    await browser.storage.local.set({ lastDigest: new Date(now).toISOString() });
    return;
  }
  if (now - new Date(lastDigest) < DIGEST_EVERY_DAYS * 86400000) return;
  await browser.storage.local.set({ lastDigest: new Date(now).toISOString() });
  if (!(await loadSettings()).notify) return;

  const since = now - DIGEST_EVERY_DAYS * 86400000;
  const recent = releases.filter((r) => new Date(r.at) >= since);
  const released = recent.reduce((a, r) => a + Math.max(1, Math.round(r.to - r.from)), 0);
  const mangas = new Set(recent.map((r) => r.id)).size;
  let read = 0;
  for (let i = 0; i < DIGEST_EVERY_DAYS; i++) {
    const day = new Date(now - i * 86400000).toLocaleDateString('sv');
    read += Object.values(history[day] || {}).reduce((a, b) => a + b, 0);
  }
  if (!released && !read) return;
  const parts = [];
  if (released) parts.push(`${released} nouveau${released > 1 ? 'x' : ''} chapitre${released > 1 ? 's' : ''} sur ${mangas} manga${mangas > 1 ? 's' : ''}`);
  if (read) parts.push(`tu en as lu ${read}${read >= 20 ? ' 🔥' : ''}`);
  browser.notifications.create('digest', {
    type: 'basic',
    iconUrl: 'icons/icon-96.png',
    title: 'Ta semaine de lecture',
    message: `${parts.join(' · ')}.`,
  });
}

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'check-new-chapters') weeklyDigestIfNeeded();
});
browser.notifications.onClicked.addListener((id) => {
  if (id !== 'digest') return;
  openDashboard();
  browser.notifications.clear(id);
});
