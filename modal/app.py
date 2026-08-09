"""
Livinai AI — Modal deployment.

Workspace: sara123meckawy
App:       livinai-interior

Two inference paths live in this app, and the HTTP layer routes between them:

* **Gen-Klein (`GenKlein`)** — `black-forest-labs/FLUX.2-klein-4B` image editing.
  This is the same engine and the same prompt architecture the Livinai web
  studio runs, and it is now the default for every interior and exterior photo
  redesign. It preserves the source architecture far better than the old
  SD 1.5 path and needs no depth/segmentation preprocessing.

* **Guided floor plans (`InteriorAI`)** — SD 1.5 (Dreamshaper) with depth + seg
  ControlNets, plus the per-room masked inpainting refine pass. FLUX.2 [klein]
  has no ControlNet, so the guided plan mode — where a rasterised mask of the
  user's drawn polygons is the whole point — stays on this path. It now builds
  its prompts from the shared `prompt_engine` too.

Deploy:
    modal secret create livinai-api-key API_KEY=<your api key>
    modal deploy app.py

Endpoints produced:
    POST https://<workspace>--livinai-interior-generate.modal.run          (preferred)
    POST https://<workspace>--livinai-interior-interiorai-generate.modal.run  (legacy)

Both accept the same body:
    {
      "image": "<base64 jpg/png>",
      "room_type": "living room",
      "design_style": "Scandinavian",
      "color_tone": "warm neutral",
      "mode": "interior" | "exterior" | "guided",
      "material": "Natural oak",           // optional
      "lighting": "Natural daylight",      // optional
      "preserve_geometry": true,           // optional
      "creativity": 42,                    // optional, 10-80
      "custom_prompt": "",                 // optional
      "rooms": [...], "doors": [...], "canvas": {...}   // guided mode only
    }
"""

import base64
import io
import os

import modal

# fastapi is only present inside the container image; guard the import so this
# file can still be parsed locally (for `modal deploy` / `modal run`).
try:
    from fastapi import Header, HTTPException
except ImportError:  # pragma: no cover
    Header = None
    HTTPException = None

from prompt_engine import (
    NEGATIVE_PROMPT,
    build_prompt,
    build_short_prompt,
    resolve_mode,
)

# ---------------------------------------------------------------------------
# MODAL APP + IMAGES
# ---------------------------------------------------------------------------

app = modal.App("livinai-interior")

CACHE_DIR = "/cache/huggingface"
FLUX_MODEL_ID = "black-forest-labs/FLUX.2-klein-4B"

# The ControlNet stack is pinned to the versions the guided path was validated
# on; FLUX.2 [klein] needs a much newer diffusers, so the two paths deliberately
# do not share an image.
controlnet_image = (
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
    .add_local_python_source("prompt_engine")
)

def _prefetch_flux():
    """Pull the FLUX.2 [klein] snapshot into the cache volume at build time.

    Doing this during the image build rather than on first request matters: the
    checkpoint is roughly 16 GB, and a cold container downloading it inline can
    outrun the caller's HTTP timeout. After this runs once the weights live on
    the volume and every later container starts from cache.
    """
    from huggingface_hub import snapshot_download

    snapshot_download(FLUX_MODEL_ID, cache_dir=CACHE_DIR, max_workers=8)


flux_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libgl1", "libglib2.0-0")
    .pip_install(
        # Flux2KleinPipeline, Flux2Transformer2DModel and AutoencoderKLFlux2
        # landed in diffusers 0.37; the text encoder is Qwen3ForCausalLM, which
        # needs a recent transformers. Ranges rather than exact pins so the
        # resolver can find a mutually compatible torch build.
        "torch>=2.6,<3",
        "diffusers>=0.37,<1",
        "transformers>=4.57,<5",
        "accelerate>=1.4",
        "safetensors>=0.4.5",
        "sentencepiece",
        "protobuf",
        "Pillow>=10.4,<12",
        "huggingface_hub[hf_transfer]>=0.30",
        "fastapi[standard]==0.115.0",
    )
    .env({
        "HF_HOME": CACHE_DIR,
        "TRANSFORMERS_CACHE": CACHE_DIR,
        # Saturates the network while pulling the ~16 GB checkpoint.
        "HF_HUB_ENABLE_HF_TRANSFER": "1",
    })
    # `copy=True` rather than the usual runtime mount: the prefetch below is a
    # build step, Modal runs a build step by importing this module, and this
    # module imports prompt_engine at line 59 — so the source has to be in the
    # image before the step, not attached to containers afterwards.
    .add_local_python_source("prompt_engine", copy=True)
)

