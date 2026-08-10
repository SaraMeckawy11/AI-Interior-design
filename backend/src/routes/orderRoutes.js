import express from "express";
import mongoose from "mongoose";
import Order from "../models/Order.js";
import User from "../models/User.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";
import axios from "axios";
import { packForProductId } from "../config/pricing.js";
import { grantCoins, purchaseReference, refundReference } from "../services/coins.js";
import { getActiveSubscription } from "../services/revenuecat.js";

const router = express.Router();

// RevenueCat API configuration
const REVENUECAT_API_KEY = process.env.REVENUECAT_API_KEY;
const REVENUECAT_URL = "https://api.revenuecat.com/v1/subscribers";

const billingCycleForProduct = (productId) => {
  const id = String(productId || "").toLowerCase();
  if (id.includes("year")) return "yearly";
  if (id.includes("week")) return "weekly";
  return "monthly";
};

async function syncSubscriptionFlag(userId) {
  const active = await Order.exists({
    user: userId,
    paymentStatus: "paid",
    isActive: true,
    endDate: { $gt: new Date() },
  });
  await User.findByIdAndUpdate(userId, { isSubscribed: Boolean(active) });
}

async function orderForEvent(userId, event, { allowProductFallback = true } = {}) {
  if (event.transaction_id) {
    const byTransaction = await Order.findOne({
      user: userId,
      transactionId: event.transaction_id,
    });
    if (byTransaction) return byTransaction;
  }

  if (allowProductFallback && event.product_id) {
    const byProduct = await Order.findOne({
      user: userId,
      plan: event.product_id,
    }).sort({ createdAt: -1 });
    if (byProduct) return byProduct;
  }

  return null;
}

/**
 * CREATE or UPSERT subscription
 */
router.post("/", isAuthenticated, async (req, res) => {
  try {
    const { productId, price, transactionId } = req.body || {};

    if (!productId || !transactionId) {
      return res.status(400).json({
        success: false,
        message: "Missing store product or transaction reference.",
      });
    }

    const verified = await getActiveSubscription(req.user._id, productId, transactionId);
    if (!verified) {
      return res.status(202).json({
        success: true,
        pending: true,
        message: "Purchase received. Pro will activate as soon as the store confirms it.",
      });
    }

    let order = await Order.findOne({
      user: req.user._id,
      transactionId: verified.transactionId,
    });
    if (!order) {
      await Order.updateMany(
        { user: req.user._id, isActive: true },
        { $set: { isActive: false } },
      );
      order = new Order({ user: req.user._id });
    }

    order.plan = verified.productId;
    order.price = Number.isFinite(Number(price)) ? Number(price) : 0;
    order.billingCycle = billingCycleForProduct(verified.productId);
    order.paymentStatus = "paid";
    order.startDate = new Date(verified.purchaseDate);
    order.endDate = new Date(verified.expiresDate);
    order.transactionId = verified.transactionId;
    order.entitlementId = verified.entitlementId;
    order.autoRenew = true;
    order.isActive = true;

    await order.save();
    await User.findByIdAndUpdate(req.user._id, { isSubscribed: true });

    res.status(201).json({ success: true, order });
  } catch (err) {
    console.error("Order creation failed:", err);
    const unavailable =
      err?.code === "REVENUECAT_NOT_CONFIGURED" || err?.response?.status >= 500;
    res.status(unavailable ? 503 : 500).json({
      success: false,
      message: unavailable
        ? "Store verification is temporarily unavailable. Pro will activate automatically if you were charged."
        : "Order creation failed.",
    });
  }
});

/**
 * GET latest subscription (even if expired)
 */
router.get("/latest", isAuthenticated, async (req, res) => {
  try {
    const latest = await Order.findOne({
      user: req.user._id,
      paymentStatus: "paid",
    }).sort({ createdAt: -1 });

    if (!latest) {
      await User.findByIdAndUpdate(req.user._id, { isSubscribed: false });
      return res.status(404).json({ success: false, message: "No subscription found." });
    }

    const isExpired = new Date(latest.endDate) < new Date();
    await User.findByIdAndUpdate(req.user._id, {
      isSubscribed: !isExpired && latest.isActive,
    });

    res.status(200).json({ success: true, order: latest });
  } catch (err) {
    console.error("Failed to fetch latest order:", err);
    res.status(500).json({ success: false, message: "Failed to fetch subscription." });
  }
});

/**
 * UPDATE latest order
 */
