// Disk Lab's video file (round 11b): a minimal MP4 writer of its own, no dependency (the supervisor's choice for the owner: no new
// dependency; ver2/docs/disk-lab-handoff.md, section 6). One H.264 video track at a constant frame rate, no audio, as WebCodecs'
// VideoEncoder gives it in its 'avc' format: each frame a sample of length-prefixed NAL units, and the decoder's configuration
// (an AVCDecoderConfigurationRecord, the avcC box's content) with the first. ISO/IEC 14496-12 (the boxes) and 14496-15 (avc1, avcC).
// The file, flat, the index written last, when the count is known:
//   ftyp                 isom, compatible with iso2, avc1 and mp41
//   mdat                 the samples one after another, in the order the encoder gave them
//   moov
//     mvhd               the movie: its time scale (1000 a second) and duration
//     trak
//       tkhd             track 1, enabled, its size
//       mdia
//         mdhd           the media's time scale (fps x 1000) and duration
//         hdlr           'vide'
//         minf
//           vmhd, dinf   (dref: the samples are in this file)
//           stbl
//             stsd       one avc1 sample entry, with its avcC (and a colr box where one is given)
//             stts       one entry: every sample lasts 1000 (a frame)
//             stss       the key frames, numbered from 1 (left out where every sample is one)
//             stsc       one entry: a sample a chunk
//             stsz       each sample's size
//             stco       each sample's offset in the file (32-bit: a file under 4 GB; the page keeps a video under 1.5 GB)
// No edit list (the first sample shows at 0) and no composition offsets: the encoder does not reorder frames (Chrome's H.264
// encoders do not), so a sample's time is its place in the list; a timestamp that says otherwise is refused, not hidden.
// No DOM: the page makes a Blob of the parts; ver2/tools/disk-lab-v2/mp4-check.mjs builds files in Node and reads them back.

const u16 = (n) => new Uint8Array([(n >>> 8) & 255, n & 255]);
const u32 = (n) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const u32s = (list) => { const out = new Uint8Array(4 * list.length), dv = new DataView(out.buffer); list.forEach((v, i) => dv.setUint32(4 * i, v)); return out; };
const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const zeros = (n) => new Uint8Array(n);
// a box: its size (32-bit, header included), its type, its content; a full box has a version and flags first
function box(type, ...parts) {
  const size = 8 + parts.reduce((n, p) => n + p.length, 0), out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, size); out.set(ascii(type), 4);
  let o = 8; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const full = (type, version, flags, ...parts) => box(type, u32(((version << 24) | flags) >>> 0), ...parts);
// the unity matrix of mvhd and tkhd (16.16 and 2.30 fixed point)
const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];
const LIMIT = 2 ** 32 - 1;   // (a 32-bit box size and stco offset)

