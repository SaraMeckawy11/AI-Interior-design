import { spawn } from "node:child_process";
import { createWriteStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const rendererRoot = path.resolve(here, "../../renderer");
const workerPath = path.join(rendererRoot, "render_worker.py");
const generatedRoot = path.join(rendererRoot, "generated");
const MODEL_NAME = /^[a-f0-9]{24}\.glb$/i;
const RENDER_TIMEOUT_MS = 240_000;
const PROBE_TIMEOUT_MS = 60_000;
// A remote build can be waiting on a cold container as well as on the export
// itself, so it gets more room than the local spawn.
const REMOTE_RENDER_TIMEOUT_MS = 300_000;
const REMOTE_MODEL_TIMEOUT_MS = 120_000;
// Each individual submit/poll request is short; REMOTE_RENDER_TIMEOUT_MS bounds
// the wait overall.
const REMOTE_REQUEST_TIMEOUT_MS = 60_000;
const REMOTE_POLL_INTERVAL_MS = 3_000;
// How long a failed readiness answer is trusted before it is worth asking
// again. Long enough that a broken deploy is not re-probed once per request,
// short enough that a Modal deploy fixing it takes effect without a restart.
const READINESS_RETRY_MS = 30_000;

/** Every third-party module the exporter imports before it can do any work. */
const REQUIRED_MODULES = ["numpy", "PIL", "shapely", "trimesh", "open3d"];

const pythonExecutable = () => process.env.WALKTHROUGH_PYTHON
  || (process.platform === "win32" ? "python" : "python3");

/**
 * Where the exporter runs.
 *
 * Set MODAL_WALKTHROUGH_ENDPOINT_URL and the Python lives on Modal, which is
 * what lets the Render service stay on the native Node runtime — it has no way
 * to install the system libraries Open3D links against. Leave it unset and the
 * exporter is spawned from this machine, which is how local development and
 * backend/Dockerfile still work.
 */
const remoteEndpoint = () => (process.env.MODAL_WALKTHROUGH_ENDPOINT_URL || "").trim().replace(/\/$/, "");

/** Set these only if the derivation below cannot work — see `siblingEndpoint`. */
const SIBLING_OVERRIDE = {
  result: "MODAL_WALKTHROUGH_RESULT_URL",
  model: "MODAL_WALKTHROUGH_MODEL_URL",
  health: "MODAL_WALKTHROUGH_HEALTH_URL",
};

/**
 * Modal names an app's endpoints after its functions, so the sibling URLs are
 * normally derived rather than configured. One variable to set is one variable
 * to get wrong, and a half-configured trio is a worse failure than none.
 *
 * The explicit overrides exist because the derivation assumes Modal's hostname
 * shape, which is true of a deployment and not of a stub you point this at to
 * test.
 */
const siblingEndpoint = (name) => {
  const override = (process.env[SIBLING_OVERRIDE[name]] || "").trim().replace(/\/$/, "");
  if (override) return override;

  const url = remoteEndpoint();
  if (!url) return "";
  const sibling = url.replace(/-build(\.modal\.run)$/i, `-${name}$1`);
  return sibling === url ? "" : sibling;
};

const ENVIRONMENT_HINT =
  "The walkthrough renderer's Python environment is not installed on this server. "
  + "Deploy backend/Dockerfile (which installs backend/renderer/requirements.txt), "
  + "or install those requirements locally and point WALKTHROUGH_PYTHON at that interpreter.";

const REMOTE_HINT =
  "MODAL_WALKTHROUGH_ENDPOINT_URL must be the POST build endpoint of the "
  + "livinai-walkthrough Modal app, e.g. "
  + "https://<workspace>--livinai-walkthrough-build.modal.run — the model and "
  + "health endpoints are derived from it. Deploy it with "
  + "`cd modal && modal deploy walkthrough_app.py`.";

/**
 * Turn a Python failure into one sentence a person can act on.
 *
 * The worker's own `main()` only catches errors raised *inside* `build()`. A
 * missing dependency fails at import time, so nothing is caught, nothing is
 * written to the response file, and the raw traceback is all we have. This used
 * to be forwarded verbatim, which is how a `ModuleNotFoundError` ended up
 * rendered as body copy in the app's Explore step. The traceback is still worth
 * keeping — it goes to the server log, not to the phone.
 */
export function describeRendererFailure(stderr = "") {
  const text = String(stderr);
  const missing = text.match(/ModuleNotFoundError: No module named ['"]([^'"]+)['"]/);
  if (missing) return `${ENVIRONMENT_HINT} (missing: ${missing[1]})`;

  // Open3D imports cleanly and then dies looking for libGL/libEGL when the base
  // image is missing them. That is an environment problem too, not a bad plan.
  if (/ImportError:.*lib(GL|EGL|gomp|X11)[^\s]*/.test(text)) {
    return `${ENVIRONMENT_HINT} (a system library Open3D needs is missing)`;
  }
  if (/MemoryError|Killed|Cannot allocate memory/.test(text)) {
    return "The server ran out of memory while building this home. Try fewer or smaller rooms.";
  }

  const lastLine = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .pop();
  // A traceback's final line is the exception itself; anything longer than a
  // sentence is diagnostics, and diagnostics do not belong in the UI.
  if (lastLine && lastLine.length <= 200 && !lastLine.startsWith("File ")) return lastLine;
  return "The exact walkthrough could not be generated.";
}

// ───────────────────────────────────────────────────────────────────────────
// Readiness
// ───────────────────────────────────────────────────────────────────────────

/**
 * Ask whichever exporter is configured whether it can actually do any work.
 *
 * A success is cached for the life of the process: a healthy environment does
 * not lose modules, and a healthy Modal app does not need re-probing per
 * request. A failure is cached only briefly, so that deploying the missing
 * piece fixes the API without also restarting it.
 */
let readinessPromise = null;
let readinessFailedAt = 0;

export function rendererReadiness({ refresh = false } = {}) {
  const expired = readinessFailedAt && Date.now() - readinessFailedAt > READINESS_RETRY_MS;
  if (refresh || expired || !readinessPromise) {
    readinessFailedAt = 0;
    readinessPromise = probeRenderer().then((state) => {
      if (!state.ready) readinessFailedAt = Date.now();
      return state;
    });
  }
  return readinessPromise;
}

function probeRenderer() {
  return remoteEndpoint() ? probeRemoteRenderer() : probeLocalRenderer();
}

async function probeRemoteRenderer() {
  const healthUrl = siblingEndpoint("health");
  if (!healthUrl) return { ready: false, reason: REMOTE_HINT };

  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ready: false,
        reason: `The walkthrough renderer on Modal answered HTTP ${response.status}. ${REMOTE_HINT}`,
      };
    }
    // The image builds only if the imports work, so an unhealthy answer here
    // means something changed under a deployed app rather than a bad deploy.
    if (!body.ok) {
      return { ready: false, reason: body.error || "The walkthrough renderer on Modal is not healthy." };
    }
    return { ready: true, runtime: "modal", endpoint: healthUrl, open3d: body.open3d, source: body.source };
  } catch (error) {
    const timedOut = error.name === "TimeoutError" || error.name === "AbortError";
    return {
      ready: false,
      reason: timedOut
        ? "The walkthrough renderer on Modal did not answer in time."
        : `The walkthrough renderer on Modal could not be reached (${error.message}). ${REMOTE_HINT}`,
    };
  }
}