router.put("/update-latest", isAuthenticated, async (req, res) => {
  try {
    const latest = await Order.findOne({
      user: req.user._id,
      paymentStatus: "paid",
    }).sort({ createdAt: -1 });

    if (!latest) {
      return res.status(404).json({ success: false, message: "No order to update." });
    }

    const { plan, billingCycle, price, startDate, endDate, autoRenew, paymentStatus } = req.body;

    latest.plan = plan || latest.plan;
    latest.billingCycle = billingCycle || latest.billingCycle;
    latest.price = price || latest.price;
    latest.startDate = new Date(startDate || latest.startDate);
    latest.endDate = new Date(endDate || latest.endDate);
    latest.autoRenew = autoRenew ?? latest.autoRenew;
    latest.paymentStatus = paymentStatus || latest.paymentStatus;
    latest.isActive = paymentStatus === "paid";

    await latest.save();

    const isExpired = new Date(latest.endDate) < new Date();
    await User.findByIdAndUpdate(req.user._id, {
      isSubscribed: !isExpired && latest.isActive,
    });

    res.status(200).json({ success: true, order: latest });
  } catch (err) {
    console.error("Failed to update order:", err);
    res.status(500).json({ success: false, message: "Failed to update order." });
  }
});

/**
 * CANCEL latest active subscription
 */
router.post("/cancel-latest", isAuthenticated, async (req, res) => {
  try {
    const latestOrder = await Order.findOne({
      user: req.user._id,
      isActive: true,
      paymentStatus: "paid",
    }).sort({ createdAt: -1 });

    if (!latestOrder) {
      return res.status(404).json({ success: false, message: "No active subscription found." });
    }

    latestOrder.autoRenew = false;  // stop auto-renew
    latestOrder.canceledAt = new Date();
    await latestOrder.save();

    const isExpired = new Date(latestOrder.endDate) < new Date();
    if (isExpired) {
      await User.findByIdAndUpdate(req.user._id, { isSubscribed: false });
    }

    try {
      if (latestOrder.entitlementId) {
        await axios.post(
          `${REVENUECAT_URL}/${req.user._id}`,
          {
            subscriber_attributes: {
              auto_renew: { value: false },
              canceled_at: { value: new Date().toISOString() },
            },
          },
          {
            headers: {
              Authorization: `Bearer ${REVENUECAT_API_KEY}`,
              "Content-Type": "application/json",
            },
          }
        );
      }
    } catch (err) {
      console.error("RevenueCat cancellation sync failed:", err.message);
    }

    res.json({ success: true, message: "Auto-renew disabled." });
  } catch (error) {
    console.error("Cancel subscription failed:", error);
    res.status(500).json({ success: false, message: "Cancel failed." });
  }
});

/**
 * Payment history
 */
router.get("/history", isAuthenticated, async (req, res) => {
  try {
    const history = await Order.find({
      user: req.user._id,
      paymentStatus: "paid",
    }).sort({ createdAt: -1 });

    res.status(200).json({ success: true, orders: history });
  } catch (err) {
    console.error("Failed to fetch payment history:", err);
    res.status(500).json({ success: false, message: "Failed to fetch history." });
  }
});

/**
 * REVENUECAT WEBHOOK — enhanced logging
 */
