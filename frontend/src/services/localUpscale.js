// On-device upscaling engine for the Image Upscaler tool.
//
// Two local modes:
//
//   * fast — pure client-side LANCZOS resize via canvas. Instant, private,
//     and free (nothing is uploaded).
//   * ai — Real-ESRGAN (realesr-general-x4v3) inference in the browser via
//     onnxruntime-web. The model (~4.8 MB) is downloaded once and cached in
//     CacheStorage; inference runs on WebGPU when available and falls back to
//     WASM (which benefits from SIMD + multi-thread when the deployment is
//     cross-origin-isolated).
//
// Everything runs locally: no image ever leaves the device.

import { hasAlpha, extractAlpha, compositeOverWhite, combineStraight } from './alphaPreserve';

// onnxruntime-web is imported dynamically (only when the on-device AI path is
// actually used) so the site-wide bundle doesn't grow by several MB.
const ORT_VERSION = '1.21.0';
const MODEL_CACHE = 'pixelboost-models-v1';

// Two verified public copies of the same export (NCHW, opset 17, official
// realesr-general-x4v3 weights). The second is a fallback if the first host
// is slow or unreachable.
const MODEL_URLS = [
  'https://huggingface.co/CoderViking/realesr-general-x4v3-onnx/resolve/main/realesr-general-x4v3.onnx',
  'https://huggingface.co/Heliosoph/realesrgan-onnx/resolve/main/realesr-general-x4v3.onnx',
];

const MODEL_SIZE_ESTIMATE_MB = 5;

// Small tiles keep peak memory sane on phones; output tiles are 4x this.
const TILE = 256;
const PAD = 16;
const NATIVE = 4;

let sessionPromise = null;
let didConfigure = false;

function configureOrt(ort) {
  if (didConfigure) return;
  didConfigure = true;
  // Serve the WASM binaries from the CDN matching the installed package so
  // Webpack never has to guess/hash them.
  ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
  ort.env.wasm.numThreads =
    typeof window !== 'undefined' && typeof window.crossOriginIsolated === 'boolean' && window.crossOriginIsolated
      ? Math.min(4, navigator.hardwareConcurrency || 2)
      : 1; // without COOP/COEP, SharedArrayBuffer is unavailable
}

/** True when WebGPU is likely usable (Chrome/Edge/Opera, secure context). */
export function canUseWebGpu() {
  return typeof navigator !== 'undefined' && !!navigator.gpu;
}

