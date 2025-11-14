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
# 🟦 Pre-download all HuggingFace models for faster cold-start
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

# Copy application code
COPY --chown=user . .

# RunPod default start
CMD ["python", "handler.py"]
