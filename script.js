document.addEventListener('DOMContentLoaded', () => {
  const menuToggleBtn = document.getElementById('menu-toggle');
  const navMenu = document.getElementById('primary-nav');
  const langToggleBtn = document.getElementById('lang-toggle');
  const researchmapLink = document.getElementById('researchmap-link');
  const formStatus = document.getElementById('form-status');

  function isJapanese() {
    return document.body.classList.contains('lang-ja');
  }

  function setStatusMessage(message, state = '') {
    if (formStatus) {
      formStatus.textContent = message;
      formStatus.className = state ? state : '';
    }
  }

  // --- Scroll-triggered Fade-in Animations ---
  const fadeElements = document.querySelectorAll('.fade-in');

  const fadeObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      // Add 'visible' class when element comes into view
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        fadeObserver.unobserve(entry.target);
      }
    });
  }, {
    root: null,
    threshold: 0.1, // Trigger when 10% is visible
    rootMargin: "0px 0px -50px 0px" // Slight offset
  });

  fadeElements.forEach(el => fadeObserver.observe(el));

  // --- Header Background on Scroll ---
  const header = document.querySelector('header');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
      header.style.background = 'rgba(7, 9, 19, 0.9)';
      header.style.boxShadow = '0 4px 30px rgba(0, 0, 0, 0.5)';
    } else {
      header.style.background = 'rgba(7, 9, 19, 0.8)';
      header.style.boxShadow = 'none';
    }
  });

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

  function renderPublications() {
    if (!publicationsContainer || !window.publicationsData) return;
    publicationsContainer.innerHTML = '';

    const selectedPublications = window.publicationsData.filter(p => p.selected);

    selectedPublications.forEach((p, idx) => {
      const item = document.createElement('div');
      item.className = 'glass-card pub-item fade-in';
      const publicationVenueEn = p.journalEn || p.journal || '';
      const publicationVenueJa = p.journalJa || p.journal || publicationVenueEn;
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
          <h4 class="ja" lang="ja">${p.titleJa || p.titleEn}</h4>
          <p class="pub-authors">
            <span class="en" lang="en">${p.authorsEn}</span>
            <span class="ja" lang="ja">${p.authorsJa}</span>
          </p>
          <p class="pub-journal">
            <span class="en" lang="en">${publicationVenueEn}</span>
            <span class="ja" lang="ja">${publicationVenueJa}</span>
          </p>
          ${linksHtml}
          ${abstractHtml}
        </div>
      `;
      publicationsContainer.appendChild(item);
    });

    initializeAbstractToggles();

    // Trigger intersection observer for new elements
    const newFades = publicationsContainer.querySelectorAll('.fade-in');
    newFades.forEach(el => fadeObserver.observe(el));
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

  // initial render
  renderPresentations('all');
  renderPublications();

  filterBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      // Button state update
      filterBtns.forEach(b => b.classList.remove('active'));
      e.target.closest('.filter-btn').classList.add('active');

      // Filter logic
      const scope = e.target.closest('.filter-btn').getAttribute('data-filter');
      renderPresentations(scope);
    });
  });

  const pdfBtnJa = document.getElementById('pdf-btn-ja');
  const pdfBtnEn = document.getElementById('pdf-btn-en');
  const pubPdfBtnJa = document.getElementById('pub-pdf-btn-ja');
  const pubPdfBtnEn = document.getElementById('pub-pdf-btn-en');
  let originalLangForPrint = '';

  function triggerPrint(lang, type = 'presentations') {
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

    // Briefly wait for rendering to finish then open print dialog
    setTimeout(() => {
      window.print();
    }, 150);
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

  window.addEventListener('scroll', () => {
    let current = '';
    sections.forEach(section => {
      const sectionTop = section.offsetTop;
      const sectionHeight = section.clientHeight;
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
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
      closeMobileMenu();
    }
  });

  // --- Scroll Indicator hiding ---
  const scrollIndicator = document.querySelector('.scroll-indicator');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 100) {
      if (scrollIndicator) scrollIndicator.style.opacity = '0';
      if (scrollIndicator) scrollIndicator.style.pointerEvents = 'none';
    } else {
      if (scrollIndicator) scrollIndicator.style.opacity = '0.6';
      if (scrollIndicator) scrollIndicator.style.pointerEvents = 'auto';
    }
  });


  // --- Contact Form Submission ---
  const contactForm = document.getElementById('contact-form');
  if (contactForm) {
    const submitBtn = contactForm.querySelector('.submit-btn');

    contactForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      if (!contactForm.reportValidity()) {
        return;
      }

      const formData = new FormData(contactForm);
      const turnstileToken = formData.get('cf-turnstile-response');

      if (!turnstileToken) {
        setStatusMessage(
          isJapanese()
            ? 'Turnstile の確認が完了していません。しばらく待ってから再度お試しください。'
            : 'Turnstile verification has not completed yet. Please wait a moment and try again.',
          'is-error'
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
  window.addEventListener('scroll', () => {
    if (window.scrollY > 500) {
      if (backToTopBtn) backToTopBtn.classList.add('visible');
    } else {
      if (backToTopBtn) backToTopBtn.classList.remove('visible');
    }
  });

  if (backToTopBtn) {
    backToTopBtn.addEventListener('click', () => {
      window.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
    });
  }

});
