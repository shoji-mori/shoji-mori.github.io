import test from 'node:test';
import assert from 'node:assert/strict';
import { newRecords, mergeByYear } from '../scripts/ads.mjs';

const existing = [
  { id: 'publication-1', year: '2025', titleEn: 'Known Paper', publicationUrl: 'https://doi.org/10.1/KNOWN' },
  { id: 'publication-2', year: '2021', titleEn: 'Older Paper', publicationUrl: '' }
];
const doc = (over) => ({ bibcode: '2026ApJ...1....1M', title: ['A New Paper'], author: ['Mori, Shoji', 'Bai, Xue-Ning'], pub: 'The Astrophysical Journal', volume: '1000', issue: '2', page: ['12'], year: '2026', doi: ['10.1/NEW'], identifier: ['arXiv:2601.01234'], property: ['REFEREED', 'ARTICLE'], doctype: 'article', ...over });

test('new refereed papers become records in the existing format; known ones are skipped', () => {
  const added = newRecords([doc({}), doc({ doi: ['10.1/known'], title: ['Different Title'] }), doc({ doi: [], title: ['Older paper'] })], existing);
  assert.equal(added.length, 1);
  const [p] = added;
  assert.equal(p.id, 'publication-3');
  assert.equal(p.authorsEn, '<strong>Shoji Mori</strong>, Xue-Ning Bai');
  assert.equal(p.authorsJa, '<strong>森 昇志</strong>, Xue-Ning Bai');
  assert.equal(p.journalEn, 'The Astrophysical Journal, 1000(2):12');
  assert.equal(p.publicationUrl, 'https://doi.org/10.1/NEW');
  assert.equal(p.arxivUrl, 'https://arxiv.org/abs/2601.01234');
});

test('non-refereed items and errata are ignored; long author lists are shortened around the owner', () => {
  assert.equal(newRecords([doc({ property: ['NOT REFEREED'] }), doc({ title: ['Erratum: X'], doi: ['10.1/e'] })], existing).length, 0);
  const many = ['A, A', 'B, B', 'C, C', 'D, D', 'E, E', 'Mori, Shoji', 'F, F', 'G, G', 'H, H'];
  const [p] = newRecords([doc({ author: many })], existing);
  assert.equal(p.authorsEn, 'A A, B B, C C, ..., <strong>Shoji Mori</strong>, et al.');
});

test('merged records stay newest first', () => {
  const merged = mergeByYear(existing, [{ id: 'x', year: '2026' }, { id: 'y', year: '2023' }]);
  assert.deepEqual(merged.map((p) => p.id), ['x', 'publication-1', 'y', 'publication-2']);
});
