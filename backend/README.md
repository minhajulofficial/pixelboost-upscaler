# PixelBoost Backend

FastAPI service that upscales images. Two engines, four modes:

| mode       | engine                                             | quality / speed              |
| ---------- | -------------------------------------------------- | ---------------------------- |
| `fast`     | Pillow LANCZOS + sharpening pass                   | instant, no new detail       |
| `ai-fast`  | Real-ESRGAN `realesr-general-x4v3` (HF Space)      | good, ~15-40s free CPU       |
| `ai-plus`  | Real-ESRGAN `RealESRGAN_x4plus` (HF Space)         | best, ~30-120s free CPU      |
| `anime`    | Real-ESRGAN `x4plus_anime_6B` (HF Space)           | tuned for illustrations      |

All AI modes support `face=1` (CPU-safe face-refine pass on the output).

## Endpoints

| Method | Path              | Purpose                                    |
| ------ | ----------------- | ------------------------------------------ |
| GET    | `/healthz`        | Liveness probe.                            |
| GET    | `/warm-ai`        | Keep-alive hook (see cron below).          |
| GET    | `/version`        | Deployed commit + feature surface.         |
| POST   | `/upscale`        | Upscale a single image.                    |
| POST   | `/upscale-bulk`   | Upscale many images → ZIP archive.         |
| POST   | `/jobs/upscale-ai`| Async AI job (returns `job_id`).           |
| GET    | `/jobs/{id}`      | Poll a job.                                |
| GET    | `/jobs/{id}/result` | Job result bytes.                        |
| POST   | `/workers/register` | Colab GPU worker registration.           |
| GET    | `/workers`        | List registered GPU workers.               |

`POST` endpoints accept multipart fields: `scale` (`2|3|4|6|8`), `format`
(`jpg|png`), `quality` (`1-100`), `mode` (`fast|ai-fast|ai-plus|anime`), `face`
(`true|false`).

## Environment variables

| Variable                        | Purpose                                                          |
| ------------------------------- | ---------------------------------------------------------------- |
| `PIXELBOOST_HF_SPACE`           | HF Space name hosting the AI model (required for AI modes).      |
| `HF_TOKEN` / `HUGGINGFACE_TOKEN`| Optional HF token (private Spaces).                              |
| `PIXELBOOST_SHARED_TOKEN`       | When set, upscale endpoints require `X-PixelBoost-Token`.        |
| `PIXELBOOST_COLAB_SECRET`       | When set, enables GPU worker registration.                       |
| `PIXELBOOST_CACHE_DIR`          | On-disk result cache location (default: system temp).            |
| `FIREBASE_ADMIN_SDK_JSON`       | Optional service account JSON → mirror cache to Firebase Storage.|
| `FIREBASE_STORAGE_BUCKET`       | Bucket to mirror cached results into.                            |
| `PIXELBOOST_AI_RATE_LIMIT`      | Per-IP AI requests / minute (default `10`).                      |

Firebase mirroring is optional: install the extra (`poetry install -E cache`),
set the two Firebase env vars, and cached results survive restarts.

## Keep-alive / warm cron

The repo ships `.github/workflows/keep-alive.yml` (GitHub Actions, every 10
min). It wakes the Render free instance via `/healthz` and pokes `/warm-ai`,
which sends a tiny probe to the HF Space so the Real-ESRGAN model stays loaded.
Edit the workflows file to point at your actual backend URL.

## Optional GPU accelerator (Colab T4)

Run `colab/pixelboost_t4_turbo.ipynb` on a free Google Colab GPU session. It
registers itself with the backend; AI jobs then route to the T4 (fast) and
fall back to the HF CPU Space automatically if the session dies.

## Run locally

```bash
poetry install
poetry run fastapi dev app/main.py   # http://localhost:8000
```

## Deploy

Render (free): use the one-click blueprint:
<https://render.com/deploy?repo=https://github.com/minhajulofficial/pixelboost-upscaler>
or `fly deploy` / `railway up` for the other hosts in this repo.