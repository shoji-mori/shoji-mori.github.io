# Disk Lab

The public disk model, at https://shoji-mori.github.io/disk-lab/: a protoplanetary disk drawn on the GPU (WebGL2) in the
browser, with nine places to visit, five looks (model, visible, mid-infrared, millimetre, gas line), and still pictures
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
| `el az d look mode field ann asym marks waves slice sq p tx ty tz speed paused t com cov ms` | a view, as "Copy a link" writes it (the same keys as the archived preview page's links). `sq` is `T`, `rho` or `layers` (the Regions); an old link's `tau` opens the temperature, `none` the density. A `mode` with one of the bits 1 and 2 turns on both (the gas with its dust); bit 64 is the jet (round 8). `marks` the flow arrows (the gas's option since round 8). (Round 15a) `ann`, the annotations: 1 all of them (as before), 0 none, else the sum of those shown: 2 the snow line's name, 4 the planet's label, 8 the scale bar, 16 the cut's lines and colour bar, 32 the gas line's colour bar, 64 the model look's key of the colours (`ann=118`: all but the scale bar); the rail's View has a checkbox for each, the A key hides them all and brings back those shown. Without `paused` the clock starts stopped (round 15a: `data-paused`) |
| `lit=fx` | the starlight's shading in the model look tied to the finish's level as before 2026-11-03 (off at Auto on guarded devices); without it the shading is drawn at every level |
| `bg=off` / `bg=cloud` | the background: none, or the dark molecular cloud of a star-forming region (round 8; the stars, the default, are not written) |
| `pl=3:1:1,8:0:0.1` | the planets: orbital radius (au, 0.05 to 20 since round 7), on (1) or off (0), and mass in Jupiter masses (round 8: 10 Earth masses to 3; without it, 1), up to four |
| `pmd=3e-8` | (round 13e) the planets' accretion rate in Jupiter masses a year, one for all of them (1e-10 to 1e-4); without it each takes a tenth of the disk's accretion rate at its orbit (auto). It sets their own disks' temperature, thickness and millimetre light (below, The planets' own disks) |
| `col=ff8800..a0d0ff` | (round 13a) the model look's colours chosen, as "Copy a link" writes them: six hex digits each, in the order gas, pebbles (rock), pebbles (ice), wind, jet, envelope, and (round 18d) the field lines, separated by dots; an empty field is that colour's default and the empty ones at the end are left out (`col=ff8800` the gas alone, `col=.....c080ff` the envelope alone, `col=......ffaa00` the field lines alone). Without it a link has the default colours; a field that is not six hex digits is the default, fields past the seventh are passed over (a link of six, before round 18d, leaves the field lines' at the default). The field lines are drawn over the picture in the model look; their colour is their lines' core, their glow and the magnetosphere's lines near the star following it |
| `mp=md3e-7_ls10` | (round 14a) the model's parameters chosen, as "Copy a link" writes them (the rail's Model): each one not at its default as a name of two letters and its value with three significant figures at most, joined by `_`: `md` the accretion rate Ṁ (M☉/yr), `ls` the star's luminosity (L☉), `ai` the turbulent α of the thermally ionized inner disk, `ti` the thermal ionization temperature (K), `lt`, `lo` the lever arm λ at R_TI and at the disk's edge, `cc` χ_c, `ga` the gaps' viscosity α. Without it a link has the defaults; a pair not understood is passed over, and the engine holds each value within its range (round 17b: `ts`, the star's colour temperature, and `li`, λ at the dust's inner edge, parameters until round 15b, are passed over as names not known; `?lamin=` is the engine's switch). The development switches below (`mdot`, `lam` with two numbers, `chic`) set the same parameters; `mp=` wins over them |
| `wb=2.5` | (round 14a) the wind's brightness in the model look (0.3 to 10; without it 1), as "Copy a link" writes it |
| `op=0.3,1,1,0.5,1,0.6` | (round 18a) the see-through of the gas, the pebbles, the wind and the envelope: factors on what each takes out of the ray; (round 18d) then the jet's, a factor on its light (it only shines), and the field lines', a factor on their lines' opacity: six factors, 0.05 to 1 (a blank one 1; four, as 1.9-dev.23 to dev.25 wrote them, read with the jet's and the field lines' at 1; a list of another length passed over; without it all 1), as "Copy a link" writes them (the See-through in each component's palette, which its swatch in Show opens: 1 − the factor in %) |
| `roll=30` | (round 18a) the camera's roll about the line of sight, in degrees (−180 to 180, wrapped; the picture counterclockwise; without it 0) |
| `stars=2.5` | (round 18a) the number of the background's stars, times the default's (0.3 to 5; without it 1), with the stars and with the cloud |
| `glow=self` | (round 18i) the model look's light: the gas's own thermal light (Look's "Own emission"): no surface lit by the star, the gas and its dust glowing at their own temperature (the cut's Temperature, the surface heated by the starlight hotter than the interior) through one grey opacity for their emission and absorption, drawn as a volume (DESIGN.md section 50). (Round 18l: by default the temperature is a mock structure, the surface down to a vertical column Σ_s from above, `selfnc=`, at the temperature of the grains the starlight heats directly, the gas below at the interior's; the cut's with `selft=star`; DESIGN.md section 53.) (Round 18k) Brightness and colour are the long-wavelength brightness temperature: the brightness on a logarithmic scale, the colour from slate blue at 10 K through white at 160 K to gold at 1500 K, a bar in the key (DESIGN.md section 52). (Round 18m: the colour is the gas's own, in shades, grey by default, the brightness as before; the column's surface is hot only where the starlight reaches it, the outer tail in the inner disk's shadow at the interior's temperature; DESIGN.md section 54.) Without it, or `glow=star`, the starlight as before; another value is passed over |
| `selfk=0.02` | (round 18i) the opacity of that own light, in cm² per gram of gas (0.001 to 100, three significant figures; without it 2), as "Copy a link" writes it when not 2 (Look's slider "Opacity κ", shown with the own light) |
| `selfnc=0.03` | (round 18l) the surface's column Σ_s of that own light's temperature, in g cm⁻² (0.001 to 10, three significant figures; without it 0.1): T⁵ = T_int⁵ + T_s⁵ e^(−N⊥/Σ_s), N⊥ = Σ/2 erfc(\|z\| / √2 H) the vertical column from above, T_s the temperature of the grains the starlight heats directly, T_int the interior's (the cut's law, with τ* replaced by N⊥/Σ_s; DESIGN.md section 53); as "Copy a link" writes it when not 0.1 (Look's slider "Surface column Σ_s", shown with the own light at that temperature) |
| `selft=star` | (round 18l) the own light's temperature, for comparisons: `col`, round 18n's (the column's surface alone, a surface only where it rises outward; where it descends, the outer tail and the inner slopes of planets' gaps, the interior's temperature through the whole column), `star`, round 18k's (the cut's Temperature: the surface down to an optical depth of about 1 toward the star, with the crest's shadow), `int`, round 18j's (the interior's alone); without it, or `selft=colstar`, the default (round 19a; round 18m's): hot where the starlight reaches and the column from above is under Σ_s, both. Not kept on the device (no control shows it); Reset all puts it back to `colstar`; "Copy a link" writes it when not `colstar`; another value is passed over. Round 18k's `?selfint=1` is read as `selft=int` where no `selft=` is given |
| `mpconst=1` | for checks (round 14a): the shaders built with the model's parameters at their defaults as constants, as until round 14 (`data-mpconst="1"`), to compare the default picture with that drawn through the parameters' uniforms (DESIGN.md section 34); the parameters then reach the script only |
| `acclayer=1` | for development (round 13a): the accretion layer drawn in the model look as until round 13 (`data-acclayer="on"` on the disk; by default it is not drawn), to compare. It was `acc=1` (`data-acc="on"`) until round 17b, when round 16c's `acc=` (below) had taken the name: the key said the layer was drawn, and the engine drew it not |
| `gasrho=old` | for development (round 13a): the gas's glow in the model look raised beyond 6 au by R / 6 au, as until round 13 (`data-gasrho="old"`; by default it is in proportion to the density), to compare |
| `mflux=0` | for development (round 13c): the mass prescriptions of before, all of them (`data-mflux="0"`): the wind's density of round 8 (its base pinned at the disk's density at τ* = 1 and held up to χ = 0.03, its loading ∝ 1/(λ − 1)), its lever arm falling outward, and the gas line's inflow moving the accretion layers' whole gas at their speed. By default one budget sets the wind and the inflow so that mass and angular momentum are conserved (DESIGN.md section 33) |
| `lam=old` / `lam=1.5,2.5` | for development (round 13c; round 14a: the two numbers are an alias of the parameters `lt` and `lo` of `mp=`, `old` a switch still): the lever arm λ of the mass budget: round 8's, falling outward, or λ at the edge of the thermally ionized inner disk (R_TI, 0.7 au with the default accretion rate) and at the disk's edge (30 au), rising in ln R between (`data-lam`; by default 1.2,5, the owner's: the inner wind strong, the outer weak; the field lines take the cold wind solutions within 1.8 to 4, the budget λ itself). 1.9-dev.7 is `lam=1.5,2.5&lamin=1.5` |
| `lamin=1.2` | for development (round 13c; round 14a: an alias of the parameter `li` of `mp=`): λ at the dust's inner edge (0.08 au), falling in ln R to the λ at R_TI (`data-lamin`; by default 4: the thermally ionized inner rim, ideal MHD, a large lever arm, so that a large part of the accretion rate at R_TI reaches the star; `lamin=1.2` is the single rise from R_TI) |
| `mdot=1.5e-8` | for development (round 13c; round 14a: an alias of the parameter `md` of `mp=`): the accretion rate, in solar masses a year (`data-mdot`; by default 1e-7, the owner's for the wind's brightness): the temperature's (the turbulent inner disk's heating, its edge R_TI where it reaches 1000 K, the accretion layer's) and the mass budget's together, so the wind's density, R_TI and the snow line follow it; `mdot=1.5e-8` gives the values until round 13c (R_TI 0.3 au, the snow line 0.98 au) |
| `chic=0.003` | for development (round 13c; round 14a: an alias of the parameter `cc` of `mp=`): how far above its base (in units of its base radius) the wind's density is held before it follows the solution (`data-chic`; by default 0.015, so that the base is no denser than the disk at the irradiation surface; 0.003 in 1.9-dev.7 and dev.8, 0.03 until round 13c) |
| `g=1,1,1,1` | (until round 6: the display amounts; read past now, the model's own amounts are shown) |
| `still=1` | show the still pictures (as without WebGL2) |
| `gl=force` | skip the check for software rendering and slow devices |
| `motion=reduce` | behave as with the system's reduced-motion setting |
| `retry=1` | written by "Try again" (round 9): start with safe settings (the model look, no cut, Auto, the whole disk), as after a visit that ended with drawing stopped |
| `guard=70` | for checks (round 9): guard as on a phone, with that budget in ms a piece of GPU work |
| `gpux=5` | for checks (round 9): count every frame's GPU time 5 times, as on a GPU 5 times slower (the floor of a frame, its slowest ray, is counted 5 times too, so this is pessimistic) |
| `present=1` | open the presenter (round 11a, below): full screen at the first key or click where the browser asks for one |
| `tilt=0` | for development (round 12b): no looking in by tilting (`data-tilt="off"` on the disk: the engine draws no offset), and no switch for it |
| `bgmove=1` | for comparison only (round 13b): the sky behind (stars, cloud) fixed in the disk's frame as before, so that it sweeps across the picture with the slow spin and with a planet followed (`data-bgmove="on"` on the disk); without it the sky holds still and turns only as the view is turned |
| `cpdh=drawn` | for comparison (round 13e): the planets' thermal mass with the disk's drawn scale height H0 a^1/4 (`data-cpdh="drawn"`); by default the gas's own, about 1.8 times thinner, so that a planet is some 6 times more thermal masses (a Jupiter at 3 au 25.6 rather than 4.6) |
| `cpd=old` | for comparison (round 13e): the planets' own disks as in round 8, 0.4 Hill radii with fixed colours (`data-cpd="old"`) |
| `#seq=…` | (the fragment, never sent to the server) a sequence of scenes, as "Copy a link" under Moves and talks writes it (round 11a) |

A link's view and settings win over those kept on the device (below); the CO look's key stays `look=co` (shown as the gas
line since round 9).

## Files

| file | what |
| --- | --- |
| `index.html` | markup and the fixed text in both languages (`.en` / `.ja` spans) |
| `disk-lab.css` | all styles |
| `app.js` | the page: the sandbox (rail), the highlights (places), links, stills, the full-resolution still picture |
| `places.js` | the nine places (view, look, components, control) and the distance fitted to the stage |
| `words.js` | the text that changes with the state, in both languages |
| `quality.js` | whether the live model can run, the start-up calibration and the render-scale governor |
| `capture.js` | saving a picture (works around `drawImage` reading nothing from the engine's canvas in Chrome); round 11c: a picture cut to 16:9 or 4:3 about its centre, the scale bar moved into the crop's corner |
| `seq.js` | the scenes for talks (round 11a): a scene from the engine's state, every value checked, a sequence as a JSON file or in a `#seq=` link |
| `qr.js` | QR codes for the audience (round 11c), with nothing but itself: byte mode, error correction M, versions 1–40, the standard's masks by the penalty rules (ISO/IEC 18004), drawn as SVG |
| `mp4.js` | the video's file (round 11b): a minimal MP4 writer of its own (one H.264 track as WebCodecs gives it; ftyp, mdat, moov), no dependency |
| `engine/disk3d.js` | Disk Lab's own GPU engine, begun as a copy of the preview page's `disk3d.js` (9436767, now archived); `engine/CHANGES.md` records what changed and what was taken from or left in the other lines, `engine/SOURCE.txt` the base and the SHA-256s |
| `changelog.html` | the public record of the updates, made from `CHANGELOG.md` by `ver2/tools/disk-lab-v2/changelog-html.py` (run it after changing the changelog); linked from "About this model" |
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

Before any check that draws heavy looks, follow "GPU checks without losing the browser" at the top of `check.js` (round 9: a
fresh origin such as `http://r9b.localhost:8642/`, a tripwire, and the slowest rays first in
`ver2/tools/disk-lab-v2/ray-check.html?view=whole|edge|star`).

The flights along a smooth path (round 11a) are checked without a browser too, the engine's own path math read from it and run
in Node (no dependency):

    node ver2/tools/disk-lab-v2/path-check.mjs

So is looking in by tilting (round 12b): the engine's rule (TILT-RULE) and the page's sensor math (TILT-MATH in app.js), read
from the files and run with a phone simulated at 60 events a second:

    node ver2/tools/disk-lab-v2/tilt-check.mjs
So are round 13b's two rules, the engine's own lines read from it: the dropped pebbles a new planet takes in (the gap's band, the
seeds, the band's radii for a few planets) and the sky that holds still while the clock turns the view (the slow spin, a planet
followed, a drag, a flight that changes the frame, the direction to the bit with no turn; round 18a: the stars' number, the count
scaling with it over 200000 cells of the shader's hash, the brightness's law kept):

    node ver2/tools/disk-lab-v2/orbit-check.mjs
    node ver2/tools/disk-lab-v2/sky-check.mjs
So are the QR codes (round 11c: the standard's published values, a symbol drawn by hand, a reader written there, and OpenCV's and
macOS Core Image's readers on PNGs where they are on the machine) and the pictures for slides (the crop, and the scale bar moved):

    node ver2/tools/disk-lab-v2/qr-check.mjs
    node ver2/tools/disk-lab-v2/crop-check.mjs
The video's file (round 11b): files built from synthetic samples and read back, broken ones read with their problem named, and
(where ffmpeg and ffprobe are installed) a real H.264 stream written again and decoded frame for frame the same; and the talks' and
the video's logic, app.js run on a fake DOM, encoder and engine (the calls frame by frame, the page put back after a cancel):

    node ver2/tools/disk-lab-v2/mp4-check.mjs
    node ver2/tools/disk-lab-v2/talk-logic.mjs          # and with --no-encoder

The model look's round 13a (DESIGN.md, section 31): the colours' link (COL-LINK in app.js, read from the file), the colours' way
through the page (app.js on a fake DOM and engine: a link's `col=`, the colours kept under `KEY()`, the rail's inputs and chips,
Reset all), and the gas's brightness against its density from the engine's JS mirror, with the shader's law checked against its
text (a table at a few radii):

    node ver2/tools/disk-lab-v2/look-check.mjs

The model's parameters (round 14a, DESIGN.md section 34): the engine itself run on a fake DOM and a fake WebGL2 that keeps what it
sends (the shaders' text, the uniforms by name and program, the textures' uploads, the draws): every program given the parameters'
uniform, a change of every parameter (R_TI as its law scales, the temperature's table sent again from the same laws as the mirrors,
the wind map's budget sent again and the map drawn again), the caches that key on the parameters (each test failing on an engine
with that piece taken out), a lost context keeping them, the aliases at the first build, `?mpconst=1`; and the page's side: the
`mp=` link (MP-LINK in app.js, read from the file), the page on a fake DOM (a link's `mp=` and `wb=` before the first picture, kept
under `KEY()`, a link without them, the aliases, the rail's Model section, Reset all), the texts that quote the model's numbers.
(Round 18i: params-check.mjs's case 12, the model look's own light: its code in every volume program, `uSelf` and `uLit` in the
frames, `glow` and `selfk` in the state; look-check.mjs's row "光り方" under the looks; link-check.mjs's `glow=` and `selfk=`.
Round 18l: case 12's `selft`, `selfnc` and `uSelfT`, and the compiled `selfX` transcribed against erfc in double precision;
look-check.mjs's surface column's row and the notes by the temperature; link-check.mjs's `selft=`, `selfnc=` and `selfint=1`.
Round 18n: case 12's `selfW` transcribed against the column's surface found by bisection, `selft=colstar`.)
probe-check.mjs and massflux-check.mjs also run at other values of the parameters:

    node ver2/tools/disk-lab-v2/params-check.mjs
    node ver2/tools/disk-lab-v2/mp-check.mjs

The words, the links and the release (round 17b, DESIGN.md section 41): the two languages of `words.js` with the same keys, of the
same kinds, the same numbers quoted, and the words and ids `app.js` names there (the keys and ids no code names are listed, to
decide on); malformed links and settings kept from 1.8, broken or of another version, through the page's start on a fake DOM
(params-check.mjs's case 8 has the engine's side: the switches passed on as the address has them); and whether `disk-lab/` is ready
to publish (the public build, the version line, the engine's SHA-256, the caches against `origin/main`, the record; with
`--release`, the version's date and row too):

    node ver2/tools/disk-lab-v2/words-check.mjs
    node ver2/tools/disk-lab-v2/link-check.mjs
    node ver2/tools/disk-lab-v2/release-check.mjs     # and with --release before a version is published

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

## The controls (round 18e)

A drag turns the view (its elevation and azimuth), with any mouse button and any key held, and so does one finger on a touch
screen; the wheel (with the picture focused, or with Ctrl/⌘), + and − and a pinch zoom; two fingers twisted turn the azimuth
and, moved up or down together, tilt; a double tap zooms in toward the point tapped, a tap with two fingers zooms out. The
point looked at (the state's `tx ty tz`) is moved from the rail's View: its four arrows step it along the picture as drawn by
a tenth of the picture's height at its distance (a step at a press; held, a step every 120 ms after 400 ms; Enter or Space one
step), as Shift+arrows do on the focused picture (`box.diskNudge(dx, dy)`: dx to the right and dy up, in tenths; the point
goes the arrow's way), and "Back to the star" (or C, `box.diskCenter()`) brings it back, to the planet while one is followed;
the chip shows only while the point is off it. The roll about the line of sight is the View's slider (`roll=`). Until round
18e Shift+drag, the middle and right buttons and one finger moved the point looked at, Alt+drag rolled, and Shift+arrows moved
the picture the arrow's way (the owner, 2026-11-07: "the mouse's drag is hard to follow"; DESIGN.md section 46).

## Remake the stills

    python3 ver2/tools/disk-lab-v2/serve.py --save-dir /tmp/disk-stills
    open http://127.0.0.1:8642/ver2/tools/disk-lab-v2/stills.html      # a window with devicePixelRatio 2; ~3 minutes
    sh ver2/tools/disk-lab-v2/stills-webp.sh /tmp/disk-stills

Some of them: `stills.html?only=whole,mm`, and (round 17b) `&frame=wide` or `tall`, `&lang=en` or `ja`, so that
`stills.html?only=whole&frame=wide&lang=en` makes one. They are drawn as the page starts (round 17b: index.html's mode 95, the
envelope off, a Jupiter at 10 au, and a Jupiter at 3 au first at the planet's place and the millimetre's, as app.js's
`placeStateNow`; until then mode 111 and one planet at 3 au), with the colours and the parameters at their defaults. `og.jpg` is
cut from `whole-en-wide` (1714 x 900, the disk large, no scale bar) to 1200 x 630, JPEG quality 86 (DESIGN.md section 12); on a
Mac, about the centre (look at it: the view of round 15a sits otherwise than the one it was cut from):

    sips -c 900 1714 /tmp/disk-stills/whole-en-wide.png --out /tmp/og-crop.png
    sips -z 630 1200 -s format jpeg -s formatOptions 86 /tmp/og-crop.png --out disk-lab/og.jpg

## Publishing

`disk-lab/` is published as it is, at `/disk-lab/` (indexed: robots, canonical and Open Graph tags in `index.html`;
`og.jpg`, 1200 x 630, is the whole disk's still). It needs `/fonts/` and `/images/favicon.svg` at the site's root, and
uses relative paths otherwise. Bump the `?v=` of
`disk-lab.css` and `app.js` in `index.html`, and of the modules `app.js` imports (`places.js`, `words.js`, `quality.js`,
`capture.js`, `seq.js`, `qr.js`, `mp4.js`), when they change (the page is served with the site's caching, and a new `app.js` with an
old module cached would fail); `release-check.mjs` (below) finds one that changed and kept its tag.

## Releasing a version (round 17b)

The public page is `disk-lab/` on `main`, taken from `dev`'s by the hand-over note's pattern (`ver2/docs/disk-lab-handoff.md`,
section 2; `disk-lab/dev/`, the development build, goes with it as it is). On `dev`, before that:

1. `VERSION` and `RELEASED` at the top of `app.js`: the version without `-dev` (`'1.9'`) and the day it is published.
2. `CHANGELOG.md`: the version's row in the first table dated that day (for 1.9, the draft's `(公開日)`, its text read again), then
   `python3 ver2/tools/disk-lab-v2/changelog-html.py`.
3. If the engine changed: `engine/SOURCE.txt` (its SHA-256, the date) and `ENGINE_SRC`'s `?v=` in `app.js`, the first ten characters
   of `shasum -a 256 disk-lab/engine/disk3d.js`, and its row in `engine/CHANGES.md`. The `?v=` of each module that changed
   (Publishing, above).
4. `python3 ver2/tools/disk-lab-v2/version-sync.py`: the version line in `index.html`.
5. The stills and `og.jpg`, where the picture of a place changed (Remake the stills).
6. The Node checks, then `node ver2/tools/disk-lab-v2/release-check.mjs --release`, and the browser's checks of a release (check.js,
   about 50 items; the hand-over note, section 3).
7. Publish, and check the published `VERSION` and the engine's `?v=` (the hand-over note, step 6).

The rail's Model section is on the public page too: `MODEL_UI` at the top of `app.js` is true (the owner, round 17b: the model's
parameters adjustable in public); it is the one switch that would hide it, links and the settings kept applying the parameters
either way.

## Citation and quality

The suggested citation is built from `CITE_URL` (the public address) and `CITE_YEAR` at the top of `app.js`: change the
URL there if the page ever moves. The quality levels (render scale of a fixed level) are `QUALITY` beside them. Best is
the default on a desktop browser with GPU timer queries (round 6; round 9: Auto on a phone or tablet, or without timers,
as in Safari, `guarded`): not chosen by the visitor, it steps down quietly where a view is too heavy (`BEST_SLOW`, `BEST_AIM`,
`BEST_UP`, `BEST_STEPS` in `app.js`; DESIGN.md, section 16). Since round 7 that step is for the running clock only (a
paused picture is drawn at 100 %), and it comes back up one level at a time after a hold (`BEST_HOLD`, doubled up to
`BEST_HOLD_MAX` when a step up is taken back within `BEST_UNDO`; frames at the display's pace, under `BEST_PACED`, try the
next level); `diskLab.quality()` and `diskLab.bestLog(true)` show it (DESIGN.md, section 17). A choice is kept with the
settings (below). While the
view moves, the volume is drawn at a lower scale and the scale comes back 0.2 s after it stops (`MOVE_K`, `MOVE_FIXED`,
`MOVE_REST` in `app.js`; DESIGN.md, section 13); `data-move="off"` on `#disk` turns this off, to compare
(`check.js`'s `zoomPacing` and `dragPacing`).

## The guard against long frames (round 9)

A piece of GPU work of a few seconds makes the system stop the GPU: the WebGL context is lost, and WebKit then gives the
page, or the whole browser, no WebGL until it is quit (the owner's iPhone, switching to the visible look at Best). Every
frame is measured (the engine's fences: `diskgpu` events with its GPU time, bands, scale and kind), and before something
dearer is drawn (a look, the line's map, the cut) its cost is predicted from the factor of the change (the engine's
`GFAC`, `box.diskGuard()`), so that the scale is lowered first: running frames stay under `GUARD_MS` (70 ms where guarded,
120 ms elsewhere), climbing one `LADDER` step at a time where guarded; a still picture may be finer (`STILL_MS` a frame),
drawn in bands of about `GUARD_MS`, one per animation frame (`box.diskBands(n, ms)`). The engine has a guard of its own as
the last word, with the same budget (`box.diskGuard({ ms })`; it lowers the scale, to 0.12 at least, and tells the page
with `diskguard`), so that no route (a link, a script's `diskSet`, a key) comes around it. A look still over the budget at
the lowest step is shown as a still on a guarded device. `diskLab.guard()` gives the state and its log. While only the
clock moves, frames are drawn at most `FPS_STILL` a second (`FPS_STILL_PHONE` on a phone; the engine's `box.diskFps(n)`;
the wait goes with each frame as `held` in `diskframe`), and a phone or tablet rests the clock after `IDLE_MS_PHONE`.
DESIGN.md, section 22.

## Talks (round 11a)

"Moves and talks", a section of the rail closed until opened: six moves played with one click from the view as it is (an orbit,
edge-on to face-on, from afar to the star, along the disk to the planet, the clock sped up, each look in turn) at a pace chosen;
scenes of one's own ("Add this view": the view, the look, the cut, what is shown, the clock), renamed, reordered, removed,
played one after another, kept on the device (localStorage `disk-lab-seq`), saved as a JSON file and opened again, or shared as a
`#seq=` link (deflate-raw and base64url in the fragment; `seq.js` checks every value of a file or a link); and "Present": the
picture alone, full screen, the scenes (with none of one's own, the nine places) stepped through with a presentation clicker's
keys (→ ↓ Page Down Enter the next, ← ↑ Page Up Backspace the one before, Home and End, Space the clock, B or . a black screen, F
full screen, Esc out). For laptops and desktops: a phone keeps the moves and Play. Every move flies along the engine's smooth
path, `box.diskPath(view, { speed, dur, rho, turns })` (van Wijk and Nuij's zoom and pan, in the frame of the destination, even in
its measure, on smooth ramps; 'diskpath' events tell its start, arrival or stop), a flight to the guard: drawn at the moving scale
within the budget, the still on arrival refined to the level as after any flight. The engine's clock for the picture is one,
`nowMs` (the flights, the fades, the look's dip), the page's own with `box.diskManual(true)` and `box.diskAdvance(dt)` for an
exporter. `diskLab.talk` gives the scenes, a link, the moves and the presenter to scripts. DESIGN.md, section 25.

## Tilt to look in (round 12b)

A switch in the rail's View, off by default, on phones and tablets only (a desktop has no motion sensor: no switch): tilting the
device turns the view a little, as a model held in the hand (the top edge toward you shows the disk more from above, the right
edge up its right side; at most 6 degrees, a dead zone of 2 degrees at rest, the gravity from `deviceorientation` low-passed over
0.3 s). On iOS, turning it on asks for the sensor (`DeviceOrientationEvent.requestPermission()`), and the switch stays off if
refused. The offset is a view of the same state: `box.diskTilt({ el, az })` draws it on the camera's pose only, never in the
state, the links, the settings kept or the scenes; a step is drawn only when it moves the picture by a pixel's worth, and counts
as a moving view (the lighter picture) only above 10 pixels a second, so that a phone held still keeps refining its still. It
rests during flights, paths, drags, the moves, Play and the presenter, and with reduced motion. Kept on the device in
localStorage `disk-lab-tilt`; Reset all turns it off. `node ver2/tools/disk-lab-v2/tilt-check.mjs` checks its numbers in Node.
DESIGN.md, section 30.
## Video (round 11b)

Under "Moves and talks", on a laptop or desktop: the scenes in order (with none of one's own, the nine places), a hold at each and
the flights between them, or one of the moves, made into an MP4 file (H.264 through WebCodecs' VideoEncoder, written by `mp4.js`) for
slides: 1280 x 720, 1920 x 1080 or 3840 x 2160, 30 or 60 frames a second, each frame drawn at the page's quality level (its scale,
and 1, 2, 4 or 8 pictures averaged from Low to Best), not in real time, on black, with the mark and the credit (Disk Lab (Mori
2026) · shoji-mori.github.io/disk-lab) in the lower right. The page takes the engine's clock (`box.diskManual(true)`), and for each
frame moves it on by 1 / fps (`box.diskAdvance`), sets what the frame begins with in the presenter's order, and draws it at the
video's size (`box.diskOut({ w, h, px })`, the box left as it is) through the snapshot, in bands and kicks within the guard. Each
flight's time is planned first (`box.diskPathPlan(from, to, o)`) and flown in it, so that the frames are counted before the first
(the estimate; at most 7200 frames and 1.5 GB). Cancel, the end or a failure put the page back as it was. `diskLab.talk.exportVideo`,
`exportPlan`, `exportCancel` and `exportState` give it to scripts. DESIGN.md, section 26.

## Kept on the device, and the visit's record (round 9)

The visitor's settings and view (the look and its map, what is shown and its options, the background, the cut, the speed,
the planets, a quality chosen, the place, the angle and distance, the point looked at; round 13a: the model look's colours, as
`col`, written as in a link; round 14a: the model's parameters, as `mp`, and the wind's brightness, as `wb`, written as in a link) are kept in localStorage `disk-lab-settings` a moment after each change and on leaving, and taken
back at the next start without a link (a link without `col=` has the default colours, one without `mp=` and `wb=` the default parameters and brightness). "Reset all" at the top of the rail
forgets them (`diskLab.resetAll()`). `disk-lab-session` records how the visit went
(`starting`, `live`, `changing`, `lost`, `stuck`, `failed`, `blocked`, `still`, `left`): after one that ended `starting`,
`changing`, `lost`, `stuck`, `failed` or `blocked`, the next visit starts with safe settings and throws the kept ones
away. check.js starts from Reset and leaves both as after a visit that went well.

## Saving a larger picture

"Save an image" offers the screen's size, twice that, or 3840 px wide (4K) (`SAVE_SIZES`, at most `SAVE_MPX` million
pixels and the GPU's limits, `box.diskSnapMax()`). The engine's `diskSnapshot({ size, bands, bandMs, frames, onFrame })`
draws the canvas `size` times larger for the picture, each frame's volume in `bands`, each band in a task of its own and
waited for (round 9; before, all sent in one task; more bands where one runs over twice `bandMs`), frame by frame; the page
plans it from the guard's cost of a frame, or the one measured just before if dearer (`box.diskCost()`; `SAVE_MS` a frame,
`SAVE_MS_SCREEN` at the screen's size, in bands of the guard's budget) and keeps the gas line's look and any view slower
than `SAVE_HEAVY` ms a frame at the screen's size (a CO moment map at 4K lost the WebGL context). `box.diskSnapLog()`
gives the last one's bands and times.

For slides (round 11c): the picture's shape, the screen's, 16:9 or 4:3 (`SAVE_RATIOS`), cut from the middle of the view and never
stretched (`capture.js`'s `cropFor` and `framed`; the scale bar, drawn 18 px from the stage's lower left corner, is moved into the
crop's while the engine serializes its overlay). The size chosen is the cut picture's (4K at 16:9 is 3840 × 2160); what the GPU
draws, its bands within the guard and `SAVE_MPX` are still the whole canvas's. The background is black (no transparent or white
background: the supervisor's choice). "Credit in the corner", on by default, burns `Disk Lab (Mori 2026) · shoji-mori.github.io/disk-lab`
(from `CITE_YEAR` and `CITE_URL`) into the lower right, beside the mark, small and faint; the citation stays below, to copy.

## A QR code for the audience (round 11c)

"QR code", beside "Copy a link", shows the code of the view's link over the stage; in the presenter, Q shows it large: of the
scene's link, or with scenes of one's own, of the page with the scenes (`#seq=`). Q again or Esc closes it (in full screen the
browser takes Esc for itself, and the presenter ends with full screen, as in round 11a: Q closes the code alone). The code opens the
public page (`CITE_URL`) unless the page is served from the public site itself, and the page's address is written under it in
large letters. A link longer than a version-18 code holds (560 bytes at level M, `QR_VERSION`) gives the page's link with
`place=` (and `lang=`) only, and the note says so. The overlay keeps the link it shows in `data-href` and the code's version in
`data-version` (`#qrOver`).

## The temperature

`THERMO` at the top of `engine/disk3d.js` holds the temperature's parameters (the star's luminosity, its colour
temperature, the accretion rate, the Rosseland opacity, the turbulent alpha, the heating layer's optical depth, the
thermal ionization and dust sublimation temperatures); `tempAt` in the shaders and `tempJS` in the script use them, and the
thermally ionized edge `NONIDEAL.R_TI` and the snow line follow. `box.diskTemp(R, z)` returns the temperature at R and z
(au), the midplane's, ln tau*, the snow line and R_TI (DESIGN.md, section 17, has the equations and the sources).

## The model's parameters (round 14a)

The rail's Model section, closed until opened (shown while `MODEL_UI` at the top of `app.js` is true: the one switch for the
public page; links and the settings kept apply the parameters either way): the star's luminosity, the
accretion rate (for the heating and the wind's mass budget alike), the turbulent α of the thermally ionized inner disk (the dead
zone's and the outer disk's keep their ratios to it), the thermal ionization temperature, the lever arm λ at R_TI and at the disk's
edge (round 15b: the colour temperature and λ at the dust's inner edge are no longer parameters; λ there is 4, `?lamin=` a
development switch), χ_c, and the gaps' viscosity α; a slider each (on a log scale where the range spans decades), the value with its unit, a chip back to
the default, and under each group the numbers that follow (the edge of the thermally ionized disk R_TI, the snow line and the
outburst's, the midplane at 1 au, what reaches the star and its share of Ṁ, the share of the inflow at 30 au the wind takes). The
engine's `box.diskParams({ ... })` takes them in one call (a key left out at its default, each held within its range) and returns
`{ now, def, spec, derived }`; the engine keeps them at its module's level (a lost context keeps them), sets THERMO's laws, R_TI,
the budget and the mirrors at once, and the shaders' uniform `uMP`, the temperature's table and the wind map at the next frame.
`box.diskWindGain(k)` is the wind's brightness in the model look (under the wind in Show). DESIGN.md, section 34.

## The probe (round 12a)

The rail's "Tap to probe" (the engine's `data-pick="probe"`, off by default; no URL parameter) makes a tap on the disk
probe the midplane point under it: a panel beside the point gives the model's numbers there and one sentence on the
physics of its region; a second tap moves it, Esc or the button again removes it. `box.diskProbe(R, z)` (au) returns
them for any point, from the engine's JS mirrors of the shaders' formulas (`probeJS`, `regionJS`, `coAlphaJS` beside
`tempJS`): `T`, `Tmid` (K), `x` (ln tau*), `zS` (the irradiation surface, au), `H` (the scale height as drawn) and `Hgas`
(the one the midplane's temperature holds up, au), `cs`, `vK` (km/s), `P` (yr), `sigmaRel`, `rhoRel` (relative to the
model's at 1 au: the cut's density face, smooth), `sigma` (g/cm², taking 1700 at 1 au), `rho` (g/cm³), `n` (cm⁻³),
`region` (`inner`, `dead`, `acc`, `base`, `wind`, `outer`, `hall`, `cavity`, `jet`, `envelope`) and `rule` (what decides
it), `alpha` (the turbulence's alpha_t), `zk` (the dead zone's top, au), `snow` ({ R, inside }), `vapour`, and `planets`
(each shown planet's gap factor at R and pressure maximum). With a third argument, the point's azimuth (radians, as
the page's tap gives it: `box.diskProbe(R, z, phi)`, round 13e), also `cpd`: inside a shown planet's own disk, its
numbers at the point (see The planets' own disks), else null. (Round 15a) Also `mag` (the magnetosphere's r_T, the star's
radius, the curtains' width and the star's period), each planet's gap after Kanagawa et al. 2016 (`depth`, `width` at half
depth in au, `K`, `alpha`), `wind` where the point is in the wind (`windProbe`: the foot of its field line found as the wind
map's footRadius finds it, the line's lambda and the budget's, the density in g/cm³ and the speeds along the line, of rotation
and at infinity in km/s), `jetV` (km/s) and `env` (the envelope's outer radius, its cavity's half angle, r_c). The probe's tap
reaches the star, gives a planet's point the planet (its gap and own disk), and a ray that misses the disk (meeting the
midplane beyond 31 au or not at all) its point nearest the star (`diskpick` with `miss`, `z`): the wind, the jet or the
envelope there; the jet's and the envelope's densities have no physical scale in the model and are not given.
`node ver2/tools/disk-lab-v2/probe-check.mjs` compares the mirrors with the GLSL, `node ver2/tools/disk-lab-v2/probe-panel-check.mjs`
checks windProbe against points on lines of known feet and prints the panel's text at nine radii and in the new places (round
15a) in both languages with a stub DOM; check.js's item 'probe: the probe against the cut face (T, rho)' compares the probe with the
colours of the cut's faces in the browser (`box.diskFacePoint`, `box.diskFaceColour`; DESIGN.md, section 29).

## The planets' own disks (round 13e)

Each planet's circumplanetary disk follows from its physics (the engine's `cpdPhys`; the study
`ver2/docs/cpd-detail-study.md` and DESIGN.md section 35): its kind and size from the planet's mass in thermal masses
(q / h³ with the gas's own scale height): a disk out to 0.4 Hill radii for a heavy planet close in, a round envelope for a
light or distant one, blended between 1 and 8 thermal masses; its temperature from the planet's accretion (by default a
tenth of the disk's accretion rate at the orbit; the planets' panel, `pmd=`), its accretion luminosity and the disk around
it; its thickness from that temperature; its millimetre optical depth from a steady accreting disk with a tenth of the
disk's dust (thick at the default rate). In the observed looks it shines by each look's own law (one display factor);
the model look keeps its material colours. `box.diskCpdState(i)` returns planet i's (`qth`, `D`, `rOut`, `mdot`, `T`,
`Hr`, `tauMm`, ...); `?cpdh=drawn` and `?cpd=old` compare. `node ver2/tools/disk-lab-v2/cpd-check.mjs` prints the tables
for 10 Earth masses to 3 Jupiters at 1 to 20 au and checks them against the study's numbers.

## The engine's switches of round 15b

Development switches, each read by the engine from `box.dataset` when it is built (the page passes `?name=value` on as
`data-name`); without them the defaults of round 15b. DESIGN.md, section 37.

| Switch | Default | What it does |
|---|---|---|
| `?pebh=0` | 0.1 | the pebble layer's thickness in scale heights in the model and millimetre looks; 0, the plane of before |
| `?excl=0` | on, 1e-7 | the envelope and the wind exclusive by their pressures; 0, the overlap of before; a number, the envelope's infall rate (M☉/yr) |
| `?coenv=0` | on | the envelope's gas in the gas line; 0, as before |
| `?wext=1` | 136 × 102 au | the wind's drawn region (the marched cylinder, the wind map to 240 au); 1, 68 × 51 au and 120 au as before |
| `?ggas=0.2` | 0.5 | the gas body's glow in the model look (0.2 before) |
| `?jetocc=0` | on | the jet hidden behind the disk (round 18b: by the disk's column between the camera and each lobe, along the ray); 0, none |
| `?lscale=0` | on | the observed looks' starlight and the star with L*; 0, as before |
| `?cpdflare=1.6` | 1 | a display factor on the flaring of the planets' disks (1, the physics) |

## The gas's surface density (rounds 18a and 18b)

The gas disk tapers beyond R_c as Σ ∝ R⁻¹ exp(−(R/R_c)^p), R_c = 30 au, p = 3 (round 19a, after the owner's "a model with a
stronger truncation may look better": the thin gas of the Gaussian tail over the crest's shadow showed edge-on as an X in the
own light; round 18b's Gaussian, p = 2, with `?sigp=2`; round 18a's exponential exp(−(R − 1 au)/R_c) gave way to that), in
place of the cut exp(−(R/30 au)⁶) of before; DESIGN.md, sections 42.1, 43.1 and 56.
Beyond the crest of the irradiated surface (19.4 au; 18.7 au with the Gaussian) the tail lies in its shadow and takes the starlight passing over it
(section 43.2); the cut of before keeps its own picture. Development switches, read by the engine when it is
built (the page passes them on as `data-sigtail` and `data-rc`):

| Switch | Default | What it does |
|---|---|---|
| `?sigtail=0` | on | the cut of before (the shaders with `SIG_CUT`: the same code as before but for where it sits) |
| `?rc=45` | 30 | R_c, au (5 to 200), for the tail (and the crest of its lit surface with it) |
| `?sigp=2` | 3 | the taper's exponent p (1 to 8): 2 the Gaussian tail of rounds 18b to 18n |
| `?aeup=0` | on | (round 19a) the automatic exposure as before: lowered close to the star only, never above 1 (by default it also rises, up to 8 times, where the picture's brightest part is dim: edge-on, from afar; DESIGN.md section 56.3) |
| `?fieldlod=0` | on | (round 19a) the field lines as before: all of them from any distance, and across the star's image (by default a line whose foot lies within a few pixels of the star is not drawn, and none crosses the star's image; section 56.4) |

## The starlight on the model look's surface (rounds 18c and 18f)

In the model look the lit surface's brightness follows, beyond 6 au, the starlight it absorbs per unit area, β/R², to the
power 0.6 (a display's compression), matched at 6 au; inside 6 au it is round 8's, eased to R^−1/2, as before. A planet's
gap redistributes only the starlight below the crest's angle, not the starlight passing over the crest, in every look and
for the pebbles' glow (DESIGN.md, section 44). The observed looks keep their own fall with the distance.

Since round 18f (DESIGN.md, section 47) the starlight's depth is the one the gas gathers along the ray from the star (a table
made when the engine is built, `starTableData`), and the light of the lit surface is laid where the gas absorbs it, with the
same total per unit area as above: on the surface the gas itself casts, curved, and beyond the crest on the gas above its
shadow as that gas thins. In the model look the lit surface and its diffuse light, the star's light scattered by the small
grains, are dimmed on their way to the camera by the gas at the visible look's opacity, and the gas's glow is lowered deep
in the disk's shadow, where even the diffuse light does not reach: seen edge-on the upper and lower lit surfaces stand apart
over a dark band. The temperature keeps its depth of before. Development switches, read by the engine when it is built (the
page passes them on as `data-litflat` and `data-skinlos`):

| Switch | Default | What it does |
|---|---|---|
| `?litflat=1` | off | the surface's light per unit area as in 1.9-dev.25: in the model look eased to R^−1/2 at every radius, and in every look the gap's factor on all of the starlight (round 18f: laid by the table as now; also with `?sigtail=0`, which keeps the picture of before) |
| `?skinlos=0` | on | the model look's lit surface seen through the disk at the gas's own extinction, and the shadow's glow at 0.4 of the lit everywhere, as until round 18f (the table stays) |

## The visible and mid-infrared looks' cylinder (round 18f)

The visible and mid-infrared looks march a cylinder of their own, smaller than the model look's (136 × 102 au): 64 × 40 au
(radius × half height) since round 18f, fitted to the lit tail (40 × 30 au before, which cut the lit surface at 40 au into
a box), the disk's light and extinction fading to nothing over its last fifth so that its walls do not show (DESIGN.md,
section 47.4). The gas line and the millimetre look keep 40 × 30 au, as does the cut of before (`?sigtail=0`). Development
switch, read by the engine when it is built (the page passes it on as `data-obscyl`):

| Switch | Default | What it does |
|---|---|---|
| `?obscyl=40,30` | 64,40 | the cylinder's radius and half height, au (30 to 136, 20 to 102), for the cost of the march (a value it cannot read: the default) |

## The small grains' one opacity (round 18g)

The gas and its small grains have one opacity a band, the same per mass in the disk, the wind and the envelope (DESIGN.md,
section 48). In visible light it is the one that absorbs the starlight and sets its depth τ* and the lit surface (K_OCC =
e^LNTAU1 √(2π) H0 = 369.6 in Σ's unit, 0.22 cm² per gram of gas with Σ(1 au) = 1700 g cm⁻², about 1/920 of interstellar dust's):
the visible look's extinction, the model look's scattered light on its way to the camera and the jet behind the disk take it. In
the mid-infrared it is about 1/17 of that (interstellar dust's τ_V / τ_9.7). The model look's gas glow stays a translucent layer
(K_G = K_OCC / 462), a picture of where the gas is. Until round 18g the visible look took 1/15 of K_OCC, the mid-infrared 1/58,
the wind and the envelope 1/462, and the model look's scattered light 1/15 (round 18f). Development switch, read by the engine
when it is built (the page passes it on as `data-opq`):

| Switch | Default | What it does |
|---|---|---|
| `?opq=0` | on | the opacities of 1.9-dev.28: the visible look's gas at 30 times the model look's, the mid-infrared's at 8, the wind and the envelope at the model look's, the model look's scattered light dimmed at 30 times (the cut of before, `?sigtail=0`, keeps them too) |
| `?selfsurf=1` | off | (round 18j) the model look's own emission at the temperature of round 18i, with the surface's grains heated directly by the starlight (the warm bands edge-on, the X of the lit cones where thin). (Round 18k: that temperature is the default now, the owner's choice; the switch is passed over) |
| `?selfint=1` | off | (round 18k) the model look's own emission at the interior's temperature of round 18j, without the surface's grains heated directly by the starlight (no warm bands edge-on), in the look of round 18k (DESIGN.md section 52). (Round 18l: the page reads it as the link's `selft=int`, above; the engine no longer reads `data-selfint`) |
| `?selflook=old` | off | (round 18k) the model look's own emission as in 1.9-dev.32 (round 18j): the interior's temperature, the brightness linear in the brightness temperature (1000 K the stretch's 1) in the gas's colour, with the depth's haze, the materials' key; to compare with the look of round 18k |
| `?selfhue=1` | off | (round 18m) the model look's own emission in the colours of its brightness temperature of round 18k (slate blue at 10 K through white at 160 K to gold at 1500 K, the key's bar and its title of then), to compare with the gas's colour in shades, the default (data-selfhue, SELF_TCOL; DESIGN.md section 54) |
| `?turb3d=0` | off | (round 18m) the turbulence of before: beyond the thermally ionized inner disk one pattern through the whole column, uniform in height (the disk map alone, a 2D texture; the shaders' text as before), to compare with the turbulence that varies with height, the default (data-turb3d, TURB3D_OFF; DESIGN.md section 54) |

## The shortcuts while the picture moves (rounds 16a and 16b)

Development switches for trying how much faster the moving picture can be drawn (DESIGN.md, section 39); off by default.
They act on every frame of a moving picture (a drag, held or not, a touch, a flight, a path, or the clock running): a still
picture, from the first frame after the motion, is drawn in full, as without them.

| Switch | Default | What it does |
|---|---|---|
| `?fast=1` | off | fewer steps: `?fastk=` of the march's step cap (the model and millimetre looks), of the continuum's substeps (visible, mid-infrared) and of the gas line's first steps |
| `?fast=2` | off | and the rays of empty blocks left out: a coarse pass at 1/8 of the size marks where the volume gathers nothing above the exposure's floor (not in a frame drawn in kicks, which the visible and mid-infrared looks are; not in the gas line's look, the cut or a planet close up). `?fast=3` is taken as 2 (the checkerboard of round 16a was dropped in 16b) |
| `?fastk=0.4` | 0.6 | the share of the steps with `?fast=` (0.2 to 1) |

## The timing switches (round 16c)

For the owner's trials of how long a picture takes to be drawn; the page passes them on as `data-steps` and `data-acc`.

| Switch | Default | What it does |
|---|---|---|
| `?steps=80` | 150 | the march's steps at most (twice that within 10 au of the point looked at), 1 to 320 (round 17b: as `box.diskSteps`; a value not a number is 150) |
| `?acc=4` | 16 | the frames a still picture averages, 1 to 16 (round 17b: the name is this switch's alone; the accretion layer's is `?acclayer=1`) |

## Every switch, at a glance (round 17b)

All the address's switches the page reads besides a view's keys (`lang`, `place`, `el az d tx ty tz p look mode field ann asym
marks waves slice sq speed paused t com cov ms roll`, `bg`, `stars`, `pl`, `pmd`, `col`, `mp`, `wb`, `op`, `#seq=`, above), each with where it is
described. A switch for development compares or tries something on the development build, a switch for checks serves the checks;
neither is written by "Copy a link". A value the page or the engine cannot read is passed over (`link-check.mjs`,
`params-check.mjs` case 8).

| Switch | For | Where |
|---|---|---|
| `still=1`, `gl=force`, `motion=reduce`, `retry=1`, `present=1` | the visitor, checks | URL parameters, above |
| `lit=fx`, `bgmove=1`, `cpdh=drawn`, `cpd=old`, `acclayer=1`, `gasrho=old` | development: before and after | URL parameters |
| `mflux=0`, `lam=old` or `lam=a,b`, `lamin=`, `mdot=`, `chic=`, `mpconst=1` | development: the mass budget and the parameters | URL parameters; The model's parameters |
| `pebh=`, `excl=`, `coenv=0`, `jetocc=0`, `ggas=`, `cpdflare=`, `wext=1`, `lscale=0` | development (round 15b) | The engine's switches of round 15b |
| `sigtail=0`, `rc=` | development (rounds 18a, 18b): the gas's cut of before, another R_c | The gas's surface density |
| `litflat=1`, `skinlos=0` | development (rounds 18c, 18f): the model look's surface lit as before; seen through the disk as before | The starlight on the model look's surface |
| `obscyl=R,Z` | development (round 18f): the visible and mid-infrared looks' cylinder | The visible and mid-infrared looks' cylinder |
| `opq=0` | development (round 18g): the opacities of before | The small grains' one opacity |
| `fast=1` or `2`, `fastk=` | development (rounds 16a, 16b) | The shortcuts while the picture moves |
| `steps=`, `acc=` | development (round 16c) | The timing switches |
| `tilt=0` | development (round 12b): no tilting | URL parameters; Tilt to look in |
| `duty=off` or a fraction, `ctmax=N`, `eddy=0`, `fps=N`, `split=0`, `kick=N`, `kadapt=1`, `math=safe` | development (round 10a): to try on a phone, recorded with the visit: the GPU's duty (0.5 on a guarded device), the continuum's iterations at most, no eddies' volume, the frame rate while only the clock moves, the continuum's rays whole (not in kicks), the work of a kick, the kick's work by kind, the main programs with safe math | the comments at `SWITCH` and `start` in `app.js` |
| `guard=ms`, `gpux=k` | checks (round 9): guard as on a phone with that budget; every frame counted k times | URL parameters; The guard |
| `caps=webkit` (with `+lin`, `+blend`, `+half`), `caps=nogl` | checks (round 10a): the extensions WebKit lacks taken away from every WebGL2 context (no timer queries, no parallel link; and no float linear filtering, float blending, float render targets), or no WebGL2 at all | the comment at `CAPS` in `app.js` |
| `gputime=1`, `handsoff=ms`, `idle=ms`, `diag=1` | checks: each piece of GPU work timed on the GPU; the hands-off delay of a picture refined while the clock runs (250 ms); the rest after ms without input; the visit's record offered in About always, with this visit's | the comments in `app.js` |
| `g=` | read past (the display amounts, until round 6) | URL parameters |
