// Trouver des mangas : recherche, recommandations et tendances sur AniList,
// import d'une liste AniList, et recherche automatique de la page anime-sama.
// Utilisé par l'arrière-plan et par l'onglet « Découvrir » (nécessite sources.js).

// ---------- AniList ----------

const ANILIST_CARD = `id siteUrl status chapters volumes format countryOfOrigin averageScore popularity genres
  title { romaji english native } synonyms coverImage { large extraLarge color } bannerImage startDate { year }
  description(asHtml: false)`;

async function searchAniList(query) {
  const data = await anilist(
    `query($s:String){Page(perPage:12){media(search:$s,type:MANGA,isAdult:false,sort:SEARCH_MATCH){${ANILIST_CARD}}}}`,
    { s: query }
  );
  return data.Page.media;
}

async function trendingAniList() {
  const data = await anilist(`{Page(perPage:12){media(type:MANGA,isAdult:false,sort:TRENDING_DESC){${ANILIST_CARD}}}}`);
  return data.Page.media;
}

// Les rangées de l'onglet « Découvrir », en une seule requête (alias par rangée)
async function discoverRows() {
  const since = (new Date().getFullYear() - 1) * 10000; // AniList : dates au format AAAAMMJJ
  const page = (args) => `Page(perPage:20){media(type:MANGA,isAdult:false,${args}){${ANILIST_CARD}}}`;
  const data = await anilist(`{
    trending: ${page('sort:TRENDING_DESC')}
    top: ${page('sort:SCORE_DESC,popularity_greater:20000')}
    manhwa: ${page('countryOfOrigin:"KR",sort:POPULARITY_DESC')}
    fresh: ${page(`startDate_greater:${since},sort:POPULARITY_DESC`)}
  }`);
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value.media]));
}

// Recommandations AniList pour plusieurs mangas en une seule requête.
// Renvoie [{ media, because: [ids des mangas qui le recommandent], score }] trié par score.
async function recommendationsFor(anilistIds) {
  if (!anilistIds.length) return [];
  const fields = anilistIds
    .map((id, i) => `m${i}:Media(id:${Number(id)}){recommendations(perPage:8,sort:RATING_DESC){nodes{rating mediaRecommendation{${ANILIST_CARD}}}}}`)
    .join(' ');
  const data = await anilist(`{${fields}}`);
  const byId = new Map();
  anilistIds.forEach((sourceId, i) => {
    for (const node of data[`m${i}`]?.recommendations?.nodes || []) {
      const media = node.mediaRecommendation;
      if (!media || node.rating <= 0) continue;
      const entry = byId.get(media.id) || { media, because: [], score: 0 };
      entry.because.push(sourceId);
      entry.score += node.rating;
      byId.set(media.id, entry);
    }
  });
  // Recommandé par plusieurs de tes mangas = bien plus pertinent
  return [...byId.values()].sort((a, b) => b.because.length - a.because.length || b.score - a.score);
}

// Liste manga publique d'un compte AniList
const ANILIST_STATUS = { CURRENT: 'reading', REPEATING: 'reading', PLANNING: 'plan', PAUSED: 'paused', COMPLETED: 'done', DROPPED: 'dropped' };

async function fetchAniListUserList(userName) {
  const data = await anilist(
    `query($u:String){MediaListCollection(userName:$u,type:MANGA){lists{entries{status progress updatedAt media{${ANILIST_CARD}}}}}}`,
    { u: userName }
  );
  return data.MediaListCollection.lists.flatMap((l) => l.entries);
}

function mediaTitle(media) {
  return media.title.english || media.title.romaji || media.title.native;
}

function mediaTitles(media) {
  return [media.title.english, media.title.romaji, media.title.native, ...(media.synonyms || [])].filter(Boolean);
}

// Scan déjà suivi correspondant à une fiche AniList (même fiche, ou même titre)
function findTrackedMedia(scans, media) {
  const titles = mediaTitles(media).map(normalizeTitle);
  return scans.find((s) => s.pub?.id === media.id || titles.includes(normalizeTitle(s.title)));
}

