
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
    // Cloudinary public IDs. The routes have always set these, but they were
    // missing from the schema, so Mongoose's strict mode silently dropped them
    // and deletion fell back to parsing the URL — which is wrong for assets in
    // a folder (`generated_images/abc` parses as just `abc`, so the original
    // was never actually removed).
    imagePublicId: {
      type: String,
    },
    generatedImagePublicId: {
      type: String,
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