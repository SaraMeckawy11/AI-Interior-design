# Livinai — updating the deployed stack

This release changes the AI engine and makes the canonical Livinai_web
exporter authoritative for the 3D walkthrough. Its Python source and assets
are bundled inside this repository's backend.

| Piece | Where it runs | Must be redeployed? |
|---|---|---|
| SD 1.5 + ControlNet inference (primary) | RunPod (`interiorAI`) | **Yes** |
| Gen‑Klein (FLUX.2 [klein]) inference (fallback) | Modal | **Yes** |
| Livinai_web GLB exporter | Modal | **Yes** |
| Node API | Render (native Node runtime) | **Yes** |
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

### Where the walkthrough exporter runs

The exporter is Python, and Open3D links system libraries (`libgl1`, `libegl1`,
the X11 set) that a package manager has to install. Render's native Node runtime
gives you no root and no `apt`, so there are exactly two working arrangements.
`backend/src/lib/walkthroughRenderer.js` supports both and picks between them on
one environment variable:

| `MODAL_WALKTHROUGH_ENDPOINT_URL` | Render runtime | Where Python runs | Memory Render needs |
|---|---|---|---|
| **set** | Node (native) | Modal, per request | whatever the API alone needs |
| unset | Docker (`backend/Dockerfile`) | in the API container | **2 GB minimum** |

Everything else is identical. Either way the app calls
`POST /api/walkthrough/realtime/session`, gets metadata plus a relative
`modelUrl`, and loads the GLB from the same `/api/walkthrough` origin. There is
no renderer URL in the app, no `INTERIOR_PLAN_ROOT`, and no second checkout.

#### Option 1 — exporter on Modal (recommended)

The Node service stays on Render's native runtime and never touches Python.
Deploy the exporter first, because the API needs the URL it prints:

```bash
cd modal && modal deploy walkthrough_app.py
```

That publishes three endpoints built from `backend/renderer` — the same exporter
source and the same bundled assets, in an image that `apt-get`s what Open3D
needs:

```
POST https://<workspace>--livinai-walkthrough-build.modal.run
GET  https://<workspace>--livinai-walkthrough-model.modal.run?name=<id>.glb
GET  https://<workspace>--livinai-walkthrough-health.modal.run
```

Set **only the first** on the Render service; the other two are derived from it
by name, so there is no way to configure two of the three and wonder why:

```
MODAL_WALKTHROUGH_ENDPOINT_URL=https://sara123meckawy--livinai-walkthrough-build.modal.run
```

It reuses the existing `livinai-api-key` secret, so `MODAL_API_KEY` on Render is
already the right token.

Building and downloading are separate calls on purpose. A furnished multi-room
GLB runs to roughly 4–20 MB, and returning it inline would make the Render
instance hold the whole file in memory just to write it to disk. Instead the
session response carries metadata only, and the route that serves the model
streams it from Modal once and caches it on disk — so repeat views of the same
home never leave Render. Scenes are content-addressed, so a name that already
exists is by definition the right file and is never re-fetched.

Cost and latency: the exporter is a CPU function with 2 GB of memory and a
five-minute idle window. You pay for the seconds it runs rather than for a
permanently reserved instance — but the first request after an idle period waits
for a cold container. Someone adjusting finishes on the same home reuses the
warm one.

Smoke-test the image before pointing Render at it:

```bash
LIVINAI_API_KEY=<your api key> modal run walkthrough_app.py
```

#### Option 2 — everything in one Docker image

Leave `MODAL_WALKTHROUGH_ENDPOINT_URL` unset and deploy `backend/Dockerfile`
with the Render service's runtime set to **Docker**, Dockerfile path
`./backend/Dockerfile`, Docker context `./backend`. It installs Node, Python,
Open3D, Shapely and Trimesh, then runs the normal Express API, which spawns
`render_worker.py` as a child process.

Render fixes native-vs-Docker when a service is created and offers no switch
afterwards, so an existing Node service has to be recreated — or a new Docker
service made, the environment variables copied across, and
`EXPO_PUBLIC_SERVER_URI` repointed — to take this path.

**Memory.** Open3D plus a furnished multi-room scene does not fit comfortably in
512 MB. If builds succeed but requests die with no error and the instance
restarts, that is the OOM killer — this option needs at least 2 GB.

#### How a broken renderer announces itself

Whichever option you pick, a misconfiguration surfaces before a user finds it:

* Both images **fail to build** if the Python imports do not work — the
  Dockerfile and `modal/walkthrough_app.py` each run
  `import numpy, PIL, shapely, trimesh, open3d` as a build step.
* `GET /healthz` reports renderer readiness, and the same check is logged once
  at boot: `Walkthrough renderer ready on Modal (…).`,
  `Walkthrough renderer ready (python3).`, or `… UNAVAILABLE: …`.
* `POST /api/walkthrough/realtime/session` returns `503 RENDERER_UNAVAILABLE`
  immediately instead of starting doomed work, and the app shows a plain
  sentence with the technical detail behind a disclosure rather than printing a
  traceback at the user.

A failed readiness answer is re-checked after 30 seconds rather than cached for
the life of the process, so deploying the missing piece fixes the API without
also restarting it.

The tell for the misconfiguration that started all this — the Node runtime with
no `MODAL_WALKTHROUGH_ENDPOINT_URL` set — is still:

```
File "/opt/render/project/src/backend/renderer/render_worker.py", line 23, in <module>
ModuleNotFoundError: No module named 'numpy'
```

`/opt/render/project/src` is the native runtime's checkout path. Set the
variable, or move to Docker.

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

## 4. RunPod handlers — the primary engine

`POST /api/designs` calls **RunPod first and falls back to Modal**. The
`interiorAI/` handler on endpoint `9x2kmfa8z6483c` serves every design it can;
Modal only answers when RunPod errors, returns no image, or does not finish
within 60 seconds.

Both handlers share `prompt_engine.py`, so a design does not change meaning when
it crosses over — but it does change engine. RunPod is SD 1.5 + ControlNet,
Modal is FLUX.2 [klein], and they do not produce the same picture. Every
generation logs which one answered:

```
Design generated by runpod, imageLen=…
RunPod request failed, falling back to Modal: …
```

Rebuild the RunPod images after changing anything under `interiorAI/` or
`interio/`; each folder carries its own copy of `prompt_engine.py`, which the
Dockerfile picks up with the rest of the directory. The endpoint builds from the
`interiorAI` branch, so pushing to that branch is what triggers a rebuild.

Override the endpoint with `RUNPOD_ENDPOINT_ID` if you move it. With
`RUNPOD_API_KEY` unset the route skips RunPod and goes straight to Modal, which
is the quickest way to take the primary out of the path without a code change.

---

## Rollback

* **Modal**: `modal app rollback livinai-interior` — or just point
  `MODAL_ENDPOINT_URL` back at the legacy `...-interiorai-generate.modal.run`
  URL, which still runs the ControlNet path for every request.
* **Backend**: the new fields are additive; the previous build works against the
  new Modal app unchanged.
* **App**: the walkthrough is a new route. Removing the card in
  `app/(tabs)/create.jsx` hides it without touching anything else.
