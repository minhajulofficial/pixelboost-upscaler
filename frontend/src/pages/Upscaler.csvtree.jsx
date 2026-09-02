// AI image upscaler tool tuned for microstock contributors.
//
// Two engines, selected per-request:
//
//   * Server (backed by the shared PixelBoost service):
//       - Fast        — Pillow LANCZOS on the backend (~50 ms).
//       - AI Fast     — Real-ESRGAN realesr-general-x4v3 (HF Space worker).
//       - AI Plus     — RealESRGAN_x4plus (best quality, slower).
//       - Anime       — RealESRGAN_x4plus_anime_6B (illustrations).
//     All server modes use the async job API (POST /jobs/upscale-ai with the
//     chosen mode → poll → result). Fast rides the same reliable queue as the
//     AI modes instead of the old blocking /upscale call. Scales 2/3/4/6/8.
//     Requests go through the same-origin Vercel proxy (/api/upscale-proxy)
//     which injects the shared abuse-protection token server-side so the
//     token never ships to the browser.
//
//   * Your PC (fully on-device — nothing is uploaded):
//       - Fast        — pure client-side LANCZOS via canvas. Instant.
//       - AI         — Real-ESRGAN x4v3 via onnxruntime-web. WebGPU when
//                       available, else WASM. Model (~5 MB) cached once.
//
// The engine choice is remembered. A banner shows when the AI model needs a
// one-time download; the WebGPU capability is surfaced so users know which
// device path they're on. Both compute paths support PNG / JPEG / WebP.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Upload, ZoomIn, X, Download, Loader2,
  Image as ImageIcon, Sparkles, Sliders, FileImage,
  Trash2, StopCircle, Plus, Zap, Wand2, Package,
  Server, Cpu, Palette, Globe, HardDrive, Shield, Eye,
} from 'lucide-react';
import Topbar from '../components/Topbar';
import ToolNav from '../components/ToolNav';
import Footer from '../components/Footer';
import SiteMeta from '../components/SiteMeta';
import { getToolSeo } from '../data/toolSeo';
import { useToast } from '../contexts/ToastContext';
import { useSiteSettings } from '../contexts/SettingsContext';
import { getToolUploadLimit } from '../services/userService';
import { useToolGate } from '../hooks/useToolGate';
import useEscapeKey from '../hooks/useEscapeKey';
import ToolGateBanner, { CreditCostBadge } from '../components/ToolGateBanner';
import AuthModal from '../components/AuthModal';
import { runLocalUpscale, canUseWebGpu, isModelCached, modelSizeEstimateMB } from '../services/localUpscale';
import { splitForUpscale, recombineAlpha } from '../services/alphaPreserve';

// PixelBoost backend (used directly when DIRECT_MODE, or as the proxy's
// fallback). Override via env for staging / self-hosted.
const API_BASE = (process.env.REACT_APP_PIXELBOOST_API_URL || 'https://pixelboost-backend-q659.onrender.com').replace(/\/+$/, '');
// When REACT_APP_PIXELBOOST_API_URL is set, the deploy is self-hosted and
// should talk to the backend directly (optionally with a token). Otherwise we
// use the same-origin Vercel proxy which injects the shared token server-side.
const DIRECT_MODE = !!process.env.REACT_APP_PIXELBOOST_API_URL;
const DIRECT_TOKEN = process.env.REACT_APP_PIXELBOOST_TOKEN || '';
const PROXY_BASE = typeof window !== 'undefined' ? `${window.location.origin}/api/upscale-proxy` : '';

const ENGINE_SERVER = 'server';
const ENGINE_LOCAL = 'local';

const SERVER_MODES = [
  { id: 'fast', label: 'Fast', blurb: 'Pillow LANCZOS · ~50 ms', Icon: Zap },
  { id: 'ai-fast', label: 'AI Fast', blurb: 'x4v3 · detail · ~15–60 s', Icon: Wand2 },
  { id: 'ai-plus', label: 'AI Plus', blurb: 'x4plus · best quality · 1–5 min', Icon: Sparkles },
  { id: 'anime', label: 'Anime', blurb: 'illustrations & line art', Icon: Palette },
];

const LOCAL_MODES = [
  { id: 'fast', label: 'Fast', blurb: 'Browser LANCZOS · instant', Icon: Zap },
  { id: 'ai', label: 'AI', blurb: 'Real-ESRGAN · private', Icon: Wand2 },
];

const SCALE_OPTIONS = [
  { id: 2, label: '2×', blurb: 'Double' },
  { id: 3, label: '3×', blurb: 'Triple' },
  { id: 4, label: '4×', blurb: 'Quad' },
  { id: 6, label: '6×', blurb: 'Six' },
  { id: 8, label: '8×', blurb: 'Eight' },
];
const FALLBACK_SCALE_IDS = [2, 3, 4, 6, 8];

