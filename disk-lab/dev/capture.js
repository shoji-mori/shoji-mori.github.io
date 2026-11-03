// Pictures of the model: the engine's diskSnapshot, with the volume read back by readPixels.
//
// In Chrome (checked on 2026-10-15, M1 Max, ANGLE Metal) a 2D canvas's drawImage of the engine's WebGL canvas copies
// nothing: diskSnapshot then returns its overlay (lines, labels) on a transparent picture. A fresh WebGL canvas with the
// same context attributes copies fine, and readPixels of the engine's canvas right after its frames gives the right
// picture. So for the time of one snapshot, drawImage with that canvas as its source is replaced by a readPixels of
// the default framebuffer (flipped to the 2D canvas's rows), done at the same moment, right after the frames that
// diskSnapshot draws and before the browser presents them. Every other drawImage is left alone.

export async function snapshot(box, opts = {}) {
  const canvas = box.querySelector(':scope > canvas');
  const gl = canvas && canvas.getContext('webgl2');
  if (!gl || typeof box.diskSnapshot !== 'function') return null;
  const proto = CanvasRenderingContext2D.prototype, drawImage = proto.drawImage;
  proto.drawImage = function (src, ...args) {
    if (src !== canvas || args.length !== 2) return drawImage.call(this, src, ...args);
    const w = canvas.width, h = canvas.height, px = new Uint8Array(w * h * 4), row = w * 4;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const img = new ImageData(w, h);
    for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    this.putImageData(img, args[0], args[1]);
  };
  try {
    return await box.diskSnapshot({ ...opts, canvas: true });
  } finally { proto.drawImage = drawImage; }
}

export const toPng = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

// (round 11c) Pictures for slides: the stage's picture cut to a ratio (16:9, 4:3) about its centre, never stretched. The
// largest rectangle of that ratio inside w x h, centred, in whole pixels: one side whole, the other the nearest whole number
// to the ratio. Ratio 0, or one within a pixel of the picture's own, is the whole picture. A pure function, checked in Node
// (ver2/tools/disk-lab-v2/crop-check.mjs).
export function cropFor(w, h, ratio) {
  if (!(ratio > 0) || !(w > 0) || !(h > 0)) return { x: 0, y: 0, w, h };
  const cw = Math.min(w, Math.round(h * ratio)), ch = Math.min(h, Math.round(w / ratio));
  const W2 = cw < w ? cw : w, H2 = cw < w ? h : ch;
  return { x: Math.floor((w - W2) / 2), y: Math.floor((h - H2) / 2), w: W2, h: H2 };
}

// A snapshot (as above) cut to the ratio. The scale bar, which the engine draws 18 px from the lower left corner and a crop
// would cut away, is moved into the crop's lower left corner: for the time of the snapshot, the engine's copy of its overlay
// (the SVG of the lines and labels it serializes before drawing it on the picture) has its scale bar groups shifted; the
// labels stay where the picture puts them. Ratio 0: the snapshot as it is.
export async function framed(box, opts = {}, ratio = 0) {
  if (!(ratio > 0)) return snapshot(box, opts);
  const canvas = box.querySelector(':scope > canvas');
  const proto = XMLSerializer.prototype, serialize = proto.serializeToString;
  proto.serializeToString = function (node, ...args) {
    if (canvas && node && node.classList && node.classList.contains('disk-overlay')) {
      // (the overlay's viewBox is the stage's CSS pixels; the canvas, at this moment, the snapshot's pixels)
      const vb = (node.getAttribute('viewBox') || '').split(/\s+/).map(Number), vw = vb[2], vh = vb[3];
      const r = cropFor(canvas.width, canvas.height, ratio);
      if (vw > 0 && vh > 0) {
        const dx = r.x * vw / canvas.width, dy = -(canvas.height - r.y - r.h) * vh / canvas.height;
        node.querySelectorAll('.disk-scale').forEach((g) => g.setAttribute('transform', `translate(${dx.toFixed(2)} ${dy.toFixed(2)})`));
      }
    }
    return serialize.call(this, node, ...args);
  };
  let c;
  try { c = await snapshot(box, opts); } finally { proto.serializeToString = serialize; }
  if (!c) return c;
  const r = cropFor(c.width, c.height, ratio);
  if (r.w === c.width && r.h === c.height) return c;
  const out = document.createElement('canvas'); out.width = r.w; out.height = r.h;
  out.getContext('2d').drawImage(c, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  return out;
}
