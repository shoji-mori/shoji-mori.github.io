// Disk Lab's scenes for talks (round 11a): a scene is a view the presenter set up and added (the camera, the look, the cut, what
// is shown, the clock), a sequence the scenes in order; the presenter flies from one to the next (app.js, the engine's diskPath).
// Here the data alone: a scene from the engine's state, every value checked as a link's are (a file or a link may come from
// anyone), and a sequence as a JSON file or in a link's fragment (#seq=, never sent to the server). No DOM. The design:
// ver2/docs/disk-lab-r11-camera.md, section 2; DESIGN.md, section 25.
//
// A scene (a "key"):
//   { label, place (the place it was made at, if the view had not left it), view: { el, az, d, tx, ty, tz, p, pi } (az: the
//     camera's azimuth as the engine's state gives it), aspect (the stage's width / height then: a narrower stage later moves
//     the camera back, as the places are fitted), look, coMode, coV, set: { mode, field, ann, marks, waves, asym, ms, slice, sq,
//     bg, planets }, clock: { paused, speed, t } (t kept for the video export to come; the live presenter sets the pause and
//     the speed only, see app.js), hold (s, the autoplay's rest), move: { dur, turns, speed } (how to fly into it; none made
//     by the page yet but the built-in moves) }
// A sequence: { v: 1, app: 'disk-lab', engine, made, pace, keys }.

export const SEQ_V = 1;
export const SEQ_MAX = 60;                 // scenes at most (a talk's worth; a link of 60 is some 5 kB)
export const PACES = { slow: 0.6, normal: 1, fast: 1.7 };   // the presenter's pace: times the engine's cruise speed

const LOOKS = ['model', 'optical', 'mir', 'mm', 'co'], CO_MODES = ['chan', 'm1', 'm0'], SQS = ['T', 'rho', 'layers'], BGS = ['off', 'stars', 'cloud'];
const SET_BITS = ['field', 'ann', 'marks', 'waves', 'asym', 'ms'];
const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v, k) => Math.round(v * k) / k;
// a number within [lo, hi], rounded to 1 / k, or undefined (left out: the scene keeps what is there)
const inRange = (v, lo, hi, k) => { const n = num(v); return Number.isFinite(n) ? round(clamp(n, lo, hi), k) : undefined; };
const bit = (v) => (v === 1 || v === true || v === '1' ? 1 : v === 0 || v === false || v === '0' ? 0 : undefined);
const pickDef = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

// A scene from the engine's state (box.diskState()) and the page's: the place it was made at (null if the view has left it), its
// label, the stage's aspect. Numbers rounded as a link rounds them (0.01 degree, 0.001 au), so that a link restores the picture
// within a pixel.
export function keyFrom(s, { label = '', place = null, aspect = 0, hold } = {}) {
  return checkKey({
    label, place, aspect,
    view: { el: s.el, az: s.az, d: s.d, tx: s.tx, ty: s.ty, tz: s.tz, p: s.p, pi: s.pi },
    look: s.look, coMode: s.coMode, coV: s.coV,
    set: { mode: s.mode, field: s.field, ann: s.ann, marks: s.marks, waves: s.waves, asym: s.asym, ms: s.ms, slice: s.slice, sq: s.sq, bg: s.bg, planets: s.planets },
    clock: { paused: s.paused, speed: s.speed, t: s.time },
    hold
  });
}

