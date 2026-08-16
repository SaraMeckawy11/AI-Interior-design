import FreeDesignLedger, { hashEmail } from "../models/FreeDesignLedger.js";
import { FREE_DESIGNS } from "../config/pricing.js";

/**
 * The free-design allowance, as something an address owns rather than an
 * account.
 *
 * Every function here fails open — a ledger that cannot be read must never stop
 * somebody rendering. The cost of being wrong in that direction is one extra
 * free design; the cost of the other direction is a paying customer told they
 * have run out of an allowance they never used.
 */

/**
 * How many free designs this address has already spent, across every account it
 * has ever had. Seeded onto a new account so the count starts where the last one
 * left off.
 */
export async function freeDesignsAlreadyUsed(email) {
  const emailHash = hashEmail(email);
  if (!emailHash) return 0;

  try {
    const entry = await FreeDesignLedger.findOne({ emailHash }).select("used").lean();
    // Clamped: a ledger row from a build with a larger allowance must not leave
    // an account owing renders it can never work off.
    return Math.min(Math.max(entry?.used || 0, 0), FREE_DESIGNS);
  } catch (error) {
    console.warn("Could not read the free-design ledger:", error.message);
    return 0;
  }
}

/** Record that this address has taken one more free design. */
export async function recordFreeDesignUsed(email) {
  const emailHash = hashEmail(email);
  if (!emailHash) return;

  try {
    await FreeDesignLedger.updateOne(
      { emailHash },
      { $inc: { used: 1 } },
      { upsert: true },
    );
  } catch (error) {
    console.warn("Could not record a free design against the ledger:", error.message);
  }
}

/**
 * Give one back, when the render it was taken for failed.
 *
 * Floored by the filter rather than by a read, for the same reason the account's
 * own counter is: two refunds racing must not drive the total below zero and
 * hand out an allowance twice.
 */
export async function releaseFreeDesign(email) {
  const emailHash = hashEmail(email);
  if (!emailHash) return;

  try {
    await FreeDesignLedger.updateOne(
      { emailHash, used: { $gt: 0 } },
      { $inc: { used: -1 } },
    );
  } catch (error) {
    console.warn("Could not return a free design to the ledger:", error.message);
  }
}
