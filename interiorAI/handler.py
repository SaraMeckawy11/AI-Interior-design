import runpod
import base64
import io
import time
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

# Lock cuDNN so kernels chosen during warmup are reused on real requests.
# (benchmark=True would re-autotune on every new shape, defeating the warmup.)
if use_cuda:
    torch.backends.cudnn.benchmark = False
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True

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
pipe.set_progress_bar_config(disable=True)

# Try to enable memory-efficient attention. Falls through silently if not
# available (newer diffusers default to PyTorch SDPA which is already fast).
try:
    pipe.enable_xformers_memory_efficient_attention()
    print("[warmup] xformers memory-efficient attention enabled")
except Exception:
    pass


# ---------------------------------------------------------------------------
# WARMUP
# ---------------------------------------------------------------------------
# RunPod FlashBoot snapshots the worker AFTER handler.py finishes importing.
# If we don't run every model end-to-end here, the very first real request has
# to JIT-compile CUDA kernels (cuBLAS / cuDNN / SDPA / attention) -- 60-90s on
# a dual-ControlNet SD1.5 pipeline. The client times out at ~60s and the job
# comes back as failed even though the worker was "ready".
#
# Running one tiny forward pass per model here forces all of that compilation
# at init time. The compiled kernels are then captured in the FlashBoot
# snapshot, so every subsequent cold start restores a fully warm worker in ~2s.
def _warmup():
    if not use_cuda:
        print("[warmup] CPU mode, skipping GPU warmup")
        return

    print("[warmup] Starting GPU warmup (this only runs at init / snapshot time)...")
    t0 = time.time()

    try:
        # Dummy RGB image matching the smaller orientation we actually serve.
        dummy_bgr = np.random.randint(0, 255, (512, 512, 3), dtype=np.uint8)
        dummy_rgb = cv2.cvtColor(dummy_bgr, cv2.COLOR_BGR2RGB)
        dummy_pil = Image.fromarray(dummy_rgb)

        # 1) DPT depth -- compiles depth transformer kernels
        with torch.no_grad():
            inputs = dpt_processor(images=dummy_pil, return_tensors="pt").to(device)
            inputs = {k: v.to(dtype=dtype) for k, v in inputs.items()}
            _ = dpt_model(**inputs).predicted_depth
        print(f"[warmup] depth ok ({time.time() - t0:.1f}s)")

        # 2) UperNet segmentation -- compiles ConvNeXt + UperNet kernels
        with torch.no_grad():
            inputs = seg_processor(images=dummy_pil, return_tensors="pt").to(device)
            inputs = {k: v.to(dtype=dtype) for k, v in inputs.items()}
            _ = seg_model(**inputs)
        print(f"[warmup] segmentation ok ({time.time() - t0:.1f}s)")

        # 3) Full SD + dual ControlNet pipeline -- compiles the UNet, VAE,
        #    text encoder, and both ControlNet forward passes. We run both
        #    orientations we actually serve (768x1024 and 1024x768) so the
        #    autotuned kernels cover real traffic shapes.
        for (w, h) in [(768, 1024), (1024, 768)]:
            ctrl_img = Image.new("RGB", (w, h), (128, 128, 128))
            with torch.inference_mode():
                _ = pipe(
                    prompt="a room",
                    image=[ctrl_img, ctrl_img],
                    num_inference_steps=2,
                    guidance_scale=7.5,
                    controlnet_conditioning_scale=[0.5, 0.1],
                    negative_prompt="blurry",
                    generator=torch.manual_seed(0),
                ).images[0]
            print(f"[warmup] pipeline {w}x{h} ok ({time.time() - t0:.1f}s)")

        if use_cuda:
            torch.cuda.synchronize()

        print(f"[warmup] DONE in {time.time() - t0:.1f}s -- worker is production-ready")
    except Exception as e:
        # Never block the worker from starting because of warmup. A cold first
        # request will just pay the compile cost, which is the pre-fix behavior.
        print(f"[warmup] FAILED: {e!r} -- continuing without warmup")


_warmup()

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

        if not base64_image:
            return {"error": "Missing image"}

        # -------------------------
        # IMAGE PROCESSING (correct order)
        # -------------------------
        image_bgr = decode_base64_image(base64_image)
        size_wh = resize_orientation(image_bgr)

        depth_img = get_depth_image(image_bgr, size_wh)
        seg_map = get_segmentation_map(image_bgr)
        seg_img = get_segmentation_image(seg_map, size_wh)

        has_window = detect_window(seg_map)

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

        negative = "blurry, lowres, distorted, floating furniture, bad lighting, wrong perspective"
        if not has_window:
            negative += ", no window"

        # --- Generate ---
        result = pipe(
            prompt=prompt,
            image=[depth_img, seg_img],
            num_inference_steps=30,
            guidance_scale=7.5,
            controlnet_conditioning_scale=[0.5, 0.1],
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
            "has_window": has_window
        }

    except Exception as e:
        return {"error": str(e)}


# ---------------------------------------------------------------------------
# ENTRYPOINT
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
