# Livinai Interior AI — Modal deployment

Serverless GPU inference for the SD 1.5 + dual-ControlNet interior design
pipeline, hosted on [Modal](https://modal.com).

- **Modal workspace**: `sara123meckawy`
- **App name**: `livinai-interior`
- **Entry file**: [`app.py`](./app.py)
- **Default GPU**: `T4` (16 GB, ~$0.59/hr flex, ~$0.40/hr active)
- **Cold start**: ~5 s after first warm (weights live on a persistent Modal Volume)

---

## Why we moved from RunPod

| | RunPod | Modal |
|---|---|---|
| Throttling | Frequent (GPU pool exhausted) | None (Modal owns capacity) |
| Active worker cost (16 GB) | $0.40/hr = **~$289/mo** | $0 if scale-to-zero, or $430/mo pinned |
| Cold start | 30–60 s | **2–5 s** (volume-cached weights) |
| Free credit | None | **$30/mo** |
| Billing unit | per second | per second |

At current traffic the expected bill is **~$0 – $15/mo** (fully inside the free tier for moderate use).

---

## One-time setup

### 1. Install the Modal CLI locally

```bash
pip install -r requirements.txt
modal setup
```

The `modal setup` command opens a browser to link your local machine to the
`sara123meckawy` Modal workspace.

### 2. Create the persistent volume (weights cache)

Already declared in `app.py` via `create_if_missing=True`, but you can
pre-create it explicitly:

```bash
modal volume create livinai-hf-cache
```

### 3. Create the API-key secret

Generate a long random string and store it as a Modal secret. The backend
will use this same string in its `Authorization: Bearer` header.

```bash
# PowerShell
$key = -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 48 | % {[char]$_})
modal secret create livinai-api-key API_KEY=$key
echo "Save this key: $key"
```

```bash
# macOS / Linux
KEY=$(openssl rand -hex 24)
modal secret create livinai-api-key API_KEY=$KEY
echo "Save this key: $KEY"
```

Copy the printed key into your **backend** `.env` as `MODAL_API_KEY=...`.

### 4. Deploy

```bash
modal deploy app.py
```

First deploy builds the image (~4–6 min, one-time).
Subsequent deploys are ~20 seconds.

At the end of deploy, Modal prints a URL that looks like:

```
https://sara123meckawy--livinai-interior-interiorai-generate.modal.run
```

Copy it into your backend `.env` as `MODAL_ENDPOINT_URL=...`.

---

## Smoke-test from the CLI

```bash
modal run app.py --image-path ./test.jpg --room-type "living room"
```

This uploads a local JPG, runs the pipeline on a T4, and saves
`generated.png` next to you. Use this to verify the deploy end-to-end
before wiring up the backend.

---

## Calling from the Livinai backend

Replace the RunPod block in
[`backend/src/routes/designRoutes.js`](../backend/src/routes/designRoutes.js)
with a single synchronous call:

```js
const modalResp = await axios.post(
  process.env.MODAL_ENDPOINT_URL,
  {
    image: imageBase64,
    room_type: roomType,
    design_style: designStyle,
    color_tone: colorTone,
    custom_prompt: customPrompt || "",
  },
  {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.MODAL_API_KEY}`,
    },
    timeout: 180_000, // 3 min — covers cold start + inference
  }
);

const generatedImageBase64 = modalResp.data.generatedImage;
```

Modal returns the image synchronously, so you can **delete the
`jobId`/polling loop entirely**.

Add to `backend/.env`:

```env
MODAL_ENDPOINT_URL=https://sara123meckawy--livinai-interior-interiorai-generate.modal.run
MODAL_API_KEY=<the key from step 3>
```

---

## Tuning cost vs latency

Edit the `@app.cls(...)` decorator in `app.py`:

| Goal | Setting |
|---|---|
| Cheapest (pay only when used) | `min_containers=0`, `gpu="T4"` |
| Zero cold-start | `min_containers=1` (~$430/mo pinned T4) |
| Faster generation (~2×) | `gpu="A10G"` (~$1.10/hr flex) |
| Higher concurrency | `max_containers=6` (or more) |
| Keep containers alive longer between requests | `scaledown_window=300` |

After any change:

```bash
modal deploy app.py
```

---

## Observability

- **Dashboard**: <https://modal.com/apps/sara123meckawy/main>
- **Logs**: `modal app logs livinai-interior`
- **Shell into a running container**: `modal shell app.py::InteriorAI`
- **Billing / usage**: <https://modal.com/settings/usage>

---

## File map

```
modal/
├── app.py            # Modal App definition + FastAPI endpoint
├── requirements.txt  # Local dev deps (modal CLI + fastapi)
├── .env.example      # Template for local env vars
├── .gitignore
└── README.md         # (this file)
```
