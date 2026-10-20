// Disk Lab v2: the page around the GPU engine (engine/disk3d.js, v2's own engine: see engine/CHANGES.md).
// The page decides whether the live model can run (quality.js), loads the engine, lays out the sandbox (the rail: look,
// what is shown, cut, variants, time, view) and the highlights (places.js), and keeps its controls in step with the
// engine through the engine's public API and events.
// See DESIGN.md for the reasons behind each choice.
import { PLACES, placeById, placeState, fitDistance } from './places.js?v=814f93ec9f';
import { WORDS } from './words.js?v=f608a7fcff';
import { probe, calibrate, govern, scaleFor, MIN_SCALE } from './quality.js?v=05d0e32989';
import { snapshot, toPng } from './capture.js?v=aa82de203b';

const ENGINE_SRC = 'engine/disk3d.js?v=c4568da63d';   // ?v= the first ten characters of the engine's SHA-256 (engine/SOURCE.txt)
// The version, shown small at the foot of the rail and in the About dialog: MAJOR.MINOR, raised a little with each update
// of the public page (MINOR for new features or physics, a third number for small fixes). History: CHANGELOG.md.
// (round 10a) A development build (/disk-lab/dev/, made by ver2/tools/disk-lab-v2/make-dev.sh) carries MAJOR.MINOR-dev.N,
// N one more with each one published. The same line is written into index.html (every [data-version], and the short tag in
// the bar, [data-version-tag]) so that it shows without the script, on a page that has stopped too; check.js compares them.
const VERSION = '1.8-dev.2', RELEASED = '2026-10-20';
const VERSION_LINE = `Disk Lab v${VERSION} (${RELEASED}) · engine ${ENGINE_SRC.split('v=')[1]}`;
// (round 10a) The keys this build keeps on the device (localStorage, sessionStorage): the public page's as before; a
// development build puts a prefix of its own in index.html's meta disk-lab-store (make-dev.sh), so that its records and
// settings never reach the public page on the same origin, nor the public page's its own
const STORE = (document.querySelector('meta[name="disk-lab-store"]') || {}).content || '';
const KEY = (k) => STORE + k;
// The citation (the page asks to be cited in research and talks): its address in one place, to change when the page
// moves from its hidden address to its public one.
const CITE_URL = 'https://shoji-mori.github.io/disk-lab/', CITE_YEAR = 2026;
// The quality the viewer may fix (render scale; Auto: the governor, and the sharpening of still pictures)
const QUALITY = { low: 0.35, mid: 0.55, high: 0.8, full: 1 };
// (round 8) the engine's finish for each level (its opt.fx: 0 none, 1 the starlight's shading, the tone and the depth's haze,
// 2 also the glow of the bright parts); Auto by the scale calibrated at the start (DESIGN.md, section 21)
const FX_OF = { low: 0, mid: 1, high: 2, full: 2 };
const fxAuto = () => { const sc = (diag.calibration && diag.calibration.scale) || 0.5; return sc >= 0.7 ? 2 : sc >= 0.45 ? 1 : 0; };

const html = document.documentElement;
const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches || q.get('motion') === 'reduce';
const coarse = matchMedia('(pointer: coarse)').matches;
// (round 9) the kind of device, for the guard against long frames, its defaults and what to say when WebGL stops
// (DESIGN.md, section 22): iOS and iPadOS (every browser there is WebKit; iPadOS calls itself a Mac with touch), Safari on a
// Mac, a phone or tablet
const UA = navigator.userAgent || '';
const IOS = /iPhone|iPad|iPod/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
const MAC_SAFARI = !IOS && /Macintosh/.test(UA) && /Safari\//.test(UA) && !/Chrome|Chromium|Edg|OPR|Firefox/.test(UA);
const MOBILE = IOS || /Android|Mobi/i.test(UA);
const APP = /CriOS/.test(UA) ? 'Chrome' : /FxiOS/.test(UA) ? 'Firefox' : /EdgiOS/.test(UA) ? 'Edge' : 'Safari';
const RESTART = IOS ? 'ios' : MAC_SAFARI ? 'mac' : 'other';
const L = () => (html.lang === 'ja' ? 'ja' : 'en');
const T = () => WORDS[L()];

const lab = $('lab'), stage = $('stage'), box = $('disk'), poster = $('poster');
const routeList = $('routeList'), placeText = $('placeText'), placeTitle = $('placeTitle'), placeActions = $('placeActions');
const lookGroup = $('lookGroup'), lookNote = $('lookNote'), lookContext = $('lookContext'), cutContext = $('cutContext');
const playBtn = $('play'), rail = $('rail');
const stageHint = $('stageHint'), stageNote = $('stageNote'), stillNote = $('stillNote'), matKey = $('matKey'), matList = $('matList');
const LOOKS = ['model', 'optical', 'mir', 'mm', 'co'];
const SPIN_DEG = 0.004 * 180 / Math.PI;   // the engine's slow turn of the view (data-spin, rad per second of the clock)

let mode = 'loading';           // 'loading' | 'live' | 'still'
let stillReason = null;
let placeI = 0;
let target = null;              // the engine state of the place arrived at, and the clock then (see away)
let gov = null;
let burstUntil = 0;
const diag = { version: VERSION, engine: ENGINE_SRC, reduce, probe: null, calibration: null, timings: {} };
const t0 = performance.now();
// (round 10a, for checks) ?caps=webkit: the extensions that Safari on iOS lacks taken away from every WebGL2 context of the
// page (getExtension gives null, getSupportedExtensions leaves them out), so that a desktop's Chrome draws as WebKit would
// choose to: no GPU timer queries (the page then guards as on a phone, and measures by fences only), no parallel link
// (FULL linked while the page waits). Joined with '+': lin, no OES_texture_float_linear; blend, no EXT_float_blend; half,
// no EXT_color_buffer_float (half-float targets only). Set before the probe and the engine see a context.
const CAPS = q.get('caps') || '';
if (/webkit/.test(CAPS) && typeof WebGL2RenderingContext !== 'undefined') {
  const drop = new Set(['EXT_disjoint_timer_query_webgl2', 'KHR_parallel_shader_compile']);
  if (/lin/.test(CAPS)) drop.add('OES_texture_float_linear');
  if (/blend/.test(CAPS)) drop.add('EXT_float_blend');
  if (/half/.test(CAPS)) drop.add('EXT_color_buffer_float');
  const P = WebGL2RenderingContext.prototype, getExt = P.getExtension, getAll = P.getSupportedExtensions;
  P.getExtension = function (n) { return drop.has(n) ? null : getExt.call(this, n); };
  P.getSupportedExtensions = function () { return (getAll.call(this) || []).filter((n) => !drop.has(n)); };
}
// (round 10a, for checks) ?caps=nogl: no WebGL2 context at all, as in a browser whose WebGL has stopped
if (/nogl/.test(CAPS) && typeof HTMLCanvasElement !== 'undefined') {
  const getCtx = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (t, a) { return t === 'webgl2' ? null : getCtx.call(this, t, a); };
}
// (round 10a) The GL objects this page's contexts make and free, by kind, and the bytes of textures and buffers allocated:
// for the flight record, to see whether anything accumulates over a visit (the owner's iPhone lost its GPU some 20 s into
// the visible look). Counted where they are made, in the page; no GL query
const glc = { live: {}, made: {}, mb: 0 };
if (typeof WebGL2RenderingContext !== 'undefined') {
  const P = WebGL2RenderingContext.prototype, BPP = { 0x881a: 8, 0x8814: 16, 0x8058: 4, 0x822d: 2, 0x822f: 4, 0x822e: 4, 0x8230: 8, 0x8c43: 4 };
  const add = (k, v) => { glc.live[k] = (glc.live[k] || 0) + v; if (v > 0) glc.made[k] = (glc.made[k] || 0) + 1; };
  for (const kind of ['Texture', 'Buffer', 'Framebuffer', 'Renderbuffer', 'Program', 'Shader', 'Query', 'VertexArray', 'Sampler']) {
    const mk = P['create' + kind], rm = P['delete' + kind];
    if (mk) P['create' + kind] = function (...a) { add(kind, 1); return mk.apply(this, a); };
    if (rm) P['delete' + kind] = function (o) { if (o) add(kind, -1); return rm.call(this, o); };
  }
  const fs = P.fenceSync, ds = P.deleteSync, ts2 = P.texStorage2D, ts3 = P.texStorage3D, bd = P.bufferData;
  P.fenceSync = function (...a) { add('Sync', 1); return fs.apply(this, a); };
  P.deleteSync = function (o) { if (o) add('Sync', -1); return ds.call(this, o); };
  P.texStorage2D = function (t, l, f, w, h) { glc.mb += w * h * (BPP[f] || 4) / 1048576; return ts2.call(this, t, l, f, w, h); };
  P.texStorage3D = function (t, l, f, w, h, d) { glc.mb += w * h * d * (BPP[f] || 4) / 1048576; return ts3.call(this, t, l, f, w, h, d); };
  P.bufferData = function (t, x, ...r) { glc.mb += (typeof x === 'number' ? x : x && x.byteLength || 0) / 1048576; return bd.call(this, t, x, ...r); };
}
// (round 10a, switches to try on a phone, recorded with the visit) ?duty=off, or a fraction: the GPU's duty (see the engine's
// diskDuty; a guarded device 0.5 by default); ?ctmax=N, the continuum's iterations at most; ?eddy=0, no eddies' volume;
// ?fps=N, the frame rate while only the clock moves
const SWITCH = { duty: q.get('duty'), ctmax: Number(q.get('ctmax')) || 0, eddy: q.get('eddy') === '0', fps: Number(q.get('fps')) || 0 };
// (round 9) the last visit's record (see record): a visit that ended with drawing stopped, or "Try again", starts safe
// (round 10a: judged from its phase and its flight record, judgePrev: only what is broken counts, not a page closed or put
// in the background while it started or changed its look)
const REC = KEY('disk-lab-session'), BAD_END = ['starting', 'changing', 'lost', 'stuck', 'failed', 'blocked'];
const readJSON = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const prevRec = readJSON(REC);
const LOG = KEY('disk-lab-log'), LOG_BAD = KEY('disk-lab-log-bad');
const prevLog = (() => { const l = readJSON(LOG); return l && Array.isArray(l.e) ? l : null; })();
const verdict = judgePrev(prevRec, prevLog);
const crashed = verdict.bad;
let phase = '';
// (round 9) the visitor's settings and view, kept on this device (see settingsNow). (Round 10a: no longer thrown away
// after a bad end: the safe start leaves them unapplied this once, and its note offers them back, restoreKept)
const SET = KEY('disk-lab-settings');
const saved = (() => { const v = readJSON(SET); return v && v.v === 1 ? v : null; })();

// ---------- small helpers ----------
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...kids.filter((k) => k != null));
  return e;
};
const pressed = (b, on) => b.setAttribute('aria-pressed', String(!!on));
const live = () => mode === 'live' && typeof box.diskState === 'function';
const S = () => box.diskState();
const aspect = () => (stage.clientWidth && stage.clientHeight ? stage.clientWidth / stage.clientHeight : 16 / 9);
let noteTimer = 0;
function note(text, ms = 2600) {
  clearTimeout(noteTimer);
  stageNote.textContent = text; stageNote.classList.toggle('on', !!text);
  if (text && ms) noteTimer = setTimeout(() => stageNote.classList.remove('on'), ms);
}

// ---------- the stage's size: the engine takes its height from data-aspect ----------
function fitStage() {
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return;
  const a = (h / w).toFixed(4);
  if (box.dataset.aspect !== a) box.dataset.aspect = a;
  if (mode !== 'live') setPoster(PLACES[placeI].id);
}
new ResizeObserver(fitStage).observe(stage);

// ---------- still pictures (the poster while loading, the pictures when the live model cannot run) ----------
let posterKey = poster.getAttribute('src') || '';   // (index.html puts up the whole disk's before the first render)
// (stills/<place>-<lang>-wide.webp is 2400 x 1200, -tall.webp 1200 x 1500, both with the annotations in that language;
// made by ver2/tools/disk-lab-v2/stills.html. Shown with object-fit: cover, so a frame of another shape crops the sides
// or the top and bottom of the same composition.)
// In the still pictures' own screen the stage takes the still's proportions (see .lab[data-state=still] in the CSS), so
// that nothing of it is cut away (the scale bar and the keys of the cut faces sit near its edges); the frame is chosen
// from the window, leaving the dock about 260 px.
function setPoster(id) {
  const ar = mode === 'still' ? innerWidth / Math.max(1, innerHeight - 260) : aspect();
  const frame = ar >= 1.2 ? 'wide' : 'tall', src = `../stills/${id}-${L()}-${frame}.webp`;
  lab.style.setProperty('--still-ar', frame === 'wide' ? '2' : '0.8');
  if (src === posterKey) return;
  posterKey = src;
  poster.src = src;
}

// ---------- the material key (round 8): the model look's colours, one per material (the engine's MAT, box.diskPalette) ----------
// (the owner: "colour the model look by material, not by temperature"; the temperature's bar that stood here went with it)
// Only the materials shown, and those that show at this distance: the envelope from 40 au, the star's magnetosphere and
// curtains within 2 au of the star; the pebbles' rock and ice on one row.
let matShown = '';
function renderMatKey(s) {
  const on = s.look === 'model' && !s.slice && !!s.ann && typeof box.diskPalette === 'function';
  matKey.classList.toggle('on', on);
  if (!on) return;
  const P = Object.fromEntries(box.diskPalette().map((m) => [m.key, m])), rows = [];
  if (s.mode & 3) rows.push(['disk'], ['acc']);
  if (s.mode & 4) rows.push(['rock', 'ice']);
  if (s.mode & 8) rows.push(['wind']);
  if (s.mode & 64) rows.push(['jet']);
  if ((s.mode & 32) && s.d > 40) rows.push(['env']);
  if ((s.mode & 16) && s.planets.some((p) => p[1])) rows.push(['planet']);
  if (s.d < 2 && !s.p) rows.push(['mag'], ['curt']);
  if (s.marks && (s.mode & 1)) rows.push(['arrows']);   // (round 8: the flow arrows, with what their length means)
  const key = L() + JSON.stringify(rows);
  if (key === matShown) return;
  matShown = key;
  matList.replaceChildren(...rows.map((ks) => ks[0] === 'arrows' ? el('li', {}, el('i', { class: 'arr' }, '\u2192'), el('span', {}, T().arrowsKey))
    : el('li', {}, ...ks.map((k) => el('i', { style: 'background:' + P[k].hex })), el('span', {}, ks.length > 1 ? T().pebblesKey : P[ks[0]][L()]))));
}

// ---------- the route (places) ----------
const routeButtons = PLACES.map((p, i) => {
  const b = el('button', { type: 'button', 'data-place': p.id, onclick: () => goPlace(i) }, el('span', { class: 'n' }, String(i + 1)), el('span', { class: 'name' }));
  routeList.append(el('li', {}, b));
  return b;
});
$('prev').addEventListener('click', () => goPlace(placeI - 1));
$('next').addEventListener('click', () => goPlace(placeI + 1));

function goPlace(i, { fly = true } = {}) {
  placeI = Math.min(PLACES.length - 1, Math.max(0, i));
  const pl = PLACES[placeI];
  if (live()) {
    const st = placeState(pl, S().mode, aspect());
    // (the planet's place shows the first planet at 3 au, as its text says; others are kept)
    // (round 8: a Jupiter, as the place's text says)
    if (pl.id === 'planet') { const ps = S().planets.filter((p, j) => j > 0 && roomFor([[3, 1, 1]], p[0], -1, p[2])); st.planets = [[3, 1, 1], ...ps].slice(0, 4); st.pi = 0; }
    else if ((pl.needs & 16) && !S().planets.some((p) => p[1])) st.planets = [[3, 1, 1]];
    guardSwitch(keyOf({ ...S(), ...st }));   // (round 9: the scale lowered first if the place's look or cut is dearer)
    box.diskSet({ ...st, fly: fly && !reduce ? 1 : 0 });
    target = { ...st, time: S().time };
    // (the default Best starts each place from 100 %: its quiet steps were for the view left)
    if (bestDefault() && st.look !== 'co') bestReset();
    if (quality !== 'auto') { relaxGuard(); applyFixed(); }
  } else setPoster(pl.id);
  renderPlace();
  sync();
  const b = routeButtons[placeI];
  if (b.scrollIntoView) b.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduce ? 'auto' : 'smooth' });
}

// Has the view been moved away from the place? (the elevation, the distance, the point looked at, the cut, following the
// planet; the azimuth against the engine's slow turn of the view since the arrival)
function away() {
  if (!target || !live()) return false;
  const s = S();
  if (s.slice !== target.slice || s.p !== target.p) return true;
  if (Math.abs(s.el - target.el) > 1.5 || Math.abs(Math.log(s.d / target.d)) > 0.12) return true;
  if (Math.hypot(s.tx, s.ty, s.tz) > 0.03 * s.d) return true;
  const drift = s.p || reduce ? 0 : SPIN_DEG * (s.time - target.time);
  const daz = ((s.az - target.az - drift) % 360 + 540) % 360 - 180;
  return Math.abs(daz) > 3;
}

