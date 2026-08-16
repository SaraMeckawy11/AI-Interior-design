import express from "express";
import axios from "axios";
import cloudinary from "../lib/cloudinary.js";
import Design from "../models/Design.js";
import User from "../models/User.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";
import { FREE_DESIGNS, RENDER_LEASE_RENEW_MS, coinCost } from "../config/pricing.js";
import { recordFreeDesignUsed } from "../services/freeDesigns.js";
import {
  claimRenderSlot,
  refundRender,
  releaseRenderSlot,
  renewRenderSlot,
} from "../services/renderLimits.js";

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

// Modal's `result` endpoint, derived from the generate URL rather than
// configured. Modal names an endpoint after its function, so the sibling is the
// same host with the function segment swapped — one variable to set is one
// variable to get wrong, and a half-configured pair is worse than none.
const modalResultUrl = () => {
  const override = (process.env.MODAL_RESULT_URL || "").trim().replace(/\/$/, "");
  if (override) return override;
  const url = (process.env.MODAL_ENDPOINT_URL || "").trim().replace(/\/$/, "");
  const sibling = url.replace(/-(?:interiorai-)?generate(\.modal\.run)$/i, "-result$1");
  return sibling === url ? "" : sibling;
};

const MODAL_POLL_INTERVAL_MS = 2_000;
// 5 minutes. The old budget was a 180s socket timeout on a blocking request,
// which is where the double-billing came from: a cold FLUX.2 [klein] container
// plus inference can pass three minutes, so the backend gave up on a job that
// was still running and paid RunPod to do the same work again.
const MODAL_MAX_POLLS = 150;

/**
 * Ask the Modal router, which picks between Gen-Klein and the ControlNet path.
 *
 * Submit-and-poll, for the same reason the walkthrough exporter works that way:
 * Modal answers any web request still running after 150 seconds with a redirect,
 * so a blocking call cannot be relied on to return the image. The endpoint now
 * hands back a call id and this waits on it — the job is never abandoned, and
 * RunPod is only asked when Modal has genuinely failed rather than merely taken
 * a while.
 *
 * A deploy where the app is newer than the service still works: an older Modal
 * that answers with the image inline is used as-is.
 */