router_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "fastapi[standard]==0.115.0",
        "opencv-python-headless==4.10.0.84",
        "numpy==1.26.4",
    )
    .add_local_python_source("prompt_engine", "floorplan_detector")
)

# Persistent HF cache volume — weights download once, reused across containers.
hf_cache_vol = modal.Volume.from_name("livinai-hf-cache", create_if_missing=True)

# Bearer-token auth: modal secret create livinai-api-key API_KEY=...
api_key_secret = modal.Secret.from_name("livinai-api-key", required_keys=["API_KEY"])

# The weights are fetched during the image build so the first real request does
# not have to wait for a 16 GB download. FLUX.2 [klein] 4B is Apache-2.0 and not
# gated, so no Hugging Face token is needed — an earlier revision required one
# and that alone made `modal deploy` fail.
#
# Modal refuses a build step placed after a non-copy `add_local_*`, and this one
# has to run after prompt_engine is present (see above). Editing prompt_engine.py
# therefore invalidates this layer — but the weights live on the volume, so the
# re-run finds them cached and finishes in seconds.
flux_image = flux_image.run_function(
    _prefetch_flux,
    volumes={"/cache": hf_cache_vol},
    timeout=60 * 60,
)

WINDOW_KEYWORDS = ["window", "windowpane"]


# ---------------------------------------------------------------------------
# GUIDED-MODE SEGMENTATION
#
# When the frontend (plan.jsx, "guided" mode) sends drawn room polygons we
# rasterize them into a clean ADE20K-style semantic mask and feed THAT into the
# seg ControlNet, instead of the UperNet-extracted segmentation of the uploaded
# floor-plan image.
# ---------------------------------------------------------------------------

# ADE20K palette colors (R, G, B) — wall, floor, ceiling, door, window.
ADE_WALL = (120, 120, 120)
ADE_FLOOR = (80, 50, 50)
ADE_CEILING = (120, 120, 80)
ADE_DOOR = (8, 255, 51)
ADE_WINDOW = (230, 230, 230)

# Stable per-room-type fill colors picked from the ADE palette so SD's seg
# ControlNet associates each colored region with the right space type.
ROOM_ANCHOR_COLORS = {
    "living room": (11, 102, 255),    # sofa class -> living-room cue
    "bedroom": (255, 245, 0),         # bed
    "kids room": (255, 245, 0),
    "kitchen": (50, 50, 250),         # cabinet
    "bathroom": (200, 100, 100),      # bathtub
    "dining room": (255, 51, 7),      # table
    "office": (255, 102, 0),          # desk
    "closet": (102, 51, 0),           # wardrobe
    "laundry room": (235, 12, 255),   # appliance
    "entryway": (8, 255, 51),         # door
    "balcony": (230, 230, 230),       # window
    "sunroom": (230, 230, 230),
    "studio": (11, 102, 255),
    "basement": (11, 102, 255),
    "attic": (11, 102, 255),
    "hallway": ADE_FLOOR,
    "full apartment": ADE_FLOOR,
}

# Compact per-room prompts for the guided-mode per-room inpainting pass. These
# are intentionally short so the CLIP budget has headroom for the style + tone
# tail, and each enumerates the canonical furniture SD should paint inside that
# polygon. This is what guarantees "kitchens look like kitchens, bedrooms look
# like bedrooms" no matter how the base pass turned out.
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


