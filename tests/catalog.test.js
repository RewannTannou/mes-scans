// Recherche anime-sama, import AniList, clic droit et recherche de site (catalog.js, background.js)

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('./helpers/extension');

const SEARCH_HTML =
  '<a href="https://anime-sama.to/catalogue/past-life-returner" class="asn-search-result"><img src="x.webp" /><div><h3 class="asn-search-result-title">Past Life Returner</h3><p class="asn-search-result-subtitle">Jeongsaengja, Reincarnator</p></div></a>' +
  '<a href="https://anime-sama.to/catalogue/a-returners-magic-should-be-special" class="asn-search-result"><img src="y.webp" /><div><h3 class="asn-search-result-title">A Returner&#039;s Magic Should be Special</h3><p class="asn-search-result-subtitle">Kikansha no Mahou wa Tokubetsu desu, Gwihwanjaui Mabeobeun Teukbyeolhaeya Hamnida</p></div></a>';
const CATALOGUE_HTML = 'panneauScan("nom", "url"); panneauAnime("Saison 1", "saison1/vostfr"); panneauScan("Scans", "scan/vf");';

// Faux anime-sama : recherche + fiches (seul ARMSBS a des scans)
function animeSamaFetch(url, opts = {}) {
  const u = String(url);
  if (u.endsWith('/template-php/defaut/fetch.php')) {
    return Promise.resolve({ ok: true, text: async () => (String(opts.body).includes('zzz') ? '' : SEARCH_HTML) });
  }
  if (u.includes('/catalogue/a-returners-magic-should-be-special')) return Promise.resolve({ ok: true, text: async () => CATALOGUE_HTML });
  if (u.includes('/catalogue/past-life-returner')) return Promise.resolve({ ok: true, text: async () => 'panneauAnime("Saison 1", "saison1/vostfr");' });
  return Promise.resolve({ ok: false, status: 503 });
}

const media = (over = {}) => ({
  id: 105393,
  siteUrl: 'https://anilist.co/manga/105393',
  status: 'FINISHED',
  chapters: 268,
  title: { english: "A Returner's Magic Should Be Special", romaji: 'Gwihwanjaui Mabeobeun Teukbyeolhaeya Hamnida', native: null },
  synonyms: [],
  coverImage: { large: 'https://img/armsbs.jpg' },
  ...over,
});

test('résultats de la recherche anime-sama', () => {
  const { ext } = loadExtension(['shared.js', 'sources.js', 'catalog.js']);
  const results = ext.parseAnimeSamaResults(SEARCH_HTML);
  assert.equal(results.length, 2);
  assert.equal(results[1].title, "A Returner's Magic Should be Special");
  assert.deepEqual([...results[1].aliases], ['Kikansha no Mahou wa Tokubetsu desu', 'Gwihwanjaui Mabeobeun Teukbyeolhaeya Hamnida']);
});

test('findOnAnimeSama : bon titre + version scans, sinon null', async () => {
  const { ext } = loadExtension(['shared.js', 'sources.js', 'catalog.js'], { fetch: animeSamaFetch });
  assert.equal(
    await ext.findOnAnimeSama(["A Returner's Magic Should Be Special"]),
    'https://anime-sama.to/catalogue/a-returners-magic-should-be-special/scan/vf/'
  );
  // Trouvé par un titre alternatif (romaji)
  assert.match(await ext.findOnAnimeSama(['Gwihwanjaui Mabeobeun Teukbyeolhaeya Hamnida']), /a-returners-magic/);
  // Fiche sans scans (anime seulement) ou titre inconnu
  assert.equal(await ext.findOnAnimeSama(['Past Life Returner']), null);
  assert.equal(await ext.findOnAnimeSama(['zzz inconnu']), null);
});

