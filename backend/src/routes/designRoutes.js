import express from "express";
import axios from "axios";
import cloudinary from "../lib/cloudinary.js";
import Design from "../models/Design.js";
import User from "../models/User.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";

const router = express.Router();

// Helper to fetch base64 from URL
async function getImageBase64FromUrl(url) {
  const response = await axios.get(url, { responseType: "arraybuffer" });
  const buffer = Buffer.from(response.data, "binary");
  return buffer.toString("base64");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ───────────────────────────────────────────────────────────────────────────
// Inference hosts
//
// Modal runs first and RunPod catches whatever it drops. Both take the same
// brief and return the same thing, so the route below does not care which one
// answered.
//
// They run the same two engines: FLUX.2 [klein] for photo redesigns, SD 1.5 +
// ControlNet for guided floor plans, routed by the same rule. `interiorAI/` runs
// the engines ported from `modal/app.py`, so the order here is an operational
// choice — which host is asked first — and not a choice of picture. It was not
// always: RunPod was SD 1.5 for *everything*, so putting it first meant nearly
// every design came back from an engine the prompts were not written for.
//
// Modal leads because it is the one that is provisioned for this work. It
// answers a warm request in seconds from volume-cached weights, and Modal owns
// its own capacity, so it does not queue behind somebody else's GPU. RunPod
// stands behind it to keep a Modal outage from reaching the user as an error.
//
// The logs still name the host and the engine — a fallback is worth seeing, and
// guided plans and photo redesigns are answered by different models on both.
// ───────────────────────────────────────────────────────────────────────────

const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID || "9x2kmfa8z6483c";
const RUNPOD_POLL_INTERVAL_MS = 2_000;
// Budget for queue time *plus* inference, not just inference. The endpoint
// scales from zero, so a design that arrives cold waits for a worker before
// anything runs: a measured run spent 59.8s queued and 12.9s generating. 150s
// covers a cold start with room to spare; past that it really is stuck.
//
// This is the fallback path now, so the budget is spent after Modal has already
// failed — the user has been waiting a while by the time it starts. Shortening
// it would mean giving up on the last host that could still answer.
const RUNPOD_MAX_POLLS = 75;

/**
 * Submit to the RunPod serverless endpoint and poll until it finishes.
 *
 * Resolves with the worker's output object — the same shape Modal returns —
 * and throws on anything that is not a finished image, so the caller has one
 * thing to catch rather than a status code to interpret.
 */
async function generateWithRunPod(payload) {
  if (!process.env.RUNPOD_API_KEY) throw new Error("RUNPOD_API_KEY is not set");

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.RUNPOD_API_KEY}`,
  };

  // The handler reads `event["input"]` and understands every field, including
  // the Gen-Klein brief controls, which it used to ignore.
  const jobResponse = await axios.post(
    `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}/run`,
    { input: payload },
    { headers, timeout: 30_000 },
  );

  const jobId = jobResponse.data?.id;
  if (!jobId) throw new Error("RunPod did not return a job id");
  console.log("RunPod job submitted:", jobId, "initial status:", jobResponse.data.status);

  for (let attempt = 1; attempt <= RUNPOD_MAX_POLLS; attempt += 1) {
    await sleep(RUNPOD_POLL_INTERVAL_MS);

    const statusResp = await axios.get(
      `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}/status/${jobId}`,
      { headers, timeout: 30_000 },
    );
    const status = statusResp.data?.status;
    console.log(`Polling RunPod [attempt ${attempt}]:`, status);

    if (status === "COMPLETED") {
      // The handler catches its own exceptions so the job completes rather than
      // failing, which means an error arrives here as a normal output body.
      const output = statusResp.data?.output;
      if (output?.error) throw new Error(`RunPod handler failed: ${output.error}`);
      if (!output?.generatedImage) throw new Error("RunPod completed without returning an image");
      return output;
    }
    if (status === "FAILED" || status === "CANCELLED" || status === "TIMED_OUT") {
      throw new Error(`RunPod job ${status.toLowerCase()}: ${statusResp.data?.error || "no detail"}`);
    }
  }

  throw new Error(`RunPod job did not finish within ${(RUNPOD_MAX_POLLS * RUNPOD_POLL_INTERVAL_MS) / 1000}s`);
}

/** Ask the Modal router, which picks between Gen-Klein and the ControlNet path. */
async function generateWithModal(payload) {
  if (!process.env.MODAL_ENDPOINT_URL) throw new Error("MODAL_ENDPOINT_URL is not set");

  const modalResp = await axios.post(process.env.MODAL_ENDPOINT_URL, payload, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.MODAL_API_KEY}`,
    },
    timeout: 180_000, // 3 min — covers worst-case cold start + inference
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });

  console.log(
    "Modal job completed:",
    "prompt=", modalResp.data?.prompt?.slice(0, 80),
    "has_window=", modalResp.data?.has_window,
  );

  if (!modalResp.data?.generatedImage) throw new Error("Modal did not return a generated image");
  return modalResp.data;
}

