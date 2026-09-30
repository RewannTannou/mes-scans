// Lecture : chapitres terminés, progression, historique, suggestions, versions

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('./helpers/extension');

const FILES = ['shared.js', 'sources.js', 'catalog.js', 'background.js'];
const today = () => new Date().toLocaleDateString('sv');
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

function setup() {
  const env = loadExtension(FILES);
  env.store.scans = [
    { id: 'a', title: 'ARMSBS', chapter: 68, status: 'reading', url: 'https://anime-sama.to/catalogue/armsbs/scan/vf/', pub: { checkedAt: daysAgo(0) } },
  ];
  const tab = { id: 1, url: 'https://anime-sama.to/catalogue/armsbs/scan/vf/', title: '' };
  const say = (msg) => env.fire('message', msg, { tab });
  return { ...env, tab, say };
}

test('finishedChapters : lu jusqu’au bout ou passé au suivant', () => {
  const { ext } = loadExtension(['shared.js']);
  assert.equal(ext.finishedChapters({ chapter: 68 }), 67);
  assert.equal(ext.finishedChapters({ chapter: 68, lastFinished: 68 }), 68);
  assert.equal(ext.finishedChapters({ chapter: 50, lastFinished: 69 }), 69); // relecture d'un ancien chapitre
  assert.equal(ext.finishedChapters({ chapter: 0 }), -1);
});

test('progression : position enregistrée, chapitre terminé à 95 %', async () => {
  const { store, say, settle } = setup();
  say({ type: 'progress', num: 68, progress: 0.456 });
  await settle();
  assert.equal(store.scans[0].position.chapter, 68);
  assert.equal(store.scans[0].position.progress, 0.46);
  assert.equal(store.scans[0].lastFinished, undefined);

  say({ type: 'progress', num: 68, progress: 0.97 });
  await settle();
  assert.equal(store.scans[0].lastFinished, 68);
});

test('progression d’un autre chapitre que celui en cours : ignorée', async () => {
  const { store, say, settle } = setup();
  say({ type: 'progress', num: 12, progress: 0.5 });
  await settle();
  assert.equal(store.scans[0].position, undefined);
});

test('historique : un chapitre compte une seule fois, quand il est fini', async () => {
  const { store, say, settle } = setup();
  say({ type: 'progress', num: 68, progress: 0.99 }); // fini en lisant jusqu'au bout
  await settle();
  assert.deepEqual(store.history[today()], { a: 1 });

  say({ type: 'chapter', num: 69 }); // passer au suivant : le 68 était déjà compté
  await settle();
  assert.deepEqual(store.history[today()], { a: 1 });

  say({ type: 'chapter', num: 70 }); // 69 sauté sans le finir au défilement : compté en passant au 70
  await settle();
  assert.deepEqual(store.history[today()], { a: 2 });

  say({ type: 'chapter', num: 40 }); // retour en arrière puis relecture : rien
  await settle();
  say({ type: 'chapter', num: 41 });
  await settle();
  assert.deepEqual(store.history[today()], { a: 2 });
});

test('isTracked renvoie la position pour proposer de reprendre', async () => {
  const { store, fire, tab } = setup();
  store.scans[0].position = { chapter: 68, progress: 0.4 };
  const [reply] = fire('message', { type: 'isTracked' }, { tab });
  assert.deepEqual({ ...(await reply).position }, { chapter: 68, progress: 0.4 });
  const [none] = fire('message', { type: 'isTracked' }, { tab: { id: 2, url: 'https://ailleurs.com/', title: '' } });
  assert.equal(await none, null);
});

test('statuts suggérés', () => {
  const { ext } = loadExtension(['shared.js']);
  const key = (s) => ext.suggestionFor(s)?.key ?? null;
  // Tout lu + série terminée -> Terminé
  assert.equal(key({ status: 'reading', chapter: 268, latest: 268, pub: { status: 'FINISHED' } }), 'done');
  // Série terminée mais pas tout lu -> rien
  assert.equal(key({ status: 'reading', chapter: 100, latest: 268, pub: { status: 'FINISHED' }, lastRead: daysAgo(1) }), null);
  // Pas lu depuis plus d'un mois -> pause
  assert.equal(key({ status: 'reading', chapter: 5, latest: 9, lastRead: daysAgo(45) }), 'pause');
  // Marqué terminé mais de nouveaux chapitres -> reprendre
  assert.equal(key({ status: 'done', chapter: 201, latest: 205 }), 'resume-205');
  // Suggestion refusée : plus proposée
  assert.equal(key({ status: 'reading', chapter: 5, latest: 9, lastRead: daysAgo(45), dismissed: ['pause'] }), null);
});

test('versions anime-sama : liste et découpage du lien', async () => {
  const fetch = async () => ({
    ok: true,
    text: async () => 'panneauScan("nom", "url"); panneauScan("Scans (couleur)", "scan/vf"); panneauScan("Scans (noir et blanc)", "scan_noir-et-blanc/vf");',
  });
  const { ext } = loadExtension(['shared.js', 'sources.js', 'catalog.js'], { fetch });
  const versions = await ext.animeSamaVersions('https://anime-sama.to/catalogue/one-piece/');
  assert.deepEqual([...versions.map((v) => v.path)], ['scan/vf', 'scan_noir-et-blanc/vf']);
  assert.equal(versions[1].name, 'Scans (noir et blanc)');
  assert.deepEqual({ ...ext.splitAnimeSamaLink('https://anime-sama.to/catalogue/one-piece/scan_noir-et-blanc/vf/') }, {
    catalogue: 'https://anime-sama.to/catalogue/one-piece/',
    path: 'scan_noir-et-blanc/vf',
  });
  assert.equal(ext.splitAnimeSamaLink('https://phenix-scans.co/manga/x/chapitre/{ch}'), null);
});
