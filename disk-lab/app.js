// Disk Lab v2: the page around the GPU engine (engine/disk3d.js, v2's own engine: see engine/CHANGES.md).
// The page decides whether the live model can run (quality.js), loads the engine, lays out the sandbox (the rail: look,
// what is shown, cut, variants, time, view) and the highlights (places.js), and keeps its controls in step with the
// engine through the engine's public API and events.
// See DESIGN.md for the reasons behind each choice.
import { PLACES, placeById, placeState, fitDistance } from './places.js?v=20261107r18e';
import { WORDS } from './words.js?v=20261111r19a';
import { probe, calibrate, govern, scaleFor, MIN_SCALE } from './quality.js?v=20261107r18e';
import { snapshot, toPng, framed, cropFor } from './capture.js?v=20261107r18e';
import { SEQ_V, SEQ_MAX, PACES, keyFrom, checkSeq, seqToHash, seqFromHash, stashFor } from './seq.js?v=20261107r18e';
import { qrEncode, qrSvg, qrBytes, qrCapacity } from './qr.js?v=20261107r18e';
import { mp4Parts } from './mp4.js?v=20261107r18e';

const ENGINE_SRC = 'engine/disk3d.js?v=3d62e469d3';   // ?v= the first ten characters of the engine's SHA-256 (engine/SOURCE.txt)
// The version, shown small at the foot of the rail and in the About dialog: MAJOR.MINOR, raised a little with each update
// of the public page (MINOR for new features or physics, a third number for small fixes). History: CHANGELOG.md.
// (round 10a) A development build (/disk-lab/dev/, made by ver2/tools/disk-lab-v2/make-dev.sh) carries MAJOR.MINOR-dev.N,
// N one more with each one published. The same line is written into index.html (every [data-version], and the short tag in
// the bar, [data-version-tag]) so that it shows without the script, on a page that has stopped too; check.js compares them.
const VERSION = '1.9', RELEASED = '2026-11-12';
const VERSION_LINE = `Disk Lab v${VERSION} (${RELEASED}) · engine ${ENGINE_SRC.split('v=')[1]}`;
// (round 14a) The rail's Model section, the model's parameters (DESIGN.md section 34), shown while MODEL_UI is true: the one
// switch for the public page. The parameters a link carries (mp=) and those kept on this device apply either way, and Reset all
// puts the defaults back.
const MODEL_UI = true;
// (round 10a) The keys this build keeps on the device (localStorage, sessionStorage): the public page's as before; a
// development build puts a prefix of its own in index.html's meta disk-lab-store (make-dev.sh), so that its records and
// settings never reach the public page on the same origin, nor the public page's its own
const STORE = (document.querySelector('meta[name="disk-lab-store"]') || {}).content || '';
const KEY = (k) => STORE + k;
// The citation (the page is free to use, no credit required; the line is offered to whoever wants to cite it: the owner, 2026-11-03): its address in one place, to change when the page
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
// ?fps=N, the frame rate while only the clock moves; ?split=0, the continuum's rays drawn whole, not in kicks (see the
// engine's SPLIT); ?kick=N, the work of a kick
// (round 13a, switches to compare the model look with that of before, on the development build: ?acclayer=1, the accretion layer
// drawn (data-acclayer="on"; ?acc=1 until round 17b, when round 16c's ?acc= of the still's frames had taken the name and the
// engine read neither as meant); ?gasrho=old, the gas's glow raised beyond 6 au as until round 13 (data-gasrho="old"); see the
// engine's ACC and uGasOuter, and DESIGN.md sections 31 and 41)
// (round 13c, the mass budget P-B', to compare on the development build: ?mflux=0, all the prescriptions of before (the wind's
// density and lambda of round 8, chi_c 0.03, the gas line's inflow of the layers' whole gas); ?lam=old, round 8's lambda in the
// budget, or ?lam=1.5,2.5, lambda at R_TI and at the disk's edge; ?lamin=1.2, lambda at the dust's inner edge (4 by default;
// 1.9-dev.7 is ?lam=1.5,2.5&lamin=1.5); ?mdot=1.5e-8, the accretion rate (M_sun/yr; 1e-7 by default) for the heating and the
// budget alike, read by the engine when its script runs (THERMO); ?chic=0.003, where the wind's base is held (0.015 by default). See the engine's
// MFLUX and DESIGN.md section 33. Only
// finite numbers are passed on; the engine bounds them)
const mfluxSw = (k, ok) => { const v = q.get(k); return v != null && ok(v) ? v : ''; };
const SWITCH = { duty: q.get('duty'), ctmax: Number(q.get('ctmax')) || 0, eddy: q.get('eddy') === '0', fps: Number(q.get('fps')) || 0, split: q.get('split') === '0', kick: Number(q.get('kick')) || 0, kadapt: q.get('kadapt') === '1',
  accLayer: q.get('acclayer') === '1', gasrho: q.get('gasrho') === 'old' ? 'old' : '',
  mflux: q.get('mflux') === '0' ? '0' : '', lam: mfluxSw('lam', (v) => v === 'old' || /^\s*\d*\.?\d+\s*,\s*\d*\.?\d+\s*$/.test(v)),
  mdot: mfluxSw('mdot', (v) => Number(v) > 0 && Number.isFinite(Number(v))), chic: mfluxSw('chic', (v) => Number(v) > 0 && Number.isFinite(Number(v))),
  lamin: mfluxSw('lamin', (v) => Number(v) > 0 && Number.isFinite(Number(v))) };
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
  const frame = ar >= 1.2 ? 'wide' : 'tall', src = `stills/${id}-${L()}-${frame}.webp`;
  lab.style.setProperty('--still-ar', frame === 'wide' ? '2' : '0.8');
  if (src === posterKey) return;
  posterKey = src;
  poster.src = src;
}

