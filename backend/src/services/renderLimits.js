import { randomUUID } from 'node:crypto';

import User from '../models/User.js';
import { MAX_RENDERS_PER_DAY, RENDER_LEASE_MS } from '../config/pricing.js';
import { releaseFreeDesign } from './freeDesigns.js';

/**
 * The guard behind "unlimited".
 *
 * Two limits, both on the account and neither on the wallet:
 *
 *  1. **One render in flight.** Held as a lease — an id and a timestamp on the
 *     user row — rather than as a counter, so a request whose process died
 *     releases it by expiring instead of by being cleaned up. Nobody
 *     redecorating renders two rooms at once, so this costs a real user nothing;
 *     what it stops is a login being shared or scripted, where the same coin
 *     balance is read by ten requests at once and every one of them finds it
 *     sufficient.
 *
 *     The lease is a *heartbeat*, not a deadline. It used to be written once and
 *     trusted for ten minutes, which meant a render killed by a deploy or an
 *     instance recycle left the account locked out for the rest of those ten
 *     minutes — every device idle, every one of them told a render was already
 *     running. The holder now refreshes the timestamp while it works, and the
 *     slot is free the moment that stops. See `renewRenderSlot`.
 *
 *  2. **A day's worth of renders**, for subscriptions only. Coins already meter
 *     themselves, one render at a time.
 *
 * Both are checked in the same atomic update as the claim. Reading a limit and
 * then acting on it in a second call is how two requests arriving together both
 * pass — which is the same race, in a different currency, either way.
 *
 * `backend/src/config/pricing.js` holds the numbers and the reasoning for them.
 */

/** The UTC day a moment belongs to, as `YYYY-MM-DD`. */
export const renderDay = (whenMs) => new Date(whenMs).toISOString().slice(0, 10);

/** Seconds until the next UTC midnight — when a spent day's count resets. */
const secondsUntilDayEnd = (whenMs) => {
  const now = new Date(whenMs);
  const midnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  return Math.max(1, Math.ceil((midnight - whenMs) / 1000));
};

/**
 * Take the account's render slot and count the render against its day, or
 * explain why neither happened.
 *
 * `capped` decides whether the daily ceiling applies — true for subscriptions,
 * false for renders paid in coins or drawn from the free allowance. The count is
 * kept either way: enforcing a number nobody has measured is guessing, and the
 * counter is what turns it into an observation.
 *
 * Resolves to `{ ok: true, lease, day }` — hand that `lease` to
 * `releaseRenderSlot` when the render is done, and that `day` to `refundRender`
 * if it failed — or to `{ ok: false, ... }` carrying the refusal, already worded
 * for the person who hit it.
 */
export async function claimRenderSlot(userId, { capped = false, nowMs = Date.now() } = {}) {
  const lease = randomUUID();
  const heldAt = new Date(nowMs);
  const staleBefore = new Date(nowMs - RENDER_LEASE_MS);
  const day = renderDay(nowMs);

  // Nothing is rendering, or what is rendering has stopped saying so. A missing
  // field matches `null` in Mongo, so accounts written before this existed — and
  // rows left holding a lease by the version that never refreshed one — are idle
  // rather than invisible.
  const slotFree = {
    $or: [{ renderLeaseAt: null }, { renderLeaseAt: { $lte: staleBefore } }],
  };
  const underDailyCap = capped ? { rendersToday: { $lt: MAX_RENDERS_PER_DAY } } : {};
  const take = { renderLeaseAt: heldAt, renderLeaseId: lease };

  // Already rendered today: take the slot and count one more, if the day has room.
  let user = await User.findOneAndUpdate(
    { _id: userId, renderDay: day, ...underDailyCap, ...slotFree },
    { $set: take, $inc: { rendersToday: 1 } },
    { new: true },
  ).select('rendersToday');

  // First render of a new UTC day, or of this account's life. The count starts
  // again at one, so the ceiling never has to be swept clear by anything.
  if (!user) {
    user = await User.findOneAndUpdate(
      { _id: userId, renderDay: { $ne: day }, ...slotFree },
      { $set: { ...take, renderDay: day, rendersToday: 1 } },
      { new: true },
    ).select('rendersToday');
  }

  // `day` goes back with the answer so a refund can name the day it is undoing:
  // a render that starts at 23:59 and fails at 00:01 must not take its coin back
  // out of tomorrow's allowance.
  if (user) return { ok: true, lease, day, rendersToday: user.rendersToday || 1 };

  // Neither update matched, so one of the two limits refused. Read the row to
  // find out which — this path is rare, and answering "no" without saying what
  // said no is how a fair-use stop reads as the app being broken.
  const current = await User.findById(userId).select('renderLeaseAt rendersToday');
  if (!current) return { ok: false, reason: 'missing', message: 'User not found' };

  if (current.renderLeaseAt && current.renderLeaseAt > staleBefore) {
    // How long the caller would have to wait if the holder never spoke again.
    // The old flat 15 seconds was a guess against a ten-minute hold, so "try
    // again shortly" was wrong by minutes; against a heartbeat it is a real
    // number, and small.
    const staleInSeconds = Math.max(
      1,
      Math.ceil((current.renderLeaseAt.getTime() + RENDER_LEASE_MS - nowMs) / 1000),
    );
    return {
      ok: false,
      reason: 'busy',
      retryAfterSeconds: staleInSeconds,
      message: 'A render is already running on this account',
      // Second person, because this is shown as-is.
      detail: 'One render at a time. Wait for the one in progress to finish, then try again.',
    };
  }

  return {
    ok: false,
    reason: 'daily',
    retryAfterSeconds: secondsUntilDayEnd(nowMs),
    limit: MAX_RENDERS_PER_DAY,
    used: current.rendersToday || 0,
    message: "Today's fair-use limit has been reached on this account",
    detail:
      `You have run ${current.rendersToday || 0} renders today, which is this plan's fair-use `
      + `limit of ${MAX_RENDERS_PER_DAY} a day. It resets at midnight UTC — and if you genuinely `
      + `need more than this, get in touch and we will lift it.`,
  };
}

