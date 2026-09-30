// Code partagé entre le tableau de bord, le popup, le script d'arrière-plan
// et content.js. `var` plutôt que `const` : ce fichier peut être injecté deux
// fois dans la même page, et redéclarer un `const` y provoquerait une erreur.

var STORAGE_KEY = 'scans';

var STATUSES = {
  reading: { label: 'En cours', color: 'var(--reading)' },
  plan:    { label: 'À lire',   color: 'var(--plan)' },
  paused:  { label: 'En pause', color: 'var(--paused)' },
  done:    { label: 'Terminé',  color: 'var(--done)' },
  dropped: { label: 'Abandonné', color: 'var(--dropped)' },
};

// ---------- Stockage ----------

async function loadScans() {
  const data = await browser.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY] || [];
}

function saveScans(scans) {
  return browser.storage.local.set({ [STORAGE_KEY]: scans });
}

var DEFAULT_SETTINGS = { notify: true, backup: true, theme: 'dark' };

// Thème des pages de l'extension : 'dark', 'light' ou 'auto' (comme le système).
// Gardé aussi dans le localStorage de la page pour s'appliquer avant le premier affichage.
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('mes-scans:theme', theme);
  } catch {
    // stockage indisponible : le thème sera appliqué un peu plus tard, au chargement des réglages
  }
}

// Pages de l'extension uniquement (ce fichier est aussi chargé dans les sites visités)
if (typeof location !== 'undefined' && location.protocol === 'moz-extension:' && typeof document !== 'undefined') {
  try {
    const theme = localStorage.getItem('mes-scans:theme');
    if (theme) document.documentElement.dataset.theme = theme;
  } catch {
    // pas de thème mémorisé
  }
  loadSettings().then((s) => applyTheme(s.theme)).catch(() => {});
}

async function loadSettings() {
  const { settings } = await browser.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...settings };
}

function saveSettings(settings) {
  return browser.storage.local.set({ settings });
}

// État de parution du manga lui-même (source : AniList), stocké dans scan.pub
var PUB_STATUSES = {
  RELEASING: { label: 'En cours de parution', short: 'En cours', color: 'var(--reading)' },
  FINISHED: { label: 'Terminé', short: 'Terminé', color: 'var(--done)' },
  HIATUS: { label: 'En pause (hiatus)', short: 'Hiatus', color: 'var(--paused)' },
  CANCELLED: { label: 'Arrêté', short: 'Arrêté', color: 'var(--dropped)' },
  NOT_YET_RELEASED: { label: 'Pas encore sorti', short: 'À venir', color: 'var(--plan)' },
};

// Lien de fiche AniList -> identifiant (https://anilist.co/manga/105393/… -> 105393)
function anilistIdFromUrl(url) {
  const m = (url || '').match(/anilist\.co\/manga\/(\d+)/);
  return m ? Number(m[1]) : null;
}

// Nombre de chapitres sortis que tu n'as pas encore lus (null si inconnu).
// scan.latest = dernier chapitre disponible, rempli par la vérification des nouveautés.
function unreadCount(scan) {
  if (scan.latest == null) return null;
  return Math.max(0, Math.ceil(scan.latest - scan.chapter));
}

// ---------- Liens de chapitre ----------

