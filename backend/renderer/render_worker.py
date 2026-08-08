"""Build Livinai_web's canonical walkthrough GLB inside this repository.

The Node API launches this worker with request/response JSON file paths. Using
files keeps the protocol reliable even though the original scene builder emits
progress diagnostics on stdout. Generated models are content-addressed and
written atomically, so concurrent requests can safely converge on one cache.
"""

from __future__ import annotations

import json
import os
import sys
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parent
ENGINE_ROOT = ROOT / "engine"
if str(ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(ENGINE_ROOT))

from webgl_walkthrough import (  # noqa: E402
    build_realtime_scene,
    interior_plan_source_version,
    scene_cache_key,
)


OUTPUT_DIR = ROOT / "generated"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def room_configs(room_configs, settings):
    """Match Livinai_web/backend/app.py::_exact_room_configs exactly."""
    return [
        {
            "name": room.get("name", f"Room {index + 1}"),
            "room_type": room.get("roomType", "Living Room"),
            "style": room.get("style", "Modern"),
            "design_profile": settings.get("designProfile", "Curated"),
            "color_mood": settings.get("colorMood", "Warm neutral"),
            "design_notes": settings.get("notes", ""),
            "floor_finish": settings.get("floorFinish", "Auto by style"),
            "wall_finish": settings.get("wallFinish", "Auto by style"),
            "rug_design": settings.get("rugDesign", "Auto by style"),
            "curtain_design": settings.get("curtainDesign", "Auto by style"),
            "decor_set": settings.get("decorSet", "Auto by style"),
            "design_seed": "preference-render-v4",
            "whole_room_design": True,
            "use_catalog": True,
            "use_triposr": False,
            "kitchen_type": room.get("kitchenType", ""),
        }
        for index, room in enumerate(room_configs)
    ]


def build(payload):
    rooms = payload.get("rooms") or []
    if not rooms:
        raise ValueError("At least one measured room is required.")

    doors = payload.get("doors") or []
    windows = payload.get("windows") or []
    balconies = payload.get("balconies") or []
    settings = payload.get("settings") or {}
    configs = room_configs(payload.get("roomConfigs") or [], settings)
    if len(configs) != len(rooms):
        raise ValueError("Every room must have one room configuration.")

    cache_payload = {
        "rooms": rooms,
        "doors": doors,
        "windows": windows,
        "balconies": balconies,
        "pixelsPerMeter": payload.get("pixelsPerMeter"),
        "configs": configs,
        "rendererRevision": payload.get("rendererRevision"),
        "format": "interior-plan-gltf-v40-wardrobe-first-bedrooms",
        "interiorPlanSource": interior_plan_source_version(),
    }
    cache_id = scene_cache_key(cache_payload)
    model_path = OUTPUT_DIR / f"{cache_id}.glb"
    metadata_path = OUTPUT_DIR / f"{cache_id}.json"

    if model_path.is_file() and metadata_path.is_file():
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        return {"success": True, "cached": True, "modelName": model_path.name, **metadata}

    token = uuid.uuid4().hex
    temporary_model = OUTPUT_DIR / f".{cache_id}.{token}.glb"
    temporary_metadata = OUTPUT_DIR / f".{cache_id}.{token}.json"
    try:
        metadata = build_realtime_scene(
            temporary_model,
            rooms,
            doors,
            windows,
            balconies,
            configs,
            payload.get("pixelsPerMeter"),
        )
        temporary_metadata.write_text(
            json.dumps(metadata, separators=(",", ":")),
            encoding="utf-8",
        )
        # Another worker may have completed the same deterministic scene first.
        # Replacing is safe because both files are already complete and share the
        # same source/configuration hash.
        os.replace(temporary_model, model_path)
        os.replace(temporary_metadata, metadata_path)
        return {"success": True, "cached": False, "modelName": model_path.name, **metadata}
    finally:
        temporary_model.unlink(missing_ok=True)
        temporary_metadata.unlink(missing_ok=True)


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: render_worker.py REQUEST_JSON RESPONSE_JSON")
    request_path = Path(sys.argv[1]).resolve()
    response_path = Path(sys.argv[2]).resolve()
    try:
        payload = json.loads(request_path.read_text(encoding="utf-8"))
        result = build(payload)
        exit_code = 0
    except Exception as error:  # The Node route returns the safe message.
        result = {"success": False, "error": str(error)}
        exit_code = 1
    response_path.write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")
    raise SystemExit(exit_code)


if __name__ == "__main__":
    main()
