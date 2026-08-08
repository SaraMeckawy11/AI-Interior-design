"""
Livinai 3D walkthrough exporter — Modal deployment.

Workspace: sara123meckawy
App:       livinai-walkthrough

This runs the exact same code as `backend/renderer`: the canonical Livinai_web
exporter, its engine, and its bundled material and furniture assets. Nothing is
reimplemented here — this file is only an image definition and two HTTP
endpoints around `render_worker.build()`.

Why it exists: the exporter needs Open3D, and Open3D needs system libraries
(`libgl1`, `libegl1`, the X11 set) that a host's package manager has to install.
Render's native Node runtime gives you no root and no `apt`, so the Node API
either had to run as a Docker image with a 2 GB memory floor, or stop hosting
Python altogether. This is the second option: Render keeps serving the API on
the Node runtime, and the heavy, occasional, memory-hungry work happens here and
is billed per second instead of per month.

The Node API talks to this through `backend/src/lib/walkthroughRenderer.js`,
which falls back to spawning Python locally when the endpoint is not configured,
so local development and `backend/Dockerfile` keep working unchanged.

Deploy (the secret already exists — it is the one the inference app uses):
    modal secret create livinai-api-key API_KEY=<your api key>   # if missing
    cd modal && modal deploy walkthrough_app.py

Endpoints produced:
    POST https://<workspace>--livinai-walkthrough-build.modal.run
    GET  https://<workspace>--livinai-walkthrough-model.modal.run?name=<id>.glb
    GET  https://<workspace>--livinai-walkthrough-health.modal.run

Set the first one as MODAL_WALKTHROUGH_ENDPOINT_URL on the Render service; the
other two are derived from it by name.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import modal

# fastapi only exists inside the container image; guard the import so the file
# can still be parsed locally by `modal deploy`.
try:
    from fastapi import Header, HTTPException
    from fastapi.responses import Response
except ImportError:  # pragma: no cover
    Header = None
    HTTPException = None
    Response = None


app = modal.App("livinai-walkthrough")

# Resolved from this file rather than the working directory, so `modal deploy`
# works from the repository root as well as from `modal/`.
REPO_ROOT = Path(__file__).resolve().parent.parent
RENDERER_SOURCE = REPO_ROOT / "backend" / "renderer"
REQUIREMENTS = RENDERER_SOURCE / "requirements.txt"

RENDERER_ROOT = "/renderer"
CACHE_ROOT = "/cache"
OUTPUT_DIR = f"{CACHE_ROOT}/walkthrough"

# Content-addressed exports survive scale-down here. Without it every container
# would rebuild scenes another container had already produced.
cache_vol = modal.Volume.from_name("livinai-walkthrough-cache", create_if_missing=True)

# The same bearer-token secret the inference app uses.
api_key_secret = modal.Secret.from_name("livinai-api-key", required_keys=["API_KEY"])

# Only renderer-generated names may ever be turned into a path. Mirrors
# MODEL_NAME in backend/src/lib/walkthroughRenderer.js.
MODEL_NAME = re.compile(r"^[a-f0-9]{24}\.glb$", re.IGNORECASE)

# Copied verbatim from backend/Dockerfile. Open3D's wheel links Filament, OpenMP
# and X11 at import time, and `interior_plan/archviz_materials.py` asks for
# `open3d.visualization.rendering` to build material records — which pulls the
# whole GUI shared object in. A headless container still needs the X libraries.
SYSTEM_LIBRARIES = [
    "libgl1",
    "libegl1",
    "libglib2.0-0",
    "libgomp1",
    "libusb-1.0-0",
    "libx11-6",
    "libxext6",
    "libxrender1",
    "libxfixes3",
    "libxcursor1",
    "libxinerama1",
    "libxrandr2",
    "libxi6",
    "libxxf86vm1",
]

# The import check is deliberately part of the build, exactly as it is in
# backend/Dockerfile: a missing wheel or system library should fail `modal
# deploy`, not surface as a Python traceback the first time someone opens the
# Explore step. It imports the engine too, not just the third-party modules.
VERIFY = (
    "import sys; sys.path.insert(0, '/renderer'); "
    "import numpy, PIL, shapely, trimesh, open3d; "
    "from open3d.visualization import rendering; "
    "import render_worker; "
    "print('renderer OK: numpy', numpy.__version__, '| open3d', open3d.__version__, "
    "'| source', render_worker.interior_plan_source_version())"
)

renderer_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install(*SYSTEM_LIBRARIES)
    .pip_install_from_requirements(str(REQUIREMENTS))
    .pip_install("fastapi[standard]==0.115.0")
    .env(
        {
            # Filament has no GPU here; ask for its software rasteriser rather
            # than letting it probe for a device that does not exist.
            "OPEN3D_CPU_RENDERING": "true",
            "PYTHONUNBUFFERED": "1",
            "PYTHONDONTWRITEBYTECODE": "1",
            "WALKTHROUGH_OUTPUT_DIR": OUTPUT_DIR,
        }
    )
    # `copy=True` bakes the exporter into a layer so the verification below can
    # import it. The engine's material and furniture assets are ~120 MB; Modal
    # hashes the directory, so only a real change re-uploads it.
    .add_local_dir(
        str(RENDERER_SOURCE),
        remote_path=RENDERER_ROOT,
        copy=True,
        ignore=[
            "**/__pycache__/**",
            "**/*.pyc",
            ".venv/**",
            "generated/**",
        ],
    )
    .run_commands(f'python -c "{VERIFY}"')
)


def _worker():
    """Import the bundled exporter, adding its root to the path once."""
    if RENDERER_ROOT not in sys.path:
        sys.path.insert(0, RENDERER_ROOT)
    import render_worker

    return render_worker


def _require_token(authorization: str):
    expected = os.environ.get("API_KEY")
    if expected:
        token = (authorization or "").removeprefix("Bearer ").strip()
        if token != expected:
            raise HTTPException(status_code=401, detail="Unauthorized")


def _model_path(name: str) -> Path:
    if not MODEL_NAME.match(name or ""):
        raise HTTPException(status_code=400, detail="Invalid walkthrough model name.")
    return Path(OUTPUT_DIR) / name


# ---------------------------------------------------------------------------
# ENDPOINTS
# ---------------------------------------------------------------------------
#
# Building and downloading are deliberately separate calls. A furnished
# multi-room GLB runs to tens of megabytes, and returning it inline — base64'd
# into the session response — would make the Render instance hold the whole
# thing in memory as a string just to write it to disk. Splitting them lets the
# API stream the file, and lets it skip the transfer entirely for a scene it has
# already cached.


@app.function(
    image=renderer_image,
    secrets=[api_key_secret],
    volumes={CACHE_ROOT: cache_vol},
    cpu=2.0,
    # Open3D plus a furnished multi-room scene does not fit in 512 MB. This is
    # the memory the Render service no longer has to reserve around the clock.
    memory=4096,
    timeout=600,
    # Keep a warm container for a few minutes: someone adjusting finishes
    # rebuilds the same home several times in a row.
    scaledown_window=300,
)
@modal.fastapi_endpoint(method="POST", docs=True)
def build(payload: dict, authorization: str = Header(default="") if Header else ""):
    """Build the canonical scene and return its metadata (not the geometry)."""
    _require_token(authorization)

    try:
        result = _worker().build(payload or {})
    except Exception as error:
        # The Node route forwards `error` to the app, so it has to read as a
        # sentence. The traceback stays in Modal's logs.
        import traceback

        traceback.print_exc()
        return {"success": False, "error": str(error)}

    # Only a completed build changes the volume; a cache hit read from it.
    if not result.get("cached"):
        cache_vol.commit()
    return result


@app.function(
    image=renderer_image,
    secrets=[api_key_secret],
    volumes={CACHE_ROOT: cache_vol},
    cpu=1.0,
    memory=1024,
    timeout=300,
    scaledown_window=300,
)
@modal.fastapi_endpoint(method="GET")
def model(name: str = "", authorization: str = Header(default="") if Header else ""):
    """Stream one built GLB back to the API, which caches and serves it."""
    _require_token(authorization)

    path = _model_path(name)
    if not path.is_file():
        # A long-lived container does not see writes another container
        # committed until it reloads. Only pay for that on a miss.
        cache_vol.reload()
    if not path.is_file():
        raise HTTPException(status_code=404, detail="This walkthrough model has expired.")

    return Response(
        content=path.read_bytes(),
        media_type="model/gltf-binary",
        headers={"Cache-Control": "public, max-age=604800, immutable"},
    )


@app.function(image=renderer_image, timeout=120, scaledown_window=300)
@modal.fastapi_endpoint(method="GET")
def health():
    """Answer whether this deployment can actually export a scene.

    The Node API calls this once at boot and caches the answer, so a broken
    deploy shows up in `/healthz` and as a 503 on the Explore step rather than
    as a four-minute timeout per request.
    """
    try:
        import open3d

        worker = _worker()
        return {
            "ok": True,
            "open3d": open3d.__version__,
            "source": worker.interior_plan_source_version(),
        }
    except Exception as error:
        return {"ok": False, "error": str(error)}


@app.local_entrypoint()
def main():
    """Export one 10 m x 8 m living room, to prove the image works.

    Rooms are pixel-space polygons plus a pixels-per-metre scale, exactly as
    `buildLayout` in lib/walkthroughScene.js produces them.

    Usage:  LIVINAI_API_KEY=<your api key> modal run walkthrough_app.py
    """
    payload = {
        "rooms": [[[0, 0], [400, 0], [400, 320], [0, 320]]],
        "doors": [],
        "windows": [],
        "balconies": [],
        "pixelsPerMeter": 40,
        "roomConfigs": [{"name": "Living Room", "roomType": "Living Room", "style": "Modern"}],
        "settings": {},
    }
    # `.remote()` bypasses the HTTP layer but not the check inside it, so the
    # smoke test has to present the same token the Render service does.
    token = os.environ.get("LIVINAI_API_KEY", "")
    result = build.remote(payload, authorization=f"Bearer {token}")
    if not result.get("success"):
        raise SystemExit(f"export failed: {result.get('error')}")
    print(f"built {result['modelName']} (cached={result['cached']})")
