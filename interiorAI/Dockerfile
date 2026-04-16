# Base image
FROM python:3.9-slim

# System dependencies
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Create user
RUN useradd -m -u 1000 user
USER user
ENV PATH="/home/user/.local/bin:$PATH"
WORKDIR /app

# Install Python dependencies
COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir --upgrade -r requirements.txt

# -------------------------------------------------------------------
#  Pre-download all HuggingFace models for faster cold-start
# -------------------------------------------------------------------
RUN python -c "\
from transformers import DPTImageProcessor, DPTForDepthEstimation, AutoImageProcessor; \
from diffusers import StableDiffusionControlNetPipeline, ControlNetModel; \
\
# Depth model \
DPTImageProcessor.from_pretrained('Intel/dpt-large', cache_dir='/home/user/.cache/huggingface'); \
DPTForDepthEstimation.from_pretrained('Intel/dpt-large', cache_dir='/home/user/.cache/huggingface'); \
\
# Segmentation model \
AutoImageProcessor.from_pretrained('openmmlab/upernet-convnext-small', cache_dir='/home/user/.cache/huggingface'); \
from transformers import UperNetForSemanticSegmentation; \
UperNetForSemanticSegmentation.from_pretrained('openmmlab/upernet-convnext-small', cache_dir='/home/user/.cache/huggingface'); \
\
# ControlNet models \
c1 = ControlNetModel.from_pretrained('lllyasviel/sd-controlnet-depth', cache_dir='/home/user/.cache/huggingface'); \
c2 = ControlNetModel.from_pretrained('lllyasviel/control_v11p_sd15_seg', cache_dir='/home/user/.cache/huggingface'); \
\
# Stable diffusion model using both ControlNets \
StableDiffusionControlNetPipeline.from_pretrained( \
    'Lykon/dreamshaper-8', \
    controlnet=[c1, c2], \
    cache_dir='/home/user/.cache/huggingface' \
); \
"

# -------------------------------------------------------------------
#  Pin runpod to 1.6.2 — runpod >=1.7 calls asyncio.Event() in
#  JobScaler.__init__, which fails on Python 3.9 with
#  "RuntimeError: There is no current event loop in thread 'MainThread'".
#  Done as a separate trailing layer so the giant pip + preload
#  layers above stay cache-hits in RunPod's registry.
# -------------------------------------------------------------------
RUN pip install --no-cache-dir --force-reinstall --no-deps runpod==1.6.2

# Copy application code
COPY --chown=user . .

# RunPod default start
CMD ["python", "handler.py"]
