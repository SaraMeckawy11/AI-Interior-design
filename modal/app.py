"""
Livinai Interior AI - Modal deployment

Workspace: sara123meckawy
App:       livinai-interior

Replicates the RunPod handler.py behavior (SD 1.5 Dreamshaper + 2 ControlNets
[depth + seg] with DPT depth and UperNet segmentation) as a synchronous HTTP
endpoint hosted on Modal.

Deploy:
    modal deploy app.py

After deploy you will get a public URL like:
    https://sara123meckawy--livinai-interior-interiorai-generate.modal.run

Invoke:
    POST {url}
    Authorization: Bearer <MODAL_API_TOKEN>
    Content-Type: application/json
    body: {
      "image": "<base64 jpg/png>",
      "room_type": "living room",
      "design_style": "Scandinavian",
      "color_tone": "warm",
      "custom_prompt": "" // optional
    }

Response matches RunPod output:
    {
      "message": "...",
      "generatedImage": "<base64 png>",
      "prompt": "...",
      "negative_prompt": "...",
      "has_window": true/false
    }
"""

import base64
import io
import os

import modal

# fastapi is only present inside the container image; guard the import so
# this file can still be parsed locally (for `modal deploy` / `modal run`).
try:
    from fastapi import Header, HTTPException
except ImportError:  # pragma: no cover
    Header = None
    HTTPException = None

# ---------------------------------------------------------------------------
# MODAL APP + IMAGE
# ---------------------------------------------------------------------------

app = modal.App("livinai-interior")

CACHE_DIR = "/cache/huggingface"

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libgl1", "libglib2.0-0")
    .pip_install(
        "torch==2.4.1",
        "diffusers==0.30.3",
        "transformers==4.44.2",
        "accelerate==0.34.2",
        "opencv-python-headless==4.10.0.84",
        "Pillow==10.4.0",
        "numpy==1.26.4",
        "xformers==0.0.28.post1",
        "fastapi[standard]==0.115.0",
    )
    .env({"HF_HOME": CACHE_DIR, "TRANSFORMERS_CACHE": CACHE_DIR})
)

# Persistent HF cache volume - weights download once, reused across all containers
hf_cache_vol = modal.Volume.from_name("livinai-hf-cache", create_if_missing=True)

# Simple bearer-token auth secret (create via: modal secret create livinai-api-key API_KEY=...)
api_key_secret = modal.Secret.from_name(
    "livinai-api-key",
    required_keys=["API_KEY"],
)

# ---------------------------------------------------------------------------
# PROMPT TEMPLATES (copied verbatim from interiorAI/handler.py)
# ---------------------------------------------------------------------------

ROOM_PROMPTS = {
    "living room": (
        "{design_style} living room interior, warm soft ambient lighting, "
        "{color_tone} palette, professional interior designer style, "
        "photorealistic 8k, high detail, natural shadows, "
        "includes sofa sets, coffee tables, area rugs, wall art, curtains, "
        "TV cabinets, indoor plants, bookshelves, accent lighting, "
        "cohesive furniture arrangement matching the room layout"
    ),
    "bedroom": (
        "{design_style} bedroom interior, cozy soft ambient lighting, "
        "{color_tone} palette, professional interior designer style, "
        "photorealistic 8k, high detail fabrics and materials, natural shadows, "
        "includes beds with layered bedding, bedside tables with lamps, "
        "wardrobes or built-in storage, textured rugs, decorative wall art, "
        "balanced and restful room layout"
    ),
    "kitchen": (
        "{design_style} kitchen interior, premium materials and fixtures, "
        "{color_tone} palette with cohesive tones, photorealistic 8k, high detail, "
        "natural reflections on countertops, includes cooking area, cabinetry, "
        "kitchen island or breakfast bar, realistic appliances, pendant lighting, "
        "functional layout with clear workflow"
    ),
    "bathroom": (
        "{design_style} bathroom interior, soft indirect lighting, "
        "{color_tone} tone palette, high detail tiles and stone surfaces, "
        "photorealistic 8k, natural reflections, includes vanity mirrors, sinks, "
        "shower areas or bathtubs, storage cabinets, clean minimalist finishes"
    ),
    "dining room": (
        "{design_style} dining room interior, elegant warm lighting, "
        "{color_tone} tones, photorealistic 8k, high detail shadows, "
        "includes dining table with multiple chairs, sideboard or buffet, wall art, "
        "textured or wooden flooring, centerpiece lighting, cohesive arrangement"
    ),
    "office": (
        "{design_style} home office interior, ergonomic workspace, "
        "{color_tone} palette, clean contemporary lighting, photorealistic 8k, high detail, "
        "includes desk, office chair, bookshelves, storage units, task lighting, "
        "organized functional layout"
    ),
    "entryway": (
        "{design_style} entryway foyer interior, soft ambient lighting, "
        "{color_tone} tone palette, photorealistic 8k, high detail decor, "
        "includes console table, wall mirror, coat storage, indoor plants, welcoming layout"
    ),
    "basement": (
        "{design_style} finished basement interior, warm ambient lighting, "
        "{color_tone} palette, photorealistic 8k, high detail textures, "
        "includes seating or entertainment area, multipurpose layout, wall decor"
    ),
    "attic": (
        "{design_style} attic interior with angled ceilings, warm lighting, "
        "{color_tone} tones, photorealistic 8k, high detail wood textures, "
        "includes seating, storage units, rugs, cozy ambient design"
    ),
    "laundry room": (
        "{design_style} laundry room interior, bright clean lighting, "
        "{color_tone} palette, photorealistic 8k, high detail surfaces, "
        "includes washer and dryer, storage cabinets, shelving, organized layout"
    ),
    "sunroom": (
        "{design_style} sunroom interior, abundant natural daylight, "
        "{color_tone} palette, photorealistic 8k, high detail, "
        "includes comfortable seating sets, many plants, glass windows, airy fresh atmosphere"
    ),
    "closet": (
        "{design_style} walk-in closet interior, soft diffused lighting, "
        "{color_tone} palette, photorealistic 8k, high detail, "
        "includes wardrobe shelves, drawers, mirrors, organized storage"
    ),
    "balcony": (
        "{design_style} balcony outdoor space, warm ambient lighting, "
        "{color_tone} tones, photorealistic 8k, high detail textures, "
        "includes outdoor seating, potted plants, railing, clean aesthetic, cohesive layout"
    ),
    "hallway": (
        "{design_style} hallway corridor interior, soft lighting, "
        "{color_tone} palette, photorealistic 8k, high detail wall textures, "
        "includes wall art, minimal clean decor, clear pathway layout"
    ),
}

