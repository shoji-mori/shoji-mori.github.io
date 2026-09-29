import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const data = (name) => JSON.parse(readFileSync(path.join(root, 'src/data', name + '.json'), 'utf8'));
export const escape = (value = '') => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const plain = (value = '') => String(value).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').trim();
export const bi = (en, ja) => '<span class="en" lang="en">' + escape(en) + '</span><span class="ja" lang="ja">' + escape(ja || en) + '</span>';
const authorMarkup = (value) => escape(value).replace(/&lt;(\/?)strong&gt;/g, '<$1strong>');
export const authors = (en, ja) => '<span class="en" lang="en">' + authorMarkup(en) + '</span><span class="ja" lang="ja">' + authorMarkup(ja || en) + '</span>';
export const firstAuthor = (p) => /^(?:Shoji Mori|S\.\s*Mori)(?:,|$)/i.test(plain(p.authorsEn));
export function publicationText(p) {
  // A translated summary helps readers; a bibliography retains the published language.
  const language = /\[in Japanese\]/i.test(p.journalEn) ? 'ja' : 'en';
  return {language, title:p[language === 'ja' ? 'titleJa' : 'titleEn'], authors:p[language === 'ja' ? 'authorsJa' : 'authorsEn'], journal:p[language === 'ja' ? 'journalJa' : 'journalEn']};
}
export const primaryUrl = (p) => p.publicationUrl || p.url || p.adsUrl || p.arxivUrl;
export const external = (url, label) => '<a href="' + escape(url) + '" target="_blank" rel="noopener">' + label + '</a>';
export const links = (items) => items.map((item) => external(item.url, escape(item.label))).join('');
export const profiles = [
  ['Google Scholar', 'https://scholar.google.com/citations?user=XUF28swAAAAJ'],
  ['NASA ADS', 'https://ui.adsabs.harvard.edu/search/q=orcid%3A0000-0002-7002-939X&sort=date%20desc'],
  ['ORCID', 'https://orcid.org/0000-0002-7002-939X'],
  ['researchmap', 'https://researchmap.jp/mori_shoji'],
  ['GitHub', 'https://github.com/shoji-mori'],
  ['ResearchGate', 'https://www.researchgate.net/profile/Shoji-Mori-3'],
  ['Scopus', 'https://www.scopus.com/authid/detail.uri?authorId=57075536200'],
  ['Web of Science', 'https://www.webofscience.com/wos/author/record/CAG-1288-2022']
];

export function validateData(publications, presentations) {
  for (const [records, required] of [[publications, ['id','year','titleEn','authorsEn','journalEn']], [presentations, ['id','year','titleEn','date','confEn','type']]]) {
    const seen = new Set();
    for (const record of records) {
      for (const field of required) if (typeof record[field] !== 'string' || !record[field].trim()) throw new Error('Missing ' + field + ' in ' + record.id);
      if (!/^\d{4}$/.test(record.year)) throw new Error('Invalid year in ' + record.id);
      if (seen.has(record.id)) throw new Error('Duplicate id: ' + record.id);
      seen.add(record.id);
      for (const [key, value] of Object.entries(record)) if (/url$/i.test(key) && value && !/^(https?:\/\/|\/)/.test(value)) throw new Error('Unsafe URL in ' + record.id + ': ' + key);
    }
  }
  for (const p of publications) if (!primaryUrl(p)) throw new Error('No publication link: ' + p.id);
}

