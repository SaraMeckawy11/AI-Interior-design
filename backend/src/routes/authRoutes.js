import express from "express";
import bcrypt from "bcryptjs";
import { OAuth2Client } from "google-auth-library";
import { createRemoteJWKSet, jwtVerify } from "jose";
import User, { normalizeEmail } from "../models/User.js";
import PrePremium from "../models/PrePremium.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";
import { sendToken } from "../../utils/sendToken.js";

const router = express.Router();

/** Kept in step with `minlength` on the User model's password field. */
const MIN_PASSWORD_LENGTH = 6;

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

/**
 * The account behind a verified Google or Apple identity.
 *
 * Three lookups, in the order that keeps one person to one account: the
 * provider's own subject (stable forever, survives an address change), then the
 * address, then creation. The address step is the one that matters here — a
 * person who signed up with an email and password and later taps "Sign in with
 * Google" has to land back on the account holding their designs and their saved
 * 3D plans, not on a fresh one that looks empty.
 */
const findOrCreateSocialUser = async ({
  provider,
  subject,
  email: rawEmail,
  username,
  profileImage = "",
}) => {
  const subjectField = provider === "apple" ? "appleSubject" : "googleSubject";
  let user = await User.findOne({ [subjectField]: subject });
  if (user) return user;

  const email = normalizeEmail(rawEmail);
  if (!email) {
    const error = new Error("Your identity provider did not share an email address.");
    error.statusCode = 400;
    throw error;
  }

  user = await User.findByEmail(email);
  if (user) {
    user[subjectField] = subject;
    if (!user.profileImage && profileImage) user.profileImage = profileImage;
    await user.save();
    return user;
  }

  const prePremium = await PrePremium.findOne({ email });
  try {
    return await User.create({
      username: username || `${provider} user`,
      email,
      profileImage,
      [subjectField]: subject,
      isPremium: !!prePremium,
    });
  } catch (error) {
    // Two devices completing the same first sign-in at once both reach this
    // line. The unique index decides; the loser reads the row the winner wrote
    // rather than failing a login that has already succeeded.
    if (error?.code !== 11000) throw error;
    const existing = await User.findOne({ [subjectField]: subject })
      || await User.findByEmail(email);
    if (existing) return existing;
    throw error;
  }
};

// Sign up with email and password.
router.post("/signup", async (req, res) => {
  try {
    const { username, password } = req.body;
    const email = normalizeEmail(req.body.email);

    if (!username || !email || !password) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }

    // Stated here rather than left to the schema. `minlength` on the model
    // raises a ValidationError, which the catch at the bottom turned into a 500
    // — so someone who chose a five-character password was told the server had
    // broken, with nothing to suggest that shortening the one thing they could
    // change would fix it.
    if (String(password).length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `Your password needs at least ${MIN_PASSWORD_LENGTH} characters.`,
      });
    }

    // Case-insensitive, so "Sara@Gmail.com" cannot become a second account
    // beside the "sara@gmail.com" this person already signed in with.
    const existingUser = await User.findByEmail(email);
    if (existingUser) {
      return res.status(400).json({ success: false, message: "User already exists" });
    }

    const prePremium = await PrePremium.findOne({ email });
    let user;
    try {
      user = await User.create({
        username,
        email,
        password,
        profileImage: "",
        isPremium: !!prePremium,
      });
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(400).json({ success: false, message: "User already exists" });
      }
      throw error;
    }

    return sendToken(user, res);
  } catch (error) {
    // Anything the schema rejects is something the person typed, so it is a 400
    // carrying the field's own message rather than a blanket 500.
    if (error?.name === "ValidationError") {
      const [first] = Object.values(error.errors || {});
      return res.status(400).json({
        success: false,
        message: first?.message || "Those details could not be used to create an account.",
      });
    }
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
    const { password } = req.body;
    const email = normalizeEmail(req.body.email);
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password required" });
    }

    const user = await User.findByEmail(email, { withPassword: true });
    if (!user) {
      return res.status(400).json({ success: false, message: "Invalid credentials" });
    }

    // An account created through Google or Apple has no password at all.
    // `bcrypt.compare` rejects on an undefined hash, which reached the client as
    // a 500 — and told someone who had simply forgotten which button they used
    // last time that the server was broken.
    if (!user.password) {
      return res.status(400).json({
        success: false,
        message: user.appleSubject
          ? "This account signs in with Apple. Use Sign in with Apple."
          : "This account signs in with Google. Use Sign in with Google.",
      });
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
