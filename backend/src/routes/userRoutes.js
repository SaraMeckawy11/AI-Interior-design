// routes/userRoutes.js
import express from 'express';
import { isAuthenticated } from '../middleware/auth.middleware.js';
import Order from '../models/Order.js';
import User from '../models/User.js';

const router = express.Router();

router.get('/me', isAuthenticated, async (req, res) => {
  try {
    const user = req.user;

    // Get latest order
    const latestOrder = await Order.findOne({
      user: user._id,      // get latest order regardless of isActive
    }).sort({ createdAt: -1 });

    const isExpired = latestOrder ? new Date(latestOrder.endDate) < new Date() : true;
    const isSubscribed = latestOrder && !isExpired 
    const autoRenew = latestOrder?.autoRenew || false;
    const subscriptionEndDate = latestOrder?.endDate || null;

    res.status(200).json({
      success: true,
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        profileImage: user.profileImage,
        freeDesignsUsed: user.freeDesignsUsed || 0,
        isSubscribed,
        isPremium: user.isPremium || false,
        autoRenew,
        subscriptionEndDate,
        manualDisabled: user.manualDisabled || false,
      },
    });
  } catch (err) {
    console.error('/api/users/me error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});


// POST /api/users/unlock-design
router.post('/unlock-design', isAuthenticated, async (req, res) => {
  try {
    const user = req.user;
    const decrement = Number(req.body.decrement) || 1;

    user.freeDesignsUsed = Math.max(0, user.freeDesignsUsed - decrement);
    await user.save();

    res.status(200).json({ success: true, freeDesignsUsed: user.freeDesignsUsed });
  } catch (err) {
    console.error('/api/users/unlock-design error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

export default router;