/**
 * Say the render holding the slot is still running.
 *
 * This is what separates a slow render from a dead one. Without it the slot can
 * only be sized by guessing how long a render might take, and every guess is
 * wrong in both directions at once: too short and a real render loses its slot
 * mid-flight, too long — which is what shipped — and a render killed by a deploy
 * locks the account out for the rest of the window with nothing running at all.
 *
 * Matched on the lease id, so a render that already lost the slot to a
 * replacement cannot revive its claim by heartbeating into it. Returns whether
 * the lease is still ours, and never throws: a missed beat is not an error, it
 * is the next one's job.
 */
export async function renewRenderSlot(userId, lease, { nowMs = Date.now() } = {}) {
  if (!lease) return false;
  try {
    const result = await User.updateOne(
      { _id: userId, renderLeaseId: lease },
      { $set: { renderLeaseAt: new Date(nowMs) } },
    );
    return (result.matchedCount ?? result.n ?? 0) > 0;
  } catch (error) {
    console.warn(`Could not renew the render slot for user ${userId}:`, error.message);
    return false;
  }
}

/**
 * Give the slot back, whatever the render did.
 *
 * Matched on the exact lease this request took, so a claim that went stale and
 * was taken over by a later render is not released by the abandoned one arriving
 * late. Never throws: this runs in a `finally`, after the response, and a failure
 * to release must not become the error the user sees. The lease goes stale on its
 * own anyway.
 */
export async function releaseRenderSlot(userId, lease) {
  if (!lease) return;
  try {
    await User.updateOne(
      { _id: userId, renderLeaseId: lease },
      { $set: { renderLeaseAt: null, renderLeaseId: null } },
    );
  } catch (error) {
    console.warn(`Could not release the render slot for user ${userId}:`, error.message);
  }
}

/**
 * Give back everything a render charged for, because it did not deliver a
 * picture.
 *
 * A render is paid for before it runs — the coin has to be taken before the GPU
 * is asked, or an account with one coin could start ten renders. That makes the
 * charge a hold rather than a sale, and a hold on something that never arrived
 * has to come back: a person who watched an ad, spent the coin and got an error
 * has paid us for nothing, and they will not watch a second ad to find out
 * whether it happens twice.
 *
 * The GPU bill is ours in that case, not theirs. A render that failed after
 * Modal accepted the job did cost us money, and refunding it anyway is the only
 * version of this that is honest.
 *
 * Everything a render consumes is undone here, in one call, because undoing half
 * of it is the bug: a refunded coin that still burned a fair-use render, or a
 * returned free design on a day that stayed counted. The slot is not part of it —
 * that comes back on success too, and `releaseRenderSlot` is unconditional.
 *
 * Never throws, for the same reason as the release above.
 */
export async function refundRender(userId, { coins = 0, freeDesign = false, day = null } = {}) {
  try {
    if (coins > 0) {
      await User.updateOne({ _id: userId }, { $inc: { adCoins: coins } });
    }
    // Floored by the filter rather than by a read, so nothing can drive the
    // free-design count below zero and hand out an allowance twice.
    if (freeDesign) {
      await User.updateOne(
        { _id: userId, freeDesignsUsed: { $gt: 0 } },
        { $inc: { freeDesignsUsed: -1 } },
      );
      // The ledger is the copy that outlives the account, so it has to be
      // refunded too — otherwise a failed render would permanently cost a free
      // design that the account itself was given back.
      const owner = await User.findById(userId).select("email").lean();
      if (owner?.email) await releaseFreeDesign(owner.email);
    }
    if (day) {
      await User.updateOne(
        { _id: userId, renderDay: day, rendersToday: { $gt: 0 } },
        { $inc: { rendersToday: -1 } },
      );
    }
  } catch (error) {
    console.warn(`Could not refund the failed render for user ${userId}:`, error.message);
  }
}
