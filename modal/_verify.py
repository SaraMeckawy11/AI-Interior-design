import json, modal
ROOM = [[0.0, 0.0], [4.4, 0.0], [4.4, 3.8], [0.0, 3.8]]
build = modal.Function.from_name("livinai-walkthrough", "build_scene")
for style in ("Modern", "Classic"):
    r = build.remote({
        "rooms": [ROOM], "doors": [], "windows": [], "balconies": [],
        "pixelsPerMeter": 1.0,
        "roomConfigs": [{"name": "Living Room", "roomType": "Living Room", "style": style}],
        "settings": {"useCatalog": True},
        "rendererRevision": "verify-catalog-v1",
    })
    print(json.dumps({"style": style, "modelName": r.get("modelName"), "cached": r.get("cached")}))
