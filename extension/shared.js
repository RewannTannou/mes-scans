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

var DEFAULT_SETTINGS = { notify: true, backup: true };

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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function initials(title) {
  return title.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

function openDashboard() {
  return browser.tabs.create({ url: browser.runtime.getURL('dashboard.html') });
}
