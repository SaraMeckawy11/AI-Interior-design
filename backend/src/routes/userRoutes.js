import express from 'express';
import { isAuthenticated } from '../middleware/auth.middleware.js';
import Order from '../models/Order.js';
import User from '../models/User.js';

const router = express.Router();

// GET /api/users/me
router.get('/me', isAuthenticated, async (req, res) => {
  try {
    const user = req.user;

    // Get latest order
    const latestOrder = await Order.findOne({
      user: user._id,
    }).sort({ createdAt: -1 });

    const isExpired = latestOrder ? new Date(latestOrder.endDate) < new Date() : true;
    const isSubscribed = latestOrder && !isExpired;
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
        adCoins: user.adCoins || 0,
        adsWatched: user.adsWatched || 0,
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

    // Each design costs 2 coins
    const COST_PER_DESIGN = 2;

    if ((user.adCoins || 0) >= COST_PER_DESIGN) {
      user.adCoins -= COST_PER_DESIGN;
    } else {
      return res.status(400).json({
        success: false,
        message: 'Not enough coins. Each design costs 2 coins.',
      });
    }

    await user.save();

    res.status(200).json({
      success: true,
      adCoins: user.adCoins,
      freeDesignsUsed: user.freeDesignsUsed,
    });
  } catch (err) {
    console.error('/api/users/unlock-design error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/users/watch-ad
// POST /api/users/watch-ad
router.post('/watch-ad', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    // Each watched ad gives 1 coin directly
    user.adCoins = (user.adCoins || 0) + 1;

    // ✅ Increment total ads watched for analytics
    user.adsWatched = (user.adsWatched || 0) + 1;

    await user.save();

    res.status(200).json({
      success: true,
      adCoins: user.adCoins,
      adsWatched: user.adsWatched,
      message: 'You earned 1 coin!',
    });
  } catch (err) {
    console.error('/api/users/watch-ad error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

export default router;
