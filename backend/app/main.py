"""PixelBoost backend — image upscaling service.

All processing happens here so the browser does no work. The pipeline is:

1. Open the upload with Pillow.
2. Resize to ``width * scale`` × ``height * scale`` using LANCZOS resampling.
3. Apply a mild unsharp-mask + contrast/saturation finishing pass.
4. Encode in the requested format/quality and stream the bytes back.

The ``/upscale-bulk`` endpoint does the same for many files in parallel and
returns a ZIP archive.
"""

from __future__ import annotations

import io
import logging
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
MAX_OUTPUT_PIXELS = 80_000_000  # ~80 megapixels output cap to avoid OOM on free tier
# Pillow's default DecompressionBomb threshold is ~89 megapixels; raise it a bit
# for large inputs but keep DOS protection on.
Image.MAX_IMAGE_PIXELS = 200_000_000


Scale = Literal[2, 4, 6]
Format = Literal["jpg", "jpeg", "png"]


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


def _upscale_image(file_bytes: bytes, filename: str, scale: int, fmt: str, quality: int) -> UpscaleResult:
    try:
        image = Image.open(io.BytesIO(file_bytes))
        image.load()
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status_code=400, detail=f"Invalid or corrupt image: {filename}") from exc

    new_w, new_h = image.width * scale, image.height * scale
    if new_w * new_h > MAX_OUTPUT_PIXELS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Output too large ({new_w}×{new_h}). "
                f"Pick a smaller image or lower scale (max ~{MAX_OUTPUT_PIXELS // 1_000_000} MP)."
            ),
        )

    resized = image.resize((new_w, new_h), resample=Image.Resampling.LANCZOS)
    sharpened = resized.filter(ImageFilter.UnsharpMask(radius=2, percent=150, threshold=3))
    contrasted = ImageEnhance.Contrast(sharpened).enhance(1.05)
    finished = ImageEnhance.Color(contrasted).enhance(1.02)

    data = _encode(finished, fmt, quality)
    content_type = "image/jpeg" if fmt == "jpg" else "image/png"
    return UpscaleResult(
        filename=_output_filename(filename, scale, fmt),
        content_type=content_type,
        data=data,
    )


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/")
def root() -> JSONResponse:
    return JSONResponse(
        {
            "name": "PixelBoost API",
            "endpoints": ["/healthz", "/upscale", "/upscale-bulk"],
        }
    )


@app.post("/upscale")
async def upscale(
    file: UploadFile = File(...),
    scale: int = Form(2),
    format: str = Form("jpg"),
    quality: int = Form(90),
) -> StreamingResponse:
    scale = _validate_scale(scale)
    fmt = _normalize_format(format)
    quality = _validate_quality(quality)

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty upload")

    result = _upscale_image(raw, file.filename or "image", scale, fmt, quality)

    return StreamingResponse(
        io.BytesIO(result.data),
        media_type=result.content_type,
        headers={
            "Content-Disposition": f'attachment; filename="{result.filename}"',
            "Content-Length": str(len(result.data)),
        },
    )


@app.post("/upscale-bulk")
async def upscale_bulk(
    files: list[UploadFile] = File(...),
    scale: int = Form(2),
    format: str = Form("jpg"),
    quality: int = Form(90),
) -> StreamingResponse:
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")

    scale = _validate_scale(scale)
    fmt = _normalize_format(format)
    quality = _validate_quality(quality)

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
                result = _upscale_image(raw, name, scale, fmt, quality)
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
            report += f"Succeeded: {successes}\nFailed: {len(errors)}\n\n"
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
        },
    )