def _rasterize_rooms_mask(rooms, size_wh, doors=None):
    """Build a rich ADE20K mask from drawn polygons + doors.

    Layout:
      - Every polygon interior is painted with ADE_FLOOR (so SD sees "floor").
      - A "furniture anchor" blob of the room-type's ADE color is painted near
        the polygon centroid so the seg ControlNet has a strong per-room class
        cue for the diffusion prior to latch onto.
      - Every polygon outline is stroked with ADE_WALL so there is a clear hard
        boundary between adjacent rooms and the outside world.
      - Each door segment is then stamped through the wall as ADE_FLOOR (the
        opening) with a small ADE_DOOR core at its midpoint so the model renders
        a proper door, in the right spot, between the right rooms.
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

    # Pass 1: fill every polygon with floor.
    for _rtype, poly in parsed:
        cv2.fillPoly(out, [poly], ADE_FLOOR)

    # Pass 2: per-room anchor blob near each centroid, clipped to the polygon so
    # it never bleeds into a neighbour. One strong cue per room beats many
    # scattered ones, and it stays inside the 77-token budget because the
    # ControlNet does the spatial work rather than the prompt.
    for rtype, poly in parsed:
        anchor = ROOM_ANCHOR_COLORS.get(rtype)
        if anchor is None or anchor == ADE_FLOOR:
            continue
        moments = cv2.moments(poly)
        if moments["m00"] == 0:
            continue
        cx = int(moments["m10"] / moments["m00"])
        cy = int(moments["m01"] / moments["m00"])
        _x, _y, bw, bh = cv2.boundingRect(poly)
        r_blob = max(10, int(min(bw, bh) * 0.22))

        poly_mask = np.zeros((h, w), dtype=np.uint8)
        cv2.fillPoly(poly_mask, [poly], 255)
        blob_mask = np.zeros((h, w), dtype=np.uint8)
        cv2.circle(blob_mask, (cx, cy), r_blob, 255, -1)
        out[cv2.bitwise_and(blob_mask, poly_mask) > 0] = anchor

    # Pass 3: walls. Thick stroke so they survive downscaling inside the
    # ControlNet preprocessor and read as hard partitions between rooms.
    wall_thickness = max(7, int(min(w, h) * 0.018))
    for _rtype, poly in parsed:
        cv2.polylines(out, [poly], isClosed=True, color=ADE_WALL, thickness=wall_thickness)

    # Pass 4: doors — stamp the opening as floor with a small door-class core so
    # the model paints an actual door frame rather than a plain gap.
    if doors:
        door_thickness = max(wall_thickness + 2, int(min(w, h) * 0.028))
        door_core_thickness = max(4, int(min(w, h) * 0.010))
        for d in doors:
            try:
                x1 = int(max(0.0, min(1.0, float(d.get("x1", 0)))) * (w - 1))
                y1 = int(max(0.0, min(1.0, float(d.get("y1", 0)))) * (h - 1))
                x2 = int(max(0.0, min(1.0, float(d.get("x2", 0)))) * (w - 1))
                y2 = int(max(0.0, min(1.0, float(d.get("y2", 0)))) * (h - 1))
            except (TypeError, ValueError):
                continue
            cv2.line(out, (x1, y1), (x2, y2), ADE_FLOOR, door_thickness)
            cv2.line(out, (x1, y1), (x2, y2), ADE_DOOR, door_core_thickness)

    return Image.fromarray(out)


def _decode_base64_image_bytes(base64_str):
    if not isinstance(base64_str, str):
        raise ValueError("Image must be a base64 string")
    if base64_str.startswith("data:image"):
        base64_str = base64_str.split(",", 1)[1]
    base64_str += "=" * (-len(base64_str) % 4)
    return base64.b64decode(base64_str)


# ---------------------------------------------------------------------------
# GEN-KLEIN — FLUX.2 [klein] image editing (default path)
# ---------------------------------------------------------------------------

@app.cls(
    image=flux_image,
    gpu="L40S",                 # 48 GB — the 4B transformer + Qwen3 encoder fit in bf16
    volumes={"/cache": hf_cache_vol},
    secrets=[api_key_secret],
    # See InteriorAI: the window is sized against the cost of reloading, not
    # against how long someone might browse. 120s meant a lone design paid for
    # two idle minutes of L40S after it finished.
    scaledown_window=90,
    min_containers=0,
    max_containers=3,
    timeout=900,
)
class GenKlein:
    """FLUX.2 [klein] 4B image-to-image redesign, matching the web studio."""

    @modal.enter()
    def load(self):
        import torch

        try:
            from diffusers import Flux2KleinPipeline
        except ImportError as error:  # pragma: no cover - surfaces a bad image
            raise RuntimeError(
                "Flux2KleinPipeline is missing. It requires diffusers >= 0.37; "
                "check the pins in flux_image."
            ) from error

        self.torch = torch
        self.pipe = Flux2KleinPipeline.from_pretrained(
            FLUX_MODEL_ID,
            torch_dtype=torch.bfloat16,
            cache_dir=CACHE_DIR,
        )
        self.pipe.to("cuda")
        # Cheap insurance on peak VRAM for 1024px output; both are no-ops on
        # pipelines that do not implement them.
        for enable in (
            lambda: self.pipe.enable_attention_slicing(),
            lambda: self.pipe.vae.enable_tiling(),
        ):
            try:
                enable()
            except Exception:
                pass

    @staticmethod
    def _target_size(image):
        """FLUX likes multiples of 16; keep the source aspect, cap the long edge."""
        landscape = image.width >= image.height
        return (1024, 768) if landscape else (768, 1024)

    @modal.method()
    def run(
        self,
        image: str,
        room_type: str = "",
        design_style: str = "",
        color_tone: str = "",
        custom_prompt: str = "",
        mode: str = "interior",
        material: str = "Natural oak",
        lighting: str = "Natural daylight",
        preserve_geometry: bool = True,
        creativity: int = 42,
        color_palette: dict | None = None,
    ):
        from PIL import Image, ImageEnhance, ImageOps

        source = ImageOps.exif_transpose(
            Image.open(io.BytesIO(_decode_base64_image_bytes(image)))
        ).convert("RGB")
        width, height = self._target_size(source)

        resolved_mode = resolve_mode(mode, room_type)
        prompt = build_prompt(
            mode=resolved_mode,
            space_type=room_type or ("Building" if resolved_mode == "exterior" else "Living Room"),
            design_style=design_style or "Modern",
            color_tone=color_tone or "Neutral",
            material=material or "Natural oak",
            lighting=lighting or "Natural daylight",
            preserve_geometry=bool(preserve_geometry),
            creativity=int(creativity or 42),
            custom_prompt=(custom_prompt or "")[:280],
            color_palette=color_palette,
        )

        # A stable base seed with a controlled creativity offset keeps repeat
        # runs comparable while letting the creative-freedom control matter.
        seed = 7 + max(10, min(80, int(creativity or 42))) * 97
        result = self.pipe(
            prompt=prompt,
            image=[source],
            width=width,
            height=height,
            num_inference_steps=4,
            guidance_scale=1.0,
            generator=self.torch.Generator(device="cuda").manual_seed(seed),
        ).images[0].convert("RGB")

        # Conservative finishing pass — improves delivery without changing
        # geometry or inventing detail.
        result = ImageEnhance.Contrast(result).enhance(1.025)
        result = ImageEnhance.Sharpness(result).enhance(1.08)

        buf = io.BytesIO()
        result.save(buf, format="PNG", optimize=True)
        return {
            "message": "Image generated successfully",
            "generatedImage": base64.b64encode(buf.getvalue()).decode(),
            "prompt": prompt,
            "negative_prompt": "",
            "engine": "gen-klein",
            "model": FLUX_MODEL_ID,
            "mode": resolved_mode,
            "has_window": True,
        }


# ---------------------------------------------------------------------------
# GUIDED FLOOR PLANS — SD 1.5 + depth/seg ControlNets
# ---------------------------------------------------------------------------

@app.cls(
    image=controlnet_image,
    # SD 1.5 with two ControlNets, a depth model and a segmenter is about 10 GB
    # in fp16. It was on the same 48 GB L40S as FLUX.2 [klein] — roughly three
    # times the hourly rate for a card that spent most of its memory empty.
    gpu="A10G",
    volumes={"/cache": hf_cache_vol},
    secrets=[api_key_secret],
    # Long enough that a second design started while looking at the first reuses
    # the container, short enough that an idle GPU is never held longer than
    # reloading would have cost. Both classes scale to zero between sessions.
    scaledown_window=90,
    min_containers=0,
    max_containers=3,
    timeout=600,
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

        self.dpt_processor = DPTImageProcessor.from_pretrained("Intel/dpt-large", cache_dir=CACHE_DIR)
        self.dpt_model = DPTForDepthEstimation.from_pretrained(
            "Intel/dpt-large", torch_dtype=self.dtype, cache_dir=CACHE_DIR
        ).to(self.device)

        self.seg_processor = AutoImageProcessor.from_pretrained("openmmlab/upernet-convnext-small", cache_dir=CACHE_DIR)
        self.seg_model = UperNetForSemanticSegmentation.from_pretrained(
            "openmmlab/upernet-convnext-small", torch_dtype=self.dtype, cache_dir=CACHE_DIR
        ).to(self.device)

        depth_cn = ControlNetModel.from_pretrained(
            "lllyasviel/sd-controlnet-depth", torch_dtype=self.dtype, cache_dir=CACHE_DIR
        )
        seg_cn = ControlNetModel.from_pretrained(
            "lllyasviel/control_v11p_sd15_seg", torch_dtype=self.dtype, cache_dir=CACHE_DIR
        )

        self.pipe = StableDiffusionControlNetPipeline.from_pretrained(
            "Lykon/dreamshaper-8",
            controlnet=[depth_cn, seg_cn],
            torch_dtype=self.dtype,
            safety_checker=None,
            cache_dir=CACHE_DIR,
        ).to(self.device)
        self.pipe.scheduler = UniPCMultistepScheduler.from_config(self.pipe.scheduler.config)

        # ── Per-room inpainting pipeline ──
        # Shares the UNet/VAE/TextEncoder weights with the base pipe and reuses
        # the same depth+seg ControlNets. In guided mode we run a second pass
        # where each drawn polygon is inpainted with furniture specific to its
        # assigned room type, while a tight mask prevents the geometry from
        # drifting. That is how we get exact placement + room-specific furniture
        # without a separate inpaint checkpoint.
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

        try:
            self.pipe.enable_xformers_memory_efficient_attention()
            self.inpaint_pipe.enable_xformers_memory_efficient_attention()
        except Exception:
            pass
        self.pipe.enable_vae_tiling()
        self.pipe.enable_attention_slicing()
        self.inpaint_pipe.enable_vae_tiling()
        self.inpaint_pipe.enable_attention_slicing()

        hf_cache_vol.commit()

    # --------------------- helper methods ---------------------

    def _decode_base64_image(self, base64_str):
        import cv2
        import numpy as np

        img = cv2.imdecode(
            np.frombuffer(_decode_base64_image_bytes(base64_str), np.uint8), cv2.IMREAD_COLOR
        )
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

        inputs = self.dpt_processor(images=Image.fromarray(rgb), return_tensors="pt").to(self.device)
        inputs = {k: v.to(dtype=self.dtype) for k, v in inputs.items()}

        with self.torch.no_grad():
            depth = self.dpt_model(**inputs).predicted_depth

        depth_resized = (
            self.torch.nn.functional.interpolate(
                depth.unsqueeze(1), size=(height, width), mode="bicubic", align_corners=False
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

        inputs = self.seg_processor(images=Image.fromarray(rgb), return_tensors="pt").to(self.device)
        inputs = {k: v.to(dtype=self.dtype) for k, v in inputs.items()}

        with self.torch.no_grad():
            outputs = self.seg_model(**inputs)

        return outputs.logits.argmax(dim=1)[0].cpu().numpy().astype(np.uint8)

    def _get_segmentation_image(self, seg_map, size_wh):
        import cv2
        from PIL import Image

        w, h = size_wh
        seg_color = cv2.applyColorMap((seg_map * 10).astype("uint8"), cv2.COLORMAP_JET)
        seg_color = cv2.resize(seg_color, (w, h), interpolation=cv2.INTER_NEAREST)
        return Image.fromarray(cv2.cvtColor(seg_color, cv2.COLOR_BGR2RGB))

    def _detect_window(self, seg_map):
        import numpy as np

        labels = self.seg_model.config.id2label
        for class_id in np.unique(seg_map):
            name = labels.get(int(class_id), "").lower()
            if any(w in name for w in WINDOW_KEYWORDS):
                return True
        return False

    def _refine_rooms_in_place(
        self, base_image, rooms, size_wh, depth_img, seg_img, design_style, color_tone
    ):
        """Per-room masked inpainting pass.

        For every drawn polygon we:
          1. Build a tight binary mask of that polygon, eroded a few pixels
             inward so we never touch the walls — this is what guarantees the
             room stays exactly where it was drawn.
          2. Feather the mask so inpainted furniture blends into the walls and
             doors produced by the base pass.
          3. Run the inpaint ControlNet pipe with a room-specific prompt while
             the same depth+seg ControlNets hold the architecture steady.
          4. Composite back into the running canvas using the blurred mask.

        Doing this per room rather than globally is what fixes both classic
        failure modes: rooms cannot shift (the mask locks them to their polygon)
        and each room gets furniture matching its *assigned* type.
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

        inset_px = max(4, int(min(w, h) * 0.012))
        feather_px = max(6, int(min(w, h) * 0.018))

        for r in rooms:
            rtype = (r.get("type") or "").strip().lower()
            template = ROOM_REFINE_PROMPTS.get(rtype)
            if not template:
                continue  # Unknown room type — the base pass already handled it.

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
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (inset_px * 2 + 1, inset_px * 2 + 1))
            inner_mask = cv2.erode(hard_mask, kernel)
            if inner_mask.max() == 0:
                continue  # Polygon too small to refine.

            feather = cv2.GaussianBlur(inner_mask, (feather_px * 2 + 1, feather_px * 2 + 1), 0)

            try:
                result = self.inpaint_pipe(
                    prompt=template.format(style=style, tone=tone),
                    negative_prompt=NEGATIVE_PROMPT,
                    image=Image.fromarray(canvas),
                    mask_image=Image.fromarray(inner_mask).convert("L"),
                    control_image=[depth_img, seg_img],
                    num_inference_steps=22,
                    guidance_scale=7.0,
                    strength=0.85,
                    controlnet_conditioning_scale=[0.45, 0.9],
                    generator=self.torch.manual_seed(17 + len(pts)),
                ).images[0]
            except Exception as error:
                # A single failed room must never fail the whole generation.
                print(f"[refine] skipped room '{rtype}': {error}")
                continue

            alpha = (feather.astype(np.float32) / 255.0)[..., None]
            blended = canvas.astype(np.float32) * (1 - alpha) + np.array(result.convert("RGB")).astype(np.float32) * alpha
            canvas = np.clip(blended, 0, 255).astype(np.uint8)

        return Image.fromarray(canvas)

    def _build_guided_prompt(self, rooms, design_style, color_tone, custom_prompt, color_palette=None):
        """Layout-aware prompt that names each room and its grid position.

        Stays under CLIP's 77-token limit: at most one short clause per room,
        with a shared photoreal/style tail from the common prompt engine.
        """
        if custom_prompt and isinstance(custom_prompt, str) and custom_prompt.strip():
            # The frontend already builds a rich layout-aware prompt; prefer it.
            return custom_prompt.strip()

        clauses = []
        seen_types = set()
        for r in rooms or []:
            rtype = (r.get("type") or "").strip().lower()
            if not rtype or rtype in seen_types:
                continue
            seen_types.add(rtype)
            pos = (r.get("position") or "").strip().lower()
            clauses.append(f"{rtype} {pos}".strip())
            if len(clauses) >= 6:  # token budget guard
                break

        layout = ", ".join(clauses) if clauses else "multi-room interior"
        tail = build_short_prompt(
            mode="interior",
            space_type="Floor Plan",
            design_style=design_style or "Modern",
            color_tone=color_tone or "neutral",
            color_palette=color_palette,
        )
        return (
            f"3D visualization of a furnished floor plan, {layout}, "
            f"each room in its exact mapped position, solid walls between rooms, doors only where drawn, "
            f"{tail}"
        )

    def _build_prompt(self, room_type, design_style, color_tone, custom_prompt, mode="interior", color_palette=None):
        if custom_prompt and isinstance(custom_prompt, str) and custom_prompt.strip():
            return custom_prompt.strip()
        return build_short_prompt(
            mode=mode,
            space_type=room_type or "interior",
            design_style=design_style or "Modern",
            color_tone=color_tone or "neutral",
            color_palette=color_palette,
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
        color_palette: dict = None,
    ):
        """Pure-python callable version. Can be invoked from other Modal apps."""
        image_bgr = self._decode_base64_image(image)
        size_wh = self._resize_orientation(image_bgr)

        depth_img = self._get_depth_image(image_bgr, size_wh)
        seg_map = self._get_segmentation_map(image_bgr)
        seg_img = self._get_segmentation_image(seg_map, size_wh)
        has_window = self._detect_window(seg_map)

        is_guided = (mode or "").strip().lower() == "guided" and bool(rooms)

        # Guided-mode override: replace the auto-extracted UperNet seg map with a
        # rasterized version of the user's drawn layout (rooms + doors). This is
        # the signal SD needs to respect the plan exactly.
        if is_guided:
            try:
                seg_img = _rasterize_rooms_mask(rooms, size_wh, doors=doors)
            except Exception:
                pass

        if is_guided:
            prompt = self._build_guided_prompt(
                rooms, design_style, color_tone, custom_prompt, color_palette
            )
        else:
            prompt = self._build_prompt(
                room_type,
                design_style,
                color_tone,
                custom_prompt,
                resolve_mode(mode, room_type),
                color_palette,
            )
        if has_window and "window" not in prompt.lower():
            prompt = prompt + ", window in place"

        negative = NEGATIVE_PROMPT
        if not has_window:
            negative += ", no window"

        # Guided: lean heavily on the seg ControlNet so the model cannot
        # rearrange rooms or drop walls between them. Otherwise keep the balance
        # that works well for single-room photos.
        cn_scale, steps = ([0.55, 0.95], 34) if is_guided else ([0.5, 0.1], 30)

        out = self.pipe(
            prompt=prompt,
            image=[depth_img, seg_img],
            num_inference_steps=steps,
            guidance_scale=7.5,
            controlnet_conditioning_scale=cn_scale,
            negative_prompt=negative,
            generator=self.torch.manual_seed(42),
        ).images[0]

        # Guided mode: per-room inpainting so each drawn polygon gets furniture
        # specific to its assigned type without shifting position.
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
            except Exception as error:
                print(f"[guided-refine] pass failed, keeping base image: {error}")

        buf = io.BytesIO()
        out.save(buf, format="PNG")
        return {
            "message": "Image generated successfully",
            "generatedImage": base64.b64encode(buf.getvalue()).decode(),
            "prompt": prompt,
            "negative_prompt": negative,
            "engine": "controlnet-guided" if is_guided else "controlnet",
            "model": "Lykon/dreamshaper-8",
            "has_window": has_window,
        }

    # The legacy `-interiorai-generate` endpoint used to live here, as a method
    # on this class. That made every request wake a GPU container to run the
    # router, which then started a *second* GPU container for the engine it
    # picked — two cold starts and two GPU bills per design. It is now the
    # module-level `interiorai_generate` below, which Modal publishes at the
    # same URL from a CPU container.


