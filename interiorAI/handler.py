# runpod_server_match_local.py
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
dtype = torch.float16 if use_cuda else torch.float32
device = "cuda" if use_cuda else "cpu"

# ---------------------------------------------------------------------------
# CACHING / MODEL LOAD (cold-start)
# ---------------------------------------------------------------------------
CACHE_DIR = "/home/user/.cache/huggingface"

# Depth model (Intel DPT large)
dpt_processor = DPTImageProcessor.from_pretrained(
    "Intel/dpt-large",
    cache_dir=CACHE_DIR
)
dpt_model = DPTForDepthEstimation.from_pretrained(
    "Intel/dpt-large",
    torch_dtype=dtype,
    cache_dir=CACHE_DIR
).to(device)
dpt_model.eval()

# Segmentation model (openmmlab/upernet-convnext-small)
seg_processor = AutoImageProcessor.from_pretrained(
    "openmmlab/upernet-convnext-small",
    cache_dir=CACHE_DIR
)
seg_model = UperNetForSemanticSegmentation.from_pretrained(
    "openmmlab/upernet-convnext-small",
    torch_dtype=dtype,
    cache_dir=CACHE_DIR
).to(device)
seg_model.eval()

# ControlNets (depth + segmentation) - load with same dtype
depth_controlnet = ControlNetModel.from_pretrained(
    "lllyasviel/sd-controlnet-depth",
    torch_dtype=dtype,
    cache_dir=CACHE_DIR
)
seg_controlnet = ControlNetModel.from_pretrained(
    "lllyasviel/control_v11p_sd15_seg",
    torch_dtype=dtype,
    cache_dir=CACHE_DIR
)