// ---------- text ----------
function renderPlace() {
  const pl = PLACES[placeI], w = T().places[pl.id];
  placeTitle.textContent = w.title;
  // (a new text comes in softly, unless motion is reduced)
  if (placeText.textContent !== w.text && placeText.textContent && !reduce && placeText.animate) {
    placeText.animate([{ opacity: 0, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,.7,.2,1)' });
  }
  placeText.textContent = w.text;
  routeButtons.forEach((b, i) => {
    b.querySelector('.name').textContent = T().places[PLACES[i].id].short;
    b.setAttribute('aria-current', String(i === placeI));
  });
  $('prev').disabled = placeI === 0; $('next').disabled = placeI === PLACES.length - 1;
  if (mode === 'still') poster.alt = w.title;
}

function renderAll() {
  const w = T();
  document.querySelectorAll('[data-aria-en]').forEach((e) => e.setAttribute('aria-label', e.dataset[L() === 'ja' ? 'ariaJa' : 'ariaEn']));
  $('prev').setAttribute('aria-label', w.prev); $('next').setAttribute('aria-label', w.next);
  $('route').setAttribute('aria-label', w.ariaRoute);
  lookGroup.setAttribute('aria-label', L() === 'ja' ? '見え方' : 'Look');
  stageHint.textContent = coarse ? w.hintTouch : w.hintMouse;
  const retry = document.getElementById('stageRetry');   // (the retry panel, if shown, in the new language)
  if (retry && !retry.hidden) { retry.firstElementChild.textContent = retryWords(); document.getElementById('retryLive').textContent = w.still.retry; }
  document.querySelectorAll('.lang-switch [data-lang]').forEach((b) => pressed(b, b.dataset.lang === L()));
  document.title = 'Disk Lab | ' + (L() === 'ja' ? '森 昇志' : 'Shoji Mori');
  renderPlace();
  renderLooks();
  renderComps();
  renderQuality();
  renderSaveSize();
  renderCite();
  renderStillNote();
  sync();
}

// ---------- looks ----------
const lookButtons = LOOKS.map((k) => {
  const b = el('button', { type: 'button', 'data-look': k, 'aria-pressed': 'false', onclick: () => setLook(k) });
  lookGroup.append(b);
  return b;
});
function renderLooks() { lookButtons.forEach((b) => { b.textContent = T().looks[b.dataset.look].label; }); }
function setLook(k) {
  if (!live()) return;
  const s = S();
  flogAdd({ k: 'set', look: k }); keeping = keeping || calibrated;   // (round 10a: see the flight recorder; a choice made after a safe start is kept)
  if (keyOf({ ...s, look: k, slice: k === 'model' ? s.slice : 0 }) === gc.key) gc.hold = GUARD_HOLD;   // (round 10a: the same look chosen again: the cap's shortest hold)
  // (an observed look has no cut: close it where the camera is, rather than flying back to the whole disk as the engine
  // does when the look alone is changed)
  guardSwitch(keyOf({ ...s, look: k, slice: k === 'model' ? s.slice : 0 }));   // (round 9: before the engine draws it)
  if (s.slice && k !== 'model') box.diskSet({ slice: 0, look: k }); else box.diskSet({ look: k });
  sync();
}

// ---------- the controls that depend on the state: the place's action; in the rail, the CO maps and the cut's quantities ----------
// (round 6: the optical depth toward the star and the cut alone are gone, the owner's choice; old links ask the engine
// for them, and it gives the temperature and the density instead)
const CUT_Q = ['T', 'rho', 'layers'];
function segmented(items, current, onPick, label, cls = 'segmented small') {
  const g = el('div', { class: cls, role: 'group', 'aria-label': label });
  for (const [key, text] of items) g.append(el('button', { type: 'button', 'aria-pressed': String(key === current), onclick: () => onPick(key) }, text));
  return g;
}
let actionsKey = '', lookKey = '', cutKey = '';
// The row under a highlight's text: the place's own control, the way back when the view has left the place, or the way
// on (the next place).
function renderActions(s) {
  const w = T(), pl = PLACES[placeI];
  const showBack = away();
  const key = [L(), pl.id, s.asym, s.waves, s.mode & 16, showBack, Date.now() < burstUntil].join('|');
  if (key === actionsKey) return;
  actionsKey = key;
  const kids = [];
  if (pl.action === 'asym') {
    kids.push(el('button', { type: 'button', class: 'action', 'aria-pressed': String(!!s.asym), onclick: () => { box.diskSet({ asym: S().asym ? 0 : 1 }); sync(); } }, w.actions.asym));
  } else if (pl.action === 'burst' && !reduce) {
    kids.push(el('button', { type: 'button', class: 'action', disabled: Date.now() < burstUntil, onclick: () => {
      box.diskBurst(); burstUntil = Date.now() + 8000; sync(); setTimeout(sync, 8100);
    } }, w.actions.burst));
  } else if (pl.action === 'waves') {
    kids.push(el('button', { type: 'button', class: 'action', 'aria-pressed': String(!!s.waves), onclick: () => { box.diskSet({ waves: S().waves ? 0 : 1 }); sync(); } }, w.actions.waves));
  } else if (pl.action === 'noplanet') {
    kids.push(el('button', { type: 'button', class: 'action', 'aria-pressed': String(!(s.mode & 16)), onclick: () => { box.diskSet({ mode: S().mode ^ 16 }); sync(); } }, w.actions.noplanet));
  }
  if (showBack) {
    kids.push(el('button', { type: 'button', class: 'action quiet', onclick: () => goPlace(placeI) },
      svgIcon('M3.5 8a4.5 4.5 0 1 0 1.4-3.3M3.5 2.8v2.4h2.4'), w.back));
  }
  // (a place with no control of its own offers the way on: the next place, or from the last one the first)
  if (!kids.length) {
    const last = placeI === PLACES.length - 1, to = last ? 0 : placeI + 1;
    kids.push(el('button', { type: 'button', class: 'action quiet next', onclick: () => goPlace(to) },
      (last ? w.again : w.onward) + T().places[PLACES[to].id].title, svgIcon('m6 3 5 5-5 5')));
  }
  placeActions.replaceChildren(...kids);
}
function svgIcon(d) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); s.append(p); return s;
}
// The rail's controls that come and go: the CO line's maps and velocity under the looks, the cut's quantities under the
// cut; and the note under the looks (the look's, the CO map's, or the cut face's).
function renderRail(s) {
  const w = T(), co = s.look === 'co', cutOpen = s.slice > 0 && s.look === 'model';
  const lk = [L(), co, s.coMode].join('|');
  if (lk !== lookKey) {
    lookKey = lk;
    const kids = [];
    if (co) {
      kids.push(segmented(['chan', 'm1', 'm0'].map((k) => [k, w.coModes[k]]), s.coMode, (k) => { guardSwitch(keyOf({ ...S(), coMode: k })); box.diskSet({ coMode: k }); sync(); }, L() === 'ja' ? 'ガス輝線の表示' : 'Line map'));
      if (s.coMode === 'chan') {
        const out = el('output', {}, kms(s.coV));
        const input = el('input', { type: 'range', min: '-12', max: '12', step: '0.25', value: String(s.coV), 'aria-label': w.velocity + ' (km/s)',
          oninput: (e) => { box.diskSet({ coV: Number(e.target.value) }); out.textContent = kms(Number(e.target.value)); } });
        kids.push(el('label', { class: 'velocity' }, w.velocity, input, out));
      }
    }
    lookContext.replaceChildren(...kids);
  } else if (co && s.coMode === 'chan') {
    // (keep the velocity's slider in step unless it is being dragged)
    const input = lookContext.querySelector('input');
    if (input && document.activeElement !== input && Number(input.value) !== s.coV) { input.value = String(s.coV); lookContext.querySelector('output').textContent = kms(s.coV); }
  }
  const shown = cutOpen ? keyItems(s) : [];
  const ck = [L(), cutOpen, s.sq, shown.join()].join('|');
  if (ck !== cutKey) {
    cutKey = ck;
    cutContext.replaceChildren(...(cutOpen ? [segmented(CUT_Q.map((k) => [k, w.cutQ[k]]), s.sq, (k) => { box.diskSet({ sq: k }); sync(); }, L() === 'ja' ? '断面に描く量' : 'Quantity on the cut'), cutKeyList(s.sq, shown)] : []));
  }
  lookNote.textContent = co ? w.coNotes[s.coMode] : cutOpen ? w.cutNotes[s.sq] : w.looks[s.look].note;
}
const kms = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + ' km/s';
// The key of the cut (round 6): the lines the engine draws on the faces, as it draws them, and what is left clear, in place
// of the names it wrote beside them (the owner: "the labels on the cut say poorly which line they mean"). The colours are
// the engine's legend at the top left of the picture. Which lines are drawn follows the engine's drawSlice: the snow line
// and where starlight reaches on every face, the pebbles with the pebbles shown, the density's contours on its face, the
// field lines with them, the flow arrows with the gas and its option (the wind's with the wind as well; round 8: no longer
// with the field lines), the planets' orbits.
function keyItems(s) {
  const out = ['tau1', 'ice'];
  if (s.mode & 4) out.push('pebbles');
  if (s.sq === 'rho') out.push('contour');
  if (s.field) out.push('field');
  if (s.marks && (s.mode & 1) && (s.mode & 8)) out.push('flow');
  if (s.marks && (s.mode & 1)) out.push('acc');
  if ((s.mode & 16) && s.planets.some((p) => p[1])) out.push('planet');
  return out;
}
const KEY_SVG = {
  tau1: '<path d="M1 5h22" stroke="#fff3df" stroke-width="1.5"/>',
  ice: '<path d="M1 5h22" stroke="#0a0d18" stroke-opacity=".6" stroke-width="4.6" stroke-dasharray="9 2" stroke-dashoffset="1"/><path d="M1 5h22" stroke="#6fd0ff" stroke-width="2.6" stroke-dasharray="7 4"/>',
  pebbles: '<path d="M1 5h11" stroke="#b07a52" stroke-width="2.2"/><path d="M12 5h11" stroke="#e3f1ff" stroke-width="2.2"/>',
  contour: '<path d="M1 7c6-5 16-5 22 0" stroke="#fff" stroke-opacity=".55" stroke-width=".9"/>',
  field: '<path d="M2 9c4-1 8-4 10-8M12 9c4-1 8-4 10-8" stroke="#cfe3ff" stroke-opacity=".7" stroke-width=".9"/>',
  flow: '<path d="M5 5h13M14.5 2.7 18 5l-3.5 2.3" stroke="#e8f4ff" stroke-width="1.1"/>',
  acc: '<path d="M19 5H8M11.5 2.7 8 5l3.5 2.3" stroke="#ffbe6a" stroke-width="1.2"/>',
  planet: '<circle cx="12" cy="5" r="4.2" fill="none" stroke="#ffd040" stroke-opacity=".7"/><circle cx="12" cy="5" r="2.2" fill="#ffd040" stroke="#0a0d18" stroke-width=".8"/>'
};
function cutKeyList(sq, shown) {
  const w = T().cutKey, li = (k, text) => {
    const sv = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    sv.setAttribute('viewBox', '0 0 24 10'); sv.setAttribute('aria-hidden', 'true'); sv.innerHTML = KEY_SVG[k];
    return el('li', {}, sv, el('span', {}, text));
  };
  const items = shown.map((k) => li(k, k === 'tau1' && sq === 'layers' ? w.tau1Regions : w[k]));
  // (round 8, the owner: "the caption for the parts without colour confuses more than it helps": the row of what is left
  // clear, added in round 6, is gone; the classification stays in DESIGN.md)
  return el('ul', { class: 'cut-key', 'aria-label': w.label }, ...items);
}

// ---------- keeping every control in step with the engine ----------
// The CO line costs 7 (a channel) to 35 (its moments) times the model's look per frame: the governor's floor is lower
// there (CO_FLOOR), and the scale starts from it, so that the first frames do not take a second each (the governor
// climbs from there while the clock runs; a still picture is sharpened when complete). Leaving the CO line, the model
// takes back the calibrated scale at once rather than climbing to it.
const CO_FLOOR = 0.12;
let wasCo = false;
function sync() {
  if (!live()) return;
  const s = S();
  if (calibrated && keyOf(s) !== gc.key) guardSwitch(keyOf(s));   // (round 9: a change the engine made, as the S key's cut)
  // (a still picture's scale is for that picture: the clock started, or another look, by any way, ends it)
  if (sharpFrom && ((!s.paused && !reduce) || s.look + s.coMode !== sharpWhat)) unsharpen();
  const base = diag.calibration && diag.calibration.scale, co = s.look === 'co';
  if (co !== wasCo && quality !== 'auto' && !holdSharp) { qCap = co ? CO_FLOOR : 1; costs.length = 0; scaleTo(fixedScale()); }
  else if (co && !wasCo && !sharpFrom && !holdSharp) runScale = scaleTo(CO_FLOOR);
  else if (!co && wasCo && !sharpFrom && !holdSharp && base) runScale = scaleTo(base);
  wasCo = co;
  applyFixed();
  lookButtons.forEach((b) => pressed(b, b.dataset.look === s.look));
  renderActions(s);
  renderRail(s);
  // (not next to the star, where the magnetosphere's columns and curtains have colours of their own)
  renderMatKey(s);
  playBtn.toggleAttribute('data-paused', !!s.paused);
  playBtn.setAttribute('aria-label', s.paused ? T().play : T().pause);
  keepSoon();
  syncComps(s);
  syncQuality(s);
  if (!saving) renderSaveSize();
  if (s.paused) setClockRate(0);   // (paused, no frames come to clear the clock's rate)
  // the rail
  rail.querySelectorAll('[data-bit]').forEach((b) => pressed(b, s.mode & Number(b.dataset.bit)));
  const opt = { field: s.field, marks: s.marks, ann: s.ann, asym: s.asym, waves: s.waves, drop: box.dataset.pick === 'pebbles' };
  rail.querySelectorAll('[data-opt]').forEach((b) => pressed(b, opt[b.dataset.opt]));
  rail.querySelectorAll('[data-cut]').forEach((b) => pressed(b, Number(b.dataset.cut) === s.slice));
  rail.querySelectorAll('[data-bg]').forEach((b) => pressed(b, b.dataset.bg === (s.bg || 'stars')));
  rail.querySelectorAll('[data-speed]').forEach((b) => pressed(b, Math.abs(Number(b.dataset.speed) - s.speed) < 1e-6));
}
// (round 8, the owner: "the clock's reading is not needed": the years beside the play button are gone. The rate below the
// speeds stays, as it says how fast the clock runs for the view; a link keeps the time, t=)
// the clock's rate for the view (the engine's clockK, slower zoomed in), told at the end of the time section's note
// while the clock runs, not on the picture (the owner, 2026-10-16)
let rateShown = '';
function setClockRate(k) {
  const n = 1 / (k || 1), t = k && k < 0.97 && !S().paused && !reduce ? T().clockRate(n < 9.95 ? n.toFixed(1) : String(Math.round(n))) : '';
  if (t !== rateShown) { rateShown = t; $('clockRate').textContent = t; }
}

// ---------- the rail (the sandbox) ----------
rail.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b || !live()) return;
  const s = S();
  // (a component may be more than one of the engine's bits, the gas with its dust: on if any is, and all turn together)
  if (b.dataset.bit) { const bit = Number(b.dataset.bit), m = s.mode & bit ? s.mode & ~bit : s.mode | bit; box.diskSet({ mode: m, ...((m & 16) && !s.planets.some((p) => p[1]) ? { planets: [...s.planets.filter((p) => roomFor([[3, 1, 1]], p[0], -1, p[2]) || !p[1]), [3, 1, 1]].slice(-4) } : {}) }); }
  else if (b.dataset.opt === 'field') box.diskField(!s.field);
  else if (b.dataset.opt === 'marks') box.diskSet({ marks: s.marks ? 0 : 1 });
  else if (b.dataset.opt === 'ann') box.diskAnnotations(!s.ann);
  else if (b.dataset.opt === 'asym') box.diskSet({ asym: s.asym ? 0 : 1 });
  else if (b.dataset.opt === 'waves') box.diskSet({ waves: s.waves ? 0 : 1 });
  else if (b.dataset.opt === 'drop') setPick(box.dataset.pick === 'pebbles' ? false : 'pebbles');
  else if (b.dataset.bg) box.diskSet({ bg: b.dataset.bg });   // (round 8: the background, the engine's BG)
  else if (b.dataset.cut) { const k = Number(b.dataset.cut); guardSwitch(keyOf({ ...s, slice: k, look: k ? 'model' : s.look })); if (k === 0) box.diskSlice(false); else box.diskSlice(true, null, k === 2 ? 'quarter' : 'half'); }
  else if (b.dataset.angle) { const [elv, az] = b.dataset.angle.split(',').map(Number); box.diskSet({ slice: 0, p: 0, el: elv, az, fly: reduce ? 0 : 1 }); }
  else if (b.id === 'recentre') box.diskCenter();
  else if (b.id === 'resetView') goPlace(0);
  else if (b.id === 'resetAll') { resetAll(); return; }
  else if (b.dataset.speed) box.diskSpeed(Number(b.dataset.speed));
  else if (b.id === 'copyLink') copyLink();
  else if (b.id === 'saveImage') saveImage(b);
  else if (b.dataset.saveSize) { saveSize = b.dataset.saveSize; try { sessionStorage.setItem(KEY('disk-lab-save-size'), saveSize); } catch { /* for this view only */ } renderSaveSize(); }
  else if (b.dataset.quality) setQuality(b.dataset.quality);
  else if (b.id === 'citeCopy') copyCite();
  else if (b.dataset.planetOn != null) { const pl = S().planets; const i = Number(b.dataset.planetOn); if (pl[i]) { pl[i][1] = pl[i][1] ? 0 : 1; if (pl[i][1] && !roomFor(pl, pl[i][0], i, pl[i][2])) pl[i][1] = 0; box.diskSet({ planets: pl }); } }
  else if (b.dataset.planetRemove != null) { const pl = S().planets; pl.splice(Number(b.dataset.planetRemove), 1); box.diskSet({ planets: pl }); }
  else if (b.id === 'addPlanet') setPick(box.dataset.pick === 'planet' ? false : 'planet');
  sync();
});
// (round 9) a planet's slider: while it is dragged, the engine makes the gap's starlight anew at most every 120 ms and the
// picture is drawn at the moving scale (as for a move of the view, see moving); on release ('change') in full
rail.addEventListener('input', (e) => {
  const t = e.target; if (!live()) return;
  if (t.dataset.planetA != null) movePlanet(Number(t.dataset.planetA), aOf(t.value), true);
  else if (t.dataset.planetM != null) massPlanet(Number(t.dataset.planetM), mOf(t.value), true);
});
rail.addEventListener('change', (e) => {
  const t = e.target; if (!live()) return;
  if (t.dataset.planetA != null) movePlanet(Number(t.dataset.planetA), aOf(t.value));
  else if (t.dataset.planetM != null) massPlanet(Number(t.dataset.planetM), mOf(t.value));
});

