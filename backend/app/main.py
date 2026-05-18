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
"""

from __future__ import annotations

import io
import logging
import os
import tempfile
import threading
import zipfile
from dataclasses import dataclass
from typing import Literal

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from PIL import Image, ImageEnhance, ImageFilter, UnidentifiedImageError

logger = logging.getLogger("pixelboost")
logging.basicConfig(level=logging.INFO)

app = FastAPI(
    title="PixelBoost API",
    description="Free unlimited image upscaler.",
    version="1.0.0",
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

ALLOWED_SCALES: set[int] = {2, 4, 6}
ALLOWED_FORMATS: set[str] = {"jpg", "jpeg", "png"}
ALLOWED_MODES: set[str] = {"fast", "ai"}
MAX_OUTPUT_PIXELS = 80_000_000  # ~80 megapixels output cap to avoid OOM on free tier
AI_MAX_INPUT_PIXELS = 4_000_000  # AI mode is CPU-only on HF free tier; keep inputs sane
# Pillow's default DecompressionBomb threshold is ~89 megapixels; raise it a bit
# for large inputs but keep DOS protection on.
Image.MAX_IMAGE_PIXELS = 200_000_000

HF_SPACE = os.environ.get("PIXELBOOST_HF_SPACE", "").strip()
HF_TOKEN = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")

_hf_client = None  # gradio_client.Client, lazily initialised
_hf_client_lock = threading.Lock()


Scale = Literal[2, 4, 6]
Format = Literal["jpg", "jpeg", "png"]
Mode = Literal["fast", "ai"]


@dataclass(slots=True)
class UpscaleResult:
    """In-memory result of one upscale operation."""

    filename: str
    content_type: str
    data: bytes


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
        raise HTTPException(
            status_code=400,
            detail=(
                f"Output too large ({new_w}×{new_h}). "
                f"Pick a smaller image or lower scale (max ~{MAX_OUTPUT_PIXELS // 1_000_000} MP)."
            ),
        )
    return new_w, new_h


def _upscale_fast(image: Image.Image, scale: int) -> Image.Image:
    new_w, new_h = image.width * scale, image.height * scale
    resized = image.resize((new_w, new_h), resample=Image.Resampling.LANCZOS)
    sharpened = resized.filter(ImageFilter.UnsharpMask(radius=2, percent=150, threshold=3))
    contrasted = ImageEnhance.Contrast(sharpened).enhance(1.05)
    return ImageEnhance.Color(contrasted).enhance(1.02)


def _get_hf_client():
    global _hf_client
    if _hf_client is not None:
        return _hf_client
    with _hf_client_lock:
        if _hf_client is None:
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
                _hf_client = Client(HF_SPACE, hf_token=HF_TOKEN, verbose=False)
            except TypeError:
                _hf_client = Client(HF_SPACE, token=HF_TOKEN, verbose=False)
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


@app.get("/healthz")
def healthz() -> dict[str, str | bool]:
    return {"status": "ok", "ai_available": bool(HF_SPACE)}


@app.get("/")
def root() -> JSONResponse:
    return JSONResponse(
        {
            "name": "PixelBoost API",
            "endpoints": ["/healthz", "/upscale", "/upscale-bulk"],
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
