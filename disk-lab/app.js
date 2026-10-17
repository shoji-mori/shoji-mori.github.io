// Disk Lab v2: the page around the GPU engine (engine/disk3d.js, v2's own engine: see engine/CHANGES.md).
// The page decides whether the live model can run (quality.js), loads the engine, lays out the sandbox (the rail: look,
// what is shown, cut, variants, time, view) and the highlights (places.js), and keeps its controls in step with the
// engine through the engine's public API and events.
// See DESIGN.md for the reasons behind each choice.
import { PLACES, placeById, placeState, fitDistance } from './places.js?v=20261016c';
import { WORDS } from './words.js?v=20261017b';
import { probe, calibrate, govern, scaleFor, MIN_SCALE } from './quality.js?v=20261016b';
import { snapshot, toPng } from './capture.js?v=20261016b';

const ENGINE_SRC = 'engine/disk3d.js?v=dc5b934c42';   // ?v= the first ten characters of the engine's SHA-256 (engine/SOURCE.txt)
const VERSION = '2026-10-17';
// The citation (the page asks to be cited in research and talks): its address in one place, to change when the page
// moves from its hidden address to its public one.
const CITE_URL = 'https://shoji-mori.github.io/disk-lab/', CITE_YEAR = 2026;
// The quality the viewer may fix (render scale; Auto: the governor, and the sharpening of still pictures)
const QUALITY = { low: 0.35, mid: 0.55, high: 0.8, full: 1 };

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
    // (the planet's place shows the first planet at 3 au, as its text says; others are kept)
    if (pl.id === 'planet') { const ps = S().planets.filter((p, j) => j > 0 && roomFor([[3, 1]], p[0], -1)); st.planets = [[3, 1], ...ps].slice(0, 4); st.pi = 0; }
    else if ((pl.needs & 16) && !S().planets.some((p) => p[1])) st.planets = [[3, 1]];
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
  if (retry && !retry.hidden) { retry.firstElementChild.textContent = w.still.retryText; document.getElementById('retryLive').textContent = w.still.retry; }
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
  // (an observed look has no cut: close it where the camera is, rather than flying back to the whole disk as the engine
  // does when the look alone is changed)
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
// field lines with them, their flow arrows with the markers (the wind's with the wind, the accretion's with the gas), the
// planets' orbits.
function keyItems(s) {
  const out = ['tau1', 'ice'];
  if (s.mode & 4) out.push('pebbles');
  if (s.sq === 'rho') out.push('contour');
  if (s.field) out.push('field');
  if (s.field && s.marks && (s.mode & 8)) out.push('flow');
  if (s.field && s.marks && (s.mode & 1)) out.push('acc');
  if ((s.mode & 16) && s.planets.some((p) => p[1])) out.push('planet');
  return out;
}
const KEY_SVG = {
  tau1: '<path d="M1 5h22" stroke="#fff3df" stroke-width="1.5"/>',
  ice: '<path d="M1 5h22" stroke="#0a0d18" stroke-opacity=".5" stroke-width="5"/><path d="M1 5h22" stroke="#6fd0ff" stroke-width="2.6" stroke-dasharray="7 4"/>',
  pebbles: '<path d="M1 5h11" stroke="#b07a52" stroke-width="2.2"/><path d="M12 5h11" stroke="#e3f1ff" stroke-width="2.2"/>',
  contour: '<path d="M1 7c6-5 16-5 22 0" stroke="#fff" stroke-opacity=".55" stroke-width=".9"/>',
  field: '<path d="M2 9c4-1 8-4 10-8M12 9c4-1 8-4 10-8" stroke="#cfe3ff" stroke-opacity=".7" stroke-width=".9"/>',
  flow: '<path d="M2 5h18M16 2l4 3-4 3" stroke="#e8f4ff" stroke-width="1.1"/>',
  acc: '<path d="M22 5H6M10 2 6 5l4 3" stroke="#ffbe6a" stroke-width="1.3"/>',
  planet: '<path d="M12 1l4 4-4 4-4-4z" fill="#ffd9a8" stroke="#0a0d18"/>',
  clear: '<rect x="1.5" y="1.5" width="21" height="7" rx="1.5" stroke="#808a9a" stroke-dasharray="2 2"/>'
};
function cutKeyList(sq, shown) {
  const w = T().cutKey, li = (k, text) => {
    const sv = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    sv.setAttribute('viewBox', '0 0 24 10'); sv.setAttribute('aria-hidden', 'true'); sv.innerHTML = KEY_SVG[k];
    return el('li', {}, sv, el('span', {}, text));
  };
  const items = shown.map((k) => li(k, k === 'tau1' && sq === 'layers' ? w.tau1Regions : w[k]));
  items.push(li('clear', w.clear[sq] || w.clear.T));
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
  // (a still picture's scale is for that picture: the clock started, or another look, by any way, ends it)
  if (sharpFrom && ((!s.paused && !reduce) || s.look + s.coMode !== sharpWhat)) unsharpen();
  const base = diag.calibration && diag.calibration.scale, co = s.look === 'co';
  if (co !== wasCo && quality !== 'auto' && !holdSharp) { qCap = co ? CO_FLOOR : 1; costs.length = 0; box.diskScale(fixedScale()); }
  else if (co && !wasCo && !sharpFrom && !holdSharp) { box.diskScale(CO_FLOOR); runScale = CO_FLOOR; }
  else if (!co && wasCo && !sharpFrom && !holdSharp && base) { box.diskScale(base); runScale = base; }
  wasCo = co;
  applyFixed();
  lookButtons.forEach((b) => pressed(b, b.dataset.look === s.look));
  renderActions(s);
  renderRail(s);
  // (not next to the star, where the magnetosphere's columns and curtains have colours of their own)
  tempKey.classList.toggle('on', s.look === 'model' && !s.slice && !!s.ann && (s.p || s.d >= 2));
  playBtn.toggleAttribute('data-paused', !!s.paused);
  playBtn.setAttribute('aria-label', s.paused ? T().play : T().pause);
  setClock(s.time);
  syncComps(s);
  syncQuality(s);
  if (!saving) renderSaveSize();
  if (s.paused) setClockRate(0);   // (paused, no frames come to clear the clock's rate)
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
  if (b.dataset.bit) { const bit = Number(b.dataset.bit), m = s.mode & bit ? s.mode & ~bit : s.mode | bit; box.diskSet({ mode: m, ...((m & 16) && !s.planets.some((p) => p[1]) ? { planets: [...s.planets.filter((p) => roomFor([[3, 1]], p[0], -1) || !p[1]), [3, 1]].slice(-4) } : {}) }); }
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
  else if (b.dataset.saveSize) { saveSize = b.dataset.saveSize; try { sessionStorage.setItem('disk-lab-save-size', saveSize); } catch { /* for this view only */ } renderSaveSize(); }
  else if (b.dataset.quality) setQuality(b.dataset.quality);
  else if (b.id === 'citeCopy') copyCite();
  else if (b.dataset.planetOn != null) { const pl = S().planets; const i = Number(b.dataset.planetOn); if (pl[i]) { pl[i][1] = pl[i][1] ? 0 : 1; if (pl[i][1] && !roomFor(pl, pl[i][0], i)) pl[i][1] = 0; box.diskSet({ planets: pl }); } }
  else if (b.dataset.planetRemove != null) { const pl = S().planets; pl.splice(Number(b.dataset.planetRemove), 1); box.diskSet({ planets: pl }); }
  else if (b.id === 'addPlanet') setPick(box.dataset.pick !== 'planet');
  sync();
});
rail.addEventListener('input', (e) => {
  const t = e.target; if (!live()) return;
  if (t.dataset.planetA != null) movePlanet(Number(t.dataset.planetA), aOf(t.value));
});