# ---------------------------------------------------------------------------
# ROUTER — one cheap endpoint that picks the right engine
# ---------------------------------------------------------------------------

def _require_token(authorization: str):
    expected = os.environ.get("API_KEY")
    if expected:
        token = (authorization or "").removeprefix("Bearer ").strip()
        if token != expected:
            raise HTTPException(status_code=401, detail="Unauthorized")


def _dispatch(body: dict):
    """Spawn the one engine that can serve this request, and return its handle.

    Guided floor plans need ControlNet conditioning, so they go to SD 1.5;
    everything else goes to Gen-Klein.

    There is deliberately no fallback between the two. Each is a GPU container,
    so retrying the other after the first failed made a single request pay two
    cold starts and two GPU bills — and answer with an engine the prompt was
    not written for, which is a different picture, not a degraded one. Failure
    is reported instead; the backend falls back to RunPod.

    `.spawn` rather than `.remote` because Modal answers any web request still
    running after 150 seconds with a 303 to a result URL. A cold FLUX.2 [klein]
    container plus inference routinely passes that, so the redirect was the
    normal case — the backend saw a request that never returned an image, gave
    up on it, and asked RunPod for the same design while this GPU was still
    working on it. Every slow generation was therefore billed twice, on two
    providers, and the user waited for the second one. Handing back a call id
    and letting the backend poll means the work is never abandoned.
    """
    image_b64 = body.get("image")
    if not image_b64:
        raise HTTPException(status_code=400, detail="Missing image")

    mode = (body.get("mode") or "").strip()
    rooms = body.get("rooms") if isinstance(body.get("rooms"), list) else None
    doors = body.get("doors") if isinstance(body.get("doors"), list) else None
    canvas = body.get("canvas") if isinstance(body.get("canvas"), dict) else None
    room_type = (body.get("room_type") or "").strip()
    design_style = (body.get("design_style") or "").strip()
    color_tone = (body.get("color_tone") or "").strip()
    # The app resolves the tone into its 60/30/10 scheme and shows all three
    # colours before generating. Absent — older clients — the prompt engine falls
    # back to the generic ratio clause.
    color_palette = body.get("color_palette") if isinstance(body.get("color_palette"), dict) else None
    custom_prompt = body.get("custom_prompt") or ""

    # Interior and exterior take one engine and only one: Gen-Klein, on the L40S.
    #
    # The guided branch below is for a traced floor plan, which needs ControlNet
    # conditioning that Gen-Klein cannot do. It used to be reachable by any
    # request that happened to carry `rooms` alongside `mode: "guided"`, so an
    # interior or exterior design was one stray field away from being served by
    # the SD 1.5 engine on a different GPU — a different picture, from a prompt
    # that was not written for it. The two photo paths are now named explicitly
    # and can never land there.
    photo_mode = mode.lower() in ("interior", "exterior")
    is_guided = (not photo_mode) and mode.lower() == "guided" and bool(rooms)

    try:
        if is_guided:
            return InteriorAI().run.spawn(
                image=image_b64,
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

        return GenKlein().run.spawn(
            image=image_b64,
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
        engine = "InteriorAI" if is_guided else "Gen-Klein"
        print(f"[router] {engine} failed: {error}")
        raise HTTPException(status_code=500, detail=str(error))


# The endpoints are short-lived on purpose: they submit or check, they never sit
# holding a connection open while a GPU works. `timeout=900` used to be the
# window the whole generation had to finish inside, which is exactly the design
# that made Modal's 150-second redirect a problem.


@app.function(image=router_image, secrets=[api_key_secret], timeout=60)
@modal.fastapi_endpoint(method="POST", docs=True)
def generate(payload: dict, authorization: str = Header(default="") if Header else ""):
    """Start a generation. Returns the call id to poll `result` with."""
    _require_token(authorization)
    return {"callId": _dispatch(payload or {}).object_id}


# Modal builds an endpoint's URL from the app and function name, so this
# module-level function is published at exactly the address the class method
# used to own:
#
#     https://<workspace>--livinai-interior-interiorai-generate.modal.run
#
# Backends still configured with that URL therefore keep working — and now get
# the same cheap CPU routing as `generate`, one GPU container per request. The
# name is the only reason this is not simply an alias of `generate`.
@app.function(image=router_image, secrets=[api_key_secret], timeout=60)
@modal.fastapi_endpoint(method="POST", docs=True)
def interiorai_generate(payload: dict, authorization: str = Header(default="") if Header else ""):
    """Legacy entry point kept so already-deployed backends keep working."""
    _require_token(authorization)
    return {"callId": _dispatch(payload or {}).object_id}


@app.function(image=router_image, secrets=[api_key_secret], timeout=60)
@modal.fastapi_endpoint(method="GET")
def result(callId: str = "", authorization: str = Header(default="") if Header else ""):
    """Report on a spawned generation: pending, or the finished image."""
    _require_token(authorization)
    if not callId:
        raise HTTPException(status_code=400, detail="Missing callId.")

    call = modal.FunctionCall.from_id(callId)
    try:
        # timeout=0 asks "is it done yet" without waiting.
        return {"status": "completed", **call.get(timeout=0)}
    except TimeoutError:
        return {"status": "pending"}
    except Exception as error:
        # An engine raising rather than returning is a bug in the engine, but it
        # still has to reach the backend as a sentence rather than as a hang.
        print(f"[router] engine call {callId} failed: {error}")
        return {"status": "completed", "error": str(error)}


def _estimate_plan_scale(rooms, doors, fallback=40.0):
    """Match the measured-scale heuristic used by the web walkthrough."""
    import math
    import statistics

    areas = []
    for room in rooms or []:
        if len(room) < 3:
            continue
        twice = sum(
            room[index][0] * room[(index + 1) % len(room)][1]
            - room[(index + 1) % len(room)][0] * room[index][1]
            for index in range(len(room))
        )
        if abs(twice) > 1:
            areas.append(abs(twice) / 2)

    area_scale = math.sqrt(statistics.median(areas) / 14.0) if areas else None
    door_lengths = [
        math.hypot(door[1][0] - door[0][0], door[1][1] - door[0][1])
        for door in (doors or [])
        if len(door) >= 2
    ]
    door_scale = statistics.median(door_lengths) / 0.9 if door_lengths else None
    if area_scale and door_scale:
        ratio = door_scale / area_scale
        return door_scale if 0.8 <= ratio <= 1.25 else area_scale
    return door_scale or area_scale or fallback


@app.function(image=router_image, secrets=[api_key_secret], timeout=90)
@modal.fastapi_endpoint(method="POST", docs=True)
def detect_floorplan(payload: dict, authorization: str = Header(default="") if Header else ""):
    """Convert a raster plan into the web-compatible editable layout contract."""
    _require_token(authorization)
    import cv2
    import numpy as np
    from floorplan_detector import detect_rooms_and_doors

    encoded = str((payload or {}).get("image") or "")
    if encoded.startswith("data:image"):
        encoded = encoded.split(",", 1)[-1]
    if not encoded or len(encoded) > 22_000_000:
        raise HTTPException(status_code=413, detail="The floor plan must be between 1 byte and 15 MB.")
    try:
        raw = base64.b64decode(encoded, validate=True)
        decoded = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    except Exception as error:
        raise HTTPException(status_code=400, detail="The floor plan image could not be read.") from error
    if decoded is None:
        raise HTTPException(status_code=400, detail="The floor plan image could not be read.")

    rooms, doors = detect_rooms_and_doors(decoded)
    if not rooms:
        raise HTTPException(
            status_code=422,
            detail="No enclosed rooms were detected. Use a high-contrast plan or trace the rooms manually.",
        )
    height, width = decoded.shape[:2]
    return {
        "success": True,
        "width": width,
        "height": height,
        "pixelsPerMeter": _estimate_plan_scale(rooms, doors),
        "rooms": rooms,
        "doors": doors,
        "windows": [],
        "balconies": [],
    }


@app.function(image=router_image)
@modal.fastapi_endpoint(method="GET")
def health():
    return {
        "status": "ok",
        "engines": {"default": FLUX_MODEL_ID, "guided": "Lykon/dreamshaper-8 + depth/seg ControlNet"},
        "promptEngine": "gen-klein-v1",
    }


# ---------------------------------------------------------------------------
# LOCAL ENTRYPOINT (for quick CLI testing: `modal run app.py`)
# ---------------------------------------------------------------------------
@app.local_entrypoint()
def main(image_path: str = "test.jpg", room_type: str = "living room", mode: str = "interior"):
    """Run a smoke test from the CLI using a local image file."""
    from pathlib import Path

    b64 = base64.b64encode(Path(image_path).read_bytes()).decode()
    result = GenKlein().run.remote(
        image=b64,
        room_type=room_type,
        design_style="Scandinavian",
        color_tone="warm neutral",
        mode=mode,
    )
    out_path = Path("generated.png")
    out_path.write_bytes(base64.b64decode(result["generatedImage"]))
    print(f"Saved -> {out_path.resolve()}")
    print(f"Engine: {result['engine']}")
    print(f"Prompt: {result['prompt'][:200]}…")
