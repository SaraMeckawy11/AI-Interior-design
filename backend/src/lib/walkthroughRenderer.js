import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const rendererRoot = path.resolve(here, "../../renderer");
const workerPath = path.join(rendererRoot, "render_worker.py");
const generatedRoot = path.join(rendererRoot, "generated");
const MODEL_NAME = /^[a-f0-9]{24}\.glb$/i;
const RENDER_TIMEOUT_MS = 240_000;
const PROBE_TIMEOUT_MS = 60_000;

/** Every third-party module the exporter imports before it can do any work. */
const REQUIRED_MODULES = ["numpy", "PIL", "shapely", "trimesh", "open3d"];

const pythonExecutable = () => process.env.WALKTHROUGH_PYTHON
  || (process.platform === "win32" ? "python" : "python3");

const ENVIRONMENT_HINT =
  "The walkthrough renderer's Python environment is not installed on this server. "
  + "Deploy backend/Dockerfile (which installs backend/renderer/requirements.txt), "
  + "or install those requirements locally and point WALKTHROUGH_PYTHON at that interpreter.";

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

/**
 * Ask the configured interpreter whether it can import what the exporter needs.
 *
 * Cached after the first successful answer: the environment cannot gain modules
 * while the process is running, so a healthy server pays for this once.
 */
let readinessPromise = null;

export function rendererReadiness({ refresh = false } = {}) {
  if (refresh || !readinessPromise) readinessPromise = probeRenderer();
  return readinessPromise;
}

function probeRenderer() {
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
      resolve({ ready: true, python: pythonExecutable() });
    });
  });
}

/** Log the renderer's state once at boot so a broken deploy is obvious. */
export async function reportRendererReadiness() {
  const state = await rendererReadiness();
  if (state.ready) console.log(`Walkthrough renderer ready (${state.python}).`);
  else console.error(`Walkthrough renderer UNAVAILABLE: ${state.reason}`);
  return state;
}

/** Run the repository-owned Livinai_web exporter in an isolated process. */
export async function buildWalkthroughModel(payload) {
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
    if (!MODEL_NAME.test(response.modelName || "")) {
      throw new Error("The bundled renderer returned an invalid model name.");
    }
    return response;
  } catch (error) {
    if (error.pythonMissing) {
      // The interpreter itself is absent, so the readiness probe would fail the
      // same way; keep the cached answer honest for /healthz.
      readinessPromise = Promise.resolve({ ready: false, reason: ENVIRONMENT_HINT });
      throw new Error(ENVIRONMENT_HINT);
    }
    throw error;
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

export function walkthroughModelPath(filename) {
  if (!MODEL_NAME.test(filename || "")) return null;
  const resolved = path.resolve(generatedRoot, filename);
  return path.dirname(resolved) === generatedRoot ? resolved : null;
}

export { generatedRoot as walkthroughGeneratedRoot };
