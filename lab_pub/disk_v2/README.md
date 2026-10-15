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
| `app.js` | the page: places, looks, panel, links, stills, the full-resolution still picture |
| `places.js` | the nine places (view, look, components, control) and the distance fitted to the stage |
| `words.js` | the text that changes with the state, in both languages |
| `quality.js` | whether the live model can run, the start-up calibration and the render-scale governor |
| `capture.js` | saving a picture (works around `drawImage` reading nothing from the engine's canvas in Chrome) |
| `engine/disk3d.js` | a copy of `lab/disk/disk3d.js` with a small patch (`ver2/tools/disk-lab-v2/engine-patch.py`: frames in flight, the exposure's readback at the start of a frame; the rendering is unchanged); `engine/SOURCE.txt` gives the commit and both SHA-256s |
| `stills/` | 36 WebP stills: `<place>-<lang>-wide.webp` (2400 × 1200), `<place>-<lang>-tall.webp` (1200 × 1500) |

## Check it

In the page's console (a visible window gives frame times too):

    const c = await import('/ver2/tools/disk-lab-v2/check.js');
    const r = await c.run();          // 28 checks, about a minute
    console.table(r.rows)

`await c.stalls()` measures, in a visible window, the stalls of the engine's exposure readback near the star, and
`await c.pacing({ scale: 0.4, flight: 2 })` the frame rate, the readbacks and the drag latency at a fixed scale (DESIGN.md,
section 7). `ver2/tools/disk-lab-v2/frame.html?w=390&h=760&src=/lab_pub/disk_v2/%3Flang%3Dja` shows the page at a phone's size in
a desktop window. With `serve.py --save-dir DIR`, `c.run({ save: 'check.json' })` writes the results there.

## Update the engine

    sh ver2/tools/disk-lab-v2/sync-engine.sh        # copies lab/disk/disk3d.js, applies engine-patch.py, writes engine/SOURCE.txt

Then set `ENGINE_SRC`'s `?v=` in `app.js` to the patched copy's first ten characters (the script prints them), run the
checks, and remake the stills if the picture changed. The page uses only the engine's public API and events. If
`engine-patch.py` refuses because the engine changed around it, review the patch; if `lab/disk/` has taken the same fix,
drop it.

The patch (DESIGN.md, section 7, "GPU の待ち行列"): animation frames came faster than the GPU finished them, so Chrome
queued several frames of GPU work; every readback of the automatic exposure (getBufferSubData, within 12 au of the star)
waited behind the whole queue (30-100 ms), and a drag reached the GPU 60-120 ms late. The patched loop fences each frame
it draws and draws only while fewer than `data-flight` (default 2) are unfinished, and the exposure's copy moves to the
start of a frame. At a fixed scale: the same frame rate (whole disk 92 vs 94 frames/s, snow line 58 vs 59), frames over
33 ms at the snow line 19.6 → 0.9 %, longest readback 68 → 17 ms, drag latency about halved (60 → 28 ms for the whole
disk). The same diff can go into `lab/disk/disk3d.js`.

## Remake the stills

    python3 ver2/tools/disk-lab-v2/serve.py --save-dir /tmp/disk-stills
    open http://127.0.0.1:8642/ver2/tools/disk-lab-v2/stills.html      # a window with devicePixelRatio 2; ~3 minutes
    sh ver2/tools/disk-lab-v2/stills-webp.sh /tmp/disk-stills

## Publishing

Copy `lab_pub/disk_v2/` as it is. It needs `/fonts/` and `/images/favicon.svg` at the site's root. Bump the `?v=` of
`disk-lab.css` and `app.js` in `index.html` when they change (the page is served with the site's caching).
