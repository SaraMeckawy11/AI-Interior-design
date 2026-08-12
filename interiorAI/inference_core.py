"""The Modal engines, ported to run inside the RunPod worker.

`POST /api/designs` calls Modal first and RunPod second. Those used to be two
different engines — SD 1.5 + ControlNet here, FLUX.2 [klein] on Modal — so which
host answered decided what the user got back, and a fallback silently changed the
picture rather than just the bill. This module is a port of the two engine classes
in `modal/app.py`, so the choice of host is no longer a choice of model, and the
order the backend tries them in is free to be an operational decision.

Two engines live here, and RunPod routes between them by the rule Modal's router
uses:

* `GenKleinEngine` — `black-forest-labs/FLUX.2-klein-4B` image editing, ported
  from `GenKlein`. The default for every interior and exterior photo redesign,
  and the same engine and prompt architecture the Livinai web studio uses.
* `ControlNetEngine` — SD 1.5 (Dreamshaper) with depth + seg ControlNets and the
  per-room masked inpainting refine pass, ported from `InteriorAI`. Guided floor
  plans stay here because FLUX.2 [klein] has no ControlNet, and a rasterised mask
  of the user's drawn polygons is the whole point of that mode.

**`modal/app.py` is the original.** Everything below — prompts, steps, guidance,
ControlNet scales, seeds, the finishing pass, the response keys — is copied from
it deliberately and must stay copied from it: two hosts answering the same route
with different numbers is the bug this replaced. Change Modal first, then port.
`prompt_engine.py` already lives in both directories under the same rule.

The one difference from Modal is packaging. Modal gives each engine its own
container class, its own image and its own GPU; RunPod gives the worker a single
process and a single GPU, so the engines are plain classes here and the handler
loads at most one of them at a time (see `_Engine.unload`).

torch, diffusers, cv2 and PIL are imported inside functions rather than at module
scope so importing this module stays cheap and a missing extra surfaces on the
request that needs it, naming the engine.
"""

from __future__ import annotations

import base64
import gc
import io

from prompt_engine import (
    NEGATIVE_PROMPT,
    build_gen_klein_interior_prompt,
    build_prompt,
    build_short_prompt,
    resolve_mode,
    resolve_render_source,
)

# ---------------------------------------------------------------------------
# MODEL IDS
# ---------------------------------------------------------------------------

FLUX_MODEL_ID = "black-forest-labs/FLUX.2-klein-4B"
FLUX_MODEL_REVISION = "e7b7dc27f91deacad38e78976d1f2b499d76a294"
SD_MODEL_ID = "Lykon/dreamshaper-8"
DEPTH_MODEL_ID = "Intel/dpt-large"
SEG_MODEL_ID = "openmmlab/upernet-convnext-small"
DEPTH_CONTROLNET_ID = "lllyasviel/sd-controlnet-depth"
SEG_CONTROLNET_ID = "lllyasviel/control_v11p_sd15_seg"

