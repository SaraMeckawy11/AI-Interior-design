from cog import BasePredictor, Input
from diffusers import StableDiffusionControlNetPipeline, ControlNetModel, UniPCMultistepScheduler
from PIL import Image
import torch
import cv2
import numpy as np
import io
import base64
import traceback

# --- Device setup ---
use_cuda = torch.cuda.is_available()
device = "cuda" if use_cuda else "cpu"

# --- Load ControlNet ---
print("[INIT] Loading models...")
controlnet = ControlNetModel.from_pretrained(
    "lllyasviel/control_v11p_sd15_canny",
    torch_dtype=torch.float32   # 🔒 force fp32
).to(device)


def init_pipe(dtype=torch.float32):
    print(f"[INIT] Loading pipeline with dtype={dtype}...")
    pipe = StableDiffusionControlNetPipeline.from_pretrained(
        "Lykon/dreamshaper-8",
        controlnet=controlnet,
        torch_dtype=dtype,
        safety_checker=None
    ).to(device)

    pipe.scheduler = UniPCMultistepScheduler.from_config(pipe.scheduler.config)

    try:
        pipe.enable_xformers_memory_efficient_attention()
        print("[INIT] xFormers enabled.")
    except Exception as e:
        print(f"[INIT] Could not enable xFormers: {e}")

    # ✅ VRAM saving
    pipe.enable_attention_slicing()
    pipe.enable_sequential_cpu_offload()

    return pipe


# 🚀 Initialize once in fp32
pipe = init_pipe(torch.float32)


# --- Helper: Convert input image to Canny edges ---
def get_canny_image(image, size=(768, 768)):
    image = cv2.resize(image, size)
    canny = cv2.Canny(image, 100, 200)
    canny_rgb = cv2.cvtColor(canny, cv2.COLOR_GRAY2RGB)
    return Image.fromarray(canny_rgb), canny


# --- Helper: Decode base64 image safely ---
def decode_base64_image(base64_str):
    if base64_str.startswith("data:image"):
        base64_str = base64_str.split(",")[1]
    base64_str += "=" * (-len(base64_str) % 4)  # Fix padding
    image_bytes = base64.b64decode(base64_str)
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("cv2.imdecode returned None")
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    return img


# --- Helper: Classify room ---
def classify_room(canny_edges):
    edge_pixels = np.sum(canny_edges > 0)
    total_pixels = canny_edges.size
    edge_ratio = edge_pixels / total_pixels
    print(f"[DEBUG] Edge ratio: {edge_ratio:.4f}")

    if edge_ratio < 0.04:
        return "empty", 0.3, 576906284
    elif edge_ratio < 0.07:
        return "semi", 0.4, 576906284
    else:
        return "furnished", 0.5, 42


# --- Predictor class for Cog ---
class Predictor(BasePredictor):
    def predict(
        self,
        image: str = Input(description="Base64-encoded input image"),
        room_type: str = Input(default="living room"),
        design_style: str = Input(default="modern"),
        color_tone: str = Input(default="warm"),
    ) -> str:

        prompt = (
            f"A {design_style} {room_type} interior with {color_tone} tones, "
            f"soft ambient lighting, realistic textures, highly detailed, "
            f"photorealistic, 8k, designed by an interior architect"
        )
        negative_prompt = (
            "blurry, low quality, low resolution, deformed furniture, distorted layout, "
            "cartoon, floating objects, extra doors or windows, incorrect perspective, bad lighting"
        )

        try:
            print("[DEBUG] Decoding base64...")
            room_image = decode_base64_image(image)
            h, w = room_image.shape[:2]
            target_size = (768, 512) if w > h else (512, 768)
            print(f"[DEBUG] Image resized → {target_size}")
            canny_image, canny_edges = get_canny_image(room_image, target_size)

            _, controlnet_scale, seed = classify_room(canny_edges)

        except Exception as e:
            raise ValueError(f"Invalid image data: {e}")

        # --- Run generation ---
        global pipe
        try:
            print("[DEBUG] Starting generation (fp32)...")
            torch.cuda.empty_cache()
            result = pipe(
                prompt=prompt,
                image=canny_image.resize((512, 512)),  # fixed size
                num_inference_steps=20,
                guidance_scale=7.0,
                controlnet_conditioning_scale=controlnet_scale,
                negative_prompt=negative_prompt,
                generator=torch.manual_seed(seed),
            )
        except Exception as e:
            print(f"[ERROR] Generation failed: {traceback.format_exc()}")
            raise

        print("[DEBUG] Generation done.")

        output_image = result.images[0]
        buffered = io.BytesIO()
        output_image.save(buffered, format="PNG")
        img_str = base64.b64encode(buffered.getvalue()).decode("utf-8")

        return img_str
