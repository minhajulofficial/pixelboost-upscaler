import { useState, useRef, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Upload, Download, Trash2, Loader2, Image as ImageIcon,
  Sparkles, Zap, AlertCircle, Palette, Wand2, Server, Cpu, Shield,
} from 'lucide-react';
import { fetchWithFailover, getServers } from '../services/serverPool';
import { useCredit } from '../services/authService';
import type { User } from '../lib/supabase';
import { getRemainingCredits, canUseCredits } from '../services/creditService';
import { isAdmin } from '../services/adminService';
// @ts-ignore
import { runLocalUpscale } from '../services/localUpscale';

type UpscalerProps = {
  user: User | null;
  onShowAuth: () => void;
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
  resultDims?: { width: number; height: number };
};

const ENGINE_SERVER = 'server';
const ENGINE_LOCAL = 'local';

const SERVER_MODES = [
  { id: 'fast', label: 'Fast', icon: Zap, color: 'text-yellow-500' },
  { id: 'ai-fast', label: 'AI Fast', icon: Wand2, color: 'text-purple-500' },
  { id: 'ai-plus', label: 'AI Plus', icon: Sparkles, color: 'text-pink-500' },
  { id: 'anime', label: 'Anime', icon: Palette, color: 'text-indigo-500' },
];

const LOCAL_MODES = [
  { id: 'fast', label: 'Fast', icon: Zap, color: 'text-yellow-500' },
  { id: 'ai', label: 'AI', icon: Wand2, color: 'text-purple-500' },
];

const SCALES = [2, 3, 4, 6, 8];
const FORMATS = [
  { id: 'png', label: 'PNG' },
  { id: 'jpg', label: 'JPEG' },
  { id: 'webp', label: 'WebP' },
];

