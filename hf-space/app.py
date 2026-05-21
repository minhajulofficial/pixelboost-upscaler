"""PixelBoost AI upscaler — HuggingFace Space (Gradio).

Real-ESRGAN inference behind a Gradio interface. The PixelBoost backend
(FastAPI) calls this Space's ``/upscale`` API endpoint when the user picks
"AI Enhance" mode.

Model: realesr-general-x4v3 (SRVGGNetCompact, ~5 MB) — chosen for fast CPU
inference on HF Spaces' free tier.

We define the architecture inline and skip ``basicsr`` / ``realesrgan``
entirely. Those packages add hefty deps (gfpgan, facexlib, numba, …) and the
import chain reliably hangs the free-CPU container before Gradio launches.
Bare PyTorch keeps cold-start under a minute.

Scales:
- 4x: native single forward pass.
- 2x / 6x / 8x: 4x forward pass + LANCZOS resize to the target size.
"""

from __future__ import annotations

import os
import sys
import time
from urllib.request import urlretrieve

import gradio as gr
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image

print(f"[pixelboost] python={sys.version.split()[0]} torch={torch.__version__}", flush=True)

MODEL_NAME = "realesr-general-x4v3"
MODEL_URL = (
    "https://github.com/xinntao/Real-ESRGAN/releases/download/"
    "v0.2.5.0/realesr-general-x4v3.pth"
)
WEIGHTS_DIR = os.environ.get("PIXELBOOST_WEIGHTS_DIR", "weights")
TILE_SIZE = int(os.environ.get("PIXELBOOST_TILE_SIZE", "192"))
TILE_PAD = int(os.environ.get("PIXELBOOST_TILE_PAD", "8"))
MAX_INPUT_PIXELS = int(os.environ.get("PIXELBOOST_MAX_INPUT_PIXELS", str(4_000_000)))
NATIVE_SCALE = 4


class SRVGGNetCompact(nn.Module):
    """SRVGG-style compact super-resolution network.

    Architecture matches ``basicsr.archs.srvgg_arch.SRVGGNetCompact`` so the
    pretrained ``realesr-general-x4v3.pth`` weights load directly. Inlined
    here to avoid pulling in basicsr / realesrgan / gfpgan.
    """

    def __init__(
        self,
        num_in_ch: int = 3,
        num_out_ch: int = 3,
        num_feat: int = 64,
        num_conv: int = 32,
        upscale: int = 4,
        act_type: str = "prelu",
    ) -> None:
        super().__init__()
        self.upscale = upscale
        self.body = nn.ModuleList()

        self.body.append(nn.Conv2d(num_in_ch, num_feat, 3, 1, 1))
        self.body.append(self._make_act(act_type, num_feat))

        for _ in range(num_conv):
            self.body.append(nn.Conv2d(num_feat, num_feat, 3, 1, 1))
            self.body.append(self._make_act(act_type, num_feat))

        self.body.append(nn.Conv2d(num_feat, num_out_ch * upscale * upscale, 3, 1, 1))
        self.upsampler = nn.PixelShuffle(upscale)

    @staticmethod
    def _make_act(act_type: str, num_feat: int) -> nn.Module:
        if act_type == "relu":
            return nn.ReLU(inplace=True)
        if act_type == "prelu":
            return nn.PReLU(num_parameters=num_feat)
        if act_type == "leakyrelu":
            return nn.LeakyReLU(negative_slope=0.1, inplace=True)
        raise ValueError(f"Unknown act_type {act_type!r}")

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out = x
        for layer in self.body:
            out = layer(out)
        out = self.upsampler(out)
        base = F.interpolate(x, scale_factor=self.upscale, mode="nearest")
        return out + base


def _download_weights() -> str:
    os.makedirs(WEIGHTS_DIR, exist_ok=True)
    dest = os.path.join(WEIGHTS_DIR, f"{MODEL_NAME}.pth")
    if not os.path.exists(dest):
        print(f"[pixelboost] downloading {MODEL_URL}", flush=True)
        t0 = time.time()
        urlretrieve(MODEL_URL, dest)
        print(
            f"[pixelboost] download done in {time.time() - t0:.1f}s "
            f"({os.path.getsize(dest) / 1024:.0f} KB)",
            flush=True,
        )
    return dest