// ---------- the components (Show): each a toggle; turned on, its settings open below it ----------
// (round 6: the gas and its dust are one component, the engine's bits 1 and 2 together: the owner, "treat the gas as a
// mixture with its dust; the dust on its own hardly shows in the model". In the observed looks bit 2 is the lit surface
// the dust makes, which goes with the gas as well. A link with one of the two bits is read as both, linkMode.)
// (round 6: the amounts, the engine's display factors of the components, are gone from the page, the owner's choice: the
// model's own amounts are what is shown, and a link's g= is read past)
// opts: the engine's options that belong to it (the gas's flow arrows, the pebbles' tap mode, the wind's asymmetry, the
// planets' waves); planets:
// the list of planets. The envelope, the jet and the labels have no settings of their own. (The flow markers were the field
// lines' option from round 5, 2026-10-16; round 8, the owner: "the flow markers: an option of the gas; small arrows". They
// show the gas's motion, drawn while the gas is shown.)
const COMPS = [
  { key: 'gas', bit: 3, opts: ['marks'] }, { key: 'pebbles', bit: 4, opts: ['drop'] },
  { key: 'wind', bit: 8, opts: ['asym'] }, { key: 'jet', bit: 64 }, { key: 'field', opt: 'field' },
  { key: 'planet', bit: 16, planets: true, opts: ['waves'] }, { key: 'envelope', bit: 32 }, { key: 'labels', opt: 'ann' }
];
const compEls = COMPS.map((c) => {
  const btn = el('button', { type: 'button', class: 'toggle', 'aria-pressed': 'false', ...(c.bit ? { 'data-bit': String(c.bit) } : { 'data-opt': c.opt }) });
  const box_ = c.opts || c.planets ? el('div', { class: 'comp-opts', hidden: true }) : null;
  if (c.planets) box_.append(el('div', { class: 'planet-list' }), el('button', { type: 'button', class: 'chip quiet', id: 'addPlanet', 'aria-pressed': 'false' }));
  for (const o of c.opts || []) box_.append(el('button', { type: 'button', class: 'toggle small', 'data-opt': o, 'aria-pressed': 'false' }));
  if (c.planets) box_.append(el('p', { class: 'rail-note planets-note' }));
  const row = el('div', { class: 'comp', 'data-comp': c.key }, btn, box_);
  $('comps').append(row);
  return { c, row, btn, opts: box_ };
});
function renderComps() {
  const w = T().show;
  for (const { c, btn, opts } of compEls) {
    btn.textContent = w[c.key];
    if (!opts) continue;
    opts.querySelectorAll('[data-opt]').forEach((b) => { b.textContent = w[b.dataset.opt]; });
    const add = opts.querySelector('#addPlanet'); if (add) add.textContent = '+ ' + w.addPlanet;
    const nt = opts.querySelector('.planets-note'); if (nt) nt.textContent = w.planetsNote;
  }
  planetsKey = '';
}
let planetsKey = '';
// the planets' orbits: from the gas disk's inner edge, the magnetosphere's truncation radius (0.05 au; round 7, before
// 1 au), to 20 au, as the engine's PLANETS.RANGE; a slider on a log scale (0 to 1000), radii rounded to two significant
// figures below 10 au
const PL_A = [0.05, 20];
const roundA = (a) => { const k = a < 0.1 ? 1000 : a < 1 ? 100 : a < 10 ? 10 : 2; return Math.round(a * k) / k; };
const aOf = (v) => roundA(PL_A[0] * Math.pow(PL_A[1] / PL_A[0], Number(v) / 1000));
const sliderOfA = (a) => String(Math.round(1000 * Math.log(a / PL_A[0]) / Math.log(PL_A[1] / PL_A[0])));
const fmtA = (a) => (a < 1 ? String(roundA(a)) : a < 10 ? a.toFixed(1) : String(Math.round(a)));
// (round 8, the owner: "give the planets a mass slider") the planets' masses, in Jupiter masses, from 10 Earth masses to 3
// (the engine's MASS: above 3 the gap turns eccentric, which the model cannot show), on a log slider; shown in Earth
// masses below 0.1 M_J (about 32), else in M_J, to two figures. Neighbours keep apart by the engine's rule in mutual Hill
// radii (box.diskMinRatio; a radius ratio of 1.4 before round 8, about the same for two Jupiters)
const PL_M = [10 / 317.83, 3], M_EARTH = 1 / 317.83;
const roundM = (m) => (m < 0.1 ? Math.round(m / M_EARTH) * M_EARTH : +m.toPrecision(2));
const mOf = (v) => roundM(PL_M[0] * Math.pow(PL_M[1] / PL_M[0], Number(v) / 1000));
const sliderOfM = (m) => String(Math.round(1000 * Math.log(m / PL_M[0]) / Math.log(PL_M[1] / PL_M[0])));
// the mass as text with its unit (M⊕ or M_J, the J as a subscript)
const fmtM = (m) => (m < 0.1 - 1e-9 ? [String(Math.round(m / M_EARTH)), 'M', '⊕'] : [String(+(m || 1).toPrecision(2)), 'M', 'J']);
const massEl = (m) => { const [n, u, sub] = fmtM(m); return el('span', { class: 'mass' }, n + '\u2009' + u, sub === 'J' ? el('sub', {}, 'J') : sub); };
const minRatio = (m1, m2) => (typeof box.diskMinRatio === 'function' ? box.diskMinRatio(m1, m2) : 1.4);
// is there room for a planet of mass m at a (within PL_A, and apart from the other shown planets by the engine's rule)?
const roomFor = (list, a, skip, m = 1) => a >= PL_A[0] && a <= PL_A[1] && list.every((p, i) => i === skip || !p[1] || Math.max(a, p[0]) / Math.min(a, p[0]) >= minRatio(m, p[2] || 1));
// a planet moved by a slider: held between its shown neighbours (the engine's rule in mutual Hill radii). (Round 9: drag,
// the slider being dragged; the row's words change in place: rebuilt, the list replaced the very slider under the finger,
// which then followed it no more)
function movePlanet(i, a, drag = false) {
  const pl = S().planets; if (!pl[i]) return;
  let lo = PL_A[0], hi = PL_A[1];
  pl.forEach((p, j) => { if (j === i || !p[1]) return; const k = minRatio(pl[i][2], p[2]); if (p[0] <= pl[i][0]) lo = Math.max(lo, p[0] * k); else hi = Math.min(hi, p[0] / k); });
  pl[i][0] = Math.min(hi, Math.max(lo, a));
  planetSet(pl, drag);
}
// a planet's mass changed by a slider: as heavy as its neighbours leave room for (they keep their places)
function massPlanet(i, m, drag = false) {
  const pl = S().planets; if (!pl[i]) return;
  let mm = m;
  while (mm > PL_M[0] && !roomFor(pl, pl[i][0], i, mm)) mm = roundM(mm * 0.97);
  pl[i][2] = Math.max(PL_M[0], mm);
  planetSet(pl, drag);
}
function planetSet(pl, drag) {
  if (drag) moving();   // (the moving scale while dragged; back MOVE_REST after the last move)
  box.diskSet({ planets: pl, drag: drag ? 1 : 0 });
  planetRows(S());
  popSync();
}
// the planets' rows' words (radius, mass) as they are now, in place
function planetRows(s) {
  const list = $('comps').querySelector('.planet-list');
  if (!list) return;
  s.planets.forEach(([a, , m], i) => {
    const b = list.querySelector(`[data-planet-on="${i}"]`), ms = b && b.parentElement.querySelector('.planet-mass');
    if (b) b.textContent = T().show.planetRow(i + 1, fmtA(a));
    if (ms) ms.replaceChildren(massEl(m));
  });
  planetsKey = L() + JSON.stringify(s.planets);
}
function syncComps(s) {
  const opt = { field: s.field, ann: s.ann };
  for (const { c, opts } of compEls) {
    const on = c.bit ? !!(s.mode & c.bit) : !!opt[c.opt];
    if (opts) opts.hidden = !on;
  }
  // (round 8: the pebbles' tap mode ends with the pebbles, as its button goes with their settings)
  if (box.dataset.pick === 'pebbles' && !(s.mode & 4)) { delete box.dataset.pick; lab.classList.remove('picking'); note('', 0); }
  // the planets' rows (rebuilt when the list changes)
  const key = L() + JSON.stringify(s.planets);
  const list = $('comps').querySelector('.planet-list');
  pressed($('addPlanet'), box.dataset.pick === 'planet');
  if (!list || key === planetsKey) return;
  planetsKey = key;
  const w = T().show;
  // (round 8: a second line with the mass and its slider under the orbit's)
  list.replaceChildren(...s.planets.map(([a, on, m], i) => el('div', { class: 'planet-row' },
    el('button', { type: 'button', class: 'toggle small', 'data-planet-on': String(i), 'aria-pressed': String(!!on) }, w.planetRow(i + 1, fmtA(a))),
    el('input', { type: 'range', min: '0', max: '1000', step: '1', value: sliderOfA(a), 'data-planet-a': String(i), 'aria-label': w.orbit(i + 1) }),
    el('button', { type: 'button', class: 'icon-x', 'data-planet-remove': String(i), 'aria-label': w.remove, title: w.remove }, '×'),
    el('span', { class: 'planet-mass' }, massEl(m)),
    el('input', { type: 'range', min: '0', max: '1000', step: '1', value: sliderOfM(m || 1), 'data-planet-m': String(i), 'aria-label': w.massOf(i + 1) }))));
}

// what a click on the disk does (the engine's data-pick): 'planet', place a planet (the engine sends diskpick); 'pebbles'
// (round 8, the owner: "no pebbles on a tap by default; a mode of the pebbles"), drop a clump of pebbles there, three near one
// radius growing a planet; neither, nothing (a click on the star or a planet still does its own). One at a time: either
// button ends the other's mode
function setPick(kind) {
  if (kind) box.dataset.pick = kind; else delete box.dataset.pick;
  lab.classList.toggle('picking', !!kind);
  note(kind === 'planet' ? T().show.picking : kind === 'pebbles' ? T().show.dropping : '', 0);
  sync();
}
box.addEventListener('diskpick', (e) => {
  const w = T().show, pl = S().planets, a = roundA(Math.min(PL_A[1], Math.max(PL_A[0], e.detail.R)));
  if (!roomFor(pl, a, -1)) { note(w.noRoom, 3500); return; }
  const i = pl.findIndex((p) => !p[1]);
  if (i >= 0) pl[i] = [a, 1, 1]; else if (pl.length < 4) pl.push([a, 1, 1]); else { note(w.full, 3500); return; }
  box.diskSet({ planets: pl, mode: S().mode | 16 });
  setPick(false);
  note(w.placed(fmtA(a)), 3000);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (box.dataset.pick) setPick(false); popClose(); } });

// a click on a planet in the picture: its orbit's slider, beside it
const pop = $('planetPop');
let popI = -1;
box.addEventListener('diskplanet', (e) => {
  popI = e.detail.i;
  const w = T().show, [a, , m] = S().planets[popI];
  const input = el('input', { type: 'range', min: '0', max: '1000', step: '1', value: sliderOfA(a), 'aria-label': w.orbit(popI + 1),
    oninput: (ev) => movePlanet(popI, aOf(ev.target.value), true), onchange: (ev) => movePlanet(popI, aOf(ev.target.value)) });
  // (round 8: and its mass)
  const inputM = el('input', { type: 'range', min: '0', max: '1000', step: '1', value: sliderOfM(m || 1), 'aria-label': w.massOf(popI + 1),
    oninput: (ev) => massPlanet(popI, mOf(ev.target.value), true), onchange: (ev) => massPlanet(popI, mOf(ev.target.value)) });
  pop.replaceChildren(el('span', { class: 'pop-name' }, w.planetRow(popI + 1, fmtA(a))), input,
    el('button', { type: 'button', class: 'icon-x', 'aria-label': 'close', onclick: popClose }, '×'),
    el('span', { class: 'pop-mass' }, massEl(m)), inputM);
  pop.hidden = false;
  const x = Math.min(stage.clientWidth - 260, Math.max(8, e.detail.x + 18)), y = Math.min(stage.clientHeight - 84, Math.max(8, e.detail.y - 22));
  pop.style.left = x + 'px'; pop.style.top = y + 'px';
  input.focus({ preventScroll: true });
});
function popSync() {
  if (pop.hidden || popI < 0) return;
  const a = S().planets[popI] && S().planets[popI][0];
  if (a == null) { popClose(); return; }
  pop.querySelector('.pop-name').textContent = T().show.planetRow(popI + 1, fmtA(a));
  pop.querySelector('.pop-mass').replaceChildren(massEl(S().planets[popI][2]));
}
function popClose() { pop.hidden = true; popI = -1; }
stage.addEventListener('pointerdown', (e) => { if (!pop.hidden && !pop.contains(e.target)) popClose(); }, { capture: true });

// ---------- quality ----------
// Auto: the governor and the sharpening of still pictures. A fixed level holds the render scale, with the governor and
// the sharpening at rest, unless the frames grow too long: then the scale is lowered so that a frame takes about 150 ms
// (a frame of seconds can make the GPU drop the WebGL context; the CO line's moments at full resolution did), and the
// note says so. In the CO look a fixed level starts from CO_FLOOR, as Auto does.
// Round 6: Best is the default (the owner: "the resolution can be the highest, basically"). Not chosen, it keeps the
// picture moving: where frames take longer than BEST_SLOW while the clock runs and the view rests, it steps down quietly
// to the fixed level whose frame is predicted under BEST_AIM (80 %, then 55 %, 35 %), and back up when a frame there
// would be under BEST_UP, saying so in the quality's note only (no toast: the visitor did not choose it). A new place
// starts again from 100 %. Chosen, Best holds 100 % as the other fixed levels hold theirs (only the guard against stalls).
// Round 7 (the owner: "after stepping down quietly, step up again quietly when it can"): the quiet step (bestCap) is for
// the running clock only; a paused picture is accumulated at 100 % as before (the guard against stalls still applies), and
// when the clock runs again it starts from the step it had. Up one level at a time, once the frames at the next level are
// predicted under BEST_UP (the 40 / 70 ms band is the hysteresis) and at least the hold after the last change has passed:
// BEST_HOLD, doubled (to BEST_HOLD_MAX) each time a step up has to be taken back within BEST_UNDO, back to BEST_HOLD at
// a new place, so that a view at the edge does not go up and down every few seconds. Frames that come at the display's
// pace (a mean under BEST_PACED) say nothing of the room left, so there the next level is tried (and taken back, with the
// longer hold, if it is slow). The guard against stalls lowers this step while the clock runs (so that it comes back up
// the same way) and the level of a paused picture otherwise (back to the level when the clock starts or stops, the view
// moves or the place changes: a cap that never relaxed kept a view at its lowest after one slow moment).
const BEST_SLOW = 70, BEST_AIM = 60, BEST_UP = 40, BEST_PACED = 22, BEST_STEPS = [1, 0.8, 0.55, 0.35];
const BEST_HOLD = 3000, BEST_HOLD_MAX = 24000, BEST_UNDO = 8000;
let quality = 'full', qCap = 1, qChosen = false, bestCap = 1;
// (a level chosen: kept with the settings since round 9, for the visit before)
// (round 10a: after a bad end, not applied this once; kept, keptQuality, for the safe start's "restore")
let keptQuality = null;
{ let k = saved && saved.quality; try { k = k || sessionStorage.getItem(KEY('disk-lab-quality')); } catch { /* none */ } if (k && (k === 'auto' || QUALITY[k])) { keptQuality = k; if (!crashed) { quality = k; qChosen = true; } } }
const qualityButtons = ['auto', 'low', 'mid', 'high', 'full'].map((k) => {
  const b = el('button', { type: 'button', 'data-quality': k, 'aria-pressed': String(k === quality) });
  $('qualityGroup').append(b);
  return b;
});
function renderQuality() {
  const w = T().quality;
  qualityButtons.forEach((b) => { b.textContent = w[b.dataset.quality]; });
  $('qualityGroup').setAttribute('aria-label', w.label);
}
const govRest = () => { if (gov) gov.pause(quality !== 'auto' || holdSharp); };
// (the default Best's quiet step applies while the clock runs; a paused picture is drawn at the level itself)
// (round 9: and within the guard, allowed: running frames under GUARD_MS, a still picture's within STILL_MS in bands)
const fixedScale = () => Math.min(QUALITY[quality] || 1, qCap, bestDefault() && live() && !S().paused ? bestCap : 1, live() ? allowed() : 1);
// the scale a fixed level asks for now, set when it changed (the clock paused or running again; not while the view moves,
// a still picture is sharpened, a measurement holds the governor or a picture is being saved)
let fixedPaused = null, skipFrames = 0;
function applyFixed() {
  if (quality === 'auto' || !live() || moveFrom || holdSharp || sharpFrom || saving || !calibrated || 'lost' in lab.dataset) return;
  const p = !!S().paused;
  if (p !== fixedPaused) { fixedPaused = p; gc.still = 0; relaxGuard(); syncQuality(); }
  const want = fixedScale();
  // (the frames still in flight were drawn at the scale left: not counted for the guards)
  if (Math.abs(box.diskScale() - want) > 0.004) { scaleTo(want); skipFrames = 3; }
}
// the visitor's choice (kept for the visit); applyQuality: the level applied, chosen or the default
function setQuality(k) {
  qChosen = true; keeping = keeping || calibrated;   // (round 10a: a choice made after a safe start is kept)
  if (calibrated) guardAfresh();   // (round 10a: see guardAfresh)
  flogAdd({ k: 'set', q: k });
  try { sessionStorage.setItem(KEY('disk-lab-quality'), k); } catch { /* for this view only */ }
  keepSoon();
  applyQuality(k);
}
function applyQuality(k) {
  quality = k; qCap = 1; costs.length = 0; bestReset();
  unsharpen();
  if (live()) {
    box.diskSet({ fx: k === 'auto' ? fxAuto() : FX_OF[k] ?? 2 });   // (round 8: the finish, see FX_OF)
    if (k === 'auto') { const base = diag.calibration && diag.calibration.scale || 0.5; runScale = scaleTo(S().look === 'co' ? CO_FLOOR : base); }
    else { qCap = S().look === 'co' ? CO_FLOOR : 1; scaleTo(fixedScale()); }
  }
  govRest();
  sync();
}
function syncQuality() {
  qualityButtons.forEach((b) => pressed(b, b.dataset.quality === quality));
  const w = T().quality, n = $('qualityNote');
  if (quality === 'auto') n.textContent = w.autoNote;
  else if (bestDefault()) n.textContent = fixedScale() < 1 ? w.bestCapped(Math.round(100 * fixedScale())) : w.bestNote;
  else if (qCap < (QUALITY[quality] || 1) || fixedScale() < (QUALITY[quality] || 1) - 0.005) n.textContent = w.capped(Math.round(100 * fixedScale()));
  else n.textContent = w.fixedNote(Math.round(100 * (QUALITY[quality] || 1)));
}
// the frames' intervals at a fixed level (consecutive frames: the clock running or a picture being averaged)
// the guard's cap back to the level's own (1, or CO_FLOOR in the CO look)
function relaxGuard() { const base = live() && S().look === 'co' ? CO_FLOOR : 1; if (qCap < base) { qCap = base; costs.length = 0; } }
const costs = [], bestRuns = [];
let bestT = 0, bestChanged = 0, bestUpAt = -1e9, bestHold = BEST_HOLD;
const bestDefault = () => quality === 'full' && !qChosen;
// (a new place, a new level: Best from 100 % with the shortest hold)
function bestReset() { bestCap = 1; bestRuns.length = 0; bestHold = BEST_HOLD; bestUpAt = -1e9; bestChanged = 0; }
// the default Best's quiet steps (see BEST_SLOW): from the frames of the running clock at a resting view, over 1.5 s
function guardBest(dt) {
  if (!bestDefault() || S().paused || S().look === 'co') { bestRuns.length = 0; return; }
  if (!(dt > 0 && dt < 2000)) return;
  bestRuns.push(dt);
  const now = performance.now();
  if (now - bestT < 1500 || bestRuns.length < 8) return;
  const mean = bestRuns.reduce((a, b) => a + b, 0) / bestRuns.length, s = box.diskScale();
  bestRuns.length = 0; bestT = now;
  const at = (to) => mean * (0.12 + 0.88 * (to * to) / (s * s));   // (a frame at another scale: 12 % fixed, the rest with the pixels, as scaleFor)
  let to = bestCap;
  if (mean > BEST_SLOW) {
    to = BEST_STEPS.find((l) => l < bestCap - 0.005 && at(l) <= BEST_AIM) ?? BEST_STEPS[BEST_STEPS.length - 1];
    // (a step up taken back soon: wait longer before the next one)
    if (now - bestUpAt < BEST_UNDO) bestHold = Math.min(BEST_HOLD_MAX, 2 * bestHold);
  } else if (now - bestChanged >= bestHold) {
    const up = BEST_STEPS.slice().reverse().find((l) => l > bestCap + 0.005);
    if (up && (mean < BEST_PACED || at(up) < BEST_UP)) { to = up; bestUpAt = now; }
  }
  if (Math.abs(to - bestCap) > 0.005) {
    bestCap = to; bestChanged = now;
    if (bestLog) bestLog.push({ t: Math.round(now), to, mean: Math.round(mean), from: Math.round(100 * s) / 100 });
    applyFixed(); sync();
  }
}
let bestLog = null;   // (for measurements: diskLab.bestLog(true) records each quiet step)
function guardFixed(dt, acc, accMax, bands = 1) {
  if (quality === 'auto' || !live() || holdSharp || moveFrom) return;
  guardBest(dt);
  // (round 9: a still picture's frame drawn in bands comes after several animation frames, its bands each within the
  // guard's budget: its interval is not the length of a piece of GPU work)
  if (bands > 1) { costs.length = 0; return; }
  if (!(dt > 0) || (S().paused && !(acc >= 2 && acc <= accMax))) return;
  costs.push(dt); if (costs.length > 6) costs.shift();
  const mean = costs.reduce((a, b) => a + b, 0) / costs.length, s = box.diskScale();
  if ((dt > 600 || (costs.length >= 4 && mean > 220)) && s > CO_FLOOR + 0.005) {
    const to = Math.max(CO_FLOOR, Math.min(s * 0.85, scaleFor(Math.max(dt, mean), s, 150)));
    // (round 7: the default Best's running step takes it, and comes back up by its quiet steps)
    if (bestDefault() && !S().paused && S().look !== 'co') { bestCap = Math.min(bestCap, to); bestChanged = performance.now(); bestRuns.length = 0; }
    else qCap = to;
    scaleTo(fixedScale()); costs.length = 0; sync();
  }
}