const FORMAT_OPTIONS = [
  { id: 'png',  label: 'PNG',  ext: 'png',  mime: 'image/png',  blurb: 'Lossless', backendFormat: 'png', clientEncode: false },
  { id: 'jpg',  label: 'JPEG', ext: 'jpg',  mime: 'image/jpeg', blurb: 'Smaller',   backendFormat: 'jpg', clientEncode: false },
  { id: 'webp', label: 'WebP', ext: 'webp', mime: 'image/webp', blurb: 'Modern',    backendFormat: 'png', clientEncode: true  },
];

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ENGINE_STORAGE = 'csvtree_upscaler_engine';
const MODE_STORAGE = 'csvtree_upscaler_mode';
const SCALE_STORAGE = 'csvtree_upscaler_scale';
const FORMAT_STORAGE = 'csvtree_upscaler_format';
const QUALITY_STORAGE = 'csvtree_upscaler_quality';

const AI_POLL_INTERVAL_MS = 2000;
const AI_POLL_TIMEOUT_MS = 30 * 60 * 1000;

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

// Read {width, height} of an <img> from any object URL / src.
function readImageDims(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = src;
  });
}

async function readErrorDetail(res) {
  try {
    const data = await res.json();
    if (data?.detail) return typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail);
    if (data?.error)  return typeof data.error  === 'string' ? data.error  : JSON.stringify(data.error);
  } catch {
    try {
      const text = await res.text();
      if (text) return text;
    } catch { /* */ }
  }
  return `${res.status} ${res.statusText}`.trim();
}

async function fetchViaProxy(path, { method = 'POST', body, signal, headers = {} } = {}) {
  // Self-hosted / staging deploy → straight to the configured backend.
  if (DIRECT_MODE) {
    const directHeaders = { ...headers };
    if (DIRECT_TOKEN) directHeaders['X-PixelBoost-Token'] = DIRECT_TOKEN;
    const directRes = await fetch(`${API_BASE}${path}`, { method, headers: directHeaders, body, signal });
    return directRes;
  }
  // Prefer the same-origin proxy which injects the shared token server-side.
  if (PROXY_BASE) {
    try {
      const res = await fetch(`${PROXY_BASE}?${method === 'GET' ? path.split('?')[1] || '' : ''}`, {
        method,
        headers: { ...headers, 'X-Proxy-Path': path.split('?')[0] },
        body: method === 'POST' ? body : undefined,
        signal,
      });
      if (res.ok || res.status === 401 || res.status === 403) return res;
      // 404 = unknown route / proxy not deployed → fall back to direct.
      if (res.status !== 404) return res;
    } catch {
      // Proxy unreachable → fall back to direct.
    }
  }
  const directRes = await fetch(`${API_BASE}${path}`, { method, headers, body, signal });
  return directRes;
}

async function runServerUpscale({ file, scale, fmt, quality, mode, signal, onProgress }) {
  // Fast (Pillow LANCZOS) and the AI modes are all served by the backend's
  // async job pipeline. We route Fast through /jobs/upscale-ai (with mode=
  // 'fast') instead of the old synchronous /upscale call so it rides the same
  // reliable queue the AI modes use and never hits the proxy's 60s blocking
  // timeout. Verified live: a mode='fast' job submits, runs and returns a
  // result just like the AI modes.
  onProgress(5, mode === 'fast' ? 'Uploading…' : 'Submitting…');
  const body = new FormData();
  body.append('file', file, file.name);
  body.append('scale', String(scale));
  body.append('format', fmt.backendFormat || fmt.id);
  body.append('quality', String(quality));
  body.append('mode', mode);
  const submit = await fetchViaProxy('/jobs/upscale-ai', { method: 'POST', body, signal });
  if (!submit.ok) throw new Error(await readErrorDetail(submit));
  const submitData = await submit.json();
  const jobId = submitData?.id;
  if (!jobId) throw new Error('Backend did not return a job id.');

  const startedAt = Date.now();
  let lastBackendProgress = 0;
  while (true) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (Date.now() - startedAt > AI_POLL_TIMEOUT_MS) {
      throw new Error('This job is taking longer than 30 minutes and will not complete. Try a smaller image.');
    }
    await sleep(AI_POLL_INTERVAL_MS, signal);
    const statusRes = await fetchViaProxy(`/jobs/${jobId}`, {
      method: 'GET',
      signal,
      headers: { Accept: 'application/json' },
    });
    if (!statusRes.ok) {
      if (statusRes.status === 404) throw new Error('Job not found on the server (it may have expired).');
      throw new Error(await readErrorDetail(statusRes));
    }
    const status = await statusRes.json();
    if (status.status === 'error') throw new Error(status.error || 'Upscale job failed.');
    const backendPct = Math.round(Math.max(0, Math.min(1, status.progress || 0)) * 100);
    if (backendPct > lastBackendProgress) lastBackendProgress = backendPct;
    let stage = mode === 'fast' ? 'Worker is queued…' : 'AI worker is queued…';
    if (status.status === 'running') stage = mode === 'fast' ? 'Upscaling…' : 'AI running…';
    if (status.status === 'done') stage = 'Finalising…';
    const synthetic = Math.min(90, 10 + Math.floor((Date.now() - startedAt) / 1000));
    onProgress(Math.max(synthetic, lastBackendProgress), stage);
    if (status.status === 'done') {
      const resultRes = await fetchViaProxy(`/jobs/${jobId}/result`, { method: 'GET', signal });
      if (!resultRes.ok) throw new Error(await readErrorDetail(resultRes));
      onProgress(95, 'Decoding…');
      return resultRes.blob();
    }
  }
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image.'));
    img.src = src;
  });
}