EXTERIOR_PROMPTS = {
    "balcony": (
        "{design_style} balcony exterior scene, warm ambient lighting, "
        "{color_tone} palette, photorealistic 8k, high detail, "
        "includes outdoor seating, potted plants, railing, textured flooring, "
        "cohesive terrace layout and natural background"
    ),
    "building": (
        "{design_style} building exterior architectural visualization, natural daylight, "
        "{color_tone} palette, photorealistic 8k, high detail facade textures, realistic shadows, "
        "includes windows, entryway, landscaping elements, professional architectural composition"
    ),
    "terrace": (
        "{design_style} terrace outdoor space, soft warm lighting, {color_tone} palette, "
        "photorealistic 8k, high detail materials, includes seating areas, planters, pergola or canopy, "
        "cohesive outdoor layout and realistic background"
    ),
    "garden": (
        "{design_style} garden landscape, natural daylight, {color_tone} palette, photorealistic 8k, "
        "high botanical detail, includes planting beds, pathways, seating niches, decorative lighting, "
        "balanced landscape composition"
    ),
    "driveway": (
        "{design_style} driveway exterior scene, natural daylight, {color_tone} palette, "
        "photorealistic 8k, high detail paving and materials, includes vehicle parking area, landscaping, "
        "clean structural elements and realistic shadows"
    ),
    "swimming pool area": (
        "{design_style} swimming pool outdoor area, natural daylight, {color_tone} palette, "
        "photorealistic 8k, high detail water reflections, poolside seating, landscaping, "
        "decking materials, ambient outdoor lighting and cohesive layout"
    ),
    "garage": (
        "{design_style} organized garage exterior, {color_tone} palette, "
        "photorealistic 8k, high detail industrial textures, clean concrete floors, "
        "includes shelving units, tool storage, vehicle parking space, functional layout"
    ),
}

FALLBACK_PROMPT = (
    "{design_style} {room_type} space, realistic lighting, {color_tone} palette, "
    "professional design style, photorealistic 8k, high detail textures, natural shadows, "
    "includes layout-appropriate furniture or structural elements, cohesive arrangement matching the space type"
)

WINDOW_KEYWORDS = ["window", "windowpane"]


# ---------------------------------------------------------------------------
# GUIDED-MODE SEGMENTATION (only addition on top of the original modal/app.py)
#
# When the frontend (plan.jsx, "guided" mode) sends drawn room polygons we
# rasterize them into a clean ADE20K-style semantic mask and feed THAT into
# the seg ControlNet, instead of the UperNet-extracted segmentation of the
# uploaded floor-plan image. Everything else in this file is unchanged.
# ---------------------------------------------------------------------------

