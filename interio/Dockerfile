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
RUN python -c "from diffusers import StableDiffusionControlNetPipeline, ControlNetModel; \
    controlnet = ControlNetModel.from_pretrained('lllyasviel/control_v11p_sd15_canny', cache_dir='/home/user/.cache/huggingface'); \
    StableDiffusionControlNetPipeline.from_pretrained('Lykon/dreamshaper-8', controlnet=controlnet, cache_dir='/home/user/.cache/huggingface')"

# Copy code
COPY --chown=user . .

# Run handler (RunPod looks for this)
CMD ["python", "handler.py"]