router.post("/", isAuthenticated, async (req, res) => {
  try {
    const {
      roomType,
      designStyle,
      colorTone,
      // The 60/30/10 scheme behind the chosen tone: { dominant, secondary,
      // accent } names plus their hexes. Optional — older app builds send only
      // `colorTone` and the prompt engine still writes the generic ratio clause.
      colorPalette,
      customPrompt,
      image,
      // Guided-mode payload (drawn room polygons + canvas info). Used by the
      // inference worker to rasterize an ADE20K semantic mask and feed it as
      // ControlNet-Seg conditioning so each room lands exactly where drawn.
      rooms,
      canvas,
      mode,
      doors,
      // Gen-Klein (FLUX.2 [klein]) controls. Optional — the Modal service
      // applies the same defaults when they are absent, so older app builds
      // keep working unchanged.
      material,
      lighting,
      preserveGeometry,
      creativity,
    } = req.body;

    if (!roomType || !designStyle || !colorTone || !image) {
      console.log("Missing required fields:", { roomType, designStyle, colorTone, image });
      return res.status(400).json({ message: "Please provide all required fields" });
    }

    // Fetch user and check usage
    const user = await User.findById(req.user._id);
    if (!user) {
      console.log("User not found:", req.user._id);
      return res.status(404).json({ message: "User not found" });
    }

    // ✅ Combined freeDesign + coin logic
    const COST_PER_DESIGN = 2;

    if (!user.isSubscribed && !user.isPremium) {
      if (user.freeDesignsUsed >= 2) {
        // If no free designs left, try using coins
        if ((user.adCoins || 0) >= COST_PER_DESIGN) {
          user.adCoins -= COST_PER_DESIGN;
          await user.save();
          console.log(`Deducted ${COST_PER_DESIGN} coins from user ${user._id}. Remaining coins: ${user.adCoins}`);
        } else {
          console.log("User has no free designs and insufficient coins:", user._id);
          return res.status(403).json({
            message: "Upgrade required",
            reason: "You have used your 2 free designs and don't have enough coins.",
          });
        }
      } else {
        // Still has free designs → consume one
        user.freeDesignsUsed += 1;
        await user.save();
        console.log(`Used one free design for user ${user._id}. Total used: ${user.freeDesignsUsed}`);
      }
    }

    // Upload original image
    const uploadedResponse = await cloudinary.uploader.upload(image);
    const imageUrl = uploadedResponse.secure_url;
    const imagePublicId = uploadedResponse.public_id;
    console.log("Uploaded original image to Cloudinary:", { imageUrl, imagePublicId });

    // Remove data URI prefix if present
    const imageBase64 = image.startsWith("data:image") ? image.split(",")[1] : image;
    console.log("Prepared base64 for AI API, length:", imageBase64.length);

    // One brief, two engines. RunPod reads it from `input`, Modal from the body.
    const payload = {
      image: imageBase64,
      room_type: roomType,
      design_style: designStyle,
      color_tone: colorTone,
      color_palette: colorPalette && typeof colorPalette === "object" ? colorPalette : null,
      custom_prompt: customPrompt || "",
      // Guided-mode spatial fields (optional, only populated by plan.jsx
      // when the user drew room outlines).
      rooms: Array.isArray(rooms) ? rooms : null,
      doors: Array.isArray(doors) ? doors : null,
      canvas: canvas && typeof canvas === "object" ? canvas : null,
      mode: typeof mode === "string" ? mode : "",
      // Gen-Klein brief controls.
      material: typeof material === "string" ? material : "",
      lighting: typeof lighting === "string" ? lighting : "",
      preserve_geometry: preserveGeometry !== false,
      creativity: Number.isFinite(Number(creativity)) ? Number(creativity) : 42,
    };

    // Modal first, RunPod second. The design credit was already spent above and
    // is not refunded if both fail — same as before this fallback existed.
    let result = null;
    let host = "modal";

    console.log("Submitting job to Modal");
    try {
      result = await generateWithModal(payload);
    } catch (modalError) {
      console.error(
        "Modal request failed, falling back to RunPod:",
        modalError.response?.status,
        modalError.response?.data || modalError.message,
      );
      host = "runpod";
      console.log("Submitting job to RunPod endpoint", RUNPOD_ENDPOINT_ID);
      try {
        result = await generateWithRunPod(payload);
      } catch (runpodError) {
        console.error("RunPod request failed too:", runpodError.message);
        return res.status(502).json({ message: "AI service failed. Please try again." });
      }
    }

    const generatedImageBase64 = result.generatedImage;
    console.log(
      `Design generated by ${host}:`,
      `engine=${result.engine || "unknown"}`,
      `model=${result.model || "unknown"}`,
      `imageLen=${generatedImageBase64.length}`,
    );

    // Upload AI-generated image to Cloudinary
    let generatedImageUrl = null;
    let generatedImagePublicId = null;

    if (generatedImageBase64) {
      const dataUri = `data:image/png;base64,${generatedImageBase64}`;
      const generatedResponse = await cloudinary.uploader.upload(dataUri, {
        folder: "generated_images",
      });
      generatedImageUrl = generatedResponse.secure_url;
      generatedImagePublicId = generatedResponse.public_id;
      console.log("Uploaded AI-generated image to Cloudinary:", { generatedImageUrl, generatedImagePublicId });
    }

    // Save design to DB
    const newDesign = new Design({
      roomType,
      designStyle,
      colorTone,
      customPrompt,
      image: imageUrl,
      imagePublicId,
      generatedImage: generatedImageUrl,
      generatedImagePublicId,
      user: req.user._id,
      username: user.username,
    });

    await newDesign.save();

    // ✅ Update user stats
    user.designCount = (user.designCount || 0) + 1;
    user.activeDesigns = (user.activeDesigns || 0) + 1;

    await user.save();

    res.status(201).json({
      image: newDesign.image,
      generatedImage: newDesign.generatedImage,
      roomType: newDesign.roomType,
      designStyle: newDesign.designStyle,
      colorTone: newDesign.colorTone,
    });
  } catch (error) {
    console.error("POST /designs error:", error);
    res.status(500).json({ message: error.message || "Something went wrong" });
  }
});