// ---------- the guard (round 9): no frame long enough for the system to stop the GPU ----------
// The owner's phone lost the WebGL context on switching to the visible look, and the browser then gave no WebGL until it
// was quit. Measured on the M1 Max (GPU timer, scale 0.25, the whole disk): a frame of the model look 11.7 ms, the visible
// look 200 and the mid-infrared 110 (their continuum is marched to a transmission of 1e-20, in sixteenths of the usual
// step), the CO line's channel 94 and its moments 430. At the default Best (scale 1) on a phone, whose GPU is several times
// slower, a frame of the visible look takes seconds, and the system stops a piece of GPU work that runs for seconds (the
// context is lost, and WebKit then refuses WebGL to the page, or the whole browser, until it is restarted). So nothing is
// sent whose predicted GPU time exceeds GUARD_MS (a phone or tablet, or no GPU timer: 70 ms; else 120 ms). The cost of a
// frame at scale 1 of what is drawn now (gc.c1, ms) comes from the engine's measure of each frame (diskgpu: fences, on
// every device) and starts from the calibration; before a change that makes frames dearer (a look, the line's map, the
// cut) it is predicted from the change's factor (FACTOR, the engine's GFAC: measured on the M1 Max and rounded up) and the
// scale is lowered at once, before the engine draws it. The engine has a guard of its own as the last word (diskGuard,
// given the same budget): a route that comes around this one (a script's diskSet, a key) is held there, and told here
// ('diskguard'). Running frames stay within the cap (gc.cap, a step of LADDER); where the device is
// guarded the cap climbs one step at a time, each from frames measured at most a step below, and only while the next is
// predicted under UP_K GUARD_MS (between that and GUARD_MS it holds: the hysteresis), and GUARD_HOLD after the last
// change (doubled, to GUARD_HOLD_MAX, each time a step up is taken back within 4 s). A still picture (the clock paused) may be finer, STILL_MS a frame in all, its frames cut
// into bands of about GUARD_MS sent one per animation frame (the engine's diskBands; it cuts more where a band runs long,
// and the band across the disk costs more than the sky's: UNEVEN). DESIGN.md, section 22.
const FACTOR = { model: 1 };   // (the engine's, taken at the start)
let CUT_F = 3;
// (the ladder starts at 0.125: at the engine's lowest scale, 0.1, the CO line's mean velocity went black with NaN specks
// and the context was lost, twice in round 3's checks; 0.12 was safe)
const STILL_MS = 400, RAMP = 1.25, UP_K = 0.7, UNEVEN = 2, GUARD_HOLD = 1500, GUARD_HOLD_MAX = 24000, LADDER = [0.125, 0.16, 0.2, 0.25, 0.32, 0.4, 0.5, 0.63, 0.8, 1];
let guarded = true, GUARD_MS = 70, calibrated = false;
// gc: what is drawn now (key), a frame of it at scale 1 (c1, ms), measured or predicted, the last measures (c1 and the
// scale of each), the cap for running frames, and a still picture's scale (0 until one is chosen)
const gc = { key: '', c1: 0, measured: false, vals: [], scales: [], cap: LADDER[0], still: 0, log: [], hold: GUARD_HOLD, changed: 0, upAt: -1e9 };
const known = {};   // (the last measure of each kind, and when)
const keyOf = (s) => s.look + (s.look === 'co' ? ':' + s.coMode : '') + (s.slice && s.look === 'model' ? ':cut' : '');
const factorOf = (k) => (FACTOR[k.replace(/:cut$/, '')] || 1) * (/:cut$/.test(k) ? CUT_F : 1);
// (a frame at scale s, the fixed share counted with the pixels: an overestimate going up, where it matters)
const costAt = (s) => gc.c1 * s * s;
const stepFor = (ms) => LADDER.reduce((m, l) => (costAt(l) <= ms ? l : m), LADDER[0]);
const stillNow = () => live() && (!!S().paused || reduce) && !moveFrom;
const capRun = () => gc.cap;
function capStill() { if (!gc.still) gc.still = Math.max(gc.cap, stepFor(STILL_MS)); return gc.still; }
const allowed = () => (!calibrated ? 1 : stillNow() ? capStill() : capRun());
const glog = (what) => {
  gc.log.push({ t: Math.round(performance.now()), what, key: gc.key, c1: Math.round(gc.c1), cap: gc.cap, still: gc.still, scale: live() ? box.diskScale() : 0 }); if (gc.log.length > 60) gc.log.shift();
  // (round 10a: and in the flight record, the same decision again on the same kind counted in its entry, not repeated)
  if (what === 'bands') return;
  const l = flog.e[flog.e.length - 1], sc = live() ? box.diskScale() : 0;
  if (l && l.k === 'g' && l.w === what && l.key === gc.key) { l.x = (l.x || 1) + 1; l.cap = gc.cap; l.sc = sc; flogSoon(); }
  else flogAdd({ k: 'g', w: what, key: gc.key, c1: Math.round(gc.c1), cap: gc.cap, st: gc.still || undefined, sc });
};
let bandsSet = 0;
// the scale now within what is allowed, and the bands: a still picture's, or a running frame's where even the lowest step
// is over the budget (a frame in bands holds its moment to its end: no seams)
function guardApply() {
  if (!live() || 'lost' in lab.dataset || saving || !(gc.c1 > 0)) return;
  const cap = allowed();
  if (box.diskScale() > cap + 0.004) { box.diskScale(cap); skipFrames = 3; glog('lowered'); }
  if (runScale > gc.cap) runScale = gc.cap;
  const c = costAt(box.diskScale());
  const n = Math.min(64, stillNow() || c > GUARD_MS ? Math.max(1, Math.ceil(UNEVEN * c / GUARD_MS)) : 1);
  if (n !== bandsSet) { bandsSet = n; box.diskBands(n, GUARD_MS / GPUX); }
}
// every scale the page asks for, within the guard
function scaleTo(s) {
  if (!live()) return 0;
  box.diskScale(Math.min(s, gc.c1 > 0 ? allowed() : s));
  guardApply();
  return box.diskScale();
}
// before something else is drawn: its cost predicted from what is drawn now (or its own last measure, the larger), the cap
// lowered at once (and, where guarded, never raised on a prediction)
function guardSwitch(key) {
  if (!key || key === gc.key) return;
  if (!(gc.c1 > 0)) { gc.key = key; return; }
  predictTier(key);   // (round 9: the cheaper march from the first frame where the slowest ray is predicted too long)
  const k0 = known[key], up = factorOf(key) > factorOf(gc.key), conv = gc.c1 * factorOf(key) / factorOf(gc.key);
  // (round 10a) Going to a cheaper kind, the dearer kind's c1 divided by the ratio of the factors underestimates it: the
  // factors were measured where the dear looks' frames are mostly their floor (the slowest rays, at the guard's lowest
  // scales), and a dear look's c1 measured at a higher scale, its floor shared among more pixels, is several times smaller
  // (the visible look's still at 0.32: c1 1109, so the model's 11 against the 30 to 45 measured, in round 10a's checks;
  // the next switch back would predict the visible look from 11). So a cheaper kind takes its own last measure, whatever
  // its age, or the model's (calibrated, then measured) times its factor, if larger: the cost of a kind on this device is
  // its own, not another's scaled by the M1 Max's ratios. Going to a dearer kind, as before (the conversion overestimates)
  gc.c1 = up ? Math.max(conv, k0 && performance.now() - k0.t < 30000 ? k0.c1 : 0) : Math.max(conv, k0 ? k0.c1 : 0, modelC1 * factorOf(key));
  Object.assign(gc, { key, measured: false, vals: [], scales: [], still: 0, hold: GUARD_HOLD, changed: performance.now(), upAt: -1e9 });
  releaseHeavy(key);
  gc.cap = Math.min(stepFor(GUARD_MS), guarded ? Math.max(LADDER[0], box.diskScale()) : 1);
  glog('switch');
  if (up) record('changing');
  guardApply();
}
// (the engine's own guard lowered the scale: something came around this guard; follow it)
box.addEventListener('diskguard', (e) => {
  const d = e.detail || {};
  if (!live() || !calibrated) return;
  // (round 10a: only to the kind the state asks for: during a change of look the engine still draws the look before for
  // 300 ms, and its guard's word on such a frame switched the page's guard back to the look left: in round 10a's checks
  // the model shown with the guard on the visible look's key)
  if (d.key && d.key !== gc.key && d.key === keyOf(S())) guardSwitch(d.key);
  const to = LADDER.reduce((m, l) => (l <= d.scale + 1e-6 ? l : m), LADDER[0]);
  if (gc.cap > to) { gc.cap = to; gc.changed = performance.now(); }
  if (runScale > gc.cap) runScale = gc.cap;
  glog('engine');
  guardApply(); syncQuality();
});
// (round 9) the engine holds an observed look until its larger program is linked and warmed (its fullWarm): a line meanwhile
box.addEventListener('diskwait', (e) => { if (!live()) return; if (e.detail && e.detail.wait) note(T().preparingLook, 0); else if (stageNote.textContent === T().preparingLook) note('', 0); });
// (round 9) the engine readying its larger program after the start (its warmFull: the picture held for a moment, 1.5 s on
// the M1 Max with a fresh profile, longer on a phone): "Preparing…", if it lasts over WARM_NOTE_MS
const WARM_NOTE_MS = 300;
let warmNoteT = 0;
box.addEventListener('diskwarm', (e) => {
  clearTimeout(warmNoteT);
  if (e.detail && e.detail.warming) warmNoteT = setTimeout(() => { if (live() && !stageNote.classList.contains('on')) note(T().loading, 0); }, e.detail.now ? 0 : WARM_NOTE_MS);
  else if (stageNote.textContent === T().loading) note('', 0);
});
// (for checks: ?gpux=k counts every frame k times longer, as on a GPU k times slower)
const GPUX = Math.max(1, Number(q.get('gpux')) || 1);
// A look whose frames run over the budget even at the lowest step, in bands (its slowest ray alone: the line's moments on a
// slow GPU), is not animated on a guarded device: after three such frames the clock is paused there and the picture drawn
// as a still, in bands, with a line saying so; leaving that look starts the clock again, and the play button animates it
// anyway (then it is not paused again for that look).
let heavyHeld = '', heavyPlayed = '', heavyOver = 0;
// (round 9) The march's tier (the engine's MARCH), chosen by measurement, not by the device's name: a guarded device starts
// with the cheaper march (its first frames must be safe before anything is measured); any other keeps the full march (its
// picture unchanged) unless a frame at the lowest step, not a first use, runs past the budget three times running: then
// it too takes the cheaper march for the rest of the visit. Only then, if a look is still over the budget, is it held as a
// still (holdHeavy). DESIGN.md, section 22.
// The threshold is the slowest ray a device should draw (TIER_MS): its budget, guarded or not. (Round 9 had 200 ms where
// not guarded, the limit the full march's long-ray bounds are made for; the checks then read the visible look's frames at
// the lowest steps at 205 to 216 ms on the M1 Max, the full march's floor, against a budget of 120: a desktop whose floor
// is over its budget takes the cheaper march too.) Before a dear look is first drawn on a device that is not guarded, its
// slowest ray is predicted
// (RAY_MPX: on the M1 Max, the slowest ray of each look in the 64 x 64 check over the model's frame per megapixel at scale
// 1; times this device's model frame per megapixel, measured at the start): over TIER_MS, the cheaper march from that
// look's first frame (a weak laptop's GPU, 5 to 10 times slower than the M1 Max, would draw the full march's integrated
// intensity in 1 to 2 s a ray). DESIGN.md, section 22.
// (the gas line's, round 9 at its end: rec, the moments in passes of three groups, their longest piece: 87, 125, 125 ms)
const RAY_MPX = { optical: 2.3, mir: 2.0, 'co:chan': 1.5, 'co:m1': 2.2, 'co:m0': 2.2 };
// (round 10a: not for the rest of the visit any more: the cheaper march is taken for the kind of frame measured over the
// budget (cheapFor) and any predicted so; another kind, where the device is not guarded, starts from the full march again,
// and a quality chosen or Reset gives every kind the full march back, to be measured anew (the owner: "nothing
// irreversible"). A guarded device keeps the cheaper march throughout, as before: its first frames must be safe before
// anything is measured)
let tierOver = 0, modelPerMpx = 0, modelC1 = 0;   // (modelC1, round 10a: the model's c1 on this device, see guardSwitch)
const cheapFor = new Set();
const TIER_MS = () => GUARD_MS;
const canvasMpx = () => { const c = box.querySelector(':scope > canvas'); return c ? c.width * c.height / 1e6 : 1; };
function predictTier(key) {
  if (!box.diskMarch || !(modelPerMpx > 0)) return;
  const k = key.replace(/:cut$/, ''), r = RAY_MPX[k];
  if (cheapFor.has(k) || (r && r * modelPerMpx > TIER_MS())) {
    if (box.diskMarch() !== 'cheap') { box.diskMarch('cheap'); glog('cheap march' + (cheapFor.has(k) ? '' : ' (predicted ' + Math.round(r * modelPerMpx) + ' ms)')); diag.guard.march = 'cheap'; }
  } else if (!guarded && box.diskMarch() === 'cheap') { box.diskMarch('full'); tierOver = 0; glog('full march'); diag.guard.march = 'full'; }
}
function chooseTier(d) {
  if (!box.diskMarch || box.diskMarch() === 'cheap') return false;
  // (at the two lowest steps: the guard steps between them, and each step back up had set the count back)
  if (box.diskScale() > LADDER[1] + 1e-3 || !(Math.max(d.vband, d.bands > 1 ? 0 : d.vol) > TIER_MS())) { tierOver = 0; return false; }
  if (++tierOver < 3) return false;
  tierOver = 0; cheapFor.add(gc.key.replace(/:cut$/, '')); box.diskMarch('cheap'); glog('cheap march'); diag.guard.march = 'cheap';
  return true;
}
// (round 10a) the visitor's choice of a quality, or Reset: the latches of the guard let go (the hold before the cap climbs
// back to its shortest, a heavy look's held clock), to be measured anew. Not the kinds measured over the budget with the
// full march (cheapFor): their floor is the slowest ray's, the same at any quality (round 10a's first try gave them the
// full march back here, and the check of the guard read 260 ms pieces of the visible look on the M1 Max until it was
// measured over again); Reset forgets them too
function guardAfresh(all = false) {
  tierOver = 0; heavyPlayed = '';
  gc.hold = GUARD_HOLD; gc.upAt = -1e9;
  if (all) { cheapFor.clear(); if (!guarded && box.diskMarch && box.diskMarch() === 'cheap') predictTier(gc.key); }
}
function holdHeavy(d) {
  if (chooseTier(d)) return;
  if (!guarded || d.still || reduce || box.diskScale() > LADDER[0] + 1e-3 || !(Math.max(d.vband, d.bands > 1 ? 0 : d.vol) > 1.5 * GUARD_MS)) { heavyOver = 0; return; }
  if (++heavyOver < 3 || S().paused || heavyPlayed === gc.key) return;
  heavyHeld = gc.key; heavyOver = 0;
  box.diskPlay(false); glog('held still'); note(T().heavyStill, 9000); sync();
}
function releaseHeavy(key) {
  if (!heavyHeld || key === heavyHeld) return;
  heavyHeld = '';
  if (live() && S().paused && !restedByIdle) { box.diskPlay(true); sync(); }
}
box.addEventListener('diskgpu', (e) => {
  const d = { ...e.detail }, key = String(d.key || '').replace(/:F$/, '');
  d.ms *= GPUX; d.band *= GPUX; d.pre = (d.pre || 0) * GPUX; d.vband = d.vband != null ? d.vband * GPUX : d.band;
  // (round 10a: the volume's cost, without the work before it, a piece of its own that does not grow with the pixels: see
  // the engine's gNote)
  d.vol = Math.max(0, d.ms - d.pre);
  // (a first use: the engine's program making its pipeline for a blend state, not the frame's cost; see the engine's warmFull)
  if (mode !== 'live' || !(d.scale > 0) || !(d.ms > 0) || d.first || 'lost' in lab.dataset) return;
  const c = d.vol / (d.scale * d.scale), now = performance.now();
  if (d.bands === 1) known[key] = { c1: c, t: now };   // (a frame in bands carries the looks' delay in each band: see below)
  if (key !== gc.key) return;
  // (a frame in bands: each band's measure carries the delay of the looks for its fence, a few ms, so their sum grows with
  // their number, and taken as the frame's cost it would ask for more bands still. Its longest band times their number
  // bounds the frame from above: cheap bands lower the estimate, so that fewer are used; a band past twice the budget
  // raises it, as the engine itself then cuts more)
  if (d.bands > 1) {
    const cb = d.vband * d.bands / (d.scale * d.scale), c0 = gc.c1;
    if (d.vband > 2 * GUARD_MS) gc.c1 = Math.max(gc.c1, cb / UNEVEN);
    else if (d.vband < 0.5 * GUARD_MS) gc.c1 = Math.min(gc.c1, cb);
    if (gc.c1 !== c0) glog('bands');
    guardApply();
    holdHeavy(d);
    return;
  }
  gc.vals.push(c); gc.scales.push(d.scale);
  if (gc.vals.length > 5) { gc.vals.shift(); gc.scales.shift(); }
  const med = gc.vals.slice().sort((a, b) => a - b)[gc.vals.length >> 1];
  // (one running frame far over the budget counts at once; otherwise the median of the last five: a light frame's
  // measure varies by half from one to the next, with the display's own work and the looks for the fence)
  gc.c1 = d.vol > 2 * GUARD_MS && !d.still ? Math.max(c, med) : med;
  gc.measured = gc.vals.length >= 3;
  if (gc.measured && gc.key === 'model') modelC1 = gc.c1;   // (round 10a: see guardSwitch)
  const cap0 = gc.cap;
  // (round 10a: the hold, doubled each time a step up was taken back, halves again once the cap has stayed four holds)
  if (gc.hold > GUARD_HOLD && now - gc.changed > 4 * gc.hold) { gc.hold = Math.max(GUARD_HOLD, gc.hold / 2); gc.changed = now; }
  if (d.still) { if (gc.still && costAt(gc.still) > 1.5 * STILL_MS) { gc.still = stepFor(STILL_MS); glog('still lowered'); } }
  else if (costAt(gc.cap) > GUARD_MS) {
    gc.cap = stepFor(GUARD_MS);
    // (a step up taken back soon: wait twice as long before the next, as Best's quiet steps do)
    if (now - gc.upAt < 4000) gc.hold = Math.min(GUARD_HOLD_MAX, 2 * gc.hold);
    gc.changed = now;
  } else if (gc.measured && now - gc.changed >= gc.hold) {
    const up = LADDER.find((l) => l > gc.cap + 1e-6);
    // (where guarded, at most the step above the highest scale measured. Round 9: this was RAMP times it, and four of the
    // ladder's steps are a little more than 1.25 apart (0.125 to 0.16, 0.25 to 0.32, 0.5 to 0.63, 0.63 to 0.8): a guarded
    // device that came down to one of them never climbed again, in the model look too)
    const top = Math.max(...gc.scales), iTop = LADDER.reduce((m, l, i) => (l <= top + 1e-3 ? i : m), 0);
    if (up && costAt(up) <= UP_K * GUARD_MS && (!guarded || LADDER.indexOf(up) <= iTop + 1)) { gc.cap = up; gc.upAt = gc.changed = now; }
  }
  if (gc.cap !== cap0) glog(gc.cap > cap0 ? 'up' : 'down');
  if (phase === 'changing' && gc.measured) record('live');
  holdHeavy(d);
  guardApply();
  if (gc.cap !== cap0) syncQuality();
});