// (round 15a) the annotations' mask as the state gives it (1: all of them; see setAnn), and the bit of the material key below
const ANN_ALL = 126, ANN_KEY = 64;
const annBits = (a) => (Number(a) === 1 ? ANN_ALL : (Number(a) || 0) & ANN_ALL);
// ---------- the material key (round 8): the model look's colours, one per material (the engine's MAT, box.diskPalette) ----------
// (the owner: "colour the model look by material, not by temperature"; the temperature's bar that stood here went with it)
// Only the materials shown, and those that show at this distance: the envelope from 40 au, the star's magnetosphere and
// curtains within 2 au of the star; the pebbles' rock and ice on one row. (Round 13a: not the accretion layer, no longer drawn,
// unless ?acclayer=1 draws it; in the colours chosen, see the model look's colours)
// (Round 18k) With the model look's own light the gas and the pebbles take the colours of their brightness temperature: a bar of
// them in place of their rows, from the engine (box.diskSelfKey: a thick gas at 10 to 1500 K on the display, its ticks), and the
// key's title says so (the class tb); the look of round 18j (?selflook=old) keeps the materials' rows. (Round 18m: by default the
// bar is the gas's colour in shades, its brightness the temperature: the bar made again when the gas's colour changes (its colour in
// the row's key), and the title says brightness; the class tbh, with ?selfhue=1, the title of round 18k's colours)
let matShown = '';
function renderMatKey(s) {
  const on = s.look === 'model' && !s.slice && !!(annBits(s.ann) & ANN_KEY) && typeof box.diskPalette === 'function';   // (round 15a: its own annotation)
  matKey.classList.toggle('on', on);
  if (!on) return;
  const sk = s.glow === 'self' && typeof box.diskSelfKey === 'function' ? box.diskSelfKey() : null, tb = !!sk && !sk.old && !!(s.mode & 7);
  matKey.classList.toggle('tb', tb);
  matKey.classList.toggle('tbh', tb && !!sk.hue);
  const P = Object.fromEntries(box.diskPalette().map((m) => [m.key, m])), rows = [];
  if (tb) rows.push(['tb', (s.mode & 3) && (s.mode & 4) ? 'both' : s.mode & 3 ? 'gas' : 'peb', 'disk']);   // (round 18m: 'disk', the gas's colour in the key)
  if (s.mode & 3) { if (!tb) rows.push(['disk']); if (SWITCH.accLayer) rows.push(['acc']); }
  if ((s.mode & 4) && !tb) rows.push(['rock', 'ice']);
  if (s.mode & 8) rows.push(['wind']);
  if (s.mode & 64) rows.push(['jet']);
  if ((s.mode & 32) && s.d > 40) rows.push(['env']);
  if ((s.mode & 16) && s.planets.some((p) => p[1])) rows.push(['planet']);
  if (s.d < 2 && !s.p) rows.push(['mag'], ['curt']);
  if (s.marks && (s.mode & 1)) rows.push(['arrows']);   // (round 8: the flow arrows, with what their length means)
  const key = L() + JSON.stringify(rows.map((ks) => ks.map((k) => k + (P[k] ? P[k].hex : ''))));   // (round 13a: and their colours)
  if (key === matShown) return;
  matShown = key;
  matList.replaceChildren(...rows.map((ks) => ks[0] === 'arrows' ? el('li', {}, el('i', { class: 'arr' }, '\u2192'), el('span', {}, T().arrowsKey))
    : ks[0] === 'tb' ? el('li', { class: 'tb' }, el('span', {}, T().selfKey[ks[1]]),
      el('i', { class: 'tb-bar', style: 'background:linear-gradient(90deg,' + sk.stops.map(([u, c]) => c + ' ' + (100 * u).toFixed(1) + '%').join(',') + ')' }),
      el('span', { class: 'tb-ticks' }, ...sk.ticks.map(([u, t], i) => el('span', { style: 'left:' + (100 * u).toFixed(1) + '%' }, i === sk.ticks.length - 1 ? t + ' K' : t))))
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

// the engine's state for arriving at a place now (its distance fitted to the stage), with the planets its text needs
// (round 11a: shared with the scenes of the places, see placeScene; round 11b: asp, a video's frame's width / height)
function placeStateNow(pl, asp = aspect()) {
  const st = placeState(pl, S().mode, asp);
  // (the planet's place shows the first planet at 3 au, as its text says; others are kept)
  // (round 8: a Jupiter, as the place's text says)
  if (pl.id === 'planet') { const ps = S().planets.filter((p, j) => j > 0 && roomFor([[3, 1, 1]], p[0], -1, p[2])); st.planets = [[3, 1, 1], ...ps].slice(0, 4); st.pi = 0; }
  // (round 15a: likewise where none shown lies within the place's half-width, fitW: the start's planet at 10 au is outside the
  // millimetre place's 6 au, whose text speaks of the gap; a Jupiter at 3 au comes first, the shown ones kept where there is room)
  else if ((pl.needs & 16) && !S().planets.some((p) => p[1] && (!pl.fitW || p[0] < pl.fitW))) st.planets = [[3, 1, 1], ...S().planets.filter((p) => p[1] && roomFor([[3, 1, 1]], p[0], -1, p[2]))].slice(0, 4);
  return st;
}
function goPlace(i, { fly = true } = {}) {
  placeI = Math.min(PLACES.length - 1, Math.max(0, i));
  const pl = PLACES[placeI];
  if (live()) {
    const st = placeStateNow(pl);
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
  if (Math.abs((((s.roll || 0) - (target.roll || 0)) % 360 + 540) % 360 - 180) > 3) return true;   // (round 18a: rolled away)
  const drift = s.p || reduce ? 0 : SPIN_DEG * (s.time - target.time);
  const daz = ((s.az - target.az - drift) % 360 + 540) % 360 - 180;
  return Math.abs(daz) > 3;
}

// ---------- text ----------
// (round 14a) the numbers the places' texts quote, from the model's parameters (the defaults' before the engine has said them,
// and in the still pictures, which show the defaults)
const approx = (v) => (v >= 10 ? String(Math.round(v)) : v >= 0.1 ? v.toFixed(1) : v.toFixed(2));
const placeNums = () => ({ snow: approx(parDerived ? parDerived.snow : 1.149), rTI: approx(parDerived ? parDerived.rTI : 0.688) });
function renderPlace() {
  const pl = PLACES[placeI], w = T().places[pl.id], text = typeof w.text === 'function' ? w.text(placeNums()) : w.text;
  placeTitle.textContent = w.title;
  // (a new text comes in softly, unless motion is reduced)
  if (placeText.textContent !== text && placeText.textContent && !reduce && placeText.animate) {
    placeText.animate([{ opacity: 0, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,.7,.2,1)' });
  }
  placeText.textContent = text;
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
  renderParams(); renderWind();   // (round 14a)
  renderQuality();
  renderSaveSize();
  renderCite();
  renderStillNote();
  renderTalk();   // (round 11a)
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
// cut; and the note under the looks (the look's, the CO map's, or the cut face's). (Round 18i: in the model look its light, and
// with its own light the opacity, see the model look's light below; the note then says what the own light shows.)
function renderRail(s) {
  const w = T(), co = s.look === 'co', cutOpen = s.slice > 0 && s.look === 'model', glowable = s.look === 'model' && typeof s.glow === 'string';
  const lk = [L(), co, s.coMode, glowable, s.glow, ncShown(s)].join('|');   // (round 18l: and the surface's column's row)
  if (lk !== lookKey) {
    lookKey = lk;
    const kids = [];
    if (glowable) kids.push(...glowRows(s));
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
  if (glowable) { renderSelfk(s); renderSelfnc(s); }   // (round 18i: the opacity's slider in step, unless it is being dragged; round 18l: and the surface's column's)
  const shown = cutOpen ? keyItems(s) : [];
  const ck = [L(), cutOpen, s.sq, shown.join()].join('|');
  if (ck !== cutKey) {
    cutKey = ck;
    cutContext.replaceChildren(...(cutOpen ? [segmented(CUT_Q.map((k) => [k, w.cutQ[k]]), s.sq, (k) => { box.diskSet({ sq: k }); sync(); }, L() === 'ja' ? '断面に描く量' : 'Quantity on the cut'), cutKeyList(s.sq, shown)] : []));
  }
  // (round 18l: the own light's note by its temperature, see SELFNC_RANGE)
  lookNote.textContent = co ? w.coNotes[s.coMode] : cutOpen ? w.cutNotes[s.sq] : glowable && s.glow === 'self' ? (s.selft === 'star' ? w.glow.noteStar : s.selft === 'int' ? w.glow.noteInt : s.selft === 'col' ? w.glow.noteCol : w.glow.note) : w.looks[s.look].note;
}
const kms = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + ' km/s';
// (Round 18i, the owner: "in the model look, the pattern of its own emission alone, with no surface lit; an opacity of about 2
// instead") The model look's light, under the looks in the model look only: the starlight, as until now, or the gas's own thermal
// light (the engine's state glow, 'star' or 'self'; its SELF), and with the own light its opacity on a log slider, SELFK_RANGE in
// cm^2 per gram of gas, 2 by default (the state's selfk), its value beside it and a chip back to the default, a row as the model's
// parameters' (mp-row). Kept with the settings on this device (DEF_KEYS), in a link as glow=self and selfk= (none at 2), Reset all
// back to the starlight; not in the scenes (as the colours are not). DESIGN.md section 50
const SELFK_RANGE = [0.001, 100], SELFK_DEF = 2;
const selfkPos = (k) => String(Math.round(1000 * Math.log(k / SELFK_RANGE[0]) / Math.log(SELFK_RANGE[1] / SELFK_RANGE[0])));
const selfkOf = (pos) => (String(pos) === selfkPos(SELFK_DEF) ? SELFK_DEF : Number((SELFK_RANGE[0] * Math.pow(SELFK_RANGE[1] / SELFK_RANGE[0], Number(pos) / 1000)).toPrecision(2)));
const selfkNum = (k) => String(Number(k.toPrecision(2)));
const selfkText = (k) => selfkNum(k) + ' cm²/g';
// (Round 18l, the owner: "rather than colouring by the optical depth from the centre, give the surface its temperature, as a mock, by
// the vertical column depth") With the own light at the temperature of the column from above (the engine's state selft 'col', the
// default) the surface's column Sigma_s, below which the gas is at the interior's temperature, on a log slider under the opacity,
// SELFNC_RANGE in g cm^-2, 0.1 by default (the state's selfnc; the engine's SELF.NC_DEF), its value beside it and a chip back to the
// default, a row as the opacity's. Kept with the settings on this device (DEF_KEYS), in a link as selfnc= (none at 0.1), Reset all back
// to it; not shown with ?selflook=old (round 18j's look, at the interior's temperature). The state's selft, the own light's
// temperature for comparisons ('colstar' round 18m's, the column's with the starlight's shadow (round 18n), 'star' round 18k's, from the
// depth toward the star, 'int' round 18j's, the interior's), has no
// control: a link's (selft=, none at 'col'; round 18k's ?selfint=1 read as selft=int), not kept on the device (UNKEPT_KEYS), Reset
// all back to 'col'. The note under the looks says the temperature drawn. DESIGN.md section 53
const SELFNC_RANGE = [0.001, 10], SELFNC_DEF = 0.1;
const selfncPos = (v) => String(Math.round(1000 * Math.log(v / SELFNC_RANGE[0]) / Math.log(SELFNC_RANGE[1] / SELFNC_RANGE[0])));
const selfncOf = (pos) => (String(pos) === selfncPos(SELFNC_DEF) ? SELFNC_DEF : Number((SELFNC_RANGE[0] * Math.pow(SELFNC_RANGE[1] / SELFNC_RANGE[0], Number(pos) / 1000)).toPrecision(2)));
const selfncNum = (v) => String(Number(v.toPrecision(2)));
const selfncText = (v) => selfncNum(v) + ' g/cm²';
const ncShown = (s) => s.look === 'model' && s.glow === 'self' && (s.selft === 'col' || s.selft === 'colstar') && typeof s.selfnc === 'number' && box.dataset.selflook !== 'old';   // (round 18n: and round 18m's, colstar)
const glowEls = {};
let selfkW = '', selfncW = '';
function glowRows(s) {
  const w = T().glow;
  const row = el('div', { class: 'glow-row' }, el('span', { class: 'glow-name', 'aria-hidden': 'true' }, w.name),
    el('span', { class: 'glow-name' }, w.self));
  if (!glowEls.row) {
    Object.assign(glowEls, { name: el('label', { class: 'mp-name', for: 'selfK' }), input: el('input', { type: 'range', id: 'selfK', min: '0', max: '1000', step: '1', 'data-self-k': '1' }),
      val: el('span', { class: 'mp-val', 'aria-hidden': 'true' }), chip: el('button', { type: 'button', class: 'chip quiet', 'data-self-k-reset': '1', hidden: true }) });
    glowEls.row = el('div', { class: 'mp-row selfk-row' }, glowEls.name, glowEls.input, glowEls.val, glowEls.chip);
  }
  if (!ncShown(s)) return [row, glowEls.row];
  if (!glowEls.ncRow) {   // (round 18l: the surface's column, see SELFNC_RANGE)
    Object.assign(glowEls, { ncName: el('label', { class: 'mp-name', for: 'selfNc' }), ncInput: el('input', { type: 'range', id: 'selfNc', min: '0', max: '1000', step: '1', 'data-self-nc': '1' }),
      ncVal: el('span', { class: 'mp-val', 'aria-hidden': 'true' }), ncChip: el('button', { type: 'button', class: 'chip quiet', 'data-self-nc-reset': '1', hidden: true }) });
    glowEls.ncRow = el('div', { class: 'mp-row selfnc-row' }, glowEls.ncName, glowEls.ncInput, glowEls.ncVal, glowEls.ncChip);
  }
  return [row, glowEls.row, glowEls.ncRow];
}
function renderSelfk(s) {
  if (!glowEls.row || s.glow !== 'self') return;
  const w = T().glow, k = Number.isFinite(s.selfk) && s.selfk > 0 ? s.selfk : SELFK_DEF;
  if (document.activeElement !== glowEls.input && glowEls.input.value !== selfkPos(k)) glowEls.input.value = selfkPos(k);
  glowEls.name.textContent = w.k;
  glowEls.input.setAttribute('aria-label', w.kOf); glowEls.input.setAttribute('aria-valuetext', w.kSpoken({ k: selfkNum(k) }));
  if (!selfkW) selfkW = valW([...Array(101).keys()].map((i) => selfkText(selfkOf(10 * i))));   // (the widest value, as the parameters')
  glowEls.val.textContent = selfkText(k); glowEls.val.style.minWidth = selfkW;
  glowEls.chip.hidden = k === SELFK_DEF; glowEls.chip.textContent = w.kDefault; glowEls.chip.setAttribute('aria-label', w.kReset);
}
function renderSelfnc(s) {
  if (!glowEls.ncRow || !ncShown(s)) return;
  const w = T().glow, v = Number.isFinite(s.selfnc) && s.selfnc > 0 ? s.selfnc : SELFNC_DEF;
  if (document.activeElement !== glowEls.ncInput && glowEls.ncInput.value !== selfncPos(v)) glowEls.ncInput.value = selfncPos(v);
  glowEls.ncName.textContent = w.nc;
  glowEls.ncInput.setAttribute('aria-label', w.ncOf); glowEls.ncInput.setAttribute('aria-valuetext', w.ncSpoken({ v: selfncNum(v) }));
  if (!selfncW) selfncW = valW([...Array(101).keys()].map((i) => selfncText(selfncOf(10 * i))));   // (the widest value, as the opacity's)
  glowEls.ncVal.textContent = selfncText(v); glowEls.ncVal.style.minWidth = selfncW;
  glowEls.ncChip.hidden = v === SELFNC_DEF; glowEls.ncChip.textContent = w.kDefault; glowEls.ncChip.setAttribute('aria-label', w.ncReset);
}
function setSelfk(k, drag = false) {
  if (!live()) return;
  if (drag) moving();
  box.diskSet({ selfk: k });
  renderSelfk(S());
}
function setSelfnc(v, drag = false) {   // (round 18l)
  if (!live()) return;
  if (drag) moving();
  box.diskSet({ selfnc: v });
  renderSelfnc(S());
}
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
  // (round 19e: with the dark edge the engine draws under them, its pebHalo)
  pebbles: '<path d="M1 5h22" stroke="#0a0d18" stroke-opacity=".45" stroke-width="3.8"/><path d="M1 5h11" stroke="#b07a52" stroke-width="2.2"/><path d="M12 5h11" stroke="#e3f1ff" stroke-width="2.2"/>',
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
// takes back the calibrated scale at once rather than climbing to it. (Round 10a, dev.6: in Auto; a fixed level holds its
// own in the CO line too, the guard's cap (allowed) bounding the first frames and the ramp climbing, as in the other looks:
// its passes are in kicks in the cheaper tier, in bands of whole rays in the full)
const CO_FLOOR = 0.12;
let wasCo = false;
function sync() {
  // (round 11b: not while a video is made: its scenes' states are the video's, not the visitor's, and the page's guard, scale and
  // settings stand aside until the page is put back as it was; the controls are under the cover meanwhile)
  if (!live() || exporting) return;
  const s = S();
  if (calibrated && keyOf(s) !== gc.key) guardSwitch(keyOf(s));   // (round 9: a change the engine made, as the S key's cut)
  // (a still picture's scale is for that picture: the clock started, or another look, by any way, ends it)
  if (sharpFrom && ((!s.paused && !reduce) || s.look + s.coMode !== sharpWhat)) unsharpen();
  const base = diag.calibration && diag.calibration.scale, co = s.look === 'co';
  if (co !== wasCo && quality !== 'auto' && !holdSharp) { qCap = 1; costs.length = 0; scaleTo(fixedScale()); }
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
  const opt = { field: s.field, marks: s.marks, asym: s.asym, waves: s.waves, drop: box.dataset.pick === 'pebbles' };
  rail.querySelectorAll('[data-opt]').forEach((b) => pressed(b, opt[b.dataset.opt]));
  rail.querySelectorAll('[data-ann]').forEach((c) => { c.checked = !!(annBits(s.ann) & Number(c.dataset.ann)); });   // (round 15a)
  renderAim(s);   // (round 18e: the point looked at)
  rail.querySelectorAll('[data-cut]').forEach((b) => pressed(b, Number(b.dataset.cut) === s.slice));
  rail.querySelectorAll('[data-bg]').forEach((b) => pressed(b, b.dataset.bg === (s.bg || 'stars')));
  rail.querySelectorAll('[data-speed]').forEach((b) => pressed(b, Math.abs(Number(b.dataset.speed) - s.speed) < 1e-6));
  exSoon();   // (round 11b: the video's plan follows the state, while its section is open)
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
  if (b.dataset.pal) { palToggle(b.dataset.pal); return; }   // (round 18d: a component's palette, nothing of the state changed)
  const s = S();
  // (a component may be more than one of the engine's bits, the gas with its dust: on if any is, and all turn together)
  if (b.dataset.bit) { const bit = Number(b.dataset.bit), m = s.mode & bit ? s.mode & ~bit : s.mode | bit; box.diskSet({ mode: m, ...((m & 16) && !s.planets.some((p) => p[1]) ? { planets: [...s.planets.filter((p) => roomFor([[3, 1, 1]], p[0], -1, p[2]) || !p[1]), [3, 1, 1]].slice(-4) } : {}) }); }
  else if (b.dataset.opt === 'field') box.diskField(!s.field);
  else if (b.dataset.opt === 'marks') box.diskSet({ marks: s.marks ? 0 : 1 });
  else if (b.dataset.opt === 'asym') box.diskSet({ asym: s.asym ? 0 : 1 });
  else if (b.dataset.opt === 'waves') box.diskSet({ waves: s.waves ? 0 : 1 });
  else if (b.dataset.opt === 'drop') setPick(box.dataset.pick === 'pebbles' ? false : 'pebbles');
  else if (b.dataset.bg) box.diskSet({ bg: b.dataset.bg });   // (round 8: the background, the engine's BG)
  else if (b.dataset.cut) { const k = Number(b.dataset.cut); guardSwitch(keyOf({ ...s, slice: k, look: k ? 'model' : s.look })); if (k === 0) box.diskSlice(false); else box.diskSlice(true, null, k === 2 ? 'quarter' : 'half'); }
  else if (b.dataset.angle) { const [elv, az] = b.dataset.angle.split(',').map(Number); box.diskSet({ slice: 0, p: 0, el: elv, az, fly: reduce ? 0 : 1 }); }
  else if (b.id === 'recentre') box.diskCenter();
  else if (b.dataset.aim) aimClick(b);   // (round 18e: the point looked at, a step unless a press made it)
  else if (b.id === 'resetView') goPlace(0);
  else if (b.id === 'rollReset') { box.diskSet({ roll: 0, fly: reduce ? 0 : 1 }); keepSoon(); }   // (round 18a: the roll back to 0)
  else if (b.id === 'starsReset') { box.diskSet({ stars: 1 }); renderStars(S()); keepSoon(); }   // (round 18a: the stars, the default)
  else if (b.id === 'resetAll') { resetAll(); return; }
  else if (b.dataset.speed) box.diskSpeed(Number(b.dataset.speed));
  else if (b.id === 'copyLink') copyLink();
  else if (b.id === 'showQr') qrShow(false);   // (round 11c)
  else if (b.id === 'saveImage') saveImage(b);
  else if (b.dataset.saveSize) { saveSize = b.dataset.saveSize; try { sessionStorage.setItem(KEY('disk-lab-save-size'), saveSize); } catch { /* for this view only */ } renderSaveSize(); }
  else if (b.dataset.saveRatio) setSaveFrame(b.dataset.saveRatio);   // (round 11c: the slide's shape, and the credit)
  else if (b.id === 'saveCredit') setSaveFrame(null, !saveCredit);
  else if (b.dataset.quality) setQuality(b.dataset.quality);
  else if (b.id === 'citeCopy') copyCite();
  else if (b.dataset.planetOn != null) { const pl = S().planets; const i = Number(b.dataset.planetOn); if (pl[i]) { pl[i][1] = pl[i][1] ? 0 : 1; if (pl[i][1] && !roomFor(pl, pl[i][0], i, pl[i][2])) pl[i][1] = 0; box.diskSet({ planets: pl }); } }
  else if (b.dataset.planetRemove != null) { const pl = S().planets; pl.splice(Number(b.dataset.planetRemove), 1); box.diskSet({ planets: pl }); }
  else if (b.id === 'addPlanet') setPick(box.dataset.pick === 'planet' ? false : 'planet');
  else if (b.dataset.cpdAuto != null) box.diskSet({ cpdMdot: 0 });   // (round 13e: the planets' accretion rate back to auto)
  else if (b.dataset.colReset) resetCol(b.dataset.colReset);   // (round 13a: a component's colours back to the default; round 18d: a colour's)
  else if (b.dataset.mpReset) setParam(b.dataset.mpReset, parDef && parDef[b.dataset.mpReset]);   // (round 14a: a parameter back to its default)
  else if (b.dataset.windReset) { windGain = 1; applyWind(); keepSoon(); }   // (round 14a: the wind's brightness)
  else if (b.dataset.opacReset != null) { setOpac(Number(b.dataset.opacReset), 1); keepSoon(); }   // (round 18a: the see-through)
  else if (b.dataset.selfKReset) { setSelfk(SELFK_DEF); keepSoon(); }   // (round 18i: the own light's opacity)
  else if (b.dataset.selfNcReset) { setSelfnc(SELFNC_DEF); keepSoon(); }   // (round 18l: the surface's column)
  sync();
});
// (round 9) a planet's slider: while it is dragged, the engine makes the gap's starlight anew at most every 120 ms and the
// picture is drawn at the moving scale (as for a move of the view, see moving); on release ('change') in full
rail.addEventListener('input', (e) => {
  const t = e.target; if (!live()) return;
  if (t.dataset.col) setCol(t.dataset.col, t.value);   // (round 13a: a colour, the picture following while it is chosen)
  else if (t.dataset.planetA != null) movePlanet(Number(t.dataset.planetA), aOf(t.value), true);
  else if (t.dataset.planetM != null) massPlanet(Number(t.dataset.planetM), mOf(t.value), true);
  else if (t.dataset.cpdMdot != null) { moving(); box.diskSet({ cpdMdot: mdOf(t.value) }); cpdRowSync(S()); }   // (round 13e)
  else if (t.dataset.mp) setParam(t.dataset.mp, mpOf(t.dataset.mp, t.value), true);   // (round 14a: a parameter, see setParam)
  else if (t.dataset.windGain) { windGain = wbOf(t.value); applyWind(true); }
  else if (t.dataset.opac != null) setOpac(Number(t.dataset.opac), opOf(t.value), true);   // (round 18a)
  else if (t.dataset.selfK) setSelfk(selfkOf(t.value), true);   // (round 18i)
  else if (t.dataset.selfNc) setSelfnc(selfncOf(t.value), true);   // (round 18l)
  else if (t.id === 'rollRange') { moving(); box.diskSet({ roll: Number(t.value) }); renderRoll(S()); }   // (round 18a: the roll, at once)
  else if (t.id === 'starsRange') { box.diskSet({ stars: stOf(t.value) }); renderStars(S()); }   // (round 18a)
});
rail.addEventListener('change', (e) => {
  const t = e.target; if (!live()) return;
  if (t.dataset.col) setCol(t.dataset.col, t.value);
  else if (t.dataset.planetA != null) movePlanet(Number(t.dataset.planetA), aOf(t.value));
  else if (t.dataset.planetM != null) massPlanet(Number(t.dataset.planetM), mOf(t.value));
  else if (t.dataset.cpdMdot != null) { box.diskSet({ cpdMdot: mdOf(t.value) }); sync(); }   // (round 13e)
  else if (t.dataset.mp) setParam(t.dataset.mp, mpOf(t.dataset.mp, t.value));
  else if (t.dataset.windGain) { windGain = wbOf(t.value); applyWind(); keepSoon(); }
  else if (t.dataset.opac != null) { setOpac(Number(t.dataset.opac), opOf(t.value)); keepSoon(); }   // (round 18a)
  else if (t.dataset.selfK) { setSelfk(selfkOf(t.value)); keepSoon(); }   // (round 18i)
  else if (t.dataset.selfNc) { setSelfnc(selfncOf(t.value)); keepSoon(); }   // (round 18l)
  else if (t.id === 'rollRange') { box.diskSet({ roll: Number(t.value) }); renderRoll(S()); keepSoon(); }   // (round 18a)
  else if (t.id === 'starsRange') { box.diskSet({ stars: stOf(t.value) }); renderStars(S()); keepSoon(); }   // (round 18a)
  else if (t.dataset.ann) setAnn(Number(t.dataset.ann), t.checked);   // (round 15a)
});
// (round 15a, the owner: the annotations each their own choice) the rail's View: a checkbox for each kind (data-ann, the engine's ANN
// bits: the snow line's name 2, the planet's label 4, the scale bar 8, the cut's lines and colour bar 16, the gas line's colour bar
// 32, the model look's key of the colours 64, drawn by the page), the state's ann the mask of those ticked; 1 when all are, as links
// have always written it, 0 when none (annBits, ANN_ALL: before the material key). The A key hides them all and brings back those shown
function setAnn(bit, on) { const m = annBits(S().ann), n = on ? m | bit : m & ~bit; box.diskSet({ ann: n === ANN_ALL ? 1 : n }); sync(); }

// ---------- the components (Show): each a toggle; turned on, its settings open below it ----------
// (round 6: the gas and its dust are one component, the engine's bits 1 and 2 together: the owner, "treat the gas as a
// mixture with its dust; the dust on its own hardly shows in the model". In the observed looks bit 2 is the lit surface
// the dust makes, which goes with the gas as well. A link with one of the two bits is read as both, linkMode.)
// (round 6: the amounts, the engine's display factors of the components, are gone from the page, the owner's choice: the
// model's own amounts are what is shown, and a link's g= is read past)
// opts: the engine's options that belong to it (the gas's flow arrows, the pebbles' tap mode, the wind's asymmetry, the
// planets' waves); planets:
// the list of planets. The envelope and the jet have no settings of their own (round 15a: the labels are the View's annotations). (The flow markers were the field
// lines' option from round 5, 2026-10-16; round 8, the owner: "the flow markers: an option of the gas; small arrows". They
// show the gas's motion, drawn while the gas is shown.)
// (round 13a) cols: the materials whose colour in the model look is chosen beside the toggle (the engine's MAT keys; see the
// model look's colours): the gas, the pebbles' rock and ice, the wind, the jet, the envelope. (Round 18d: in the component's
// palette, which its swatch beside the toggle opens; see the palettes below)
// (round 14a) the wind's brightness in the model look, a row under the wind's settings (see the wind's brightness below):
// made here, with the components, its elements kept in wbEls
const wbEls = {};
function wbRow() {
  Object.assign(wbEls, { name: el('label', { class: 'mp-name', for: 'windGain' }), input: el('input', { type: 'range', id: 'windGain', min: '0', max: '1000', step: '1', 'data-wind-gain': '1' }),
    val: el('span', { class: 'mp-val' }), chip: el('button', { type: 'button', class: 'chip quiet', 'data-wind-reset': '1', hidden: true }) });
  wbEls.row = el('div', { class: 'mp-row gain-row', hidden: true }, wbEls.name, wbEls.input, wbEls.val, wbEls.chip);
  return wbEls.row;
}
// (round 18a, the owner: "the objects' transparency too") a component's see-through (see the see-through below): made here, its
// elements kept in opEls by the component's place in op; OP_MIN, the least factor, and OP_MAX, the slider's end (the share taken
// away, %). (Round 18b, the owner: "could the see-through's controls be more discreet?": a small half-filled mark and a short
// slider with no name, the value and the chip only once it is changed. Round 18c: in the colours' span beside the toggle.)
// (Round 18d, the owner: "moving the see-through's bar makes its text appear, and the row breaks onto two lines: deal with it;
// can't it go inside the colour palette?") In the component's palette (see the palettes below), a row as the model's parameters'
// (mp-row): its name over the slider, the value beside it, the chip back to the default beside the name with its place kept while
// it is hidden, so that the slider keeps its length and its place as the value changes. Its class op-row marks it among them.
const OP_MIN = 0.05, OP_MAX = Math.round(100 * (1 - OP_MIN));
const opEls = [];
// (round 18d: the face of a component's swatch in the looks other than the model's, where its palette holds the see-through alone)
function opMark() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', 'op-mark');
  const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); ring.setAttribute('cx', '8'); ring.setAttribute('cy', '8'); ring.setAttribute('r', '5.5');
  const half = document.createElementNS('http://www.w3.org/2000/svg', 'path'); half.setAttribute('d', 'M8 2.5a5.5 5.5 0 0 0 0 11Z'); half.setAttribute('fill', 'currentColor');
  s.append(ring, half);
  return s;
}
function opRow(i) {
  const e = { name: el('label', { class: 'mp-name', for: 'opac' + i }), input: el('input', { type: 'range', id: 'opac' + i, min: '0', max: String(OP_MAX), step: '1', 'data-opac': String(i) }),
    val: el('span', { class: 'mp-val', 'aria-hidden': 'true' }), chip: el('button', { type: 'button', class: 'chip quiet', 'data-opac-reset': String(i), hidden: true }) };
  e.row = el('div', { class: 'mp-row op-row' }, e.name, e.input, e.val, e.chip);   // (round 18d: in the palette)
  opEls[i] = e;
  return e.row;
}
// (round 18d) a colour's row in a component's palette: its name (the pebbles' rock and ice, else "colour"), the colour input and
// the chip back to that colour's default, shown once it is changed
function colRow(k) {
  const r = { k, name: el('label', { class: 'pal-name', for: 'col-' + k }), input: el('input', { type: 'color', id: 'col-' + k, 'data-col': k }),
    chip: el('button', { type: 'button', class: 'chip quiet', 'data-col-reset': k, hidden: true }) };
  r.row = el('div', { class: 'pal-col' }, r.name, r.input, r.chip);
  return r;
}
// (round 18a) op: the component's place in the state's op, its see-through (see the see-through below); the jet has none (its lobes
// only shine, nothing of it takes light out of the ray), the planets' disks go with the gas's. (Round 18d, the owner: "a see-through
// for the jet": its place 4, a factor on its light, as its palette's note says; "for the field lines a colour palette and a
// see-through bar": their colour 'field', drawn in the overlay, and their place 5, a factor on their lines' opacity.) opLooks: the
// looks where the see-through has something to act on, when not all of them (the engine draws the field lines in the model look
// alone, the jet in the model and the visible look, JET.LOOK); elsewhere its palette holds no see-through (see renderPal)
const COMPS = [
  { key: 'gas', bit: 3, opts: ['marks'], cols: ['disk'], op: 0 }, { key: 'pebbles', bit: 4, opts: ['drop'], cols: ['rock', 'ice'], op: 1 },
  { key: 'wind', bit: 8, opts: ['asym'], cols: ['wind'], op: 2 }, { key: 'jet', bit: 64, cols: ['jet'], op: 4, opLooks: ['model', 'optical'] },
  { key: 'field', opt: 'field', cols: ['field'], op: 5, opLooks: ['model'] },
  { key: 'planet', bit: 16, planets: true, opts: ['waves'] }, { key: 'envelope', bit: 32, cols: ['env'], op: 3 }
];   // (round 15a: the labels, a component until now, are the View's annotations, a choice for each kind)
const compEls = COMPS.map((c) => {
  const btn = el('button', { type: 'button', class: 'toggle', 'aria-pressed': 'false', ...(c.bit ? { 'data-bit': String(c.bit) } : { 'data-opt': c.opt }) });
  const box_ = c.opts || c.planets ? el('div', { class: 'comp-opts', hidden: true }) : null;   // (round 18c: the see-through moved to the colours)
  if (c.planets) box_.append(el('div', { class: 'planet-list' }), el('button', { type: 'button', class: 'chip quiet', id: 'addPlanet', 'aria-pressed': 'false' }));
  for (const o of c.opts || []) box_.append(el('button', { type: 'button', class: 'toggle small', 'data-opt': o, 'aria-pressed': 'false' }));
  // (round 13e) the planets' accretion rate, which sets their own disks (see cpdRowSync)
  if (c.planets) box_.append(el('div', { class: 'cpd-mdot' }, el('span', { class: 'cpd-mdot-k', 'data-cpd-k': '' }), el('span', { class: 'cpd-mdot-v', 'data-cpd-v': '' }),
    el('input', { type: 'range', min: '0', max: '1000', step: '1', 'data-cpd-mdot': '' }), el('button', { type: 'button', class: 'chip quiet', 'data-cpd-auto': '', hidden: true })),
  el('p', { class: 'rail-note cpd-note', 'data-cpd-note': '' }));
  if (c.key === 'wind') box_.append(wbRow());   // (round 14a: its brightness in the model look)
  if (c.planets) box_.append(el('p', { class: 'rail-note planets-note' }));
  // (round 13a) beside the toggle, its colours (shown in the model look once the engine has started) and the chip back to the
  // default (shown while one of them is changed). (Round 18c: the see-through's mark and slider after them.) (Round 18d) One small
  // round swatch instead, which opens the component's palette (see the palettes below): its colours' rows and its see-through's.
  // The palette follows the swatch in the order of the page (the Tab key goes from the swatch into it); it lies over what follows.
  let pal = null;
  if (c.cols || c.op != null) {
    const id = 'pal-' + c.key, cr = (c.cols || []).map(colRow);
    pal = { cols: cr, dot: el('span', { class: 'pal-dot', 'aria-hidden': 'true' }), note: c.key === 'jet' ? el('p', { class: 'rail-note pal-note' }) : null };   // (round 18d: the jet's, what its see-through does)
    pal.btn = el('button', { type: 'button', class: 'pal-btn', 'data-pal': c.key, 'aria-expanded': 'false', 'aria-controls': id, hidden: true }, pal.dot, opMark());
    pal.box = el('div', { class: 'pal', id, role: 'group', hidden: true }, ...cr.map((r) => r.row), c.op != null ? opRow(c.op) : null, pal.note);
  }
  const row = el('div', { class: 'comp', 'data-comp': c.key }, btn, pal && pal.btn, pal && pal.box, box_);
  $('comps').append(row);
  return { c, row, btn, opts: box_, pal };
});
function renderComps() {
  const w = T().show;
  for (const { c, btn, opts, pal } of compEls) {
    btn.textContent = w[c.key];
    if (pal) {   // (round 13a; round 18d: in the palette, a chip for each colour. The swatch's name goes with the look: renderPal)
      for (const r of pal.cols) {
        const t = w.colOf(r.k);
        r.name.textContent = w.colName(r.k); r.input.setAttribute('aria-label', t); r.input.setAttribute('title', t);
        r.chip.textContent = w.colDefault; r.chip.setAttribute('aria-label', w.colReset(r.k));
      }
      if (pal.note) pal.note.textContent = w.opacJet;   // (round 18d: what the see-through does to the jet)
    }
    if (!opts) continue;
    opts.querySelectorAll('[data-opt]').forEach((b) => { b.textContent = w[b.dataset.opt]; });
    const add = opts.querySelector('#addPlanet'); if (add) add.textContent = '+ ' + w.addPlanet;
    const nt = opts.querySelector('.planets-note'); if (nt) nt.textContent = w.planetsNote;
    // (round 13e) the planets' accretion rate's words (its value: cpdRowSync)
    const ck = opts.querySelector('[data-cpd-k]');
    if (ck) {
      ck.textContent = w.cpdMdot;
      opts.querySelector('[data-cpd-mdot]').setAttribute('aria-label', w.cpdMdotOf);
      opts.querySelector('[data-cpd-auto]').textContent = w.cpdAutoBtn;
      opts.querySelector('[data-cpd-note]').textContent = w.cpdNote;
    }
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
// (round 13e) The planets' accretion rate (the owner's D-2, cpd-detail-study.md section 9): by default each planet's is a tenth of
// the disk's accretion rate at its orbit (the engine's cpdPhys), "auto"; the slider sets one rate for all the planets, on a log
// scale from 1e-10 to 1e-4 M_J/yr (PDS 70 b and c accrete about 1e-8; the default near 3e-5 at 3 au), and the chip goes back to
// auto. The value: the rate set, or auto with the first shown planet's own. It sets their disks' temperature, thickness and
// millimetre light (DESIGN.md section 35). Kept with the settings (DEF_KEYS) and in a link (pmd=).
const PL_MD = [1e-10, 1e-4];
const mdOf = (v) => +(PL_MD[0] * Math.pow(PL_MD[1] / PL_MD[0], Number(v) / 1000)).toPrecision(2);
const sliderOfMd = (m) => String(Math.round(1000 * Math.log(Math.min(PL_MD[1], Math.max(PL_MD[0], m)) / PL_MD[0]) / Math.log(PL_MD[1] / PL_MD[0])));
// a rate as "3.0 × 10⁻⁵ M_J/yr" (the J a subscript)
const mdEl = (m) => el('span', {}, sci(m) + ' M', el('sub', {}, 'J'), '/' + T().probe.yr);
function cpdRowSync(s) {
  const comps = $('comps'), val = comps.querySelector('[data-cpd-v]');
  if (!val || typeof box.diskCpdState !== 'function') return;
  const set = s.cpdMdot > 0, i = s.planets.findIndex((p) => p[1]), c = i >= 0 ? box.diskCpdState(i) : null;
  const v = set ? s.cpdMdot : c ? c.mdot : 0;
  val.replaceChildren(set ? mdEl(v) : T().show.cpdAuto(v > 0 ? sci(v) : '—'));
  const input = comps.querySelector('[data-cpd-mdot]');
  if (input && v > 0 && document.activeElement !== input) input.value = sliderOfMd(v);
  const chip = comps.querySelector('[data-cpd-auto]');
  if (chip) chip.hidden = !set;
}
function syncComps(s) {
  cpdRowSync(s);
  const opt = { field: s.field };
  for (const { c, opts } of compEls) {
    const on = c.bit ? !!(s.mode & c.bit) : !!opt[c.opt];
    if (opts) opts.hidden = !on;
  }
  renderPal(s);   // (round 13a: the colours are the model look's; round 18d: the swatches and the palettes' rows with the look)
  // (round 14a: the wind's brightness, as the colours, the model look's)
  if (wbEls.row) wbEls.row.hidden = s.look !== 'model' || typeof box.diskWindGain !== 'function';
  renderOpac(s);   // (round 18a: the see-through, in every look)
  renderRoll(s);   // (round 18a: the camera's roll)
  renderStars(s);   // (round 18a: the background's stars)
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

// ---------- the components' palettes (round 18d) ----------
// The owner: "moving the see-through's bar makes its text appear, and the row breaks onto two lines: deal with it; can't it go
// inside the colour palette?" Beside each toggle with colours or a see-through, one small round swatch, and nothing else that
// changes: in the model look the component's colour now (the pebbles' rock and ice, a circle in two halves), changed or not; in
// the other looks the half-filled mark, its palette then holding the see-through alone (no swatch there for a component with
// nothing to show in that look: the field lines, drawn in the model look alone, and the jet beyond the visible look; COMPS'
// opLooks). The swatch opens the component's palette below it, within the rail's column, over the rows that follow: a row for
// each of its colours in the model look (a name, the colour input, the chip back to that colour's default once changed) and the
// see-through's row in every look where it acts (its name, the slider, the value, the chip once changed). What changes is in
// the palette, so the row of the toggle keeps one line. One palette open at a time (palOpen, the component's entry of compEls).
// The swatch has aria-expanded and names its palette (aria-controls), a group named as the swatch; opened, the focus goes to
// its first control.
// Closed by the swatch again, by Esc (the focus back on the swatch), by a press outside it and its swatch (the focus left where
// the press puts it), and when the focus moves on out of it (Tab past its last control, which would leave it over the rows that
// the focus goes to). col=, op=, the settings kept (DEF_KEYS) and Reset all are as before.
let palOpen = null;
// the swatches as the look and the colours are, with their names (and the palettes' as the swatches'), and in each palette the
// colours' rows in the model look only, the see-through's where it acts; shown once the engine has started (the colours' defaults
// known)
function renderPal(s) {
  const w = T().show, model = s.look === 'model';
  for (const { c, pal } of compEls) {
    if (!pal) continue;
    const withCols = model && pal.cols.length > 0, withOp = c.op != null && (!c.opLooks || c.opLooks.includes(s.look));
    const label = withCols ? w.pal(w[c.key]) : w.palOp(w[c.key]);
    pal.btn.hidden = !colDef || (!withCols && !withOp);
    pal.btn.classList.toggle('op-only', !withCols);
    pal.btn.setAttribute('aria-label', label); pal.btn.setAttribute('title', label); pal.box.setAttribute('aria-label', label);
    if (colDef) { const hex = pal.cols.map((r) => cols[r.k] || colDef[r.k]); pal.dot.style.background = hex.length > 1 ? `linear-gradient(90deg, ${hex[0]} 50%, ${hex[1]} 50%)` : hex[0] || ''; }
    for (const r of pal.cols) r.row.hidden = !model;
    if (opEls[c.op]) opEls[c.op].row.hidden = !withOp;
    if (pal.note) pal.note.hidden = !withOp;
    if (palOpen && palOpen.pal === pal) {
      if (pal.btn.hidden) palClose(false);
      // (a look left while a colour had the focus: the see-through's slider takes it)
      else if (!model && pal.cols.some((r) => r.input === document.activeElement) && opEls[c.op]) opEls[c.op].input.focus({ preventScroll: true });
    }
  }
  palPlace();
}
function palToggle(key) {
  const ce = compEls.find((x) => x.c.key === key);
  if (!ce || !ce.pal) return;
  const again = palOpen === ce;
  palClose(false);
  if (again) return;
  palOpen = ce;
  ce.pal.box.hidden = false; ce.pal.btn.setAttribute('aria-expanded', 'true');
  palPlace();
  const r0 = ce.pal.cols.find((r) => !r.row.hidden), e = opEls[ce.c.op], first = r0 ? r0.input : e && !e.row.hidden ? e.input : null;
  if (first) first.focus({ preventScroll: true });
  ce.pal.box.scrollIntoView({ block: 'nearest' });
}
function palClose(back) {
  const ce = palOpen;
  if (!ce) return;
  palOpen = null;
  ce.pal.box.hidden = true; ce.pal.btn.setAttribute('aria-expanded', 'false');
  if (back) ce.pal.btn.focus({ preventScroll: true });
}
// below its swatch, as wide as its rows need and the column allows (CSS), its left edge under the swatch as far as it fits
function palPlace() {
  if (!palOpen) return;
  const { row, pal } = palOpen, W = row.clientWidth, w = Math.min(W, pal.box.offsetWidth);
  pal.box.style.top = (pal.btn.offsetTop + pal.btn.offsetHeight + 4) + 'px';
  pal.box.style.left = Math.max(0, Math.min(pal.btn.offsetLeft - 6, W - w)) + 'px';
}
document.addEventListener('pointerdown', (e) => { if (palOpen && !palOpen.pal.box.contains(e.target) && !palOpen.pal.btn.contains(e.target)) palClose(false); }, { capture: true });
rail.addEventListener('focusout', (e) => { const t = e.relatedTarget; if (palOpen && t && !palOpen.pal.box.contains(t) && !palOpen.pal.btn.contains(t)) palClose(false); });
window.addEventListener('resize', () => palPlace());

// ---------- the model look's colours (round 13a) ----------
// The owner: "make each colour changeable". The colour of each material the model look draws (the gas, the pebbles' rock and
// ice, the wind, the jet, the envelope: COMPS' cols) is chosen beside its component in Show, with a colour input and, while
// one is changed, a chip back to the default. They go to the engine in one call, box.diskColours (each material not chosen
// takes its default, the engine's MAT), are kept with the settings on this device (settingsNow, under KEY), written into a
// link as one parameter, col= (COL-LINK), and put back by Reset all. Shown in the model look only: the observed looks show a
// light of their own, in colours that are not the materials'. Not in the scenes (a scene is a view, not a palette). (Round 18d:
// in each component's palette; and the field lines' colour, 'field', which the engine draws in the overlay, where the field lines
// are drawn in the model look only)
// COL-LINK
// The colours a link carries, in this order: the gas (the engine's 'disk'), the pebbles' rock and ice, the wind, the jet, the
// envelope ('env'), the field lines ('field', round 18d). col= holds their six hex digits each in that order, separated by dots,
// a field left empty for a colour at its default and the empty ones at the end left out: col=ff8800 is the gas alone,
// col=.....c080ff the envelope alone, col=......ffaa00 the field lines alone, and no col= at all is every default. Read back, a
// field that is not six hex digits is the default, and fields past the seventh are passed over (a link of six, before round
// 18d, has the field lines' at the default).
const COL_ORDER = ['disk', 'rock', 'ice', 'wind', 'jet', 'env', 'field'];
// a colour as '#rrggbb' in small letters, from '#rrggbb' or 'rrggbb' in either case; null if it is not one
function colHex(v) { return typeof v === 'string' && /^#?[0-9a-f]{6}$/i.test(v) ? '#' + v.replace('#', '').toLowerCase() : null; }
// the colours chosen ({ key: colour }), only the keys of COL_ORDER, only real colours, none at its default (def, by key)
function colClean(cols, def) {
  const out = {};
  for (const k of COL_ORDER) { const h = colHex(cols && cols[k]); if (h && h !== def[k]) out[k] = h; }
  return out;
}
// the colours chosen as a link's value ('' when every one is at its default)
function colToLink(cols, def) {
  const c = colClean(cols, def), f = COL_ORDER.map((k) => (c[k] ? c[k].slice(1) : ''));
  while (f.length && !f[f.length - 1]) f.pop();
  return f.join('.');
}
// a link's value back as the colours chosen (only those not at the default)
function colFromLink(s, def) {
  const f = typeof s === 'string' ? s.split('.') : [], cols = {};
  COL_ORDER.forEach((k, i) => { if (/^[0-9a-f]{6}$/i.test(f[i] || '')) cols[k] = '#' + f[i].toLowerCase(); });
  return colClean(cols, def);
}
// /COL-LINK
// the colours chosen (only those not at the default) and the engine's defaults (null until the engine has started)
let cols = {}, colDef = null;
// into the engine, in one call, and into the inputs and chips
function applyCols() {
  if (typeof box.diskColours === 'function') colDef = box.diskColours(cols).def;
  renderCols();
}
// the inputs as the colours are, and each colour's chip back to its default while it is changed (round 18d: a chip for each
// colour, in the palette; the swatches follow, renderPal)
function renderCols() {
  if (!colDef) return;
  for (const { pal } of compEls) {
    if (!pal) continue;
    for (const r of pal.cols) { const v = cols[r.k] || colDef[r.k]; if (v && r.input.value !== v) r.input.value = v; r.chip.hidden = !cols[r.k]; }
  }
  if (live()) renderPal(S());
}
// a colour chosen in an input (and while it is being chosen: the picture follows)
function setCol(k, v) {
  const h = colHex(v);
  if (!h || !colDef || !COL_ORDER.includes(k)) return;
  if (h === colDef[k]) delete cols[k]; else cols[k] = h;
  applyCols();
  renderMatKey(S());
  keepSoon();
}
// a colour back to its default (the rail's click handler then syncs, and keeps the settings). (Round 18d: each colour's own chip;
// a component's chip put all its colours back until then)
function resetCol(k) {
  if (!COL_ORDER.includes(k)) return;
  delete cols[k];
  applyCols();
}
// the colours kept with the settings on this device (none: the defaults)
const keptCols = () => (saved && typeof saved.col === 'string' && colDef ? colFromLink(saved.col, colDef) : {});

// ---------- the model's parameters (round 14a) ----------
// The owner: "let the model's parameters be changed" (DESIGN.md section 34). The rail's Model section, closed until opened: a row
// for each parameter the engine offers (box.diskParams; its spec gives the default, the range and whether the slider is on a log
// scale), with its name, a slider, the value with its unit and, while it is changed, a chip back to the default; under each group
// the numbers that follow (the engine's derived: the edge of the thermally ionized disk, the snow line, what reaches the star, the
// wind's share). They go to the engine in one call (each parameter not chosen at its default), are kept with the settings on this
// device (settingsNow, under KEY), written into a link as one parameter, mp= (MP-LINK), and put back by Reset all. The
// development switches before round 14a, ?mdot=, ?lam=a,b, ?lamin= and ?chic=, are aliases of the parameters (a link's mp=
// wins); ?mflux=0 and ?lam=old stay switches. Not in the scenes (a scene is a view). Applied after a safe start too, as the
// colours: they change the picture's cost little. MODEL_UI shows the section.
// MP-LINK
// The parameters a link carries, each by a name of two letters: mp= holds the name and the value of each one not at its default,
// joined by '_' (a value with three significant figures at most, written the shortest way: 3e-7, 0.015, 1.2), e.g.
// mp=md3e-7_ls10; no mp= at all is every default. Read back, a pair whose name is not known, or whose value is not a number, is
// passed over (that parameter at its default); the engine holds each one within its range. (Round 17b: ts, the star's colour
// temperature, and li, lambda at the dust's inner edge, are no longer parameters since round 15b: a link's ts or li of before
// is passed over as a name not known, the picture at the engine's own values)
const MP_KEYS = { md: 'mdot', ls: 'lum', ai: 'alphaIn', ti: 'tTI', lt: 'lamTI', lo: 'lamOut', cc: 'chic', ga: 'alphaGap' };
const MP_NAME = Object.fromEntries(Object.entries(MP_KEYS).map(([n, k]) => [k, n]));
// a value as a link writes it: three significant figures at most
const mpNum = (v) => String(Number(Number(v).toPrecision(3)));
// the parameters chosen ({ key: value }): only the engine's keys and finite numbers, none at its default (def, by key)
function mpClean(par, def) {
  const out = {};
  for (const k of Object.values(MP_KEYS)) {
    const v = par && par[k] != null && par[k] !== '' ? Number(par[k]) : NaN;
    if (Number.isFinite(v) && !(def && v === def[k])) out[k] = v;
  }
  return out;
}
// the parameters chosen as a link's value ('' when every one is at its default)
const mpToLink = (par, def) => Object.entries(mpClean(par, def)).map(([k, v]) => MP_NAME[k] + mpNum(v)).join('_');
// a link's value back as the parameters chosen (only those not at the default)
function mpFromLink(v, def) {
  const out = {};
  for (const pair of typeof v === 'string' ? v.split('_') : []) {
    const k = MP_KEYS[pair.slice(0, 2)], x = pair.slice(2).trim() !== '' ? Number(pair.slice(2)) : NaN;   // (round 17b: a blank value is none, not 0)
    if (k && Number.isFinite(x)) out[k] = x;
  }
  return mpClean(out, def);
}
// /MP-LINK
// the development switches before round 14a, as the parameters they set (see SWITCH)
function mpAliases() {
  const o = {}, m = /^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\s*$/.exec(SWITCH.lam || '');
  if (SWITCH.mdot) o.mdot = Number(SWITCH.mdot);
  if (m) { o.lamTI = Number(m[1]); o.lamOut = Number(m[2]); }
  if (SWITCH.chic) o.chic = Number(SWITCH.chic);   // (?lamin= is the engine's switch since round 15b, data-lamin: not a parameter)
  return o;
}
// the parameters chosen (only those not at the default), and the engine's defaults, spec and the numbers that follow (null until
// the engine has started)
let params = {}, parDef = null, parSpec = null, parDerived = null;
// into the engine, in one call, and into the rail, the places' texts and the probe's panel; on release (fin) the guard measures
// the frames afresh
function applyParams(fin = true) {
  if (typeof box.diskParams !== 'function') return;
  const r = box.diskParams(params);
  parDef = r.def; parSpec = r.spec; parDerived = r.derived; params = mpClean(r.now, r.def);
  if (fin && calibrated) guardAfresh();
  renderParams();
  renderPlace();
  if (probeLast) probeRender();
}
// a parameter set by its slider (drag: while it is held: the picture at the moving scale, the engine told at most every
// MP_DRAG_MS, since it makes the temperature's table and the wind map again; in full on release) or by its chip
const MP_DRAG_MS = 150;
let mpLast = 0, mpTimer = 0;
function setParam(k, v, drag = false) {
  if (!parDef || !(k in parDef) || !Number.isFinite(v)) return;
  if (v === parDef[k]) delete params[k]; else params[k] = v;
  clearTimeout(mpTimer);
  if (drag) {
    moving();
    const wait = MP_DRAG_MS - (performance.now() - mpLast);
    if (wait > 0) { mpTimer = setTimeout(() => { mpLast = performance.now(); applyParams(false); }, wait); renderParams(); return; }
    mpLast = performance.now(); applyParams(false); return;
  }
  applyParams();
  keepSoon();
}
// a slider's position (0 to 1000) for a value, and the value for a position, on the spec's scale (the default's own position
// gives the default exactly; elsewhere three significant figures, as a link writes them)
const mpPos = (k, v) => { const sp = parSpec[k], u = sp.log ? Math.log(v / sp.min) / Math.log(sp.max / sp.min) : (v - sp.min) / (sp.max - sp.min); return Math.round(1000 * Math.min(1, Math.max(0, u))); };
const mpOf = (k, pos) => {
  const sp = parSpec[k], u = Number(pos) / 1000;
  if (Number(pos) === mpPos(k, parDef[k])) return parDef[k];
  return Number((sp.log ? sp.min * Math.pow(sp.max / sp.min, u) : sp.min + (sp.max - sp.min) * u).toPrecision(3));
};
// (round 15a, the owner: a slider's bar changed its length while it was dragged, as the value beside it changed its width) a value's
// cell as wide as the widest text of its slider, in ch: a character 1, the narrow ones 0.6 (the spaces, the point, the slash, the
// superscripts), a CJK one 1.8, and 1 more; for the language now. The bar beside it then keeps its length (DESIGN.md section 36)
const chW = (t) => [...t].reduce((s, c) => s + (/[\u3000-\u9fff]/.test(c) ? 1.8 : /[\s.,/⁰¹²³⁴⁵⁶⁷⁸⁹⁻]/.test(c) ? 0.6 : 1), 1);
const valW = (texts) => Math.ceil(2 * Math.max(...texts.map(chW))) / 2 + 'ch';
const mpWMemo = {};
const mpValW = (k) => { const id = L() + k + ':' + parSpec[k].min + ':' + parSpec[k].max; return mpWMemo[id] || (mpWMemo[id] = valW([...Array(101).keys()].map((i) => mpText(k, mpOf(k, 10 * i))).concat(mpText(k, parDef[k])))); };
// a value as the rail writes it, with its unit
const MP_SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const mpSci = (v) => { const e = Math.floor(Math.log10(v) + 1e-9), m = v / Math.pow(10, e); return (Math.abs(m - 1) < 5e-3 ? '' : m.toFixed(1) + ' × ') + '10' + String(e).replace(/./g, (c) => MP_SUP[c]); };
function mpText(k, v) {
  const t = k === 'mdot' || k === 'alphaIn' || k === 'alphaGap' ? mpSci(v) : k === 'tTI' ? String(Math.round(v)) : mpNum(v);
  return t + ({ mdot: L() === 'ja' ? ' M☉/年' : ' M☉/yr', lum: ' L☉', tTI: ' K' }[k] || '');
}
// the rail's rows by group (the engine's keys)
// (round 15a, the owner: no row for T* nor for lambda at the dust's inner edge, so that lambda has two sliders, at R_TI and at
// 30 au; round 15b took both out of the engine's parameters, and round 17b out of the page's link, MP_KEYS)
const MP_GROUPS = [['star', ['lum']], ['heat', ['mdot', 'alphaIn', 'tTI']], ['wind', ['lamTI', 'lamOut', 'chic']], ['planets', ['alphaGap']]];
// the numbers under a group, from the engine's derived
function mpDerivedText(g) {
  const d = parDerived, w = T().model, au = (v) => (v >= 10 ? String(Math.round(v)) : v >= 1 ? v.toFixed(2) : v.toPrecision(2));
  if (!d) return '';
  if (g === 'heat') return w.heat({ rTI: au(d.rTI), snow: au(d.snow), burst: au(d.snowBurst), t1: String(Math.round(d.tMid1)) });
  if (g === 'wind') return d.mdotStar == null ? w.windOff : (SWITCH.lam === 'old' ? w.lamOld + ' ' : '') + w.wind({ star: mpSci(d.mdotStar), fStar: String(Math.round(100 * d.fStar)), share: String(Math.round(100 * d.windShare)) });
  if (g === 'planets') return w.planets;
  return '';
}
let mpEls = null;
// the section's rows, made once the engine has said its parameters
function buildParams() {
  const body = $('modelBody');
  if (!body || !parSpec) return;
  $('modelSection').hidden = !MODEL_UI;
  mpEls = { rows: {}, groups: {}, note: el('p', { class: 'rail-note' }) };
  body.replaceChildren(mpEls.note, ...MP_GROUPS.map(([g, keys]) => {
    const head = el('h4', { class: 'talk-sub' }), der = el('p', { class: 'rail-note mp-derived' });
    mpEls.groups[g] = { head, der };
    return el('div', { class: 'mp-group' }, head, ...keys.filter((k) => parSpec[k]).map((k) => {
      const r = { name: el('label', { class: 'mp-name', for: 'mp-' + k }), input: el('input', { type: 'range', id: 'mp-' + k, min: '0', max: '1000', step: '1', 'data-mp': k }),
        val: el('span', { class: 'mp-val' }), chip: el('button', { type: 'button', class: 'chip quiet', 'data-mp-reset': k, hidden: true }) };
      mpEls.rows[k] = r;
      return el('div', { class: 'mp-row' }, r.name, r.input, r.val, r.chip);
    }), der);
  }));
  renderParams();
}
// the rows as the parameters are (a slider being dragged keeps its own place), in the language now
function renderParams() {
  if (!mpEls || !parSpec) return;
  const w = T().model;
  mpEls.note.textContent = w.note;
  for (const [g] of MP_GROUPS) { const G = mpEls.groups[g]; G.head.textContent = w.groups[g]; G.der.textContent = mpDerivedText(g); G.der.hidden = !G.der.textContent; }
  for (const k in mpEls.rows) {
    const r = mpEls.rows[k], v = k in params ? params[k] : parDef[k], pos = String(mpPos(k, v)), t = mpText(k, v);
    r.name.textContent = w.names[k];
    if (document.activeElement !== r.input && r.input.value !== pos) r.input.value = pos;
    r.input.setAttribute('aria-valuetext', t);
    r.val.textContent = t; r.val.style.minWidth = mpValW(k);
    r.chip.hidden = !(k in params);
    r.chip.textContent = w.def; r.chip.setAttribute('aria-label', w.reset(w.names[k]));
  }
}
// the parameters kept with the settings on this device (none: the defaults)
const keptParams = () => (saved && typeof saved.mp === 'string' && parDef ? mpFromLink(saved.mp, parDef) : {});
// (round 14a) The wind's brightness in the model look, as the viewer chooses it under the wind's settings (the engine's
// box.diskWindGain: a factor on the wind's glow, WB_RANGE, 1 by default): a display choice, the owner tuning the wind's look.
// Kept with the settings on this device, in a link as wb= (none: 1), put back by Reset all; not in the scenes.
const WB_RANGE = [0.3, 10];
let windGain = 1;
const wbPos = (k) => String(Math.round(1000 * Math.log(k / WB_RANGE[0]) / Math.log(WB_RANGE[1] / WB_RANGE[0])));
const wbOf = (pos) => (String(pos) === wbPos(1) ? 1 : Number((WB_RANGE[0] * Math.pow(WB_RANGE[1] / WB_RANGE[0], Number(pos) / 1000)).toPrecision(2)));
const wbFrom = (v) => { const x = v != null && String(v).trim() !== '' ? Number(v) : NaN; return Number.isFinite(x) ? Math.min(WB_RANGE[1], Math.max(WB_RANGE[0], x)) : 1; };   // (round 17b: a blank one is none)
const keptWind = () => (saved && saved.wb ? wbFrom(saved.wb) : 1);
function applyWind(drag = false) {
  if (typeof box.diskWindGain === 'function') windGain = box.diskWindGain(windGain);
  if (drag) moving();
  renderWind();
}
function renderWind() {
  if (!wbEls.row) return;
  const wbText = (k) => '× ' + (k >= 1 ? k.toFixed(1) : k.toFixed(2)), w = T().show, t = wbText(windGain);
  if (document.activeElement !== wbEls.input && wbEls.input.value !== wbPos(windGain)) wbEls.input.value = wbPos(windGain);
  wbEls.name.textContent = w.windGain;
  wbEls.input.setAttribute('aria-label', w.windGainOf); wbEls.input.setAttribute('aria-valuetext', t);
  wbEls.val.textContent = t; wbEls.val.style.minWidth = valW([...Array(101).keys()].map((i) => wbText(wbOf(10 * i))));   // (round 15a)
  wbEls.chip.hidden = windGain === 1; wbEls.chip.textContent = w.gainDefault; wbEls.chip.setAttribute('aria-label', w.windGainReset);
}
// (round 18a, the owner: "the objects' transparency too") The see-through of the gas, the pebbles, the wind and the envelope, a row
// under each one's settings (round 18d: in each one's palette): the engine's state op, four factors on what each takes out of the
// ray (its extinction, in every look where it absorbs; its own light is left as it is), from 1 (the default, as before) to OP_MIN.
// The slider reads the share taken away, 0 to 95 %, in steps of 1 %: a factor f = 1 - p / 100. Kept with the settings on this
// device (DEF_KEYS), in a link as op= (the four factors, none when all are 1), put back by Reset all and by each row's chip; not in
// the scenes (as the colours and the wind's brightness are not). The picture's mean changes with it: the automatic exposure follows.
// (Round 18d, the owner: "a see-through for the jet, a see-through bar for the field lines") Six factors: [4] the jet's, on its light
// (it only shines, nothing of it takes light out of the ray), [5] the field lines', on their lines' opacity. A list of four (the
// links and the settings of dev.23 to dev.25) is read with those two at 1, as the engine reads it; op= has the six.
const opPos = (f) => String(Math.round(100 * (1 - f)));
const opOf = (pos) => Math.min(1, Math.max(OP_MIN, Number((1 - Number(pos) / 100).toFixed(2))));
const opList = (s) => (Array.isArray(s.op) && (s.op.length === 6 || s.op.length === 4) ? [...s.op, 1, 1].slice(0, 6) : [1, 1, 1, 1, 1, 1]);
function setOpac(i, f, drag = false) {
  const op = opList(S()).slice(); op[i] = f;
  if (drag) moving();
  box.diskSet({ op });
  renderOpac(S());
}
function renderOpac(s) {
  if (!opEls.length) return;
  const w = T().show, op = opList(s), text = (f) => w.opacVal(Math.round(100 * (1 - f)));
  for (const c of COMPS) {
    const e = opEls[c.op]; if (c.op == null || !e) continue;
    const f = op[c.op], t = text(f);
    if (document.activeElement !== e.input && e.input.value !== opPos(f)) e.input.value = opPos(f);
    // (round 18b: no name on the row, the value and the chip once changed. Round 18d: in the palette its name and its value again,
    // the chip once changed; the slider's name with what it does, and its value, for the screen reader)
    e.name.textContent = w.opac;
    e.input.setAttribute('aria-label', w.opacOf(w[c.key], c.key)); e.input.setAttribute('aria-valuetext', t);   // (round 18d: what it does, by the component)
    e.val.textContent = t; e.val.style.minWidth = valW([text(1), text(OP_MIN)]);   // (round 15a: the widest text, the bar's length kept)
    e.chip.hidden = f === 1; e.chip.textContent = w.gainDefault; e.chip.setAttribute('aria-label', w.opacReset(w[c.key]));
  }
}
// (round 18a, the owner: "turn the camera about the line of sight") The roll, in the rail's View: the state's roll (degrees, -180 to
// 180, counterclockwise), the slider setting it at once, its chip back to 0 (a flight); a place's view and the first view are
// unrolled (places.js; round 18e: no gesture rolls, Alt-drag did). Kept with the view (VIEW_KEYS), in a link as roll= (none at 0), in
// the scenes with their view.
function renderRoll(s) {
  const w = T().view, v = Math.round(Number(s.roll) || 0), input = $('rollRange');
  if (document.activeElement !== input && input.value !== String(v)) input.value = String(v);
  $('rollName').textContent = w.roll;
  input.setAttribute('aria-label', w.rollOf); input.setAttribute('aria-valuetext', w.rollVal(v));
  $('rollVal').textContent = w.rollVal(v); $('rollVal').style.minWidth = valW([w.rollVal(-180), w.rollVal(-88)]);   // (round 15a)
  const chip = $('rollReset'); chip.hidden = !(Number(s.roll) || 0); chip.textContent = T().show.gainDefault; chip.setAttribute('aria-label', w.rollReset);
}
// (round 18e, the owner: "the mouse's drag is hard to follow: let a drag turn the disk only, and move the camera from the control
// panel") The point looked at, in the rail's View under the roll. Its four arrows step it along the picture as it is drawn by a tenth
// of the picture's height (the engine's diskNudge, as Shift+arrows: it goes the arrow's way, the picture the other): a step at the
// press, and while the press is held a step every AIM_EVERY ms after AIM_WAIT, until the pointer is lifted, leaves the arrow or is
// cancelled (the page hidden, the window left). A click that no press of that arrow made just before (the keyboard's Enter or Space,
// a screen reader) is a step of its own. Its chip brings the point back to the star, or to the planet followed (the engine's
// diskCenter, as the C key), hidden while it is there. The point is the state's tx, ty, tz, kept as before: with the view
// (VIEW_KEYS), in a link (tx=), in the scenes; a flight, Home and the places set it.
const AIM_WAIT = 400, AIM_EVERY = 120, AIM_CLICK = 1000;
let aimHeld = null, aimDown = null, aimUp = null;   // (the arrow held and its timer; the arrow pressed; the one a press was last lifted from, and when)
const aimStep = (b) => { const [x, y] = b.dataset.aim.split(',').map(Number); if (live() && typeof box.diskNudge === 'function') box.diskNudge(x, y); };
const aimStop = () => { if (aimHeld) { clearTimeout(aimHeld.t); aimHeld = null; } };
function aimClick(b) {
  const own = aimUp && aimUp.b === b && performance.now() - aimUp.at < AIM_CLICK;
  aimUp = null;
  if (!own) aimStep(b);
}
rail.querySelectorAll('[data-aim]').forEach((b) => {
  b.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !live()) return;
    aimStop(); aimDown = b; aimUp = null; aimStep(b);
    const on = () => { if (!live()) { aimStop(); return; } aimStep(b); aimHeld.t = setTimeout(on, AIM_EVERY); };
    aimHeld = { b, t: setTimeout(on, AIM_WAIT) };
  });
  b.addEventListener('pointerup', () => { if (aimDown === b) aimUp = { b, at: performance.now() }; aimDown = null; aimStop(); });
  b.addEventListener('pointerleave', aimStop); b.addEventListener('pointercancel', () => { aimDown = null; aimStop(); });
  b.addEventListener('contextmenu', (e) => e.preventDefault());   // (a long press on a phone)
});
addEventListener('pointerup', () => { aimDown = null; });   // (a press lifted off its arrow: no click of it follows)
addEventListener('blur', aimStop);
document.addEventListener('visibilitychange', aimStop);
function renderAim(s) {
  const w = T().view, chip = $('recentre');
  const names = { '-1,0': w.aimLeft, '0,1': w.aimUp, '0,-1': w.aimDown, '1,0': w.aimRight };
  $('aimName').textContent = w.aim;
  rail.querySelectorAll('[data-aim]').forEach((b) => { b.setAttribute('aria-label', names[b.dataset.aim]); b.title = names[b.dataset.aim]; });
  chip.hidden = !(Number(s.tx) || Number(s.ty) || Number(s.tz));
  chip.textContent = s.p ? w.aimPlanet : w.aimStar; chip.setAttribute('aria-label', s.p ? w.aimPlanetOf : w.aimStarOf);
}
// (round 18a, the owner: "more background stars") The number of the background's stars, in the rail's Background: the state's
// stars, times the default's (ST_RANGE, the engine's STARS), on a log slider (0 to 1000; the default exactly at its place); the
// stars' brightness keeps its law. Kept with the settings (DEF_KEYS), in a link as stars= (none at 1), Reset and its chip put
// back 1; not in the scenes. With the background off it is kept and does nothing.
const ST_RANGE = [0.3, 5];
const stPos = (k) => String(Math.round(1000 * Math.log(k / ST_RANGE[0]) / Math.log(ST_RANGE[1] / ST_RANGE[0])));
const stOf = (pos) => (String(pos) === stPos(1) ? 1 : Number((ST_RANGE[0] * Math.pow(ST_RANGE[1] / ST_RANGE[0], Number(pos) / 1000)).toPrecision(2)));
function renderStars(s) {
  const w = T().view, k = Number(s.stars) > 0 ? Number(s.stars) : 1, text = (x) => w.starsVal(x >= 1 ? x.toFixed(1) : x.toFixed(2)), input = $('starsRange');
  if (document.activeElement !== input && input.value !== stPos(k)) input.value = stPos(k);
  $('starsName').textContent = w.stars;
  input.setAttribute('aria-label', w.starsOf); input.setAttribute('aria-valuetext', text(k));
  $('starsVal').textContent = text(k); $('starsVal').style.minWidth = valW([text(0.3), text(5), text(0.55)]);   // (round 15a)
  const chip = $('starsReset'); chip.hidden = k === 1; chip.textContent = T().show.gainDefault; chip.setAttribute('aria-label', w.starsReset);
}

// what a click on the disk does (the engine's data-pick): 'planet', place a planet (the engine sends diskpick); 'pebbles'
// (round 8, the owner: "no pebbles on a tap by default; a mode of the pebbles"), drop a clump of pebbles there, three near one
// radius growing a planet; neither, nothing (a click on the star or a planet still does its own). One at a time: either
// button ends the other's mode. (Round 12a: 'probe', the probe, see probeAt; leaving it removes the probe's panel)
function setPick(kind) {
  if (kind) box.dataset.pick = kind; else delete box.dataset.pick;
  lab.classList.toggle('picking', !!kind);
  note(kind === 'planet' ? T().show.picking : kind === 'pebbles' ? T().show.dropping : kind === 'probe' ? T().probe.on : '', 0);
  if (kind !== 'probe') probeClose();
  pressed($('probeBtn'), kind === 'probe');
  sync();
}
box.addEventListener('diskpick', (e) => {
  if (box.dataset.pick === 'probe') { probeAt(e.detail); return; }
  const w = T().show, pl = S().planets, a = roundA(Math.min(PL_A[1], Math.max(PL_A[0], e.detail.R)));
  if (!roomFor(pl, a, -1)) { note(w.noRoom, 3500); return; }
  const i = pl.findIndex((p) => !p[1]);
  if (i >= 0) pl[i] = [a, 1, 1]; else if (pl.length < 4) pl.push([a, 1, 1]); else { note(w.full, 3500); return; }
  box.diskSet({ planets: pl, mode: S().mode | 16 });
  setPick(false);
  note(w.placed(fmtA(a)), 3000);
});
// (round 18d: Esc with a component's palette open closes it alone, the focus back on its swatch)
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (palOpen) { palClose(true); return; } if (box.dataset.pick) setPick(false); popClose(); } });

// (round 12a) The probe ("touch a point of the disk and the physics answers", the roadmap's second pillar). With
// data-pick="probe" a tap on the disk in the picture sends the engine's diskpick (the midplane point under it, as placing a
// planet does) and a panel beside that point gives what the model has there, from the engine's box.diskProbe(R, 0) (its JS
// mirrors of the shaders' formulas: DESIGN.md, section 29): the temperature, the gas's density and surface density, the
// scale height, the Keplerian speed and period, the turbulence's alpha, the region and one sentence on what the physics
// does there, the water's state about the snow line, and a planet's gap or pressure maximum at that radius. A second tap
// moves it; Esc, the button again or another pick mode removes it. In the picture only a ring at the point, which fades
// (the page's: the engine draws nothing for the probe, and the point would not stay under a view that moves). On a narrow
// stage the panel sits along its bottom edge. Its type is large enough to read from across a room (the presenter).
let probeLast = null;   // the last probe's { R, x, y } (round 15a: or a planet's, or a ray's that missed): said again in the other language
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const sci = (v) => { const e = Math.floor(Math.log10(v)), m = v / Math.pow(10, e); return (m.toFixed(1) === '10.0' ? '1.0 × 10' + String(e + 1).replace(/./g, (c) => SUP[c]) : m.toFixed(1) + ' × 10' + String(e).replace(/./g, (c) => SUP[c])); };
const sig3 = (v) => (v >= 100 ? String(Math.round(v)) : v >= 10 ? v.toFixed(1) : v.toPrecision(2));
function probeAt(d) {
  // (round 13e: and the azimuth, for a planet's own disk; round 15a: planet, a tap on a planet's point, its index; miss and z, a ray
  // that missed the disk, at its point closest to the star)
  probeLast = { R: d.R, z: d.z || 0, phi: d.phi, miss: !!d.miss, planet: d.planet, x: d.x, y: d.y };
  probeRender();
  // the ring at the point
  const m = el('div', { class: 'probe-mark', 'aria-hidden': 'true' });
  m.style.left = d.x + 'px'; m.style.top = d.y + 'px';
  stage.querySelectorAll('.probe-mark').forEach((o) => o.remove());
  stage.append(m);
  setTimeout(() => m.remove(), reduce ? 1200 : 2600);
}
// (round 15a) a share in per cent: two figures below 1 %, one decimal between 99 and 100 %
const pct = (v) => { const x = 100 * v; return x < 1 ? x.toPrecision(2) : x > 99 && x < 100 ? x.toFixed(1) : String(Math.round(x)); };
function probeRender() {
  const panel = $('probePanel');
  if (!probeLast || !live() || typeof box.diskProbe !== 'function') { panel.hidden = true; return; }
  const w = T().probe, q = probeLast, s = S();
  // (round 14a: the numbers the region's sentence and the note quote, from the model's parameters: the thermal ionization's
  // temperature, the alphas (the outer disk's in its ratio to the inner's), the disk drawn thicker than its temperature holds up)
  const mp = typeof box.diskParams === 'function' ? box.diskParams() : null, a0 = mp ? mp.now.alphaIn : 0.01;
  const nums = { tTI: String(Math.round(mp ? mp.now.tTI : 1000)), aIn: String(Number(a0.toPrecision(1))), aOut: String(Number((mp && mp.derived.alphaOut != null ? mp.derived.alphaOut : 0.09 * a0).toPrecision(1))), hf: (mp ? mp.derived.hFactor : 1.71).toFixed(1) };
  const said = (v) => (typeof v === 'function' ? v(nums) : v);
  const row = (k, v, title) => el('div', { class: 'probe-row', ...(title ? { title } : {}) }, el('span', { class: 'probe-k' }, k), el('span', { class: 'probe-v' }, v));
  const line = (t) => el('p', { class: 'probe-line' }, t);
  let head, rows, phys = '';
  if (q.planet != null) {
    // (round 15a) a tap on a planet's point: the planet, its gap as the engine has it (Kanagawa et al.: diskProbe's planets) and its
    // own disk (cpdPhys: diskCpdState)
    const pl = s.planets[q.planet];
    if (!pl) { probeClose(); return; }
    const [a, , m] = pl, g = (box.diskProbe(a, 0).planets || []).find((o) => o.a === a), c = typeof box.diskCpdState === 'function' ? box.diskCpdState(q.planet) : null, [n, , sub] = fmtM(m);
    head = w.planetTitle(fmtA(a));
    rows = [row(w.mass, n + ' M' + (sub === 'J' ? '_J' : sub)), row(w.P, sig3(Math.pow(a, 1.5)) + ' ' + w.yr)];
    if (c) rows.push(row(w.hill, sig3(c.rH) + ' au'), row(w.qth, sig3(c.qth)));
    rows.push(line(g ? w.gapOf({ depth: pct(g.depth), w: sig3(g.width), K: sig3(g.K), alpha: sci(g.alpha) }) + (g.trap ? ' ' + w.bump(fmtA(g.trap)) : '') : w.noGap));
    if (c) rows.push(line(w.cpdOf({ kind: c.D >= 0.5 ? 'disk' : 'envelope', rOut: sig3(c.rOut), rOutH: (c.rOut / c.rH).toFixed(2), T: sig3(c.at(0.5 * c.rOut).T), mdot: sci(c.mdot) + ' M_J/' + w.yr, auto: c.auto })));
  } else {
    const p = box.diskProbe(q.R, q.z, q.phi), r = fmtA(q.R), rr = Math.hypot(q.R, q.z), vK1 = p.vK * Math.sqrt(p.R);
    head = q.miss ? w.aboveTitle({ below: q.z < 0, r: sig3(rr), R: fmtA(q.R), z: sig3(Math.abs(q.z)) }) : w.title(r);
    const reg = row(w.region, w.regions[p.region] || p.region, p.rule);
    // (inside the magnetosphere, the cavity, there is no disk gas: only the orbit's numbers; a density of 0 is said so too)
    const gas = p.region !== 'cavity', num = (v, f) => (gas && v > 0 ? f(v) : w.none);
    const diskRows = () => [
      row(w.T, num(p.T, (v) => sig3(v) + ' K')),
      row(w.rho, num(p.rho, (v) => sci(v) + ' g/cm³')),
      row(w.sigma, num(p.sigma, (v) => sig3(v) + ' g/cm²')),
      row(w.H, num(p.H, (v) => sig3(v) + ' au (H/R ' + (v / p.R).toFixed(3) + ')')),
      row(w.vK, p.vK.toFixed(1) + ' km/s'),
      row(w.P, p.P < 0.1 ? (p.P * 365.25).toFixed(1) + ' ' + w.days : sig3(p.P) + ' ' + w.yr),
      row(w.alpha, !gas ? w.none : p.alpha < 1e-6 ? w.laminar : sci(p.alpha)),
      reg,
      row(w.water, (p.vapour ? (p.snow.inside ? w.snowIn : w.snowOutWarm) : w.snowOut)(fmtA(p.snow.R)))
    ];
    // (round 15a) inside the magnetosphere: r_T, the curtains' lines, the free fall from r_T, sqrt(2 G M (1/r - 1/r_T)) with G M from
    // the Keplerian speed, here and at the star's surface, and the corotation radius (Kepler's third law for the star's period)
    const M = p.mag, ff = (x) => vK1 * Math.sqrt(Math.max(0, 2 * (1 / x - 1 / M.rT)));
    const magRows = () => [reg, row(w.rT, sig3(M.rT) + ' au'), row(w.curtains, w.curtainsV(sig3(M.rT), sig3(M.rT * (1 + M.dl)))),
      row(w.vff, w.vffV(String(Math.round(ff(Math.max(rr, M.rS)))), String(Math.round(ff(M.rS))))), row(w.rCo, w.rCoV(sig3(Math.pow(M.pDays / 365.25, 2 / 3)), String(M.pDays)))];
    // (round 15a) the wind from the engine's mirror of its map (windProbe); the jet's speed; the envelope's fall on a parabolic
    // orbit, |v| = (2 G M / r)^1/2. Neither the jet nor the envelope has a density in physical units in the model: said so
    const Wd = p.wind, lamB = Wd && Math.abs(Wd.lamBud - Wd.lam) > 0.005 ? Wd.lamBud.toFixed(2) : '';
    const windRows = () => [reg, row(w.windRho, sci(Wd.rho) + ' g/cm³'), row(w.windV, sig3(Wd.vp) + ' km/s'), row(w.windRot, sig3(Wd.vphi) + ' km/s'),
      row(w.windFoot, w.windFootV(fmtA(Wd.foot), Wd.lam.toFixed(2), lamB)), row(w.windTerm, sig3(Wd.vInf) + ' km/s')];
    const envRows = () => [reg, row(w.envV, sig3(vK1 * Math.sqrt(2 / rr)) + ' km/s'), row(w.rho, w.noScale),
      ...(Math.atan2(q.R, Math.abs(q.z)) < p.env.thCav ? [line(w.inCavity)] : []), ...(rr > p.env.R ? [line(w.beyondEnv)] : [])];
    rows = p.region === 'cavity' && M ? magRows() : p.region === 'wind' && Wd ? windRows() : p.region === 'jet' ? [reg, row(w.jetV, String(Math.round(p.jetV)) + ' km/s'), row(w.rho, w.noScale)]
      : p.region === 'envelope' && p.env ? envRows() : diskRows();
    if ((p.region === 'wind' && !(s.mode & 8)) || (p.region === 'envelope' && !(s.mode & 32))) rows.push(line(w.hidden));
    if (!q.miss) for (const pl of p.planets) {
      const pc = 100 * pl.gap;
      if (pl.gap < 0.5) rows.push(line(w.gap({ a: fmtA(pl.a), f: pc < 1 ? pc.toPrecision(2) : String(Math.round(pc)), depth: pct(pl.depth), w: sig3(pl.width), bump: pl.trap ? fmtA(pl.trap) : '' })));
      if (pl.atTrap) rows.push(line(w.trap(fmtA(pl.a))));
    }
    // (round 13e) inside a planet's own disk or envelope (diskProbe with the point's azimuth): its numbers at the point
    if (p.cpd) {
      const c = p.cpd, [n, , sub] = fmtM(c.m);
      rows.push(line(w.cpd({ a: fmtA(c.a), m: n + ' M' + (sub === 'J' ? '_J' : sub), r: sig3(c.r) + ' au', rH: c.rH.toFixed(2), rOut: c.rOutH.toFixed(2),
        T: sig3(c.T), Hr: c.Hr.toFixed(2), mdot: sci(c.mdot) + ' M_J/' + w.yr, kind: c.kind })));
    }
    phys = said(w.physics[p.region]) || '';
  }
  panel.replaceChildren(
    el('div', { class: 'probe-head' }, el('span', { class: 'probe-title' }, head), el('button', { type: 'button', class: 'icon-x', 'aria-label': w.close, title: w.close, onclick: () => setPick(false) }, '×')),
    ...rows,
    el('p', { class: 'probe-physics' }, phys),
    el('p', { class: 'probe-note' }, said(w.model)));
  panel.hidden = false;
  // beside the point, inside the stage; along the bottom edge of a narrow stage
  const sw = stage.clientWidth, sh = stage.clientHeight, docked = sw < 560;
  panel.classList.toggle('docked', docked);
  if (docked) { panel.style.left = panel.style.top = ''; return; }
  const pw = panel.offsetWidth, ph = panel.offsetHeight;
  const x = probeLast.x + 24 + pw < sw - 8 ? probeLast.x + 24 : Math.max(8, probeLast.x - 24 - pw);
  panel.style.left = x + 'px'; panel.style.top = Math.min(sh - ph - 8, Math.max(8, probeLast.y - ph / 2)) + 'px';
}
function probeClose() { probeLast = null; const panel = $('probePanel'); if (panel) panel.hidden = true; }
$('probeBtn').addEventListener('click', () => { if (live()) setPick(box.dataset.pick === 'probe' ? false : 'probe'); });
// (said again in the language chosen: after setLang, whose listener comes later)
document.querySelectorAll('.lang-switch [data-lang]').forEach((b) => b.addEventListener('click', () => setTimeout(probeRender, 0)));

// a click on a planet in the picture: its orbit's slider, beside it
const pop = $('planetPop');
let popI = -1;
box.addEventListener('diskplanet', (e) => {
  // (round 15a) with the probe on, a tap on a planet's point probes the planet: its mass, orbit, gap and own disk (see probeRender)
  if (box.dataset.pick === 'probe') { probeAt({ planet: e.detail.i, x: e.detail.x, y: e.detail.y }); return; }
  popI = e.detail.i;
  const w = T().show, [a, , m] = S().planets[popI];
  const input = el('input', { type: 'range', min: '0', max: '1000', step: '1', value: sliderOfA(a), 'aria-label': w.orbit(popI + 1),
    oninput: (ev) => movePlanet(popI, aOf(ev.target.value), true), onchange: (ev) => movePlanet(popI, aOf(ev.target.value)) });
  // (round 8: and its mass)
  const inputM = el('input', { type: 'range', min: '0', max: '1000', step: '1', value: sliderOfM(m || 1), 'aria-label': w.massOf(popI + 1),
    oninput: (ev) => massPlanet(popI, mOf(ev.target.value), true), onchange: (ev) => massPlanet(popI, mOf(ev.target.value)) });
  pop.replaceChildren(el('span', { class: 'pop-name' }, w.planetRow(popI + 1, fmtA(a))), input,
    el('button', { type: 'button', class: 'icon-x', 'aria-label': T().log.close, title: T().log.close, onclick: popClose }, '×'),   // (round 17b: in the page's language, as the safe start's ×)
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
// note says so. In the CO look a fixed level starts from CO_FLOOR, as Auto does. (Round 10a, dev.5: a fixed level is not
// lowered for slow frames; dev.6: nor capped in the CO look, see sync)
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
// (round 10a, dev.5: Auto at rest is the ramp's (stillStep), not the frame rate's: the governor rests; its scale at the start,
// runScale, is what the lighter picture while moving is taken from)
const govRest = () => { if (gov) gov.pause(!(quality === 'auto' && moveFrom && !holdSharp)); };
// (the default Best's quiet step applies while the clock runs; a paused picture is drawn at the level itself)
// (round 9: and within the guard, allowed: running frames under GUARD_MS, a still picture's within STILL_MS in bands)
// (round 10a, dev.5, the owner after dev.4 on the iPhone: "at Best, no automatic change of the resolution". A fixed level is
// fixed: the default Best's quiet step (bestCap) is no more, and the guard does not lower it while the clock runs: in the
// looks drawn in kicks or in bands each piece of GPU work is within the budget whatever the scale, and the GPU rests between
// them on a phone (the duty). What is left: the lighter picture while the view moves (the owner's own, see moving), the
// level's scale reached a rung a picture once the view rests (the ramp, see stillStep), the safe start after a bad end
// (Auto, with its "restore"), and the gas line's look, whose passes are not in kicks: the guard's cap there, as before)
const fixedScale = () => Math.min(QUALITY[quality] || 1, qCap, live() ? allowed() : 1);
// the scale a fixed level asks for now, set when it changed (the clock paused or running again; not while the view moves,
// a still picture is sharpened, a measurement holds the governor or a picture is being saved)
let fixedPaused = null, skipFrames = 0;
function applyFixed() {
  if (quality === 'auto' || !live() || moveFrom || holdSharp || sharpFrom || saving || !calibrated || 'lost' in lab.dataset) return;
  const p = !!S().paused;
  // (round 10a, dev.5: the ramp goes on whether the clock runs or not: a pause, the idle rest's among them, keeps the picture)
  if (p !== fixedPaused) { fixedPaused = p; relaxGuard(); syncQuality(); }
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
    else { qCap = 1; scaleTo(fixedScale()); }   // (round 10a, dev.6: the gas line's too, its passes in kicks or in bands: its level, not CO_FLOOR)
  }
  govRest();
  sync();
}
function syncQuality() {
  qualityButtons.forEach((b) => pressed(b, b.dataset.quality === quality));
  const w = T().quality, n = $('qualityNote');
  if (quality === 'auto') n.textContent = w.autoNote;
  else if (bestDefault()) n.textContent = w.bestNote;
  else n.textContent = w.fixedNote(Math.round(100 * (QUALITY[quality] || 1)));
}
// the frames' intervals at a fixed level (consecutive frames: the clock running or a picture being averaged)
// the guard's cap back to the level's own
function relaxGuard() { if (qCap < 1) { qCap = 1; costs.length = 0; } }   // (round 10a, dev.6: the level's, in every look)
const costs = [], bestRuns = [];
let bestT = 0, bestChanged = 0, bestUpAt = -1e9, bestHold = BEST_HOLD;
const bestDefault = () => quality === 'full' && !qChosen;
// (a new place, a new level: Best from 100 % with the shortest hold)
function bestReset() { bestCap = 1; bestRuns.length = 0; bestHold = BEST_HOLD; bestUpAt = -1e9; bestChanged = 0; }
// the default Best's quiet steps (see BEST_SLOW): from the frames of the running clock at a resting view, over 1.5 s
function guardBest(dt) {
  // (round 10a, dev.5: Best is fixed, see fixedScale: no quiet steps)
  bestRuns.length = 0; if (dt >= 0) return;
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
  // (round 10a, dev.5: a fixed level is not lowered for a slow frame, see fixedScale; dev.6: in the gas line's look neither, its
  // passes in kicks (the cheaper tier) or in bands of whole rays within a desktop's budget)
  costs.length = 0; if (dt >= 0) return;
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
// (round 10a, dev.5: hands off, the view at rest, the clock running or not: the picture refined a rung a picture up to its level
// (stillStep). The gas line's look as before (paused only) until its passes are in kicks)
const stillNow = () => live() && !moveFrom;   // (round 10a, dev.6: the gas line's look as the others)
const capRun = () => gc.cap;
// (the ramp's first rung: a paused picture's, where a still started (STILL_MS a frame); with the clock running, the rung at or
// under the scale drawn now and the guard's cap for running frames (the lighter picture of a move just ended; after a switch of
// look, the cap the switch set), a rung a picture from there)
const rungUnder = (sc) => LADDER.reduce((m, l) => (l <= sc + 0.004 ? l : m), LADDER[0]);
function capStill() { if (!gc.still) gc.still = S().paused || reduce ? Math.max(gc.cap, stepFor(STILL_MS)) : rungUnder(Math.min(live() ? box.diskScale() : 1, gc.cap)); return gc.still; }
// (round 10a, A4: the owner, trying dev.3 on the iPhone: 「静止時はもっとがんばっていいかも」) A still picture is refined step by
// step up to its level's scale (Best: 1, the full canvas; Auto: 1): it starts where it did (capStill: STILL_MS a frame), and
// once PROG_N frames are averaged at a step, the next step of LADDER. No total time: each frame's pieces stay within the
// budget whatever the scale (the engine's bands; in the visible and mid-infrared looks its kicks, a piece of which is bounded
// whatever the ray), the GPU resting between them on a phone (its duty); the first touch, wheel or key leaves the frame and
// brings the running scale back (the engine's leaveStill, and the page's lighter picture while the view moves). Not in the
// gas line's look: its passes' slowest rays are not cut into kicks yet (STILL_MS, as before)
// (round 10a, optimizing the time to the full scale: a step once one frame of it is done (PROG_N; 4 made the steps between
// cost four frames each, and on a phone's frame as WebKit on a GPU six times slower the still had not reached scale 1 after 4
// minutes), and two steps of LADDER at a time (PROG_SKIP: each about 1.56 times the last, 2.4 times the pixels), the last to
// the level's scale: the frames on the way cost some 0.9 of the last one's, where every step at four frames cost some 10)
// (round 10a, dev.5, the owner: "refine step by step without stopping the clock, each picture may take longer") With the clock
// running, a rung a picture (PROG_SKIP is a paused picture's), up to the level's scale; Auto up to the rung whose pictures come
// within HANDSOFF_MS (?handsoff=ms), a rung down where they take over 1.5 times that: its pictures while the view moves are
// still those of the frame rate (the lighter picture), at rest each may take a quarter of a second
const PROG_N = 1, PROG_SKIP = 2, HANDSOFF_MS = Number(q.get('handsoff')) > 0 ? Number(q.get('handsoff')) : 250;
const stillTop = () => (quality === 'auto' ? 1 : QUALITY[quality] || 1);
let picMs = 0;   // (Auto at rest: the time between its pictures lately, ms)
function stillStep(acc, accMax) {
  if (!stillNow() || !calibrated || saving || holdSharp || 'lost' in lab.dataset || !gc.still) return false;
  const s = box.diskScale(), top = stillTop(), run = !S().paused && !reduce;
  if (s < gc.still - 0.004 || acc < Math.min(PROG_N, accMax || PROG_N)) return false;
  if (run && quality === 'auto' && picMs > 0) {
    if (picMs > 1.5 * HANDSOFF_MS && gc.still > LADDER[0] + 0.004) { gc.still = LADDER.reduce((m, l) => (l < gc.still - 0.004 ? l : m), LADDER[0]); glog('ramp down'); return true; }
    if (picMs > HANDSOFF_MS / 1.3) return false;
  }
  if (gc.still >= top - 0.004) return false;
  const i = LADDER.findIndex((l) => l > gc.still + 0.004);
  if (i < 0) return false;
  const next = LADDER[Math.min(LADDER.length - 1, i + (run ? 1 : PROG_SKIP) - 1)];
  gc.still = Math.min(top, next); glog('still up');
  return true;
}
const allowed = () => (!calibrated ? 1 : stillNow() ? capStill() : capRun());
const glog = (what) => {
  gc.log.push({ t: Math.round(performance.now()), what, key: gc.key, c1: Math.round(gc.c1), cap: gc.cap, still: gc.still, scale: live() ? box.diskScale() : 0 }); if (gc.log.length > 60) gc.log.shift();
  // (round 10a: and in the flight record, the same decision again on the same kind counted in its entry, not repeated)
  if (what === 'bands') return;
  const l = flog.e[flog.e.length - 1], sc = live() ? box.diskScale() : 0;
  if (l && l.k === 'g' && l.w === what && l.key === gc.key) { l.x = (l.x || 1) + 1; l.cap = gc.cap; l.sc = sc; flogSoon(); }
  else flogAdd({ k: 'g', w: what, key: gc.key, c1: Math.round(gc.c1), cap: gc.cap, st: gc.still || undefined, sc });
};
let bandsSet = 0, engFixed = null;
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
  // (round 10a, dev.5: hands off, the engine's own guard cuts a frame over the budget into bands rather than lowering its scale:
  // the scale is the level's, or the ramp's (the gas line's look apart, see fixedScale))
  const fix = stillNow();
  if (fix !== engFixed && typeof box.diskGuard === 'function') { engFixed = fix; box.diskGuard({ fixed: fix }); }
}
// every scale the page asks for, within the guard
function scaleTo(s) {
  if (!live()) return 0;
  if (exporting) return box.diskScale();   // (round 11b: a video being made holds the scale it planned for its frames)
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
  moveScale = 0;   // (round 10a, dev.6: another kind, Auto's lighter picture learned anew)
  gc.cap = Math.min(stepFor(GUARD_MS), guarded ? Math.max(LADDER[0], box.diskScale()) : 1);
  glog('switch');
  if (up) record('changing');
  guardApply();
}
// (the engine's own guard lowered the scale: something came around this guard; follow it)
box.addEventListener('diskguard', (e) => {
  const d = e.detail || {};
  if (!live() || !calibrated || exporting) return;   // (round 11b: a video's settling frames, at its size, are not the page's)
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
// (for checks: ?gpux=k counts every frame k times longer, as on a GPU k times slower; round 17b: a finite k only, else 1, as an
// infinite one made every cost infinite)
const GPUX = Number.isFinite(Number(q.get('gpux'))) ? Math.max(1, Number(q.get('gpux')) || 1) : 1;
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
  // (round 10a: nor a frame drawn outside the animation frames (out: a resize's), see the engine's fence)
  if (mode !== 'live' || !(d.scale > 0) || !(d.ms > 0) || d.first || d.out || 'lost' in lab.dataset) return;
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
  // (a still's frames are refined step by step whatever a frame costs, their pieces bounded by the engine's bands and kicks, see
  // stillStep; round 10a, dev.6: the gas line's too)
  if (d.still) { /* (not lowered) */ }
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
  if (s.roll) u.searchParams.set('roll', String(s.roll));   // (round 18a: the camera's roll, degrees, when not 0)
  if (s.look === 'co') { u.searchParams.set('com', s.coMode); u.searchParams.set('cov', String(s.coV)); }
  if (!s.ms) u.searchParams.set('ms', '0');
  if (s.bg && s.bg !== 'stars') u.searchParams.set('bg', s.bg);   // (round 8: the background, when not the stars)
  if (s.stars != null && s.stars !== 1) u.searchParams.set('stars', String(s.stars));   // (round 18a: the number of its stars, when not 1)
  const cl = colDef ? colToLink(cols, colDef) : '';
  if (cl) u.searchParams.set('col', cl);   // (round 13a: the model look's colours, when not all the defaults; see COL-LINK)
  const mp = parDef ? mpToLink(params, parDef) : '';
  if (mp) u.searchParams.set('mp', mp);   // (round 14a: the model's parameters, when not all the defaults; see MP-LINK)
  if (windGain !== 1) u.searchParams.set('wb', mpNum(windGain));   // (round 14a: the wind's brightness)
  // (round 8: with each planet's mass in M_J; a link without it is read as Jupiter's. Round 17b: pl= empty when every planet was
  // removed, so that the link gives none back, not the start's planet)
  u.searchParams.set('pl', s.planets.map(([a, on, m]) => a + ':' + on + ':' + m).join(','));
  if (s.cpdMdot > 0) u.searchParams.set('pmd', String(s.cpdMdot));   // (round 13e: the planets' accretion rate, M_J/yr, when not auto)
  if (opList(s).some((f) => f !== 1)) u.searchParams.set('op', opList(s).map((f) => String(f)).join(','));   // (round 18a: the see-through; round 18d: six factors)
  if (Number.isFinite(s.selfk) && s.selfk !== SELFK_DEF) u.searchParams.set('selfk', String(s.selfk));
  // (round 18l: the own light's temperature when not the column's, and the surface's column when not 0.1; see SELFNC_RANGE)
  if (typeof s.selft === 'string' && s.selft !== 'colstar') u.searchParams.set('selft', s.selft);   // (round 19a: 'colstar' the default, 'col' until round 18n)
  if (Number.isFinite(s.selfnc) && s.selfnc !== SELFNC_DEF) u.searchParams.set('selfnc', String(s.selfnc));
  u.searchParams.set('t', String(Math.round(s.time * 1000) / 1000));
  u.searchParams.set('lang', L());
  return u.href;
}
async function copyLink() {
  const href = linkFor(S()), field = $('linkField');
  try { await navigator.clipboard.writeText(href); field.hidden = true; note(T().linkCopied); }
  catch { field.value = href; field.hidden = false; field.focus(); field.select(); note(T().linkShown, 4000); }
}
// (round 11c, the roadmap's "a QR code for the audience's phones") "QR code", beside "Copy a link", shows the code of the view's
// link over the stage; in the presenter, Q shows it, large: of the scene's link, or with scenes of one's own, of the page with
// the scenes (#seq=, which may be shared: disk-lab-handoff.md 6); Q again or Esc closes it, and so does a step to another scene.
// The code (qr.js: byte mode, level M) opens the public page unless this page is served from the public site itself: a talk
// given from a copy on the laptop, or from localhost, would hand the audience an address they cannot open. Under the code, the
// page's address in letters to read from the back of a room. A link longer than QR_BYTES, a code of version 18 (89 modules:
// projected 2 m tall, some 2 cm a module, which a phone reads across a room; ten scenes make some 470 characters), is not put
// in a code: the page's link with its place is, and the note says so. The overlay keeps what it shows in data-href and
// data-version, for checks.
const QR_VERSION = 18, QR_BYTES = qrCapacity(QR_VERSION), QR_PUBLIC = new URL(CITE_URL);
const qrOver = $('qrOver');
let qrFrom = null;   // (the button to give the focus back to, when opened from the rail)
const qrOpen = () => !qrOver.hidden;
const qrHref = (href) => {
  const u = new URL(href);
  return location.protocol === 'https:' && location.host === QR_PUBLIC.host ? u.href : QR_PUBLIC.origin + QR_PUBLIC.pathname + u.search + u.hash;
};
async function qrShow(inTalk) {
  if (!live()) return;
  if (!inTalk && qrOpen()) { qrClose(); return; }   // (the rail's button again: closed)
  const w = T().qr, at = PLACES[placeI].id;
  let href, said;
  if (inTalk && seq.keys.length) {
    const u = new URL(location.pathname, location.href); u.searchParams.set('lang', L());
    href = qrHref(u.href + await seqToHash(seqOut())); said = w.scenes(seq.keys.length);
    if (!presenting) return;   // (the presenter left while the link was made)
  } else { href = qrHref(linkFor(S())); said = w.view; }
  if (qrBytes(href).length > QR_BYTES) {
    const u = new URL(href); u.search = ''; u.hash = ''; u.searchParams.set('place', at); u.searchParams.set('lang', L());
    href = u.href; said = w.tooLong(T().places[at].title);
  }
  const code = qrEncode(href, { maxVersion: QR_VERSION });
  if (!code) { note(w.failed, 4000); return; }
  const u = new URL(href);
  $('qrCode').innerHTML = qrSvg(code, { title: w.label });
  $('qrUrl').textContent = u.host + u.pathname.replace(/\/$/, '');
  $('qrNote').textContent = said;
  Object.assign(qrOver.dataset, { href, version: String(code.version) });
  qrOver.setAttribute('aria-label', w.label);
  if (!qrOpen()) qrFrom = inTalk ? null : document.activeElement;
  qrOver.hidden = false;
  if (!inTalk) $('qrClose').focus();
}
function qrClose() {
  if (!qrOpen()) return;
  qrOver.hidden = true; $('qrCode').replaceChildren();
  if (qrFrom && qrFrom.isConnected && qrFrom.focus) qrFrom.focus();
  qrFrom = null;
}
qrOver.addEventListener('click', (e) => { if (e.target === qrOver || e.target.closest('#qrClose')) qrClose(); });
// (Esc outside the presenter; in it, the presenter's keys close the code first; and the code closed as the presenter starts or ends)
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && qrOpen() && !presenting) { e.preventDefault(); qrClose(); } });
new MutationObserver(() => qrClose()).observe(lab, { attributes: true, attributeFilter: ['data-present'] });
let saving = false;
let exporting = null;   // (round 11b: the video being made, see exportVideo; saving is set with it)
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
// (round 11c, the roadmap's "pictures for slides") The saved picture's shape: the screen's, or 16:9 or 4:3 cut from the middle of
// the view (capture.js, framed: never stretched; the scale bar moved into the crop's corner; the size chosen above is the cut
// picture's, 4K 3840 px wide). The background stays black (the supervisor's choice, disk-lab-handoff.md 6). And a one-line credit
// burnt into the lower right corner, beside the mark, off unless turned on (the owner, 2026-11-03: free to use, no credit required;
// the citation stays below, to copy). Both kept for the visit, as the size is.
const SAVE_RATIOS = { screen: 0, '16:9': 16 / 9, '4:3': 4 / 3 };
let saveRatio = 'screen', saveCredit = false;
try { const r = sessionStorage.getItem(KEY('disk-lab-save-ratio')); if (r in SAVE_RATIOS) saveRatio = r; if (sessionStorage.getItem(KEY('disk-lab-save-credit')) === '1') saveCredit = true; } catch { /* the defaults */ }
const saveRatioNow = () => SAVE_RATIOS[saveRatio] || 0;
const saveRatioButtons = Object.keys(SAVE_RATIOS).map((k) => {
  const b = el('button', { type: 'button', 'data-save-ratio': k, 'aria-pressed': String(k === saveRatio) });
  $('saveRatioGroup').append(b);
  return b;
});
// the plan for the size chosen: k (times the screen's pixels each way), the picture's size, the render scale and the bands
// (fm: the cost of a frame now, measured just before saving (diskCost); the frames' intervals otherwise, for the note)
function savePlan(fmNow) {
  const m = box.diskSnapMax(), [sw, sh] = m.screen, cr = cropFor(sw, sh, saveRatioNow());   // (round 11c: the slide's crop)
  let k = saveSize === '4k' ? 3840 / cr.w : Number(saveSize);
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
  // (round 11c: the picture's size is the crop's; the frames, their cost and SAVE_MPX are the whole canvas's, which is drawn)
  return { k, w: Math.round(cr.w * k), h: Math.round(cr.h * k), to: Math.round(to * 100) / 100, bands, band };
}
// (p: a plan measured just before saving, which may differ from the one the note showed: then the note says the new one)
function renderSaveSize(p = null) {
  const w = T().saveSize;
  saveSizeButtons.forEach((b) => { b.textContent = w[{ 1: 'screen', 2: 'twice', '4k': 'uhd' }[b.dataset.saveSize]]; pressed(b, b.dataset.saveSize === saveSize); });
  $('saveSizeGroup').setAttribute('aria-label', w.label);
  renderSaveFrame();
  if (!live()) { $('saveSizeNote').textContent = ''; return; }
  p = p || savePlan();
  $('saveSizeNote').textContent = saveSize !== '1' && p.k === 1 ? w.coScreen(p.w, p.h) : p.k > 1 && p.to < 0.999 ? w.lower(p.w, p.h, Math.round(100 * p.to)) : w.note(p.w, p.h);
  if (saveRatio !== 'screen') $('saveSizeNote').textContent += T().saveFrame.crop;   // (round 11c: the cut, said)
}
async function saveImage(btn) {
  if (saving) return;
  stopPlay();   // (review of round 11a: no move, scene or tour of the looks changes the picture while it is saved, see talks)
  saving = true; btn.disabled = true; note(T().imageBusy, 0);
  try {
    // (at the screen's size: at its resolution where a frame there is predicted under SAVE_MS_SCREEN, else at the scale that
    // keeps it so; a saved picture of the CO line's moments at full resolution took seconds a frame. Round 9: the frame
    // measured just before saving is the running one, within the guard's budget)
    const p = savePlan(saveSize !== '1' ? await box.diskCost() : 0);
    renderSaveSize(p);
    const c = await shotFramed({ scale: p.to, size: p.k, bands: p.bands, bandMs: p.band, frames: SAVE_FRAMES, onFrame: (i, n) => note(T().imageProgress(i, n), 0) });
    if (c) await watermark(c);
    if (c && saveCredit) credit(c);   // (round 11c)
    const blob = c && await toPng(c);
    if (!blob) throw new Error('no picture');
    const a = el('a', { href: URL.createObjectURL(blob), download: `disk-lab-${PLACES[placeI].id}${saveRatio !== 'screen' ? '-' + saveRatio.replace(':', 'x') : ''}${p.k > 1 ? '-' + c.width + 'x' + c.height : ''}.png` });
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
  markOn(c);
}
// (round 11b: drawn at once where the mark is ready, for a video's frames, each stamped as it comes; returns its box)
function markOn(c) {
  const g = c.getContext('2d'), w = Math.round(c.width * 0.06), h = Math.round(w * 677 / 1874), m = Math.round(c.width * 0.012);
  g.save(); g.globalAlpha = 0.2; g.drawImage(markImg, c.width - w - m, c.height - h - m, w, h); g.restore();
  return { w, h, m };
}
// (round 11c) the shape's buttons and the credit's toggle, named in words.js (the note says the cut, renderSaveSize)
function renderSaveFrame() {
  const w = T().saveFrame;
  saveRatioButtons.forEach((b) => { b.textContent = w[b.dataset.saveRatio]; pressed(b, b.dataset.saveRatio === saveRatio); });
  $('saveRatioGroup').setAttribute('aria-label', w.label);
  $('saveCredit').textContent = w.credit; pressed($('saveCredit'), saveCredit);
}
function setSaveFrame(ratio, withCredit) {
  if (ratio in SAVE_RATIOS) saveRatio = ratio;
  if (withCredit != null) saveCredit = !!withCredit;
  try { sessionStorage.setItem(KEY('disk-lab-save-ratio'), saveRatio); sessionStorage.setItem(KEY('disk-lab-save-credit'), saveCredit ? '1' : '0'); } catch { /* for this visit only */ }
  renderSaveSize();
}
// a picture of the model cut to the shape chosen, with the governor resting meanwhile (as shot)
async function shotFramed(opts) {
  if (gov) gov.pause(true);
  try { return await framed(box, opts, saveRatioNow()); } finally { govRest(); }
}
// The credit, one line in English as the citation is on either page (round 8): small, white and faint like the mark, to the
// left of it in the lower right corner, at the mark's height; a soft shadow keeps it legible over a bright part of the picture.
// The scale bar keeps the lower left. Its size from the picture's shorter side (some 1.6 %), never wider than the room left of
// the mark.
const CREDIT = `Disk Lab (Mori ${CITE_YEAR}) · ${CITE_URL.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
function credit(c) {
  const g = c.getContext('2d'), mw = Math.round(c.width * 0.06), mh = Math.round(mw * 677 / 1874), m = Math.round(c.width * 0.012);
  const room = c.width - 2 * m - mw - m;
  let px = Math.max(10, Math.round(0.016 * Math.min(c.width, c.height)));
  g.save();
  g.font = `${px}px Helvetica, Arial, sans-serif`;
  const tw = g.measureText(CREDIT).width;
  if (tw > room && room > 0) { px = Math.max(8, Math.floor(px * room / tw)); g.font = `${px}px Helvetica, Arial, sans-serif`; }
  g.textAlign = 'right'; g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,0.7)'; g.shadowBlur = Math.max(2, px / 3);
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.fillText(CREDIT, c.width - m - mw - m, c.height - m - mh / 2);
  g.restore();
}
// a link's mode with the gas and its dust as one: either of the engine's bits 1 and 2 turns on both (round 6)
const linkMode = (m) => (Number.isInteger(m) && (m & 3) ? m | 3 : m);
// a link's state: the place first, then any of the engine's keys (diskSet checks every value)
function stateFromLink() {
  const NUM = ['p', 'el', 'az', 'd', 'tx', 'ty', 'tz', 'roll', 'mode', 'field', 'speed', 'paused', 'slice', 'ann', 'ms', 'asym', 'marks', 'waves'];   // (round 18a: roll)
  const st = {};
  for (const k of NUM) if (q.has(k)) st[k] = q.get(k);
  if (st.mode != null) st.mode = linkMode(Number(st.mode));
  if (q.has('sq')) st.sq = q.get('sq');
  if (q.has('look')) st.look = q.get('look');
  if (q.has('bg')) st.bg = q.get('bg');
  if (q.has('stars')) st.stars = q.get('stars');   // (round 18a; the engine passes over what is not a finite number and bounds it)
  if (q.has('com')) st.coMode = q.get('com');
  if (q.has('cov')) st.coV = q.get('cov');
  if (q.has('t')) st.time = q.get('t');
  // (round 17b: an empty field is no number, not 0: pl=::: made a planet at the inner end; the engine passes over a radius not a number)
  if (q.has('pl')) st.planets = q.get('pl').split(',').filter(Boolean).map((t) => t.split(':').map((x) => (x.trim() === '' ? NaN : Number(x))));
  if (q.has('pmd')) st.cpdMdot = q.get('pmd');   // (round 13e; the engine bounds it, and reads anything not positive as auto)
  // (round 18a: the see-through, four factors; a blank one is 1; the engine bounds them and passes over a list of another length.
  // Round 18d: six, with the jet's and the field lines'; four, as dev.23 to dev.25 wrote them, the engine takes with those at 1)
  if (q.has('op')) st.op = q.get('op').split(',').map((x) => (x.trim() === '' ? 1 : Number(x)));
  // (round 18i: the own light's opacity, which the engine bounds; the model look's light is always its own emission now, see
  // the owner's request of round 19: "星の光モードを消す")
  if (q.has('selfk')) st.selfk = q.get('selfk');
  // (round 18l: the own light's temperature, a name the engine knows, round 18k's ?selfint=1 as selft=int where no selft= is given; and
  // the surface's column, which the engine bounds)
  if (q.has('selft')) st.selft = q.get('selft');
  else if (q.get('selfint') === '1') st.selft = 'int';
  if (q.has('selfnc')) st.selfnc = q.get('selfnc');
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
// (2026-11-04, the owner) the record of updates (changelog.html) in a dialog of its own, beside About; its frame loads when first opened
const histDlg = $('history');   // (not "history": that name is the window's, used for the address)
if (histDlg && $('historyOpen')) {
  const frame = $('historyFrame');
  $('historyOpen').addEventListener('click', () => { if (frame && !frame.src) frame.src = frame.dataset.src; histDlg.showModal(); });
  $('historyClose').addEventListener('click', () => histDlg.close());
  histDlg.addEventListener('click', (e) => { if (e.target === histDlg) histDlg.close(); });
  histDlg.addEventListener('close', () => $('historyOpen').focus({ preventScroll: true }));
}

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
  if (!live() || moveFrom || holdSharp || quality !== 'auto' || 'lost' in lab.dataset || !(S().paused || reduce) || saving || recent.length < 4) return;
  // (round 9: as fine as the guard's still picture, capStill: STILL_MS a frame, drawn in bands of GUARD_MS; it was the scale
  // whose frame the accumulation's own intervals predicted at SHARP_MS, drawn whole)
  // (round 10a, A4: and on, a step at a time up to 1, see stillStep)
  if (box.diskScale() >= capStill() - 0.004) stillStep(PROG_N, PROG_N);
  const s = box.diskScale(), to = Math.min(1, capStill());
  if (to < 1.15 * s) return;
  sharpFrom = sharpFrom || s; recent.length = 0; sharpWhat = S().look + S().coMode;
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
  if (Number(q.get('guard')) > 0 && Number.isFinite(Number(q.get('guard')))) { guarded = true; GUARD_MS = Math.max(5, Number(q.get('guard'))); }   // (round 17b: finite: an infinite budget guards nothing)
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
  // (round 14a, for the check of the default picture: ?mpconst=1, the shaders with the model's parameters at their defaults as
  // constants, as until round 14, the parameters then reaching the script only; see the engine's MP_CONST and DESIGN.md section 34)
  if (q.get('mpconst') === '1') box.dataset.mpconst = '1';
  if (SWITCH.eddy) box.dataset.eddy = 'off';   // (round 10a: see SWITCH)
  if (SWITCH.split) box.dataset.split = '0';
  if (SWITCH.kick > 0) box.dataset.kick = String(Math.round(SWITCH.kick));
  // (round 13b, for a comparison only: ?bgmove=1, the sky behind fixed in the disk's frame as before, swept by the slow spin and
  // by a planet followed; see the engine's bgTurn)
  if (q.get('bgmove') === '1') box.dataset.bgmove = 'on';
  // (round 13e, to compare the planets' own disks: ?cpdh=drawn, the thermal mass with the drawn h (the owner's D-1 takes the gas's
  // own, about 1.8 times thinner); ?cpd=old, round 8's disk (0.4 R_H, its colours and glow); see the engine's cpdPhys)
  if (q.get('cpdh') === 'drawn') box.dataset.cpdh = 'drawn';
  if (q.get('cpd') === 'old') box.dataset.cpd = 'old';
  // (round 19d, the visual review, to compare: ?cpdvol=0, the planet's disk in the model look as the three clouds of before; by
  // default a volume with the planet's bright point in it, see the engine's cpdVolume)
  if (q.get('cpdvol') === '0') box.dataset.cpdvol = '0';
  if (SWITCH.accLayer) box.dataset.acclayer = 'on';   // (round 13a: see SWITCH)
  if (q.get('lit') === 'fx') box.dataset.lit = 'fx';   // (2026-11-03: the starlight's shading tied to the finish's level, as before; see the engine's uLit)
  if (SWITCH.gasrho) box.dataset.gasrho = SWITCH.gasrho;
  for (const k of ['mflux', 'lam', 'lamin', 'mdot', 'chic']) if (SWITCH[k]) box.dataset[k] = SWITCH[k];   // (round 13c: see SWITCH)
  box.setAttribute('data-disk3d', '');
  // (round 15b) the engine's dev switches, read from the address: a thick pebble layer, the envelope/wind exclusion, the gas line from the
  // envelope, the jet's occlusion, the gas's glow, the CPD's flare, the wind's extent, the starlight's scale (README); (round 16a) the
  // shortcuts while the picture moves and their share of the steps (README, the engine's FAST; round 16b: the checkerboard dropped);
  // (round 16c) the march's steps and the still's frames, for the owner's timing trials; (round 18a) the gas's surface density, its
  // cut of before (?sigtail=0) and another R_c for its tail (?rc=, au; round 18b: a Gaussian); (round 18c) the model look's starlight
  // on the surface as before, eased to R^-1/2 at every radius (?litflat=1); (round 18f) the visible and mid-infrared looks' cylinder
  // (?obscyl=R,Z, au), and the model look's lit surface seen through the disk as before, its shadow's glow as before (?skinlos=0);
  // (round 18g) the opacities of before, the visible and mid-infrared looks' and the model look's scattered light's, as in 1.9-dev.28
  // (?opq=0). Each passed as it is: the engine reads each within its range, and a value it cannot read as its default
  for (const k of ['pebh', 'excl', 'coenv', 'jetocc', 'ggas', 'cpdflare', 'wext', 'lscale', 'fast', 'fastk', 'steps', 'acc', 'sigtail', 'rc', 'sigp', 'aeup', 'fieldlod', 'litflat', 'obscyl', 'skinlos', 'opq', 'selfsurf', 'selflook', 'selfhue', 'turb3d']) if (q.has(k)) box.dataset[k] = q.get(k);   // (round 18j: selfsurf, the own light with the lit surface's warm grains as in round 18i; round 18k: the default now, passed over by the engine; selflook=old, the look of round 18j. Round 18l: round 18k's selfint=1, the interior's temperature, is the link's selft=int, see stateFromLink. Round 18m: selfhue=1, the own light in round 18k's colours of the brightness temperature; turb3d=0, the turbulence of before, uniform in height)
  // (round 19e, the visual review) ?cutlook=old: the cut faces' colours and their keys as before the review (the engine's CUT_OLD), to compare
  if (q.has('cutlook')) box.dataset.cutlook = q.get('cutlook');
  try { await loadEngine(); } catch (e) { diag.failError = String((e && e.message) || e); record('failed'); return enterStill('failed'); }
  // (the engine's own start: the defaults Reset returns to; round 15a: with the clock's state, stopped by data-paused)
  if (typeof box.diskState === 'function') DEF0 = pick(box.diskState(), [...DEF_KEYS, ...UNKEPT_KEYS, 'paused']);   // (round 18l: UNKEPT_KEYS)
  // (round 13a) the model look's colours, before the first picture: a link's col= (a link without it: the defaults), else those
  // kept on this device. Also after a safe start: they cost nothing to draw, and are not lost when the settings are next kept
  if (typeof box.diskColours === 'function') {
    colDef = box.diskColours().def;
    cols = q.has('col') || stateFromLink() || q.has('place') ? colFromLink(q.get('col') || '', colDef) : keptCols();
    applyCols();
  }
  // (round 14a) the model's parameters, before the first picture: a link's mp= (a link without it: the defaults), else those kept on
  // this device, with the development switches' aliases between (mp= wins); and the wind's brightness, a link's wb= or the one kept.
  // Also after a safe start, as the colours (see the model's parameters)
  if (typeof box.diskParams === 'function') {
    const p0 = box.diskParams(), fromLink = q.has('mp') || stateFromLink() || q.has('place');
    parDef = p0.def; parSpec = p0.spec;
    params = { ...(fromLink ? {} : keptParams()), ...mpAliases(), ...(fromLink ? mpFromLink(q.get('mp') || '', parDef) : {}) };
    applyParams(false);
    buildParams();
  }
  if (typeof box.diskWindGain === 'function') { windGain = q.has('wb') || stateFromLink() || q.has('place') ? wbFrom(q.get('wb')) : keptWind(); applyWind(); }
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
  // (2026-11-03, the owner: a copied link did not give the picture back. After a bad end the link's state was dropped with the kept
  // one; now the link is honoured, made safe: the culprit avoided where the record names one, else any observed look and the cut
  // set aside (the view, the colours and the rest stay). The kept settings are still dropped after a bad end.)
  const safeLink = (st) => { if (!st || !crashed) return st; const o = avoided(st); if (!avoid) { if (o.look && o.look !== 'model') o.look = 'model'; if (o.slice != null) o.slice = 0; } return o; };
  const linked = safeLink(stateFromLink()) || (crashed || q.has('place') ? null : keptState());
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
    // (round 10a, dev.6: the looks drawn in kicks down to the ladder's first step while moving, as their guard's cap allowed in dev.4)
    floor: () => (S().look === 'co' ? CO_FLOOR : S().look === 'optical' || S().look === 'mir' ? LADDER[0] : MIN_SCALE), cap: () => (stillNow() ? 1 : capRun()), onChange: (sc) => { if (moveFrom) moveScale = sc; else runScale = sc; } });
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
  // (round 11a: a link's scenes, #seq=; ?present=1 opens the presenter, full screen at the first key or click where the browser
  // asks for one)
  seqOpenHash();
  if (q.get('present') === '1') present(true);
}

// (round 10a) What the page sets in the engine for this device, once the guard is calibrated, and again when the engine is
// built anew after a lost context was given back (its build starts from its defaults: round 9 left the engine's own guard
// off, the full march on a guarded device, no frame-rate cap and the eddies every frame after a restore): its guard's budget
// and the kind measured, the march's tier (the cheaper on a guarded device; else for the kinds measured over the budget),
// the frame rate while only the clock moves (FPS_STILL, a phone or tablet FPS_STILL_PHONE; the display's own while the view
// moves or anything changes), and on a guarded device the eddies' volume every other frame while only the clock moves
function engineSettings() {
  if (typeof box.diskGuard !== 'function') return;
  engFixed = null;   // (round 10a, dev.5: told again to an engine built anew, see guardApply)
  box.diskGuard({ ms: GUARD_MS / GPUX, key: gc.key, c1: gc.c1 / GPUX });   // (the engine's own guard, the same budget)
  if (typeof box.diskMarch === 'function') { if (guarded) box.diskMarch('cheap'); else predictTier(gc.key); }
  if (typeof box.diskFps === 'function') box.diskFps(SWITCH.fps > 0 ? SWITCH.fps : MOBILE || coarse ? FPS_STILL_PHONE : FPS_STILL);
  if (typeof box.diskEddyEvery === 'function') box.diskEddyEvery(guarded ? 2 : 1);
  // (round 10a: on a guarded device the GPU rests between frames that only move the clock and between a still's bands: half
  // the time at most busy, DUTY_GUARDED; see the engine's diskDuty)
  if (typeof box.diskDuty === 'function') box.diskDuty(SWITCH.duty === 'off' ? 0 : Number(SWITCH.duty) > 0 ? Number(SWITCH.duty) : guarded ? DUTY_GUARDED : 0);
  if (SWITCH.ctmax > 0 && typeof box.diskCtMax === 'function') box.diskCtMax(SWITCH.ctmax);
  // (round 10a: the march in kicks, see the engine's SPLIT: a kick's work and the state's size by the device. Guarded (a phone),
  // 32 steps a kick (5 to 7 ms at the slowest rays on the M1 Max) and 8 MB a set; else 48 steps (64 made a frame's GPU time 1.16
  // times the rays drawn whole, where 32 made it 1.56, but its slowest kicks 9 to 14 ms) and 32 MB a set, so that a desktop's
  // frame is one band, its slowest ray paid once)
  // (round 10a, optimizing: ?kadapt=1, the work of a kick adapted by kind, see the engine's kickKOf; off unless asked)
  if (typeof box.diskSplit === 'function') box.diskSplit({ k: SWITCH.kick > 0 ? SWITCH.kick : guarded ? 32 : 48, mb: guarded ? 8 : 32, adapt: SWITCH.kadapt });
}
// the engine's own changes (keys, a drag, the easter eggs, a restored context) reach the controls
box.addEventListener('diskstate', () => sync());
box.addEventListener('diskmode', () => sync());
box.addEventListener('diskframe', (e) => {
  if (mode !== 'live') return;
  // (round 11b: a video's frames are drawn at its size and its scale, a second or more each: not the frames of the page's guard, its
  // ramp, its lighter picture while moving or its measures; the flight record told that a picture was finished)
  if (exporting) { flog.frT = Date.now() - flog.t0; return; }
  setClockRate(e.detail.clock);
  // (the intervals between frames of one still picture, at one scale, are what a frame of it costs; a complete picture
  // may be sharpened)
  // (round 9: held, the time the frame waited for the frame rate's cap, is not its cost)
  const { acc = 0, accMax = 0, bands = 1, held = 0, kicks = 0 } = e.detail, now = performance.now() - held;
  // (round 7: an interval after a complete still picture, or after the page was hidden, is a rest, not a frame's cost:
  // counted, the first frame after the clock started again took the scale to its floor)
  if (lastIdle) lastFrame = 0;
  lastIdle = !!S().paused && accMax > 0 && acc >= accMax;
  // (round 10a, A4: a still refined to the next step, see stillStep; Auto by its own sharpening, onAccumulated. The view moved:
  // from its first step again)
  if (moveFrom && gc.still) gc.still = 0;
  if (!moveFrom && !S().paused && lastFrame && now - lastFrame < 5000) picMs = picMs ? 0.6 * picMs + 0.4 * (now - lastFrame) : now - lastFrame;
  else if (moveFrom) picMs = 0;
  if (stillStep(acc, accMax)) { if (quality === 'auto') scaleTo(capStill()); else applyFixed(); picMs = 0; sync(); }
  applyFixed();
  if (skipFrames > 0) { skipFrames--; costs.length = 0; }
  else guardFixed(lastFrame ? now - lastFrame : 0, acc, accMax, kicks ? Math.max(2, bands) : bands);   // (in kicks: no piece is the frame)
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
let moveFrom = 0, moveTimer = 0, lastView = null, moveScale = 0;   // (moveScale: Auto's lighter picture, as the governor left it in the last move)
function moving() {
  if (exporting || holdSharp || box.dataset.move === 'off' || !live() || 'lost' in lab.dataset) return;   // (round 11b: see sync)
  if (!moveFrom) {
    unsharpen();
    moveFrom = box.diskScale();
    const floor = S().look === 'co' ? CO_FLOOR : S().look === 'optical' || S().look === 'mir' ? LADDER[0] : MIN_SCALE;
    const to = quality === 'auto' ? Math.max(floor, Math.min(moveFrom, moveScale > 0 ? moveScale : MOVE_K * runScale)) : Math.min(moveFrom, MOVE_FIXED);
    // (round 10a, dev.6: Auto's lighter picture follows the frame rate while the view moves, the governor working then only (its
    // runScale kept for the next move); at rest the ramp's. dev.5 left it at the scale measured at the start: on the phone's frame
    // a drag in the model's look ran at 52 frames a second at the start's view and 34 next to the star, against dev.4's 55 and 37)
    if (gov) gov.pause(quality !== 'auto' || holdSharp);
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
  // (round 10a, dev.5: the ramp from the lighter picture, a rung a picture, see stillStep; Auto's too)
  if (live()) scaleTo(quality === 'auto' ? capStill() : fixedScale());
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
const DEF_KEYS = ['mode', 'field', 'marks', 'asym', 'waves', 'ann', 'bg', 'look', 'coMode', 'coV', 'slice', 'sq', 'speed', 'planets', 'ms', 'cpdMdot', 'op', 'stars', 'selfk', 'selfnc'];   // (round 18l: selfnc, the own light's surface column)   // (round 18i: selfk, the own light's opacity; round 19: glow removed, see the owner's request to drop the starlight mode)
// (round 18l) the engine's state that a link carries and this device does not keep, which Reset all puts back to the engine's start:
// the own light's temperature for comparisons, selft, which no control shows (see SELFNC_RANGE)
const UNKEPT_KEYS = ['selft'];   // (round 18a: op, stars)   // (round 13e: cpdMdot, the planets' accretion rate)
const VIEW_KEYS = ['el', 'az', 'd', 'tx', 'ty', 'tz', 'p', 'pi', 'roll'];   // (round 18a: roll, the camera's about the line of sight)
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] != null).map((k) => [k, Array.isArray(o[k]) ? o[k].map((v) => (Array.isArray(v) ? v.slice() : v)) : o[k]]));
let DEF0 = null, defaults = null, keeping = false, keepTimer = 0;
function settingsNow() {
  const s = S();
  // (round 13a: col, the model look's colours as a link writes them, '' for the defaults; see COL-LINK)
  // (round 14a: mp, the model's parameters as a link writes them, '' for the defaults, see MP-LINK; wb, the wind's brightness)
  return talkHeld({ v: 1, place: PLACES[placeI].id, ...pick(s, DEF_KEYS), ...pick(s, VIEW_KEYS), quality: qChosen ? quality : null, col: colDef ? colToLink(cols, colDef) : '',
    mp: parDef ? mpToLink(params, parDef) : '', wb: windGain !== 1 ? mpNum(windGain) : '' });   // (round 11a: see talkHeld)
}
function keepNow() {
  clearTimeout(keepTimer); keepTimer = 0;
  if (!keeping || !live() || 'lost' in lab.dataset || exporting) return;   // (round 11b: a video's scenes are not the visitor's settings)
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
  box.diskSet({ ...pick(d, [...DEF_KEYS, ...UNKEPT_KEYS]), paused: d.paused ? 1 : 0 });   // (round 18l: UNKEPT_KEYS)
  box.diskSpeed(d.speed || 1);
  cols = {}; applyCols();   // (round 13a: the model look's colours, the defaults)
  params = {}; applyParams(); windGain = 1; applyWind();   // (round 14a: the model's parameters and the wind's brightness, the defaults)
  applyQuality(d.quality);
  goPlace(0);
  keepNow();
  note(T().resetDone, 3500);
}

// ---------- looking in by tilting the phone (round 12b) ----------
// The roadmap's "tilt the phone to look in" (DESIGN.md, section 30). A setting in the rail's View, off by default, kept on this
// device (its own key: it is the device's, not the view's), and shown only on a phone or a tablet (a desktop has no sensor; the
// switch is not made). With it on, the phone's tilt from the way it is held at rest turns the view by a small offset, as a model
// held in the hand turns: the top edge toward you shows the disk more from above, the right edge up (or toward you) more of its
// right side; at most 6 degrees, eased. The offset goes to the engine (box.diskTilt), which draws it on the camera's pose and
// never writes it into the state: the links, the settings kept and the scenes are those of the view without it. The engine
// draws a step only when it moves the picture by a pixel's worth, and tells when the steps are fast enough to count as a moving
// view (then moving(), the lighter picture, as a drag; slower, and at rest, the still keeps refining to the quality chosen).
// The sensor is deviceorientation (beta and gamma, the W3C's angles of the device's frame), turned into the gravity's
// direction in the screen's frame (with the screen's own turn), low-passed with a time constant of 0.3 s (TILT_TAU: the hand's
// tremor, 8-12 Hz, is cut to a twentieth), measured from a rest (the hold when the tilt starts or takes up again), with a dead
// zone of 2 degrees about it (TILT_DEAD: no offset at all there, so that a phone held about still draws the state's own view,
// bit for bit) and a smooth ease to the edge (tanh). The rest is pulled along when the hold leaves it by more than 30 degrees
// (TILT_LEASH: a new posture, lying down, needs no reset; the offset then stays at its edge). It lets go (the rest follows the
// hold, with the same time constant, so that the offset eases back to none, and takes up again from there without a jump)
// while the view is moved otherwise (a flight, a path, a drag or a touch: diskframe's moving), during the moves, the scenes'
// Play and the presenter, and while the page is not live. Off with reduced motion (the switch is shown, not to be turned on),
// and with ?tilt=0 (a development switch: data-tilt="off" on the disk, which the engine honours, and no switch). The sensor's
// events do not count as input for the rest (DESIGN.md, section 19): a phone left on a table goes to rest as before.
// iOS (13 and later) gives the sensor only to a page that asks from a user's gesture: the switch asks when it is turned on
// (DeviceOrientationEvent.requestPermission), says in words what came of it, and stays off if refused. Kept on, the next visit
// listens at once; where nothing comes (iOS asks again in a new visit), the first touch on the page asks.
// TILT-MATH
const TILT_TAU = 0.3, TILT_DEAD = 2, TILT_GAIN = 0.4, TILT_MAX = 6, TILT_LEASH = 30;   // (s; degrees, and degrees of view a degree of tilt)
const TILT_RAD = Math.PI / 180;
// The gravity's direction (unit, pointing down) in the screen's frame (x to the right, y up, z out of the screen toward the
// viewer), from deviceorientation's beta and gamma (degrees; the device's frame, intrinsic Z-X'-Y'' angles: the earth's up is
// [-cos b sin g, sin b, cos b cos g] in it) and the screen's turn (degrees: screen.orientation.angle, or iOS's window.orientation;
// the screen's frame is the device's turned by that angle about z)
function tiltGravity(beta, gamma, turn) {
  const b = beta * TILT_RAD, g = gamma * TILT_RAD, a = (turn || 0) * TILT_RAD;
  const x = Math.cos(b) * Math.sin(g), y = -Math.sin(b), z = -Math.cos(b) * Math.cos(g);
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a), z];
}
// one step (dt, s) of the low-pass on a direction: f toward g by 1 - e^(-dt/TILT_TAU), kept unit; the first sample as it is
function tiltFilter(f, g, dt) {
  if (!f) return g.slice();
  const k = 1 - Math.exp(-Math.max(0, dt) / TILT_TAU), v = f.map((x, i) => x + (g[i] - x) * k), n = Math.hypot(v[0], v[1], v[2]) || 1;
  return v.map((x) => x / n);
}
// the rest g0 pulled along the great circle toward the hold g, so that they are at most TILT_LEASH degrees apart
function tiltLeash(g0, g) {
  const c = Math.max(-1, Math.min(1, g0[0] * g[0] + g0[1] * g[1] + g0[2] * g[2])), ang = Math.acos(c), lim = TILT_LEASH * TILT_RAD;
  if (!(ang > lim) || Math.sin(ang) < 1e-9) return g0;
  const s = Math.sin(ang), a = Math.sin(lim) / s, b = Math.sin(ang - lim) / s;   // (slerp from g toward g0, lim from g)
  return g0.map((x, i) => a * x + b * g[i]);
}
// The tilt from the rest g0 to the hold g (degrees): [toward, right]. toward: the turn about the screen's x axis, positive with
// the top edge toward the viewer (the angle between the two directions as they project on the screen's y-z plane); right: the
// gravity's lean across the screen, positive with the right edge up (turned about the screen's upright axis, toward the viewer
// when the phone lies back, or about its normal, as a wheel)
function tiltAngles(g0, g) {
  const toward = -Math.atan2(g0[1] * g[2] - g0[2] * g[1], g0[1] * g[1] + g0[2] * g[2]) / TILT_RAD;
  const as = (x) => Math.asin(Math.max(-1, Math.min(1, x)));
  return [toward, (as(g0[0]) - as(g[0])) / TILT_RAD];
}
// the offset (degrees of view) for a tilt d (degrees): none within TILT_DEAD of the rest, then a smooth start (a quadratic to
// twice it, the slope continuous), TILT_GAIN a degree, eased to at most TILT_MAX; odd
function tiltEase(d) {
  const a = Math.abs(d), D = TILT_DEAD, x = a <= D ? 0 : a < 2 * D ? (a - D) * (a - D) / (2 * D) : a - 1.5 * D;
  return x === 0 ? 0 : Math.sign(d) * TILT_MAX * Math.tanh(TILT_GAIN * x / TILT_MAX);
}
// /TILT-MATH
const TILT_KEY = KEY('disk-lab-tilt');
const TILT_DEV = MOBILE && typeof DeviceOrientationEvent !== 'undefined' && q.get('tilt') !== '0';
let tiltOn = false, tiltListening = false, tiltF = null, tiltG0 = null, tiltT = 0, tiltGot = false, tiltBusyT = 0, tiltWatch = 0, tiltBtn = null, tiltNoteEl = null, tiltOnce = null;
// the screen's turn (degrees) for the sensor's frame
const tiltTurn = () => { const o = screen.orientation; return o && typeof o.angle === 'number' ? o.angle : Number(window.orientation) || 0; };
// let go: the view moved otherwise (within 0.3 s of a frame that said so), a move, the scenes' Play, the presenter, not live
const tiltPaused = () => !live() || !!playing || presenting || performance.now() - tiltBusyT < 300;
function tiltSay(k) {
  if (!tiltNoteEl) return;
  tiltNoteEl.replaceChildren(el('span', { class: 'en', lang: 'en' }, WORDS.en.tilt[k]), el('span', { class: 'ja', lang: 'ja' }, WORDS.ja.tilt[k]));
}
function tiltSensor(e) {
  if (e.beta == null || e.gamma == null) return;   // (a desktop's browser may send one empty event)
  tiltGot = true;
  if (!tiltOn) return;
  const t = performance.now(), dt = tiltT ? Math.min(0.2, (t - tiltT) / 1000) : 0;
  tiltT = t;
  tiltF = tiltFilter(tiltF, tiltGravity(e.beta, e.gamma, tiltTurn()), dt);
  if (!tiltG0) tiltG0 = tiltF.slice();
  tiltG0 = tiltPaused() ? tiltFilter(tiltG0, tiltF, dt) : tiltLeash(tiltG0, tiltF);
  if (!live()) return;
  const [toward, right] = tiltAngles(tiltG0, tiltF), r = box.diskTilt({ el: tiltEase(toward), az: tiltEase(right) });
  if (r && r.moving) moving();
}
// the rest taken afresh with the next event (the screen turned, the page shown again)
const tiltAfresh = () => { tiltF = null; tiltG0 = null; tiltT = 0; };
function tiltListen(on) {
  if (on === tiltListening) return;
  tiltListening = on;
  if (on) addEventListener('deviceorientation', tiltSensor); else removeEventListener('deviceorientation', tiltSensor);
  tiltAfresh();
}
// The setting on or off (why: the word to say), kept on this device. Off: the offset taken away at once (the state's view).
function tiltSet(on, why) {
  tiltOn = !!on && TILT_DEV && !reduce;
  clearTimeout(tiltWatch); tiltTouchOff();
  tiltListen(tiltOn);
  if (!tiltOn && live() && typeof box.diskTilt === 'function') box.diskTilt(false);
  if (tiltBtn) pressed(tiltBtn, tiltOn);
  try { localStorage.setItem(TILT_KEY, tiltOn ? '1' : '0'); } catch { /* for this visit only */ }
  tiltSay(why || (tiltOn ? 'on' : 'off'));
  // (nothing heard in 2 s: a device without the sensor, or iOS waiting to be asked; see tiltKept)
  if (tiltOn) { tiltGot = false; tiltWatch = setTimeout(() => { if (tiltOn && !tiltGot) tiltSet(false, 'none'); }, 2000); }
}
// iOS: the permission asked within the gesture (the call made before anything is awaited); elsewhere nothing to ask
async function tiltAsk() {
  const DOE = window.DeviceOrientationEvent;
  if (DOE && typeof DOE.requestPermission === 'function') {
    tiltSay('asking');
    let r = 'error';
    try { r = await DOE.requestPermission(); } catch { /* not from a gesture, or no sensor: said as failed */ }
    if (r !== 'granted') { tiltSet(false, r === 'denied' ? 'denied' : 'failed'); return; }
  }
  tiltSet(true, 'on');
}
// kept on: listen at once; if nothing comes in 2 s where the browser asks (iOS, a new visit), the next touch on the page asks
// (a gesture), and the switch says so meanwhile (a touch on the switch itself is the switch's: it turns the tilt off)
const tiltTouchOff = () => { if (!tiltOnce) return; removeEventListener('touchend', tiltOnce, true); removeEventListener('click', tiltOnce, true); tiltOnce = null; };
function tiltKept() {
  tiltOn = true; tiltListen(true); pressed(tiltBtn, true); tiltSay('on');
  const DOE = window.DeviceOrientationEvent, asks = DOE && typeof DOE.requestPermission === 'function';
  tiltGot = false;
  tiltWatch = setTimeout(() => {
    if (!tiltOn || tiltGot) return;
    if (!asks) { tiltSet(false, 'none'); return; }
    tiltSay('touch');
    tiltOnce = (e) => { if (tiltBtn && tiltBtn.contains(e.target)) return; tiltTouchOff(); if (tiltOn && !tiltGot) tiltAsk(); };
    addEventListener('touchend', tiltOnce, true); addEventListener('click', tiltOnce, true);
  }, 2000);
}
function tiltInit() {
  if (q.get('tilt') === '0') box.dataset.tilt = 'off';   // (the development switch: the engine draws no offset)
  if (!TILT_DEV) return;   // (a desktop: no sensor, no switch)
  const sec = $('recentre') && $('recentre').closest('.rail-sec');
  if (!sec) return;
  tiltBtn = el('button', { type: 'button', class: 'chip', id: 'tiltSwitch', 'data-tilt': '', 'aria-pressed': 'false', 'aria-describedby': 'tiltNote',
    disabled: reduce, onclick: () => { if (tiltOn) tiltSet(false); else tiltAsk(); } },
  el('span', { class: 'en', lang: 'en' }, WORDS.en.tilt.label), el('span', { class: 'ja', lang: 'ja' }, WORDS.ja.tilt.label));
  tiltNoteEl = el('p', { class: 'rail-note', id: 'tiltNote' });
  // (round 15a: with the view's chips, before the annotations' group)
  const annG = sec.querySelector('.ann-group'), tiltEls = [el('div', { class: 'chips' }, tiltBtn), tiltNoteEl];
  if (annG && annG.parentNode === sec) annG.before(...tiltEls); else sec.append(...tiltEls);
  if (reduce) { tiltSay('reduced'); return; }
  let kept = false;
  try { kept = localStorage.getItem(TILT_KEY) === '1'; } catch { /* not kept */ }
  if (kept) tiltKept(); else tiltSay('off');
  // (the view moved otherwise: from the engine's frames; the screen turned or the page shown again: the rest afresh; Reset all:
  // off, as at the first visit)
  box.addEventListener('diskframe', (e) => { if (e.detail && e.detail.moving) tiltBusyT = performance.now(); });
  if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', tiltAfresh); else addEventListener('orientationchange', tiltAfresh);
  document.addEventListener('visibilitychange', tiltAfresh);
  $('resetAll').addEventListener('click', () => { if (tiltOn) tiltSet(false); });
}
tiltInit();

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
  // (round 10a: the march in kicks given up for a kind, a bug of the engine's (its state could not be made, or a band was
  // given more kicks than its rays can need): written down at once)
  else if (d.k === 'split') flogAdd({ k: 'split', ok: d.ok, broken: d.broken || undefined, stuck: d.stuck, key: d.key, rows: d.rows, w: d.w, h: d.h }, true);
  // (round 10a: a piece of GPU work timed with no fence, an error of the engine's: see its GT_NOFENCE)
  else if (d.k === 'nofence') flogAdd({ k: 'nofence', w: d.w, key: d.key, gpu: d.gpu, age: d.age, late: d.late, ms: d.ms }, true);
  else if (d.k === 'sync') {
    // (a call that waited for the GPU's process over 5 ms, see the engine's slowSync: one entry for a run of the same call,
    // with their count and the longest)
    let x = null;
    for (let i = flog.e.length - 1; i >= Math.max(0, flog.e.length - 3); i--) if (flog.e[i].k === 'sync' && flog.e[i].w === d.w) { x = flog.e[i]; break; }
    if (x) { x.n = (x.n || 1) + 1; x.ms = Math.max(x.ms, r1(d.ms)); flogSoon(); } else flogAdd({ k: 'sync', w: d.w, ms: r1(d.ms), key: gc.key }, d.ms > 500);
  }
});
// (round 10a) A heartbeat a second (hb, the last HB_N): frames finished, pieces, the GPU's busy time (their sum, ms), the
// longest piece, the scale, the kind, the clock running, the model's time, the components: the seconds before a loss; and
// the dearest kick of the march in kicks (its piece's time over its kicks, ms; see the engine's SPLIT)
const hbCur = { f: 0, p: 0, busy: 0, max: 0, kick: 0 };
flog.hb = [];
setInterval(() => {
  if (document.hidden) return;
  const s0 = live() ? S() : null;
  flog.hb.push([Math.round((Date.now() - flog.t0) / 1000), hbCur.f, hbCur.p, Math.round(hbCur.busy), Math.round(hbCur.max), live() ? Math.round(box.diskScale() * 1000) / 1000 : 0, gc.key, s0 ? (s0.paused ? 0 : 1) : -1, s0 ? Math.round(s0.time) : 0, s0 ? s0.mode : 0, Math.round(hbCur.kick * 10) / 10]);
  if (flog.hb.length > HB_N) flog.hb.shift();
  hbCur.f = hbCur.p = hbCur.busy = hbCur.max = hbCur.kick = 0;
}, 1000);
// every frame summed up by its kind, no entry each (saved with the heartbeat)
box.addEventListener('diskgpu', (ev) => {
  const d = ev.detail || {}; if (!(d.ms > 0)) return;
  hbCur.f++; hbCur.p += d.bands || 1; hbCur.busy += d.ms; hbCur.max = Math.max(hbCur.max, d.band || d.ms); hbCur.kick = Math.max(hbCur.kick, d.kick || 0);
  const k = String(d.key || '').replace(/:F$/, ''), s = flog.sum[k] || (flog.sum[k] = { n: 0, ms: 0, band: 0, sc: 0, top: 0, pre: 0, first: 0 });
  s.n++; s.ms = Math.max(s.ms, Math.round(d.ms)); s.band = Math.max(s.band, Math.round(d.band)); s.sc = d.scale; s.top = Math.max(s.top, d.scale); s.pre = Math.max(s.pre, Math.round(d.pre || 0)); if (d.first) s.first++;
  // (round 10a: in kicks, the most a frame took, its dearest kick, and the dearest kick sent alone (ms))
  if (d.kicks) { s.kicks = Math.max(s.kicks || 0, d.kicks); s.kick = Math.max(s.kick || 0, d.kick || 0); s.kick1 = Math.max(s.kick1 || 0, d.kick1 || 0); }
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
    split: typeof box.diskSplit === 'function' ? (({ on, k, adapt }) => ({ on: on ? 1 : 0, k, adapt: adapt ? 1 : 0 }))(box.diskSplit()) : undefined,
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
  if (colDef) { cols = keptCols(); applyCols(); }   // (round 13a: the colours kept, as at a start without a link)
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
  // (round 17b: the panel named by its title, index.html's aria-labelledby)
  stageLog.replaceChildren(el('p', { class: 'log-title', id: 'logTitle' }, w.title), el('p', { class: 'log-note' }, w.note), pre,
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
  if (l.hb && l.hb.length) out.push('per second [s, frames, pieces, busy ms, longest ms, scale, kind, clock, time, mode, kick ms]: ' + l.hb.map((h) => '[' + h.join(',') + ']').join(' '));
  out.push(`at the end: key ${l.key} · quality ${l.q} · scale ${l.sc} · last frame +${r1((l.frT || 0) / 1000)} s · last input +${r1((l.inT || 0) / 1000)} s · last sign of life +${r1((l.alive - l.t0) / 1000)} s`);
  for (const x of l.e) { const { t, k, ...rest } = x; out.push(`+${(t / 1000).toFixed(1)} s ${k} ${f(rest)}`); }
  return out.join('\n');
}

// ---------- talks (round 11a): moves, scenes and the presenter ----------
// The owner: 「研究じゃなくていい、プレゼンに使われるといい」「視点移動アニメーションの実装かなあ」 (ver2/docs/disk-lab-roadmap.md);
// the design, ver2/docs/disk-lab-r11-camera.md; the supervisor's choices on its open questions, disk-lab-handoff.md section 6.
// "Moves and talks" in the rail (closed until opened, so that the sandbox is as the visitor knows it): the built-in moves, each
// played at once from the view as it is; the scenes (seq.js): "Add this view", renamed, reordered, removed, played, kept on this
// device, saved as a JSON file and opened again, shared as a #seq= link; and the presenter: the picture alone, full screen, the
// scenes stepped through with a clicker's keys (with no scenes of one's own, the nine places). Every flight is the engine's smooth
// path (diskPath): to the engine a flight, its frames drawn at the moving scale within the guard (moving, here), and the still on
// arrival refined to the level chosen (the ramp), as after any flight. The look the presenter chose is kept while flying (no switch
// to the model look): a scene's look, cut and line map are set before the flight where they cost less than what is shown, on
// arrival where they cost more (the guard's factors), so that no flight is dearer than both its ends. DESIGN.md, section 25.
const SEQ_KEY = KEY('disk-lab-seq'), SEQ_PREV = KEY('disk-lab-seq-prev'), HOLD_S = 3;
const seqNew = () => ({ v: SEQ_V, app: 'disk-lab', engine: '', made: '', pace: 'normal', keys: [] });
let seq = checkSeq(readJSON(SEQ_KEY)) || seqNew();
const talk = $('talk'), seqList = $('seqList');
// (review of round 11a) The pace is the presenter's, kept apart from the scenes (choosing it is not an edit of them); a link or a
// file carries it, and opening one takes it for this visit
const PACE_KEY = KEY('disk-lab-pace');
let pace = (() => { try { const v = localStorage.getItem(PACE_KEY); return Object.prototype.hasOwnProperty.call(PACES, v) ? v : seq.pace; } catch { return seq.pace; } })();
const paceK = () => PACES[pace] || 1;
// the scenes kept on this device, marked with where they came from (own, link, file); a link's fragment, once the scenes are
// changed, taken out of the address, so that a reload keeps the change
function seqKeep() {
  try { localStorage.setItem(SEQ_KEY, JSON.stringify(seq)); } catch { /* not kept: this visit's only */ }
  if (/^#seq=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
}
function seqChanged() { seqKeep(); renderTalk(); }
// (review of round 11a: SEQ_PREV was written and never read, and a pace or a rename counted as the edit that pushed one's own list
// out. Now) a list from a link or a file takes the place of the list here only after the copy (SEQ_PREV) is made, unless the copy
// already holds one's own list (seq.js, stashFor); "Restore my earlier scenes" swaps the two back
const seqPrev = () => checkSeq(readJSON(SEQ_PREV));
function seqReplace(o, src) {
  if (JSON.stringify(o.keys) === JSON.stringify(seq.keys)) return;   // (the same list again, as a reload of its link)
  const prev = seqPrev(), keep = stashFor(seq, prev);
  try { if (keep && keep !== prev) localStorage.setItem(SEQ_PREV, JSON.stringify(keep)); } catch { /* not kept */ }
  stopPlay();
  seq = { ...o, src };
  pace = o.pace || pace;   // (for this visit; the pace kept on the device is the presenter's own choice)
  seqChanged();
}
function seqRestore() {
  const prev = seqPrev();
  if (!prev) return;
  stopPlay();
  try { if (seq.keys.length) localStorage.setItem(SEQ_PREV, JSON.stringify(seq)); else localStorage.removeItem(SEQ_PREV); } catch { /* not kept */ }
  seq = prev; seqChanged(); note(T().talk.restored);
}
const seqOut = () => ({ ...seq, pace, engine: ENGINE_SRC.split('v=')[1], made: new Date().toISOString().slice(0, 10) });
// a scene of a place, as goPlace sets it (its distance fitted to the stage now; round 11b: or to a video's frame, asp)
function placeScene(i, asp = aspect()) {
  const pl = PLACES[i], st = placeStateNow(pl, asp);
  return { label: T().places[pl.id].title, place: pl.id, aspect: asp, view: pick(st, VIEW_KEYS), look: st.look, set: pick(st, ['mode', 'field', 'slice', 'sq', 'planets']) };
}
// what is played or presented: the scenes, or with none, the places
const scenes = () => (seq.keys.length ? seq.keys : live() ? PLACES.map((_, i) => placeScene(i)) : []);

// The flight under way to a scene, { id, done(arrived) }: its end told by the engine ('diskpath': arrived, or left)
let flying = null;
box.addEventListener('diskpath', (e) => {
  const d = e.detail || {};
  if (!flying || d.id !== flying.id || d.state === 'start') return;
  const f = flying; flying = null; f.done(d.state === 'arrive'); armIdle();   // (round 11a: the idle rest waits for no flight now)
});
const leaveFlight = () => { if (flying) { const f = flying; flying = null; f.done(false); } };
// To a scene (or a move's leg, a scene of some parts): what is shown, the planets and the options set first (they fade in or out
// as it goes; a planet followed must be there), the look, cut and line map before if cheaper and on arrival if dearer, the
// camera on its path, the clock (paused or running, its speed) on arrival. The clock's time is not set live: a jump of the eddies
// and the planet on arrival (it is kept in the scene for the video export to come). Resolves true on arrival, false when left
// (another scene, a drag, the wheel, a key, a lost context). cut, or reduced motion: there at once, no flight
function flyTo(k, { cut = false } = {}) {
  leaveFlight();
  if (!live() || 'lost' in lab.dataset) return Promise.resolve(false);
  const p = sceneParts(k, S(), aspect());
  if (p.look !== S().look) flogAdd({ k: 'set', look: p.look, path: 1 });   // (the flight record: see setLook)
  if (Object.keys(p.before).length) box.diskSet(p.before);
  if (quality !== 'auto') relaxGuard();
  const setLooks = () => { guardSwitch(keyOf({ ...S(), look: p.look, coMode: p.coMode, slice: p.slice })); if (Object.keys(p.lookSet).length) box.diskSet(p.lookSet); };
  if (!p.later) setLooks();
  const arrive = () => {
    if (p.later) setLooks();
    if (p.clock) box.diskSet(p.clock);
    if (k.place) { const i = PLACES.findIndex((pl) => pl.id === k.place); if (i >= 0) { placeI = i; target = { ...S(), time: S().time }; renderPlace(); } }
    sync();
  };
  if (cut || reduce) { box.diskSet({ ...p.view, fly: 0 }); arrive(); return Promise.resolve(true); }
  moving();   // (the lighter picture at once: a still being refined is left before the first moving frame, as a drag leaves it)
  // (the pace scales a move's own time too, the orbit's 24 s and the rise's 6 s: review of round 11a)
  const mv = k.move || {}, r = box.diskPath(p.view, { speed: paceK() * (mv.speed || 1), dur: mv.dur && mv.dur / paceK(), turns: mv.turns });
  return new Promise((resolve) => { flying = { id: r.id, done: (ok) => { if (ok) arrive(); else sync(); resolve(ok); } }; });
}
// (round 11b: shared by a flight to a scene, flyTo, and a video's, see exEvent) A scene's parts in the order they are set, from the
// state s0 it is left from and the frame's width / height asp: what is shown, the planets and the options first (they fade in or out
// as it goes; a planet followed must be there; a video leaves out the background: on black), the look, cut and line map (later: on
// arrival, where they cost more than what is shown; else before the flight), the view, the clock (on arrival)
function sceneParts(k, s0, asp, video = false) {
  const set = k.set || {}, look = k.look || s0.look, coMode = k.coMode || s0.coMode;
  const slice = look !== 'model' ? 0 : set.slice != null ? set.slice : s0.slice;
  const later = factorOf(keyOf({ ...s0, look, coMode, slice })) > factorOf(keyOf(s0));
  // (only what changes: a cut set again, as it is, would end a flight under way, and a look set again would dip)
  const lookSet = { ...(look !== s0.look ? { look } : {}), ...(coMode !== s0.coMode ? { coMode } : {}), ...(slice !== s0.slice ? { slice } : {}), ...(k.coV != null ? { coV: k.coV } : {}), ...(set.sq ? { sq: set.sq } : {}) };
  const before = {};
  for (const x of ['planets', 'mode', 'field', 'ann', 'marks', 'waves', 'asym', 'ms', ...(video ? [] : ['bg'])]) if (set[x] != null) before[x] = set[x];
  let clock = null;
  if (k.clock) { clock = {}; if (k.clock.paused != null) clock.paused = k.clock.paused; if (k.clock.speed != null) clock.speed = k.clock.speed; }
  return { look, coMode, slice, later, lookSet, before, view: sceneView(k, asp), clock };
}
// (a frame narrower than the stage the scene was made on: the camera moved back, as the places are fitted; the field of view is
// vertical. Round 18a: a view without a roll, a scene made before it or a move's leg set apart, is unrolled)
function sceneView(k, asp) {
  const view = { roll: 0, ...k.view };
  if (view.d && k.aspect && asp < k.aspect - 1e-3) view.d = Math.min(600, Math.round(view.d * k.aspect / asp * 1000) / 1000);
  return view;
}

// The built-in moves (the design's section 4), one click each, from the view as it is: legs flown one after another with no rest
// between, or the clock or the look changed with the camera held. Pressed again, or another move, a scene, the presenter or a
// drag: stopped where it is
const MOVES = ['orbit', 'rise', 'powers', 'planet', 'timelapse', 'looks'];
const TIMELAPSE = { speed: 10, ms: 10000 }, LOOK_MS = 4000, LOOK_TOUR = ['model', 'optical', 'mir', 'mm'];
let playToken = 0, playing = '', timeLapse = null;   // playing: a move's name, 'play' (the scenes one after another), or ''
const sleepers = new Set();
const sleep = (ms) => new Promise((r) => { const w = () => { clearTimeout(t); sleepers.delete(w); r(); }; const t = setTimeout(w, ms); sleepers.add(w); });
// what plays, stopped: its waits woken, its flight left (where the camera is, unless a flight to a scene takes over), the clock
// given back from a time-lapse
function stopPlay(grab = true) {
  playToken++;
  for (const w of [...sleepers]) w();
  if (flying) { leaveFlight(); if (grab && live()) box.diskPath(false); }
  endTimeLapse();
  if (playing) playEnd();
}
// (review of round 11a) what played has ended: the idle rest armed again (none while playing or flying), the look the tour started
// from forgotten
function playEnd() { playing = ''; tourLook = ''; renderTalk(); armIdle(); }
// (review of round 11a) the settings kept on the device while a move holds the clock or the look: the speed before a time-lapse and
// the look a tour of the looks started from, so that a reload meanwhile does not start the next visit at x10 or in another look
let tourLook = '';
function talkHeld(o) { if (timeLapse && o.speed != null) o.speed = timeLapse.speed; if (tourLook && o.look != null) o.look = tourLook; return o; }
function endTimeLapse() {
  const tl = timeLapse; timeLapse = null;
  if (!tl || !live()) return;
  // (the clock as it was, unless it was changed meanwhile)
  if (Math.abs(S().speed - TIMELAPSE.speed) < 1e-6) box.diskSpeed(tl.speed);
  if (tl.paused && !S().paused) box.diskPlay(false);
  sync();
}
// each move's legs, from the state now. Orbit: one turn round the point looked at, at the elevation and distance as they are, 24
// s (15 degrees a second); rise: to edge-on (2 degrees), then up to face-on (89) in 6 s; powers (of ten): out to afar (340 au, the
// envelope on), then in to the star (0.15 au), some 10 s at the normal pace; planet: out to the disk's edge on the planet's side,
// following it (the point looked at 17 au outside it, 40 au away), then in to the planet's place, van Wijk's arc turning round to
// its view. The camera holds for the clock's time-lapse (10 times, 10 s) and the looks in turn (the model's, visible, mid-infrared,
// millimetre, 4 s each, back to the look before). (Round 11b: asp, a video's frame's width / height, for the planet's place)
function moveLegs(name, asp = aspect()) {
  const s = S();
  if (name === 'orbit') return [{ view: {}, move: { dur: 24, turns: 1 } }];
  if (name === 'rise') return [...(Math.abs(s.el - 2) > 1 ? [{ view: { el: 2 } }] : []), { view: { el: 89 }, move: { dur: 6 } }];
  if (name === 'powers') return [{ view: { p: 0, el: 14, az: s.az, d: 340, tx: 0, ty: 0, tz: 0 }, set: { mode: s.mode | 32 } }, { view: { el: 22, d: 0.15 } }];
  if (name === 'planet') {
    const st = placeStateNow(placeById('planet'), asp);
    return [{ view: { p: 1, pi: 0, el: 16, az: 0, d: 40, tx: 17, ty: 0, tz: 0 }, set: { mode: st.mode, planets: st.planets } }, { view: pick(st, VIEW_KEYS) }];
  }
  return [];
}
async function runMove(name) {
  if (!live()) return;
  const again = playing === name;
  stopPlay();
  if (again || !MOVES.includes(name)) return;
  const token = playToken;
  playing = name; renderTalk(); flogAdd({ k: 'set', move: name });
  if (name === 'timelapse') {
    const s0 = S(); timeLapse = { speed: s0.speed, paused: !!s0.paused };
    box.diskSet({ paused: 0, speed: TIMELAPSE.speed }); sync();
    await sleep(TIMELAPSE.ms / paceK());   // (the pace scales the moves' own times too: review of round 11a)
    if (token === playToken) endTimeLapse();
  } else if (name === 'looks') {
    const order = LOOK_TOUR.filter((k) => k !== S().look).concat(S().look);
    tourLook = S().look;
    for (let i = 0; i < order.length && token === playToken; i++) { setLook(order[i]); if (i < order.length - 1) await sleep(LOOK_MS / paceK()); }
  } else {
    for (const leg of moveLegs(name)) if (token !== playToken || !(await flyTo(leg))) break;
  }
  if (token === playToken) playEnd();
}
// the scenes one after another (with none of one's own, the places), each held HOLD_S (its own hold, if it has one) once there
async function playScenes() {
  const again = playing === 'play';
  stopPlay();
  if (again || !live()) return;
  const token = playToken, list = scenes();
  playing = 'play'; renderTalk();
  for (let i = 0; i < list.length && token === playToken; i++) {
    sceneI = i; renderSeq();
    if (!(await flyTo(list[i])) || token !== playToken) break;
    if (i < list.length - 1) await sleep(1000 * (list[i].hold ?? HOLD_S));
  }
  if (token === playToken) playEnd();
}

// The presenter (the design's section 5.2; for laptops and desktops, the owner's choice: phones are the audience's): the stage
// alone, full screen where the browser allows it (else the window), the watermark kept. → ↓ Page Down Enter the next scene,
// ← ↑ Page Up Backspace the one before, Home and End the first and the last, Space the clock, B or . a black screen, F full
// screen again, Esc out (the browser's own Esc leaves full screen, and the presenter with it). The keys are taken before the
// canvas's (a capture on the window), so that its Space, arrows and B (the outburst) do not act as well, and a clicker's F5 (its
// "start the slides") does not reload the page in a talk. A drag still turns the view, and the next press flies on from where it
// is. A second press within 0.4 s of the one before, while flying: there at once. The idle rest is off while presenting; the
// screen is kept awake where the browser can (Screen Wake Lock).
let presenting = false, sceneI = -1, sceneMoved = false, lastPress = 0, wasFull = false, hudT = 0, ctlT = 0, wakeLock = null;
const presentHud = $('presentHud');
const fullEl = () => document.fullscreenElement || document.webkitFullscreenElement || null;
function fullscreen(on) {
  const de = document.documentElement, f = on ? de.requestFullscreen || de.webkitRequestFullscreen : document.exitFullscreen || document.webkitExitFullscreen;
  if (!f || !!fullEl() === on) return;
  try { const p = f.call(on ? de : document, on ? { navigationUI: 'hide' } : undefined); if (p && p.catch) p.catch(() => {}); } catch { /* the window, then */ }
}
function present(on) {
  on = !!on;
  if (on === presenting || (on && !live())) return;
  stopPlay();
  presenting = on; sceneI = -1; sceneMoved = false;
  lab.toggleAttribute('data-present', on); flogAdd({ k: 'set', present: on ? 1 : 0 });
  // (the focus off the rail's button: Space or Enter must not press a hidden button meanwhile)
  if (on && document.activeElement && document.activeElement !== document.body && document.activeElement.blur) document.activeElement.blur();
  if (on) { fullscreen(true); fullOnce = true; clearTimeout(idleTimer); keepAwake(true); hud(T().talk.presentHint, ''); }
  else { fullscreen(false); black(false); keepAwake(false); hud('', ''); armIdle(); $('presentBtn').focus({ preventScroll: true }); }
  renderTalk();
}
// (review of round 11a) Opened by ?present=1, the presenter asks for full screen with no gesture, and the browser refuses: its first
// key or press then asks once more, as a gesture of the visitor's
let fullOnce = false;
const fullAgain = () => { if (presenting && fullOnce && !fullEl()) { fullOnce = false; fullscreen(true); } };
window.addEventListener('pointerdown', fullAgain, { capture: true, passive: true });
for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(ev, () => {
  const full = !!fullEl();
  if (presenting && wasFull && !full) present(false);   // (the browser's Esc left full screen: the presenter too)
  wasFull = full && presenting;
});
function black(on) { lab.toggleAttribute('data-black', !!on); }
// the scene's name and its number, for 4 s
function hud(caption, count) {
  $('presentCap').textContent = caption; $('presentN').textContent = count;
  presentHud.classList.toggle('on', !!(caption || count));
  clearTimeout(hudT);
  if (caption || count) hudT = setTimeout(() => presentHud.classList.remove('on'), 4000);
}
async function keepAwake(on) {
  try {
    if (on && !wakeLock && navigator.wakeLock && document.visibilityState === 'visible') { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
    else if (!on && wakeLock) { const w = wakeLock; wakeLock = null; await w.release(); }
  } catch { wakeLock = null; }
}
document.addEventListener('visibilitychange', () => { if (presenting && !document.hidden) keepAwake(true); });
function goScene(i) {
  const list = live() ? scenes() : [];
  if (!list.length) return;
  i = Math.max(0, Math.min(list.length - 1, i));
  const now = performance.now();
  if (i === sceneI && !sceneMoved && !flying) { if (i === list.length - 1) hud(T().talk.last, `${i + 1} / ${list.length}`); return; }
  const cut = !!flying && now - lastPress < 400;
  lastPress = now; sceneI = i; sceneMoved = false;
  if (playing || timeLapse) stopPlay(false);   // (a move or the autoplay left; its flight taken over by this one)
  hud(list[i].label || T().talk.viewN(i + 1), `${i + 1} / ${list.length}`);
  renderSeq();
  flyTo(list[i], { cut }).then((ok) => { if (!ok && sceneI === i) sceneMoved = true; });
}
window.addEventListener('keydown', (e) => {
  if (!presenting || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key !== 'Escape') fullAgain();   // (not on the key that leaves)
  // (review of round 11a: a corner button reached with Tab keeps its Enter and Space: they press it, not the next scene)
  if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.closest && e.target.closest('.present-ctl')) return;
  const k = e.key, step = { ArrowRight: 1, ArrowDown: 1, PageDown: 1, Enter: 1, ArrowLeft: -1, ArrowUp: -1, PageUp: -1, Backspace: -1 }[k];
  let used = true;
  if (e.repeat && (step || k === ' ' || k === 'q' || k === 'Q')) { /* (a key held: one step) */ }
  else if (qrOpen() && (k === 'Escape' || k === 'q' || k === 'Q')) qrClose();   // (round 11c: the code closed first)
  else if (step) { qrClose(); goScene(sceneI + step); }
  else if (k === 'Home') { qrClose(); goScene(0); }
  else if (k === 'End') { qrClose(); goScene(scenes().length - 1); }
  else if (k === ' ') { if (live()) playBtn.click(); }
  else if (k === 'b' || k === 'B' || k === '.') black(!lab.hasAttribute('data-black'));
  else if (k === 'Escape') present(false);
  else if (k === 'f' || k === 'F') fullscreen(true);
  else if (k === 'q' || k === 'Q') qrShow(true);   // (round 11c: a QR code of the scene's link, for the audience)
  else if (k === 'F5') { /* (a clicker's "start the slides": no reload in a talk) */ }
  else used = false;
  if (used) { e.preventDefault(); e.stopPropagation(); }
}, { capture: true });
// (a drag or the wheel on the picture: the scene left, the next press flies to it again; the buttons in the corner, for a mouse,
// shown while it moves, and the cursor hidden when it rests)
stage.addEventListener('pointerdown', (e) => { if (presenting && e.target === box.querySelector(':scope > canvas')) sceneMoved = true; }, { capture: true, passive: true });
stage.addEventListener('wheel', () => { if (presenting) sceneMoved = true; }, { capture: true, passive: true });
stage.addEventListener('pointermove', () => {
  if (!presenting) return;
  lab.dataset.pointer = ''; clearTimeout(ctlT); ctlT = setTimeout(() => { delete lab.dataset.pointer; }, 2500);
}, { passive: true });
$('presentPrev').addEventListener('click', () => goScene(sceneI - 1));
$('presentNext').addEventListener('click', () => goScene(sceneI + 1));
$('presentExit').addEventListener('click', () => present(false));

// the rail's part: the moves and the pace (made here, named in words.js), the scenes' list and its buttons
// (with reduced motion no orbit and no time-lapse: there are no flights, and the clock does not run)
const moveButtons = MOVES.filter((m) => !reduce || (m !== 'orbit' && m !== 'timelapse')).map((m) => { const b = el('button', { type: 'button', class: 'chip', 'data-move': m, 'aria-pressed': 'false' }); $('moveGroup').append(b); return b; });
const paceButtons = Object.keys(PACES).map((k) => { const b = el('button', { type: 'button', 'data-pace': k, 'aria-pressed': 'false' }); $('paceGroup').append(b); return b; });
let clearAt = -1e9;
function renderTalk() {
  const w = T().talk;
  moveButtons.forEach((b) => { b.textContent = w.moves[b.dataset.move]; pressed(b, playing === b.dataset.move); });
  paceButtons.forEach((b) => { b.textContent = w.pace[b.dataset.pace]; pressed(b, pace === b.dataset.pace); });
  $('paceGroup').setAttribute('aria-label', w.pace.label);
  $('seqPlay').textContent = playing === 'play' ? w.stop : w.play;
  $('seqClear').textContent = performance.now() - clearAt < 4000 ? w.clearAgain : w.clear;
  $('seqClear').disabled = !seq.keys.length;
  renderSeq();
  renderExport();   // (round 11b)
}
function renderSeq() {
  const w = T().talk, n = seq.keys.length, cur = presenting || playing === 'play' ? sceneI : -1;
  $('seqRestore').hidden = !seqPrev();   // (review of round 11a: "Restore my earlier scenes" while the copy holds a list)
  // (review of round 11a: a scene being renamed is not made again under the typing (the autoplay's next scene, a move's end, the
  // second press of "Remove all"): with the same rows, only which one is current changes)
  if (seqList.contains(document.activeElement) && seqList.children.length === n) {
    [...seqList.children].forEach((li, i) => { if (i === cur) li.setAttribute('aria-current', 'true'); else li.removeAttribute('aria-current'); });
    return;
  }
  seqList.replaceChildren(...seq.keys.map((k, i) => el('li', { class: 'seq-row', 'aria-current': i === cur ? 'true' : null },
    el('span', { class: 'n', 'aria-hidden': 'true' }, String(i + 1)),
    el('input', { type: 'text', value: k.label || '', placeholder: w.viewN(i + 1), maxlength: '80', 'aria-label': w.nameOf(i + 1), 'data-seq-name': String(i) }),
    el('button', { type: 'button', class: 'icon-chip', 'data-seq-up': String(i), 'aria-label': w.up(i + 1), disabled: i === 0 }, '↑'),
    el('button', { type: 'button', class: 'icon-chip', 'data-seq-down': String(i), 'aria-label': w.down(i + 1), disabled: i === n - 1 }, '↓'),
    el('button', { type: 'button', class: 'icon-chip', 'data-seq-remove': String(i), 'aria-label': w.remove(i + 1) }, '×'),
    el('button', { type: 'button', class: 'chip quiet', 'data-seq-go': String(i), 'aria-label': w.goTo(i + 1) }, w.go))));
  $('seqNone').hidden = n > 0;
}
// the view as it is, a scene: named after the place if the view has not left it (else "View n" until named)
function addView() {
  if (!live()) return;
  if (seq.keys.length >= SEQ_MAX) { note(T().talk.full(SEQ_MAX)); return; }
  const at = away() ? null : PLACES[placeI].id, k = keyFrom(S(), { label: at ? T().places[at].short : '', place: at, aspect: aspect() });
  if (k) { seq.keys.push(k); seqChanged(); }
}
function moveKey(i, by) {
  const j = i + by;
  if (j < 0 || j >= seq.keys.length) return;
  [seq.keys[i], seq.keys[j]] = [seq.keys[j], seq.keys[i]]; seqChanged();
}
// "Remove all": a second press within 4 s
function seqClear() {
  if (!seq.keys.length) return;
  if (performance.now() - clearAt > 4000) { clearAt = performance.now(); renderTalk(); setTimeout(renderTalk, 4100); return; }
  clearAt = -1e9; seq.keys = []; seqChanged();
}
function seqSave() {
  const out = seqOut(), a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' })), download: `disk-lab-scenes-${out.made}.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function seqLink() {
  const u = new URL(location.pathname, location.href); u.searchParams.set('lang', L());
  const href = u.href + await seqToHash(seqOut()), field = $('seqLinkField');
  try { await navigator.clipboard.writeText(href); field.hidden = true; note(T().talk.linkCopied); }
  catch { field.value = href; field.hidden = false; field.focus(); field.select(); note(T().linkShown, 4000); }
}
// a link's scenes (#seq=), at the start and when the fragment changes: shown, the section opened; the list here kept in the copy
// first (seqReplace)
async function seqOpenHash() {
  if (!/^#seq=/.test(location.hash) || !live()) return;
  const o = await seqFromHash(location.hash);
  if (!o || !o.keys.length) { note(T().talk.linkFailed, 4000); return; }
  seqReplace(o, 'link'); talk.open = true; renderTalk();
  note(T().talk.fromLink(o.keys.length), 5000);
}
window.addEventListener('hashchange', seqOpenHash);
talk.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.move) runMove(b.dataset.move);
  else if (b.dataset.pace) { pace = b.dataset.pace; try { localStorage.setItem(PACE_KEY, pace); } catch { /* this visit's only */ } renderTalk(); }
  else if (b.id === 'seqRestore') seqRestore();
  else if (b.dataset.seqUp != null) moveKey(Number(b.dataset.seqUp), -1);
  else if (b.dataset.seqDown != null) moveKey(Number(b.dataset.seqDown), 1);
  else if (b.dataset.seqRemove != null) { seq.keys.splice(Number(b.dataset.seqRemove), 1); seqChanged(); }
  else if (b.dataset.seqGo != null) { stopPlay(); const i = Number(b.dataset.seqGo); if (seq.keys[i]) { sceneI = i; flyTo(seq.keys[i]); } }
  else if (b.id === 'seqAdd') addView();
  else if (b.id === 'seqPlay') playScenes();
  else if (b.id === 'presentBtn') present(true);
  else if (b.id === 'seqSave') seqSave();
  else if (b.id === 'seqLoad') $('seqFile').click();
  else if (b.id === 'seqLink') seqLink();
  else if (b.id === 'seqClear') seqClear();
});
// a scene renamed: kept as it is typed (review of round 11a: on 'change' only, a name being typed was lost when the list was made
// again under it), the list not made again, the field keeps its focus
const seqName = (e) => {
  const t = e.target, k = t.dataset && t.dataset.seqName != null ? seq.keys[Number(t.dataset.seqName)] : null;
  if (!k) return;
  const v = t.value.trim().slice(0, 80);
  if (v) k.label = v; else delete k.label;
  seqKeep();
};
talk.addEventListener('input', seqName); talk.addEventListener('change', seqName);
$('seqFile').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  let o = null;
  try { if (f.size < 1 << 20) o = checkSeq(JSON.parse(await f.text())); } catch { o = null; }
  if (!o || !o.keys.length) { note(T().talk.loadFailed, 4000); return; }
  seqReplace(o, 'file'); note(T().talk.loaded(o.keys.length));
});