function probeLocalRenderer() {
  // Import for real rather than checking that a spec exists. Open3D's spec is
  // present the moment the wheel is unpacked, but the import still fails if the
  // image is missing libGL — which is exactly the case worth catching.
  const script = `import importlib,sys\n`
    + `missing=[]\n`
    + `for m in ${JSON.stringify(REQUIRED_MODULES)}:\n`
    + `    try: importlib.import_module(m)\n`
    + `    except Exception: missing.append(m)\n`
    + `sys.stdout.write(",".join(missing))`;

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let child;
    try {
      child = spawn(pythonExecutable(), ["-c", script], { windowsHide: true });
    } catch {
      resolve({ ready: false, reason: ENVIRONMENT_HINT });
      return;
    }
    const timeout = setTimeout(() => {
      child.kill();
      resolve({ ready: false, reason: "The renderer's Python interpreter did not respond." });
    }, PROBE_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", () => {
      clearTimeout(timeout);
      resolve({
        ready: false,
        reason: `${pythonExecutable()} is not on this server's PATH. ${ENVIRONMENT_HINT}`,
      });
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      const missing = stdout.trim() ? stdout.trim().split(",") : [];
      if (code !== 0) {
        resolve({ ready: false, reason: describeRendererFailure(stderr), missing });
        return;
      }
      if (missing.length) {
        resolve({ ready: false, missing, reason: `${ENVIRONMENT_HINT} (missing: ${missing.join(", ")})` });
        return;
      }
      resolve({ ready: true, runtime: "local", python: pythonExecutable() });
    });
  });
}

