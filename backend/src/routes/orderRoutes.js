import express from "express";
import Order from "../models/Order.js";
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

    // ✅ Prevent multiple active subscriptions
    const existing = await Order.findOne({
      user: req.user._id,
      isActive: true,
      endDate: { $gte: new Date() },
    });

    if (existing) {
      return res.status(400).json({ success: false, message: "Already subscribed." });
    }

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
    res.status(201).json({ success: true, order: savedOrder });
  } catch (err) {
    console.error("Failed to create order:", err);
    res.status(500).json({ success: false, message: "Order creation failed." });
  }
});

// ✅ GET latest active subscription
router.get("/latest", isAuthenticated, async (req, res) => {
  try {
    const latest = await Order.findOne({
      user: req.user._id,
      isActive: true,
      paymentStatus: "paid",
      endDate: { $gte: new Date() },
    }).sort({ createdAt: -1 });

    if (!latest) {
      return res.status(404).json({ success: false, message: "No active subscription found." });
    }

    res.status(200).json(latest);
  } catch (err) {
    console.error("Failed to fetch latest order:", err);
    res.status(500).json({ success: false, message: "Failed to fetch subscription." });
  }
});

// ✅ UPDATE latest active order
router.put('/update-latest', isAuthenticated, async (req, res) => {
  try {
    const latest = await Order.findOne({
      user: req.user._id,
      isActive: true,
      paymentStatus: "paid",
      endDate: { $gte: new Date() },
    }).sort({ createdAt: -1 });

    if (!latest) {
      return res.status(404).json({ success: false, message: 'No active order to update.' });
    }

    const {
      plan,
      billingCycle,
      price,
      startDate,
      endDate,
      autoRenew
    } = req.body;

    latest.plan = plan || latest.plan;
    latest.billingCycle = billingCycle || latest.billingCycle;
    latest.price = price || latest.price;
    latest.startDate = new Date(startDate || latest.startDate);
    latest.endDate = new Date(endDate || latest.endDate);
    latest.autoRenew = autoRenew ?? latest.autoRenew;

    await latest.save();
    res.status(200).json({ success: true, order: latest });
  } catch (err) {
    console.error('Failed to update order:', err);
    res.status(500).json({ success: false, message: 'Failed to update order.' });
  }
});

// ✅ CANCEL latest active subscription
router.post('/cancel-latest', isAuthenticated, async (req, res) => {
  try {
    const latestOrder = await Order.findOne({
      user: req.user._id,
      isActive: true,
      paymentStatus: 'paid',
      endDate: { $gte: new Date() },
    }).sort({ createdAt: -1 });

    if (!latestOrder) {
      return res.status(404).json({ success: false, message: 'No active subscription found.' });
    }

    latestOrder.autoRenew = false;
    await latestOrder.save();

    res.json({ success: true, message: 'Auto-renew disabled.' });
  } catch (error) {
    console.error('Cancel subscription failed:', error);
    res.status(500).json({ success: false, message: 'Cancel failed.' });
  }
});

export default router;