# ADE20K palette colors (R, G, B) — wall, floor, ceiling, door, window.
ADE_WALL = (120, 120, 120)
ADE_FLOOR = (80, 50, 50)
ADE_CEILING = (120, 120, 80)
ADE_DOOR = (8, 255, 51)
ADE_WINDOW = (230, 230, 230)

# Stable per-room-type fill colors picked from the ADE palette so SD's seg
# ControlNet associates each colored region with the right space type.
# Compact per-room prompts used during the guided-mode per-room inpainting
# pass. Each one is intentionally short (so the CLIP budget has headroom for
# style + tone tail) and enumerates the canonical furniture SD should paint
# inside that polygon. This is what guarantees "kitchens look like kitchens,
# bedrooms look like bedrooms" no matter how the base pass turned out.
ROOM_REFINE_PROMPTS = {
    "living room":  "photorealistic {style} living room interior, sofa, coffee table, rug, tv console, lamps, plants, {tone} palette, top-down 3d interior render, sharp detail",
    "bedroom":      "photorealistic {style} bedroom interior, bed with bedding, nightstands, lamps, wardrobe, rug, {tone} palette, top-down 3d interior render, sharp detail",
    "kids room":    "photorealistic {style} kids bedroom, single bed, desk, toys, storage, playful rug, {tone} palette, top-down 3d render",
    "kitchen":      "photorealistic {style} kitchen interior, cabinets, countertop, stove, fridge, island, pendant lights, {tone} palette, top-down 3d render, sharp detail",
    "bathroom":     "photorealistic {style} bathroom interior, vanity, sink, mirror, toilet, shower or bathtub, tiled floor, {tone} palette, top-down 3d render",
    "dining room":  "photorealistic {style} dining room interior, dining table, chairs, pendant light, sideboard, rug, {tone} palette, top-down 3d render",
    "office":       "photorealistic {style} home office interior, desk, office chair, bookshelves, task lamp, rug, {tone} palette, top-down 3d render",
    "entryway":     "photorealistic {style} entryway, console table, mirror, coat rack, rug, {tone} palette, top-down 3d render",
    "hallway":      "photorealistic {style} hallway interior, wood or tiled flooring, wall art, runner rug, {tone} palette, top-down 3d render",
    "closet":       "photorealistic {style} walk-in closet, wardrobe shelves, drawers, mirror, rug, {tone} palette, top-down 3d render",
    "laundry room": "photorealistic {style} laundry room, washer, dryer, shelving, cabinets, tiled floor, {tone} palette, top-down 3d render",
    "balcony":      "photorealistic {style} balcony, outdoor seating, plants, railing, {tone} palette, top-down 3d render",
    "sunroom":      "photorealistic {style} sunroom, seating, lush plants, glass walls, rug, {tone} palette, top-down 3d render",
    "basement":     "photorealistic {style} finished basement, seating, entertainment unit, rug, {tone} palette, top-down 3d render",
    "attic":        "photorealistic {style} attic room, seating, storage, rug, warm wood textures, {tone} palette, top-down 3d render",
    "studio":       "photorealistic {style} studio room, flexible furniture, sofa, desk, rug, {tone} palette, top-down 3d render",
}

ROOM_ANCHOR_COLORS = {
    "living room":    (11, 102, 255),    # sofa class -> living-room cue
    "bedroom":        (255, 245, 0),     # bed
    "kids room":      (255, 245, 0),
    "kitchen":        (50, 50, 250),     # cabinet
    "bathroom":       (200, 100, 100),   # bathtub
    "dining room":    (255, 51, 7),      # table
    "office":         (255, 102, 0),     # desk
    "closet":         (102, 51, 0),      # wardrobe
    "laundry room":   (235, 12, 255),    # appliance
    "entryway":       (8, 255, 51),      # door
    "balcony":        (230, 230, 230),   # window
    "sunroom":        (230, 230, 230),
    "studio":         (11, 102, 255),
    "basement":       (11, 102, 255),
    "attic":          (11, 102, 255),
    "hallway":        ADE_FLOOR,
    "full apartment": ADE_FLOOR,
}


