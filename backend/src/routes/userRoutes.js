// routes/userRoutes.js
import express from 'express';
import { isAuthenticated } from '../middleware/auth.middleware.js';
import Order from '../models/Order.js';

const router = express.Router();

router.get('/me', isAuthenticated, async (req, res) => {
  try {
    const user = req.user;

    // Get latest order
    const latestOrder = await Order.findOne({
      user: user._id,
      isActive: true,
    }).sort({ createdAt: -1 });

    const isSubscribed = latestOrder && new Date(latestOrder.endDate) > new Date();
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
        isPremium: user.isPremium || false,   //  include manual premium flag
        autoRenew,
        subscriptionEndDate,
      },
    });
  } catch (err) {
    console.error('/api/users/me error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
