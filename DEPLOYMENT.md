# Livinai — updating the deployed stack

This release changes the AI engine and makes the canonical Livinai_web
exporter authoritative for the 3D walkthrough. Its Python source and assets
are bundled inside this repository's backend.

| Piece | Where it runs | Must be redeployed? |
|---|---|---|
| Gen‑Klein (FLUX.2 [klein]) inference | Modal | **Yes** |
| Node API + bundled Livinai_web GLB exporter | backend Docker image | **Yes** |
| Expo app (3D walkthrough, new UI) | EAS build / OTA update | **Yes** |
| RunPod handlers (`interiorAI/`, `interio/`) | RunPod | Only if you still use them |

---

## 1. Modal — deploy the new inference app

The Modal app now hosts **two** engines and a cheap router that picks between
them:

* `GenKlein` — `black-forest-labs/FLUX.2-klein-4B`, used for every interior and
  exterior photo redesign. Same model and same prompt architecture as the
  Livinai web studio.
* `InteriorAI` — SD 1.5 + depth/seg ControlNets, still used for **guided floor
  plans** (`mode: "guided"`), because that path depends on ControlNet
  conditioning that FLUX.2 [klein] does not have.

### 1a. Secrets

Only one, and it already exists:

```bash
modal secret create livinai-api-key API_KEY=<your api key>
```

No Hugging Face token is needed. `black-forest-labs/FLUX.2-klein-4B` is
Apache-2.0 and not gated.

### 1b. Deploy

```bash
cd modal && modal deploy app.py
```

This publishes three URLs:

```
POST  https://<workspace>--livinai-interior-generate.modal.run             <- new, preferred
GET   https://<workspace>--livinai-interior-health.modal.run               <- new
POST  https://<workspace>--livinai-interior-interiorai-generate.modal.run  <- legacy, still works
```

### 1c. Point the backend at the new router

The legacy class endpoint still works, but it wakes a GPU container just to
decide where to send the request. Switch `MODAL_ENDPOINT_URL` to the router:

```
MODAL_ENDPOINT_URL=https://sara123meckawy--livinai-interior-generate.modal.run
```

### 1d. Expect a slow first *build*, not a slow first request

The FLUX.2 [klein] checkpoint is roughly 16 GB. It is downloaded into the
`livinai-hf-cache` volume **during the image build**, so the first deploy takes
a while (10–20 minutes on a cold cache) and every request after that starts from
cached weights. Later deploys reuse the layer and finish in seconds.

Smoke-test end to end once it is up:

```bash
modal run app.py --image-path ./test.jpg --room-type "living room"
```

If Gen‑Klein is unavailable for any reason — gated-model access, an OOM, a cold
start failure — the router automatically falls back to the ControlNet pipeline
rather than returning an error, so the app keeps working while you fix it.

---

## 2. Node backend

Redeploy `backend/`. Changes:

* `POST /api/designs` now forwards `material`, `lighting`, `preserveGeometry`
  and `creativity` to Modal. Older app builds that omit them still work — the
  prompt engine applies the same defaults.
* `POST /api/designs/walkthrough` stores a frame captured from the live 3D
  walkthrough. It uploads to Cloudinary and saves a `Design`,
  and it consumes **no** design credits or coins, because no inference runs.
* The walkthrough's **"Render with AI"** button goes through the normal
  `POST /api/designs` route — it sends the live 3D frame with
  `preserveGeometry: true` and a very low `creativity`, so the model only
  resolves materials and lighting over the geometry the user built. That means
  it *does* consume a design credit, and the result is saved to the collection
  by that route, exactly like any other generation.
* `Design` now persists `imagePublicId` / `generatedImagePublicId`. These were
  always being set by the routes but were missing from the schema, so Mongoose
  silently dropped them and deletion fell back to parsing the URL — which is
  wrong for assets stored in a folder, meaning old images were never actually
  removed from Cloudinary. Existing documents keep the old behaviour; new ones
  delete cleanly.

Deploy `backend/Dockerfile` with the service's **root/build directory set to
`backend`**. It installs Node, Python, Open3D, Shapely and
Trimesh, then runs the normal Express API. The API launches
`backend/renderer/render_worker.py` directly and serves its content-addressed
GLB from the same `/api/walkthrough` origin. There is no renderer URL,
`INTERIOR_PLAN_ROOT`, second checkout, or sidecar service to configure.

---

## 3. Expo app

Nothing new to install — the 3D walkthrough uses `react-native-webview`,
`react-native-svg`, `expo-file-system`, `expo-media-library` and
`expo-sharing`, all already in `package.json`.

```bash
npx expo start --dev-client     # verify locally
eas build --platform android    # or ios
```

### Canonical walkthrough renderer

The Explore screen sends the measured polygons, openings, pixels-per-metre,
room configurations and finish settings to the exact Livinai_web exporter
snapshot under `backend/renderer`. It does not substitute the small legacy catalogue if that
request fails: the app shows a retryable error instead of presenting incorrect
geometry or furniture as an exact result.

For local development, create `backend/renderer/.venv`, install
`backend/renderer/requirements.txt`, and optionally set `WALKTHROUGH_PYTHON` to
that environment's Python executable. The Expo app uses only
`EXPO_PUBLIC_SERVER_URI`, exactly like the rest of the API.

### One runtime dependency to know about

The app bundles the same **three.js r185**, GLTFLoader and RoomEnvironment used
by Livinai_web in `lib/exactThreeRuntime.js`; the walkthrough has no CDN runtime
dependency. Geometry, furniture identity, dimensions, transforms, and mapped
materials come from the exporter-produced GLB. Run
`npm run build:exact-viewer` after intentionally changing the pinned Three.js
version.

---

## 4. RunPod handlers (optional)

`interiorAI/` and `interio/` are no longer in the request path — the backend
talks to Modal. They were updated to the shared prompt engine anyway so they do
not drift. If you still run them, rebuild the images; each folder now contains
its own copy of `prompt_engine.py`, which the Dockerfile picks up with the rest
of the directory.

---

## Rollback

* **Modal**: `modal app rollback livinai-interior` — or just point
  `MODAL_ENDPOINT_URL` back at the legacy `...-interiorai-generate.modal.run`
  URL, which still runs the ControlNet path for every request.
* **Backend**: the new fields are additive; the previous build works against the
  new Modal app unchanged.
* **App**: the walkthrough is a new route. Removing the card in
  `app/(tabs)/create.jsx` hides it without touching anything else.
