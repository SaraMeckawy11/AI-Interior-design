// models/PrePremium.js
import mongoose from "mongoose";

const PrePremiumSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  addedAt: { type: Date, default: Date.now },
});

export default mongoose.model("PrePremium", PrePremiumSchema);