// ---------- the video (round 11b): the scenes or a move, a frame at a time on the engine's own clock ----------
// The design, ver2/docs/disk-lab-r11-camera.md, section 7; the supervisor's choices for the owner, DESIGN.md section 26. An MP4 file
// (H.264 through WebCodecs' VideoEncoder, the page's own writer, mp4.js) of the scenes in order (with none of one's own, the places),
// a hold at each and the flights between them along the engine's path, or of one of the moves; for slides, so: each frame drawn at the
// quality chosen (its level's scale, the still's, never the moving one; its pictures averaged, EX_SUB), not in real time, on black,
// with the mark and the credit burned in. The page owns the clock meanwhile (the engine's diskManual): for each frame the clocks move
// on by 1 / fps (diskAdvance: the model's at the scene's speed, the flights, the fades, the look's dip), what the frame begins with is
// set (a flight's departure, an arrival, the clock, a look: in the presenter's order, sceneParts), and the frame is drawn at the
// video's size (diskOut) through the snapshot, in bands and kicks within the guard's budget, each waited for; nothing else draws
// meanwhile (the animation frames wait while a snapshot runs, and the next snapshot starts in the same task as the last one's end).
// The flights' times are planned before the first frame (diskPathPlan) and flown in that time (diskPath's dur), so that the frames
// are counted first: the estimate, the limits, the progress. Cancel, the end, or a failure put the page back as it was: the clock on
// the wall again, the canvas at the box's size, the state (the view, the look, what is shown, the clock and its time), the scale.
// For laptops and desktops, as the presenter (not on phones and tablets); not with reduced motion, where the engine cuts the flights.
const EX_SIZE = { 720: [1280, 720], 1080: [1920, 1080], 2160: [3840, 2160] }, EX_FPS = [30, 60], EX_HOLD = [2, 3, 5];
// (the frame's stage, CSS pixels high: the lines, labels and the scale bar as on a laptop's stage, 720 / 1080 / 2160 rows at 1, 1.5, 3
// pixels a CSS pixel, whatever the window: the same video from any window)
const EX_CSS_H = 720;
// (the pictures averaged a frame, by the level: the design's Draft 1, Good 4, Best 8 (its section 7.2), Low and Medium between; Auto
// draws at its still's scale, 1, as Best)
const EX_SUB = { low: 1, mid: 2, high: 4, full: 8 };
// (bits a second at 30 and 60 frames a second, variable: dark gradients band at low rates in 8-bit 4:2:0 (the design's 7.2); and the
// H.264 level each size and rate needs (3.1 / 3.2, 4.0 / 4.2, 5.1 / 5.2: the macroblocks a frame and a second), High profile, else
// Main, else Constrained Baseline where the browser has no High)
const EX_RATE = { 720: [8e6, 12e6], 1080: [16e6, 24e6], 2160: [50e6, 80e6] }, EX_LEVEL = { 720: ['1f', '20'], 1080: ['28', '2a'], 2160: ['33', '34'] };
// (the limits: the encoded frames are kept in memory until the file is written, a 60 s clip at 4K and 60 a second some 600 MB; a
// plan over EX_MAX_BYTES at its rate is refused, and one whose frames come to more than EX_MAX_BYTES * 1.25 in fact is stopped. And
// at most EX_MAX_FRAMES frames, 4 minutes at 30 a second: a talk's clip is seconds to a minute or two, and at Best a job of thousands
// of frames runs for hours, in a tab that must stay in front, with no way yet to take it up again after a lost context)
const EX_MAX_FRAMES = 7200, EX_MAX_BYTES = 1.5e9, EX_KEY_S = 2;
// (a flight planned for f frames is flown in a hair less, so that the frame at its end is the arrival itself whatever the rounding of
// the clock's milliseconds: the path's own end, the state's view exactly)
const EX_EPS = 1e-4;
// (a look's frame against the model's at the same scale, for the estimate: DESIGN.md section 22's table at scale 0.5, M1 Max)
const EX_RATIO = { model: 1, mm: 0.3, optical: 19, mir: 9.5, 'co:chan': 8, 'co:m1': 37, 'co:m0': 37 };
const VIDEO_OK = typeof VideoEncoder === 'function' && typeof VideoFrame === 'function';
const EX_SET = KEY('disk-lab-video'), exOpt = { what: 'scenes', size: '1080', fps: 30, hold: 3 };
try { const v = JSON.parse(sessionStorage.getItem(EX_SET) || 'null'); if (v && EX_SIZE[v.size] && EX_FPS.includes(v.fps) && EX_HOLD.includes(v.hold)) Object.assign(exOpt, { size: v.size, fps: v.fps, hold: v.hold }); } catch { /* the defaults */ }
const exSupport = {};   // (the encoder's configuration for a size and rate, or null: VideoEncoder.isConfigSupported, asked once)
const EX_CANCEL = { cancelled: true };
const exAbout = (s) => T().video.about(s);

