"""PixelBoost backend — image upscaling service.

Modes:

``fast`` (default)
    Pure Pillow pipeline: open → LANCZOS resize → mild unsharp/contrast/
    saturation finishing pass → encode. Milliseconds, negligible memory.

``ai-fast``
    Real-ESRGAN ``realesr-general-x4v3`` via the HuggingFace Space — fast,
    detail-rich general upscales (~15-40s on free CPU).

``ai-plus``
    Real-ESRGAN ``RealESRGAN_x4plus`` via the Space — best quality, slower.
    ``ai`` is accepted as an alias for ``ai-plus`` (backward compat).

``anime``
    Real-ESRGAN ``RealESRGAN_x4plus_anime_6B`` via the Space — tuned for
    illustrations / anime.

All AI modes additionally support a ``face`` flag: when enabled the Space
runs a CPU-safe face-refine pass (Haar face detection + CLAHE/unsharp) on the
upscaled output.

Scales: 2 / 3 / 4 / 6 / 8. The Space natively upscales 4x; other targets are
reached by a native 4x pass + LANCZOS resize. 8x additionally chains a second
4x pass on tiny inputs (when the intermediate fits the Space input cap).

Protection & stability:

- ``PIXELBOOST_SHARED_TOKEN`` — if set, multi-part upscale endpoints require
  the header ``X-PixelBoost-Token`` (or ``Authorization: Bearer``). The
  static frontend normally goes through a serverless proxy (Vercel
  ``/api/upscale-proxy``) which injects the token server-side, so the token
  never ships to browsers.
- ``/warm-ai`` — lightweight keep-alive hook. A GitHub Actions cron hits
  ``/healthz`` + ``/warm-ai`` every ~10 minutes so the free Render instance and
  the HF Space model stay warm (avoids 20-60s cold starts on real requests).
- Result cache — output bytes are memoized on disk keyed by a hash of
  (image + mode + model + face + scale + format + quality). Re-requests return
  instantly. If Firebase Admin is configured (``FIREBASE_ADMIN_SDK_JSON``,
  ``FIREBASE_STORAGE_BUCKET``) the blob is also mirrored to Storage so the
  cache survives restarts (best-effort).
- Optional GPU workers: free-runner Colab notebooks can register themselves
  via ``POST /workers/register`` (see ``colab/pixelboost_t4_turbo.ipynb``).
  AI jobs are routed to a registered GPU worker when one is healthy, else they
  fall back to the HF Space automatically.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import hashlib
import io
import json
import logging
import os
import tempfile
import threading
import time
import uuid
import zipfile
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Literal

from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from PIL import Image, ImageEnhance, ImageFilter, ImageStat, UnidentifiedImageError

logger = logging.getLogger("pixelboost")
logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    # Start the AI job worker on app startup so /jobs/upscale-ai submissions
    # can be drained in the background. Stop it on shutdown.
    await _start_jobs_worker()
    try:
        yield
    finally:
        await _stop_jobs_worker()


app = FastAPI(
    title="PixelBoost API",
    description="Free unlimited image upscaler.",
    version="2.0.0",
    lifespan=_lifespan,
)

# CORS — keep wide open so the static frontend (Cloudflare Pages, Vercel, etc.)
# can call the API directly.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

ALLOWED_SCALES: set[int] = {2, 3, 4, 6, 8}
ALLOWED_FORMATS: set[str] = {"jpg", "jpeg", "png"}
# ``ai`` is kept as a backward-compatible alias for ``ai-plus``.
ALLOWED_MODES: set[str] = {"fast", "ai-fast", "ai-plus", "anime", "ai"}
# mode -> HF Space model key
MODE_MODEL: dict[str, str] = {
    "ai-fast": "x4v3",
    "ai-plus": "x4plus",
    "anime": "anime",
}
# Output cap kept conservative for the 512MB-RAM free tier.
MAX_OUTPUT_PIXELS = int(os.environ.get("PIXELBOOST_MAX_OUTPUT_PIXELS", str(40_000_000)))
AI_MAX_INPUT_PIXELS = int(os.environ.get("PIXELBOOST_AI_MAX_INPUT_PIXELS", str(4_000_000)))
# Hard cap for one Space inference round-trip. gradio_client.predict has no
# built-in timeout, so a stale session or a hung Space call would otherwise
# block the single AI job worker forever and jam the whole queue.
AI_CALL_TIMEOUT_SECONDS = int(os.environ.get("PIXELBOOST_AI_CALL_TIMEOUT", "480"))
# Pillow's default DecompressionBomb threshold is ~89 megapixels; raise it a bit
# for large inputs but keep DOS protection on.
Image.MAX_IMAGE_PIXELS = 200_000_000

HF_SPACE = os.environ.get("PIXELBOOST_HF_SPACE", "").strip()
HF_TOKEN = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")

# Shared token protection (optional). When set, upscale endpoints require it.
SHARED_TOKEN = os.environ.get("PIXELBOOST_SHARED_TOKEN", "").strip()
# Token for peer GPU workers (Colab notebook) to identify themselves.
COLAB_SECRET = os.environ.get("PIXELBOOST_COLAB_SECRET", "").strip()

# GG-Face style cache: disk + optional Firebase Storage mirror.
CACHE_DIR = os.environ.get("PIXELBOOST_CACHE_DIR", os.path.join(tempfile.gettempdir(), "pixelboost-cache"))
CACHE_MAX_BYTES = int(os.environ.get("PIXELBOOST_CACHE_MAX_BYTES", str(400 * 1024 * 1024)))

_hf_client = None  # gradio_client.Client, lazily initialised
_hf_client_created_at: float = 0.0
_hf_client_lock = threading.Lock()
# Re-create the gradio_client periodically. Long-lived Client instances have
# been observed to drop their session/websocket state after extended idle.
HF_CLIENT_TTL_SECONDS = float(os.environ.get("PIXELBOOST_HF_CLIENT_TTL", "300"))

# Pool for wrapping gradio_client.predict calls with a hard timeout.
_predict_pool = concurrent.futures.ThreadPoolExecutor(max_workers=2)

MAX_ACTIVE_JOBS = int(os.environ.get("PIXELBOOST_MAX_ACTIVE_JOBS", "32"))
JOB_TTL_SECONDS = float(os.environ.get("PIXELBOOST_JOB_TTL", "600"))
MAX_JOB_INPUT_BYTES = int(os.environ.get("PIXELBOOST_MAX_JOB_INPUT_BYTES", str(20 * 1024 * 1024)))
AI_JOB_INPUT_BYTES = int(os.environ.get("PIXELBOOST_AI_JOB_INPUT_BYTES", str(12 * 1024 * 1024)))

JobStatus = Literal["queued", "running", "done", "error"]
Scale = Literal[2, 3, 4, 6, 8]

# Build/deploy identifiers exposed at /version.
GIT_COMMIT = (
    os.environ.get("RENDER_GIT_COMMIT")
    or os.environ.get("GIT_COMMIT")
    or os.environ.get("COMMIT_SHA")
    or "unknown"
)
GIT_BRANCH = os.environ.get("RENDER_GIT_BRANCH") or os.environ.get("GIT_BRANCH") or "unknown"


@dataclass(slots=True)
class UpscaleResult:
    filename: str
    content_type: str
    data: bytes
    from_cache: bool = False


@dataclass
class AiJob:
    id: str
    status: JobStatus
    progress: float
    filename: str
    scale: int
    fmt: str
    quality: int
    mode: str
    created_at: float
    face: bool = False
    file_bytes: bytes = b""
    started_at: float | None = None
    finished_at: float | None = None
    result_filename: str | None = None
    result_content_type: str | None = None
    result_data: bytes | None = None
    error: str | None = None


_jobs: dict[str, AiJob] = {}
_jobs_lock = threading.Lock()
_jobs_queue: asyncio.Queue[str] | None = None
_jobs_worker_task: asyncio.Task[None] | None = None

# ---------------------------------------------------------------------------
# Shared-token + naive per-IP rate limiter (free-tier abuse protection)
# ---------------------------------------------------------------------------

_hit_counts: dict[str, list[float]] = {}
_hit_lock = threading.Lock()
AI_RATE_LIMIT_PER_MIN = int(os.environ.get("PIXELBOOST_AI_RATE_LIMIT", "10"))


def _require_token(token: str | None) -> None:
    if not SHARED_TOKEN:
        return
    provided = token if token is not None else ""
    if provided.startswith("Bearer "):
        provided = provided[len("Bearer ") :].strip()
    if provided != SHARED_TOKEN:
        raise HTTPException(status_code=401, detail="Missing or invalid access token.")


def _rate_limit_ai(ip: str) -> None:
    """Sliding-window per-IP limit on AI endpoints, best-effort."""
    now = time.monotonic()
    window = 60.0
    with _hit_lock:
        bucket = _hit_counts.setdefault(ip, [])
        bucket[:] = [t for t in bucket if now - t < window]
        if len(bucket) >= AI_RATE_LIMIT_PER_MIN:
            raise HTTPException(
                status_code=429,
                detail="Too many AI upscales from this IP. Please wait a minute.",
            )
        bucket.append(now)
        if len(_hit_counts) > 10_000:
            for key in [k for k, v in _hit_counts.items() if not v]:
                del _hit_counts[key]


def _client_ip(request_headers: dict[str, str]) -> str:
    for key in ("x-forwarded-for", "x-real-ip"):
        value = request_headers.get(key)
        if value:
            return value.split(",")[0].strip()
    return "unknown"


# ---------------------------------------------------------------------------
# Result cache (disk LRU + optional Firebase Storage mirror)
# ---------------------------------------------------------------------------


def _cache_key(
    file_bytes: bytes, mode: str, model: str, face: bool, scale: int, fmt: str, quality: int
) -> str:
    digest = hashlib.sha256(
        file_bytes
        + b"\x00"
        + f"{mode}|{model}|{face}|{scale}|{fmt}|{quality}".encode()
    ).hexdigest()
    return digest


def _ensure_cache_dir() -> None:
    os.makedirs(CACHE_DIR, exist_ok=True)


def _disk_cache_get(key: str, ext: str) -> bytes | None:
    _ensure_cache_dir()
    path = os.path.join(CACHE_DIR, f"{key}.{ext}")
    try:
        with open(path, "rb") as fh:
            return fh.read()
    except OSError:
        return None


def _disk_cache_set(key: str, ext: str, data: bytes) -> None:
    _ensure_cache_dir()
    path = os.path.join(CACHE_DIR, f"{key}.{ext}")
    try:
        tmp = path + ".tmp"
        with open(tmp, "wb") as fh:
            fh.write(data)
        os.replace(tmp, path)
    except OSError:
        return

    # Opportunistic LRU-ish trim of the oldest files past the byte cap.
    try:
        total = 0
        ranked: list[tuple[float, str]] = []
        for name in os.listdir(CACHE_DIR):
            full = os.path.join(CACHE_DIR, name)
            try:
                total += os.path.getsize(full)
                ranked.append((os.path.getmtime(full), full))
            except OSError:
                continue
        if total > CACHE_MAX_BYTES:
            for _, full in sorted(ranked):
                if total <= CACHE_MAX_BYTES:
                    break
                try:
                    total -= os.path.getsize(full)
                    os.unlink(full)
                except OSError:
                    continue
    except OSError:
        pass


def _firebase_blob_key(key: str, ext: str) -> str:
    return f"upscale/{key}.{ext}"


def _firebase_get(key: str, ext: str) -> bytes | None:
    """Optional Firebase Storage read-back (best-effort)."""
    try:
        from google.cloud import storage  # type: ignore
    except ImportError:
        return None
    creds_json = os.environ.get("FIREBASE_ADMIN_SDK_JSON", "").strip()
    bucket_name = os.environ.get("FIREBASE_STORAGE_BUCKET", "").strip()
    if not creds_json or not bucket_name:
        return None
    try:
        client = storage.Client.from_service_account_info(json.loads(creds_json))
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(_firebase_blob_key(key, ext))
        data = blob.download_as_bytes()
        _disk_cache_set(key, ext, data)
        return data
    except Exception as exc:  # noqa: BLE001
        logger.debug("Firebase cache read failed: %s", exc)
        return None


def _firebase_set(key: str, ext: str, data: bytes) -> None:
    try:
        from google.cloud import storage  # type: ignore
    except ImportError:
        return
    creds_json = os.environ.get("FIREBASE_ADMIN_SDK_JSON", "").strip()
    bucket_name = os.environ.get("FIREBASE_STORAGE_BUCKET", "").strip()
    if not creds_json or not bucket_name:
        return
    try:
        client = storage.Client.from_service_account_info(json.loads(creds_json))
        bucket = client.bucket(bucket_name)
        bucket.blob(_firebase_blob_key(key, ext)).upload_from_string(
            data, content_type="application/octet-stream"
        )
    except Exception as exc:  # noqa: BLE001
        logger.debug("Firebase cache write failed: %s", exc)


# ---------------------------------------------------------------------------
# GPU worker registry (self-hosted Colab free GPUs)
# ---------------------------------------------------------------------------

_workers: dict[str, dict[str, object]] = {}
_workers_lock = threading.Lock()
WORKER_TTL_SECONDS = float(os.environ.get("PIXELBOOST_WORKER_TTL", "90"))


def _gc_workers() -> None:
    now = time.monotonic()
    with _workers_lock:
        for wid in list(_workers.keys()):
            if now - float(_workers[wid]["last_seen"]) > WORKER_TTL_SECONDS:
                del _workers[wid]


def _pick_worker_for_mode(mode: str) -> str | None:
    if not COLAB_SECRET:
        return None
    _gc_workers()
    with _workers_lock:
        for wid, worker in _workers.items():
            if worker.get("busy"):
                continue
            if worker.get("mode") and worker["mode"] != mode:
                continue
            return str(worker["url"])
    return None


def _mark_worker_busy(url: str, busy: bool) -> None:
    with _workers_lock:
        for worker in _workers.values():
            if str(worker["url"]) == url:
                worker["busy"] = busy


def _call_colab_worker(
    url: str, file_bytes: bytes, filename: str, scale: int, mode: str, face: bool
) -> bytes | None:
    """Upscale via a registered Colab GPU worker. Returns bytes or None."""
    try:
        import httpx
    except ImportError:  # pragma: no cover
        logger.warning("httpx not installed; cannot call Colab worker")
        return None

    _mark_worker_busy(url, True)
    try:
        files = {
            "file": (filename, file_bytes, "application/octet-stream"),
        }
        response = httpx.post(
            f"{url.rstrip('/')}/upscale",
            files=files,
            data={"scale": scale, "mode": mode, "face": "1" if face else "0"},
            timeout=300,
        )
        response.raise_for_status()
        return response.content
    except Exception as exc:  # noqa: BLE001
        logger.warning("Colab worker %s failed: %s", url, exc)
        return None
    finally:
        _mark_worker_busy(url, False)


# ---------------------------------------------------------------------------
# Image helpers
# ---------------------------------------------------------------------------


def _normalize_format(fmt: str) -> str:
    fmt = fmt.lower().strip()
    if fmt == "jpeg":
        fmt = "jpg"
    if fmt not in {"jpg", "png"}:
        raise HTTPException(status_code=400, detail=f"Unsupported format: {fmt!r}")
    return fmt


def _validate_scale(scale: int) -> int:
    if scale not in ALLOWED_SCALES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported scale {scale}. Use one of {sorted(ALLOWED_SCALES)}.",
        )
    return scale


def _validate_quality(quality: int) -> int:
    if quality < 1 or quality > 100:
        raise HTTPException(status_code=400, detail="quality must be between 1 and 100")
    return quality


def _normalize_mode(mode: str) -> str:
    mode = mode.lower().strip()
    if mode == "ai":  # backward-compatible alias
        mode = "ai-plus"
    if mode not in {"fast", "ai-fast", "ai-plus", "anime"}:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported mode {mode!r}. Use one of fast | ai-fast | ai-plus | anime.",
        )
    if mode != "fast" and not HF_SPACE:
        raise HTTPException(
            status_code=503,
            detail="AI mode is not configured on this backend (PIXELBOOST_HF_SPACE missing).",
        )
    return mode


def _model_for_mode(mode: str) -> str:
    return MODE_MODEL.get(mode, "x4plus")


def _output_filename(original: str, scale: int, fmt: str, mode: str = "fast") -> str:
    stem = original.rsplit("/", 1)[-1]
    if "." in stem:
        stem = stem.rsplit(".", 1)[0]
    if not stem:
        stem = "image"
    if mode != "fast":
        return f"{stem}_upscaled_{mode}_{scale}x.{fmt}"
    return f"{stem}_upscaled_{scale}x.{fmt}"


def _encode(image: Image.Image, fmt: str, quality: int) -> bytes:
    buffer = io.BytesIO()
    if fmt == "jpg":
        if image.mode in {"RGBA", "LA", "P"}:
            background = Image.new("RGB", image.size, (255, 255, 255))
            if image.mode == "P":
                image = image.convert("RGBA")
            background.paste(image, mask=image.split()[-1] if image.mode in {"RGBA", "LA"} else None)
            image = background
        elif image.mode != "RGB":
            image = image.convert("RGB")
        image.save(buffer, format="JPEG", quality=quality, optimize=True, progressive=True)
        return buffer.getvalue()

    # PNG path
    if image.mode not in {"RGB", "RGBA", "L", "LA"}:
        image = image.convert("RGBA")
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def _open_image(file_bytes: bytes, filename: str) -> Image.Image:
    try:
        image = Image.open(io.BytesIO(file_bytes))
        image.load()
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status_code=400, detail=f"Invalid or corrupt image: {filename}") from exc
    return image


def _enforce_output_cap(image: Image.Image, scale: int) -> tuple[int, int]:
    new_w, new_h = image.width * scale, image.height * scale
    if new_w * new_h > MAX_OUTPUT_PIXELS:
        # Suggest the highest scale that *would* fit for this input.
        src_pixels = image.width * image.height
        suggested = None
        for s in sorted(ALLOWED_SCALES, reverse=True):
            if s < scale and src_pixels * s * s <= MAX_OUTPUT_PIXELS:
                suggested = s
                break
        suggestion = (
            f" Try {suggested}× instead, or shrink the source." if suggested else " Try a smaller source image."
        )
        raise HTTPException(
            status_code=400,
            detail=(
                f"Output too large at {scale}× ({new_w}×{new_h} ≈ "
                f"{(new_w * new_h) // 1_000_000} MP, cap ~{MAX_OUTPUT_PIXELS // 1_000_000} MP)."
                f"{suggestion}"
            ),
        )
    return new_w, new_h


def _upscale_fast(image: Image.Image, scale: int) -> Image.Image:
    """Classical upscale tuned for stable quality across photos and graphics."""
    new_w, new_h = image.width * scale, image.height * scale

    working = image if image.mode in {"RGB", "RGBA", "L"} else image.convert("RGB")

    if scale >= 4:
        mid = working.resize((image.width * 2, image.height * 2), resample=Image.Resampling.LANCZOS)
        upscaled = mid.resize((new_w, new_h), resample=Image.Resampling.LANCZOS)
    else:
        upscaled = working.resize((new_w, new_h), resample=Image.Resampling.LANCZOS)

    stats = ImageStat.Stat(upscaled.convert("RGB"))
    channel_means = stats.mean
    channel_spread = max(channel_means) - min(channel_means)
    is_low_chroma = channel_spread < 7.0

    sharpen_percent = 95 if is_low_chroma else (105 if scale == 2 else 125)
    sharpen_radius = 1.15 if is_low_chroma else 1.3
    sharpen_threshold = 3 if is_low_chroma else 2

    finished = upscaled.filter(
        ImageFilter.UnsharpMask(radius=sharpen_radius, percent=sharpen_percent, threshold=sharpen_threshold)
    )
    contrast_boost = 1.03 if is_low_chroma else 1.05
    color_boost = 1.00 if is_low_chroma else 1.02
    finished = ImageEnhance.Contrast(finished).enhance(contrast_boost)
    finished = ImageEnhance.Color(finished).enhance(color_boost)
    return finished


# ---------------------------------------------------------------------------
# HF Space client
# ---------------------------------------------------------------------------


def _build_hf_client():
    try:
        from gradio_client import Client
    except ImportError as exc:
        raise HTTPException(
            status_code=503,
            detail="AI mode unavailable: gradio_client not installed.",
        ) from exc
    logger.info("Connecting to HuggingFace Space %s", HF_SPACE)
    try:
        return Client(HF_SPACE, hf_token=HF_TOKEN, verbose=False)
    except TypeError:
        return Client(HF_SPACE, token=HF_TOKEN, verbose=False)


def _get_hf_client():
    global _hf_client, _hf_client_created_at
    now = time.monotonic()
    if _hf_client is not None and (now - _hf_client_created_at) < HF_CLIENT_TTL_SECONDS:
        return _hf_client
    with _hf_client_lock:
        now = time.monotonic()
        if _hf_client is None or (now - _hf_client_created_at) >= HF_CLIENT_TTL_SECONDS:
            _hf_client = _build_hf_client()
            _hf_client_created_at = now
    return _hf_client


def _call_hf_space(image: Image.Image, scale: int, model: str, face: bool, filename: str) -> Image.Image:
    """One Space inference round-trip, with retry + model-arg fallback."""
    if image.width * image.height > AI_MAX_INPUT_PIXELS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Input too large for AI mode ({image.width}×{image.height}). "
                f"Max ~{AI_MAX_INPUT_PIXELS // 1_000_000} MP. Pick a smaller "
                f"image or switch to Fast mode."
            ),
        )

    client = _get_hf_client()
    suffix = os.path.splitext(filename)[1].lower() or ".png"
    if suffix not in {".png", ".jpg", ".jpeg", ".webp"}:
        suffix = ".png"

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp_path = tmp.name
        image_to_send = image if image.mode in {"RGB", "RGBA"} else image.convert("RGB")
        image_to_send.save(tmp_path)

    try:
        try:
            from gradio_client import handle_file
        except ImportError:  # pragma: no cover
            handle_file = lambda p: p  # type: ignore[assignment]

        attempts = 2
        last_exc: Exception | None = None
        result_path = None

        def _predict_with_timeout(**kwargs):
            fut = _predict_pool.submit(
                lambda cl=current_client: cl.predict(**kwargs, api_name="/upscale")
            )
            fut.add_done_callback(lambda f: f.exception() if not f.cancelled() else None)
            try:
                return fut.result(timeout=AI_CALL_TIMEOUT_SECONDS)
            except concurrent.futures.TimeoutError:
                # Can't kill the orphaned thread; make sure the next call uses a
                # fresh client (the current one likely holds a dead session).
                global _hf_client, _hf_client_created_at
                with _hf_client_lock:
                    _hf_client = None
                    _hf_client_created_at = 0.0
                raise HTTPException(
                    status_code=504,
                    detail="AI upscaling timed out waiting for the HF Space.",
                )

        for attempt in range(1, attempts + 1):
            current_client = client if attempt == 1 else _build_hf_client()
            try:
                kwargs: dict[str, object] = {"image": handle_file(tmp_path), "scale": int(scale)}
                try:
                    # New Space API surface (model + face params).
                    kwargs["model"] = model
                    kwargs["face"] = face
                    result_path = _predict_with_timeout(**kwargs)
                except (TypeError, ValueError, KeyError) as exc:
                    msg = str(exc).lower()
                    # Older Space deployed without model/face inputs rejects
                    # unknown params with a message like "not defined in the
                    # endpoint's input" or "unknown parameter".
                    if any(t in msg for t in ("unexpected keyword", "unknown", "not defined", "not a valid input", "key-word argument", "keyword argument")):
                        result_path = _predict_with_timeout(
                            image=handle_file(tmp_path),
                            scale=int(scale),
                        )
                    else:
                        raise
                if attempt > 1:
                    global _hf_client, _hf_client_created_at
                    with _hf_client_lock:
                        _hf_client = current_client
                        _hf_client_created_at = time.monotonic()
                break
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                message = str(exc).lower()
                retryable = any(
                    token in message
                    for token in (
                        "read operation timed out",
                        "timed out",
                        "timeout",
                        "connection reset",
                        "connection aborted",
                        "server disconnected",
                    )
                )
                if attempt < attempts and retryable:
                    logger.warning(
                        "HF Space transient failure for %s (attempt %s/%s): %s",
                        filename,
                        attempt,
                        attempts,
                        exc,
                    )
                    continue
                logger.exception("HF Space inference failed for %s", filename)
                raise HTTPException(
                    status_code=502,
                    detail=f"AI upscaling failed: {exc}",
                ) from exc

        if result_path is None:
            raise HTTPException(status_code=502, detail=f"AI upscaling failed: {last_exc}")
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    try:
        result_img = Image.open(result_path)
        result_img.load()
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(
            status_code=502,
            detail="AI upscaling returned an unreadable image.",
        ) from exc
    return result_img


def _upscale_ai(image: Image.Image, scale: int, mode: str, filename: str, face: bool = False) -> Image.Image:
    """AI upscale with GPU-worker routing.

    The Space natively upscales 4x then resizes to any requested scale
    (2/3/4/6/8), so a single call covers every scale. (An earlier two-pass
    chain for 8x silently returned a 4x image whenever the 4x intermediate
    exceeded the Space input cap.)
    """
    model = _model_for_mode(mode)

    # Prefer a registered GPU worker (Colab T4) when one is healthy.
    worker_url = _pick_worker_for_mode(mode)
    if worker_url:
        buf = io.BytesIO()
        (image if image.mode in {"RGB", "RGBA"} else image.convert("RGB")).save(buf, format="PNG")
        data = _call_colab_worker(worker_url, buf.getvalue(), filename, scale, mode, face)
        if data is not None:
            try:
                result_img = Image.open(io.BytesIO(data))
                result_img.load()
                return result_img
            except (UnidentifiedImageError, OSError):
                logger.warning("Colab worker returned unreadable bytes; falling back to HF Space.")

    return _call_hf_space(image, scale, model, face, filename)


def _upscale_image(
    file_bytes: bytes,
    filename: str,
    scale: int,
    fmt: str,
    quality: int,
    mode: str,
    face: bool = False,
) -> UpscaleResult:
    image = _open_image(file_bytes, filename)
    _enforce_output_cap(image, scale)

    model = _model_for_mode(mode)
    key = _cache_key(file_bytes, mode, model, face, scale, fmt, quality)
    ext = "jpg" if fmt == "jpg" else "png"

    cached = _disk_cache_get(key, ext)
    if cached is None:
        cached = _firebase_get(key, ext)
    if cached is not None:
        content_type = "image/jpeg" if fmt == "jpg" else "image/png"
        return UpscaleResult(
            filename=_output_filename(filename, scale, fmt, mode),
            content_type=content_type,
            data=cached,
            from_cache=True,
        )

    if mode == "fast":
        finished = _upscale_fast(image, scale)
    else:
        finished = _upscale_ai(image, scale, mode, filename, face)

    data = _encode(finished, fmt, quality)
    _disk_cache_set(key, ext, data)
    _firebase_set(key, ext, data)

    content_type = "image/jpeg" if fmt == "jpg" else "image/png"
    return UpscaleResult(
        filename=_output_filename(filename, scale, fmt, mode),
        content_type=content_type,
        data=data,
    )


# ---------------------------------------------------------------------------
# Async-job machinery for AI mode
# ---------------------------------------------------------------------------


async def _start_jobs_worker() -> None:
    global _jobs_queue, _jobs_worker_task
    _jobs_queue = asyncio.Queue()
    _jobs_worker_task = asyncio.create_task(_jobs_worker_loop(), name="pixelboost-ai-worker")


async def _stop_jobs_worker() -> None:
    global _jobs_worker_task
    if _jobs_worker_task is None:
        return
    _jobs_worker_task.cancel()
    try:
        await _jobs_worker_task
    except (asyncio.CancelledError, Exception):  # noqa: BLE001
        pass
    _jobs_worker_task = None


async def _jobs_worker_loop() -> None:
    assert _jobs_queue is not None
    while True:
        job_id = await _jobs_queue.get()
        with _jobs_lock:
            job = _jobs.get(job_id)
            if job is None or job.status != "queued":
                continue
            job.status = "running"
            job.started_at = time.monotonic()
            job.progress = 0.1
        try:
            result = await asyncio.to_thread(
                _upscale_image,
                job.file_bytes,
                job.filename,
                job.scale,
                job.fmt,
                job.quality,
                job.mode,
                job.face,
            )
            with _jobs_lock:
                job.status = "done"
                job.progress = 1.0
                job.finished_at = time.monotonic()
                job.result_filename = result.filename
                job.result_content_type = result.content_type
                job.result_data = result.data
                job.file_bytes = b""  # free RAM
        except HTTPException as exc:
            with _jobs_lock:
                job.status = "error"
                job.error = str(exc.detail)
                job.finished_at = time.monotonic()
                job.file_bytes = b""
        except asyncio.CancelledError:
            with _jobs_lock:
                if job.status == "running":
                    job.status = "error"
                    job.error = "Worker cancelled"
                    job.finished_at = time.monotonic()
                    job.file_bytes = b""
            raise
        except Exception as exc:  # noqa: BLE001
            logger.exception("AI job %s failed", job_id)
            with _jobs_lock:
                job.status = "error"
                job.error = str(exc) or "Unknown error"
                job.finished_at = time.monotonic()
                job.file_bytes = b""


def _gc_jobs() -> None:
    now = time.monotonic()
    with _jobs_lock:
        for jid in list(_jobs.keys()):
            j = _jobs[jid]
            if j.finished_at is not None and (now - j.finished_at) > JOB_TTL_SECONDS:
                del _jobs[jid]


def _count_active_jobs_locked() -> int:
    return sum(1 for j in _jobs.values() if j.status in ("queued", "running"))


def _serialize_job(job: AiJob) -> dict[str, object]:
    payload: dict[str, object] = {
        "id": job.id,
        "status": job.status,
        "progress": round(job.progress, 4),
        "scale": job.scale,
        "format": job.fmt,
        "mode": job.mode,
        "filename": job.filename,
    }
    if job.error is not None:
        payload["error"] = job.error
    if job.status == "done":
        payload["result_url"] = f"/jobs/{job.id}/result"
        if job.result_filename:
            payload["result_filename"] = job.result_filename
    return payload


# ---------------------------------------------------------------------------
# Keep-alive / warm helpers
# ---------------------------------------------------------------------------

_warm_lock = threading.Lock()
_warm_in_progress = False


def _warm_ai_worker() -> None:
    global _warm_in_progress
    try:
        logger.info("warm-ai: sending a tiny probe to the HF Space...")
        probe = Image.new("RGB", (64, 64), (128, 128, 128))
        for warm_mode in ("ai-fast", "ai-plus", "anime"):
            _upscale_ai(probe, 2, warm_mode, "warm-probe.png")
        logger.info("warm-ai: probe completed, Space is warm.")
    except Exception as exc:  # noqa: BLE001
        logger.warning("warm-ai probe failed: %s", exc)
    finally:
        _warm_in_progress = False


# ---------------------------------------------------------------------------
# HTTP endpoints
# ---------------------------------------------------------------------------


@app.get("/healthz")
def healthz() -> dict[str, str | bool | int]:
    with _jobs_lock:
        active = _count_active_jobs_locked()
    with _workers_lock:
        workers = len(_workers)
    return {"status": "ok", "ai_available": bool(HF_SPACE), "ai_jobs_active": active, "gpu_workers": workers}


@app.get("/warm-ai")
def warm_ai() -> dict[str, object]:
    """Keep-alive hook for cron (GitHub Actions). Wakes Render and pokes the
    HF Space with a tiny probe so real requests don't hit cold starts."""
    if not HF_SPACE:
        return {"status": "ok", "note": "no AI space configured"}
    global _warm_in_progress
    with _warm_lock:
        if _warm_in_progress:
            return {"status": "already_warming"}
        _warm_in_progress = True
    threading.Thread(target=_warm_ai_worker, daemon=True).start()
    return {"status": "warming_started"}


