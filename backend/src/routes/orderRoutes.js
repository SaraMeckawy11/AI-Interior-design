import express from "express";
import Order from "../models/Order.js";
import User from "../models/User.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";

const router = express.Router();

// ✅ CREATE new subscription
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
    } = req.body;

    // ✅ Deactivate previous active subscriptions
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
      autoRenew: true,
      isActive: true,
    });

    const savedOrder = await newOrder.save();

    // ✅ Update user subscription status
    await User.findByIdAndUpdate(req.user._id, {
      isSubscribed: true,
    });

    res.status(201).json({ success: true, order: savedOrder });
  } catch (err) {
    console.error("Failed to create order:", err);
    res.status(500).json({ success: false, message: "Order creation failed." });
  }
});

// ✅ GET latest subscription (even if expired or inactive)
router.get("/latest", isAuthenticated, async (req, res) => {
  try {
    const latest = await Order.findOne({
      user: req.user._id,
      paymentStatus: "paid",
    }).sort({ createdAt: -1 });

    if (!latest) {
      // Ensure user marked unsubscribed if no subscriptions
      await User.findByIdAndUpdate(req.user._id, { isSubscribed: false });
      return res.status(404).json({ success: false, message: "No subscription found." });
    }

    const isExpired = new Date(latest.endDate) < new Date();

    // ✅ Sync subscription state with actual expiration
    await User.findByIdAndUpdate(req.user._id, {
      isSubscribed: !isExpired && latest.isActive,
    });

    res.status(200).json({ success: true, order: latest });
  } catch (err) {
    console.error("Failed to fetch latest order:", err);
    res.status(500).json({ success: false, message: "Failed to fetch subscription." });
  }
});

// ✅ UPDATE latest order
router.put("/update-latest", isAuthenticated, async (req, res) => {
  try {
    const latest = await Order.findOne({
      user: req.user._id,
      paymentStatus: "paid",
    }).sort({ createdAt: -1 });

    if (!latest) {
      return res.status(404).json({ success: false, message: "No order to update." });
    }

    const {
      plan,
      billingCycle,
      price,
      startDate,
      endDate,
      autoRenew,
    } = req.body;

    latest.plan = plan || latest.plan;
    latest.billingCycle = billingCycle || latest.billingCycle;
    latest.price = price || latest.price;
    latest.startDate = new Date(startDate || latest.startDate);
    latest.endDate = new Date(endDate || latest.endDate);
    latest.autoRenew = autoRenew ?? latest.autoRenew;

    await latest.save();

    // ✅ Recalculate subscription status
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

// ✅ CANCEL latest active subscription
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

    // ✅ Only set isSubscribed to false if endDate already passed
    const isExpired = new Date(latestOrder.endDate) < new Date();
    if (isExpired) {
      await User.findByIdAndUpdate(req.user._id, { isSubscribed: false });
    }

    res.json({ success: true, message: "Auto-renew disabled." });
  } catch (error) {
    console.error("Cancel subscription failed:", error);
    res.status(500).json({ success: false, message: "Cancel failed." });
  }
});

// ✅ GET all successful payment history
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

export default router;
