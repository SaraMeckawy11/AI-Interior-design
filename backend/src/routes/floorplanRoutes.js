import express from "express";
import axios from "axios";

import { isAuthenticated } from "../middleware/auth.middleware.js";

const router = express.Router();

/**
 * Keep the detector behind the existing authenticated API so the mobile app
 * never needs a Modal secret. The CPU detector returns the same editable
 * geometry contract used by livinai_web.
 */
router.post("/detect", isAuthenticated, async (req, res) => {
  const { image, mimeType } = req.body || {};
  if (typeof image !== "string" || image.length < 16) {
    return res.status(400).json({ message: "Please provide a floor-plan image." });
  }
  if (image.length > 22_000_000) {
    return res.status(413).json({ message: "The floor plan must be 15 MB or smaller." });
  }

  const endpoint = process.env.MODAL_FLOORPLAN_ENDPOINT_URL
    || process.env.MODAL_ENDPOINT_URL?.replace(/-(?:interiorai-)?generate\.modal\.run$/, "-detect-floorplan.modal.run");
  if (!endpoint) {
    return res.status(503).json({
      message: "Floor-plan detection is not configured yet. You can still trace rooms over the uploaded image.",
    });
  }

  try {
    const response = await axios.post(
      endpoint,
      { image, mimeType: mimeType || "image/jpeg" },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.MODAL_API_KEY}`,
        },
        timeout: 60_000,
        maxContentLength: 24_000_000,
        maxBodyLength: 24_000_000,
      },
    );
    return res.json(response.data);
  } catch (error) {
    const status = Number(error.response?.status) || 502;
    const detail = error.response?.data?.detail || error.response?.data?.message || error.message;
    console.error("POST /floorplans/detect error:", status, detail);
    return res.status(status >= 400 && status < 500 ? status : 502).json({
      message: detail || "The floor plan could not be detected.",
    });
  }
});

export default router;