// The video's plan, from the choices and the state now: its frames, and what happens at which (events in order: 'start' at 0, a
// flight's 'leave' and its 'arrive', the 'clock', a 'look'). Each flight's time from the engine's plan of its path (diskPathPlan),
// rounded to whole frames; a hold to whole frames of the chosen length (a scene's own hold, if it has one, as Play takes it).
function exPlan(o = exOpt) {
  const size = String(o.size), fps = Number(o.fps), [w, h] = EX_SIZE[size] || [], out = { what: o.what, size, w, h, fps, hold: Number(o.hold), ok: false, why: 'none', frames: 0 };
  if (!w || !EX_FPS.includes(fps) || !live() || typeof box.diskPathPlan !== 'function') return out;
  const asp = w / h, lim = box.diskSnapMax(), m = Math.min(lim.limits.texture, lim.limits.renderbuffer, lim.limits.viewport, 8192);
  Object.assign(out, { asp, px: h / EX_CSS_H, outPx: w * h, screenPx: Math.max(1, canvasMpx() * 1e6) });
  if (w > m || h > m) return { ...out, why: 'gpu' };
  const level = quality === 'auto' ? 'full' : quality;
  Object.assign(out, { level, scale: QUALITY[level] || 1, sub: EX_SUB[level] || 8 });
  const holdS = Math.max(0, out.hold || 0), F = (s) => Math.max(0, Math.round(s * fps)), ev = [], add = (at, e) => { e.at = at; ev.push(e); return e; };
  const speedOf = (mv) => paceK() * ((mv && mv.speed) || 1);   // (the pace apart from the scenes: review of round 11a)
  const kinds = [];   // (the look at each event, for the estimate and the gas line's scale)
  let n = 0;
  const fly = (k, prev, view) => {
    const mv = k.move || {}, sp = speedOf(mv), d = box.diskPathPlan(prev, view, { speed: sp, dur: mv.dur && mv.dur / paceK(), turns: mv.turns }).dur;
    const lv = add(n, { do: 'leave', k, f: F(d), speed: sp, turns: mv.turns });
    n += lv.f;
    add(n, { do: 'arrive', leave: lv });
  };
  if (o.what === 'scenes') {
    const list = seq.keys.length ? seq.keys : PLACES.map((_, i) => placeScene(i, asp));
    if (!list.length) return out;
    out.scenes = list.length; out.own = seq.keys.length > 0;
    let prev = sceneView(list[0], asp);
    add(0, { do: 'start', k: list[0] });
    kinds.push([0, list[0]]);
    n += F(list[0].hold ?? holdS);
    for (let i = 1; i < list.length; i++) {
      const v = sceneView(list[i], asp);
      fly(list[i], prev, v);
      kinds.push([n, list[i]]);
      n += F(list[i].hold ?? holdS);
      prev = { ...prev, ...v };
    }
  } else if (MOVES.includes(o.what) && !(reduce && (o.what === 'orbit' || o.what === 'timelapse'))) {
    add(0, { do: 'start' });
    const s = S();
    // (the moves' own times scaled by the pace, as the live moves are: the integration's review of round 11a)
    if (o.what === 'timelapse') { add(0, { do: 'clock', set: { paused: 0, speed: TIMELAPSE.speed } }); n += F(TIMELAPSE.ms / 1000 / paceK()); add(n, { do: 'clock', back: true }); }
    else if (o.what === 'looks') {
      const order = LOOK_TOUR.filter((k) => k !== s.look).concat(s.look);
      order.forEach((look, i) => { add(n, { do: 'look', look }); kinds.push([n, { look }]); if (i < order.length - 1) n += F(LOOK_MS / 1000 / paceK()); });
    } else {
      let prev = pick(s, VIEW_KEYS);
      for (const leg of moveLegs(o.what, asp)) { const v = { ...prev, ...leg.view }; fly(leg, prev, v); prev = v; }
    }
    n += F(holdS);
  } else return out;
  // (the last event's frame is the video's: an arrival at its end, with no hold after, is shown)
  n = Math.max(n, ...ev.map((e) => e.at + 1));
  Object.assign(out, { frames: n, seconds: n / fps, events: ev, rate: EX_RATE[size][fps === 60 ? 1 : 0] });
  out.bytes = Math.round(out.rate * out.seconds / 8);
  // (the gas line's look at a size over the screen's pixels: its volume drawn at most at the screen's pixels, as a saved picture of it
  // is (a moment map at 4K lost the WebGL context, DESIGN.md section 21): the whole video at that scale, so that its sharpness does not
  // change from one scene to the next)
  const coIn = kinds.some(([, k]) => (k.look || S().look) === 'co') || (o.what !== 'scenes' && S().look === 'co');
  out.scaleUsed = coIn ? Math.min(out.scale, Math.round(100 * Math.sqrt(out.screenPx / out.outPx)) / 100) : out.scale;
  // (round 11b: the visible or mid-infrared look in it at High or Best: slow, a frame tens of seconds (the panel says so; a note,
  // not a refusal). The first measure, 1080p at Best, made no frame in 14 minutes: DESIGN.md section 26)
  const lookIn = (l) => kinds.some(([, k]) => (k.look || S().look) === l) || (!kinds.length && S().look === l);
  out.slow = (lookIn('optical') || lookIn('mir')) && (level === 'high' || level === 'full');
  // (the estimate: each stretch of frames at what a frame of its look costs; an estimate, measured as the frames come)
  let t = 0;
  const marks = kinds.length ? kinds : [[0, {}]];
  marks.forEach(([at, k], i) => { const to = i + 1 < marks.length ? marks[i + 1][0] : n, s0 = S(); t += (to - at) * exCost(keyOf({ ...s0, look: k.look || s0.look, coMode: k.coMode || s0.coMode, slice: (k.look || s0.look) === 'model' && k.set && k.set.slice != null ? k.set.slice : 0 }), out); });
  out.estimate = t;
  out.why = n < 1 ? 'none' : n > EX_MAX_FRAMES ? 'long' : out.bytes > EX_MAX_BYTES ? 'big' : '';
  out.ok = !out.why;
  return out;
}
// what a frame of the video should cost (s): a frame of its look at scale 1 on this device (the guard's measure of what is drawn now,
// else the model's times the look's ratio, EX_RATIO), at the video's pixels and scale, times the pictures averaged, with a little for
// the read back, the overlay and the encoder
function exCost(kind, p) {
  const base = modelC1 > 0 ? modelC1 : gc.c1 / factorOf(gc.key), k = kind.replace(/:cut$/, '');
  const c1 = (kind === gc.key && gc.measured ? gc.c1 : base * (EX_RATIO[k] || 1) * (/:cut$/.test(kind) ? CUT_F : 1)) / GPUX;
  return p.sub * c1 * (p.outPx / p.screenPx) * p.scaleUsed * p.scaleUsed / 1000 + 0.04 + 2e-8 * p.outPx;
}
// the bands a frame's volume is drawn in, at least (the engine adds what its guard asks for, and cuts more where a band runs long):
// as a saved picture's, from the guard's measure of the look asked for and the one before it (the engine draws that one through the
// look's dip, 300 ms), at the video's pixels and scale
function exBands(p) {
  const s = S(), kinds = [keyOf(s), exporting && exporting.kind0 || keyOf(s)];
  const c1 = Math.max(...kinds.map((k) => (k === gc.key && gc.measured ? gc.c1 : (modelC1 > 0 ? modelC1 : gc.c1) * factorOf(k)) / GPUX));
  const cost = c1 * (p.outPx / p.screenPx) * p.scaleUsed * p.scaleUsed;
  return Math.min(64, Math.max(1, Math.ceil(UNEVEN * cost / (GUARD_MS / GPUX))));
}
// the encoder's configuration for a size and rate, as the browser says it can: High, else Main, else Constrained Baseline; with the
// rate control and latency asked for, else without them (null: none)
async function exConfig(size, fps) {
  const key = size + '@' + fps;
  if (key in exSupport) return exSupport[key];
  let got = null;
  if (VIDEO_OK && typeof VideoEncoder.isConfigSupported === 'function') {
    const [w, h] = EX_SIZE[size], lv = EX_LEVEL[size][fps === 60 ? 1 : 0], bitrate = EX_RATE[size][fps === 60 ? 1 : 0];
    outer: for (const prof of ['6400', '4d00', '42e0']) {
      for (const more of [{ bitrateMode: 'variable', latencyMode: 'quality' }, {}]) {
        const c = { codec: 'avc1.' + prof + lv, width: w, height: h, bitrate, framerate: fps, avc: { format: 'avc' }, ...more };
        try { const r = await VideoEncoder.isConfigSupported(c); if (r && r.supported) { got = c; break outer; } } catch { /* the next */ }
      }
    }
  }
  exSupport[key] = got;
  return got;
}
// the mark as on the stage and in saved pictures, in the lower right of each frame, and the credit beside it only where "Credit in the
// corner" is on under Save an image (the owner, 2026-11-03: free to use, no credit required; the scale bar is in the lower left)
function exStamp(c) {
  const g = c.getContext('2d'), H = c.height, W = c.width;
  const mk = markImg && markImg.complete && markImg.naturalWidth ? markOn(c) : { w: Math.round(W * 0.06), h: Math.round(W * 0.06 * 677 / 1874), m: Math.round(W * 0.012) };
  if (!saveCredit) return;
  const fs = Math.max(10, Math.round(H * 0.017));
  g.save();
  g.globalAlpha = 0.62; g.fillStyle = '#fff'; g.textAlign = 'right'; g.textBaseline = 'middle';
  g.font = `500 ${fs}px Inter, 'Helvetica Neue', Arial, sans-serif`;
  g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = Math.max(2, Math.round(fs / 4));
  g.fillText(T().video.credit(CITE_YEAR, CITE_URL), W - mk.w - mk.m - Math.round(0.8 * mk.m), H - mk.m - mk.h / 2);
  g.restore();
}
// the look, cut and line map of a scene set in a video: the march's tier as the page's guard chooses it for that look (guardSwitch's
// part that changes the picture; the page's own guard stands aside meanwhile), the visit's record told a dearer look is drawn
function exLooks(p) {
  const s = S(), key = keyOf({ ...s, look: p.look, coMode: p.coMode, slice: p.slice }), from = keyOf(s);
  if (key !== from) {
    if (exporting) exporting.kind0 = from;
    if (factorOf(key) > factorOf(from)) record('changing');
    predictTier(key);
    flogAdd({ k: 'set', look: p.look, video: 1 });
  }
  if (Object.keys(p.lookSet).length) box.diskSet(p.lookSet);
}
// what a frame begins with
function exEvent(e, p) {
  if (e.do === 'leave') {
    const q = e.parts = sceneParts(e.k, S(), p.asp, true);
    if (Object.keys(q.before).length) box.diskSet(q.before);
    if (!q.later) exLooks(q);
    if (e.f > 0) box.diskPath(q.view, { speed: e.speed, dur: e.f / p.fps - EX_EPS, turns: e.turns });
    else box.diskSet({ ...q.view, fly: 0 });
  } else if (e.do === 'arrive') {
    const q = e.leave.parts;
    if (q.later) exLooks(q);
    if (q.clock) box.diskSet(q.clock);
  } else if (e.do === 'clock') {
    // (the time-lapse, and its end: the clock as it was, as endTimeLapse gives it back)
    if (e.back) { const c0 = exporting.clock0 || {}; box.diskSpeed(c0.speed || 1); if (c0.paused) box.diskPlay(false); }
    else { exporting.clock0 = { speed: S().speed, paused: S().paused }; box.diskSet(e.set); }
  } else if (e.do === 'look') {
    const s = S(), slice = e.look === 'model' ? s.slice : 0;
    exLooks({ look: e.look, coMode: s.coMode, slice, lookSet: { look: e.look, ...(slice !== s.slice ? { slice } : {}) } });
  }
}
// the video's first frame, set at once before the clock is taken: the first scene (and its time: the video begins as the scene was
// added; the clock runs on from there, at each scene's speed), or the view as it is (a move); on black
function exStart(p) {
  const e = p.events[0];
  if (e.k) {
    const q = sceneParts(e.k, S(), p.asp, true), t = e.k.clock && e.k.clock.t;
    box.diskSet({ ...q.before, bg: 'off' });
    exLooks(q);
    box.diskSet({ ...(t != null ? { time: t } : {}), ...q.view, fly: 0 });   // (the time before the view: a scene's azimuth is the world's at its time)
    if (q.clock) box.diskSet(q.clock);
  } else box.diskSet({ bg: 'off' });
}
// the cover over the stage while a video is made (the picture there is drawn at the video's size, stretched to the box): the frames as
// they come, the progress, Cancel; the rest of the page inert
const exCoverEl = $('exportCover'), exPreview = $('exPreview');
function exCover(on) {
  exCoverEl.hidden = !on;
  lab.toggleAttribute('data-exporting', on);
  for (const e of [rail, $('dock'), $('tabs'), lab.querySelector('.bar')]) if (e) e.inert = on;
  if (on) { $('exCancel').disabled = false; $('exCancel').focus({ preventScroll: true }); }
}
function exProgress() {
  const ex = exporting; if (!ex) return;
  const w = T().video, t = ex.times, k = Math.min(8, t.length - 1);
  const per = k > 0 ? (t[t.length - 1] - t[t.length - 1 - k]) / k / 1000 : ex.plan.estimate / ex.plan.frames;
  ex.perFrame = per;
  $('exProgress').textContent = ex.cancelled ? w.cancelling : ex.phase === 'prepare' ? w.preparing : ex.phase === 'file' ? w.writing
    : w.progress(ex.i + 1, ex.plan.frames, ex.sub + 1, ex.plan.sub, k > 0 ? per.toFixed(per < 10 ? 2 : 1) : '', exAbout((ex.plan.frames - ex.i - 1) * per));
}
function exShow(c) {
  const g = exPreview.getContext && exPreview.getContext('2d');
  if (!g) return;
  if (exPreview.height !== Math.round(exPreview.width * c.height / c.width)) exPreview.height = Math.round(exPreview.width * c.height / c.width);
  g.drawImage(c, 0, 0, exPreview.width, exPreview.height);
}

