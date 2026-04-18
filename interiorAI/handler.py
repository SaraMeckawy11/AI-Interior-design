import runpod
import base64
import io
import torch
import cv2
import numpy as np
from PIL import Image
from diffusers import StableDiffusionControlNetPipeline, ControlNetModel, UniPCMultistepScheduler
from transformers import DPTImageProcessor, DPTForDepthEstimation, AutoImageProcessor, UperNetForSemanticSegmentation

# --- Device setup ---
use_cuda = torch.cuda.is_available()
dtype = torch.float16 if use_cuda else torch.float32
device = "cuda" if use_cuda else "cpu"

CACHE_DIR = "/home/user/.cache/huggingface"

# --- Load models once (cold start) ---
dpt_processor = DPTImageProcessor.from_pretrained(
    "Intel/dpt-large",
    cache_dir=CACHE_DIR,
)
dpt_model = DPTForDepthEstimation.from_pretrained(
    "Intel/dpt-large",
    torch_dtype=dtype,
    cache_dir=CACHE_DIR,
).to(device)

seg_processor = AutoImageProcessor.from_pretrained(
    "openmmlab/upernet-convnext-small",
    cache_dir=CACHE_DIR,
)
seg_model = UperNetForSemanticSegmentation.from_pretrained(
    "openmmlab/upernet-convnext-small",
    torch_dtype=dtype,
    cache_dir=CACHE_DIR,
).to(device)

depth_controlnet = ControlNetModel.from_pretrained(
    "lllyasviel/sd-controlnet-depth",
    torch_dtype=dtype,
    cache_dir=CACHE_DIR,
)
seg_controlnet = ControlNetModel.from_pretrained(
    "lllyasviel/control_v11p_sd15_seg",
    torch_dtype=dtype,
    cache_dir=CACHE_DIR,
)

pipe = StableDiffusionControlNetPipeline.from_pretrained(
    "Lykon/dreamshaper-8",
    controlnet=[depth_controlnet, seg_controlnet],
    torch_dtype=dtype,
    safety_checker=None,
    cache_dir=CACHE_DIR,
).to(device)

pipe.scheduler = UniPCMultistepScheduler.from_config(pipe.scheduler.config)

# ---------------------------------------------------------------------------
# PROMPT TEMPLATES
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

# universal hybrid fallback (option C)
FALLBACK_PROMPT = (
    "{design_style} {room_type} space, realistic lighting, {color_tone} palette, "
    "professional design style, photorealistic 8k, high detail textures, natural shadows, "
    "includes layout-appropriate furniture or structural elements, cohesive arrangement matching the space type"
)

# Normalize list of exterior keys for lookups
EXTERIOR_KEYS = {k.lower(): k for k in EXTERIOR_PROMPTS.keys()}

# ---------------------------------------------------------------------------
# ADE20K SEMANTIC ANCHORS (guided-mode polygon rasterization)
#
# Turns the room polygons drawn in plan.jsx into an ADE20K-style semantic
# mask so ControlNet-Seg places each room EXACTLY where the user drew it.
# ---------------------------------------------------------------------------
ADE_WALL = (120, 120, 120)
ADE_FLOOR = (80, 50, 50)
ADE_CEILING = (120, 120, 80)
ADE_WINDOW = (230, 230, 230)
ADE_DOOR = (8, 255, 51)

# Furniture-anchor colors -- RGB triples from the standard ADE20K palette.
# These are ONE SMALL BLOB per room, NOT a whole-room fill (that was making
# SD tile giant furniture across entire rooms).
ROOM_ANCHOR_COLORS = {
    "living room":    (11, 102, 255),   # sofa        (ADE class 23)
    "bedroom":        (204, 5, 255),    # bed         (ADE class 7)
    "kitchen":        (224, 5, 255),    # cabinet     (ADE class 10)
    "bathroom":       (0, 102, 200),    # bathtub     (ADE class 37)
    "dining room":    (255, 6, 82),     # table       (ADE class 15)
    "office":         (8, 255, 214),    # desk        (ADE class 33)
    "hallway":        None,             # no furniture anchor
    "closet":         (0, 163, 255),    # wardrobe    (ADE class 35)
    "laundry room":   (255, 224, 0),
    "entryway":       (8, 255, 51),     # door        (ADE class 14)
    "balcony":        (11, 102, 255),
    "basement":       (11, 102, 255),
    "kids room":      (204, 5, 255),
    "studio":         (11, 102, 255),
    "full apartment": None,
    "attic":          (11, 102, 255),
    "sunroom":        (11, 102, 255),
}


