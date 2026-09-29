import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import path from 'node:path';
import { root, data, escape, plain, bi, profiles, primaryUrl, external, links, validateData, bibtex, paper, talk, researchFigures, publicationText, authorMarkup, shortVenue, talkFormat } from './content.mjs';

export function build() {
  const publications = data('publications.seed');
  // Newest first by the recorded date; one legacy record sits out of order in the source array.
  const dateKey = (p) => { const m = String(p.date).match(/^(\d{4})\/\s*(\d{1,2})(?:\/\s*(\d{1,2}))?/); return m ? +m[1]*10000 + +m[2]*100 + +(m[3]||0) : +p.year*10000; };
  const presentations = data('presentations').map((p,i)=>({p,i})).sort((a,b)=>dateKey(b.p)-dateKey(a.p)||a.i-b.i).map(({p})=>p);
  const research = data('research');
  const cv = data('cv');
  const materials = data('materials');
  const projects = data('projects');
  validateData(publications,presentations);
  for (const section of [...research,...cv]) if (!section.id || !section.titleEn || !section.titleJa) throw new Error('Invalid bilingual section');
  const dist = path.join(root,'dist');
  mkdirSync(dist,{recursive:true});
  cpSync(path.join(root,'public'),dist,{recursive:true});
  for (const file of ['files','me.webp','me.jpg',data('site').cvPdf.replace(/^\//,''),'google382eb4ad681ea1fc.html','robots.txt','.nojekyll']) cpSync(path.join(root,'..',file),path.join(dist,file),{recursive:true});
  cpSync(path.join(root,'src/styles/styles.css'),path.join(dist,'styles.css'));
  cpSync(path.join(root,'src/scripts/site.js'),path.join(dist,'site.js'));
  writeFileSync(path.join(dist,'publications.bib'),publications.map(bibtex).join('\n\n') + '\n');

  const pages = [
    ['index','','Home','ホーム'],
    ['research','research/','Research','研究'],
    ['publications','publications/','Publications','論文'],
    ['talks','talks/','Talks & materials','発表・資料'],
    ['cv','cv/','CV','CV']
  ];
  const descriptions = {
    index:'Shoji Mori, theoretical astrophysicist at Tsinghua IAS: MHD simulations of protoplanetary disks, disk temperature, and the water snow line.',
    research:'Research by Shoji Mori on electron heating, disk temperatures and water, satellite formation, and observations of young stars.',
    publications:'Papers by Shoji Mori, with links to journal, arXiv and ADS, and BibTeX.',
    talks:'Conference presentations, slides, posters, and theses by Shoji Mori.',
    cv:'Shoji Mori: academic experience, education, grants, awards, teaching, mentoring, and professional service.'
  };
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthsLong = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  // Talks dated after the build day are announced as upcoming.
  const today = new Date();
  const todayKey = today.getFullYear()*10000 + (today.getMonth()+1)*100 + today.getDate();
  const upcoming = (t) => dateKey(t) > todayKey;
  // "Last updated" follows the newest past record, so it reflects the content rather than the build.
  const newest = String((presentations.find(t=>!upcoming(t)) || presentations[0]).date).match(/^(\d{4})\/\s*(\d{1,2})/);
  const newestPaperYear = Math.max(...publications.map(p=>+p.year));
  const updated = newest && +newest[1] >= newestPaperYear ? bi(monthsLong[+newest[2]-1]+' '+newest[1], newest[1]+'年'+(+newest[2])+'月') : bi(String(newestPaperYear), newestPaperYear+'年');
  // CV ranges such as "2023.12 - Present" are shown with an en dash and a translated open end.
  const cvDate = (value) => { const [start,end] = String(value).split(/\s+-\s+/); return end === undefined ? escape(value) : end === 'Present' ? bi(start+'–present', start+'–現在') : escape(start+'–'+end); };
  const template = readFileSync(path.join(root,'src/layouts/base.html'),'utf8');
  const fill = (source,vars) => source.replace(/\{\{(\w+)\}\}/g,(_,key)=>{
    if (!(key in vars)) throw new Error('Missing template value: ' + key);
    return vars[key];
  });
  const paragraphs = (p) => p.paragraphsEn.map((text,i)=>'<p>'+bi(text,p.paragraphsJa[i])+'</p>').join('');
  const years = [...new Set(publications.map(p=>p.year))].sort().reverse();
  // Pages show WebP renditions (see docs/asset-sources.md); the link opens the original full-resolution file.
  const webp = (file,w) => '/images/web/'+file.replace(/\.\w+$/,'')+'-'+w+'.webp';
  const figure = (f) => '<figure class="research-figure"><a href="/images/'+f.file+'" target="_blank" rel="noopener"><img src="'+webp(f.file,1000)+'" srcset="'+webp(f.file,1000)+' 1000w, '+webp(f.file,1800)+' '+Math.min(f.width,1800)+'w" sizes="(min-width: 1150px) 900px, (min-width: 920px) 70vw, 92vw" alt="'+escape(f.alt)+'" width="'+f.width+'" height="'+f.height+'" loading="lazy" decoding="async"></a><figcaption>'+bi(f.captionEn,f.captionJa)+' '+external(f.source,escape(f.credit))+'</figcaption></figure>';
  const publicationById = new Map(publications.map(p=>[p.id,p]));
  const byYear = (records,render) => [...new Set(records.map(r=>r.year))].map(year=>'<section class="year-group" data-year-group aria-labelledby="year-'+year+'"><h2 class="year-heading" id="year-'+year+'">'+year+'</h2><div class="year-records">'+records.filter(r=>r.year===year).map(render).join('')+'</div></section>').join('');
  const site = data('site');
  const homePapers = site.representativePapers;
  for (const id of homePapers) if (!publications.some(p=>p.id===id)) throw new Error('Unknown representative paper in site.json: '+id);
  const listRow = (date,body,aside='') => '<li><span class="list-date">'+date+'</span><div>'+body+'</div>'+aside+'</li>';
  const monthLabel = (t) => { const m = String(t.date).match(/^(\d{4})\/\s*(\d{1,2})/); return m ? bi(months[+m[2]-1]+' '+m[1], m[1]+'年'+(+m[2])+'月') : escape(t.year); };
  const components = {
    // Home: recent talks, research themes and representative papers as dated lists.
    // Papers appear only under representative papers, so nothing is listed twice.
    homeRecent:presentations.slice(0,4).map(t=>listRow(monthLabel(t)+(upcoming(t)?'<span class="upcoming-label">'+bi('Upcoming','予定')+'</span>':''),'<a class="list-title" href="/talks/#'+t.id+'">'+bi(t.titleEn,t.titleJa)+'</a><p class="list-meta">'+talkFormat(t)+' · '+bi(t.confEn,t.confJa)+'</p>')).join(''),
    // Each theme cites its three most recent papers. Cover images are cropped details of figures shown in full, with credits, on the research page.
    homeResearch:research.map(r=>listRow(escape(r.period),'<a class="list-title" href="/research/#'+r.id+'">'+bi(r.titleEn,r.titleJa)+'</a><p class="list-finding">'+bi(r.findingEn,r.findingJa)+'</p><p class="list-meta" lang="en">'+[...r.papers].sort((a,b)=>+publicationById.get(b.id).year - +publicationById.get(a.id).year).slice(0,3).map(ref=>'<a href="/publications/#'+ref.id+'">'+escape(ref.label)+'</a>').join(', ')+'</p>',r.cover?'<img class="list-thumb" src="/images/'+r.cover+'" alt="" width="960" height="600" loading="lazy" decoding="async">':'')).join(''),
    homeSelected:homePapers.map(id=>{
      const p = publicationById.get(id);
      const t = publicationText(p);
      const actions = [[p.publicationUrl||p.url,'Journal'],[p.arxivUrl,'arXiv'],[p.adsUrl,'ADS']].filter(([url])=>url).map(([url,label])=>external(url,label)).join('');
      return listRow(p.year,'<a class="list-title" href="'+escape(primaryUrl(p))+'" lang="'+t.language+'">'+escape(t.title)+'</a><p class="list-meta" lang="'+t.language+'">'+authorMarkup(t.authors)+'</p><p class="list-meta">'+escape(shortVenue(p))+'<span class="list-links">'+actions+'</span></p>');
    }).join(''),
    homeLinks:profiles.filter(([label])=>site.homeProfileLinks.includes(label)).map(([label,url])=>external(url,escape(label))).join(''),
    publicationTotal:String(publications.length),
    siteEmail:escape(site.email),
    siteCv:escape(site.cvPdf),
    siteRole:bi(site.roleEn.join('\n'),site.roleJa.join('\n')).replace(/\n/g,'<br>'),
    siteStatement:bi(site.statementEn,site.statementJa),
    profileList:profiles.map(([label,url])=>external(url,escape(label))).join(''),
    allPublications:byYear(publications,p=>paper(p)),
    publicationCount:'',
    publicationYears:'<option value="all" data-en="All years" data-ja="すべての年">All years</option>'+years.map(y=>'<option value="'+y+'">'+y+'</option>').join(''),
    publicationProfiles:profiles.slice(0,3).map(([label,url])=>external(url,escape(label))).join(''),
    talkCount:'',
    // Talks from the most recent years are listed openly; earlier years sit in a closed group that
    // searching or filtering opens automatically (site.js).
    talkRows:(()=>{
      const years=[...new Set(presentations.map(t=>t.year))];
      const openYears=new Set(years.slice(0,3));
      const recent=presentations.filter(t=>openYears.has(t.year)), older=presentations.filter(t=>!openYears.has(t.year));
      return byYear(recent,t=>talk(t,upcoming(t)))+(older.length?'<details class="older-talks" data-older><summary>'+bi('Earlier talks ('+older[older.length-1].year+'–'+older[0].year+', '+older.length+')','それ以前の発表（'+older[older.length-1].year+'–'+older[0].year+'年、'+older.length+'件）')+'</summary>'+byYear(older,t=>talk(t,upcoming(t)))+'</details>':'');
    })(),
    materials:[...new Set(materials.map(m=>m.categoryEn))].map(category=>{
      const group = materials.filter(m=>m.categoryEn===category);
      return '<section class="material-group"><h3>'+bi(category,group[0].categoryJa)+'</h3><div class="materials-grid">'+group.map(m=>'<article class="material-card"><div class="material-meta"><span>'+m.year+'</span><span>PDF</span></div><h4>'+bi(m.titleEn,m.titleJa)+'</h4><p>'+bi(m.venueEn,m.venueJa)+'</p><div class="paper-links">'+links(m.links)+'</div></article>').join('')+'</div></section>';
    }).join(''),
    researchIndex:research.map(r=>'<a href="#'+r.id+'">'+bi(r.titleEn,r.titleJa)+'</a>').join('')+'<a href="#projects">'+bi('Projects and collaborations','観測プロジェクトと共同研究')+'</a><a href="#vision">'+bi('Research vision','研究の展望')+'</a>',
    // Observational projects come from src/data/projects.json; papers are linked to the publication list.
    researchProjects:projects.map(pr=>{
      const papers = pr.papers.map(id=>{const p=publicationById.get(id);if(!p)throw new Error('Unknown project paper: '+id);return '<li><a href="/publications/#'+p.id+'">'+escape(p.titleEn.replace(/^Early Planet Formation in Embedded Disks \(eDisk\)\.\s*/,'eDisk ').replace(/\s+/g,' '))+'</a> <span>('+p.year+')</span></li>';}).join('');
      return '<article class="project" id="project-'+pr.id+'"><div class="project-head"><h3>'+external(pr.url,pr.nameJa?bi(pr.name,pr.nameJa):escape(pr.name))+'</h3><p class="project-meta">'+escape(pr.fullName)+' · '+bi(pr.facilityEn,pr.facilityJa)+'</p></div><p class="project-role">'+bi(pr.roleEn,pr.roleJa)+'</p>'+(papers?'<details class="project-papers"><summary>'+bi('Papers ('+pr.papers.length+')','関連論文（'+pr.papers.length+'本）')+'</summary><ul>'+papers+'</ul></details>':'')+'</article>';
    }).join(''),
    researchChapters:research.map(r=>{
      const figures = (r.figures||[]).map(({file,after})=>{
        const f = researchFigures.find(f=>f.file===file);
        if(!f)throw new Error('Unknown research figure: '+file);
        return {after,html:figure(f)};
      });
      const references = r.papers.map(ref=>{
        const p = publicationById.get(ref.id);
        if(!p)throw new Error('Unknown research reference: '+ref.id);
        return '<li><a href="/publications/#'+p.id+'" title="'+escape(p.titleEn)+'">'+escape(ref.label)+'</a></li>';
      }).join('');
      const body = r.paragraphsEn.map((text,i)=>'<p>'+bi(text,r.paragraphsJa[i])+'</p>'+figures.filter(f=>f.after===i+1).map(f=>f.html).join('')).join('');
      return '<section class="research-chapter" id="'+r.id+'"><p class="research-period">'+escape(r.period)+'</p><h2>'+bi(r.titleEn,r.titleJa)+'</h2>'+body+'<div class="related-work"><span>'+bi('Papers','関連論文')+'</span><ul>'+references+'</ul></div></section>';
    }).join(''),
    cvIndex:cv.map(s=>'<a href="#'+s.id+'">'+bi(s.titleEn,s.titleJa)+'</a>').join(''),
    cvSections:cv.map(s=>'<section class="cv-section" id="'+s.id+'"><h2>'+bi(s.titleEn,s.titleJa)+'</h2>'+s.items.map(item=>'<article class="cv-entry"><div class="cv-date">'+cvDate(item.date)+'</div><div>'+(item.titleEn?'<h3>'+bi(item.titleEn,item.titleJa)+'</h3>':'')+paragraphs(item)+(item.links.length?'<div class="paper-links">'+links(item.links)+'</div>':'')+'</div></article>').join('')+'</section>').join('')
  };

  const navigation = (current) => pages.slice(1).map(([page,href,label,labelJa])=>'<a href="/'+href+'"'+(page===current?' aria-current="page"':'')+'>'+bi(label,labelJa)+'</a>').join('');
  for (const [file,url,en] of pages) {
    const pageSource = readFileSync(path.join(root,'src/pages',file+'.html'),'utf8');
    const canonical = 'https://shoji-mori.github.io/'+url;
    const schema = {'@context':'https://schema.org','@graph':[
      {'@type':'Person','@id':'https://shoji-mori.github.io/#person',name:'Shoji Mori',alternateName:'森 昇志',url:'https://shoji-mori.github.io/',jobTitle:'Shuimu Fellow',worksFor:{'@type':'CollegeOrUniversity',name:'Tsinghua University'},sameAs:profiles.map(([,url])=>url)},
      {'@type':'WebPage',name:en+' | Shoji Mori',url:canonical,description:descriptions[file],about:{'@id':'https://shoji-mori.github.io/#person'}}
    ]};
    if(file==='publications') for(const p of publications) schema['@graph'].push({'@type':'ScholarlyArticle',headline:p.titleEn,datePublished:p.year,url:primaryUrl(p),author:{'@id':'https://shoji-mori.github.io/#person'},isPartOf:{'@type':'Periodical',name:p.journalEn.split(', ')[0]}});
    const vars = {
      pageTitle:escape(file==='index'?'Shoji Mori | Theoretical astrophysicist, Tsinghua IAS':en+' | Shoji Mori'),
      description:escape(descriptions[file]),
      canonical,
      structuredData:JSON.stringify(schema).replace(/</g,'\\u003c'),
      pageClass:file+'-page',
      content:fill(pageSource,components),
      navigation:navigation(file),
      year:new Date().getFullYear(),
      updated,
      siteEmail:escape(site.email)
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
  const notFound = '<section class="container page-heading"><h1>'+bi('Page not found.','ページが見つかりません。')+'</h1><p class="page-lead">'+bi('The page may have moved. Browse the research or publications below.','ページが移動した可能性があります。以下から研究内容や論文をご覧ください。')+'</p><div class="page-actions" style="margin-top:28px"><a class="text-link" href="/">'+bi('Home','ホーム')+'</a><a class="text-link" href="/research/">'+bi('Research','研究内容')+'</a><a class="text-link" href="/publications/">'+bi('Publications','論文一覧')+'</a></div></section>';
  writeFileSync(path.join(dist,'404.html'),fill(template,{pageTitle:'Page not found | Shoji Mori',description:'The requested page could not be found.',canonical:'https://shoji-mori.github.io/404.html',structuredData:'{}',pageClass:'not-found-page',content:notFound,navigation:navigation(''),year:new Date().getFullYear(),updated,siteEmail:escape(site.email)}));
  // The former Activity page duplicated the talk archive; keep its URL working.
  mkdirSync(path.join(dist,'news'),{recursive:true});
  writeFileSync(path.join(dist,'news','index.html'),'<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0; url=/talks/"><link rel="canonical" href="https://shoji-mori.github.io/talks/"><title>Talks | Shoji Mori</title></head><body><p><a href="/talks/">Talks and materials</a></p></body></html>\n');
  return {pages:5,printPages:2,publications:publications.length,presentations:presentations.length,materials:materials.length};
}

if (process.argv[1] === new URL(import.meta.url).pathname) console.log('Built',build());
