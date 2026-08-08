# The all-in-one API image: Express plus the walkthrough exporter in one
# container. It is one of the two supported arrangements — the other runs the
# exporter on Modal (`modal/walkthrough_app.py`) and lets the API deploy to a
# plain Node host, which is cheaper because only this image needs the 2 GB of
# memory Open3D wants. See DEPLOYMENT.md. Leave MODAL_WALKTHROUGH_ENDPOINT_URL
# unset to use the Python installed below.
FROM node:20-bookworm-slim

# The walkthrough exporter is Python. Open3D's wheel links Filament, OpenMP and
# X11 at import time, and `backend/renderer/engine/interior_plan/archviz_materials.py`
# asks for `open3d.visualization.rendering` to build material records, which
# pulls the whole GUI shared object in — so a headless image still needs the X
# libraries below, not just libgl1/libgomp1.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      python3 \
      python3-pip \
      libgl1 \
      libegl1 \
      libglib2.0-0 \
      libgomp1 \
      libusb-1.0-0 \
      libx11-6 \
      libxext6 \
      libxrender1 \
      libxfixes3 \
      libxcursor1 \
      libxinerama1 \
      libxrandr2 \
      libxi6 \
      libxxf86vm1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY renderer/requirements.txt ./renderer/requirements.txt
# The import check is deliberately part of the build. Without it a missing
# wheel or system library only surfaces when someone opens the Explore step and
# gets a Python traceback in the app; with it, the deploy fails instead.
RUN pip3 install --break-system-packages --no-cache-dir -r renderer/requirements.txt \
    && python3 -c "import numpy, PIL, shapely, trimesh, open3d; from open3d.visualization import rendering; print('renderer python OK: numpy', numpy.__version__, '| open3d', open3d.__version__)"

COPY . .

ENV NODE_ENV=production
ENV WALKTHROUGH_PYTHON=python3
# Open3D has no GPU here; ask Filament for its software rasteriser rather than
# letting it probe for a device that does not exist.
ENV OPEN3D_CPU_RENDERING=true
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
EXPOSE 3000

CMD ["node", "src/index.js"]
