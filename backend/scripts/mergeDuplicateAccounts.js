/**
 * Find — and optionally merge — the accounts that were split by an unnormalised
 * email address.
 *
 * `User.email` used to be stored exactly as it was typed, and every sign-in
 * route looked it up the same way. So `Sara@Gmail.com` from the signup form and
 * `sara@gmail.com` from Google were two accounts for one person, and everything
 * keyed on `user._id` — designs, orders, coins, and the saved 3D walkthrough
 * plans — split between them. The address is normalised now (see
 * `models/User.js`), which stops new duplicates; the rows already written are
 * what this script is for.
 *
 * It reports by default and changes nothing. Merging is a decision about
 * somebody's data, so it has to be asked for:
 *
 *     node backend/scripts/mergeDuplicateAccounts.js            # report only
 *     node backend/scripts/mergeDuplicateAccounts.js --merge    # actually merge
 *
 * The oldest account of each set is kept, because it is the one whose id the
 * store receipts and RevenueCat aliases already point at. Owned rows are
 * repointed at it, the flags that can only ever be gained (premium, subscribed,
 * coins) are carried across, and the emptied duplicates are deleted.
 *
 * Nothing here needs to run on a schedule; it is a one-off for the accounts that
 * already exist.
 */

import dotenv from "dotenv";
import mongoose from "mongoose";

import CoinGrant from "../src/models/CoinGrant.js";
import Design from "../src/models/Design.js";
import Order from "../src/models/Order.js";
import User, { normalizeEmail } from "../src/models/User.js";
import WalkthroughPlan from "../src/models/WalkthroughPlan.js";

dotenv.config();

const OWNED = [
  { model: WalkthroughPlan, label: "3D plans" },
  { model: Design, label: "designs" },
  { model: Order, label: "orders" },
  { model: CoinGrant, label: "coin grants" },
];

const merging = process.argv.includes("--merge");

/** Accounts grouped by the address they *should* have had, duplicates only. */
const duplicateSets = async () => {
  const users = await User.find({})
    .select("email username createdAt isPremium isSubscribed adCoins adsWatched freeDesignsUsed googleSubject appleSubject password profileImage")
    .sort({ createdAt: 1 });

  const byEmail = new Map();
  for (const user of users) {
    const key = normalizeEmail(user.email);
    if (!key) continue;
    if (!byEmail.has(key)) byEmail.set(key, []);
    byEmail.get(key).push(user);
  }
  return [...byEmail.entries()].filter(([, group]) => group.length > 1);
};

const countOwned = async (userId) => {
  const counts = await Promise.all(
    OWNED.map(({ model }) => model.countDocuments({ user: userId })),
  );
  return OWNED.map(({ label }, index) => `${counts[index]} ${label}`).join(", ");
};

const merge = async (keeper, duplicate) => {
  for (const { model } of OWNED) {
    await model.updateMany({ user: duplicate._id }, { $set: { user: keeper._id } });
  }

  // Only ever upward: a person who paid on either account keeps what they paid
  // for, and a balance is the sum of the two rather than whichever we looked at
  // first.
  const update = {
    email: normalizeEmail(keeper.email),
    isPremium: keeper.isPremium || duplicate.isPremium,
    isSubscribed: keeper.isSubscribed || duplicate.isSubscribed,
    adCoins: (keeper.adCoins || 0) + (duplicate.adCoins || 0),
    adsWatched: (keeper.adsWatched || 0) + (duplicate.adsWatched || 0),
    freeDesignsUsed: Math.max(keeper.freeDesignsUsed || 0, duplicate.freeDesignsUsed || 0),
  };
  // A provider identity normally exists on only one of the two, which is the
  // whole shape of this bug: the email account and the Google account were never
  // joined. The stored password is already a hash, so it is copied with an
  // update rather than a `save()` — the pre-save hook would hash it a second
  // time and lock the person out.
  if (!keeper.googleSubject && duplicate.googleSubject) update.googleSubject = duplicate.googleSubject;
  if (!keeper.appleSubject && duplicate.appleSubject) update.appleSubject = duplicate.appleSubject;
  if (!keeper.password && duplicate.password) update.password = duplicate.password;
  if (!keeper.profileImage && duplicate.profileImage) update.profileImage = duplicate.profileImage;

  // The duplicate has to release its unique keys before the keeper can take
  // them, so it goes first.
  await duplicate.deleteOne();
  await User.updateOne({ _id: keeper._id }, { $set: update });
};

const main = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set.");
  await mongoose.connect(process.env.MONGO_URI);

  const sets = await duplicateSets();
  if (!sets.length) {
    console.log("No duplicate accounts found.");
    return;
  }

  console.log(
    `${sets.length} address${sets.length === 1 ? "" : "es"} with more than one account`
    + `${merging ? "" : " (report only — pass --merge to fix)"}:\n`,
  );

  for (const [email, group] of sets) {
    const [keeper, ...duplicates] = group;
    console.log(`${email}`);
    console.log(`  keep  ${keeper._id}  "${keeper.email}"  created ${keeper.createdAt?.toISOString()}  (${await countOwned(keeper._id)})`);
    for (const duplicate of duplicates) {
      console.log(`  merge ${duplicate._id}  "${duplicate.email}"  created ${duplicate.createdAt?.toISOString()}  (${await countOwned(duplicate._id)})`);
    }

    if (merging) {
      for (const duplicate of duplicates) await merge(keeper, duplicate);
      console.log(`  → merged into ${keeper._id}`);
    }
    console.log("");
  }
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
