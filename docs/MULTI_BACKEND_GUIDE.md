# PixelBoost Multi-Backend + HuggingFace Guide

A complete guide to deploying multiple PixelBoost backend servers, adding HuggingFace Spaces, and scaling for unlimited use.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [How It All Connects](#2-how-it-all-connects)
3. [Deploy Your First Backend (Render)](#3-deploy-your-first-backend-render)
4. [Deploy Your Own HuggingFace Space](#4-deploy-your-own-huggingface-space)
5. [Deploy Multiple Backend Servers](#5-deploy-multiple-backend-servers)
6. [Add HF Spaces to Your Backend](#6-add-hf-spaces-to-your-backend)
7. [GPU Workers (Colab T4)](#7-gpu-workers-colab-t4)
8. [Frontend Server Pool Configuration](#8-frontend-server-pool-configuration)
9. [Auth Token Setup](#9-auth-token-setup)
10. [Performance Comparison](#10-performance-comparison)
11. [Scaling Strategy](#11-scaling-strategy)
12. [Environment Variables Reference](#12-environment-variables-reference)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (React)                        │
│                                                                 │
│  serverPool.ts ──► Server 1 (Render) ──► HF Space (CPU)        │
│       │          ► Server 2 (Railway) ──► Colab T4 (GPU)       │
│       │          ► Server 3 (Fly.io)  ──► HF Space (CPU)       │
│       │                                                         │
│       └── load balancing: lowest jobsCount wins                 │
└─────────────────────────────────────────────────────────────────┘
```

**Three independent pieces:**

| Component | What it does | Where to host |
|-----------|-------------|---------------|
| **Frontend** | React SPA (upload, settings, download) | Vercel / Cloudflare Pages / Netlify |
| **Backend** | FastAPI server — routes jobs, auth, caching | Render / Railway / Fly.io |
| **HF Space** | Real-ESRGAN AI inference (Gradio) | HuggingFace (free CPU) |

Optional 4th piece:
| **GPU Worker** | Colab T4 notebook — fast GPU inference | Google Colab (free) |

---

## 2. How It All Connects

### Request Flow (Server Engine)

```
User clicks "Upscale" in browser
    │
    ▼
Frontend (serverPool.ts)
    ├── Picks best server (lowest active jobs)
    ├── Adds Authorization header (Bearer token)
    │
    ▼
Backend (FastAPI on Render)
    ├── Checks auth token (PIXELBOOST_SHARED_TOKEN)
    ├── Checks rate limit (10 req/min per IP)
    ├── Checks cache (disk + optional Firebase)
    │
    ├── If "fast" mode → Pillow LANCZOS (instant, no AI)
    │
    └── If AI mode (ai-fast / ai-plus / anime):
        ├── Try GPU Worker first (Colab T4 via /workers/register)
        │   └── If worker available → fast (1-2s on T4)
        │
        └── Fallback to HF Space (gradio_client.predict)
            └── Calls your HuggingFace Space's /upscale API
                └── Real-ESRGAN inference on free CPU (15-120s)
```

### Key Points

- **Backend is stateless** — no user data, no credits. Auth is frontend-only (Supabase).
- **HF Space does the actual AI work** — the backend just orchestrates.
- **GPU Workers are optional** — they accelerate AI modes but aren't required.
- **Frontend manages the server pool** — client-side load balancing.

---

## 3. Deploy Your First Backend (Render)

### Option A: One-Click Deploy

Click this button (must be logged into Render):

```
https://render.com/deploy?repo=https://github.com/minhajulofficial/pixelboost-upscaler
```

### Option B: Manual Deploy

1. Fork the repo to your GitHub.

2. Create a new **Web Service** on Render:
   - **Environment:** Docker
   - **Dockerfile:** `backend/Dockerfile`
   - **Region:** Oregon (or closest to your users)
   - **Plan:** Free (512MB RAM, sleeps after 15 min)

3. Set environment variables:

| Variable | Value |
|----------|-------|
| `PIXELBOOST_HF_SPACE` | `your-username/pixelboost-upscaler` (your HF Space name) |
| `HF_TOKEN` | (optional) your HuggingFace token for private Spaces |
| `PIXELBOOST_SHARED_TOKEN` | a random string (e.g., `my-secret-token-123`) |
| `PIXELBOOST_COLAB_SECRET` | (optional) same as what Colab notebooks will use |

4. Deploy. Your backend is now live at `https://your-service.onrender.com`.

### Verify

```bash
curl https://your-service.onrender.com/healthz
# Should return: {"status":"ok","ai_available":true,...}
```

---

## 4. Deploy Your Own HuggingFace Space

The HF Space runs Real-ESRGAN inference on free CPU. You get your own so you control the cold starts and don't depend on a shared Space.

### Steps

1. **Create a new HuggingFace account** at https://huggingface.co

2. **Create a new Space:**
   - Go to https://huggingface.co/new-space
   - Name: `pixelboost-upscaler` (or any name)
   - SDK: **Gradio**
   - Hardware: **CPU Basic** (free)
   - Visibility: Public or Private

3. **Upload the HF Space code:**

   ```bash
   # Clone your empty Space
   git clone https://huggingface.co/spaces/YOUR_USERNAME/pixelboost-upscaler
   cd pixelboost-upscaler

   # Copy the HF Space files from the repo
   cp /path/to/pixelboost-upscaler/hf-space/* .

   # Push to HuggingFace
   git add .
   git commit -m "deploy PixelBoost AI upscaler"
   git push
   ```

4. **Wait for build** (~2-5 minutes). The Space will:
   - Install PyTorch + dependencies
   - Download Real-ESRGAN weights (~5MB + ~67MB + ~18MB)
   - Start the Gradio server

5. **Verify** your Space works:
   - Visit `https://YOUR_USERNAME-pixelboost-upscaler.hf.space`
   - Upload a test image
   - Check the API endpoint: `https://YOUR_USERNAME-pixelboost-upscaler.hf.space/api/predict`

### Important HF Space Details

| Detail | Value |
|--------|-------|
| **Free tier** | 2 vCPU, 16GB RAM, sleeps after 48h inactivity |
| **API endpoint** | `https://YOUR_SPACE.hf.space/upscale` |
| **Gradio API** | `client.predict(image, scale, model, face)` |
| **Model warm-up** | x4v3 loads at startup (~5s) |
| **Cold start** | ~20-60s if sleeping |

### Keep the Space Awake

Add a GitHub Actions cron to prevent sleep:

Create `.github/workflows/keep-alive.yml`:

```yaml
name: Keep HF Space Warm
on:
  schedule:
    - cron: "*/8 * * * *"   # every 8 minutes
  workflow_dispatch:

jobs:
  warm:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -s "https://YOUR_USERNAME-pixelboost-upscaler.hf.space/healthz" > /dev/null
          echo "HF Space warmed"
```

---

## 5. Deploy Multiple Backend Servers

Multiple backends = more concurrent users + redundancy.

### Render (Free)

1. Fork the repo (or use a separate repo).
2. Create another Web Service → Docker → `backend/Dockerfile`.
3. Set the **same env vars** (same `PIXELBOOST_HF_SPACE`, same `PIXELBOOST_SHARED_TOKEN`).
4. Result: `https://pixelboost-backend-2.onrender.com`

### Railway ($5/mo, no sleep)

1. Create a new Railway project.
2. Connect your GitHub repo.
3. Set **Root Directory** to `backend/`.
4. Railway auto-detects the Dockerfile.
5. Set env vars (same as Render).
6. Result: `https://pixelboost-backend.up.railway.app`

### Fly.io (free tier: 3 shared VMs)

```bash
cd backend
fly launch          # auto-detects Dockerfile
fly deploy
fly scale memory 512
```

Set env vars:
```bash
fly secrets set PIXELBOOST_HF_SPACE=your-username/pixelboost-upscaler
fly secrets set PIXELBOOST_SHARED_TOKEN=your-token
```

Result: `https://pixelboost-backend.fly.dev`

### Pricing Comparison

| Provider | Free Tier | Sleep? | Cold Start | Price for Always-On |
|----------|-----------|--------|------------|---------------------|
| **Render** | Yes (512MB) | Yes (15min) | ~30s | $7/mo |
| **Railway** | $5 credit | No | None | $5/mo |
| **Fly.io** | Yes (3 VMs) | Auto-stop | ~5s | $3.64/mo |
| **Koyeb** | Yes (1 nano) | Yes | ~10s | $7/mo |

---

## 6. Add HF Spaces to Your Backend

### Option A: Use Your Own HF Space

Set `PIXELBOOST_HF_SPACE` to your Space name:

```bash
# Backend env var
PIXELBOOST_HF_SPACE=your-username/pixelboost-upscaler
```

### Option B: Use a GPU-Optimized Space

Some HF Spaces have paid GPU hardware (T4, A10G). Create one:

1. In your Space settings → **Hardware**
2. Select **T4 small** ($0.60/hr) or **A10G small** ($1.05/hr)
3. Your Space now runs on GPU → inference is 5-10x faster

### Option C: Use a Custom Inference Endpoint

If you have your own inference server (not HF), modify `backend/app/main.py`:

In the `_call_hf_space()` function, replace the `gradio_client` call with your own HTTP call:

```python
# Instead of gradio_client, use httpx
import httpx

response = httpx.post(
    "https://your-inference-server.com/upscale",
    files={"file": ("image.png", image_bytes, "image/png")},
    data={"scale": scale, "model": model},
    timeout=300,
)
```

### Multiple HF Spaces (Load Balancing)

To use multiple HF Spaces, deploy multiple backends, each pointing to a different Space:

| Backend | HF Space | Notes |
|---------|----------|-------|
| Backend 1 (Render) | `user/space-v1` | Free CPU, general model |
| Backend 2 (Railway) | `user/space-v2` | Free CPU, anime model |
| Backend 3 (Fly.io) | `user/space-gpu` | T4 GPU, fastest |

Each backend is independent. The frontend load-balances across them.

---

## 7. GPU Workers (Colab T4)

The fastest way to get GPU inference for free.

### How It Works

```
┌──────────────────────────┐
│  Google Colab (Free T4)  │
│                          │
│  1. Load Real-ESRGAN     │
│  2. Start FastAPI server │
│  3. Open Cloudflare      │
│     tunnel               │
│  4. Register with        │
│     backend every 30s    │
└──────────┬───────────────┘
           │ POST /workers/register
           ▼
┌──────────────────────────┐
│  Backend (Render)        │
│                          │
│  _pick_worker_for_mode() │
│  → Sends job to T4       │
│  → Falls back to HF if   │
│     worker dies          │
└──────────────────────────┘
```

### Setup

1. Open `colab/pixelboost_t4_turbo.ipynb` in Colab.

2. Set these variables in the first cell:

   ```python
   BACKEND_URL = "https://pixelboost-backend-q659.onrender.com"
   WORKER_SECRET = "your-secret-token"  # Must match PIXELBOOST_COLAB_SECRET on backend
   DEFAULT_MODE = "ai-plus"  # or "ai-fast" or "anime"
   ```

3. **Run All** (Runtime → Run All).

4. The notebook will:
   - Install dependencies
   - Load Real-ESRGAN on GPU
   - Start a FastAPI server on port 8080
   - Open a Cloudflare tunnel (`trycloudflare.com`)
   - Register with your backend

5. **Verify worker is registered:**

   ```bash
   curl https://your-backend.onrender.com/workers
   # Should show your worker with a trycloudflare.com URL
   ```

### Worker Behavior

- **Registration:** Every 30 seconds via `POST /workers/register`
- **TTL:** Workers expire after 90 seconds without re-registration
- **Job routing:** Backend checks for available workers first, falls back to HF Space
- **Busy flag:** Worker is marked busy during inference, prevents overload

### Speed Comparison

| Method | Inference Time | Cost |
|--------|---------------|------|
| HF Space (free CPU) | 15-120s | Free |
| Colab T4 (free GPU) | 1-5s | Free |
| HF Space (paid T4) | 3-10s | $0.60/hr |

---

## 8. Frontend Server Pool Configuration

### Add Servers to Frontend

Edit the `.env` file in the frontend:

```env
# Primary backend
VITE_SERVER_1_URL=https://pixelboost-backend-q659.onrender.com

# Second backend
VITE_SERVER_2_URL=https://pixelboost-backend-2.onrender.com

# Third backend (optional)
VITE_SERVER_3_URL=https://pixelboost-backend.fly.dev

# Auth token (must match PIXELBOOST_SHARED_TOKEN on each backend)
VITE_API_TOKEN=your-shared-token

# Supabase (for user auth + credits)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

# Admin email
VITE_ADMIN_EMAILS=minhajulofficial.bd@gmail.com
```

### How Load Balancing Works

1. On app load, frontend checks health of all servers (`GET /healthz`).
2. When user clicks "Upscale":
   - `getBestServer()` picks the server with the **lowest active job count**.
   - If that server fails (5xx), tries the next server.
   - Max 3 retry attempts.
3. The server selector dropdown lets users manually pick a server.

### Adding More Servers (Beyond 3)

Edit `frontend/src/services/serverPool.ts`:

```typescript
const DEFAULT_SERVERS: Server[] = ([
  {
    url: import.meta.env.VITE_SERVER_1_URL || 'https://backend-1.onrender.com',
    name: 'Server 1',
    status: 'unknown',
    lastCheck: 0,
    responseTime: 0,
    jobsCount: 0,
  },
  {
    url: import.meta.env.VITE_SERVER_2_URL || '',
    name: 'Server 2',
    status: 'unknown',
    lastCheck: 0,
    responseTime: 0,
    jobsCount: 0,
  },
  {
    url: import.meta.env.VITE_SERVER_3_URL || '',
    name: 'Server 3',
    status: 'unknown',
    lastCheck: 0,
    responseTime: 0,
    jobsCount: 0,
  },
  // ADD MORE SERVERS HERE:
  {
    url: import.meta.env.VITE_SERVER_4_URL || '',
    name: 'Server 4',
    status: 'unknown',
    lastCheck: 0,
    responseTime: 0,
    jobsCount: 0,
  },
] as Server[]).filter((s) => s.url);
```

Then add the env var in `.env`:

```env
VITE_SERVER_4_URL=https://your-4th-backend.onrender.com
```

---

## 9. Auth Token Setup

The `PIXELBOOST_SHARED_TOKEN` protects your backend from unauthorized use.

### How It Works

```
Frontend                          Backend
   │                                │
   │  POST /jobs/upscale-ai         │
   │  Header: Authorization: Bearer │
   │          your-shared-token     │
   │───────────────────────────────►│
   │                                │  _require_token()
   │                                │  → checks token matches
   │                                │  → 401 if invalid
   │  ◄────────────────────────────│
```

### Setup

1. **Generate a random token:**

   ```bash
   # On your computer
   python -c "import secrets; print(secrets.token_urlsafe(32))"
   # Output: aBcDeFgHiJkLmNoPqRsTuVwXyZ12345678
   ```

2. **Set on each backend:**

   ```bash
   # Render: Environment tab → Add env var
   PIXELBOOST_SHARED_TOKEN=aBcDeFgHiJkLmNoPqRsTuVwXyZ12345678

   # Railway: Variables tab → Add variable
   PIXELBOOST_SHARED_TOKEN=aBcDeFgHiJkLmNoPqRsTuVwXyZ12345678

   # Fly.io: fly secrets set
   fly secrets set PIXELBOOST_SHARED_TOKEN=aBcDeFgHiJkLmNoPqRsTuVwXyZ12345678
   ```

3. **Set on frontend:**

   ```env
   # .env
   VITE_API_TOKEN=aBcDeFgHiJkLmNoPqRsTuVwXyZ12345678
   ```

### Security Note

The `VITE_API_TOKEN` is embedded in the frontend JavaScript (visible in browser DevTools). This is acceptable because:
- The token is your own secret, not a user's credential
- The backend has no user-level data (credits are frontend-only)
- Rate limiting (10 req/min per IP) prevents abuse even if token leaks

For stronger security, use a Vercel API proxy (see `docs/DEPLOYMENT.md`).

---

## 10. Performance Comparison

### Inference Speed (1024×1024 input, 4× upscale)

| Method | Time | Cost | Notes |
|--------|------|------|-------|
| Fast (Pillow LANCZOS) | ~50ms | Free | No AI, no new detail |
| HF Space (free CPU, x4v3) | 15-40s | Free | Good quality |
| HF Space (free CPU, x4plus) | 30-120s | Free | Best quality |
| HF Space (free CPU, anime) | 20-60s | Free | Illustrations |
| Colab T4 (x4v3) | 1-3s | Free | Fastest free option |
| Colab T4 (x4plus) | 3-8s | Free | Best quality + GPU |
| HF Space (paid T4) | 3-10s | $0.60/hr | Always-on GPU |
| HF Space (paid A10G) | 1-4s | $1.05/hr | Fastest paid |

### Throughput

| Setup | Concurrent Users | Notes |
|-------|-----------------|-------|
| 1× Render free | 1-3 | Sleep after 15min, 32 max jobs |
| 1× Railway ($5) | 5-10 | No sleep, always-on |
| 3× Render free | 3-9 | Load balanced |
| 1× Colab T4 | 1-5 | Fast, but session expires after ~6h |
| 3× Render + Colab T4 | 5-15 | Best free setup |

---

## 11. Scaling Strategy

### Free Tier (No Budget)

```
3× Render free backends + 1× Colab T4 worker
├── Backend 1: pixelboost-backend-1.onrender.com
├── Backend 2: pixelboost-backend-2.onrender.com
├── Backend 3: pixelboost-backend-3.onrender.com
└── GPU Worker: Colab T4 (run during peak hours)
```

- **Strengths:** Free, redundant, GPU-accelerated
- **Weakness:** Backends sleep after 15min, Colab sessions expire after ~6h
- **Best for:** Personal use, small community

### Paid Tier (Small Budget, ~$15/mo)

```
1× Railway backend ($5/mo) + 2× Render free backends
├── Backend 1: Railway (always-on, primary)
├── Backend 2: Render free (overflow)
└── Backend 3: Render free (overflow)
```

- **Strengths:** Primary always-on, no cold starts
- **Weakness:** Single paid server
- **Best for:** Growing user base

### Production Tier (~$30/mo)

```
3× Railway backends ($5/mo each) + HF Space with paid GPU
├── Backend 1: Railway (always-on)
├── Backend 2: Railway (always-on)
├── Backend 3: Railway (always-on)
└── HF Space: T4 GPU ($0.60/hr when active)
```

- **Strengths:** Always-on, fast GPU inference, no sleep
- **Best for:** Production app with paying users

---

## 12. Environment Variables Reference

### Backend (FastAPI)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PIXELBOOST_HF_SPACE` | Yes (for AI) | — | HF Space name (e.g., `user/space`) |
| `HF_TOKEN` | No | — | HF token for private Spaces |
| `PIXELBOOST_SHARED_TOKEN` | No | — | API auth token (set for production) |
| `PIXELBOOST_COLAB_SECRET` | No | — | Secret for GPU worker registration |
| `PIXELBOOST_AI_RATE_LIMIT` | No | `10` | Per-IP AI requests/minute |
| `PIXELBOOST_MAX_ACTIVE_JOBS` | No | `32` | Max concurrent AI jobs |
| `PIXELBOOST_CACHE_DIR` | No | `/tmp/pixelboost-cache` | Disk cache location |
| `PIXELBOOST_MAX_OUTPUT_PIXELS` | No | `40000000` | Max output pixels (fast mode) |
| `PIXELBOOST_AI_MAX_INPUT_PIXELS` | No | `4000000` | Max input pixels (AI mode) |
| `PIXELBOOST_MAX_JOB_INPUT_BYTES` | No | `20971520` | Max upload size (fast) |
| `PIXELBOOST_AI_JOB_INPUT_BYTES` | No | `12582912` | Max upload size (AI) |
| `PIXELBOOST_WORKER_TTL` | No | `90` | Worker expiry in seconds |
| `PIXELBOOST_AI_CALL_TIMEOUT` | No | `1650` | HF Space call timeout (seconds) |
| `FIREBASE_ADMIN_SDK_JSON` | No | — | Firebase service account JSON |
| `FIREBASE_STORAGE_BUCKET` | No | — | Firebase Storage bucket |

### Frontend (React/Vite)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_SERVER_1_URL` | Yes | — | Primary backend URL |
| `VITE_SERVER_2_URL` | No | — | Second backend URL |
| `VITE_SERVER_3_URL` | No | — | Third backend URL |
| `VITE_API_TOKEN` | Yes | — | Shared auth token |
| `VITE_SUPABASE_URL` | Yes | — | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Yes | — | Supabase anon key |
| `VITE_ADMIN_EMAILS` | No | `minhajulofficial.bd@gmail.com` | Admin emails |

### HF Space

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PIXELBOOST_WEIGHTS_DIR` | No | `weights` | Where to store model weights |
| `PIXELBOOST_TILE_PAD` | No | `16` | Tile padding for inference |
| `PIXELBOOST_TILE_WORKERS` | No | `2` | Parallel tile threads |
| `PIXELBOOST_TILE_X4V3` | No | `384` | Tile size for x4v3 model |
| `PIXELBOOST_TILE_X4PLUS` | No | `256` | Tile size for x4plus model |
| `PIXELBOOST_TILE_ANIME` | No | `320` | Tile size for anime model |
| `PIXELBOOST_DEFAULT_MODEL` | No | `x4v3` | Default model to warm at startup |

---

## 13. Troubleshooting

### Backend returns 401 Unauthorized

**Cause:** Missing or wrong auth token.

**Fix:**
1. Check `PIXELBOOST_SHARED_TOKEN` is set on the backend.
2. Check `VITE_API_TOKEN` matches on the frontend.
3. Check the token value is identical (no extra spaces).

### Backend returns 503 "AI mode not configured"

**Cause:** `PIXELBOOST_HF_SPACE` is not set on the backend.

**Fix:**
```bash
# On Render dashboard → Environment
PIXELBOOST_HF_SPACE=your-username/pixelboost-upscaler
```

### HF Space is slow / cold starts

**Cause:** HF Space was sleeping.

**Fix:**
1. Set up the keep-alive GitHub Actions cron (see [Section 4](#4-deploy-your-own-huggingface-space)).
2. Or upgrade to paid HF hardware (T4/A10G).

### Backend sleeps after 15 minutes (Render free)

**Cause:** Render free tier sleeps after inactivity.

**Fix:**
1. Set up the keep-alive cron (hits `/healthz` every 10 min).
2. Or upgrade to Railway ($5/mo, no sleep).
3. Or deploy on Fly.io (free tier, auto-scales down but wakes faster).

### "All servers unavailable" in frontend

**Cause:** All backend servers are down or unreachable.

**Fix:**
1. Check each backend URL is correct in `.env`.
2. Check backend health: `curl https://your-backend.onrender.com/healthz`
3. Check CORS is enabled (it is by default in the backend).
4. Check `VITE_API_TOKEN` matches on both sides.

### AI upscale returns "timed out"

**Cause:** HF Space is overloaded or dead.

**Fix:**
1. Check HF Space is running: visit the Space URL.
2. Increase `PIXELBOOST_AI_CALL_TIMEOUT` on backend.
3. Check the HF Space logs for errors.
4. Try a different model (x4v3 is faster than x4plus).

---

## Quick Start Checklist

- [ ] Fork the repo
- [ ] Deploy HF Space (Section 4)
- [ ] Deploy Backend 1 on Render (Section 3)
- [ ] Set `PIXELBOOST_HF_SPACE` on backend
- [ ] Set `PIXELBOOST_SHARED_TOKEN` on backend
- [ ] Deploy Frontend on Vercel
- [ ] Set `VITE_SERVER_1_URL` on frontend
- [ ] Set `VITE_API_TOKEN` on frontend
- [ ] Test: upload an image and upscale
- [ ] (Optional) Deploy Backend 2 & 3 (Section 5)
- [ ] (Optional) Run Colab T4 worker (Section 7)
- [ ] (Optional) Set up keep-alive cron (Section 4)
