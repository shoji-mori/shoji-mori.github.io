# Disk Lab

The public disk model, at https://shoji-mori.github.io/disk-lab/: a protoplanetary disk drawn on the GPU (WebGL2) in the
browser, with nine places to visit, five looks (model, visible, mid-infrared, millimetre, CO), and still pictures
where the live model cannot run. Static files only: no build, no dependencies. This folder is both where it is developed
and what is published (it was `lab_pub/disk_v2/`, hidden, until round 4). The site links to it from the home and research
pages, with a view transition (DESIGN.md, section 12). Why it is built this way: [DESIGN.md](DESIGN.md) (in Japanese).

## Run it

    python3 ver2/tools/disk-lab-v2/serve.py          # from the repository root; no-store, 127.0.0.1 only
    open http://127.0.0.1:8642/disk-lab/

The page reads `/fonts/inter-latin-*.woff2` and `/images/favicon.svg` from the site's root, so serve the repository
root (as GitHub Pages does).

URL parameters:

| parameter | effect |
| --- | --- |
| `lang=en` / `lang=ja` | language (otherwise the visit's choice, `sessionStorage['site-language']`, then the browser's) |
| `place=whole` … `afar` | start at a place (`whole wind snow planet mm heat deadzone star afar`) |
| `el az d look mode field ann asym marks waves slice sq p tx ty tz speed paused t com cov ms` | a view, as "Copy a link" writes it (the same keys as the archived preview page's links). `sq` is `T`, `rho` or `layers` (the Regions); an old link's `tau` opens the temperature, `none` the density. A `mode` with one of the bits 1 and 2 turns on both (the gas with its dust); bit 64 is the jet (round 8). `marks` the flow arrows (the gas's option since round 8) |
| `bg=off` / `bg=cloud` | the background: none, or the dark molecular cloud of a star-forming region (round 8; the stars, the default, are not written) |
| `pl=3:1:1,8:0:0.1` | the planets: orbital radius (au, 0.05 to 20 since round 7), on (1) or off (0), and mass in Jupiter masses (round 8: 10 Earth masses to 3; without it, 1), up to four |
| `g=1,1,1,1` | (until round 6: the display amounts; read past now, the model's own amounts are shown) |
| `still=1` | show the still pictures (as without WebGL2) |
| `gl=force` | skip the check for software rendering and slow devices |
| `motion=reduce` | behave as with the system's reduced-motion setting |

## Files

| file | what |
| --- | --- |
| `index.html` | markup and the fixed text in both languages (`.en` / `.ja` spans) |
| `disk-lab.css` | all styles |
| `app.js` | the page: the sandbox (rail), the highlights (places), links, stills, the full-resolution still picture |
| `places.js` | the nine places (view, look, components, control) and the distance fitted to the stage |
| `words.js` | the text that changes with the state, in both languages |
| `quality.js` | whether the live model can run, the start-up calibration and the render-scale governor |
| `capture.js` | saving a picture (works around `drawImage` reading nothing from the engine's canvas in Chrome) |
| `engine/disk3d.js` | Disk Lab's own GPU engine, begun as a copy of the preview page's `disk3d.js` (9436767, now archived); `engine/CHANGES.md` records what changed and what was taken from or left in the other lines, `engine/SOURCE.txt` the base and the SHA-256s |
| `logo-white.svg` | the site's header mark (`/images/logo-mark.svg` on origin/main) in white: the faint watermark on the stage and in saved pictures |
| `stills/` | 36 WebP stills: `<place>-<lang>-wide.webp` (2400 × 1200), `<place>-<lang>-tall.webp` (1200 × 1500) |

## Check it

In the page's console (a visible window gives frame times too):

    const c = await import('/ver2/tools/disk-lab-v2/check.js');
    const r = await c.run();          // the page's checks, about two minutes
    console.table(r.rows)

`await c.stalls()` measures, in a visible window, the stalls of the engine's exposure readback near the star,
`await c.pacing({ scale: 0.4, flight: 2 })` the frame rate, the readbacks and the drag latency at a fixed scale, and
`await c.zoomPacing()` the frame intervals while the wheel zooms in and out (DESIGN.md, section 7).
`ver2/tools/disk-lab-v2/frame.html?w=390&h=760&src=/disk-lab/%3Flang%3Dja` shows the page at a phone's size in
a desktop window. With `serve.py --save-dir DIR`, `c.run({ save: 'check.json' })` writes the results there.
In that frame, `const t = await import('/ver2/tools/disk-lab-v2/touch-check.js'); await t.run(frames[0])` plays
synthetic two-finger gestures on the picture and reports how far each moved the view (round 8, DESIGN.md section 21).

The engine's own checks (ver2/tools/disk-check's state matrix, on v2's engine, with the states close to the star):

    const e = await import('/ver2/tools/disk-lab-v2/engine-check.js');
    const m = await e.run();          // 300 states (346 until round 6, when the cut lost two quantities), about 8 minutes; m.problems

## The engine

The engine is Disk Lab's own (`engine/CHANGES.md`). It began as a copy of the preview page's engine; that page has been
archived, so there is no upstream to compare with any more (`sync-engine.sh` only says so). A change is made in
`engine/disk3d.js` and recorded in `engine/CHANGES.md`; then `engine/SOURCE.txt` and `ENGINE_SRC`'s `?v=` in `app.js`
take the new SHA-256, the checks run, and the stills are remade if the picture changed.
`ver2/tools/disk-lab-v2/engine-patch.py` is the record of the first round's patch (frames in flight, the exposure's
readback at the start of a frame; DESIGN.md, section 7, "GPU の待ち行列"), which the engine carries.

## Remake the stills

    python3 ver2/tools/disk-lab-v2/serve.py --save-dir /tmp/disk-stills
    open http://127.0.0.1:8642/ver2/tools/disk-lab-v2/stills.html      # a window with devicePixelRatio 2; ~3 minutes
    sh ver2/tools/disk-lab-v2/stills-webp.sh /tmp/disk-stills

## Publishing

`disk-lab/` is published as it is, at `/disk-lab/` (indexed: robots, canonical and Open Graph tags in `index.html`;
`og.jpg`, 1200 x 630, is the whole disk's still). It needs `/fonts/` and `/images/favicon.svg` at the site's root, and
uses relative paths otherwise. Bump the `?v=` of
`disk-lab.css` and `app.js` in `index.html`, and of the modules `app.js` imports (`places.js`, `words.js`, `quality.js`,
`capture.js`), when they change (the page is served with the site's caching, and a new `app.js` with an old module
cached would fail).

## Citation and quality

The suggested citation is built from `CITE_URL` (the public address) and `CITE_YEAR` at the top of `app.js`: change the
URL there if the page ever moves. The quality levels (render scale of a fixed level) are `QUALITY` beside them. Best is
the default (round 6): not chosen by the visitor, it steps down quietly where a view is too heavy (`BEST_SLOW`, `BEST_AIM`,
`BEST_UP`, `BEST_STEPS` in `app.js`; DESIGN.md, section 16). Since round 7 that step is for the running clock only (a
paused picture is drawn at 100 %), and it comes back up one level at a time after a hold (`BEST_HOLD`, doubled up to
`BEST_HOLD_MAX` when a step up is taken back within `BEST_UNDO`; frames at the display's pace, under `BEST_PACED`, try the
next level); `diskLab.quality()` and `diskLab.bestLog(true)` show it (DESIGN.md, section 17). A choice is kept for the
visit (sessionStorage `disk-lab-quality`). While the
view moves, the volume is drawn at a lower scale and the scale comes back 0.2 s after it stops (`MOVE_K`, `MOVE_FIXED`,
`MOVE_REST` in `app.js`; DESIGN.md, section 13); `data-move="off"` on `#disk` turns this off, to compare
(`check.js`'s `zoomPacing` and `dragPacing`).

## Saving a larger picture

"Save an image" offers the screen's size, twice that, or 3840 px wide (4K) (`SAVE_SIZES`, at most `SAVE_MPX` million
pixels and the GPU's limits, `box.diskSnapMax()`). The engine's `diskSnapshot({ size, bands, bandMs, frames, onFrame })`
draws the canvas `size` times larger for the picture, each frame's volume in `bands` sent to the GPU one by one (more where
one runs over twice `bandMs`), frame by frame; the page plans it from the cost of a frame measured just before
(`box.diskCost()`, `SAVE_BAND_MS`, `SAVE_BANDS`) and keeps the CO look and any view slower than `SAVE_HEAVY` ms a frame at
the screen's size (a CO moment map at 4K lost the WebGL context). `box.diskSnapLog()` gives the last one's bands and times.

## The temperature

`THERMO` at the top of `engine/disk3d.js` holds the temperature's parameters (the star's luminosity, its colour
temperature, the accretion rate, the Rosseland opacity, the turbulent alpha, the heating layer's optical depth, the
thermal ionization and dust sublimation temperatures); `tempAt` in the shaders and `tempJS` in the script use them, and the
thermally ionized edge `NONIDEAL.R_TI` and the snow line follow. `box.diskTemp(R, z)` returns the temperature at R and z
(au), the midplane's, ln tau*, the snow line and R_TI (DESIGN.md, section 17, has the equations and the sources).