// ---------- the components (Show): each a toggle; turned on, its settings open below it ----------
// (round 6: the gas and its dust are one component, the engine's bits 1 and 2 together: the owner, "treat the gas as a
// mixture with its dust; the dust on its own hardly shows in the model". In the observed looks bit 2 is the lit surface
// the dust makes, which goes with the gas as well. A link with one of the two bits is read as both, linkMode.)
// (round 6: the amounts, the engine's display factors of the components, are gone from the page, the owner's choice: the
// model's own amounts are what is shown, and a link's g= is read past)
// opts: the engine's options that belong to it (the wind's asymmetry, the field lines' flow markers, the planets' waves);
// planets: the list of planets. The envelope and the labels have no settings of their own. (The flow markers move along
// the field lines, and the engine draws them only with the lines: the owner put them there, 2026-10-16.)
const COMPS = [
  { key: 'gas', bit: 3 }, { key: 'pebbles', bit: 4 },
  { key: 'wind', bit: 8, opts: ['asym'] }, { key: 'field', opt: 'field', opts: ['marks'] },
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
// is there room for a planet at a (within PL_A, at least 1.4 in the ratio of radii from the other shown planets)?
const roomFor = (list, a, skip) => a >= PL_A[0] && a <= PL_A[1] && list.every((p, i) => i === skip || !p[1] || Math.max(a, p[0]) / Math.min(a, p[0]) >= 1.4);
// a planet moved by a slider: held between its shown neighbours (1.4 in the ratio of radii)
function movePlanet(i, a) {
  const pl = S().planets; if (!pl[i]) return;
  let lo = PL_A[0], hi = PL_A[1];
  pl.forEach((p, j) => { if (j === i || !p[1]) return; if (p[0] <= pl[i][0]) lo = Math.max(lo, p[0] * 1.4); else hi = Math.min(hi, p[0] / 1.4); });
  pl[i][0] = Math.min(hi, Math.max(lo, a));
  box.diskSet({ planets: pl });
  planetsKey = ''; syncComps(S());
  popSync();
}
function syncComps(s) {
  const opt = { field: s.field, ann: s.ann };
  for (const { c, opts } of compEls) {
    const on = c.bit ? !!(s.mode & c.bit) : !!opt[c.opt];
    if (opts) opts.hidden = !on;
  }
  // the planets' rows (rebuilt when the list changes)
  const key = L() + JSON.stringify(s.planets);
  const list = $('comps').querySelector('.planet-list');
  pressed($('addPlanet'), box.dataset.pick === 'planet');
  if (!list || key === planetsKey) return;
  planetsKey = key;
  const w = T().show;
  list.replaceChildren(...s.planets.map(([a, on], i) => el('div', { class: 'planet-row' },
    el('button', { type: 'button', class: 'toggle small', 'data-planet-on': String(i), 'aria-pressed': String(!!on) }, w.planetRow(i + 1, fmtA(a))),
    el('input', { type: 'range', min: '0', max: '1000', step: '1', value: sliderOfA(a), 'data-planet-a': String(i), 'aria-label': w.orbit(i + 1) }),
    el('button', { type: 'button', class: 'icon-x', 'data-planet-remove': String(i), 'aria-label': w.remove, title: w.remove }, '×'))));
}

// placing a planet: a click on the disk (the engine sends diskpick instead of dropping pebbles)
function setPick(on) {
  if (on) box.dataset.pick = 'planet'; else delete box.dataset.pick;
  lab.classList.toggle('picking', !!on);
  if (on) note(T().show.picking, 0); else note('', 0);
  sync();
}
box.addEventListener('diskpick', (e) => {
  const w = T().show, pl = S().planets, a = roundA(Math.min(PL_A[1], Math.max(PL_A[0], e.detail.R)));
  if (!roomFor(pl, a, -1)) { note(w.noRoom, 3500); return; }
  const i = pl.findIndex((p) => !p[1]);
  if (i >= 0) pl[i] = [a, 1]; else if (pl.length < 4) pl.push([a, 1]); else { note(w.full, 3500); return; }
  box.diskSet({ planets: pl, mode: S().mode | 16 });
  setPick(false);
  note(w.placed(fmtA(a)), 3000);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (box.dataset.pick === 'planet') setPick(false); popClose(); } });

