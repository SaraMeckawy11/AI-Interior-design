import axios from "axios";
import express from "express";
import cloudinary from "../lib/cloudinary.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";
import Design from "../models/Design.js";
import User from "../models/User.js";
import Replicate from "replicate";

const router = express.Router();

// Initialize Replicate
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

async function getImageBase64FromUrl(url) {
  const response = await axios.get(url, { responseType: "arraybuffer" });
  const buffer = Buffer.from(response.data, "binary");
  return buffer.toString("base64");
}

router.post("/", isAuthenticated, async (req, res) => {
  try {
    const { roomType, designStyle, colorTone, customPrompt, image } = req.body;

    if (!roomType || !designStyle || !colorTone || !image) {
      return res.status(400).json({ message: "Please provide all required fields" });
    }

    // ✅ Fetch user and check usage
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (!user.isSubscribed && user.freeDesignsUsed >= 2) {
      return res.status(403).json({
        message: "Upgrade required",
        reason: "You have used your 2 free designs. Please upgrade to continue.",
      });
    }

    // 🖼 Upload original image to Cloudinary
    const uploadedResponse = await cloudinary.uploader.upload(image);
    const imageUrl = uploadedResponse.secure_url;
    const imagePublicId = uploadedResponse.public_id;

    const imageBase64 = await getImageBase64FromUrl(imageUrl);

    // 🤖 Call Replicate model
    let generatedImageUrl = null;
    let generatedImagePublicId = null;
    try {
      const output = await replicate.run(
        "sarameckawy11/interio:1fbfbf09617971b972bd0162345bad5277f46579d16b47ede789251ecaaa9cca",
        {
          input: {
      image_base64: `data:image/png;base64,${imageBase64}`,
            room_type: roomType,
            design_style: designStyle,
            color_tone: colorTone,
            prompt: customPrompt || ""
          }
        }
      );

      if (output && output.length > 0) {
        // Replicate usually returns URLs
        const aiImageUrl = output[0];

        // Download AI image and convert to Base64
        const aiImageBase64 = await getImageBase64FromUrl(aiImageUrl);

        // Upload AI-generated image to Cloudinary
        const generatedResponse = await cloudinary.uploader.upload(
          `data:image/png;base64,${aiImageBase64}`,
          { folder: "generated_images" }
        );
        generatedImageUrl = generatedResponse.secure_url;
        generatedImagePublicId = generatedResponse.public_id;
      }
    } catch (err) {
      console.error("Replicate API error:", err.message || err);
      return res.status(500).json({ message: "Error generating design" });
    }

    // 💾 Save design to DB
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
    });

    await newDesign.save();

    // ➕ Increment freeDesignsUsed if not subscribed
    if (!user.isSubscribed) {
      user.freeDesignsUsed += 1;
      await user.save();
    }

    res.status(201).json({
      image: newDesign.image,
      generatedImage: newDesign.generatedImage,
      roomType: newDesign.roomType,
      designStyle: newDesign.designStyle,
      colorTone: newDesign.colorTone,
    });
  } catch (error) {
    console.error("POST /designs error:", error.message || error);
    res.status(500).json({ message: error.message || "Something went wrong" });
  }
});

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

    const output = designs.map(design => ({
      generatedImage: design.generatedImage,
      image: design.image,
      roomType: design.roomType,
      designStyle: design.designStyle,
      colorTone: design.colorTone,
      user: design.user,
      createdAt: design.createdAt,
      _id: design._id
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

router.get("/user", isAuthenticated, async (req, res) => {
  try {
    const designs = await Design.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.json(designs);
  } catch (error) {
    console.error("GET /designs/user error:", error.message || error);
    res.status(500).json({ message: "Server error" });
  }
});

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

    res.json({ message: "Design deleted successfully" });

  } catch (error) {
    console.error("DELETE /designs/:id error:", error.message || error);
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