// ---------- the citation ----------
function renderCite() {
  const w = T().cite, line = w.line(CITE_YEAR, CITE_URL, VERSION);
  $('citeRail').replaceChildren(document.createTextNode(w.lead + ' '), el('span', { class: 'cite-line' }, line), ' ', el('button', { type: 'button', class: 'chip quiet', id: 'citeCopy' }, w.copy));
  $('citeAbout').textContent = w.lead; $('citeLine').textContent = line;
}
async function copyCite() {
  try { await navigator.clipboard.writeText(T().cite.line(CITE_YEAR, CITE_URL, VERSION)); note(T().cite.copied); } catch { note(T().cite.line(CITE_YEAR, CITE_URL, VERSION), 6000); }
}

// ---------- time ----------
playBtn.addEventListener('click', () => {
  if (!live()) return;
  if (S().paused && heavyHeld === gc.key) { heavyPlayed = heavyHeld; heavyHeld = ''; }   // (round 9: animated anyway, see holdHeavy)
  box.diskPlay(!!S().paused); sync();
});

// ---------- sharing ----------
const LINK_KEYS = ['el', 'az', 'd', 'mode', 'field', 'ann', 'asym', 'marks', 'waves', 'slice', 'sq', 'p', 'look', 'speed', 'paused'];
function linkFor(s) {
  const u = new URL(location.href); u.search = '';
  u.searchParams.set('place', PLACES[placeI].id);
  for (const k of LINK_KEYS) u.searchParams.set(k, String(s[k]));
  if (s.tx || s.ty || s.tz) for (const k of ['tx', 'ty', 'tz']) u.searchParams.set(k, String(s[k]));
  if (s.look === 'co') { u.searchParams.set('com', s.coMode); u.searchParams.set('cov', String(s.coV)); }
  if (!s.ms) u.searchParams.set('ms', '0');
  if (s.bg && s.bg !== 'stars') u.searchParams.set('bg', s.bg);   // (round 8: the background, when not the stars)
  // (round 8: with each planet's mass in M_J; a link without it is read as Jupiter's)
  if (s.planets.length) u.searchParams.set('pl', s.planets.map(([a, on, m]) => a + ':' + on + ':' + m).join(','));
  u.searchParams.set('t', String(Math.round(s.time * 1000) / 1000));
  u.searchParams.set('lang', L());
  return u.href;
}
async function copyLink() {
  const href = linkFor(S()), field = $('linkField');
  try { await navigator.clipboard.writeText(href); field.hidden = true; note(T().linkCopied); }
  catch { field.value = href; field.hidden = false; field.focus(); field.select(); note(T().linkShown, 4000); }
}
let saving = false;
// (round 7, the owner: "offering a resolution when saving is a good idea") The saved picture's size: as the screen (its
// pixels, up to twice the CSS size), twice that each way, or 3840 px wide (4K), within what the GPU allows (diskSnapMax:
// the largest texture, renderbuffer and viewport, and 8192 px) and at most SAVE_MPX million pixels. The volume is drawn
// at that size, each frame in bands of about SAVE_BAND_MS on the GPU (predicted from the frames just drawn: a frame of
// seconds makes the system stop the GPU and the WebGL context is lost), and where even SAVE_BANDS bands would not keep it
// so (next to the star in some looks), at a lower render scale, said so in the note; the lines, labels and the mark are
// drawn at the full size from their vectors. The frames are drawn one at a time, with the progress. The CO look saves at
// the screen's size only: its line transfer costs some 30 times the model's a frame (the moments at 4K took 0.4-40 s a
// frame in a trial, at 17 % of the pixels, in eight bands, and three such trials made Chrome turn WebGL off until it was
// restarted), for a picture already drawn at 12 % of the screen's pixels; so does a view whose frame on the screen already
// takes over SAVE_HEAVY ms (measured just before, diskCost), and a camera within SAVE_NEAR au of the star (the magnetosphere
// and the inner disk's eddies are drawn there, a frame some four times the whole disk's).
// (round 9) The plan from the guard's cost of a frame (gc.c1, or the frame measured just before saving, the larger): a
// frame at most SAVE_MS in all (SAVE_MS_SCREEN at the screen's size), in bands of the guard's budget (GUARD_MS), each
// sent in a task of its own and waited for (the engine's snapshot); before, bands of 250 ms, all sent in one task.
const SAVE_SIZES = ['1', '2', '4k'], SAVE_MPX = 12, SAVE_MS = 2000, SAVE_MS_SCREEN = 400, SAVE_FRAMES = 12, SAVE_HEAVY = 400, SAVE_NEAR = 2;
let saveSize = '1';
try { const k = sessionStorage.getItem(KEY('disk-lab-save-size')); if (SAVE_SIZES.includes(k)) saveSize = k; } catch { /* the default */ }
const saveSizeButtons = SAVE_SIZES.map((k) => {
  const b = el('button', { type: 'button', 'data-save-size': k, 'aria-pressed': String(k === saveSize) });
  $('saveSizeGroup').append(b);
  return b;
});
// the plan for the size chosen: k (times the screen's pixels each way), the picture's size, the render scale and the bands
// (fm: the cost of a frame now, measured just before saving (diskCost); the frames' intervals otherwise, for the note)
function savePlan(fmNow) {
  const m = box.diskSnapMax(), [sw, sh] = m.screen;
  let k = saveSize === '4k' ? 3840 / sw : Number(saveSize);
  // (a frame at scale 1 on the screen, ms of the GPU's own time: the guard's, or the frame measured just now if dearer)
  const sc = box.diskScale(), c1 = Math.max(gc.c1 > 0 ? gc.c1 / GPUX : 0, fmNow > 0 ? fmNow / (sc * sc) : 0) || 400, band = GUARD_MS / GPUX;
  // (the CO look, and a view whose frame on the screen already takes over SAVE_HEAVY ms, at the screen's size only)
  const st = S(), e = st.el * Math.PI / 180, a = st.az * Math.PI / 180;
  const camR = Math.hypot(st.tx + st.d * Math.cos(e) * Math.cos(a), st.ty + st.d * Math.cos(e) * Math.sin(a), st.tz + st.d * Math.sin(e));
  k = st.look === 'co' || c1 * sc * sc > SAVE_HEAVY || camR < SAVE_NEAR ? 1 : Math.max(1, Math.min(k, m.k, Math.sqrt(SAVE_MPX * 1e6 / (sw * sh))));
  // (a frame at render scale `to` and k times the pixels)
  const cost = (to) => c1 * k * k * to * to, total = k === 1 ? SAVE_MS_SCREEN : SAVE_MS;
  const to = Math.max(0.1, Math.min(1, Math.sqrt(total / (c1 * k * k))));
  const bands = Math.min(64, Math.max(1, Math.ceil(UNEVEN * cost(to) / band)));
  return { k, w: Math.round(sw * k), h: Math.round(sh * k), to: Math.round(to * 100) / 100, bands, band };
}
// (p: a plan measured just before saving, which may differ from the one the note showed: then the note says the new one)
function renderSaveSize(p = null) {
  const w = T().saveSize;
  saveSizeButtons.forEach((b) => { b.textContent = w[{ 1: 'screen', 2: 'twice', '4k': 'uhd' }[b.dataset.saveSize]]; pressed(b, b.dataset.saveSize === saveSize); });
  $('saveSizeGroup').setAttribute('aria-label', w.label);
  if (!live()) { $('saveSizeNote').textContent = ''; return; }
  p = p || savePlan();
  $('saveSizeNote').textContent = saveSize !== '1' && p.k === 1 ? w.coScreen(p.w, p.h) : p.k > 1 && p.to < 0.999 ? w.lower(p.w, p.h, Math.round(100 * p.to)) : w.note(p.w, p.h);
}
async function saveImage(btn) {
  if (saving) return;
  saving = true; btn.disabled = true; note(T().imageBusy, 0);
  try {
    // (at the screen's size: at its resolution where a frame there is predicted under SAVE_MS_SCREEN, else at the scale that
    // keeps it so; a saved picture of the CO line's moments at full resolution took seconds a frame. Round 9: the frame
    // measured just before saving is the running one, within the guard's budget)
    const p = savePlan(saveSize !== '1' ? await box.diskCost() : 0);
    renderSaveSize(p);
    const c = await shot({ scale: p.to, size: p.k, bands: p.bands, bandMs: p.band, frames: SAVE_FRAMES, onFrame: (i, n) => note(T().imageProgress(i, n), 0) });
    if (c) await watermark(c);
    const blob = c && await toPng(c);
    if (!blob) throw new Error('no picture');
    const a = el('a', { href: URL.createObjectURL(blob), download: `disk-lab-${PLACES[placeI].id}${p.k > 1 ? '-' + c.width + 'x' + c.height : ''}.png` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    note(T().imageDone);
  } catch { note(T().imageFailed, 4000); }
  finally { saving = false; btn.disabled = false; }
}
// a picture of the model, with the governor resting meanwhile
async function shot(opts) {
  if (gov) gov.pause(true);
  try { return await snapshot(box, opts); } finally { govRest(); }
}
// the site's mark, white and faint, in the lower right of a saved picture (as on the stage): a help to whoever cites it
let markImg = null;
async function watermark(c) {
  if (!markImg) { markImg = new Image(); markImg.src = 'logo-white.svg'; }
  try { await markImg.decode(); } catch { return; }
  const g = c.getContext('2d'), w = Math.round(c.width * 0.06), h = Math.round(w * 677 / 1874), m = Math.round(c.width * 0.012);
  g.save(); g.globalAlpha = 0.2; g.drawImage(markImg, c.width - w - m, c.height - h - m, w, h); g.restore();
}
// a link's mode with the gas and its dust as one: either of the engine's bits 1 and 2 turns on both (round 6)
const linkMode = (m) => (Number.isInteger(m) && (m & 3) ? m | 3 : m);
// a link's state: the place first, then any of the engine's keys (diskSet checks every value)
function stateFromLink() {
  const NUM = ['p', 'el', 'az', 'd', 'tx', 'ty', 'tz', 'mode', 'field', 'speed', 'paused', 'slice', 'ann', 'ms', 'asym', 'marks', 'waves'];
  const st = {};
  for (const k of NUM) if (q.has(k)) st[k] = q.get(k);
  if (st.mode != null) st.mode = linkMode(Number(st.mode));
  if (q.has('sq')) st.sq = q.get('sq');
  if (q.has('look')) st.look = q.get('look');
  if (q.has('bg')) st.bg = q.get('bg');
  if (q.has('com')) st.coMode = q.get('com');
  if (q.has('cov')) st.coV = q.get('cov');
  if (q.has('t')) st.time = q.get('t');
  if (q.has('pl')) st.planets = q.get('pl').split(',').filter(Boolean).map((t) => t.split(':').map(Number));
  return Object.keys(st).length ? st : null;
}

// ---------- the two halves on a narrow screen: the sandbox (default) and the highlights ----------
function setTab(t) {
  lab.dataset.tab = t === 'tour' ? 'tour' : 'explore';
  pressedTab();
}
function pressedTab() {
  const tour = lab.dataset.tab === 'tour';
  $('tabExplore').setAttribute('aria-selected', String(!tour)); $('tabTour').setAttribute('aria-selected', String(tour));
  $('tabExplore').tabIndex = tour ? -1 : 0; $('tabTour').tabIndex = tour ? 0 : -1;
}
$('tabExplore').addEventListener('click', () => setTab('explore'));
$('tabTour').addEventListener('click', () => setTab('tour'));
$('tabs').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault(); setTab(lab.dataset.tab === 'tour' ? 'explore' : 'tour'); $(lab.dataset.tab === 'tour' ? 'tabTour' : 'tabExplore').focus();
});
lab.dataset.tab = q.get('place') ? 'tour' : 'explore';
pressedTab();
// (the two halves are tab panels only where they are tabs)
const narrow = matchMedia('(max-width: 860px)');
const tabRoles = () => { for (const id of ['rail', 'dock']) { if (narrow.matches) $(id).setAttribute('role', 'tabpanel'); else $(id).removeAttribute('role'); } };
narrow.addEventListener('change', tabRoles); tabRoles();

