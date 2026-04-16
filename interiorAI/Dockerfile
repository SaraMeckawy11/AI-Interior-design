# Base image
FROM python:3.10-slim

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

# Install Python dependencies (pinned versions -- see requirements.txt)
COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir -r requirements.txt

# -------------------------------------------------------------------
#  Pre-download all HuggingFace models for faster cold-start
# -------------------------------------------------------------------
COPY --chown=user preload.py .
RUN python preload.py

# Copy application code
COPY --chown=user . .

# RunPod default start
CMD ["python", "handler.py"]