// The file's parts, to be joined (new Blob(parts) in a page). o:
//   width, height   the frames' size (px; the encoder's)
//   fps             frames a second (a whole number: the media's time scale is fps x 1000, a frame 1000)
//   avcC            the encoder's description (Uint8Array or ArrayBuffer): the AVCDecoderConfigurationRecord
//   samples         [{ data (Uint8Array), key (a key frame), ts (its timestamp, microseconds; optional) }], in order
//   time            when it was made (ms since 1970; the boxes count seconds since 1904), 0 for none
//   colr            { primaries, transfer, matrix, full }: an nclx colour box (ISO/IEC 23001-8 codes), where the stream's own
//                   signalling is to be stated in the container too; none by default
// Returns { parts, size (bytes), frames, seconds }. Throws on what would make a file a player reads wrong.
export function mp4Parts({ width, height, fps, avcC, samples, time = 0, colr = null, name = 'Disk Lab' } = {}) {
  if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width < 65536 && height < 65536)) throw new Error('mp4: the size ' + width + ' x ' + height);
  if (!(Number.isInteger(fps) && fps >= 1 && fps <= 240)) throw new Error('mp4: the frame rate ' + fps + ' (a whole number, 1 to 240)');
  const desc = avcC instanceof Uint8Array ? avcC : avcC instanceof ArrayBuffer ? new Uint8Array(avcC) : ArrayBuffer.isView(avcC) ? new Uint8Array(avcC.buffer, avcC.byteOffset, avcC.byteLength) : null;
  if (!desc || desc.length < 7 || desc[0] !== 1) throw new Error('mp4: no AVC decoder configuration (avcC)');
  if (!Array.isArray(samples) || !samples.length) throw new Error('mp4: no samples');
  const n = samples.length, timescale = fps * 1000, delta = 1000, frameUs = 1e6 / fps;
  samples.forEach((s, i) => {
    if (!s || !(s.data instanceof Uint8Array) || !s.data.length) throw new Error('mp4: sample ' + i + ' is empty');
    // (in decode order, each at its own frame's time, half a frame either way: an encoder that reordered frames would need ctts)
    if (s.ts != null && !(Math.abs(s.ts - i * frameUs) < frameUs / 2)) throw new Error('mp4: sample ' + i + ' at ' + s.ts + ' us, not frame ' + i + ' (reordered or dropped)');
  });
  if (!samples[0].key) throw new Error('mp4: the first sample is not a key frame');
  const sizes = samples.map((s) => s.data.length), data = sizes.reduce((a, b) => a + b, 0);
  const ftyp = box('ftyp', ascii('isom'), u32(0x200), ascii('isom'), ascii('iso2'), ascii('avc1'), ascii('mp41'));
  const base = ftyp.length + 8;   // (the first sample: after ftyp and mdat's header)
  const offsets = []; let at = base;
  for (const z of sizes) { offsets.push(at); at += z; }
  const t = time ? Math.floor(time / 1000) + 2082844800 : 0, ms = Math.round(n * 1000 / fps);
  const nameBytes = ascii(name.slice(0, 31)), compressor = zeros(32); compressor[0] = nameBytes.length; compressor.set(nameBytes, 1);
  const avc1 = box('avc1', zeros(6), u16(1), u16(0), u16(0), zeros(12), u16(width), u16(height), u32(0x00480000), u32(0x00480000), u32(0), u16(1), compressor, u16(0x0018), u16(0xffff),
    box('avcC', desc), ...(colr ? [box('colr', ascii('nclx'), u16(colr.primaries), u16(colr.transfer), u16(colr.matrix), new Uint8Array([colr.full ? 0x80 : 0]))] : []));
  const keys = []; samples.forEach((s, i) => { if (s.key) keys.push(i + 1); });
  const stbl = box('stbl',
    full('stsd', 0, 0, u32(1), avc1),
    full('stts', 0, 0, u32(1), u32(n), u32(delta)),
    ...(keys.length < n ? [full('stss', 0, 0, u32(keys.length), u32s(keys))] : []),
    full('stsc', 0, 0, u32(1), u32(1), u32(1), u32(1)),
    full('stsz', 0, 0, u32(0), u32(n), u32s(sizes)),
    full('stco', 0, 0, u32(n), u32s(offsets)));
  const minf = box('minf', full('vmhd', 0, 1, u16(0), u16(0), u16(0), u16(0)), box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))), stbl);
  const mdia = box('mdia', full('mdhd', 0, 0, u32(t), u32(t), u32(timescale), u32(n * delta), u16(0x55c4), u16(0)),   // (0x55c4: the language 'und')
    full('hdlr', 0, 0, u32(0), ascii('vide'), zeros(12), ascii('VideoHandler\0')), minf);
  const tkhd = full('tkhd', 0, 3, u32(t), u32(t), u32(1), u32(0), u32(ms), zeros(8), u16(0), u16(0), u16(0), u16(0), u32s(MATRIX), u32(width * 65536), u32(height * 65536));
  const mvhd = full('mvhd', 0, 0, u32(t), u32(t), u32(1000), u32(ms), u32(0x00010000), u16(0x0100), zeros(10), u32s(MATRIX), zeros(24), u32(2));
  const moov = box('moov', mvhd, box('trak', tkhd, mdia));
  const size = base + data + moov.length;
  if (8 + data > LIMIT || size > LIMIT) throw new Error('mp4: ' + size + ' bytes, over the 32-bit offsets of this writer');
  const mdatHead = new Uint8Array(8); new DataView(mdatHead.buffer).setUint32(0, 8 + data); mdatHead.set(ascii('mdat'), 4);
  return { parts: [ftyp, mdatHead, ...samples.map((s) => s.data), moov], size, frames: n, seconds: n / fps };
}
