document.addEventListener('DOMContentLoaded', () => {

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
  const langToggleBtn = document.getElementById('lang-toggle');
  const researchmapLink = document.getElementById('researchmap-link');
  
  function updateResearchmapLink() {
    if (!researchmapLink) return;
    if (document.body.classList.contains('lang-ja')) {
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

  langToggleBtn.addEventListener('click', () => {
    document.body.classList.toggle('lang-ja');
    updateResearchmapLink();
    updateLangToggleText();
    
    if (document.body.classList.contains('lang-ja')) {
      localStorage.setItem('lang', 'ja');
    } else {
      localStorage.setItem('lang', 'en');
    }
  });

  function updateLangToggleText() {
    if (document.body.classList.contains('lang-ja')) {
      langToggleBtn.textContent = 'English';
    } else {
      langToggleBtn.textContent = '日本語';
    }
  }
  updateLangToggleText(); // initial call


  // --- Presentations rendering & filtering ---
  const presentationsContainer = document.getElementById('presentations-container');
  const filterBtns = document.querySelectorAll('.filter-btn');
  
  function renderPresentations(filterScope) {
    if (!presentationsContainer || !window.presentationsData) return;
    
    presentationsContainer.innerHTML = ''; // clear
    
    const filtered = window.presentationsData.filter(p => filterScope === 'all' || p.scope === filterScope);
    
    filtered.forEach(p => {
      const item = document.createElement('div');
      item.className = 'pub-item';
      
      const noteHtml = p.noteEn ? `<p class="pub-journal" style="margin-top:0.3rem;"><span class="en" style="color:var(--accent-pink); font-family:var(--font-mono); font-size:0.8rem;">&#9733; ${p.noteEn}</span><span class="ja" style="color:var(--accent-pink); font-family:var(--font-mono); font-size:0.8rem;">&#9733; ${p.noteJa}</span></p>` : '';

      item.innerHTML = `
        <div class="pub-year">${p.year}</div>
        <div class="pub-details">
          <h4 class="en">${p.titleEn}</h4>
          <h4 class="ja">${p.titleJa}</h4>
          <p class="pub-authors">
            <span class="en">${p.authorsEn}</span>
            <span class="ja">${p.authorsJa}</span>
          </p>
          <p class="pub-journal">
            <span class="en">${p.confEn}</span>
            <span class="ja">${p.confJa}</span>
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

  // --- Back to Top Button ---
  const backToTopBtn = document.getElementById('back-to-top');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 500) {
      backToTopBtn.classList.add('visible');
    } else {
      backToTopBtn.classList.remove('visible');
    }
  });

  backToTopBtn.addEventListener('click', () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  });

});
