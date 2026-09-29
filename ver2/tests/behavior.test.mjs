import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesRecord } from '../src/scripts/site.js';
import { bibtex, firstAuthor, validateData, data, publicationText } from '../scripts/content.mjs';

const record={search:'snow line 水 岩石惑星 mori okuzumi 2021',year:'2021',selected:'true',first:'true',scope:'international',type:'invited'};

test('search combines words and filters, including Japanese, and reset restores a record',()=>{
  assert(matchesRecord(record,{q:'  SNOW   mori ',year:'2021',selection:'selected'}));
  assert(matchesRecord(record,{q:'水 惑星',year:'all',selection:'first'}));
  assert(!matchesRecord(record,{q:'snow',year:'2025'}));
  assert(!matchesRecord(record,{q:'absent'}));
  assert(matchesRecord(record,{q:'',year:'all',selection:'all',scope:'all',type:'all'}));
});

test('oral presentations include invited talks; unknown scope is not silently classified',()=>{
  assert(matchesRecord(record,{type:'oral'}));
  assert(matchesRecord(record,{type:'invited'}));
  assert(!matchesRecord(record,{type:'poster'}));
  const unknown={...record,scope:'unspecified'};
  assert(matchesRecord(unknown,{scope:'all'}));
  assert(!matchesRecord(unknown,{scope:'international'}));
});

test('first-author selection does not include a later author or a surname substring',()=>{
  assert(firstAuthor({authorsEn:'<strong>Shoji Mori</strong>, Satoshi Okuzumi'}));
  assert(!firstAuthor({authorsEn:'Yuri Aikawa, <strong>Shoji Mori</strong>'}));
  assert(!firstAuthor({authorsEn:'Shoji Morita, Shoji Mori'}));
});

test('citation export preserves a complete author list and marks a truncated list as others',()=>{
  const full={id:'publication-1',year:'2025',titleEn:'Gas & ice',authorsEn:'<strong>Shoji Mori</strong>, Xue-Ning Bai',journalEn:'The Astrophysical Journal, 992:85',publicationUrl:'https://doi.org/10.3847/1538-4357/adf8d7'};
  const citation=bibtex(full);
  assert(citation.includes('Shoji Mori and Xue-Ning Bai'));
  assert(citation.includes('Gas \\& ice'));
  assert(citation.includes('doi = {10.3847/1538-4357/adf8d7}'));
  assert(citation.includes('volume = {992}'));
  const abbreviated=bibtex({...full,authorsEn:'Yuri Aikawa, ..., Shoji Mori, et al.'});
  assert(abbreviated.includes('author = {Yuri Aikawa and others}'));
  assert(!abbreviated.includes('...'));
});

test('the existing archive validates, but corrupt records fail before publication',()=>{
  const pubs=data('publications.seed'),talks=data('presentations');
  assert.doesNotThrow(()=>validateData(pubs,talks));
  assert.throws(()=>validateData([...pubs,pubs[0]],talks),/Duplicate/);
  assert.throws(()=>validateData([{...pubs[0],publicationUrl:'javascript:alert(1)'}],talks),/Unsafe URL/);
  assert.throws(()=>validateData([{...pubs[0],titleEn:''}],talks),/Missing/);
});

test('bibliography keeps published titles and names while allowing separate translated summaries',()=>{
  const pubs=data('publications.seed');
  const english=pubs.find(p=>p.id==='publication-15');
  assert.notEqual(english.titleEn,english.titleJa);
  assert.equal(publicationText(english).title,english.titleEn);
  assert.equal(publicationText(english).authors,english.authorsEn);
  const japanese=pubs.find(p=>p.id==='publication-17');
  assert.equal(publicationText(japanese).title,japanese.titleJa);
  assert.equal(publicationText(japanese).authors,japanese.authorsJa);
  assert(bibtex(japanese).includes(japanese.titleJa));
  assert(bibtex(japanese).includes('language = {Japanese}'));
});