// ---------- language ----------
function setLang(l) {
  html.lang = l; html.classList.toggle('lang-ja', l === 'ja');
  try { sessionStorage.setItem(KEY('site-language'), l); } catch { /* the choice still applies to this page */ }
  actionsKey = lookKey = cutKey = '';
  if (mode !== 'live' || 'lost' in lab.dataset) setPoster(PLACES[placeI].id);   // (the stills carry their labels)
  renderAll();
}
document.querySelectorAll('.lang-switch [data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));

// ---------- the way home ----------
// When the page before this one in the tab is the site's home page (the visitor came in by its card), the bar's link
// goes back to it rather than loading it anew: the home page comes back as it was left, scrolled to the card, and the
// stage returns into the card (index.html, the view transition). Elsewhere the link is an ordinary link.
lab.querySelector('.mark .home').addEventListener('click', (e) => {
  const nav = window.navigation;
  if (!nav || !nav.currentEntry || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const prev = nav.entries()[nav.currentEntry.index - 1], u = prev && prev.url ? new URL(prev.url) : null;
  if (u && u.origin === location.origin && u.pathname === '/') { e.preventDefault(); nav.back(); }
});

// ---------- the dialog ----------
const about = $('about');
$('aboutOpen').addEventListener('click', () => { about.showModal(); });
$('aboutClose').addEventListener('click', () => about.close());
about.addEventListener('click', (e) => { if (e.target === about) about.close(); });   // (a click on the backdrop)
about.addEventListener('close', () => $('aboutOpen').focus({ preventScroll: true }));

// ---------- the stage's hint, and the wheel ----------
let hintTimer = 0;
function hint(on) {
  clearTimeout(hintTimer);
  stageHint.classList.toggle('on', on);
  if (on) hintTimer = setTimeout(() => stageHint.classList.remove('on'), 6000);
}
// The page does not scroll under the stage, so the wheel over the picture zooms without a click first: the canvas takes
// the focus before the engine's own listener sees the event (the engine zooms only with the focus or Ctrl/Cmd held).
stage.addEventListener('wheel', (e) => {
  const c = box.querySelector(':scope > canvas');
  if (c && e.target === c && document.activeElement !== c && !e.ctrlKey && !e.metaKey) { c.dataset.quietFocus = ''; c.focus({ preventScroll: true }); }
}, { capture: true, passive: true });
// (focus given for the wheel draws no ring until a key is used on the picture)
stage.addEventListener('keydown', (e) => { if (e.target.dataset) delete e.target.dataset.quietFocus; }, { capture: true });
stage.addEventListener('focusout', (e) => { if (e.target.dataset) delete e.target.dataset.quietFocus; });
stage.addEventListener('pointerdown', () => hint(false), { capture: true, passive: true });
stage.addEventListener('wheel', () => hint(false), { capture: true, passive: true });

// ---------- a still picture at the screen's full resolution ----------
// While the model is paused (or the clock is stopped for reduced motion) and nothing moves, the engine averages jittered
// frames into one picture (its accumulation, accMax frames). When that picture is complete, the page has it drawn again
// at a higher render scale, up to the screen's full resolution (1), since no frame rate is at stake; the first touch, key
// or wheel on the page brings back the running scale before the engine sees the event. The scale is the guard's for a
// still picture (round 9, capStill: STILL_MS a frame, in bands of GUARD_MS; until round 8 the one whose frame was predicted
// at 150 ms from the accumulation's own frames, drawn whole: the CO line's moments cost some 30 times the model, next to
// the star a frame costs 4 times the whole disk's; at scale 1 a frame of the moments took seconds, and the GPU dropped the
// WebGL context).
let sharpFrom = 0, runScale = 0;   // runScale: the scale the model runs at (calibrated, then governed)
let lastFrame = 0, lastIdle = false, holdSharp = false, sharpWhat = '', frameMs = 0;   // sharpWhat: the look sharpened
document.addEventListener('visibilitychange', () => { lastFrame = 0; });
const recent = [];                 // the intervals between the accumulation's frames (ms; the last 12)
function unsharpen() {
  if (!sharpFrom) return;
  const sharpFrom0 = sharpFrom;
  sharpFrom = 0; recent.length = 0; scaleTo(sharpFrom0);
  govRest();
}
function onAccumulated() {
  if (!live() || sharpFrom || moveFrom || holdSharp || quality !== 'auto' || 'lost' in lab.dataset || !(S().paused || reduce) || saving || recent.length < 4) return;
  // (round 9: as fine as the guard's still picture, capStill: STILL_MS a frame, drawn in bands of GUARD_MS; it was the scale
  // whose frame the accumulation's own intervals predicted at SHARP_MS, drawn whole)
  const s = box.diskScale(), to = Math.min(1, capStill());
  if (to < 1.15 * s) return;
  sharpFrom = s; recent.length = 0; sharpWhat = S().look + S().coMode;
  if (gov) gov.pause(true);
  scaleTo(to);
}
for (const type of ['pointerdown', 'keydown']) lab.addEventListener(type, unsharpen, { capture: true });
stage.addEventListener('wheel', unsharpen, { capture: true, passive: true });

// ---------- still pictures ----------
function renderStillNote() {
  if (mode !== 'still') { stillNote.hidden = true; return; }
  const w = T().still, kids = [stillReason === 'blocked' ? w.blocked(w.restart[RESTART](APP)) : w[stillReason] || w.forced];
  if (['software', 'slow', 'forced'].includes(stillReason)) {
    kids.push(el('button', { type: 'button', class: 'action', onclick: () => {
      const u = new URL(location.href); u.searchParams.delete('still'); u.searchParams.set('gl', 'force'); location.replace(u.href);
    } }, w.tryLive));
  }
  // (the live model failing to start, or finding no WebGL: a reload may find it again. Round 9: not where the browser has
  // stopped WebGL (blocked), which only quitting and reopening it brings back, as the note says; nor in WebKit with no WebGL)
  if (stillReason === 'failed' || (stillReason === 'nogl' && RESTART === 'other')) kids.push(el('button', { type: 'button', class: 'action', onclick: retryLive }, w.retry));
  // (why it failed, small, so that a report can say: the engine's box.dataset.fallbackError, or the probe's reason)
  const why = ['failed', 'blocked'].includes(stillReason) ? (box.dataset.fallbackError || diag.failError || '') : '';
  if (why) kids.push(el('span', { class: 'still-why' }, '(' + why + ')'));
  kids.push(el('span', { class: 'still-why' }, VERSION_LINE));   // (round 10a: the build, on every still screen)
  stillNote.replaceChildren(...kids.map((k) => (typeof k === 'string' ? document.createTextNode(k) : k)));
  stillNote.hidden = false;
}
function enterStill(reason) {
  mode = 'still'; stillReason = reason; lab.dataset.state = 'still';
  if (typeof box.diskPlay === 'function') box.diskPlay(false);
  if (gov) { gov.stop(); gov = null; }
  posterKey = ''; setPoster(PLACES[placeI].id);
  note('', 0);
  renderAll();
  // (round 10a: where WebGL has stopped, what helps on the stage itself too, at its top: on a phone the note under the
  // picture may lie under the browser's bar)
  if (reason === 'blocked') note(T().still.blocked(T().still.restart[RESTART](APP)), 0);
  showLogLink();   // (round 10a: the last bad end's record, in the About dialog)
  flogDevice(null);   // (round 10a: the device, and why it shows stills, without the engine)
}

// ---------- starting ----------
function loadEngine() {
  return new Promise((resolve, reject) => {
    const s = el('script', { src: ENGINE_SRC });
    s.onload = resolve; s.onerror = () => reject(new Error('engine did not load'));
    document.body.append(s);
  });
}

// (round 10a) After a bad end whose record names what was in view (an observed look, the line's map, the cut: avoid), only
// that is left out: the link or the kept settings are applied otherwise as they are (avoided), the model look in its place
// and Auto this once. Where the record does not say, or it was the model look itself, the safe start of round 9: the whole
// disk, the model look, no cut, Auto, whatever the address asks for.
const avoid = (() => {
  const k = crashed && verdict.culprit ? verdict.culprit.key : '';
  const look = k.split(':')[0], cut = /:cut$/.test(k);
  return k && LOOKS.includes(look) && (look !== 'model' || cut) ? { key: k, look, cut } : null;
})();
const avoided = (st) => {
  if (!st || !avoid) return st;
  const o = { ...st };
  if (avoid.look !== 'model' && o.look === avoid.look) o.look = 'model';
  if (avoid.cut) o.slice = 0;
  return o;
};
async function start() {
  // (round 9: after a visit that ended badly, the whole disk, whatever the address asks for; round 10a: see avoid)
  const linkPlace = placeById(q.get('place')), placeOk = linkPlace && (!avoid || (!(avoid.cut && linkPlace.cut) && linkPlace.look !== avoid.look));
  const first = ((!crashed || avoid) && placeOk && linkPlace) || PLACES[0];
  placeI = PLACES.indexOf(first);
  fitStage(); setPoster(first.id);
  renderAll();
  if (q.get('still') === '1') return enterStill('forced');
  diag.probe = probe();
  // (no WebGL2 after a visit that lost it, or on a retry: the browser has stopped WebGL)
  if (!diag.probe.ok && q.get('gl') !== 'force') { const r = crashed && diag.probe.reason === 'nogl' ? 'blocked' : diag.probe.reason; record(r === 'blocked' ? 'blocked' : 'still'); return enterStill(r); }
  // (round 9) the guard's budget and the default quality for this device: a phone or tablet, or a browser without GPU timer
  // queries (Safari), is guarded (GUARD_MS 70 ms, the cap climbs a step at a time) and starts at Auto; elsewhere Best, as
  // before, within a budget of 120 ms. A level chosen by the visitor is kept, guarded the same; after a bad end, Auto.
  guarded = MOBILE || coarse || !diag.probe.timer;
  GUARD_MS = guarded ? 70 : 120;
  // (for checks: ?guard=<ms> guards as a phone would, with that budget)
  if (Number(q.get('guard')) > 0) { guarded = true; GUARD_MS = Math.max(5, Number(q.get('guard'))); }
  diag.guard = { guarded, budget: GUARD_MS, mobile: MOBILE, timer: !!diag.probe.timer, crashed, previous: prevRec };
  if (crashed) { quality = 'auto'; qChosen = false; }
  else if (!qChosen) quality = guarded ? 'auto' : 'full';
  record('starting');
  // (after the way in from the site, if the page was entered by it: index.html, window.diskLabArrival)
  if (window.diskLabArrival) await window.diskLabArrival;
  note(T().loading, 0);
  // (the engine reads these when it starts: the first frame is the place's, the Home key goes to the fitted whole disk)
  const whole = PLACES[0];
  Object.assign(box.dataset, { elevation: String(first.view.el), azimuth: String(first.view.az), distance: String(Math.round(fitDistance(whole, aspect()) * 1000) / 1000) });
  if (!first.field) box.dataset.nofield = '';
  if (q.get('motion') === 'reduce') box.dataset.static = '';
  // (the wind symmetric by default, as the client asked; the one-sided wind of Mori, Bai & Tomida 2025 is a control)
  box.dataset.asym = 'off';
  // (round 9: the engine's first frames, and the calibration's, at a modest scale: lower where guarded)
  box.dataset.scale = guarded ? '0.35' : '0.5';
  // (round 10a, for a comparison on the phone: ?math=safe, the engine's main programs compiled with safe math, see its
  // SAFE_MATH; the record says which ran)
  if (q.get('math') === 'safe') box.dataset.math = 'safe';
  if (SWITCH.eddy) box.dataset.eddy = 'off';   // (round 10a: see SWITCH)
  box.setAttribute('data-disk3d', '');
  try { await loadEngine(); } catch (e) { diag.failError = String((e && e.message) || e); record('failed'); return enterStill('failed'); }
  if (typeof box.diskState === 'function') DEF0 = pick(box.diskState(), DEF_KEYS);   // (the engine's own start: the defaults Reset returns to)
  if (typeof box.diskGuard === 'function') { const g0 = box.diskGuard(); Object.assign(FACTOR, g0.factors); CUT_F = g0.cut; }
  diag.timings.engine = Math.round(performance.now() - t0);
  // (the probe found WebGL2 with float targets, but the engine's own context came out lost or without them: the browser's
  // WebGL is stuck, as in Safari on 2026-10-17, where only quitting and reopening the browser brought it back; a reload does not)
  if (box.classList.contains('disk-fallback') && /^(the WebGL2 context was lost|no float render targets)/.test(box.dataset.fallbackError || '')) { record('blocked'); return enterStill('blocked'); }
  if (typeof box.diskSet !== 'function' || box.classList.contains('disk-fallback')) { record('failed'); return enterStill('failed'); }
  mode = 'live';
  lab.dataset.state = 'loading';
  // the place (in the model look or the millimetre's, a cut at most: light enough to measure), measured before the picture
  // is shown; then what a link asks for, through the guard (round 9: a link's look was set before the calibration, which
  // then drew ten frames of it at once)
  goPlace(placeI, { fly: false });
  try { diag.calibration = await calibrate(box); } catch (e) { diag.calibration = { error: String(e) }; }
  diag.timings.calibrated = Math.round(performance.now() - t0);
  if (diag.calibration && diag.calibration.slow && q.get('gl') !== 'force') { record('still'); return enterStill('slow'); }
  // (the guard's start: a frame at scale 1 from the calibration's, a fifth more for a running frame than for the idle
  // GPU's; the cap the step within the budget, where guarded at most a step above the scale measured)
  const cal = diag.calibration || {}, ref = cal.t1 > 0 ? [cal.t1, cal.s1] : [cal.t0, cal.s0];
  gc.key = keyOf(S());
  gc.c1 = ref[0] > 0 && ref[1] > 0 ? GPUX * 1.2 * ref[0] / (ref[1] * ref[1]) : 400;
  // (the prediction's measure, from the calibration as the ratios were: the running model's c1 is several times higher, its
  // fixed costs divided by a small scale squared)
  if (gc.key === 'model') modelPerMpx = gc.c1 / canvasMpx();
  modelC1 = gc.c1 / factorOf(gc.key);   // (round 10a: see guardSwitch)
  gc.cap = Math.min(stepFor(GUARD_MS), guarded ? RAMP * (ref[1] || 0.35) : 1);
  calibrated = true;
  glog('calibrated');
  // (round 9) the march's tier: the cheaper one from the start where guarded, before a kept or linked look is drawn (see
  // chooseTier)
  engineSettings();
  // (round 9: with no link, the settings and view the visitor left, kept on this device: a link wins over them)
  // (round 10a: after a bad end, without what was in view then, avoided; none where the record does not say)
  const linked = crashed && !avoid ? null : avoided(stateFromLink() || (q.has('place') ? null : keptState()));
  if (linked) { const s0 = S(); guardSwitch(keyOf({ ...s0, ...linked, slice: linked.slice != null ? Number(linked.slice) : s0.slice })); box.diskSet(linked); }
  if (linked && linked.place) { const i = PLACES.findIndex((p) => p.id === linked.place); if (i >= 0) { placeI = i; renderPlace(); } }
  defaults = { ...DEF0, quality: guarded ? 'auto' : 'full' };
  // (round 10a: after a safe start the kept settings are not written over until the visitor does something, so that they are
  // still there to be offered back, or to come back by themselves at the next visit)
  keeping = !crashed;
  if (crashed) for (const t of ['pointerdown', 'keydown']) lab.addEventListener(t, () => { keeping = true; }, { capture: true, once: true });
  lab.dataset.state = 'live';
  note('', 0);
  runScale = Math.min(box.diskScale(), gc.cap);
  if (!reduce) gov = govern(box, { base: diag.calibration && diag.calibration.scale || 0.5, running: () => !S().paused,
    floor: () => (S().look === 'co' ? CO_FLOOR : MIN_SCALE), cap: () => (stillNow() ? 1 : capRun()), onChange: (sc) => { runScale = sc; } });
  if (quality !== 'auto') applyQuality(quality);
  else { box.diskSet({ fx: fxAuto() }); scaleTo(box.diskScale()); }   // (round 8: the finish for Auto, see FX_OF)
  // (round 9: the frame rate's cap, the eddies' cadence and the GPU timer: see engineSettings)
  // (for checks: ?gputime=1, each piece of GPU work timed on the GPU too, see the engine's diskGpuTime)
  if (q.get('gputime') === '1' && typeof box.diskGpuTime === 'function') box.diskGpuTime(1);
  diag.guard.march = typeof box.diskMarch === 'function' ? box.diskMarch() : null;
  record('live');
  flogDevice(linked ? { look: linked.look, place: linked.place, slice: linked.slice, coMode: linked.coMode, d: linked.d, from: stateFromLink() ? 'link' : 'kept', avoided: avoid ? avoid.key : undefined } : crashed ? { safe: 1 } : null);
  if (crashed) showSafe();
  else showLogLink();
  if (reduce) { const r = $('reducedNote'); r.textContent = T().reduced; r.hidden = false; playBtn.hidden = true; $('speedGroup').hidden = true; }
  sync();
  hint(true);
  diag.timings.live = Math.round(performance.now() - t0);
  armIdle();
}

// (round 10a) What the page sets in the engine for this device, once the guard is calibrated, and again when the engine is
// built anew after a lost context was given back (its build starts from its defaults: round 9 left the engine's own guard
// off, the full march on a guarded device, no frame-rate cap and the eddies every frame after a restore): its guard's budget
// and the kind measured, the march's tier (the cheaper on a guarded device; else for the kinds measured over the budget),
// the frame rate while only the clock moves (FPS_STILL, a phone or tablet FPS_STILL_PHONE; the display's own while the view
// moves or anything changes), and on a guarded device the eddies' volume every other frame while only the clock moves
function engineSettings() {
  if (typeof box.diskGuard !== 'function') return;
  box.diskGuard({ ms: GUARD_MS / GPUX, key: gc.key, c1: gc.c1 / GPUX });   // (the engine's own guard, the same budget)
  if (typeof box.diskMarch === 'function') { if (guarded) box.diskMarch('cheap'); else predictTier(gc.key); }
  if (typeof box.diskFps === 'function') box.diskFps(SWITCH.fps > 0 ? SWITCH.fps : MOBILE || coarse ? FPS_STILL_PHONE : FPS_STILL);
  if (typeof box.diskEddyEvery === 'function') box.diskEddyEvery(guarded ? 2 : 1);
  // (round 10a: on a guarded device the GPU rests between frames that only move the clock and between a still's bands: half
  // the time at most busy, DUTY_GUARDED; see the engine's diskDuty)
  if (typeof box.diskDuty === 'function') box.diskDuty(SWITCH.duty === 'off' ? 0 : Number(SWITCH.duty) > 0 ? Number(SWITCH.duty) : guarded ? DUTY_GUARDED : 0);
  if (SWITCH.ctmax > 0 && typeof box.diskCtMax === 'function') box.diskCtMax(SWITCH.ctmax);
}
// the engine's own changes (keys, a drag, the easter eggs, a restored context) reach the controls
box.addEventListener('diskstate', () => sync());
box.addEventListener('diskmode', () => sync());
box.addEventListener('diskframe', (e) => {
  if (mode !== 'live') return;
  setClockRate(e.detail.clock);
  // (the intervals between frames of one still picture, at one scale, are what a frame of it costs; a complete picture
  // may be sharpened)
  // (round 9: held, the time the frame waited for the frame rate's cap, is not its cost)
  const { acc = 0, accMax = 0, bands = 1, held = 0 } = e.detail, now = performance.now() - held;
  // (round 7: an interval after a complete still picture, or after the page was hidden, is a rest, not a frame's cost:
  // counted, the first frame after the clock started again took the scale to its floor)
  if (lastIdle) lastFrame = 0;
  lastIdle = !!S().paused && accMax > 0 && acc >= accMax;
  applyFixed();
  if (skipFrames > 0) { skipFrames--; costs.length = 0; }
  else guardFixed(lastFrame ? now - lastFrame : 0, acc, accMax, bands);
  // (what a frame costs now: consecutive frames, the clock running or a picture being averaged)
  if (bands === 1 && lastFrame && now - lastFrame < 3000 && (!S().paused || acc >= 2)) frameMs = frameMs ? 0.7 * frameMs + 0.3 * (now - lastFrame) : now - lastFrame;
  if (acc >= 2 && lastFrame) { recent.push(now - lastFrame); if (recent.length > 12) recent.shift(); }
  lastFrame = performance.now();
  if (accMax && acc >= accMax && lab.dataset.state === 'live') onAccumulated();
  healthTick(e.detail);   // (round 10a: the picture's health, for the flight record)
  flog.frT = Date.now() - flog.t0;   // (round 10a: the last frame finished: a picture still drawn but no input reaching the page, WebKit bug 306598, against nothing drawn)
  watchMoving(e.detail);
  renderMatKey(S());   // (the key's rows follow the distance: the envelope, the magnetosphere)
});

// ---------- a lighter picture while the view moves ----------
// While the view moves (a drag, the wheel, a pinch, a flight, the keys), the volume is drawn at a lower render scale, so
// that the picture answers at once; MOVE_REST after it stops, the scale it had comes back (and a paused picture is then
// sharpened as before, onAccumulated). Auto: MOVE_K of the running scale (0.42 of the pixels), not below the look's
// floor. A fixed level: High and Best move at Medium (MOVE_FIXED), Low and Medium as they are (the level is what a still
// picture is drawn at; moving, the frame rate comes first). A drag or the wheel lowers the scale before the engine draws
// the moved view; a flight, a drag or a touch is in the engine's frames (detail.moving), and a key's step in its state
// from frame to frame (the azimuth less the slow turn of the clock). data-move="off" on the disk turns it off, to compare.
const MOVE_K = 0.65, MOVE_REST = 200, MOVE_FIXED = 0.55;
// (round 9) the frame rate's cap while the clock runs and nothing else moves (item 3 of round 9, DESIGN.md section 22)
const FPS_STILL = 30, FPS_STILL_PHONE = 20, DUTY_GUARDED = 0.5;
let moveFrom = 0, moveTimer = 0, lastView = null;
function moving() {
  if (holdSharp || box.dataset.move === 'off' || !live() || 'lost' in lab.dataset) return;
  if (!moveFrom) {
    unsharpen();
    moveFrom = box.diskScale();
    const floor = S().look === 'co' ? CO_FLOOR : MIN_SCALE;
    const to = quality === 'auto' ? Math.max(floor, Math.min(moveFrom, MOVE_K * runScale)) : Math.min(moveFrom, MOVE_FIXED);
    if (gov) gov.pause(true);
    gc.still = 0;   // (round 9: a still picture after the move is chosen anew)
    if (Math.min(to, capRun()) < moveFrom - 0.005) scaleTo(Math.round(to * 1000) / 1000);
  }
  clearTimeout(moveTimer);
  // (at least one frame and a half: where a frame is slow, a flight's frames keep it moving)
  moveTimer = setTimeout(endMoving, Math.max(MOVE_REST, 1.5 * frameMs));
}
function viewNow(time) {
  const s = S(), az = s.p || reduce ? s.az : s.az - SPIN_DEG * time;
  return [s.el, Math.log(s.d), s.tx / s.d, s.ty / s.d, s.tz / s.d, az, s.p];
}
function watchMoving({ time, moving: flying }) {
  if (!live()) { lastView = null; return; }
  if (flying) moving();
  const v = viewNow(time), was = lastView;
  lastView = v;
  if (!was) return;
  // (the state is rounded to 0.01 degree and 0.001 au: these are well above its steps)
  const daz = Math.abs(((v[5] - was[5]) % 360 + 540) % 360 - 180);
  if (Math.abs(v[0] - was[0]) > 0.02 || daz > 0.02 || Math.abs(v[1] - was[1]) > 1e-4 || v[6] !== was[6] ||
    Math.abs(v[2] - was[2]) + Math.abs(v[3] - was[3]) + Math.abs(v[4] - was[4]) > 1e-4) moving();
}
stage.addEventListener('pointermove', (e) => { if (e.buttons && e.target === box.querySelector(':scope > canvas')) moving(); }, { capture: true, passive: true });
stage.addEventListener('wheel', moving, { capture: true, passive: true });
function endMoving() {
  if (!moveFrom) return;
  moveFrom = 0; skipFrames = 3;
  if (quality !== 'auto') relaxGuard();
  if (live()) scaleTo(quality === 'auto' ? runScale : fixedScale());
  govRest();
}
// A lost context usually comes back by itself within a second or two. If it has not after RETRY_AFTER, the stage offers
// to draw again: the page is loaded anew with the view and settings in its address (linkFor), and retry=1 tells the
// start that a failing probe means the browser has stopped WebGL (after repeated losses Chrome blocks it until restart).
const RETRY_AFTER = 2500;
let retryTimer = 0;
const stageRetry = $('stageRetry');
// (round 9: the reload carries nothing but the language: it starts with safe settings, as after any visit that ended with
// drawing stopped; it carried the view and settings before, the look that had stopped the GPU among them)
function retryLive() {
  const u = new URL(location.pathname, location.href);
  u.searchParams.set('lang', L()); u.searchParams.set('retry', '1');
  location.replace(u.href);
}
$('retryLive').addEventListener('click', retryLive);
// (round 9) What helps, said plainly: where a reload can bring WebGL back (Chrome, Firefox and the others: a new context),
// the button and, below it, what to do if it does not; in WebKit (Safari, and every browser on iOS and iPadOS), where a
// page that lost its context gets no new one until the browser is quit (the owner's iPhone and Mac), the way to quit and
// reopen it, and no button. Clearing caches does not help anywhere.
function retryWords() {
  const w = T().still;
  return RESTART === 'other' ? w.retryText + ' ' + w.retryHint : w.stuck(w.restart[RESTART](APP));
}
function showRetry(on) {
  clearTimeout(retryTimer);
  if (on) { stageRetry.firstElementChild.textContent = retryWords(); $('retryLive').textContent = T().still.retry; $('retryLive').hidden = RESTART !== 'other'; record('stuck'); }
  stageRetry.hidden = !on;
}
box.addEventListener('disklost', (e) => {
  // (round 10a: in the flight record, with the browser's message, what was in flight, and whether the page was hidden: WebKit
  // takes back the context of a page in the background, which is not a fault)
  const dl = e.detail || {};
  if (dl.lost) flogAdd({ k: 'lost', key: dl.key, sc: dl.sc, msg: dl.msg || undefined, fl: dl.inFlight && dl.inFlight.length ? dl.inFlight : undefined, warming: dl.warming || undefined, hidden: document.hidden ? 1 : undefined }, true);
  else flogAdd({ k: 'back' }, true);
  if (e.detail.lost) {
    record('lost');
    lab.dataset.lost = ''; posterKey = ''; setPoster(PLACES[placeI].id); note(T().still.lost, 0);
    clearTimeout(retryTimer); retryTimer = setTimeout(() => { if ('lost' in lab.dataset) { note('', 0); showRetry(true); } }, RETRY_AFTER);
  }
  else {
    // (the engine is built anew from its data attributes and the state it had. Round 9: what may have stopped the GPU is
    // not drawn again: an observed look or the cut goes back to the model's whole look, the cap to a low step, and the
    // guard measures afresh)
    delete lab.dataset.lost; note('', 0); showRetry(false);
    sharpFrom = 0; recent.length = 0; govRest();
    const s0 = S(), safe = s0.look !== 'model' || s0.slice;
    Object.assign(gc, { key: keyOf(s0), measured: false, vals: [], scales: [], still: 0 });
    if (gc.key !== 'model') guardSwitch('model');
    gc.cap = Math.min(gc.cap, LADDER[4]);
    if (safe) box.diskSet({ look: 'model', slice: 0 });
    box.diskScale(Math.min(runScale || gc.cap, gc.cap)); bandsSet = 0; guardApply();
    engineSettings();   // (round 10a: the engine built anew has its defaults, see engineSettings)
    record('live');
    if (safe) note(T().restoredSafe, 6000);
    sync();
  }
});

// ---------- the settings kept on this device, and Reset (round 9) ----------
// The owner: "it would be good if the settings were kept when the page is reloaded or left and come back to; then make the
// reset button a little clearer". What the visitor set (the look, its map and velocity, what is shown and its options,
// the background, the cut and its quantity, the speed, the planets, a quality chosen) and the view (the place, the angle,
// the distance, the point looked at, following a planet) are written to localStorage a moment after each change and when
// the page is left, and taken back at the next start, unless the address carries a link (?place=, or a view as "Copy a
// link" writes it), which wins. Not kept: the clock's time and pause, the tap modes, the saved picture's size. After a
// visit that ended with drawing stopped they are thrown away (see record). "Reset" (the top of the rail) forgets them and
// puts everything back as at the first visit: the engine's own start (DEF0), the first place, the device's quality.
const DEF_KEYS = ['mode', 'field', 'marks', 'asym', 'waves', 'ann', 'bg', 'look', 'coMode', 'coV', 'slice', 'sq', 'speed', 'planets', 'ms'];
const VIEW_KEYS = ['el', 'az', 'd', 'tx', 'ty', 'tz', 'p', 'pi'];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] != null).map((k) => [k, Array.isArray(o[k]) ? o[k].map((v) => (Array.isArray(v) ? v.slice() : v)) : o[k]]));
let DEF0 = null, defaults = null, keeping = false, keepTimer = 0;
function settingsNow() {
  const s = S();
  return { v: 1, place: PLACES[placeI].id, ...pick(s, DEF_KEYS), ...pick(s, VIEW_KEYS), quality: qChosen ? quality : null };
}
function keepNow() {
  clearTimeout(keepTimer); keepTimer = 0;
  if (!keeping || !live() || 'lost' in lab.dataset) return;
  try { localStorage.setItem(SET, JSON.stringify(settingsNow())); } catch { /* not kept: the next visit starts afresh */ }
}
function keepSoon() { if (keeping && !keepTimer) keepTimer = setTimeout(keepNow, 600); }
addEventListener('pagehide', keepNow);
// the kept settings as a state for diskSet (the place's id with them), checked as a link's are
function keptState() {
  if (!saved) return null;
  const st = pick(saved, [...DEF_KEYS, ...VIEW_KEYS]);
  if (st.mode != null) st.mode = linkMode(Number(st.mode));
  if (Array.isArray(st.planets)) st.planets = st.planets.filter((p) => Array.isArray(p)).map((p) => p.map(Number));
  st.place = placeById(saved.place) ? saved.place : null;
  return Object.keys(st).length > 1 ? st : null;
}
function resetAll() {
  if (!live() || !defaults) return;
  guardAfresh(true);   // (round 10a)
  try { localStorage.removeItem(SET); sessionStorage.removeItem(KEY('disk-lab-quality')); } catch { /* nothing kept */ }
  setPick(false); popClose(); unsharpen();
  qChosen = false;
  const d = { ...defaults };
  guardSwitch(keyOf({ ...S(), look: d.look, slice: d.slice }));
  box.diskSet({ ...pick(d, DEF_KEYS), paused: 0 });
  box.diskSpeed(d.speed || 1);
  applyQuality(d.quality);
  goPlace(0);
  keepNow();
  note(T().resetDone, 3500);
}

