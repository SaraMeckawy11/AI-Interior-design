import mongoose from "mongoose";

/**
 * Every coin that has ever been added to an account, and why.
 *
 * `User.adCoins` is a running balance, which is the right thing to read but the
 * wrong thing to trust on its own: `$inc` is happy to run twice. A grant row is
 * what makes crediting idempotent — the unique index on (user, reference) means
 * the second attempt at the same ad or the same receipt fails at the database
 * rather than quietly paying out again.
 *
 * It is also the only record of where a balance came from. Without it, "this
 * account has 340 coins" is unanswerable: bought, earned, or a bug?
 */
const coinGrantSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    /** 'ad' | 'purchase' | 'refund' | 'admin' */
    kind: {
      type: String,
      required: true,
      enum: ["ad", "purchase", "refund", "admin"],
    },
    /**
     * The thing being paid for, once.
     *
     * A store transaction id for a purchase; the ad network's reward id — or a
     * short time bucket, for clients that send none — for an ad. Unique per
     * account, never globally: two people can hold receipts from the same
     * sandbox and neither should block the other.
     */
    reference: {
      type: String,
      required: true,
    },
    coins: {
      type: Number,
      required: true,
    },
    /** Pack id, product id, ad unit — whatever is worth having in a dispute. */
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true },
);

coinGrantSchema.index({ user: 1, reference: 1 }, { unique: true });
// "How many ads has this account cashed in today" is asked on every reward.
coinGrantSchema.index({ user: 1, kind: 1, createdAt: -1 });

const CoinGrant = mongoose.model("CoinGrant", coinGrantSchema);

export default CoinGrant;
