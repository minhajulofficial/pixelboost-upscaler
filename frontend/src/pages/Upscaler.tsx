import { useState, useRef, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Upload, Download, Trash2, Loader2, Image as ImageIcon,
  Sparkles, Zap, AlertCircle, Palette, Wand2, Server,
  Eye, ArrowLeft, HardDrive,
} from 'lucide-react';
import Topbar from '../components/Topbar';
import Footer from '../components/Footer';
import { fetchWithFailover, getServers } from '../services/serverPool';
import { useCredit } from '../services/authService';
import type { User } from '../lib/supabase';
import { canUseCredits } from '../services/creditService';

type UpscalerProps = {
  user: User | null;
};

type ImageItem = {
  id: string;
  file: File;
  preview: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  progress: number;
  result?: Blob;
  resultPreview?: string;
  error?: string;
  inputDims?: { width: number; height: number };
  resultDims?: { width: number; height: number };
};

const SERVER_MODES = [
  { id: 'fast', label: 'Fast', icon: Zap, color: 'text-yellow-500' },
  { id: 'ai-fast', label: 'AI Fast', icon: Wand2, color: 'text-purple-500' },
  { id: 'ai-plus', label: 'AI Plus', icon: Sparkles, color: 'text-pink-500' },
  { id: 'anime', label: 'Anime', icon: Palette, color: 'text-indigo-500' },
];

const LOCAL_MODES = [
  { id: 'fast', label: 'Fast', icon: Zap, color: 'text-yellow-500' },
  { id: 'ai', label: 'AI', icon: Wand2, color: 'text-purple-500' },
  { id: 'ai-plus', label: 'AI Plus', icon: Sparkles, color: 'text-pink-500' },
];

const ENGINE_SERVER = 'server';
const ENGINE_LOCAL = 'local';

const SCALES = [2, 3, 4, 6, 8];
const FORMATS = [
  { id: 'png', label: 'PNG' },
  { id: 'jpg', label: 'JPEG' },
  { id: 'webp', label: 'WebP' },
];

