// QR codes for the audience (round 11c): a link as a QR code, drawn as SVG, with nothing but this file.
//
// The symbol follows ISO/IEC 18004 (QR Code, Model 2): byte mode (the text as UTF-8), error correction level M (about
// 15 % of the codewords can be restored: a code on a projector may be glared or partly hidden by a head), the smallest
// version (1 to 40) that holds the text, and of the eight masks the one with the lowest penalty by the standard's four
// rules. The function patterns, the zigzag of the codewords, the block interleaving and the format and version
// information are the standard's. Checked in Node against the standard's published values, a symbol drawn by hand and an
// independent reader (and, where they are on the machine, OpenCV's and macOS Core Image's readers):
// ver2/tools/disk-lab-v2/qr-check.mjs.

// GF(256) with the standard's polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11D) and α = 2
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

// level M by version (index 0 unused): the error correction codewords of each block, and the number of blocks
const ECC_M = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
const BLOCKS_M = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];

const sizeOf = (v) => 17 + 4 * v;
// the modules left for the codewords once the function patterns are drawn (the version information from version 7)
function rawModules(v) {
  let n = (16 * v + 128) * v + 64;
  if (v >= 2) { const a = Math.floor(v / 7) + 2; n -= (25 * a - 10) * a - 55; if (v >= 7) n -= 36; }
  return n;
}
const totalCodewords = (v) => Math.floor(rawModules(v) / 8);
const dataCount = (v) => totalCodewords(v) - ECC_M[v] * BLOCKS_M[v];
// the alignment patterns' centres along either axis (the standard's table, as its rule: evenly spaced from the far side)
function alignAt(v) {
  if (v === 1) return [];
  const n = Math.floor(v / 7) + 2, step = Math.floor((v * 8 + n * 3 + 5) / (n * 4 - 4)) * 2, out = [6];
  for (let p = sizeOf(v) - 7; out.length < n; p -= step) out.splice(1, 0, p);
  return out;
}

export const qrBytes = (text) => new TextEncoder().encode(String(text));
// the bytes that fit at level M: the data codewords less the mode (4 bits) and the count (8 bits to version 9, else 16)
export const qrCapacity = (v) => Math.floor((dataCount(v) * 8 - 4 - (v < 10 ? 8 : 16)) / 8);

