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

  // --- Presentations rendering & filtering ---
  const presentationsContainer = document.getElementById('presentations-container');
  const filterBtns = document.querySelectorAll('[data-filter]');
  
  function renderPresentations(filterScope) {
    if (!presentationsContainer || !window.presentationsData) return;

    presentationsContainer.innerHTML = ''; // clear
    
    const filtered = window.presentationsData.filter(p => filterScope === 'all' || p.scope === filterScope);
    
    filtered.forEach(p => {
      const item = document.createElement('div');
      item.className = 'pub-item';
      
      const noteHtml = p.noteEn ? `<p class="pub-journal" style="margin-top:0.3rem;"><span class="en" lang="en" style="color:var(--accent-pink); font-family:var(--font-mono); font-size:0.8rem;">&#9733; ${p.noteEn}</span><span class="ja" lang="ja" style="color:var(--accent-pink); font-family:var(--font-mono); font-size:0.8rem;">&#9733; ${p.noteJa}</span></p>` : '';

      item.innerHTML = `
        <div class="pub-year">${p.year}</div>
        <div class="pub-details">
          <h4 class="en" lang="en">${p.titleEn}</h4>
          <h4 class="ja" lang="ja">${p.titleJa}</h4>
          <p class="pub-authors">
            <span class="en" lang="en">${p.authorsEn}</span>
            <span class="ja" lang="ja">${p.authorsJa}</span>
          </p>
          <p class="pub-journal">
            <span class="en" lang="en">${p.confEn}</span>
            <span class="ja" lang="ja">${p.confJa}</span>
            <span style="font-family: var(--font-mono); font-size: 0.8rem; margin-left: 10px; opacity: 0.7; color: var(--accent-cyan);">[${p.type.toUpperCase()}]</span>
          </p>
          ${noteHtml}
        </div>
      `;
      presentationsContainer.appendChild(item);
    });
  }

  // initial render
  renderPresentations('all');

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

  // --- Abstract Toggling ---
  const abstractGroups = document.querySelectorAll('.pub-details');
  abstractGroups.forEach(group => {
    const buttons = group.querySelectorAll('.abstract-toggle');
    const content = group.querySelector('.abstract-content');

    if (!buttons.length || !content) return;

    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const isExpanded = content.classList.toggle('active');

        buttons.forEach(button => {
          button.setAttribute('aria-expanded', String(isExpanded));
        });

        content.setAttribute('aria-hidden', String(!isExpanded));

        const enBtn = group.querySelector('.abstract-toggle.en');
        const jaBtn = group.querySelector('.abstract-toggle.ja');

        if (enBtn) enBtn.textContent = isExpanded ? 'Hide Abstract' : 'View Abstract';
        if (jaBtn) jaBtn.textContent = isExpanded ? '要旨を閉じる' : '要旨を表示';
      });
    });
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
