import axios from "axios";
import express from "express";
import { Buffer } from "node:buffer";

import cloudinary from "../lib/cloudinary.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";
import WalkthroughPlan from "../models/WalkthroughPlan.js";

const router = express.Router();
const MODEL_NAME = /^[a-f0-9]{24}\.glb$/i;

// A plan a phone can realistically hold. Past this the library stops being a
// library and starts being a place plans go to be lost.
const MAX_PLANS_PER_USER = 40;

const rendererRoot = () => (process.env.INTERIOR_PLAN_RENDERER_URL || "").replace(/\/$/, "");

// ───────────────────────────────────────────────────────────────────────────
// Saved 3D plans
// ───────────────────────────────────────────────────────────────────────────

/**
 * Move an image the device sent into Cloudinary, if it is worth moving.
 *
 * The editor can hand over three different things for the same field: a `data:`
 * URI it just read off disk, an https URL from a previous save, or nothing. Only
 * the first needs uploading — re-uploading an https URL on every save would
 * orphan an asset per keystroke.
 */
const storeImage = async (value, folder) => {
  if (!value || typeof value !== "string") return { url: null, publicId: null };
  if (!value.startsWith("data:")) return { url: value, publicId: null };
  const uploaded = await cloudinary.uploader.upload(value, { folder });
  return { url: uploaded.secure_url, publicId: uploaded.public_id };
};

const destroyImage = async (publicId) => {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    console.error("Cloudinary destroy failed:", publicId, error.message);
  }
};

/** What the library list needs — everything except the geometry blob. */
const summarize = (plan) => ({
  id: plan._id,
  clientId: plan.clientId,
  title: plan.title,
  source: plan.source,
  roomCount: plan.roomCount,
  openingCount: plan.openingCount,
  areaMeters: plan.areaMeters,
  planImage: plan.planImage || null,
  thumbnail: plan.thumbnail || plan.planImage || null,
  updatedAt: plan.updatedAt,
  createdAt: plan.createdAt,
});

// List the signed-in user's saved plans, newest first. The geometry is left out
// so opening the library never downloads every plan the user owns.
router.get("/plans", isAuthenticated, async (req, res) => {
  try {
    const plans = await WalkthroughPlan.find({ user: req.user._id })
      .select("-data")
      .sort({ updatedAt: -1 })
      .limit(MAX_PLANS_PER_USER);
    return res.json({ plans: plans.map(summarize) });
  } catch (error) {
    console.error("GET /walkthrough/plans error:", error);
    return res.status(500).json({ message: "Your saved 3D plans could not be loaded." });
  }
});

// One plan, with the geometry needed to reopen it in the editor.
router.get("/plans/:id", isAuthenticated, async (req, res) => {
  try {
    const plan = await WalkthroughPlan.findOne({ _id: req.params.id, user: req.user._id });
    if (!plan) return res.status(404).json({ message: "That 3D plan no longer exists." });
    return res.json({ plan: { ...summarize(plan), data: plan.data } });
  } catch (error) {
    console.error("GET /walkthrough/plans/:id error:", error);
    return res.status(500).json({ message: "That 3D plan could not be opened." });
  }
});

/**
 * Create or update a plan, keyed on the id the device generated.
 *
 * Upserting on `clientId` rather than creating on POST is what makes saving
 * idempotent: the editor autosaves locally and syncs on demand, and a retry
 * after a dropped connection has to land on the same row rather than leaving the
 * user with three copies of one flat.
 */
router.post("/plans", isAuthenticated, async (req, res) => {
  const { clientId, title, source, data, roomCount, openingCount, areaMeters, planImage, thumbnail } = req.body || {};

  if (!clientId || typeof clientId !== "string") {
    return res.status(400).json({ message: "This plan is missing its identifier." });
  }
  if (!data || typeof data !== "object") {
    return res.status(400).json({ message: "This plan has no geometry to save." });
  }

  try {
    const existing = await WalkthroughPlan.findOne({ user: req.user._id, clientId });

    if (!existing) {
      const count = await WalkthroughPlan.countDocuments({ user: req.user._id });
      if (count >= MAX_PLANS_PER_USER) {
        return res.status(409).json({
          message: `You can keep ${MAX_PLANS_PER_USER} saved 3D plans. Delete one to save another.`,
        });
      }
    }

    // Upload before writing, so a failed upload never leaves a row pointing at
    // a `data:` URI that the app would then try to render.
    const storedPlanImage = await storeImage(planImage, "walkthrough_plans");
    const storedThumbnail = await storeImage(thumbnail, "walkthrough_thumbnails");

    const update = {
      user: req.user._id,
      clientId,
      title: (title || "").trim().slice(0, 80) || "Untitled 3D plan",
      source: source === "upload" ? "upload" : "blank",
      roomCount: Number(roomCount) || 0,
      openingCount: Number(openingCount) || 0,
      areaMeters: Number(areaMeters) || 0,
      data,
    };

    // A field the client did not send this time keeps whatever it had. Clearing
    // it would drop the uploaded plan every time only the geometry changed.
    if (storedPlanImage.url) {
      update.planImage = storedPlanImage.url;
      if (storedPlanImage.publicId) update.planImagePublicId = storedPlanImage.publicId;
    } else if (planImage === null) {
      update.planImage = null;
      update.planImagePublicId = null;
    }
    if (storedThumbnail.url) {
      update.thumbnail = storedThumbnail.url;
      if (storedThumbnail.publicId) update.thumbnailPublicId = storedThumbnail.publicId;
    }

    // Replacing an image means the one it replaced is now unreferenced.
    if (existing && storedPlanImage.publicId && existing.planImagePublicId !== storedPlanImage.publicId) {
      await destroyImage(existing.planImagePublicId);
    }
    if (existing && storedThumbnail.publicId && existing.thumbnailPublicId !== storedThumbnail.publicId) {
      await destroyImage(existing.thumbnailPublicId);
    }

    const plan = await WalkthroughPlan.findOneAndUpdate(
      { user: req.user._id, clientId },
      { $set: update },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    return res.status(existing ? 200 : 201).json({ plan: summarize(plan) });
  } catch (error) {
    console.error("POST /walkthrough/plans error:", error);
    return res.status(500).json({ message: "This 3D plan could not be saved." });
  }
});

// Rename only. Geometry changes always go through the upsert above.
router.patch("/plans/:id", isAuthenticated, async (req, res) => {
  try {
    const title = String(req.body?.title || "").trim().slice(0, 80);
    if (!title) return res.status(400).json({ message: "Give this plan a name." });

    const plan = await WalkthroughPlan.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { $set: { title } },
      { new: true },
    ).select("-data");
    if (!plan) return res.status(404).json({ message: "That 3D plan no longer exists." });
    return res.json({ plan: summarize(plan) });
  } catch (error) {
    console.error("PATCH /walkthrough/plans/:id error:", error);
    return res.status(500).json({ message: "This 3D plan could not be renamed." });
  }
});

router.delete("/plans/:id", isAuthenticated, async (req, res) => {
  try {
    const plan = await WalkthroughPlan.findOne({ _id: req.params.id, user: req.user._id });
    if (!plan) return res.status(404).json({ message: "That 3D plan no longer exists." });

    await destroyImage(plan.planImagePublicId);
    await destroyImage(plan.thumbnailPublicId);
    await plan.deleteOne();

    return res.json({ message: "3D plan deleted." });
  } catch (error) {
    console.error("DELETE /walkthrough/plans/:id error:", error);
    return res.status(500).json({ message: "This 3D plan could not be deleted." });
  }
});

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
