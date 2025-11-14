import runpod
import base64
import io
import torch
import cv2
import numpy as np
from PIL import Image
from diffusers import StableDiffusionControlNetPipeline, ControlNetModel, UniPCMultistepScheduler
from transformers import DPTImageProcessor, DPTForDepthEstimation, AutoImageProcessor, UperNetForSemanticSegmentation

# -----------------------------------------------------------------------------
# DEVICE SETUP
# -----------------------------------------------------------------------------
use_cuda = torch.cuda.is_available()
dtype = torch.float16 if use_cuda else torch.float32
device = "cuda" if use_cuda else "cpu"

# -----------------------------------------------------------------------------
# LOAD MODELS ONCE (COLD START)
# -----------------------------------------------------------------------------

# Depth model
dpt_processor = DPTImageProcessor.from_pretrained(
    "Intel/dpt-large",
    cache_dir="/home/user/.cache/huggingface"
)
dpt_model = DPTForDepthEstimation.from_pretrained(
    "Intel/dpt-large",
    torch_dtype=torch.float32,
    cache_dir="/home/user/.cache/huggingface"
).to(device)

# Segmentation model
seg_processor = AutoImageProcessor.from_pretrained(
    "openmmlab/upernet-convnext-small",
    cache_dir="/home/user/.cache/huggingface"
)
seg_model = UperNetForSemanticSegmentation.from_pretrained(
    "openmmlab/upernet-convnext-small",
    torch_dtype=torch.float32,
    cache_dir="/home/user/.cache/huggingface"
).to(device)

# ControlNets (depth + segmentation)
depth_controlnet = ControlNetModel.from_pretrained(
    "lllyasviel/sd-controlnet-depth",
    torch_dtype=dtype,
    cache_dir="/home/user/.cache/huggingface"
)

seg_controlnet = ControlNetModel.from_pretrained(
    "lllyasviel/control_v11p_sd15_seg",
    torch_dtype=dtype,
    cache_dir="/home/user/.cache/huggingface"
)

# Stable Diffusion pipeline
pipe = StableDiffusionControlNetPipeline.from_pretrained(
    "Lykon/dreamshaper-8",
    controlnet=[depth_controlnet, seg_controlnet],
    torch_dtype=dtype,
    safety_checker=None,
    cache_dir="/home/user/.cache/huggingface"
).to(device)

pipe.scheduler = UniPCMultistepScheduler.from_config(pipe.scheduler.config)


# -----------------------------------------------------------------------------
# UTILITIES
# -----------------------------------------------------------------------------

def decode_base64_image(base64_str):
    if base64_str.startswith("data:image"):
        base64_str = base64_str.split(",")[1]
    base64_str += "=" * (-len(base64_str) % 4)
    img_bytes = base64.b64decode(base64_str)
    nparr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Invalid image provided")
    return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)


def resize_orientation(img):
    h, w = img.shape[:2]
    if w > h:
        return (768, 512)
    else:
        return (512, 768)


# -----------------------------------------------------------------------------
# DEPTH MAP GENERATION
# -----------------------------------------------------------------------------

def get_depth_image(image, size):
    image_resized = cv2.resize(image, size, interpolation=cv2.INTER_CUBIC)
    rgb = cv2.cvtColor(image_resized, cv2.COLOR_RGB2BGR)

    inputs = dpt_processor(images=Image.fromarray(rgb), return_tensors="pt").to(device)

    with torch.no_grad():
        depth = dpt_model(**inputs).predicted_depth

    depth_resized = torch.nn.functional.interpolate(
        depth.unsqueeze(1),
        size=size[::-1],
        mode="bicubic",
        align_corners=False
    ).squeeze().cpu().numpy()

    depth_norm = ((depth_resized - depth_resized.min()) /
                  (depth_resized.max() - depth_resized.min()) * 255).astype(np.uint8)

    return Image.fromarray(depth_norm).convert("RGB")


# -----------------------------------------------------------------------------
# SEGMENTATION GENERATION
# -----------------------------------------------------------------------------

def get_seg_map(image):
    image_resized = cv2.resize(image, resize_orientation(image), interpolation=cv2.INTER_CUBIC)
    rgb = cv2.cvtColor(image_resized, cv2.COLOR_RGB2BGR)

    inputs = seg_processor(images=Image.fromarray(rgb), return_tensors="pt").to(device)

    with torch.no_grad():
        outputs = seg_model(**inputs)

    seg = outputs.logits.argmax(dim=1)[0].cpu().numpy().astype(np.uint8)
    return seg


def get_seg_image(seg_map, size):
    seg_colormap = cv2.applyColorMap((seg_map * 10).astype(np.uint8), cv2.COLORMAP_JET)
    seg_resized = cv2.resize(seg_colormap, size, interpolation=cv2.INTER_NEAREST)
    return Image.fromarray(seg_resized)


# -----------------------------------------------------------------------------
# WINDOW DETECTION
# -----------------------------------------------------------------------------

WINDOW_KEYWORDS = ["window", "windowpane"]

def detect_window(seg_map):
    unique_ids = np.unique(seg_map)
    id2label = seg_model.config.id2label

    for class_id in unique_ids:
        name = id2label.get(int(class_id), "").lower()
        if any(w in name for w in WINDOW_KEYWORDS):
            return True
    return False


# -----------------------------------------------------------------------------
# MAIN HANDLER
# -----------------------------------------------------------------------------

def handler(event):
    try:
        body = event["input"]

        base64_image = body.get("image")
        room_type = body.get("room_type", "bedroom")
        design_style = body.get("design_style", "modern")
        color_tone = body.get("color_tone", "vanilla latte")

        if not base64_image:
            return {"error": "Missing image"}

        # Decode the input image
        image = decode_base64_image(base64_image)

        # Orientation size (portrait or landscape)
        size = resize_orientation(image)

        # Depth map
        depth_img = get_depth_image(image, size)

        # Segmentation map
        seg_map = get_seg_map(image)
        seg_img = get_seg_image(seg_map, size)

        # Window detection
        has_window = detect_window(seg_map)

        # Dynamic prompt with variables
        prompt = (
            f"A {design_style} {room_type} interior with {color_tone} tones, "
            f"soft ambient lighting, realistic textures, highly detailed, "
            f"photorealistic, 8k, designed by an interior architect"
        )

        # Negative prompt + window logic
        negative_prompt = (
            "blurry, lowres, distorted, floating furniture, bad lighting, wrong perspective"
        )

        if not has_window:
            negative_prompt += ", no window"

        # Run generation
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

        # Convert result to Base64
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


# -----------------------------------------------------------------------------
# RUNPOD ENTRYPOINT
# -----------------------------------------------------------------------------

if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
