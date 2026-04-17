"""
Livinai Interior AI - Modal deployment

Workspace: sara123meckawy
App:       livinai-interior

Replicates the RunPod handler.py behavior (SD 1.5 Dreamshaper + 2 ControlNets
[depth + seg] with DPT depth and UperNet segmentation) as a synchronous HTTP
endpoint hosted on Modal.

Deploy:
    modal deploy app.py

After deploy you will get a public URL like:
    https://sara123meckawy--livinai-interior-interiorai-generate.modal.run

Invoke:
    POST {url}
    Authorization: Bearer <MODAL_API_TOKEN>
    Content-Type: application/json
    body: {
      "image": "<base64 jpg/png>",
      "room_type": "living room",
      "design_style": "Scandinavian",
      "color_tone": "warm",
      "custom_prompt": "" // optional
    }

Response matches RunPod output:
    {
      "message": "...",
      "generatedImage": "<base64 png>",
      "prompt": "...",
      "negative_prompt": "...",
      "has_window": true/false
    }
"""

import base64
import io
import os

import modal

# fastapi is only present inside the container image; guard the import so
# this file can still be parsed locally (for `modal deploy` / `modal run`).
try:
    from fastapi import Header, HTTPException
except ImportError:  # pragma: no cover
    Header = None
    HTTPException = None

# ---------------------------------------------------------------------------
# MODAL APP + IMAGE
# ---------------------------------------------------------------------------

app = modal.App("livinai-interior")

CACHE_DIR = "/cache/huggingface"

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libgl1", "libglib2.0-0")
    .pip_install(
        "torch==2.4.1",
        "diffusers==0.30.3",
        "transformers==4.44.2",
        "accelerate==0.34.2",
        "opencv-python-headless==4.10.0.84",
        "Pillow==10.4.0",
        "numpy==1.26.4",
        "xformers==0.0.28.post1",
        "fastapi[standard]==0.115.0",
    )
    .env({"HF_HOME": CACHE_DIR, "TRANSFORMERS_CACHE": CACHE_DIR})
)

# Persistent HF cache volume - weights download once, reused across all containers
hf_cache_vol = modal.Volume.from_name("livinai-hf-cache", create_if_missing=True)

# Simple bearer-token auth secret (create via: modal secret create livinai-api-key API_KEY=...)
api_key_secret = modal.Secret.from_name(
    "livinai-api-key",
    required_keys=["API_KEY"],
)

# ---------------------------------------------------------------------------
# PROMPT TEMPLATES (copied verbatim from interiorAI/handler.py)
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

FALLBACK_PROMPT = (
    "{design_style} {room_type} space, realistic lighting, {color_tone} palette, "
    "professional design style, photorealistic 8k, high detail textures, natural shadows, "
    "includes layout-appropriate furniture or structural elements, cohesive arrangement matching the space type"
)

WINDOW_KEYWORDS = ["window", "windowpane"]


# ---------------------------------------------------------------------------
# INFERENCE CLASS
# ---------------------------------------------------------------------------