/** Log the renderer's state once at boot so a broken deploy is obvious. */
export async function reportRendererReadiness() {
  const state = await rendererReadiness();
  if (state.ready) {
    console.log(
      state.runtime === "modal"
        ? `Walkthrough renderer ready on Modal (${state.endpoint}).`
        : `Walkthrough renderer ready (${state.python}).`,
    );
  } else console.error(`Walkthrough renderer UNAVAILABLE: ${state.reason}`);
  return state;
}

// ───────────────────────────────────────────────────────────────────────────
// Building
// ───────────────────────────────────────────────────────────────────────────

/** Run the repository-owned Livinai_web exporter, here or on Modal. */
export async function buildWalkthroughModel(payload) {
  const response = remoteEndpoint()
    ? await buildOnModal(payload)
    : await buildLocally(payload);

  if (!MODEL_NAME.test(response.modelName || "")) {
    throw new Error("The bundled renderer returned an invalid model name.");
  }
  return response;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One authenticated JSON call to the exporter, with a readable failure. */
async function modalJson(url, init = {}) {
  let response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${process.env.MODAL_API_KEY}`,
      },
      signal: AbortSignal.timeout(REMOTE_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      throw new Error("The exact walkthrough renderer timed out.");
    }
    console.error("[walkthrough renderer] Modal request failed:", error.message);
    throw new Error("Livinai could not reach the 3D rendering service.");
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(`[walkthrough renderer] Modal answered HTTP ${response.status}:`, body.detail || body.error || "");
    if (response.status === 401) throw new Error("The 3D rendering service rejected this server's credentials.");
    throw new Error("The exact walkthrough could not be generated.");
  }
  return body;
}

/**
 * Ask Modal to export the scene, then wait for it.
 *
 * Submitting and polling rather than one blocking call, because Modal answers
 * any web request still running after 150 seconds with a redirect to a result
 * URL — and a furnished multi-room home takes longer than that to export, so
 * that would be the normal case, not the exception.
 *
 * Only the metadata comes back here. The GLB itself runs to tens of megabytes,
 * and pulling it through this response would mean holding the whole file in
 * memory on an instance that has better uses for it — so it is fetched lazily,
 * once, by the route that serves it.
 */
async function buildOnModal(payload) {
  const resultUrl = siblingEndpoint("result");
  if (!resultUrl) throw new Error(REMOTE_HINT);

  const submitted = await modalJson(remoteEndpoint(), {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!submitted.callId) throw new Error("The 3D rendering service did not accept this home.");

  const deadline = Date.now() + REMOTE_RENDER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(REMOTE_POLL_INTERVAL_MS);

    const body = await modalJson(`${resultUrl}?callId=${encodeURIComponent(submitted.callId)}`);
    if (body.status !== "completed") continue;

    if (!body.success) {
      // The worker already reduced the failure to a sentence; the traceback
      // stayed in Modal's logs.
      throw new Error(body.error || "The exact walkthrough could not be generated.");
    }
    // Same shape the local worker writes to its response file, minus geometry.
    const { status, ...rest } = body;
    return rest;
  }

  throw new Error("The exact walkthrough renderer timed out.");
}

/** Run the exporter in an isolated process on this machine. */
async function buildLocally(payload) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "livinai-walkthrough-"));
  const requestPath = path.join(temporaryRoot, "request.json");
  const responsePath = path.join(temporaryRoot, "response.json");
  await fs.writeFile(requestPath, JSON.stringify(payload), "utf8");

  let stderr = "";
  try {
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn(pythonExecutable(), [workerPath, requestPath, responsePath], {
        cwd: rendererRoot,
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
      });
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error("The exact walkthrough renderer timed out."));
      }, RENDER_TIMEOUT_MS);
      child.stderr.on("data", (chunk) => {
        stderr = `${stderr}${chunk}`.slice(-8_000);
      });
      child.once("error", (error) => {
        clearTimeout(timeout);
        error.pythonMissing = error.code === "ENOENT";
        reject(error);
      });
      child.once("close", (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
    });

    let response;
    try {
      response = JSON.parse(await fs.readFile(responsePath, "utf8"));
    } catch (error) {
      if (exitCode !== 0) {
        if (stderr.trim()) console.error(`[walkthrough renderer]\n${stderr.trim()}`);
        throw new Error(describeRendererFailure(stderr));
      }
      throw error;
    }
    if (exitCode !== 0 || !response.success) {
      if (stderr.trim()) console.error(`[walkthrough renderer]\n${stderr.trim()}`);
      throw new Error(response.error || describeRendererFailure(stderr));
    }
    return response;
  } catch (error) {
    if (error.pythonMissing) {
      // The interpreter itself is absent, so the readiness probe would fail the
      // same way; keep the cached answer honest for /healthz.
      readinessPromise = Promise.resolve({ ready: false, reason: ENVIRONMENT_HINT });
      readinessFailedAt = Date.now();
      throw new Error(ENVIRONMENT_HINT);
    }
    throw error;
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Serving the geometry
// ───────────────────────────────────────────────────────────────────────────

export function walkthroughModelPath(filename) {
  if (!MODEL_NAME.test(filename || "")) return null;
  const resolved = path.resolve(generatedRoot, filename);
  return path.dirname(resolved) === generatedRoot ? resolved : null;
}

/**
 * Make sure a built model is on this machine's disk, downloading it once if the
 * exporter ran on Modal.
 *
 * Model names are content-addressed, so a file that exists is by definition the
 * right file and is never re-fetched. Rejects with `notFound` when the model is
 * genuinely gone — a scene whose container has since scaled down, or a stale URL
 * the app kept from an earlier session.
 */
export async function ensureWalkthroughModel(filename) {
  const modelPath = walkthroughModelPath(filename);
  if (!modelPath) throw Object.assign(new Error("Invalid walkthrough model."), { notFound: true });

  try {
    await fs.access(modelPath);
    return modelPath;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const modelUrl = siblingEndpoint("model");
  if (!modelUrl) throw Object.assign(new Error("This walkthrough model has expired."), { notFound: true });

  const response = await fetch(`${modelUrl}?name=${encodeURIComponent(filename)}`, {
    headers: { Authorization: `Bearer ${process.env.MODAL_API_KEY}` },
    signal: AbortSignal.timeout(REMOTE_MODEL_TIMEOUT_MS),
  });
  if (response.status === 404) {
    throw Object.assign(new Error("This walkthrough model has expired."), { notFound: true });
  }
  if (!response.ok) {
    throw new Error(`The 3D rendering service answered HTTP ${response.status} for this model.`);
  }

  // Stream to a sibling file and rename, rather than buffering. A furnished
  // multi-room GLB is tens of megabytes, and this instance has 512 MB to run
  // the whole API in. The rename also means a request arriving mid-download
  // never sends a truncated model, and two requests for the same new scene
  // cannot interleave into one broken file.
  await fs.mkdir(generatedRoot, { recursive: true });
  const partial = path.join(generatedRoot, `.${filename}.${randomUUID()}.part`);
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
    await fs.rename(partial, modelPath);
  } finally {
    await fs.rm(partial, { force: true });
  }
  return modelPath;
}

export { generatedRoot as walkthroughGeneratedRoot };