// Trouve le numéro de chapitre dans une URL et renvoie un modèle avec {ch}
// pour que le bouton « Lire » suive automatiquement le chapitre actuel.
// Ex : https://site.com/one-piece/chapitre-1100/  ->  https://site.com/one-piece/chapitre-{ch}/
function detectChapter(url) {
  if (!url) return null;
  const keyword = /(chap(?:ter|itre)?|ch|episode|ep|scan)([-_/.\s]*)(\d+(?:[.,]\d+)?)(?![A-Za-z0-9])/i;
  let m = url.match(keyword);
  if (m) {
    const start = m.index + m[1].length + m[2].length;
    return { num: parseFloat(m[3].replace(',', '.')), template: url.slice(0, start) + '{ch}' + url.slice(start + m[3].length) };
  }
  // Sinon : dernier segment du chemin entièrement numérique (ex : /one-piece/1100/)
  m = url.match(/\/(\d+(?:\.\d+)?)\/?(?:[?#].*)?$/);
  if (m) {
    const start = m.index + 1;
    return { num: parseFloat(m[1]), template: url.slice(0, start) + '{ch}' + url.slice(start + m[1].length) };
  }
  return null;
}

function formatChapter(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

function chapterUrl(scan) {
  if (!scan.url) return '';
  return scan.url.replace('{ch}', formatChapter(scan.chapter));
}

function siteName(url) {
  try {
    return new URL(url.replace('{ch}', '0')).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// ---------- Liens d'un scan ----------
// scan.url     = lien principal : celui qu'ouvre « Lire » (le dernier site utilisé)
// scan.altUrls = les autres sites où tu lis ce manga

function scanLinks(scan) {
  return [scan.url, ...(scan.altUrls || [])].filter(Boolean);
}

// Remplace le domaine d'un lien (en gardant le {ch})
function withHost(link, host) {
  try {
    const u = new URL(link.replace('{ch}', '__ch__'));
    u.hostname = host;
    return u.href.replace('__ch__', '{ch}');
  } catch {
    return link;
  }
}

// Le site a changé de domaine (anime-sama.to -> anime-sama.fr) : on met à jour
// tous les liens de ce site, dans tous les scans.
function renameHost(scans, from, to) {
  for (const scan of scans) {
    const fix = (link) => (siteName(link) === from ? withHost(link, to) : link);
    scan.url = scan.url && fix(scan.url);
    if (scan.altUrls) scan.altUrls = scan.altUrls.map(fix);
  }
}

// Le lien devient le principal (« Lire » ouvrira ce site)
function promoteLink(scan, link) {
  if (!link || link === scan.url) return;
  scan.altUrls = [scan.url, ...(scan.altUrls || [])].filter((l) => l && l !== link);
  scan.url = link;
}

// « anime-sama.to » -> « anime-sama » : sert à reconnaître un site qui a changé d'extension
function hostLabel(host) {
  const parts = host.split('.');
  return parts.length > 1 ? parts.slice(0, -1).join('.') : host;
}

// Réduit une URL à « domaine + chemin » pour comparer sans se soucier
// de http/https, www, de la barre finale ou des paramètres (?page=2…).
// loose : ignore aussi l'extension du domaine (.to, .fr, .co…)
function normalizeUrl(url, loose = false) {
  try {
    const u = new URL(url);
    let host = u.hostname.replace(/^www\./, '');
    if (loose) host = hostLabel(host);
    return (host + u.pathname).replace(/\/+$/, '').toLowerCase();
  } catch {
    return '';
  }
}

var CHAPTER_SUFFIX = /(?:[-_/.\s]+(?:chap(?:ter|itre)?|ch|episode|ep|scan))?[-_/.\s]*$/i;

// Adresse « de la série » d'un lien : ce qui précède le chapitre.
// phenix-scans.co/manga/a-returners-magic/chapitre/{ch}  ->  phenix-scans.co/manga/a-returners-magic
// Pour un lien sans {ch}, c'est simplement le lien enregistré.
function seriesKey(link, loose = false) {
  const norm = normalizeUrl(link.replace('{ch}', '__ch__'), loose);
  if (!norm.includes('__ch__')) return norm;
  return norm.split('__ch__')[0].replace(CHAPTER_SUFFIX, '');
}

// Même chose, mais en gardant l'adresse complète (pour aller chercher la page)
function seriesUrl(link) {
  return link.includes('{ch}') ? link.split('{ch}')[0].replace(CHAPTER_SUFFIX, '') : link;
}

// Expression qui reconnaît les pages de chapitre d'un lien modèle, ou null
function chapterPattern(link, loose = false) {
  if (!link.includes('{ch}')) return null;
  const pattern = normalizeUrl(link.replace('{ch}', '__ch__'), loose);
  if (!pattern.includes('__ch__')) return null;
  const [before, after] = pattern.split('__ch__').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${before}(\\d+(?:[.,]\\d+)?)${after}$`);
}

function normalizeTitle(t) {
  return (t || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
}

function matchLinks(scans, pageUrl, loose) {
  const page = normalizeUrl(pageUrl, loose);
  if (!page) return null;

  // 1. Page de chapitre dont l'adresse suit exactement un modèle enregistré
  for (const scan of scans) {
    for (const link of scanLinks(scan)) {
      const m = chapterPattern(link, loose)?.exec(page);
      if (m) return { scan, link, num: parseFloat(m[1].replace(',', '.')) };
    }
  }

  // 2. Page qui fait partie de la série (même lien, ou une sous-page)
  let best = null;
  for (const scan of scans) {
    for (const link of scanLinks(scan)) {
      const key = seriesKey(link, loose);
      if (!key.includes('/')) continue; // juste un nom de domaine : trop large
      if ((page === key || page.startsWith(key + '/')) && (!best || key.length > best.key.length)) {
        best = { scan, link, key };
      }
    }
  }
  return best ? { scan: best.scan, link: best.link, num: null } : null;
}

// Cherche parmi les scans suivis celui qui correspond à la page visitée.
// Renvoie { scan, link, num, moved } :
//   num   = chapitre lu dans l'adresse, ou null s'il n'y apparaît pas
//   link  = lien du scan qui correspond (utile quand il y a plusieurs sites)
//   moved = { from, to } si le site a changé de domaine depuis l'enregistrement
// Renvoie null si rien ne correspond.
function matchScan(scans, pageUrl) {
  const hit = matchLinks(scans, pageUrl, false) || matchLinks(scans, pageUrl, true);
  if (!hit) return null;
  const from = siteName(hit.link);
  const to = new URL(pageUrl).hostname;
  return from !== to.replace(/^www\./, '') ? { ...hit, moved: { from, to } } : hit;
}

function findByTitle(scans, title) {
  const t = normalizeTitle(title);
  return t ? scans.find((s) => normalizeTitle(s.title) === t) : null;
}

// Scan du même site dont le titre apparaît dans le titre de l'onglet.
// Ex : onglet « Ch. 63 - Solo Leveling - MangaDex » sur mangadex.org -> Solo Leveling
function matchByPageTitle(scans, tab) {
  const host = siteName(tab.url);
  const pageTitle = normalizeTitle(tab.title);
  if (!host || !pageTitle) return null;
  let best = null;
  for (const scan of scans) {
    const t = normalizeTitle(scan.title);
    const link = scanLinks(scan).find((l) => siteName(l) === host);
    if (t.length < 3 || !link || !pageTitle.includes(t)) continue;
    if (!best || t.length > normalizeTitle(best.scan.title).length) best = { scan, link, num: null };
  }
  return best;
}

// Numéro de chapitre écrit dans un texte : « Chapitre 63 », « Ch. 12.5 », « Episode 4 »…
function chapterFromText(text) {
  const m = (text || '').match(/(?:^|[^a-z])(?:chap(?:ter|itre)?|ch|episode|ep)\.?\s*(\d+(?:[.,]\d+)?)(?!\d)/i);
  if (!m) return null;
  // « 1,100 » = mille cent (séparateur de milliers), « 12,5 » = douze et demi
  const raw = /^\d+,\d{3}$/.test(m[1]) ? m[1].replace(',', '') : m[1].replace(',', '.');
  return parseFloat(raw);
}

// Permission de lire les pages, nécessaire au suivi automatique.
// Firefox l'accorde à l'installation, mais on peut la retirer dans about:addons.
var ALL_SITES = { origins: ['*://*/*'] };

function hasAllSitesPermission() {
  return browser.permissions.contains(ALL_SITES);
}

// Textes de la page où le numéro de chapitre apparaît souvent : menu déroulant
// « changer de chapitre », titre de l'onglet, gros titre, fil d'Ariane.
// (Fonction autonome : elle est aussi exécutée directement dans la page.)
function collectChapterTexts() {
  const texts = [];
  for (const o of document.querySelectorAll('select option:checked')) texts.push(o.textContent);
  texts.push(document.title);
  for (const el of document.querySelectorAll('h1, h2, [class*="breadcrumb"] li:last-child, [class*="breadcrumb"] a:last-child')) {
    texts.push(el.textContent);
  }
  return texts.map((t) => t.trim()).filter(Boolean).slice(0, 40);
}

function chapterFromTexts(texts) {
  for (const text of texts) {
    const num = chapterFromText(text);
    if (num !== null) return num;
  }
  return null;
}

async function readChapterFromPage(tabId) {
  try {
    const [res] = await browser.scripting.executeScript({ target: { tabId }, func: collectChapterTexts });
    return chapterFromTexts(res.result || []);
  } catch {
    // Page protégée (about:, store…) ou permission manquante
    return null;
  }
}

// Titre d'une page de scan, sans le chapitre ni le nom du site :
// « A Returner's Magic Should Be Special - Chapitre 62 - Phenix Scans »
//   ->  « A Returner's Magic Should Be Special »
function cleanTitle(raw, url) {
  let t = (raw || '')
    .replace(/\b(chap(?:ter|itre)?|ch\.?|episode|ep\.?|scan)\s*\d+.*$/i, '')
    .split(/\s[-|–—:]\s/)[0]
    .replace(/[\s\-–|:,]+$/, '')
    .trim();
  if (t) return t;
  // Sinon on devine à partir de l'URL : /manga/a-returners-magic/chapitre/62
  const ignore = /^(manga|mangas|manhwa|series|serie|comics?|webtoons?|read|lecture-en-ligne|title|chapitre|chapter|scan|\d+)$/i;
  const segs = new URL(url).pathname.split('/').filter((s) => s && !ignore.test(s) && !/\d+$/.test(s));
  const slug = segs.pop() || '';
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------- Sorties (journal releases) ----------

// Sortie encore à lire : tu n'as pas atteint ce chapitre
function isUnread(r, scan) {
  return scan.chapter < r.to;
}

// Chapitre à ouvrir : le prochain que tu n'as pas lu (sans dépasser la sortie),
// sur le site où le chapitre est sorti s'il fait toujours partie du scan
function releaseUrl(r, scan) {
  const link = scanLinks(scan).includes(r.link) ? r.link : scan.url;
  if (!link.includes('{ch}')) return link;
  const next = isUnread(r, scan) ? Math.min(r.to, Math.floor(scan.chapter) + 1) : r.to;
  return link.replace('{ch}', formatChapter(next));
}

function chaptersLabel(r) {
  return r.to - r.from > 1
    ? `Chapitres ${formatChapter(Math.floor(r.from) + 1)} à ${formatChapter(r.to)}`
    : `Chapitre ${formatChapter(r.to)}`;
}

// ---------- Rythme de sortie (calendrier) ----------

var WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
var MIN_RELEASES_FOR_RHYTHM = 3;

// Estime le rythme de sortie d'un scan à partir de ses sorties enregistrées :
// { every: jours entre deux sorties, weekday: jour habituel (séries hebdomadaires)
//   ou null, next: date ISO du prochain chapitre estimé, label: « chaque jeudi » }
// ou null s'il n'y a pas assez de sorties ou qu'elles sont trop irrégulières.
function releaseRhythm(releases, scanId) {
  const dates = releases
    .filter((r) => r.id === scanId)
    .map((r) => new Date(r.at))
    .sort((a, b) => a - b);
  if (dates.length < MIN_RELEASES_FOR_RHYTHM) return null;

  const gaps = dates.slice(1).map((d, i) => (d - dates[i]) / 86400000).sort((a, b) => a - b);
  const every = gaps[Math.floor(gaps.length / 2)]; // médiane : insensible à une semaine de pause
  if (every < 0.5 || every > 60) return null;

  const last = dates.at(-1);
  if (every >= 5.5 && every <= 8.5) {
    // Hebdomadaire : jour de la semaine le plus fréquent, prochaine occurrence après la dernière sortie
    const counts = {};
    for (const d of dates) counts[d.getDay()] = (counts[d.getDay()] || 0) + 1;
    const weekday = Number(Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]);
    const next = new Date(last);
    next.setHours(12, 0, 0, 0);
    do next.setDate(next.getDate() + 1);
    while (next.getDay() !== weekday);
    return { every: 7, weekday, next: next.toISOString(), label: `chaque ${WEEKDAYS[weekday]}` };
  }
  const days = Math.round(every);
  return {
    every,
    weekday: null,
    next: new Date(last.getTime() + every * 86400000).toISOString(),
    label: days <= 1 ? 'tous les jours' : `tous les ${days} jours environ`,
  };
}

// ---------- Progression dans un chapitre ----------

// Un chapitre compte comme lu quand on a vu 95 % de ses images
var FINISHED_AT = 0.95;

// Dernier chapitre terminé : celui lu jusqu'au bout (scan.lastFinished) ou, à
// défaut, celui d'avant le chapitre en cours (passer au suivant = avoir fini).
function finishedChapters(scan) {
  return Math.max(scan.lastFinished ?? -Infinity, Math.floor(scan.chapter) - 1);
}

// Zone de lecture de la page : de la première à la dernière grande image (les
// pages du chapitre), pour ne pas compter les commentaires en dessous.
// (Fonction autonome : exécutée dans la page par content.js.)
function readingArea() {
  const pages = [...document.images].filter((img) => img.getBoundingClientRect().width >= 300);
  const loaded = pages.filter((img) => img.complete && img.naturalHeight > 0 && img.getBoundingClientRect().height >= 200);
  if (loaded.length < 3) {
    return { top: 0, bottom: document.documentElement.scrollHeight, pending: false };
  }
  const rects = pages.map((img) => img.getBoundingClientRect());
  return {
    top: Math.min(...rects.map((r) => r.top)) + scrollY,
    bottom: Math.max(...rects.map((r) => r.bottom)) + scrollY,
    pending: loaded.length < pages.length, // images pas encore chargées : la fin n'est pas atteinte
  };
}

// Progression de 0 à 1 dans le chapitre, ou null si la page n'est pas assez
// longue pour être mesurée (lecture « page par page »…)
function readingProgress() {
  const { top, bottom, pending } = readingArea();
  const height = bottom - top;
  if (height < innerHeight * 1.5) return null;
  const progress = Math.min(1, Math.max(0, (scrollY + innerHeight - top) / height));
  return pending ? Math.min(progress, FINISHED_AT - 0.01) : progress;
}

// Position de défilement qui correspond à une progression (pour reprendre la lecture)
function scrollTargetFor(progress) {
  const { top, bottom } = readingArea();
  return Math.max(0, top + progress * (bottom - top) - innerHeight);
}

// ---------- Statuts suggérés ----------

var INACTIVE_DAYS = 30; // « Pas lu depuis un mois : mettre en pause ? »

function daysSince(iso) {
  return (Date.now() - new Date(iso)) / 86400000;
}

// Suggestion pour un scan, ou null. key sert à ne plus la proposer si tu la refuses.
function suggestionFor(s) {
  const dismissed = s.dismissed || [];
  const offer = (key, text, action, status) => (dismissed.includes(key) ? null : { key, text, action, status });
  const unread = unreadCount(s);

  if (s.status === 'reading' && s.pub?.status === 'FINISHED' && unread === 0) {
    return offer('done', 'Tu as tout lu et la série est terminée.', 'Passer en « Terminé »', 'done');
  }
  if (s.status === 'reading' && s.lastRead && daysSince(s.lastRead) > INACTIVE_DAYS) {
    return offer('pause', `Pas lu depuis ${Math.floor(daysSince(s.lastRead))} jours.`, 'Mettre « En pause »', 'paused');
  }
  if (s.status === 'done' && unread > 0) {
    return offer(`resume-${s.latest}`, `La série continue : ${unread} chapitre${unread > 1 ? 's' : ''} à lire.`, 'Repasser « En cours »', 'reading');
  }
  return null;
}

// ---------- Insertion de HTML sûre ----------

// Remplace le contenu d'un élément par du HTML construit par l'extension, après
// nettoyage par DOMPurify (vendor/purify.min.js, version officielle non modifiée) :
// aucun script ni gestionnaire d'événement venu d'un site ou d'AniList ne peut passer,
// même si une valeur avait échappé à escapeHtml.
function setHTML(element, html) {
  element.replaceChildren(
    DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true, ADD_ATTR: ['target', 'referrerpolicy', 'loading'] })
  );
}

// Remplit une liste déroulante : options = [[valeur, libellé], …]
function setOptions(select, options) {
  select.replaceChildren(...options.map(([value, label]) => new Option(label, value)));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function initials(title) {
  return title.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

function openDashboard() {
  return browser.tabs.create({ url: browser.runtime.getURL('dashboard.html') });
}
