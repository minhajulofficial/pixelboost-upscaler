---
title: PixelBoost AI Upscaler
emoji: ✨
colorFrom: purple
colorTo: pink
sdk: gradio
sdk_version: 5.25.0
python_version: "3.10"
app_file: app.py
pinned: false
license: mit
short_description: Real-ESRGAN AI image upscaler for PixelBoost
---

# PixelBoost AI Upscaler

Real-ESRGAN (`realesr-general-x4v3`) behind a Gradio interface. This Space
powers the **AI Enhance** mode of [PixelBoost](https://pixelboost-upscaler.pages.dev/).
The Space exposes an `/upscale` API endpoint that the PixelBoost FastAPI
backend calls via `gradio_client`.

## Local dev

```bash
pip install -r requirements.txt
python app.py
```

## Notes

- Free CPU tier: expect 20-90s per image. Tiling (256px) keeps memory low.
- Model weights download from the official Real-ESRGAN GitHub release on
  first boot and are cached in `./weights`.
- Source-of-truth lives in
  [pixelboost-upscaler/hf-space](https://github.com/minhajulofficial/pixelboost-upscaler/tree/main/hf-space);
  push changes from there.
