
import mongoose from "mongoose";

const designSchema = new mongoose.Schema(
  {
    image: {
      type: String,
      required: true,
    },
    generatedImage: {
      type: String, // AI-generated image URL (optional)
    },
    roomType: {
      type: String,
      required: true,
    },
    designStyle: {
      type: String,
      required: true,
    },
    colorTone: {
      type: String,
      required: true,
    },
    customPrompt: {
      type: String, // optional user prompt
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    username: {
      type: String,
      required: false, // not mandatory since old docs won’t have it
    },
  },
  { timestamps: true }
);

const Design = mongoose.model("Design", designSchema);

export default Design;