// a click on a planet in the picture: its orbit's slider, beside it
const pop = $('planetPop');
let popI = -1;
box.addEventListener('diskplanet', (e) => {
  popI = e.detail.i;
  const w = T().show, a = S().planets[popI][0];
  const input = el('input', { type: 'range', min: '0', max: '1000', step: '1', value: sliderOfA(a), 'aria-label': w.orbit(popI + 1),
    oninput: (ev) => movePlanet(popI, aOf(ev.target.value)) });
  pop.replaceChildren(el('span', { class: 'pop-name' }, w.planetRow(popI + 1, fmtA(a))), input,
    el('button', { type: 'button', class: 'icon-x', 'aria-label': 'close', onclick: popClose }, '×'));
  pop.hidden = false;
  const x = Math.min(stage.clientWidth - 230, Math.max(8, e.detail.x + 18)), y = Math.min(stage.clientHeight - 60, Math.max(8, e.detail.y - 22));
  pop.style.left = x + 'px'; pop.style.top = y + 'px';
  input.focus({ preventScroll: true });
});
function popSync() {
  if (pop.hidden || popI < 0) return;
  const a = S().planets[popI] && S().planets[popI][0];
  if (a == null) { popClose(); return; }
  pop.querySelector('.pop-name').textContent = T().show.planetRow(popI + 1, fmtA(a));
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
try { const k = sessionStorage.getItem('disk-lab-quality'); if (k && (k === 'auto' || QUALITY[k])) { quality = k; qChosen = true; } } catch { /* default */ }
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
const fixedScale = () => Math.min(QUALITY[quality] || 1, qCap, bestDefault() && live() && !S().paused ? bestCap : 1);
// the scale a fixed level asks for now, set when it changed (the clock paused or running again; not while the view moves,
// a still picture is sharpened, a measurement holds the governor or a picture is being saved)
let fixedPaused = null, skipFrames = 0;
function applyFixed() {
  if (quality === 'auto' || !live() || moveFrom || holdSharp || sharpFrom || saving || 'lost' in lab.dataset) return;
  const p = !!S().paused;
  if (p !== fixedPaused) { fixedPaused = p; relaxGuard(); syncQuality(); }
  const want = fixedScale();
  // (the frames still in flight were drawn at the scale left: not counted for the guards)
  if (Math.abs(box.diskScale() - want) > 0.004) { box.diskScale(want); skipFrames = 3; }
}
// the visitor's choice (kept for the visit); applyQuality: the level applied, chosen or the default
function setQuality(k) {
  qChosen = true;
  try { sessionStorage.setItem('disk-lab-quality', k); } catch { /* for this view only */ }
  applyQuality(k);
}
function applyQuality(k) {
  quality = k; qCap = 1; costs.length = 0; bestReset();
  unsharpen();
  if (live()) {
    if (k === 'auto') { const base = diag.calibration && diag.calibration.scale || 0.5; box.diskScale(S().look === 'co' ? CO_FLOOR : base); runScale = box.diskScale(); }
    else { qCap = S().look === 'co' ? CO_FLOOR : 1; box.diskScale(fixedScale()); }
  }
  govRest();
  sync();
}
function syncQuality() {
  qualityButtons.forEach((b) => pressed(b, b.dataset.quality === quality));
  const w = T().quality, n = $('qualityNote');
  if (quality === 'auto') n.textContent = w.autoNote;
  else if (bestDefault()) n.textContent = fixedScale() < 1 ? w.bestCapped(Math.round(100 * fixedScale())) : w.bestNote;
  else if (qCap < (QUALITY[quality] || 1)) n.textContent = w.capped(Math.round(100 * fixedScale()));
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
function guardFixed(dt, acc, accMax) {
  if (quality === 'auto' || !live() || holdSharp || moveFrom) return;
  guardBest(dt);
  if (!(dt > 0) || (S().paused && !(acc >= 2 && acc <= accMax))) return;
  costs.push(dt); if (costs.length > 6) costs.shift();
  const mean = costs.reduce((a, b) => a + b, 0) / costs.length, s = box.diskScale();
  if ((dt > 600 || (costs.length >= 4 && mean > 220)) && s > CO_FLOOR + 0.005) {
    const to = Math.max(CO_FLOOR, Math.min(s * 0.85, scaleFor(Math.max(dt, mean), s, 150)));
    // (round 7: the default Best's running step takes it, and comes back up by its quiet steps)
    if (bestDefault() && !S().paused && S().look !== 'co') { bestCap = Math.min(bestCap, to); bestChanged = performance.now(); bestRuns.length = 0; }
    else qCap = to;
    box.diskScale(fixedScale()); costs.length = 0; sync();
  }
}

// ---------- the citation ----------
function renderCite() {
  const w = T().cite, line = w.line(CITE_YEAR, CITE_URL);
  $('citeRail').replaceChildren(document.createTextNode(w.lead + ' '), el('span', { class: 'cite-line' }, line), ' ', el('button', { type: 'button', class: 'chip quiet', id: 'citeCopy' }, w.copy));
  $('citeAbout').textContent = w.lead; $('citeLine').textContent = line;
}
async function copyCite() {
  try { await navigator.clipboard.writeText(T().cite.line(CITE_YEAR, CITE_URL)); note(T().cite.copied); } catch { note(T().cite.line(CITE_YEAR, CITE_URL), 6000); }
}

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
  if (s.planets.length) u.searchParams.set('pl', s.planets.map(([a, on]) => a + ':' + on).join(','));
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
const SAVE_SIZES = ['1', '2', '4k'], SAVE_MPX = 12, SAVE_BAND_MS = 250, SAVE_BANDS = 8, SAVE_FRAMES = 12, SAVE_HEAVY = 400, SAVE_NEAR = 2;
let saveSize = '1';
try { const k = sessionStorage.getItem('disk-lab-save-size'); if (SAVE_SIZES.includes(k)) saveSize = k; } catch { /* the default */ }
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
  const sc = box.diskScale(), fm = fmNow || frameMs || (diag.calibration && diag.calibration.fullMs) || 100;
  // (the CO look, and a view whose frame on the screen already takes over SAVE_HEAVY ms, at the screen's size only)
  const st = S(), e = st.el * Math.PI / 180, a = st.az * Math.PI / 180;
  const camR = Math.hypot(st.tx + st.d * Math.cos(e) * Math.cos(a), st.ty + st.d * Math.cos(e) * Math.sin(a), st.tz + st.d * Math.sin(e));
  k = st.look === 'co' || fm > SAVE_HEAVY || camR < SAVE_NEAR ? 1 : Math.max(1, Math.min(k, m.k, Math.sqrt(SAVE_MPX * 1e6 / (sw * sh))));
  // (a frame at render scale `to` and k times the pixels: 12 % fixed, the rest with the pixels, as scaleFor)
  const cost = (to) => fm * (0.12 + 0.88 * (k * k * to * to) / (sc * sc));
  let to = 1, bands = Math.max(1, Math.ceil(cost(1) / SAVE_BAND_MS));
  if (k === 1) { to = Math.min(1, Math.max(sc, scaleFor(fm, sc, 400))); bands = 1; }   // (as before round 7, at the screen's size)
  else if (bands > SAVE_BANDS) { bands = SAVE_BANDS; to = Math.max(0.1, Math.min(1, sc / k * Math.sqrt(Math.max(0.01, (SAVE_BANDS * SAVE_BAND_MS / fm - 0.12) / 0.88)))); }
  return { k, w: Math.round(sw * k), h: Math.round(sh * k), to: Math.round(to * 100) / 100, bands };
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
    // (at the screen's size: at its resolution where a frame there is predicted under 400 ms from the frames just drawn,
    // else at the scale that keeps it so; a saved picture of the CO line's moments at full resolution took seconds a frame)
    const p = savePlan(saveSize !== '1' ? await box.diskCost() : 0);
    renderSaveSize(p);
    const c = await shot({ scale: p.to, size: p.k, bands: p.bands, bandMs: SAVE_BAND_MS, frames: SAVE_FRAMES, onFrame: (i, n) => note(T().imageProgress(i, n), 0) });
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
  try { sessionStorage.setItem('site-language', l); } catch { /* the choice still applies to this page */ }
  actionsKey = lookKey = cutKey = ''; clockShown = -1;
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
// or wheel on the page brings back the running scale before the engine sees the event. The scale is the one whose frame
// is predicted at SHARP_MS from the accumulation's own frames (what is drawn now: the CO line's moments cost some 30
// times the model, next to the star a frame costs 4 times the whole disk's; at scale 1 a frame of the moments took
// seconds, and the GPU dropped the WebGL context).
const SHARP_MS = 150;
let sharpFrom = 0, runScale = 0;   // runScale: the scale the model runs at (calibrated, then governed)
let lastFrame = 0, lastIdle = false, holdSharp = false, sharpWhat = '', frameMs = 0;   // sharpWhat: the look sharpened
document.addEventListener('visibilitychange', () => { lastFrame = 0; });
const recent = [];                 // the intervals between the accumulation's frames (ms; the last 12)
function unsharpen() {
  if (!sharpFrom) return;
  box.diskScale(sharpFrom); sharpFrom = 0; recent.length = 0;
  govRest();
}
function onAccumulated() {
  if (!live() || sharpFrom || moveFrom || holdSharp || quality !== 'auto' || 'lost' in lab.dataset || !(S().paused || reduce) || saving || recent.length < 4) return;
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
  // (WebGL stopped by the browser after a lost context: a reload may find it again, else a restart of the browser)
  if (stillReason === 'blocked') kids.push(el('button', { type: 'button', class: 'action', onclick: () => location.reload() }, w.retry));
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
  if (!diag.probe.ok && q.get('gl') !== 'force') return enterStill(q.get('retry') === '1' ? 'blocked' : diag.probe.reason);
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
  if (quality !== 'auto') applyQuality(quality);
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
  setClockRate(e.detail.clock);
  // (the intervals between frames of one still picture, at one scale, are what a frame of it costs; a complete picture
  // may be sharpened)
  const now = performance.now(), { acc = 0, accMax = 0 } = e.detail;
  // (round 7: an interval after a complete still picture, or after the page was hidden, is a rest, not a frame's cost:
  // counted, the first frame after the clock started again took the scale to its floor)
  if (lastIdle) lastFrame = 0;
  lastIdle = !!S().paused && accMax > 0 && acc >= accMax;
  applyFixed();
  if (skipFrames > 0) { skipFrames--; costs.length = 0; }
  else guardFixed(lastFrame ? now - lastFrame : 0, acc, accMax);
  // (what a frame costs now: consecutive frames, the clock running or a picture being averaged)
  if (lastFrame && now - lastFrame < 3000 && (!S().paused || acc >= 2)) frameMs = frameMs ? 0.7 * frameMs + 0.3 * (now - lastFrame) : now - lastFrame;
  if (acc >= 2 && lastFrame) { recent.push(now - lastFrame); if (recent.length > 12) recent.shift(); }
  lastFrame = now;
  if (accMax && acc >= accMax && lab.dataset.state === 'live') onAccumulated();
  watchMoving(e.detail);
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
let moveFrom = 0, moveTimer = 0, lastView = null;
function moving() {
  if (holdSharp || box.dataset.move === 'off' || !live() || 'lost' in lab.dataset) return;
  if (!moveFrom) {
    unsharpen();
    moveFrom = box.diskScale();
    const floor = S().look === 'co' ? CO_FLOOR : MIN_SCALE;
    const to = quality === 'auto' ? Math.max(floor, Math.min(moveFrom, MOVE_K * runScale)) : Math.min(moveFrom, MOVE_FIXED);
    if (gov) gov.pause(true);
    if (to < moveFrom - 0.005) box.diskScale(Math.round(to * 1000) / 1000);
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
  if (live()) box.diskScale(quality === 'auto' ? runScale : fixedScale());
  govRest();
}
// A lost context usually comes back by itself within a second or two. If it has not after RETRY_AFTER, the stage offers
// to draw again: the page is loaded anew with the view and settings in its address (linkFor), and retry=1 tells the
// start that a failing probe means the browser has stopped WebGL (after repeated losses Chrome blocks it until restart).
const RETRY_AFTER = 2500;
let retryTimer = 0;
const stageRetry = $('stageRetry');
function retryLive() {
  let href = location.href;
  try { href = linkFor(S()); } catch { /* (the state may be out of reach while the context is lost) */ }
  const u = new URL(href); u.searchParams.set('retry', '1'); u.searchParams.delete('still'); location.replace(u.href);
}
$('retryLive').addEventListener('click', retryLive);
function showRetry(on) {
  clearTimeout(retryTimer);
  if (on) { stageRetry.firstElementChild.textContent = T().still.retryText; $('retryLive').textContent = T().still.retry; }
  stageRetry.hidden = !on;
}
box.addEventListener('disklost', (e) => {
  if (e.detail.lost) {
    lab.dataset.lost = ''; posterKey = ''; setPoster(PLACES[placeI].id); note(T().still.lost, 0);
    clearTimeout(retryTimer); retryTimer = setTimeout(() => { if ('lost' in lab.dataset) { note('', 0); showRetry(true); } }, RETRY_AFTER);
  }
  else {
    // (the engine is built anew from its data attributes: give it back the scale it ran at)
    delete lab.dataset.lost; note('', 0); showRetry(false);
    sharpFrom = 0; recent.length = 0; govRest();
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
  pauseGovernor: (on) => { holdSharp = !!on; if (on) unsharpen(); govRest(); },
  setQuality: (k) => setQuality(k),
  // (for measurements: record the default Best's quiet steps from now, or stop and return them)
  bestLog: (on) => { const l = bestLog; bestLog = on ? [] : null; return l; },
  quality: () => ({ quality, chosen: qChosen, qCap, bestCap, hold: bestHold, scale: live() ? box.diskScale() : 0, paused: live() ? !!S().paused : null, moving: !!moveFrom, sharpened: !!sharpFrom, held: holdSharp, saving }),
  // (for checks: back to the default, Best not chosen)
  defaultQuality: () => { qChosen = false; try { sessionStorage.removeItem('disk-lab-quality'); } catch { /* */ } applyQuality('full'); },
  // (for checks: a picture with the mark, as saved)
  stamped: async () => { const c = await shot({}); if (c) await watermark(c); return c; },
  setLook, setLang, setTab: (t) => setTab(t), link: () => (live() ? linkFor(S()) : null), snapshot: (opts) => shot(opts)
};
$('colophon').textContent = `Disk Lab ${VERSION} · engine ${ENGINE_SRC.split('v=')[1]}`;
start();
