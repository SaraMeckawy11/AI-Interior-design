# Livinai — updating the deployed stack

This release changes the AI engine and makes the canonical Livinai_web
exporter authoritative for the 3D walkthrough. Its Python source and assets
are bundled inside this repository's backend.

| Piece | Where it runs | Must be redeployed? |
|---|---|---|
| Gen‑Klein + ControlNet inference (primary) | RunPod (`interiorAI`) | **Yes** |
| Gen‑Klein + ControlNet inference (fallback) | Modal | **Yes** |
| Livinai_web GLB exporter | Modal | **Yes** |
| Node API | Render (native Node runtime) | **Yes** |
| Expo app (3D walkthrough, new UI) | EAS build / OTA update | **Yes** |
| Legacy canny handler (`interio/`) | RunPod | Only if you still use it |

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

Every one of these runs on a CPU container. The two `generate` endpoints route;
they never hold a GPU while an engine works.

### 1c. Point the backend at the new router

Both URLs now route from a cheap CPU container and cost exactly one GPU call, so
this is tidiness rather than a fix. It was not always so: the legacy endpoint
used to be a method on the `InteriorAI` GPU class, which meant every request
woke a GPU container to run the router, and the router then started a *second*
GPU container for the engine it chose — two cold starts and two GPU bills per
design, showing up in the Modal dashboard as an `InteriorAI` call followed by a
`GenKlein` call. It is now a module-level function that Modal publishes at the
same address.

Prefer the router URL anyway, since its name says what it does:

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

The router makes **one** engine call per request: guided plans to `InteriorAI`,
everything else to `GenKlein`. It used to retry the other engine when the first
failed, which meant a single request starting two GPU containers — two cold
starts, two GPU bills — to answer with an engine the prompt was not written for.
A failure here is reported to the backend instead, and the backend falls back to
RunPod (§4).

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

#### What a session actually costs

Almost always, nothing. `/realtime/session` looks the request up in the
`walkthroughscenes` collection first, keyed by a hash of the geometry and the
design (`backend/src/lib/walkthroughSceneCache.js`). A hit answers from Mongo and
never wakes Modal — no container, no build, no poll loop — so reopening a plan,
stepping back to Style and forward again, or two people drawing the same flat all
cost one indexed lookup. Only a genuinely new combination of rooms, openings and
finishes reaches the exporter.

The GLB is cached separately and for the same reason: model names are
content-addressed, `/realtime/model/:filename` keeps them on the instance's disk,
and the response is `immutable` for a week so the WebView asks once.

Two things invalidate a remembered scene:

* `LIVINAI_WEB_RENDERER_REVISION` in `lib/exactWalkthroughScene.js` — bump it when
  the exporter's output changes. It is part of the key, so the app and the server
  invalidate together.
* `WALKTHROUGH_SCENE_CACHE_VERSION` (optional, Render runtime) — bump it to drop
  every remembered scene without shipping an app release.

Rows expire 90 days after they were last opened. If a GLB is evicted from the
Modal volume before then, the model route answers 404 *and* deletes the rows
pointing at it, so the app's "Try again" rebuilds rather than retrying a dead URL.

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

## 4. RunPod — the primary host

`POST /api/designs` calls **RunPod first and falls back to Modal**. The
`interiorAI/` handler on endpoint `9x2kmfa8z6483c` serves every design it can;
Modal only answers when RunPod errors, returns no image, or does not finish
inside the poll budget below.

**Both hosts now run the same two engines**, routed by the same rule: FLUX.2
[klein] for photo redesigns, SD 1.5 + depth/seg ControlNets for guided floor
plans. `interiorAI/inference_core.py` is a port of the two engine classes in
`modal/app.py` — same prompts, steps, guidance, ControlNet scales, seeds,
finishing pass and response keys. Falling back therefore changes who bills the
GPU and nothing the user sees.

Until this release RunPod was SD 1.5 for *every* request, and because it answers
first, that is what nearly every design actually came back as — the FLUX.2
[klein] path the prompts were written for only ran when RunPod happened to fail.
The shared `prompt_engine.py` meant a brief did not change *meaning* across the
two, but it was still a different model.

