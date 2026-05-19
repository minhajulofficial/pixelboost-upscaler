"""PixelBoost backend — image upscaling service.

Two modes are supported:

``fast`` (default)
    Pure Pillow pipeline: open → LANCZOS resize → mild unsharp/contrast/
    saturation finishing pass → encode. Runs in milliseconds with negligible
    memory, but cannot recover or invent detail — it is a classical resampler.

``ai``
    Real-ESRGAN inference is offloaded to a HuggingFace Space (configured via
    ``PIXELBOOST_HF_SPACE``). We send the input to the Space via
    ``gradio_client``, receive the upscaled image, then re-encode in the
    requested format/quality so the response shape matches ``fast`` mode.
    Slower (20-90s per image on free CPU) but produces real, detail-rich
    upscales.

The ``/upscale-bulk`` endpoint loops over files using the same mode and
returns a ZIP archive.

AI mode also exposes an asynchronous job API (``POST /jobs/upscale-ai``,
``GET /jobs/{id}``, ``GET /jobs/{id}/result``) which lets the client poll
for a result instead of holding open a single long HTTP request. This
bypasses the ~100s Cloudflare/Render edge timeout that otherwise drops
slow AI requests partway through.
"""

from __future__ import annotations

import asyncio
import io
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

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from PIL import Image, ImageEnhance, ImageFilter, UnidentifiedImageError

logger = logging.getLogger("pixelboost")
logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    # Start the AI job worker on app startup so /jobs/upscale-ai submissions
    # can be drained in the background while HTTP requests continue to be
    # served. Stop it on shutdown.
    await _start_jobs_worker()
    try:
        yield
    finally:
        await _stop_jobs_worker()


app = FastAPI(
    title="PixelBoost API",
    description="Free unlimited image upscaler.",
    version="1.0.0",
    lifespan=_lifespan,
)

# CORS — keep wide open so the static frontend (Cloudflare Pages, Vercel, etc.)
# can call the API directly. Do not remove.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

ALLOWED_SCALES: set[int] = {2, 4}
ALLOWED_FORMATS: set[str] = {"jpg", "jpeg", "png"}
ALLOWED_MODES: set[str] = {"fast", "ai"}
# Output cap kept conservative for the 512MB-RAM free tier. With 4× capped at
# the top of the supported range, a 1080p input lands at ~33MP which is well
# under the 40MP guard. The cap still protects against pathologically large
# inputs that would otherwise OOM-kill the worker and surface as a generic
# "Network error" in the browser.
MAX_OUTPUT_PIXELS = int(os.environ.get("PIXELBOOST_MAX_OUTPUT_PIXELS", str(40_000_000)))
AI_MAX_INPUT_PIXELS = 4_000_000  # AI mode is CPU-only on HF free tier; keep inputs sane
# Pillow's default DecompressionBomb threshold is ~89 megapixels; raise it a bit
# for large inputs but keep DOS protection on.
Image.MAX_IMAGE_PIXELS = 200_000_000

HF_SPACE = os.environ.get("PIXELBOOST_HF_SPACE", "").strip()
HF_TOKEN = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")

_hf_client = None  # gradio_client.Client, lazily initialised
_hf_client_created_at: float = 0.0
_hf_client_lock = threading.Lock()
# Re-create the gradio_client periodically. Long-lived Client instances have
# been observed to drop their session/websocket state after extended idle,
# which then makes subsequent .predict() calls fail with cryptic errors.
HF_CLIENT_TTL_SECONDS = float(os.environ.get("PIXELBOOST_HF_CLIENT_TTL", "300"))

# Async-job-queue state for AI mode. The worker is a single asyncio task
# that pulls job ids off the queue and runs ``gradio_client.predict`` in a
# background thread (so the HTTP event loop stays responsive to /jobs/{id}
# polls). HF Space concurrency is 1 anyway, so a single worker matches the
# upstream capacity.
MAX_ACTIVE_JOBS = int(os.environ.get("PIXELBOOST_MAX_ACTIVE_JOBS", "32"))
JOB_TTL_SECONDS = float(os.environ.get("PIXELBOOST_JOB_TTL", "600"))
MAX_JOB_INPUT_BYTES = int(os.environ.get("PIXELBOOST_MAX_JOB_INPUT_BYTES", str(20 * 1024 * 1024)))

