# Livinai — updating the deployed stack

This release changes the AI engine and adds a new client-side feature. Nothing
breaks if you deploy only part of it, but the new engine will not be used until
step 1 and step 2 are both done.

| Piece | Where it runs | Must be redeployed? |
|---|---|---|
| Gen‑Klein (FLUX.2 [klein]) inference | Modal | **Yes** |
| Node API (`/api/designs`, `/api/designs/walkthrough`) | your Node host (Render/Railway/VPS) | **Yes** |
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

### 1a. Create the Hugging Face token secret (new, required)

`black-forest-labs/FLUX.2-klein-4B` is a gated repository. Accept the licence on
the model page with the same Hugging Face account, then:

```bash
modal secret create livinai-hf-token HF_TOKEN=hf_your_token_here
```

If this secret is missing the deploy will fail. The existing
`livinai-api-key` secret is unchanged.

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

### 1d. Expect a slow first request

The FLUX.2 [klein] checkpoint is roughly 16 GB and downloads once into the
`livinai-hf-cache` volume. The first call after deploy can take several minutes;
every call after that is a normal cold start. Warm it before a demo:

```bash
curl -X POST https://sara123meckawy--livinai-interior-generate.modal.run \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{"image":"<base64 jpeg>","room_type":"Living Room","design_style":"Japandi","color_tone":"Warm neutral"}'
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
* `POST /api/designs/walkthrough` is **new**: it stores a frame captured from
  the on-device 3D walkthrough. It uploads to Cloudinary and saves a `Design`,
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

No new environment variables.

---

## 3. Expo app

Nothing new to install — the 3D walkthrough uses `react-native-webview`,
`react-native-svg`, `expo-file-system`, `expo-media-library` and
`expo-sharing`, all already in `package.json`.

```bash
npx expo start --dev-client     # verify locally
eas build --platform android    # or ios
```

### One runtime dependency to know about

The walkthrough loads **three.js r159 from a CDN** inside the WebView
(`unpkg`, falling back to `jsdelivr`, then `cdnjs`). The scene itself — geometry,
furniture, materials, textures — is generated entirely on the device; only the
engine script is fetched. The screen shows a clear message if all three CDNs are
unreachable.

If you would rather not depend on a CDN, vendor `three.min.js` into
`assets/` and inline it in `lib/walkthroughScene.js` where `THREE_SOURCES` is
declared. That adds roughly 600 KB to the bundle.

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