// Makes the video. o: the choices (what, size, fps, hold), with download (false: not saved, for checks) and keep (the Blob returned).
// Resolves { ok, frames, bytes, name, ms, perFrame, blob? } or { ok: false, cancelled } or { ok: false, why | error }.
async function exportVideo(o = {}) {
  if (exporting || saving) return { ok: false, why: 'busy' };
  if (!VIDEO_OK || reduce || presenting || !live() || 'lost' in lab.dataset || typeof box.diskOut !== 'function') return { ok: false, why: 'unavailable' };
  const opts = { ...exOpt, ...o }, plan = exPlan(opts);
  if (!plan.ok) return { ok: false, why: plan.why, plan };
  const cfg = await exConfig(plan.size, plan.fps);
  if (!cfg) return { ok: false, why: 'codec', plan };
  if (exporting || saving || !live()) return { ok: false, why: 'busy' };
  // (what plays stopped, a move's lighter picture ended and a sharpened still left first, with the page's own rules; then the page
  // stands aside: its guard, scale, governor, ramp and settings, until it is put back)
  stopPlay(); clearTimeout(moveTimer); endMoving(); unsharpen();
  const was = { s: S(), scale: box.diskScale(), place: placeI, target, march: box.diskMarch ? box.diskMarch() : null, phase };
  const ex = exporting = { plan, i: 0, sub: 0, phase: 'prepare', cancelled: false, error: null, t0: performance.now(), times: [], bytes: 0, chunks: [], desc: null, kind0: '', perFrame: 0 };
  saving = true;
  if (gov) gov.pause(true);
  exCover(true); exProgress();
  flogAdd({ k: 'set', video: plan.what, size: plan.w + 'x' + plan.h, fps: plan.fps, frames: plan.frames, sub: plan.sub, sc: plan.scaleUsed }, true);
  let enc = null, res, back = false;
  // the page as it was: the clock on the wall again (from where it stands: nothing jumps), the state (a jump, fly: 0, which leaves a
  // path under way; the time before the view, as a scene's), the march's tier, the scale, then the canvas at the box's size (the
  // engine draws the state put back at once there), the place. Once the last frame is drawn, before the file is written: the clock
  // is held only while frames are made (held with a path, a fade or a dip under way, the engine is busy and its animation frames
  // would draw the same picture again meanwhile); and in finally, whatever ended it (a cancel, the encoder's error, a lost context,
  // the writer's refusal)
  const putBack = () => {
    if (back) return;
    back = true;
    box.diskManual(false);
    box.diskSet({ ...pick(was.s, DEF_KEYS), time: was.s.time, ...pick(was.s, VIEW_KEYS), paused: was.s.paused, fly: 0 });
    if (was.march && box.diskMarch) { box.diskMarch(was.march); diag.guard.march = was.march; }
    box.diskScale(was.scale);
    box.diskOut(null);
    placeI = was.place; target = was.target;
  };
  try {
    // (the mark and the credit's font ready before the first frame: each frame is stamped at once, with no wait between frames)
    if (!markImg) { markImg = new Image(); markImg.src = 'logo-white.svg'; }
    try { await markImg.decode(); } catch { /* the credit without the mark */ }
    try { if (document.fonts && document.fonts.load) await document.fonts.load('500 20px Inter'); } catch { /* another font */ }
    enc = new VideoEncoder({
      output: (chunk, meta) => {
        if (exporting !== ex) return;
        const d = meta && meta.decoderConfig && meta.decoderConfig.description;
        if (d && !ex.desc) ex.desc = new Uint8Array(ArrayBuffer.isView(d) ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : d.slice(0));
        const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
        ex.chunks.push({ data, key: chunk.type === 'key', ts: chunk.timestamp }); ex.bytes += data.length;
      },
      error: (e) => { ex.error = ex.error || String((e && e.message) || e); }
    });
    enc.configure(cfg);
    // the first frame's state, settled at the video's size at a light scale (the fades, the look's dip and the exposure, on the wall
    // clock); then the clock taken, and the frames at the level's scale
    exStart(plan);
    box.diskScale(0.25);
    if (!box.diskOut({ w: plan.w, h: plan.h, px: plan.px })) throw new Error(T().video.gpu(plan.w, plan.h));
    await box.diskSettle(15000);
    if (ex.cancelled) throw EX_CANCEL;
    if ('lost' in lab.dataset) throw new Error(T().video.lost);
    box.diskManual(true);
    box.diskScale(plan.scaleUsed);
    ex.phase = 'frames';
    const N = plan.frames, dt = 1 / plan.fps, ev = plan.events;
    let ei = 0;
    for (let i = 0; i < N; i++) {
      if (i > 0) box.diskAdvance(dt);
      while (ei < ev.length && ev[ei].at <= i) { const e = ev[ei++]; if (e.do !== 'start') exEvent(e, plan); }
      ex.i = i; ex.sub = 0;
      // (the snapshot starts its frames in this task: from here the animation frames draw nothing until it ends; a cancel is seen
      // between its pictures, thrown from its onFrame, after which the engine puts its snapshot's state back as at any end)
      // (round 11b: and between its pieces, stop: the engine leaves the frame there and gives null)
      const shot = snapshot(box, { scale: plan.scaleUsed, bands: exBands(plan), bandMs: GUARD_MS / GPUX, frames: plan.sub, stop: () => ex.cancelled, onFrame: (j) => { ex.sub = j; if (ex.cancelled) throw EX_CANCEL; exProgress(); } });
      shot.catch(() => {});   // (awaited below; not an unhandled rejection meanwhile)
      while (enc.encodeQueueSize > 2 && !ex.error && !ex.cancelled) await new Promise((r) => setTimeout(r, 5));
      const c = await shot;
      if (ex.cancelled) throw EX_CANCEL;
      if (!c) throw new Error('lost' in lab.dataset ? T().video.lost : 'no picture');
      if (ex.error) throw new Error(ex.error);
      exStamp(c);
      const vf = new VideoFrame(c, { timestamp: Math.round(i * 1e6 / plan.fps), duration: Math.round(1e6 / plan.fps), alpha: 'discard' });
      enc.encode(vf, { keyFrame: i % (EX_KEY_S * plan.fps) === 0 });
      vf.close();
      ex.times.push(performance.now());
      exShow(c); exProgress();
      if (ex.bytes > 1.25 * EX_MAX_BYTES) throw new Error(T().video.big((ex.bytes / 1e9).toFixed(1), EX_MAX_BYTES / 1e9));
      if (ex.cancelled) throw EX_CANCEL;
    }
    putBack();
    ex.phase = 'file'; exProgress();
    await enc.flush();
    if (ex.error) throw new Error(ex.error);
    if (ex.chunks.length !== N) throw new Error(ex.chunks.length + ' frames encoded of ' + N);
    const file = mp4Parts({ width: plan.w, height: plan.h, fps: plan.fps, avcC: ex.desc, samples: ex.chunks, time: Date.now() });
    const blob = new Blob(file.parts, { type: 'video/mp4' }), name = `disk-lab-${plan.what}-${plan.w}x${plan.h}-${plan.fps}fps.mp4`;
    const ms = performance.now() - ex.t0, frameMs = ex.times.length > 1 ? (ex.times[ex.times.length - 1] - ex.times[0]) / (ex.times.length - 1) : ms;
    if (opts.download !== false) {
      const a = el('a', { href: URL.createObjectURL(blob), download: name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);   // (a large file is read by the download for a while)
    }
    res = { ok: true, frames: N, encoded: ex.chunks.length, keys: ex.chunks.filter((x) => x.key).length, bytes: file.size, name, ms: Math.round(ms), perFrame: Math.round(frameMs) / 1000, codec: cfg.codec, plan: { ...plan, events: undefined }, ...(opts.keep ? { blob } : {}) };
  } catch (e) {
    res = e === EX_CANCEL ? { ok: false, cancelled: true, frames: ex.times.length } : { ok: false, error: String((e && e.message) || e), frames: ex.times.length };
  } finally {
    if (enc && enc.state !== 'closed') { try { enc.close(); } catch { /* closed by an error */ } }
    putBack();
    if (live() && !('lost' in lab.dataset)) record(was.phase || 'live');
    saving = false; exporting = null;
    exCover(false);
    flogAdd({ k: 'set', video: 0, ok: res && res.ok ? 1 : 0, cancelled: res && res.cancelled ? 1 : undefined, frames: ex.times.length, ms: Math.round(performance.now() - ex.t0), err: res && res.error ? res.error.slice(0, 80) : undefined }, true);
    applyFixed(); guardApply(); govRest();
    renderPlace(); sync(); renderExport();
    const w = T().video;
    note(res.ok ? w.done(res.name, (res.bytes / 1e6).toPrecision(2)) : res.cancelled ? w.cancelled : w.failed(res.error || res.why), res.ok ? 8000 : 6000);
  }
  return res;
}
$('exCancel').addEventListener('click', () => { if (exporting) { exporting.cancelled = true; $('exCancel').disabled = true; exProgress(); } });

// the panel in "Moves and talks": what (the scenes, or a move), the size, the frame rate, the hold; the plan in one line, or why not
const exWhat = $('exWhat');
const exSizeButtons = Object.keys(EX_SIZE).map((k) => { const b = el('button', { type: 'button', 'data-ex-size': k, 'aria-pressed': 'false' }, k === '2160' ? '4K' : k + 'p'); $('exSize').append(b); return b; });
const exFpsButtons = EX_FPS.map((f) => { const b = el('button', { type: 'button', 'data-ex-fps': String(f), 'aria-pressed': 'false' }, f + ' fps'); $('exFps').append(b); return b; });
const exHoldButtons = EX_HOLD.map((s) => { const b = el('button', { type: 'button', 'data-ex-hold': String(s), 'aria-pressed': 'false' }); $('exHold').append(b); return b; });
let exWhatKey = '', exTimer = 0;
function renderExport() {
  clearTimeout(exTimer); exTimer = 0;
  const w = T().video, no = !VIDEO_OK ? w.noEncoder : reduce ? w.noMotion : '';
  $('exNo').textContent = no; $('exNo').hidden = !no; $('exForm').hidden = !!no;
  if (no) return;
  // (the list of what: rebuilt when the language or the number of scenes changes)
  const key = L() + seq.keys.length;
  if (key !== exWhatKey) {
    exWhatKey = key;
    exWhat.replaceChildren(el('option', { value: 'scenes' }, seq.keys.length ? w.scenes(seq.keys.length) : w.places), ...MOVES.map((m) => el('option', { value: m }, T().talk.moves[m])));
  }
  exWhat.value = exOpt.what;
  exSizeButtons.forEach((b) => pressed(b, b.dataset.exSize === String(exOpt.size)));
  exFpsButtons.forEach((b) => pressed(b, Number(b.dataset.exFps) === exOpt.fps));
  exHoldButtons.forEach((b) => { b.textContent = w.hold(b.dataset.exHold); pressed(b, Number(b.dataset.exHold) === exOpt.hold); });
  if (!live()) { $('exPlan').textContent = ''; $('exGo').disabled = true; return; }
  const p = exPlan(), sup = exSupport[p.size + '@' + p.fps];
  if (sup === undefined && VIDEO_OK) exConfig(p.size, p.fps).then(() => renderExport());
  $('exPlan').textContent = !p.ok && p.why === 'long' ? w.long(p.frames, EX_MAX_FRAMES, EX_MAX_FRAMES / 30 / 60)
    : !p.ok && p.why === 'big' ? w.big((p.bytes / 1e9).toFixed(1), EX_MAX_BYTES / 1e9)
    : !p.ok && p.why === 'gpu' ? w.gpu(p.w, p.h)
    : sup === null ? w.codec(p.w, p.h, p.fps)
    : p.ok ? w.plan({ seconds: p.seconds.toFixed(1), frames: p.frames, w: p.w, h: p.h, fps: p.fps, level: T().quality[p.level], sub: p.sub, capped: p.scaleUsed < p.scale - 1e-3 ? Math.round(100 * p.scaleUsed) : 0, mb: (p.bytes / 1e6).toPrecision(2), time: exAbout(p.estimate) }) + (p.slow ? ' ' + w.slow : '') : '';
  $('exGo').disabled = !p.ok || !sup || !!exporting;
}
// (the plan follows the state, a look, a quality or the scenes changed: drawn again a moment after, while the section is open)
const exSoon = () => { if (talk.open && !exTimer && !exporting) exTimer = setTimeout(renderExport, 400); };
talk.addEventListener('toggle', () => { if (talk.open) renderExport(); });
exWhat.addEventListener('change', () => { exOpt.what = exWhat.value; renderExport(); });
$('exportBox').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b || exporting) return;
  if (b.dataset.exSize) exOpt.size = b.dataset.exSize;
  else if (b.dataset.exFps) exOpt.fps = Number(b.dataset.exFps);
  else if (b.dataset.exHold) exOpt.hold = Number(b.dataset.exHold);
  else if (b.id === 'exGo') { exportVideo(); return; }
  else return;
  try { sessionStorage.setItem(EX_SET, JSON.stringify({ size: exOpt.size, fps: exOpt.fps, hold: exOpt.hold })); } catch { /* for this view only */ }
  renderExport();
});
// (for laptops and desktops, as the presenter: not on a phone or a tablet, whatever its width)
if (MOBILE || coarse) $('exportBox').hidden = true;