def _build_model() -> nn.Module:
    weights_path = _download_weights()
    model = SRVGGNetCompact(
        num_in_ch=3,
        num_out_ch=3,
        num_feat=64,
        num_conv=32,
        upscale=NATIVE_SCALE,
        act_type="prelu",
    )
    state = torch.load(weights_path, map_location="cpu")
    key = "params_ema" if "params_ema" in state else "params"
    model.load_state_dict(state[key], strict=True)
    model.eval()
    return model


print("[pixelboost] building model...", flush=True)
_t0 = time.time()
MODEL = _build_model()
print(f"[pixelboost] model ready in {time.time() - _t0:.1f}s", flush=True)


@torch.inference_mode()
def _infer_tile(tile: torch.Tensor) -> torch.Tensor:
    """Run a single forward pass on a 4D tensor in [0, 1] range."""
    return MODEL(tile).clamp_(0.0, 1.0)


@torch.inference_mode()
def _infer_tiled(image: Image.Image) -> Image.Image:
    """Tile-based 4x inference to keep memory bounded on free CPU."""
    arr = np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0
    h, w, _ = arr.shape
    tensor = torch.from_numpy(arr).permute(2, 0, 1).unsqueeze(0)  # 1×3×H×W

    out_h, out_w = h * NATIVE_SCALE, w * NATIVE_SCALE
    out = torch.zeros((1, 3, out_h, out_w), dtype=torch.float32)

    tile = TILE_SIZE
    pad = TILE_PAD
    tiles_y = max(1, (h + tile - 1) // tile)
    tiles_x = max(1, (w + tile - 1) // tile)

    for ty in range(tiles_y):
        for tx in range(tiles_x):
            y0 = ty * tile
            x0 = tx * tile
            y1 = min(y0 + tile, h)
            x1 = min(x0 + tile, w)

            py0 = max(0, y0 - pad)
            px0 = max(0, x0 - pad)
            py1 = min(h, y1 + pad)
            px1 = min(w, x1 + pad)

            patch = tensor[:, :, py0:py1, px0:px1]
            up = _infer_tile(patch)

            crop_top = (y0 - py0) * NATIVE_SCALE
            crop_left = (x0 - px0) * NATIVE_SCALE
            crop_h = (y1 - y0) * NATIVE_SCALE
            crop_w = (x1 - x0) * NATIVE_SCALE
            up_cropped = up[:, :, crop_top : crop_top + crop_h, crop_left : crop_left + crop_w]

            out[:, :, y0 * NATIVE_SCALE : y1 * NATIVE_SCALE, x0 * NATIVE_SCALE : x1 * NATIVE_SCALE] = up_cropped

    out_arr = (out.squeeze(0).permute(1, 2, 0).numpy() * 255.0).clip(0, 255).astype(np.uint8)
    return Image.fromarray(out_arr)


def upscale(image: Image.Image | None, scale: int = 4) -> Image.Image:
    """Run Real-ESRGAN inference and resize to the requested scale."""
    if image is None:
        raise gr.Error("No image provided.")
    if int(scale) not in {2, 4, 6, 8}:
        raise gr.Error("Scale must be 2, 4, 6, or 8.")

    image = image.convert("RGB")
    if image.width * image.height > MAX_INPUT_PIXELS:
        raise gr.Error(
            f"Input too large ({image.width}x{image.height}). "
            f"Max ~{MAX_INPUT_PIXELS // 1_000_000} megapixels in AI mode."
        )

    t0 = time.time()
    result = _infer_tiled(image)
    target = (image.width * int(scale), image.height * int(scale))
    if result.size != target:
        result = result.resize(target, Image.Resampling.LANCZOS)
    print(f"[pixelboost] {image.width}x{image.height} -> {target[0]}x{target[1]} in {time.time() - t0:.1f}s", flush=True)
    return result


demo = gr.Interface(
    fn=upscale,
    inputs=[
        gr.Image(type="pil", label="Input image"),
        gr.Radio([2, 4, 6, 8], value=4, label="Scale", type="value"),
    ],
    outputs=gr.Image(type="pil", label="Upscaled", format="png"),
    title="PixelBoost AI Upscaler",
    description=(
        "Real-ESRGAN (realesr-general-x4v3) running on HuggingFace free CPU. "
        "Expect 20-90s per image. Called from the PixelBoost backend when "
        "users pick AI Enhance mode."
    ),
    api_name="upscale",
    flagging_mode="never",
    concurrency_limit=1,
)
demo.queue(max_size=20)

if __name__ == "__main__":
    print("[pixelboost] launching gradio...", flush=True)
    demo.launch(show_api=True)
