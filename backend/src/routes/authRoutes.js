import express from "express";
import bcrypt from "bcryptjs";
import { OAuth2Client } from "google-auth-library";
import { createRemoteJWKSet, jwtVerify } from "jose";
import User, { normalizeEmail } from "../models/User.js";
import PrePremium from "../models/PrePremium.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";
import { sendToken } from "../../utils/sendToken.js";
import { freeDesignsAlreadyUsed } from "../services/freeDesigns.js";

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

/**
 * The name Apple sent, or nothing.
 *
 * Apple returns `fullName` on the *first* authorization for an Apple ID and
 * never again — every later sign-in carries nulls, by design. This used to
 * answer "Apple user" for that case, which is how a real name became a
 * placeholder: the name arrived once, and any later sign-in overwrote nothing
 * because there was nothing to distinguish "Apple told us nothing this time"
 * from "this person is called Apple user". It returns null now, and the callers
 * decide what to fall back to.
 */
const displayNameFromApple = (fullName) => {
  if (!fullName || typeof fullName !== "object") return null;
  return (
    [fullName.givenName, fullName.middleName, fullName.familyName]
      .filter(Boolean)
      .join(" ") || null
  );
};

/** Names nobody chose, which a real one is always allowed to replace. */
const PLACEHOLDER_NAMES = new Set(["apple user", "google user", "user"]);

const isPlaceholderName = (name) =>
  !name || PLACEHOLDER_NAMES.has(String(name).trim().toLowerCase());

/**
 * A readable name from an address, for when the provider gave none.
 *
 * Apple's private relay addresses are random hex at
 * `@privaterelay.appleid.com`, so they are skipped — "K7x9m2qp" is not a better
 * greeting than a generic one.
 */
const nameFromEmail = (email) => {
  const local = String(email || "").split("@")[0];
  const domain = String(email || "").split("@")[1] || "";
  if (!local || domain.toLowerCase().endsWith("privaterelay.appleid.com")) return null;

  const cleaned = local
    .replace(/[._-]+/g, " ")
    .replace(/\d+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  if (!cleaned) return null;

  return cleaned
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

/**
 * Write a real name onto an account that is still carrying a placeholder.
 *
 * The name Apple sends once has to be captured whenever it arrives, because it
 * will not arrive again. A real name already on the account is never touched —
 * this only ever replaces a placeholder.
 */
const backfillName = async (user, incomingName) => {
  if (!incomingName || !isPlaceholderName(user.username)) return user;
  user.username = incomingName;
  await user.save();
  return user;
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
  if (user) return backfillName(user, username);

  const email = normalizeEmail(rawEmail);
  if (!email) {
    const error = new Error("Your identity provider did not share an email address.");
    error.statusCode = 400;
    throw error;
  }

  const resolvedName = username || nameFromEmail(email) || `${provider} user`;

  user = await User.findByEmail(email);
  if (user) {
    user[subjectField] = subject;
    if (!user.profileImage && profileImage) user.profileImage = profileImage;
    if (isPlaceholderName(user.username) && !isPlaceholderName(resolvedName)) {
      user.username = resolvedName;
    }
    await user.save();
    return user;
  }

  const prePremium = await PrePremium.findOne({ email });
  const freeDesignsUsed = await freeDesignsAlreadyUsed(email);
  try {
    return await User.create({
      username: resolvedName,
      email,
      profileImage,
      [subjectField]: subject,
      isPremium: !!prePremium,
      freeDesignsUsed,
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
    // Where this address left off, not zero. See services/freeDesigns.js.
    const freeDesignsUsed = await freeDesignsAlreadyUsed(email);
    let user;
    try {
      user = await User.create({
        username,
        email,
        password,
        profileImage: "",
        isPremium: !!prePremium,
        freeDesignsUsed,
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
