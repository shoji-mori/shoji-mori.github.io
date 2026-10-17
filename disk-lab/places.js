// The places of Disk Lab: where the camera goes, in which look, and what must be shown there for the text to be true.
// The views come from the (now archived) preview page's tour and presets (its disk3d.js, TOUR and VIEWS); distances are
// for a wide stage and are lengthened on narrow ones (see fitDistance). The text of each place is in words.js under the
// same id.
//
//   view    el, az (degrees), d (au); p: 1 follows the planet (az is then measured from the planet)
//   fitW    half-width (au) that must stay in view across the stage; 0 when the subject sits at the centre
//   look    the look the place is written for
//   field   the field lines drawn there (the engine's lines over the volume)
//   cut     null, or { slice: 1 (half) | 2 (quarter), sq } with sq one of T, rho, tau, layers, none
//   needs   bits of the engine's mode that the text describes (1 gas, 2 its small dust (the lit surface in the observed looks; the page
//           shows 1 and 2 as one, the gas), 4 pebbles, 8 wind, 16 planet,
//           32 envelope, 64 jet (round 8)); turned on when arriving, other bits left as the visitor set them
//   hides   bits turned off when arriving (default none; until round 7 the envelope everywhere but afar, as it showed only
//           from about 150 au: on a narrow stage the whole disk, seen from 135 au, showed a part of it. Round 8: it shows
//           faintly from 40 au and in full from afar, so it is left as the visitor set it)
//   action  the one control of the place (see app.js): 'asym', 'burst', 'waves', 'noplanet', or 'cut' (the quantities)

export const FOV = 32;   // the engine's vertical field of view (data-fov), degrees

export const PLACES = [
  // (round 8: the whole disk seen from 16 degrees, 22 before, so that its flared, lit surface and the dark band under it show)
  { id: 'whole', view: { el: 16, az: -65, d: 90 }, fitW: 31, look: 'model', field: 0, cut: null, needs: 1 | 2 | 4 | 8 },
  { id: 'wind', view: { el: 10, az: -80, d: 60 }, fitW: 22, look: 'model', field: 1, cut: null, needs: 1 | 2 | 8 | 64, action: 'asym' },
  { id: 'snow', view: { el: 30, az: -65, d: 9 }, fitW: 3.6, look: 'model', field: 0, cut: null, needs: 1 | 2 | 4, action: 'burst' },
  { id: 'planet', view: { p: 1, el: 30, az: 160, d: 1.6 }, fitW: 0.6, look: 'model', field: 0, cut: null, needs: 1 | 2 | 4 | 16, action: 'waves' },
  { id: 'mm', view: { el: 50, az: -65, d: 15 }, fitW: 6, look: 'mm', field: 0, cut: null, needs: 4 | 16, action: 'noplanet' },
  { id: 'heat', view: { el: 6, az: -65, d: 2.4 }, fitW: 1.3, look: 'model', field: 0, cut: { slice: 1, sq: 'T' }, needs: 1 | 2, action: 'cut' },
  { id: 'deadzone', view: { el: 24, az: -65, d: 3.4 }, fitW: 1.6, look: 'model', field: 0, cut: { slice: 2, sq: 'layers' }, needs: 1 | 2, action: 'cut' },
  { id: 'star', view: { el: 22, az: -65, d: 0.15 }, fitW: 0.07, look: 'model', field: 1, cut: null, needs: 1 | 2 },
  { id: 'afar', view: { el: 14, az: -65, d: 340 }, fitW: 0, look: 'model', field: 0, cut: null, needs: 1 | 2 | 8 | 32 | 64 }
];

export const placeById = (id) => PLACES.find((p) => p.id === id) || null;

// The distance at which a half-width w (au) around the point looked at fills the stage across, for a stage of
// width / height = aspect: the engine's field of view is vertical, so a narrow stage needs the camera farther away.
export function fitDistance(place, aspect) {
  const d = place.view.d;
  if (!place.fitW || !(aspect > 0)) return d;
  return Math.max(d, place.fitW / (Math.tan(FOV * Math.PI / 360) * aspect));
}

// The engine's state for arriving at a place (diskSet keys), given the components shown now and the stage's aspect.
export function placeState(place, mode, aspect) {
  const v = place.view, st = { p: v.p ? 1 : 0, el: v.el, az: v.az, d: Math.round(fitDistance(place, aspect) * 1000) / 1000,
    tx: 0, ty: 0, tz: 0, look: place.look, field: place.field, mode: (mode | place.needs) & ~(place.hides ?? 0) };
  if (place.cut) { st.slice = place.cut.slice; st.sq = place.cut.sq; } else st.slice = 0;
  return st;
}