test('scanFromMedia et findTrackedMedia', () => {
  const { ext } = loadExtension(['shared.js', 'sources.js', 'catalog.js']);
  const scan = ext.scanFromMedia(media(), { status: 'reading' });
  assert.equal(scan.title, "A Returner's Magic Should Be Special");
  assert.equal(scan.status, 'reading');
  assert.equal(scan.pub.id, 105393);
  assert.equal(scan.url, '');
  assert.ok(scan.pub.titles.includes('Gwihwanjaui Mabeobeun Teukbyeolhaeya Hamnida'));
  // Reconnu par la fiche ou par le titre
  assert.ok(ext.findTrackedMedia([{ title: 'autre', pub: { id: 105393 } }], media()));
  assert.ok(ext.findTrackedMedia([{ title: "a returner's magic should be special" }], media()));
  assert.equal(ext.findTrackedMedia([{ title: 'One Piece', pub: { id: 1 } }], media()), undefined);
});

test('import AniList : ajoute les nouveaux, avance sans reculer', () => {
  const { ext } = loadExtension(['shared.js', 'sources.js', 'catalog.js']);
  const scans = [{ id: 'x', title: "A Returner's Magic Should Be Special", chapter: 80, status: 'reading', url: 'u' }];
  const entries = [
    { status: 'CURRENT', progress: 70, media: media() }, // déjà suivi, plus bas : pas de recul
    { status: 'COMPLETED', progress: 201, updatedAt: 1700000000, media: media({ id: 105398, title: { english: 'Solo Leveling', romaji: 'Na Honjaman Level Up' }, synonyms: [] }) },
    { status: 'PLANNING', progress: 0, media: media({ id: 30013, title: { english: 'One Piece', romaji: 'One Piece' }, synonyms: [] }) },
  ];
  const result = ext.mergeAniListEntries(scans, entries);
  assert.deepEqual({ ...result }, { added: 2, updated: 0 });
  assert.equal(scans[0].chapter, 80);
  assert.equal(scans[1].status, 'done');
  assert.equal(scans[1].chapter, 201);
  assert.equal(scans[2].status, 'plan');

  const again = ext.mergeAniListEntries(scans, [{ status: 'CURRENT', progress: 90, media: media() }]);
  assert.deepEqual({ ...again }, { added: 0, updated: 1 });
  assert.equal(scans[0].chapter, 90);
});

test('arrière-plan : les scans sans lien sont cherchés sur anime-sama (une seule fois)', async () => {
  const { ext, store, settle } = loadExtension(['shared.js', 'sources.js', 'catalog.js', 'background.js'], { fetch: animeSamaFetch });
  const found = ext.scanFromMedia(media());
  const missing = ext.scanFromMedia(media({ id: 1, title: { english: 'zzz inconnu' }, synonyms: [] }));
  store.scans = [found, missing];
  await ext.findMissingSources();
  await settle();
  assert.equal(store.scans[0].url, 'https://anime-sama.to/catalogue/a-returners-magic-should-be-special/scan/vf/');
  assert.equal(store.scans[1].url, '');
  assert.ok(store.scans[1].sourceSearchedAt, 'marqué comme cherché : pas de nouvelle tentative');
});

test('clic droit : ajoute la page, ou signale un scan déjà suivi', async () => {
  const { store, fire, calls, settle } = loadExtension(['shared.js', 'sources.js', 'catalog.js', 'background.js']);
  store.scans = [];
  fire('menuClick', { menuItemId: 'add-link', linkUrl: 'https://phenix-scans.co/manga/x/chapitre/12', linkText: 'Mon Manhwa - Chapitre 12' }, { id: 1 });
  await settle();
  assert.equal(store.scans.length, 1);
  assert.equal(store.scans[0].title, 'Mon Manhwa');
  assert.equal(store.scans[0].chapter, 12);
  assert.equal(store.scans[0].url, 'https://phenix-scans.co/manga/x/chapitre/{ch}');
  assert.equal(calls.notifications.at(-1).title, 'Ajouté à Mes Scans');

  fire('menuClick', { menuItemId: 'add-page' }, { id: 1, url: 'https://phenix-scans.co/manga/x/chapitre/13', title: 'Mon Manhwa' });
  await settle();
  assert.equal(store.scans.length, 1);
  assert.equal(calls.notifications.at(-1).title, 'Déjà dans ta liste');
});
