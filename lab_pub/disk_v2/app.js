// Disk Lab v2: the page around the GPU engine (engine/disk3d.js, v2's own engine: see engine/CHANGES.md).
// The page decides whether the live model can run (quality.js), loads the engine, lays out the sandbox (the rail: look,
// what is shown, cut, variants, time, view) and the highlights (places.js), and keeps its controls in step with the
// engine through the engine's public API and events.
// See DESIGN.md for the reasons behind each choice.
import { PLACES, placeById, placeState, fitDistance } from './places.js?v=20261016a';
import { WORDS } from './words.js?v=20261016a';
import { probe, calibrate, govern, scaleFor, MIN_SCALE } from './quality.js?v=20261016a';
import { snapshot, toPng } from './capture.js?v=20261016a';

const ENGINE_SRC = 'engine/disk3d.js?v=e8aabb71e1';   // ?v= the first ten characters of the engine's SHA-256 (engine/SOURCE.txt)
const VERSION = '2026-10-15';

const html = document.documentElement;
const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches || q.get('motion') === 'reduce';
const coarse = matchMedia('(pointer: coarse)').matches;
const L = () => (html.lang === 'ja' ? 'ja' : 'en');
const T = () => WORDS[L()];

const lab = $('lab'), stage = $('stage'), box = $('disk'), poster = $('poster');
const routeList = $('routeList'), placeText = $('placeText'), placeTitle = $('placeTitle'), placeActions = $('placeActions');
const lookGroup = $('lookGroup'), lookNote = $('lookNote'), lookContext = $('lookContext'), cutContext = $('cutContext');
const playBtn = $('play'), clock = $('clock'), rail = $('rail');
const stageHint = $('stageHint'), stageNote = $('stageNote'), stillNote = $('stillNote'), tempKey = $('tempKey');
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
let posterKey = '';
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

// ---------- the temperature key: the engine's colours for temperature (tcolor in its shader, tcolorJS in its script) ----------
(function drawTempKey() {
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const tcolor = (T_) => {
    const l = Math.log(T_), st = [[3.69, 4.50, [0.071, 0.325, 1.000]], [4.50, 4.98, [0.560, 0.800, 1.000]], [4.98, 5.16, [0.920, 0.900, 0.860]],
      [5.16, 5.86, [1.000, 0.325, 0.047]], [5.86, 6.68, [1.000, 0.560, 0.120]], [6.68, 7.38, [1.000, 0.860, 0.240]]];
    let c = [0.023, 0.148, 0.893];
    for (const [a, b, k] of st) { const t = ss(a, b, l); c = c.map((v, i) => v + (k[i] - v) * t); }
    return c.map((v) => Math.round(255 * 0.92 * Math.pow(v, 1 / 2.2)));
  };
  const T0 = 30, T1 = 2000, stops = [];
  for (let i = 0; i <= 24; i++) { const u = i / 24, c = tcolor(T0 * Math.pow(T1 / T0, u)); stops.push(`rgb(${c.join(',')}) ${(u * 100).toFixed(1)}%`); }
  $('tempBar').style.background = `linear-gradient(90deg, ${stops.join(', ')})`;
  const ticks = tempKey.querySelector('.temp-ticks');
  ticks.style.position = 'relative'; ticks.style.height = '1.4em';
  [...ticks.children].forEach((s, i) => {
    const Tk = [30, 160, 2000][i], u = Math.log(Tk / T0) / Math.log(T1 / T0);
    Object.assign(s.style, { position: 'absolute', left: (u * 100) + '%', transform: i === 0 ? 'none' : i === 2 ? 'translateX(-100%)' : 'translateX(-50%)' });
  });
})();

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
    box.diskSet({ ...st, fly: fly && !reduce ? 1 : 0 });
    target = { ...st, time: S().time };
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
  document.querySelectorAll('.lang-switch [data-lang]').forEach((b) => pressed(b, b.dataset.lang === L()));
  document.title = 'Disk Lab | ' + (L() === 'ja' ? '森 昇志' : 'Shoji Mori');
  renderPlace();
  renderLooks();
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
  // (an observed look has no cut: close it where the camera is, rather than flying back to the whole disk as the engine
  // does when the look alone is changed)
  if (s.slice && k !== 'model') box.diskSet({ slice: 0, look: k }); else box.diskSet({ look: k });
  sync();
}

