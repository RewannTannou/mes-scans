// Comportement de l'arrière-plan (background.js) avec un faux Firefox

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('./helpers/extension');

const FILES = ['shared.js', 'sources.js', 'background.js'];
const today = () => new Date().toLocaleDateString('sv');

function setup(options) {
  const env = loadExtension(FILES, options);
  env.store.scans = [
    {
      id: 'a', title: "A Returner's Magic", chapter: 68, status: 'reading',
      url: 'https://anime-sama.to/catalogue/a-returners-magic-should-be-special/scan/vf/',
      altUrls: ['https://phenix-scans.co/manga/a-returners-magic-should-be-special/chapitre/{ch}'],
      pub: { checkedAt: new Date().toISOString() },
    },
    { id: 'b', title: 'Autre', chapter: 3, status: 'reading', url: 'https://anime-sama.to/catalogue/autre/scan/vf/', pub: { checkedAt: new Date().toISOString() } },
  ];
  const visit = (url, changeInfo = { url }) => env.fire('tabs', 1, changeInfo, { id: 1, url, title: '' });
  return { ...env, visit };
}

test('chapitre lu sur un 2e site : enregistré, et ce site devient le principal', async () => {
  const { store, visit, settle } = setup();
  visit('https://phenix-scans.co/manga/a-returners-magic-should-be-special/chapitre/69');
  await settle();
  assert.equal(store.scans[0].chapter, 69);
  assert.match(store.scans[0].url, /phenix-scans/);
  assert.match(store.scans[0].altUrls[0], /anime-sama/);
});

test('le chapitre suit la lecture en arrière aussi', async () => {
  const { store, fire, settle } = setup();
  const tab = { id: 1, url: 'https://anime-sama.to/catalogue/autre/scan/vf/', title: '' };
  fire('message', { type: 'chapter', num: 2 }, { tab });
  await settle();
  assert.equal(store.scans[1].chapter, 2);
});

test('changement de domaine : tous les liens du site sont corrigés', async () => {
  const { store, visit, settle } = setup();
  visit('https://anime-sama.fr/catalogue/autre/scan/vf/');
  await settle();
  assert.equal(store.scans[1].url, 'https://anime-sama.fr/catalogue/autre/scan/vf/');
  assert.ok(store.scans[0].url.startsWith('https://anime-sama.fr/'));
});

test('historique : lectures comptées, grosses corrections ignorées', async () => {
  const { ext, store, fire, settle } = setup();
  const tab = { id: 1, url: 'https://anime-sama.to/catalogue/autre/scan/vf/', title: '' };
  fire('message', { type: 'chapter', num: 5 }, { tab });
  await settle();
  assert.deepEqual(store.history[today()], { b: 2 });

  const scans = structuredClone(store.scans);
  scans[0].chapter = 200; // correction à la main : +132
  await ext.saveScans(scans);
  await settle();
  assert.deepEqual(store.history[today()], { b: 2 });
});

test('raccourcis clavier +1 / −1', async () => {
  const { store, fire, setActiveTab, calls, settle } = setup();
  setActiveTab({ url: 'https://anime-sama.to/catalogue/autre/scan/vf/', title: '' });
  fire('command', 'chapter-next');
  await settle();
  assert.equal(store.scans[1].chapter, 4);
  assert.equal(calls.badges[1], '4');
  fire('command', 'chapter-prev');
  await settle();
  assert.equal(store.scans[1].chapter, 3);
});

test('nouveaux chapitres : pas de sortie à la 1re vérification, puis journal + notification', async () => {
  let online = 269;
  const fetch = async (url) =>
    String(url).includes('get_nb_chap')
      ? { ok: true, json: async () => Object.fromEntries(Array.from({ length: online }, (_, i) => [i + 1, 1])) }
      : String(url).includes('anime-sama')
        ? { ok: true, text: async () => '<h1 id="titreOeuvre">X</h1>' }
        : { ok: false, status: 503 };
  const { ext, store, calls } = setup({ fetch });

  await ext.checkNewChapters();
  assert.equal(store.scans[0].latest, 269);
  assert.equal(store.releases, undefined);
  assert.equal(calls.notifications.length, 0);

  online = 271;
  await ext.checkNewChapters();
  // Les deux scans sont sur anime-sama : chacun a sa sortie
  const release = store.releases.find((r) => r.id === 'a');
  assert.equal(store.releases.length, 2);
  assert.equal(release.from, 269);
  assert.equal(release.to, 271);
  assert.match(release.link, /anime-sama/);
  assert.equal(calls.notifications.length, 2);
  assert.match(calls.notifications[0].title, /2 nouveaux chapitres/);
  assert.match(calls.notifications[0].message, /A Returner's Magic : chapitre 271 disponible \(tu en es au 68\)/);
});

test('sauvegarde automatique : une fois par semaine au plus', async () => {
  const { ext, store, calls } = setup();
  store.settings = { backup: true };
  await ext.backupIfNeeded();
  await ext.backupIfNeeded();
  assert.equal(calls.downloads.length, 1);
  assert.equal(calls.downloads[0].filename, `MesScans/mes-scans-${today()}.json`);
});
