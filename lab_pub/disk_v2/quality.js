// Can this device draw the live model, and at what resolution? (DESIGN.md, section 7)
//
// probe(): decided before the engine is loaded, on a throwaway WebGL2 context. A context refused with
//   failIfMajorPerformanceCaveat but granted without it, or a renderer named as software (SwiftShader, llvmpipe, ...),
//   means that WebGL "works" on the CPU: far too slow for a ray march, so the page shows its stills instead.
// calibrate(box): right after the engine has started, before the picture is shown. One diskBench at the starting
//   render scale gives the GPU time of a frame; that time grows nearly as the number of pixels (measured on an M1 Max:
//   7.2, 12.9, 33.3 ms at scales 0.4, 0.6, 1.0, for pixel counts 0.44, 1, 2.78), so the scale that fits the budget
//   follows; a second, shorter bench at that scale corrects it once.
// govern(box): while the model runs, the intervals between drawn frames decide small steps down (the upper quartile or
//   the mean interval above 22 ms) or up (both below 17.8 ms, three windows running), never back above a scale found
//   too slow lately. Not the median: frames that miss the display's refresh come at twice its interval, and a median of
//   16.7 ms hid 42% of frames at 33 ms in the first trial; the mean catches the long stalls between quick frames.
// The engine's own adapt() steps 0.8x or 1.15x every 90 frames, from data-scale up to data-scale-max: the page starts
// it with data-scale-max below every scale it sets, so that it never raises the scale on its own (it may still lower
// it, above 0.4, when frames run late: a safety net in the same direction).

export const SOFTWARE = /swiftshader|llvmpipe|softpipe|lavapipe|software|basic render|mesa offscreen|gdi generic/i;

function lose(gl) {
  try { const x = gl && gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); } catch { /* nothing to free */ }
}
function rendererOf(gl) {
  try {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch { return ''; }
}

// { ok, reason: null | 'nogl' | 'software', renderer }
export function probe() {
  let gl = null, renderer = '';
  try {
    gl = document.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: true });
    if (!gl) {
      const any = document.createElement('canvas').getContext('webgl2');
      if (!any) return { ok: false, reason: 'nogl', renderer };
      renderer = rendererOf(any); lose(any);
      return { ok: false, reason: 'software', renderer, caveat: true };
    }
    renderer = rendererOf(gl);
    if (SOFTWARE.test(renderer)) return { ok: false, reason: 'software', renderer };
    // (the engine draws its lookup maps into float targets)
    if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) return { ok: false, reason: 'nogl', renderer };
    return { ok: true, reason: null, renderer };
  } catch {
    return { ok: false, reason: 'nogl', renderer };
  } finally { lose(gl); }
}

// ms of GPU time per frame (as diskBench measures it: one frame, the GPU idle) aimed at. The running frame costs more
// (compositing, the overlay, frames queued behind each other): on the M1 Max, 14 ms in the bench kept 60 frames/s and
// 15.6 ms already missed the refresh in 42% of frames.
export const BUDGET = 13.5;
export const MIN_SCALE = 0.25;  // below this the picture turns to mush; a device that needs less gets the stills
export const SLOW = 110;        // ms per frame predicted at MIN_SCALE beyond which the live model is not worth it

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
// the time of a frame at a scale, from one measured at s0: a fixed share (the maps, the overlay's upload) and a part
// that grows as the pixels, that is as the square of the scale
const FIXED = 0.12;
const timeAt = (t0, s0, s) => t0 * (FIXED + (1 - FIXED) * (s / s0) ** 2);
const scaleFor = (t0, s0, budget) => s0 * Math.sqrt(Math.max(0.01, (budget / t0 - FIXED) / (1 - FIXED)));