@app.cls(
    image=image,
    gpu="T4",  # 16 GB, cheapest suitable GPU (~$0.59/hr). Upgrade to "A10G" for ~2x speed.
    volumes={"/cache": hf_cache_vol},
    secrets=[api_key_secret],
    scaledown_window=60,        # keep container warm 60s after last request
    min_containers=0,           # set to 1 for zero-cold-start (adds cost)
    max_containers=3,           # concurrent scale-out
    timeout=600,                # 10 min per-request max
)
class InteriorAI:

    @modal.enter()
    def load_models(self):
        """Cold-start: load all models into GPU memory. Runs once per container."""
        import torch
        from diffusers import (
            StableDiffusionControlNetPipeline,
            ControlNetModel,
            UniPCMultistepScheduler,
        )
        from transformers import (
            DPTImageProcessor,
            DPTForDepthEstimation,
            AutoImageProcessor,
            UperNetForSemanticSegmentation,
        )

        self.torch = torch
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.dtype = torch.float16 if self.device == "cuda" else torch.float32

        self.dpt_processor = DPTImageProcessor.from_pretrained(
            "Intel/dpt-large", cache_dir=CACHE_DIR
        )
        self.dpt_model = DPTForDepthEstimation.from_pretrained(
            "Intel/dpt-large", torch_dtype=self.dtype, cache_dir=CACHE_DIR
        ).to(self.device)

        self.seg_processor = AutoImageProcessor.from_pretrained(
            "openmmlab/upernet-convnext-small", cache_dir=CACHE_DIR
        )
        self.seg_model = UperNetForSemanticSegmentation.from_pretrained(
            "openmmlab/upernet-convnext-small",
            torch_dtype=self.dtype,
            cache_dir=CACHE_DIR,
        ).to(self.device)

        depth_cn = ControlNetModel.from_pretrained(
            "lllyasviel/sd-controlnet-depth",
            torch_dtype=self.dtype,
            cache_dir=CACHE_DIR,
        )
        seg_cn = ControlNetModel.from_pretrained(
            "lllyasviel/control_v11p_sd15_seg",
            torch_dtype=self.dtype,
            cache_dir=CACHE_DIR,
        )

        self.pipe = StableDiffusionControlNetPipeline.from_pretrained(
            "Lykon/dreamshaper-8",
            controlnet=[depth_cn, seg_cn],
            torch_dtype=self.dtype,
            safety_checker=None,
            cache_dir=CACHE_DIR,
        ).to(self.device)

        self.pipe.scheduler = UniPCMultistepScheduler.from_config(
            self.pipe.scheduler.config
        )

        # Memory-efficient flags so pipeline fits in 16 GB with room to spare
        try:
            self.pipe.enable_xformers_memory_efficient_attention()
        except Exception:
            pass
        self.pipe.enable_vae_tiling()
        self.pipe.enable_attention_slicing()

        # Persist any newly downloaded weights to the volume for next cold start
        hf_cache_vol.commit()

    # --------------------- helper methods ---------------------

    def _decode_base64_image(self, base64_str):
        import cv2
        import numpy as np

        if not isinstance(base64_str, str):
            raise ValueError("Image must be a base64 string")
        if base64_str.startswith("data:image"):
            base64_str = base64_str.split(",")[1]
        base64_str += "=" * (-len(base64_str) % 4)
        img_bytes = base64.b64decode(base64_str)
        img = cv2.imdecode(np.frombuffer(img_bytes, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Invalid image provided")
        return img

    def _resize_orientation(self, img):
        h, w = img.shape[:2]
        return (1024, 768) if w > h else (768, 1024)

    def _get_depth_image(self, image_bgr, size_wh):
        import cv2
        import numpy as np
        from PIL import Image

        width, height = size_wh
        resized = cv2.resize(image_bgr, (width, height), interpolation=cv2.INTER_CUBIC)
        rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)

        inputs = self.dpt_processor(
            images=Image.fromarray(rgb), return_tensors="pt"
        ).to(self.device)
        inputs = {k: v.to(dtype=self.dtype) for k, v in inputs.items()}

        with self.torch.no_grad():
            depth = self.dpt_model(**inputs).predicted_depth

        depth_resized = (
            self.torch.nn.functional.interpolate(
                depth.unsqueeze(1),
                size=(height, width),
                mode="bicubic",
                align_corners=False,
            )
            .squeeze()
            .cpu()
            .numpy()
        )

        depth_norm = (
            (depth_resized - depth_resized.min())
            / (depth_resized.max() - depth_resized.min())
            * 255
        ).astype(np.uint8)

        return Image.fromarray(depth_norm).convert("RGB")

    def _get_segmentation_map(self, image_bgr):
        import cv2
        import numpy as np
        from PIL import Image

        width, height = self._resize_orientation(image_bgr)
        resized = cv2.resize(image_bgr, (width, height), interpolation=cv2.INTER_CUBIC)
        rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)

        inputs = self.seg_processor(
            images=Image.fromarray(rgb), return_tensors="pt"
        ).to(self.device)
        inputs = {k: v.to(dtype=self.dtype) for k, v in inputs.items()}

        with self.torch.no_grad():
            outputs = self.seg_model(**inputs)

        return outputs.logits.argmax(dim=1)[0].cpu().numpy().astype(np.uint8)

    def _get_segmentation_image(self, seg_map, size_wh):
        import cv2
        import numpy as np
        from PIL import Image

        w, h = size_wh
        seg_color = cv2.applyColorMap(
            (seg_map * 10).astype(np.uint8), cv2.COLORMAP_JET
        )
        seg_color = cv2.resize(seg_color, (w, h), interpolation=cv2.INTER_NEAREST)
        seg_rgb = cv2.cvtColor(seg_color, cv2.COLOR_BGR2RGB)
        return Image.fromarray(seg_rgb)

    def _detect_window(self, seg_map):
        import numpy as np

        labels = self.seg_model.config.id2label
        for class_id in np.unique(seg_map):
            name = labels.get(int(class_id), "").lower()
            if any(w in name for w in WINDOW_KEYWORDS):
                return True
        return False

    def _build_prompt(self, room_type, design_style, color_tone, custom_prompt):
        room_key = (room_type or "").strip().lower()

        if custom_prompt and isinstance(custom_prompt, str) and custom_prompt.strip():
            return custom_prompt.strip()

        if room_key in ROOM_PROMPTS:
            return ROOM_PROMPTS[room_key].format(
                design_style=design_style or "Stylish",
                color_tone=color_tone or "neutral",
            )
        if room_key in EXTERIOR_PROMPTS:
            return EXTERIOR_PROMPTS[room_key].format(
                design_style=design_style or "Stylish",
                color_tone=color_tone or "neutral",
            )
        return FALLBACK_PROMPT.format(
            design_style=design_style or "Stylish",
            room_type=room_type or "interior",
            color_tone=color_tone or "neutral",
        )

    # --------------------- core generation method ---------------------

    @modal.method()
    def run(
        self,
        image: str,
        room_type: str = "",
        design_style: str = "",
        color_tone: str = "",
        custom_prompt: str = "",
    ):
        """Pure-python callable version. Can be invoked from other Modal apps."""
        image_bgr = self._decode_base64_image(image)
        size_wh = self._resize_orientation(image_bgr)

        depth_img = self._get_depth_image(image_bgr, size_wh)
        seg_map = self._get_segmentation_map(image_bgr)
        seg_img = self._get_segmentation_image(seg_map, size_wh)
        has_window = self._detect_window(seg_map)

        prompt = self._build_prompt(room_type, design_style, color_tone, custom_prompt)
        if has_window:
            prompt = prompt + ", window in place"

        negative = (
            "blurry, lowres, distorted, floating furniture, bad lighting, wrong perspective"
        )
        if not has_window:
            negative += ", no window"

        result = self.pipe(
            prompt=prompt,
            image=[depth_img, seg_img],
            num_inference_steps=30,
            guidance_scale=7.5,
            controlnet_conditioning_scale=[0.5, 0.1],
            negative_prompt=negative,
            generator=self.torch.manual_seed(42),
        )
        out = result.images[0]

        buf = io.BytesIO()
        out.save(buf, format="PNG")
        generated_b64 = base64.b64encode(buf.getvalue()).decode()

        return {
            "message": "Image generated successfully",
            "generatedImage": generated_b64,
            "prompt": prompt,
            "negative_prompt": negative,
            "has_window": has_window,
        }

    # --------------------- public HTTP endpoint ---------------------

    @modal.fastapi_endpoint(method="POST", docs=True)
    def generate(
        self,
        payload: dict,
        authorization: str = Header(default="") if Header else "",
    ):
        """
        HTTP endpoint called by the Livinai backend.

        Headers:
          Authorization: Bearer <API_KEY>

        Body (same shape as current RunPod payload.input):
          { image, room_type, design_style, color_tone, custom_prompt? }
        """
        expected = os.environ.get("API_KEY")
        if expected:
            token = (authorization or "").removeprefix("Bearer ").strip()
            if token != expected:
                raise HTTPException(status_code=401, detail="Unauthorized")

        body = payload or {}
        image_b64 = body.get("image")
        if not image_b64:
            raise HTTPException(status_code=400, detail="Missing image")

        try:
            return self.run.local(
                image=image_b64,
                room_type=(body.get("room_type") or "").strip(),
                design_style=(body.get("design_style") or "").strip(),
                color_tone=(body.get("color_tone") or "").strip(),
                custom_prompt=body.get("custom_prompt") or "",
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# LOCAL ENTRYPOINT (for quick CLI testing: `modal run app.py`)
# ---------------------------------------------------------------------------
@app.local_entrypoint()
def main(image_path: str = "test.jpg", room_type: str = "living room"):
    """Run a smoke test from the CLI using a local image file."""
    from pathlib import Path

    data = Path(image_path).read_bytes()
    b64 = base64.b64encode(data).decode()

    ai = InteriorAI()
    result = ai.run.remote(
        image=b64,
        room_type=room_type,
        design_style="Scandinavian",
        color_tone="warm neutral",
    )
    out_path = Path("generated.png")
    out_path.write_bytes(base64.b64decode(result["generatedImage"]))
    print(f"Saved -> {out_path.resolve()}")
    print(f"Prompt: {result['prompt']}")
    print(f"Has window: {result['has_window']}")
