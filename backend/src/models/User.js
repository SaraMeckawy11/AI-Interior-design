import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      // unique: true,
    },
    // Normalised on the way in, so one address is one account however it was
    // typed. Mongoose applies `lowercase`/`trim` to query filters as well as to
    // writes, which is what makes every `findOne({ email })` in the app agree
    // with the unique index above it.
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      minlength: 6,
    },
    profileImage: {
      type: String,
      default: "",
    },
    googleSubject: {
      type: String,
      unique: true,
      sparse: true,
    },
    appleSubject: {
      type: String,
      unique: true,
      sparse: true,
    },
    orders: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Order",
      },
    ],
    //  Track number of free designs used
    freeDesignsUsed: {
      type: Number,
      default: 0,
    },
    // Track total number of designs created
    designCount: {
      type: Number,
      default: 0,  // lifetime total
    },
    activeDesigns: {
      type: Number,
      default: 0,  // currently not deleted
    },

    // Subscription status (paid users)
    isSubscribed: {
      type: Boolean,
      default: false,
    },
    // Manual Premium flag (friends/family accounts)
    isPremium: {
      type: Boolean,
      default: false,
    },
     manualDisabled: { 
      type: Boolean, 
      default: false 
    }, // manually disabled by admin
    adsWatched: { 
      type: Number, 
      default: 0 
    },
    adCoins: {
      type: Number,
      default: 0
    },

    // ── Fair use ───────────────────────────────────────────────────────────
    // Written only by `services/renderLimits.js`, and only through atomic
    // updates — never by `user.save()`, which would let two requests arriving
    // together each write the count they read.

    /** When the render running on this account took the slot; null when idle. */
    renderLeaseAt: {
      type: Date,
      default: null,
    },
    /** The UTC day `rendersToday` is counting, as `YYYY-MM-DD`. */
    renderDay: {
      type: String,
      default: "",
    },
    /** Renders started on `renderDay`. Counted for every account, capped only
     *  for subscriptions — coins meter themselves. */
    rendersToday: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

// Hash password before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function (userPassword) {
  return await bcrypt.compare(userPassword, this.password);
};

/** The address as it is stored: trimmed, lower case, never null. */
export const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The one account that owns this address.
 *
 * Every sign-in route has to resolve an identity the same way, because an
 * address that resolves to two different rows is two accounts for one person —
 * and everything hung off `user._id` splits with them. That is what happened to
 * the saved 3D plans: somebody signed up as `Sara@Gmail.com`, came back through
 * Google (which reports `sara@gmail.com`), and the lookup missed by case alone,
 * so a second account was created and the plans stayed with the first.
 *
 * The normalised lookup runs first and uses the unique index. Rows written
 * before the field was normalised cannot be found that way, so a miss falls back
 * to a case-insensitive match — and rewrites the row it finds, so each legacy
 * address pays for that scan once and is exact from then on.
 */
userSchema.statics.findByEmail = async function findByEmail(rawEmail, { withPassword = false } = {}) {
  const email = normalizeEmail(rawEmail);
  if (!email) return null;

  const find = (filter) => {
    const query = this.findOne(filter);
    return withPassword ? query.select("+password") : query;
  };

  const exact = await find({ email });
  if (exact) return exact;

  const legacy = await find({ email: new RegExp(`^${escapeRegExp(email)}$`, "i") });
  if (!legacy) return null;

  if (legacy.email !== email) {
    legacy.email = email;
    // A conflicting row already holding the normalised address means the two
    // accounts have to be merged by hand; returning the one we found still
    // beats creating a third.
    try {
      await legacy.save();
    } catch (error) {
      console.warn(`Could not normalise the email on user ${legacy._id}:`, error.message);
    }
  }
  return legacy;
};

const User = mongoose.model("User", userSchema);

export default User;
