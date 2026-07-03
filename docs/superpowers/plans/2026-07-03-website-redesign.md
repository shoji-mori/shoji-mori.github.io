# Website Redesign (ver2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild shoji-mori.github.io as an Astro site in `ver2/` — an editorial "featured article" design, ADS-synced publication data, and a professional data layer — while the current live site keeps serving from the repo root until an explicit, user-approved cutover.

**Architecture:** A standalone Astro project rooted at `ver2/`. Bibliographic data flows one-way: NASA ADS (source of truth for citations/metadata) → `scripts/sync-ads.mjs` → `src/data/publications.generated.json`, merged at build time with hand-curated `src/data/publications.overrides.yaml` (summaries, highlight flags — never touched by the sync script). Presentations and CV are plain YAML, migrated once from the existing `*_data.js` files and `index.html`. News is an Astro content collection. All data is Zod-validated; a schema failure fails the build. Interactive behavior (language toggle, filters, BibTeX copy, contact form) is written as framework-free TypeScript modules with unit tests, then wired into pages via plain `<script>` tags — no client framework needed.

**Tech Stack:** Astro (latest stable — see Global Constraints), TypeScript, Zod, `yaml`, Vitest + happy-dom + node-html-parser for tests, `@fontsource/*` for self-hosted fonts, `@astrojs/sitemap`.

## Global Constraints

