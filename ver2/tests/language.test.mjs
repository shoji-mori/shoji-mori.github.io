import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const template = readFileSync(new URL('../src/layouts/base.html', import.meta.url), 'utf8');
const initializer = html => html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
const script = initializer(template);

function initialLanguage({ languages, language, selected, query = '', blocked = false } = {}) {
  const classes = new Set();
  const html = {
    lang: 'en',
    classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); } },
  };
  runInNewContext(script, {
    URLSearchParams,
    location: { search: query },
    navigator: { languages, language },
    document: { documentElement: html },
    sessionStorage: {
      getItem(key) {
        assert.equal(key, 'site-language');
        if (blocked) throw new Error('Storage is unavailable');
        return selected ?? null;
      },
      setItem() { assert.fail('Automatic detection must not save a manual preference'); },
    },
  });
  assert.equal(classes.has('lang-ja'), html.lang === 'ja');
  return html.lang;
}

test('the highest-priority browser language selects Japanese or falls back to English', () => {
  for (const locale of ['ja', 'ja-JP', 'ja-JP-u-ca-japanese', 'JA-jp']) {
    assert.equal(initialLanguage({ languages: [locale, 'en-US'] }), 'ja');
  }
  for (const locale of ['en-US', 'zh-TW', 'fr-FR']) {
    assert.equal(initialLanguage({ languages: [locale, 'ja'] }), 'en');
  }
  assert.equal(initialLanguage({ languages: [], language: 'ja-JP' }), 'ja');
  assert.equal(initialLanguage(), 'en');
});

test('an explicit tab preference takes precedence over the browser environment', () => {
  assert.equal(initialLanguage({ languages: ['ja-JP'], selected: 'en' }), 'en');
  assert.equal(initialLanguage({ languages: ['en-US'], selected: 'ja' }), 'ja');
  assert.equal(initialLanguage({ languages: ['ja-JP'], selected: 'invalid' }), 'ja');
});

test('supported link languages override tab preferences; unknown values do not', () => {
  assert.equal(initialLanguage({ languages: ['ja'], selected: 'ja', query: '?lang=en' }), 'en');
  assert.equal(initialLanguage({ languages: ['en'], selected: 'en', query: '?lang=ja' }), 'ja');
  assert.equal(initialLanguage({ languages: ['ja'], query: '?lang=fr' }), 'ja');
  assert.equal(initialLanguage({ languages: ['ja'], query: '?lang=' }), 'ja');
});

test('restricted storage still allows environment detection and explicit language links', () => {
  assert.equal(initialLanguage({ languages: ['ja-JP'], blocked: true }), 'ja');
  assert.equal(initialLanguage({ languages: ['en-US'], blocked: true }), 'en');
  assert.equal(initialLanguage({ languages: ['ja-JP'], query: '?lang=en', blocked: true }), 'en');
});

test('all regular published pages use the template language initializer before rendering', () => {
  for (const page of ['index.html', 'research/index.html', 'publications/index.html', 'talks/index.html', 'cv/index.html', '404.html']) {
    const html = readFileSync(new URL('../../' + page, import.meta.url), 'utf8');
    assert.equal(initializer(html), script, page);
    assert(html.indexOf('<script>') < html.indexOf('</head>'), page);
  }
});
