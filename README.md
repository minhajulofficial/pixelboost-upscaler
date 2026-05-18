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

- **Backend** — Fly.io free tier. `fly launch` inside `backend/`, then `fly deploy`.
- **Frontend** — Cloudflare Pages or any static host. Build command
  `npm run build`, output `dist/`.

## License

MIT