// ---------- the controls that depend on the state: the place's action; in the rail, the CO maps and the cut's quantities ----------
const CUT_Q = ['T', 'rho', 'tau', 'layers', 'none'];
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
      kids.push(segmented(['chan', 'm1', 'm0'].map((k) => [k, w.coModes[k]]), s.coMode, (k) => { box.diskSet({ coMode: k }); sync(); }, L() === 'ja' ? 'CO の表示' : 'CO map'));
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
  const ck = [L(), cutOpen, s.sq].join('|');
  if (ck !== cutKey) {
    cutKey = ck;
    cutContext.replaceChildren(...(cutOpen ? [segmented(CUT_Q.map((k) => [k, w.cutQ[k]]), s.sq, (k) => { box.diskSet({ sq: k }); sync(); }, L() === 'ja' ? '断面に描く量' : 'Quantity on the cut')] : []));
  }
  lookNote.textContent = co ? w.coNotes[s.coMode] : cutOpen ? w.cutNotes[s.sq] : w.looks[s.look].note;
}
const kms = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + ' km/s';

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
  // (a still picture's scale is for that picture: the clock started, or another look, by any way, ends it)
  if (sharpFrom && ((!s.paused && !reduce) || s.look + s.coMode !== sharpWhat)) unsharpen();
  const base = diag.calibration && diag.calibration.scale, co = s.look === 'co';
  if (co && !wasCo && !sharpFrom && !holdSharp) { box.diskScale(CO_FLOOR); runScale = CO_FLOOR; }
  if (!co && wasCo && !sharpFrom && !holdSharp && base) { box.diskScale(base); runScale = base; }
  wasCo = co;
  lookButtons.forEach((b) => pressed(b, b.dataset.look === s.look));
  renderActions(s);
  renderRail(s);
  // (not next to the star, where the magnetosphere's columns and curtains have colours of their own)
  tempKey.classList.toggle('on', s.look === 'model' && !s.slice && !!s.ann && (s.p || s.d >= 2));
  playBtn.toggleAttribute('data-paused', !!s.paused);
  playBtn.setAttribute('aria-label', s.paused ? T().play : T().pause);
  setClock(s.time);
  // the rail
  rail.querySelectorAll('[data-bit]').forEach((b) => pressed(b, s.mode & Number(b.dataset.bit)));
  const opt = { field: s.field, marks: s.marks, ann: s.ann, asym: s.asym, waves: s.waves };
  rail.querySelectorAll('[data-opt]').forEach((b) => pressed(b, opt[b.dataset.opt]));
  rail.querySelectorAll('[data-cut]').forEach((b) => pressed(b, Number(b.dataset.cut) === s.slice));
  rail.querySelectorAll('[data-speed]').forEach((b) => pressed(b, Math.abs(Number(b.dataset.speed) - s.speed) < 1e-6));
}
let clockShown = -1;
function setClock(time) {
  const y = Math.floor(time / 12 * 10) / 10;
  if (y !== clockShown) { clockShown = y; clock.textContent = T().clock(y); }
}

// ---------- the rail (the sandbox) ----------
rail.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b || !live()) return;
  const s = S();
  if (b.dataset.bit) box.diskSet({ mode: s.mode ^ Number(b.dataset.bit) });
  else if (b.dataset.opt === 'field') box.diskField(!s.field);
  else if (b.dataset.opt === 'marks') box.diskSet({ marks: s.marks ? 0 : 1 });
  else if (b.dataset.opt === 'ann') box.diskAnnotations(!s.ann);
  else if (b.dataset.opt === 'asym') box.diskSet({ asym: s.asym ? 0 : 1 });
  else if (b.dataset.opt === 'waves') box.diskSet({ waves: s.waves ? 0 : 1 });
  else if (b.dataset.cut) { const k = Number(b.dataset.cut); if (k === 0) box.diskSlice(false); else box.diskSlice(true, null, k === 2 ? 'quarter' : 'half'); }
  else if (b.dataset.angle) { const [elv, az] = b.dataset.angle.split(',').map(Number); box.diskSet({ slice: 0, p: 0, el: elv, az, fly: reduce ? 0 : 1 }); }
  else if (b.id === 'recentre') box.diskCenter();
  else if (b.id === 'resetView') goPlace(0);
  else if (b.dataset.speed) box.diskSpeed(Number(b.dataset.speed));
  else if (b.id === 'copyLink') copyLink();
  else if (b.id === 'saveImage') saveImage(b);
  sync();
});

// ---------- time ----------
playBtn.addEventListener('click', () => { if (!live()) return; box.diskPlay(!!S().paused); sync(); });

