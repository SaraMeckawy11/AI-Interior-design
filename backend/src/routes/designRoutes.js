import axios from "axios";
import express from "express";
import cloudinary from "../lib/cloudinary.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";
import Design from "../models/Design.js";
import User from "../models/User.js";

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

    // ✅ Fetch user and check usage
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (!user.isSubscribed && user.freeDesignsUsed >= 2) {
      return res.status(403).json({
        message: "Upgrade required",
        reason: "You have used your 2 free designs. Please upgrade to continue.",
      });
    }

    // 🖼 Upload original image
    const uploadedResponse = await cloudinary.uploader.upload(image);
    const imageUrl = uploadedResponse.secure_url;
    const imagePublicId = uploadedResponse.public_id;

    const imageBase64 = await getImageBase64FromUrl(imageUrl);

    // 🤖 Call AI generation API
    let generatedImageBase64;
    try {
  // Clean and validate base64
  const cleanBase64 = imageBase64.replace(/(\r\n|\n|\r)/gm, '').trim();

  if (!cleanBase64 || cleanBase64.length < 1000) {
    throw new Error("Invalid or too short base64 image data.");
  }

  console.log("Calling AI API with base64 size:", cleanBase64.length);

  // Make the POST request to HuggingFace Space
  const aiResponse = await axios.post(
    `https://SaraMeckawy-InteriorAI.hf.space/api/predict/`,
    {
      data: [
        `data:image/png;base64,${cleanBase64}`,
        roomType,
        designStyle,
        colorTone
      ]
    },
    {
      headers: {
        "Content-Type": "application/json"
      },
      timeout: 120000
    }
  );

      generatedImageBase64 = aiResponse.data.generatedImage;
    } catch (err) {
      console.error("AI server error:", err.response?.data || err.message);
      return res.status(err.response?.status || 500).json({
        message: err.response?.data?.message || "AI server error",
      });
    }

    // 🖼 Upload AI-generated image
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

    // ✅ Filter designs by authenticated user
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
