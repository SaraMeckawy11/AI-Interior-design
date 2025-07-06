import express from "express";
import axios from "axios";
import cloudinary from "../lib/cloudinary.js";
import Design from "../models/Design.js";
import User from "../models/User.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";

const router = express.Router();

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

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (!user.isSubscribed && user.freeDesignsUsed >= 2) {
      return res.status(403).json({
        message: "Upgrade required",
        reason: "You have used your 2 free designs. Please upgrade to continue.",
      });
    }

    // Upload original image to Cloudinary
    const uploadedResponse = await cloudinary.uploader.upload(image);
    const imageUrl = uploadedResponse.secure_url;
    const imagePublicId = uploadedResponse.public_id;

    // Convert image to base64
    const imageBase64 = await getImageBase64FromUrl(imageUrl);

    // AI generation API call to Hugging Face
    let generatedImageBase64;
    try {
      console.log("📤 Sending request to Hugging Face AI API...");
      const aiResponse = await axios.post(
        "https://SaraMeckawy-Interior.hf.space/generate",
        {
          image: imageBase64,
          room_type: roomType,
          design_style: designStyle,
          color_tone: colorTone,
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 120000, // Optional: prevent hanging
        }
      );
      generatedImageBase64 = aiResponse.data.generatedImage;
      console.log("✅ AI image generated successfully");
    } catch (err) {
      console.error("❌ AI server error:", err.response?.data || err.message);
      return res.status(err.response?.status || 500).json({
        message: err.response?.data?.message || "AI server error",
      });
    }

    // Upload generated image
    let generatedImageUrl = null;
    let generatedImagePublicId = null;

    if (generatedImageBase64) {
      const dataUri = `data:image/png;base64,${generatedImageBase64}`;
      const generatedResponse = await cloudinary.uploader.upload(dataUri, {
        folder: "generated_images",
      });
      generatedImageUrl = generatedResponse.secure_url;
      generatedImagePublicId = generatedResponse.public_id;
    }

    // Save design
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

export default router;