@app.get("/version")
def version() -> dict[str, object]:
    return {
        "git_commit": GIT_COMMIT,
        "git_branch": GIT_BRANCH,
        "scales": sorted(ALLOWED_SCALES),
        "modes": ["fast", "ai-fast", "ai-plus", "anime"],
        "ai_available": bool(HF_SPACE),
        "max_output_pixels": MAX_OUTPUT_PIXELS,
        "ai_max_input_pixels": AI_MAX_INPUT_PIXELS,
    }


@app.get("/")
def root() -> JSONResponse:
    return JSONResponse(
        {
            "name": "PixelBoost API",
            "endpoints": [
                "/healthz",
                "/version",
                "/warm-ai",
                "/upscale",
                "/upscale-bulk",
                "/jobs/upscale-ai",
                "/jobs/{id}",
                "/jobs/{id}/result",
                "/workers/register",
                "/workers",
            ],
            "modes": ["fast", "ai-fast", "ai-plus", "anime"],
            "scales": sorted(ALLOWED_SCALES),
            "ai_available": bool(HF_SPACE),
            "git_commit": GIT_COMMIT,
        }
    )


@app.post("/upscale")
async def upscale(
    request: Request,
    file: UploadFile = File(...),
    scale: int = Form(2),
    format: str = Form("jpg"),
    quality: int = Form(90),
    mode: str = Form("fast"),
    face: bool = Form(False),
    x_pixelboost_token: str | None = Header(default=None, alias="X-PixelBoost-Token"),
    authorization: str | None = Header(default=None),
) -> StreamingResponse:
    _require_token(x_pixelboost_token or authorization)
    scale = _validate_scale(scale)
    fmt = _normalize_format(format)
    quality = _validate_quality(quality)
    mode = _normalize_mode(mode)
    if mode != "fast":
        _rate_limit_ai(_client_ip(dict(request.headers)))

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty upload")

    result = _upscale_image(raw, file.filename or "image", scale, fmt, quality, mode, face)

    return StreamingResponse(
        io.BytesIO(result.data),
        media_type=result.content_type,
        headers={
            "Content-Disposition": f'attachment; filename="{result.filename}"',
            "Content-Length": str(len(result.data)),
            "X-PixelBoost-Mode": mode,
            "X-PixelBoost-Cache": "1" if result.from_cache else "0",
        },
    )