export default function Upscaler({ user, onShowAuth }: UpscalerProps) {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [engine, setEngine] = useState<'server' | 'local'>('server');
  const [scale, setScale] = useState(2);
  const [mode, setMode] = useState('fast');
  const [format, setFormat] = useState('png');
  const [quality, setQuality] = useState(95);
  const [processing, setProcessing] = useState(false);
  const [selectedServer, setSelectedServer] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const MODES = engine === 'server' ? SERVER_MODES : LOCAL_MODES;

  const servers = getServers();
  const remainingCredits = user ? getRemainingCredits(user.credits_used, user.credits_limit) : 0;
  const canProcess = user ? canUseCredits(user.credits_used, user.credits_limit) : false;

  // Cleanup previews on unmount
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
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const handleUpscale = async (item: ImageItem) => {
    if (engine === 'server' && !canProcess) {
      onShowAuth();
      return;
    }

    setImages((prev) =>
      prev.map((img) => (img.id === item.id ? { ...img, status: 'processing', progress: 0 } : img))
    );

    try {
      let blob: Blob;
      if (engine === 'local') {
        // @ts-ignore
        blob = await runLocalUpscale(item.file, { mode, scale, quality, format, onProgress: (p: number) => {
          setImages((prev) => prev.map((img) => img.id === item.id ? { ...img, progress: p } : img));
        }});
        // handle format transcode if needed (WebP via canvas is inside runLocalUpscale)
        if (format === 'jpg' && blob.type !== 'image/jpeg') {
          // runLocalUpscale already encodes format
        }
      } else {
        const server = servers[selectedServer];
        if (!server) throw new Error('No server available');

        const formData = new FormData();
        formData.append('file', item.file);
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
          throw new Error(errorData.detail || errorData.error || `Server error: ${response.status}`);
        }

        const { id: jobId } = await response.json();
        // poll job
        let resultBlob: Blob | null = null;
        for (let i = 0; i < 180; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const { response: pollRes } = await fetchWithFailover(`/jobs/${jobId}`, { method: 'GET' });
          const data = await pollRes.json();
          const pct = Math.round((data.progress || 0) * 100);
          setImages((prev) => prev.map((img) => img.id === item.id ? { ...img, progress: pct } : img));
          if (data.status === 'done') {
            const { response: resRes } = await fetchWithFailover(`/jobs/${jobId}/result`, { method: 'GET' });
            resultBlob = await resRes.blob();
            break;
          }
          if (data.status === 'error') throw new Error(data.error || 'Job failed');
        }
        if (!resultBlob) throw new Error('Job timeout');
        blob = resultBlob;
        // client-side WebP transcode if requested
        if (format === 'webp') {
          const url = URL.createObjectURL(blob);
          const imgEl = new Image();
          imgEl.src = url;
          await new Promise<void>((res, rej) => { imgEl.onload = () => res(); imgEl.onerror = () => rej(new Error('decode failed')); });
          const canvas = document.createElement('canvas');
          canvas.width = imgEl.naturalWidth;
          canvas.height = imgEl.naturalHeight;
          canvas.getContext('2d')!.drawImage(imgEl, 0, 0);
          blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => b ? res(b) : rej(new Error('webp encode failed')), 'image/webp', quality / 100));
          URL.revokeObjectURL(url);
        }
      }
      const resultPreview = URL.createObjectURL(blob);

      // Get result dimensions
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

      // Use credit only for server engine
      if (engine === 'server' && user) {
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
            ? { ...img, status: 'error', error: err instanceof Error ? err.message : 'Upscale failed' }
            : img
        )
      );
    }
  };

  const handleUpscaleAll = async () => {
    if (!canProcess) {
      onShowAuth();
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
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-gray-800 bg-gray-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-2">
            <Sparkles className="text-purple-500" size={24} />
            <span className="text-xl font-bold">PixelBoost</span>
          </Link>

          <div className="flex items-center gap-4">
            {user ? (
              <div className="flex items-center gap-4">
                <Link to="/dashboard" className="text-sm text-gray-300 hover:text-white">Dashboard</Link>
                {isAdmin(user) && <Link to="/admin" className="text-sm font-semibold text-purple-400 hover:text-purple-300">Admin</Link>}
                <div className="text-right">
                  <div className="text-sm font-medium text-white">{user.email}</div>
                  <div className="text-xs text-gray-400">
                    {remainingCredits === Infinity ? 'Unlimited' : `${remainingCredits} credits`}
                  </div>
                </div>
                <img
                  src={user.avatar_url || `https://ui-avatars.com/api/?name=${user.email}`}
                  alt=""
                  className="h-8 w-8 rounded-full"
                />
              </div>
            ) : (
              <button
                onClick={onShowAuth}
                className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500"
              >
                Sign In
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Upload Zone */}
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
          className="mb-8 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-700 bg-gray-900/50 p-12 transition-colors hover:border-purple-500 hover:bg-gray-900"
        >
          <Upload size={48} className="mb-4 text-gray-500" />
          <p className="mb-2 text-lg font-medium text-gray-300">
            Drop images here or click to upload
          </p>
          <p className="text-sm text-gray-500">JPG, PNG up to 20MB</p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />
        </div>

        {/* Settings Bar — full CSV Tree models */}
        {images.length > 0 && (
          <div className="mb-8 rounded-2xl border border-gray-800 bg-gray-900/50 p-6">
            <div className="flex flex-wrap items-center gap-6">
              {/* Where to run */}
              <div>
                <label className="mb-2 block text-xs font-medium text-gray-400">Where to run</label>
                <div className="flex gap-2">
                  <button onClick={() => { setEngine('server'); setMode('fast'); }} className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium ${engine === 'server' ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
                    <Server size={14} /> Server
                  </button>
                  <button onClick={() => { setEngine('local'); setMode('fast'); }} className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium ${engine === 'local' ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
                    <Cpu size={14} /> Your PC
                  </button>
                </div>
                <p className="mt-1 max-w-[260px] text-[10px] leading-relaxed text-gray-500">
                  {engine === 'server' ? 'Images are sent to the PixelBoost server. Best for 8×.' : 'Nothing is uploaded. Runs in your browser.'}
                </p>
              </div>

              {/* Mode */}
              <div>
                <label className="mb-2 block text-xs font-medium text-gray-400">Mode</label>
                <div className="flex gap-2 flex-wrap">
                  {MODES.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setMode(m.id)}
                      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        mode === m.id
                          ? 'bg-purple-600 text-white'
                          : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                      }`}
                    >
                      <m.icon size={14} className={m.color} />
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Scale */}
              <div>
                <label className="mb-2 block text-xs font-medium text-gray-400">Scale</label>
                <div className="flex gap-2">
                  {SCALES.map((s) => (
                    <button
                      key={s}
                      onClick={() => setScale(s)}
                      className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
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

              {/* Format */}
              <div>
                <label className="mb-2 block text-xs font-medium text-gray-400">Format</label>
                <div className="flex gap-2">
                  {FORMATS.map((f) => (
                    <button key={f.id} onClick={() => setFormat(f.id)} className={`rounded-lg px-3 py-2 text-sm font-medium ${format === f.id ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quality */}
              {(format === 'jpg' || format === 'webp') && (
                <div className="min-w-[140px]">
                  <label className="mb-2 block text-xs font-medium text-gray-400">Quality {quality}%</label>
                  <input type="range" min={50} max={100} value={quality} onChange={(e) => setQuality(Number(e.target.value))} className="w-full accent-purple-600" />
                </div>
              )}

              {/* Server */}
              {servers.length > 1 && (
                <div>
                  <label className="mb-2 block text-xs font-medium text-gray-400">Server</label>
                  <select
                    value={selectedServer}
                    onChange={(e) => setSelectedServer(Number(e.target.value))}
                    className="rounded-lg bg-gray-800 px-4 py-2 text-sm text-gray-300 focus:outline-none focus:ring-1 focus:ring-purple-500"
                  >
                    {servers.map((s, i) => (
                      <option key={i} value={i}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Actions */}
              <div className="ml-auto flex gap-3">
                <button
                  onClick={handleUpscaleAll}
                  disabled={processing || images.every((img) => img.status !== 'pending')}
                  className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-6 py-3 font-semibold text-white transition-all hover:from-violet-500 hover:to-purple-500 disabled:opacity-50"
                >
                  {processing ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <Sparkles size={18} />
                  )}
                  Upscale All
                </button>

                {images.some((img) => img.result) && (
                  <button
                    onClick={handleDownloadAll}
                    className="flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-emerald-500"
                  >
                    <Download size={18} />
                    ZIP
                  </button>
                )}

                <button
                  onClick={handleClear}
                  className="rounded-xl border border-gray-700 px-6 py-3 font-semibold text-gray-300 transition-colors hover:border-rose-500 hover:text-rose-400"
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
                className="group relative overflow-hidden rounded-2xl border border-gray-800 bg-gray-900"
              >
                {/* Preview */}
                <div className="relative aspect-square">
                  {item.resultPreview ? (
                    <div className="flex h-full">
                      <img
                        src={item.preview}
                        alt=""
                        className="h-full w-1/2 object-cover opacity-60"
                      />
                      <img src={item.resultPreview} alt="" className="h-full w-1/2 object-cover" />
                    </div>
                  ) : (
                    <img src={item.preview} alt="" className="h-full w-full object-cover" />
                  )}

                  {/* Status overlay */}
                  {item.status === 'processing' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                      <Loader2 size={32} className="animate-spin text-purple-500" />
                    </div>
                  )}
                  {item.status === 'error' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                      <AlertCircle size={32} className="text-red-500" />
                    </div>
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
                  <div className="mb-2 flex items-center justify-between">
                    <span className="truncate text-sm font-medium text-gray-300">
                      {item.file.name}
                    </span>
                    <span className="ml-2 text-xs text-gray-500">
                      {(item.file.size / 1024 / 1024).toFixed(1)}MB
                    </span>
                  </div>

                  {item.error && (
                    <p className="mb-2 text-xs text-red-400">{item.error}</p>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2">
                    {item.status === 'pending' && (
                      <button
                        onClick={() => handleUpscale(item)}
                        className="flex-1 rounded-lg bg-purple-600 py-2 text-sm font-medium text-white hover:bg-purple-500"
                      >
                        Upscale
                      </button>
                    )}
                    {item.status === 'done' && (
                      <button
                        onClick={() => handleDownload(item)}
                        className="flex-1 rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white hover:bg-emerald-500"
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
    </div>
  );
}