#: Every checkpoint the ControlNet engine loads, in the order it loads them.
#: Deployment images pre-download this list so the first request does not.
CONTROLNET_MODEL_IDS = (
    DEPTH_MODEL_ID,
    SEG_MODEL_ID,
    DEPTH_CONTROLNET_ID,
    SEG_CONTROLNET_ID,
    SD_MODEL_ID,
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


def decode_base64_image_bytes(base64_str):
    if not isinstance(base64_str, str):
        raise ValueError("Image must be a base64 string")
    if base64_str.startswith("data:image"):
        base64_str = base64_str.split(",", 1)[1]
    base64_str += "=" * (-len(base64_str) % 4)
    return base64.b64decode(base64_str)


def is_guided_request(mode, rooms) -> bool:
    """The one routing rule, shared so both hosts pick the same engine.

    Guided floor plans need ControlNet conditioning; everything else is a photo
    redesign and goes to Gen-Klein.
    """
    return (mode or "").strip().lower() == "guided" and bool(rooms)


def rasterize_rooms_mask(rooms, size_wh, doors=None):
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


class _Engine:
    """Shared lifecycle so the worker can swap engines on one GPU.

    This is the part Modal does not need: there each engine is its own container
    class with its own GPU, so nothing is ever unloaded. A RunPod worker has one
    process and one GPU, and FLUX.2 [klein] in bf16 plus the SD 1.5 ControlNet
    stack do not fit on it together — so the handler evicts one before loading
    the other, which is what `unload()` is for.
    """

    def __init__(self, cache_dir: str):
        self.cache_dir = cache_dir
        self.torch = None
        self.device = "cpu"

    def _init_torch(self):
        import torch

        self.torch = torch
        self.device = "cuda" if torch.cuda.is_available() else "cpu"

    def load(self):  # pragma: no cover - overridden
        raise NotImplementedError

    def unload(self):
        for name in list(vars(self)):
            if name.endswith("pipe") or name.endswith("model") or name.endswith("processor"):
                setattr(self, name, None)
        gc.collect()
        if self.torch is not None and self.device == "cuda":
            self.torch.cuda.empty_cache()


# ---------------------------------------------------------------------------
# GEN-KLEIN — FLUX.2 [klein] image editing (default path)
# ---------------------------------------------------------------------------


class ExteriorGenKleinEngine(_Engine):
    """Exact RunPod exterior renderer from ad7a9ba."""

    name = "gen-klein-exterior-ad7a9ba"
    model_id = FLUX_MODEL_ID

    def load(self):
        self._init_torch()
        try:
            from diffusers import Flux2KleinPipeline
        except ImportError as error:  # pragma: no cover
            raise RuntimeError(
                "Flux2KleinPipeline is missing. It requires diffusers >= 0.37; "
                "check the pins in the deployment image."
            ) from error

        self.pipe = Flux2KleinPipeline.from_pretrained(
            FLUX_MODEL_ID,
            torch_dtype=self.torch.bfloat16,
            cache_dir=self.cache_dir,
        )
        self.pipe.to(self.device)
        for enable in (
            lambda: self.pipe.enable_attention_slicing(),
            lambda: self.pipe.vae.enable_tiling(),
        ):
            try:
                enable()
            except Exception:
                pass
        return self

    @staticmethod
    def _target_size(image):
        landscape = image.width >= image.height
        return (1024, 768) if landscape else (768, 1024)

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
        color_palette: dict = None,
    ):
        from PIL import Image, ImageEnhance, ImageOps

        source = ImageOps.exif_transpose(
            Image.open(io.BytesIO(decode_base64_image_bytes(image)))
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

        seed = 7 + max(10, min(80, int(creativity or 42))) * 97
        result = self.pipe(
            prompt=prompt,
            image=[source],
            width=width,
            height=height,
            num_inference_steps=4,
            guidance_scale=1.0,
            generator=self.torch.Generator(device=self.device).manual_seed(seed),
        ).images[0].convert("RGB")

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


class GenKleinEngine(_Engine):
    """FLUX.2 [klein] 4B image-to-image redesign, matching the web studio."""

    name = "gen-klein"
    model_id = FLUX_MODEL_ID

    def load(self):
        self._init_torch()
        import os
        from huggingface_hub import snapshot_download
        from transformers import AutoModelForCausalLM, AutoTokenizer
        from transformers import BitsAndBytesConfig as TransformersBnb4bit

        try:
            from diffusers import Flux2KleinPipeline, Flux2Transformer2DModel
            from diffusers import BitsAndBytesConfig as DiffusersBnb4bit
        except ImportError as error:  # pragma: no cover - surfaces a bad image
            raise RuntimeError(
                "Flux2KleinPipeline is missing. It requires diffusers >= 0.37; "
                "check the pins in the deployment image."
            ) from error
        local_dir = snapshot_download(
            FLUX_MODEL_ID,
            revision=FLUX_MODEL_REVISION,
            cache_dir=self.cache_dir,
            allow_patterns=[
                "model_index.json", "scheduler/*", "tokenizer/*",
                "text_encoder/*", "transformer/*", "vae/*",
            ],
        )
        self.tokenizer = AutoTokenizer.from_pretrained(os.path.join(local_dir, "tokenizer"))
        self.text_encoder = AutoModelForCausalLM.from_pretrained(
            os.path.join(local_dir, "text_encoder"),
            torch_dtype=self.torch.bfloat16,
            quantization_config=TransformersBnb4bit(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=self.torch.bfloat16,
            ),
            device_map={"": 0},
        )
        transformer = Flux2Transformer2DModel.from_pretrained(
            local_dir,
            subfolder="transformer",
            torch_dtype=self.torch.bfloat16,
            quantization_config=DiffusersBnb4bit(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=self.torch.bfloat16,
            ),
        )
        self.pipe = Flux2KleinPipeline.from_pretrained(
            local_dir,
            transformer=transformer,
            text_encoder=None,
            tokenizer=None,
            torch_dtype=self.torch.bfloat16,
        )
        self.pipe.to(self.device)
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
        return self

    @staticmethod
    def _target_size(image):
        """FLUX likes multiples of 16; keep the source aspect, cap the long edge."""
        landscape = image.width >= image.height
        return (1024, 768) if landscape else (768, 1024)

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
        color_palette: dict = None,
        render_source: str = "",
    ):
        from PIL import Image, ImageChops, ImageFilter, ImageOps

        source = ImageOps.exif_transpose(
            Image.open(io.BytesIO(decode_base64_image_bytes(image)))
        ).convert("RGB")
        width, height = self._target_size(source)

        resolved_mode = resolve_mode(mode, room_type)
        if resolved_mode == "interior" and room_type.strip().lower() != "prompt only":
            prompt = build_gen_klein_interior_prompt(
                space_type=room_type or "Living Room",
                design_style=design_style or "Modern",
                color_tone=color_tone or "Neutral",
                color_palette=color_palette,
                # Photograph or captured 3D frame; absent means photograph.
                source=render_source,
            )
        elif room_type.strip().lower() == "prompt only" and custom_prompt.strip():
            prompt = custom_prompt.strip()
        else:
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
        chat_prompt = self.tokenizer.apply_chat_template(
            [{"role": "user", "content": prompt}],
            tokenize=False,
            add_generation_prompt=True,
            enable_thinking=False,
        )
        prompt_tokens = len(self.tokenizer(chat_prompt)["input_ids"])
        if prompt_tokens > 512:
            raise ValueError(
                f"Interior brief is {prompt_tokens} tokens; maximum is 512."
            )
        with self.torch.no_grad():
            prompt_embeds = self.pipe._get_qwen3_prompt_embeds(
                text_encoder=self.text_encoder,
                tokenizer=self.tokenizer,
                prompt=prompt,
                dtype=self.torch.bfloat16,
                device=self.device,
            ).cpu()
        def structure_score(candidate):
            source_edges = source.resize((width, height)).convert("L").filter(
                ImageFilter.GaussianBlur(1.2)
            ).filter(ImageFilter.FIND_EDGES).point(
                lambda value: 255 if value >= 24 else 0
            )
            candidate_edges = candidate.convert("L").filter(
                ImageFilter.GaussianBlur(0.8)
            ).filter(ImageFilter.FIND_EDGES).point(
                lambda value: 255 if value >= 24 else 0
            ).filter(ImageFilter.MaxFilter(7))
            source_edges = source_edges.crop((8, 8, width - 8, height - 8))
            candidate_edges = candidate_edges.crop((8, 8, width - 8, height - 8))
            source_count = source_edges.histogram()[255]
            if not source_count:
                return 0.0
            kept = ImageChops.multiply(source_edges, candidate_edges).histogram()[255]
            return kept / source_count

        # Match Gen_klein.py's preferred seed. Edge recall stays diagnostic and
        # cannot replace the design with a semantically worse composition.
        embeds_device = prompt_embeds.to(self.device)
        selected_seed = 7
        result = self.pipe(
            prompt=None,
            prompt_embeds=embeds_device,
            image=[source],
            width=width,
            height=height,
            num_inference_steps=4,
            guidance_scale=1.0,
            generator=self.torch.Generator(device=self.device).manual_seed(selected_seed),
        ).images[0].convert("RGB")

        # Living rooms used to get a second 4-step cleanup pass here. It also
        # re-rendered the furniture it was told to leave alone and softened the
        # coffee table; the restraint it bought is now in the brief itself.
        score = structure_score(result)

        buf = io.BytesIO()
        result.save(buf, format="PNG", optimize=True)
        return {
            "message": "Image generated successfully",
            "generatedImage": base64.b64encode(buf.getvalue()).decode(),
            "prompt": prompt,
            "prompt_tokens": prompt_tokens,
            "structure_score": round(score, 4),
            "seed": selected_seed,
            "candidates": 1,
            "render_source": resolve_render_source(render_source),
            "cleanup_applied": False,
            "negative_prompt": "",
            "engine": "gen-klein",
            "model": FLUX_MODEL_ID,
            "mode": resolved_mode,
            "has_window": True,
        }


