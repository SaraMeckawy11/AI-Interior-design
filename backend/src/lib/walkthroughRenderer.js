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

const pythonExecutable = () => process.env.WALKTHROUGH_PYTHON
  || (process.platform === "win32" ? "python" : "python3");

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
      if (exitCode !== 0 && stderr.trim()) throw new Error(stderr.trim());
      throw error;
    }
    if (exitCode !== 0 || !response.success) {
      throw new Error(response.error || stderr.trim() || "The exact walkthrough could not be generated.");
    }
    if (!MODEL_NAME.test(response.modelName || "")) {
      throw new Error("The bundled renderer returned an invalid model name.");
    }
    return response;
  } catch (error) {
    if (error.pythonMissing) {
      throw new Error(
        "Python is unavailable. Install backend/renderer/requirements.txt or use the backend Docker image.",
      );
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
