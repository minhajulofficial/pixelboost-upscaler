# PixelBoost

> Free unlimited image upscaler. Upload JPG/PNG, pick a 2×/4×/6×/8× scale, and get
> a crisp upscaled copy back. Two engines: instant **Fast** (Pillow LANCZOS) and
> real-detail **AI Enhance** (Real-ESRGAN on a HuggingFace Space).

## Features

- **Two engines, one toggle:**
  - **Fast** — Pillow LANCZOS + mild unsharp/contrast/saturation finishing
    pass. Runs in milliseconds, no AI, can't invent missing detail.
  - **AI Enhance** — Real-ESRGAN (`realesr-general-x4v3`) inference offloaded
    to a free HuggingFace Space. 20–90 s per image, recovers real texture.
- **2×, 4×, 6×, and 8× scales** in either engine.
- **Bulk upload + ZIP download** via JSZip.
- **Unlimited usage** — no sign-up, no watermark, no daily limit.
  (Per-image limits still apply for free-tier stability: Fast mode caps
  output at **40 MP** total pixels, AI mode caps input at **4 MP** since the
  HuggingFace Space is CPU-only. Inputs above these are rejected with a
  clear 400. The frontend will pre-warn before submit when possible.)
- **Server-side processing** — the browser doesn't transcode pixels, so even
  budget Android phones can upscale 12 MP photos.
- **Mobile-first dark UI** built with React, TypeScript, and Tailwind CSS.

## Repository layout

```
.
├── backend/    FastAPI + Pillow image-processing API (Poetry)
├── frontend/   React + Vite + Tailwind upscaler UI
└── hf-space/   Gradio + Real-ESRGAN HuggingFace Space (AI mode worker)
```

## Quick start

### Backend (Python 3.12, Poetry)

```bash
cd backend
poetry install
poetry run fastapi dev app/main.py     # http://localhost:8000
```

Endpoints:

| Method | Path                   | Notes                                                                            |
| ------ | ---------------------- | -------------------------------------------------------------------------------- |
| GET    | `/healthz`             | reports `ai_available` + `ai_jobs_active`                                        |
| GET    | `/version`             | reports `git_commit`, supported `scales`/`modes`, caps — use to detect deploy drift |
| POST   | `/upscale`             | form: `file`, `scale`, `format`, `quality`, `mode` (`fast`/`ai`)                 |
| POST   | `/upscale-bulk`        | same fields, returns ZIP archive                                                 |
| POST   | `/jobs/upscale-ai`     | async AI mode — returns `202` + `job_id`. Use this to avoid 100 s edge timeouts. |
| GET    | `/jobs/{id}`           | poll for `queued`/`running`/`done`/`error` + `progress`                          |
| GET    | `/jobs/{id}/result`    | fetch the bytes once the job is `done`                                           |

For AI mode, set `PIXELBOOST_HF_SPACE` (e.g. `minhajulofficial/pixelboost-upscaler`)
on the backend. Without it, `mode=ai` requests return HTTP 503.

### Frontend (Node 20+)

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

Set the backend URL in `frontend/.env`:

```
VITE_API_URL=http://localhost:8000
```

For production, point this at your deployed Render/Fly.io backend.

### AI Enhance worker (HuggingFace Space)

The `hf-space/` directory is the source of truth for the Gradio app that runs
Real-ESRGAN. To deploy/update:

```bash
cd hf-space
pip install -r requirements.txt
python app.py        # local sanity check (downloads model on first run)
```

Push to HuggingFace via `huggingface_hub`:

```bash
huggingface-cli login   # paste a write token
huggingface-cli upload-large-folder minhajulofficial/pixelboost-upscaler . --repo-type=space
```

Then set `PIXELBOOST_HF_SPACE=minhajulofficial/pixelboost-upscaler` on the
backend host (Render, Fly, …).

## Deployment

Full walkthrough — including Cloudflare Pages settings and a comparison of Render / Railway / Fly.io for the backend — lives in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

One-click backend deploys:

- **Render** — [`render.yaml`](render.yaml) at the repo root; click [Deploy to Render](https://render.com/deploy?repo=https://github.com/minhajulofficial/pixelboost-upscaler).
- **Railway** — [`backend/railway.toml`](backend/railway.toml); set the service's root directory to `backend` in the Railway UI.
- **Fly.io** — [`backend/fly.toml`](backend/fly.toml); `cd backend && fly launch --no-deploy --copy-config && fly deploy`.

The frontend is a static Vite bundle (`npm run build` → `dist/`) and goes on Cloudflare Pages, Vercel, Netlify, etc. Make sure to set `VITE_API_URL` to your deployed backend URL **before** building.

## License

MIT
