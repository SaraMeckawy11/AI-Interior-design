import axios from "axios";
import express from "express";
import { Buffer } from "node:buffer";

import { isAuthenticated } from "../middleware/auth.middleware.js";

const router = express.Router();
const MODEL_NAME = /^[a-f0-9]{24}\.glb$/i;

const rendererRoot = () => (process.env.INTERIOR_PLAN_RENDERER_URL || "").replace(/\/$/, "");

/**
 * Proxy Livinai_web's realtime session contract through the mobile API. This
 * keeps the mobile client on its existing authenticated host while using the
 * original Interior_Plan exporter for geometry, furniture and placement.
 */
router.post("/realtime/session", isAuthenticated, async (req, res) => {
  const root = rendererRoot();
  if (!root) {
    return res.status(503).json({
      message: "The exact Interior_Plan walkthrough renderer is not configured.",
    });
  }

  try {
    const response = await axios.post(`${root}/api/walkthrough/realtime/session`, req.body, {
      headers: { "Content-Type": "application/json" },
      timeout: 180_000,
      maxBodyLength: 10_000_000,
    });
    const data = response.data || {};
    const modelName = String(data.modelUrl || "").split(/[/?#]/).filter(Boolean).pop();
    if (!MODEL_NAME.test(modelName || "")) {
      return res.status(502).json({ message: "The renderer returned an invalid walkthrough model." });
    }
    return res.json({
      ...data,
      modelUrl: `/api/walkthrough/realtime/model/${modelName}`,
    });
  } catch (error) {
    const upstreamStatus = Number(error.response?.status) || 502;
    const detail = error.response?.data?.detail || error.response?.data?.message || error.message;
    console.error("POST /walkthrough/realtime/session error:", upstreamStatus, detail);
    return res.status(upstreamStatus >= 400 && upstreamStatus < 500 ? upstreamStatus : 502).json({
      message: detail || "The exact walkthrough could not be generated.",
    });
  }
});

// GLTFLoader cannot attach the app's bearer token, so model URLs are unlisted,
// content-addressed cache keys. Only strict renderer-generated names can pass.
router.get("/realtime/model/:filename", async (req, res) => {
  const root = rendererRoot();
  const { filename } = req.params;
  if (!root) return res.status(503).json({ message: "The walkthrough renderer is not configured." });
  if (!MODEL_NAME.test(filename)) return res.status(400).json({ message: "Invalid walkthrough model." });

  try {
    const response = await axios.get(`${root}/generated/walkthrough/${filename}`, {
      responseType: "arraybuffer",
      timeout: 90_000,
      maxContentLength: 80_000_000,
    });
    res.set({
      "Content-Type": "model/gltf-binary",
      "Cache-Control": "public, max-age=604800, immutable",
    });
    return res.send(Buffer.from(response.data));
  } catch (error) {
    const upstreamStatus = Number(error.response?.status) || 502;
    console.error("GET /walkthrough/realtime/model error:", upstreamStatus, error.message);
    return res.status(upstreamStatus === 404 ? 404 : 502).json({
      message: upstreamStatus === 404 ? "This walkthrough model has expired." : "The walkthrough model could not be loaded.",
    });
  }
});

export default router;