// Nouveau scan à partir d'une fiche AniList (sans site pour l'instant)
function scanFromMedia(media, { status = 'plan', chapter = 0 } = {}) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: mediaTitle(media),
    url: '',
    altUrls: [],
    chapter,
    status,
    cover: media.coverImage?.large || '',
    lastRead: null,
    createdAt: now,
    pub: {
      id: media.id,
      status: media.status,
      chapters: media.chapters,
      url: media.siteUrl,
      title: mediaTitle(media),
      cover: media.coverImage?.large,
      titles: mediaTitles(media), // tous les titres connus : servent à trouver le manga sur les sites
      checkedAt: now,
    },
  };
}

// Fusionne une liste AniList dans la bibliothèque : ajoute les nouveaux mangas,
// avance le chapitre des mangas déjà suivis (sans jamais le faire reculer).
function mergeAniListEntries(scans, entries) {
  let added = 0;
  let updated = 0;
  for (const entry of entries) {
    const status = ANILIST_STATUS[entry.status] || 'plan';
    const existing = findTrackedMedia(scans, entry.media);
    if (existing) {
      if (entry.progress > existing.chapter) {
        existing.chapter = entry.progress;
        updated++;
      }
      existing.pub ??= scanFromMedia(entry.media).pub;
      continue;
    }
    const scan = scanFromMedia(entry.media, { status, chapter: entry.progress || 0 });
    if (entry.updatedAt) scan.lastRead = new Date(entry.updatedAt * 1000).toISOString();
    scans.push(scan);
    added++;
  }
  return { added, updated };
}

function plainDescription(text, max = 220) {
  const plain = (text || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  return plain.length > max ? `${plain.slice(0, max).replace(/\s+\S*$/, '')}…` : plain;
}

// ---------- anime-sama ----------

// Domaine actuel d'anime-sama : celui de tes scans s'il y en a (le site change
// parfois d'extension), sinon le domaine par défaut.
function animeSamaHost(scans) {
  for (const scan of scans) {
    const host = scanLinks(scan).map((l) => new URL(l.replace('{ch}', '0')).hostname).find((h) => /(^|\.)anime-sama\./.test(h));
    if (host) return host;
  }
  return 'anime-sama.to';
}

// Cherche un manga sur anime-sama avec la recherche du site, puis vérifie
// sur sa fiche qu'il existe une version scans. Renvoie le lien des scans, ou null.
async function findOnAnimeSama(titles, host = 'anime-sama.to') {
  const wanted = titles.map(normalizeTitle).filter(Boolean);
  for (const query of titles.slice(0, 3)) {
    const res = await fetch(`https://${host}/template-php/defaut/fetch.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ query }),
      credentials: 'include',
    });
    if (!res.ok) continue;
    const html = await res.text();
    for (const result of parseAnimeSamaResults(html)) {
      const names = [result.title, ...result.aliases].map(normalizeTitle);
      if (!names.some((n) => wanted.includes(n))) continue;
      const scanPath = await animeSamaScanPath(result.url);
      if (scanPath) return `${result.url.replace(/\/+$/, '')}/${scanPath}/`;
    }
  }
  return null;
}

// Résultats de la recherche anime-sama : [{ url, title, aliases }]
function parseAnimeSamaResults(html) {
  const decode = (s) => s.replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"');
  return [...html.matchAll(/<a href="([^"]+)"[^>]*class="asn-search-result"[\s\S]*?<h3[^>]*>([^<]*)<\/h3>(?:<p[^>]*>([^<]*)<\/p>)?/g)].map((m) => ({
    url: m[1],
    title: decode(m[2]),
    aliases: m[3] ? decode(m[3]).split(',').map((a) => a.trim()) : [],
  }));
}

// Chemin de la version scans d'une fiche (« scan/vf »), en préférant la VF
async function animeSamaScanPath(catalogueUrl) {
  const res = await fetch(catalogueUrl, { credentials: 'include' });
  if (!res.ok) return null;
  const html = await res.text();
  const paths = [...html.matchAll(/panneauScan\("([^"]*)",\s*"([^"]*)"\)/g)].map((m) => m[2]).filter((p) => p && p !== 'url');
  return paths.find((p) => p === 'scan/vf') || paths.find((p) => p.startsWith('scan')) || null;
}
