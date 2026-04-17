# Base image
FROM python:3.9-slim

# System deps
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Create user
RUN useradd -m -u 1000 user
USER user
ENV PATH="/home/user/.local/bin:$PATH"
WORKDIR /app

# Install dependencies
COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir --upgrade -r requirements.txt

# --- Pre-download Hugging Face models to cache ---
RUN python -c "\
from transformers import DPTImageProcessor, DPTForDepthEstimation, \
    AutoImageProcessor, UperNetForSemanticSegmentation; \
from diffusers import StableDiffusionControlNetPipeline, ControlNetModel; \
CACHE = '/home/user/.cache/huggingface'; \
DPTImageProcessor.from_pretrained('Intel/dpt-large', cache_dir=CACHE); \
DPTForDepthEstimation.from_pretrained('Intel/dpt-large', cache_dir=CACHE); \
AutoImageProcessor.from_pretrained('openmmlab/upernet-convnext-small', cache_dir=CACHE); \
UperNetForSemanticSegmentation.from_pretrained('openmmlab/upernet-convnext-small', cache_dir=CACHE); \
c1 = ControlNetModel.from_pretrained('lllyasviel/sd-controlnet-depth', cache_dir=CACHE); \
c2 = ControlNetModel.from_pretrained('lllyasviel/control_v11p_sd15_seg', cache_dir=CACHE); \
StableDiffusionControlNetPipeline.from_pretrained( \
    'Lykon/dreamshaper-8', \
    controlnet=[c1, c2], \
    safety_checker=None, \
    cache_dir=CACHE, \
)"

# Copy code
COPY --chown=user . .

# Run handler (RunPod looks for this)
CMD ["python", "handler.py"]