router.post("/webhook", async (req, res) => {
  try {
    // Verify webhook secret
    const authHeader = req.headers.authorization;
    const webhookSecret = process.env.REVENUECAT_WEBHOOK_SECRET;
    if (!webhookSecret || authHeader !== `Bearer ${webhookSecret}`) {
      console.warn("Unauthorized RevenueCat webhook attempt:", req.headers);
      return res.status(401).json({ success: false, message: "Unauthorized webhook" });
    }

    // RevenueCat v1 wraps purchase fields in `event`. Accept the old flat
    // shape as well so saved dashboard test payloads keep working.
    const event = req.body?.event || req.body;
    if (!event?.type || !event?.app_user_id) {
      console.warn("Invalid RevenueCat event payload:", event);
      return res.status(400).json({ success: false, message: "Invalid RevenueCat event" });
    }

    // RevenueCat recommends checking the original id and aliases as well as
    // app_user_id because a purchase can move between those ids after login.
    const customerIds = [
      event.app_user_id,
      event.original_app_user_id,
      ...(Array.isArray(event.aliases) ? event.aliases : []),
    ].filter((id) => mongoose.isObjectIdOrHexString(id));

    const user = customerIds.length
      ? await User.findOne({ _id: { $in: customerIds } })
      : null;
    if (!user) {
      console.warn("RevenueCat webhook received for unknown user:", event.app_user_id);
      return res.status(200).json({ success: true, message: "Unknown user ignored." });
    }

    console.log("RevenueCat webhook received:", {
      type: event.type,
      userId: user._id,
      username: user.username,
      transactionId: event.transaction_id,
      entitlementId: event.entitlement_id,
      expirationDate: event.expiration_at_ms ? new Date(Number(event.expiration_at_ms)) : null,
    });

    switch (event.type) {
      /** A completed consumable purchase credits its pack exactly once. */
      case "NON_RENEWING_PURCHASE": {
        const pack = packForProductId(event.product_id);
        if (!pack) {
          console.warn("Non-renewing purchase of an unknown product:", event.product_id);
          break;
        }
        if (!event.transaction_id) {
          console.warn("Non-renewing purchase with no transaction id:", event.product_id);
          break;
        }

        const result = await grantCoins(user._id, {
          kind: "purchase",
          reference: purchaseReference(event.transaction_id),
          coins: pack.coins,
          meta: { packId: pack.id, productId: event.product_id, source: "webhook" },
        });

        console.log(
          result.credited
            ? `Credited ${pack.coins} coins to ${user._id} from webhook.`
            : `Coin purchase ${event.transaction_id} was already credited.`,
        );
        break;
      }

      /**
       * INITIAL PURCHASE or RENEWAL — always create new order
       */
      case "INITIAL_PURCHASE":
      case "RENEWAL": {
        // A consumable must never be mistaken for a subscription and grant Pro.
        if (packForProductId(event.product_id)) {
          console.warn("Coin product arrived as a subscription event, ignoring:", event.product_id);
          break;
        }
        if (!event.entitlement_id) {
          console.warn("Subscription product has no entitlement, ignoring:", event.product_id);
          break;
        }

        const endDate = event.expiration_at_ms
          ? new Date(Number(event.expiration_at_ms))
          : null;
        if (!endDate || Number.isNaN(endDate.getTime())) {
          console.warn("Subscription purchase has no valid expiration:", event.id);
          break;
        }

        let order = await orderForEvent(user._id, event, { allowProductFallback: false });
        if (!order) {
          await Order.updateMany(
            { user: user._id, isActive: true },
            { $set: { isActive: false } },
          );
          order = new Order({ user: user._id });
        }

        order.plan = event.product_id || "unknown";
        order.price = Number(event.price_in_purchased_currency ?? event.price ?? 0);
        order.billingCycle = billingCycleForProduct(event.product_id);
        order.paymentStatus = "paid";
        order.startDate = event.purchased_at_ms
          ? new Date(Number(event.purchased_at_ms))
          : new Date();
        order.endDate = endDate;
        order.transactionId = event.transaction_id || order.transactionId || `tx_${event.id}`;
        order.entitlementId = event.entitlement_id || null;
        order.autoRenew = true;
        order.isActive = endDate > new Date();

        await order.save();
        await syncSubscriptionFlag(user._id);

        console.log("Created new order for user:", user._id);
        break;
      }

      /**
       * CANCELLATION / UNCANCELLATION — update latest order
       */
      case "CANCELLATION":
      case "UNCANCELLATION": {
        // RevenueCat also uses CANCELLATION when a one-time purchase is
        // refunded. Reverse the pack once without touching subscription state.
        const pack = packForProductId(event.product_id);
        if (pack) {
          if (event.type === "CANCELLATION" && event.transaction_id) {
            const result = await grantCoins(user._id, {
              kind: "refund",
              reference: refundReference(event.transaction_id),
              coins: -pack.coins,
              meta: {
                packId: pack.id,
                productId: event.product_id,
                reason: event.cancel_reason || "store_refund",
                source: "webhook",
              },
            });
            console.log(
              result.credited
                ? `Removed ${pack.coins} coins from ${user._id} after a refund.`
                : `Refund ${event.transaction_id} was already applied.`,
            );
          }
          break;
        }

        const latestOrder = await orderForEvent(user._id, event);

        if (latestOrder) {
          if (event.type === "CANCELLATION") {
            // RevenueCat cancellation (system), keep subscription active until endDate
            latestOrder.autoRenew = false;
            latestOrder.isActive = true;
            // Do NOT set manualCancel here, only user-triggered cancel sets that
          } else if (event.type === "UNCANCELLATION") {
              // Re-enable auto-renew if subscription is still active
              latestOrder.autoRenew = true;
          }
          await latestOrder.save();
        } else {
          console.warn("No matching subscription order for:", event.type, event.product_id);
        }

        await syncSubscriptionFlag(user._id);

        break;
      }

      /**
       * EXPIRATION — mark latest order inactive
       */
      case "EXPIRATION": {
        const latestOrder = await orderForEvent(user._id, event);

        if (latestOrder) {
          latestOrder.isActive = false;
          latestOrder.autoRenew = false;
          await latestOrder.save();
        }

        // An old weekly expiration must not revoke a newer monthly/yearly plan.
        await syncSubscriptionFlag(user._id);
        console.log("Subscription expired for user:", user._id);
        break;
      }

      default:
        console.log("Unhandled RevenueCat event type:", event.type, "for user:", user._id);
        break;
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error("RevenueCat webhook error:", err);
    res.status(500).json({ success: false, message: "Webhook handling failed." });
  }
});

export default router;