JobStatus = Literal["queued", "running", "done", "error"]


Scale = Literal[2, 4]
Format = Literal["jpg", "jpeg", "png"]
Mode = Literal["fast", "ai"]


@dataclass(slots=True)
class UpscaleResult:
    """In-memory result of one upscale operation."""

    filename: str
    content_type: str
    data: bytes


@dataclass
class AiJob:
    """Server-side state for one async AI upscale request.

    The ``file_bytes`` field is cleared once the worker has finished with the
    input so completed/errored jobs don't keep multi-MB blobs alive past
    their useful life.
    """

    id: str
    status: JobStatus
    progress: float
    filename: str
    scale: int
    fmt: str
    quality: int
    created_at: float
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


def _validate_mode(mode: str) -> str:
    mode = mode.lower().strip()
    if mode not in ALLOWED_MODES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported mode {mode!r}. Use one of {sorted(ALLOWED_MODES)}.",
        )
    if mode == "ai" and not HF_SPACE:
        raise HTTPException(
            status_code=503,
            detail="AI mode is not configured on this backend (PIXELBOOST_HF_SPACE missing).",
        )
    return mode


def _output_filename(original: str, scale: int, fmt: str) -> str:
    stem = original.rsplit("/", 1)[-1]
    if "." in stem:
        stem = stem.rsplit(".", 1)[0]
    if not stem:
        stem = "image"
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
        # Suggest the highest scale that *would* fit for this input. Gives the
        # user something concrete to do instead of just "try smaller".
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
    """LANCZOS upscale with light finishing.

    The finishing pass (unsharp + contrast + saturation) is applied to the
    *small* input image first, then a single LANCZOS resize produces the
    final output. Doing it in this order keeps peak memory roughly equal to
    one copy of the target image (~100 MB for 4× of 1080p) instead of two,
    which matters on the 512 MB free tier where OOM kills surface to the
    browser as a generic "Network error".
    """
    new_w, new_h = image.width * scale, image.height * scale
    sharpened = image.filter(ImageFilter.UnsharpMask(radius=2, percent=150, threshold=3))
    contrasted = ImageEnhance.Contrast(sharpened).enhance(1.05)
    sharpened = None  # type: ignore[assignment]  # let GC free the intermediate
    colored = ImageEnhance.Color(contrasted).enhance(1.02)
    contrasted = None  # type: ignore[assignment]
    return colored.resize((new_w, new_h), resample=Image.Resampling.LANCZOS)


def _build_hf_client():
    try:
        from gradio_client import Client
    except ImportError as exc:  # pragma: no cover - dependency missing
        raise HTTPException(
            status_code=503,
            detail="AI mode unavailable: gradio_client not installed.",
        ) from exc
    logger.info("Connecting to HuggingFace Space %s", HF_SPACE)
    # The token kwarg was renamed between gradio_client releases
    # (older: ``hf_token``, newer: ``token``). Try both for compat.
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


