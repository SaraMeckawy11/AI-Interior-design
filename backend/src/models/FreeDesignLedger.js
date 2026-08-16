import mongoose from "mongoose";
import crypto from "crypto";

/**
 * How many free designs an address has already spent — kept apart from the
 * account, so that deleting the account does not hand the allowance back.
 *
 * `freeDesignsUsed` lives on the User row, which is the right place for it
 * while the account exists and the wrong place for it afterwards: deleting the
 * account deleted the only record that the two free renders had been taken, so
 * signing up again with the same address produced a fresh pair. Two taps in
 * Profile, and the free tier renewed itself indefinitely.
 *
 * Nothing here is personal data. The address is stored as an HMAC and never in
 * the clear, so a row survives the deletion without keeping anything the
 * deletion promised to remove: it can answer "has this address had its two?"
 * and cannot be read back into an address, listed, or joined to anything else.
 * That is the whole of what abuse prevention needs.
 */
const freeDesignLedgerSchema = new mongoose.Schema(
  {
    emailHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    used: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true },
);

/**
 * The key an address is recorded under.
 *
 * Keyed rather than salted-per-row on purpose: the point is to recognise an
 * address that comes back, which a per-row salt would make impossible. The
 * secret is what stops the hash being a lookup table — without it, a list of
 * candidate addresses could be hashed and compared.
 */
export function hashEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return null;

  const secret = process.env.FREE_DESIGN_LEDGER_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    // Better to stop recognising returning addresses than to write rows under a
    // key that changes between deploys and silently means nothing.
    console.warn("FREE_DESIGN_LEDGER_SECRET and JWT_SECRET are both unset; free-design ledger disabled.");
    return null;
  }

  return crypto.createHmac("sha256", secret).update(normalized).digest("hex");
}

const FreeDesignLedger = mongoose.model("FreeDesignLedger", freeDesignLedgerSchema);

export default FreeDesignLedger;