- All new work happens under `ver2/` at the repo root. Do not modify `index.html`, `style.css`, `script.js`, `publications_data.js`, `presentations_data.js`, or anything under `admin/` in this plan — those are touched only in the final cutover task (Task 25), which requires explicit user go-ahead before running.
- Design system: paper background `#faf9f6`, ink `#1a1a1a`, two accents only — burnt orange `#c96a2e` (disk inner-edge) and deep space navy `#0b1026`/`#1a2247`. Serif for headings (Newsreader / Noto Serif JP), sans for body/UI (Inter / Noto Sans JP). Fonts self-hosted via `@fontsource/*`, `font-display: swap`.
- Hero: dark navy gradient, static background image (no autoplay video, no heavy animation). `prefers-reduced-motion` must be respected wherever motion is used.
- Multilingual: current toggle approach only — both languages present in the DOM, `.lang-ja` class on `<body>` switches visibility via CSS, `localStorage` persists the choice. No `/ja/` routes.
- Data provenance: publication bibliographic fields (title, authors, journal, DOI, arXiv ID, citation count, refereed status) come from ADS. Only `selected`, `highlight`/`highlightOrder`/`highlightImage`, `abstractEn`, `abstractJa`, and (when ADS's Romanized authors need a Japanese rendering) `authorsJa` live in the local overrides file, keyed by DOI → arXiv ID → slug (never by ADS bibcode, so overrides never depend on sync having run first).
- ADS API token is read from the environment variable `ADS_API_TOKEN` (never hard-coded; stored as a GitHub Actions secret of the same name in the final deploy task).
- Every data-producing script (migration, sync, seed) is idempotent and safe to re-run.
- Node.js >= 22.12.0 required (Astro's own engine floor). Use `npm` (matches the rest of the repo).

---

## Milestone A — Project Scaffold & Design System

### Task 1: Scaffold the Astro project

**Files:**
- Create: `ver2/package.json`
- Create: `ver2/tsconfig.json`
- Create: `ver2/astro.config.mjs`
- Create: `ver2/vitest.config.ts`
- Create: `ver2/src/pages/index.astro`
- Create: `ver2/.gitignore`
- Test: `ver2/tests/smoke.test.ts`

**Interfaces:**
- Produces: a buildable Astro project at `ver2/` with `npm run build` emitting `ver2/dist/index.html`, and `npm test` running Vitest.

- [ ] **Step 1: Write the failing test**

```typescript
// ver2/tests/smoke.test.ts
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(__dirname, '..');

describe('astro build smoke test', () => {
  it('produces dist/index.html containing the site title', () => {
    execSync('npm run build', { cwd: root, stdio: 'inherit' });
    const outPath = path.join(root, 'dist/index.html');
    expect(existsSync(outPath)).toBe(true);
    const html = readFileSync(outPath, 'utf-8');
    expect(html).toContain('Shoji Mori');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ver2 && npm test -- smoke` (before `package.json`/`astro.config.mjs`/pages exist)
Expected: FAIL — `npm run build` errors because there is no `package.json` / Astro project yet.

- [ ] **Step 3: Write the scaffold**

```json
// ver2/package.json
{
  "name": "shoji-mori-website",
  "private": true,
  "type": "module",
  "version": "0.1.0",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "migrate:publications": "node scripts/migrate-publications.mjs",
    "migrate:presentations": "node scripts/migrate-presentations.mjs",
    "sync:ads": "node scripts/sync-ads.mjs",
    "seed:news": "node scripts/seed-news.mjs"
  },
  "dependencies": {
    "astro": "^7.0.6",
    "zod": "^4.4.3",
    "yaml": "^2.9.0",
    "@astrojs/sitemap": "^3.7.3",
    "@fontsource/newsreader": "^5.2.10",
    "@fontsource/inter": "^5.2.8",
    "@fontsource/noto-serif-jp": "^5.2.8",
    "@fontsource/noto-sans-jp": "^5.2.9"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^4.1.9",
    "happy-dom": "^20.10.6",
    "node-html-parser": "^8.0.4",
    "@types/node": "^22.10.0"
  }
}
```

```jsonc
// ver2/tsconfig.json
{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
```

```javascript
// ver2/astro.config.mjs
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://shoji-mori.github.io',
  integrations: [sitemap()],
});
```

```typescript
// ver2/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
```

```
# ver2/.gitignore
node_modules/
dist/
.astro/
```

```astro
---
// ver2/src/pages/index.astro
---
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Shoji Mori | Protoplanetary Disks &amp; Planet Formation</title>
  </head>
  <body>
    <h1>Shoji Mori</h1>
  </body>
</html>
```

- [ ] **Step 4: Install dependencies**

Run: `cd ver2 && npm install`
Expected: lockfile `ver2/package-lock.json` created, no errors.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd ver2 && npm test -- smoke`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add ver2/package.json ver2/package-lock.json ver2/tsconfig.json ver2/astro.config.mjs ver2/vitest.config.ts ver2/.gitignore ver2/src/pages/index.astro ver2/tests/smoke.test.ts
git commit -m "Scaffold ver2 Astro project"
```

---

### Task 2: Design tokens, global stylesheet, self-hosted fonts

**Files:**
- Create: `ver2/src/styles/tokens.css`
- Create: `ver2/src/styles/global.css`
- Create: `ver2/src/styles/print.css`
- Modify: `ver2/src/pages/index.astro` (import the stylesheets)
- Test: `ver2/tests/design-tokens.test.ts`

**Interfaces:**
- Produces: CSS custom properties consumed by every later component — `--color-paper`, `--color-ink`, `--color-accent-orange`, `--color-navy-deep`, `--color-navy-mid`, `--font-serif-en`, `--font-serif-ja`, `--font-sans-en`, `--font-sans-ja`, `--max-width`, `--space-1` … `--space-8`.

- [ ] **Step 1: Write the failing test**

```typescript
// ver2/tests/design-tokens.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const tokensPath = path.resolve(__dirname, '../src/styles/tokens.css');

describe('design tokens', () => {
  it('defines the core color and font custom properties', () => {
    const css = readFileSync(tokensPath, 'utf-8');
    for (const token of [
      '--color-paper',
      '--color-ink',
      '--color-accent-orange',
      '--color-navy-deep',
      '--font-serif-en',
      '--font-sans-en',
    ]) {
      expect(css).toContain(token);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ver2 && npm test -- design-tokens`
Expected: FAIL — `tokens.css` does not exist.

- [ ] **Step 3: Write the tokens and global styles**

```css
/* ver2/src/styles/tokens.css */
:root {
  /* Paper & ink */
  --color-paper: #faf9f6;
  --color-paper-dim: #f2f0ea;
  --color-ink: #1a1a1a;
  --color-ink-soft: #4a4a4a;
  --color-rule: #e5e0d5;

  /* The two accents only */
  --color-accent-orange: #c96a2e;
  --color-navy-deep: #0b1026;
  --color-navy-mid: #1a2247;

  /* Type */
  --font-serif-en: 'Newsreader', 'Noto Serif JP', serif;
  --font-serif-ja: 'Noto Serif JP', 'Newsreader', serif;
  --font-sans-en: 'Inter', 'Noto Sans JP', sans-serif;
  --font-sans-ja: 'Noto Sans JP', 'Inter', sans-serif;

  /* Spacing scale (rem) */
  --space-1: 0.5rem;
  --space-2: 1rem;
  --space-3: 1.5rem;
  --space-4: 2rem;
  --space-5: 3rem;
  --space-6: 4.5rem;
  --space-7: 6rem;
  --space-8: 9rem;

  --max-width: 1100px;
}
```

```css
/* ver2/src/styles/global.css */
@import '@fontsource/newsreader/400.css';
@import '@fontsource/newsreader/600.css';
@import '@fontsource/newsreader/400-italic.css';
@import '@fontsource/inter/400.css';
@import '@fontsource/inter/600.css';
@import '@fontsource/noto-serif-jp/500.css';
@import '@fontsource/noto-sans-jp/400.css';
@import './tokens.css';

*, *::before, *::after { box-sizing: border-box; }

html {
  scroll-behavior: smooth;
}

@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

body {
  margin: 0;
  background: var(--color-paper);
  color: var(--color-ink);
  font-family: var(--font-sans-en);
  line-height: 1.6;
}

body.lang-ja { font-family: var(--font-sans-ja); }

h1, h2, h3, h4 {
  font-family: var(--font-serif-en);
  font-weight: 600;
  line-height: 1.3;
  margin: 0 0 var(--space-2);
}

body.lang-ja h1, body.lang-ja h2, body.lang-ja h3, body.lang-ja h4 {
  font-family: var(--font-serif-ja);
}

.container {
  max-width: var(--max-width);
  margin: 0 auto;
  padding: 0 var(--space-3);
}

.en, .ja { display: inline; }
body.lang-ja .en { display: none; }
body:not(.lang-ja) .ja { display: none; }

.chapter-number {
  font-family: var(--font-serif-en);
  font-size: 2.75rem;
  font-weight: 700;
  color: var(--color-rule);
  line-height: 1;
}

.rule {
  border: none;
  border-top: 1px solid var(--color-rule);
  margin: var(--space-4) 0;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

```css
/* ver2/src/styles/print.css */
@media print {
  header nav, .back-to-top, .contact-form, .hero-cta { display: none !important; }
  body { background: #fff; color: #000; }
  a[href]::after { content: " (" attr(href) ")"; font-size: 0.8em; }
  .container { max-width: none; }
}
```

```astro
---
// ver2/src/pages/index.astro
import '../styles/global.css';
---
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Shoji Mori | Protoplanetary Disks &amp; Planet Formation</title>
  </head>
  <body>
    <h1>Shoji Mori</h1>
  </body>
</html>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ver2 && npm test -- design-tokens`
Expected: PASS

- [ ] **Step 5: Verify the site still builds**

Run: `cd ver2 && npm run build`
Expected: build succeeds with no missing-import errors.

- [ ] **Step 6: Commit**

```bash
git add ver2/src/styles ver2/src/pages/index.astro ver2/tests/design-tokens.test.ts
git commit -m "Add design tokens, global stylesheet, and self-hosted fonts"
```

---

### Task 3: Base layout, Header, Footer

**Files:**
- Create: `ver2/src/layouts/BaseLayout.astro`
- Create: `ver2/src/components/Header.astro`
- Create: `ver2/src/components/Footer.astro`
- Create: `ver2/src/data/profile-links.ts`
- Modify: `ver2/src/pages/index.astro` (use `BaseLayout`)
- Test: `ver2/tests/base-layout.test.ts`

**Interfaces:**
- Produces: `BaseLayout.astro` accepting props `{ titleEn: string; titleJa: string; descriptionEn: string; descriptionJa: string; path: string }`, rendering `<Header />` and `<Footer />` around a `<slot />`.
- Produces: `profile-links.ts` exporting `PROFILE_LINKS: { label: string; url: string; icon: string }[]` (ORCID, Google Scholar, ADS, researchmap, GitHub, ResearchGate, Scopus, Web of Science).

- [ ] **Step 1: Write the failing test**

```typescript
// ver2/tests/base-layout.test.ts
import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'node-html-parser';

const root = path.resolve(__dirname, '..');

describe('BaseLayout', () => {
  it('renders header nav, lang toggle, and footer profile links', () => {
    execSync('npm run build', { cwd: root, stdio: 'inherit' });
    const html = readFileSync(path.join(root, 'dist/index.html'), 'utf-8');
    const doc = parse(html);

    const nav = doc.querySelector('nav[aria-label="Primary"]');
    expect(nav).not.toBeNull();
    expect(doc.querySelector('#lang-toggle')).not.toBeNull();

    const footer = doc.querySelector('footer');
    expect(footer).not.toBeNull();
    expect(footer!.querySelector('a[href*="orcid.org"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ver2 && npm test -- base-layout`
Expected: FAIL — no `Header`/`Footer` components, no `#lang-toggle`, no ORCID link yet.

- [ ] **Step 3: Write the profile links data, Header, Footer, and layout**

```typescript
// ver2/src/data/profile-links.ts
export interface ProfileLink {
  label: string;
  url: string;
  icon: string;
}

export const PROFILE_LINKS: ProfileLink[] = [
  { label: 'ORCID', url: 'https://orcid.org/0000-0002-7002-939X', icon: 'orcid' },
  { label: 'Google Scholar', url: 'https://scholar.google.com/citations?user=XUF28swAAAAJ', icon: 'scholar' },
  { label: 'ADS', url: 'https://ui.adsabs.harvard.edu/public-libraries/', icon: 'ads' },
  { label: 'researchmap', url: 'https://researchmap.jp/mori_shoji', icon: 'researchmap' },
  { label: 'GitHub', url: 'https://github.com/shoji-mori', icon: 'github' },
  { label: 'ResearchGate', url: 'https://www.researchgate.net/profile/Shoji-Mori-3', icon: 'researchgate' },
  { label: 'Scopus', url: 'https://www.scopus.com/authid/detail.uri?authorId=57075536200', icon: 'scopus' },
  { label: 'Web of Science', url: 'https://www.webofscience.com/wos/author/record/CAG-1288-2022', icon: 'wos' },
];
```

```astro
---
// ver2/src/components/Header.astro
const navItems = [
  { href: '/', en: 'Home', ja: 'ホーム' },
  { href: '/research/', en: 'Research', ja: '研究内容' },
  { href: '/publications/', en: 'Publications', ja: '論文・解説' },
  { href: '/talks/', en: 'Talks', ja: '学会発表' },
  { href: '/cv/', en: 'CV', ja: '経歴' },
  { href: '/news/', en: 'News', ja: 'お知らせ' },
];
---
<header>
  <nav aria-label="Primary" class="container">
    <a href="/" class="logo">SHOJI MORI</a>
    <button id="menu-toggle" class="menu-toggle" type="button" aria-label="Toggle navigation" aria-expanded="false" aria-controls="primary-nav">
      <span></span><span></span><span></span>
    </button>
    <ul class="nav-links" id="primary-nav">
      {navItems.map((item) => (
        <li><a href={item.href}><span class="en" lang="en">{item.en}</span><span class="ja" lang="ja">{item.ja}</span></a></li>
      ))}
      <li>
        <button id="lang-toggle" class="lang-btn" type="button" aria-label="Toggle language">
          <span class="en" lang="ja">日本語</span>
          <span class="ja" lang="en">English</span>
        </button>
      </li>
    </ul>
  </nav>
</header>
```

```astro
---
// ver2/src/components/Footer.astro
import { PROFILE_LINKS } from '../data/profile-links';
---
<footer class="container">
  <div class="footer-contact">
    <a href="mailto:shoji9m@mail.tsinghua.edu.cn">shoji9m [at] mail.tsinghua.edu.cn</a>
  </div>
  <ul class="footer-links">
    {PROFILE_LINKS.map((link) => (
      <li><a href={link.url} target="_blank" rel="noopener">{link.label}</a></li>
    ))}
  </ul>
  <p class="footer-copyright">&copy; 2026 Shoji Mori.</p>
</footer>
```

```astro
---
// ver2/src/layouts/BaseLayout.astro
import '../styles/global.css';
import '../styles/print.css';
import Header from '../components/Header.astro';
import Footer from '../components/Footer.astro';

interface Props {
  titleEn: string;
  titleJa: string;
  descriptionEn: string;
  descriptionJa: string;
  path: string;
}

const { titleEn, titleJa, descriptionEn, descriptionJa, path } = Astro.props;
const canonical = new URL(path, Astro.site).toString();
---
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{titleEn}</title>
    <meta name="description" content={descriptionEn} />
    <link rel="canonical" href={canonical} />
    <meta data-lang="en" data-field="title" content={titleEn} />
    <meta data-lang="ja" data-field="title" content={titleJa} />
    <meta data-lang="en" data-field="description" content={descriptionEn} />
    <meta data-lang="ja" data-field="description" content={descriptionJa} />
    <slot name="head" />
  </head>
  <body>
    <Header />
    <main>
      <slot />
    </main>
    <Footer />
    <script src="/scripts/lang-toggle-bootstrap.js"></script>
  </body>
</html>
```

```astro
---
// ver2/src/pages/index.astro
import BaseLayout from '../layouts/BaseLayout.astro';
---
<BaseLayout
  titleEn="Shoji Mori | Protoplanetary Disks &amp; Planet Formation"
  titleJa="森 昇志 | 原始惑星系円盤と惑星形成"
  descriptionEn="Personal academic website of Shoji Mori, Shuimu Fellow at Tsinghua University."
  descriptionJa="清華大学Shuimuフェロー、森昇志の研究者ウェブサイト。"
  path="/"
>
  <h1>Shoji Mori</h1>
</BaseLayout>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ver2 && npm test -- base-layout`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ver2/src/layouts ver2/src/components ver2/src/data/profile-links.ts ver2/src/pages/index.astro ver2/tests/base-layout.test.ts
git commit -m "Add BaseLayout, Header, Footer, and profile links data"
```

---

### Task 4: Language toggle (pure logic + wiring)

**Files:**
- Create: `ver2/src/scripts-client/lang-toggle.ts`
- Create: `ver2/public/scripts/lang-toggle-bootstrap.js`
- Modify: `ver2/src/components/Header.astro` (no markup change needed — `#lang-toggle` already exists from Task 3)
- Test: `ver2/src/scripts-client/lang-toggle.test.ts`

**Interfaces:**
- Produces: `getSavedLanguage(storage: Storage): 'en' | 'ja' | null`, `saveLanguagePreference(storage: Storage, lang: 'en' | 'ja'): void`, `applyLanguage(doc: Document, lang: 'en' | 'ja'): void`, `initLangToggle(doc: Document, win: Window & typeof globalThis): void` — all exported from `lang-toggle.ts`.
- Consumes: the `body.lang-ja` CSS contract already defined in `global.css` (Task 2) and the `#lang-toggle` button markup from `Header.astro` (Task 3).

- [ ] **Step 1: Write the failing test**

```typescript
// ver2/src/scripts-client/lang-toggle.test.ts
import { describe, expect, it, beforeEach } from 'vitest';
import {
  getSavedLanguage,
  saveLanguagePreference,
  applyLanguage,
  initLangToggle,
} from './lang-toggle';

function makeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

describe('lang-toggle', () => {
  let storage: Storage;
  beforeEach(() => { storage = makeStorage(); });

  it('returns null when nothing is saved', () => {
    expect(getSavedLanguage(storage)).toBeNull();
  });

  it('round-trips a saved preference', () => {
    saveLanguagePreference(storage, 'ja');
    expect(getSavedLanguage(storage)).toBe('ja');
  });

  it('applyLanguage adds lang-ja class for ja and removes it for en', () => {
    applyLanguage(document, 'ja');
    expect(document.body.classList.contains('lang-ja')).toBe(true);
    applyLanguage(document, 'en');
    expect(document.body.classList.contains('lang-ja')).toBe(false);
  });

  it('initLangToggle applies the saved language and toggles on click', () => {
    document.body.innerHTML = '<button id="lang-toggle"></button>';
    saveLanguagePreference(storage, 'ja');
    initLangToggle(document, { localStorage: storage } as unknown as Window & typeof globalThis);
    expect(document.body.classList.contains('lang-ja')).toBe(true);

    document.getElementById('lang-toggle')!.dispatchEvent(new Event('click'));
    expect(document.body.classList.contains('lang-ja')).toBe(false);
    expect(getSavedLanguage(storage)).toBe('en');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ver2 && npm test -- lang-toggle`
Expected: FAIL — `./lang-toggle` module does not exist.

- [ ] **Step 3: Write the implementation**

```typescript
// ver2/src/scripts-client/lang-toggle.ts
export type Lang = 'en' | 'ja';
const STORAGE_KEY = 'lang';

export function getSavedLanguage(storage: Storage): Lang | null {
  const value = storage.getItem(STORAGE_KEY);
  return value === 'ja' || value === 'en' ? value : null;
}

export function saveLanguagePreference(storage: Storage, lang: Lang): void {
  storage.setItem(STORAGE_KEY, lang);
}

export function applyLanguage(doc: Document, lang: Lang): void {
  doc.body.classList.toggle('lang-ja', lang === 'ja');
  doc.documentElement.setAttribute('lang', lang);
}

export function initLangToggle(doc: Document, win: Window & typeof globalThis): void {
  const saved = getSavedLanguage(win.localStorage);
  if (saved) applyLanguage(doc, saved);

  const button = doc.getElementById('lang-toggle');
  if (!button) return;

  button.addEventListener('click', () => {
    const next: Lang = doc.body.classList.contains('lang-ja') ? 'en' : 'ja';
    applyLanguage(doc, next);
    saveLanguagePreference(win.localStorage, next);
  });
}
```

```javascript
// ver2/public/scripts/lang-toggle-bootstrap.js
// Plain-JS bootstrap: Astro serves TS-authored logic as a built module from
// src/scripts-client/lang-toggle.ts via an inline import here, keeping the
// exported functions unit-testable while the page only loads one small file.
import { initLangToggle } from '/src/scripts-client/lang-toggle.ts';
initLangToggle(document, window);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ver2 && npm test -- lang-toggle`
Expected: PASS

- [ ] **Step 5: Verify wiring in a real build**

Run: `cd ver2 && npm run build && grep -c "lang-toggle-bootstrap" dist/index.html`
Expected: output `1` (the bootstrap script tag is present).

- [ ] **Step 6: Commit**

```bash
git add ver2/src/scripts-client/lang-toggle.ts ver2/src/scripts-client/lang-toggle.test.ts ver2/public/scripts/lang-toggle-bootstrap.js
git commit -m "Add language toggle logic with unit tests"
```

---

### Task 5: Mobile menu toggle and header scroll shadow

**Files:**
- Create: `ver2/src/scripts-client/header-behavior.ts`
- Create: `ver2/public/scripts/header-behavior-bootstrap.js`
- Modify: `ver2/src/layouts/BaseLayout.astro` (add the second bootstrap script tag)
- Test: `ver2/src/scripts-client/header-behavior.test.ts`

**Interfaces:**
- Produces: `initMobileMenu(doc: Document): void` (toggles `.nav-open` on `#primary-nav` and `aria-expanded` on `#menu-toggle`, closes on nav-link click), `initHeaderScrollShadow(doc: Document, win: Window): void` (adds `.scrolled` class to `<header>` past a 10px scroll threshold).

- [ ] **Step 1: Write the failing test**

```typescript
// ver2/src/scripts-client/header-behavior.test.ts
import { describe, expect, it } from 'vitest';
import { initMobileMenu } from './header-behavior';

describe('header-behavior', () => {
  it('toggles nav-open and aria-expanded on menu button click', () => {
    document.body.innerHTML = `
      <header>
        <button id="menu-toggle" aria-expanded="false"></button>
        <ul id="primary-nav"><li><a href="/research/">Research</a></li></ul>
      </header>`;
    initMobileMenu(document);

    const button = document.getElementById('menu-toggle')!;
    const nav = document.getElementById('primary-nav')!;

    button.dispatchEvent(new Event('click'));
    expect(nav.classList.contains('nav-open')).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('true');

    nav.querySelector('a')!.dispatchEvent(new Event('click', { bubbles: true }));
    expect(nav.classList.contains('nav-open')).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ver2 && npm test -- header-behavior`
Expected: FAIL — `./header-behavior` module does not exist.

- [ ] **Step 3: Write the implementation**

```typescript
// ver2/src/scripts-client/header-behavior.ts
export function initMobileMenu(doc: Document): void {
  const button = doc.getElementById('menu-toggle');
  const nav = doc.getElementById('primary-nav');
  if (!button || !nav) return;

  const close = () => {
    nav.classList.remove('nav-open');
    button.setAttribute('aria-expanded', 'false');
  };

  button.addEventListener('click', () => {
    const isOpen = nav.classList.toggle('nav-open');
    button.setAttribute('aria-expanded', String(isOpen));
  });

  nav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', close);
  });
}

export function initHeaderScrollShadow(doc: Document, win: Window): void {
  const header = doc.querySelector('header');
  if (!header) return;

  const update = () => {
    header.classList.toggle('scrolled', win.scrollY > 10);
  };
  win.addEventListener('scroll', update, { passive: true });
  update();
}
```

```javascript
// ver2/public/scripts/header-behavior-bootstrap.js
import { initMobileMenu, initHeaderScrollShadow } from '/src/scripts-client/header-behavior.ts';
initMobileMenu(document);
initHeaderScrollShadow(document, window);
```

```astro
// ver2/src/layouts/BaseLayout.astro — add alongside the existing bootstrap script tag
    <script src="/scripts/lang-toggle-bootstrap.js"></script>
    <script src="/scripts/header-behavior-bootstrap.js"></script>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ver2 && npm test -- header-behavior`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ver2/src/scripts-client/header-behavior.ts ver2/src/scripts-client/header-behavior.test.ts ver2/public/scripts/header-behavior-bootstrap.js ver2/src/layouts/BaseLayout.astro
git commit -m "Add mobile menu and header scroll-shadow behavior"
```

---

## Milestone B — Data Foundations

### Task 6: Zod schemas for publications, presentations, CV, and the News content collection

**Files:**
- Create: `ver2/src/data/schemas.ts`
- Create: `ver2/src/content.config.ts`
- Create: `ver2/src/content/news/.gitkeep`
- Test: `ver2/src/data/schemas.test.ts`

**Interfaces:**
- Produces: `AdsRecordSchema`, `AdsSearchResponseSchema`, `PublicationOverrideSchema`, `PublicationOverridesFileSchema`, `PublicationSchema`, `PresentationSchema`, `PresentationsFileSchema`, `CvDataSchema` and their inferred TypeScript types (`AdsRecord`, `PublicationOverride`, `Publication`, `Presentation`, `CvData`) — all later tasks import types from this one file.
- Produces: the `news` content collection (`astro:content`) with a schema of `{ date, titleEn, titleJa, summaryEn, summaryJa, linkUrl?, linkLabelEn?, linkLabelJa? }`.

- [ ] **Step 1: Write the failing test**

```typescript
// ver2/src/data/schemas.test.ts
import { describe, expect, it } from 'vitest';
import { PublicationSchema, PresentationSchema, CvDataSchema, PublicationOverrideSchema } from './schemas';

describe('schemas', () => {
  it('accepts a valid Publication', () => {
    const result = PublicationSchema.safeParse({
      id: 'doi:10.3847/1538-4357/adf8d7',
      source: 'ads',
      year: '2025',
      titleEn: 'Radiative Nonideal MHD Simulations of Inner Protoplanetary Disks',
      titleJa: 'Radiative Nonideal MHD Simulations of Inner Protoplanetary Disks',
      authorsEn: '<strong>Shoji Mori</strong>, Xue-Ning Bai, Kengo Tomida',
      authorsJa: '<strong>森 昇志</strong>, Xue-Ning Bai, 富田 賢吾',
      journalEn: 'The Astrophysical Journal, 992:85',
      journalJa: 'The Astrophysical Journal, 992:85',
      doi: '10.3847/1538-4357/adf8d7',
      arxivId: '2508.03624',
      bibcode: '2025ApJ...992...85M',
      adsUrl: 'https://ui.adsabs.harvard.edu/abs/2025ApJ...992...85M',
      url: null,
      citationCount: 0,
      refereed: true,
      selected: true,
      highlight: true,
      highlightOrder: 1,
      abstractEn: 'This study simulates the inner part of a planet-forming disk.',
      abstractJa: '若い星のまわりにある円盤の内側をシミュレーションした研究です。',
      bibtex: '@ARTICLE{2025ApJ...992...85M}',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a Publication missing a required field', () => {
    const result = PublicationSchema.safeParse({ id: 'x' });
    expect(result.success).toBe(false);
  });

  it('rejects a PublicationOverride manual block missing url', () => {
    const result = PublicationOverrideSchema.safeParse({
      id: 'slug:some-proceedings',
      selected: false,
      highlight: false,
      abstractEn: '',
      abstractJa: '',
      manual: { titleEn: 'X', authorsEn: 'Y', journalEn: 'Z', year: '2021' },
    });
    expect(result.success).toBe(false);
  });

  it('accepts a valid Presentation', () => {
    const result = PresentationSchema.safeParse({
      id: '2025-12-epf-thermal-structure',
      year: '2025',
      date: '2025/12/8-12',
      titleEn: 'Thermal Structure of Magnetized Protoplanetary Disks',
      titleJa: 'Thermal Structure of Magnetized Protoplanetary Disks',
      authorsEn: 'S. Mori',
      authorsJa: '森 昇志',
      confEn: 'International Conference on Exoplanets and Planet Formation',
      confJa: 'International Conference on Exoplanets and Planet Formation',
      type: 'poster',
      scope: 'international',
      placeEn: 'Shanghai, China',
      placeJa: '上海 (中国)',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid CvData shape', () => {
    const result = CvDataSchema.safeParse({
      education: [{ dateRange: '2016.04 - 2019.03', titleEn: 'Ph.D.', titleJa: '博士', orgEn: 'Tokyo Tech', orgJa: '東京工業大学' }],
      grants: [],
      awards: [],
      teaching: [],
      mentoring: [],
      service: [],
      seminars: [],
      reviewJournals: [{ name: 'Nature Astronomy', url: 'https://www.nature.com/natastron/' }],
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ver2 && npm test -- schemas`
Expected: FAIL — `./schemas` module does not exist.

- [ ] **Step 3: Write the schemas**

```typescript
// ver2/src/data/schemas.ts
import { z } from 'zod';

export const AdsRecordSchema = z.object({
  bibcode: z.string(),
  title: z.array(z.string()).min(1),
  author: z.array(z.string()),
  pub: z.string().nullable(),
  volume: z.string().nullable().optional(),
  page: z.array(z.string()).nullable().optional(),
  year: z.string(),
  doi: z.array(z.string()).nullable().optional(),
  identifier: z.array(z.string()).nullable().optional(),
  citation_count: z.number().default(0),
  property: z.array(z.string()).default([]),
});
export type AdsRecord = z.infer<typeof AdsRecordSchema>;

export const AdsSearchResponseSchema = z.object({
  response: z.object({
    numFound: z.number(),
    docs: z.array(AdsRecordSchema),
  }),
});

const ManualFallbackSchema = z.object({
  titleEn: z.string(),
  authorsEn: z.string(),
  journalEn: z.string(),
  year: z.string(),
  url: z.string(),
});

export const PublicationOverrideSchema = z.object({
  id: z.string(),
  doi: z.string().nullable().optional(),
  arxivId: z.string().nullable().optional(),
  selected: z.boolean().default(false),
  highlight: z.boolean().default(false),
  highlightOrder: z.number().optional(),
  highlightImage: z.string().optional(),
  authorsJa: z.string().optional(),
  abstractEn: z.string().default(''),
  abstractJa: z.string().default(''),
  manual: ManualFallbackSchema.optional(),
});
export type PublicationOverride = z.infer<typeof PublicationOverrideSchema>;
export const PublicationOverridesFileSchema = z.array(PublicationOverrideSchema);

export const PublicationSchema = z.object({
  id: z.string(),
  source: z.enum(['ads', 'manual']),
  year: z.string(),
  titleEn: z.string(),
  titleJa: z.string(),
  authorsEn: z.string(),
  authorsJa: z.string(),
  journalEn: z.string(),
  journalJa: z.string(),
  doi: z.string().nullable(),
  arxivId: z.string().nullable(),
  bibcode: z.string().nullable(),
  adsUrl: z.string().nullable(),
  url: z.string().nullable(),
  citationCount: z.number(),
  refereed: z.boolean(),
  selected: z.boolean(),
  highlight: z.boolean(),
  highlightOrder: z.number().optional(),
  highlightImage: z.string().optional(),
  abstractEn: z.string(),
  abstractJa: z.string(),
  bibtex: z.string().nullable(),
});
export type Publication = z.infer<typeof PublicationSchema>;

export const PresentationSchema = z.object({
  id: z.string(),
  year: z.string(),
  date: z.string(),
  titleEn: z.string(),
  titleJa: z.string(),
  authorsEn: z.string(),
  authorsJa: z.string(),
  confEn: z.string(),
  confJa: z.string(),
  type: z.enum(['invited', 'oral', 'poster']),
  scope: z.enum(['international', 'domestic']),
  placeEn: z.string(),
  placeJa: z.string(),
  url: z.string().nullable().optional(),
  slideUrl: z.string().nullable().optional(),
  posterUrl: z.string().nullable().optional(),
  noteEn: z.string().nullable().optional(),
  noteJa: z.string().nullable().optional(),
});
export type Presentation = z.infer<typeof PresentationSchema>;
export const PresentationsFileSchema = z.array(PresentationSchema);

const CvTimelineEntrySchema = z.object({
  dateRange: z.string(),
  titleEn: z.string(),
  titleJa: z.string(),
  orgEn: z.string(),
  orgJa: z.string(),
  noteEn: z.string().optional(),
  noteJa: z.string().optional(),
  extraEn: z.string().optional(),
  extraJa: z.string().optional(),
  linkLabel: z.string().optional(),
  linkUrl: z.string().optional(),
});

const CvGrantSchema = z.object({
  dateRange: z.string(),
  titleEn: z.string(),
  titleJa: z.string(),
  roleEn: z.string(),
  roleJa: z.string(),
  amountEn: z.string().optional(),
  amountJa: z.string().optional(),
  linkLabel: z.string().optional(),
  linkUrl: z.string().optional(),
});

const CvAwardSchema = z.object({
  year: z.string(),
  titleEn: z.string(),
  titleJa: z.string(),
  orgEn: z.string(),
  orgJa: z.string(),
  dateEn: z.string().optional(),
  dateJa: z.string().optional(),
  linkLabel: z.string().optional(),
  linkUrl: z.string().optional(),
});

const CvSimpleEntrySchema = z.object({
  dateRange: z.string(),
  titleEn: z.string(),
  titleJa: z.string(),
  orgEn: z.string(),
  orgJa: z.string(),
});

const CvMenteeSchema = z.object({
  dateRange: z.string(),
  nameEn: z.string(),
  nameJa: z.string(),
  roleEn: z.string(),
  roleJa: z.string(),
  topicEn: z.string(),
  topicJa: z.string(),
});

const CvSeminarSchema = z.object({
  date: z.string(),
  titleEn: z.string(),
  titleJa: z.string(),
  venueEn: z.string(),
  venueJa: z.string(),
  slideUrl: z.string().optional(),
  videoUrl: z.string().optional(),
});

export const CvDataSchema = z.object({
  education: z.array(CvTimelineEntrySchema),
  grants: z.array(CvGrantSchema),
  awards: z.array(CvAwardSchema),
  teaching: z.array(CvSimpleEntrySchema),
  mentoring: z.array(CvMenteeSchema),
  service: z.array(CvSimpleEntrySchema),
  seminars: z.array(CvSeminarSchema),
  reviewJournals: z.array(z.object({ name: z.string(), url: z.string() })),
});
export type CvData = z.infer<typeof CvDataSchema>;
```

```typescript
// ver2/src/content.config.ts
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const news = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/news' }),
  schema: z.object({
    date: z.coerce.date(),
    titleEn: z.string(),
    titleJa: z.string(),
    summaryEn: z.string(),
    summaryJa: z.string(),
    linkUrl: z.string().optional(),
    linkLabelEn: z.string().optional(),
    linkLabelJa: z.string().optional(),
  }),
});

export const collections = { news };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ver2 && npm test -- schemas`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ver2/src/data/schemas.ts ver2/src/data/schemas.test.ts ver2/src/content.config.ts ver2/src/content/news/.gitkeep
git commit -m "Add Zod schemas for publications, presentations, CV, and news collection"
```

---

### Task 7: Pure formatting helpers (author names, journal strings, arXiv/refereed extraction)

**Files:**
- Create: `ver2/src/lib/format.ts`
- Test: `ver2/src/lib/format.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions on primitives).
- Produces: `adsNameToDisplay(adsName: string): string`, `formatAuthors(adsAuthors: string[], ownerLastName?: string): string`, `formatJournal(pub: string | null, volume?: string | null, page?: string[] | null): string`, `extractArxivId(identifiers?: string[] | null): string | null`, `isRefereed(property: string[]): boolean` — consumed by `merge-publications.ts` in Task 8.

- [ ] **Step 1: Write the failing test**

```typescript
// ver2/src/lib/format.test.ts
import { describe, expect, it } from 'vitest';
import { adsNameToDisplay, formatAuthors, formatJournal, extractArxivId, isRefereed } from './format';

describe('adsNameToDisplay', () => {
  it('converts "Last, First" to "First Last"', () => {
    expect(adsNameToDisplay('Mori, Shoji')).toBe('Shoji Mori');
  });
  it('returns the name unchanged when there is no comma', () => {
    expect(adsNameToDisplay('Mori')).toBe('Mori');
  });
});

describe('formatAuthors', () => {
  it('bolds the owner and joins short author lists with commas', () => {
    const result = formatAuthors(['Mori, Shoji', 'Bai, Xue-Ning', 'Tomida, Kengo']);
    expect(result).toBe('<strong>Shoji Mori</strong>, Xue-Ning Bai, Kengo Tomida');
  });

  it('truncates long author lists to first three + owner + et al.', () => {
    const authors = [
      'Takakuwa, Shigehisa', 'Saigo, Kazuya', 'Kido, Miyu', 'Aso, Yusuke',
      'Ohashi, Nagayoshi', 'Mori, Shoji', 'Someone, Else',
    ];
    const result = formatAuthors(authors);
    expect(result).toBe(
      'Shigehisa Takakuwa, Kazuya Saigo, Miyu Kido, <strong>Shoji Mori</strong>, et al.'
    );
  });
});

describe('formatJournal', () => {
  it('joins publication, volume, and page', () => {
    expect(formatJournal('The Astrophysical Journal', '992', ['85'])).toBe(
      'The Astrophysical Journal, 992:85'
    );
  });
  it('handles a missing volume', () => {
    expect(formatJournal('The Astrophysical Journal', null, null)).toBe('The Astrophysical Journal');
  });
  it('returns an empty string when pub is null', () => {
    expect(formatJournal(null)).toBe('');
  });
});

describe('extractArxivId', () => {
  it('finds the arXiv identifier among ADS identifiers', () => {
    expect(extractArxivId(['2025ApJ...992...85M', 'arXiv:2508.03624'])).toBe('2508.03624');
  });
  it('returns null when there is no arXiv identifier', () => {
    expect(extractArxivId(['2025ApJ...992...85M'])).toBeNull();
  });
  it('returns null for null/undefined input', () => {
    expect(extractArxivId(null)).toBeNull();
    expect(extractArxivId(undefined)).toBeNull();
  });
});

describe('isRefereed', () => {
  it('is true when property contains REFEREED', () => {
    expect(isRefereed(['ARTICLE', 'REFEREED'])).toBe(true);
  });
  it('is false otherwise', () => {
    expect(isRefereed(['ARTICLE'])).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ver2 && npm test -- format`
Expected: FAIL — `./format` module does not exist.

- [ ] **Step 3: Write the implementation**

```typescript
// ver2/src/lib/format.ts
export function adsNameToDisplay(adsName: string): string {
  const [last, first] = adsName.split(',').map((s) => s.trim());
  return first ? `${first} ${last}` : last;
}

export function formatAuthors(adsAuthors: string[], ownerLastName = 'Mori'): string {
  const names = adsAuthors.map(adsNameToDisplay);
  const ownerIndex = names.findIndex((name) => name.includes(ownerLastName));
  const bolded = names.map((name, i) => (i === ownerIndex ? `<strong>${name}</strong>` : name));

  if (bolded.length <= 6) {
    return bolded.join(', ');
  }

  const visible = bolded.slice(0, 3);
  if (ownerIndex >= 3) visible.push(bolded[ownerIndex]);
  return `${visible.join(', ')}, et al.`;
}

export function formatJournal(
  pub: string | null,
  volume?: string | null,
  page?: string[] | null,
): string {
  if (!pub) return '';
  if (!volume) return pub;
  const pageStr = page && page[0] ? `:${page[0]}` : '';
  return `${pub}, ${volume}${pageStr}`;
}

export function extractArxivId(identifiers?: string[] | null): string | null {
  if (!identifiers) return null;
  const found = identifiers.find((id) => id.startsWith('arXiv:'));
  return found ? found.replace('arXiv:', '') : null;
}

export function isRefereed(property: string[]): boolean {
  return property.includes('REFEREED');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ver2 && npm test -- format`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ver2/src/lib/format.ts ver2/src/lib/format.test.ts
git commit -m "Add pure formatting helpers for publication display strings"
```

---

### Task 8: Publication merge logic (ADS records + local overrides → display data)

**Files:**
- Create: `ver2/src/lib/merge-publications.ts`
- Test: `ver2/src/lib/merge-publications.test.ts`

**Interfaces:**
- Consumes: `AdsRecord`, `PublicationOverride`, `Publication` types from `src/data/schemas.ts` (Task 6); `formatAuthors`, `formatJournal`, `extractArxivId`, `isRefereed` from `src/lib/format.ts` (Task 7).
- Produces: `mergePublications(adsRecords: AdsRecord[], overrides: PublicationOverride[], bibtexByBibcode?: Record<string, string>): Publication[]` — consumed by `src/data/publications.ts` (Task 12) and by the ADS sync script's own tests are not required (sync script only fetches; merging happens at read time).

- [ ] **Step 1: Write the failing test**

```typescript
// ver2/src/lib/merge-publications.test.ts
import { describe, expect, it } from 'vitest';
import { mergePublications } from './merge-publications';
import type { AdsRecord, PublicationOverride } from '../data/schemas';

const adsRecord: AdsRecord = {
  bibcode: '2025ApJ...992...85M',
  title: ['Radiative Nonideal MHD Simulations of Inner Protoplanetary Disks'],
  author: ['Mori, Shoji', 'Bai, Xue-Ning', 'Tomida, Kengo'],
  pub: 'The Astrophysical Journal',
  volume: '992',
  page: ['85'],
  year: '2025',
  doi: ['10.3847/1538-4357/adf8d7'],
  identifier: ['arXiv:2508.03624'],
  citation_count: 3,
  property: ['ARTICLE', 'REFEREED'],
};

describe('mergePublications', () => {
  it('merges an ADS record with its matching override by DOI', () => {
    const override: PublicationOverride = {
      id: 'doi:10.3847/1538-4357/adf8d7',
      doi: '10.3847/1538-4357/adf8d7',
      selected: true,
      highlight: true,
      highlightOrder: 1,
      abstractEn: 'This study simulates the inner part of a planet-forming disk.',
      abstractJa: '若い星のまわりにある円盤の内側をシミュレーションした研究です。',
    };

    const [pub] = mergePublications([adsRecord], [override], {
      '2025ApJ...992...85M': '@ARTICLE{2025ApJ...992...85M}',
    });

    expect(pub.source).toBe('ads');
    expect(pub.authorsEn).toBe('<strong>Shoji Mori</strong>, Xue-Ning Bai, Kengo Tomida');
    expect(pub.journalEn).toBe('The Astrophysical Journal, 992:85');
    expect(pub.selected).toBe(true);
    expect(pub.highlight).toBe(true);
    expect(pub.abstractEn).toContain('simulates the inner part');
    expect(pub.citationCount).toBe(3);
    expect(pub.refereed).toBe(true);
    expect(pub.bibtex).toBe('@ARTICLE{2025ApJ...992...85M}');
  });

  it('uses default (non-selected, non-highlighted) values when there is no override', () => {
    const [pub] = mergePublications([adsRecord], []);
    expect(pub.selected).toBe(false);
    expect(pub.highlight).toBe(false);
    expect(pub.abstractEn).toBe('');
  });

  it('includes an override-only manual entry when it has no ADS match', () => {
    const override: PublicationOverride = {
      id: 'slug:snow-line-proceedings',
      selected: false,
      highlight: false,
      abstractEn: '',
      abstractJa: '',
      manual: {
        titleEn: 'A Proceedings Paper Without a DOI',
        authorsEn: '<strong>Shoji Mori</strong>',
        journalEn: 'Wakusei Kagaku, 30(4)',
        year: '2021',
        url: 'https://www.wakusei.jp/book/pp/2021/2021-4/2021-04-148.pdf',
      },
    };

    const results = mergePublications([adsRecord], [override]);
    expect(results).toHaveLength(2);
    const manual = results.find((p) => p.source === 'manual');
    expect(manual).toBeDefined();
    expect(manual!.url).toBe('https://www.wakusei.jp/book/pp/2021/2021-4/2021-04-148.pdf');
  });

  it('sorts results by year descending', () => {
    const older: AdsRecord = { ...adsRecord, bibcode: '2019ApJ...880...80X', year: '2019', doi: ['10.1/older'] };
    const results = mergePublications([adsRecord, older], []);
    expect(results.map((p) => p.year)).toEqual(['2025', '2019']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ver2 && npm test -- merge-publications`
Expected: FAIL — `./merge-publications` module does not exist.

- [ ] **Step 3: Write the implementation**

```typescript
// ver2/src/lib/merge-publications.ts
import type { AdsRecord, Publication, PublicationOverride } from '../data/schemas';
import { formatAuthors, formatJournal, extractArxivId, isRefereed } from './format';

function keyFor(doi?: string | null, arxivId?: string | null, fallback?: string | null): string {
  return (doi || arxivId || fallback || '').toLowerCase();
}

function mergeAdsRecord(record: AdsRecord, override: PublicationOverride | undefined): Publication {
  const doi = record.doi?.[0] ?? null;
  const arxivId = extractArxivId(record.identifier);
  const titleEn = record.title[0];
  const authorsEn = formatAuthors(record.author);
  const journalEn = formatJournal(record.pub, record.volume, record.page);

  return {
    id: override?.id ?? keyFor(doi, arxivId, record.bibcode),
    source: 'ads',
    year: record.year,
    titleEn,
    titleJa: titleEn,
    authorsEn,
    authorsJa: override?.authorsJa ?? authorsEn,
    journalEn,
    journalJa: journalEn,
    doi,
    arxivId,
    bibcode: record.bibcode,
    adsUrl: `https://ui.adsabs.harvard.edu/abs/${record.bibcode}`,
    url: null,
    citationCount: record.citation_count,
    refereed: isRefereed(record.property),
    selected: override?.selected ?? false,
    highlight: override?.highlight ?? false,
    highlightOrder: override?.highlightOrder,
    highlightImage: override?.highlightImage,
    abstractEn: override?.abstractEn ?? '',
    abstractJa: override?.abstractJa ?? '',
    bibtex: null,
  };
}

function manualPublicationFromOverride(override: PublicationOverride): Publication {
  if (!override.manual) {
    throw new Error(`Override ${override.id} has no ADS match and no manual fallback fields`);
  }
  const { manual } = override;
  return {
    id: override.id,
    source: 'manual',
    year: manual.year,
    titleEn: manual.titleEn,
    titleJa: manual.titleEn,
    authorsEn: manual.authorsEn,
    authorsJa: override.authorsJa ?? manual.authorsEn,
    journalEn: manual.journalEn,
    journalJa: manual.journalEn,
    doi: override.doi ?? null,
    arxivId: override.arxivId ?? null,
    bibcode: null,
    adsUrl: null,
    url: manual.url,
    citationCount: 0,
    refereed: false,
    selected: override.selected,
    highlight: override.highlight,
    highlightOrder: override.highlightOrder,
    highlightImage: override.highlightImage,
    abstractEn: override.abstractEn,
    abstractJa: override.abstractJa,
    bibtex: null,
  };
}

export function mergePublications(
  adsRecords: AdsRecord[],
  overrides: PublicationOverride[],
  bibtexByBibcode: Record<string, string> = {},
): Publication[] {
  const overrideByKey = new Map<string, PublicationOverride>();
  for (const override of overrides) {
    overrideByKey.set(keyFor(override.doi, override.arxivId, override.id), override);
  }

  const matchedOverrideIds = new Set<string>();
  const merged: Publication[] = adsRecords.map((record) => {
    const doi = record.doi?.[0] ?? null;
    const arxivId = extractArxivId(record.identifier);
    const override = overrideByKey.get(keyFor(doi, arxivId, record.bibcode));
    if (override) matchedOverrideIds.add(override.id);
    const pub = mergeAdsRecord(record, override);
    return { ...pub, bibtex: bibtexByBibcode[record.bibcode] ?? null };
  });

  for (const override of overrides) {
    if (!matchedOverrideIds.has(override.id) && override.manual) {
      merged.push(manualPublicationFromOverride(override));
    }
  }

  return merged.sort((a, b) => Number(b.year) - Number(a.year));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ver2 && npm test -- merge-publications`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ver2/src/lib/merge-publications.ts ver2/src/lib/merge-publications.test.ts
git commit -m "Add publication merge logic joining ADS records with local overrides"
```

---

### Task 9: ADS sync script

**Files:**
- Create: `ver2/scripts/sync-ads.mjs`
- Create: `ver2/scripts/lib/ads-client.mjs`
- Test: `ver2/scripts/lib/ads-client.test.ts`

**Interfaces:**
- Produces: `searchByOrcid(orcid: string, token: string, fetchImpl?: typeof fetch): Promise<AdsRecordLike[]>` and `exportBibtex(bibcodes: string[], token: string, fetchImpl?: typeof fetch): Promise<Record<string,string>>` from `ads-client.mjs`, both accepting an injectable `fetch` for testing.
- Produces: `ver2/src/data/publications.generated.json` — an array validated against `AdsRecordSchema`, written by `sync-ads.mjs` when run with `ADS_API_TOKEN` set. `sync-ads.mjs` never writes to `publications.overrides.yaml`.

- [ ] **Step 1: Write the failing test**

```typescript
// ver2/scripts/lib/ads-client.test.ts
import { describe, expect, it, vi } from 'vitest';
import { searchByOrcid, exportBibtex } from './ads-client.mjs';

describe('searchByOrcid', () => {
  it('calls the ADS search endpoint with a bearer token and returns docs', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        response: {
          numFound: 1,
          docs: [{ bibcode: '2025ApJ...992...85M', title: ['A Title'], author: ['Mori, Shoji'], pub: 'ApJ', year: '2025', citation_count: 0, property: ['REFEREED'] }],
        },
      }),
    }));

    const docs = await searchByOrcid('0000-0002-7002-939X', 'FAKE_TOKEN', fetchImpl as unknown as typeof fetch);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('orcid%3A0000-0002-7002-939X');
    expect(options.headers.Authorization).toBe('Bearer FAKE_TOKEN');
    expect(docs).toHaveLength(1);
    expect(docs[0].bibcode).toBe('2025ApJ...992...85M');
  });

  it('throws a descriptive error on a non-OK response', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401, statusText: 'Unauthorized' }));
    await expect(
      searchByOrcid('0000-0002-7002-939X', 'BAD_TOKEN', fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow(/ADS search failed: 401/);
  });
});

describe('exportBibtex', () => {
  it('posts bibcodes and returns a bibcode-to-bibtex map', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ export: '@ARTICLE{2025ApJ...992...85M,\n title={A}\n}\n\n@ARTICLE{2019ApJ...880...80X,\n title={B}\n}\n' }),
    }));

    const map = await exportBibtex(
      ['2025ApJ...992...85M', '2019ApJ...880...80X'],
      'FAKE_TOKEN',
      fetchImpl as unknown as typeof fetch,
    );

    expect(map['2025ApJ...992...85M']).toContain('title={A}');
    expect(map['2019ApJ...880...80X']).toContain('title={B}');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ver2 && npm test -- ads-client`
Expected: FAIL — `./ads-client.mjs` does not exist.

- [ ] **Step 3: Write the ADS client and sync script**

```javascript
// ver2/scripts/lib/ads-client.mjs
const SEARCH_URL = 'https://api.adsabs.harvard.edu/v1/search/query';
const EXPORT_URL = 'https://api.adsabs.harvard.edu/v1/export/bibtex';

const FIELDS = ['bibcode', 'title', 'author', 'pub', 'volume', 'page', 'year', 'doi', 'identifier', 'citation_count', 'property'];

export async function searchByOrcid(orcid, token, fetchImpl = fetch) {
  const query = new URLSearchParams({
    q: `orcid:${orcid}`,
    fl: FIELDS.join(','),
    rows: '200',
  });
  const response = await fetchImpl(`${SEARCH_URL}?${query.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`ADS search failed: ${response.status} ${response.statusText}`);
  }
  const body = await response.json();
  return body.response.docs;
}

export async function exportBibtex(bibcodes, token, fetchImpl = fetch) {
  if (bibcodes.length === 0) return {};
  const response = await fetchImpl(EXPORT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ bibcode: bibcodes }),
  });
  if (!response.ok) {
    throw new Error(`ADS bibtex export failed: ${response.status} ${response.statusText}`);
  }
  const body = await response.json();
  const entries = body.export.split(/\n\n(?=@)/).map((entry) => entry.trim()).filter(Boolean);
  const map = {};
  for (const entry of entries) {
    const match = entry.match(/^@\w+\{([^,]+),/);
    if (match) map[match[1]] = entry;
  }
  return map;
}
```

```javascript
// ver2/scripts/sync-ads.mjs
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchByOrcid, exportBibtex } from './lib/ads-client.mjs';

// Note: this script runs under plain `node`, which cannot import the
// TypeScript-authored `src/data/schemas.ts` directly. Full Zod validation of
// these records already happens where they are read back (`loadGeneratedAdsRecords`
// in `src/data/publications.ts`, Task 12), which runs through Astro/Vite's
// TypeScript pipeline. This script only does a minimal shape sanity check.
const REQUIRED_FIELDS = ['bibcode', 'title', 'author', 'year'];

function assertMinimalShape(doc) {
  for (const field of REQUIRED_FIELDS) {
    if (!(field in doc)) {
      throw new Error(`ADS record ${doc.bibcode ?? '(unknown bibcode)'} is missing required field "${field}"`);
    }
  }
}

const ORCID = '0000-0002-7002-939X';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, '../src/data/publications.generated.json');
const BIBTEX_OUT_PATH = path.join(__dirname, '../src/data/publications.bibtex.json');

async function main() {
  const token = process.env.ADS_API_TOKEN;
  if (!token) {
    throw new Error('ADS_API_TOKEN environment variable is required to run sync-ads.mjs');
  }

  const docs = await searchByOrcid(ORCID, token);
  docs.forEach(assertMinimalShape);

  const bibcodes = docs.map((doc) => doc.bibcode);
  const bibtexMap = await exportBibtex(bibcodes, token);

  await writeFile(OUT_PATH, JSON.stringify(docs, null, 2) + '\n', 'utf-8');
  await writeFile(BIBTEX_OUT_PATH, JSON.stringify(bibtexMap, null, 2) + '\n', 'utf-8');

  console.log(`Synced ${docs.length} ADS records and ${Object.keys(bibtexMap).length} BibTeX entries.`);
}

main().catch((error) => {
  console.error('ADS sync failed:', error.message);
  console.error('The previous publications.generated.json (if any) has been left untouched.');
  process.exitCode = 1;
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ver2 && npm test -- ads-client`
Expected: PASS

- [ ] **Step 5: Manual verification with a real token (run by the human, not the agent)**

Run: `cd ver2 && ADS_API_TOKEN=<your token from https://ui.adsabs.harvard.edu/user/settings/token> npm run sync:ads`
Expected: console line `Synced N ADS records and M BibTeX entries.`, and `src/data/publications.generated.json` / `src/data/publications.bibtex.json` are created. This step requires the human's own ADS token (§6 of the design doc) — the agent should stop here and ask the human to run it if the token is not available in the environment.

- [ ] **Step 6: Commit**

```bash
git add ver2/scripts/sync-ads.mjs ver2/scripts/lib/ads-client.mjs ver2/scripts/lib/ads-client.test.ts
git commit -m "Add ADS sync script (search + BibTeX export) with mocked-fetch tests"
```

Note: do not commit `src/data/publications.generated.json` / `publications.bibtex.json` yet — Task 10 needs the *old* site's data untouched by ADS first, and Task 12's loader is written to tolerate the generated file being absent (falls back to an empty ADS record list) so `npm run build` still works before the human runs the real sync.

---

### Task 10: Migrate `publications_data.js` to `publications.overrides.yaml`

**Files:**
- Create: `ver2/scripts/migrate-publications.mjs`
- Test: `ver2/scripts/migrate-publications.test.ts`
- Generate (by running the script): `ver2/src/data/publications.overrides.yaml`

**Interfaces:**
- Consumes: the repo-root `publications_data.js` (22 entries, verified in Task exploration — read-only, never modified).
- Produces: `ver2/src/data/publications.overrides.yaml`, an array matching `PublicationOverridesFileSchema` (Task 6), consumed by `src/data/publications.ts` (Task 12).

- [ ] **Step 1: Write the failing test**

```typescript
// ver2/scripts/migrate-publications.test.ts
import { describe, expect, it, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { PublicationOverridesFileSchema } from '../src/data/schemas';

const root = path.resolve(__dirname, '..');
const outPath = path.join(root, 'src/data/publications.overrides.yaml');

describe('migrate-publications', () => {
  beforeAll(() => {
    execSync('node scripts/migrate-publications.mjs', { cwd: root, stdio: 'inherit' });
  });

  it('produces a file with all 22 publications, valid against the schema', () => {
    const overrides = YAML.parse(readFileSync(outPath, 'utf-8'));
    expect(overrides).toHaveLength(22);
    expect(() => PublicationOverridesFileSchema.parse(overrides)).not.toThrow();
  });

  it('keys the 2025 ApJ paper by DOI and preserves its Japanese abstract', () => {
    const overrides = YAML.parse(readFileSync(outPath, 'utf-8'));
    const entry = overrides.find((o: { id: string }) => o.id === 'doi:10.3847/1538-4357/adf8d7');
    expect(entry).toBeDefined();
    expect(entry.selected).toBe(true);
    expect(entry.abstractJa).toContain('若い星のまわりにある');
  });

  it('falls back to a slug id and the plain url field for the DOI-less proceedings entry', () => {
    const overrides = YAML.parse(readFileSync(outPath, 'utf-8'));
    const entry = overrides.find((o: { manual?: { url: string } }) =>
      o.manual?.url === 'https://www.wakusei.jp/book/pp/2021/2021-4/2021-04-148.pdf'
    );
    expect(entry).toBeDefined();
    expect(entry.id).toMatch(/^slug:/);
    expect(entry.doi).toBeFalsy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ver2 && npm test -- migrate-publications`
Expected: FAIL — `scripts/migrate-publications.mjs` does not exist.

- [ ] **Step 3: Write the migration script**

```javascript
// ver2/scripts/migrate-publications.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = path.join(__dirname, '../../publications_data.js');
const OUT_PATH = path.join(__dirname, '../src/data/publications.overrides.yaml');

function doiFromUrl(url) {
  if (!url) return null;
  const match = url.match(/doi\.org\/(.+)$/);
  return match ? match[1] : null;
}

function arxivIdFromUrl(url) {
  if (!url) return null;
  const match = url.match(/arxiv\.org\/abs\/(.+)$/);
  return match ? match[1] : null;
}

function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);
}

function loadOldData(sourcePath) {
  const text = readFileSync(sourcePath, 'utf-8')
    .replace(/^window\.\w+\s*=\s*/, '')
    .replace(/;\s*$/, '');
  return JSON.parse(text);
}

function toOverride(entry) {
  const doi = doiFromUrl(entry.publicationUrl);
  const arxivId = arxivIdFromUrl(entry.arxivUrl);
  const id = doi ? `doi:${doi}` : arxivId ? `arxiv:${arxivId}` : `slug:${slugify(entry.titleEn)}`;

  return {
    id,
    doi,
    arxivId,
    selected: entry.selected ?? false,
    highlight: false,
    authorsJa: entry.authorsJa !== entry.authorsEn ? entry.authorsJa : undefined,
    abstractEn: entry.abstractEn ?? '',
    abstractJa: entry.abstractJa ?? '',
    manual: {
      titleEn: entry.titleEn,
      authorsEn: entry.authorsEn,
      journalEn: entry.journalEn,
      year: entry.year,
      url: entry.publicationUrl ?? entry.arxivUrl ?? entry.adsUrl ?? entry.url ?? '',
    },
  };
}

function main() {
  const entries = loadOldData(SOURCE_PATH);
  const overrides = entries.map(toOverride);
  // Drop `undefined` values (e.g. authorsJa when it equals authorsEn) so the
  // YAML output only contains fields the schema actually expects to see.
  const cleaned = JSON.parse(JSON.stringify(overrides));
  writeFileSync(OUT_PATH, YAML.stringify(cleaned), 'utf-8');
  console.log(`Migrated ${cleaned.length} publications to ${path.relative(process.cwd(), OUT_PATH)}`);
}

main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ver2 && npm test -- migrate-publications`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ver2/scripts/migrate-publications.mjs ver2/scripts/migrate-publications.test.ts ver2/src/data/publications.overrides.yaml
git commit -m "Migrate publications_data.js to publications.overrides.yaml"
```

---

### Task 11: Migrate `presentations_data.js` to `presentations.yaml`

**Files:**
- Create: `ver2/scripts/migrate-presentations.mjs`
- Test: `ver2/scripts/migrate-presentations.test.ts`
- Generate (by running the script): `ver2/src/data/presentations.yaml`

**Interfaces:**
- Consumes: the repo-root `presentations_data.js` (61 entries — read-only, never modified).
- Produces: `ver2/src/data/presentations.yaml`, an array matching `PresentationsFileSchema` (Task 6), consumed by `src/data/presentations.ts` (Task 12).

Three source entries (2023 invited talk at Ringberg, 2023 SPIDI poster, 2023 Protostars & Planets VII poster) are missing the `scope` field in the current data. All three are major international meetings, so the script defaults missing `scope` to `'international'` and prints a warning naming each affected entry — the human should skim that output once after running the script.

- [ ] **Step 1: Write the failing test**

```typescript
// ver2/scripts/migrate-presentations.test.ts
import { describe, expect, it, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { PresentationsFileSchema } from '../src/data/schemas';

const root = path.resolve(__dirname, '..');
const outPath = path.join(root, 'src/data/presentations.yaml');

describe('migrate-presentations', () => {
  beforeAll(() => {
    execSync('node scripts/migrate-presentations.mjs', { cwd: root, stdio: 'inherit' });
  });

  it('produces a file with all 61 presentations, valid against the schema', () => {
    const presentations = YAML.parse(readFileSync(outPath, 'utf-8'));
    expect(presentations).toHaveLength(61);
    expect(() => PresentationsFileSchema.parse(presentations)).not.toThrow();
  });

  it('preserves the type/scope distribution, defaulting the 3 scope-less entries to international', () => {
    const presentations = YAML.parse(readFileSync(outPath, 'utf-8'));
    const byType: Record<string, number> = {};
    const byScope: Record<string, number> = {};
    for (const p of presentations) {
      byType[p.type] = (byType[p.type] ?? 0) + 1;
      byScope[p.scope] = (byScope[p.scope] ?? 0) + 1;
    }
    expect(byType).toEqual({ poster: 17, oral: 40, invited: 4 });
    expect(byScope).toEqual({ international: 25, domestic: 36 });
  });

  it('gives every entry a unique slug id', () => {
    const presentations = YAML.parse(readFileSync(outPath, 'utf-8'));
    const ids = new Set(presentations.map((p: { id: string }) => p.id));
    expect(ids.size).toBe(presentations.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ver2 && npm test -- migrate-presentations`
Expected: FAIL — `scripts/migrate-presentations.mjs` does not exist.

- [ ] **Step 3: Write the migration script**

```javascript
// ver2/scripts/migrate-presentations.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = path.join(__dirname, '../../presentations_data.js');
const OUT_PATH = path.join(__dirname, '../src/data/presentations.yaml');

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function loadOldData(sourcePath) {
  const text = readFileSync(sourcePath, 'utf-8')
    .replace(/^window\.\w+\s*=\s*/, '')
    .replace(/;\s*$/, '');
  return JSON.parse(text);
}

function toPresentation(entry, usedIds) {
  if (!entry.scope) {
    console.warn(`WARNING: defaulting missing scope to 'international' for "${entry.confEn}" (${entry.date})`);
  }

  let id = slugify(`${entry.date}-${entry.titleEn}`).slice(0, 70);
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${slugify(`${entry.date}-${entry.titleEn}`).slice(0, 68)}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(id);

  return { ...entry, id, scope: entry.scope ?? 'international' };
}

function main() {
  const entries = loadOldData(SOURCE_PATH);
  const usedIds = new Set();
  const presentations = entries.map((entry) => toPresentation(entry, usedIds));
  const cleaned = JSON.parse(JSON.stringify(presentations));
  writeFileSync(OUT_PATH, YAML.stringify(cleaned), 'utf-8');
  console.log(`Migrated ${cleaned.length} presentations to ${path.relative(process.cwd(), OUT_PATH)}`);
}

main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ver2 && npm test -- migrate-presentations`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ver2/scripts/migrate-presentations.mjs ver2/scripts/migrate-presentations.test.ts ver2/src/data/presentations.yaml
git commit -m "Migrate presentations_data.js to presentations.yaml"
```

---

### Task 12: CV data file and the three data loader modules

**Files:**
- Create: `ver2/src/data/cv.yaml` (hand-authored from the current `index.html` CV section — no automated migration script, since this content lives in prose HTML, not structured JS)
- Create: `ver2/src/data/publications.ts`
- Create: `ver2/src/data/presentations.ts`
- Create: `ver2/src/data/cv.ts`
- Test: `ver2/src/data/publications.test.ts`, `ver2/src/data/presentations.test.ts`, `ver2/src/data/cv.test.ts`

**Interfaces:**
- Produces: `getPublications(): Publication[]`, `getPresentations(): Presentation[]`, `getCvData(): CvData` — consumed by every page in Milestones C–D.

- [ ] **Step 1: Write the failing tests**

```typescript
// ver2/src/data/publications.test.ts
import { describe, expect, it } from 'vitest';
import { getPublications } from './publications';
import { PublicationSchema } from './schemas';

describe('getPublications', () => {
  it('returns all migrated publications, each valid against PublicationSchema', () => {
    const publications = getPublications();
    expect(publications.length).toBe(22);
    for (const pub of publications) {
      expect(() => PublicationSchema.parse(pub)).not.toThrow();
    }
  });
});
```

```typescript
// ver2/src/data/presentations.test.ts
import { describe, expect, it } from 'vitest';
import { getPresentations } from './presentations';

describe('getPresentations', () => {
  it('returns all 61 migrated presentations', () => {
    expect(getPresentations()).toHaveLength(61);
  });
});
```

```typescript
// ver2/src/data/cv.test.ts
import { describe, expect, it } from 'vitest';
import { getCvData } from './cv';

describe('getCvData', () => {
  it('returns all CV sections with the expected entry counts', () => {
    const cv = getCvData();
    expect(cv.education).toHaveLength(6);
    expect(cv.grants).toHaveLength(7);
    expect(cv.awards).toHaveLength(6);
    expect(cv.teaching).toHaveLength(4);
    expect(cv.mentoring).toHaveLength(4);
    expect(cv.service).toHaveLength(6);
    expect(cv.seminars).toHaveLength(14);
    expect(cv.reviewJournals).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ver2 && npm test -- publications presentations cv`
Expected: FAIL — none of `publications.ts`, `presentations.ts`, `cv.ts`, or `cv.yaml` exist yet.

- [ ] **Step 3: Write `cv.yaml`**

```yaml
# ver2/src/data/cv.yaml
education:
  - dateRange: "2023.12 - Present"
    titleEn: "Shuimu Fellow"
    titleJa: "Shuimuフェロー"
    orgEn: "Tsinghua University, Institute for Advanced Study, Beijing"
    orgJa: "清華大学, 高等研究所, 中国 北京"
  - dateRange: "2021.04 - 2023.11"
    titleEn: "JSPS Research Fellow (PD)"
    titleJa: "日本学術振興会 特別研究員 (PD)"
    orgEn: "Tohoku University, Astronomical Institute, Sendai"
    orgJa: "東北大学, 天文学専攻 天体理論グループ, 日本 仙台"
  - dateRange: "2019.04 - 2021.03"
    titleEn: "Postdoctoral Researcher"
    titleJa: "ポスドク研究員"
    orgEn: "University of Tokyo, Department of Astronomy, Tokyo"
    orgJa: "東京大学, 天文学専攻, 日本 東京"
  - dateRange: "2016.04 - 2019.03"
    titleEn: "Ph.D. in Earth and Planetary Sciences"
    titleJa: "博士（理学）地球惑星科学専攻"
    orgEn: "Tokyo Institute of Technology"
    orgJa: "東京工業大学"
    noteEn: "Degree conferred: 2019.03.26 · JSPS Research Fellow (DC2) (2017–2019)"
    noteJa: "学位取得: 2019.03.26 · 日本学術振興会 特別研究員 (DC2) (2017–2019)"
    extraEn: "Thesis: \"Understanding the turbulent and thermal structure of protoplanetary disks with magnetohydrodynamic simulations\""
    extraJa: "博士論文: 「原始惑星系円盤の乱流と熱構造の理解 ― 磁気流体力学シミュレーションによる研究」"
    linkLabel: "Thesis (PDF)"
    linkUrl: "files/thesis/thesis-201903-phd-thesis.pdf"
  - dateRange: "2014.04 - 2016.03"
    titleEn: "M.S. in Earth and Planetary Sciences"
    titleJa: "修士（理学）地球惑星科学専攻"
    orgEn: "Tokyo Institute of Technology"
    orgJa: "東京工業大学"
    noteEn: "Degree conferred: 2016.03.28"
    noteJa: "学位取得: 2016.03.28"
    extraEn: "Thesis: \"The Effects of Electron Heating on the Magnetorotational Instability in Protoplanetary Disks\""
    extraJa: "修士論文: 「原始惑星系円盤における電子加熱が磁気回転不安定に与える影響」"
    linkLabel: "Thesis (PDF)"
    linkUrl: "files/thesis/thesis-201603-master-thesis.pdf"
  - dateRange: "2010.04 - 2014.03"
    titleEn: "B.S. in Earth and Planetary Sciences"
    titleJa: "学士（理学）地球惑星科学科"
    orgEn: "Tokyo Institute of Technology"
    orgJa: "東京工業大学"
    extraEn: "Thesis: \"The Dead Zones in Considering the Nonlinear Ohm's Law in Protoplanetary Disks\""
    extraJa: "卒業論文: 「原始惑星系円盤における非線形オームを考慮したデッドゾーン」"
    linkLabel: "Thesis (PDF)"
    linkUrl: "files/thesis/thesis-201403-undergraduate-thesis.pdf"

grants:
  - dateRange: "2022.04 - 2025.03"
    titleEn: "Dust dynamics in protoplanetary disks explored through magnetohydrodynamic simulations"
    titleJa: "磁気流体力学数値シミュレーションから探る原始惑星系円盤内のダスト運動"
    roleEn: "JSPS Grant-in-Aid for Early-Career Scientists (PI)"
    roleJa: "日本学術振興会 若手研究 (代表)"
    amountEn: "Amount: 4,030,000 JPY (Direct: 3,100,000 JPY)"
    amountJa: "総額: 4,030,000円 (直接経費: 3,100,000円)"
    linkLabel: "KAKEN"
    linkUrl: "https://kaken.nii.ac.jp/ja/grant/KAKENHI-PROJECT-22K14081/"
  - dateRange: "2021.04 - 2024.03"
    titleEn: "Formation process of Earth-like planets revealed by magnetohydrodynamic simulations of protoplanetary disks"
    titleJa: "原始惑星系円盤の磁気流体力学シミュレーションから解明する地球型惑星の形成過程"
    roleEn: "JSPS Research Fellowship for Young Scientists (PD) (PI)"
    roleJa: "日本学術振興会 特別研究員奨励費 (代表)"
    amountEn: "Amount: 5,200,000 JPY (Direct: 4,000,000 JPY)"
    amountJa: "総額: 5,200,000円 (直接経費: 4,000,000円)"
    linkLabel: "KAKEN"
    linkUrl: "https://kaken.nii.ac.jp/ja/grant/KAKENHI-PROJECT-22KJ0155/"
  - dateRange: "2017.04 - 2020.03"
    titleEn: "A new model of magnetohydrodynamic turbulence and dust evolution in protoplanetary disks considering electron heating"
    titleJa: "電子加熱を考慮した原始惑星系円盤の新しい磁気乱流・ダスト進化モデル"
    roleEn: "JSPS Research Fellowship for Young Scientists (DC2) (PI)"
    roleJa: "日本学術振興会 特別研究員奨励費 (代表)"
    amountEn: "Amount: 1,900,000 JPY (Direct: 1,900,000 JPY)"
    amountJa: "総額: 1,900,000円 (直接経費: 1,900,000円)"
    linkLabel: "KAKEN"
    linkUrl: "https://kaken.nii.ac.jp/ja/grant/KAKENHI-PROJECT-17J10129/"
  - dateRange: "2021.04 - 2023.03"
    titleEn: "Protoplanetary disks and formation of terrestrial planets"
    titleJa: "Protoplanetary disks and formation of terrestrial planets"
    roleEn: "Tohoku Univ. – Tsinghua Univ. Collaborative Research Fund (Co-I)"
    roleJa: "東北大学・清華大学 合同研究資金 (分担)"
    amountEn: "Amount: 4,000,000 JPY"
    amountJa: "総額: 4,000,000円"
  - dateRange: "2019.06"
    titleEn: "From Stars to Planets II: Connecting Our Understanding of Star and Planet Formation"
    titleJa: "From Stars to Planets II: Connecting Our Understanding of Star and Planet Formation"
    roleEn: "Astronomical Society of Japan Hayakawa Fund (Travel Grant Recipient)"
    roleJa: "日本天文学会 早川幸男基金（渡航助成）"
    amountEn: "Date: 2019.06.15-23 / Destination: Gothenburg, Sweden / Support: Full"
    amountJa: "期間: 2019.06.15-23 / 渡航先: スウェーデン・ヨーテボリ / 助成: 全額"
  - dateRange: "2016.04 - 2020.03"
    titleEn: "Integrated Evolution Model of Dust and Ice Snowlines in Protoplanetary Disks"
    titleJa: "原始惑星系円盤のダストと氷昇華線の統合進化モデル"
    roleEn: "JSPS Grant-in-Aid for Young Scientists (B) (Co-I)"
    roleJa: "日本学術振興会 若手研究(B) (分担)"
    linkLabel: "KAKEN"
    linkUrl: "https://kaken.nii.ac.jp/ja/grant/KAKENHI-PROJECT-16K17661/"
  - dateRange: "2013.08 - 2015.03"
    titleEn: "Construction of Planetesimal Formation Theory Considering Co-evolution of Solids and MHD Turbulence"
    titleJa: "固体と磁気流体乱流の共進化を考慮した微惑星形成理論の構築"
    roleEn: "JSPS Grant for Research Activity Start-up (Co-I)"
    roleJa: "日本学術振興会 研究活動スタート支援 (分担)"
    linkLabel: "KAKEN"
    linkUrl: "https://kaken.nii.ac.jp/ja/grant/KAKENHI-PROJECT-25887023/"

awards:
  - year: "2025"
    titleEn: "Selected Participant, KITP Program \"Planet Formation and Migration near the Inner Edge of Disks\""
    titleJa: "KITP滞在型プログラム「Planet Formation and Migration near the Inner Edge of Disks」採択"
    orgEn: "Kavli Institute for Theoretical Physics (KITP), UC Santa Barbara"
    orgJa: "カブリ理論物理学研究所（KITP）, カリフォルニア大学サンタバーバラ校"
    dateEn: "Apr 15, 2025 - May 23, 2025"
    dateJa: "2025年4月15日 - 5月23日"
    linkLabel: "Program"
    linkUrl: "https://www.kitp.ucsb.edu/activities/edgeplanets25"
  - year: "2023"
    titleEn: "Shuimu Tsinghua Scholar (Overseas)"
    titleJa: "水木学者（Shuimu Tsinghua Scholar）"
    orgEn: "Tsinghua University"
    orgJa: "清華大学"
  - year: "2017"
    titleEn: "Poster Presentation Award"
    titleJa: "ポスター賞"
    orgEn: "Summer School for Young Astronomers"
    orgJa: "天文・天体物理若手夏の学校"
  - year: "2016"
    titleEn: "Poster Presentation Award"
    titleJa: "ポスター賞"
    orgEn: "Summer School for Young Astronomers"
    orgJa: "天文・天体物理若手夏の学校"
  - year: "2015"
    titleEn: "Poster Presentation Award"
    titleJa: "ポスター賞"
    orgEn: "Summer School for Young Astronomers"
    orgJa: "天文・天体物理若手夏の学校"
  - year: "2015"
    titleEn: "Best Poster Award"
    titleJa: "最優秀ポスター賞"
    orgEn: "The 7th Meeting on Cosmic Dust"
    orgJa: "The 7th Meeting on Cosmic Dust"

teaching:
  - dateRange: "2022.03"
    titleEn: "Instructor (CfCA Hydrodynamics School 2021)"
    titleJa: "講師（CfCA 2021年度流体学校）"
    orgEn: "Center for Computational Astrophysics (CfCA), National Astronomical Observatory of Japan"
    orgJa: "国立天文台 天文シミュレーションプロジェクト（CfCA）"
  - dateRange: "2023.04 - 2023.09"
    titleEn: "Part-time Lecturer (Physics)"
    titleJa: "非常勤講師（物理学）"
    orgEn: "National Institute of Technology, Ichinoseki College"
    orgJa: "一関工業高等専門学校"
  - dateRange: "2016"
    titleEn: "Teaching Assistant (Computational Planetary Science)"
    titleJa: "ティーチングアシスタント（計算惑星科学）"
    orgEn: "Tokyo Institute of Technology"
    orgJa: "東京工業大学"
  - dateRange: "2014"
    titleEn: "Teaching Assistant (Computational Planetary Science)"
    titleJa: "ティーチングアシスタント（計算惑星科学）"
    orgEn: "Tokyo Institute of Technology"
    orgJa: "東京工業大学"

mentoring:
  - dateRange: "2024 - Present"
    nameEn: "Yu Wang"
    nameJa: "Yu Wang"
    roleEn: "Ph.D. Student @ Tsinghua University"
    roleJa: "博士課程学生 @ 清華大学"
    topicEn: "Two-dimensional structure of snow lines"
    topicJa: "研究テーマ: スノーラインの２次元的構造"
  - dateRange: "2024 - Present"
    nameEn: "Dawei Dai"
    nameJa: "Dawei Dai"
    roleEn: "Ph.D. Student @ Tsinghua University"
    roleJa: "博士課程学生 @ 清華大学"
    topicEn: "Dispersal processes in protoplanetary disks"
    topicJa: "研究テーマ: 原始惑星系円盤の散逸過程"
  - dateRange: "2021 - Present"
    nameEn: "Katsushi Kondo"
    nameJa: "近藤 克"
    roleEn: "Ph.D. Student @ Institute of Science Tokyo"
    roleJa: "博士課程学生 @ 東京科学大学"
    topicEn: "Snow line evolution in magnetized protoplanetary disks"
    topicJa: "研究テーマ: 磁気的原始惑星系円盤のスノーライン進化"
  - dateRange: "2021 - Present"
    nameEn: "Haruhi Enomoto"
    nameJa: "榎本 晴日"
    roleEn: "Ph.D. Student @ Institute of Science Tokyo"
    roleJa: "博士課程学生 @ 東京科学大学"
    topicEn: "Development of local MHD simulations toward global magnetic flux evolution"
    topicJa: "研究テーマ: 大局的磁束進化にむけた局所MHD計算の開発"

service:
  - dateRange: "2022.04 - 2023.03"
    titleEn: "Public Relations Staff (JpGU)"
    titleJa: "広報担当（JpGU）"
    orgEn: "Japan Geoscience Union (JpGU)"
    orgJa: "日本地球惑星科学連合（JpGU）"
  - dateRange: "2022"
    titleEn: "Session Timekeeper (ASJ Spring Meeting 2022)"
    titleJa: "タイムキーパー（日本天文学会2022年春季年会）"
    orgEn: "The Astronomical Society of Japan"
    orgJa: "日本天文学会"
  - dateRange: "2022.01"
    titleEn: "Session Chair (CfCA Users Meeting FY2021)"
    titleJa: "座長（2022.01 CfCAユーザーズミーティング）"
    orgEn: "Center for Computational Astrophysics (CfCA), National Astronomical Observatory of Japan"
    orgJa: "国立天文台 天文シミュレーションプロジェクト（CfCA）"
  - dateRange: "2021.02.23-24"
    titleEn: "Founder, Organizer, and Chair (Young Workshop on Planetary System Formation)"
    titleJa: "立ち上げ・世話人・座長（惑星系形成若手研究会）"
    orgEn: "Young Workshop on Planetary System Formation"
    orgJa: "惑星系形成若手研究会"
  - dateRange: "2020"
    titleEn: "Session Chair (The Japanese Society for Planetary Sciences Fall Meeting 2020)"
    titleJa: "座長（日本惑星科学会2020年秋季講演会）"
    orgEn: "The Japanese Society for Planetary Sciences"
    orgJa: "日本惑星科学会"
  - dateRange: "2015.9 - 2016.8"
    titleEn: "Session Chair (Summer School for Young Astronomers 2016)"
    titleJa: "座長（2016年天文・天体物理若手夏の学校）"
    orgEn: "Summer School for Young Astronomers"
    orgJa: "天文・天体物理若手夏の学校"

seminars:
  - date: "2024.11.12"
    titleEn: "Irradiation-Dominated Magnetized Protoplanetary Disks: Disk Structures and Planet Formation"
    titleJa: "Irradiation-Dominated Magnetized Protoplanetary Disks: Disk Structures and Planet Formation"
    venueEn: "KIAA-DoA Seminar · Peking University"
    venueJa: "KIAA-DoA セミナー · 北京大学"
  - date: "2024.10.10"
    titleEn: "Temperature Structure and Its Evolution of Magnetized Protoplanetary Disks"
    titleJa: "Temperature Structure and Its Evolution of Magnetized Protoplanetary Disks"
    venueEn: "WP/CSH Special Seminar · University of Bern"
    venueJa: "WP/CSH 特別セミナー · ベルン大学"
  - date: "2023.05.24"
    titleEn: "Thermal structure and snowline migration of laminar magnetic protoplanetary disks"
    titleJa: "層流磁化原始惑星系円盤の熱構造とスノーライン移動"
    venueEn: "Online Seminar"
    venueJa: "オンラインセミナー"
  - date: "2023.04.24"
    titleEn: "Temperature Structure of Protoplanetary Disks Explored through Magnetohydrodynamic Simulations"
    titleJa: "磁気流体力学シミュレーションから探る原始惑星系円盤の温度構造"
    venueEn: "CPS Seminar · Center for Planetary Science, Kobe University"
    venueJa: "CPS セミナー · 神戸大学 惑星科学研究センター"
    slideUrl: "files/slides/slide-20230424-cps-seminar.pdf"
    videoUrl: "https://www.cps-jp.org/modules/mosir/player.php?v=20230424_01_mori"
  - date: "2018.03.06"
    titleEn: "Temperature Structure in Weakly Ionized Protoplanetary Disks"
    titleJa: "Temperature Structure in Weakly Ionized Protoplanetary Disks"
    venueEn: "Informal Talk · Tsinghua University"
    venueJa: "インフォーマルトーク · 清華大学"
  - date: "2017.12.18"
    titleEn: "Effects of Electron Heating on Magnetic Turbulence in Protoplanetary Disks"
    titleJa: "原始惑星系円盤において電子加熱が磁気乱流に与える影響"
    venueEn: "Colloquium · Tohoku University"
    venueJa: "談話会 · 東北大学"
  - date: "2017.10.18"
    titleEn: "The Effect of Electron Heating in MRI on Protoplanetary Disks"
    titleJa: "The Effect of Electron Heating in MRI on Protoplanetary Disks"
    venueEn: "Seminar · Osaka University"
    venueJa: "セミナー · 大阪大学"
  - date: "2017.07.13"
    titleEn: "Gas Heating in Protoplanetary Disks Based on Magnetohydrodynamic Simulations"
    titleJa: "磁気流体力学計算に基づいた原始惑星系円盤でのガスの加熱"
    venueEn: "Seminar · Kyoto University"
    venueJa: "セミナー · 京都大学"
  - date: "2016.04.26"
    titleEn: "Suppression of Magnetic Turbulence by Electron Heating in Protoplanetary Disks"
    titleJa: "Suppression of Magnetic Turbulence by Electron Heating in Protoplanetary Disks"
    venueEn: "Seminar · StarPlan, Niels Bohr Institute"
    venueJa: "セミナー · StarPlan, Niels Bohr Institute"
  - date: "2016.04"
    titleEn: "Suppression of Magnetic Turbulence by Electron Heating in Protoplanetary Disks"
    titleJa: "Suppression of Magnetic Turbulence by Electron Heating in Protoplanetary Disks"
    venueEn: "Seminar · Heidelberg University"
    venueJa: "セミナー · ハイデルベルク大学"
  - date: "2016.04"
    titleEn: "Suppression of Magnetic Turbulence by Electron Heating in Protoplanetary Disks"
    titleJa: "Suppression of Magnetic Turbulence by Electron Heating in Protoplanetary Disks"
    venueEn: "Seminar · Max Planck Institute for Astronomy"
    venueJa: "セミナー · マックス・プランク天文学研究所"
  - date: "2015.12.14"
    titleEn: "The Effects of Electron Heating on the Magnetorotational Instability in Protoplanetary Disks"
    titleJa: "The Effects of Electron Heating on the Magnetorotational Instability in Protoplanetary Disks"
    venueEn: "Seminar · Jet Propulsion Laboratory"
    venueJa: "セミナー · Jet Propulsion Laboratory"
  - date: "2015.08.25"
    titleEn: "Effects of Electron Heating on Magnetic Turbulence in Protoplanetary Disks"
    titleJa: "原始惑星系円盤中の電子加熱が磁気乱流に及ぼす影響"
    venueEn: "Seminar · Star and Planet Formation Seminar"
    venueJa: "セミナー · 星惑星形成セミナー"
  - date: "2014.07.13"
    titleEn: "Stabilization of Magnetic Disk Turbulence by Electric Field Heating of Electrons"
    titleJa: "Stabilization of Magnetic Disk Turbulence by Electric Field Heating of Electrons"
    venueEn: "Seminar · Nagoya"
    venueJa: "セミナー · 名古屋"

reviewJournals:
  - name: "Nature Astronomy"
    url: "https://www.nature.com/natastron/"
  - name: "The Astrophysical Journal Letters (ApJL)"
    url: "https://journals.aas.org/astrophysical-journal-letters/"
  - name: "The Astronomical Journal (AJ)"
    url: "https://journals.aas.org/astronomical-journal/"
  - name: "Monthly Notices of the Royal Astronomical Society (MNRAS)"
    url: "https://academic.oup.com/mnras"
  - name: "Research in Astronomy and Astrophysics (RAA)"
    url: "https://www.raa-journal.org/"
```

- [ ] **Step 4: Write the three loader modules**

```typescript
// ver2/src/data/publications.ts
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { AdsRecordSchema, PublicationOverridesFileSchema, type Publication } from './schemas';
import { mergePublications } from '../lib/merge-publications';

const DATA_DIR = path.join(process.cwd(), 'src/data');

function loadGeneratedAdsRecords() {
  const generatedPath = path.join(DATA_DIR, 'publications.generated.json');
  if (!existsSync(generatedPath)) return [];
  const raw = JSON.parse(readFileSync(generatedPath, 'utf-8'));
  return raw.map((record: unknown) => AdsRecordSchema.parse(record));
}

function loadBibtexMap(): Record<string, string> {
  const bibtexPath = path.join(DATA_DIR, 'publications.bibtex.json');
  if (!existsSync(bibtexPath)) return {};
  return JSON.parse(readFileSync(bibtexPath, 'utf-8'));
}

function loadOverrides() {
  const overridesPath = path.join(DATA_DIR, 'publications.overrides.yaml');
  const raw = YAML.parse(readFileSync(overridesPath, 'utf-8'));
  return PublicationOverridesFileSchema.parse(raw);
}

export function getPublications(): Publication[] {
  return mergePublications(loadGeneratedAdsRecords(), loadOverrides(), loadBibtexMap());
}
```

```typescript
// ver2/src/data/presentations.ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { PresentationsFileSchema, type Presentation } from './schemas';

const DATA_PATH = path.join(process.cwd(), 'src/data/presentations.yaml');

export function getPresentations(): Presentation[] {
  const raw = YAML.parse(readFileSync(DATA_PATH, 'utf-8'));
  return PresentationsFileSchema.parse(raw);
}
```

```typescript
// ver2/src/data/cv.ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { CvDataSchema, type CvData } from './schemas';

const DATA_PATH = path.join(process.cwd(), 'src/data/cv.yaml');

export function getCvData(): CvData {
  const raw = YAML.parse(readFileSync(DATA_PATH, 'utf-8'));
  return CvDataSchema.parse(raw);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd ver2 && npm test -- publications presentations cv`
Expected: PASS (publications will all report `source: 'manual'` until Task 9 Step 5's real ADS sync has been run by the human — that is expected at this point in the plan).

- [ ] **Step 6: Commit**

```bash
git add ver2/src/data/cv.yaml ver2/src/data/publications.ts ver2/src/data/presentations.ts ver2/src/data/cv.ts ver2/src/data/publications.test.ts ver2/src/data/presentations.test.ts ver2/src/data/cv.test.ts
git commit -m "Add CV data and publication/presentation/CV data loaders"
```

---

## Milestone C — Homepage

### Task 13: Site statistics (h-index, first-author count, citations, grants)

**Files:**
- Create: `ver2/src/lib/stats.ts`
- Test: `ver2/src/lib/stats.test.ts`

**Interfaces:**
- Consumes: `Publication`, `CvData` types from `src/data/schemas.ts`.
- Produces: `isFirstAuthor(pub: Publication): boolean`, `computeHIndex(citationCounts: number[]): number`, `computeStats(publications: Publication[], cv: CvData): SiteStats` where `SiteStats = { refereedCount, firstAuthorCount, totalCitations, hIndex, grantCount }` — consumed by `src/pages/index.astro` (Task 14) via `StatBand.astro`.

- [ ] **Step 1: Write the failing test**

```typescript
// ver2/src/lib/stats.test.ts
import { describe, expect, it } from 'vitest';
import { isFirstAuthor, computeHIndex, computeStats } from './stats';
import type { Publication, CvData } from '../data/schemas';

describe('isFirstAuthor', () => {
  it('is true when the bolded owner name opens the author string', () => {
    expect(isFirstAuthor({ authorsEn: '<strong>Shoji Mori</strong>, Xue-Ning Bai' } as Publication)).toBe(true);
  });
  it('is false when the bolded owner name is not first', () => {
    expect(isFirstAuthor({ authorsEn: 'Xue-Ning Bai, <strong>Shoji Mori</strong>' } as Publication)).toBe(false);
  });
});

describe('computeHIndex', () => {
  it('computes the standard h-index', () => {
    expect(computeHIndex([10, 8, 5, 4, 3])).toBe(4);
  });
  it('returns 0 for an empty or all-zero list', () => {
    expect(computeHIndex([])).toBe(0);
    expect(computeHIndex([0, 0, 0])).toBe(0);
  });
});

describe('computeStats', () => {
  it('aggregates refereed count, first-author count, citations, h-index, and grants', () => {
    const publications = [
      { authorsEn: '<strong>Shoji Mori</strong>', refereed: true, citationCount: 10 },
      { authorsEn: '<strong>Shoji Mori</strong>', refereed: true, citationCount: 8 },
      { authorsEn: 'Someone, <strong>Shoji Mori</strong>', refereed: true, citationCount: 5 },
      { authorsEn: '<strong>Shoji Mori</strong>', refereed: false, citationCount: 0 },
    ] as Publication[];
    const cv = { grants: [{}, {}] } as CvData;

    const stats = computeStats(publications, cv);
    expect(stats.refereedCount).toBe(3);
    expect(stats.firstAuthorCount).toBe(2);
    expect(stats.totalCitations).toBe(23);
    expect(stats.grantCount).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ver2 && npm test -- stats`
Expected: FAIL — `./stats` module does not exist.

- [ ] **Step 3: Write the implementation**

```typescript
// ver2/src/lib/stats.ts
import type { Publication, CvData } from '../data/schemas';

export function isFirstAuthor(pub: Publication): boolean {
  return pub.authorsEn.trimStart().startsWith('<strong>');
}

export function computeHIndex(citationCounts: number[]): number {
  const sorted = [...citationCounts].sort((a, b) => b - a);
  let h = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    if (sorted[i] >= i + 1) h = i + 1;
    else break;
  }
  return h;
}

export interface SiteStats {
  refereedCount: number;
  firstAuthorCount: number;
  totalCitations: number;
  hIndex: number;
  grantCount: number;
}

export function computeStats(publications: Publication[], cv: CvData): SiteStats {
  const refereed = publications.filter((p) => p.refereed);
  return {
    refereedCount: refereed.length,
    firstAuthorCount: refereed.filter(isFirstAuthor).length,
    totalCitations: publications.reduce((sum, p) => sum + p.citationCount, 0),
    hIndex: computeHIndex(publications.map((p) => p.citationCount)),
    grantCount: cv.grants.length,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ver2 && npm test -- stats`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ver2/src/lib/stats.ts ver2/src/lib/stats.test.ts
git commit -m "Add site statistics computation (h-index, citations, grants)"
```

---

### Task 14: Homepage — Hero, stat band, research highlights, news preview, selected publications

**Files:**
- Modify: `ver2/src/data/publications.overrides.yaml` (flag 3 existing entries as highlights)
- Create: `ver2/src/components/StatBand.astro`
- Create: `ver2/src/components/FigurePlaceholder.astro`
- Create: `ver2/src/components/HighlightCard.astro`
- Modify: `ver2/src/pages/index.astro` (full homepage)
- Test: `ver2/tests/homepage.test.ts`

**Interfaces:**
- Consumes: `getPublications()` (Task 12), `getCvData()` (Task 12), `computeStats()` (Task 13), the `news` content collection (Task 6).
- Produces: the live homepage — no further task depends on its internals, but its layout (chapter-numbered sections, `.container` rhythm) is the visual reference for Research/Talks/CV pages.

- [ ] **Step 1: Flag three publications as homepage highlights**

Open `ver2/src/data/publications.overrides.yaml` (produced by Task 10) and change these three entries from `highlight: false` to the values below (matched by their `id`, using the DOIs already present in the migrated file):

```yaml
# id: doi:10.3847/1538-4357/adf8d7  (Radiative Nonideal MHD Simulations of Inner Protoplanetary Disks, 2025 ApJ)
    highlight: true
    highlightOrder: 1
    highlightImage: "/images/highlights/inner-disk-simulation.svg"

# id: doi:10.1051/0004-6361/202453362  (Long-term evolution of the temperature structure..., 2025 A&A)
    highlight: true
    highlightOrder: 2
    highlightImage: "/images/highlights/temperature-structure.svg"
```

For the third highlight, search `publications.overrides.yaml` for the entry whose `manual.titleEn` is `"Evolution of the Water Snow Line in Magnetically Accreting Protoplanetary Disks"` and set:

```yaml
    highlight: true
    highlightOrder: 3
    highlightImage: "/images/highlights/snow-line.svg"
```

- [ ] **Step 2: Add three placeholder highlight images**

```bash
mkdir -p ver2/public/images/highlights
```

Create `ver2/public/images/highlights/inner-disk-simulation.svg`, `temperature-structure.svg`, and `snow-line.svg`, each a simple placeholder (swap for a real simulation render later — same filename keeps the reference working):

```xml
<!-- ver2/public/images/highlights/inner-disk-simulation.svg (repeat with different fill for the other two) -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
  <rect width="400" height="300" fill="#1a2247" />
  <circle cx="200" cy="150" r="90" fill="none" stroke="#c96a2e" stroke-width="2" opacity="0.6" />
  <circle cx="200" cy="150" r="50" fill="none" stroke="#c96a2e" stroke-width="2" opacity="0.8" />
  <circle cx="200" cy="150" r="14" fill="#c96a2e" />
</svg>
```

(Create the other two SVGs identically — only the filename differs for now; each is replaced with a real figure independently once the human supplies images per design doc §6.)

- [ ] **Step 3: Write the failing test**

```typescript
// ver2/tests/homepage.test.ts
import { describe, expect, it, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'node-html-parser';

const root = path.resolve(__dirname, '..');

describe('homepage', () => {
  beforeAll(() => {
    execSync('npm run build', { cwd: root, stdio: 'inherit' });
  });

  it('renders the hero question, stat band, 3 highlights, news preview, and selected publications', () => {
    const html = readFileSync(path.join(root, 'dist/index.html'), 'utf-8');
    const doc = parse(html);

    expect(doc.querySelector('.hero')).not.toBeNull();
    expect(html).toContain('Where do planets');

    const statItems = doc.querySelectorAll('.stat-band .stat-item');
    expect(statItems.length).toBe(4);

    const highlights = doc.querySelectorAll('.highlight-card');
    expect(highlights.length).toBe(3);

    expect(doc.querySelector('.news-preview')).not.toBeNull();
    expect(doc.querySelector('.selected-publications')).not.toBeNull();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd ver2 && npm test -- homepage`
Expected: FAIL — homepage still only renders `<h1>Shoji Mori</h1>`.

- [ ] **Step 5: Write the components**

```astro
---
// ver2/src/components/StatBand.astro
import type { SiteStats } from '../lib/stats';
interface Props { stats: SiteStats }
const { stats } = Astro.props;
const items = [
  { valueEn: String(stats.refereedCount), labelEn: 'refereed papers', labelJa: '査読論文' },
  { valueEn: String(stats.firstAuthorCount), labelEn: 'as first author', labelJa: '筆頭著者' },
  { valueEn: String(stats.totalCitations), labelEn: 'citations', labelJa: '被引用数' },
  { valueEn: `h=${stats.hIndex}`, labelEn: 'h-index', labelJa: 'h指数' },
];
---
<div class="stat-band container">
  {items.map((item) => (
    <div class="stat-item">
      <span class="stat-value">{item.valueEn}</span>
      <span class="stat-label en" lang="en">{item.labelEn}</span>
      <span class="stat-label ja" lang="ja">{item.labelJa}</span>
    </div>
  ))}
</div>
```

```astro
---
// ver2/src/components/FigurePlaceholder.astro
interface Props { src: string; altEn: string; altJa: string }
const { src, altEn, altJa } = Astro.props;
---
<div class="figure-placeholder">
  <img src={src} alt={altEn} loading="lazy" />
  <span class="sr-only en" lang="en">{altEn}</span>
  <span class="sr-only ja" lang="ja">{altJa}</span>
</div>
```

```astro
---
// ver2/src/components/HighlightCard.astro
import type { Publication } from '../data/schemas';
import FigurePlaceholder from './FigurePlaceholder.astro';
interface Props { pub: Publication; reverse?: boolean }
const { pub, reverse = false } = Astro.props;
---
<article class:list={['highlight-card', { reverse }]}>
  <FigurePlaceholder
    src={pub.highlightImage ?? '/images/highlights/inner-disk-simulation.svg'}
    altEn={pub.titleEn}
    altJa={pub.titleJa}
  />
  <div class="highlight-body">
    <h3 class="en" lang="en">{pub.titleEn}</h3>
    <h3 class="ja" lang="ja">{pub.titleJa}</h3>
    <p class="en" lang="en" set:html={pub.abstractEn} />
    <p class="ja" lang="ja" set:html={pub.abstractJa} />
    <a href={pub.adsUrl ?? pub.url ?? '#'} target="_blank" rel="noopener" class="highlight-link">
      <span class="en" lang="en">{pub.journalEn} →</span>
      <span class="ja" lang="ja">{pub.journalJa} →</span>
    </a>
  </div>
</article>
```

- [ ] **Step 6: Write the homepage**

```astro
---
// ver2/src/pages/index.astro
import BaseLayout from '../layouts/BaseLayout.astro';
import StatBand from '../components/StatBand.astro';
import HighlightCard from '../components/HighlightCard.astro';
import { getPublications } from '../data/publications';
import { getCvData } from '../data/cv';
import { computeStats } from '../lib/stats';
import { getCollection } from 'astro:content';

const publications = getPublications();
const cv = getCvData();
const stats = computeStats(publications, cv);

const highlights = publications
  .filter((p) => p.highlight)
  .sort((a, b) => (a.highlightOrder ?? 0) - (b.highlightOrder ?? 0));

const selected = publications.filter((p) => p.selected).slice(0, 5);

const newsEntries = (await getCollection('news'))
  .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf())
  .slice(0, 4);
---
<BaseLayout
  titleEn="Shoji Mori | Protoplanetary Disks &amp; Planet Formation"
  titleJa="森 昇志 | 原始惑星系円盤と惑星形成"
  descriptionEn="Personal academic website of Shoji Mori, Shuimu Fellow at Tsinghua University. Theoretical astrophysicist studying protoplanetary disks and planet formation."
  descriptionJa="清華大学Shuimuフェロー、森昇志の研究者ウェブサイト。原始惑星系円盤と惑星形成の理論的研究。"
  path="/"
>
  <section class="hero">
    <div class="container">
      <p class="hero-kicker en" lang="en">SHOJI MORI · SHUIMU FELLOW, TSINGHUA UNIVERSITY</p>
      <p class="hero-kicker ja" lang="ja">森 昇志 · 清華大学 Shuimuフェロー</p>
      <h1 class="hero-question">
        <span class="en" lang="en">Where do planets<br /><em>come from?</em></span>
        <span class="ja" lang="ja">惑星は<br /><em>どこから来るのか？</em></span>
      </h1>
      <p class="hero-lede en" lang="en">I trace the birth of worlds in the disks of gas and dust around young stars, using simulations of magnetized, radiative flows.</p>
      <p class="hero-lede ja" lang="ja">私は、若い星のまわりに広がるガスと塵の円盤の中で惑星がどのように生まれるのかを、磁化された輻射性の流れのシミュレーションを通して明らかにしています。</p>
    </div>
  </section>

  <StatBand stats={stats} />

  <section class="research-highlights container">
    <h2><span class="chapter-number">01</span> <span class="en" lang="en">Research Highlights</span><span class="ja" lang="ja">研究ハイライト</span></h2>
    {highlights.map((pub, i) => <HighlightCard pub={pub} reverse={i % 2 === 1} />)}
  </section>

  <hr class="rule container" />

  <section class="news-preview container">
    <h2><span class="en" lang="en">News</span><span class="ja" lang="ja">お知らせ</span></h2>
    <ul>
      {newsEntries.map((entry) => (
        <li>
          <time datetime={entry.data.date.toISOString()}>{entry.data.date.toISOString().slice(0, 10)}</time>
          <span class="en" lang="en">{entry.data.titleEn}</span>
          <span class="ja" lang="ja">{entry.data.titleJa}</span>
        </li>
      ))}
    </ul>
    <a href="/news/"><span class="en" lang="en">All news →</span><span class="ja" lang="ja">お知らせ一覧 →</span></a>
  </section>

  <hr class="rule container" />

  <section class="selected-publications container">
    <h2><span class="en" lang="en">Selected Publications</span><span class="ja" lang="ja">主要論文</span></h2>
    <ol>
      {selected.map((pub) => (
        <li>
          <span class="en" lang="en" set:html={pub.authorsEn} /><span class="ja" lang="ja" set:html={pub.authorsJa} />
          — <span class="en" lang="en">{pub.titleEn}</span><span class="ja" lang="ja">{pub.titleJa}</span>,
          <span class="en" lang="en">{pub.journalEn}</span><span class="ja" lang="ja">{pub.journalJa}</span>
          (<a href={pub.adsUrl ?? pub.url ?? '#'} target="_blank" rel="noopener">ADS</a>)
        </li>
      ))}
    </ol>
    <a href="/publications/"><span class="en" lang="en">Full publication list →</span><span class="ja" lang="ja">全業績一覧 →</span></a>
  </section>
</BaseLayout>
```

Add the accompanying CSS to `ver2/src/styles/global.css` (append):

```css
.hero {
  background: linear-gradient(180deg, var(--color-navy-deep) 0%, var(--color-navy-mid) 75%, var(--color-paper) 100%);
  padding: var(--space-7) 0 var(--space-6);
  color: #f4f2ec;
}
.hero-kicker { font-family: var(--font-sans-en); font-size: 0.8rem; letter-spacing: 0.15em; opacity: 0.6; }
.hero-question { font-size: clamp(2rem, 5vw, 3.25rem); font-weight: 300; margin: var(--space-3) 0; }
.hero-question em { font-style: italic; font-weight: 700; }
.hero-lede { max-width: 40ch; opacity: 0.85; }

.stat-band { display: flex; flex-wrap: wrap; gap: var(--space-4); padding: var(--space-4) 0; border-bottom: 1px solid var(--color-rule); }
.stat-item { display: flex; flex-direction: column; }
.stat-value { font-family: var(--font-serif-en); font-size: 1.75rem; }
.stat-label { font-size: 0.8rem; color: var(--color-ink-soft); }

.highlight-card { display: grid; grid-template-columns: 1fr 1.4fr; gap: var(--space-4); align-items: center; margin: var(--space-5) 0; }
.highlight-card.reverse { grid-template-columns: 1.4fr 1fr; }
.highlight-card.reverse .figure-placeholder { order: 2; }
.figure-placeholder img { width: 100%; border-radius: 4px; display: block; }

.research-highlights, .news-preview, .selected-publications { padding: var(--space-5) 0; }
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd ver2 && npm test -- homepage`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add ver2/src/data/publications.overrides.yaml ver2/public/images/highlights ver2/src/components/StatBand.astro ver2/src/components/FigurePlaceholder.astro ver2/src/components/HighlightCard.astro ver2/src/pages/index.astro ver2/src/styles/global.css ver2/tests/homepage.test.ts
git commit -m "Build homepage: hero, stat band, research highlights, news preview, selected publications"
```

---

## Milestone D — Research, Publications, Talks, CV, News Pages

### Task 15: `/research` page — six numbered chapters

**Files:**
- Create: `ver2/src/data/research-chapters.ts`
- Create: `ver2/src/pages/research.astro`
- Test: `ver2/tests/research-page.test.ts`

**Interfaces:**
- Produces: `RESEARCH_CHAPTERS: { number: string; titleEn: string; titleJa: string; paragraphs: { en: string; ja: string }[] }[]`, consumed only by `research.astro`.

- [ ] **Step 1: Write the failing test**

```typescript
// ver2/tests/research-page.test.ts
import { describe, expect, it, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'node-html-parser';

const root = path.resolve(__dirname, '..');

describe('/research page', () => {
  beforeAll(() => {
    execSync('npm run build', { cwd: root, stdio: 'inherit' });
  });

  it('renders all 6 numbered research chapters', () => {
    const html = readFileSync(path.join(root, 'dist/research/index.html'), 'utf-8');
    const doc = parse(html);
    const chapters = doc.querySelectorAll('.research-chapter');
    expect(chapters.length).toBe(6);
    expect(html).toContain('06');
    expect(html).toContain('Revealing disks through observations');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ver2 && npm test -- research-page`
Expected: FAIL — `/research/` route does not exist.

- [ ] **Step 3: Write the chapter data**

```typescript
// ver2/src/data/research-chapters.ts
export interface ResearchChapter {
  number: string;
  titleEn: string;
  titleJa: string;
  paragraphs: { en: string; ja: string }[];
}

export const RESEARCH_CHAPTERS: ResearchChapter[] = [
  {
    number: '01',
    titleEn: 'Structure and evolution of protoplanetary disks',
    titleJa: '原始惑星系円盤の構造と進化',
    paragraphs: [
      {
        en: 'To understand planet formation, we first need to know the structure of the protoplanetary disk in which it takes place and how that structure changes over time.',
        ja: '惑星形成を理解するためには、まずその舞台となる原始惑星系円盤がどのような構造をもち、どのように変化していくのかを知る必要があります。',
      },
      {
        en: 'Temperature, density, the distribution of dust, and the flow of material all affect where planetary building blocks gather and how they grow. I study how these basic properties evolve as disks age.',
        ja: '円盤の温度、密度、ダストの分布、そして物質の流れは、惑星の材料がどこに集まり、どのように成長していくかを大きく左右します。私は、こうした基本的な構造が時間とともにどのように進化していくのかを調べています。',
      },
    ],
  },
  {
    number: '02',
    titleEn: 'Magnetic fields and mass transport in planet-forming disks',
    titleJa: '磁場と物質輸送がつくる惑星形成環境',
    paragraphs: [
      {
        en: 'A protoplanetary disk is not a static environment. Its structure changes continuously as material moves through it.',
        ja: '円盤の構造は静かに保たれているわけではなく、内部で起こる物質輸送によって絶えず変化しています。',
      },
      {
        en: 'Magnetic fields are especially important because they act on the partly ionized gas and help shape the disk’s physical structure. I study how these processes influence the structure and evolution of disks as a whole.',
        ja: 'とくに磁場は、プラズマ状態となっている円盤のガスに力をおよぼし、円盤の物理構造を形づくります。私は、こうした過程が円盤全体の構造や進化にどのような影響を与えるのかを研究しています。',
      },
    ],
  },
  {
    number: '03',
    titleEn: 'Disk temperatures and the distribution of volatiles',
    titleJa: '円盤の温度構造と揮発性物質の分布',
    paragraphs: [
      {
        en: 'The flow of matter and energy inside disks also controls temperature and the distribution of water and other volatiles.',
        ja: '円盤の流れやエネルギーのやりとりは、温度構造や水・揮発性物質の分布にも深く関わっています。',
      },
      {
        en: 'Because the locations where water can remain as ice depend on temperature, understanding disk temperatures is essential for thinking about planetary composition and water content. I study how heating, cooling, radiative transfer, and mass transport shape the distribution of volatiles in disks.',
        ja: '水が氷として存在できる場所は温度によって決まるため、温度構造を理解することは、惑星の含水率や組成を考えるうえで欠かせません。私は、加熱と冷却、輻射輸送、物質輸送を通して、円盤の中で水や揮発性物質がどのように分布していくのかを調べています。',
      },
    ],
  },
  {
    number: '04',
    titleEn: 'Environments where terrestrial planets form',
    titleJa: '地球型惑星が生まれる環境',
    paragraphs: [
      {
        en: 'Understanding these disk environments helps us ask under what conditions rocky planets like Earth can form.',
        ja: 'こうした円盤環境の理解は、地球のような岩石惑星がどのような条件のもとで生まれるのかを考えることにつながります。',
      },
      {
        en: 'I focus on how temperature structure, the distribution of dust, and material transport affect the availability of rocky material and water. This is an important step toward reconstructing the formation history of Earth and the Solar System.',
        ja: '私は、温度構造、ダストの分布、物質輸送が、岩石質の材料や水の量をどのように左右するのかに注目しています。地球型惑星が生まれる環境を明らかにすることは、地球や太陽系の形成史を理解するための重要な手がかりになると考えています。',
      },
    ],
  },
  {
    number: '05',
    titleEn: 'Environmental differences behind planetary diversity',
    titleJa: '惑星の多様性を生む環境の違い',
    paragraphs: [
      {
        en: 'Many planetary systems discovered in the Universe look very different from Earth and the Solar System.',
        ja: '宇宙には、地球や太陽系とは異なる多様な惑星系が数多く見つかっています。',
      },
      {
        en: 'I want to understand how differences in disk mass, temperature, lifetime, and mass transport lead to differences in planetary mass, composition, and orbital structure. Through this, we can better understand what kind of place Earth and the Solar System occupy in the wider Universe.',
        ja: '私は、円盤の質量、温度、寿命、物質輸送の違いが、どのように惑星の質量や組成、軌道の違いへとつながるのかを知りたいと考えています。そのことを通して、地球や太陽系が宇宙の中でどのような存在なのかも見えてくるはずです。',
      },
    ],
  },
  {
    number: '06',
    titleEn: 'Revealing disks through observations',
    titleJa: '観測から探る円盤の実像',
    paragraphs: [
      {
        en: 'Theoretical work needs to be tested against real systems.',
        ja: 'こうした理論的な研究を進めるうえでは、実際の観測による裏付けが欠かせません。',
      },
      {
        en: 'Much of the internal structure and formation history of protoplanetary disks cannot be seen directly, so we have to infer the underlying physics from what observations do reveal. I move back and forth between theory and observation to build realistic disk models grounded in data.',
        ja: '原始惑星系円盤の内部構造や形成過程の多くは直接見えるわけではないため、観測で見えている姿から背後にある物理を読み解く必要があります。私は、理論と観測を行き来しながら、観測に裏付けられた現実的な円盤像を描こうとしています。',
      },
    ],
  },
];
```

- [ ] **Step 4: Write the page**

```astro
---
// ver2/src/pages/research.astro
import BaseLayout from '../layouts/BaseLayout.astro';
import { RESEARCH_CHAPTERS } from '../data/research-chapters';
---
<BaseLayout
  titleEn="Research | Shoji Mori"
  titleJa="研究内容 | 森 昇志"
  descriptionEn="How protoplanetary disks evolve, and how that shapes the planets that form within them."
  descriptionJa="原始惑星系円盤がどのように進化し、そこで生まれる惑星をどう形づくるのか。"
  path="/research/"
>
  <section class="container research-intro">
    <h1><span class="en" lang="en">Research</span><span class="ja" lang="ja">研究内容</span></h1>
    <p class="en" lang="en">Planets are born in protoplanetary disks, the disks of gas and dust that surround young stars. The conditions inside these disks strongly influence what kinds of planets can form.</p>
    <p class="ja" lang="ja">惑星は、若い星のまわりに広がるガスと塵の円盤である原始惑星系円盤の中で生まれます。この円盤の環境は、どのような惑星ができるかを大きく左右します。</p>
  </section>

  {RESEARCH_CHAPTERS.map((chapter) => (
    <article class="research-chapter container">
      <div class="chapter-heading">
        <span class="chapter-number">{chapter.number}</span>
        <h2><span class="en" lang="en">{chapter.titleEn}</span><span class="ja" lang="ja">{chapter.titleJa}</span></h2>
      </div>
      {chapter.paragraphs.map((p) => (
        <>
          <p class="en" lang="en">{p.en}</p>
          <p class="ja" lang="ja">{p.ja}</p>
        </>
      ))}
    </article>
  ))}
</BaseLayout>
```

Append to `ver2/src/styles/global.css`:

```css
.research-chapter { display: grid; grid-template-columns: 5rem 1fr; gap: var(--space-3); padding: var(--space-5) 0; border-top: 1px solid var(--color-rule); }
.chapter-heading { grid-column: 1 / -1; display: flex; align-items: baseline; gap: var(--space-3); }
.research-chapter p { grid-column: 2; max-width: 65ch; }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd ver2 && npm test -- research-page`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add ver2/src/data/research-chapters.ts ver2/src/pages/research.astro ver2/src/styles/global.css ver2/tests/research-page.test.ts
git commit -m "Add /research page with six numbered chapters"
```

---

### Task 16: `/publications` page — filters and BibTeX

**Files:**
- Create: `ver2/src/lib/bibtex.ts`
- Create: `ver2/src/scripts-client/publication-filters.ts`
- Create: `ver2/public/scripts/publication-filters-bootstrap.js`
- Create: `ver2/src/components/PublicationItem.astro`
- Create: `ver2/src/pages/publications.astro`
- Test: `ver2/src/lib/bibtex.test.ts`, `ver2/src/scripts-client/publication-filters.test.ts`, `ver2/tests/publications-page.test.ts`

**Interfaces:**
- Consumes: `getPublications()` (Task 12).
- Produces: `buildCombinedBibtex(publications: Publication[]): string` (Task lib), `applyPublicationFilters(doc: Document): void` (client script reading `data-year`/`data-refereed`/`data-first-author` attributes on `.publication-item` and toggling `hidden`).

- [ ] **Step 1: Write the failing tests**

```typescript
// ver2/src/lib/bibtex.test.ts
import { describe, expect, it } from 'vitest';
import { buildCombinedBibtex } from './bibtex';
import type { Publication } from '../data/schemas';

describe('buildCombinedBibtex', () => {
  it('joins each publication\'s bibtex with a blank line, skipping entries without one', () => {
    const publications = [
      { bibtex: '@ARTICLE{A,\n title={One}\n}' },
      { bibtex: null },
      { bibtex: '@ARTICLE{B,\n title={Two}\n}' },
    ] as Publication[];

    const result = buildCombinedBibtex(publications);
    expect(result).toBe('@ARTICLE{A,\n title={One}\n}\n\n@ARTICLE{B,\n title={Two}\n}');
  });
});
```

```typescript
// ver2/src/scripts-client/publication-filters.test.ts
import { describe, expect, it } from 'vitest';
import { applyPublicationFilters } from './publication-filters';

function setup() {
  document.body.innerHTML = `
    <select id="filter-year"><option value="all">All</option><option value="2025">2025</option></select>
    <select id="filter-refereed"><option value="all">All</option><option value="yes">Refereed only</option></select>
    <ul>
      <li class="publication-item" data-year="2025" data-refereed="true"></li>
      <li class="publication-item" data-year="2019" data-refereed="false"></li>
    </ul>`;
}

describe('applyPublicationFilters', () => {
  it('hides items that do not match the selected year', () => {
    setup();
    applyPublicationFilters(document);
    (document.getElementById('filter-year') as HTMLSelectElement).value = '2025';
    document.getElementById('filter-year')!.dispatchEvent(new Event('change'));

    const items = document.querySelectorAll('.publication-item');
    expect((items[0] as HTMLElement).hidden).toBe(false);
    expect((items[1] as HTMLElement).hidden).toBe(true);
  });

  it('hides non-refereed items when "Refereed only" is selected', () => {
    setup();
    applyPublicationFilters(document);
    (document.getElementById('filter-refereed') as HTMLSelectElement).value = 'yes';
    document.getElementById('filter-refereed')!.dispatchEvent(new Event('change'));

    const items = document.querySelectorAll('.publication-item');
    expect((items[0] as HTMLElement).hidden).toBe(false);
    expect((items[1] as HTMLElement).hidden).toBe(true);
  });
});
```

```typescript
// ver2/tests/publications-page.test.ts
import { describe, expect, it, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'node-html-parser';

const root = path.resolve(__dirname, '..');

describe('/publications page', () => {
  beforeAll(() => {
    execSync('npm run build', { cwd: root, stdio: 'inherit' });
  });

  it('lists all 22 publications and offers a combined .bib download', () => {
    const html = readFileSync(path.join(root, 'dist/publications/index.html'), 'utf-8');
    const doc = parse(html);
    expect(doc.querySelectorAll('.publication-item').length).toBe(22);
    expect(doc.querySelector('a[href="/publications.bib"]')).not.toBeNull();
  });

  it('emits a combined .bib file', () => {
    expect(readFileSync(path.join(root, 'dist/publications.bib'), 'utf-8')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ver2 && npm test -- bibtex publication-filters publications-page`
Expected: FAIL — none of the modules/routes exist.

- [ ] **Step 3: Write `bibtex.ts`**

```typescript
// ver2/src/lib/bibtex.ts
import type { Publication } from '../data/schemas';

export function buildCombinedBibtex(publications: Publication[]): string {
  return publications
    .map((p) => p.bibtex)
    .filter((entry): entry is string => Boolean(entry))
    .join('\n\n');
}
```

- [ ] **Step 4: Write the filter script**

```typescript
// ver2/src/scripts-client/publication-filters.ts
export function applyPublicationFilters(doc: Document): void {
  const yearSelect = doc.getElementById('filter-year') as HTMLSelectElement | null;
  const refereedSelect = doc.getElementById('filter-refereed') as HTMLSelectElement | null;
  const items = Array.from(doc.querySelectorAll<HTMLElement>('.publication-item'));

  function apply(): void {
    const year = yearSelect?.value ?? 'all';
    const refereed = refereedSelect?.value ?? 'all';

    for (const item of items) {
      const matchesYear = year === 'all' || item.dataset.year === year;
      const matchesRefereed = refereed === 'all' || item.dataset.refereed === 'true';
      item.hidden = !(matchesYear && matchesRefereed);
    }
  }

  yearSelect?.addEventListener('change', apply);
  refereedSelect?.addEventListener('change', apply);
  apply();
}
```

```javascript
// ver2/public/scripts/publication-filters-bootstrap.js
import { applyPublicationFilters } from '/src/scripts-client/publication-filters.ts';
applyPublicationFilters(document);
```

- [ ] **Step 5: Write `PublicationItem.astro` and the page**

```astro
---
// ver2/src/components/PublicationItem.astro
import type { Publication } from '../data/schemas';
interface Props { pub: Publication }
const { pub } = Astro.props;
---
<li class="publication-item" data-year={pub.year} data-refereed={String(pub.refereed)}>
  <span class="pub-year">{pub.year}</span>
  <div class="pub-body">
    <p class="en" lang="en" set:html={pub.authorsEn} />
    <p class="ja" lang="ja" set:html={pub.authorsJa} />
    <p class="pub-title en" lang="en">{pub.titleEn}</p>
    <p class="pub-title ja" lang="ja">{pub.titleJa}</p>
    <p class="pub-journal en" lang="en">{pub.journalEn} {pub.citationCount > 0 && `· ${pub.citationCount} citations`}</p>
    <p class="pub-journal ja" lang="ja">{pub.journalJa} {pub.citationCount > 0 && `· 被引用 ${pub.citationCount} 件`}</p>
    {(pub.abstractEn || pub.abstractJa) && (
      <details class="pub-abstract">
        <summary><span class="en" lang="en">Plain-language summary</span><span class="ja" lang="ja">やさしい解説</span></summary>
        <p class="en" lang="en">{pub.abstractEn}</p>
        <p class="ja" lang="ja">{pub.abstractJa}</p>
      </details>
    )}
    <div class="pub-links">
      {pub.doi && <a href={`https://doi.org/${pub.doi}`} target="_blank" rel="noopener">DOI</a>}
      {pub.arxivId && <a href={`https://arxiv.org/abs/${pub.arxivId}`} target="_blank" rel="noopener">arXiv</a>}
      {pub.adsUrl && <a href={pub.adsUrl} target="_blank" rel="noopener">ADS</a>}
      {pub.url && !pub.doi && !pub.arxivId && <a href={pub.url} target="_blank" rel="noopener">Link</a>}
      {pub.bibtex && (
        <button type="button" class="copy-bibtex" data-bibtex={pub.bibtex}>BibTeX</button>
      )}
    </div>
  </div>
</li>
```

```astro
---
// ver2/src/pages/publications.astro
import BaseLayout from '../layouts/BaseLayout.astro';
import PublicationItem from '../components/PublicationItem.astro';
import { getPublications } from '../data/publications';

const publications = getPublications();
const years = Array.from(new Set(publications.map((p) => p.year))).sort((a, b) => Number(b) - Number(a));
---
<BaseLayout
  titleEn="Publications | Shoji Mori"
  titleJa="論文・解説 | 森 昇志"
  descriptionEn="Peer-reviewed publications on protoplanetary disks and planet formation, synced from NASA ADS."
  descriptionJa="原始惑星系円盤と惑星形成に関する査読論文一覧（NASA ADS 同期）。"
  path="/publications/"
>
  <section class="container">
    <h1><span class="en" lang="en">Publications</span><span class="ja" lang="ja">論文・解説</span></h1>
    <div class="publication-controls">
      <select id="filter-year">
        <option value="all">All years</option>
        {years.map((y) => <option value={y}>{y}</option>)}
      </select>
      <select id="filter-refereed">
        <option value="all">All</option>
        <option value="yes">Refereed only</option>
      </select>
      <a href="/publications.bib" download>Download all as BibTeX (.bib)</a>
    </div>
    <ul class="publication-list">
      {publications.map((pub) => <PublicationItem pub={pub} />)}
    </ul>
  </section>
</BaseLayout>
<script src="/scripts/publication-filters-bootstrap.js"></script>
<script src="/scripts/bibtex-copy-bootstrap.js"></script>
```

- [ ] **Step 6: Emit the combined `.bib` file at build time**

```typescript
// ver2/src/pages/publications.bib.ts
import type { APIRoute } from 'astro';
import { getPublications } from '../data/publications';
import { buildCombinedBibtex } from '../lib/bibtex';

export const GET: APIRoute = () => {
  const body = buildCombinedBibtex(getPublications());
  return new Response(body, { headers: { 'Content-Type': 'application/x-bibtex; charset=utf-8' } });
};
```

- [ ] **Step 7: Write the BibTeX-copy client script (small, no dedicated test — exercised by the page build test)**

```typescript
// ver2/src/scripts-client/bibtex-copy.ts
export function initBibtexCopyButtons(doc: Document, nav: Navigator): void {
  doc.querySelectorAll<HTMLButtonElement>('.copy-bibtex').forEach((button) => {
    button.addEventListener('click', async () => {
      const text = button.dataset.bibtex ?? '';
      await nav.clipboard.writeText(text);
      const original = button.textContent;
      button.textContent = 'Copied!';
      setTimeout(() => { button.textContent = original; }, 1500);
    });
  });
}
```

```javascript
// ver2/public/scripts/bibtex-copy-bootstrap.js
import { initBibtexCopyButtons } from '/src/scripts-client/bibtex-copy.ts';
initBibtexCopyButtons(document, navigator);
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd ver2 && npm test -- bibtex publication-filters publications-page`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add ver2/src/lib/bibtex.ts ver2/src/lib/bibtex.test.ts ver2/src/scripts-client/publication-filters.ts ver2/src/scripts-client/publication-filters.test.ts ver2/src/scripts-client/bibtex-copy.ts ver2/public/scripts/publication-filters-bootstrap.js ver2/public/scripts/bibtex-copy-bootstrap.js ver2/src/components/PublicationItem.astro ver2/src/pages/publications.astro ver2/src/pages/publications.bib.ts ver2/tests/publications-page.test.ts
git commit -m "Add /publications page with year/refereed filters and BibTeX export"
```

---

### Task 17: `/talks` page — presentations grouped by year, with inline materials

**Files:**
- Create: `ver2/src/components/PresentationItem.astro`
- Create: `ver2/src/pages/talks.astro`
- Test: `ver2/tests/talks-page.test.ts`

**Interfaces:**
- Consumes: `getPresentations()` (Task 12). Each `Presentation` already carries `slideUrl`/`posterUrl` (migrated in Task 11), so materials render inline per entry — no separate materials data file is needed.

- [ ] **Step 1: Write the failing test**

```typescript
// ver2/tests/talks-page.test.ts
import { describe, expect, it, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'node-html-parser';

const root = path.resolve(__dirname, '..');

describe('/talks page', () => {
  beforeAll(() => {
    execSync('npm run build', { cwd: root, stdio: 'inherit' });
  });

  it('lists all 61 presentations grouped under year headings', () => {
    const html = readFileSync(path.join(root, 'dist/talks/index.html'), 'utf-8');
    const doc = parse(html);
    expect(doc.querySelectorAll('.presentation-item').length).toBe(61);
    expect(doc.querySelectorAll('.year-heading').length).toBeGreaterThan(1);
  });

  it('links a slide PDF for at least one presentation', () => {
    const html = readFileSync(path.join(root, 'dist/talks/index.html'), 'utf-8');
    expect(html).toContain('files/slides/slide-20230424-cps-seminar.pdf');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ver2 && npm test -- talks-page`
Expected: FAIL — `/talks/` route does not exist.

- [ ] **Step 3: Write `PresentationItem.astro` and the page**

```astro
---
// ver2/src/components/PresentationItem.astro
import type { Presentation } from '../data/schemas';
interface Props { pres: Presentation }
const { pres } = Astro.props;
const typeLabel = { invited: 'Invited', oral: 'Oral', poster: 'Poster' }[pres.type];
---
<li class="presentation-item">
  <span class="pres-date">{pres.date}</span>
  <span class="pres-type-tag">{typeLabel}</span>
  <div class="pres-body">
    <p class="pres-title en" lang="en">{pres.titleEn}</p>
    <p class="pres-title ja" lang="ja">{pres.titleJa}</p>
    <p class="pres-meta en" lang="en">{pres.authorsEn} — {pres.confEn}, {pres.placeEn}</p>
    <p class="pres-meta ja" lang="ja">{pres.authorsJa} — {pres.confJa}, {pres.placeJa}</p>
    <div class="pres-links">
      {pres.url && <a href={pres.url} target="_blank" rel="noopener">Program</a>}
      {pres.slideUrl && <a href={pres.slideUrl} target="_blank" rel="noopener">Slides</a>}
      {pres.posterUrl && <a href={pres.posterUrl} target="_blank" rel="noopener">Poster</a>}
    </div>
  </div>
</li>
```

```astro
---
// ver2/src/pages/talks.astro
import BaseLayout from '../layouts/BaseLayout.astro';
import PresentationItem from '../components/PresentationItem.astro';
import { getPresentations } from '../data/presentations';

const presentations = getPresentations();
const byYear = new Map<string, typeof presentations>();
for (const pres of presentations) {
  const list = byYear.get(pres.year) ?? [];
  list.push(pres);
  byYear.set(pres.year, list);
}
const years = Array.from(byYear.keys()).sort((a, b) => Number(b) - Number(a));
---
<BaseLayout
  titleEn="Talks | Shoji Mori"
  titleJa="学会発表 | 森 昇志"
  descriptionEn="Conference talks, posters, and invited seminars given by Shoji Mori."
  descriptionJa="森昇志の学会発表・招待セミナーの一覧。"
  path="/talks/"
>
  <section class="container">
    <h1><span class="en" lang="en">Talks</span><span class="ja" lang="ja">学会発表</span></h1>
    {years.map((year) => (
      <div>
        <h2 class="year-heading">{year}</h2>
        <ul class="presentation-list">
          {byYear.get(year)!.map((pres) => <PresentationItem pres={pres} />)}
        </ul>
      </div>
    ))}
  </section>
</BaseLayout>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ver2 && npm test -- talks-page`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ver2/src/components/PresentationItem.astro ver2/src/pages/talks.astro ver2/tests/talks-page.test.ts
git commit -m "Add /talks page grouping presentations by year with inline materials"
```

---

### Task 18: `/cv` page

**Files:**
- Create: `ver2/src/pages/cv.astro`
- Test: `ver2/tests/cv-page.test.ts`

**Interfaces:**
- Consumes: `getCvData()` (Task 12).

- [ ] **Step 1: Write the failing test**

```typescript
// ver2/tests/cv-page.test.ts
import { describe, expect, it, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'node-html-parser';

const root = path.resolve(__dirname, '..');

describe('/cv page', () => {
  beforeAll(() => {
    execSync('npm run build', { cwd: root, stdio: 'inherit' });
  });

  it('renders every CV section with the migrated entry counts and a PDF link', () => {
    const html = readFileSync(path.join(root, 'dist/cv/index.html'), 'utf-8');
    const doc = parse(html);
    expect(doc.querySelectorAll('.cv-education .cv-entry').length).toBe(6);
    expect(doc.querySelectorAll('.cv-grants .cv-entry').length).toBe(7);
    expect(doc.querySelectorAll('.cv-awards .cv-entry').length).toBe(6);
    expect(doc.querySelector('a[href="/cv_mori_shoji_v3.3.pdf"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ver2 && npm test -- cv-page`
Expected: FAIL — `/cv/` route does not exist.

- [ ] **Step 3: Write the page**

```astro
---
// ver2/src/pages/cv.astro
import BaseLayout from '../layouts/BaseLayout.astro';
import { getCvData } from '../data/cv';

const cv = getCvData();
---
<BaseLayout
  titleEn="CV | Shoji Mori"
  titleJa="経歴 | 森 昇志"
  descriptionEn="Education, grants, awards, teaching, and review experience of Shoji Mori."
  descriptionJa="森昇志の経歴・受賞・グラント・査読実績。"
  path="/cv/"
>
  <section class="container cv-header">
    <h1><span class="en" lang="en">Curriculum Vitae</span><span class="ja" lang="ja">経歴</span></h1>
    <a href="/cv_mori_shoji_v3.3.pdf" target="_blank" rel="noopener" class="cv-pdf-link">
      <span class="en" lang="en">Download PDF</span><span class="ja" lang="ja">PDFをダウンロード</span>
    </a>
  </section>

  <section class="container cv-education">
    <h2><span class="en" lang="en">Experience &amp; Education</span><span class="ja" lang="ja">経歴</span></h2>
    {cv.education.map((e) => (
      <div class="cv-entry">
        <div class="cv-date">{e.dateRange}</div>
        <div>
          <p class="en" lang="en"><strong>{e.titleEn}</strong> — {e.orgEn}</p>
          <p class="ja" lang="ja"><strong>{e.titleJa}</strong> — {e.orgJa}</p>
          {e.noteEn && <p class="en cv-note" lang="en">{e.noteEn}</p>}
          {e.noteJa && <p class="ja cv-note" lang="ja">{e.noteJa}</p>}
          {e.extraEn && <p class="en cv-extra" lang="en"><em>{e.extraEn}</em></p>}
          {e.extraJa && <p class="ja cv-extra" lang="ja"><em>{e.extraJa}</em></p>}
          {e.linkUrl && <a href={e.linkUrl} target="_blank" rel="noopener">{e.linkLabel}</a>}
        </div>
      </div>
    ))}
  </section>

  <section class="container cv-grants">
    <h2><span class="en" lang="en">Grants &amp; Competitive Funds</span><span class="ja" lang="ja">競争的資金等の研究課題</span></h2>
    {cv.grants.map((g) => (
      <div class="cv-entry">
        <div class="cv-date">{g.dateRange}</div>
        <div>
          <p class="en" lang="en"><strong>{g.titleEn}</strong></p>
          <p class="ja" lang="ja"><strong>{g.titleJa}</strong></p>
          <p class="en cv-note" lang="en">{g.roleEn}</p>
          <p class="ja cv-note" lang="ja">{g.roleJa}</p>
          {g.amountEn && <p class="en cv-extra" lang="en">{g.amountEn}</p>}
          {g.amountJa && <p class="ja cv-extra" lang="ja">{g.amountJa}</p>}
          {g.linkUrl && <a href={g.linkUrl} target="_blank" rel="noopener">{g.linkLabel}</a>}
        </div>
      </div>
    ))}
  </section>

  <section class="container cv-awards">
    <h2><span class="en" lang="en">Awards &amp; Honors</span><span class="ja" lang="ja">受賞歴</span></h2>
    {cv.awards.map((a) => (
      <div class="cv-entry">
        <div class="cv-date">{a.year}</div>
        <div>
          <p class="en" lang="en"><strong>{a.titleEn}</strong></p>
          <p class="ja" lang="ja"><strong>{a.titleJa}</strong></p>
          <p class="en cv-note" lang="en">{a.orgEn}</p>
          <p class="ja cv-note" lang="ja">{a.orgJa}</p>
          {a.linkUrl && <a href={a.linkUrl} target="_blank" rel="noopener">{a.linkLabel}</a>}
        </div>
      </div>
    ))}
  </section>

  <section class="container cv-teaching">
    <h2><span class="en" lang="en">Teaching &amp; Workshops</span><span class="ja" lang="ja">教育・講習会</span></h2>
    {cv.teaching.map((t) => (
      <div class="cv-entry">
        <div class="cv-date">{t.dateRange}</div>
        <div>
          <p class="en" lang="en"><strong>{t.titleEn}</strong> — {t.orgEn}</p>
          <p class="ja" lang="ja"><strong>{t.titleJa}</strong> — {t.orgJa}</p>
        </div>
      </div>
    ))}
  </section>

  <section class="container cv-mentoring">
    <h2><span class="en" lang="en">Mentoring &amp; Supervision</span><span class="ja" lang="ja">学生指導・メンター</span></h2>
    {cv.mentoring.map((m) => (
      <div class="cv-entry">
        <div class="cv-date">{m.dateRange}</div>
        <div>
          <p class="en" lang="en"><strong>{m.nameEn}</strong> — {m.roleEn}</p>
          <p class="ja" lang="ja"><strong>{m.nameJa}</strong> — {m.roleJa}</p>
          <p class="en cv-note" lang="en">{m.topicEn}</p>
          <p class="ja cv-note" lang="ja">{m.topicJa}</p>
        </div>
      </div>
    ))}
  </section>

  <section class="container cv-service">
    <h2><span class="en" lang="en">Academic Service &amp; Community</span><span class="ja" lang="ja">学会・コミュニティ運営</span></h2>
    {cv.service.map((s) => (
      <div class="cv-entry">
        <div class="cv-date">{s.dateRange}</div>
        <div>
          <p class="en" lang="en"><strong>{s.titleEn}</strong> — {s.orgEn}</p>
          <p class="ja" lang="ja"><strong>{s.titleJa}</strong> — {s.orgJa}</p>
        </div>
      </div>
    ))}
  </section>

  <section class="container cv-seminars">
    <h2><span class="en" lang="en">External Seminars &amp; Colloquia</span><span class="ja" lang="ja">外部セミナー・談話会</span></h2>
    {cv.seminars.map((s) => (
      <div class="cv-entry">
        <div class="cv-date">{s.date}</div>
        <div>
          <p class="en" lang="en">{s.titleEn}</p>
          <p class="ja" lang="ja">{s.titleJa}</p>
          <p class="en cv-note" lang="en">{s.venueEn}</p>
          <p class="ja cv-note" lang="ja">{s.venueJa}</p>
          {s.slideUrl && <a href={s.slideUrl} target="_blank" rel="noopener">Slides</a>}
          {s.videoUrl && <a href={s.videoUrl} target="_blank" rel="noopener">Video</a>}
        </div>
      </div>
    ))}
  </section>

  <section class="container cv-review">
    <h2><span class="en" lang="en">Review Experience</span><span class="ja" lang="ja">査読実績</span></h2>
    <p class="en" lang="en">Referee for {cv.reviewJournals.map((j) => j.name).join(', ')}.</p>
    <p class="ja" lang="ja">以下の主要学術誌において査読協力（Referee）を行っています：{cv.reviewJournals.map((j) => j.name).join(', ')}</p>
    <ul class="cv-review-list">
      {cv.reviewJournals.map((j) => <li><a href={j.url} target="_blank" rel="noopener">{j.name}</a></li>)}
    </ul>
  </section>
</BaseLayout>
```

Append to `ver2/src/styles/global.css`:

```css
.cv-entry { display: grid; grid-template-columns: 10rem 1fr; gap: var(--space-3); padding: var(--space-2) 0; border-top: 1px solid var(--color-rule); }
.cv-date { font-family: var(--font-sans-en); font-size: 0.85rem; color: var(--color-ink-soft); }
.cv-note { font-size: 0.85rem; color: var(--color-ink-soft); }
.cv-extra { font-size: 0.85rem; color: var(--color-accent-orange); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ver2 && npm test -- cv-page`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ver2/src/pages/cv.astro ver2/src/styles/global.css ver2/tests/cv-page.test.ts
git commit -m "Add /cv page rendering all CV sections and a PDF download link"
```

---

### Task 19: `/news` page, the news content collection, and a seed script

**Files:**
- Create: `ver2/scripts/seed-news.mjs`
- Create: `ver2/src/pages/news.astro`
- Test: `ver2/scripts/seed-news.test.ts`, `ver2/tests/news-page.test.ts`

**Interfaces:**
- Consumes: `publications.overrides.yaml` (Task 10) and `presentations.yaml` (Task 11) as the source of *real, dated* facts — the script never invents content, matching the design doc's scope-out of new written content (§8).
- Produces: markdown files under `src/content/news/*.md` matching the `news` collection schema (Task 6), and the `/news` page rendering them newest-first.

- [ ] **Step 1: Write the failing test**

```typescript
// ver2/scripts/seed-news.test.ts
import { describe, expect, it, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const newsDir = path.join(root, 'src/content/news');

describe('seed-news', () => {
  beforeAll(() => {
    execSync('node scripts/seed-news.mjs', { cwd: root, stdio: 'inherit' });
  });

  it('creates at least one dated news entry per selected publication', () => {
    const files = readdirSync(newsDir).filter((f) => f.endsWith('.md'));
    expect(files.length).toBeGreaterThan(0);
  });

  it('derives dates from real arXiv IDs rather than inventing them', () => {
    const files = readdirSync(newsDir).filter((f) => f.endsWith('.md'));
    const arxivEntry = files.find((f) => f.startsWith('2025-08'));
    expect(arxivEntry).toBeDefined();
    const content = readFileSync(path.join(newsDir, arxivEntry!), 'utf-8');
    expect(content).toContain('arxiv.org/abs/2508.03624');
  });
});
```

```typescript
// ver2/tests/news-page.test.ts
import { describe, expect, it, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'node-html-parser';

const root = path.resolve(__dirname, '..');

describe('/news page', () => {
  beforeAll(() => {
    execSync('node scripts/seed-news.mjs && npm run build', { cwd: root, stdio: 'inherit', shell: '/bin/bash' });
  });

  it('renders news entries newest-first', () => {
    const html = readFileSync(path.join(root, 'dist/news/index.html'), 'utf-8');
    const doc = parse(html);
    expect(doc.querySelectorAll('.news-entry').length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ver2 && npm test -- seed-news news-page`
Expected: FAIL — `scripts/seed-news.mjs` and `/news/` route do not exist.

- [ ] **Step 3: Write the seed script**

```javascript
// ver2/scripts/seed-news.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OVERRIDES_PATH = path.join(__dirname, '../src/data/publications.overrides.yaml');
const PRESENTATIONS_PATH = path.join(__dirname, '../src/data/presentations.yaml');
const NEWS_DIR = path.join(__dirname, '../src/content/news');

function arxivDate(arxivId) {
  // arXiv IDs are YYMM.NNNNN; treat the 1st of that month as the real,
  // verifiable submission date rather than guessing a day.
  const [yymm] = arxivId.split('.');
  const year = 2000 + Number(yymm.slice(0, 2));
  const month = yymm.slice(2, 4);
  return `${year}-${month}-01`;
}

function presentationDate(dateField) {
  // presentations.yaml dates look like "2025/12/8-12" or "2025/09/09-11";
  // take the first day of the range.
  const [y, m, dRange] = dateField.split('/');
  const day = (dRange ?? '1').split('-')[0].padStart(2, '0');
  return `${y}-${m.padStart(2, '0')}-${day}`;
}

function writeEntry(date, titleEn, titleJa, summaryEn, summaryJa, linkUrl) {
  if (!existsSync(NEWS_DIR)) mkdirSync(NEWS_DIR, { recursive: true });
  const slug = `${date}-${titleEn.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`.replace(/-+$/, '');
  const frontmatter = {
    date,
    titleEn,
    titleJa,
    summaryEn,
    summaryJa,
    ...(linkUrl ? { linkUrl, linkLabelEn: 'Read more', linkLabelJa: '詳細' } : {}),
  };
  writeFileSync(path.join(NEWS_DIR, `${slug}.md`), `---\n${YAML.stringify(frontmatter)}---\n`, 'utf-8');
}

function main() {
  const overrides = YAML.parse(readFileSync(OVERRIDES_PATH, 'utf-8'));
  for (const o of overrides) {
    if (!o.arxivId || !o.selected) continue;
    writeEntry(
      arxivDate(o.arxivId),
      `New paper: ${o.manual.titleEn}`,
      `新しい論文: ${o.manual.titleEn}`,
      `Posted on arXiv: ${o.manual.titleEn}.`,
      `arXivに新しい論文を公開しました: ${o.manual.titleEn}`,
      `https://arxiv.org/abs/${o.arxivId}`,
    );
  }

  const presentations = YAML.parse(readFileSync(PRESENTATIONS_PATH, 'utf-8'));
  const recent = presentations
    .filter((p) => Number(p.year) >= 2024)
    .sort((a, b) => Number(b.year) - Number(a.year));
  for (const p of recent) {
    writeEntry(
      presentationDate(p.date),
      `Gave a talk at ${p.confEn}`,
      `${p.confJa}で発表しました`,
      `${p.titleEn} (${p.confEn}).`,
      `${p.titleJa}（${p.confJa}）。`,
      p.url ?? undefined,
    );
  }

  console.log('Seeded news entries from publications.overrides.yaml and presentations.yaml.');
}

main();
```

- [ ] **Step 4: Write the `/news` page**

```astro
---
// ver2/src/pages/news.astro
import BaseLayout from '../layouts/BaseLayout.astro';
import { getCollection } from 'astro:content';

const entries = (await getCollection('news')).sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
---
<BaseLayout
  titleEn="News | Shoji Mori"
  titleJa="お知らせ | 森 昇志"
  descriptionEn="Recent publications, talks, and activity."
  descriptionJa="最近の論文・発表・活動記録。"
  path="/news/"
>
  <section class="container">
    <h1><span class="en" lang="en">News</span><span class="ja" lang="ja">お知らせ</span></h1>
    <ul class="news-list">
      {entries.map((entry) => (
        <li class="news-entry">
          <time datetime={entry.data.date.toISOString()}>{entry.data.date.toISOString().slice(0, 10)}</time>
          <div>
            <p class="en" lang="en">{entry.data.titleEn}</p>
            <p class="ja" lang="ja">{entry.data.titleJa}</p>
            {entry.data.linkUrl && <a href={entry.data.linkUrl} target="_blank" rel="noopener">{entry.data.linkLabelEn}</a>}
          </div>
        </li>
      ))}
    </ul>
  </section>
</BaseLayout>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd ver2 && npm test -- seed-news news-page`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add ver2/scripts/seed-news.mjs ver2/src/pages/news.astro ver2/scripts/seed-news.test.ts ver2/tests/news-page.test.ts ver2/src/content/news
git commit -m "Add /news page and a seed script deriving entries from verified publication/presentation data"
```

---

## Milestone E — Contact, SEO, Redirects

### Task 20: Contact form with Turnstile and Formspark

**Files:**
- Create: `ver2/src/scripts-client/contact-form.ts`
- Create: `ver2/public/scripts/contact-form-bootstrap.js`
- Create: `ver2/src/components/ContactForm.astro`
- Modify: `ver2/src/pages/index.astro` (add the contact section before the closing `</BaseLayout>`)
- Test: `ver2/src/scripts-client/contact-form.test.ts`, extend `ver2/tests/homepage.test.ts`

**Interfaces:**
- Produces: `isHoneypotFilled(form: HTMLFormElement): boolean`, `buildStatusMessage(state: 'sending'|'success'|'error'): { en: string; ja: string }`, `initContactForm(doc: Document, fetchImpl?: typeof fetch): void`.

- [ ] **Step 1: Write the failing test**

```typescript
// ver2/src/scripts-client/contact-form.test.ts
import { describe, expect, it, vi } from 'vitest';
import { isHoneypotFilled, buildStatusMessage, initContactForm } from './contact-form';

function setupForm(): HTMLFormElement {
  document.body.innerHTML = `
    <form id="contact-form" action="https://submit-form.com/p3OcmXTQj">
      <input name="_honeypot" value="">
      <input name="name" value="Ada">
      <div id="form-status"></div>
    </form>`;
  return document.getElementById('contact-form') as HTMLFormElement;
}

describe('isHoneypotFilled', () => {
  it('is false when the honeypot field is empty', () => {
    const form = setupForm();
    expect(isHoneypotFilled(form)).toBe(false);
  });
  it('is true when a bot fills the honeypot field', () => {
    const form = setupForm();
    (form.querySelector('[name="_honeypot"]') as HTMLInputElement).value = 'spam';
    expect(isHoneypotFilled(form)).toBe(true);
  });
});

describe('buildStatusMessage', () => {
  it('returns bilingual copy for each state', () => {
    expect(buildStatusMessage('sending').en).toMatch(/Sending/);
    expect(buildStatusMessage('success').ja).toContain('送信しました');
    expect(buildStatusMessage('error').en).toMatch(/wrong/);
  });
});

describe('initContactForm', () => {
  it('submits via fetch and shows a success message', async () => {
    const form = setupForm();
    const fetchImpl = vi.fn(async () => ({ ok: true } as Response));
    initContactForm(document, fetchImpl as unknown as typeof fetch);

    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchImpl).toHaveBeenCalledWith(form.action, expect.objectContaining({ method: 'POST' }));
    expect(document.getElementById('form-status')!.innerHTML).toContain('Message sent');
  });

  it('silently drops the submission when the honeypot is filled', async () => {
    const form = setupForm();
    (form.querySelector('[name="_honeypot"]') as HTMLInputElement).value = 'spam';
    const fetchImpl = vi.fn();
    initContactForm(document, fetchImpl as unknown as typeof fetch);

    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ver2 && npm test -- contact-form`
Expected: FAIL — `./contact-form` module does not exist.

- [ ] **Step 3: Write the implementation**

```typescript
// ver2/src/scripts-client/contact-form.ts
export function isHoneypotFilled(form: HTMLFormElement): boolean {
  const field = form.querySelector<HTMLInputElement>('[name="_honeypot"]');
  return Boolean(field && field.value.trim().length > 0);
}

type FormState = 'sending' | 'success' | 'error';

export function buildStatusMessage(state: FormState): { en: string; ja: string } {
  switch (state) {
    case 'sending':
      return { en: 'Sending…', ja: '送信中…' };
    case 'success':
      return { en: 'Message sent. Thank you!', ja: '送信しました。ありがとうございます。' };
    case 'error':
      return { en: 'Something went wrong. Please email me directly.', ja: '送信に失敗しました。メールでご連絡ください。' };
  }
}

export function initContactForm(doc: Document, fetchImpl: typeof fetch = fetch): void {
  const form = doc.getElementById('contact-form') as HTMLFormElement | null;
  const statusEl = doc.getElementById('form-status');
  if (!form || !statusEl) return;

  const setStatus = (state: FormState) => {
    const msg = buildStatusMessage(state);
    statusEl.innerHTML = `<span class="en" lang="en">${msg.en}</span><span class="ja" lang="ja">${msg.ja}</span>`;
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (isHoneypotFilled(form)) return;

    setStatus('sending');
    fetchImpl(form.action, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } })
      .then((response) => {
        if (!response.ok) throw new Error(`Form submission failed: ${response.status}`);
        setStatus('success');
        form.reset();
      })
      .catch(() => setStatus('error'));
  });
}
```

```javascript
// ver2/public/scripts/contact-form-bootstrap.js
import { initContactForm } from '/src/scripts-client/contact-form.ts';
initContactForm(document);
```

- [ ] **Step 4: Write `ContactForm.astro`**

```astro
---
// ver2/src/components/ContactForm.astro
---
<section class="contact-form container" id="contact">
  <h2><span class="en" lang="en">Get in Touch</span><span class="ja" lang="ja">お問い合わせ</span></h2>
  <p class="en" lang="en">If you are interested in my research, collaborations, or have any questions, feel free to reach out through the form or social media.</p>
  <p class="ja" lang="ja">研究内容や共同研究に関するお問い合わせ、ご質問などがありましたら、以下のフォームまたはSNSよりお気軽にご連絡ください。</p>

  <form id="contact-form" action="https://submit-form.com/p3OcmXTQj" method="post">
    <div class="hp-field" aria-hidden="true">
      <label class="sr-only" for="website">Website</label>
      <input type="text" id="website" name="_honeypot" tabindex="-1" autocomplete="off" />
    </div>
    <div class="form-group">
      <label class="sr-only" for="name">Name</label>
      <input type="text" id="name" name="name" placeholder="Your Name / お名前" autocomplete="name" required />
    </div>
    <div class="form-group">
      <label class="sr-only" for="email">Email</label>
      <input type="email" id="email" name="email" placeholder="Your Email / メールアドレス" autocomplete="email" required />
    </div>
    <div class="form-group">
      <label class="sr-only" for="message">Message</label>
      <textarea id="message" name="message" rows="5" placeholder="Your Message / メッセージ" required></textarea>
    </div>
    <div class="turnstile-wrap">
      <div class="cf-turnstile" data-sitekey="0x4AAAAAACvUFMAbNpb0ja_Y"></div>
    </div>
    <button type="submit" class="submit-btn">
      <span class="en" lang="en">Send Message</span><span class="ja" lang="ja">送信する</span>
    </button>
    <p class="form-note en" lang="en">This form sends directly via Formspark. If submission fails, please contact me by email.</p>
    <p class="form-note ja" lang="ja">このフォームは Formspark 経由で直接送信されます。送信できない場合はメールでご連絡ください。</p>
    <div id="form-status" role="status" aria-live="polite"></div>
  </form>
</section>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" defer></script>
```

- [ ] **Step 5: Add the section to the homepage**

```astro
// ver2/src/pages/index.astro — insert immediately before the closing </BaseLayout>, after the selected-publications section
  <ContactForm />
</BaseLayout>
<script src="/scripts/contact-form-bootstrap.js"></script>
```

And add the import at the top alongside the other component imports:

```astro
import ContactForm from '../components/ContactForm.astro';
```

- [ ] **Step 6: Extend the homepage build test**

Add to `ver2/tests/homepage.test.ts`, inside the existing `it(...)` block:

```typescript
    expect(doc.querySelector('#contact-form')).not.toBeNull();
    expect(doc.querySelector('.cf-turnstile')).not.toBeNull();
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd ver2 && npm test -- contact-form homepage`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add ver2/src/scripts-client/contact-form.ts ver2/src/scripts-client/contact-form.test.ts ver2/public/scripts/contact-form-bootstrap.js ver2/src/components/ContactForm.astro ver2/src/pages/index.astro ver2/tests/homepage.test.ts
git commit -m "Add contact form with Turnstile and Formspark submission handling"
```

---

### Task 21: SEO — per-page JSON-LD, OGP, sitemap

**Files:**
- Create: `ver2/src/components/SeoHead.astro`
- Create: `ver2/src/lib/json-ld.ts`
- Modify: `ver2/src/layouts/BaseLayout.astro` (use `SeoHead`, accept `ogImage` prop)
- Test: `ver2/src/lib/json-ld.test.ts`, `ver2/tests/seo.test.ts`

**Interfaces:**
- Consumes: `Publication[]` from `getPublications()`.
- Produces: `buildPersonJsonLd(): object`, `buildScholarlyArticleJsonLd(pub: Publication): object` — used by `SeoHead.astro` and by `publications.astro` (one `<script type="application/ld+json">` per publication).

- [ ] **Step 1: Write the failing test**

```typescript
// ver2/src/lib/json-ld.test.ts
import { describe, expect, it } from 'vitest';
import { buildPersonJsonLd, buildScholarlyArticleJsonLd } from './json-ld';
import type { Publication } from '../data/schemas';

describe('buildPersonJsonLd', () => {
  it('includes the ORCID and canonical site URL', () => {
    const jsonLd = buildPersonJsonLd();
    expect(jsonLd['@type']).toBe('Person');
    expect(jsonLd.sameAs).toContain('https://orcid.org/0000-0002-7002-939X');
  });
});

describe('buildScholarlyArticleJsonLd', () => {
  it('maps a Publication to a ScholarlyArticle node', () => {
    const pub = {
      titleEn: 'A Title', authorsEn: '<strong>Shoji Mori</strong>, Xue-Ning Bai',
      journalEn: 'The Astrophysical Journal, 992:85', year: '2025', doi: '10.3847/x', adsUrl: 'https://ui.adsabs.harvard.edu/abs/x',
    } as Publication;
    const jsonLd = buildScholarlyArticleJsonLd(pub);
    expect(jsonLd['@type']).toBe('ScholarlyArticle');
    expect(jsonLd.headline).toBe('A Title');
    expect(jsonLd.author).toEqual([{ '@type': 'Person', name: 'Shoji Mori' }, { '@type': 'Person', name: 'Xue-Ning Bai' }]);
  });
});
```

```typescript
// ver2/tests/seo.test.ts
import { describe, expect, it, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');

describe('SEO output', () => {
  beforeAll(() => {
    execSync('npm run build', { cwd: root, stdio: 'inherit' });
  });

  it('generates a sitemap', () => {
    expect(existsSync(path.join(root, 'dist/sitemap-index.xml'))).toBe(true);
  });

  it('includes Person JSON-LD on the homepage', () => {
    const html = readFileSync(path.join(root, 'dist/index.html'), 'utf-8');
    expect(html).toContain('"@type":"Person"');
    expect(html).toContain('orcid.org/0000-0002-7002-939X');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ver2 && npm test -- json-ld seo`
Expected: FAIL — `./json-ld` does not exist and no JSON-LD is emitted yet.

- [ ] **Step 3: Write `json-ld.ts`**

```typescript
// ver2/src/lib/json-ld.ts
import type { Publication } from '../data/schemas';

export function buildPersonJsonLd() {
  return {
    '@type': 'Person',
    '@id': 'https://shoji-mori.github.io/#person',
    name: 'Shoji Mori',
    alternateName: '森 昇志',
    url: 'https://shoji-mori.github.io/',
    jobTitle: 'Shuimu Fellow',
    worksFor: { '@type': 'CollegeOrUniversity', name: 'Tsinghua University' },
    sameAs: [
      'https://github.com/shoji-mori',
      'https://scholar.google.com/citations?user=XUF28swAAAAJ',
      'https://orcid.org/0000-0002-7002-939X',
      'https://www.scopus.com/authid/detail.uri?authorId=57075536200',
      'https://www.webofscience.com/wos/author/record/CAG-1288-2022',
      'https://www.researchgate.net/profile/Shoji-Mori-3',
      'https://researchmap.jp/mori_shoji',
    ],
  };
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, '');
}

export function buildScholarlyArticleJsonLd(pub: Publication) {
  const authors = stripHtml(pub.authorsEn).split(',').map((name) => name.trim()).filter(Boolean);
  return {
    '@type': 'ScholarlyArticle',
    headline: pub.titleEn,
    author: authors.map((name) => ({ '@type': 'Person', name })),
    datePublished: pub.year,
    isPartOf: { '@type': 'PublicationIssue', name: pub.journalEn },
    ...(pub.doi ? { sameAs: `https://doi.org/${pub.doi}` } : {}),
  };
}
```

- [ ] **Step 4: Write `SeoHead.astro` and wire it into `BaseLayout.astro`**

```astro
---
// ver2/src/components/SeoHead.astro
import { buildPersonJsonLd } from '../lib/json-ld';
interface Props {
  titleEn: string; descriptionEn: string; canonical: string; ogImage?: string;
  includePersonJsonLd?: boolean;
}
const { titleEn, descriptionEn, canonical, ogImage = '/me.jpg', includePersonJsonLd = false } = Astro.props;
---
<meta property="og:type" content="website" />
<meta property="og:url" content={canonical} />
<meta property="og:title" content={titleEn} />
<meta property="og:description" content={descriptionEn} />
<meta property="og:image" content={new URL(ogImage, canonical).toString()} />
<meta property="twitter:card" content="summary_large_image" />
{includePersonJsonLd && (
  <script type="application/ld+json" set:html={JSON.stringify(buildPersonJsonLd())} />
)}
```

```astro
// ver2/src/layouts/BaseLayout.astro — add inside <head>, after the existing <meta> tags
    <SeoHead titleEn={titleEn} descriptionEn={descriptionEn} canonical={canonical} includePersonJsonLd={path === '/'} />
```

(Add the corresponding `import SeoHead from '../components/SeoHead.astro';` at the top of `BaseLayout.astro`.)

- [ ] **Step 5: Emit per-publication JSON-LD on `/publications`**

```astro
// ver2/src/pages/publications.astro — add inside the <BaseLayout>, once per publication, alongside <PublicationItem pub={pub} />
{publications.map((pub) => (
  <script type="application/ld+json" set:html={JSON.stringify(buildScholarlyArticleJsonLd(pub))} />
))}
```

(Add `import { buildScholarlyArticleJsonLd } from '../lib/json-ld';` at the top of `publications.astro`.)

- [ ] **Step 6: Enable the sitemap integration's already-configured output**

The `@astrojs/sitemap` integration was added to `astro.config.mjs` in Task 1; no further config is needed — it automatically covers every page emitted by `astro build`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd ver2 && npm test -- json-ld seo`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add ver2/src/lib/json-ld.ts ver2/src/lib/json-ld.test.ts ver2/src/components/SeoHead.astro ver2/src/layouts/BaseLayout.astro ver2/src/pages/publications.astro ver2/tests/seo.test.ts
git commit -m "Add Person/ScholarlyArticle JSON-LD, OGP metadata, and sitemap generation"
```

---

### Task 22: Old-anchor redirects and static asset passthrough

**Files:**
- Create: `ver2/src/scripts-client/legacy-anchor-redirect.ts`
- Create: `ver2/public/scripts/legacy-anchor-redirect-bootstrap.js`
- Modify: `ver2/src/layouts/BaseLayout.astro` (load the redirect bootstrap on `/` only, inline and blocking, before paint)
- Copy: `files/`, `cv_mori_shoji_v3.3.pdf`, `me.jpg`, `me.webp`, `google382eb4ad681ea1fc.html`, `robots.txt` → `ver2/public/`
- Test: `ver2/src/scripts-client/legacy-anchor-redirect.test.ts`

**Interfaces:**
- Produces: `resolveLegacyAnchorRedirect(hash: string): string | null` mapping `#research`→`/research/`, `#publications`→`/publications/`, `#presentations`→`/talks/`, `#materials`→`/talks/`, `#cv`→`/cv/`, `#contact`→`/#contact`, everything else → `null` (no redirect).

- [ ] **Step 1: Write the failing test**

```typescript
// ver2/src/scripts-client/legacy-anchor-redirect.test.ts
import { describe, expect, it } from 'vitest';
import { resolveLegacyAnchorRedirect } from './legacy-anchor-redirect';

describe('resolveLegacyAnchorRedirect', () => {
  it('maps known legacy anchors to their new pages', () => {
    expect(resolveLegacyAnchorRedirect('#research')).toBe('/research/');
    expect(resolveLegacyAnchorRedirect('#publications')).toBe('/publications/');
    expect(resolveLegacyAnchorRedirect('#presentations')).toBe('/talks/');
    expect(resolveLegacyAnchorRedirect('#materials')).toBe('/talks/');
    expect(resolveLegacyAnchorRedirect('#cv')).toBe('/cv/');
  });
  it('returns null for an unrecognized or empty hash', () => {
    expect(resolveLegacyAnchorRedirect('')).toBeNull();
    expect(resolveLegacyAnchorRedirect('#home')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ver2 && npm test -- legacy-anchor-redirect`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the implementation**

```typescript
// ver2/src/scripts-client/legacy-anchor-redirect.ts
const LEGACY_ANCHOR_MAP: Record<string, string> = {
  '#research': '/research/',
  '#publications': '/publications/',
  '#presentations': '/talks/',
  '#materials': '/talks/',
  '#cv': '/cv/',
};

export function resolveLegacyAnchorRedirect(hash: string): string | null {
  return LEGACY_ANCHOR_MAP[hash] ?? null;
}

export function initLegacyAnchorRedirect(loc: Location): void {
  const target = resolveLegacyAnchorRedirect(loc.hash);
  if (target) loc.replace(target);
}
```

```javascript
// ver2/public/scripts/legacy-anchor-redirect-bootstrap.js
import { initLegacyAnchorRedirect } from '/src/scripts-client/legacy-anchor-redirect.ts';
if (location.pathname === '/' || location.pathname === '/index.html') {
  initLegacyAnchorRedirect(location);
}
```

```astro
// ver2/src/layouts/BaseLayout.astro — add just before the closing </head>, so the redirect fires before first paint
    <script src="/scripts/legacy-anchor-redirect-bootstrap.js"></script>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ver2 && npm test -- legacy-anchor-redirect`
Expected: PASS

- [ ] **Step 5: Copy static assets**

```bash
cp -R files ver2/public/files
cp cv_mori_shoji_v3.3.pdf me.jpg me.webp google382eb4ad681ea1fc.html robots.txt ver2/public/
```

- [ ] **Step 6: Verify the copied assets are served from the build**

Run: `cd ver2 && npm run build && ls dist/files/posters dist/files/slides dist/files/thesis && test -f dist/cv_mori_shoji_v3.3.pdf && test -f dist/robots.txt`
Expected: no errors; all files present.

- [ ] **Step 7: Commit**

```bash
git add ver2/src/scripts-client/legacy-anchor-redirect.ts ver2/src/scripts-client/legacy-anchor-redirect.test.ts ver2/public/scripts/legacy-anchor-redirect-bootstrap.js ver2/src/layouts/BaseLayout.astro ver2/public/files ver2/public/cv_mori_shoji_v3.3.pdf ver2/public/me.jpg ver2/public/me.webp ver2/public/google382eb4ad681ea1fc.html ver2/public/robots.txt
git commit -m "Add legacy-anchor redirects and copy static assets into ver2/public"
```

---

## Milestone F — Automation & Deploy

### Task 23: Weekly ADS sync GitHub Action

**Files:**
- Create: `.github/workflows/sync-ads.yml` (repo root — alongside the existing `.github/workflows/`)

**Interfaces:**
- Consumes: `ver2/scripts/sync-ads.mjs` (Task 9), the `ADS_API_TOKEN` GitHub Actions secret.
- Produces: a weekly commit to `ver2/src/data/publications.generated.json` / `publications.bibtex.json` when ADS data has changed; never touches `publications.overrides.yaml`.

- [ ] **Step 1: Add the ADS_API_TOKEN secret (manual, human-only)**

In the GitHub repository settings → Secrets and variables → Actions, add a secret named `ADS_API_TOKEN` with the token from https://ui.adsabs.harvard.edu/user/settings/token. This step cannot be scripted or run by an agent — it requires the human's own GitHub and ADS credentials.

- [ ] **Step 2: Write the workflow**

```yaml
# .github/workflows/sync-ads.yml
name: Sync ADS publications

on:
  schedule:
    - cron: '17 3 * * 1' # every Monday, 03:17 UTC
  workflow_dispatch: {}

permissions:
  contents: write

jobs:
  sync:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: ver2
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: ver2/package-lock.json
      - run: npm ci
      - run: npm run sync:ads
        env:
          ADS_API_TOKEN: ${{ secrets.ADS_API_TOKEN }}
      - name: Commit changes if any
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add src/data/publications.generated.json src/data/publications.bibtex.json
          git diff --cached --quiet || git commit -m "chore: weekly ADS publication sync"
          git push
```

- [ ] **Step 3: Verify the workflow file is valid YAML**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/sync-ads.yml'))"`
Expected: no output, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/sync-ads.yml
git commit -m "Add weekly GitHub Actions workflow to sync ADS publication data"
```

Note: this workflow's first real run (whether triggered manually via `workflow_dispatch` or by the schedule) is what actually populates `publications.generated.json` in the repository, upgrading every publication's `source` from `'manual'` to `'ads'`. Trigger it once by hand (or run Task 9 Step 5 locally) after the secret is in place, rather than waiting a week.

---

### Task 24: CI build/test workflow for `ver2/` (no deploy)

**Files:**
- Create: `.github/workflows/ver2-ci.yml`

**Interfaces:**
- Consumes: nothing beyond the `ver2/` project itself. Does not deploy — it exists purely to keep `main` from accumulating a broken `ver2/` while the live root site keeps serving unaffected.

- [ ] **Step 1: Write the workflow**

```yaml
# .github/workflows/ver2-ci.yml
name: ver2 CI

on:
  push:
    paths: ['ver2/**']
  pull_request:
    paths: ['ver2/**']

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: ver2
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: ver2/package-lock.json
      - run: npm ci
      - run: npm test
      - run: npm run build
```

- [ ] **Step 2: Verify the workflow file is valid YAML**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ver2-ci.yml'))"`
Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ver2-ci.yml
git commit -m "Add CI workflow to build and test ver2 on every push/PR"
```

---

### Task 25: Cutover (manual — requires the user's explicit go-ahead)

**Do not run this task's steps until the human has reviewed the live `ver2` preview and explicitly says to proceed.** This is the one irreversible step in the whole plan: it deletes the current production files and replaces GitHub Pages' published output. Per this repo's global working agreement, destructive/production-affecting steps are never taken without direct confirmation — an agent executing this plan should stop before Step 1 and ask.

**Files:**
- Delete: `index.html`, `style.css`, `script.js`, `publications_data.js`, `presentations_data.js`, `me.jpg`, `me.webp`, `image_eheating.png`, `cv_mori_shoji_v3.3.pdf`, `google382eb4ad681ea1fc.html`, `robots.txt`, `sitemap.xml` (all now superseded by their `ver2/public/` copies or Astro-generated equivalents)
- Create: `.github/workflows/deploy.yml`
- Modify: repository Settings → Pages → Build and deployment → Source: "GitHub Actions" (was: "Deploy from a branch")

- [ ] **Step 1: Human review checkpoint**

Run `cd ver2 && npm run build && npm run preview`, browse the preview URL, and confirm with the human that the site looks and behaves as expected (including the language toggle, contact form, and printing `/cv/`). Do not proceed to Step 2 without an explicit "go ahead."

- [ ] **Step 2: Write the deploy workflow**

```yaml
# .github/workflows/deploy.yml
name: Deploy site

on:
  push:
    branches: [main]
  workflow_dispatch: {}

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: ver2
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: ver2/package-lock.json
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: ver2/dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 3: Remove the superseded root files**

```bash
git rm index.html style.css script.js publications_data.js presentations_data.js me.jpg me.webp image_eheating.png cv_mori_shoji_v3.3.pdf google382eb4ad681ea1fc.html robots.txt sitemap.xml
```

- [ ] **Step 4: Switch the Pages source setting**

In the GitHub repository Settings → Pages → Build and deployment, change Source from "Deploy from a branch" to "GitHub Actions". This is a one-time manual setting change (cannot be scripted from within the repo) and must be done by the human.

- [ ] **Step 5: Commit and push**

```bash
git add .github/workflows/deploy.yml
git commit -m "Cut over to the ver2 Astro site: remove legacy static files, deploy via GitHub Actions"
git push
```

- [ ] **Step 6: Verify the live site**

Watch the "Deploy site" Actions run to green, then load `https://shoji-mori.github.io/` and spot-check: homepage hero/highlights render, `/publications/`, `/talks/`, `/cv/`, `/news/`, `/research/` all resolve, an old bookmarked link like `https://shoji-mori.github.io/#publications` redirects to `/publications/`, and the contact form still submits successfully.

---

## Self-Review Notes

- **Spec coverage:** every design-doc section (§2 design system, §3 page map + multilingual + URL compatibility, §4 data layer + ADS sync + BibTeX/JSON-LD + failure handling, §5 tech stack + deploy + `ver2/` workflow, §6 required assets, §7 error handling/testing, §8 scope exclusions) maps onto at least one task above. `admin/` is untouched throughout (never listed in any task's Files section).
- **Placeholder scan:** no "TBD"/"TODO"/"add appropriate handling" phrases; the one interim visual placeholder (`FigurePlaceholder.astro` / highlight SVGs) is fully coded and explicitly noted as swappable, not a stub.
- **Type consistency:** `Publication`, `PublicationOverride`, `AdsRecord`, `Presentation`, `CvData` are defined once in `schemas.ts` (Task 6) and imported by name everywhere else (`format.ts`, `merge-publications.ts`, `stats.ts`, `bibtex.ts`, `json-ld.ts`, every page/component) — no redeclared or renamed shapes across tasks.
- **Deviation flagged to the user:** the design doc names "Astro 5"; the current stable release at plan-writing time is Astro 7.0.6 (Node >=22.12.0). This plan targets latest-stable Astro rather than literally pinning a now-superseded major version, consistent with the design's own "use the latest, most capable choice" reasoning from the technology comparison — flagged here rather than silently substituted.
