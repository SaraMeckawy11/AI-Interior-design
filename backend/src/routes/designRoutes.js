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

// Helper to sleep
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

router.post("/", isAuthenticated, async (req, res) => {
  try {
    const { roomType, designStyle, colorTone, customPrompt, image } = req.body;

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

    // Submit job to RunPod
    const payload = {
      input: {
        image: imageBase64,
        room_type: roomType,
        design_style: designStyle,
        color_tone: colorTone,
        custom_prompt: customPrompt || "",
      },
    };

    console.log("Submitting job to RunPod:", { payload });

    const jobResponse = await axios.post(
      "https://api.runpod.ai/v2/9x2kmfa8z6483c/run",
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.RUNPOD_API_KEY}`,
        },
      }
    );

    const jobId = jobResponse.data.id;
    console.log("RunPod job submitted:", jobId, "initial status:", jobResponse.data.status);

    // Poll RunPod job until completed
    let generatedImageBase64 = null;
    const maxRetries = 30;
    let retries = 0;

    while (retries < maxRetries) {
      await sleep(2000); // wait 2 seconds

      const statusResp = await axios.get(
        `https://api.runpod.ai/v2/9x2kmfa8z6483c/status/${jobId}`,
        {
          headers: {
            "Authorization": `Bearer ${process.env.RUNPOD_API_KEY}`,
          },
        }
      );

      console.log(`Polling RunPod [attempt ${retries + 1}]:`, statusResp.data.status);

      if (statusResp.data.status === "COMPLETED") {
        generatedImageBase64 = statusResp.data.output.generatedImage;
        break;
      } else if (statusResp.data.status === "FAILED") {
        console.error("RunPod job failed:", statusResp.data);
        return res.status(500).json({ message: "RunPod job failed" });
      }

      retries++;
    }

    if (!generatedImageBase64) {
      console.warn("RunPod job did not complete in time, returning original image only");
    } else {
      console.log("Received generated image base64 length:", generatedImageBase64.length);
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