async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Model download failed (HTTP ${res.status}).`);
  if (!res.body) return res.arrayBuffer();
  const reader = res.body.getReader();
  const length = Number(res.headers.get('content-length')) || 0;
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.byteLength;
      if (length && onProgress) onProgress(Math.round((received / length) * 88));
    }
  }
  const buf = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  return buf.buffer;
}

async function getModelBuffer(onProgress) {
  if (!('caches' in window)) {
    return fetchWithProgress(MODEL_URLS[0], onProgress);
  }
  const cache = await caches.open(MODEL_CACHE);
  for (const url of MODEL_URLS) {
    const hit = await cache.match(url);
    if (hit && hit.ok) {
      const blob = await hit.blob();
      onProgress(90);
      return await blob.arrayBuffer();
    }
  }
  const buffer = await fetchWithProgress(MODEL_URLS[0], onProgress);
  try {
    await cache.put(MODEL_URLS[0], new Response(new Blob([buffer])));
  } catch {
    // caching is best-effort
  }
  return buffer;
}

const yieldToUi = () => new Promise((resolve) => setTimeout(resolve, 0));

// OffscreenCanvas keeps off-main-thread rendering nice, but older Safari /
// some webviews don't have it — fall back to a regular canvas for them.
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

/** Lazily build (and reuse) the ORT session. Returns { session, inputName, outputName }. */
function ensureSession(onProgress, onStage) {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const ortModule = await import('onnxruntime-web');
      const ort = ortModule.default || ortModule;
      configureOrt(ort);
      onStage('Downloading AI model (~5 MB, one time)…');
      const buffer = await getModelBuffer(onProgress);
      onStage('Running inference…');
      const providers = canUseWebGpu()
        ? ['webgpu', 'wasm']
        : ['wasm'];
      const session = await ort.InferenceSession.create(buffer, {
        executionProviders: providers,
        graphOptimizationLevel: 'all',
      });
      const inputName = session.inputNames[0];
      const outputName = session.outputNames[0];
      return { session, inputName, outputName, ort };
    })();
    // reset so a failed download can be retried
    sessionPromise.catch(() => { sessionPromise = null; });
  }
  return sessionPromise;
}

async function inferTiled(session, ort, im, inputName, outputName, onTileDone) {
  const { data, width: w, height: h } = im;

  // Native 4x output buffer.
  const outW = w * NATIVE;
  const outH = h * NATIVE;
  const outF = new Float32Array(outW * outH * 3);

  const tilesX = Math.max(1, Math.ceil(w / TILE));
  const tilesY = Math.max(1, Math.ceil(h / TILE));
  const total = tilesX * tilesY;
  let done = 0;

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const y0 = ty * TILE;
      const x0 = tx * TILE;
      const y1 = Math.min(y0 + TILE, h);
      const x1 = Math.min(x0 + TILE, w);

      const py0 = Math.max(0, y0 - PAD);
      const px0 = Math.max(0, x0 - PAD);
      const py1 = Math.min(h, y1 + PAD);
      const px1 = Math.min(w, x1 + PAD);
      const ph = py1 - py0;
      const pw = px1 - px0;

      // Build padded [1,3,ph,pw] input directly from the RGBA source.
      const patch = new Float32Array(1 * 3 * ph * pw);
      for (let y = py0; y < py1; y++) {
        const srcRow = y * w * 4 + px0 * 4;
        const dstRow = (y - py0) * pw * 3;
        for (let x = px0; x < px1; x++) {
          const s = srcRow + (x - px0) * 4;
          const d = dstRow + (x - px0) * 3;
          patch[d] = data[s] / 255;
          patch[d + 1] = data[s + 1] / 255;
          patch[d + 2] = data[s + 2] / 255;
        }
      }

      const tensor = new ort.Tensor('float32', patch, [1, 3, ph, pw]);
      const feeds = { [inputName]: tensor };
      const out = await session.run(feeds);
      const result = out[outputName].data; // Float32Array, [1,3,ph*4,pw*4]

      const cropTop = (y0 - py0) * NATIVE;
      const cropLeft = (x0 - px0) * NATIVE;
      const cropH = (y1 - y0) * NATIVE;
      const cropW = (x1 - x0) * NATIVE;
      const ow = ph * NATIVE;

      for (let y = 0; y < cropH; y++) {
        const sRow = ((cropTop + y) * ow + cropLeft) * 3;
        const dRow = ((y0 * NATIVE + y) * outW + x0 * NATIVE) * 3;
        for (let x = 0; x < cropW; x++) {
          const s = sRow + x * 3;
          const d = dRow + x * 3;
          outF[d] = result[s];
          outF[d + 1] = result[s + 1];
          outF[d + 2] = result[s + 2];
        }
      }

      done += 1;
      if (onTileDone) onTileDone((done / total) * 100);
      await yieldToUi();
    }
  }

  // Float output → RGBA ImageData for the caller to draw.
  const outIm = new ImageData(outW, outH);
  const outData = outIm.data;
  for (let i = 0; i < outW * outH; i++) {
    const o = i * 3;
    outData[i * 4] = Math.max(0, Math.min(255, outF[o] * 255));
    outData[i * 4 + 1] = Math.max(0, Math.min(255, outF[o + 1] * 255));
    outData[i * 4 + 2] = Math.max(0, Math.min(255, outF[o + 2] * 255));
    outData[i * 4 + 3] = 255;
  }
  return outIm;
}

/**
 * Local upscale.
 *
 * @param {Blob} blob input image file
 * @param {{ mode: 'fast'|'ai', scale: number, quality: number,
 *           format: {id:'png'|'jpg'|'webp', mime:string},
 *           onProgress:(pct:number, stage:string)=>void }} opts
 * @returns {Promise<Blob>} upscaled blob
 */
export async function runLocalUpscale(blob, { mode, scale, quality, format, onProgress }) {
  const bitmap = await createImageBitmap(blob);
  const { width: srcW, height: srcH } = bitmap;
  const targetW = Math.round(srcW * scale);
  const targetH = Math.round(srcH * scale);

  let fullW = targetW;
  let fullH = targetH;
  let aiIm = null;
  let aiInput = null;
  let aiAlpha = null;

  if (mode === 'ai') {
    const { session, inputName, outputName, ort } = await ensureSession(
      (p) => onProgress(p * 0.9, 'Downloading AI model…'),
      () => {},
    );
    onProgress(1, 'Preparing image…');
    await yieldToUi();
    const srcCanvas = makeCanvas(srcW, srcH);
    const srcCtx = srcCanvas.getContext('2d');
    srcCtx.drawImage(bitmap, 0, 0);
    const im = srcCtx.getImageData(0, 0, srcW, srcH);
    // Real-ESRGAN can't see alpha, so a transparent PNG would come back with a
    // black background. Composite over white for the model, keep the alpha
    // channel, and re-attach it after inference.
    aiInput = im;
    if (hasAlpha(im.data)) {
      aiAlpha = extractAlpha(im.data, srcW, srcH);
      aiInput = new ImageData(compositeOverWhite(im.data, srcW, srcH), srcW, srcH);
    }
    onProgress(2, 'Running AI inference…');
    aiIm = await inferTiled(session, ort, aiInput, inputName, outputName, (p) =>
      onProgress(Math.min(90, 2 + p * 0.88), 'Running AI inference…'),
    );
    fullW = aiIm.width;
    fullH = aiIm.height;
  }

  // Render final image at the requested scale (LANCZOS for fast / downscales,
  // and for upscaling an AI 4x result to 6x/8x).
  const outCanvas = makeCanvas(targetW, targetH);
  const ctx = outCanvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (aiIm) {
    const tmp = makeCanvas(fullW, fullH);
    const tmpCtx = tmp.getContext('2d');
    tmpCtx.putImageData(aiIm, 0, 0);
    ctx.drawImage(tmp, 0, 0, fullW, fullH, 0, 0, targetW, targetH);
  } else {
    ctx.drawImage(bitmap, 0, 0, srcW, srcH, 0, 0, targetW, targetH);
  }
  bitmap.close?.();

  // Re-attach the upscaled alpha channel so transparent PNGs stay transparent.
  if (aiAlpha && format.id !== 'jpg') {
    const alphaCanvas = makeCanvas(targetW, targetH);
    const aCtx = alphaCanvas.getContext('2d');
    aCtx.imageSmoothingEnabled = true;
    aCtx.imageSmoothingQuality = 'high';
    const alphaSrc = makeCanvas(srcW, srcH);
    alphaSrc.getContext('2d').putImageData(new ImageData(aiAlpha, srcW, srcH), 0, 0);
    aCtx.drawImage(alphaSrc, 0, 0, srcW, srcH, 0, 0, targetW, targetH);
    const alphaOut = aCtx.getImageData(0, 0, targetW, targetH).data;
    const rgbData = ctx.getImageData(0, 0, targetW, targetH).data;
    ctx.putImageData(
      new ImageData(combineStraight(rgbData, alphaOut, targetW, targetH), targetW, targetH),
      0,
      0,
    );
  }

  onProgress(95, 'Encoding…');
  let qualityArg;
  if (format.id === 'png') qualityArg = undefined;
  else if (format.id === 'jpg') qualityArg = Math.max(0.5, Math.min(1, quality / 100));
  else qualityArg = Math.max(0.4, Math.min(1, quality / 100));

  return canvasToBlob(outCanvas, format.mime, qualityArg);
}

/** True when we have already downloaded/cached the model. */
export async function isModelCached() {
  try {
    if (!('caches' in window)) return false;
    const cache = await caches.open(MODEL_CACHE);
    for (const url of MODEL_URLS) {
      if (await cache.match(url)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function modelSizeEstimateMB() {
  return MODEL_SIZE_ESTIMATE_MB;
}