import {
  ChangeEvent,
  DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import {
  AlertTriangle,
  Check,
  Download,
  Image as ImageIcon,
  Loader2,
  Sparkles,
  Trash2,
  Upload,
  X,
  Zap,
} from "lucide-react";
import "./App.css";

type Scale = 2 | 4 | 6;
type Format = "jpg" | "png";

interface Settings {
  scale: Scale;
  format: Format;
  quality: number;
}

interface Dimensions {
  width: number;
  height: number;
}

type ImageStatus = "pending" | "processing" | "done" | "error";

interface ImageItem {
  id: string;
  file: File;
  name: string;
  originalSize: number;
  previewUrl: string;
  status: ImageStatus;
  progress: number;
  result?: Blob;
  resultUrl?: string;
  resultSize?: number;
  originalDimensions?: Dimensions;
  newDimensions?: Dimensions;
  error?: string;
}

function parseApi(raw: string): { base: string; authHeader: string | null } {
  const cleaned = raw.replace(/\/$/, "");
  try {
    const parsed = new URL(cleaned);
    if (parsed.username || parsed.password) {
      const creds = `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`;
      const authHeader = `Basic ${btoa(creds)}`;
      parsed.username = "";
      parsed.password = "";
      return { base: parsed.toString().replace(/\/$/, ""), authHeader };
    }
    return { base: cleaned, authHeader: null };
  } catch {
    return { base: cleaned, authHeader: null };
  }
}

const { base: API_URL, authHeader: AUTH_HEADER } = parseApi(
  import.meta.env.VITE_API_URL ?? "http://localhost:8000",
);
const SCALE_OPTIONS: Scale[] = [2, 4, 6];
const FORMAT_OPTIONS: Format[] = ["jpg", "png"];

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function readImageDimensions(file: File): Promise<Dimensions> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve({ width: 0, height: 0 });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

function readBlobDimensions(blob: Blob): Promise<Dimensions> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve({ width: 0, height: 0 });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

interface UpscaleApiResult {
  blob: Blob;
}

function upscaleRequest(
  file: File,
  settings: Settings,
  onProgress: (pct: number) => void,
  signal: AbortSignal,
): Promise<UpscaleApiResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/upscale`, true);
    xhr.responseType = "blob";
    if (AUTH_HEADER) xhr.setRequestHeader("Authorization", AUTH_HEADER);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const uploadFraction = event.loaded / event.total;
        onProgress(Math.min(0.6, uploadFraction * 0.6));
      }
    };

    xhr.onreadystatechange = () => {
      if (xhr.readyState === XMLHttpRequest.HEADERS_RECEIVED) {
        onProgress(0.7);
      }
    };

    xhr.onprogress = (event) => {
      if (event.lengthComputable) {
        const downloadFraction = event.loaded / event.total;
        onProgress(0.7 + Math.min(0.29, downloadFraction * 0.29));
      } else {
        onProgress(0.85);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve({ blob: xhr.response as Blob });
      } else {
        const blob = xhr.response as Blob | undefined;
        if (blob && blob.type.includes("json")) {
          blob.text().then((text) => {
            try {
              const parsed = JSON.parse(text) as { detail?: string };
              reject(new Error(parsed.detail ?? `HTTP ${xhr.status}`));
            } catch {
              reject(new Error(text || `HTTP ${xhr.status}`));
            }
          });
        } else {
          reject(new Error(`HTTP ${xhr.status} ${xhr.statusText || ""}`.trim()));
        }
      }
    };

    xhr.onerror = () => reject(new Error("Network error — is the backend reachable?"));
    xhr.ontimeout = () => reject(new Error("Request timed out"));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));

    signal.addEventListener("abort", () => xhr.abort(), { once: true });

    const form = new FormData();
    form.append("file", file);
    form.append("scale", String(settings.scale));
    form.append("format", settings.format);
    form.append("quality", String(settings.quality));
    xhr.send(form);
  });
}

function StatusBadge({ status }: { status: ImageStatus }) {
  if (status === "pending") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-800 px-2.5 py-0.5 text-xs font-medium text-gray-300">
        Pending
      </span>
    );
  }
  if (status === "processing") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-300">
        <Loader2 className="h-3 w-3 animate-spin" />
        Processing
      </span>
    );
  }
  if (status === "done") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
        <Check className="h-3 w-3" />
        Done
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2.5 py-0.5 text-xs font-medium text-rose-300">
      <AlertTriangle className="h-3 w-3" />
      Error
    </span>
  );
}

interface BeforeAfterProps {
  item: ImageItem;
  onClose: () => void;
}

function BeforeAfterModal({ item, onClose }: BeforeAfterProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative w-full max-w-6xl max-h-full overflow-y-auto rounded-2xl border border-gray-800 bg-gray-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 rounded-full bg-gray-900/90 p-2 text-gray-200 hover:bg-gray-800 transition-all duration-200"
          aria-label="Close preview"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="border-b border-gray-800 px-5 py-4">
          <h3 className="truncate text-base font-semibold text-white">{item.name}</h3>
          <p className="text-xs text-gray-500">Tap or click outside to dismiss</p>
        </div>
        <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2 md:p-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs uppercase tracking-wide text-gray-400">
              <span className="font-semibold text-gray-300">Original</span>
              <span>
                {item.originalDimensions
                  ? `${item.originalDimensions.width} × ${item.originalDimensions.height}`
                  : ""}
              </span>
            </div>
            <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
              <img src={item.previewUrl} alt="Original" className="h-auto w-full" />
            </div>
            <p className="text-xs text-gray-500">{formatBytes(item.originalSize)}</p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs uppercase tracking-wide text-gray-400">
              <span className="font-semibold text-purple-300">Upscaled</span>
              <span>
                {item.newDimensions
                  ? `${item.newDimensions.width} × ${item.newDimensions.height}`
                  : ""}
              </span>
            </div>
            <div className="overflow-hidden rounded-xl border border-purple-700/50 bg-gray-900 shadow-lg shadow-purple-900/30">
              {item.resultUrl ? (
                <img src={item.resultUrl} alt="Upscaled" className="h-auto w-full" />
              ) : (
                <div className="flex h-64 items-center justify-center text-gray-500">
                  No result
                </div>
              )}
            </div>
            <p className="text-xs text-emerald-300">
              {item.resultSize ? formatBytes(item.resultSize) : ""}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [settings, setSettings] = useState<Settings>({
    scale: 2,
    format: "jpg",
    quality: 90,
  });
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [modalId, setModalId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const imagesRef = useRef<ImageItem[]>([]);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(() => {
    return () => {
      imagesRef.current.forEach((item) => {
        URL.revokeObjectURL(item.previewUrl);
        if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
      });
      abortRef.current?.abort();
    };
  }, []);

  const pendingCount = useMemo(
    () => images.filter((i) => i.status === "pending" || i.status === "error").length,
    [images],
  );
  const doneCount = useMemo(
    () => images.filter((i) => i.status === "done").length,
    [images],
  );

  const updateItem = useCallback((id: string, patch: Partial<ImageItem>) => {
    setImages((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const handleUpload = useCallback(async (incoming: FileList | File[]) => {
    setGlobalError(null);
    const list = Array.from(incoming).filter((f) =>
      ["image/jpeg", "image/jpg", "image/png"].includes(f.type),
    );
    if (list.length === 0) {
      setGlobalError("Only JPG and PNG images are supported.");
      return;
    }
    const newItems: ImageItem[] = list.map((file) => ({
      id: newId(),
      file,
      name: file.name,
      originalSize: file.size,
      previewUrl: URL.createObjectURL(file),
      status: "pending",
      progress: 0,
    }));
    setImages((prev) => [...prev, ...newItems]);

    // Read dimensions asynchronously
    await Promise.all(
      newItems.map(async (item) => {
        const dims = await readImageDimensions(item.file);
        updateItem(item.id, { originalDimensions: dims });
      }),
    );
  }, [updateItem]);

  const handleFilePick = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      void handleUpload(e.target.files);
      e.target.value = "";
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void handleUpload(e.dataTransfer.files);
    }
  };

  const handleUpscaleSingle = useCallback(
    async (id: string) => {
      const target = imagesRef.current.find((it) => it.id === id);
      if (!target) return;
      const controller = abortRef.current ?? new AbortController();
      if (!abortRef.current) abortRef.current = controller;

      updateItem(id, { status: "processing", progress: 0, error: undefined });
      try {
        const { blob } = await upscaleRequest(
          target.file,
          settings,
          (pct) => updateItem(id, { progress: pct }),
          controller.signal,
        );
        const previousUrl = imagesRef.current.find((it) => it.id === id)?.resultUrl;
        if (previousUrl) URL.revokeObjectURL(previousUrl);
        const resultUrl = URL.createObjectURL(blob);
        const dims = await readBlobDimensions(blob);
        updateItem(id, {
          status: "done",
          progress: 1,
          result: blob,
          resultUrl,
          resultSize: blob.size,
          newDimensions: dims,
          error: undefined,
        });
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        updateItem(id, {
          status: "error",
          progress: 0,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    },
    [settings, updateItem],
  );

  const handleUpscaleAll = useCallback(async () => {
    if (isProcessing) return;
    const queue = imagesRef.current.filter(
      (it) => it.status === "pending" || it.status === "error",
    );
    if (queue.length === 0) return;
    setIsProcessing(true);
    setGlobalError(null);
    abortRef.current = new AbortController();
    try {
      for (const item of queue) {
        if (abortRef.current.signal.aborted) break;
        await handleUpscaleSingle(item.id);
      }
    } finally {
      setIsProcessing(false);
      abortRef.current = null;
    }
  }, [isProcessing, handleUpscaleSingle]);

  const handleDownloadSingle = (id: string) => {
    const item = imagesRef.current.find((it) => it.id === id);
    if (!item?.result) return;
    const ext = settings.format === "jpg" ? "jpg" : "png";
    const baseName = item.name.replace(/\.[^.]+$/, "");
    saveAs(item.result, `${baseName}_upscaled_${settings.scale}x.${ext}`);
  };

  const handleDownloadAll = async () => {
    const finished = imagesRef.current.filter((it) => it.status === "done" && it.result);
    if (finished.length === 0) return;
    const zip = new JSZip();
    const ext = settings.format === "jpg" ? "jpg" : "png";
    finished.forEach((item) => {
      const baseName = item.name.replace(/\.[^.]+$/, "");
      zip.file(`${baseName}_upscaled_${settings.scale}x.${ext}`, item.result as Blob);
    });
    const blob = await zip.generateAsync({ type: "blob" });
    saveAs(blob, `pixelboost_${settings.scale}x.zip`);
  };

  const handleRemove = (id: string) => {
    setImages((prev) => {
      const target = prev.find((it) => it.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
        if (target.resultUrl) URL.revokeObjectURL(target.resultUrl);
      }
      return prev.filter((it) => it.id !== id);
    });
  };

  const handleClearAll = () => {
    abortRef.current?.abort();
    imagesRef.current.forEach((item) => {
      URL.revokeObjectURL(item.previewUrl);
      if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
    });
    setImages([]);
    setGlobalError(null);
  };

  const openModal = (id: string) => {
    const item = imagesRef.current.find((it) => it.id === id);
    if (item?.status === "done") setModalId(id);
  };

  const modalItem = modalId ? images.find((it) => it.id === modalId) ?? null : null;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="relative overflow-hidden bg-gradient-to-r from-violet-900 via-purple-900 to-indigo-900">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "radial-gradient(60% 60% at 20% 10%, rgba(236,72,153,0.35) 0%, transparent 50%), radial-gradient(60% 60% at 80% 30%, rgba(59,130,246,0.35) 0%, transparent 50%)",
          }}
        />
        <div className="relative mx-auto flex max-w-6xl flex-col items-start gap-2 px-5 py-8 sm:px-8 sm:py-10">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/10 ring-1 ring-white/15 backdrop-blur">
              <Sparkles className="h-6 w-6 text-white" />
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
              PixelBoost
            </h1>
          </div>
          <p className="max-w-xl text-sm text-violet-100/85 sm:text-base">
            Free unlimited image upscaler. Boost JPG and PNG up to 6× — all processing happens
            on our servers so your phone doesn&apos;t break a sweat.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-10 space-y-6">
        {/* Upload Zone */}
        <section
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`group cursor-pointer rounded-2xl border-2 border-dashed bg-gray-900/60 transition-all duration-200 ${
            isDragging
              ? "border-purple-400 bg-purple-500/10"
              : "border-gray-700 hover:border-purple-500/70 hover:bg-gray-900"
          }`}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
          }}
        >
          <div className="flex flex-col items-center justify-center gap-3 px-5 py-10 text-center sm:py-14">
            <div
              className={`grid h-14 w-14 place-items-center rounded-2xl transition-all duration-200 ${
                isDragging ? "bg-purple-500/30 text-purple-100" : "bg-gray-800 text-purple-300"
              }`}
            >
              <Upload className="h-7 w-7" />
            </div>
            <div>
              <p className="text-base font-semibold text-white sm:text-lg">
                {isDragging ? "Drop to add images" : "Tap or drop images to upload"}
              </p>
              <p className="mt-1 text-xs text-gray-400 sm:text-sm">
                JPG or PNG · multiple files supported · no size limit
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png"
              multiple
              className="hidden"
              onChange={handleFilePick}
            />
          </div>
        </section>

        {globalError && (
          <div className="rounded-xl border border-rose-500/50 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {globalError}
          </div>
        )}

        {/* Settings Bar */}
        <section className="rounded-2xl border border-gray-800 bg-gray-900 p-4 shadow-lg sm:p-5">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Scale
              </span>
              <div className="flex rounded-full bg-gray-800 p-1">
                {SCALE_OPTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSettings((prev) => ({ ...prev, scale: s }))}
                    className={`min-h-[36px] min-w-[44px] rounded-full px-3 text-sm font-semibold transition-all duration-200 ${
                      settings.scale === s
                        ? "bg-purple-600 text-white shadow-md shadow-purple-900/40"
                        : "text-gray-300 hover:text-white"
                    }`}
                    aria-pressed={settings.scale === s}
                  >
                    {s}×
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Format
              </span>
              <div className="flex rounded-full bg-gray-800 p-1">
                {FORMAT_OPTIONS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setSettings((prev) => ({ ...prev, format: f }))}
                    className={`min-h-[36px] min-w-[52px] rounded-full px-3 text-sm font-semibold uppercase transition-all duration-200 ${
                      settings.format === f
                        ? "bg-purple-600 text-white shadow-md shadow-purple-900/40"
                        : "text-gray-300 hover:text-white"
                    }`}
                    aria-pressed={settings.format === f}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {settings.format === "jpg" && (
              <div className="flex min-w-[200px] flex-1 items-center gap-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Quality
                </span>
                <input
                  type="range"
                  min={1}
                  max={100}
                  value={settings.quality}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, quality: Number(e.target.value) }))
                  }
                  className="h-6 flex-1"
                  aria-label="JPEG quality"
                />
                <span className="w-8 text-right text-sm font-semibold text-purple-300 tabular-nums">
                  {settings.quality}
                </span>
              </div>
            )}
          </div>
        </section>

        {/* Action Buttons */}
        <section className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void handleUpscaleAll()}
            disabled={pendingCount === 0 || isProcessing}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-purple-900/30 transition-all duration-200 hover:bg-purple-700 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-500 disabled:shadow-none sm:flex-none"
          >
            {isProcessing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Upscaling…
              </>
            ) : (
              <>
                <Zap className="h-4 w-4" />
                Upscale All
                {pendingCount > 0 && (
                  <span className="ml-1 rounded-full bg-purple-800/70 px-2 py-0.5 text-xs">
                    {pendingCount}
                  </span>
                )}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => void handleDownloadAll()}
            disabled={doneCount === 0}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-emerald-900/30 transition-all duration-200 hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-500 disabled:shadow-none sm:flex-none"
          >
            <Download className="h-4 w-4" />
            Download ZIP
            {doneCount > 0 && (
              <span className="ml-1 rounded-full bg-emerald-800/70 px-2 py-0.5 text-xs">
                {doneCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={handleClearAll}
            disabled={images.length === 0}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-gray-800 px-4 py-2 text-sm font-semibold text-gray-200 transition-all duration-200 hover:bg-rose-600 hover:text-white disabled:cursor-not-allowed disabled:bg-gray-900 disabled:text-gray-600"
          >
            <Trash2 className="h-4 w-4" />
            Clear All
          </button>
        </section>

        {/* Image Queue */}
        {images.length === 0 ? (
          <section className="rounded-2xl border border-dashed border-gray-800 bg-gray-900/40 px-6 py-12 text-center text-gray-500">
            <ImageIcon className="mx-auto mb-3 h-8 w-8 text-gray-700" />
            No images yet. Drop or pick some files above to get started.
          </section>
        ) : (
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {images.map((item) => (
              <article
                key={item.id}
                className="group relative overflow-hidden rounded-xl border border-gray-800 bg-gray-900 shadow-lg transition-all duration-200 hover:border-purple-700/60 hover:shadow-purple-900/30"
              >
                <button
                  type="button"
                  onClick={() => handleRemove(item.id)}
                  className="absolute right-2 top-2 z-10 rounded-full bg-gray-950/80 p-1.5 text-gray-300 transition-all duration-200 hover:bg-rose-600 hover:text-white"
                  aria-label="Remove image"
                >
                  <X className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => openModal(item.id)}
                  disabled={item.status !== "done"}
                  className="block w-full focus:outline-none"
                  aria-label={item.status === "done" ? "Open before/after preview" : item.name}
                >
                  <div className="relative aspect-[4/3] w-full overflow-hidden bg-gray-800">
                    <img
                      src={item.resultUrl ?? item.previewUrl}
                      alt={item.name}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                    />
                    {item.status === "processing" && (
                      <div className="absolute inset-0 grid place-items-center bg-black/40 backdrop-blur-[1px]">
                        <Loader2 className="h-8 w-8 animate-spin text-purple-300" />
                      </div>
                    )}
                  </div>
                </button>

                <div className="space-y-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="truncate text-sm font-semibold text-white" title={item.name}>
                      {item.name}
                    </h4>
                    <StatusBadge status={item.status} />
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span>{formatBytes(item.originalSize)}</span>
                    {item.originalDimensions && item.originalDimensions.width > 0 && (
                      <span>
                        {item.originalDimensions.width} × {item.originalDimensions.height}
                      </span>
                    )}
                  </div>

                  {item.status === "processing" && (
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
                      <div
                        className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 transition-all duration-200"
                        style={{ width: `${Math.round(item.progress * 100)}%` }}
                      />
                    </div>
                  )}

                  {item.status === "done" && item.newDimensions && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-emerald-300">
                        → {item.newDimensions.width} × {item.newDimensions.height}
                      </span>
                      <span className="text-emerald-300">
                        {item.resultSize ? formatBytes(item.resultSize) : ""}
                      </span>
                    </div>
                  )}

                  {item.status === "error" && (
                    <p className="text-xs text-rose-300" title={item.error}>
                      {item.error ?? "Failed to upscale"}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2 pt-1">
                    {item.status === "done" && (
                      <button
                        type="button"
                        onClick={() => handleDownloadSingle(item.id)}
                        className="inline-flex min-h-[36px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white transition-all duration-200 hover:bg-emerald-700"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download
                      </button>
                    )}
                    {(item.status === "pending" || item.status === "error") && (
                      <button
                        type="button"
                        onClick={() => void handleUpscaleSingle(item.id)}
                        disabled={isProcessing}
                        className="inline-flex min-h-[36px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-purple-600 px-3 text-xs font-semibold text-white transition-all duration-200 hover:bg-purple-700 disabled:bg-gray-800 disabled:text-gray-500"
                      >
                        <Zap className="h-3.5 w-3.5" />
                        Upscale
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </section>
        )}
      </main>

      <footer className="border-t border-gray-900 px-4 py-6 text-center text-xs text-gray-500 sm:py-8">
        PixelBoost · 100% Free · No Limits · No Sign-up Required
      </footer>

      {modalItem && <BeforeAfterModal item={modalItem} onClose={() => setModalId(null)} />}
    </div>
  );
}
