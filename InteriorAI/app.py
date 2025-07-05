from fastapi import FastAPI, Request
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from diffusers import StableDiffusionControlNetPipeline, ControlNetModel, UniPCMultistepScheduler
from PIL import Image
import torch
import cv2
import numpy as np
import io
import base64
import traceback

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Device and dtype setup ---
use_cuda = torch.cuda.is_available()
dtype = torch.float16 if use_cuda else torch.float32
device = "cuda" if use_cuda else "cpu"

# --- Load ControlNet and Stable Diffusion Pipeline ---
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

# --- Helper: Convert base64 to image ---
def decode_base64_image(base64_str):
    try:
        print(f"Decoding base64 image of length {len(base64_str)}")
        if base64_str.startswith("data:image"):
            base64_str = base64_str.split(",")[1]
        print(f"Base64 data (start): {base64_str[:30]}... (end): {base64_str[-30:]}")
        image_bytes = base64.b64decode(base64_str)
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("cv2.imdecode returned None - image decode failed")
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        return img
    except Exception as e:
        print(f"Error decoding base64 image: {e}")
        raise

# --- Helper: Get Canny edge image ---
def get_canny_image(image, size=(768, 768)):
    image = cv2.resize(image, size)
    canny = cv2.Canny(image, 100, 200)
    canny_rgb = cv2.cvtColor(canny, cv2.COLOR_GRAY2RGB)
    return Image.fromarray(canny_rgb)

# --- Request schema ---
class GenerateRequest(BaseModel):
    image: str
    room_type: str
    design_style: str
    color_tone: str
    prompt: str = None

# --- Main generation route ---
@app.post("/generate")
async def generate(data: GenerateRequest):
    base64_image = data.image
    room_type = data.room_type
    design_style = data.design_style
    color_tone = data.color_tone
    custom_prompt = data.prompt

    if not base64_image or len(base64_image) < 100:
        return {
            "message": "Invalid or missing image data"
        }

    prompt = custom_prompt or (
        f"A {design_style} {room_type} interior with {color_tone} tones ,soft ambient lighting, "
        f"realistic textures, highly detailed, photorealistic, 8k, designed by an interior architect"
    )

    negative_prompt = (
        "blurry, low quality, low resolution, deformed furniture, distorted layout, cartoon, floating objects, "
        "extra doors or windows, incorrect perspective, bad lighting"
    )

    try:
        room_image = decode_base64_image(base64_image)
        orig_h, orig_w = room_image.shape[:2]
        target_size = (768, 512) if orig_w > orig_h else (512, 768)
        canny_image = get_canny_image(room_image, target_size)
    except Exception as e:
        return {
            "message": "Invalid image data",
            "details": str(e)
        }

    try:
        result = pipe(
            prompt=prompt,
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
            "message": "Image generated successfully",
            "generatedImage": img_str,
            "prompt": prompt,
            "room_type": room_type,
            "design_style": design_style,
            "color_tone": color_tone
        }

    except Exception as e:
        print("Error during generation:", e)
        traceback.print_exc()
        return {
            "message": "Something went wrong",
            "details": str(e)
        }
