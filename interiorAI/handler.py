# runpod_server_match_local_fixed_fp32.py
import runpod
import base64
import io
import torch
import cv2
import numpy as np
from PIL import Image
from diffusers import StableDiffusionControlNetPipeline, ControlNetModel, UniPCMultistepScheduler
from transformers import DPTImageProcessor, DPTForDepthEstimation, AutoImageProcessor, UperNetForSemanticSegmentation

# ---------------------------------------------------------------------------
# DEVICE / DTYPE
# ---------------------------------------------------------------------------
use_cuda = torch.cuda.is_available()
device = "cuda" if use_cuda else "cpu"

FP32 = torch.float32

# ---------------------------------------------------------------------------
# CACHE
# ---------------------------------------------------------------------------
CACHE_DIR = "/home/user/.cache/huggingface"

# ---------------------------------------------------------------------------
# LOAD MODELS — ALL FP32 to avoid mixed-dtype errors
# ---------------------------------------------------------------------------

# Depth model (FP32)
dpt_processor = DPTImageProcessor.from_pretrained(
    "Intel/dpt-large",
    cache_dir=CACHE_DIR
)
dpt_model = DPTForDepthEstimation.from_pretrained(
    "Intel/dpt-large",
    torch_dtype=FP32,
    cache_dir=CACHE_DIR
).to(device)
dpt_model.eval()

# Segmentation model (FP32 to avoid dtype mismatch)
seg_processor = AutoImageProcessor.from_pretrained(
    "openmmlab/upernet-convnext-small",
    cache_dir=CACHE_DIR
)
seg_model = UperNetForSemanticSegmentation.from_pretrained(
    "openmmlab/upernet-convnext-small",
    torch_dtype=FP32,
    cache_dir=CACHE_DIR
).to(device)
seg_model.eval()

# ControlNets (FP32)
depth_controlnet = ControlNetModel.from_pretrained(
    "lllyasviel/sd-controlnet-depth",
    torch_dtype=FP32,
    cache_dir=CACHE_DIR
)
seg_controlnet = ControlNetModel.from_pretrained(
    "lllyasviel/control_v11p_sd15_seg",
    torch_dtype=FP32,
    cache_dir=CACHE_DIR
)

# Stable Diffusion pipeline (FP32)
pipe = StableDiffusionControlNetPipeline.from_pretrained(
    "Lykon/dreamshaper-8",
    controlnet=[depth_controlnet, seg_controlnet],
    torch_dtype=FP32,
    safety_checker=None,
    cache_dir=CACHE_DIR
).to(device)

# Make scheduler same as local
pipe.scheduler = UniPCMultistepScheduler.from_config(pipe.scheduler.config)

# ---------------------------------------------------------------------------
# UTILITIES
# ---------------------------------------------------------------------------
def decode_base64_image(base64_str):
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
    if w > h:
        return (768, 512)  # width, height
    else:
        return (512, 768)

# ---------------------------------------------------------------------------
# DEPTH (FP32 MODEL)
# ---------------------------------------------------------------------------
def get_depth_image(image_bgr, size_wh):
    width, height = size_wh

    image_resized = cv2.resize(image_bgr, (width, height), interpolation=cv2.INTER_CUBIC)
    image_rgb = cv2.cvtColor(image_resized, cv2.COLOR_BGR2RGB)

    inputs = dpt_processor(images=Image.fromarray(image_rgb), return_tensors="pt").to(device)
    # keep inputs FP32 for FP32 model
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
# SEGMENTATION (FP32 MODEL)
# ---------------------------------------------------------------------------
def get_segmentation_map(image_bgr):
    width, height = resize_orientation(image_bgr)

    image_resized = cv2.resize(image_bgr, (width, height), interpolation=cv2.INTER_CUBIC)
    image_rgb = cv2.cvtColor(image_resized, cv2.COLOR_BGR2RGB)

    inputs = seg_processor(images=Image.fromarray(image_rgb), return_tensors="pt").to(device)
    # keep inputs FP32 for FP32 model
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
    unique_ids = np.unique(seg_map)

    for class_id in unique_ids:
        name = labels.get(int(class_id), "").lower()
        if any(w in name for w in WINDOW_KEYWORDS):
            return True

    return False

# ---------------------------------------------------------------------------
# HANDLER
# ---------------------------------------------------------------------------
def handler(event):
    try:
        body = event.get("input", {})
        base64_image = body.get("image")

        room_type = body.get("room_type", "bedroom")
        design_style = body.get("design_style", "modern")
        color_tone = body.get("color_tone", "vanilla latte")

        if not base64_image:
            return {"error": "Missing image"}

        image_bgr = decode_base64_image(base64_image)

        size_wh = resize_orientation(image_bgr)

        depth_img = get_depth_image(image_bgr, size_wh)

        seg_map = get_segmentation_map(image_bgr)
        seg_img = get_segmentation_image(seg_map, size_wh)

        has_window = detect_window(seg_map)

        # -------------------------------------------------------------------
        # BUILD PROMPT BASE
        # -------------------------------------------------------------------
        prompt = (
            f"{design_style} {room_type}, interior design, soft ambient lighting, high detail, "
            f"{color_tone} tones, realistic textures, highly detailed, photorealistic, 8k, "
            "designed by an interior architect"
        )

        # Always define negative BEFORE any conditional modification
        negative = "blurry, lowres, distorted, floating furniture, bad lighting, wrong perspective"

        # -------------------------------------------------------------------
        # WINDOW LOGIC
        # -------------------------------------------------------------------
        if has_window:
            # Insert "window in place" directly after the room_type word
            prompt = prompt.replace(f"{room_type}", f"{room_type} with window in place")
        else:
            # NO window → modify ONLY negative prompt, as you requested
            negative += ", no window"

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

        buffer = io.BytesIO()
        out.save(buffer, format="PNG")
        img_str = base64.b64encode(buffer.getvalue()).decode()

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
