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
router.post("/webhook", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${process.env.REVENUECAT_WEBHOOK_SECRET}`) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { type, app_user_id, transaction_id, expiration_at_ms } = req.body.event || {};

    if (!app_user_id || !transaction_id) {
      return res.status(400).json({ success: false, message: "Missing user or transaction ID" });
    }

    const user = await User.findById(app_user_id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const order = await Order.findOne({
      user: user._id,
      transactionId: transaction_id,
    }).sort({ createdAt: -1 });

    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    switch (type) {
      case "CANCELLATION":
        order.autoRenew = false;
        order.canceledAt = new Date();
        order.isActive = false;
        await order.save();
        await User.findByIdAndUpdate(user._id, { isSubscribed: false });
        break;

      case "RENEWAL":
        order.endDate = new Date(Number(expiration_at_ms));
        order.isActive = true;
        order.paymentStatus = "paid";
        await order.save();
        await User.findByIdAndUpdate(user._id, { isSubscribed: true });
        break;

      case "EXPIRATION":
        order.isActive = false;
        await order.save();
        await User.findByIdAndUpdate(user._id, { isSubscribed: false });
        break;

      default:
        console.log("Unhandled RevenueCat event:", type);
        break;
    }

    res.json({ success: true });
  } catch (err) {
    console.error("RevenueCat webhook error:", err);
    res.status(500).json({ success: false, message: "Webhook failed." });
  }
});

export default router;
