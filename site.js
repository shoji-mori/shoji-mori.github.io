export function matchesRecord(record, filters) {
  const query = (filters.q || '').trim().toLocaleLowerCase();
  const words = query.split(/\s+/).filter(Boolean);
  return words.every(word => (record.search || '').includes(word))
    && (!filters.year || filters.year === 'all' || record.year === filters.year)
    && (!filters.scope || filters.scope === 'all' || record.scope === filters.scope)
    && (!filters.type || filters.type === 'all' || record.type === filters.type || (filters.type === 'oral' && record.type === 'invited'))
    && (filters.selection !== 'selected' || record.selected === 'true')
    && (filters.selection !== 'first' || record.first === 'true');
}

function initializeSite() {
  const html = document.documentElement;
  const japanese = () => html.lang === 'ja';
  const localize = (en, ja) => japanese() ? ja : en;
  const menuButton = document.querySelector('.menu-toggle');
  const mobileNav = document.getElementById('mobile-nav');
  const filterSections = [...document.querySelectorAll('[data-filter-list]')];
  const incomingParams=new URLSearchParams(location.search);
  for(const section of filterSections) {
    for(const control of section.querySelector('form').elements) {
      if(!control.name||!incomingParams.has(control.name))continue;
      const value=incomingParams.get(control.name);
      if(control.tagName==='SELECT'&&![...control.options].some(option=>option.value===value))continue;
      control.value=value;
    }
  }
  let toastTimer;

  function toast(en, ja) {
    const status = document.getElementById('copy-status');
    status.textContent = localize(en,ja);
    status.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=>status.classList.remove('visible'),4500);
  }

  function applyFilters(section) {
    const form = section.querySelector('form');
    const filters = Object.fromEntries(new FormData(form));
    const records = [...section.querySelectorAll('[data-record]')];
    let count = 0;
    for (const record of records) {
      const matches = matchesRecord(record.dataset,filters);
      record.hidden = !matches;
      if(matches) count++;
    }
    section.querySelectorAll('[data-year-group]').forEach(group=>{group.hidden=!group.querySelector('[data-record]:not([hidden])');});
    const filtered = Object.entries(filters).some(([key,value])=>key==='q'?value.trim():value!=='all');
    section.querySelector('.results-count').textContent = filtered ? localize(count+(count===1?' result':' results'),'検索結果：'+count+'件') : '';
    section.querySelector('.empty-state').hidden = count > 0;
    section.querySelector('.clear-filters').hidden = !filtered;
    const kind=section.dataset.filterList;
    document.querySelectorAll('[data-export="'+kind+'"]').forEach(link=>{
      link.href='/'+kind+'/print/?'+new URLSearchParams({lang:html.lang,...filters});
    });
    const query=new URLSearchParams({lang:html.lang});
    for(const [key,value] of Object.entries(filters))if(value&&value!=='all')query.set(key,value);
    history.replaceState(null,'',location.pathname+'?'+query+location.hash);
  }

  function setLanguage(lang, persist = true) {
    html.lang=lang;
    html.classList.toggle('lang-ja',lang==='ja');
    document.querySelectorAll('[data-lang]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.lang===lang)));
    document.querySelectorAll('option[data-en]').forEach(option=>option.textContent=lang==='ja'?option.dataset.ja:option.dataset.en);
    document.querySelectorAll('[data-placeholder-en]').forEach(input=>input.placeholder=lang==='ja'?input.dataset.placeholderJa:input.dataset.placeholderEn);
    if(menuButton) menuButton.setAttribute('aria-label',localize('Navigation menu','ナビゲーションメニュー'));
    document.querySelectorAll('a[href^="https://researchmap.jp/mori_shoji"]').forEach(link=>{
      link.href='https://researchmap.jp/mori_shoji'+(lang==='ja'?'':'?lang=en');
    });
    for(const section of filterSections) applyFilters(section);
    if(persist) {
      // Storage can be unavailable in private or restricted browser contexts.
      // The visible language still changes; only persistence is optional.
      try{localStorage.setItem('lang',lang);}catch{}
    }
  }
  setLanguage((incomingParams.get('lang')||html.lang)==='ja'?'ja':'en',false);
  document.querySelectorAll('[data-lang]').forEach(button=>button.addEventListener('click',()=>setLanguage(button.dataset.lang)));

  const exportSheet=document.querySelector('[data-print-document]');
  if(exportSheet) {
    const params=new URLSearchParams(location.search);
    if(!params.has('sourceLang'))params.set('sourceLang',params.get('lang')==='ja'?'ja':'en');
    const language=document.getElementById('export-language');
    const range=document.getElementById('export-range');
    const printButton=document.getElementById('export-print');
    const returnParams=new URLSearchParams(params);
    returnParams.delete('range');
    returnParams.set('lang',params.get('sourceLang'));
    returnParams.delete('sourceLang');
    document.querySelector('.export-toolbar>a').href='/'+exportSheet.dataset.printDocument+'/?'+returnParams;
    const records=[...exportSheet.querySelectorAll('[data-record]')];
    const keys=exportSheet.dataset.printDocument==='publications'?['q','year','selection']:['q','scope','type'];
    const filters=Object.fromEntries(keys.map(key=>[key,params.get(key)|| (key==='q'?'':'all')]));
    language.value=params.get('lang')==='ja'?'ja':'en';
    range.value=params.get('range')==='filtered'?'filtered':'all';
    function updateExport() {
      // Export preferences belong to this document, not the website's saved language.
      setLanguage(language.value,false);
      let count=0;
      for(const record of records) {
        record.hidden=range.value==='filtered'&&!matchesRecord(record.dataset,filters);
        if(!record.hidden)count++;
      }
      const labels={q:localize('Search','検索語'),year:localize('Year','年'),selection:localize('Authorship','掲載区分'),scope:localize('Conference','学会区分'),type:localize('Format','形式')};
      const values={selected:localize('Selected works','主要論文'),first:localize('First author','筆頭著者'),international:localize('International','国際学会'),domestic:localize('Domestic','国内学会'),unspecified:localize('Unspecified','区分なし'),oral:localize('Oral, including invited','口頭発表（招待を含む）'),invited:localize('Invited','招待講演'),poster:localize('Poster','ポスター')};
      const criteria=Object.entries(filters).filter(([key,value])=>value&&value!=='all').map(([key,value])=>labels[key]+': '+(key==='q'?value:(values[value]||value)));
      exportSheet.querySelector('.export-context').textContent=range.value==='all'
        ?localize('Complete list','すべての記録')
        :localize('Filtered list ('+count+(count===1?' result)':' results)'),'絞り込んだ一覧（'+count+'件）')+(criteria.length?' · '+criteria.join(' / '):'');
      exportSheet.querySelector('.export-empty').hidden=count>0;
      printButton.disabled=count===0;
      params.set('lang',language.value);
      params.set('range',range.value);
      history.replaceState(null,'',location.pathname+'?'+params);
      document.title=localize('Shoji Mori — ','森 昇志 — ')+(exportSheet.dataset.printDocument==='publications'?localize('Publications','論文一覧'):localize('Presentations','発表一覧'));
    }
    language.addEventListener('change',updateExport);
    range.addEventListener('change',updateExport);
    printButton.addEventListener('click',()=>window.print());
    updateExport();
    return;
  }

  const closeMenu = (focus = false) => {
    mobileNav.hidden=true;
    menuButton.setAttribute('aria-expanded','false');
    if(focus) menuButton.focus();
  };
  menuButton?.addEventListener('click',()=>{
    const open=menuButton.getAttribute('aria-expanded')!=='true';
    menuButton.setAttribute('aria-expanded',String(open));
    mobileNav.hidden=!open;
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape' && !mobileNav.hidden) closeMenu(true);
  });
  mobileNav?.querySelectorAll('a').forEach(link=>link.addEventListener('click',()=>closeMenu()));
  window.matchMedia('(min-width: 861px)').addEventListener('change',event=>{if(event.matches)closeMenu();});

  for(const section of filterSections) {
    const form=section.querySelector('form');
    form.addEventListener('submit',event=>event.preventDefault());
    form.addEventListener('input',()=>applyFilters(section));
    form.addEventListener('change',()=>applyFilters(section));
    section.querySelector('.clear-filters').addEventListener('click',()=>{
      form.reset();applyFilters(section);form.querySelector('input').focus();
    });
  }
  document.querySelectorAll('[data-print]').forEach(button=>button.addEventListener('click',()=>window.print()));
  document.querySelectorAll('[data-bibtex]').forEach(button=>button.addEventListener('click',async()=>{
    try {
      await navigator.clipboard.writeText(button.dataset.bibtex);
      toast('Citation copied.','引用情報をコピーしました。');
    } catch {
      toast('Copy is unavailable. Use the BibTeX download at the top of this page.','コピーできませんでした。ページ上部のBibTeXダウンロードをご利用ください。');
    }
  }));

  function openLinkedSummary() {
    const target=document.getElementById(location.hash.slice(1));
    const summary=target?.querySelector('.paper-summary');
    if(summary)summary.open=true;
  }
  openLinkedSummary();
  window.addEventListener('hashchange',openLinkedSummary);

  // Highlight the section currently being read in the side index.
  const indexLinks=[...document.querySelectorAll('.page-index a[href^="#"]')];
  if(indexLinks.length && 'IntersectionObserver' in window) {
    const visible=new Set();
    const spy=new IntersectionObserver(entries=>{
      for(const entry of entries) entry.isIntersecting?visible.add(entry.target.id):visible.delete(entry.target.id);
      const current=indexLinks.find(link=>visible.has(link.hash.slice(1)));
      if(current) indexLinks.forEach(link=>link.classList.toggle('is-current',link===current));
    },{rootMargin:'-20% 0px -60% 0px'});
    indexLinks.forEach(link=>{const target=document.getElementById(link.hash.slice(1));if(target)spy.observe(target);});
  }


  // Preserve inbound links from the former single-page site.
  if(location.pathname==='/' || location.pathname==='/index.html') {
    const redirects={
      '#research':'/research/','#research-overview':'/research/','#publications':'/publications/',
      '#presentations':'/talks/','#materials':'/talks/#materials','#cv':'/cv/'
    };
    if(redirects[location.hash]) location.replace(redirects[location.hash]);
  }

  const form=document.getElementById('contact-form');
  const disclosure=document.getElementById('contact-details');
  const widget=document.getElementById('turnstile-widget');
  const status=document.getElementById('form-status');
  let widgetId;
  let loading;
  const setStatus=(en,ja)=>{status.textContent=localize(en,ja);};
  function loadVerification() {
    if(loading)return loading;
    loading=new Promise((resolve,reject)=>{
      function render() {
        try {
          widgetId=window.turnstile.render(widget,{
            sitekey:widget.dataset.sitekey,theme:'light',language:html.lang,
            'error-callback':()=>{setStatus('Verification is unavailable. Please contact me by email.','認証を利用できません。メールでご連絡ください。');},
            'expired-callback':()=>{setStatus('Verification expired. Please complete it again.','認証の有効期限が切れました。再度認証してください。');}
          });
          resolve();
        } catch(error) { reject(error); }
      }
      if(window.turnstile){render();return;}
      const script=document.createElement('script');
      script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async=true;
      script.addEventListener('load',render,{once:true});
      script.addEventListener('error',()=>{script.remove();reject(new Error('Verification script failed'));},{once:true});
      document.head.appendChild(script);
    }).catch(error=>{
      loading=null;
      setStatus('Verification could not load. Please try again or contact me by email.','認証を読み込めませんでした。再度試すか、メールでご連絡ください。');
      throw error;
    });
    return loading;
  }
  disclosure?.addEventListener('toggle',()=>{if(disclosure.open)loadVerification().catch(()=>{});});
  form?.addEventListener('submit',async event=>{
    event.preventDefault();
    if(!form.reportValidity())return;
    if(new FormData(form).get('_honeypot'))return;
    if(widgetId===undefined || !window.turnstile?.getResponse(widgetId)) {
      setStatus('Please complete the verification before sending.','送信前に認証を完了してください。');
      loadVerification().catch(()=>{});return;
    }
    const button=form.querySelector('button[type=submit]');
    button.disabled=true;
    setStatus('Sending…','送信中です…');
    try {
      const payload=Object.fromEntries(new FormData(form));
      payload['cf-turnstile-response']=window.turnstile.getResponse(widgetId);
      const response=await fetch(form.action,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)});
      if(!response.ok)throw new Error('Message service returned '+response.status);
      form.reset();
      setStatus('Your message has been sent. Thank you.','メッセージを送信しました。ありがとうございます。');
    } catch {
      setStatus('Delivery could not be confirmed. Please contact me by email.','送信を確認できませんでした。メールで直接ご連絡ください。');
    } finally {
      button.disabled=false;window.turnstile.reset(widgetId);
    }
  });
}

if(typeof document!=='undefined')initializeSite();