# ---------------------------------------------------------------------------
# GUIDED FLOOR PLANS — SD 1.5 + depth/seg ControlNets
# ---------------------------------------------------------------------------


class ControlNetEngine(_Engine):
    """SD 1.5 + depth/seg ControlNets, with the guided per-room refine pass."""

    name = "controlnet"
    model_id = SD_MODEL_ID

    def load(self):
        """Cold-start: load all models into GPU memory. Runs once per container."""
        self._init_torch()

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

        self.dtype = self.torch.float16 if self.device == "cuda" else self.torch.float32

        self.dpt_processor = DPTImageProcessor.from_pretrained(
            DEPTH_MODEL_ID, cache_dir=self.cache_dir
        )
        self.dpt_model = DPTForDepthEstimation.from_pretrained(
            DEPTH_MODEL_ID, torch_dtype=self.dtype, cache_dir=self.cache_dir
        ).to(self.device)

        self.seg_processor = AutoImageProcessor.from_pretrained(
            SEG_MODEL_ID, cache_dir=self.cache_dir
        )
        self.seg_model = UperNetForSemanticSegmentation.from_pretrained(
            SEG_MODEL_ID, torch_dtype=self.dtype, cache_dir=self.cache_dir
        ).to(self.device)

        depth_cn = ControlNetModel.from_pretrained(
            DEPTH_CONTROLNET_ID, torch_dtype=self.dtype, cache_dir=self.cache_dir
        )
        seg_cn = ControlNetModel.from_pretrained(
            SEG_CONTROLNET_ID, torch_dtype=self.dtype, cache_dir=self.cache_dir
        )

        self.pipe = StableDiffusionControlNetPipeline.from_pretrained(
            SD_MODEL_ID,
            controlnet=[depth_cn, seg_cn],
            torch_dtype=self.dtype,
            safety_checker=None,
            cache_dir=self.cache_dir,
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
        return self

    # --------------------- helper methods ---------------------

    def _decode_base64_image(self, base64_str):
        import cv2
        import numpy as np

        img = cv2.imdecode(
            np.frombuffer(decode_base64_image_bytes(base64_str), np.uint8), cv2.IMREAD_COLOR
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
        from PIL import Image

        width, height = self._resize_orientation(image_bgr)
        resized = cv2.resize(image_bgr, (width, height), interpolation=cv2.INTER_CUBIC)
        rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)

        inputs = self.seg_processor(images=Image.fromarray(rgb), return_tensors="pt").to(self.device)
        inputs = {k: v.to(dtype=self.dtype) for k, v in inputs.items()}

        with self.torch.no_grad():
            outputs = self.seg_model(**inputs)

        return outputs.logits.argmax(dim=1)[0].cpu().numpy().astype("uint8")

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
        image_bgr = self._decode_base64_image(image)
        size_wh = self._resize_orientation(image_bgr)

        depth_img = self._get_depth_image(image_bgr, size_wh)
        seg_map = self._get_segmentation_map(image_bgr)
        seg_img = self._get_segmentation_image(seg_map, size_wh)
        has_window = self._detect_window(seg_map)

        is_guided = is_guided_request(mode, rooms)

        # Guided-mode override: replace the auto-extracted UperNet seg map with a
        # rasterized version of the user's drawn layout (rooms + doors). This is
        # the signal SD needs to respect the plan exactly.
        if is_guided:
            try:
                seg_img = rasterize_rooms_mask(rooms, size_wh, doors=doors)
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
            "model": SD_MODEL_ID,
            "has_window": has_window,
        }
