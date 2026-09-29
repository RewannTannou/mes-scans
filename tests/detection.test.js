// Détection du numéro de chapitre dans une adresse ou un texte (shared.js)

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('./helpers/extension');

const { ext } = loadExtension(['shared.js']);

test('detectChapter : numéro et modèle {ch} dans une adresse', () => {
  const cases = [
    ['https://phenix-scans.co/manga/a-returners-magic-should-be-special/chapitre/62', 62, 'https://phenix-scans.co/manga/a-returners-magic-should-be-special/chapitre/{ch}'],
    ['https://sushiscan.net/one-piece-chapitre-1100/', 1100, 'https://sushiscan.net/one-piece-chapitre-{ch}/'],
    ['https://www.japscan.lol/lecture-en-ligne/one-piece/1100/', 1100, 'https://www.japscan.lol/lecture-en-ligne/one-piece/{ch}/'],
    ['https://site.com/manga/chainsaw-man/chapter-150.5', 150.5, 'https://site.com/manga/chainsaw-man/chapter-{ch}'],
    ['https://x.com/read/berserk/ch_373?page=2', 373, 'https://x.com/read/berserk/ch_{ch}?page=2'],
  ];
  for (const [url, num, template] of cases) {
    assert.deepEqual({ ...ext.detectChapter(url) }, { num, template }, url);
  }
});

test("detectChapter : pas de faux positif sur un identifiant ou un nom", () => {
  assert.equal(ext.detectChapter('https://mangadex.org/chapter/8f3a-uuid'), null);
  assert.equal(ext.detectChapter('https://site.com/manga/solo-leveling'), null);
  assert.equal(ext.detectChapter('https://site.com/manga/12345/tower-of-god'), null);
  assert.equal(ext.detectChapter('https://anime-sama.to/catalogue/a-returners-magic-should-be-special/scan/vf/'), null);
});

test('chapterFromText : formats courants', () => {
  assert.equal(ext.chapterFromText('CHAPITRE 68'), 68);
  assert.equal(ext.chapterFromText('Dernière sélection : Chapitre 68'), 68);
  assert.equal(ext.chapterFromText('Ch. 12.5 - Solo Leveling - MangaDex'), 12.5);
  assert.equal(ext.chapterFromText('Episode 4'), 4);
  assert.equal(ext.chapterFromText('Chapter 1,100'), 1100); // séparateur de milliers
  assert.equal(ext.chapterFromText('Chapitre 12,5'), 12.5); // virgule décimale
  assert.equal(ext.chapterFromText("A RETURNER'S MAGIC SHOULD BE SPECIAL"), null);
  assert.equal(ext.chapterFromText('Kaiju No. 8'), null);
});

test('unreadCount : chapitres restants', () => {
  assert.equal(ext.unreadCount({ chapter: 68, latest: 269 }), 201);
  assert.equal(ext.unreadCount({ chapter: 68, latest: 68.5 }), 1);
  assert.equal(ext.unreadCount({ chapter: 70, latest: 69 }), 0);
  assert.equal(ext.unreadCount({ chapter: 5 }), null);
});
