# Base image — identical to the working interio project.
# python:3.9-slim gives a clean, consistent base; we install torch ourselves
# with an explicit CUDA wheel so there are zero version conflicts.
FROM python:3.9-slim

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
# torch is pinned to 2.1.2+cu121 (same wheel the working interio
# project uses) to guarantee a consistent environment.
# -------------------------------------------------------------------
COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir --upgrade -r requirements.txt

# -------------------------------------------------------------------
# Pre-download ALL HuggingFace model weights into the image layer.
# Zero network I/O at container startup.
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
# Eliminates every HTTP round-trip on container startup (version
# checks, metadata fetches) — previously added 30-60 s across 5 calls.
# -------------------------------------------------------------------
ENV HF_HUB_OFFLINE=1
ENV TRANSFORMERS_OFFLINE=1
ENV HF_DATASETS_OFFLINE=1

# -------------------------------------------------------------------
# Pin runpod to 1.6.2 as a trailing layer so the heavy pip+preload
# layers above stay as cache hits on rebuilds.
# runpod >=1.7 calls asyncio.Event() in JobScaler.__init__ which
# crashes on Python 3.9: "no current event loop in thread MainThread"
# -------------------------------------------------------------------
RUN pip install --no-cache-dir --force-reinstall --no-deps runpod==1.6.2

# Copy application code (last — changes here don't bust model cache)
COPY --chown=user . .

CMD ["python", "handler.py"]
