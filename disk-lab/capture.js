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