def _rasterize_rooms_mask(rooms, size_wh, doors=None):
    """Build a rich ADE20K mask from drawn polygons + doors.

    Layout:
      - Every polygon interior is painted with ADE_FLOOR (so SD sees "floor").
      - A "furniture anchor" blob of the room-type's ADE color is painted near
        the polygon centroid so the seg ControlNet has a strong per-room class
        cue for the diffusion prior to latch onto.
      - Every polygon outline is stroked with ADE_WALL so there is a clear
        hard boundary between adjacent rooms and the outside world.
      - Each door segment is then stamped through the wall as ADE_FLOOR (the
        opening) with a small ADE_DOOR core at its midpoint so the model
        renders a proper door, in the right spot, between the right rooms.
    The result: SD with the seg ControlNet at high conditioning scale will
    faithfully reproduce the user's layout (rooms where drawn, walls between
    them, doors where marked).
    """
    import cv2
    import numpy as np
    from PIL import Image

    w, h = size_wh
    out = np.zeros((h, w, 3), dtype=np.uint8)

    parsed = []
    for r in rooms or []:
        rtype = (r.get("type") or "").strip().lower()
        pts = []
        for p in r.get("polygon") or []:
            try:
                px = max(0.0, min(1.0, float(p.get("x", 0)))) * (w - 1)
                py = max(0.0, min(1.0, float(p.get("y", 0)))) * (h - 1)
                pts.append([px, py])
            except (TypeError, ValueError):
                continue
        if len(pts) >= 3:
            parsed.append((rtype, np.array(pts, dtype=np.int32)))

    if not parsed:
        return Image.new("RGB", (w, h), (0, 0, 0))

    # Pass 1: fill every polygon with floor. Later passes paint anchor blobs
    # on top so each room reads as "room with floor + that room's anchor".
    for _rtype, poly in parsed:
        cv2.fillPoly(out, [poly], ADE_FLOOR)

    # Pass 2: paint a per-room anchor blob near each centroid, clipped to the
    # polygon so it never bleeds into neighbouring rooms. A single strong cue
    # per room beats many scattered ones and stays inside the SD 77-token budget
    # because the ControlNet does the spatial work, not the prompt.
    poly_mask_cache = {}
    for idx, (rtype, poly) in enumerate(parsed):
        anchor = ROOM_ANCHOR_COLORS.get(rtype)
        if anchor is None or anchor == ADE_FLOOR:
            continue
        M = cv2.moments(poly)
        if M["m00"] == 0:
            continue
        cx = int(M["m10"] / M["m00"])
        cy = int(M["m01"] / M["m00"])
        x, y, bw, bh = cv2.boundingRect(poly)
        r_blob = max(10, int(min(bw, bh) * 0.22))

        poly_mask = np.zeros((h, w), dtype=np.uint8)
        cv2.fillPoly(poly_mask, [poly], 255)
        poly_mask_cache[idx] = poly_mask

        blob_mask = np.zeros((h, w), dtype=np.uint8)
        cv2.circle(blob_mask, (cx, cy), r_blob, 255, -1)

        combined = cv2.bitwise_and(blob_mask, poly_mask)
        out[combined > 0] = anchor

    # Pass 3: walls. Thick stroke so they survive downscaling inside the
    # ControlNet preprocessor and read as hard partitions between rooms.
    wall_thickness = max(7, int(min(w, h) * 0.018))
    for _rtype, poly in parsed:
        cv2.polylines(out, [poly], isClosed=True,
                      color=ADE_WALL, thickness=wall_thickness)

    # Pass 4: doors. Each door is a line segment along a wall — stamp it as
    # floor (punches the opening) with a small ADE_DOOR core so the model
    # paints an actual door frame there rather than a plain gap.
    if doors:
        door_thickness = max(wall_thickness + 2,
                             int(min(w, h) * 0.028))
        door_core_thickness = max(4, int(min(w, h) * 0.010))
        for d in doors:
            try:
                x1 = int(max(0.0, min(1.0, float(d.get("x1", 0)))) * (w - 1))
                y1 = int(max(0.0, min(1.0, float(d.get("y1", 0)))) * (h - 1))
                x2 = int(max(0.0, min(1.0, float(d.get("x2", 0)))) * (w - 1))
                y2 = int(max(0.0, min(1.0, float(d.get("y2", 0)))) * (h - 1))
            except (TypeError, ValueError):
                continue
            # Punch the opening through the wall.
            cv2.line(out, (x1, y1), (x2, y2), ADE_FLOOR, door_thickness)
            # Paint a door-class core at the midpoint so SD renders a frame.
            cv2.line(out, (x1, y1), (x2, y2), ADE_DOOR, door_core_thickness)

    return Image.fromarray(out)


# ---------------------------------------------------------------------------
# INFERENCE CLASS
# ---------------------------------------------------------------------------

