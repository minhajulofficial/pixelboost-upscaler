# PixelBoost Frontend

Vite + React + TypeScript + Tailwind UI for the PixelBoost upscaler.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # outputs dist/
```

Set `VITE_API_URL` in `.env` to the backend URL (defaults to
`http://localhost:8000`).

## Deploy to Cloudflare Pages

1. Push to GitHub.
2. Create a Pages project, connect the repo, and use:
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Environment variable: `VITE_API_URL=https://your-backend.fly.dev`
