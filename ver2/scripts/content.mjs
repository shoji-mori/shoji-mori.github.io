import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const data = (name) => JSON.parse(readFileSync(path.join(root, 'src/data', name + '.json'), 'utf8'));
export const escape = (value = '') => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const plain = (value = '') => String(value).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').trim();
export const bi = (en, ja) => '<span class="en" lang="en">' + escape(en) + '</span><span class="ja" lang="ja">' + escape(ja || en) + '</span>';
export const authorMarkup = (value) => escape(value).replace(/&lt;(\/?)strong&gt;/g, '<$1strong>');
export const authors = (en, ja) => '<span class="en" lang="en">' + authorMarkup(en) + '</span><span class="ja" lang="ja">' + authorMarkup(ja || en) + '</span>';
export const firstAuthor = (p) => /^(?:Shoji Mori|S\.\s*Mori)(?:,|$)/i.test(plain(p.authorsEn));
export function publicationText(p) {
  // A translated summary helps readers; a bibliography retains the published language.
  const language = /\[in Japanese\]/i.test(p.journalEn) ? 'ja' : 'en';
  return {language, title:p[language === 'ja' ? 'titleJa' : 'titleEn'], authors:p[language === 'ja' ? 'authorsJa' : 'authorsEn'], journal:p[language === 'ja' ? 'journalJa' : 'journalEn']};
}
// Standard journal abbreviations for compact lists; the full name stays in the archive and citations.
export const shortVenue = (p) => p.journalEn.replace(/^The Astrophysical Journal Letters/, 'ApJL').replace(/^The Astrophysical Journal/, 'ApJ').replace(/^Astronomy & Astrophysics/, 'A&A').replace(/^Monthly Notices of the Royal Astronomical Society/, 'MNRAS').replace(/,\s*/, ' ');
export const primaryUrl = (p) => p.publicationUrl || p.url || p.adsUrl || p.arxivUrl;
export const external = (url, label) => '<a href="' + escape(url) + '" target="_blank" rel="noopener">' + label + '</a>';
// Generic link labels in the CV and materials data have Japanese equivalents; names such as journals stay as written.
const linkLabelsJa = {'Thesis (PDF)':'学位論文（PDF）','Slides':'スライド','Program':'プログラム','Video':'動画'};
export const links = (items) => items.map((item) => external(item.url, linkLabelsJa[item.label] ? bi(item.label, linkLabelsJa[item.label]) : escape(item.label))).join('');
// Profile links come from src/data/site.json.
export const profiles = data('site').profiles.map(({label,url})=>[label,url]);

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

export function paper(p, compact = false, note = '') {
  const native = publicationText(p);
  const search = [p.titleEn,p.titleJa,plain(p.authorsEn),plain(p.authorsJa),p.journalEn,p.abstractEn,p.abstractJa].join(' ').toLowerCase();
  const actions = [[p.publicationUrl || p.url, 'Journal'],[p.arxivUrl, 'arXiv'],[p.adsUrl, 'ADS']].filter(([url]) => url).map(([url,label]) => external(url, label)).join('');
  return '<article class="paper-row" id="' + p.id + '" data-record data-year="' + p.year + '" data-first="' + firstAuthor(p) + '" data-selected="' + !!p.selected + '" data-search="' + escape(search) + '">' +
    '<div class="paper-year">' + p.year + '</div><div class="paper-body"><h3 lang="'+native.language+'">' + external(primaryUrl(p), escape(native.title)) + '</h3>' +
    '<p class="paper-authors" lang="'+native.language+'">' + authorMarkup(native.authors) + '</p><p class="paper-venue" lang="'+native.language+'">' + escape(native.journal) + '</p>' + (note ? '<p class="paper-note">' + note + '</p>' : '') +
    '<div class="paper-links">' + actions + (compact ? '' : '<button type="button" data-bibtex="' + escape(bibtex(p)) + '">' + bi('Copy BibTeX','BibTeXをコピー') + '</button>') +
    (p.selected && !compact ? '<span class="selected-label">' + bi('Selected','主要論文') + '</span>' : '') + '</div>' +
    (!compact && (p.abstractEn || p.abstractJa) ? '<details class="paper-summary"><summary>' + bi('In plain language','研究の内容を読む') + '</summary><p>' + bi(p.abstractEn,p.abstractJa) + '</p></details>' : '') + '</div></article>';
}