async function transcodeToWebp(blob, qualityPct) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImageElement(url);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const q = Math.max(0.4, Math.min(1, qualityPct / 100));
    return await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode WebP.'))), 'image/webp', q);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function statusBadge(status) {
  switch (status) {
    case 'queued':     return { text: 'Queued',    cls: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' };
    case 'processing': return { text: 'Working',   cls: 'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300' };
    case 'done':       return { text: 'Done',      cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' };
    case 'failed':     return { text: 'Failed',    cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' };
    case 'cancelled':  return { text: 'Cancelled', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' };
    default:           return { text: status,      cls: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' };
  }
}

// Full-screen before/after preview — mirrors the main PixelBoost site's modal.
// Original + upscaled side by side with dimensions and file sizes.
function BeforeAfterPreview({ item, fmtExt, onClose }) {
  useEscapeKey(onClose);
  if (typeof document === 'undefined') return null;

  const dims = (d) => (d && d.width ? `${d.width} × ${d.height}` : '');
  return createPortal(
    <div
      className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-3 sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Before / after preview"
    >
      <div
        className="relative w-full max-w-6xl max-h-full overflow-y-auto rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl modal-content"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 rounded-full bg-gray-100 dark:bg-gray-800 p-2 text-gray-600 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          aria-label="Close preview"
        >
          <X size={18} />
        </button>
        <div className="border-b border-gray-200 dark:border-gray-800 px-5 py-4 pr-14">
          <h3 className="truncate text-base font-bold text-gray-900 dark:text-white">{item.file?.name || 'Image'}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {item.resultExt || fmtExt} · tap or click outside to dismiss
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2 md:p-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">
              <span className="font-bold text-gray-700 dark:text-gray-200">Original</span>
              <span>{dims(item.origDims)}</span>
            </div>
            <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 flex items-center justify-center min-h-[160px]">
              {item.originalUrl
                ? <img src={item.originalUrl} alt="Original" className="h-auto w-full" />
                : <ImageIcon size={28} className="text-gray-400" />}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">{formatBytes(item.file?.size)}</p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">
              <span className="font-bold text-pink-600 dark:text-pink-300">Upscaled</span>
              <span>{dims(item.resultDims)}</span>
            </div>
            <div className="overflow-hidden rounded-xl border border-pink-300 dark:border-pink-800/60 bg-gray-100 dark:bg-gray-800 flex items-center justify-center min-h-[160px] shadow-lg shadow-pink-500/10">
              {item.resultUrl
                ? <img src={item.resultUrl} alt="Upscaled" className="h-auto w-full" />
                : <div className="flex items-center text-gray-500">No result</div>}
            </div>
            <p className="text-xs text-green-600 dark:text-green-400">
              {item.resultSize ? formatBytes(item.resultSize) : ''}
            </p>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function loadSetting(key, fallback, validator) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = (() => { try { return JSON.parse(raw); } catch { return raw; } })();
    return validator(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export default function ToolUpscaler() {
  const toast = useToast();
  const { settings: siteSettings } = useSiteSettings();
  const maxBatchFiles = getToolUploadLimit(siteSettings, 'upscaler');
  const hasBatchCap = Number.isFinite(maxBatchFiles);
  const gate = useToolGate('upscaler');
  const fileInputRef = useRef();
  const abortRef = useRef(null);

  const [showAuth, setShowAuth] = useState(false);
  const [items, setItems] = useState([]);
  const [engine, setEngine] = useState(() => loadSetting(ENGINE_STORAGE, ENGINE_SERVER,
    (v) => v === ENGINE_SERVER || v === ENGINE_LOCAL));
  const [mode, setMode] = useState(() => loadSetting(MODE_STORAGE, 'fast', () => true));
  const [scale, setScale] = useState(() => loadSetting(SCALE_STORAGE, 2,
    (v) => SCALE_OPTIONS.some((s) => s.id === v)));
  const [availableScaleIds, setAvailableScaleIds] = useState(FALLBACK_SCALE_IDS);
  const [format, setFormat] = useState(() => loadSetting(FORMAT_STORAGE, 'png',
    (v) => FORMAT_OPTIONS.some((f) => f.id === v)));
  const [quality, setQuality] = useState(() => loadSetting(QUALITY_STORAGE, 92,
    (v) => Number.isInteger(v) && v >= 50 && v <= 100));
  const [processing, setProcessing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [webgpu, setWebgpu] = useState(null); // null=unknown, true/false
  const [modelCached, setModelCached] = useState(false);
  const [previewId, setPreviewId] = useState(null);

  useEffect(() => { try { localStorage.setItem(ENGINE_STORAGE, engine); } catch { /* */ } }, [engine]);
  useEffect(() => { try { localStorage.setItem(MODE_STORAGE, mode); } catch { /* */ } }, [mode]);
  useEffect(() => { try { localStorage.setItem(SCALE_STORAGE, String(scale)); } catch { /* */ } }, [scale]);
  useEffect(() => { try { localStorage.setItem(FORMAT_STORAGE, format); } catch { /* */ } }, [format]);
  useEffect(() => { try { localStorage.setItem(QUALITY_STORAGE, String(quality)); } catch { /* */ } }, [quality]);

  // Detect WebGPU + model cache (for the "Your PC · AI" path).
  useEffect(() => {
    setWebgpu(canUseWebGpu());
    let alive = true;
    isModelCached().then((cached) => { if (alive) setModelCached(cached); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // Probe the server backend for the scales it accepts.
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetchViaProxy('/', { method: 'GET', signal: controller.signal, headers: { Accept: 'application/json' } });
        if (!res.ok) return;
        const data = await res.json();
        const raw = Array.isArray(data?.scales) ? data.scales : [];
        const supported = raw
          .map((n) => Number(n))
          .filter((n) => SCALE_OPTIONS.some((opt) => opt.id === n))
          .sort((a, b) => a - b);
        if (!active || supported.length === 0) return;
        setAvailableScaleIds(supported);
        setScale((curr) => {
          if (supported.includes(curr)) return curr;
          const lower = supported.filter((s) => s <= curr);
          return lower.length ? lower[lower.length - 1] : supported[0];
        });
      } catch {
        // Network error / aborted — keep the fallback.
      }
    })();
    return () => { active = false; controller.abort(); };
  }, []);

  useEffect(() => () => {
    setItems((curr) => {
      curr.forEach((it) => {
        if (it.originalUrl) URL.revokeObjectURL(it.originalUrl);
        if (it.resultUrl)   URL.revokeObjectURL(it.resultUrl);
      });
      return [];
    });
  }, []);

  const queueCount  = useMemo(() => items.filter((i) => i.status === 'queued').length, [items]);
  const doneCount   = useMemo(() => items.filter((i) => i.status === 'done').length, [items]);
  const failedCount = useMemo(() => items.filter((i) => i.status === 'failed').length, [items]);
  const fmtChoice   = useMemo(() => FORMAT_OPTIONS.find((f) => f.id === format) || FORMAT_OPTIONS[0], [format]);

  const activeModes = useMemo(() => (engine === ENGINE_LOCAL ? LOCAL_MODES : SERVER_MODES), [engine]);
  // If the persisted mode isn't valid for the current engine, snap to the first.
  useEffect(() => {
    if (!activeModes.some((m) => m.id === mode)) setMode(activeModes[0].id);
  }, [activeModes, mode]);
  const modeChoice = useMemo(() => activeModes.find((m) => m.id === mode) || activeModes[0], [activeModes, mode]);

  const updateItem = useCallback((id, patch) => {
    setItems((curr) => curr.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const addFiles = useCallback((rawFiles) => {
    const valid = [];
    for (const f of rawFiles) {
      if (!f.type.startsWith('image/')) continue;
      if (f.size > MAX_FILE_BYTES) {
        toast.error(`${f.name}: file too large (max ${formatBytes(MAX_FILE_BYTES)}).`);
        continue;
      }
      valid.push(f);
    }
    setItems((curr) => {
      let accepted;
      if (!hasBatchCap) {
        accepted = valid;
      } else {
        const remaining = maxBatchFiles - curr.length;
        if (remaining <= 0) {
          toast.error(`Queue full (max ${maxBatchFiles}). Remove a file first.`);
          return curr;
        }
        accepted = valid.slice(0, remaining);
        if (valid.length > accepted.length) {
          toast.error(`Only ${accepted.length} of ${valid.length} files added (queue limit ${maxBatchFiles}).`);
        }
      }
      const next = accepted.map((file) => ({
        id: uid(),
        file,
        originalUrl: URL.createObjectURL(file),
        status: 'queued',
        progress: 0,
        stage: '',
        resultUrl: null,
        resultSize: null,
        resultExt: '',
        origDims: null,
        resultDims: null,
        error: '',
      }));
      return [...curr, ...next];
    });
    // Read original dimensions asynchronously (for the preview header).
    valid.slice(0, hasBatchCap ? maxBatchFiles : valid.length).forEach((file) => {
      const url = URL.createObjectURL(file);
      readImageDims(url).then((dims) => {
        URL.revokeObjectURL(url);
        if (!dims.width) return;
        setItems((curr) => curr.map((it) => (it.file === file ? { ...it, origDims: dims } : it)));
      }).catch(() => URL.revokeObjectURL(url));
    });
  }, [toast, hasBatchCap, maxBatchFiles]);

  function onFileChange(e) {
    const files = Array.from(e.target.files || []);
    if (files.length) addFiles(files);
    e.target.value = '';
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) addFiles(files);
  }

  function removeItem(id) {
    setItems((curr) => curr.filter((it) => {
      if (it.id !== id) return true;
      if (it.originalUrl) URL.revokeObjectURL(it.originalUrl);
      if (it.resultUrl)   URL.revokeObjectURL(it.resultUrl);
      return false;
    }));
  }

  function clearAll() {
    if (processing) return;
    setItems((curr) => {
      curr.forEach((it) => {
        if (it.originalUrl) URL.revokeObjectURL(it.originalUrl);
        if (it.resultUrl)   URL.revokeObjectURL(it.resultUrl);
      });
      return [];
    });
  }

  async function runOne(item, signal) {
    const onProgress = (pct, stage) => updateItem(item.id, { progress: pct, stage });
    let blob;
    let split = null;
    if (engine === ENGINE_LOCAL) {
      updateItem(item.id, { status: 'processing', progress: 0, stage: 'Starting…', error: '' });
      blob = await runLocalUpscale(item.file, {
        mode,
        scale,
        quality,
        format: fmtChoice,
        onProgress,
      });
    } else {
      // Server engines (Pillow LANCZOS / Real-ESRGAN) can't see the alpha
      // channel, so a transparent PNG would come back with a black background.
      // Composite over white, upscale that, then re-attach the alpha channel
      // client-side so transparent PNGs stay "same to same".
      split = await splitForUpscale(item.file);
      const sendFile = split.hasAlpha ? split.rgbBlob : item.file;
      if (split.hasAlpha) onProgress(12, 'Preparing transparency…');
      blob = await runServerUpscale({
        file: sendFile,
        scale,
        fmt: fmtChoice,
        quality,
        mode,
        signal,
        onProgress,
      });
      if (split.hasAlpha && (fmtChoice.id === 'png' || fmtChoice.id === 'webp')) {
        onProgress(93, 'Restoring transparency…');
        blob = await recombineAlpha(
          blob,
          split.alphaData,
          split.width,
          split.height,
          fmtChoice.id === 'webp' ? 'image/webp' : 'image/png',
          fmtChoice.id === 'webp' ? Math.max(0.4, Math.min(1, quality / 100)) : undefined,
        );
      }
    }
    if (engine === ENGINE_SERVER && fmtChoice.clientEncode && fmtChoice.id === 'webp' && !split?.hasAlpha) {
      onProgress(97, 'Encoding WebP…');
      blob = await transcodeToWebp(blob, quality);
    }
    return blob;
  }

  async function runQueue() {
    if (processing) return;
    const queued = items.filter((it) => it.status === 'queued');
    if (!queued.length) {
      toast.error('Queue is empty. Drop some images first.');
      return;
    }
    const pre = gate.preflight();
    if (!pre.allowed) {
      if (pre.reason === 'sign-in-required') setShowAuth(true);
      else toast.error("You can't run the Upscaler right now. See the banner above for details.");
      return;
    }

    setProcessing(true);
    abortRef.current = new AbortController();
    try {
      for (const item of queued) {
        if (abortRef.current?.signal.aborted) {
          updateItem(item.id, { status: 'cancelled', stage: '' });
          continue;
        }
        const itemPre = gate.preflight();
        if (!itemPre.allowed) {
          updateItem(item.id, {
            status: 'failed',
            error: itemPre.reason === 'out-of-credits'
              ? `Out of credits — need ${itemPre.cost}, have ${gate.credits}.`
              : 'Locked. Please review the banner above.',
            stage: '', progress: 0,
          });
          continue;
        }
        updateItem(item.id, { status: 'processing', progress: 0, stage: 'Starting…', error: '' });
        try {
          const blob = await runOne(item, abortRef.current.signal);
          const url = URL.createObjectURL(blob);
          updateItem(item.id, {
            status: 'done',
            progress: 100,
            stage: 'Done.',
            resultUrl: url,
            resultSize: blob.size,
            resultExt: fmtChoice.ext,
          });
          readImageDims(url).then((dims) => {
            if (dims.width) updateItem(item.id, { resultDims: dims });
          }).catch(() => {});
          // On-device runs consume no server resources → no credit charge.
          if (engine === ENGINE_SERVER) {
            gate.charge({ mode, scale, format: fmtChoice.id }).catch(() => {});
          }
        } catch (err) {
          if (err?.name === 'AbortError' || err?.message === 'Aborted') {
            updateItem(item.id, { status: 'cancelled', stage: '', progress: 0 });
          } else {
            updateItem(item.id, {
              status: 'failed',
              error: err?.message || 'Upscale failed.',
              stage: '',
              progress: 0,
            });
            toast.error(`${item.file.name}: ${err?.message || 'failed'}`);
          }
        }
      }
    } finally {
      setProcessing(false);
      abortRef.current = null;
    }
  }

  function cancelQueue() {
    abortRef.current?.abort();
    setItems((curr) => curr.map((it) => (
      it.status === 'queued' ? { ...it, status: 'cancelled' } : it
    )));
  }

  function downloadItem(item) {
    if (!item.resultUrl) return;
    const a = document.createElement('a');
    a.href = item.resultUrl;
    const baseName = (item.file?.name || 'image').replace(/\.[^.]+$/, '');
    a.download = `${baseName}-${scale}x.${item.resultExt || fmtChoice.ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function downloadAllZip() {
    const ready = items.filter((it) => it.status === 'done' && it.resultUrl);
    if (!ready.length) {
      toast.error('No upscaled images yet.');
      return;
    }
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      for (const it of ready) {
        // eslint-disable-next-line no-await-in-loop
        const blob = await fetch(it.resultUrl).then((r) => r.blob());
        const baseName = (it.file?.name || 'image').replace(/\.[^.]+$/, '');
        zip.file(`${baseName}-${scale}x.${it.resultExt || fmtChoice.ext}`, blob);
      }
      const archive = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(archive);
      const a = document.createElement('a');
      a.href = url;
      a.download = `upscaled-${scale}x-${ready.length}-images.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (err) {
      toast.error(err?.message || 'Could not build ZIP.');
    }
  }

  function switchEngine(next) {
    setEngine(next);
  }

  const localAiSelected = engine === ENGINE_LOCAL && mode === 'ai';
  const serverAI = engine === ENGINE_SERVER && mode !== 'fast';
  const aiUpscaleNote = serverAI
    ? 'Server modes run on free CPU workers; first run after idle adds ~30 s wake-up. AI Plus is best quality but slower.'
    : localAiSelected
      ? `Runs entirely on this device. Model (~${modelSizeEstimateMB()} MB) downloads once; ${webgpu ? 'WebGPU detected — fast path.' : 'WebGPU not detected — using WASM (slower).'}`
      : '';

  const engineNote = engine === ENGINE_SERVER
    ? 'Images are sent to the PixelBoost server for processing. Best for huge or 8× upscales.'
    : 'Everything runs in your browser — nothing is uploaded. Best for privacy and free unlimited use.';

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-[#0a1a0f] text-gray-900 dark:text-gray-100 transition-colors">
      <SiteMeta {...(getToolSeo('upscaler') || {})} />
      <ToolNav />
      <Topbar hideSidebarToggle withToolNav onToggleSidebar={() => {}} />

      <main className="flex-1 pt-[56px] lg:pl-[var(--toolnav-w,220px)]">
        <div className="max-w-[1100px] mx-auto px-3 md:px-5 py-6">
          <Link to="/tools/generator" className="inline-flex items-center gap-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-xs mb-4 transition-colors">
            <ArrowLeft size={14} /> Back to Generator
          </Link>

          <header className="flex items-start gap-4 mb-6 animate-slide-up">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-pink-400 to-fuchsia-600 text-white flex items-center justify-center shadow-lg shrink-0">
              <ZoomIn size={22} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl md:text-3xl font-bold">Image Upscaler</h1>
                {engine === ENGINE_SERVER
                  ? <CreditCostBadge cost={gate.cost} />
                  : <span className="text-[10px] font-bold uppercase tracking-wider text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/30 px-2 py-1 rounded-md">Free · runs on your PC</span>}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-3xl leading-relaxed">
                Enlarge photos 2× to 8×. Up to four server AI tiers (Real-ESRGAN) or fully-private on-device upscaling (WebGPU/WASM) — your choice.
              </p>
            </div>
          </header>

          <ToolGateBanner gate={gate} toolLabel="Image Upscaler" onSignIn={() => setShowAuth(true)} />

          {engine === ENGINE_LOCAL && localAiSelected && !modelCached && (
            <div className="mb-4 rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-900/20 p-3 flex items-start gap-3">
              <HardDrive size={16} className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-snug">
                <strong>On-device AI:</strong> the Real-ESRGAN model (~{modelSizeEstimateMB()} MB) will be downloaded once on first run, then cached. Your images never leave this device.
                {webgpu === false && ' Your browser lacks WebGPU, so inference uses the slower WASM backend — consider Server mode for large images.'}
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-5">
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-4 md:p-5">
              {items.length === 0 ? (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                  className={`w-full min-h-[260px] md:min-h-[360px] rounded-xl border-2 border-dashed flex flex-col items-center justify-center text-center px-4 transition-colors ${
                    dragOver
                      ? 'border-pink-500 bg-pink-50 dark:bg-pink-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:border-pink-400 dark:hover:border-pink-500 hover:bg-gray-50 dark:hover:bg-gray-800/40'
                  }`}
                >
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-pink-400 to-fuchsia-600 text-white flex items-center justify-center mb-3 shadow-md">
                    <Upload size={20} />
                  </div>
                  <p className="text-sm font-bold mb-1">Drop images here or click to browse</p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 max-w-md">
                    PNG, JPG, or WebP · up to {formatBytes(MAX_FILE_BYTES)} each{hasBatchCap ? ` · ${maxBatchFiles} images per batch` : ''}
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={onFileChange}
                    className="hidden"
                  />
                </button>
              ) : (
                <div>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <p className="text-xs font-bold">
                      Queue · {items.length} {items.length === 1 ? 'image' : 'images'}
                      <span className="text-gray-500 dark:text-gray-400 font-normal ml-2">
                        ({doneCount} done{failedCount ? `, ${failedCount} failed` : ''}{queueCount ? `, ${queueCount} pending` : ''})
                      </span>
                    </p>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={processing || (hasBatchCap && items.length >= maxBatchFiles)}
                        className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        <Plus size={11} /> Add
                      </button>
                      <button
                        onClick={clearAll}
                        disabled={processing}
                        className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        <Trash2 size={11} /> Clear
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={onFileChange}
                        className="hidden"
                      />
                    </div>
                  </div>

                  <div className="space-y-2 stagger-children">
                    {items.map((item) => {
                      const badge = statusBadge(item.status);
                      return (
                        <div
                            key={item.id}
                            onClick={() => { if (item.status === 'done' && item.resultUrl) setPreviewId(item.id); }}
                            className={`flex items-stretch gap-3 p-2 rounded-xl border border-gray-100 dark:border-gray-800 ${
                              item.status === 'done' && item.resultUrl
                                ? 'cursor-pointer hover:border-pink-300 dark:hover:border-pink-700 hover:shadow-sm transition-all'
                                : 'hover:border-gray-200 dark:hover:border-gray-700'
                            } transition-colors`}
                            title={item.status === 'done' && item.resultUrl ? 'Click to preview before / after' : undefined}
                          >
                            <div className="relative w-14 h-14 shrink-0 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                              {(item.resultUrl || item.originalUrl)
                                ? <img src={item.resultUrl || item.originalUrl} alt={item.file.name} className="w-full h-full object-cover" />
                                : <ImageIcon size={18} className="text-gray-400" />}
                              {item.status === 'done' && item.resultUrl && (
                                <span className="absolute inset-0 grid place-items-center bg-black/30 opacity-0 hover:opacity-100 transition-opacity">
                                  <ZoomIn size={16} className="text-white" />
                                </span>
                              )}
                            </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-medium truncate" title={item.file.name}>{item.file.name}</p>
                              <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider shrink-0 ${badge.cls}`}>
                                {badge.text}
                              </span>
                            </div>
                            <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                              {formatBytes(item.file.size)}
                              {item.resultSize && (
                                <span className="text-pink-600 dark:text-pink-300 font-medium">
                                  {' · '}upscaled {formatBytes(item.resultSize)}
                                </span>
                              )}
                            </p>
                            {item.status === 'processing' && (
                              <div className="mt-1.5">
                                <div className="flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">
                                  <span className="flex items-center gap-1">
                                    <Loader2 size={10} className="animate-spin" /> {item.stage}
                                  </span>
                                  <span>{item.progress}%</span>
                                </div>
                                <div className="h-1 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                                  <div className="h-full bg-gradient-to-r from-pink-400 to-fuchsia-500 transition-all" style={{ width: `${item.progress}%` }} />
                                </div>
                              </div>
                            )}
                            {item.error && (
                              <p className="mt-1 text-[10px] text-red-600 dark:text-red-400 line-clamp-2">{item.error}</p>
                            )}
                          </div>
                          <div className="flex flex-col items-end justify-center gap-1 shrink-0">
                            {item.status === 'done' && item.resultUrl && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setPreviewId(item.id); }}
                                className="px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 hover:bg-pink-50 dark:hover:bg-pink-900/20 transition-colors flex items-center gap-1"
                                title="Preview before / after"
                              >
                                <Eye size={11} />
                              </button>
                            )}
                            {item.resultUrl && (
                              <button
                                onClick={(e) => { e.stopPropagation(); downloadItem(item); }}
                                className="px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider text-pink-600 dark:text-pink-300 hover:bg-pink-50 dark:hover:bg-pink-900/20 transition-colors flex items-center gap-1"
                                title={`Download as ${(item.resultExt || fmtChoice.ext).toUpperCase()}`}
                              >
                                <Download size={11} />
                              </button>
                            )}
                            <button
                              onClick={(e) => { e.stopPropagation(); removeItem(item.id); }}
                              disabled={processing && item.status === 'processing'}
                              className="px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                              title="Remove from queue"
                            >
                              <X size={11} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <aside className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-4 md:p-5 h-fit lg:sticky lg:top-[72px]">
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-green-500 uppercase tracking-[0.15em] mb-3">
                <Sliders size={11} /> Settings
              </div>

              <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Where to run</p>
              <div className="grid grid-cols-2 gap-2 mb-1">
                {[
                  { id: ENGINE_SERVER, label: 'Server', Icon: Server, note: 'Free tier' },
                  { id: ENGINE_LOCAL, label: 'Your PC', Icon: Cpu, note: 'CPU / GPU' },
                ].map((opt) => {
                  const Icon = opt.Icon;
                  const active = engine === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => switchEngine(opt.id)}
                      disabled={processing}
                      className={`px-2 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all border flex items-center justify-center gap-1.5 ${
                        active
                          ? 'bg-pink-500 border-pink-500 text-white'
                          : 'bg-gray-50 dark:bg-gray-800/60 border-gray-100 dark:border-gray-800 text-gray-700 dark:text-gray-300 hover:border-pink-400'
                      } ${processing ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <Icon size={12} />
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-snug mb-3">{engineNote}</p>

              <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Mode</p>
              <div className="grid grid-cols-2 gap-2 mb-1">
                {activeModes.map((opt) => {
                  const Icon = opt.Icon;
                  const active = mode === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => setMode(opt.id)}
                      disabled={processing}
                      className={`px-2 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all border flex items-center justify-center gap-1.5 ${
                        active
                          ? 'bg-pink-500 border-pink-500 text-white'
                          : 'bg-gray-50 dark:bg-gray-800/60 border-gray-100 dark:border-gray-800 text-gray-700 dark:text-gray-300 hover:border-pink-400'
                      } ${processing ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <Icon size={12} />
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-snug mb-4">
                {modeChoice.blurb}
              </p>

              <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Scale</p>
              <div className="grid grid-cols-5 gap-1.5 mb-2">
                {SCALE_OPTIONS.map((opt) => {
                  const supported = engine === ENGINE_LOCAL || availableScaleIds.includes(opt.id);
                  return (
                    <button
                      key={opt.id}
                      onClick={() => setScale(opt.id)}
                      disabled={processing || !supported}
                      title={supported ? opt.blurb : 'Not supported on this backend'}
                      className={`px-1 py-2 rounded-lg text-center transition-all border ${
                        scale === opt.id
                          ? 'bg-pink-500 border-pink-500 text-white'
                          : 'bg-gray-50 dark:bg-gray-800/60 border-gray-100 dark:border-gray-800 text-gray-700 dark:text-gray-300 hover:border-pink-400'
                      } ${(processing || !supported) ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <p className="text-[11px] font-bold leading-none">{opt.label}</p>
                      <p className={`text-[8px] mt-0.5 ${scale === opt.id ? 'text-pink-100' : 'text-gray-400 dark:text-gray-500'}`}>
                        {opt.blurb}
                      </p>
                    </button>
                  );
                })}
              </div>
              {aiUpscaleNote && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400 leading-snug mb-4">{aiUpscaleNote}</p>
              )}
              {!aiUpscaleNote && <div className="mb-4" />}

              <div className="flex items-center gap-1.5 text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                <FileImage size={11} /> Format
              </div>
              <div className="grid grid-cols-3 gap-1.5 mb-3">
                {FORMAT_OPTIONS.map((fmt) => (
                  <button
                    key={fmt.id}
                    onClick={() => setFormat(fmt.id)}
                    disabled={processing}
                    className={`px-2 py-1.5 rounded-lg text-center transition-all border ${
                      format === fmt.id
                        ? 'bg-pink-500 border-pink-500 text-white'
                        : 'bg-gray-50 dark:bg-gray-800/60 border-gray-100 dark:border-gray-800 text-gray-700 dark:text-gray-300 hover:border-pink-400'
                    } ${processing ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <p className="text-[11px] font-bold leading-none">{fmt.label}</p>
                    <p className={`text-[9px] mt-0.5 ${format === fmt.id ? 'text-pink-100' : 'text-gray-400 dark:text-gray-500'}`}>
                      {fmt.blurb}
                    </p>
                  </button>
                ))}
              </div>

              {format !== 'png' && (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Quality</span>
                    <span className="text-[11px] font-bold text-gray-900 dark:text-white">{quality}%</span>
                  </div>
                  <input
                    type="range"
                    min={50}
                    max={100}
                    step={1}
                    value={quality}
                    onChange={(e) => setQuality(Number(e.target.value))}
                    disabled={processing}
                    className="w-full"
                  />
                </div>
              )}

              <button
                onClick={runQueue}
                disabled={!queueCount || processing}
                className="w-full px-4 py-2.5 rounded-xl bg-gradient-to-r from-pink-500 to-fuchsia-500 text-white text-xs font-bold uppercase tracking-wider shadow-md hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity flex items-center justify-center gap-2"
              >
                {processing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {processing
                  ? 'Working…'
                  : queueCount
                    ? `Upscale Queue · ${queueCount} pending`
                    : 'Upscale Queue'}
              </button>

              {processing && (
                <button
                  onClick={cancelQueue}
                  className="w-full mt-2 px-4 py-2.5 rounded-xl border border-red-200 dark:border-red-700/60 text-red-600 dark:text-red-400 text-xs font-bold uppercase tracking-wider hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex items-center justify-center gap-2"
                >
                  <StopCircle size={14} /> Stop Queue
                </button>
              )}

              {doneCount > 0 && !processing && (
                <button
                  onClick={downloadAllZip}
                  className="w-full mt-3 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 text-xs font-bold uppercase tracking-wider hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center justify-center gap-2"
                >
                  <Package size={14} />
                  Download ZIP ({doneCount})
                </button>
              )}

              <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800 space-y-2 text-[10px] text-gray-500 dark:text-gray-400 leading-relaxed">
                <p className="flex items-center gap-1.5">
                  <Globe size={11} className="shrink-0" />
                  <span><strong className="text-gray-700 dark:text-gray-300">Server:</strong> Fast (Pillow) or Real-ESRGAN AI Fast / AI Plus / Anime on shared free workers. Scales 2–8×.</span>
                </p>
                <p className="flex items-center gap-1.5">
                  <Cpu size={11} className="shrink-0" />
                  <span><strong className="text-gray-700 dark:text-gray-300">Your PC:</strong> Fast (instant) or Real-ESRGAN AI via onnxruntime — {webgpu ? 'WebGPU' : 'WASM'}{webgpu ? '' : ' (no WebGPU found)'}. Nothing is uploaded.</span>
                </p>
                <p className="flex items-center gap-1.5">
                  <Shield size={11} className="shrink-0" />
                  <span><strong className="text-gray-700 dark:text-gray-300">Privacy:</strong> Server images aren't stored after the job; Your PC images never leave the device.</span>
                </p>
              </div>
            </aside>
          </div>
        </div>
        <Footer />
      </main>

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}

      {previewId && (
        <BeforeAfterPreview
          item={items.find((i) => i.id === previewId) || { file: { name: '' }, status: 'done', resultUrl: '', originalUrl: '', origDims: null, resultDims: null, resultSize: null, resultExt: '' }}
          fmtExt={fmtChoice.ext}
          onClose={() => setPreviewId(null)}
        />
      )}
    </div>
  );
}