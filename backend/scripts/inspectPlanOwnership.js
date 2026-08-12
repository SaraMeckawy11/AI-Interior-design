/**
 * Who actually owns the saved 3D plans.
 *
 * Read only. It writes nothing and changes nothing.
 *
 *     MONGO_URI="mongodb+srv://..." node backend/scripts/inspectPlanOwnership.js
 *
 * ## Why this exists
 *
 * Every read path for a plan is already scoped to the signed-in account —
 * `GET /walkthrough/plans` filters on `user: req.user._id`, `GET
 * /walkthrough/plans/:id` filters on both `_id` and `user`, and the device's
 * copy lives under a storage key containing the user id. So a plan cannot cross
 * between two accounts by being *fetched* wrongly. Which leaves exactly three
 * ways for one account to show another's plans, and this script tells them
 * apart:
 *
 *  1. **They are one account.** Two sign-ins resolving to a single row — the
 *     same Google or Apple identity reached from two addresses, or two rows
 *     merged by normalisation. Then nothing leaked: there is one account, and
 *     it has one library. Look for a row below owning plans the person thinks
 *     belong to two different logins.
 *  2. **The rows are genuinely misfiled.** A plan carrying the wrong `user`.
 *     `DUPLICATE clientId` and `ORPHAN` below catch this.
 *  3. **Neither** — the accounts are separate and the plans are filed
 *     correctly, so the wrong library is being shown on the device rather than
 *     sent by the server. That points the search at the app, not the API.
 *
 * Emails are masked in the output; this prints enough to identify a row without
 * putting anybody's full address in a terminal log.
 */

import dotenv from "dotenv";
import mongoose from "mongoose";

import User, { normalizeEmail } from "../src/models/User.js";
import WalkthroughPlan from "../src/models/WalkthroughPlan.js";

dotenv.config();

/** `sara@gmail.com` → `sa••@gmail.com`. Enough to recognise, not to publish. */
const mask = (email) => {
  const value = String(email || "");
  const at = value.indexOf("@");
  if (at < 1) return value || "(none)";
  const name = value.slice(0, at);
  const head = name.slice(0, Math.min(2, name.length));
  return `${head}${"•".repeat(Math.max(1, name.length - head.length))}${value.slice(at)}`;
};

const main = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set.");
  await mongoose.connect(process.env.MONGO_URI);

  const users = await User.find({})
    .select("email username createdAt googleSubject appleSubject password")
    .sort({ createdAt: 1 })
    .lean();
  const plans = await WalkthroughPlan.find({})
    .select("user clientId title updatedAt")
    .sort({ updatedAt: -1 })
    .lean();

  const byUser = new Map(users.map((user) => [String(user._id), user]));
  const plansFor = new Map();
  for (const plan of plans) {
    const key = String(plan.user);
    if (!plansFor.has(key)) plansFor.set(key, []);
    plansFor.get(key).push(plan);
  }

  console.log(`${users.length} accounts, ${plans.length} saved 3D plans\n`);

  for (const user of users) {
    const id = String(user._id);
    const owned = plansFor.get(id) || [];
    const signIns = [
      user.password ? "password" : null,
      user.googleSubject ? "google" : null,
      user.appleSubject ? "apple" : null,
    ].filter(Boolean).join(" + ") || "none";

    console.log(`${id}  ${mask(user.email)}`);
    console.log(`  username "${user.username}"  signs in with: ${signIns}`);
    console.log(`  ${owned.length} plan${owned.length === 1 ? "" : "s"}`);
    for (const plan of owned) {
      console.log(`    "${plan.title}"  clientId=${plan.clientId}  updated ${plan.updatedAt?.toISOString?.() || plan.updatedAt}`);
    }
    console.log("");
  }

  // ── The three explanations, tested ──────────────────────────────────────

  const problems = [];

  // 1. One account reached from what looks like two.
  const bySubject = new Map();
  for (const user of users) {
    for (const field of ["googleSubject", "appleSubject"]) {
      if (!user[field]) continue;
      const key = `${field}:${user[field]}`;
      if (!bySubject.has(key)) bySubject.set(key, []);
      bySubject.get(key).push(user);
    }
  }
  for (const [key, group] of bySubject) {
    if (group.length > 1) {
      problems.push(`SHARED IDENTITY  ${key} is on ${group.length} accounts: ${group.map((u) => mask(u.email)).join(", ")}`);
    }
  }

  const byEmail = new Map();
  for (const user of users) {
    const key = normalizeEmail(user.email);
    if (!key) continue;
    if (!byEmail.has(key)) byEmail.set(key, []);
    byEmail.get(key).push(user);
  }
  for (const [key, group] of byEmail) {
    if (group.length > 1) {
      problems.push(`DUPLICATE EMAIL  ${mask(key)} is on ${group.length} accounts: ${group.map((u) => String(u._id)).join(", ")}`);
    }
  }

  // 2. Plans filed against the wrong owner, or against nobody.
  for (const plan of plans) {
    if (!byUser.has(String(plan.user))) {
      problems.push(`ORPHAN  plan "${plan.title}" (${plan._id}) belongs to user ${plan.user}, which does not exist`);
    }
  }

  const byClientId = new Map();
  for (const plan of plans) {
    if (!byClientId.has(plan.clientId)) byClientId.set(plan.clientId, []);
    byClientId.get(plan.clientId).push(plan);
  }
  for (const [clientId, group] of byClientId) {
    const owners = new Set(group.map((plan) => String(plan.user)));
    if (owners.size > 1) {
      problems.push(
        `DUPLICATE clientId  ${clientId} exists under ${owners.size} accounts (${[...owners].join(", ")}) `
        + `— the same device-generated plan was saved to more than one account`,
      );
    }
  }

  if (!problems.length) {
    console.log("No shared identities, no duplicate emails, no orphans, no plan saved under two accounts.");
    console.log("The plans are filed correctly and the accounts are separate — so the wrong library is");
    console.log("being shown on the device rather than sent by the API. Say so and I will chase it there.");
  } else {
    console.log("Found:\n");
    for (const problem of problems) console.log(`  ${problem}`);
  }
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
