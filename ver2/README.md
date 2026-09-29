# Shoji Mori — website refresh

Five static pages, built in ver2/ so the existing GitHub Pages site stays intact during review. The redesign makes the research question, publications, and CV immediately accessible, with an editorial layout and credited research imagery.

## Preview and validation

Node.js 22 or later is sufficient. There are no package dependencies to install.

    cd ver2
    npm run dev

Open http://127.0.0.1:4321/. The server binds only to the local machine, watches src/, and rebuilds after edits. Refresh the page to see changes.

    npm test
    npm run build
    npm run check

The build produces dist/ with five main routes, two print-preview routes, a 404 page, a redirect from the former /news/ page to /talks/, a sitemap, a bibliography download, and copies of the existing public PDFs. dist/ is ignored. The checker validates document structure, internal links and fragments, local assets, citation exports, and record counts.

## Content

- src/pages/: page structure and bilingual editorial text.
- src/layouts/base.html: navigation, language controls, metadata, and contact.
- src/styles/styles.css: responsive typography, layouts, and print styles.
- src/scripts/site.js: language persistence, filters, menus, citation copying, printing, and the existing contact integration.
- src/data/publications.seed.json: 22 publications migrated from the existing site.
- src/data/presentations.json: 61 presentations, including three records without an assigned domestic/international scope. These remain visible in the complete list and under “Unspecified.”
- src/data/research.json, cv.json, materials.json: four research themes spanning 2016–2025, eight CV sections, and 12 materials. Research references use stable publication IDs.
- src/data/provenance.json: original source hashes and migration counts.
- docs/asset-sources.md: figure sources and credits.
- docs/2026-09-12-design-review.md: design references, the rationale for the revision, research evidence, and the feature audit.

Each record's id should remain stable when editing or reordering it. Add new records with a new, unique ID. Publication and presentation content is rendered into HTML, so it is readable without JavaScript. Filters, language switching, and copying require JavaScript. The language preference uses the same localStorage key (lang) as the current site.

The new JSON files are the content inputs for this preview. They are a preserved snapshot of the existing site's content, **not an updated ADS feed**. This implementation does not add ADS synchronization or display unverified citation metrics. The current site's root data files and admin/ are unchanged.

Before production use, connect the existing admin export to the new build. The admin currently exports publications_data.js and presentations_data.js, so replacing those root files alone does not update this preview's JSON inputs. The feature audit records this remaining integration work.

The earlier July design and implementation documents describe a wider Astro/data-automation migration. This revision implements the design and usability work with the existing static-site approach and no new dependencies. It does not claim completion of that separate infrastructure plan.

## Bibliography and PDF output

Publication titles and names retain the published language. English papers remain in English even in the Japanese interface; the Japanese review retains its Japanese title. Accessible summaries remain bilingual. The home page's representative papers are an editorial selection spanning the research history, independent of the older archive's selected-work flags.

The publications and talks pages link to dedicated print previews at /publications/print/ and /talks/print/. Users choose Japanese or English and either the complete list or the current search results, then use their browser's print-to-PDF command. Empty search results disable the print button. The talks export contains presentations, excluding the separate materials catalogue.

Search filters are encoded in the archive URL and carried into the preview. Print language changes do not modify the saved website language; the return link restores the source language and filters, including after a preview reload. The print routes are excluded from the sitemap and marked noindex. Without JavaScript, browser printing still provides the complete English list.

## Contact and external services

The existing Formspark endpoint, honeypot, email address, and Cloudflare Turnstile site key are preserved. Turnstile loads only when the contact form is opened. No external message was sent during development. Actual delivery and the production domain's CAPTCHA configuration require a production check; direct email is always available.

## Publishing

The repository currently publishes its root from main. Nothing in this preview changes that setup or deploys automatically. The local preview is the review artifact.

After explicit approval to publish, rebuild and validate the site, then copy the generated HTML, CSS, JavaScript, images, bibliography, sitemap, and route directories from ver2/dist/ into the repository root, preserving the existing public files and admin/. Review the resulting diff before committing and pushing. Do not copy dist/ wholesale over unrelated root directories.

Old home-page anchors for research, publications, presentations, materials, and CV are redirected to their new routes. Existing PDF URLs and Google verification are retained.
