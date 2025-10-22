import express from "express";
import Order from "../models/Order.js";
import User from "../models/User.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";
import axios from "axios";

const router = express.Router();

// RevenueCat API configuration
const REVENUECAT_API_KEY = process.env.REVENUECAT_API_KEY;
const REVENUECAT_URL = "https://api.revenuecat.com/v1/subscribers";

/**
 * CREATE or UPSERT subscription
 */
router.post("/", isAuthenticated, async (req, res) => {
  try {
    const {
      plan,
      price,
      billingCycle,
      startDate,
      endDate,
      paymentStatus,
      transactionId,
      entitlementId,
      autoRenew = true,
    } = req.body;

    const existingOrder = await Order.findOne({
      user: req.user._id,
      isActive: true,
      paymentStatus: "paid",
    }).sort({ createdAt: -1 });

    let order;
    if (existingOrder) {
      existingOrder.plan = plan || existingOrder.plan;
      existingOrder.billingCycle = billingCycle || existingOrder.billingCycle;
      existingOrder.price = price || existingOrder.price;
      existingOrder.startDate = new Date(startDate || existingOrder.startDate);
      existingOrder.endDate = new Date(endDate || existingOrder.endDate);
      existingOrder.transactionId = transactionId || existingOrder.transactionId;
      existingOrder.entitlementId = entitlementId || existingOrder.entitlementId;
      existingOrder.autoRenew = autoRenew;
      existingOrder.paymentStatus = paymentStatus || existingOrder.paymentStatus;
      existingOrder.isActive = paymentStatus === "paid";
      await existingOrder.save();
      order = existingOrder;
    } else {
      await Order.updateMany(
        { user: req.user._id, isActive: true },
        { $set: { isActive: false } }
      );

      const newOrder = new Order({
        user: req.user._id,
        plan,
        price,
        billingCycle,
        paymentStatus: paymentStatus || "paid",
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        transactionId,
        entitlementId,
        autoRenew,
        isActive: paymentStatus === "paid",
      });

      order = await newOrder.save();
    }

    if (paymentStatus === "paid") {
      await User.findByIdAndUpdate(req.user._id, { isSubscribed: true });
    } else {
      await User.findByIdAndUpdate(req.user._id, { isSubscribed: false });
    }

    // Sync to RevenueCat
    if (entitlementId && transactionId) {
      try {
        await axios.post(
          `${REVENUECAT_URL}/${req.user._id}`,
          {
            subscriber_attributes: {
              plan: { value: plan },
              transaction_id: { value: transactionId },
              entitlement_id: { value: entitlementId },
              auto_renew: { value: autoRenew },
              payment_status: { value: paymentStatus },
            },
          },
          {
            headers: {
              Authorization: `Bearer ${REVENUECAT_API_KEY}`,
              "Content-Type": "application/json",
            },
          }
        );
      } catch (err) {
        console.error("RevenueCat sync failed:", err.message);
      }
    }

    res.status(201).json({ success: true, order });
  } catch (err) {
    console.error("Order creation/update failed:", err);
    res.status(500).json({ success: false, message: "Order creation failed." });
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

    latestOrder.autoRenew = false;
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
 * REVENUECAT WEBHOOK — handles anonymous IDs
 */
router.post("/webhook", async (req, res) => {
  try {
    // Verify webhook secret
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${process.env.REVENUECAT_WEBHOOK_SECRET}`) {
      return res.status(401).json({ success: false, message: "Unauthorized webhook" });
    }

    const event = req.body;
    if (!event?.type || !event?.app_user_id) {
      return res.status(400).json({ success: false, message: "Invalid RevenueCat event" });
    }

    let appUserId = event.app_user_id;

    // Handle anonymous IDs ($RCAnonymousID:...)
    if (appUserId.startsWith("$RCAnonymousID:")) {
      console.log("Received anonymous RevenueCat webhook for:", appUserId);
      // skip syncing to DB or log separately if needed
      return res.status(200).json({ success: true, message: "Anonymous user, ignored." });
    }

    const user = await User.findById(appUserId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const order = await Order.findOne({ user: user._id, transactionId: event.transaction_id }).sort({ createdAt: -1 });

    switch (event.type) {
      case "INITIAL_PURCHASE":
      case "RENEWAL":
        if (order) {
          order.isActive = true;
          order.paymentStatus = "paid";
          order.endDate = event.expiration_at_ms ? new Date(Number(event.expiration_at_ms)) : order.endDate;
          order.autoRenew = true;
          await order.save();
        } else {
          const newOrder = new Order({
            user: user._id,
            plan: event.product_id || "unknown",
            price: 0,
            billingCycle: "unknown",
            paymentStatus: "paid",
            startDate: new Date(),
            endDate: event.expiration_at_ms ? new Date(Number(event.expiration_at_ms)) : null,
            transactionId: event.transaction_id,
            autoRenew: true,
            isActive: true,
          });
          await newOrder.save();
        }
        await User.findByIdAndUpdate(user._id, { isSubscribed: true });
        break;

      case "CANCELLATION":
      case "UNCANCELLATION":
        if (order) {
          order.autoRenew = event.type === "CANCELLATION" ? false : true;
          order.isActive = event.type !== "CANCELLATION";
          order.canceledAt = event.type === "CANCELLATION" ? new Date() : null;
          await order.save();
        }
        await User.findByIdAndUpdate(user._id, { isSubscribed: event.type !== "CANCELLATION" });
        break;

      case "EXPIRATION":
        if (order) {
          order.isActive = false;
          order.autoRenew = false;
          await order.save();
        }
        await User.findByIdAndUpdate(user._id, { isSubscribed: false });
        break;

      default:
        console.log("Unhandled RevenueCat event type:", event.type);
        break;
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error("RevenueCat webhook error:", err);
    res.status(500).json({ success: false, message: "Webhook handling failed." });
  }
});

export default router;
