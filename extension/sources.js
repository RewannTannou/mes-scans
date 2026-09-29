// Récupère le dernier chapitre disponible d'un scan, site par site.
// Pour ajouter un site : une entrée dans SOURCES avec match(lien) et latest(lien, scan).

const SOURCES = [
  {
    name: 'anime-sama',
    match: (link) => /(^|\.)anime-sama\./.test(siteName(link)),
    latest: animeSamaLatest,
  },
  {
    // Tous les sites dont l'adresse contient le numéro de chapitre (phenix-scans…)
    name: 'liste de chapitres',
    match: (link) => link.includes('{ch}'),
    latest: chapterListLatest,
  },
];

function sourceForLink(link) {
  return SOURCES.find((s) => s.match(link));
}

function hasSource(scan) {
  return scanLinks(scan).some(sourceForLink);
}

// Plus grand chapitre disponible sur l'ensemble des sites du scan :
// { num, link } (link = le site où il est sorti), ou null
async function fetchLatestChapter(scan) {
  let best = null;
  for (const link of scanLinks(scan)) {
    const source = sourceForLink(link);
    if (!source) continue;
    try {
      const num = await source.latest(link, scan);
      if (num !== null && (best === null || num > best.num)) best = { num, link };
    } catch (err) {
      console.warn(`${source.name} : vérification impossible pour ${siteName(link)}`, err);
    }
  }
  return best;
}

async function fetchDocument(url) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) return null; // site en panne, protection anti-robots…
  return new DOMParser().parseFromString(await res.text(), 'text/html');
}

// ---------- Sites « classiques » ----------
// La page du manga liste ses chapitres sous forme de liens :
// on garde ceux qui suivent le modèle du scan (…/chapitre/{ch}) et on prend le plus grand.

async function chapterListLatest(link) {
  const pageUrl = seriesUrl(link);
  const doc = await fetchDocument(pageUrl);
  if (!doc) return null;
  const pattern = chapterPattern(link, true);
  const nums = [];
  for (const a of doc.querySelectorAll('a[href]')) {
    let href;
    try {
      href = new URL(a.getAttribute('href'), pageUrl).href;
    } catch {
      continue;
    }
    const m = pattern.exec(normalizeUrl(href, true));
    if (m) nums.push(parseFloat(m[1].replace(',', '.')));
  }
  return nums.length ? Math.max(...nums) : null;
}

// ---------- État de parution (AniList) ----------
// Les sites de scans affichent souvent l'état de l'anime, pas celui du manga :
// on demande donc à AniList (base de données manga, API gratuite sans compte).

const ANILIST_FIELDS = 'id status chapters siteUrl title { romaji english native } synonyms coverImage { large }';

async function anilist(query, variables) {
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`AniList ${res.status}`);
  return (await res.json()).data;
}

// Fiche AniList du scan : par identifiant si tu l'as choisie, sinon par titre
async function fetchPublication(scan) {
  let media;
  if (scan.pub?.id) {
    media = (await anilist(`query($id:Int){Media(id:$id,type:MANGA){${ANILIST_FIELDS}}}`, { id: scan.pub.id })).Media;
  } else {
    const results = (await anilist(`query($s:String){Page(perPage:5){media(search:$s,type:MANGA){${ANILIST_FIELDS}}}}`, { s: scan.title })).Page.media;
    // On préfère un résultat dont un des titres correspond exactement, sinon le premier
    const wanted = normalizeTitle(scan.title);
    media = results.find((m) => [m.title.english, m.title.romaji, m.title.native, ...m.synonyms].some((t) => normalizeTitle(t) === wanted)) || results[0];
  }
  if (!media) return { id: null, status: null, checkedAt: new Date().toISOString() };
  return {
    id: media.id,
    status: media.status,
    chapters: media.chapters,
    url: media.siteUrl,
    title: media.title.english || media.title.romaji,
    cover: media.coverImage?.large,
    checkedAt: new Date().toISOString(),
  };
}

// ---------- anime-sama ----------
// La page du manga contient son nom exact (#titreOeuvre). Le site s'en sert pour
// demander la liste des chapitres à get_nb_chap_et_img.php, qui renvoie un objet
// avec une entrée par chapitre.

async function animeSamaLatest(link, scan) {
  const pageUrl = link.replace('{ch}', formatChapter(scan.chapter));
  const doc = await fetchDocument(pageUrl);
  if (!doc) return null;
  const name = doc.getElementById('titreOeuvre')?.innerHTML;
  if (!name) return null;

  const api = new URL(`/s2/scans/get_nb_chap_et_img.php?oeuvre=${encodeURIComponent(name)}`, pageUrl);
  const res = await fetch(api, { credentials: 'include' });
  if (!res.ok) return null;
  const count = Object.keys(await res.json()).length;

  const inlineScripts = [...doc.querySelectorAll('script:not([src])')].map((s) => s.textContent).join('\n');
  return animeSamaLastChapter(count, inlineScripts);
}

// Par défaut, les chapitres vont de 1 à count. Certains mangas ont une liste
// personnalisée (chapitres spéciaux, numérotation décalée) décrite dans la page
// par des appels resetListe / creerListe / newSP / newSPF / finirListe :
// on les rejoue comme le fait le site pour trouver le vrai dernier numéro.
function animeSamaLastChapter(count, script) {
  const code = script.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const calls = [...code.matchAll(/\b(resetListe|creerListe|newSPF?|finirListe)\s*\(([^)]*)\)/g)];
  if (!calls.length) return count;

  const nums = [];
  let retards = 0; // chapitres spéciaux, qui décalent la fin de la liste
  for (const [, fn, rawArgs] of calls) {
    const args = rawArgs.split(',').map((a) => a.trim().replace(/^["'`]|["'`]$/g, ''));
    if (fn === 'resetListe') {
      nums.length = 0;
      retards = 0;
    } else if (fn === 'creerListe') {
      for (let i = Number(args[0]); i <= Number(args[1]); i++) nums.push(i);
    } else if (fn === 'newSP') {
      const n = parseFloat(args[0]);
      if (!Number.isNaN(n)) nums.push(n);
      retards++;
    } else if (fn === 'newSPF') {
      const n = chapterFromText(args[0]);
      if (n !== null) nums.push(n);
      retards++;
    } else if (fn === 'finirListe') {
      for (let i = Number(args[0]); i <= count - retards; i++) nums.push(i);
    }
  }
  return nums.length ? Math.max(...nums) : count;
}
