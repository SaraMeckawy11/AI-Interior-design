# ── Base image: RunPod-official PyTorch 2.2.2 + CUDA 12.1 ─────────────────────
# Includes torch, torchvision, torchaudio, xformers, and a full CUDA dev stack.
# Switching from python:3.9-slim eliminates the multi-GB torch pip install that
# was inflating cold-start by slowing down the entire init sequence.
FROM runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel-ubuntu22.04

# System dependencies for OpenCV
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -u 1000 user
USER user
ENV PATH="/home/user/.local/bin:$PATH"
WORKDIR /app

# -------------------------------------------------------------------
# Install Python dependencies
# torch / torchvision / xformers are already in the base image;
# we install only the ML/serving stack on top.
# -------------------------------------------------------------------
COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# -------------------------------------------------------------------
# Pre-download ALL HuggingFace model weights into the image layer.
# Running during build means zero network I/O at container startup.
# -------------------------------------------------------------------
RUN python -c "\
from transformers import DPTImageProcessor, DPTForDepthEstimation, \
    AutoImageProcessor, UperNetForSemanticSegmentation; \
from diffusers import StableDiffusionControlNetPipeline, ControlNetModel; \
CACHE = '/home/user/.cache/huggingface'; \
\
DPTImageProcessor.from_pretrained('Intel/dpt-large', cache_dir=CACHE); \
DPTForDepthEstimation.from_pretrained('Intel/dpt-large', cache_dir=CACHE); \
\
AutoImageProcessor.from_pretrained('openmmlab/upernet-convnext-small', cache_dir=CACHE); \
UperNetForSemanticSegmentation.from_pretrained('openmmlab/upernet-convnext-small', cache_dir=CACHE); \
\
c1 = ControlNetModel.from_pretrained('lllyasviel/sd-controlnet-depth', cache_dir=CACHE); \
c2 = ControlNetModel.from_pretrained('lllyasviel/control_v11p_sd15_seg', cache_dir=CACHE); \
\
StableDiffusionControlNetPipeline.from_pretrained( \
    'Lykon/dreamshaper-8', \
    controlnet=[c1, c2], \
    safety_checker=None, \
    cache_dir=CACHE, \
); \
print('All models pre-downloaded.')"

# -------------------------------------------------------------------
# Lock HuggingFace into fully offline mode AFTER the download step.
# This eliminates every HTTP round-trip during container startup
# (version checks, metadata fetches) which previously added 30-60 s
# across 5 model calls.
# -------------------------------------------------------------------
ENV HF_HUB_OFFLINE=1
ENV TRANSFORMERS_OFFLINE=1
ENV HF_DATASETS_OFFLINE=1

# Copy application code (last layer — changes here don't bust model cache)
COPY --chown=user . .

CMD ["python", "handler.py"]