def rasterize_rooms_mask(rooms, size_wh):
    """
    Clean ADE20K semantic mask with auto geometry repair. See modal/app.py
    for the full rationale. Summary:
      - label map via painter's algorithm (later polygons win on overlap)
      - iterative 1px dilation closes small accidental gaps
      - walls painted only where LABELS change -> exactly one wall between
        any two rooms, regardless of how the user drew them
      - small centered furniture anchor blob per room
      - balcony/sunroom: window strip on its longest edge
    """
    w, h = size_wh

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
            parsed.append({"type": rtype, "pts": np.array(pts, dtype=np.int32)})

    if not parsed:
        return Image.new("RGB", (w, h), (0, 0, 0))

    label_map = np.zeros((h, w), dtype=np.int32)
    for idx, poly in enumerate(parsed, start=1):
        cv2.fillPoly(label_map, [poly["pts"]], idx)

    max_gap_px = max(4, int(min(w, h) * 0.025))
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    for _ in range(max_gap_px):
        background = label_map == 0
        if not background.any():
            break
        next_map = label_map.copy()
        changed = False
        for idx in range(1, len(parsed) + 1):
            mask = (label_map == idx).astype(np.uint8)
            dilated = cv2.dilate(mask, kernel, iterations=1)
            write = background & (dilated > 0) & (next_map == 0)
            if write.any():
                next_map[write] = idx
                changed = True
        label_map = next_map
        if not changed:
            break

    out = np.zeros((h, w, 3), dtype=np.uint8)
    out[label_map > 0] = ADE_FLOOR

    for idx, poly in enumerate(parsed, start=1):
        color = ROOM_ANCHOR_COLORS.get(poly["type"])
        if color is None:
            continue
        xs, ys = poly["pts"][:, 0], poly["pts"][:, 1]
        cx = int(xs.mean())
        cy = int(ys.mean())
        extent = min(int(xs.max() - xs.min()), int(ys.max() - ys.min()))
        r_blob = max(10, int(extent * 0.18))
        cv2.circle(out, (cx, cy), r_blob, color, -1)
        if poly["type"] in ("balcony", "sunroom"):
            pts = poly["pts"]
            best = (0.0, 0, 1)
            for i in range(len(pts)):
                a = pts[i]
                b = pts[(i + 1) % len(pts)]
                L = float(np.hypot(b[0] - a[0], b[1] - a[1]))
                if L > best[0]:
                    best = (L, i, (i + 1) % len(pts))
            a = tuple(int(v) for v in pts[best[1]])
            b = tuple(int(v) for v in pts[best[2]])
            win_w = max(8, int(min(w, h) * 0.018))
            cv2.line(out, a, b, ADE_WINDOW, thickness=win_w)

    boundaries = np.zeros((h, w), dtype=np.uint8)
    diff_v = (label_map[:-1, :] != label_map[1:, :])
    diff_h = (label_map[:, :-1] != label_map[:, 1:])
    boundaries[:-1, :] |= diff_v.astype(np.uint8)
    boundaries[1:, :] |= diff_v.astype(np.uint8)
    boundaries[:, :-1] |= diff_h.astype(np.uint8)
    boundaries[:, 1:] |= diff_h.astype(np.uint8)

    wall_thickness = max(8, int(min(w, h) * 0.016))
    wall_kernel = cv2.getStructuringElement(
        cv2.MORPH_RECT, (wall_thickness, wall_thickness)
    )
    boundaries = cv2.dilate(boundaries, wall_kernel, iterations=1)
    out[boundaries > 0] = ADE_WALL

    return Image.fromarray(out)


def synthesize_depth_from_mask(seg_img):
    """
    Clean ControlNet-Depth image built from the semantic mask. Skips DPT on
    the noisy floor plan in guided mode (Arabic labels / dimensions /
    electrical symbols were being read as 3D geometry -> hallucinations).
    Convention: bright = close. walls 230, floor/anchors 110, windows 60,
    background 0.
    """
    arr = np.array(seg_img).astype(np.int32)
    h, w = arr.shape[:2]

    def _match(color):
        c = np.array(color, dtype=np.int32)
        return np.all(arr == c, axis=-1)

    depth = np.zeros((h, w), dtype=np.uint8)
    depth[_match(ADE_FLOOR)] = 110
    for color in ROOM_ANCHOR_COLORS.values():
        if color is not None:
            depth[_match(color)] = 110
    depth[_match(ADE_WINDOW)] = 60
    depth[_match(ADE_WALL)] = 230

    depth = cv2.GaussianBlur(depth, (7, 7), 0)
    depth_rgb = cv2.cvtColor(depth, cv2.COLOR_GRAY2RGB)
    return Image.fromarray(depth_rgb)