// ---------- the visit's record (round 9) ----------
// One small record in localStorage of how the visit is going: 'starting' until the live model draws, 'live', 'changing'
// while something much dearer is first drawn (until frames of it have been measured, see guardSwitch), 'lost' (the WebGL
// context lost, until it comes back), 'stuck' (not back: the stage says what helps), 'failed' or 'blocked' (the live model
// could not start), 'still' (the stills by design: no WebGL2, too slow), 'left' (the page left during a start or a change).
// A visit after one that ended starting, changing, lost, stuck, failed or blocked, or opened by "Try again", starts with
// safe settings: the model look, no cut, Auto, the whole disk, whatever its address says (the owner: "then the earlier
// settings must be thrown away"), and says so in one line.
// (round 10a) The owner: "an irreversible change is not good, even to protect the user"; "tell 'it computes but takes
// long or uses power' clearly apart from 'it cannot compute and stops'". The record now carries the kind of frame drawn
// (key), and the next visit judges the last one from it and from the flight record (judgePrev): only what is broken starts
// it safe, and then only without what was in view when it stopped, where the record says (the culprit: an observed look,
// the line's map, the cut), the settings kept and offered back in one tap (restoreKept). DESIGN.md, section 23.
function record(p) {
  phase = p;
  try { localStorage.setItem(REC, JSON.stringify({ phase: p, t: Date.now(), v: VERSION, key: gc.key || '' })); } catch { /* not kept: the next visit starts as usual */ }
  flogAdd({ k: 'ph', p, key: gc.key || '' }, true);
}
addEventListener('pagehide', () => { if (phase === 'starting' || phase === 'changing') record('left'); flog.end = 'hide'; flogAdd({ k: 'hide', w: 'pagehide' }, true); });
addEventListener('pageshow', (e) => { if (!e.persisted) return; flog.end = ''; flogClaim(); flogAdd({ k: 'show', w: 'back' }, true); if (phase === 'left' && mode === 'live') record('live'); });
document.addEventListener('visibilitychange', () => { if (document.hidden) flogAdd({ k: 'hide' }, true); else { flogClaim(); flogAdd({ k: 'show' }, true); } });

// How the last visit ended: { bad, why, culprit, report } from its phase (REC) and its flight record (LOG). Slow is allowed,
// broken is a bug. Broken (bad): the context lost and not given back while the page was in view ('lost', 'stuck'); the live
// model unable to start ('failed', 'blocked'); a piece of GPU work told as hung that never ended ('hung'); the page
// stopped while in view, its record ending without its being hidden or left (frozen, or its process ended): with a dear
// step begun and not ended, or in a start or a change of look ('stopped'), or else ('died', the cause unknown). Not broken:
// a page closed, reloaded or put in the background whatever it was doing (its record ends hidden); a context lost while
// hidden (WebKit takes a hidden page's back); a slow piece that ended (late). A visit before 1.8, with no flight record,
// is judged by its phase alone, as round 9 did. culprit: the kind of frame in view at the end (key) and the quality, where
// the record says. report: the record is worth offering (broken, or values not finite seen in the picture). "Try again"
// (retry=1) starts safe as before.
function judgePrev(r, log) {
  const OPEN_MS = 15000, retry = q.get('retry') === '1';
  if (!log) { const bad = retry || !!(r && BAD_END.includes(r.phase)); return { bad, why: retry ? 'retry' : bad ? r.phase : '', culprit: null, report: false }; }
  // (a record written within the last two heartbeats is of a page still running, in another tab or a frame: not judged)
  const e = log.e, last = e[e.length - 1], hidden = log.end === 'hide' || !!(last && last.k === 'hide') || Date.now() - (log.alive || 0) < 6500;
  // (a step begun and not ended counts only near the end: within OPEN_MS of the last sign of life)
  const near = (x) => (log.alive || 0) - (log.t0 + x.t) < OPEN_MS;
  const rev = e.slice().reverse(), open = rev.find((x) => x.open && near(x)), hung = rev.find((x) => x.k === 'hung' && x.ended == null), lostE = rev.find((x) => x.k === 'lost');
  const ph = r ? r.phase : '';
  const why = ph === 'failed' || ph === 'blocked' ? ph
    : (ph === 'lost' || ph === 'stuck') && !(lostE && lostE.hidden) ? 'lost'
    : hung && !hidden ? 'hung'
    : hidden ? (retry ? 'retry' : '')
    : open ? 'stopped' : ph === 'starting' || ph === 'changing' ? 'stopped' : ph === 'live' ? 'died' : retry ? 'retry' : '';
  const k = String((lostE && why === 'lost' && lostE.key) || (why === 'hung' && hung.key) || (why === 'stopped' && open && open.key) || (r && r.key) || log.key || '').replace(/:pre$/, '').replace(/:F$/, '');
  return { bad: !!why, why, culprit: why && k ? { key: k, q: log.q || '' } : null, report: !!why || !!log.broken, at: log.alive || 0 };
}