async function generateWithModal(payload) {
  if (!process.env.MODAL_ENDPOINT_URL) throw new Error("MODAL_ENDPOINT_URL is not set");

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.MODAL_API_KEY}`,
  };

  const submitted = await axios.post(process.env.MODAL_ENDPOINT_URL, payload, {
    headers,
    timeout: 120_000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });

  // An older deployment answers the whole job inline.
  if (submitted.data?.generatedImage) {
    console.log("Modal job completed inline (pre-spawn deployment)");
    return submitted.data;
  }

  const callId = submitted.data?.callId;
  if (!callId) throw new Error("Modal did not accept this design");

  const resultUrl = modalResultUrl();
  if (!resultUrl) {
    throw new Error("MODAL_RESULT_URL could not be derived from MODAL_ENDPOINT_URL");
  }
  console.log("Modal job submitted:", callId);

  /**
   * Past this line a GPU is running and the bill for it is already incurred,
   * whatever happens next. Anything that goes wrong from here is marked
   * `committed` so the caller does not also pay RunPod to redo work Modal is
   * still doing — which is the whole double-spend, and it survived the move to
   * polling: a dropped poll or a job that ran past the budget still sent the
   * same design to a second provider.
   */
  const committed = (message) => Object.assign(new Error(message), { modalCommitted: true });

  let pollFailures = 0;
  for (let attempt = 1; attempt <= MODAL_MAX_POLLS; attempt += 1) {
    await sleep(MODAL_POLL_INTERVAL_MS);

    let statusResp;
    try {
      statusResp = await axios.get(
        `${resultUrl}?callId=${encodeURIComponent(callId)}`,
        { headers, timeout: 60_000, maxContentLength: Infinity },
      );
    } catch (error) {
      // A poll is a cheap CPU call on a network that occasionally blinks.
      // Giving up on the first failure threw away a running GPU job.
      pollFailures += 1;
      console.error(`Modal poll failed (${pollFailures}):`, error.message);
      if (pollFailures >= 5) throw committed("Modal stopped answering about this design");
      continue;
    }
    pollFailures = 0;

    if (statusResp.data?.status !== "completed") continue;

    // The engine reduces its own failures to a sentence, so an error arrives
    // here as a normal body rather than as a status code.
    if (statusResp.data?.error) throw new Error(`Modal engine failed: ${statusResp.data.error}`);
    if (!statusResp.data?.generatedImage) throw new Error("Modal did not return a generated image");

    console.log(
      "Modal job completed:",
      "prompt=", statusResp.data?.prompt?.slice(0, 80),
      "has_window=", statusResp.data?.has_window,
    );
    return statusResp.data;
  }

  throw committed(
    `Modal job did not finish within ${(MODAL_MAX_POLLS * MODAL_POLL_INTERVAL_MS) / 1000}s`,
  );
}

router.post("/", isAuthenticated, async (req, res) => {
  /**
   * What this request is holding: the account's render slot, and whatever it was
   * charged before it had a picture to show for it.
   *
   * The charge has to happen before the GPU is asked — otherwise an account with
   * one coin can start ten renders — so it is a hold, and every way out of this
   * handler that is not a delivered image releases it. Tracking it here rather
   * than refunding at each `return` is deliberate: there are five ways to fail in
   * this route and there will be more, and the one that forgets to refund is the
   * one that takes somebody's coin for nothing.
   *
   * The slot comes back either way, delivered or not. The money only comes back
   * if it was not earned.
   */
  const held = { lease: null, coins: 0, freeDesign: false, day: null };
  let delivered = false;
  // Keeps the render slot alive for exactly as long as this handler is running.
  // Cleared in the `finally`, so the slot stops being defended the instant the
  // request stops existing — including when it throws.
  let heartbeat = null;

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
      // Which price list entry this render is billed against — "design" for the
      // interior/exterior/plan paths, "walkthrough" for a frame rendered out of
      // the 3D view. Only the *name* comes from the client; the price attached
      // to that name is decided here.
      product,
      // What the image *is*: a photograph, or a frame captured out of the 3D
      // walkthrough. The interior brief locks geometry differently for the two,
      // so this reaches the engine. Kept separate from `product` on purpose —
      // that names a price list row, and billing must not decide what the model
      // is asked for. Absent means photograph.
      renderSource,
      // Which re-roll of this brief the user is on. The engines hash their seed
      // from the brief itself so two different rooms cannot start from the same
      // noise; that also makes the same request reproduce exactly, which is
      // wrong for somebody pressing generate again wanting a different design.
      // The client sends a fresh number per attempt, and this passes it on.
      variation,
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

    /**
     * The render slot and the day's count, before anything is charged.
     *
     * Taken first because it is what makes the charge below safe: two requests
     * arriving together used to both read the same balance, both find it
     * sufficient, and both spend it. Only one of them gets the slot now.
     *
     * The day is counted before the render for the same reason — two requests
     * cannot both be the fortieth. A render that fails gives the count back with
     * everything else it took; a day's allowance is for pictures delivered.
     *
     * The daily ceiling only applies where nothing else counts, which is a
     * subscription. Coin and free renders are metered by the coins.
     */
    const slot = await claimRenderSlot(user._id, {
      capped: Boolean(user.isSubscribed || user.isPremium),
    });

    if (!slot.ok) {
      if (slot.reason === "missing") {
        return res.status(404).json({ message: slot.message });
      }
      console.log(
        `Render refused for user ${user._id}:`,
        slot.reason === "busy"
          ? "a render is already in flight"
          : `fair-use day spent (${slot.used}/${slot.limit})`,
      );
      // 429, not 403. The app sends a 403 to the paywall, and this account has
      // already paid — asking it for money again is the wrong answer to "wait" or
      // to "that is enough for today".
      res.set("Retry-After", String(slot.retryAfterSeconds));
      return res.status(429).json({
        message: slot.message,
        reason: slot.detail,
        limitKind: slot.reason,
        retryAfterSeconds: slot.retryAfterSeconds,
        adCoins: user.adCoins || 0,
        freeDesignsUsed: user.freeDesignsUsed || 0,
      });
    }

    held.lease = slot.lease;
    held.day = slot.day;
    console.log(`Render slot taken by user ${user._id} (${slot.rendersToday} today)`);

    // From here the slot is held only while this handler is alive to say so. If
    // the process dies — a deploy, an instance recycled mid-render — the beats
    // stop, the lease goes stale within the window, and the account can render
    // again in about a minute rather than being told "one at a time" with
    // nothing running for the next ten.
    heartbeat = setInterval(() => {
      renewRenderSlot(req.user._id, held.lease).catch(() => {});
    }, RENDER_LEASE_RENEW_MS);
    // Never let the beat be the reason the process stays up.
    heartbeat.unref?.();

    /**
     * ✅ Free allowance, then coins, then the paywall.
     *
     * The price comes from the price list by product name, so a walkthrough
     * frame costs what a walkthrough frame costs and a flat design costs what a
     * flat design costs — a distinction the old flat `COST_PER_DESIGN = 2` could
     * not make, and one the app was disagreeing with anyway (it gated the button
     * on a hardcoded 2 while the ad paid 1).
     *
     * The 403 now carries the numbers. "Upgrade required" told a person nothing
     * about how short they were, so the screen that opened next could not say
     * either — it just asked for money.
     */
    const price = coinCost(product);

    if (!user.isSubscribed && !user.isPremium) {
      if ((user.freeDesignsUsed || 0) >= FREE_DESIGNS) {
        if ((user.adCoins || 0) >= price) {
          user.adCoins -= price;
          await user.save();
          // A hold, not a sale, until there is a picture to show for it.
          held.coins = price;
          console.log(`Deducted ${price} coin(s) from user ${user._id}. Remaining: ${user.adCoins}`);
        } else {
          console.log("User has no free designs and insufficient coins:", user._id);
          return res.status(403).json({
            message: "Not enough coins",
            reason:
              `This ${product === "walkthrough" ? "walkthrough render" : "design"} costs `
              + `${price} ${price === 1 ? "coin" : "coins"}, and you have ${user.adCoins || 0}.`,
            required: price,
            adCoins: user.adCoins || 0,
            freeDesignsUsed: user.freeDesignsUsed || 0,
          });
        }
      } else {
        // Still inside the free allowance → consume one, charge nothing.
        user.freeDesignsUsed += 1;
        await user.save();
        // Recorded against the address as well as the account, so deleting the
        // account and signing up again does not reset the allowance.
        await recordFreeDesignUsed(user.email);
        held.freeDesign = true;
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
      render_source: typeof renderSource === "string" ? renderSource : "",
      // Always 0, so the same photo and the same choices reproduce the same
      // design. Older app builds still send a timestamp here, which made every
      // render a re-roll of its own seed and meant a design could never be
      // reproduced. The inference hosts drop it too — this is the same rule
      // stated at the layer that can be fixed without an app release.
      // ALLOW_DESIGN_VARIATION=1 restores it for a real "try another" control.
      variation:
        process.env.ALLOW_DESIGN_VARIATION === "1" && Number.isFinite(Number(variation))
          ? Number(variation)
          : 0,
    };

    // Modal first, RunPod second. Whatever was held above is given back on every
    // path out of here that does not end in a picture, including this one — the
    // GPU bill for a failed render is ours, not the customer's.
    //
    // RunPod is a fallback for a Modal that *could not take the work*: not
    // configured, unreachable, or it rejected the request. Once Modal has
    // accepted a job the GPU is running and is billed whether or not this
    // process is still listening, so sending the same design to a second
    // provider does not rescue anything — it just buys the picture twice.
    let result = null;
    let host = "modal";

    console.log("Submitting job to Modal");
    try {
      result = await generateWithModal(payload);
    } catch (modalError) {
      if (modalError.modalCommitted) {
        console.error("Modal job was accepted but never returned:", modalError.message);
        return res.status(504).json({
          message: "Your design is taking longer than expected. Please try again in a moment.",
        });
      }
      console.error(
        "Modal could not take this design, falling back to RunPod:",
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

    // Both engines throw rather than answer with an empty image, so this is a
    // belt-and-braces check — but it has to be a failure rather than a design row
    // with nothing in it. An answer with no picture used to come back as a 201
    // that the app then reported as "Design Generation Failed", which is a charge
    // for a render the person was told had failed.
    if (!generatedImageBase64) {
      console.error(`${host} returned no generated image`);
      return res.status(502).json({ message: "AI service failed. Please try again." });
    }

    console.log(
      `Design generated by ${host}:`,
      `engine=${result.engine || "unknown"}`,
      `model=${result.model || "unknown"}`,
      `imageLen=${generatedImageBase64.length}`,
    );

    // Upload AI-generated image to Cloudinary
    const dataUri = `data:image/png;base64,${generatedImageBase64}`;
    const generatedResponse = await cloudinary.uploader.upload(dataUri, {
      folder: "generated_images",
    });
    const generatedImageUrl = generatedResponse.secure_url;
    const generatedImagePublicId = generatedResponse.public_id;
    console.log("Uploaded AI-generated image to Cloudinary:", { generatedImageUrl, generatedImagePublicId });

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

    // There is a picture, saved, with a URL. The hold above is now earned.
    delivered = true;

    res.status(201).json({
      image: newDesign.image,
      generatedImage: newDesign.generatedImage,
      roomType: newDesign.roomType,
      designStyle: newDesign.designStyle,
      colorTone: newDesign.colorTone,
      // What this actually cost and what is left. The app used to subtract the
      // price from its own copy of the balance after a successful render, which
      // meant two devices — or one device and a refund — drifted apart until the
      // next fetch of /me. The charge happened here, so the new balance ships
      // back with the result.
      charged: user.isSubscribed || user.isPremium ? 0 : price,
      adCoins: user.adCoins || 0,
      freeDesignsUsed: user.freeDesignsUsed || 0,
    });
  } catch (error) {
    console.error("POST /designs error:", error);
    res.status(500).json({ message: error.message || "Something went wrong" });
  } finally {
    // Stop defending the slot before releasing it. A beat already awaiting the
    // database can still land after the release, and is harmless when it does:
    // it matches on the lease id, which the release has already cleared, so it
    // updates nothing rather than marking an idle account busy again.
    if (heartbeat) clearInterval(heartbeat);

    // No picture, no charge. This covers the ways out that are known — a refused
    // paywall, both engines down, an answer with no image, a Cloudinary or
    // database throw — and, more to the point, the ones added later, because a
    // new `return` in this handler now refunds by default instead of by being
    // remembered.
    if (!delivered) {
      const owed = held.coins || held.freeDesign || held.day;
      if (owed) {
        console.log(
          `Refunding a failed render for user ${req.user._id}:`,
          held.coins ? `${held.coins} coin(s)` : held.freeDesign ? "1 free design" : "no charge",
          held.day ? `and its count against ${held.day}` : "",
        );
      }
      await refundRender(req.user._id, held);
    }

    // The next render on this account waits on this line, so it runs whether or
    // not there was a picture. The answer above has already been sent, and a slot
    // held past the response is an account that cannot render again until the
    // lease expires.
    await releaseRenderSlot(req.user._id, held.lease);
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
