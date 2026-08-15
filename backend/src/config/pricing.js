/**
 * What things cost — server side, and therefore authoritative.
 *
 * This is the twin of `constants/pricing.js` in the app. The app uses its copy
 * to label buttons and to disable one early; this copy decides whether an
 * account is actually charged. They have to be edited together, and where they
 * disagree the app is wrong.
 *
 * Nothing here trusts a number sent by the client. A request names a *product*
 * ("design", "walkthrough") and the price is looked up here — the price is never
 * read from the request body, because a client that can name its own price can
 * name zero.
 */

/** One ad, one coin. */
export const AD_COIN_REWARD = 1;

/** Renders every new account gets before coins or a subscription apply. */
export const FREE_DESIGNS = 2;

/** The price list, in coins. One coin, whatever you render. */
export const COIN_COST = {
  design: 1,
  walkthrough: 1,
};

/**
 * What a render costs.
 *
 * Anything unrecognised falls back to the flat design price rather than to
 * zero — an unknown product must not be free, and older app builds send no
 * product at all.
 */
export function coinCost(product) {
  return COIN_COST[product] ?? COIN_COST.design;
}

/**
 * Coin packs, keyed by the id the app sends when a purchase completes.
 *
 * The coin amount is taken from here and not from the request, so a tampered
 * client cannot credit itself a thousand coins for a $1.99 receipt.
 */
export const COIN_PACKS = {
  coins_10: { coins: 10, productId: "livinai_coins_10", priceUsd: 1.99 },
  coins_30: { coins: 30, productId: "livinai_coins_30", priceUsd: 4.99 },
  coins_100: { coins: 100, productId: "livinai_coins_100", priceUsd: 12.99 },
};

/**
 * Which pack a store product identifier refers to, or null for anything else.
 *
 * The app names a pack by its own id; RevenueCat's webhook names it by the Play
 * product, and Play now appends a purchase option — `livinai_coins_10:10-coins`
 * for a product whose option is named `10-coins`, the same `product:option`
 * shape subscriptions use. Everything before the colon is the product, so that
 * is what gets compared. Anything unrecognised returns null and is left alone:
 * a subscription arriving here must not be mistaken for coins.
 */
export function packForProductId(productId) {
  if (!productId) return null;
  const base = String(productId).split(":")[0];
  const found = Object.entries(COIN_PACKS).find(
    ([, pack]) => pack.productId === base,
  );
  return found ? { id: found[0], ...found[1] } : null;
}

/**
 * How many rewarded ads one account may cash in per day.
 *
 * Not a punishment — a floor under the ad network's own fraud checks. Watching
 * forty ads in an evening is not something a person redecorating a room does,
 * and without a cap the coin economy is only as strong as the weakest emulator.
 */
export const MAX_AD_COINS_PER_DAY = 20;

/**
 * How finely two "I watched an ad" calls are told apart.
 *
 * The reward event has been observed arriving twice for one ad — a listener
 * registered twice by a re-running effect will do it — and the account was
 * credited both times, which is the bug where one ad paid two coins. Grants are
 * now keyed, and a client that does not send a key gets one derived from this
 * time bucket, so two calls inside the same ten seconds are the same ad.
 */
export const AD_DEDUPE_WINDOW_MS = 10_000;

/**
 * Fair use, on the side of the ledger that has no meter.
 *
 * Coins bound themselves: a render costs one, and an account that has none
 * cannot start another. A subscription deliberately has no such stop — it is
 * sold as unlimited and should feel that way — which leaves every render a
 * subscriber starts billing an L40S against a fixed $9.99, or against a yearly
 * plan that nets nearer $4 a month. Nothing about an account being paid stops it
 * being scripted or shared.
 *
 * Neither number below is a price and neither is meant to be reached. Somebody
 * redecorating renders ten or twenty rooms in a month, one at a time, waiting for
 * each; a day that runs to forty is not that person, and two at once is not that
 * person either. They cap the worst case at a known figure and are invisible to
 * everyone else.
 */

/**
 * Renders one subscription may run in a day, counted per UTC day.
 *
 * Not applied to coin or free renders — those are already paid for one at a
 * time, and refusing somebody who bought a hundred coins the fiftieth render
 * they paid for would be taking their money and then rationing it. Their
 * renders are still counted, so the real distribution is on record before this
 * number is ever tuned.
 */
export const MAX_RENDERS_PER_DAY = 40;

/**
 * How long one account may hold the single render slot before the hold is
 * treated as abandoned.
 *
 * The slot is the limit that actually bites, and it does so on both sides of the
 * ledger. A day's ceiling bounds what a shared or scripted login can spend, but
 * only afterwards, and only for a subscription — it does nothing about ten
 * requests arriving at the same instant, each reading the same one-coin balance
 * and each finding it sufficient. One render in flight is what makes a balance
 * mean something, and it is free: nobody redecorating renders two rooms at once.
 *
 * A hold has to expire, because the process that took it can die — a deploy
 * mid-render, an unhandled throw, an instance recycled under the request — and a
 * hold that outlived its request would lock the account out permanently.
 *
 * This was ten minutes, chosen as "longer than any honest render". That is the
 * right way to size a hold that cannot say whether it is still alive, and it is
 * why people kept being told "one at a time" with every device idle: the render
 * that took the hold had died, and nothing could tell the difference between a
 * dead hold and a slow one until ten minutes had passed.
 *
 * So the hold now says so. A running render refreshes its lease every
 * `RENDER_LEASE_RENEW_MS`, and the window below is what counts as *stale* rather
 * than what counts as *long*: miss a couple of heartbeats and the slot is free.
 * A dead render is now cleared in about a minute instead of ten, and a genuinely
 * slow one holds the slot for as long as it actually runs, which the old fixed
 * window could not do either.
 */
export const RENDER_LEASE_MS = 75 * 1000;

/**
 * How often a running render says it is still there.
 *
 * Three heartbeats inside the staleness window, so a single missed one — a
 * hiccup on the database round trip, an event loop busy decoding a large
 * image — never hands the slot to somebody else while the render is still
 * going.
 */
export const RENDER_LEASE_RENEW_MS = 25 * 1000;
