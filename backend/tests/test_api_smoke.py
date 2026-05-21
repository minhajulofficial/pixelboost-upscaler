import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from PIL import Image
import io

from app.main import app


def _png_bytes(w=8, h=8):
    im = Image.new("RGB", (w, h), (120, 50, 200))
    b = io.BytesIO()
    im.save(b, format="PNG")
    return b.getvalue()


def test_root_exposes_scales():
    c = TestClient(app)
    r = c.get("/")
    assert r.status_code == 200
    payload = r.json()
    assert payload["scales"] == [2, 4, 6, 8]


def test_upscale_fast_2x_ok():
    c = TestClient(app)
    raw = _png_bytes(10, 12)
    r = c.post(
        "/upscale",
        files={"file": ("x.png", raw, "image/png")},
        data={"scale": "2", "format": "png", "quality": "90", "mode": "fast"},
    )
    assert r.status_code == 200
    out = Image.open(io.BytesIO(r.content))
    assert out.size == (20, 24)


def test_upscale_rejects_bad_scale():
    c = TestClient(app)
    raw = _png_bytes()
    r = c.post(
        "/upscale",
        files={"file": ("x.png", raw, "image/png")},
        data={"scale": "3", "format": "png", "quality": "90", "mode": "fast"},
    )
    assert r.status_code == 400
    assert "Unsupported scale" in r.text
