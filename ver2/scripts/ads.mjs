// NASA ADS lookup for new refereed papers. Pure functions are exported for tests;
// the network part runs only from scripts/sync-ads.mjs.
const SEARCH_URL = 'https://api.adsabs.harvard.edu/v1/search/query';
const FIELDS = ['bibcode', 'title', 'author', 'pub', 'volume', 'issue', 'page', 'year', 'doi', 'identifier', 'property', 'doctype'];
export const ORCID = '0000-0002-7002-939X';

export async function searchByOrcid(orcid, token, fetchImpl = fetch) {
  const query = new URLSearchParams({ q: `orcid:${orcid}`, fl: FIELDS.join(','), rows: '200', sort: 'date desc' });
  const response = await fetchImpl(`${SEARCH_URL}?${query}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`ADS search failed: ${response.status} ${response.statusText}`);
  return (await response.json()).response.docs;
}

const normalize = (title) => String(title).toLowerCase().replace(/<[^>]*>/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const doiOf = (url = '') => (String(url).match(/doi\.org\/(.+)$/i) || [])[1]?.toLowerCase();

// "Mori, Shoji" -> "Shoji Mori"; long author lists are shortened the way the existing records are.
function formatAuthors(authors, me, others) {
  const names = authors.map((a) => a.split(/,\s*/).reverse().join(' ').trim());
  const mine = names.findIndex((n) => /^Shoji Mori$|^S\.\s*Mori$/i.test(n));
  const mark = (n, i) => (i === mine ? `<strong>${me}</strong>` : n);
  if (names.length <= 8) return names.map(mark).join(', ');
  const head = names.slice(0, 3).map(mark);
  return mine >= 3 ? `${head.join(', ')}, ..., <strong>${me}</strong>, ${others}` : `${head.join(', ')}, ${others}`;
}

function journal(doc) {
  const page = Array.isArray(doc.page) ? doc.page[0] : doc.page;
  const volume = doc.volume ? doc.volume + (doc.issue ? `(${doc.issue})` : '') : '';
  return [doc.pub, [volume, page].filter(Boolean).join(':')].filter(Boolean).join(', ');
}

// Returns records for refereed articles not yet in `existing`, shaped like publications.seed.json.
// Plain-language summaries and Japanese names are left for the owner to fill in.
export function newRecords(docs, existing) {
  const knownDoi = new Set(existing.map((p) => doiOf(p.publicationUrl)).filter(Boolean));
  const knownTitle = new Set(existing.map((p) => normalize(p.titleEn)));
  let next = Math.max(...existing.map((p) => Number(p.id.replace('publication-', '')))) + 1;
  const out = [];
  for (const doc of docs) {
    if (!(doc.property || []).includes('REFEREED') || !['article', 'eprint'].includes(doc.doctype ?? 'article')) continue;
    if (/^erratum/i.test(doc.title?.[0] ?? '')) continue;
    const doi = doc.doi?.[0]?.toLowerCase();
    const title = doc.title?.[0] ?? '';
    if ((doi && knownDoi.has(doi)) || knownTitle.has(normalize(title))) continue;
    const arxiv = (doc.identifier || []).map((i) => (String(i).match(/^arXiv:(\d{4}\.\d{4,5})$/i) || [])[1]).find(Boolean);
    const venue = journal(doc);
    out.push({
      year: String(doc.year), selected: false,
      titleEn: title, titleJa: title,
      authorsEn: formatAuthors(doc.author || [], 'Shoji Mori', 'et al.'),
      authorsJa: formatAuthors(doc.author || [], '森 昇志', 'ほか'),
      journalEn: venue, journalJa: venue,
      publicationUrl: doi ? `https://doi.org/${doc.doi[0]}` : '',
      arxivUrl: arxiv ? `https://arxiv.org/abs/${arxiv}` : '',
      adsUrl: `https://ui.adsabs.harvard.edu/abs/${doc.bibcode}/abstract`,
      abstractEn: '', abstractJa: '',
      id: `publication-${next++}`
    });
  }
  return out;
}

// Inserts new records by year, newest first, keeping the existing order within a year.
export function mergeByYear(existing, added) {
  const merged = [...existing];
  for (const record of added) {
    const at = merged.findIndex((p) => Number(p.year) <= Number(record.year));
    merged.splice(at < 0 ? merged.length : at, 0, record);
  }
  return merged;
}
