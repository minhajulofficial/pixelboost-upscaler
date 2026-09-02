// Transparency-preserving helpers for the Image Upscaler.
//
// AI super-resolution (Real-ESRGAN) and JPEG encoding can't represent alpha,
// so a transparent PNG comes back with a black background. To keep the result
// "same to same" we:
//   1. composite the source over white,
//   2. let the upscaling engine handle that RGB,
//   3. upscale the alpha channel separately (it is smooth, so LANCZOS is fine),
//   4. recombine into straight-alpha RGBA.
// JPEG output can't carry alpha at all, so it is simply composited over white.

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasToBlob(canvas, type, quality) {
  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type, quality });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Encoding failed'))), type, quality);
  });
}

/** True when any pixel has alpha < 255. */
export function hasAlpha(rgba) {
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] < 255) return true;
  }
  return false;
}

/** Straight RGBA -> opaque RGB composited over white. */
export function compositeOverWhite(rgba, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const a = rgba[o + 3] / 255;
    out[o] = Math.round(rgba[o] * a + 255 * (1 - a));
    out[o + 1] = Math.round(rgba[o + 1] * a + 255 * (1 - a));
    out[o + 2] = Math.round(rgba[o + 2] * a + 255 * (1 - a));
    out[o + 3] = 255;
  }
  return out;
}

/** Extract the alpha channel as a grayscale RGBA image. */
export function extractAlpha(rgba, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    out[o] = rgba[o + 3];
    out[o + 1] = rgba[o + 3];
    out[o + 2] = rgba[o + 3];
    out[o + 3] = 255;
  }
  return out;
}

/** Unpremultiply RGB-over-white using the upscaled alpha. */
export function combineStraight(rgbOverWhite, alpha, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const a = alpha[o] / 255;
    let r = 0;
    let g = 0;
    let b = 0;
    if (a > 0) {
      r = (rgbOverWhite[o] - 255 * (1 - a)) / a;
      g = (rgbOverWhite[o + 1] - 255 * (1 - a)) / a;
      b = (rgbOverWhite[o + 2] - 255 * (1 - a)) / a;
    }
    out[o] = Math.max(0, Math.min(255, Math.round(r)));
    out[o + 1] = Math.max(0, Math.min(255, Math.round(g)));
    out[o + 2] = Math.max(0, Math.min(255, Math.round(b)));
    out[o + 3] = Math.round(a * 255);
  }
  return out;
}

/**
 * Decode a possibly-transparent image and prepare it for an alpha-unaware
 * upscaler. Returns { hasAlpha, width, height, rgbBlob?, alphaData? }.
 * When hasAlpha, rgbBlob is the source composited over white and alphaData is
 * the straight alpha channel at the source resolution.
 */
export async function splitForUpscale(blob) {
  const bitmap = await createImageBitmap(blob);
  const w = bitmap.width;
  const h = bitmap.height;
  const srcCanvas = makeCanvas(w, h);
  const srcCtx = srcCanvas.getContext('2d');
  srcCtx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const src = srcCtx.getImageData(0, 0, w, h).data;
  if (!hasAlpha(src)) {
    return { hasAlpha: false, width: w, height: h };
  }
  const compCanvas = makeCanvas(w, h);
  compCanvas.getContext('2d')
    .putImageData(new ImageData(compositeOverWhite(src, w, h), w, h), 0, 0);
  const rgbBlob = await canvasToBlob(compCanvas, 'image/png');
  return { hasAlpha: true, width: w, height: h, rgbBlob, alphaData: extractAlpha(src, w, h) };
}

/**
 * Re-attach a LANCZOS-upscaled alpha channel to the engine's RGB result.
 * The engine result is decoded at its own resolution, so alpha is scaled to
 * match regardless of what the backend returned.
 */
export async function recombineAlpha(engineBlob, alphaData, alphaW, alphaH, mime, quality) {
  const bitmap = await createImageBitmap(engineBlob);
  const ew = bitmap.width;
  const eh = bitmap.height;
  const engineCanvas = makeCanvas(ew, eh);
  const engineCtx = engineCanvas.getContext('2d');
  engineCtx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const engineData = engineCtx.getImageData(0, 0, ew, eh).data;

  const alphaCanvas = makeCanvas(ew, eh);
  const aCtx = alphaCanvas.getContext('2d');
  aCtx.imageSmoothingEnabled = true;
  aCtx.imageSmoothingQuality = 'high';
  const srcAlpha = makeCanvas(alphaW, alphaH);
  srcAlpha.getContext('2d').putImageData(new ImageData(alphaData, alphaW, alphaH), 0, 0);
  aCtx.drawImage(srcAlpha, 0, 0, alphaW, alphaH, 0, 0, ew, eh);
  const alphaOut = aCtx.getImageData(0, 0, ew, eh).data;

  const outCanvas = makeCanvas(ew, eh);
  outCanvas.getContext('2d').putImageData(
    new ImageData(combineStraight(engineData, alphaOut, ew, eh), ew, eh),
    0,
    0,
  );
  return canvasToBlob(outCanvas, mime, quality);
}