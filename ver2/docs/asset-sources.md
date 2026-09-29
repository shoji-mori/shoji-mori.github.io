# Image sources

## HL Tauri observation

- File: public/images/hl-tau.jpg (1800 × 1800).
- Source: https://www.eso.org/public/images/eso1436a/
- Original download: https://cdn.eso.org/images/large/eso1436a.jpg
- Credit: **ALMA (ESO/NAOJ/NRAO)**.
- License: CC BY 4.0. Terms: https://www.eso.org/public/outreach/copyright/
- The original JPEG is retained, displayed against the navy page background. The credit and source link are visible beside it. The outer 5% of the image margin (background noise only) is faded in CSS so the square edge does not show against the hero gradient; the disk itself is not masked.
- This is a visualization of a millimeter observation of the disk around HL Tauri, not a numerical simulation or a true-color optical photograph. Ring gaps alone do not establish the presence of confirmed planets.

## Research figures

Extracted without redrawing from the owner's existing publicly shared research materials. Axes, legends, and scientific annotations are retained. Full-resolution versions are available from the research-page figures; original PDFs are linked in their captions.

| Image | Original source | Attribution |
| --- | --- | --- |
| mhd-alignment-thermal-structure.png | files/posters/poster-20251208-epf-thermal-structure-magnetized-ppds.pdf, p. 1, section 3 | Mori, Bai & Tomida (2025) |
| planet-growth-migration-tracks.png | Same poster, p. 1, section 4 | Mori, Kunitomo & Ogihara (2025) |
| episodic-surface-accretion.png | files/slides/slide-20250911-asj-autumn-global-nonideal-mhd.pdf, p. 13 | Mori, Bai & Tomida (2025) |
| electron-heating-mri-snapshots.png | files/thesis/thesis-201903-phd-thesis.pdf, p. 48, Fig. 2.3 (panels rearranged side by side) | Mori et al. (2017) |
| cpd-wind-accretion-schematic.png | files/slides/slide-20250128-cpdsf3-magnetic-circumplanetary-disks.pdf, p. 20 (schematic only) | Mori (2025 talk); see Shibaike & Mori (2023) |

These are model/simulation figures. No additional public license was inferred from the PDFs. Exact extraction parameters, original dimensions, and checksums are recorded in src/data/image-provenance.json.

## Portrait and existing files

The existing me.webp, me.jpg, CV PDF, theses, slides, and posters are copied to the build at their original public paths. The source files remain unchanged.

## Research card covers

The home-page research cards use cropped details of the research figures above, re-encoded as WebP (960 × 600) in public/images/cards/. They are decorative previews (empty alt text) and link to the research page, where each figure appears in full with its caption and credit.

| Card | Crop of | Command |
| --- | --- | --- |
| cards/temperature-water.webp | mhd-alignment-thermal-structure.png (upper panel interior) | magick SOURCE -crop 848x530+401+40 +repage -resize 960x600! -quality 82 DEST |
| cards/electron-heating.webp | electron-heating-mri-snapshots.png (both boxes, without titles, colorbar, or axes) | magick ( SOURCE -crop 655x545+242+236 ) ( -size 70x545 xc:white ) ( SOURCE -crop 655x545+1203+236 ) +append -resize 880x -extent 960x600 (white, centered) |
| cards/satellite-formation.webp | cpd-wind-accretion-schematic.png (whole) | magick SOURCE -resize x560 -extent 960x600 (white, centered) |

The observations theme has no cover: no figure from Mori et al. (2024) or the FAUST/eDisk papers is available among the owner's public materials, so the card uses a plain gradient.

## Fonts

Newsreader and Inter (latin and latin-ext subsets, woff2) are self-hosted in public/fonts/, copied from @fontsource/newsreader 5.2.10 and @fontsource/inter 5.2.8. Both are licensed under the SIL Open Font License 1.1; the license texts are in public/fonts/OFL-*.txt. Japanese text uses the reader's system Mincho/Gothic faces.
