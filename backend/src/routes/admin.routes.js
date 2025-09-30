import express from "express";
import PrePremium from "../models/PrePremium.js";

const router = express.Router();

/**
 * @route POST /admin/pre-premium
 * @desc Add one or multiple emails to the PrePremium list
 * @access Private (should be admin-only)
 */
router.post("/pre-premium", async (req, res) => {
  try {
    const { emails } = req.body; // 👈 accept array of emails

    if (!emails || !Array.isArray(emails)) {
      return res.status(400).json({ success: false, message: "Emails array required" });
    }

    const inserted = [];
    for (let email of emails) {
      email = email.toLowerCase().trim();
      if (!email) continue;

      const exists = await PrePremium.findOne({ email });
      if (!exists) {
        await PrePremium.create({ email });
        inserted.push(email);
      }
    }

    res.json({ success: true, message: "Emails added to PrePremium", inserted });
  } catch (error) {
    console.error("Admin pre-premium error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/**
 * @route GET /admin/pre-premium
 * @desc Get all pre-premium emails
 */
router.get("/pre-premium", async (req, res) => {
  try {
    const list = await PrePremium.find().sort({ addedAt: -1 });
    res.json({ success: true, list });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/**
 * @route DELETE /admin/pre-premium/:email
 * @desc Remove email from pre-premium
 */
router.delete("/pre-premium/:email", async (req, res) => {
  try {
    const { email } = req.params;
    await PrePremium.deleteOne({ email: email.toLowerCase().trim() });
    res.json({ success: true, message: `Removed ${email} from PrePremium` });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;