export function bibtex(p) {
  // The legacy bibliography abbreviates some author lists. BibTeX's "others"
  // retains that distinction instead of fabricating missing names.
  const author = plain(p.authorsEn).split(/\s*,\s*/);
  const truncated = author.findIndex((name) => /^(?:\.{3}|…|et al\.?)/i.test(name));
  const fullNames = truncated >= 0 ? [...author.slice(0, truncated), 'others'] : author;
  const latex = (s) => String(s).replace(/\\/g, '\\textbackslash{}').replace(/[{}%&#_]/g, (c) => '\\' + c);
  const doiMatch = (primaryUrl(p) || '').match(/doi\.org\/(.+)$/i);
  const fields = [
    ['title', '{' + latex(publicationText(p).title) + '}'],
    ['author', latex(fullNames.join(' and '))],
    ['year', p.year],
    ['journal', latex(p.journalEn.split(', ')[0])],
    ['url', primaryUrl(p)]
  ];
  if (publicationText(p).language === 'ja') fields.push(['language','Japanese']);
  if (doiMatch) fields.push(['doi', doiMatch[1]]);
  const venue = p.journalEn.match(/,\s*(\d+)(?:\((\d+)\))?[: ]([\w-]+)/);
  if (venue) {
    fields.push(['volume', venue[1]]);
    if (venue[2]) fields.push(['number', venue[2]]);
    fields.push(['pages', venue[3].replace(/(?<!-)-(?!-)/g, '--')]);
  }
  return '@article{Mori' + p.year + '_' + p.id.replace('publication-', '') + ',\n' + fields.map(([k,v]) => '  ' + k + ' = {' + v + '}').join(',\n') + '\n}';
}

export function paper(p, compact = false) {
  const native = publicationText(p);
  const search = [p.titleEn,p.titleJa,plain(p.authorsEn),plain(p.authorsJa),p.journalEn,p.abstractEn,p.abstractJa].join(' ').toLowerCase();
  const actions = [[p.publicationUrl || p.url, 'Journal ↗'],[p.arxivUrl, 'arXiv ↗'],[p.adsUrl, 'ADS ↗']].filter(([url]) => url).map(([url,label]) => external(url, label)).join('');
  return '<article class="paper-row" id="' + p.id + '" data-record data-year="' + p.year + '" data-first="' + firstAuthor(p) + '" data-selected="' + !!p.selected + '" data-search="' + escape(search) + '">' +
    '<div class="paper-year">' + p.year + '</div><div class="paper-body"><h3 lang="'+native.language+'">' + external(primaryUrl(p), escape(native.title)) + '</h3>' +
    '<p class="paper-authors" lang="'+native.language+'">' + authorMarkup(native.authors) + '</p><p class="paper-venue" lang="'+native.language+'">' + escape(native.journal) + '</p>' +
    '<div class="paper-links">' + actions + (compact ? '' : '<button type="button" data-bibtex="' + escape(bibtex(p)) + '">' + bi('Copy BibTeX','BibTeXをコピー') + '</button>') +
    (p.selected && !compact ? '<span class="selected-label">' + bi('Selected','主要論文') + '</span>' : '') + '</div>' +
    (!compact && (p.abstractEn || p.abstractJa) ? '<details class="paper-summary"><summary>' + bi('In plain language','研究の内容を読む') + '</summary><p>' + bi(p.abstractEn,p.abstractJa) + '</p></details>' : '') + '</div></article>';
}

export function talk(p) {
  const actions = [[p.slideUrl,bi('Slides ↓','スライド ↓')],[p.posterUrl,bi('Poster ↓','ポスター ↓')],[p.videoUrl,bi('Video ↗','動画 ↗')],[p.url,bi('Conference ↗','学会・資料 ↗')]].filter(([url])=>url).map(([url,label])=>external(url,label)).join('');
  const format = p.type === 'poster' ? bi('Poster','ポスター') : p.type === 'invited' ? bi('Invited talk','招待講演') : bi('Oral presentation','口頭発表');
  return '<article class="talk-row" id="' + p.id + '" data-record data-scope="' + (p.scope || 'unspecified') + '" data-type="' + p.type + '" data-search="' + escape([p.titleEn,p.titleJa,p.confEn,p.confJa,p.authorsEn,p.authorsJa,p.year].join(' ').toLowerCase()) + '">' +
    '<div class="talk-date">' + escape(p.date) + '<span>' + format + '</span></div><div><h3>' + bi(p.titleEn,p.titleJa) + '</h3>' +
    '<p class="talk-conference">' + bi(p.confEn,p.confJa) + '</p><p class="talk-location">' + bi(p.placeEn,p.placeJa) + '</p><p class="talk-authors">' + bi(p.authorsEn,p.authorsJa) + '</p>' +
    (p.noteEn || p.noteJa ? '<p class="talk-note">' + bi(p.noteEn,p.noteJa) + '</p>' : '') +
    (actions ? '<div class="paper-links">' + actions + '</div>' : '') + '</div></article>';
}

export function news(p) {
  return '<article class="news-item"><span class="news-date">' + escape(p.date) + '</span><div><div class="news-category">' + (p.type === 'poster' ? bi('POSTER','ポスター発表') : bi('PRESENTATION','口頭発表')) + '</div>' +
    '<h3><a href="/talks/#' + p.id + '">' + bi(p.confEn,p.confJa) + '</a></h3><p>' + bi(p.titleEn,p.titleJa) + '</p></div><a class="news-arrow" href="/talks/#' + p.id + '" aria-label="' + escape('View presentation: ' + p.titleEn) + '">↗</a></article>';
}

export const researchFigures = [{
  file:'mhd-alignment-thermal-structure.png', width:1749, height:1278,
  captionEn:'A vertical slice through the simulated disk. The left half shows gas density and the right half temperature. The two panels compare opposite magnetic-field orientations relative to disk rotation.',
  captionJa:'円盤を横から切って見た計算結果。左半分がガス密度、右半分が温度です。上下の図は、円盤の回転に対する磁場の向きが異なるモデルを比較しています。',
  credit:'Mori, Bai & Tomida (2025)',
  source:'/files/posters/poster-20251208-epf-thermal-structure-magnetized-ppds.pdf',
  alt:'Vertical slices of simulated disks: density on the left and temperature on the right, comparing aligned and anti-aligned magnetic fields.'
}];