export const talkFormat = (p) => p.type === 'poster' ? bi('Poster','ポスター') : p.type === 'invited' ? bi('Invited talk','招待講演') : bi('Oral presentation','口頭発表');

// A highlighted talk (invited, or marked "highlight": true in the data) shows in full, with an optional
// short description; other talks use a compact row with the details in one line.
export const isHighlight = (p) => p.highlight ?? p.type === 'invited';

export function talk(p, upcoming = false) {
  const actions = [[p.slideUrl,bi('Slides (PDF)','スライド（PDF）')],[p.posterUrl,bi('Poster (PDF)','ポスター（PDF）')],[p.videoUrl,bi('Video','動画')],[p.url,bi('Conference','学会ページ')]].filter(([url])=>url).map(([url,label])=>external(url,label)).join('');
  if (!isHighlight(p)) return '<article class="talk-row talk-compact" id="' + p.id + '" data-record data-scope="' + (p.scope || 'unspecified') + '" data-type="' + p.type + '" data-search="' + escape([p.titleEn,p.titleJa,p.confEn,p.confJa,p.authorsEn,p.authorsJa,p.year].join(' ').toLowerCase()) + '">' +
    '<div class="talk-date">' + escape(String(p.date).replace(/\/\s+/g, '/')) + (upcoming ? '<span class="upcoming-label">' + bi('Upcoming','予定') + '</span>' : '') + '</div><div><h3>' + bi(p.titleEn,p.titleJa) + '</h3>' +
    '<p class="talk-meta"><span class="format-label">' + talkFormat(p) + '</span> · ' + bi(p.confEn,p.confJa) + (p.placeEn ? ' · ' + bi(String(p.placeEn).split(', ').slice(-2).join(', '), String(p.placeJa || '').replace(/^.*\(([^)]*)\)\s*$/, '$1') || p.placeEn) : '') + '</p>' +
    (actions ? '<div class="paper-links">' + actions + '</div>' : '') + '</div></article>';
  return '<article class="talk-row talk-highlight" id="' + p.id + '" data-record data-scope="' + (p.scope || 'unspecified') + '" data-type="' + p.type + '" data-search="' + escape([p.titleEn,p.titleJa,p.confEn,p.confJa,p.authorsEn,p.authorsJa,p.year].join(' ').toLowerCase()) + '">' +
    '<div class="talk-date">' + escape(String(p.date).replace(/\/\s+/g, '/')) + '<span class="format-label">' + talkFormat(p) + '</span>' + (upcoming ? '<span class="upcoming-label">' + bi('Upcoming','予定') + '</span>' : '') + '</div><div><h3>' + bi(p.titleEn,p.titleJa) + '</h3>' +
    '<p class="talk-conference">' + bi(p.confEn,p.confJa) + '</p><p class="talk-location">' + bi(p.placeEn,p.placeJa) + '</p><p class="talk-authors">' + bi(p.authorsEn,p.authorsJa) + '</p>' +
    (p.noteEn || p.noteJa ? '<p class="talk-note">' + bi(p.noteEn,p.noteJa) + '</p>' : '') +
    (p.summaryEn ? '<p class="talk-summary">' + bi(p.summaryEn,p.summaryJa) + '</p>' : '') +
    (actions ? '<div class="paper-links">' + actions + '</div>' : '') + '</div></article>';
}

