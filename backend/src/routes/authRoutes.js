import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";
import { sendToken } from "../../utils/sendToken.js";

const router = express.Router();


// ✅ Signup with email + password
router.post("/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }

    let existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      avatar: "",
    });

    await sendToken(user, res);
  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});


// ✅ Login with email + password
router.post("/login", async (req, res) => {
  try {
    const { email, password, signedToken } = req.body;

    // 🔹 Case 1: Google login with signedToken
    if (signedToken) {
      let data;
      try {
        data = jwt.verify(signedToken, process.env.JWT_SECRET);
      } catch (err) {
        return res.status(401).json({ success: false, message: "Invalid Google token" });
      }

      if (!data.email) {
        return res.status(400).json({ success: false, message: "Missing email in Google token" });
      }

      let user = await User.findOne({ email: data.email });
      if (!user) {
        user = await User.create({
          name: data.name || "Unnamed",
          email: data.email,
          avatar: data.avatar || "",
        });
      }

      return sendToken(user, res);
    }

    // 🔹 Case 2: Normal email+password login
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password required" });
    }

    const user = await User.findOne({ email }).select("+password");
    if (!user) {
      return res.status(400).json({ success: false, message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: "Invalid credentials" });
    }

    await sendToken(user, res);
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});


// ✅ Get Logged-In User
router.get("/me", isAuthenticated, async (req, res) => {
  try {
    res.status(200).json({ success: true, user: req.user });
  } catch (error) {
    console.error("Me route error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