# ---------------------------------------------------------------------------
# UTILITIES
# ---------------------------------------------------------------------------

def decode_base64_image(base64_str):
    if not isinstance(base64_str, str):
        raise ValueError("Image must be a base64 string")
    if base64_str.startswith("data:image"):
        base64_str = base64_str.split(",")[1]

    base64_str += "=" * (-len(base64_str) % 4)
    img_bytes = base64.b64decode(base64_str)

    img = cv2.imdecode(np.frombuffer(img_bytes, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Invalid image provided")
    return img  # BGR


def resize_orientation(img):
    h, w = img.shape[:2]
    return (1024, 768) if w > h else (768, 1024)

# ---------------------------------------------------------------------------
# DEPTH (FP16)
# ---------------------------------------------------------------------------
def get_depth_image(image_bgr, size_wh):
    width, height = size_wh

    resized = cv2.resize(image_bgr, (width, height), interpolation=cv2.INTER_CUBIC)
    rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)

    inputs = dpt_processor(images=Image.fromarray(rgb), return_tensors="pt").to(device)
    inputs = {k: v.to(dtype=dtype) for k, v in inputs.items()}

    with torch.no_grad():
        depth = dpt_model(**inputs).predicted_depth

    depth_resized = torch.nn.functional.interpolate(
        depth.unsqueeze(1),
        size=(height, width),
        mode="bicubic",
        align_corners=False
    ).squeeze().cpu().numpy()

    depth_norm = ((depth_resized - depth_resized.min()) /
                  (depth_resized.max() - depth_resized.min()) * 255).astype(np.uint8)

    return Image.fromarray(depth_norm).convert("RGB")


# ---------------------------------------------------------------------------
# SEGMENTATION (FP16)
# ---------------------------------------------------------------------------
def get_segmentation_map(image_bgr):
    width, height = resize_orientation(image_bgr)

    resized = cv2.resize(image_bgr, (width, height), interpolation=cv2.INTER_CUBIC)
    rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)

    inputs = seg_processor(images=Image.fromarray(rgb), return_tensors="pt").to(device)
    inputs = {k: v.to(dtype=dtype) for k, v in inputs.items()}

    with torch.no_grad():
        outputs = seg_model(**inputs)

    seg_map = outputs.logits.argmax(dim=1)[0].cpu().numpy().astype(np.uint8)
    return seg_map


def get_segmentation_image(seg_map, size_wh):
    w, h = size_wh
    seg_color = cv2.applyColorMap((seg_map * 10).astype(np.uint8), cv2.COLORMAP_JET)
    seg_color = cv2.resize(seg_color, (w, h), interpolation=cv2.INTER_NEAREST)
    seg_rgb = cv2.cvtColor(seg_color, cv2.COLOR_BGR2RGB)
    return Image.fromarray(seg_rgb)


# ---------------------------------------------------------------------------
# WINDOW DETECTION
# ---------------------------------------------------------------------------
WINDOW_KEYWORDS = ["window", "windowpane"]

def detect_window(seg_map):
    labels = seg_model.config.id2label
    for class_id in np.unique(seg_map):
        name = labels.get(int(class_id), "").lower()
        if any(w in name for w in WINDOW_KEYWORDS):
            return True
    return False


