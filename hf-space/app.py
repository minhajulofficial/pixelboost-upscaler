"""PixelBoost AI upscaler — HuggingFace Space (Gradio).

Real-ESRGAN inference behind a Gradio interface. The PixelBoost backend
(FastAPI) calls this Space's ``/upscale`` API endpoint when the user picks any
AI tier ("AI Fast", "AI Plus", "Anime Illustration").

Supported models (weights auto-download from the official xinntao/Real-ESRGAN
release, then kept on disk for subsequent cold-starts):

- ``x4v3``        realesr-general-x4v3  (SRVGGNetCompact, ~5 MB)  — fastest
- ``x4plus``      RealESRGAN_x4plus     (RRDBNet 23 blocks, ~67 MB) — best quality
- ``anime``       RealESRGAN_x4plus_anime_6B (RRDBNet 6 blocks, ~18 MB) — illustrations

Both architectures are defined inline (SRVGGNetCompact + RRDBNet) so we skip
``basicsr`` / ``realesrgan`` / ``gfpgan`` entirely — those add hefty deps
(gfpgan, facexlib, numba, …) and reliably hang the free-CPU container before
Gradio launches. Bare PyTorch keeps cold-start fast.

Speed on free CPU (2 vCPU):

- The small SRVGG model runs *parallel tiles*: intra-op threads are set to 1
  and ``min(cpu, 2)`` tile patches are inferred concurrently on a thread pool,
  so both vCPUs are actually used. Larger TILE_SIZE for SRVGG also cuts per-
  tile forward-pass overhead.
- The deep RRDBNet models run serially with intra-op threads (they are far
  more compute-bound than launch-overhead-bound); quality wins there.

Face refine: a lightweight, free-CPU-safe pass (Haar face detection + CLAHE +
unsharp on the detected regions) instead of full GFPGAN, which would add
~800 MB of model weights and seconds-to-minutes of extra inference on free
hardware.

Scales: 2 / 3 / 4 / 6 / 8. The network natively upscales 4x; any other target
is reached by a native 4x forward pass + high-quality LANCZOS resize (8x means
"4x then 2x" of the intermediate).
"""

from __future__ import annotations

import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.request import urlretrieve

import gradio as gr
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image, ImageEnhance, ImageFilter

print(f"[pixelboost] python={sys.version.split()[0]} torch={torch.__version__}", flush=True)

WEIGHTS_DIR = os.environ.get("PIXELBOOST_WEIGHTS_DIR", "weights")
TILE_PAD = int(os.environ.get("PIXELBOOST_TILE_PAD", "16"))
MAX_INPUT_PIXELS = int(os.environ.get("PIXELBOOST_MAX_INPUT_PIXELS", str(4_000_000)))
NATIVE_SCALE = 4

# Model registry: (human label, weights URL, tile size, parallel tiles?)
MODEL_REGISTRY: dict[str, dict[str, object]] = {
    "x4v3": {
        "label": "AI Fast (general x4v3)",
        "url": (
            "https://github.com/xinntao/Real-ESRGAN/releases/download/"
            "v0.2.5.0/realesr-general-x4v3.pth"
        ),
        "tile": int(os.environ.get("PIXELBOOST_TILE_X4V3", "384")),
        "parallel": True,
        "arch": "srvgg",
    },
    "x4plus": {
        "label": "AI Plus (RealESRGAN x4plus)",
        "url": (
            "https://github.com/xinntao/Real-ESRGAN/releases/download/"
            "v0.2.1.0/RealESRGAN_x4plus.pth"
        ),
        "tile": int(os.environ.get("PIXELBOOST_TILE_X4PLUS", "256")),
        "parallel": False,
        "arch": "rrdb",
        "blocks": 23,
    },
    "anime": {
        "label": "Anime Illustration (x4plus_anime_6B)",
        "url": (
            "https://github.com/xinntao/Real-ESRGAN/releases/download/"
            "v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth"
        ),
        "tile": int(os.environ.get("PIXELBOOST_TILE_ANIME", "320")),
        "parallel": False,
        "arch": "rrdb",
        "blocks": 6,
    },
}