// ---------- sharing ----------
const LINK_KEYS = ['el', 'az', 'd', 'mode', 'field', 'ann', 'asym', 'marks', 'waves', 'slice', 'sq', 'p', 'look', 'speed', 'paused'];
function linkFor(s) {
  const u = new URL(location.href); u.search = '';
  u.searchParams.set('place', PLACES[placeI].id);
  for (const k of LINK_KEYS) u.searchParams.set(k, String(s[k]));
  if (s.tx || s.ty || s.tz) for (const k of ['tx', 'ty', 'tz']) u.searchParams.set(k, String(s[k]));
  if (s.look === 'co') { u.searchParams.set('com', s.coMode); u.searchParams.set('cov', String(s.coV)); }
  if (!s.ms) u.searchParams.set('ms', '0');
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
async function saveImage(btn) {
  if (saving) return;
  saving = true; btn.disabled = true; note(T().imageBusy, 0);
  try {
    const c = await shot({ full: true });
    const blob = c && await toPng(c);
    if (!blob) throw new Error('no picture');
    const a = el('a', { href: URL.createObjectURL(blob), download: `disk-lab-${PLACES[placeI].id}.png` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    note(T().imageDone);
  } catch { note(T().imageFailed, 4000); }
  finally { saving = false; btn.disabled = false; }
}
// a picture of the model, with the governor resting meanwhile
async function shot(opts) {
  if (gov) gov.pause(true);
  try { return await snapshot(box, opts); } finally { if (gov) gov.pause(false); }
}
// a link's state: the place first, then any of the engine's keys (diskSet checks every value)
function stateFromLink() {
  const NUM = ['p', 'el', 'az', 'd', 'tx', 'ty', 'tz', 'mode', 'field', 'speed', 'paused', 'slice', 'ann', 'ms', 'asym', 'marks', 'waves'];
  const st = {};
  for (const k of NUM) if (q.has(k)) st[k] = q.get(k);
  if (q.has('sq')) st.sq = q.get('sq');
  if (q.has('look')) st.look = q.get('look');
  if (q.has('com')) st.coMode = q.get('com');
  if (q.has('cov')) st.coV = q.get('cov');
  if (q.has('t')) st.time = q.get('t');
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
  try { sessionStorage.setItem('site-language', l); } catch { /* the choice still applies to this page */ }
  actionsKey = lookKey = cutKey = ''; clockShown = -1;
  if (mode !== 'live' || 'lost' in lab.dataset) setPoster(PLACES[placeI].id);   // (the stills carry their labels)
  renderAll();
}
document.querySelectorAll('.lang-switch [data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));

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
// or wheel on the page brings back the running scale before the engine sees the event. The scale is the one whose frame
// is predicted at SHARP_MS from the accumulation's own frames (what is drawn now: the CO line's moments cost some 30
// times the model, next to the star a frame costs 4 times the whole disk's; at scale 1 a frame of the moments took
// seconds, and the GPU dropped the WebGL context).
const SHARP_MS = 150;
let sharpFrom = 0, runScale = 0;   // runScale: the scale the model runs at (calibrated, then governed)
let lastFrame = 0, holdSharp = false, sharpWhat = '';   // sharpWhat: the look sharpened
const recent = [];                 // the intervals between the accumulation's frames (ms; the last 12)
function unsharpen() {
  if (!sharpFrom) return;
  box.diskScale(sharpFrom); sharpFrom = 0; recent.length = 0;
  if (gov) gov.pause(false);
}
function onAccumulated() {
  if (!live() || sharpFrom || holdSharp || 'lost' in lab.dataset || !(S().paused || reduce) || saving || recent.length < 4) return;
  // (the mean, not the median: with two frames in flight they come in pairs, a long interval and a short one)
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length, s = box.diskScale(), to = Math.min(1, scaleFor(mean, s, SHARP_MS));
  if (to < 1.15 * s) return;
  sharpFrom = s; recent.length = 0; sharpWhat = S().look + S().coMode;
  if (gov) gov.pause(true);
  box.diskScale(to);
}
for (const type of ['pointerdown', 'keydown']) lab.addEventListener(type, unsharpen, { capture: true });
stage.addEventListener('wheel', unsharpen, { capture: true, passive: true });

// ---------- still pictures ----------
function renderStillNote() {
  if (mode !== 'still') { stillNote.hidden = true; return; }
  const w = T().still, kids = [w[stillReason] || w.forced];
  if (['software', 'slow', 'forced'].includes(stillReason)) {
    kids.push(el('button', { type: 'button', class: 'action', onclick: () => {
      const u = new URL(location.href); u.searchParams.delete('still'); u.searchParams.set('gl', 'force'); location.replace(u.href);
    } }, w.tryLive));
  }
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
}

// ---------- starting ----------
function loadEngine() {
  return new Promise((resolve, reject) => {
    const s = el('script', { src: ENGINE_SRC });
    s.onload = resolve; s.onerror = () => reject(new Error('engine did not load'));
    document.body.append(s);
  });
}

async function start() {
  const first = placeById(q.get('place')) || PLACES[0];
  placeI = PLACES.indexOf(first);
  fitStage(); setPoster(first.id);
  renderAll();
  if (q.get('still') === '1') return enterStill('forced');
  diag.probe = probe();
  if (!diag.probe.ok && q.get('gl') !== 'force') return enterStill(diag.probe.reason);
  note(T().loading, 0);
  // (the engine reads these when it starts: the first frame is the place's, the Home key goes to the fitted whole disk)
  const whole = PLACES[0];
  Object.assign(box.dataset, { elevation: String(first.view.el), azimuth: String(first.view.az), distance: String(Math.round(fitDistance(whole, aspect()) * 1000) / 1000) });
  if (!first.field) box.dataset.nofield = '';
  if (q.get('motion') === 'reduce') box.dataset.static = '';
  // (the wind symmetric by default, as the client asked; the one-sided wind of Mori, Bai & Tomida 2025 is a control)
  box.dataset.asym = 'off';
  box.setAttribute('data-disk3d', '');
  try { await loadEngine(); } catch { return enterStill('failed'); }
  diag.timings.engine = Math.round(performance.now() - t0);
  if (typeof box.diskSet !== 'function' || box.classList.contains('disk-fallback')) return enterStill('failed');
  mode = 'live';
  lab.dataset.state = 'loading';
  // the place, then what a link asks for
  goPlace(placeI, { fly: false });
  const linked = stateFromLink();
  if (linked) box.diskSet(linked);
  // the render scale for this device, measured before the picture is shown
  try { diag.calibration = await calibrate(box); } catch (e) { diag.calibration = { error: String(e) }; }
  diag.timings.calibrated = Math.round(performance.now() - t0);
  if (diag.calibration && diag.calibration.slow && q.get('gl') !== 'force') return enterStill('slow');
  lab.dataset.state = 'live';
  note('', 0);
  runScale = box.diskScale();
  if (!reduce) gov = govern(box, { base: diag.calibration && diag.calibration.scale || 0.5, running: () => !S().paused,
    floor: () => (S().look === 'co' ? CO_FLOOR : MIN_SCALE), onChange: (sc) => { runScale = sc; } });
  if (reduce) { const r = $('reducedNote'); r.textContent = T().reduced; r.hidden = false; playBtn.hidden = true; $('speedGroup').hidden = true; }
  sync();
  hint(true);
  diag.timings.live = Math.round(performance.now() - t0);
}

// the engine's own changes (keys, a drag, the easter eggs, a restored context) reach the controls
box.addEventListener('diskstate', () => sync());
box.addEventListener('diskmode', () => sync());
box.addEventListener('diskframe', (e) => {
  if (mode !== 'live') return;
  setClock(e.detail.time);
  // (the intervals between frames of one still picture, at one scale, are what a frame of it costs; a complete picture
  // may be sharpened)
  const now = performance.now(), { acc = 0, accMax = 0 } = e.detail;
  if (acc >= 2 && lastFrame) { recent.push(now - lastFrame); if (recent.length > 12) recent.shift(); }
  lastFrame = now;
  if (accMax && acc >= accMax && lab.dataset.state === 'live') onAccumulated();
});
box.addEventListener('disklost', (e) => {
  if (e.detail.lost) { lab.dataset.lost = ''; posterKey = ''; setPoster(PLACES[placeI].id); note(T().still.lost, 0); }
  else {
    // (the engine is built anew from its data attributes: give it back the scale it ran at)
    delete lab.dataset.lost; note('', 0);
    sharpFrom = 0; recent.length = 0; if (gov) gov.pause(false);
    if (runScale) box.diskScale(runScale);
    sync();
  }
});

window.diskLab = {
  diag, PLACES, WORDS,
  state: () => ({ mode, stillReason, place: PLACES[placeI].id, away: away(), sharpened: !!sharpFrom, governor: gov ? gov.state() : null }),
  goPlace: (id, opts) => goPlace(typeof id === 'number' ? id : PLACES.findIndex((p) => p.id === id), opts),
  // (for measurements: frames drawn by diskBench would otherwise reach the governor)
  // (for measurements: also holds the sharpening of a still picture and the CO line's own scale; the scale is the caller's)
  pauseGovernor: (on) => { holdSharp = !!on; if (on) unsharpen(); if (gov) gov.pause(on); },
  setLook, setLang, setTab: (t) => setTab(t), link: () => (live() ? linkFor(S()) : null), snapshot: (opts) => shot(opts)
};
$('colophon').textContent = `Disk Lab ${VERSION} · engine ${ENGINE_SRC.split('v=')[1]}`;
start();