/**
 * Save a captured frame from the client-side 3D walkthrough.
 *
 * The walkthrough renders entirely on the device (three.js in a WebView), so no
 * inference happens here and no design credits or coins are consumed — this
 * route only persists the captured view so it shows up in the user's
 * collection alongside their generated designs.
 */
router.post("/walkthrough", isAuthenticated, async (req, res) => {
  try {
    const { image, roomType, designStyle, colorTone, notes } = req.body;

    if (!image) {
      return res.status(400).json({ message: "Please provide the captured walkthrough view" });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const dataUri = image.startsWith("data:image") ? image : `data:image/jpeg;base64,${image}`;
    const uploaded = await cloudinary.uploader.upload(dataUri, {
      folder: "walkthrough_views",
    });

    const design = new Design({
      roomType: roomType || "3D Walkthrough",
      designStyle: designStyle || "Modern",
      colorTone: colorTone || "Neutral",
      customPrompt: notes || "",
      // A walkthrough capture has no separate "before" image; the rendered view
      // is both the source and the result.
      image: uploaded.secure_url,
      imagePublicId: uploaded.public_id,
      generatedImage: uploaded.secure_url,
      generatedImagePublicId: uploaded.public_id,
      user: req.user._id,
      username: user.username,
    });
    await design.save();

    user.activeDesigns = (user.activeDesigns || 0) + 1;
    await user.save();

    res.status(201).json({
      image: design.image,
      generatedImage: design.generatedImage,
      roomType: design.roomType,
      designStyle: design.designStyle,
      colorTone: design.colorTone,
    });
  } catch (error) {
    console.error("POST /designs/walkthrough error:", error);
    res.status(500).json({ message: error.message || "Could not save this walkthrough view" });
  }
});

// GET all designs with pagination
router.get("/", isAuthenticated, async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 5;
    const skip = (page - 1) * limit;

    const designs = await Design.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("user", "username profileImage");

    const totalDesigns = await Design.countDocuments({ user: req.user._id });

    const output = designs.map((design) => ({
      generatedImage: design.generatedImage,
      image: design.image,
      roomType: design.roomType,
      designStyle: design.designStyle,
      colorTone: design.colorTone,
      customPrompt: design.customPrompt,
      user: design.user,
      createdAt: design.createdAt,
      _id: design._id,
    }));

    res.json({
      output,
      currentPage: page,
      totalDesigns,
      totalPages: Math.ceil(totalDesigns / limit),
    });
  } catch (error) {
    console.error("GET /designs error:", error.message || error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// GET all designs of current user
router.get("/user", isAuthenticated, async (req, res) => {
  try {
    const designs = await Design.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.json(designs);
  } catch (error) {
    console.error("GET /designs/user error:", error.message || error);
    res.status(500).json({ message: "Server error" });
  }
});

// DELETE a design
router.delete("/:id", isAuthenticated, async (req, res) => {
  try {
    const design = await Design.findById(req.params.id);
    if (!design) {
      return res.status(404).json({ message: "Design not found" });
    }

    if (design.user.toString() !== req.user._id.toString()) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (design.imagePublicId) {
      await cloudinary.uploader.destroy(design.imagePublicId);
    } else if (design.image && design.image.includes("cloudinary")) {
      const publicId = design.image.split("/").pop().split(".")[0];
      await cloudinary.uploader.destroy(publicId);
    }

    if (design.generatedImagePublicId) {
      await cloudinary.uploader.destroy(design.generatedImagePublicId);
    } else if (design.generatedImage && design.generatedImage.includes("cloudinary")) {
      const publicId = design.generatedImage.split("/").pop().split(".")[0];
      await cloudinary.uploader.destroy(publicId);
    }

    await design.deleteOne();

    // ✅ Update user's activeDesigns
    const user = await User.findById(req.user._id);
    if (user) {
      user.activeDesigns = Math.max((user.activeDesigns || 0) - 1, 0);
      await user.save();
    }

    res.json({ message: "Design deleted successfully" });
  } catch (error) {
    console.error("DELETE /designs/:id error:", error.message || error);
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;

// Exported so the two hosts can be exercised against the real services without
// standing up Mongo, Cloudinary and an authenticated session first. Both resolve
// with the worker's full output object, so a smoke test can check which engine
// and model answered, not just that an image came back. Nothing in the app
// imports these.
export { generateWithRunPod, generateWithModal };
