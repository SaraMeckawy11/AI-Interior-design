import express from 'express';
import { isAuthenticated } from '../middleware/auth.middleware.js';
import CoinGrant from '../models/CoinGrant.js';
import Order from '../models/Order.js';
import User from '../models/User.js';
import {
  AD_COIN_REWARD,
  AD_DEDUPE_WINDOW_MS,
  COIN_COST,
  COIN_PACKS,
  FREE_DESIGNS,
  MAX_AD_COINS_PER_DAY,
} from '../config/pricing.js';
import { grantCoins, purchaseReference } from '../services/coins.js';
import {
  hasNonSubscriptionPurchase,
  sameStoreProduct,
} from '../services/revenuecat.js';

const router = express.Router();

// ✅ GET /api/users/me
router.get('/me', isAuthenticated, async (req, res) => {
  try {
    const user = req.user;

    // Get latest order
    const latestOrder = await Order.findOne({
      user: user._id,
    }).sort({ createdAt: -1 });

    const isExpired = latestOrder?.endDate
      ? new Date(latestOrder.endDate) <= new Date()
      : true;
    const isSubscribed = Boolean(
      latestOrder
      && latestOrder.paymentStatus === 'paid'
      && latestOrder.isActive
      && !isExpired,
    );
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
      // The price list, from the side that enforces it. The app ships its own
      // copy so it can label a button before the first request completes, but
      // this is the one that decides — and shipping it here means a price change
      // does not have to wait for an app release to stop being a lie.
      pricing: {
        adCoinReward: AD_COIN_REWARD,
        freeDesigns: FREE_DESIGNS,
        coinCost: COIN_COST,
        maxAdCoinsPerDay: MAX_AD_COINS_PER_DAY,
      },
    });
  } catch (err) {
    console.error('/api/users/me error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * ✅ POST /api/users/watch-ad
 *
 * One finished rewarded ad, one coin.
 *
 * This used to be a bare `adCoins + 1` on every call, which made the balance a
 * function of how many times the client happened to fire its reward listener —
 * and a listener registered by an effect that re-runs fires twice, which is why
 * one ad was paying two coins. The award is now keyed and recorded, so a
 * duplicate call is answered with the balance it already produced.
 *
 * `rewardId` should be the ad network's own reward identifier. Builds that do
 * not send one fall back to a coarse time bucket, which collapses a double-fire
 * without needing the app to be updated first.
 */
router.post('/watch-ad', isAuthenticated, async (req, res) => {
  try {
    const userId = req.user._id;
    const { rewardId } = req.body || {};

    const reference = String(
      rewardId || `ad-${Math.floor(Date.now() / AD_DEDUPE_WINDOW_MS)}`,
    ).slice(0, 128);

    // A day's worth of ads, counted from the ledger rather than from a field on
    // the user, so it cannot drift out of step with what was actually paid.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const earnedToday = await CoinGrant.countDocuments({
      user: userId,
      kind: 'ad',
      createdAt: { $gte: since },
    });

    if (earnedToday >= MAX_AD_COINS_PER_DAY) {
      const user = await User.findById(userId).select('adCoins adsWatched');
      return res.status(429).json({
        success: false,
        adCoins: user?.adCoins || 0,
        adsWatched: user?.adsWatched || 0,
        message: `You have earned the most coins we can give for ads today. Come back tomorrow, or top up instead.`,
      });
    }

    const result = await grantCoins(userId, {
      kind: 'ad',
      reference,
      coins: AD_COIN_REWARD,
      meta: { source: 'rewarded' },
    });

    res.status(200).json({
      success: true,
      adCoins: result.adCoins,
      adsWatched: result.adsWatched,
      credited: result.credited,
      coinsAwarded: result.credited ? AD_COIN_REWARD : 0,
      message: result.credited
        ? `You earned ${AD_COIN_REWARD} coin!`
        : 'That ad has already been counted.',
    });
  } catch (err) {
    console.error('/api/users/watch-ad error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * ✅ POST /api/users/coins/purchase
 *
 * Credit a coin pack the store has already charged for.
 *
 * The coin amount comes from the pack table here, never from the request — the
 * app sends which pack was bought and the receipt it was bought with, and this
 * decides what that is worth. The transaction id is the idempotency key, so the
 * app is free to retry after a lost response, and a replayed receipt pays once.
 *
 * RevenueCat is queried before crediting. Without that check, any authenticated
 * caller could invent a transaction id and award itself any pack in this table.
 * The webhook remains the recovery path if this request arrives before
 * RevenueCat's customer record has caught up.
 */
router.post('/coins/purchase', isAuthenticated, async (req, res) => {
  try {
    const { packId, transactionId, productId } = req.body || {};

    const pack = COIN_PACKS[packId];
    if (!pack) {
      return res.status(400).json({ success: false, message: 'Unknown coin pack.' });
    }
    if (!transactionId) {
      return res.status(400).json({ success: false, message: 'Missing purchase reference.' });
    }
    if (productId && !sameStoreProduct(productId, pack.productId)) {
      return res.status(400).json({ success: false, message: 'The product does not match this pack.' });
    }

    const verified = await hasNonSubscriptionPurchase(
      req.user._id,
      productId || pack.productId,
      transactionId,
    );

    if (!verified) {
      const user = await User.findById(req.user._id).select('adCoins');
      return res.status(202).json({
        success: true,
        pending: true,
        adCoins: user?.adCoins || 0,
        credited: false,
        coinsAwarded: 0,
        message: 'Purchase received. Your coins will appear as soon as the store confirms it.',
      });
    }

    const result = await grantCoins(req.user._id, {
      kind: 'purchase',
      reference: purchaseReference(transactionId),
      coins: pack.coins,
      meta: { packId, productId: productId || pack.productId, priceUsd: pack.priceUsd },
    });

    res.status(200).json({
      success: true,
      adCoins: result.adCoins,
      credited: result.credited,
      coinsAwarded: result.credited ? pack.coins : 0,
      message: result.credited
        ? `${pack.coins} coins added to your balance.`
        : 'That purchase has already been credited.',
    });
  } catch (err) {
    console.error('/api/users/coins/purchase error:', err);
    const unavailable = err?.code === 'REVENUECAT_NOT_CONFIGURED' || err?.response?.status >= 500;
    res.status(unavailable ? 503 : 500).json({
      success: false,
      message: unavailable
        ? 'Store verification is temporarily unavailable. If you were charged, your coins will be added automatically.'
        : 'Server error',
    });
  }
});

/**
 * ✅ GET /api/users/coins
 *
 * The balance and how it was built, newest first. The app uses the balance; the
 * history is here because "where did my coins go" is a support question that
 * should not need a database console to answer.
 */
router.get('/coins', isAuthenticated, async (req, res) => {
  try {
    const [user, grants] = await Promise.all([
      User.findById(req.user._id).select('adCoins adsWatched'),
      CoinGrant.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50).lean(),
    ]);

    res.status(200).json({
      success: true,
      adCoins: user?.adCoins || 0,
      adsWatched: user?.adsWatched || 0,
      grants: grants.map((grant) => ({
        kind: grant.kind,
        coins: grant.coins,
        createdAt: grant.createdAt,
        meta: grant.meta,
      })),
    });
  } catch (err) {
    console.error('/api/users/coins error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

export default router;