def _upscale_ai(image: Image.Image, scale: int, filename: str) -> Image.Image:
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
        except ImportError:  # pragma: no cover - older gradio_client
            handle_file = lambda p: p  # type: ignore[assignment]
        try:
            result_path = client.predict(
                image=handle_file(tmp_path),
                scale=int(scale),
                api_name="/upscale",
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("HF Space inference failed for %s", filename)
            raise HTTPException(
                status_code=502,
                detail=f"AI upscaling failed: {exc}",
            ) from exc
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


def _upscale_image(
    file_bytes: bytes,
    filename: str,
    scale: int,
    fmt: str,
    quality: int,
    mode: str = "fast",
) -> UpscaleResult:
    image = _open_image(file_bytes, filename)
    _enforce_output_cap(image, scale)

    if mode == "ai":
        finished = _upscale_ai(image, scale, filename)
    else:
        finished = _upscale_fast(image, scale)

    data = _encode(finished, fmt, quality)
    content_type = "image/jpeg" if fmt == "jpg" else "image/png"
    return UpscaleResult(
        filename=_output_filename(filename, scale, fmt),
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
            # ``gradio_client.predict`` is blocking; offload to a thread so the
            # event loop continues to service /jobs/{id} polls and /healthz.
            result = await asyncio.to_thread(
                _upscale_image,
                job.file_bytes,
                job.filename,
                job.scale,
                job.fmt,
                job.quality,
                "ai",
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
    """Drop completed/errored jobs older than ``JOB_TTL_SECONDS``.

    Called opportunistically on each /jobs/{id} read so we don't need a
    separate timer task. Active (queued/running) jobs are never collected.
    """
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
# HTTP endpoints
# ---------------------------------------------------------------------------


@app.get("/healthz")
def healthz() -> dict[str, str | bool | int]:
    with _jobs_lock:
        active = _count_active_jobs_locked()
    return {"status": "ok", "ai_available": bool(HF_SPACE), "ai_jobs_active": active}


@app.get("/")
def root() -> JSONResponse:
    return JSONResponse(
        {
            "name": "PixelBoost API",
            "endpoints": [
                "/healthz",
                "/upscale",
                "/upscale-bulk",
                "/jobs/upscale-ai",
                "/jobs/{id}",
                "/jobs/{id}/result",
            ],
            "modes": sorted(ALLOWED_MODES),
            "ai_available": bool(HF_SPACE),
        }
    )


@app.post("/upscale")
async def upscale(
    file: UploadFile = File(...),
    scale: int = Form(2),
    format: str = Form("jpg"),
    quality: int = Form(90),
    mode: str = Form("fast"),
) -> StreamingResponse:
    scale = _validate_scale(scale)
    fmt = _normalize_format(format)
    quality = _validate_quality(quality)
    mode = _validate_mode(mode)

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty upload")

    result = _upscale_image(raw, file.filename or "image", scale, fmt, quality, mode)

    return StreamingResponse(
        io.BytesIO(result.data),
        media_type=result.content_type,
        headers={
            "Content-Disposition": f'attachment; filename="{result.filename}"',
            "Content-Length": str(len(result.data)),
            "X-PixelBoost-Mode": mode,
        },
    )


@app.post("/upscale-bulk")
async def upscale_bulk(
    files: list[UploadFile] = File(...),
    scale: int = Form(2),
    format: str = Form("jpg"),
    quality: int = Form(90),
    mode: str = Form("fast"),
) -> StreamingResponse:
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")

    scale = _validate_scale(scale)
    fmt = _normalize_format(format)
    quality = _validate_quality(quality)
    mode = _validate_mode(mode)

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
                result = _upscale_image(raw, name, scale, fmt, quality, mode)
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
    file: UploadFile = File(...),
    scale: int = Form(2),
    format: str = Form("jpg"),
    quality: int = Form(90),
) -> JSONResponse:
    """Submit an AI upscale request and return immediately with a ``job_id``.

    Clients should poll ``GET /jobs/{job_id}`` until ``status`` is ``done`` or
    ``error``, then fetch the bytes from ``GET /jobs/{job_id}/result``. This
    decouples long-running inference from the HTTP request lifecycle, so the
    ~100s Cloudflare/Render edge timeout no longer terminates slow AI jobs.
    """
    if _jobs_queue is None:
        raise HTTPException(status_code=503, detail="Job worker not started yet. Try again in a moment.")

    scale = _validate_scale(scale)
    fmt = _normalize_format(format)
    quality = _validate_quality(quality)
    # AI mode requires HF Space; reuse _validate_mode for the 503 path.
    _validate_mode("ai")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty upload")
    if len(raw) > MAX_JOB_INPUT_BYTES:
        raise HTTPException(
            status_code=413,
            detail=(
                f"Image too large for async AI mode ({len(raw) // 1_000_000} MB > "
                f"{MAX_JOB_INPUT_BYTES // 1_000_000} MB cap)."
            ),
        )

    # Validate input dimensions / decode early so the client gets a fast,
    # actionable 400 instead of a queued job that immediately errors.
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
            "X-PixelBoost-Mode": "ai",
            "X-PixelBoost-Job-Id": job.id,
        },
    )