// A scene checked: every number finite and within the engine's ranges (its diskSet checks them again), every name one it knows;
// what fails is left out. null where nothing of a view is left.
export function checkKey(k) {
  if (!k || typeof k !== 'object') return null;
  const v = k.view && typeof k.view === 'object' ? k.view : {};
  const view = pickDef({
    el: inRange(v.el, -89, 89, 100),
    az: Number.isFinite(num(v.az)) ? round(((num(v.az) % 360) + 540) % 360 - 180, 100) : undefined,
    d: Number.isFinite(num(v.d)) && num(v.d) > 0 ? round(clamp(num(v.d), 0.01, 600), 1000) : undefined,
    tx: inRange(v.tx, -400, 400, 1e4), ty: inRange(v.ty, -400, 400, 1e4), tz: inRange(v.tz, -400, 400, 1e4),
    p: bit(v.p), pi: inRange(v.pi, 0, 3, 1)
  });
  if (!['el', 'az', 'd'].some((x) => x in view)) return null;
  const out = { view };
  if (typeof k.label === 'string' && k.label.trim()) out.label = k.label.trim().slice(0, 80);
  if (typeof k.place === 'string' && /^[a-z]{2,12}$/.test(k.place)) out.place = k.place;
  const a = num(k.aspect); if (a > 0.2 && a < 5) out.aspect = round(a, 1000);
  if (LOOKS.includes(k.look)) out.look = k.look;
  if (CO_MODES.includes(k.coMode)) out.coMode = k.coMode;
  const cv = inRange(k.coV, -20, 20, 100); if (cv !== undefined) out.coV = cv;
  const s = k.set && typeof k.set === 'object' ? k.set : {}, set = {};
  const mode = num(s.mode); if (Number.isFinite(mode)) set.mode = Math.round(mode) & 127;
  for (const b of SET_BITS) { const x = bit(s[b]); if (x !== undefined) set[b] = x; }
  const sl = inRange(s.slice, 0, 2, 1); if (sl !== undefined) set.slice = sl;
  if (SQS.includes(s.sq)) set.sq = s.sq;
  if (BGS.includes(s.bg)) set.bg = s.bg;
  if (Array.isArray(s.planets)) {
    const pl = s.planets.filter((x) => Array.isArray(x)).slice(0, 4).map((x) => [inRange(x[0], 0.05, 20, 1000), bit(x[1]), inRange(x[2] ?? 1, 0.03, 3, 1e4)]).filter((x) => x[0] !== undefined && x[1] !== undefined && x[2] !== undefined);
    set.planets = pl;
  }
  if (Object.keys(set).length) out.set = set;
  const c = k.clock && typeof k.clock === 'object' ? k.clock : null;
  if (c) { const clock = pickDef({ paused: bit(c.paused), speed: inRange(c.speed, 0.1, 10, 1000), t: inRange(c.t, 0, 1e6, 1000) }); if (Object.keys(clock).length) out.clock = clock; }
  const h = inRange(k.hold, 0, 60, 10); if (h !== undefined) out.hold = h;
  const m = k.move && typeof k.move === 'object' ? k.move : null;
  if (m) { const move = pickDef({ dur: inRange(m.dur, 0.5, 120, 100), turns: inRange(m.turns, -4, 4, 1), speed: inRange(m.speed, 0.25, 4, 100) }); if (Object.keys(move).length) out.move = move; }
  return out;
}

// A sequence checked (a file's, a link's, the device's): its scenes checked, those that are not left out; null if it is not a
// sequence of Disk Lab's. A later version's (v > 1) is read as far as this one knows it.
export function checkSeq(o) {
  if (!o || typeof o !== 'object' || !Array.isArray(o.keys)) return null;
  if (o.app != null && o.app !== 'disk-lab') return null;
  const keys = o.keys.slice(0, SEQ_MAX).map(checkKey).filter(Boolean);
  const pace = Object.prototype.hasOwnProperty.call(PACES, o.pace) ? o.pace : 'normal';
  return { v: SEQ_V, app: 'disk-lab', engine: typeof o.engine === 'string' ? o.engine.slice(0, 16) : '', made: typeof o.made === 'string' ? o.made.slice(0, 10) : '', pace, keys };
}

// A sequence in a link's fragment: '#seq=' and a letter for the encoding, then the JSON in base64url: z, deflate-raw; d, deflate
// (where the browser has CompressionStream but not that format: not verified for every browser, see the design's section 2.2);
// j, the JSON as it is.
const b64u = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = (t) => { const s = atob(t.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((t.length + 3) % 4)); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };
async function pump(stream, max) {
  const r = stream.getReader(), parts = []; let n = 0;
  for (;;) {
    const { done, value } = await r.read(); if (done) break;
    n += value.length;
    if (n > max) { try { await r.cancel(); } catch { /* gone */ } throw new Error('too large'); }   // (a link that inflates to megabytes is not a talk)
    parts.push(value);
  }
  const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const squeeze = (bytes, fmt) => pump(new Blob([bytes]).stream().pipeThrough(new CompressionStream(fmt)), 1 << 22);
const unsqueeze = (bytes, fmt) => pump(new Blob([bytes]).stream().pipeThrough(new DecompressionStream(fmt)), 1 << 18);

export async function seqToHash(seq) {
  const json = new TextEncoder().encode(JSON.stringify(checkSeq(seq)));
  if (typeof CompressionStream === 'function') {
    for (const [tag, fmt] of [['z', 'deflate-raw'], ['d', 'deflate']]) {
      try { return '#seq=' + tag + b64u(await squeeze(json, fmt)); } catch { /* the next */ }
    }
  }
  return '#seq=j' + b64u(json);
}
// the sequence in a fragment, or null (not one, or not readable here: a link longer than 64 kB is not one either)
export async function seqFromHash(hash) {
  const m = /^#?seq=([zdj])([A-Za-z0-9_-]{1,65536})$/.exec(hash || '');
  if (!m) return null;
  try {
    let bytes = unb64u(m[2]);
    if (m[1] !== 'j') { if (typeof DecompressionStream !== 'function') return null; bytes = await unsqueeze(bytes, m[1] === 'z' ? 'deflate-raw' : 'deflate'); }
    return checkSeq(JSON.parse(new TextDecoder().decode(bytes)));
  } catch { return null; }
}
