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
