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
#  NOTE: previous `python -c` here was broken (Dockerfile line
#  continuations removed the newlines, so the `# Depth model` etc.
#  comments silently commented out every `.from_pretrained` call
#  below them). Using an actual Python file to guarantee execution.
# -------------------------------------------------------------------
COPY --chown=user preload.py .
RUN python preload.py

# Copy application code
COPY --chown=user . .

# RunPod default start
CMD ["python", "handler.py"]