DEFAULT_MODEL = os.environ.get("PIXELBOOST_DEFAULT_MODEL", "x4v3")


# ---------------------------------------------------------------------------
# Architectures (inlined, matching basicsr so pretrained weights load strict)
# ---------------------------------------------------------------------------


class SRVGGNetCompact(nn.Module):
    """SRVGG-style compact super-resolution network.

    Matches ``basicsr.archs.srvgg_arch.SRVGGNetCompact`` so the pretrained
    ``realesr-general-x4v3.pth`` weights load directly.
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


class ResidualDenseBlock(nn.Module):
    """Residual dense block used inside every RRDB (matches basicsr)."""

    def __init__(self, num_feat: int = 64, num_grow_ch: int = 32) -> None:
        super().__init__()
        self.conv1 = nn.Conv2d(num_feat, num_grow_ch, 3, 1, 1)
        self.conv2 = nn.Conv2d(num_feat + num_grow_ch, num_grow_ch, 3, 1, 1)
        self.conv3 = nn.Conv2d(num_feat + 2 * num_grow_ch, num_grow_ch, 3, 1, 1)
        self.conv4 = nn.Conv2d(num_feat + 3 * num_grow_ch, num_grow_ch, 3, 1, 1)
        self.conv5 = nn.Conv2d(num_feat + 4 * num_grow_ch, num_feat, 3, 1, 1)
        self.lrelu = nn.LeakyReLU(negative_slope=0.2, inplace=True)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x1 = self.lrelu(self.conv1(x))
        x2 = self.lrelu(self.conv2(torch.cat((x, x1), 1)))
        x3 = self.lrelu(self.conv3(torch.cat((x, x1, x2), 1)))
        x4 = self.lrelu(self.conv4(torch.cat((x, x1, x2, x3), 1)))
        x5 = self.conv5(torch.cat((x, x1, x2, x3, x4), 1))
        return x5 * 0.2 + x


class RRDB(nn.Module):
    """Residual in Residual Dense Block (matches basicsr)."""

    def __init__(self, num_feat: int = 64, num_grow_ch: int = 32) -> None:
        super().__init__()
        self.rdb1 = ResidualDenseBlock(num_feat, num_grow_ch)
        self.rdb2 = ResidualDenseBlock(num_feat, num_grow_ch)
        self.rdb3 = ResidualDenseBlock(num_feat, num_grow_ch)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out = self.rdb1(x)
        out = self.rdb2(out)
        out = self.rdb3(out)
        return out * 0.2 + x


class RRDBNet(nn.Module):
    """RRDBNet super-resolution network (matches basicsr).

    Used by ``RealESRGAN_x4plus`` (23 RRDB blocks) and
    ``RealESRGAN_x4plus_anime_6B`` (6 RRDB blocks).
    """

    def __init__(
        self,
        num_in_ch: int = 3,
        num_out_ch: int = 3,
        num_feat: int = 64,
        num_block: int = 23,
        num_grow_ch: int = 32,
        upscale: int = 4,
    ) -> None:
        super().__init__()
        self.upscale = upscale
        self.conv_first = nn.Conv2d(num_in_ch, num_feat, 3, 1, 1)
        self.body = nn.ModuleList([RRDB(num_feat, num_grow_ch) for _ in range(num_block)])
        self.conv_body = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
        self.conv_up1 = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
        self.conv_up2 = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
        self.conv_hr = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
        self.conv_last = nn.Conv2d(num_feat, num_out_ch, 3, 1, 1)
        self.lrelu = nn.LeakyReLU(negative_slope=0.2, inplace=True)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        feat = self.conv_first(x)
        body_feat = self.body[0](feat)
        for block in self.body[1:]:
            body_feat = block(body_feat)
        feat = feat + body_feat
        feat = self.conv_body(feat)
        feat = self.lrelu(self.conv_up1(F.interpolate(feat, scale_factor=2, mode="nearest")))
        feat = self.lrelu(self.conv_up2(F.interpolate(feat, scale_factor=2, mode="nearest")))
        feat = self.conv_hr(feat)
        out = self.conv_last(self.lrelu(feat))
        return out


# ---------------------------------------------------------------------------
# Weights / model management
# ---------------------------------------------------------------------------


def _download_weights(model_key: str) -> str:
    os.makedirs(WEIGHTS_DIR, exist_ok=True)
    url = str(MODEL_REGISTRY[model_key]["url"])
    dest = os.path.join(WEIGHTS_DIR, f"{model_key}.pth")
    if not os.path.exists(dest):
        print(f"[pixelboost] downloading {url}", flush=True)
        t0 = time.time()
        urlretrieve(url, dest)
        print(
            f"[pixelboost] download done in {time.time() - t0:.1f}s "
            f"({os.path.getsize(dest) / 1024:.0f} KB)",
            flush=True,
        )
    return dest


def _build_model(model_key: str) -> nn.Module:
    spec = MODEL_REGISTRY[model_key]
    weights_path = _download_weights(model_key)
    if spec["arch"] == "srvgg":
        model: nn.Module = SRVGGNetCompact(
            num_in_ch=3,
            num_out_ch=3,
            num_feat=64,
            num_conv=32,
            upscale=NATIVE_SCALE,
            act_type="prelu",
        )
    else:
        model = RRDBNet(
            num_in_ch=3,
            num_out_ch=3,
            num_feat=64,
            num_block=int(spec["blocks"]),  # type: ignore[arg-type]
            num_grow_ch=32,
            upscale=NATIVE_SCALE,
        )
    state = torch.load(weights_path, map_location="cpu")
    key = "params_ema" if "params_ema" in state else "params"
    model.load_state_dict(state[key], strict=True)
    model.eval()
    return model


# Warm up the default model at startup so the first real request isn't paying
# the full cold-start. Other models load lazily on first use.
_models: dict[str, nn.Module] = {}
print(f"[pixelboost] warming up model '{DEFAULT_MODEL}'...", flush=True)
_t0 = time.time()
_models[DEFAULT_MODEL] = _build_model(DEFAULT_MODEL)
print(f"[pixelboost] default model ready in {time.time() - _t0:.1f}s", flush=True)


def _get_model(model_key: str) -> nn.Module:
    if model_key not in _models:
        _models[model_key] = _build_model(model_key)
    return _models[model_key]


# ---------------------------------------------------------------------------
# Face refine (free-CPU-safe alternative to full GFPGAN)
# ---------------------------------------------------------------------------

try:
    import cv2  # type: ignore

    _CV2_AVAILABLE = True
    _FACE_CASCADE = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    )
except Exception as exc:  # noqa: BLE001
    print(f"[pixelboost] face refine disabled: {exc}", flush=True)
    _CV2_AVAILABLE = False
    _FACE_CASCADE = None


def _refine_faces(image: Image.Image) -> Image.Image:
    """Detect faces and apply a gentle local detail boost on each region.

    CLAHE on the lightness channel + a light unsharp mask. This is a
    lightweight, free-CPU-friendly stand-in for full GAN-based face
    enhancement; it visibly tightens eyes/edges without the weight download
    or multi-second GPU-class inference that GFPGAN would need.
    """
    if not _CV2_AVAILABLE or _FACE_CASCADE is None:
        return image

    rgb = image.convert("RGB")
    arr = np.asarray(rgb)
    gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
    # Downscale huge images for detection speed; faces found at reduced scale
    # are mapped back via the ratio.
    max_side = 1600
    ratio = 1.0
    detect_gray = gray
    if max(gray.shape) > max_side:
        ratio = max_side / float(max(gray.shape))
        detect_gray = cv2.resize(
            gray, (0, 0), fx=ratio, fy=ratio, interpolation=cv2.INTER_AREA
        )

    faces = _FACE_CASCADE.detectMultiScale(
        detect_gray, scaleFactor=1.1, minNeighbors=5, minSize=(48, 48)
    )
    if len(faces) == 0:
        return image

    lab = cv2.cvtColor(arr, cv2.COLOR_RGB2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l_enhanced = clahe.apply(l_channel)
    enhanced = cv2.cvtColor(cv2.merge((l_enhanced, a_channel, b_channel)), cv2.COLOR_LAB2RGB)

    result = image.convert("RGB")
    sharpened = np.asarray(result)
    sharpened = cv2.cvtColor(
        cv2.addWeighted(
            enhanced, 1.15,
            cv2.GaussianBlur(enhanced, (0, 0), 1.0), -0.15, 0,
        ),
        cv2.COLOR_RGB2RGB,
    )

    mask = np.zeros(gray.shape[:2], dtype=np.float32)
    for x, y, w, h in faces:
        x, y, w, h = int(x / ratio), int(y / ratio), int(w / ratio), int(h / ratio)
        margin_x, margin_y = int(w * 0.12), int(h * 0.12)
        x0 = max(0, x - margin_x)
        y0 = max(0, y - margin_y)
        x1 = min(gray.shape[1], x + w + margin_x)
        y1 = min(gray.shape[0], y + h + margin_y)
        mask[y0:y1, x0:x1] = 1.0

    if mask.max() == 0:
        return image

    mask = cv2.GaussianBlur(mask, (0, 0), 9)
    mask3 = np.stack([mask] * 3, axis=-1)
    blended = (sharpened * mask3 + np.asarray(result) * (1.0 - mask3)).astype(np.uint8)
    return Image.fromarray(blended)


# ---------------------------------------------------------------------------
# Tiled inference
# ---------------------------------------------------------------------------

_TILE_WORKERS = int(os.environ.get("PIXELBOOST_TILE_WORKERS", "2"))


@torch.inference_mode()
def _infer_tile(model: nn.Module, tile: torch.Tensor) -> torch.Tensor:
    return model(tile).clamp_(0.0, 1.0)


@torch.inference_mode()
def _infer_tiled(model_key: str, image: Image.Image) -> Image.Image:
    spec = MODEL_REGISTRY[model_key]
    model = _get_model(model_key)
    tile = int(spec["tile"])
    pad = TILE_PAD
    parallel = bool(spec["parallel"]) and _TILE_WORKERS > 1

    arr = np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0
    h, w, _ = arr.shape
    tensor = torch.from_numpy(arr).permute(2, 0, 1).unsqueeze(0)  # 1×3×H×W

    out_h, out_w = h * NATIVE_SCALE, w * NATIVE_SCALE
    out = torch.zeros((1, 3, out_h, out_w), dtype=torch.float32)

    tiles_y = max(1, (h + tile - 1) // tile)
    tiles_x = max(1, (w + tile - 1) // tile)

    def patch_for(tx: int, ty: int) -> tuple[torch.Tensor, tuple[int, int, int, int]]:
        y0, x0 = ty * tile, tx * tile
        y1, x1 = min(y0 + tile, h), min(x0 + tile, w)
        py0, px0 = max(0, y0 - pad), max(0, x0 - pad)
        py1, px1 = min(h, y1 + pad), min(w, x1 + pad)
        crop_top = (y0 - py0) * NATIVE_SCALE
        crop_left = (x0 - px0) * NATIVE_SCALE
        crop_h = (y1 - y0) * NATIVE_SCALE
        crop_w = (x1 - x0) * NATIVE_SCALE
        return (
            tensor[:, :, py0:py1, px0:px1],
            (crop_top, crop_left, crop_h, crop_w, y0, x0, y1, x1),
        )

    jobs = [(tx, ty) for ty in range(tiles_y) for tx in range(tiles_x)]

    def run_job(job: tuple[int, int]) -> tuple[torch.Tensor, tuple[int, int, int, int]]:
        tx, ty = job
        patch, meta = patch_for(tx, ty)
        up = _infer_tile(model, patch)
        crop_top, crop_left, crop_h, crop_w, y0, x0, y1, x1 = meta
        up_cropped = up[:, :, crop_top : crop_top + crop_h, crop_left : crop_left + crop_w]
        return up_cropped, (y0, x0, y1, x1)

    if parallel:
        # One thread per tile, single intra-op thread each => both vCPUs are
        # actually kept busy. This is the real win for the shallow SRVGG net.
        old_threads = torch.get_num_threads()
        torch.set_num_threads(1)
        try:
            with ThreadPoolExecutor(max_workers=min(_TILE_WORKERS, os.cpu_count() or 1)) as pool:
                for up_cropped, (y0, x0, y1, x1) in pool.map(run_job, jobs):
                    out[:, :, y0 * NATIVE_SCALE : y1 * NATIVE_SCALE, x0 * NATIVE_SCALE : x1 * NATIVE_SCALE] = (
                        up_cropped
                    )
        finally:
            torch.set_num_threads(old_threads)
    else:
        for job in jobs:
            up_cropped, (y0, x0, y1, x1) = run_job(job)
            out[:, :, y0 * NATIVE_SCALE : y1 * NATIVE_SCALE, x0 * NATIVE_SCALE : x1 * NATIVE_SCALE] = up_cropped

    out_arr = (out.squeeze(0).permute(1, 2, 0).numpy() * 255.0).clip(0, 255).astype(np.uint8)
    return Image.fromarray(out_arr)


# ---------------------------------------------------------------------------
# Gradio API
# ---------------------------------------------------------------------------


def upscale(image: Image.Image | None, scale: int = 4, model: str = DEFAULT_MODEL, face: bool = False) -> Image.Image:
    """Run Real-ESRGAN inference and resize to the requested scale."""
    if image is None:
        raise gr.Error("No image provided.")
    if int(scale) not in {2, 3, 4, 6, 8}:
        raise gr.Error("Scale must be 2, 3, 4, 6, or 8.")
    if model not in MODEL_REGISTRY:
        raise gr.Error(f"Unknown model {model!r}. Choose one of {sorted(MODEL_REGISTRY)}.")

    image = image.convert("RGB")
    if image.width * image.height > MAX_INPUT_PIXELS:
        raise gr.Error(
            f"Input too large ({image.width}x{image.height}). "
            f"Max ~{MAX_INPUT_PIXELS // 1_000_000} megapixels in AI mode."
        )

    t0 = time.time()
    result = _infer_tiled(model, image)
    target = (image.width * int(scale), image.height * int(scale))
    if result.size != target:
        result = result.resize(target, Image.Resampling.LANCZOS)
    if face:
        result = _refine_faces(result)
    print(
        f"[pixelboost] model={model} face={face} {image.width}x{image.height} -> "
        f"{target[0]}x{target[1]} in {time.time() - t0:.1f}s",
        flush=True,
    )
    return result


demo = gr.Interface(
    fn=upscale,
    inputs=[
        gr.Image(type="pil", label="Input image"),
        gr.Radio([2, 3, 4, 6, 8], value=4, label="Scale", type="value"),
        gr.Radio(
            [k for k in MODEL_REGISTRY],
            value=DEFAULT_MODEL,
            label="Model",
            info="x4v3 = fast general · x4plus = best quality · anime = illustrations",
        ),
        gr.Checkbox(value=False, label="Face refine"),
    ],
    outputs=gr.Image(type="pil", label="Upscaled", format="png"),
    title="PixelBoost AI Upscaler",
    description=(
        "Real-ESRGAN (x4v3 / x4plus / x4plus_anime) running on HuggingFace "
        "free CPU. Expect 15-120s per image depending on model and size. "
        "Called from the PixelBoost backend when users pick an AI tier."
    ),
    api_name="upscale",
    flagging_mode="never",
    concurrency_limit=1,
)
demo.queue(max_size=20)

if __name__ == "__main__":
    print("[pixelboost] launching gradio...", flush=True)
    demo.launch(show_api=True)
