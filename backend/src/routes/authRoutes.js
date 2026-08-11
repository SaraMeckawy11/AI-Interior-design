import express from "express";
import bcrypt from "bcryptjs";
import { OAuth2Client } from "google-auth-library";
import { createRemoteJWKSet, jwtVerify } from "jose";
import User from "../models/User.js";
import PrePremium from "../models/PrePremium.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";
import { sendToken } from "../../utils/sendToken.js";

const router = express.Router();
const googleClient = new OAuth2Client();
const appleJwks = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

const googleAudiences = () =>
  (process.env.GOOGLE_CLIENT_IDS || "")
    .split(",")
    .map((clientId) => clientId.trim())
    .filter(Boolean);

const isAllowedGoogleAudience = (audience, configuredAudiences) => {
  if (configuredAudiences.length) return configuredAudiences.includes(audience);

  const projectNumber = process.env.GOOGLE_CLOUD_PROJECT_NUMBER || "365853441307";
  return (
    typeof audience === "string" &&
    audience.startsWith(`${projectNumber}-`) &&
    audience.endsWith(".apps.googleusercontent.com")
  );
};

const displayNameFromApple = (fullName) => {
  if (!fullName || typeof fullName !== "object") return "Apple user";
  return [fullName.givenName, fullName.middleName, fullName.familyName]
    .filter(Boolean)
    .join(" ") || "Apple user";
};

const findOrCreateSocialUser = async ({
  provider,
  subject,
  email,
  username,
  profileImage = "",
}) => {
  const subjectField = provider === "apple" ? "appleSubject" : "googleSubject";
  let user = await User.findOne({ [subjectField]: subject });
  if (user) return user;

  if (!email) {
    const error = new Error("Your identity provider did not share an email address.");
    error.statusCode = 400;
    throw error;
  }

  user = await User.findOne({ email });
  if (user) {
    user[subjectField] = subject;
    if (!user.profileImage && profileImage) user.profileImage = profileImage;
    await user.save();
    return user;
  }

  const prePremium = await PrePremium.findOne({ email });
  return User.create({
    username: username || `${provider} user`,
    email,
    profileImage,
    [subjectField]: subject,
    isPremium: !!prePremium,
  });
};

// Sign up with email and password.
router.post("/signup", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, message: "User already exists" });
    }

    const prePremium = await PrePremium.findOne({ email });
    const user = await User.create({
      username,
      email,
      password,
      profileImage: "",
      isPremium: !!prePremium,
    });

    return sendToken(user, res);
  } catch (error) {
    console.error("Signup error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// Verify Google and Apple identity tokens on the server. The app never signs
// its own provider tokens and never contains a server secret.
router.post("/social", async (req, res) => {
  try {
    const { provider, identityToken, fullName } = req.body;
    if (!identityToken || !["google", "apple"].includes(provider)) {
      return res.status(400).json({
        success: false,
        message: "Provider and identity token are required",
      });
    }

    let socialIdentity;

    if (provider === "google") {
      const audiences = googleAudiences();
      const ticket = await googleClient.verifyIdToken({
        idToken: identityToken,
        ...(audiences.length ? { audience: audiences } : {}),
      });
      const payload = ticket.getPayload();
      if (
        !payload?.sub ||
        !payload.email ||
        payload.email_verified !== true ||
        !isAllowedGoogleAudience(payload.aud, audiences)
      ) {
        return res.status(401).json({
          success: false,
          message: "Google could not verify this email",
        });
      }

      socialIdentity = {
        provider,
        subject: payload.sub,
        email: payload.email,
        username: payload.name || payload.email.split("@")[0],
        profileImage: payload.picture || "",
      };
    } else {
      const { payload } = await jwtVerify(identityToken, appleJwks, {
        issuer: "https://appleid.apple.com",
        audience: process.env.APPLE_BUNDLE_ID || "com.livinai.app",
      });
      if (!payload.sub) {
        return res.status(401).json({ success: false, message: "Apple identity is invalid" });
      }

      socialIdentity = {
        provider,
        subject: payload.sub,
        email: typeof payload.email === "string" ? payload.email : null,
        username: displayNameFromApple(fullName),
      };
    }

    const user = await findOrCreateSocialUser(socialIdentity);
    return sendToken(user, res);
  } catch (error) {
    console.error("Social login error:", error.message);
    return res.status(error.statusCode || 401).json({
      success: false,
      message: error.statusCode
        ? error.message
        : "The identity token could not be verified",
    });
  }
});

// Log in with email and password.
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
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

    return sendToken(user, res);
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

router.get("/me", isAuthenticated, async (req, res) => {
  try {
    return res.status(200).json({ success: true, user: req.user });
  } catch (error) {
    console.error("Me route error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
