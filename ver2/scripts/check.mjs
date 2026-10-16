import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { root, data } from './content.mjs';

const dist=path.join(root,'dist');
const pages=['index.html','research/index.html','publications/index.html','talks/index.html','cv/index.html','publications/print/index.html','talks/print/index.html','404.html'];
const documents=new Map(pages.map(p=>[p,readFileSync(path.join(dist,p),'utf8')]));
const decode=(text)=>text.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
let localReferences=0;
for(const [file,html] of documents) {
  assert.equal((html.match(/<h1(?:\s|>)/g)||[]).length,1,file+': one main heading');
  assert(!/\{\{\w+\}\}/.test(html),file+': unresolved template');
  assert(!/(?:src|href)="(?:undefined|null|#)"/.test(html),file+': unresolved target');
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size,ids.length,file+': duplicate IDs');
  const inputs=[...html.matchAll(/<(?:input|textarea|select)\b[^>]*>/g)].map(m=>m[0]);
  for(const input of inputs) assert(/(?:\bid=|\baria-label=)/.test(input)||html.includes('<label'),file+': unlabeled input');
  for(const script of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g))JSON.parse(script[1]);
  for(const img of html.matchAll(/<img\b[^>]*>/g)) {
    assert(/\balt="[^"]*"/.test(img[0]),file+': missing alt');
    assert(/\bwidth="\d+"/.test(img[0]) && /\bheight="\d+"/.test(img[0]),file+': image size required');
  }
  for(const link of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const ref=decode(link[1]);
    if(/^(?:https?:|mailto:|data:)/.test(ref))continue;
    const [location,hash]=ref.split('#');
    const pathname=location.split('?')[0];
    let target=pathname?path.resolve(dist,'.'+pathname):path.join(dist,file);
    assert(target.startsWith(dist+path.sep)||target===dist,'reference escapes dist');
    if(existsSync(target)&&statSync(target).isDirectory())target=path.join(target,'index.html');
    assert(existsSync(target),file+': missing local target '+ref);
    if(hash && path.extname(target)==='.html')assert(readFileSync(target,'utf8').includes('id="'+hash+'"'),file+': missing fragment '+ref);
    localReferences++;
  }
}
assert.equal((documents.get('publications/index.html').match(/class="paper-row"/g)||[]).length,data('publications.seed').length);
assert.equal((documents.get('talks/index.html').match(/class="talk-row[ "]/g)||[]).length,data('presentations').length);
assert.equal((documents.get('talks/index.html').match(/class="material-card"/g)||[]).length,data('materials').length);
assert.equal((documents.get('research/index.html').match(/class="research-chapter"/g)||[]).length,data('research').length);
assert(!documents.get('index.html').includes('stats-band'));
// The former Activity page redirects to the talk archive.
assert(readFileSync(path.join(dist,'news/index.html'),'utf8').includes('url=/talks/'));
// Home lists each paper once: talks under Recent, papers under Representative papers.
const home=documents.get('index.html');
assert(!home.slice(home.indexOf('id="home-recent"'),home.indexOf('id="home-research"')).includes('doi.org'));
assert.equal((documents.get('publications/print/index.html').match(/class="paper-row"/g)||[]).length,data('publications.seed').length);
assert.equal((documents.get('talks/print/index.html').match(/class="talk-row[ "]/g)||[]).length,data('presentations').length);
assert(!documents.get('talks/print/index.html').includes('material-card'));
assert.equal((documents.get('cv/index.html').match(/class="cv-entry"/g)||[]).length,data('cv').reduce((total,section)=>total+section.items.length,0));
assert.equal((readFileSync(path.join(dist,'publications.bib'),'utf8').match(/@article{/g)||[]).length,data('publications.seed').length);
assert(readFileSync(path.join(dist,'styles.css'),'utf8').includes('@media print'));
assert(readFileSync(path.join(dist,'styles.css'),'utf8').includes('prefers-reduced-motion'));
// Disk Lab's card on home and research, with the render waiting for it (the way back from Disk Lab), and /disk-lab/ in
// the sitemap. Only the regular pages opt in to view transitions: the print pages stay as they were.
for(const page of ['index.html','research/index.html']){
  const html=documents.get(page);
  assert(html.includes('href="/disk-lab/"')&&html.includes('data-disk-lab-card'),page+': Disk Lab card');
  assert(html.includes('<link rel="expect" href="#disk-lab-card" blocking="render">'),page+': the render waits for the card');
}
assert(readFileSync(path.join(dist,'sitemap.xml'),'utf8').includes('<loc>https://shoji-mori.github.io/disk-lab/</loc>'));
// Disk Lab in the header's navigation, on the desktop and in the mobile menu, of every page with the site's header.
for(const [page,html] of documents){
  if(!html.includes('class="desktop-nav"')) continue;
  for(const nav of ['class="desktop-nav"','id="mobile-nav"']){
    const at=html.indexOf(nav), part=html.slice(at,html.indexOf('</nav>',at));
    assert(part.includes('<a href="/disk-lab/">Disk Lab</a>'),page+': Disk Lab in the navigation ('+nav+')');
  }
}
assert(documents.get('index.html').includes('@view-transition')&&!documents.get('publications/print/index.html').includes('@view-transition'));
console.log('Validated '+pages.length+' pages, '+localReferences+' local references, all migrated records, image dimensions, document metadata, and citation downloads.');
