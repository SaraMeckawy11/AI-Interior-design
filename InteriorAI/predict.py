from cog import BasePredictor, Input
from diffusers import StableDiffusionControlNetPipeline, ControlNetModel, UniPCMultistepScheduler
from PIL import Image
import torch
import cv2
import numpy as np
import base64
import io

class Predictor(BasePredictor):
    def setup(self):
        # --- Device and dtype setup ---
        use_cuda = torch.cuda.is_available()
        self.dtype = torch.float16 if use_cuda else torch.float32
        self.device = "cuda" if use_cuda else "cpu"

        # --- Load ControlNet and Stable Diffusion Pipeline ---
        self.controlnet = ControlNetModel.from_pretrained(
            "lllyasviel/control_v11p_sd15_canny", torch_dtype=self.dtype
        )

        self.pipe = StableDiffusionControlNetPipeline.from_pretrained(
            "Lykon/dreamshaper-8",
            controlnet=self.controlnet,
            torch_dtype=self.dtype,
            safety_checker=None
        ).to(self.device)

        self.pipe.scheduler = UniPCMultistepScheduler.from_config(self.pipe.scheduler.config)

    # --- Helper: Convert input image to Canny edges ---
    def get_canny_image(self, image, size=(768, 768)):
        image = cv2.resize(image, size)
        canny = cv2.Canny(image, 100, 200)
        canny_rgb = cv2.cvtColor(canny, cv2.COLOR_GRAY2RGB)
        return Image.fromarray(canny_rgb)

    # --- Helper: Decode base64 image safely ---
    def decode_base64_image(self, base64_str):
        if base64_str.startswith("data:image"):
            base64_str = base64_str.split(",")[1]
        base64_str += "=" * (-len(base64_str) % 4)  # fix padding
        image_bytes = base64.b64decode(base64_str)
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Failed to decode base64 image")
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        return img

    def predict(
        self,
        image_base64: str = Input(description="Input image as base64 string"),
        room_type: str = Input(description="Type of room"),
        design_style: str = Input(description="Design style"),
        color_tone: str = Input(description="Color tone"),
        prompt: str = Input(description="Optional custom prompt", default=""),
    ) -> dict:
        try:
            # --- Decode input image ---
            img = self.decode_base64_image(image_base64)
            h, w = img.shape[:2]
            target_size = (768, 512) if w > h else (512, 768)
            canny_image = self.get_canny_image(img, target_size)

            # --- Build prompt if not provided ---
            if not prompt:
                prompt = (
                    f"A {design_style} {room_type} interior with {color_tone} tones, "
                    f"soft ambient lighting, realistic textures, highly detailed, photorealistic, 8k, "
                    f"designed by an interior architect"
                )

            negative_prompt = (
                "blurry, low quality, low resolution, deformed furniture, distorted layout, cartoon, floating objects, "
                "extra doors or windows, incorrect perspective, bad lighting"
            )

            # --- Run the pipeline ---
            result = self.pipe(
                prompt=prompt,
                image=canny_image,
                num_inference_steps=30,
                guidance_scale=7.5,
                controlnet_conditioning_scale=0.5,
                negative_prompt=negative_prompt,
                generator=torch.manual_seed(42),
            )

            output_image = result.images[0]

            # --- Convert output image to base64 ---
            buffered = io.BytesIO()
            output_image.save(buffered, format="PNG")
            img_str = base64.b64encode(buffered.getvalue()).decode("utf-8")

            # --- Return JSON-like dict (like Flask API) ---
            return {
                "message": "Image generated successfully",
                "generatedImage": img_str,
                "prompt": prompt,
                "room_type": room_type,
                "design_style": design_style,
                "color_tone": color_tone
            }

        except Exception as e:
            return {
                "message": "Something went wrong",
                "details": str(e)
            }