Every generation logs the host, the engine and the model:

```
Design generated by runpod: engine=gen-klein model=black-forest-labs/FLUX.2-klein-4B imageLen=…
RunPod request failed, falling back to Modal: …
```

### 4a. What the endpoint now needs

Two things the SD 1.5-only worker did not:

* **A 48 GB GPU class.** Gen-Klein runs the 4B transformer plus its Qwen3 text
  encoder in bf16 with no CPU offload — the same arrangement `GenKlein` uses on
  Modal's L40S. Set the endpoint's GPU accordingly (L40S / A6000 / A100 80 GB);
  a 24 GB worker will OOM on the first photo redesign.
* **Somewhere for ~16 GB of FLUX weights.** `interiorAI/Dockerfile` bakes them
  into the image by default, which makes the image large but a cold worker
  instant. The alternative is a **network volume** on the endpoint plus
  `--build-arg PREFETCH_FLUX=0`: the first cold worker downloads to
  `/runpod-volume` and every later one reads it from there.
  `_cache_dir_for` in `handler.py` finds the weights under either arrangement, so
  the build flag is the only thing to change. Do not run with neither — a worker
  downloading 16 GB inside a request will blow the poll budget below and every
  design will quietly be served by Modal.

The worker keeps at most one engine on the GPU and evicts the other when a
request needs it, since they do not fit together on one card. A guided plan
arriving at a worker warm with Gen-Klein therefore pays a reload; workers serving
one kind of request, which is nearly all of them, load once.

One dependency note: Modal builds each engine its own image and pins the guided
path to torch 2.4 / diffusers 0.30. A RunPod worker gets one environment, so
`interiorAI/requirements.txt` runs both engines on the newer set FLUX.2 [klein]
requires (diffusers ≥ 0.37, transformers ≥ 4.57, torch ≥ 2.6), where the SD 1.5
ControlNet pipelines are still supported.

**The poll budget is 150 seconds, and it covers queue time, not just
inference.** The endpoint scales from zero with a 5-second idle timeout, so a
design arriving cold waits for a worker before anything runs: a measured job
spent 59.8s queued and 12.9s generating. An earlier 60-second budget abandoned
work like that one second before it finished and handed the request to Modal,
which makes "RunPod first" a formality — the fallback fires on almost every cold
request while the RunPod worker carries on generating an image nobody collects.
If you change the endpoint's scaling, re-check `RUNPOD_MAX_POLLS` against it.

Re-measure it after this release: a cold worker now loads FLUX.2 [klein] rather
than SD 1.5, and if the weights are on a network volume rather than baked into
the image, the very first worker per volume also downloads them. Watch the
`falling back to Modal` line — if it fires on every cold request, the budget or
the provisioning is wrong, not the model.

Rebuild the RunPod images after changing anything under `interiorAI/` or
`interio/`; each folder carries its own copy of `prompt_engine.py`, and
`interiorAI/` also carries `inference_core.py`, which the Dockerfile picks up
with the rest of the directory. The endpoint builds from the `interiorAI` branch,
so pushing to that branch is what triggers a rebuild.

`modal/app.py` is the original of both engines. When you change generation there
— prompts, steps, guidance, ControlNet scales, seeds — port the change into
`interiorAI/inference_core.py` and redeploy both, or the two hosts start
answering the same route with different pictures again, which is the failure this
release fixed.

Override the endpoint with `RUNPOD_ENDPOINT_ID` if you move it — it is read once
at module load, so it needs a restart, not just an env change. With
`RUNPOD_API_KEY` unset the route skips RunPod without making a request and every
design goes to Modal, which is the quickest way to take the primary out of the
path when the endpoint is misbehaving.

---

## Rollback

* **Modal**: `modal app rollback livinai-interior`. Switching `MODAL_ENDPOINT_URL`
  between the two `generate` URLs is no longer a rollback — both route the same
  way now. To force every design onto the ControlNet path, send `mode: "guided"`
  with room polygons, or roll the app back.
* **Backend**: the new fields are additive; the previous build works against the
  new Modal app unchanged.
* **App**: the walkthrough is a new route. Removing the card in
  `app/(tabs)/create.jsx` hides it without touching anything else.
