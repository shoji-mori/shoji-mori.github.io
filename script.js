document.addEventListener('DOMContentLoaded', () => {
  const menuToggleBtn = document.getElementById('menu-toggle');
  const navMenu = document.getElementById('primary-nav');
  const langToggleBtn = document.getElementById('lang-toggle');
  const researchmapLink = document.getElementById('researchmap-link');
  const formStatus = document.getElementById('form-status');
  const contactSection = document.getElementById('contact');
  const contactForm = document.getElementById('contact-form');
  const publicationsSection = document.getElementById('publications');
  const presentationsSection = document.getElementById('presentations');
  const publicationsPrintContainer = document.getElementById('publications-print-container');
  const turnstileContainer = document.getElementById('turnstile-widget');
  const turnstileSiteKey = turnstileContainer ? turnstileContainer.dataset.sitekey : '';
  const supportsIntersectionObserver = 'IntersectionObserver' in window;
  let turnstileLoadPromise = null;
  let turnstileWidgetId = null;
  let publicationsLoadPromise = null;
  let presentationsLoadPromise = null;
  let currentPresentationFilter = 'all';

  function isJapanese() {
    return document.body.classList.contains('lang-ja');
  }

  function setStatusMessage(message, state = '') {
    if (formStatus) {
      formStatus.textContent = message;
      formStatus.className = state ? state : '';
    }
  }

  function setContainerMessage(container, enText, jaText, state = 'idle') {
    if (!container) return;
    container.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
    container.innerHTML = `
      <p class="deferred-status deferred-status-${state}">
        <span class="en" lang="en">${enText}</span>
        <span class="ja" lang="ja">${jaText}</span>
      </p>
    `;
  }

  function revealElements(elements) {
    elements.forEach(el => {
      if (supportsIntersectionObserver && fadeObserver) {
        fadeObserver.observe(el);
      } else {
        el.classList.add('visible');
      }
    });
  }

  function loadWindowAssignmentScript(src, globalName) {
    if (window[globalName]) {
      return Promise.resolve(window[globalName]);
    }

    const currentPromise = globalName === 'publicationsData' ? publicationsLoadPromise : presentationsLoadPromise;
    if (currentPromise) {
      return currentPromise;
    }

    const loadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.dataset.datasetScript = globalName;
      script.addEventListener('load', () => {
        if (window[globalName]) {
          resolve(window[globalName]);
          return;
        }
        reject(new Error(`Loaded ${src} but ${globalName} is missing.`));
      }, { once: true });
      script.addEventListener('error', () => {
        reject(new Error(`Failed to load ${src}.`));
      }, { once: true });
      document.body.appendChild(script);
    }).catch((error) => {
      if (globalName === 'publicationsData') {
        publicationsLoadPromise = null;
      } else {
        presentationsLoadPromise = null;
      }
      throw error;
    });

    if (globalName === 'publicationsData') {
      publicationsLoadPromise = loadPromise;
    } else {
      presentationsLoadPromise = loadPromise;
    }

    return loadPromise;
  }

  function observeSectionLoad(section, loadFn) {
    if (!section) return;

    if (!supportsIntersectionObserver) {
      loadFn().catch(() => {});
      return;
    }

    const observer = new IntersectionObserver((entries, currentObserver) => {
      const isVisible = entries.some(entry => entry.isIntersecting);
      if (!isVisible) return;
      loadFn().catch(() => {});
      currentObserver.disconnect();
    }, {
      root: null,
      threshold: 0,
      rootMargin: '300px 0px'
    });

    observer.observe(section);
  }

  function setTurnstileState(state) {
    if (turnstileContainer) {
      turnstileContainer.dataset.state = state;
    }
  }

  function renderTurnstile() {
    if (!turnstileContainer || !turnstileSiteKey || !window.turnstile || turnstileWidgetId !== null) {
      return;
    }

    turnstileContainer.innerHTML = '';
    turnstileWidgetId = window.turnstile.render(turnstileContainer, {
      sitekey: turnstileSiteKey,
      theme: 'dark'
    });
    setTurnstileState('ready');
  }

  function ensureTurnstileLoaded() {
    if (!turnstileContainer || !turnstileSiteKey) {
      return Promise.resolve();
    }

    if (turnstileWidgetId !== null) {
      return Promise.resolve();
    }

    if (window.turnstile) {
      renderTurnstile();
      return Promise.resolve();
    }

    if (turnstileLoadPromise) {
      return turnstileLoadPromise;
    }

    setTurnstileState('loading');
    turnstileLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.dataset.turnstileScript = 'true';
      script.addEventListener('load', () => {
        renderTurnstile();
        resolve();
      }, { once: true });
      script.addEventListener('error', () => {
        turnstileLoadPromise = null;
        setTurnstileState('error');
        reject(new Error('Failed to load Turnstile.'));
      }, { once: true });
      document.head.appendChild(script);
    });

    return turnstileLoadPromise;
  }

  function resetTurnstileWidget() {
    if (window.turnstile && turnstileWidgetId !== null) {
      window.turnstile.reset(turnstileWidgetId);
    }
  }

  function waitForNextFrame() {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  }

  async function waitForPrintLayout() {
    await waitForNextFrame();
    await waitForNextFrame();
    await new Promise((resolve) => window.setTimeout(resolve, 250));
  }

  // --- Scroll-triggered Fade-in Animations ---
  const fadeElements = document.querySelectorAll('.fade-in');
  const fadeObserver = supportsIntersectionObserver
    ? new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            fadeObserver.unobserve(entry.target);
          }
        });
      }, {
        root: null,
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
      })
    : null;

  revealElements(fadeElements);

  // --- Header Background on Scroll ---
  const header = document.querySelector('header');
  function updateHeaderState() {
    if (!header) return;
    header.classList.toggle('is-scrolled', window.scrollY > 50);
  }

  updateHeaderState();
  window.addEventListener('scroll', updateHeaderState, { passive: true });

  // --- Language Toggle Logic ---
  function updateResearchmapLink() {
    if (!researchmapLink) return;
    if (isJapanese()) {
      researchmapLink.href = 'https://researchmap.jp/mori_shoji';
    } else {
      researchmapLink.href = 'https://researchmap.jp/mori_shoji?lang=en';
    }
  }

  // Check if saved preference exists
  if (localStorage.getItem('lang') === 'ja') {
    document.body.classList.add('lang-ja');
  }
  updateResearchmapLink(); // initial call

  if (langToggleBtn) {
    langToggleBtn.addEventListener('click', () => {
      document.body.classList.toggle('lang-ja');
      updateResearchmapLink();
      updateLangToggleText();
      setStatusMessage('');

      if (isJapanese()) {
        localStorage.setItem('lang', 'ja');
      } else {
        localStorage.setItem('lang', 'en');
      }
    });
  }

  function updateLangToggleText() {
    if (!langToggleBtn) return;

    if (isJapanese()) {
      langToggleBtn.setAttribute('aria-label', 'Switch language to English');
      langToggleBtn.setAttribute('title', 'Switch language to English');
    } else {
      langToggleBtn.setAttribute('aria-label', '言語を日本語に切り替える');
      langToggleBtn.setAttribute('title', '言語を日本語に切り替える');
    }
  }
  updateLangToggleText(); // initial call

  // --- Mobile Navigation ---
  function closeMobileMenu() {
    if (!navMenu || !menuToggleBtn) return;

    navMenu.classList.remove('open');
    menuToggleBtn.classList.remove('is-open');
    menuToggleBtn.setAttribute('aria-expanded', 'false');
  }

  if (menuToggleBtn && navMenu) {
    menuToggleBtn.addEventListener('click', () => {
      const isOpen = navMenu.classList.toggle('open');
      menuToggleBtn.classList.toggle('is-open', isOpen);
      menuToggleBtn.setAttribute('aria-expanded', String(isOpen));
    });
  }

  // --- Publications rendering ---
  const publicationsContainer = document.getElementById('publications-container');

  function isJapaneseLanguagePublication(publicationVenueEn, publicationVenueJa) {
    return /\[in Japanese\]/i.test(publicationVenueEn) || /[\u3040-\u30ff\u3400-\u9fff]/.test(publicationVenueJa);
  }

  function getJapaneseModePublicationText(publication) {
    const publicationVenueEn = publication.journalEn || publication.journal || '';
    const publicationVenueJa = publication.journalJa || publication.journal || publicationVenueEn;
    const isJapaneseLanguage = isJapaneseLanguagePublication(publicationVenueEn, publicationVenueJa);

    return {
      title: isJapaneseLanguage ? (publication.titleJa || publication.titleEn) : publication.titleEn,
      authors: isJapaneseLanguage ? (publication.authorsJa || publication.authorsEn) : publication.authorsEn,
      venue: isJapaneseLanguage ? publicationVenueJa : publicationVenueEn,
      usesJapanesePunctuation: isJapaneseLanguage
    };
  }

  function renderPublications() {
    if (!publicationsContainer || !window.publicationsData) return;
    publicationsContainer.setAttribute('aria-busy', 'false');
    publicationsContainer.innerHTML = '';

    const publications = window.publicationsData.filter(p => p.selected);

    publications.forEach((p, idx) => {
      const item = document.createElement('div');
      item.className = 'glass-card pub-item fade-in';
      const publicationVenueEn = p.journalEn || p.journal || '';
      const publicationVenueJa = p.journalJa || p.journal || publicationVenueEn;
      const japaneseModeText = getJapaneseModePublicationText(p);
      const publicationUrl = p.publicationUrl || p.url || '';
      const linkItemsEn = [];
      const linkItemsJa = [];

      if (publicationUrl) {
        linkItemsEn.push(`<a href="${publicationUrl}" target="_blank" rel="noopener">Published</a>`);
        linkItemsJa.push(`<a href="${publicationUrl}" target="_blank" rel="noopener">出版版</a>`);
      }
      if (p.arxivUrl) {
        linkItemsEn.push(`<a href="${p.arxivUrl}" target="_blank" rel="noopener">arXiv</a>`);
        linkItemsJa.push(`<a href="${p.arxivUrl}" target="_blank" rel="noopener">arXiv</a>`);
      }
      if (p.adsUrl) {
        linkItemsEn.push(`<a href="${p.adsUrl}" target="_blank" rel="noopener">ADS</a>`);
        linkItemsJa.push(`<a href="${p.adsUrl}" target="_blank" rel="noopener">ADS</a>`);
      }

      const linksHtml = linkItemsEn.length ? `
        <p class="pub-meta pub-link">
          <span class="en" lang="en">${linkItemsEn.join(' / ')}</span>
          <span class="ja" lang="ja">${linkItemsJa.join(' / ')}</span>
        </p>` : '';

      const abstractHtml = p.abstractEn ? `
        <button class="abstract-toggle en" type="button" lang="en" aria-expanded="false" aria-controls="pub-abstract-${idx}">View Abstract</button>
        <button class="abstract-toggle ja" type="button" lang="ja" aria-expanded="false" aria-controls="pub-abstract-${idx}">要旨を表示</button>
        <div class="abstract-content" id="pub-abstract-${idx}" aria-hidden="true">
          <p class="en" lang="en">${p.abstractEn}</p>
          <p class="ja" lang="ja">${p.abstractJa}</p>
        </div>` : '';

      item.innerHTML = `
        <div class="pub-year">${p.year}</div>
        <div class="pub-details">
          <h4 class="en" lang="en">${p.titleEn}</h4>
          <h4 class="ja" lang="ja">${japaneseModeText.title}</h4>
          <p class="pub-authors">
            <span class="en" lang="en">${p.authorsEn}</span>
            <span class="ja" lang="ja">${japaneseModeText.authors}</span>
          </p>
          <p class="pub-journal">
            <span class="en" lang="en">${publicationVenueEn}</span>
            <span class="ja" lang="ja">${japaneseModeText.venue}</span>
          </p>
          ${linksHtml}
          ${abstractHtml}
        </div>
      `;
      publicationsContainer.appendChild(item);
    });

    initializeAbstractToggles();

    const newFades = publicationsContainer.querySelectorAll('.fade-in');
    revealElements(newFades);
  }

  function renderPublicationsPrintList() {
    if (!publicationsPrintContainer || !window.publicationsData) return;
    publicationsPrintContainer.innerHTML = '';

    window.publicationsData.forEach((p, idx) => {
      const item = document.createElement('p');
      item.className = 'print-publication-item';
      const publicationVenueEn = p.journalEn || p.journal || '';
      const japaneseModeText = getJapaneseModePublicationText(p);
      const jaDelimiter = japaneseModeText.usesJapanesePunctuation ? '、' : ', ';

      item.innerHTML = `
        <span class="print-publication-index">${idx + 1}.</span>
        <span class="en" lang="en">${p.titleEn}, ${p.authorsEn}, ${publicationVenueEn}</span>
        <span class="ja" lang="ja">${japaneseModeText.title}${jaDelimiter}${japaneseModeText.authors}${jaDelimiter}${japaneseModeText.venue}</span>
      `;
      publicationsPrintContainer.appendChild(item);
    });
  }

  function ensurePublicationsLoaded() {
    if (!publicationsContainer) {
      return Promise.resolve();
    }

    if (window.publicationsData) {
      renderPublications();
      return Promise.resolve(window.publicationsData);
    }

    setContainerMessage(
      publicationsContainer,
      'Loading publications...',
      '論文データを読み込み中...',
      'loading'
    );

    return loadWindowAssignmentScript('publications_data.js?v=3', 'publicationsData')
      .then((data) => {
        renderPublications();
        renderPublicationsPrintList();
        return data;
      })
      .catch((error) => {
        setContainerMessage(
          publicationsContainer,
          'Unable to load publications right now.',
          '論文データを読み込めませんでした。',
          'error'
        );
        throw error;
      });
  }

  function initializeAbstractToggles() {
    // This function handles both Publications and Presentations if they use .abstract-toggle
    const abstractGroups = document.querySelectorAll('.pub-details');
    abstractGroups.forEach(group => {
      const toggleBtns = group.querySelectorAll('.abstract-toggle');
      const content = group.querySelector('.abstract-content');

      if (!content) return;

      toggleBtns.forEach(btn => {
        // Clone and replace to prevent duplicate listeners
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);

        newBtn.addEventListener('click', () => {
          const isExpanded = newBtn.getAttribute('aria-expanded') === 'true';
          const newState = !isExpanded;

          toggleBtns.forEach(b => {
             const controlledId = newBtn.getAttribute('aria-controls');
             const targetBtn = group.querySelector(`[aria-controls="${controlledId}"][lang="${b.getAttribute('lang')}"]`);
             if (targetBtn) {
               targetBtn.setAttribute('aria-expanded', String(newState));
               if (targetBtn.getAttribute('lang') === 'ja') {
                 targetBtn.textContent = newState ? '要旨を閉じる' : '要旨を表示';
               } else {
                 targetBtn.textContent = newState ? 'Hide Abstract' : 'View Abstract';
               }
             }
          });

          content.classList.toggle('open', newState);
          content.setAttribute('aria-hidden', String(!newState));
        });
      });
    });
  }

  // --- Presentations rendering & filtering ---
  const presentationsContainer = document.getElementById('presentations-container');
  const filterBtns = document.querySelectorAll('[data-filter]');

  function renderPresentations(filterScope) {
    if (!presentationsContainer || !window.presentationsData) return;
    presentationsContainer.setAttribute('aria-busy', 'false');
    presentationsContainer.innerHTML = ''; // clear

    // Categories definition
    const categories = [
      {
        id: 'intl-oral',
        nameEn: 'International Conferences - Oral',
        nameJa: '国際会議 (口頭発表)',
        filter: p => p.scope === 'international' && (p.type === 'oral' || p.type === 'invited')
      },
      {
        id: 'intl-poster',
        nameEn: 'International Conferences - Poster',
        nameJa: '国際会議 (ポスター発表)',
        filter: p => p.scope === 'international' && p.type === 'poster'
      },
      {
        id: 'domestic-oral',
        nameEn: 'Domestic Conferences - Oral',
        nameJa: '国内会議 (口頭発表)',
        filter: p => p.scope === 'domestic' && (p.type === 'oral' || p.type === 'invited')
      },
      {
        id: 'domestic-poster',
        nameEn: 'Domestic Conferences - Poster',
        nameJa: '国内会議 (ポスター発表)',
        filter: p => p.scope === 'domestic' && p.type === 'poster'
      }
    ];

    categories.forEach(cat => {
      const items = window.presentationsData.filter(p => {
        const matchesScope = (filterScope === 'all' || p.scope === filterScope);
        return matchesScope && cat.filter(p);
      });

      if (items.length === 0) return;

      // Group Subheading
      const heading = document.createElement('h3');
      heading.className = 'presentations-subheading';
      heading.innerHTML = `<span class="en">${cat.nameEn}</span><span class="ja">${cat.nameJa}</span>`;
      presentationsContainer.appendChild(heading);

      items.forEach(p => {
        const item = document.createElement('div');
        item.className = 'pub-item';

        // Invited badge only
        const isInvited = p.type === 'invited';
        const typeBadge = isInvited
          ? `<span class="invited-badge" style="font-family: var(--font-mono); font-size: 0.8rem; margin-left: 10px; color: var(--accent-pink); opacity: 0.85;">[INVITED]</span>`
          : '';

        const confLinkStyle = 'color:inherit; text-decoration: underline; text-underline-offset:3px; opacity:0.9;';
        const hasUrl = typeof p.url === 'string' && p.url.trim() !== '';
        const confEnHtml = hasUrl ? `<a href="${p.url}" target="_blank" rel="noopener" style="${confLinkStyle}">${p.confEn}</a>` : p.confEn;
        const confJaHtml = hasUrl ? `<a href="${p.url}" target="_blank" rel="noopener" style="${confLinkStyle}">${p.confJa}</a>` : p.confJa;

        const metaPartsEn = [];
        const metaPartsJa = [];
        if (p.date) { metaPartsEn.push(p.date); metaPartsJa.push(p.date); }
        if (p.placeEn) metaPartsEn.push(p.placeEn);
        if (p.placeJa) metaPartsJa.push(p.placeJa);
        else if (p.placeEn) metaPartsJa.push(p.placeEn);

        const metaHtml = (metaPartsEn.length > 0) ? `
          <p class="pub-meta">
            <span class="en" lang="en">${metaPartsEn.join(' &middot; ')}</span>
            <span class="ja" lang="ja">${metaPartsJa.join(' &middot; ')}</span>
          </p>` : '';

        const resourceLinksEn = [];
        const resourceLinksJa = [];
        if (p.posterUrl) {
          resourceLinksEn.push(`<a href="${p.posterUrl}" target="_blank" rel="noopener">Poster</a>`);
          resourceLinksJa.push(`<a href="${p.posterUrl}" target="_blank" rel="noopener">ポスター</a>`);
        }
        if (p.slideUrl) {
          resourceLinksEn.push(`<a href="${p.slideUrl}" target="_blank" rel="noopener">Slides</a>`);
          resourceLinksJa.push(`<a href="${p.slideUrl}" target="_blank" rel="noopener">スライド</a>`);
        }
        if (p.videoUrl) {
          resourceLinksEn.push(`<a href="${p.videoUrl}" target="_blank" rel="noopener">Video</a>`);
          resourceLinksJa.push(`<a href="${p.videoUrl}" target="_blank" rel="noopener">動画</a>`);
        }
        const resourceHtml = resourceLinksEn.length ? `
          <p class="pub-meta pub-link">
            <span class="en" lang="en">${resourceLinksEn.join(' / ')}</span>
            <span class="ja" lang="ja">${resourceLinksJa.join(' / ')}</span>
          </p>` : '';

        const noteHtml = p.noteEn ? `<p class="pub-note ${isInvited ? 'is-invited' : ''}" style="margin-top:0.3rem;"><span class="en" lang="en" style="color:var(--accent-pink); font-family:var(--font-mono); font-size:0.8rem;">&#9733; ${p.noteEn}</span><span class="ja" lang="ja" style="color:var(--accent-pink); font-family:var(--font-mono); font-size:0.8rem;">&#9733; ${p.noteJa}</span></p>` : '';

        const dispTitleEn = p.titleEn;
        const dispTitleJa = p.titleJa || p.titleEn;

        item.innerHTML = `
          <div class="pub-year">${p.year}</div>
          <div class="pub-details">
            <h4 class="en" lang="en">${dispTitleEn}</h4>
            <h4 class="ja" lang="ja">${dispTitleJa}</h4>
            <p class="pub-authors">
              <span class="en" lang="en">${p.authorsEn}</span>
              <span class="ja" lang="ja">${p.authorsJa}</span>
            </p>
            <p class="pub-journal">
              <span class="en" lang="en">${confEnHtml}</span>
              <span class="ja" lang="ja">${confJaHtml}</span>
              ${typeBadge}
            </p>
            ${metaHtml}
            ${resourceHtml}
            ${noteHtml}
          </div>
        `;
        presentationsContainer.appendChild(item);
      });
    });
  }

  function ensurePresentationsLoaded() {
    if (!presentationsContainer) {
      return Promise.resolve();
    }

    if (window.presentationsData) {
      renderPresentations(currentPresentationFilter);
      return Promise.resolve(window.presentationsData);
    }

    setContainerMessage(
      presentationsContainer,
      'Loading presentations...',
      '発表データを読み込み中...',
      'loading'
    );

    return loadWindowAssignmentScript('presentations_data.js?v=9', 'presentationsData')
      .then((data) => {
        renderPresentations(currentPresentationFilter);
        return data;
      })
      .catch((error) => {
        setContainerMessage(
          presentationsContainer,
          'Unable to load presentations right now.',
          '発表データを読み込めませんでした。',
          'error'
        );
        throw error;
      });
  }

  observeSectionLoad(publicationsSection, ensurePublicationsLoaded);
  observeSectionLoad(presentationsSection, ensurePresentationsLoaded);

  filterBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      filterBtns.forEach(b => b.classList.remove('active'));
      const targetButton = e.target.closest('.filter-btn');
      targetButton.classList.add('active');
      currentPresentationFilter = targetButton.getAttribute('data-filter') || 'all';

      if (window.presentationsData) {
        renderPresentations(currentPresentationFilter);
        return;
      }

      ensurePresentationsLoaded().catch(() => {});
    });
  });

  const pdfBtnJa = document.getElementById('pdf-btn-ja');
  const pdfBtnEn = document.getElementById('pdf-btn-en');
  const pubPdfBtnJa = document.getElementById('pub-pdf-btn-ja');
  const pubPdfBtnEn = document.getElementById('pub-pdf-btn-en');
  let originalLangForPrint = '';

  async function triggerPrint(lang, type = 'presentations') {
    try {
      if (type === 'publications') {
        await ensurePublicationsLoaded();
        renderPublicationsPrintList();
      } else {
        await ensurePresentationsLoaded();
      }
    } catch (error) {
      return;
    }

    // Save current language
    originalLangForPrint = isJapanese() ? 'ja' : 'en';

    // Force language for PDF
    if (lang === 'ja') {
      document.body.classList.add('lang-ja');
    } else {
      document.body.classList.remove('lang-ja');
    }

    // Add sectional focus class
    const focusClass = type === 'publications' ? 'print-publications-only' : 'print-presentations-only';
    document.body.classList.add(focusClass);

    updateResearchmapLink();
    updateLangToggleText();

    // Switch filter to "All" if working on presentations
    if (type === 'presentations') {
       const allFilterBtn = document.querySelector('[data-filter="all"]');
       if (allFilterBtn && !allFilterBtn.classList.contains('active')) {
         allFilterBtn.click();
       }
    }

    await waitForPrintLayout();
    window.print();
  }

  if (pdfBtnJa) pdfBtnJa.addEventListener('click', () => triggerPrint('ja', 'presentations'));
  if (pdfBtnEn) pdfBtnEn.addEventListener('click', () => triggerPrint('en', 'presentations'));
  if (pubPdfBtnJa) pubPdfBtnJa.addEventListener('click', () => triggerPrint('ja', 'publications'));
  if (pubPdfBtnEn) pubPdfBtnEn.addEventListener('click', () => triggerPrint('en', 'publications'));

  window.addEventListener('afterprint', () => {
    document.body.classList.remove('print-presentations-only');
    document.body.classList.remove('print-publications-only');

    // Restore original language
    if (originalLangForPrint === 'ja') {
      document.body.classList.add('lang-ja');
    } else {
      document.body.classList.remove('lang-ja');
    }

    updateResearchmapLink();
    updateLangToggleText();
  });

  // --- Nav Active Link on Scroll ---
  const navLinks = document.querySelectorAll('nav ul li a');
  const sections = document.querySelectorAll('section');

  navLinks.forEach(link => {
    link.addEventListener('click', () => {
      if (window.innerWidth <= 768) {
        closeMobileMenu();
      }
    });
  });

  function updateActiveNavLink() {
    let current = '';
    sections.forEach(section => {
      const sectionTop = section.offsetTop;
      if (pageYOffset >= (sectionTop - 150)) {
        current = section.getAttribute('id');
      }
    });

    navLinks.forEach(link => {
      link.classList.remove('active');
      if (link.getAttribute('href').includes(current)) {
        link.classList.add('active');
      }
    });
  }

  updateActiveNavLink();
  window.addEventListener('scroll', updateActiveNavLink, { passive: true });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
      closeMobileMenu();
    }
  });

  if (contactSection && turnstileContainer) {
    if (supportsIntersectionObserver) {
      const contactObserver = new IntersectionObserver((entries, observer) => {
        const isVisible = entries.some(entry => entry.isIntersecting);
        if (!isVisible) return;
        ensureTurnstileLoaded().catch(() => {});
        observer.disconnect();
      }, {
        root: null,
        threshold: 0,
        rootMargin: '200px 0px'
      });
      contactObserver.observe(contactSection);
    } else {
      ensureTurnstileLoaded().catch(() => {});
    }
  }

  if (contactForm) {
    const submitBtn = contactForm.querySelector('.submit-btn');

    contactForm.addEventListener('focusin', () => {
      ensureTurnstileLoaded().catch(() => {});
    }, { once: true });

    contactForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      if (!contactForm.reportValidity()) {
        return;
      }

      const formData = new FormData(contactForm);
      const turnstileToken = formData.get('cf-turnstile-response');

      if (!turnstileToken) {
        ensureTurnstileLoaded().catch(() => {
          setStatusMessage(
            isJapanese()
              ? 'Turnstile の読み込みに失敗しました。時間をおいて再度お試しください。'
              : 'Failed to load Turnstile. Please try again in a moment.',
            'is-error'
          );
        });
        setStatusMessage(
          isJapanese()
            ? 'スパム対策を読み込み中です。表示された確認を完了してから再度送信してください。'
            : 'Spam protection is loading. Complete the verification widget, then submit again.',
          'is-pending'
        );
        return;
      }

      const payload = Object.fromEntries(formData.entries());

      if (submitBtn) {
        submitBtn.disabled = true;
      }

      setStatusMessage(
        isJapanese() ? '送信中です...' : 'Sending...',
        'is-pending'
      );

      try {
        const response = await fetch(contactForm.action, {
          method: contactForm.method || 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const formsparkStatus = response.headers.get('formspark-status');
          const error = new Error(`Formspark request failed: ${response.status}`);
          error.formsparkStatus = formsparkStatus;
          throw error;
        }

        contactForm.reset();
        resetTurnstileWidget();
        setStatusMessage(
          isJapanese()
            ? '送信が完了しました。ありがとうございます。'
            : 'Your message has been sent. Thank you.',
          'is-success'
        );
      } catch (error) {
        console.error(error);
        if (error.formsparkStatus === 'spam') {
          setStatusMessage(
            isJapanese()
              ? 'Formspark により spam と判定されました。Formspark 側の Spam Protection 設定を確認してください。'
              : 'Formspark marked this submission as spam. Please check your Formspark spam protection settings.',
            'is-error'
          );
        } else {
          setStatusMessage(
            isJapanese()
              ? '送信に失敗しました。時間をおいて再度お試しいただくか、メールで直接ご連絡ください。'
              : 'Unable to send your message. Please try again later or contact me directly by email.',
            'is-error'
          );
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
        }
      }
    });
  }

  // --- Back to Top Button ---
  const backToTopBtn = document.getElementById('back-to-top');
  function updateBackToTopButton() {
    if (window.scrollY > 500) {
      if (backToTopBtn) backToTopBtn.classList.add('visible');
    } else {
      if (backToTopBtn) backToTopBtn.classList.remove('visible');
    }
  }

  updateBackToTopButton();
  window.addEventListener('scroll', updateBackToTopButton, { passive: true });

  if (backToTopBtn) {
    backToTopBtn.addEventListener('click', () => {
      window.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
    });
  }

});