# Base Stable Diffusion pipeline (model)
pipe = StableDiffusionControlNetPipeline.from_pretrained(
    "Lykon/dreamshaper-8",
    controlnet=[depth_controlnet, seg_controlnet],
    torch_dtype=dtype,
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
    # pad base64
    base64_str += "=" * (-len(base64_str) % 4)
    img_bytes = base64.b64decode(base64_str)
    nparr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Invalid image provided")
    # keep BGR as cv2 loaded -> functions expect BGR then convert where needed
    return img

def resize_orientation(img):
    h, w = img.shape[:2]
    if w > h:
        # Landscape: same as desktop TARGET_WIDTH=768, TARGET_HEIGHT=512
        return (768, 512)
    else:
        # Portrait: TARGET_WIDTH=512, TARGET_HEIGHT=768
        return (512, 768)

# ---------------------------------------------------------------------------
# DEPTH MAP (matches local code)
# ---------------------------------------------------------------------------
def get_depth_image(image_bgr, size_wh):
    # size_wh is (width, height)
    width, height = size_wh
    image_resized = cv2.resize(image_bgr, (width, height), interpolation=cv2.INTER_CUBIC)
    # LOCAL uses BGR -> convert to RGB before sending to processor
    image_rgb = cv2.cvtColor(image_resized, cv2.COLOR_BGR2RGB)

    inputs = dpt_processor(images=Image.fromarray(image_rgb), return_tensors="pt").to(device)

    with torch.no_grad():
        depth = dpt_model(**inputs).predicted_depth

    # Interpolate to (height, width)
    depth_resized = torch.nn.functional.interpolate(
        depth.unsqueeze(1),
        size=(height, width),
        mode="bicubic",
        align_corners=False
    ).squeeze().cpu().numpy()

    depth_norm = ((depth_resized - depth_resized.min()) /
                  (depth_resized.max() - depth_resized.min()) * 255).astype(np.uint8)

    # Return PIL RGB just like local code
    return Image.fromarray(depth_norm).convert("RGB")

# ---------------------------------------------------------------------------
# SEGMENTATION MAP & IMAGE (matches local code)
# ---------------------------------------------------------------------------
def get_segmentation_map(image_bgr):
    width, height = resize_orientation(image_bgr)
    image_resized = cv2.resize(image_bgr, (width, height), interpolation=cv2.INTER_CUBIC)
    image_rgb = cv2.cvtColor(image_resized, cv2.COLOR_BGR2RGB)

    inputs = seg_processor(images=Image.fromarray(image_rgb), return_tensors="pt").to(device)

    with torch.no_grad():
        outputs = seg_model(**inputs)

    seg_map = outputs.logits.argmax(dim=1)[0].cpu().numpy().astype(np.uint8)
    return seg_map

def get_segmentation_image(seg_map, target_wh):
    # seg_map is in resized (width,height) from get_segmentation_map
    # Create colormap same as local: cv2.applyColorMap((seg_map * 10).astype(np.uint8), cv2.COLORMAP_JET)
    seg_colormap = cv2.applyColorMap((seg_map * 10).astype(np.uint8), cv2.COLORMAP_JET)
    # Resize colormap to target size (width,height)
    target_width, target_height = target_wh
    seg_colormap_resized = cv2.resize(seg_colormap, (target_width, target_height), interpolation=cv2.INTER_NEAREST)
    # seg_colormap_resized is BGR -> convert to RGB image for pipeline
    seg_rgb = cv2.cvtColor(seg_colormap_resized, cv2.COLOR_BGR2RGB)
    return Image.fromarray(seg_rgb)

# ---------------------------------------------------------------------------
# WINDOW DETECTION (matches local code)
# ---------------------------------------------------------------------------
WINDOW_KEYWORDS = ["window", "windowpane"]

def detect_window(seg_map):
    unique_ids = np.unique(seg_map)
    id2label = seg_model.config.id2label

    for class_id in unique_ids:
        name = id2label.get(int(class_id), "").lower()
        if any(w in name for w in WINDOW_KEYWORDS):
            return True
    return False

# ---------------------------------------------------------------------------
# HANDLER (RunPod)
# ---------------------------------------------------------------------------
def handler(event):
    try:
        body = event.get("input", {}) if isinstance(event, dict) else {}
        base64_image = body.get("image")
        room_type = body.get("room_type", "bedroom")
        design_style = body.get("design_style", "modern")
        color_tone = body.get("color_tone", "vanilla latte")

        if not base64_image:
            return {"error": "Missing image"}

        # Decode input image (BGR)
        image_bgr = decode_base64_image(base64_image)

        # Orientation and target size
        size_wh = resize_orientation(image_bgr)  # (width, height)

        # Depth image (PIL RGB)
        depth_img = get_depth_image(image_bgr, size_wh)

        # Segmentation map (on resized version used in seg model)
        seg_map = get_segmentation_map(image_bgr)
        seg_img = get_segmentation_image(seg_map, size_wh)

        # Window detection (from raw seg map)
        has_window = detect_window(seg_map)

        # Prompt: EXACT same style as local script (to match outputs)
        prompt = (
            f"{design_style} {room_type}, interior design, soft ambient lighting, high detail, "
            f"{color_tone} tones, realistic textures, highly detailed, "
            "photorealistic, 8k, designed by an interior architect"
        )

        # Negative prompt base (same as local)
        negative_prompt = "blurry, lowres, distorted, floating furniture, bad lighting, wrong perspective"
        if not has_window:
            negative_prompt += ", no window"

        # Run generation using same params and seed as local
        # Use the same guidance/controlnet scales as local
        result = pipe(
            prompt=prompt,
            image=[depth_img, seg_img],
            num_inference_steps=30,
            guidance_scale=7.5,
            controlnet_conditioning_scale=[0.5, 0.1],
            negative_prompt=negative_prompt,
            generator=torch.manual_seed(42)
        )

        output_image = result.images[0]

        # Convert result to Base64 PNG
        buffer = io.BytesIO()
        output_image.save(buffer, format="PNG")
        img_str = base64.b64encode(buffer.getvalue()).decode()

        return {
            "message": "Image generated successfully",
            "generatedImage": img_str,
            "has_window": has_window,
            "prompt": prompt,
            "negative_prompt": negative_prompt,
            "design_style": design_style,
            "room_type": room_type,
            "color_tone": color_tone
        }

    except Exception as e:
        return {"error": str(e)}

# ---------------------------------------------------------------------------
# RUNPOD ENTRYPOINT
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