// ---------- the flight recorder (round 10a) ----------
// The owner's phone stopped in the visible look with nothing to say why. The page keeps, on this device only (localStorage,
// LOG; nothing is ever sent), a short record of what it and the engine are doing: the device (its browser, screen, the GPU's
// name where given, the extensions and limits that change what the engine does, the settings it started with), and a ring
// of the last LOG_N steps: the links of the shader programs, the warm, the pieces of GPU work that are dear (predicted over
// 40 % of the budget, a first use, or not predicted; the engine's recBand), each written down before it is sent and
// completed after; a piece not done after 2.5 s while the page runs (hung); the phases; the guard's decisions; a lost
// context with what was in flight; a GL error; values not finite in the picture (the engine's HEALTH_FS); errors of the
// script; the page hidden or shown. Where the page dies, the last step begun and not ended is what was running; the
// heartbeat (alive, every HEART_MS while the page is shown) says how long it ran after. Each kind of frame is summed up
// (sum: frames, the longest frame and band, the scales) without an entry each. The next visit judges the last from it
// (judgePrev) and offers it to copy (the safe start's note, the About dialog; with ?diag=1 this visit's too). A few KB,
// written at once before a dear step, otherwise within 2 s. No GL query is made for it in the frames.
const LOG_N = 40, HEART_MS = 1000, HEALTH_MS = 10000, HEALTH_OBS_MS = 2000, HB_N = 30;
const flog = { v: VERSION, eng: ENGINE_SRC.split('v=')[1], t0: Date.now(), alive: Date.now(), end: '', key: '', q: '', sc: 0, dev: null, sum: {}, health: null, broken: '', e: [] };
let flogTimer = 0, baseE = null;
// (one record for the device: the visit that holds it (LOG_OWNER, its t0) writes it, and a visit takes it when it starts and
// whenever it is shown again, so that of two pages open at once the one in view keeps it, and a page that stops in view
// has its own record there. A page in a frame (the checks') takes it from the page under it)
const LOG_OWNER = KEY('disk-lab-log-owner');
const flogClaim = () => { try { localStorage.setItem(LOG_OWNER, String(flog.t0)); } catch { /* none kept */ } };
const flogMine = () => { try { return localStorage.getItem(LOG_OWNER) === String(flog.t0); } catch { return false; } };
function flogSave() {
  clearTimeout(flogTimer); flogTimer = 0;
  flog.alive = Date.now(); flog.key = gc.key; flog.q = quality; flog.sc = live() ? box.diskScale() : 0;
  // (round 10a: the clock, running or not, and its time; the GL objects alive by kind and the MB allocated so far)
  if (live()) { const s0 = S(); flog.clock = { run: s0.paused ? 0 : 1, t: Math.round(s0.time * 10) / 10, sp: s0.speed, mode: s0.mode }; }
  flog.gl = { live: glc.live, made: glc.made, mb: Math.round(glc.mb * 10) / 10 };
  if (!flogMine()) return;
  try { localStorage.setItem(LOG, JSON.stringify(flog)); } catch { /* not kept (full, or refused): the page goes on */ }
}
const flogSoon = () => { if (!flogTimer) flogTimer = setTimeout(flogSave, 2000); };
function flogAdd(o, now = false) {
  o.t = Date.now() - flog.t0; flog.e.push(o);
  if (flog.e.length > LOG_N) flog.e.shift();
  if (now) flogSave(); else flogSoon();
  return o;
}
const flogFind = (id) => { for (let i = flog.e.length - 1; i >= 0; i--) if (flog.e[i].id === id || flog.e[i].rid === id) return flog.e[i]; return null; };
const r1 = (v) => Math.round(v * 10) / 10;
// (the last visit's record, kept apart when it ended badly or saw values not finite, for its report; then this visit's
// record begins)
if (prevLog && verdict.report) { try { localStorage.setItem(LOG_BAD, JSON.stringify({ ...prevLog, verdict })); } catch { /* not kept */ } }
const badLog = readJSON(LOG_BAD);
// (round 10a) the last three visits' records, the newest first, each with its judgement: a visit that stopped is not lost
// to the visits after it that found WebGL stopped (on the owner's iPhone, until Safari was quit)
const LOG_HIST = KEY('disk-lab-log-hist');
const histLogs = (() => {
  const h = readJSON(LOG_HIST), list = Array.isArray(h) ? h.filter((l) => l && Array.isArray(l.e)) : [];
  if (prevLog && !list.some((l) => l.t0 === prevLog.t0)) { list.unshift({ ...prevLog, verdict }); list.length = Math.min(list.length, 3); try { localStorage.setItem(LOG_HIST, JSON.stringify(list)); } catch { /* not kept */ } }
  return list;
})();
flogClaim(); flogSave();
setInterval(() => { if (!document.hidden) flogSave(); }, HEART_MS);
// (a hung piece ended after all: slow, not broken)
const hungEnded = (ms, id) => { for (let i = flog.e.length - 1; i >= 0; i--) { const x = flog.e[i]; if (x.k === 'hung' && x.ended == null && (!id || !x.id || x.id === id)) { x.ended = r1(ms); return; } } };
// the engine's steps (see its rec)
const BASE_PROGS = new Set(['FS', 'disk', 'wind', 'env', 'turb3', 'shade3', 'wstr', 'show', 'bloom', 'ae', 'health']);
box.addEventListener('diskrec', (ev) => {
  const d = ev.detail || {};
  if (d.k === 'link' && BASE_PROGS.has(d.w)) {
    // (the programs made as the engine starts, in one entry: the one being made, their count and time)
    if (!baseE || baseE.done) baseE = flogAdd({ k: 'link', w: 'base', n: 0, ms: 0 });
    if (d.ph === 0) { baseE.at = d.w; baseE.open = 1; flogSave(); return; }
    baseE.n++; baseE.ms = r1(baseE.ms + d.ms); delete baseE.open;
    if (!d.ok) { baseE.ok = 0; baseE.log = d.log; flogSave(); } else flogSoon();
    if (d.w === 'health') { baseE.done = 1; delete baseE.at; }
  } else if (d.k === 'link' || d.k === 'warm') {
    if (d.ph === 0) { flogAdd({ k: d.k, id: d.id, w: d.w, key: d.key, pc: d.pc, open: 1 }, true); return; }
    const x = flogFind(d.id) || flogAdd({ k: d.k, id: d.id, w: d.w });
    x.ms = r1(d.ms); delete x.open;
    if (d.ok === 0) { x.ok = 0; x.log = d.log; flog.broken = flog.broken || 'link'; }
    if (d.late) { x.late = 1; hungEnded(d.ms, d.id); }
    flogSave();
  } else if (d.k === 'piece') {
    if (d.ph === 0) {
      // (a frame's dear bands in one entry: bands sent b, done dn, the longest ms, the dearest prediction; and frames of one
      // kind at one scale that follow each other, x of them, in one entry too)
      let x = null;
      for (let i = flog.e.length - 1; i >= Math.max(0, flog.e.length - 4); i--) {
        const y = flog.e[i];
        if (y.k === 'piece' && ((d.job && y.job === d.job) || (!y.open && y.key === d.key && y.sc === d.sc && y.n === d.n && !d.first && !y.first))) { x = y; break; }
      }
      if (x && x.job !== d.job) { x.x = (x.x || 1) + 1; x.job = d.job; x.t = Date.now() - flog.t0; }
      if (!x) x = flogAdd({ k: 'piece', job: d.job, key: d.key, sc: d.sc, n: d.n, s: d.s || undefined, first: d.first || undefined, b: 0, dn: 0, ms: 0, pred: 0 });
      x.rid = d.id; x.b++; x.pred = Math.max(x.pred, d.pred || 0); x.open = 1;
      if (d.rows) x.rows = d.rows;   // (the band in flight: rows y0 to y1 of the volume's rH, its full width rW)
      flogSave();
    } else {
      const x = flogFind(d.id); if (!x) return;
      x.dn++; x.ms = Math.max(x.ms, r1(d.ms)); if (x.dn >= x.b) delete x.open;
      if (d.late) { x.late = 1; hungEnded(d.ms, d.id); }
      flogSoon();
    }
  } else if (d.k === 'hung') {
    const x = d.id ? flogFind(d.id) : null; if (x) x.hung = r1(d.ms);
    flogAdd({ k: 'hung', id: d.id || undefined, key: d.key || (x && x.key) || d.w || '', ms: r1(d.ms), sc: d.sc, n: d.n, first: d.first || undefined, pre: d.pre || undefined, s: d.s || undefined }, true);
  } else if (d.k === 'late') { hungEnded(d.ms, d.id); flogAdd({ k: 'late', key: d.key || '', ms: r1(d.ms), s: d.s || undefined }); }
  else if (d.k === 'oom' || d.k === 'glerr') { if (d.k === 'oom') flog.broken = flog.broken || 'oom'; flogAdd({ k: d.k, w: d.w, e: d.e }, true); }
  else if (d.k === 'first') flogAdd({ k: 'first', w: d.w, key: d.key }, true);   // (a pipeline the GPU's process makes now)
  else if (d.k === 'sync') {
    // (a call that waited for the GPU's process over 5 ms, see the engine's slowSync: one entry for a run of the same call,
    // with their count and the longest)
    let x = null;
    for (let i = flog.e.length - 1; i >= Math.max(0, flog.e.length - 3); i--) if (flog.e[i].k === 'sync' && flog.e[i].w === d.w) { x = flog.e[i]; break; }
    if (x) { x.n = (x.n || 1) + 1; x.ms = Math.max(x.ms, r1(d.ms)); flogSoon(); } else flogAdd({ k: 'sync', w: d.w, ms: r1(d.ms), key: gc.key }, d.ms > 500);
  }
});
// (round 10a) A heartbeat a second (hb, the last HB_N): frames finished, pieces, the GPU's busy time (their sum, ms), the
// longest piece, the scale, the kind, the clock running, the model's time, the components: the seconds before a loss
const hbCur = { f: 0, p: 0, busy: 0, max: 0 };
flog.hb = [];
setInterval(() => {
  if (document.hidden) return;
  const s0 = live() ? S() : null;
  flog.hb.push([Math.round((Date.now() - flog.t0) / 1000), hbCur.f, hbCur.p, Math.round(hbCur.busy), Math.round(hbCur.max), live() ? Math.round(box.diskScale() * 1000) / 1000 : 0, gc.key, s0 ? (s0.paused ? 0 : 1) : -1, s0 ? Math.round(s0.time) : 0, s0 ? s0.mode : 0]);
  if (flog.hb.length > HB_N) flog.hb.shift();
  hbCur.f = hbCur.p = hbCur.busy = hbCur.max = 0;
}, 1000);
// every frame summed up by its kind, no entry each (saved with the heartbeat)
box.addEventListener('diskgpu', (ev) => {
  const d = ev.detail || {}; if (!(d.ms > 0)) return;
  hbCur.f++; hbCur.p += d.bands || 1; hbCur.busy += d.ms; hbCur.max = Math.max(hbCur.max, d.band || d.ms);
  const k = String(d.key || '').replace(/:F$/, ''), s = flog.sum[k] || (flog.sum[k] = { n: 0, ms: 0, band: 0, sc: 0, top: 0, pre: 0, first: 0 });
  s.n++; s.ms = Math.max(s.ms, Math.round(d.ms)); s.band = Math.max(s.band, Math.round(d.band)); s.sc = d.scale; s.top = Math.max(s.top, d.scale); s.pre = Math.max(s.pre, Math.round(d.pre || 0)); if (d.first) s.first++;
});
// the picture's health (the engine's HEALTH_FS): values not finite are a bug, said in the record and offered in the next visit
let healthT = 0, healthKey = '';
box.addEventListener('diskhealth', (ev) => {
  const d = ev.detail || {};
  flog.health = { key: d.key, sc: d.scale, acc: d.acc, bad: d.bad, neg: d.neg, worst: d.worst, max: d.max, cells: d.cells, t: Date.now() - flog.t0 };
  // (where: the cells of a 32 x 18 grid over the picture, column and row from the top left, with values not finite; chans:
  // which channels, 1 red, 2 green, 4 blue: green alone shows magenta)
  if (d.bad || d.neg) { flog.broken = flog.broken || 'nonfinite'; flogAdd({ k: 'nf', key: d.key, sc: d.scale, acc: d.acc, size: d.size, bad: d.bad, neg: d.neg, worst: d.worst, max: d.max, chans: d.chans, where: d.where }, true); }
});
// (asked for: a still when complete, a new kind of frame once measured, every frame drawn in bands, and every HEALTH_MS while
// the clock runs, HEALTH_OBS_MS in the observed looks: values not finite seen before a loss are then in the record)
function healthTick(d) {
  if (!live() || typeof box.diskHealth !== 'function' || 'lost' in lab.dataset) return;
  const now = performance.now(), still = d.accMax > 0 && d.acc >= d.accMax, key = gc.key + (still ? ':still@' + box.diskScale() : '');
  if ((still && key !== healthKey) || (gc.measured && !healthKey.startsWith(gc.key)) || d.bands > 1 || now - healthT > (gc.key === 'model' ? HEALTH_MS : HEALTH_OBS_MS)) { healthKey = key; healthT = now; box.diskHealth(); }
}
addEventListener('error', (e) => flogAdd({ k: 'err', m: String(e.message || e.error || '').slice(0, 160) }, true));
addEventListener('unhandledrejection', (e) => flogAdd({ k: 'err', m: 'rejection: ' + String((e.reason && e.reason.message) || e.reason).slice(0, 150) }, true));
// the device, once, when the engine has started (what the record's report begins with)
function flogDevice(kept) {
  const c = box.querySelector(':scope > canvas'), caps = typeof box.diskCaps === 'function' ? box.diskCaps() : null;
  flog.dev = { ua: navigator.userAgent, dpr: devicePixelRatio, screen: [screen.width, screen.height], stage: [stage.clientWidth, stage.clientHeight], canvas: c ? [c.width, c.height] : null,
    probe: diag.probe, caps, emu: CAPS || undefined, math: box.dataset.math || undefined, gpux: GPUX > 1 ? GPUX : undefined,
    sw: Object.fromEntries(Object.entries(SWITCH).filter(([, v]) => v)), duty: typeof box.diskDuty === 'function' ? box.diskDuty() : undefined,
    still: mode === 'still' ? stillReason : undefined, fail: box.dataset.fallbackError || diag.failError || undefined, guarded, budget: GUARD_MS, march: diag.guard && diag.guard.march, quality, chosen: qChosen,
    prev: { phase: prevRec && prevRec.phase, why: verdict.why, culprit: verdict.culprit }, kept };
  flogSave();
}
// The safe start's note (round 10a): what happened, as far as the record says, and two offers: the settings kept on this
// device back in one tap (restoreKept, through the guard as at any start), and the last visit's record to read and copy.
// It stays until closed or used (30 s at most); the record stays offered in the About dialog.
const stageSafe = $('stageSafe'), stageLog = $('stageLog');
let safeTimer = 0;
const lookName = (key) => { const [look, m] = key.split(':'), w = T(); return look === 'model' ? w.cutName : look === 'co' && w.coModes[m] ? `${w.looks.co.label}(${w.coModes[m]})` : (w.looks[look] || {}).label || look; };
function showSafe() {
  const w = T(), kids = [el('p', {}, avoid ? w.safeStartKnown(lookName(avoid.key)) : w.safeStart)];
  const acts = [];
  if (saved || keptQuality) acts.push(el('button', { type: 'button', class: 'chip', onclick: restoreKept }, w.safeRestore));
  if (badLog || prevLog) acts.push(el('button', { type: 'button', class: 'chip quiet', onclick: () => showLog() }, w.log.show));
  acts.push(el('button', { type: 'button', class: 'icon-x', 'aria-label': w.log.close, title: w.log.close, onclick: () => hideSafe() }, '×'));
  kids.push(el('div', { class: 'safe-acts' }, ...acts));
  stageSafe.replaceChildren(...kids); stageSafe.hidden = false;
  clearTimeout(safeTimer); safeTimer = setTimeout(hideSafe, 30000);
  showLogLink();
}
function hideSafe() { clearTimeout(safeTimer); stageSafe.hidden = true; }
// the settings kept before the safe start, back: the place, the look, the view, what is shown, the quality chosen
function restoreKept() {
  hideSafe();
  if (!live()) return;
  const st = keptState();
  if (st) {
    const s0 = S();
    guardSwitch(keyOf({ ...s0, ...st, slice: st.slice != null ? Number(st.slice) : s0.slice }));
    box.diskSet({ ...st, fly: reduce ? 0 : 1 });
    if (st.place) { const i = PLACES.findIndex((p) => p.id === st.place); if (i >= 0) { placeI = i; target = { ...S(), time: S().time }; renderPlace(); } }
  }
  if (keptQuality) { qChosen = true; applyQuality(keptQuality); }
  else { qChosen = false; applyQuality(guarded ? 'auto' : 'full'); }   // (none chosen: the device's own)
  keeping = true; keepNow();
  flogAdd({ k: 'set', w: 'restored', look: st && st.look, q: keptQuality || undefined }, true);
  sync(); note(T().restoredKept, 3000);
}
// the record offered in the About dialog: the last bad end's, if any (and with ?diag=1 always, with this visit's)
function showLogLink() {
  const b = $('logOpen');
  if (!b || !(badLog || histLogs.some((l) => l.verdict && l.verdict.bad) || q.get('diag') === '1')) return;
  b.textContent = T().log.show; b.hidden = false; b.onclick = () => { about.close(); showLog(); };
}
function showLog() {
  // (round 10a: the last three visits, the newest first; and the last that ended badly if it is older; ?diag=1 this visit too)
  const w = T().log, mine = q.get('diag') === '1', list = histLogs.slice();
  if (badLog && !list.some((l) => l.t0 === badLog.t0)) list.push(badLog);
  const text = [...(list.length ? list.map((l, i) => (i ? '\n--- ' + (i + 1) + ' ---\n' : '') + logText(l)) : [w.none]), ...(mine ? ['', '--- ' + w.mine + ' ---', logText(flog)] : [])].join('\n');
  const pre = el('pre', {}, text);
  const copy = el('button', { type: 'button', class: 'chip', onclick: async () => {
    try { await navigator.clipboard.writeText(text); copy.textContent = w.copied; }
    catch { const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  } }, w.copy);
  stageLog.replaceChildren(el('p', { class: 'log-title' }, w.title), el('p', { class: 'log-note' }, w.note), pre,
    el('div', { class: 'safe-acts' }, copy, el('button', { type: 'button', class: 'chip quiet', onclick: () => { stageLog.hidden = true; } }, w.close)));
  stageLog.hidden = false;
}
// the record as text, to read and paste (in English: it is for the author)
function logText(l) {
  if (!l || !Array.isArray(l.e)) return '';
  const d = l.dev || {}, c = d.caps || {}, f = (o) => Object.entries(o).filter(([, v]) => v != null && v !== '').map(([k, v]) => k + ' ' + (typeof v === 'object' ? JSON.stringify(v) : v)).join(', ');
  const when = new Date(l.t0), out = [];
  out.push(`Disk Lab ${l.v} · engine ${l.eng} · ${when.toISOString().replace('T', ' ').slice(0, 19)} UTC · ran ${r1((l.alive - l.t0) / 1000)} s · ended ${l.end === 'hide' ? 'left or hidden' : 'in view (stopped?)'}${l.verdict ? ' · judged: ' + (l.verdict.why || 'fine') : ''}${l.broken ? ' · broken: ' + l.broken : ''}`);
  if (d.ua) out.push(d.ua);
  out.push(`dpr ${d.dpr} · screen ${(d.screen || []).join('x')} · stage ${(d.stage || []).join('x')} · canvas ${(d.canvas || []).join('x')} · ${c.renderer || (d.probe && d.probe.renderer) || '?'} · ${c.version || ''}`);
  if (d.caps) out.push(`timer ${c.timer} pcomp ${c.pcomp} fLinear ${c.fLinear} cbFloat ${c.cbFloat} cbHalf ${c.cbHalf} fBlend ${c.fBlend} · maxTex ${c.maxTex} max3D ${c.max3D} maxRB ${c.maxRB} maxDB ${c.maxDB} view ${(c.maxView || []).join('x')} · exts ${c.nExt}`);
  out.push(`start: ${f({ guarded: d.guarded, budget: d.budget, march: d.march, quality: d.quality, chosen: d.chosen, emu: d.emu, math: d.math, gpux: d.gpux })} · prev ${JSON.stringify(d.prev || {})} · kept ${JSON.stringify(d.kept || null)}`);
  out.push('frames: ' + (Object.entries(l.sum || {}).map(([k, s]) => `${k} ${s.n} (max ${s.ms} ms, band ${s.band}, pre ${s.pre}, scale ${s.sc}/${s.top}${s.first ? ', first ' + s.first : ''})`).join('; ') || 'none'));
  if (l.health) out.push('health: ' + f(l.health));
  if (l.clock) out.push('clock: ' + f(l.clock) + (d.sw && Object.keys(d.sw).length ? ' · switches ' + JSON.stringify(d.sw) : '') + (d.duty != null ? ' · duty ' + d.duty : '') + (d.still ? ' · still ' + d.still : '') + (d.fail ? ' · fail ' + d.fail : ''));
  else if (d.still || d.fail) out.push('still: ' + (d.still || '') + (d.fail ? ' · fail ' + d.fail : '') + (d.probe ? ' · probe ' + JSON.stringify(d.probe) : ''));
  if (l.gl) out.push('gl: live ' + JSON.stringify(l.gl.live) + ' · made ' + JSON.stringify(l.gl.made) + ' · MB ' + l.gl.mb);
  if (l.hb && l.hb.length) out.push('per second [s, frames, pieces, busy ms, longest ms, scale, kind, clock, time, mode]: ' + l.hb.map((h) => '[' + h.join(',') + ']').join(' '));
  out.push(`at the end: key ${l.key} · quality ${l.q} · scale ${l.sc} · last frame +${r1((l.frT || 0) / 1000)} s · last input +${r1((l.inT || 0) / 1000)} s · last sign of life +${r1((l.alive - l.t0) / 1000)} s`);
  for (const x of l.e) { const { t, k, ...rest } = x; out.push(`+${(t / 1000).toFixed(1)} s ${k} ${f(rest)}`); }
  return out.join('\n');
}

// ---------- resting when left alone ----------
// A running clock keeps the GPU drawing every frame. Left alone for IDLE_MS (IDLE_BLUR_MS while the window is not the
// focused one), the clock is paused: the picture is then finished at full resolution (onAccumulated) and the engine draws
// nothing more, so the GPU rests. The next input (a move, a press, a key, the wheel, a touch, the window coming back to
// the front) starts the clock again, if it was this rest that stopped it; a pause chosen by the visitor stays. A press on
// the play button itself is left to the button. data-idle="off" on the disk turns it off (the checks run without input).
// (round 9: a phone or tablet rests sooner, IDLE_MS_PHONE)
const IDLE_MS = 60000, IDLE_MS_PHONE = 30000, IDLE_BLUR_MS = 15000;
let idleTimer = 0, restedByIdle = false;
function armIdle() {
  clearTimeout(idleTimer);
  if (!live() || reduce || box.dataset.idle === 'off') return;
  idleTimer = setTimeout(restIdle, document.hasFocus() ? (MOBILE || coarse ? IDLE_MS_PHONE : IDLE_MS) : IDLE_BLUR_MS);
}
function restIdle() {
  if (!live() || reduce || box.dataset.idle === 'off' || 'lost' in lab.dataset) return;
  if (saving || moveFrom) return armIdle();
  if (S().paused) return;
  restedByIdle = true; box.diskPlay(false); sync(); note(T().idleRest, 0);
}
function wake(e) {
  flog.inT = Date.now() - flog.t0;   // (round 10a: the last input, for the flight record)
  if (restedByIdle) {
    restedByIdle = false; note('', 0);
    const onPlay = e && e.target && e.target.closest && e.target.closest('#play');
    if (!onPlay && live() && S().paused) { box.diskPlay(true); sync(); }
  }
  armIdle();
}
for (const t of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) window.addEventListener(t, wake, { capture: true, passive: true });
window.addEventListener('focus', wake);
window.addEventListener('blur', () => armIdle());
document.addEventListener('visibilitychange', () => { if (!document.hidden) armIdle(); });

window.diskLab = {
  diag, PLACES, WORDS,
  state: () => ({ mode, stillReason, place: PLACES[placeI].id, away: away(), sharpened: !!sharpFrom, governor: gov ? gov.state() : null }),
  goPlace: (id, opts) => goPlace(typeof id === 'number' ? id : PLACES.findIndex((p) => p.id === id), opts),
  // (for measurements: frames drawn by diskBench would otherwise reach the governor)
  // (for measurements: also holds the sharpening of a still picture and the CO line's own scale; the scale is the caller's)
  pauseGovernor: (on) => { holdSharp = !!on; if (on) unsharpen(); govRest(); },
  setQuality: (k) => setQuality(k),
  // (for measurements: record the default Best's quiet steps from now, or stop and return them)
  bestLog: (on) => { const l = bestLog; bestLog = on ? [] : null; return l; },
  // (round 9: the guard's state, see guardApply: the budget, what is drawn, a frame of it at scale 1, the cap, the still's
  // scale and bands, and its log of steps)
  guard: () => ({ guarded, budget: GUARD_MS, march: box.diskMarch ? box.diskMarch() : null, modelPerMpx: Math.round(modelPerMpx), key: gc.key, c1: Math.round(gc.c1), measured: gc.measured, cap: gc.cap, still: gc.still, bands: bandsSet, phase, crashed, log: gc.log.slice() }),
  quality: () => ({ quality, chosen: qChosen, qCap, bestCap, hold: bestHold, scale: live() ? box.diskScale() : 0, paused: live() ? !!S().paused : null, moving: !!moveFrom, sharpened: !!sharpFrom, held: holdSharp, saving }),
  // (for checks: back to the default, Best not chosen)
  defaultQuality: () => { qChosen = false; try { sessionStorage.removeItem(KEY('disk-lab-quality')); } catch { /* */ } applyQuality('full'); },
  // (for checks: a picture with the mark, as saved)
  stamped: async () => { const c = await shot({}); if (c) await watermark(c); return c; },
  setLook, setLang, setTab: (t) => setTab(t), link: () => (live() ? linkFor(S()) : null), snapshot: (opts) => shot(opts),
  resetAll: () => resetAll(),   // (round 9: "Reset all", for checks)
  // (round 10a: the keys this build keeps on the device, the flight record now and the last visit's, its judgement, the
  // version line; for checks, here or through a WebDriver session)
  keys: { settings: SET, session: REC, log: LOG, logBad: LOG_BAD, logOwner: LOG_OWNER, quality: KEY('disk-lab-quality'), lang: KEY('site-language') },
  flightLog: () => JSON.parse(JSON.stringify(flog)), flightText: () => logText(flog), lastLog: () => badLog || prevLog, verdict: () => ({ ...verdict, avoid }),
  versionLine: VERSION_LINE, version: VERSION, showLog: () => showLog(), restoreKept: () => restoreKept()
};
// (round 10a: the same line as index.html writes without the script; check.js compares them)
document.querySelectorAll('[data-version]').forEach((e) => { e.textContent = VERSION_LINE; });
start();