// { scale, t0, s0, t1, s1, predictedAtMin, fullMs (a frame at scale 1), slow, timer }
export async function calibrate(box, { budget = BUDGET } = {}) {
  const frameMs = (r) => (r && isFinite(r.gpu) && r.gpu > 0 ? r.gpu : r && r.wall);
  const s0 = box.diskScale();
  const r0 = await box.diskBench(4);
  const t0 = frameMs(r0);
  if (!(t0 > 0)) return { scale: s0, t0: NaN, s0, slow: false, timer: false };
  let scale = clamp(scaleFor(t0, s0, budget), MIN_SCALE, 1);
  let t1 = NaN, s1 = NaN;
  if (Math.abs(scale - s0) > 0.08) {
    s1 = box.diskScale(scale);
    const r1 = await box.diskBench(3);
    t1 = frameMs(r1);
    if (t1 > 0) scale = clamp(scaleFor(t1, s1, budget), MIN_SCALE, 1);
  }
  const ref = t1 > 0 ? [t1, s1] : [t0, s0];
  const predictedAtMin = timeAt(ref[0], ref[1], MIN_SCALE);
  box.diskScale(scale);
  return { scale: Math.round(scale * 1000) / 1000, t0, s0, t1, s1, predictedAtMin: Math.round(predictedAtMin * 10) / 10,
    fullMs: Math.round(timeAt(ref[0], ref[1], 1) * 10) / 10,
    slow: predictedAtMin > SLOW, timer: isFinite(r0.gpu) && r0.gpu > 0, size: r0.size };
}

// Steps the render scale with the intervals between drawn frames; returns { stop, state }.
// base: the scale found at start (calibrate); far below it, the way back up is quicker (a burst of load, another tab, a
// snapshot, may have pushed the scale to its floor).
export function govern(box, { onChange, base = 0.5, running = () => true } = {}) {
  const WINDOW_MS = 1500, MIN_FRAMES = 30, SLOW_MS = 22, FAST_MS = 17.8, AIM_MS = 16.7, IDLE_MS = 250, STALL_MS = 2000, RELAX_MS = 8000;
  let iv = [], last = 0, since = performance.now(), fastRuns = 0, ceiling = 1, ceilingT = 0, paused = false;
  const log = [];
  const quartile = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(0.75 * (s.length - 1))]; };
  const set = (s, why, m) => {
    const now = box.diskScale(), next = Math.round(clamp(s, MIN_SCALE, 1) * 1000) / 1000;
    if (Math.abs(next - now) < 0.01) return;
    box.diskScale(next);
    log.push({ t: Math.round(performance.now()), from: now, to: next, why, ms: Math.round(m * 10) / 10 });
    if (log.length > 40) log.shift();
    if (onChange) onChange(next, why);
  };
  const onFrame = () => {
    const now = performance.now();
    if (document.hidden || paused) { last = 0; return; }
    // (a gap means nothing was being drawn: a paused, settled picture; it says nothing of the frame rate. While the clock
    // runs every frame is drawn, and a long interval is a stall, which counts)
    if (last && (running() ? now - last < STALL_MS : now - last < IDLE_MS)) iv.push(now - last);
    last = now;
    if (ceiling < 1 && now - ceilingT > RELAX_MS) { ceiling = Math.min(1, ceiling * 1.12); ceilingT = now; }
    if (iv.length < MIN_FRAMES || now - since < WINDOW_MS) return;
    // Two measures of the window: the upper quartile of the intervals (frames that miss the display's refresh), and the
    // mean (the throughput, stalls included). Near the star the engine reads its exposure measurement back every few
    // frames; Chrome then waits for all the GPU work queued so far, and frames that came every 6 ms meet a 100-400 ms
    // stall: the quartile stays low while a third of the time is lost. The lower the scale, the shorter the queue.
    const q75 = quartile(iv), mean = iv.reduce((a, b) => a + b, 0) / iv.length, m = Math.max(q75, mean), s = box.diskScale();
    iv = []; since = now;
    if (m > SLOW_MS && s > MIN_SCALE) {
      ceiling = Math.min(ceiling, s * 0.92); ceilingT = now; fastRuns = 0;
      set(s * clamp(Math.sqrt(AIM_MS / m), 0.6, 0.92), 'slow', m);
    } else if (m < FAST_MS) {
      const low = s < 0.8 * base;
      if (++fastRuns >= (low ? 2 : 3) && s < Math.min(1, ceiling)) { fastRuns = 0; set(Math.min(ceiling, s * (low ? 1.25 : 1.12)), 'fast', m); }
    } else fastRuns = 0;
  };
  box.addEventListener('diskframe', onFrame);
  return {
    stop: () => box.removeEventListener('diskframe', onFrame),
    // (frames drawn for a snapshot, at another scale, say nothing of the running frame rate; the engine also puts its
    // scale back at the end of a snapshot, which would undo a step taken meanwhile)
    pause: (on) => { paused = !!on; iv = []; last = 0; since = performance.now(); },
    state: () => ({ scale: box.diskScale(), ceiling: Math.round(ceiling * 1000) / 1000, log: log.slice() })
  };
}
