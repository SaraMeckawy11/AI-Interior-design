"""Livinai RunPod worker — the primary engine behind `POST /api/designs`.

The backend submits here first and only falls back to Modal, so this worker has
to answer with the same picture Modal would have produced. It therefore runs the
engines ported from `modal/app.py` (see `inference_core.py`) and routes between
them by the same rule Modal's router uses:

* `mode: "guided"` with drawn room polygons -> SD 1.5 + depth/seg ControlNets,
  because that mode is a rasterised mask of the user's polygons and FLUX.2
  [klein] has no ControlNet.
* everything else -> Gen-Klein, `black-forest-labs/FLUX.2-klein-4B`.

This replaced a worker that ran SD 1.5 for *every* request. It shared
`prompt_engine.py` with Modal, so a design meant the same thing on both hosts —
but it was a different model, and since RunPod answers first that meant nearly
every user got the SD 1.5 picture while the FLUX.2 [klein] path the prompts were
written for only ran when RunPod failed.

Endpoint requirements, both new here:

* **A 48 GB GPU class.** Gen-Klein runs the 4B transformer plus the Qwen3 text
  encoder in bf16 with no CPU offload, the way `GenKlein` runs on Modal's L40S.
* **Room for ~16 GB of FLUX weights.** The Dockerfile bakes them in by default;
  attach a network volume and build with `--build-arg PREFETCH_FLUX=0` to keep
  them out of the image instead. `_cache_dir_for` finds them either way.

Response shape matches Modal's exactly:

    {"message", "generatedImage", "prompt", "negative_prompt",
     "engine", "model", "mode", "has_window"}
"""

import os

import runpod

from inference_core import (
    FLUX_MODEL_ID,
    SD_MODEL_ID,
    ControlNetEngine,
    GenKleinEngine,
    is_guided_request,
)

# Weights baked into the image by the Dockerfile.
BAKED_CACHE_DIR = "/home/user/.cache/huggingface"
# RunPod mounts a network volume here when the endpoint has one attached.
VOLUME_CACHE_DIR = "/runpod-volume/huggingface"


def _has_snapshot(cache_dir, model_id):
    """True when `model_id` is already downloaded under `cache_dir`."""
    folder = "models--" + model_id.replace("/", "--")
    return os.path.isdir(os.path.join(cache_dir, folder, "snapshots"))


def _cache_dir_for(model_id):
    """Where to read/write `model_id`, given what this worker actually has.

    Whichever cache already holds the checkpoint wins, so a baked image and an
    attached network volume can both be right and neither re-downloads 16 GB.
    Only when nothing has it yet does the choice matter: the volume, if one is
    mounted, so the download survives the worker.

    `LIVINAI_CACHE_DIR` overrides all of it.
    """
    override = os.environ.get("LIVINAI_CACHE_DIR")
    if override:
        return override
    for cache_dir in (BAKED_CACHE_DIR, VOLUME_CACHE_DIR):
        if _has_snapshot(cache_dir, model_id):
            return cache_dir
    volume_mounted = os.path.isdir(os.path.dirname(VOLUME_CACHE_DIR))
    return VOLUME_CACHE_DIR if volume_mounted else BAKED_CACHE_DIR


_ENGINE_TYPES = {
    "gen-klein": (GenKleinEngine, FLUX_MODEL_ID),
    "controlnet": (ControlNetEngine, SD_MODEL_ID),
}

# At most one entry: see the eviction in `_engine`.
_loaded = {}


def _engine(name):
    """Return the named engine, loading it and evicting the other one first.

    Modal can keep both resident because each is a separate GPU container. Here
    they would share one card, and they do not fit on it together — so the rare
    guided request pays a reload rather than the common one risking an OOM.
    Warm workers serving one kind of request, which is nearly all of them, load
    once and keep it.
    """
    existing = _loaded.get(name)
    if existing is not None:
        return existing

    for other, engine in list(_loaded.items()):
        print(f"[engine] unloading {other} to make room for {name}")
        engine.unload()
        _loaded.pop(other, None)

    engine_type, model_id = _ENGINE_TYPES[name]
    cache_dir = _cache_dir_for(model_id)
    print(f"[engine] loading {name} ({model_id}) from {cache_dir}")
    engine = engine_type(cache_dir=cache_dir).load()
    _loaded[name] = engine
    return engine


def handler(event):
    try:
        body = event.get("input") or {}

        image = body.get("image")
        if not image:
            return {"error": "Missing image"}

        mode = (body.get("mode") or "").strip()
        rooms = body.get("rooms") if isinstance(body.get("rooms"), list) else None
        doors = body.get("doors") if isinstance(body.get("doors"), list) else None
        canvas = body.get("canvas") if isinstance(body.get("canvas"), dict) else None
        room_type = (body.get("room_type") or "").strip()
        design_style = (body.get("design_style") or "").strip()
        color_tone = (body.get("color_tone") or "").strip()
        # The 60/30/10 scheme the app resolved from that tone and showed the user
        # before they generated. Absent on older clients; the prompt engine falls
        # back to naming only the dominant.
        color_palette = body.get("color_palette") if isinstance(body.get("color_palette"), dict) else None
        custom_prompt = body.get("custom_prompt") or ""

        if is_guided_request(mode, rooms):
            return _engine("controlnet").run(
                image=image,
                room_type=room_type,
                design_style=design_style,
                color_tone=color_tone,
                custom_prompt=custom_prompt,
                rooms=rooms,
                canvas=canvas,
                mode=mode,
                doors=doors,
                color_palette=color_palette,
            )

        return _engine("gen-klein").run(
            image=image,
            room_type=room_type,
            design_style=design_style,
            color_tone=color_tone,
            custom_prompt=custom_prompt,
            mode=mode or "interior",
            material=(body.get("material") or "Natural oak").strip(),
            lighting=(body.get("lighting") or "Natural daylight").strip(),
            preserve_geometry=body.get("preserve_geometry", True),
            creativity=int(body.get("creativity") or 42),
            color_palette=color_palette,
        )

    except Exception as error:
        # RunPod reports this as a FAILED job, which is the backend's cue to fall
        # back to Modal — so a bad request here still reaches the user as a
        # design rather than as an error.
        print(f"[handler] generation failed: {error}")
        return {"error": str(error)}


# ---------------------------------------------------------------------------
# ENTRYPOINT
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
