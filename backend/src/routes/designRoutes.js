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

router.post("/", isAuthenticated, async (req, res) => {
  try {
    const {
      roomType,
      designStyle,
      colorTone,
      customPrompt,
      image,
      // Guided-mode payload (drawn room polygons + canvas info). Used by the
      // inference worker to rasterize an ADE20K semantic mask and feed it as
      // ControlNet-Seg conditioning so each room lands exactly where drawn.
      rooms,
      canvas,
      mode,
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

    // Submit job to Modal (synchronous - no polling needed)
    const payload = {
      image: imageBase64,
      room_type: roomType,
      design_style: designStyle,
      color_tone: colorTone,
      custom_prompt: customPrompt || "",
      // Guided-mode spatial fields (optional, only populated by plan.jsx
      // when the user drew room outlines).
      rooms: Array.isArray(rooms) ? rooms : null,
      canvas: canvas && typeof canvas === "object" ? canvas : null,
      mode: typeof mode === "string" ? mode : "",
    };

    console.log("Submitting job to Modal endpoint");

    let generatedImageBase64 = null;
    try {
      const modalResp = await axios.post(
        process.env.MODAL_ENDPOINT_URL,
        payload,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.MODAL_API_KEY}`,
          },
          timeout: 180_000, // 3 min — covers worst-case cold start + inference
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        }
      );

      generatedImageBase64 = modalResp.data?.generatedImage || null;
      console.log(
        "Modal job completed:",
        "prompt=", modalResp.data?.prompt?.slice(0, 80),
        "has_window=", modalResp.data?.has_window,
        "imageLen=", generatedImageBase64?.length
      );
    } catch (err) {
      console.error(
        "Modal request failed:",
        err.response?.status,
        err.response?.data || err.message
      );
      return res.status(502).json({ message: "AI service failed. Please try again." });
    }

    if (!generatedImageBase64) {
      console.warn("Modal did not return a generated image");
      return res.status(502).json({ message: "AI service returned no image" });
    }

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
