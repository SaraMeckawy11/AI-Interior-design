import express from "express";

import cloudinary from "../lib/cloudinary.js";
import {
  buildWalkthroughModel,
  ensureWalkthroughModel,
  knownRendererSource,
  rendererReadiness,
  walkthroughModelPath,
} from "../lib/walkthroughRenderer.js";
import { sceneCacheKey } from "../lib/walkthroughSceneCache.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";
import WalkthroughPlan from "../models/WalkthroughPlan.js";
import WalkthroughScene from "../models/WalkthroughScene.js";

const router = express.Router();

// A plan a phone can realistically hold. Past this the library stops being a
// library and starts being a place plans go to be lost.
const MAX_PLANS_PER_USER = 40;

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
 * Build Livinai_web's canonical realtime scene with the renderer snapshot and
 * assets bundled in this repository. There is no second project, service URL,
 * or machine-specific source root in this path.
 *
 * A scene that has been built before is answered from `WalkthroughScene` without
 * involving the exporter at all — no readiness probe, no Modal container, no
 * poll loop. That is the common case by a wide margin: the app asks for a
 * session every time someone reaches the Explore step, so walking through the
 * same flat twice used to cost two GPU builds even though the exporter's own
 * content-addressed cache meant the second one produced a byte-identical file.
 */
router.post("/realtime/session", isAuthenticated, async (req, res) => {
  const payload = req.body || {};
  const key = sceneCacheKey(payload);

  /**
   * "Rebuild" has to mean rebuild, here as well as on the device.
   *
   * The app clears its two local copies and asks again — but the request that
   * follows is identical to the one that produced the row in the first place,
   * so this handler answered from the cache and returned the very scene the
   * user was trying to get rid of. Pressing Rebuild could not change anything,
   * which made it worse than no button at all.
   *
   * Not part of `sceneCacheKey`: this says how to answer, not what to build,
   * and the fresh scene is still written under the same key so the next person
   * with this plan gets it for free.
   */
  const forceRebuild = payload.forceRebuild === true;

  /**
   * Which exporter is live — but never at the cost of making a hit wait.
   *
   * This used to `await rendererReadiness()` before touching the cache, so the
   * fastest path in the whole feature, answering a known plan out of the
   * database, was put behind a network probe to Modal. On a cold instance that
   * is the difference between an instant open and a visible pause, and it was
   * paid by every request that had nothing to invalidate.
   *
   * The probe is memoised, so the value is already there on all but the first
   * request. Take it when it is, start it when it is not, and let a scene that
   * cannot be checked yet answer — one more open will check it. Nothing is lost
   * except the invalidation happening a single request later than it could.
   */
  const rendererSource = knownRendererSource();

  // `findOneAndUpdate` rather than `findOne`, so reading a scene is also what
  // keeps it alive: the TTL index drops rows nobody has opened in 90 days.
  try {
    const cached = forceRebuild ? null : await WalkthroughScene.findOneAndUpdate(
      { key },
      { $set: { lastUsedAt: new Date() } },
      { new: true },
    );
    // A row built by a different exporter is not this plan's scene any more.
    //
    // Rows written before this field existed carry no source, and they are
    // stale by the same test rather than by exception: we cannot say which
    // renderer built them, a new one has demonstrably shipped, and guessing in
    // their favour is precisely how a catalogue of new furniture reached
    // nobody. They rebuild once, and then answer for themselves.
    //
    // When the *current* source is unknown — a locally spawned renderer, which
    // reports none — there is nothing to compare and the row is trusted exactly
    // as before, so local development does not rebuild on every request.
    const staleRenderer = !!cached
      && !!rendererSource
      && cached.rendererSource !== rendererSource;
    if (cached && !staleRenderer) {
      return res.json({
        ...cached.data,
        modelUrl: `/api/walkthrough/realtime/model/${cached.modelName}`,
        sceneKey: key,
        rendererSource: cached.rendererSource || undefined,
        cached: true,
      });
    }
    if (staleRenderer) {
      console.log(
        `[walkthrough] rebuilding ${key.slice(0, 12)}: built by ${cached.rendererSource}, `
        + `renderer is now ${rendererSource}`,
      );
    }
  } catch (error) {
    // A cache that cannot be read is a slow request, not a failed one.
    console.error("walkthrough scene cache read failed:", error.message);
  }

  // A server that cannot import the exporter will spend four minutes failing
  // the same way for every request. Answer immediately, and say why. Only a
  // miss gets this far, so awaiting the probe here costs nothing a build was
  // not about to cost anyway.
  const renderer = await rendererReadiness();
  // Now that the probe has resolved, stamp the row with what actually built it
  // rather than with whatever was known before the request started.
  const builtBySource = (typeof renderer.source === "string" && renderer.source) || rendererSource;
  if (!renderer.ready) {
    return res.status(503).json({
      message: "The 3D walkthrough service is not available right now.",
      detail: renderer.reason,
      code: "RENDERER_UNAVAILABLE",
    });
  }

  try {
    const { modelName, cached: _exporterCached, ...data } = await buildWalkthroughModel(payload);

    // Upsert rather than create: two phones asking for the same new scene at the
    // same moment both get here, and the second must not fail on the unique key.
    try {
      await WalkthroughScene.updateOne(
        { key },
        { $set: { modelName, data, rendererSource: builtBySource, lastUsedAt: new Date() } },
        { upsert: true },
      );
    } catch (error) {
      console.error("walkthrough scene cache write failed:", error.message);
    }

    return res.json({
      ...data,
      modelUrl: `/api/walkthrough/realtime/model/${modelName}`,
      sceneKey: key,
      rendererSource: builtBySource || undefined,
      cached: false,
    });
  } catch (error) {
    console.error("POST /walkthrough/realtime/session error:", error.message);
    return res.status(500).json({
      message: error.message || "The exact walkthrough could not be generated.",
    });
  }
});

// GLTFLoader cannot attach the app's bearer token, so model URLs are unlisted,
// content-addressed cache keys. Only strict renderer-generated names can pass.
//
// When the exporter runs on Modal the geometry is not on this disk yet, so the
// first request for a scene fetches it once and every later request — including
// the repeat views that make up most of the traffic — is served locally.
router.get("/realtime/model/:filename", async (req, res) => {
  const { filename } = req.params;
  if (!walkthroughModelPath(filename)) {
    return res.status(400).json({ message: "Invalid walkthrough model." });
  }

  try {
    const modelPath = await ensureWalkthroughModel(filename);
    res.set({
      "Content-Type": "model/gltf-binary",
      "Cache-Control": "public, max-age=604800, immutable",
    });
    return res.sendFile(modelPath);
  } catch (error) {
    if (error.notFound) {
      // The geometry is gone for good — evicted from the Modal volume, most
      // likely. Any remembered session pointing at it would hand the same dead
      // URL to the next person who opened that plan, so it goes too, and the
      // retry the app already offers rebuilds the scene properly.
      WalkthroughScene.deleteMany({ modelName: filename }).catch((cleanupError) => {
        console.error("walkthrough scene cache purge failed:", cleanupError.message);
      });
      return res.status(404).json({ message: "This walkthrough model has expired." });
    }
    console.error("GET /walkthrough/realtime/model error:", error.message);
    return res.status(502).json({ message: "This walkthrough model could not be loaded." });
  }
});

export default router;
