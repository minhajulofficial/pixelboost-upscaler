# PixelBoost

> Free unlimited image upscaler. Upload JPG/PNG, pick a 2×/4×/6× scale, and get
> a crisp upscaled copy back — all heavy lifting runs on the server so your
> phone never breaks a sweat.

## Features

- **2×, 4×, 6× upscaling** powered by Pillow's LANCZOS resampler.
- **Subtle finishing pass**: unsharp mask + a touch of contrast and saturation
  for a clean, modern look.
- **Bulk upload + ZIP download** via JSZip.
- **Unlimited usage** — no sign-up, no watermark, no daily limit.
- **Server-side processing** — the browser doesn't transcode pixels, so even
  budget Android phones can upscale 12 MP photos.
- **Mobile-first dark UI** built with React, TypeScript, and Tailwind CSS.

## Repository layout

```
.
├── backend/    FastAPI + Pillow image-processing API (Poetry)
└── frontend/   React + Vite + Tailwind upscaler UI
```

## Quick start

### Backend (Python 3.12, Poetry)

```bash
cd backend
poetry install
poetry run fastapi dev app/main.py     # http://localhost:8000
```

Endpoints:

| Method | Path             |
| ------ | ---------------- |
| GET    | `/healthz`       |
| POST   | `/upscale`       |
| POST   | `/upscale-bulk`  |

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

For production, point this at your deployed Fly.io backend.

## Deployment

Full walkthrough — including Cloudflare Pages settings and a comparison of Render / Railway / Fly.io for the backend — lives in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

One-click backend deploys:

- **Render** — [`render.yaml`](render.yaml) at the repo root; click [Deploy to Render](https://render.com/deploy?repo=https://github.com/minhajulofficial/pixelboost-upscaler).
- **Railway** — [`backend/railway.toml`](backend/railway.toml); set the service's root directory to `backend` in the Railway UI.
- **Fly.io** — [`backend/fly.toml`](backend/fly.toml); `cd backend && fly launch --no-deploy --copy-config && fly deploy`.

The frontend is a static Vite bundle (`npm run build` → `dist/`) and goes on Cloudflare Pages, Vercel, Netlify, etc. Make sure to set `VITE_API_URL` to your deployed backend URL **before** building.

## License

MIT
