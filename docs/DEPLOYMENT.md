# Deploying PixelBoost

PixelBoost is two pieces:

- **Frontend** (`frontend/`) — static Vite/React bundle. Hostable on Cloudflare Pages, Vercel, Netlify, GitHub Pages, S3, etc.
- **Backend** (`backend/`) — FastAPI + Pillow. Needs a real host that runs Docker or Python; can't run on Pages/Vercel-static.

The frontend talks to the backend through whatever URL is in `VITE_API_URL` at **build time**. So the deploy order is: backend first, get its public URL, set that URL as the frontend's env var, then build + deploy the frontend.

---

## 1. Deploy the backend

Pick one. All three options use the existing `backend/Dockerfile` and read `$PORT` for the port.

### Option A — Render (one-click)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/minhajulofficial/pixelboost-upscaler)

The repo ships a top-level `render.yaml` (Render Blueprint) that Render reads automatically. It builds from `backend/Dockerfile`, exposes `/healthz`, and runs on the free plan. After the deploy finishes you'll get a URL like `https://pixelboost-backend-abc1.onrender.com` — that's your `VITE_API_URL`.

Manual steps if the button doesn't work:

1. Sign in at https://render.com.
2. **New → Blueprint** → connect this GitHub repo → Render reads `render.yaml` and proposes the service.
3. Click **Apply**.
4. Wait for the first build (~3–4 min). Copy the resulting URL.

Free plan note: Render spins free Docker services down after 15 min of inactivity. The first request after idle takes ~30s to wake up. If you want always-on, upgrade or use Fly.io.

### Option B — Railway

The repo ships `backend/railway.toml`. Steps:

1. Sign in at https://railway.app.
2. **New Project → Deploy from GitHub repo** → pick `minhajulofficial/pixelboost-upscaler`.
3. In the new service's **Settings → Source → Root Directory**, set it to `backend`. Railway will then read `railway.toml` and build the Dockerfile.
4. **Settings → Networking → Generate Domain** to get a public URL.

### Option C — Fly.io (your own org)

The repo ships `backend/fly.toml` already wired up. From a machine with `flyctl` and authenticated to your own Fly.io org:

```bash
cd backend
fly launch --no-deploy --copy-config   # accepts existing fly.toml; pick a unique app name
fly deploy
fly status                              # confirm the machine is healthy
```

The deploy URL is `https://<your-app>.fly.dev`.

> Devin's session-time deploy ran into `Your organization has reached its machine limit. Please contact billing@fly.io` on the shared Fly account Devin uses — that's why the backend isn't already live. Deploying from your own Fly.io org sidesteps that quota.

### Verify the backend

Whichever host you pick, sanity-check with curl:

```bash
curl https://<your-backend-url>/healthz
# → {"status":"ok"}
```

---

## 2. Point the frontend at the backend

### On Cloudflare Pages (production)

Right now `pixelboost-upscaler.pages.dev` returns 404 because the Pages project isn't wired up to the repo correctly. Fix it in **Pages → Settings → Build & deployments**:

| Setting                   | Value                              |
| ------------------------- | ---------------------------------- |
| Production branch         | `main`                             |
| Framework preset          | `None` (or `Vite`)                 |
| Build command             | `npm install && npm run build`     |
| Build output directory    | `dist`                             |
| Root directory (advanced) | `frontend`                         |

Then in **Settings → Environment variables → Production**, add:

```
VITE_API_URL = https://<your-backend-url>
```

Save → **Deployments → Retry deployment** on the latest `main` build. `pixelboost-upscaler.pages.dev` should serve the app.

### Building locally

```bash
cd frontend
VITE_API_URL=https://<your-backend-url> npm run build
# dist/ now contains the production bundle you can upload anywhere
```

---

## 3. CORS

`backend/app/main.py` enables `Access-Control-Allow-Origin: *` for every header and method, so the frontend can sit on any domain. If you ever tighten that, keep `Authorization` in the allowed headers — `App.tsx` may send it when `VITE_API_URL` embeds basic-auth credentials (e.g. behind a private reverse proxy).
