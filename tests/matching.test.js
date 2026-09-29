// Reconnaître le scan d'une page visitée (shared.js)

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('./helpers/extension');

const { ext } = loadExtension(['shared.js']);

const armsbs = {
  id: 'a',
  title: "A Returner's Magic Should Be Special",
  chapter: 62,
  url: 'https://phenix-scans.co/manga/a-returners-magic-should-be-special/chapitre/{ch}',
  altUrls: ['https://anime-sama.to/catalogue/a-returners-magic-should-be-special/scan/vf/'],
};
const onePiece = { id: 'b', title: 'One Piece', chapter: 1100, url: 'https://sushiscan.net/one-piece-chapitre-{ch}/' };
const scans = [armsbs, onePiece];

const match = (url) => {
  const hit = ext.matchScan(scans, url);
  return hit && { id: hit.scan.id, num: hit.num, moved: hit.moved && { ...hit.moved } };
};

test('page de chapitre : scan et numéro', () => {
  assert.deepEqual(match('https://phenix-scans.co/manga/a-returners-magic-should-be-special/chapitre/63'), { id: 'a', num: 63, moved: undefined });
  assert.deepEqual(match('http://www.phenix-scans.co/manga/a-returners-magic-should-be-special/chapitre/63/?page=2#top'), { id: 'a', num: 63, moved: undefined });
  assert.deepEqual(match('https://sushiscan.net/one-piece-chapitre-1101/'), { id: 'b', num: 1101, moved: undefined });
});

test('page de la série : scan reconnu sans numéro', () => {
  assert.equal(match('https://phenix-scans.co/manga/a-returners-magic-should-be-special').num, null);
  assert.equal(match('https://phenix-scans.co/manga/a-returners-magic-should-be-special').id, 'a');
});

test('deuxième site du même manga', () => {
  assert.deepEqual(match('https://anime-sama.to/catalogue/a-returners-magic-should-be-special/scan/vf/'), { id: 'a', num: null, moved: undefined });
});

test('site qui a changé de domaine', () => {
  assert.deepEqual(match('https://anime-sama.fr/catalogue/a-returners-magic-should-be-special/scan/vf/').moved, { from: 'anime-sama.to', to: 'anime-sama.fr' });
});

test("pas de confusion avec un autre manga ou un nom proche", () => {
  assert.equal(match('https://phenix-scans.co/manga/other/chapitre/63'), null);
  assert.equal(match('https://phenix-scans.co/manga/a-returners-magic-should-be-special-2'), null);
  assert.equal(match('https://sushiscan.net/one-piece-chapitre-1101-vf/'), null);
});

test('reconnaissance par le titre de l’onglet (même site uniquement)', () => {
  const tab = (url) => ({ url, title: "A Returner's Magic Should Be Special - Chapitre 70 - Phenix Scans" });
  assert.equal(ext.matchByPageTitle(scans, tab('https://phenix-scans.co/lecture/xyz')).scan.id, 'a');
  assert.equal(ext.matchByPageTitle(scans, tab('https://autre-site.com/lecture/xyz')), null);
});

test('renameHost et promoteLink', () => {
  const copy = structuredClone([armsbs]);
  ext.renameHost(copy, 'anime-sama.to', 'anime-sama.fr');
  assert.equal(copy[0].altUrls[0], 'https://anime-sama.fr/catalogue/a-returners-magic-should-be-special/scan/vf/');
  ext.promoteLink(copy[0], copy[0].altUrls[0]);
  assert.match(copy[0].url, /anime-sama\.fr/);
  assert.match(copy[0].altUrls[0], /phenix-scans/);
});

test('seriesUrl : page du manga à partir du modèle', () => {
  assert.equal(ext.seriesUrl('https://phenix-scans.co/manga/x/chapitre/{ch}'), 'https://phenix-scans.co/manga/x');
  assert.equal(ext.seriesUrl('https://sushiscan.net/one-piece-chapitre-{ch}/'), 'https://sushiscan.net/one-piece');
});