// ---------- resting when left alone ----------
// A running clock keeps the GPU drawing every frame. Left alone for IDLE_MS (IDLE_BLUR_MS while the window is not the
// focused one), the clock is paused: the picture is then finished at full resolution (onAccumulated) and the engine draws
// nothing more, so the GPU rests. The next input (a move, a press, a key, the wheel, a touch, the window coming back to
// the front) starts the clock again, if it was this rest that stopped it; a pause chosen by the visitor stays. A press on
// the play button itself is left to the button. data-idle="off" on the disk turns it off (the checks run without input).
// (round 9: a phone or tablet rests sooner, IDLE_MS_PHONE)
const IDLE_MS = 60000, IDLE_MS_PHONE = 30000, IDLE_BLUR_MS = 15000, IDLE_TEST = Number(q.get('idle')) > 0 ? Number(q.get('idle')) : 0;   // (?idle=ms: for checks)
let idleTimer = 0, restedByIdle = false;
function armIdle() {
  clearTimeout(idleTimer);
  if (!live() || reduce || box.dataset.idle === 'off' || presenting || playing || flying) return;   // (round 11a: not in a talk, nor while a move or the scenes play)
  idleTimer = setTimeout(restIdle, IDLE_TEST || (document.hasFocus() ? (MOBILE || coarse ? IDLE_MS_PHONE : IDLE_MS) : IDLE_BLUR_MS));
}
function restIdle() {
  if (!live() || reduce || box.dataset.idle === 'off' || 'lost' in lab.dataset || presenting || playing || flying) return;
  if (saving || moveFrom) return armIdle();
  if (S().paused) return;
  // (round 10a, dev.5: no note on the picture: the owner, trying dev.4 on the iPhone, found it in the way; the play button
  // shows the clock stopped, and any touch starts it again)
  restedByIdle = true; box.diskPlay(false); sync();
}
function wake(e) {
  flog.inT = Date.now() - flog.t0;   // (round 10a: the last input, for the flight record)
  if (restedByIdle) {
    restedByIdle = false;
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
  // (round 13a: the model look's colours chosen, { key: '#rrggbb' } (only those not at the default); with an object, set as the
  // inputs would set them, every key left out at its default; for checks and scripts)
  colours: (o) => { if (o !== undefined && colDef) { cols = colClean(o || {}, colDef); applyCols(); if (live()) renderMatKey(S()); keepSoon(); } return { ...cols }; },
  // (round 10a: the keys this build keeps on the device, the flight record now and the last visit's, its judgement, the
  // version line; for checks, here or through a WebDriver session)
  keys: { settings: SET, session: REC, log: LOG, logBad: LOG_BAD, logOwner: LOG_OWNER, quality: KEY('disk-lab-quality'), lang: KEY('site-language') },
  flightLog: () => JSON.parse(JSON.stringify(flog)), flightText: () => logText(flog), lastLog: () => badLog || prevLog, verdict: () => ({ ...verdict, avoid }),
  versionLine: VERSION_LINE, version: VERSION, showLog: () => showLog(), restoreKept: () => restoreKept(),
  // (round 11a: the talks, for checks: the scenes (a copy; set checks them as a file's), a #seq= link to them, the moves, the
  // presenter and its scene, the flight under way)
  talk: {
    scenes: () => JSON.parse(JSON.stringify(seq)), setScenes: (o) => { const v = checkSeq(o); if (v) { stopPlay(); seq = v; pace = v.pace || pace; seqChanged(); } return !!v; },
    add: () => addView(), link: async () => { const u = new URL(location.pathname, location.href); u.searchParams.set('lang', L()); return u.href + await seqToHash(seqOut()); },
    move: (name) => runMove(name), play: () => playScenes(), stop: () => stopPlay(), go: (i) => goScene(i), fly: (k) => flyTo(k),
    present: (on) => present(on), state: () => ({ presenting, scene: sceneI, moved: sceneMoved, playing, flying: flying ? flying.id : 0, black: lab.hasAttribute('data-black'), pace, n: seq.keys.length || PLACES.length }),
    // (round 11b: the video: made (o: what, size, fps, hold; download false and keep true for checks), its plan (the frames and when
    // each event comes), cancelled, and its progress while it is made)
    exportVideo: (o) => exportVideo(o),
    exportPlan: (o) => { const p = exPlan({ ...exOpt, ...o }); return { ...p, events: (p.events || []).map((e) => ({ at: e.at, do: e.do, f: e.f })) }; },
    exportCancel: () => { if (exporting) exporting.cancelled = true; return !!exporting; },
    // (round 11b: with the snapshot's progress, its pieces so far and the last one: slow told from stuck)
    exportState: () => (exporting ? { phase: exporting.phase, i: exporting.i, sub: exporting.sub, frames: exporting.plan.frames, perFrame: exporting.perFrame, bytes: exporting.bytes, encoded: exporting.chunks.length, snap: box.diskSnapLog && box.diskSnapLog() ? (({ pieces, sub, last, ms }) => ({ pieces, sub, last, subMs: ms }))(box.diskSnapLog()) : null } : null)
  }
};
// (round 10a: the same line as index.html writes without the script; check.js compares them)
document.querySelectorAll('[data-version]').forEach((e) => { e.textContent = VERSION_LINE; });
start();
