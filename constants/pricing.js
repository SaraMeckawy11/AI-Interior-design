/**
 * What things cost.
 *
 * Livinai is paid for in two ways, and a person picks one:
 *
 *  1. **A subscription** — monthly or yearly. Unlimited renders, no ads, no
 *     counting. This is for people who use the app.
 *  2. **Coins** — bought in packs, or earned one at a time by watching a
 *     rewarded ad. This is for people who want three renders and then to be left
 *     alone, and it is the only route that costs them nothing.
 *
 * Every number below used to be a literal, in six files, disagreeing. The
 * client checked `coins < 2` before letting someone press Generate; the server
 * charged `COST_PER_DESIGN = 2`; the upgrade screen's copy said "each design
 * costs 2 coins"; the ad granted 1. Change one of those and the other five kept
 * the old price — which is how a person could be shown a balance that let them
 * start a render the server then refused.
 *
 * `backend/src/config/pricing.js` is the same table for the server, and the
 * server is the authority: the client uses these numbers to *say* what something
 * will cost and to disable a button early, never to decide whether a charge
 * happened. The two files have to be edited together.
 */

/** One ad, one coin. Not two, and not a variable amount from the ad network. */
export const AD_COIN_REWARD = 1;

/** Renders every new account gets before any of this applies. */
export const FREE_DESIGNS = 2;

/**
 * The price list, in coins.
 *
 * A walkthrough render is three because that is roughly what it costs to make:
 * it runs the exporter, holds a GPU for the scene, and then does the same
 * image-to-image pass a flat design does. Charging the same for both would mean
 * the cheap path subsidising the expensive one, and the expensive one is the
 * reason anyone subscribes.
 */
export const COIN_COST = {
  design: 1,
  walkthrough: 3,
};

/** What a render of this kind costs, defaulting to the flat design price. */
export const coinCost = (product) => COIN_COST[product] ?? COIN_COST.design;

/**
 * Coin packs.
 *
 * `productId` is the store SKU — the same string has to exist in Google Play
 * Console and be attached to the matching RevenueCat product, or the pack
 * silently will not appear. `priceUsd` is a fallback for the price label only:
 * whenever the store answers, its own localised `priceString` wins, because a
 * hardcoded dollar figure shown to someone paying in rupees is wrong twice.
 *
 * The middle pack is the one most people should buy, so it is the one that gets
 * the badge — and it is priced so that per-coin it beats the small pack by
 * enough to be worth noticing.
 */
export const COIN_PACKS = [
  {
    id: "coins_10",
    productId: "livinai_coins_10",
    coins: 10,
    priceUsd: 1.99,
    badge: null,
  },
  {
    id: "coins_30",
    productId: "livinai_coins_30",
    coins: 30,
    priceUsd: 4.99,
    badge: "Most popular",
  },
  {
    id: "coins_100",
    productId: "livinai_coins_100",
    coins: 100,
    priceUsd: 12.99,
    badge: "Best value",
  },
];

/** Per-coin saving against the smallest pack, as a whole percentage. */
export const packSaving = (pack) => {
  const base = COIN_PACKS[0];
  const basePerCoin = base.priceUsd / base.coins;
  const perCoin = pack.priceUsd / pack.coins;
  return Math.round((1 - perCoin / basePerCoin) * 100);
};

/**
 * Subscriptions.
 *
 * Weekly is gone. A weekly plan on a product someone opens when they are
 * redecorating — a few evenings, months apart — bills eleven times for the two
 * they use it, and it is the shape of plan app stores get complaints about.
 * Monthly is the shortest honest commitment here, and yearly is priced at five
 * months of it so the saving is real rather than a rounded-up "80%".
 */
export const PLANS = [
  {
    id: "monthly",
    packageType: "MONTHLY",
    productId: "livinai_pro_monthly",
    title: "Monthly",
    priceUsd: 9.99,
    period: "month",
    badge: null,
  },
  {
    id: "yearly",
    packageType: "ANNUAL",
    productId: "livinai_pro_yearly",
    title: "Yearly",
    priceUsd: 59.99,
    period: "year",
    badge: "Best value",
  },
];

/** How much the yearly plan saves against twelve months of the monthly one. */
export const YEARLY_SAVING_PERCENT = (() => {
  const monthly = PLANS.find((plan) => plan.id === "monthly");
  const yearly = PLANS.find((plan) => plan.id === "yearly");
  return Math.round((1 - yearly.priceUsd / (monthly.priceUsd * 12)) * 100);
})();

/** "1 coin" / "3 coins", so the count and its noun never disagree. */
export const coinLabel = (count) => `${count} ${count === 1 ? "coin" : "coins"}`;