// the generator polynomial of degree n, the product of (x − α^i) for i < n: its coefficients from x^n (1) down to x^0
export function rsGenerator(n) {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const r = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) { r[j] ^= g[j]; r[j + 1] ^= mul(g[j], EXP[i]); }
    g = r;
  }
  return Uint8Array.from(g);
}
// a block's n error correction codewords: the remainder of data(x) x^n divided by the generator
export function rsRemainder(data, n) {
  const g = rsGenerator(n), r = new Uint8Array(n);
  for (const b of data) {
    const f = b ^ r[0];
    r.copyWithin(0, 1); r[n - 1] = 0;
    for (let j = 0; j < n; j++) r[j] ^= mul(g[j + 1], f);
  }
  return r;
}
// the format information for level M (its two bits 00) and a mask: BCH(15,5), then the standard's XOR 101010000010010
export function formatBits(mask) {
  const d = mask & 7;
  let r = d;
  for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
  return ((d << 10) | r) ^ 0x5412;
}
// the version information (versions 7 to 40): BCH(18,6)
export function versionBits(v) {
  let r = v;
  for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
  return (v << 12) | r;
}
// the data codewords: the mode 0100 (bytes), the count, the bytes, a terminator of up to four 0 bits, 0 bits to the byte,
// then the pad codewords 11101100 and 00010001 in turn
export function dataCodewords(bytes, v) {
  const n = dataCount(v), bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); put(bytes.length, v < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  if (bits.length > n * 8) throw new RangeError(`${bytes.length} bytes do not fit version ${v}`);
  put(0, Math.min(4, n * 8 - bits.length));
  put(0, (8 - bits.length % 8) % 8);
  const out = new Uint8Array(n);
  for (let i = 0; i < bits.length; i++) out[i >> 3] |= bits[i] << (7 - (i & 7));
  for (let i = bits.length >> 3, p = 0; i < n; i++, p ^= 1) out[i] = p ? 0x11 : 0xEC;
  return out;
}
// the blocks, each with its error correction, interleaved: the data codewords of every block in turn (the short blocks,
// one data codeword fewer, first), then their error correction codewords in turn
export function interleave(data, v) {
  const nb = BLOCKS_M[v], ne = ECC_M[v], total = totalCodewords(v);
  const short = nb - total % nb, shortLen = Math.floor(total / nb) - ne, blocks = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const len = shortLen + (i < short ? 0 : 1), d = data.slice(k, k + len);
    k += len;
    blocks.push([d, rsRemainder(d, ne)]);
  }
  const out = [];
  for (let i = 0; i <= shortLen; i++) for (const [d] of blocks) if (i < d.length) out.push(d[i]);
  for (let i = 0; i < ne; i++) for (const [, e] of blocks) out.push(e[i]);
  return Uint8Array.from(out);
}
// the eight masks (x the column, y the row): where true, a data module is inverted
function maskAt(k, x, y) {
  switch (k) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return (x * y) % 2 + (x * y) % 3 === 0;
    case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
    default: return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
  }
}
// the symbol: the function patterns (the finders with their separators, the timing patterns, the alignment patterns, the
// dark module, the format and version areas), the codewords in the zigzag (two columns at a time from the right, up and
// down in turn, round the vertical timing pattern; the remainder bits light), the mask on the data modules, then the
// format information for that mask
export function placeMatrix(cw, v, mask) {
  const n = sizeOf(v), m = new Uint8Array(n * n), fn = new Uint8Array(n * n);
  const set = (x, y, dark) => { m[y * n + x] = dark ? 1 : 0; fn[y * n + x] = 1; };
  for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < n && y >= 0 && y < n) set(x, y, d !== 2 && d !== 4);
    }
  }
  for (let i = 8; i < n - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const al = alignAt(v), na = al.length;
  for (let i = 0; i < na; i++) for (let j = 0; j < na; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;   // (the finders' corners)
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  // (bit i of the format information: one copy round the upper left finder, the other split between the lower left and
  // the upper right)
  const format = (bits) => {
    for (let i = 0; i <= 5; i++) set(8, i, (bits >>> i) & 1);
    set(8, 7, (bits >>> 6) & 1); set(8, 8, (bits >>> 7) & 1); set(7, 8, (bits >>> 8) & 1);
    for (let i = 9; i < 15; i++) set(14 - i, 8, (bits >>> i) & 1);
    for (let i = 0; i < 8; i++) set(n - 1 - i, 8, (bits >>> i) & 1);
    for (let i = 8; i < 15; i++) set(8, n - 15 + i, (bits >>> i) & 1);
    set(8, n - 8, 1);   // (the dark module)
  };
  format(0);   // (the area kept first, so that the codewords go round it)
  if (v >= 7) {
    const vb = versionBits(v);
    for (let i = 0; i < 18; i++) { const a = n - 11 + i % 3, b = Math.floor(i / 3), d = (vb >>> i) & 1; set(a, b, d); set(b, a, d); }
  }
  let k = 0;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const up = ((right + 1) & 2) === 0;
    for (let vert = 0; vert < n; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = up ? n - 1 - vert : vert;
      if (!fn[y * n + x] && k < cw.length * 8) { m[y * n + x] = (cw[k >> 3] >>> (7 - (k & 7))) & 1; k++; }
    }
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!fn[y * n + x] && maskAt(mask, x, y)) m[y * n + x] ^= 1;
  format(formatBits(mask));
  return { version: v, size: n, mask, modules: m };
}
// the standard's penalty of a masked symbol: N1 3 for a run of five modules of one colour in a row or column, and 1 for each
// module more; N2 3 for each 2 x 2 block of one colour; N3 40 for each 1:1:3:1:1 pattern (dark light dark dark dark light
// dark) with four light modules before or after it, outside the symbol counted as light (its quiet zone); N4 10 for each
// 5 % of the dark modules' share away from half
export function penalty(m, n) {
  let p = 0, dark = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let a = 0; a < n; a++) {
      const get = pass ? (b) => m[b * n + a] : (b) => m[a * n + b];   // (the rows, then the columns)
      let run = 1;
      for (let b = 1; b <= n; b++) {
        if (b < n && get(b) === get(b - 1)) run++;
        else { if (run >= 5) p += run - 2; run = 1; }
      }
      const light = (from, to) => { for (let c = Math.max(0, from); c < Math.min(n, to); c++) if (get(c)) return false; return true; };
      for (let b = 0; b + 7 <= n; b++) {
        if (get(b) && !get(b + 1) && get(b + 2) && get(b + 3) && get(b + 4) && !get(b + 5) && get(b + 6) && (light(b - 4, b) || light(b + 7, b + 11))) p += 40;
      }
    }
  }
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
    const c = m[y * n + x];
    if (c === m[y * n + x + 1] && c === m[(y + 1) * n + x] && c === m[(y + 1) * n + x + 1]) p += 3;
  }
  for (let i = 0; i < n * n; i++) dark += m[i];
  return p + 10 * Math.floor(Math.abs(dark * 20 / (n * n) - 10));
}
// a text as a QR code: { version, size, mask, modules } (modules row by row, 1 dark), or null when it does not fit maxVersion.
// mask -1: the one with the lowest penalty (the first of equals); 0 to 7: that one
export function qrEncode(text, { minVersion = 1, maxVersion = 40, mask = -1 } = {}) {
  const bytes = qrBytes(text), top = Math.min(40, maxVersion);
  let v = Math.max(1, minVersion);
  while (v <= top && bytes.length > qrCapacity(v)) v++;
  if (v > top) return null;
  const cw = interleave(dataCodewords(bytes, v), v);
  if (mask >= 0 && mask <= 7) return placeMatrix(cw, v, mask);
  let best = null, low = Infinity;
  for (let k = 0; k < 8; k++) { const s = placeMatrix(cw, v, k), pk = penalty(s.modules, s.size); if (pk < low) { best = s; low = pk; } }
  return best;
}
// the symbol as SVG markup: one module a unit, the quiet zone `border` modules wide, the dark modules one path (each row's
// runs merged), crisp edges; sized by the page's CSS (no width or height)
export function qrSvg(qr, { border = 4, dark = '#000', light = '#fff', title = '' } = {}) {
  const n = qr.size, w = n + 2 * border, esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  let d = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!qr.modules[y * n + x]) continue;
      let e = x;
      while (e + 1 < n && qr.modules[y * n + e + 1]) e++;
      d += `M${x + border} ${y + border}h${e - x + 1}v1h-${e - x + 1}z`;
      x = e;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${w}" shape-rendering="crispEdges" role="img">` +
    (title ? `<title>${esc(title)}</title>` : '') + `<rect width="${w}" height="${w}" fill="${esc(light)}"/><path d="${d}" fill="${esc(dark)}"/></svg>`;
}
