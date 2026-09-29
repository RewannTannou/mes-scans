// Dernier chapitre disponible par site (sources.js), sans réseau

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('./helpers/extension');

test('anime-sama : liste par défaut et listes personnalisées', () => {
  const { ext } = loadExtension(['shared.js', 'sources.js']);
  assert.equal(ext.animeSamaLastChapter(269, ''), 269);
  assert.equal(ext.animeSamaLastChapter(269, '/* resetListe(); creerListe(debut, fin); */'), 269);
  // 1 à 10, un 10.5, un « One Shot », puis 11 jusqu'à 100 - 2 spéciaux = 98
  const custom = '$(document).ready(function(){ resetListe(); creerListe(1, 10); newSP(10.5); newSPF("One Shot"); finirListe(11); });';
  assert.equal(ext.animeSamaLastChapter(100, custom), 98);
});

test('anime-sama : nom de l’œuvre puis API des chapitres', async () => {
  const requested = [];
  const fetch = async (url) => {
    requested.push(String(url));
    if (String(url).includes('get_nb_chap_et_img.php')) {
      return { ok: true, json: async () => Object.fromEntries(Array.from({ length: 269 }, (_, i) => [i + 1, 9])) };
    }
    return { ok: true, text: async () => '<h1 id="titreOeuvre">A Returner\'s Magic Should be Special</h1>' };
  };
  const { ext } = loadExtension(['shared.js', 'sources.js'], { fetch });
  const latest = await ext.fetchLatestChapter({ chapter: 68, url: 'https://anime-sama.to/catalogue/a-returners-magic-should-be-special/scan/vf/' });
  assert.equal(latest.num, 269);
  // Nom exact de l'œuvre, encodé dans l'adresse (l'apostrophe devient %27)
  assert.equal(decodeURIComponent(new URL(requested[1]).searchParams.get('oeuvre')), "A Returner's Magic Should be Special");
});

test('liste de chapitres : plus grand lien qui suit le modèle du scan', async () => {
  const fetch = async () => ({
    ok: true,
    text: async () => '<a href="/manga/x/chapitre/1">1</a><a href="https://phenix-scans.co/manga/x/chapitre/42">42</a><a href="/manga/y/chapitre/99">autre manga</a>',
  });
  const { ext } = loadExtension(['shared.js', 'sources.js'], { fetch });
  assert.equal(await ext.chapterListLatest('https://phenix-scans.co/manga/x/chapitre/{ch}'), 42);
});

test('site en panne : null, sans planter', async () => {
  const { ext } = loadExtension(['shared.js', 'sources.js']);
  assert.equal(await ext.fetchLatestChapter({ chapter: 1, url: 'https://phenix-scans.co/manga/x/chapitre/{ch}' }), null);
});