@app.post("/upscale-bulk")
async def upscale_bulk(
    request: Request,
    files: list[UploadFile] = File(...),
    scale: int = Form(2),
    format: str = Form("jpg"),
    quality: int = Form(90),
    mode: str = Form("fast"),
    face: bool = Form(False),
    x_pixelboost_token: str | None = Header(default=None, alias="X-PixelBoost-Token"),
    authorization: str | None = Header(default=None),
) -> StreamingResponse:
    _require_token(x_pixelboost_token or authorization)
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")

    scale = _validate_scale(scale)
    fmt = _normalize_format(format)
    quality = _validate_quality(quality)
    mode = _normalize_mode(mode)
    if mode != "fast":
        _rate_limit_ai(_client_ip(dict(request.headers)))

    archive_buffer = io.BytesIO()
    errors: list[dict[str, str]] = []
    successes = 0

    with zipfile.ZipFile(archive_buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for upload in files:
            raw = await upload.read()
            name = upload.filename or "image"
            if not raw:
                errors.append({"file": name, "error": "empty upload"})
                continue
            try:
                result = _upscale_image(raw, name, scale, fmt, quality, mode, face)
            except HTTPException as exc:
                errors.append({"file": name, "error": str(exc.detail)})
                continue
            except Exception as exc:  # noqa: BLE001
                logger.exception("Failed to upscale %s", name)
                errors.append({"file": name, "error": str(exc)})
                continue
            zf.writestr(result.filename, result.data)
            successes += 1

        if errors:
            report = "PixelBoost ZIP report\n=====================\n"
            report += f"Succeeded: {successes}\nFailed: {len(errors)}\nMode: {mode}\n\n"
            for item in errors:
                report += f"- {item['file']}: {item['error']}\n"
            zf.writestr("_errors.txt", report)

    if successes == 0:
        raise HTTPException(status_code=400, detail="No images could be upscaled.")

    archive_buffer.seek(0)
    return StreamingResponse(
        archive_buffer,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="pixelboost_{scale}x.zip"',
            "X-PixelBoost-Succeeded": str(successes),
            "X-PixelBoost-Failed": str(len(errors)),
            "X-PixelBoost-Mode": mode,
        },
    )