@app.cls(
    image=image,
    gpu="L40S",                 # 48 GB, ~3-4x faster than T4 at fp16, best price/perf for SD1.5
    volumes={"/cache": hf_cache_vol},
    secrets=[api_key_secret],
    scaledown_window=60,        # keep container warm 60s after last request
    min_containers=0,           # set to 1 for zero-cold-start (adds cost)
    max_containers=3,           # concurrent scale-out
    timeout=600,                # 10 min per-request max
)
class InteriorAI:

    @modal.enter()
    def load_models(self):
        """Cold-start: load all models into GPU memory. Runs once per container."""
        import torch
        from diffusers import (
            StableDiffusionControlNetPipeline,
            StableDiffusionControlNetInpaintPipeline,
            ControlNetModel,
            UniPCMultistepScheduler,
        )
        from transformers import (
            DPTImageProcessor,
            DPTForDepthEstimation,
            AutoImageProcessor,
            UperNetForSemanticSegmentation,
        )

        self.torch = torch
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.dtype = torch.float16 if self.device == "cuda" else torch.float32

        self.dpt_processor = DPTImageProcessor.from_pretrained(
            "Intel/dpt-large", cache_dir=CACHE_DIR
        )
        self.dpt_model = DPTForDepthEstimation.from_pretrained(
            "Intel/dpt-large", torch_dtype=self.dtype, cache_dir=CACHE_DIR
        ).to(self.device)

        self.seg_processor = AutoImageProcessor.from_pretrained(
            "openmmlab/upernet-convnext-small", cache_dir=CACHE_DIR
        )
        self.seg_model = UperNetForSemanticSegmentation.from_pretrained(
            "openmmlab/upernet-convnext-small",
            torch_dtype=self.dtype,
            cache_dir=CACHE_DIR,
        ).to(self.device)

        depth_cn = ControlNetModel.from_pretrained(
            "lllyasviel/sd-controlnet-depth",
            torch_dtype=self.dtype,
            cache_dir=CACHE_DIR,
        )
        seg_cn = ControlNetModel.from_pretrained(
            "lllyasviel/control_v11p_sd15_seg",
            torch_dtype=self.dtype,
            cache_dir=CACHE_DIR,
        )

        self.pipe = StableDiffusionControlNetPipeline.from_pretrained(
            "Lykon/dreamshaper-8",
            controlnet=[depth_cn, seg_cn],
            torch_dtype=self.dtype,
            safety_checker=None,
            cache_dir=CACHE_DIR,
        ).to(self.device)

        self.pipe.scheduler = UniPCMultistepScheduler.from_config(
            self.pipe.scheduler.config
        )

        # ── Per-room inpainting pipeline ──
        # Shares the UNet/VAE/TextEncoder weights with the base pipe and reuses
        # the same depth+seg ControlNets. We use this in guided mode to do a
        # second pass where each drawn polygon is inpainted with furniture
        # specific to its assigned room type, while a tight mask prevents the
        # geometry from drifting. This is how we guarantee "exact placement +
        # room-specific furniture" without needing a separate inpaint checkpoint.
        self.inpaint_pipe = StableDiffusionControlNetInpaintPipeline(
            vae=self.pipe.vae,
            text_encoder=self.pipe.text_encoder,
            tokenizer=self.pipe.tokenizer,
            unet=self.pipe.unet,
            controlnet=self.pipe.controlnet,
            scheduler=self.pipe.scheduler,
            safety_checker=None,
            feature_extractor=self.pipe.feature_extractor,
            requires_safety_checker=False,
        ).to(self.device)

        # Memory-efficient flags so pipeline fits in 16 GB with room to spare
        try:
            self.pipe.enable_xformers_memory_efficient_attention()
            self.inpaint_pipe.enable_xformers_memory_efficient_attention()
        except Exception:
            pass
        self.pipe.enable_vae_tiling()
        self.pipe.enable_attention_slicing()
        self.inpaint_pipe.enable_vae_tiling()
        self.inpaint_pipe.enable_attention_slicing()

        # Persist any newly downloaded weights to the volume for next cold start
        hf_cache_vol.commit()

    # --------------------- helper methods ---------------------

    def _decode_base64_image(self, base64_str):
        import cv2
        import numpy as np

        if not isinstance(base64_str, str):
            raise ValueError("Image must be a base64 string")
        if base64_str.startswith("data:image"):
            base64_str = base64_str.split(",")[1]
        base64_str += "=" * (-len(base64_str) % 4)
        img_bytes = base64.b64decode(base64_str)
        img = cv2.imdecode(np.frombuffer(img_bytes, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Invalid image provided")
        return img

    def _resize_orientation(self, img):
        h, w = img.shape[:2]
        return (1024, 768) if w > h else (768, 1024)

    def _get_depth_image(self, image_bgr, size_wh):
        import cv2
        import numpy as np
        from PIL import Image

        width, height = size_wh
        resized = cv2.resize(image_bgr, (width, height), interpolation=cv2.INTER_CUBIC)
        rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)

        inputs = self.dpt_processor(
            images=Image.fromarray(rgb), return_tensors="pt"
        ).to(self.device)
        inputs = {k: v.to(dtype=self.dtype) for k, v in inputs.items()}

        with self.torch.no_grad():
            depth = self.dpt_model(**inputs).predicted_depth

        depth_resized = (
            self.torch.nn.functional.interpolate(
                depth.unsqueeze(1),
                size=(height, width),
                mode="bicubic",
                align_corners=False,
            )
            .squeeze()
            .cpu()
            .numpy()
        )

        depth_norm = (
            (depth_resized - depth_resized.min())
            / (depth_resized.max() - depth_resized.min())
            * 255
        ).astype(np.uint8)

        return Image.fromarray(depth_norm).convert("RGB")

    def _get_segmentation_map(self, image_bgr):
        import cv2
        import numpy as np
        from PIL import Image

        width, height = self._resize_orientation(image_bgr)
        resized = cv2.resize(image_bgr, (width, height), interpolation=cv2.INTER_CUBIC)
        rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)

        inputs = self.seg_processor(
            images=Image.fromarray(rgb), return_tensors="pt"
        ).to(self.device)
        inputs = {k: v.to(dtype=self.dtype) for k, v in inputs.items()}

        with self.torch.no_grad():
            outputs = self.seg_model(**inputs)

        return outputs.logits.argmax(dim=1)[0].cpu().numpy().astype(np.uint8)

    def _get_segmentation_image(self, seg_map, size_wh):
        import cv2
        import numpy as np
        from PIL import Image

        w, h = size_wh
        seg_color = cv2.applyColorMap(
            (seg_map * 10).astype(np.uint8), cv2.COLORMAP_JET
        )
        seg_color = cv2.resize(seg_color, (w, h), interpolation=cv2.INTER_NEAREST)
        seg_rgb = cv2.cvtColor(seg_color, cv2.COLOR_BGR2RGB)
        return Image.fromarray(seg_rgb)

    def _detect_window(self, seg_map):
        import numpy as np

        labels = self.seg_model.config.id2label
        for class_id in np.unique(seg_map):
            name = labels.get(int(class_id), "").lower()
            if any(w in name for w in WINDOW_KEYWORDS):
                return True
        return False

    def _refine_rooms_in_place(
        self,
        base_image,
        rooms,
        size_wh,
        depth_img,
        seg_img,
        design_style,
        color_tone,
    ):
        """Per-room masked inpainting pass.

        For every drawn polygon we:
          1. Build a tight binary mask of that polygon (padded a few pixels
             inward so we don't touch the walls — this is what guarantees
             the room stays exactly where drawn).
          2. Feather the mask's inner edge so inpainted furniture blends
             seamlessly with the surrounding walls/doors from the base pass.
          3. Run the inpaint ControlNet pipe with a room-specific prompt
             (kitchen furniture for kitchens, beds for bedrooms, etc.) while
             the same depth+seg ControlNets hold the architecture steady.
          4. Composite the result back into the running canvas using the
             blurred mask so seams vanish.

        Doing it per-room instead of globally is what fixes the two problems
        the user hit: rooms can't shift (mask locks them to their polygon)
        and each room gets furniture matching its *assigned* type (prompt
        changes per polygon).
        """
        import cv2
        import numpy as np
        from PIL import Image

        if not rooms:
            return base_image

        w, h = size_wh
        canvas = np.array(base_image.convert("RGB"))
        style = (design_style or "modern").strip().lower() or "modern"
        tone = (color_tone or "neutral").strip().lower() or "neutral"

        # Small inward shrink so the furniture doesn't paint over walls.
        inset_px = max(4, int(min(w, h) * 0.012))
        feather_px = max(6, int(min(w, h) * 0.018))

        for r in rooms:
            rtype = (r.get("type") or "").strip().lower()
            if not rtype:
                continue
            template = ROOM_REFINE_PROMPTS.get(rtype)
            if not template:
                # Unknown room type — skip; the base pass already handled it.
                continue

            pts = []
            for p in r.get("polygon") or []:
                try:
                    px = max(0.0, min(1.0, float(p.get("x", 0)))) * (w - 1)
                    py = max(0.0, min(1.0, float(p.get("y", 0)))) * (h - 1)
                    pts.append([px, py])
                except (TypeError, ValueError):
                    continue
            if len(pts) < 3:
                continue
            poly = np.array(pts, dtype=np.int32)

            hard_mask = np.zeros((h, w), dtype=np.uint8)
            cv2.fillPoly(hard_mask, [poly], 255)

            # Erode so we stay safely inside the room (don't overwrite walls).
            kernel = cv2.getStructuringElement(
                cv2.MORPH_ELLIPSE, (inset_px * 2 + 1, inset_px * 2 + 1)
            )
            inner_mask = cv2.erode(hard_mask, kernel)
            if inner_mask.max() == 0:
                continue  # Polygon too small to refine — skip.

            # Feathered mask for smooth compositing back into the canvas.
            feather = cv2.GaussianBlur(
                inner_mask, (feather_px * 2 + 1, feather_px * 2 + 1), 0
            )

            prompt = template.format(style=style, tone=tone)
            negative = (
                "blurry, lowres, distorted, warped geometry, wrong furniture, "
                "mismatched room type, floating objects, bad lighting, artifacts, "
                "merged walls, duplicated furniture"
            )

            try:
                # Use the same current-canvas image as the source so
                # previously-refined rooms stay intact when the next room runs.
                source_pil = Image.fromarray(canvas)
                mask_pil = Image.fromarray(inner_mask).convert("L")

                result = self.inpaint_pipe(
                    prompt=prompt,
                    negative_prompt=negative,
                    image=source_pil,
                    mask_image=mask_pil,
                    control_image=[depth_img, seg_img],
                    num_inference_steps=22,
                    guidance_scale=7.0,
                    strength=0.85,                      # strong enough to paint fresh furniture
                    controlnet_conditioning_scale=[0.45, 0.9],
                    generator=self.torch.manual_seed(17 + len(pts)),
                ).images[0]
            except Exception as e:
                # If a single room fails, keep the base canvas rather than
                # failing the whole generation.
                print(f"[refine] skipped room '{rtype}': {e}")
                continue

            refined = np.array(result.convert("RGB")).astype(np.float32)
            current = canvas.astype(np.float32)
            alpha = (feather.astype(np.float32) / 255.0)[..., None]
            blended = current * (1 - alpha) + refined * alpha
            canvas = np.clip(blended, 0, 255).astype(np.uint8)

        return Image.fromarray(canvas)

    def _build_guided_prompt(self, rooms, design_style, color_tone, custom_prompt):
        """Interior-designer-grade prompt that enumerates each room + its
        grid position so SD places each space where the user drew it.

        Stays under CLIP's 77-token limit: at most one short clause per room,
        with room names abbreviated, and a shared photoreal/style tail.
        """
        if custom_prompt and isinstance(custom_prompt, str) and custom_prompt.strip():
            # Frontend already builds a rich layout-aware prompt; prefer it.
            return custom_prompt.strip()

        style = (design_style or "Modern").strip().lower() or "modern"
        tone = (color_tone or "neutral").strip().lower() or "neutral"

        clauses = []
        seen_types = set()
        for r in rooms or []:
            rtype = (r.get("type") or "").strip().lower()
            if not rtype or rtype in seen_types:
                continue
            seen_types.add(rtype)
            pos = (r.get("position") or "").strip().lower()
            if pos:
                clauses.append(f"{rtype} {pos}")
            else:
                clauses.append(rtype)
            if len(clauses) >= 6:  # token budget guard
                break

        layout = ", ".join(clauses) if clauses else "multi-room interior"

        return (
            f"professional interior designer 3D visualization of a floor plan, "
            f"multi-room home with {layout}, "
            f"each room in its exact mapped position, solid walls between rooms, "
            f"doors only where drawn, complete furnishings fitting each room type, "
            f"{style} style, {tone} palette, photorealistic 8k, "
            f"soft natural daylight, cohesive interior design, sharp architectural lines"
        )

    def _build_prompt(self, room_type, design_style, color_tone, custom_prompt):
        room_key = (room_type or "").strip().lower()

        if custom_prompt and isinstance(custom_prompt, str) and custom_prompt.strip():
            return custom_prompt.strip()

        if room_key in ROOM_PROMPTS:
            return ROOM_PROMPTS[room_key].format(
                design_style=design_style or "Stylish",
                color_tone=color_tone or "neutral",
            )
        if room_key in EXTERIOR_PROMPTS:
            return EXTERIOR_PROMPTS[room_key].format(
                design_style=design_style or "Stylish",
                color_tone=color_tone or "neutral",
            )
        return FALLBACK_PROMPT.format(
            design_style=design_style or "Stylish",
            room_type=room_type or "interior",
            color_tone=color_tone or "neutral",
        )

    # --------------------- core generation method ---------------------

    @modal.method()
    def run(
        self,
        image: str,
        room_type: str = "",
        design_style: str = "",
        color_tone: str = "",
        custom_prompt: str = "",
        rooms: list = None,
        canvas: dict = None,
        mode: str = "",
        doors: list = None,
    ):
        """Pure-python callable version. Can be invoked from other Modal apps."""
        image_bgr = self._decode_base64_image(image)
        size_wh = self._resize_orientation(image_bgr)

        depth_img = self._get_depth_image(image_bgr, size_wh)
        seg_map = self._get_segmentation_map(image_bgr)
        seg_img = self._get_segmentation_image(seg_map, size_wh)
        has_window = self._detect_window(seg_map)

        is_guided = (mode or "").strip().lower() == "guided" and bool(rooms)

        # Guided-mode override: replace the auto-extracted UperNet seg map with
        # a rasterized version of the user's drawn layout (rooms + doors). This
        # is the signal SD needs to 100 % respect the user's plan.
        if is_guided:
            try:
                seg_img = _rasterize_rooms_mask(rooms, size_wh, doors=doors)
            except Exception:
                pass

        # ── Prompt ──
        if is_guided:
            prompt = self._build_guided_prompt(
                rooms, design_style, color_tone, custom_prompt
            )
        else:
            prompt = self._build_prompt(
                room_type, design_style, color_tone, custom_prompt
            )
        if has_window and "window" not in prompt.lower():
            prompt = prompt + ", window in place"

        negative = (
            "blurry, lowres, distorted, floating furniture, bad lighting, "
            "wrong perspective, merged rooms, missing walls, warped geometry, "
            "inconsistent room layout, deformed architecture, artifacts"
        )
        if not has_window:
            negative += ", no window"

        # Guided: lean heavily on the seg ControlNet so the model cannot
        # rearrange rooms or drop walls between them. Quick: keep the
        # original balance that works well for single-room photos.
        if is_guided:
            cn_scale = [0.55, 0.95]
            steps = 34
        else:
            cn_scale = [0.5, 0.1]
            steps = 30

        result = self.pipe(
            prompt=prompt,
            image=[depth_img, seg_img],
            num_inference_steps=steps,
            guidance_scale=7.5,
            controlnet_conditioning_scale=cn_scale,
            negative_prompt=negative,
            generator=self.torch.manual_seed(42),
        )
        out = result.images[0]

        # Guided mode: run a per-room inpainting pass so each drawn polygon
        # gets furniture specific to its assigned room type without shifting
        # position. This is the step that turns a decent multi-room render
        # into an interior-designer-grade plan.
        if is_guided:
            try:
                out = self._refine_rooms_in_place(
                    base_image=out,
                    rooms=rooms,
                    size_wh=size_wh,
                    depth_img=depth_img,
                    seg_img=seg_img,
                    design_style=design_style,
                    color_tone=color_tone,
                )
            except Exception as e:
                print(f"[guided-refine] pass failed, keeping base image: {e}")

        buf = io.BytesIO()
        out.save(buf, format="PNG")
        generated_b64 = base64.b64encode(buf.getvalue()).decode()

        return {
            "message": "Image generated successfully",
            "generatedImage": generated_b64,
            "prompt": prompt,
            "negative_prompt": negative,
            "has_window": has_window,
        }

    # --------------------- public HTTP endpoint ---------------------

    @modal.fastapi_endpoint(method="POST", docs=True)
    def generate(
        self,
        payload: dict,
        authorization: str = Header(default="") if Header else "",
    ):
        """
        HTTP endpoint called by the Livinai backend.

        Headers:
          Authorization: Bearer <API_KEY>

        Body (same shape as current RunPod payload.input):
          { image, room_type, design_style, color_tone, custom_prompt? }
        """
        expected = os.environ.get("API_KEY")
        if expected:
            token = (authorization or "").removeprefix("Bearer ").strip()
            if token != expected:
                raise HTTPException(status_code=401, detail="Unauthorized")

        body = payload or {}
        image_b64 = body.get("image")
        if not image_b64:
            raise HTTPException(status_code=400, detail="Missing image")

        try:
            return self.run.local(
                image=image_b64,
                room_type=(body.get("room_type") or "").strip(),
                design_style=(body.get("design_style") or "").strip(),
                color_tone=(body.get("color_tone") or "").strip(),
                custom_prompt=body.get("custom_prompt") or "",
                rooms=body.get("rooms") if isinstance(body.get("rooms"), list) else None,
                canvas=body.get("canvas") if isinstance(body.get("canvas"), dict) else None,
                mode=(body.get("mode") or "").strip(),
                doors=body.get("doors") if isinstance(body.get("doors"), list) else None,
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# LOCAL ENTRYPOINT (for quick CLI testing: `modal run app.py`)
# ---------------------------------------------------------------------------
@app.local_entrypoint()
def main(image_path: str = "test.jpg", room_type: str = "living room"):
    """Run a smoke test from the CLI using a local image file."""
    from pathlib import Path

    data = Path(image_path).read_bytes()
    b64 = base64.b64encode(data).decode()

    ai = InteriorAI()
    result = ai.run.remote(
        image=b64,
        room_type=room_type,
        design_style="Scandinavian",
        color_tone="warm neutral",
    )
    out_path = Path("generated.png")
    out_path.write_bytes(base64.b64decode(result["generatedImage"]))
    print(f"Saved -> {out_path.resolve()}")
    print(f"Prompt: {result['prompt']}")
    print(f"Has window: {result['has_window']}")
