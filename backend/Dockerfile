FROM node:20-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      python3 \
      python3-pip \
      libgl1 \
      libglib2.0-0 \
      libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY renderer/requirements.txt ./renderer/requirements.txt
RUN pip3 install --break-system-packages --no-cache-dir -r renderer/requirements.txt

COPY . .

ENV NODE_ENV=production
ENV WALKTHROUGH_PYTHON=python3
EXPOSE 3000

CMD ["node", "src/index.js"]