@app.post("/jobs/upscale-ai", status_code=202)
async def submit_ai_job(
    request: Request,
    file: UploadFile = File(...),
    scale: int = Form(2),
    format: str = Form("jpg"),
    quality: int = Form(90),
    mode: str = Form("ai-fast"),
    face: bool = Form(False),
    x_pixelboost_token: str | None = Header(default=None, alias="X-PixelBoost-Token"),
    authorization: str | None = Header(default=None),
) -> JSONResponse:
    """Submit an AI upscale request and return immediately with a ``job_id``."""
    _require_token(x_pixelboost_token or authorization)
    if _jobs_queue is None:
        raise HTTPException(status_code=503, detail="Job worker not started yet. Try again in a moment.")

    scale = _validate_scale(scale)
    fmt = _normalize_format(format)
    quality = _validate_quality(quality)
    mode = _normalize_mode(mode)
    _rate_limit_ai(_client_ip(dict(request.headers)))

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty upload")
    if len(raw) > AI_JOB_INPUT_BYTES:
        raise HTTPException(
            status_code=413,
            detail=(
                f"Image too large for async AI mode ({len(raw) // 1_000_000} MB > "
                f"{AI_JOB_INPUT_BYTES // 1_000_000} MB cap)."
            ),
        )

    probe = _open_image(raw, file.filename or "image")
    _enforce_output_cap(probe, scale)
    if probe.width * probe.height > AI_MAX_INPUT_PIXELS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Input too large for AI mode ({probe.width}×{probe.height} "
                f"≈ {(probe.width * probe.height) // 1_000_000} MP; cap "
                f"{AI_MAX_INPUT_PIXELS // 1_000_000} MP). Use fast mode for large sources."
            ),
        )

    with _jobs_lock:
        if _count_active_jobs_locked() >= MAX_ACTIVE_JOBS:
            raise HTTPException(
                status_code=429,
                detail="Server is busy with AI upscales right now. Please retry shortly.",
            )
        job_id = uuid.uuid4().hex
        job = AiJob(
            id=job_id,
            status="queued",
            progress=0.0,
            filename=file.filename or "image",
            scale=scale,
            fmt=fmt,
            quality=quality,
            mode=mode,
            face=face,
            created_at=time.monotonic(),
            file_bytes=raw,
        )
        _jobs[job_id] = job
    _jobs_queue.put_nowait(job_id)

    with _jobs_lock:
        queue_position = sum(
            1 for j in _jobs.values() if j.status == "queued" and j.created_at <= job.created_at
        )

    payload = _serialize_job(job)
    payload["queue_position"] = queue_position
    return JSONResponse(payload, status_code=202)


