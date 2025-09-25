import runpod
import base64
import io
import torch
import cv2
import numpy as np
from PIL import Image
from diffusers import StableDiffusionControlNetPipeline, ControlNetModel, UniPCMultistepScheduler

# --- Device setup ---
use_cuda = torch.cuda.is_available()
dtype = torch.float16 if use_cuda else torch.float32
device = "cuda" if use_cuda else "cpu"

# --- Load models once (cold start) ---
controlnet = ControlNetModel.from_pretrained(
    "lllyasviel/control_v11p_sd15_canny", torch_dtype=dtype
)
pipe = StableDiffusionControlNetPipeline.from_pretrained(
    "Lykon/dreamshaper-8",
    controlnet=controlnet,
    torch_dtype=dtype,
    safety_checker=None
).to(device)
pipe.scheduler = UniPCMultistepScheduler.from_config(pipe.scheduler.config)

# --- Helper functions ---
def get_canny_image(image, size=(768, 768)):
    image = cv2.resize(image, size)
    canny = cv2.Canny(image, 100, 200)
    canny_rgb = cv2.cvtColor(canny, cv2.COLOR_GRAY2RGB)
    return Image.fromarray(canny_rgb), canny

def decode_base64_image(base64_str):
    if base64_str.startswith("data:image"):
        base64_str = base64_str.split(",")[1]
    base64_str += "=" * (-len(base64_str) % 4)
    image_bytes = base64.b64decode(base64_str)
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("cv2.imdecode returned None")
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    return img

def classify_room(canny_edges):
    edge_pixels = np.sum(canny_edges > 0)
    total_pixels = canny_edges.size
    edge_ratio = edge_pixels / total_pixels
    if edge_ratio < 0.04:
        return 0.3, 576906284
    elif edge_ratio < 0.07:
        return 0.4, 576906284
    else:
        return 0.5, 42

# --- Main handler ---
def handler(event):
    try:
        body = event["input"]
        base64_image = body.get("image")
        room_type = body.get("room_type", "living room")
        design_style = body.get("design_style", "modern")
        color_tone = body.get("color_tone", "neutral")

        if not base64_image or len(base64_image) < 100:
            return {"error": "Invalid or missing image data"}

        room_image = decode_base64_image(base64_image)
        h, w = room_image.shape[:2]
        target_size = (768, 512) if w > h else (512, 768)
        canny_image, canny_edges = get_canny_image(room_image, target_size)
        controlnet_scale, seed = classify_room(canny_edges)

        prompt = (
            f"A {design_style} {room_type} interior with {color_tone} tones, "
            f"soft ambient lighting, realistic textures, highly detailed, "
            f"photorealistic, 8k, designed by an interior architect"
        )

        negative_prompt = (
            "blurry, low quality, low resolution, deformed furniture, distorted layout, cartoon, "
            "floating objects, extra doors or windows, incorrect perspective, bad lighting"
        )

        result = pipe(
            prompt=prompt,
            image=canny_image,
            num_inference_steps=30,
            guidance_scale=7.5,
            controlnet_conditioning_scale=controlnet_scale,
            negative_prompt=negative_prompt,
            generator=torch.manual_seed(seed)
        )

        output_image = result.images[0]
        buffered = io.BytesIO()
        output_image.save(buffered, format="PNG")
        img_str = base64.b64encode(buffered.getvalue()).decode("utf-8")

        return {
            "message": "Image generated successfully",
            "generatedImage": img_str,
            "prompt": prompt,
            "room_type": room_type,
            "design_style": design_style,
            "color_tone": color_tone
        }

    except Exception as e:
        return {"error": str(e)}

# Start runpod serverless
runpod.serverless.start({"handler": handler})