export default function Upscaler({ user }: UpscalerProps) {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [scale, setScale] = useState(2);
  const [mode, setMode] = useState('fast');
  const [format, setFormat] = useState('png');
  const [quality, setQuality] = useState(95);
  const [processing, setProcessing] = useState(false);
  const [selectedServer, setSelectedServer] = useState(0);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [engine, setEngine] = useState(() => {
    try { const v = localStorage.getItem('pixelboost_engine'); return v === ENGINE_LOCAL ? ENGINE_LOCAL : ENGINE_SERVER; } catch { return ENGINE_SERVER; }
  });
  const [disabledScales, setDisabledScales] = useState<number[]>([]);
  const [disabledModels, setDisabledModels] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const rawModes = engine === ENGINE_LOCAL ? LOCAL_MODES : SERVER_MODES;
  const MODES = rawModes.filter((m) => !disabledModels.includes(m.id));
  const visibleScales = engine === ENGINE_SERVER ? SCALES.filter((s) => !disabledScales.includes(s)) : SCALES;

  useEffect(() => {
    (async () => {
      try {
        const { supabase } = await import('../lib/supabase');
        const { data: ds } = await supabase.from('site_config').select('value').eq('key', 'site_settings').single();
        if (ds?.value && typeof ds.value === 'object') {
          const d = (ds.value as Record<string, unknown>).disabledScales;
          if (Array.isArray(d)) setDisabledScales(d as number[]);
        }
        const { data: md } = await supabase.from('site_config').select('value').eq('key', 'models').single();
        if (md?.value && Array.isArray(md.value)) {
          const disabled = (md.value as Array<{ id: string; enabled: boolean }>).filter((m) => m.enabled === false).map((m) => m.id);
          setDisabledModels(disabled);
        }
      } catch {}
      try {
        const s = getServers()[0];
        if (s) {
          const r = await fetch(`${s.url}/version`);
          if (r.ok) {
            const j = await r.json() as Record<string, unknown>;
            if (typeof j.max_output_pixels === 'number') setServerCaps((c) => ({ ...c, maxOutput: j.max_output_pixels as number }));
            if (typeof j.ai_max_input_pixels === 'number') setServerCaps((c) => ({ ...c, aiMax: j.ai_max_input_pixels as number }));
          }
        }
      } catch {}
    })();
  }, []);

  useEffect(() => { try { localStorage.setItem('pixelboost_engine', engine); } catch {} }, [engine]);
  useEffect(() => {
    const valid = MODES.some((m) => m.id === mode);
    if (!valid) setMode(MODES[0].id);
  }, [engine]);
  useEffect(() => {
    if (!visibleScales.includes(scale) && visibleScales.length > 0) setScale(visibleScales[0]);
  }, [visibleScales.join(',')]);

  const servers = getServers();
  const canProcess = engine === ENGINE_LOCAL ? !!user : (user ? canUseCredits(user.credits_used, user.credits_limit) : false);

  const [serverCaps, setServerCaps] = useState({ aiMax: 4000000, maxOutput: 25000000 });
  const SERVER_AI_MAX_PIXELS = serverCaps.aiMax;
  const SERVER_MAX_OUTPUT_PIXELS = serverCaps.maxOutput;

  async function getServerSafeBlob(file: File, dims: { width: number; height: number } | null | undefined, scale: number, mode: string): Promise<File> {
    let w = dims?.width, h = dims?.height;
    if (!w || !h) {
      try {
        const url = URL.createObjectURL(file);
        const d = await new Promise<{ width: number; height: number }>((res) => {
          const im = new Image();
          im.onload = () => res({ width: im.naturalWidth, height: im.naturalHeight });
          im.onerror = () => res({ width: 0, height: 0 });
          im.src = url;
        });
        URL.revokeObjectURL(url);
        w = d.width; h = d.height;
        if (!w || !h) return file;
      } catch { return file; }
    }
    let targetW = w, targetH = h;
    let needResize = false;
    if (mode !== 'fast' && w * h > SERVER_AI_MAX_PIXELS) {
      const r = Math.sqrt(SERVER_AI_MAX_PIXELS / (w * h));
      targetW = Math.max(64, Math.round(w * r));
      targetH = Math.max(64, Math.round(h * r));
      needResize = true;
    }
    const outPixels = targetW * targetH * scale * scale;
    if (outPixels > SERVER_MAX_OUTPUT_PIXELS) {
      const r = Math.sqrt(SERVER_MAX_OUTPUT_PIXELS / outPixels);
      targetW = Math.max(64, Math.round(targetW * r));
      targetH = Math.max(64, Math.round(targetH * r));
      needResize = true;
    }
    if (!needResize) return file;
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = targetW; canvas.height = targetH;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h, 0, 0, targetW, targetH);
    bitmap.close?.();
    const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => b ? res(b) : rej(new Error('resize failed')), file.type || 'image/png', 0.92));
    return new File([blob], file.name, { type: blob.type });
  }

  useEffect(() => {
    return () => {
      images.forEach((img) => {
        URL.revokeObjectURL(img.preview);
        if (img.resultPreview) URL.revokeObjectURL(img.resultPreview);
      });
    };
  }, []);

  const handleFiles = useCallback((files: FileList | File[]) => {
    const newImages: ImageItem[] = Array.from(files)
      .filter((f) => f.type.startsWith('image/'))
      .map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        preview: URL.createObjectURL(file),
        status: 'pending' as const,
        progress: 0,
      }));

    setImages((prev) => [...prev, ...newImages]);

    newImages.forEach((item) => {
      const img = new Image();
      img.onload = () => {
        setImages((prev) =>
          prev.map((i) =>
            i.id === item.id
              ? { ...i, inputDims: { width: img.naturalWidth, height: img.naturalHeight } }
              : i
          )
        );
      };
      img.src = item.preview;
    });
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const handleUpscale = async (item: ImageItem) => {
    if (!canProcess) {
      window.location.href = '/login';
      return;
    }

    setImages((prev) =>
      prev.map((img) =>
        img.id === item.id ? { ...img, status: 'processing', progress: 0 } : img
      )
    );

    try {
      let blob: Blob;
      if (engine === ENGINE_LOCAL) {
        // @ts-ignore - JS service without declaration
        const { runLocalUpscale } = await import('../services/localUpscale.js');
        blob = await runLocalUpscale(item.file, {
          scale,
          mode,
          format,
          quality,
          onProgress: (pct: number) => {
            setImages((prev) => prev.map((img) => img.id === item.id ? { ...img, progress: pct } : img));
          },
        });
      } else {
        const server = servers[selectedServer];
        if (!server) throw new Error('No server available');

        const safeFile = await getServerSafeBlob(item.file, item.inputDims, scale, mode);

        const formData = new FormData();
        formData.append('file', safeFile);
        formData.append('scale', String(scale));
        formData.append('format', format === 'webp' ? 'png' : format);
        formData.append('quality', String(quality));
        formData.append('mode', mode);

        const { response } = await fetchWithFailover('/jobs/upscale-ai', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            errorData.detail || errorData.error || `Server error: ${response.status}`
          );
        }

        const { id: jobId } = await response.json();
        let resultBlob: Blob | null = null;
        for (let i = 0; i < 180; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const { response: pollRes } = await fetchWithFailover(`/jobs/${jobId}`, {
            method: 'GET',
          });
          const data = await pollRes.json();
          const pct = Math.round((data.progress || 0) * 100);
          setImages((prev) =>
            prev.map((img) =>
              img.id === item.id ? { ...img, progress: pct } : img
            )
          );
          if (data.status === 'done') {
            const { response: resRes } = await fetchWithFailover(
              `/jobs/${jobId}/result`,
              { method: 'GET' }
            );
            resultBlob = await resRes.blob();
            break;
          }
          if (data.status === 'error') throw new Error(data.error || 'Job failed');
        }
        if (!resultBlob) throw new Error('Job timeout');
        blob = resultBlob;

        if (format === 'webp') {
          const url = URL.createObjectURL(blob);
          const imgEl = new Image();
          imgEl.src = url;
          await new Promise<void>((res, rej) => {
            imgEl.onload = () => res();
            imgEl.onerror = () => rej(new Error('decode failed'));
          });
          const canvas = document.createElement('canvas');
          canvas.width = imgEl.naturalWidth;
          canvas.height = imgEl.naturalHeight;
          canvas.getContext('2d')!.drawImage(imgEl, 0, 0);
          blob = await new Promise<Blob>((res, rej) =>
            canvas.toBlob(
              (b) => (b ? res(b) : rej(new Error('webp encode failed'))),
              'image/webp',
              quality / 100
            )
          );
          URL.revokeObjectURL(url);
        }
      }

      const resultPreview = URL.createObjectURL(blob);
      const resultImg = new Image();
      resultImg.src = resultPreview;
      await new Promise<void>((resolve) => {
        resultImg.onload = () => resolve();
      });
      const resultDims = { width: resultImg.naturalWidth, height: resultImg.naturalHeight };

      setImages((prev) =>
        prev.map((img) =>
          img.id === item.id
            ? {
                ...img,
                status: 'done',
                progress: 100,
                result: blob,
                resultPreview,
                resultDims,
              }
            : img
        )
      );

      if (user && engine === ENGINE_SERVER) {
        try {
          await useCredit(user.id);
        } catch {
          // Credit use failed, but upscale succeeded
        }
      }
    } catch (err) {
      setImages((prev) =>
        prev.map((img) =>
          img.id === item.id
            ? {
                ...img,
                status: 'error',
                error: err instanceof Error ? err.message : 'Upscale failed',
              }
            : img
        )
      );
    }
  };

  const handleUpscaleAll = async () => {
    if (!canProcess) {
      window.location.href = '/login';
      return;
    }

    setProcessing(true);
    const pending = images.filter((img) => img.status === 'pending');

    for (const item of pending) {
      await handleUpscale(item);
    }

    setProcessing(false);
  };

  const handleDownload = (item: ImageItem) => {
    if (!item.result) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(item.result);
    a.download = `upscaled_${item.file.name}`;
    a.click();
  };

  const handleDownloadAll = async () => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    images
      .filter((img) => img.result)
      .forEach((img) => {
        zip.file(`upscaled_${img.file.name}`, img.result!);
      });

    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'upscaled_images.zip';
    a.click();
  };

  const handleClear = () => {
    images.forEach((img) => {
      URL.revokeObjectURL(img.preview);
      if (img.resultPreview) URL.revokeObjectURL(img.resultPreview);
    });
    setImages([]);
  };

  const removeImage = (id: string) => {
    const img = images.find((i) => i.id === id);
    if (img) {
      URL.revokeObjectURL(img.preview);
      if (img.resultPreview) URL.revokeObjectURL(img.resultPreview);
    }
    setImages((prev) => prev.filter((i) => i.id !== id));
  };

  return (
    <div className="flex min-h-screen flex-col bg-gray-950">
      <Topbar user={user} />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors"
          >
            <ArrowLeft size={14} />
            Back
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-white">Upscale Images</h1>
          <p className="text-sm text-gray-400">
            Enhance your images with AI upscaling
          </p>
        </div>

        {/* Upload Zone with gradient */}
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
          className="relative mb-8 cursor-pointer overflow-hidden rounded-2xl border-2 border-dashed border-gray-700 p-12 text-center transition-all hover:border-purple-500"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 via-transparent to-violet-500/10" />
          <div className="relative">
            <Upload size={48} className="mx-auto mb-4 text-gray-500" />
            <p className="mb-2 text-lg font-medium text-gray-300">
              Drop images here or click to upload
            </p>
            <p className="text-sm text-gray-500">JPG, PNG, WebP up to 20MB</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />
        </div>

        {/* Settings Bar */}
        {images.length > 0 && (
          <div className="mb-8 rounded-2xl border border-gray-800 bg-gray-900/50 p-5">
            <div className="flex flex-wrap items-center gap-5">
              {/* Engine */}
              <div>
                <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-gray-400">
                  Engine
                </label>
                <div className="flex rounded-lg bg-gray-800 p-1">
                  <button
                    onClick={() => setEngine(ENGINE_SERVER)}
                    className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors ${engine === ENGINE_SERVER ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}
                  >
                    <Server size={12} /> Server
                  </button>
                  <button
                    onClick={() => setEngine(ENGINE_LOCAL)}
                    className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors ${engine === ENGINE_LOCAL ? 'bg-green-600 text-white' : 'text-gray-400 hover:text-white'}`}
                  >
                    <HardDrive size={12} /> Your PC
                  </button>
                </div>
              </div>

              {/* Divider */}
              <div className="h-8 w-px bg-gray-800" />

              {/* Mode */}
              <div>
                <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-gray-400">
                  Mode
                </label>
                <div className="flex gap-1.5">
                  {MODES.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setMode(m.id)}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                        mode === m.id
                          ? 'bg-purple-600 text-white'
                          : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                      }`}
                    >
                      <m.icon size={12} className={m.color} />
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Divider */}
              <div className="h-8 w-px bg-gray-800" />

              {/* Scale */}
              <div>
                <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-gray-400">
                  Scale
                </label>
                <div className="flex gap-1.5">
                  {visibleScales.map((s) => (
                    <button
                      key={s}
                      onClick={() => setScale(s)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                        scale === s
                          ? 'bg-purple-600 text-white'
                          : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                      }`}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              </div>

              {/* Divider */}
              <div className="h-8 w-px bg-gray-800" />

              {/* Format */}
              <div>
                <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-gray-400">
                  Format
                </label>
                <div className="flex gap-1.5">
                  {FORMATS.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setFormat(f.id)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                        format === f.id
                          ? 'bg-purple-600 text-white'
                          : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quality */}
              {(format === 'jpg' || format === 'webp') && (
                <>
                  <div className="h-8 w-px bg-gray-800" />
                  <div className="min-w-[120px]">
                    <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-gray-400">
                      Quality {quality}%
                    </label>
                    <input
                      type="range"
                      min={50}
                      max={100}
                      value={quality}
                      onChange={(e) => setQuality(Number(e.target.value))}
                      className="w-full accent-purple-600"
                    />
                  </div>
                </>
              )}

              {/* Server Selector */}
              {servers.length > 1 && (
                <>
                  <div className="h-8 w-px bg-gray-800" />
                  <div>
                    <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-gray-400">
                      Server
                    </label>
                    <select
                      value={selectedServer}
                      onChange={(e) => setSelectedServer(Number(e.target.value))}
                      className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs text-gray-300 focus:outline-none focus:ring-1 focus:ring-purple-500"
                    >
                      {servers.map((s, i) => (
                        <option key={i} value={i}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {/* Actions */}
              <div className="ml-auto flex gap-2">
                <button
                  onClick={handleUpscaleAll}
                  disabled={processing || images.every((img) => img.status !== 'pending')}
                  className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-5 py-2 text-sm font-semibold text-white transition-all hover:from-violet-500 hover:to-purple-500 disabled:opacity-50"
                >
                  {processing ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Sparkles size={16} />
                  )}
                  Upscale All
                </button>

                {images.some((img) => img.result) && (
                  <button
                    onClick={handleDownloadAll}
                    className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
                  >
                    <Download size={16} />
                    ZIP
                  </button>
                )}

                <button
                  onClick={handleClear}
                  className="rounded-xl border border-gray-700 px-5 py-2 text-sm font-semibold text-gray-300 transition-colors hover:border-rose-500 hover:text-rose-400"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Image Grid */}
        {images.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {images.map((item) => (
              <div
                key={item.id}
                className="group relative overflow-hidden rounded-2xl border border-gray-800 bg-gray-900 transition-all duration-200 hover:border-gray-700 hover:shadow-lg hover:shadow-purple-500/5"
              >
                {/* Preview */}
                <div className="relative aspect-square">
                  {item.status === 'done' && item.resultPreview && compareId === item.id ? (
                    <CompareSlider
                      beforeSrc={item.preview}
                      afterSrc={item.resultPreview}
                    />
                  ) : item.resultPreview ? (
                    <div className="flex h-full">
                      <img
                        src={item.preview}
                        alt=""
                        className="h-full w-1/2 object-cover opacity-60"
                      />
                      <img
                        src={item.resultPreview}
                        alt=""
                        className="h-full w-1/2 object-cover"
                      />
                    </div>
                  ) : (
                    <img
                      src={item.preview}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  )}

                  {/* Processing overlay with progress bar */}
                  {item.status === 'processing' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60">
                      <div className="mb-3 h-2 w-3/4 overflow-hidden rounded-full bg-gray-700">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-violet-500 to-purple-500 transition-all duration-300"
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                      <span className="text-sm font-semibold text-white">
                        {item.progress}%
                      </span>
                    </div>
                  )}

                  {item.status === 'error' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                      <AlertCircle size={32} className="text-red-500" />
                    </div>
                  )}

                  {/* Compare button */}
                  {item.status === 'done' && item.resultPreview && (
                    <button
                      onClick={() =>
                        setCompareId(compareId === item.id ? null : item.id)
                      }
                      className={`absolute left-2 top-2 rounded-full p-1.5 transition-colors ${
                        compareId === item.id
                          ? 'bg-purple-600 text-white'
                          : 'bg-black/60 text-white opacity-0 group-hover:opacity-100 hover:bg-purple-600'
                      }`}
                    >
                      <Eye size={14} />
                    </button>
                  )}

                  {/* Remove button */}
                  <button
                    onClick={() => removeImage(item.id)}
                    className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-600"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {/* Info */}
                <div className="p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="truncate text-sm font-medium text-gray-300">
                      {item.file.name}
                    </span>
                    <span className="ml-2 shrink-0 text-xs text-gray-500">
                      {(item.file.size / 1024 / 1024).toFixed(1)}MB
                    </span>
                  </div>

                  {/* Size display */}
                  {item.inputDims && (
                    <p className="mb-1 text-[11px] text-gray-500">
                      {item.inputDims.width}×{item.inputDims.height}
                      {item.status === 'done' && item.resultDims
                        ? ` → ${item.resultDims.width}×${item.resultDims.height}`
                        : ` → ${item.inputDims.width * scale}×${item.inputDims.height * scale}`}
                    </p>
                  )}

                  {item.error && (
                    <p className="mb-1 text-xs text-red-400">{item.error}</p>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2">
                    {item.status === 'pending' && (
                      <button
                        onClick={() => handleUpscale(item)}
                        className="flex-1 rounded-lg bg-purple-600 py-1.5 text-xs font-medium text-white hover:bg-purple-500"
                      >
                        Upscale
                      </button>
                    )}
                    {item.status === 'done' && (
                      <button
                        onClick={() => handleDownload(item)}
                        className="flex-1 rounded-lg bg-emerald-600 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
                      >
                        Download
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty State */}
        {images.length === 0 && (
          <div className="py-24 text-center">
            <ImageIcon size={64} className="mx-auto mb-4 text-gray-700" />
            <p className="text-gray-500">No images uploaded yet</p>
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}

function CompareSlider({
  beforeSrc,
  afterSrc,
}: {
  beforeSrc: string;
  afterSrc: string;
}) {
  const [pos, setPos] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const handleMove = useCallback((clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setPos(pct);
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      dragging.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      handleMove(e.clientX);
    },
    [handleMove]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      handleMove(e.clientX);
    },
    [handleMove]
  );

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full cursor-ew-resize select-none overflow-hidden"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* After (full background) */}
      <img
        src={afterSrc}
        alt="After"
        className="absolute inset-0 h-full w-full object-cover"
        draggable={false}
      />

      {/* Before (clipped) */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ width: `${pos}%` }}
      >
        <img
          src={beforeSrc}
          alt="Before"
          className="h-full w-full object-cover"
          style={{ width: `${containerRef.current?.offsetWidth || 1000}px` }}
          draggable={false}
        />
      </div>

      {/* Divider line */}
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-white shadow-lg"
        style={{ left: `${pos}%`, transform: 'translateX(-50%)' }}
      >
        {/* Drag handle */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-lg">
          <div className="flex gap-0.5">
            <div className="h-3 w-0.5 rounded-full bg-gray-400" />
            <div className="h-3 w-0.5 rounded-full bg-gray-400" />
          </div>
        </div>
      </div>

      {/* Labels */}
      <div className="absolute bottom-3 left-3 rounded-full bg-black/70 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
        Before
      </div>
      <div className="absolute bottom-3 right-3 rounded-full bg-black/70 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
        After
      </div>
    </div>
  );
}
