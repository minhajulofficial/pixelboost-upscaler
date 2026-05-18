# PixelBoost Backend

FastAPI service that upscales images using Pillow's LANCZOS resampler plus a
light sharpening / contrast / saturation finishing pass. All image processing
happens server-side so the client (phone or laptop) does no work.

## Endpoints

| Method | Path             | Purpose                                   |
| ------ | ---------------- | ----------------------------------------- |
| GET    | `/healthz`       | Liveness probe.                           |
| POST   | `/upscale`       | Upscale a single image. Returns the image bytes. |
| POST   | `/upscale-bulk`  | Upscale many images. Returns a ZIP archive.       |

All `POST` endpoints accept the multipart form fields:

- `scale` — `2`, `4`, or `6` (default `2`)
- `format` — `jpg` or `png` (default `jpg`)
- `quality` — `1`–`100` (JPEG quality, default `90`)

## Run locally

```bash
poetry install
poetry run fastapi dev app/main.py
```

The server starts on http://localhost:8000.

## Deploy to Fly.io

```bash
fly launch        # accept the defaults, do not deploy yet
fly deploy
```
