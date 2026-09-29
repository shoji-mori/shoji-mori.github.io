// Adds refereed papers found on NASA ADS (by ORCID) that are not yet in src/data/publications.seed.json.
// Usage: ADS_API_TOKEN=... npm run sync:ads    (token: https://ui.adsabs.harvard.edu/user/settings/token)
// Review the diff, optionally add summaries or "selected": true, then run `npm run release`.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root } from './content.mjs';
import { ORCID, searchByOrcid, newRecords, mergeByYear } from './ads.mjs';

const token = process.env.ADS_API_TOKEN;
if (!token) throw new Error('Set ADS_API_TOKEN (https://ui.adsabs.harvard.edu/user/settings/token).');
const file = path.join(root, 'src/data/publications.seed.json');
const existing = JSON.parse(readFileSync(file, 'utf8'));
const added = newRecords(await searchByOrcid(ORCID, token), existing);
if (!added.length) {
  console.log('No new refereed papers on ADS.');
} else {
  writeFileSync(file, JSON.stringify(mergeByYear(existing, added), null, 2) + '\n');
  for (const p of added) console.log(`Added ${p.id}: ${p.year} ${p.titleEn} (${p.journalEn})`);
  console.log('Check the new records in src/data/publications.seed.json before releasing.');
}
