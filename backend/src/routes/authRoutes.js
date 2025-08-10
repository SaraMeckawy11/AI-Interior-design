import express from "express";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";
import { sendToken } from "../../utils/sendToken.js";

const router = express.Router();

// Login Route
router.post("/login", async (req, res) => {
  try {
    const { signedToken } = req.body;

    if (!signedToken) {
      console.log("No token provided");
      return res.status(400).json({ success: false, message: "No token provided" });
    }

    console.log("Received signedToken:", signedToken);

    let data;
    try {
      data = jwt.verify(signedToken, process.env.JWT_SECRET);
      console.log("Decoded token data:", data);
    } catch (err) {
      console.log("JWT verification failed:", err.message);
      return res.status(401).json({ success: false, message: "Invalid token" });
    }

    if (!data.email) {
      console.log("Decoded token missing email");
      return res.status(400).json({ success: false, message: "Missing email in token" });
    }

    let user = await User.findOne({ email: data.email });
    if (user) {
      console.log("User found:", user.email);
    } else {
      console.log("Creating new user...");
      user = await User.create({
          username: data.name || "user" + Date.now(),  // add a fallback
        name: data.name || "Unnamed",
        email: data.email,
        avatar: data.avatar || "",
      });
      console.log("New user created:", user.email);
    }

    await sendToken(user, res);

  } catch (error) {
    console.error("Unhandled login error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});


// Get Logged-In User
router.get("/me", isAuthenticated, async (req, res) => {
  try {
    const user = req.user;
    res.status(200).json({ success: true, user });
  } catch (error) {
    console.error("Me route error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
