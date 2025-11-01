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
// POST /api/users/unlock-design
router.post('/unlock-design', isAuthenticated, async (req, res) => {
  try {
    const user = req.user;

    // Prefer using adCoins before decrementing freeDesignsUsed
    if ((user.adCoins || 0) > 0) {
      user.adCoins -= 1;
    } else {
      const decrement = Number(req.body.decrement) || 1;
      user.freeDesignsUsed = Math.max(0, user.freeDesignsUsed - decrement);
    }

    await user.save();

    res.status(200).json({
      success: true,
      freeDesignsUsed: user.freeDesignsUsed,
      adCoins: user.adCoins,
    });
  } catch (err) {
    console.error('/api/users/unlock-design error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});


// POST /api/users/watch-ad
router.post('/watch-ad', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    user.adsWatched = (user.adsWatched || 0) + 1;

    // Every 3 watched ads gives 1 adCoin
    if (user.adsWatched >= 3) {
      user.adCoins = (user.adCoins || 0) + 1; // add 1 coin
      user.adsWatched = 0; // reset counter
    }

    await user.save();

    const remaining = 3 - user.adsWatched;

    res.status(200).json({
      success: true,
      adCoins: user.adCoins,
      adsWatched: user.adsWatched,
      remaining,
      message:
        remaining === 0
          ? '🎉 You earned 1 design coin!'
          : `Watch ${remaining} more ads to earn 1 coin.`,
    });
  } catch (err) {
    console.error('/api/users/watch-ad error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});


export default router;
