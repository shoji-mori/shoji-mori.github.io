import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import path from 'node:path';
import { root, data, escape, plain, bi, profiles, primaryUrl, external, links, validateData, bibtex, paper, talk, news, researchFigures } from './content.mjs';

export function build() {
  const publications = data('publications.seed');
  const presentations = data('presentations');
  const research = data('research');
  const cv = data('cv');
  const materials = data('materials');
  validateData(publications,presentations);
  for (const section of [...research,...cv]) if (!section.id || !section.titleEn || !section.titleJa) throw new Error('Invalid bilingual section');
  const dist = path.join(root,'dist');
  mkdirSync(dist,{recursive:true});
  cpSync(path.join(root,'public'),dist,{recursive:true});
  for (const file of ['files','me.webp','me.jpg','cv_mori_shoji_v3.3.pdf','google382eb4ad681ea1fc.html','robots.txt','.nojekyll']) cpSync(path.join(root,'..',file),path.join(dist,file),{recursive:true});
  cpSync(path.join(root,'src/styles/styles.css'),path.join(dist,'styles.css'));
  cpSync(path.join(root,'src/scripts/site.js'),path.join(dist,'site.js'));
  writeFileSync(path.join(dist,'publications.bib'),publications.map(bibtex).join('\n\n') + '\n');

  const pages = [
    ['index','','Home','ホーム'],
    ['research','research/','Research','研究'],
    ['publications','publications/','Publications','論文'],
    ['talks','talks/','Talks & materials','発表・資料'],
    ['cv','cv/','About','プロフィール'],
    ['news','news/','Activity','活動']
  ];
  const descriptions = {
    index:'Shoji Mori, theoretical astrophysicist at Tsinghua University. Exploring the physics of protoplanetary disks and the origins of planets.',
    research:'Research by Shoji Mori on electron heating, disk temperatures and water, satellite formation, and observations of young stars.',
    publications:'Publications and reviews by Shoji Mori. Search papers, read accessible summaries, and download citations.',
    talks:'Conference presentations, slides, posters, and theses by Shoji Mori.',
    cv:'Shoji Mori: academic experience, education, grants, awards, teaching, mentoring, and professional service.',
    news:'Recent conference contributions and publicly shared research materials by Shoji Mori.'
  };
  const template = readFileSync(path.join(root,'src/layouts/base.html'),'utf8');
  const fill = (source,vars) => source.replace(/\{\{(\w+)\}\}/g,(_,key)=>{
    if (!(key in vars)) throw new Error('Missing template value: ' + key);
    return vars[key];
  });
  const paragraphs = (p) => p.paragraphsEn.map((text,i)=>'<p>'+bi(text,p.paragraphsJa[i])+'</p>').join('');
  const years = [...new Set(publications.map(p=>p.year))].sort().reverse();
  const figure = (f) => '<figure class="research-figure"><a href="/images/'+f.file+'" target="_blank" rel="noopener"><img src="/images/'+f.file+'" alt="'+escape(f.alt)+'" width="'+f.width+'" height="'+f.height+'" loading="lazy" decoding="async"></a><figcaption>'+bi(f.captionEn,f.captionJa)+' '+external(f.source,escape(f.credit))+'</figcaption></figure>';
  const publicationById = new Map(publications.map(p=>[p.id,p]));
  const homePapers = ['publication-22','publication-15','publication-6','publication-5','publication-2'];
  const components = {
    researchNotes:research.map(r=>'<article class="research-note"><p class="research-period">'+escape(r.period)+'</p><h3><a href="/research/#'+r.id+'">'+bi(r.titleEn,r.titleJa)+'</a></h3><p>'+bi(r.summaryEn,r.summaryJa)+'</p></article>').join(''),
    selectedPublications:homePapers.map(id=>paper(publicationById.get(id),true)).join(''),
    allPublications:publications.map(p=>paper(p)).join(''),
    publicationCount:'',
    publicationYears:'<option value="all" data-en="All years" data-ja="すべての年">All years</option>'+years.map(y=>'<option value="'+y+'">'+y+'</option>').join(''),
    publicationProfiles:profiles.slice(0,3).map(([label,url])=>external(url,escape(label)+' ↗')).join(''),
    newsItems:presentations.slice(0,4).map(news).join(''),
    allNews:presentations.filter(p=>p.year==='2025').map(news).join(''),
    talkCount:'',
    talkRows:presentations.map(talk).join(''),
    materials:[...new Set(materials.map(m=>m.categoryEn))].map(category=>{
      const group = materials.filter(m=>m.categoryEn===category);
      return '<section class="material-group"><h3>'+bi(category,group[0].categoryJa)+'</h3><div class="materials-grid">'+group.map(m=>'<article class="material-card"><div class="material-meta"><span>'+m.year+'</span><span>PDF</span></div><h4>'+bi(m.titleEn,m.titleJa)+'</h4><p>'+bi(m.venueEn,m.venueJa)+'</p><div class="paper-links">'+links(m.links)+'</div></article>').join('')+'</div></section>';
    }).join(''),
    researchIndex:research.map(r=>'<a href="#'+r.id+'">'+bi(r.titleEn,r.titleJa)+'</a>').join(''),
    researchChapters:research.map(r=>{
      const f = researchFigures.find(f=>f.file===r.figure);
      const references = r.papers.map(ref=>{
        const p = publicationById.get(ref.id);
        if(!p)throw new Error('Unknown research reference: '+ref.id);
        return '<li><a href="/publications/#'+p.id+'" title="'+escape(p.titleEn)+'">'+escape(ref.label)+'</a></li>';
      }).join('');
      return '<section class="research-chapter" id="'+r.id+'"><p class="research-period">'+escape(r.period)+'</p><h2>'+bi(r.titleEn,r.titleJa)+'</h2>'+paragraphs(r)+(f?figure(f):'')+'<div class="related-work"><span>'+bi('Papers','関連論文')+'</span><ul>'+references+'</ul></div></section>';
    }).join(''),
    cvIndex:cv.map((s,i)=>'<a href="#'+s.id+'"><span>0'+(i+1)+'</span><span>'+bi(s.titleEn,s.titleJa)+'</span></a>').join(''),
    cvSections:cv.map(s=>'<section class="cv-section" id="'+s.id+'"><h2>'+bi(s.titleEn,s.titleJa)+'</h2>'+s.items.map(item=>'<article class="cv-entry"><div class="cv-date">'+escape(item.date)+'</div><div>'+(item.titleEn?'<h3>'+bi(item.titleEn,item.titleJa)+'</h3>':'')+paragraphs(item)+(item.links.length?'<div class="paper-links">'+links(item.links)+'</div>':'')+'</div></article>').join('')+'</section>').join('')
  };

  for (const [file,url,en] of pages) {
    const pageSource = readFileSync(path.join(root,'src/pages',file+'.html'),'utf8');
    const canonical = 'https://shoji-mori.github.io/'+url;
    const schema = {'@context':'https://schema.org','@graph':[
      {'@type':'Person','@id':'https://shoji-mori.github.io/#person',name:'Shoji Mori',alternateName:'森 昇志',url:'https://shoji-mori.github.io/',jobTitle:'Shuimu Fellow',worksFor:{'@type':'CollegeOrUniversity',name:'Tsinghua University'},sameAs:profiles.map(([,url])=>url)},
      {'@type':'WebPage',name:en+' | Shoji Mori',url:canonical,description:descriptions[file],about:{'@id':'https://shoji-mori.github.io/#person'}}
    ]};
    if(file==='publications') for(const p of publications) schema['@graph'].push({'@type':'ScholarlyArticle',headline:p.titleEn,datePublished:p.year,url:primaryUrl(p),author:{'@id':'https://shoji-mori.github.io/#person'},isPartOf:{'@type':'Periodical',name:p.journalEn.split(', ')[0]}});
    const vars = {
      pageTitle:escape(file==='index'?'Shoji Mori | The origins of planets':en+' | Shoji Mori'),
      description:escape(descriptions[file]),
      canonical,
      structuredData:JSON.stringify(schema).replace(/</g,'\\u003c'),
      pageClass:file+'-page',
      content:fill(pageSource,components),
      navigation:pages.slice(1).map(([page,href,label,labelJa])=>'<a href="/'+href+'"'+(page===file?' aria-current="page"':'')+'>'+bi(label,labelJa)+'</a>').join(''),
      profileLinks:profiles.map(([label,href])=>external(href,escape(label)+'<span aria-hidden="true">↗</span>')).join(''),
      year:new Date().getFullYear()
    };
    const target = path.join(dist,url);
    mkdirSync(target,{recursive:true});
    writeFileSync(path.join(target,'index.html'),fill(template,vars));
  }
  const exportTemplate = readFileSync(path.join(root,'src/layouts/export.html'),'utf8');
  for (const [kind,en,ja,rows] of [
    ['publications','Publications','論文・解説',publications.map(p=>paper(p,true)).join('')],
    ['talks','Presentations','学会発表',presentations.map(talk).join('')]
  ]) {
    const target = path.join(dist,kind,'print');
    mkdirSync(target,{recursive:true});
    writeFileSync(path.join(target,'index.html'),fill(exportTemplate,{kind,title:bi(en,ja),pageTitle:en+' | Shoji Mori',rows}));
  }
  writeFileSync(path.join(dist,'sitemap.xml'),'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+pages.map(([,url])=>'<url><loc>https://shoji-mori.github.io/'+url+'</loc></url>').join('')+'</urlset>\n');
  const notFound = '<section class="container page-heading"><p class="eyebrow section-index">404</p><h1>'+bi('Page not found.','ページが見つかりません。')+'</h1><p class="page-lead">'+bi('The page may have moved. Browse the research or publications below.','ページが移動した可能性があります。以下から研究内容や論文をご覧ください。')+'</p><div class="page-actions" style="margin-top:28px"><a class="button button-ink" href="/">Home →</a><a class="text-link" href="/research/">'+bi('Research','研究内容')+' →</a><a class="text-link" href="/publications/">'+bi('Publications','論文一覧')+' →</a></div></section>';
  writeFileSync(path.join(dist,'404.html'),fill(template,{pageTitle:'Page not found | Shoji Mori',description:'The requested page could not be found.',canonical:'https://shoji-mori.github.io/404.html',structuredData:'{}',pageClass:'not-found-page',content:notFound,navigation:'',profileLinks:profiles.map(([label,url])=>external(url,escape(label))).join(''),year:new Date().getFullYear()}));
  return {pages:6,printPages:2,publications:publications.length,presentations:presentations.length,materials:materials.length};
}

if (process.argv[1] === new URL(import.meta.url).pathname) console.log('Built',build());
