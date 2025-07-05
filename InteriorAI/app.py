from flask import Flask, request, jsonify
from diffusers import StableDiffusionControlNetPipeline, ControlNetModel, UniPCMultistepScheduler
from PIL import Image
import torch
import cv2
import numpy as np
import io
import base64
from flask_cors import CORS
import traceback
import random

app = Flask(__name__)
CORS(app)

# --- Device and dtype setup ---
use_cuda = torch.cuda.is_available()
dtype = torch.float16 if use_cuda else torch.float32
device = "cuda" if use_cuda else "cpu"

# --- Load ControlNet and Stable Diffusion Pipeline ---
controlnet = ControlNetModel.from_pretrained(
    "lllyasviel/control_v11p_sd15_canny", torch_dtype=dtype
)

model1="Lykon/dreamshaper-8"

pipe = StableDiffusionControlNetPipeline.from_pretrained(
    model1,
    controlnet=controlnet,
    torch_dtype=dtype,
    safety_checker=None
).to(device)

pipe.scheduler = UniPCMultistepScheduler.from_config(pipe.scheduler.config)

# --- Helper: Convert input image to Canny edges ---
def get_canny_image(image, size=(768, 768)):
    image = cv2.resize(image, size)
    canny = cv2.Canny(image, 100, 200)
    canny_rgb = cv2.cvtColor(canny, cv2.COLOR_GRAY2RGB)
    return Image.fromarray(canny_rgb)

# --- Helper: Convert base64 to NumPy image ---
# def decode_base64_image(base64_str):
#     try:
#         if base64_str.startswith("data:image"):
#             base64_str = base64_str.split(",")[1]
#         image_bytes = base64.b64decode(base64_str)
#         nparr = np.frombuffer(image_bytes, np.uint8)
#         img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
#         if img is None:
#             raise ValueError("cv2.imdecode returned None")
#         return img
#     except Exception as e:
#         raise ValueError(f"Failed to decode base64 image: {e}")

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
        
        #  Fix: Convert BGR to RGB
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        
        return img
    except Exception as e:
        print(f"Error decoding base64 image: {e}")
        raise

@app.route("/generate", methods=["POST"])
def generate():
    data = request.json
    base64_image = data.get("image")
    room_type = data.get("room_type")
    design_style = data.get("design_style")
    color_tone = data.get("color_tone")
    custom_prompt = data.get("prompt", None)

    if not base64_image or len(base64_image) < 100:
        return jsonify({"message": "Invalid or missing image data"}), 400

    prompt = (
        f"A {design_style} {room_type} interior with {color_tone} tones ,soft ambient lighting, "
        f"realistic textures, highly detailed, photorealistic, 8k, designed by an interior architect"
    )

    negative_prompt = (
        "blurry, low quality, low resolution, deformed furniture, distorted layout, cartoon, floating objects, "
        "extra doors or windows, incorrect perspective, bad lighting"
    )

    try:
        # Decode and preprocess image
        room_image = decode_base64_image(base64_image)
        orig_h, orig_w = room_image.shape[:2]
        target_size = (768, 512) if orig_w > orig_h else (512, 768)
        canny_image = get_canny_image(room_image, target_size)
    except Exception as e:
        return jsonify({"message": "Invalid image data", "details": str(e)}), 400

    try:
        # Generate image
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

        return jsonify({
            "message": "Image generated successfully",
            "generatedImage": img_str,
            "prompt": prompt,
            "room_type": room_type,
            "design_style": design_style,
            "color_tone": color_tone
        })

    except Exception as e:
        print("Error during generation:", e)
        traceback.print_exc()
        return jsonify({"message": "Something went wrong", "details": str(e)}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
