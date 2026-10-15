# Disk Lab v2

The public version of the disk model: a protoplanetary disk drawn on the GPU (WebGL2) in the browser, with nine places
to visit, five looks (model, scattered light, mid-infrared, millimetre, CO), and still pictures where the live model
cannot run. Static files only: no build, no dependencies. The page is hidden for now (`noindex`, not linked from the
site). Why it is built this way: [DESIGN.md](DESIGN.md) (in Japanese).

## Run it

    python3 ver2/tools/disk-lab-v2/serve.py          # from the repository root; no-store, 127.0.0.1 only
    open http://127.0.0.1:8642/lab_pub/disk_v2/

The page reads `/fonts/inter-latin-*.woff2` and `/images/favicon.svg` from the site's root, so serve the repository
root (as GitHub Pages does).

URL parameters:

| parameter | effect |
| --- | --- |
| `lang=en` / `lang=ja` | language (otherwise the visit's choice, `sessionStorage['site-language']`, then the browser's) |
| `place=whole` … `afar` | start at a place (`whole wind snow planet mm heat deadzone star afar`) |
| `el az d look mode field ann asym marks waves slice sq p tx ty tz speed paused t com cov ms` | a view, as "Copy a link" writes it (the same keys as the preview page `lab/disk/`) |
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
| `engine/disk3d.js` | v2's own GPU engine, begun as a copy of `lab/disk/disk3d.js` (9436767); `engine/CHANGES.md` records what changed and what was taken from or left in the other lines, `engine/SOURCE.txt` the base and the SHA-256s |
| `stills/` | 36 WebP stills: `<place>-<lang>-wide.webp` (2400 × 1200), `<place>-<lang>-tall.webp` (1200 × 1500) |

## Check it

In the page's console (a visible window gives frame times too):

    const c = await import('/ver2/tools/disk-lab-v2/check.js');
    const r = await c.run();          // the page's checks, about two minutes
    console.table(r.rows)

`await c.stalls()` measures, in a visible window, the stalls of the engine's exposure readback near the star,
`await c.pacing({ scale: 0.4, flight: 2 })` the frame rate, the readbacks and the drag latency at a fixed scale, and
`await c.zoomPacing()` the frame intervals while the wheel zooms in and out (DESIGN.md, section 7).
`ver2/tools/disk-lab-v2/frame.html?w=390&h=760&src=/lab_pub/disk_v2/%3Flang%3Dja` shows the page at a phone's size in
a desktop window. With `serve.py --save-dir DIR`, `c.run({ save: 'check.json' })` writes the results there.

The engine's own checks (ver2/tools/disk-check's state matrix, on v2's engine, with the states close to the star):

    const e = await import('/ver2/tools/disk-lab-v2/engine-check.js');
    const m = await e.run();          // 346 states, about 9 minutes; m.problems

## The engine

The engine is v2's own (`engine/CHANGES.md`). To see what the upstream engine (`lab/disk/disk3d.js`) has changed since
v2's base:

    sh ver2/tools/disk-lab-v2/sync-engine.sh          # writes nothing; -p for the full diffs

A change worth taking is applied by hand and recorded in `engine/CHANGES.md`; then `engine/SOURCE.txt` and `ENGINE_SRC`'s
`?v=` in `app.js` take the new SHA-256, the checks run, and the stills are remade if the picture changed.
`ver2/tools/disk-lab-v2/engine-patch.py` is the record of the first round's patch (frames in flight, the exposure's
readback at the start of a frame; DESIGN.md, section 7, "GPU の待ち行列"), which the engine carries.

## Remake the stills

    python3 ver2/tools/disk-lab-v2/serve.py --save-dir /tmp/disk-stills
    open http://127.0.0.1:8642/ver2/tools/disk-lab-v2/stills.html      # a window with devicePixelRatio 2; ~3 minutes
    sh ver2/tools/disk-lab-v2/stills-webp.sh /tmp/disk-stills

## Publishing

Copy `lab_pub/disk_v2/` as it is. It needs `/fonts/` and `/images/favicon.svg` at the site's root. Bump the `?v=` of
`disk-lab.css` and `app.js` in `index.html`, and of the modules `app.js` imports (`places.js`, `words.js`, `quality.js`,
`capture.js`), when they change (the page is served with the site's caching, and a new `app.js` with an old module
cached would fail).