@app.get("/jobs/{job_id}")
async def get_job_status(job_id: str) -> JSONResponse:
    _gc_jobs()
    with _jobs_lock:
        job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found or expired.")
    return JSONResponse(_serialize_job(job))


@app.get("/jobs/{job_id}/result")
async def get_job_result(job_id: str) -> StreamingResponse:
    with _jobs_lock:
        job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found or expired.")
    if job.status != "done" or job.result_data is None:
        raise HTTPException(
            status_code=409,
            detail=f"Job is not ready (status={job.status}). Poll /jobs/{{id}} first.",
        )
    assert job.result_content_type is not None
    assert job.result_filename is not None
    return StreamingResponse(
        io.BytesIO(job.result_data),
        media_type=job.result_content_type,
        headers={
            "Content-Disposition": f'attachment; filename="{job.result_filename}"',
            "Content-Length": str(len(job.result_data)),
            "X-PixelBoost-Mode": job.mode,
            "X-PixelBoost-Job-Id": job.id,
        },
    )


# ---------------------------------------------------------------------------
# GPU worker registration (Colab notebook peers)
# ---------------------------------------------------------------------------


@app.post("/workers/register", status_code=200)
async def register_worker(
    url: str = Form(...),
    secret: str = Form(...),
    mode: str = Form("ai-plus"),
) -> JSONResponse:
    """Called periodically by self-hosted Colab notebooks to announce they are
    alive and ready to accept jobs. Workers expire after 90s without a refresh."""
    if not COLAB_SECRET:
        raise HTTPException(status_code=404, detail="Peer workers are not enabled on this instance.")
    if secret != COLAB_SECRET:
        raise HTTPException(status_code=401, detail="Invalid worker secret.")
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="URL must be absolute.")
    if mode not in {"ai-fast", "ai-plus", "anime"}:
        raise HTTPException(status_code=400, detail="Worker mode must be an AI mode.")

    worker_id = hashlib.sha256(url.encode()).hexdigest()[:12]
    with _workers_lock:
        _workers[worker_id] = {
            "url": url,
            "mode": mode,
            "busy": False,
            "last_seen": time.monotonic(),
        }
    return JSONResponse({"worker_id": worker_id, "registered": True, "ttl": WORKER_TTL_SECONDS})


@app.get("/workers")
async def list_workers() -> JSONResponse:
    _gc_workers()
    with _workers_lock:
        items = [
            {
                "id": wid,
                "url": w["url"],
                "mode": w.get("mode"),
                "busy": w.get("busy"),
                "last_seen_seconds_ago": round(time.monotonic() - float(w["last_seen"]), 1),
            }
            for wid, w in sorted(_workers.items())
        ]
    return JSONResponse({"workers": items, "enabled": bool(COLAB_SECRET)})