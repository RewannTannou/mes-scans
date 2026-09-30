// Étape 4 : rythme de sortie, santé des sites, résumé de la semaine

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('./helpers/extension');

const at = (y, m, d, h = 18) => new Date(y, m - 1, d, h).toISOString();

test('rythme hebdomadaire : jour habituel et prochaine sortie', () => {
  const { ext } = loadExtension(['shared.js']);
  // Sorties les jeudis 3, 10, 17 et 24 septembre 2026 (une semaine sautée ne gêne pas)
  const releases = [at(2026, 9, 24), at(2026, 9, 17), at(2026, 9, 10), at(2026, 9, 3)].map((d) => ({ id: 'a', at: d }));
  const r = ext.releaseRhythm(releases, 'a');
  assert.equal(r.weekday, 4); // jeudi
  assert.equal(r.label, 'chaque jeudi');
  assert.equal(new Date(r.next).toLocaleDateString('sv'), '2026-10-01');
});

test('rythme régulier non hebdomadaire, et pas assez de données', () => {
  const { ext } = loadExtension(['shared.js']);
  const every3 = [at(2026, 9, 1), at(2026, 9, 4), at(2026, 9, 7), at(2026, 9, 10)].map((d) => ({ id: 'b', at: d }));
  const r = ext.releaseRhythm(every3, 'b');
  assert.equal(r.weekday, null);
  assert.equal(r.label, 'tous les 3 jours environ');
  assert.equal(new Date(r.next).toLocaleDateString('sv'), '2026-09-13');
  assert.equal(ext.releaseRhythm(every3.slice(0, 2), 'b'), null); // 2 sorties : trop peu
  assert.equal(ext.releaseRhythm(every3, 'autre'), null);
});

test('état de santé des sites : échecs d’affilée, remis à zéro quand le site répond', async () => {
  let up = false;
  const fetch = async (url) =>
    String(url).includes('get_nb_chap')
      ? { ok: true, json: async () => ({ 1: 1, 2: 1 }) }
      : String(url).includes('anime-sama') && up
        ? { ok: true, text: async () => '<h1 id="titreOeuvre">X</h1>' }
        : { ok: false, status: 503 };
  const { ext, store } = loadExtension(['shared.js', 'sources.js', 'catalog.js', 'background.js'], { fetch });
  store.scans = [{ id: 'a', title: 'X', chapter: 1, status: 'reading', url: 'https://anime-sama.to/catalogue/x/scan/vf/', pub: { id: 1, genres: [], checkedAt: new Date().toISOString() } }];
  for (let i = 0; i < 3; i++) await ext.checkNewChapters();
  assert.equal(store.siteHealth['anime-sama.to'].failures, 3);
  up = true;
  await ext.checkNewChapters();
  assert.equal(store.siteHealth['anime-sama.to'].failures, 0);
  assert.ok(store.siteHealth['anime-sama.to'].lastOk);
});

test('résumé de la semaine : rien la 1re fois, puis sorties + lectures', async () => {
  const { ext, store, calls } = loadExtension(['shared.js', 'sources.js', 'catalog.js', 'background.js']);
  store.scans = [];
  await ext.weeklyDigestIfNeeded();
  assert.ok(store.lastDigest);
  assert.equal(calls.notifications.length, 0);

  store.lastDigest = new Date(Date.now() - 8 * 86400000).toISOString();
  const day = new Date().toLocaleDateString('sv');
  store.releases = [
    { id: 'a', from: 10, to: 12, at: new Date().toISOString() },
    { id: 'b', from: 5, to: 6, at: new Date().toISOString() },
    { id: 'c', from: 1, to: 2, at: new Date(Date.now() - 20 * 86400000).toISOString() }, // trop ancienne
  ];
  store.history = { [day]: { a: 4, b: 3 } };
  await ext.weeklyDigestIfNeeded();
  assert.equal(calls.notifications.length, 1);
  assert.equal(calls.notifications[0].message, '3 nouveaux chapitres sur 2 mangas · tu en as lu 7.');
});
