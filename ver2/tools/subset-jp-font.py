#!/usr/bin/env python3
"""Rebuild the self-hosted Japanese font subsets from the characters the site uses.

The site ships Noto Sans JP (SIL OFL) cut down to the kana, punctuation and kanji
that appear in src/ and the built pages, so readers download ~190 kB per weight
instead of several MB. Characters missing from the subset still render, in the
reader's system Gothic font, so a stale subset degrades gracefully.

Usage (after `npm run build`):
  python3 tools/subset-jp-font.py --source DIR   # regenerate public/fonts/noto-sans-jp-site-*.woff
  python3 tools/subset-jp-font.py --check        # list used characters missing from the subset

DIR holds the per-range .woff files and 400.css/600.css of the @fontsource/noto-sans-jp
package (`npm pack @fontsource/noto-sans-jp` and extract; files/ and the css files).
Requires fontTools (`pip install fonttools`). WOFF (zlib) is used because WOFF2 needs brotli.
"""
import argparse, os, re, sys, unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'fonts'
WEIGHTS = ('400', '600')

def used_characters():
    text = ''
    for base in (ROOT / 'src', ROOT / 'dist'):
        for path in base.rglob('*'):
            if path.suffix in ('.html', '.json') and '_proto' not in path.parts:
                text += path.read_text(encoding='utf-8')
    chars = {c for c in text if ord(c) > 0x2FFF}
    # Keep all kana and full-width forms so small copy edits need no rebuild.
    chars |= {chr(c) for c in list(range(0x3000, 0x3040)) + list(range(0x3040, 0x3100)) + list(range(0xFF01, 0xFF5F))}
    return {c for c in chars if unicodedata.category(c) != 'Cn'}

def ranges(css_block):
    out = set()
    for part in re.search(r'unicode-range:\s*([^;]+);', css_block).group(1).split(','):
        part = part.strip()[2:]
        a, _, z = part.partition('-')
        out.update(range(int(a, 16), int(z or a, 16) + 1))
    return out

def build(source):
    from fontTools.ttLib import TTFont
    from fontTools import merge, subset
    cps = {ord(c) for c in used_characters()}
    for weight in WEIGHTS:
        css = (Path(source) / f'{weight}.css').read_text()
        parts = []
        for i, block in enumerate(re.findall(r'@font-face\s*\{(.*?)\}', css, re.S)):
            need = cps & ranges(block)
            if not need:
                continue
            name = re.search(r'url\(\./files/([^)]+)\.woff2\)', block).group(1) + '.woff'
            font = TTFont(Path(source) / 'files' / name)
            font.flavor = None
            options = subset.Options(); options.layout_features = ['*']; options.notdef_outline = True
            subsetter = subset.Subsetter(options); subsetter.populate(text=''.join(map(chr, need))); subsetter.subset(font)
            tmp = OUT / f'.part-{weight}-{i}.ttf'; font.save(tmp); parts.append(str(tmp))
        merged = merge.Merger().merge(parts)
        for p in parts:
            os.remove(p)
        merged.flavor = 'woff'
        target = OUT / f'noto-sans-jp-site-{weight}.woff'
        merged.save(target)
        print(f'{target.name}: {target.stat().st_size} bytes')

def check():
    from fontTools.ttLib import TTFont
    cmap = TTFont(OUT / f'noto-sans-jp-site-{WEIGHTS[0]}.woff').getBestCmap()
    missing = sorted(c for c in used_characters() if ord(c) not in cmap and not 0xFE00 <= ord(c) <= 0xFE0F)
    print('missing:', ''.join(missing) if missing else 'none')
    return 1 if missing else 0

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if args.check:
        sys.exit(check())
    if not args.source:
        parser.error('--source is required to rebuild')
    build(args.source)
