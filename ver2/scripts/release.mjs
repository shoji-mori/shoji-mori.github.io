// Build, validate and copy the generated site into the repository root, which GitHub Pages serves.
// It does not commit or push: review `git status` / `git diff` in the repository root, then commit and push.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { root } from './content.mjs';
import { build } from './build.mjs';

const dist = path.join(root, 'dist');
const site = path.join(root, '..');
// Only generated routes and assets are replaced; files/, admin/, PDFs and other root files are left alone.
const directories = ['research', 'publications', 'talks', 'mentoring', 'cv', 'news', 'images', 'fonts'];
const files = ['index.html', '404.html', 'styles.css', 'site.js', 'publications.bib', 'sitemap.xml'];

console.log('Built', build());
const run = (args) => execFileSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
run(['scripts/check.mjs']);
run(['--test', 'tests/']);

for (const dir of directories) {
  const target = path.join(site, dir);
  rmSync(target, { recursive: true, force: true });
  cpSync(path.join(dist, dir), target, { recursive: true });
}
for (const file of files) cpSync(path.join(dist, file), path.join(site, file));
if (existsSync(path.join(site, '_proto'))) throw new Error('Unexpected _proto directory in the repository root');
console.log('Copied the built site to ' + site + '. Review the changes, then commit and push.');
