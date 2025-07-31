# predict.py

from diffusers import StableDiffusionControlNetPipeline, ControlNetModel, UniPCMultistepScheduler
from PIL import Image
import torch
import cv2
import numpy as np
import io
import base64
import traceback

# Setup device
device = "cuda" if torch.cuda.is_available() else "cpu"
dtype = torch.float16 if device == "cuda" else torch.float32

# Load models (loaded only once when container starts)
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


def get_canny_image(image, size=(768, 768)):
    image = cv2.resize(image, size)
    canny = cv2.Canny(image, 100, 200)
    canny_rgb = cv2.cvtColor(canny, cv2.COLOR_GRAY2RGB)
    return Image.fromarray(canny_rgb)


def decode_base64_image(base64_str):
    if base64_str.startswith("data:image"):
        base64_str = base64_str.split(",")[1]
    image_bytes = base64.b64decode(base64_str)
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("cv2.imdecode failed")
    return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)


def predict(image: str, room_type: str, design_style: str, color_tone: str, prompt: str = None) -> dict:
    try:
        room_image = decode_base64_image(image)
        orig_h, orig_w = room_image.shape[:2]
        target_size = (768, 512) if orig_w > orig_h else (512, 768)
        canny_image = get_canny_image(room_image, target_size)

        final_prompt = (
            f"A {design_style} {room_type} interior with {color_tone} tones, soft ambient lighting, "
            f"realistic textures, highly detailed, photorealistic, 8k, designed by an interior architect"
        )

        negative_prompt = (
            "blurry, low quality, low resolution, deformed furniture, distorted layout, cartoon, floating objects, "
            "extra doors or windows, incorrect perspective, bad lighting"
        )

        result = pipe(
            prompt=final_prompt,
            image=canny_image,
            num_inference_steps=30,
            guidance_scale=7.5,
            controlnet_conditioning_scale=0.5,
            negative_prompt=negative_prompt,
            generator=torch.manual_seed(42)
        )

        output_image = result.images[0]
        buffered = io.BytesIO()
        output_image.save(buffered, format="PNG")
        img_str = base64.b64encode(buffered.getvalue()).decode("utf-8")

        return {
            "generatedImage": img_str,
            "prompt": final_prompt,
            "room_type": room_type,
            "design_style": design_style,
            "color_tone": color_tone
        }

    except Exception as e:
        return {"error": str(e), "trace": traceback.format_exc()}
