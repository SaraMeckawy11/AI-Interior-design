import CoinGrant from '../models/CoinGrant.js';
import User from '../models/User.js';

/** Duplicate-key, from either the unique index or a racing upsert. */
export const isDuplicate = (error) => error?.code === 11000;

/**
 * The idempotency key for a bought pack.
 *
 * Two paths credit a coin purchase — the app, straight after the store returns,
 * and RevenueCat's webhook — and either one may be the only one that runs: the
 * app path loses to a phone killed between the charge and the request, and the
 * webhook loses to a server that was down. They must therefore both be allowed
 * to fire and agree on what they are crediting, which they do by deriving the
 * same reference from the same RevenueCat transaction id. Whichever arrives
 * second collides on the grant index and pays nothing.
 */
export const purchaseReference = (transactionId) =>
  `purchase-${String(transactionId).slice(0, 110)}`;

/** A refund is a separate idempotent adjustment from the original purchase. */
export const refundReference = (transactionId) =>
  `refund-${String(transactionId).slice(0, 112)}`;

/**
 * Add coins to an account exactly once.
 *
 * The grant row is written *first*. If it collides with the unique index this
 * is a replay — the same ad reported twice, or a purchase the app retried after
 * a dropped response — and the balance is returned untouched rather than
 * incremented a second time. That ordering is the whole mechanism: crediting
 * first and recording afterwards leaves a window in which a crash pays twice.
 *
 * This lives here rather than beside the route that first needed it because the
 * webhook credits coins too, and two copies of "add coins, but only once" is
 * exactly the kind of duplication that ends with one of them forgetting the
 * grant row.
 */
export async function grantCoins(userId, { kind, reference, coins, meta }) {
  try {
    await CoinGrant.create({ user: userId, kind, reference, coins, meta });
  } catch (error) {
    if (isDuplicate(error)) {
      const user = await User.findById(userId).select('adCoins adsWatched');
      return { credited: false, adCoins: user?.adCoins || 0, adsWatched: user?.adsWatched || 0 };
    }
    throw error;
  }

  const user = await User.findByIdAndUpdate(
    userId,
    { $inc: { adCoins: coins, ...(kind === 'ad' ? { adsWatched: 1 } : {}) } },
    { new: true },
  ).select('adCoins adsWatched');

  return { credited: true, adCoins: user?.adCoins || 0, adsWatched: user?.adsWatched || 0 };
}