# ---------------------------------------------------------------------------
# HANDLER
# ---------------------------------------------------------------------------
def handler(event):
    try:
        body = event.get("input", {}) or {}
        base64_image = body.get("image")

        room_type = (body.get("room_type") or "").strip()
        design_style = (body.get("design_style") or "").strip()
        color_tone = (body.get("color_tone") or "").strip()

        # Guided-mode fields (optional)
        rooms = body.get("rooms")
        mode = (body.get("mode") or "").strip().lower()

        if not base64_image:
            return {"error": "Missing image"}

        # -------------------------
        # IMAGE PROCESSING (correct order)
        # -------------------------
        image_bgr = decode_base64_image(base64_image)
        size_wh = resize_orientation(image_bgr)

        use_room_mask = (
            mode == "guided"
            and isinstance(rooms, list)
            and any(r and r.get("polygon") for r in rooms)
        )

        if use_room_mask:
            # GUIDED MODE
            # - mask from the drawn polygons (small furniture anchors, wall
            #   outlines -- no whole-room furniture flood)
            # - depth synthesized FROM that mask (skip DPT on the noisy
            #   architectural plan)
            seg_img = rasterize_rooms_mask(rooms, size_wh)
            depth_img = synthesize_depth_from_mask(seg_img)
            has_window = any(
                (r.get("type") or "").strip().lower() in ("balcony", "sunroom")
                for r in rooms
                if r
            )
            cn_scales = [0.4, 0.75]
            guidance_scale = 5.5
        else:
            depth_img = get_depth_image(image_bgr, size_wh)
            seg_map = get_segmentation_map(image_bgr)
            seg_img = get_segmentation_image(seg_map, size_wh)
            has_window = detect_window(seg_map)
            cn_scales = [0.5, 0.1]
            guidance_scale = 7.5

        # --- PROMPTS ---
        custom_prompt = body.get("custom_prompt")  # user-sent prompt (may be empty)

        # Normalize room_type for lookups
        room_key = (room_type or "").strip().lower()

        prompt = None

        # 1) If user supplied a custom prompt (non-empty) -> use it
        if custom_prompt and isinstance(custom_prompt, str) and custom_prompt.strip():
            prompt = custom_prompt.strip()

        # 2) If no custom prompt, try to pick a detailed template:
        if prompt is None:
            # check interior room prompts first
            if room_key in ROOM_PROMPTS:
                template = ROOM_PROMPTS[room_key]
                prompt = template.format(design_style=design_style or "Stylish", color_tone=color_tone or "neutral")
            # check exterior prompts
            elif room_key in EXTERIOR_PROMPTS:
                template = EXTERIOR_PROMPTS[room_key]
                prompt = template.format(design_style=design_style or "Stylish", color_tone=color_tone or "neutral")
            else:
                # fallback hybrid (C)
                prompt = FALLBACK_PROMPT.format(
                    design_style=design_style or "Stylish",
                    room_type=room_type or "interior",
                    color_tone=color_tone or "neutral"
                )

        # Make sure prompt is a string
        if not isinstance(prompt, str) or not prompt.strip():
            prompt = FALLBACK_PROMPT.format(
                design_style=design_style or "Stylish",
                room_type=room_type or "space",
                color_tone=color_tone or "neutral"
            )

        # WINDOW-aware modification
        if has_window:
            prompt = prompt + ", window in place"
        else:
            # add to negative prompt instead of prompt
            pass

        # Keep the base negative IDENTICAL to the pre-fix version so the
        # interior.jsx / exterior.jsx / quick-mode flows behave exactly as
        # they did before. Extra drafting- and duplication-blockers only
        # apply to plan.jsx guided mode (use_room_mask).
        negative = "blurry, lowres, distorted, floating furniture, bad lighting, wrong perspective"
        if not has_window:
            negative += ", no window"
        if use_room_mask:
            negative += (
                ", low quality, deformed, watermark, text, "
                "duplicate rooms, repeated furniture, tiled pattern, multiple beds, "
                "multiple sofas, mixed rooms, wrong room in wrong place, mismatched layout, "
                "rooms outside their boundaries, overlapping room areas, fragmented layout, "
                "2D floor plan, technical drawing, architectural drafting, dimension lines, "
                "labels, arabic text, symbols, door swing arcs, plan annotations"
            )

        # --- Generate ---
        result = pipe(
            prompt=prompt,
            image=[depth_img, seg_img],
            num_inference_steps=30,
            guidance_scale=guidance_scale,
            controlnet_conditioning_scale=cn_scales,
            negative_prompt=negative,
            generator=torch.manual_seed(42)
        )

        out = result.images[0]

        buf = io.BytesIO()
        out.save(buf, format="PNG")
        img_str = base64.b64encode(buf.getvalue()).decode()

        return {
            "message": "Image generated successfully",
            "generatedImage": img_str,
            "prompt": prompt,
            "negative_prompt": negative,
            "has_window": has_window,
            "guided_mask_used": use_room_mask,
        }

    except Exception as e:
        return {"error": str(e)}


# ---------------------------------------------------------------------------
# ENTRYPOINT
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
