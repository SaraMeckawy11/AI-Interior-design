# Livinai RunPod worker.
#
# Python 3.11 to match the Modal images. It is not optional any more: the FLUX.2
# [klein] text encoder is Qwen3, which needs transformers >= 4.57, and that has
# dropped Python 3.9.
FROM python:3.11-slim

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Create user
RUN useradd -m -u 1000 user
USER user
ENV PATH="/home/user/.local/bin:$PATH"
WORKDIR /app

# Saturates the network while pulling the ~16 GB FLUX.2 [klein] checkpoint.
ENV HF_HUB_ENABLE_HF_TRANSFER=1

# Install dependencies
COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir --upgrade -r requirements.txt

# --- Guided floor plans: SD 1.5 + depth/seg ControlNets ---
# Model ids are duplicated from inference_core.py on purpose: importing them here
# would put the source in front of these layers, and then editing a comment would
# throw away the downloads below.
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

# --- Photo redesigns: FLUX.2 [klein], the default engine ---
# Roughly 16 GB, so this decides how the endpoint is provisioned:
#
#   PREFETCH_FLUX=1 (default) — weights baked in. Big image, but a cold worker
#     starts generating immediately and needs nothing attached to it.
#   PREFETCH_FLUX=0 — build with a network volume attached to the endpoint
#     instead. The first cold worker downloads to /runpod-volume and every later
#     one reads it from there. Keeps the image small; costs one slow first
#     request per volume.
#
# `_cache_dir_for` in handler.py finds the weights under either arrangement, so
# this flag is the only thing to change. The backend's RunPod poll budget is 150s
# including queue time — a worker downloading 16 GB inside a request will miss it
# and the design will be served by Modal instead.
#
# Apache-2.0 and ungated, so no Hugging Face token is needed.
ARG PREFETCH_FLUX=1
RUN if [ "$PREFETCH_FLUX" = "1" ]; then python -c "\
from huggingface_hub import snapshot_download; \
snapshot_download( \
    'black-forest-labs/FLUX.2-klein-4B', \
    cache_dir='/home/user/.cache/huggingface', \
    max_workers=8, \
)"; else echo 'Skipping FLUX prefetch — attach a network volume to the endpoint.'; fi

# Copy code
COPY --chown=user . .

# Run handler (RunPod looks for this)
CMD ["python", "handler.py"]