export const researchFigures = [{
  file:'mhd-alignment-thermal-structure.png', width:1749, height:1278,
  captionEn:'A vertical slice through the simulated disk. The left half shows gas density and the right half temperature. The two panels compare opposite magnetic-field orientations relative to disk rotation.',
  captionJa:'円盤を横から切って見た計算結果。左半分がガス密度、右半分が温度です。上下の図は、円盤の回転に対する磁場の向きが異なるモデルを比較しています。',
  credit:'Mori, Bai & Tomida (2025)',
  source:'/files/posters/poster-20251208-epf-thermal-structure-magnetized-ppds.pdf',
  alt:'Vertical slices of simulated disks: density on the left and temperature on the right, comparing aligned and anti-aligned magnetic fields.'
},{
  file:'planet-growth-migration-tracks.png', width:2028, height:787,
  captionEn:'Model growth and migration tracks of planets in a turbulent disk (left) and a magnetically driven disk (right). Track colors show the water fraction of each planet.',
  captionJa:'乱流円盤（左）と磁場駆動の円盤（右）のモデルで計算した、惑星の成長と軌道移動の道筋。線の色は惑星に含まれる水の割合を表します。',
  credit:'Mori, Kunitomo & Ogihara (2025)',
  source:'/files/posters/poster-20251208-epf-thermal-structure-magnetized-ppds.pdf',
  alt:'Planet mass versus orbital radius for turbulent and MHD disk models, with growth tracks colored by water fraction.'
},{
  file:'episodic-surface-accretion.png', width:1851, height:795,
  captionEn:'Ratio of the surface accretion rate to the accretion rate inside the disk, as a function of radius and time, in a 2D radiation nonideal MHD simulation. Episodes of stronger surface accretion recur.',
  captionJa:'二次元輻射非理想MHD計算で、表層の降着率と円盤内部の降着率の比を、半径と時間の関数として示した図。表層の降着が強まる時期が繰り返し現れます。',
  credit:'Mori, Bai & Tomida (2025)',
  source:'/files/slides/slide-20250911-asj-autumn-global-nonideal-mhd.pdf',
  alt:'A radius-time map of the surface-to-disk accretion-rate ratio, showing repeated episodes of stronger surface accretion.'
},{
  file:'electron-heating-mri-snapshots.png', width:1876, height:814,
  captionEn:'Magnetic-field strength in local magnetohydrodynamic simulations after 60 orbits, with electron heating (left) and without it (right). With electron heating, the small-scale turbulence seen on the right is suppressed. Field strength is shown in normalized units.',
  captionJa:'局所的な磁気流体シミュレーションで、60公転後の磁場の強さを比べた図。左が電子加熱あり、右が電子加熱なし。電子加熱があると、右に見られる細かな乱流が抑えられます。磁場の強さは規格化した値です。',
  credit:'Mori et al. (2017)',
  source:'/files/thesis/thesis-201903-phd-thesis.pdf',
  alt:'Two simulation boxes colored by magnetic-field strength: a nearly uniform, layered box with electron heating and a box full of small turbulent structures without it.'
},{
  file:'cpd-wind-accretion-schematic.png', width:2000, height:1335,
  captionEn:'Schematic of a disk around a young giant planet (CPD) inside the planet-forming disk (PPD). Gas falls onto the CPD from the PPD, a magnetically driven wind leaves the disk surface, and gas flows both toward and away from the planet within the CPD.',
  captionJa:'原始惑星系円盤（PPD）の中で、若い巨大惑星を取り巻く周惑星円盤（CPD）の模式図。PPDからガスが降り積もり、円盤の表面から磁場が駆動する風が吹き出し、CPDの中では惑星へ向かう流れと外へ向かう流れが生じます。',
  credit:'Mori (2025 talk); see Shibaike & Mori (2023)',
  source:'/files/slides/slide-20250128-cpdsf3-magnetic-circumplanetary-disks.pdf',
  alt:'Schematic: a planet surrounded by a circumplanetary disk, with arrows for infall from the protoplanetary disk, a wind from the disk surface, and inward and outward flows in the disk.'
}];
