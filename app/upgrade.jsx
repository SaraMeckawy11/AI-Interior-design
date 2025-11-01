import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import styles from '../assets/styles/upgrade.styles';
import COLORS from '../constants/colors';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../authStore';
import purchases, { LOG_LEVEL } from 'react-native-purchases';
import { RewardedAd, RewardedAdEventType, TestIds } from 'react-native-google-mobile-ads';

export default function Upgrade() {
  const { token, fetchUser } = useAuthStore();
  const [selectedPlan, setSelectedPlan] = useState('weekly');
  const [currencyCode, setCurrencyCode] = useState('USD');
  const [weeklyPrice, setWeeklyPrice] = useState(5.99);
  const [yearlyPrice, setYearlyPrice] = useState(50.99);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [coins, setCoins] = useState(0);
  const [offerings, setOfferings] = useState(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // Rewarded ad setup
  const adUnitId = __DEV__ ? TestIds.REWARDED : 'ca-app-pub-4470538534931449/2411201644';
  const rewardedAd = RewardedAd.createForAdRequest(adUnitId);

  useEffect(() => {
    const init = async () => {
      try {
        purchases.setLogLevel(LOG_LEVEL.DEBUG);

        let user = null;
        if (token) {
          const res = await fetch(`${process.env.EXPO_PUBLIC_SERVER_URI}/api/users/me`, {
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          });
          if (res.ok) {
            const data = await res.json();
            user = data.user;
          }
        }
        if (!user?._id) return;

        await purchases.configure({
          apiKey: "goog_uVORiYiVgmggjNiOAHvBLferRyp",
          appUserID: user._id.toString(),
        });

        const o = await purchases.getOfferings();
        if (o?.current?.availablePackages?.length > 0) {
          setOfferings(o);
          const weeklyPkg = o.current.weekly || o.current.availablePackages.find(p => p.packageType === 'WEEKLY');
          const annualPkg = o.current.annual || o.current.availablePackages.find(p => p.packageType === 'ANNUAL');
          const product = weeklyPkg?.product || annualPkg?.product;
          if (product?.currencyCode) setCurrencyCode(product.currencyCode);
        }

        setIsSubscribed(Boolean(user?.isSubscribed));
        setCoins(Number(user?.coins || 0)); // 🪙 load user coins
      } catch (err) {
        console.error('Initialization error:', err);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [token]);

  const getPackageForPlan = (plan) => {
    if (!offerings?.current) return undefined;
    const current = offerings.current;
    return plan === 'weekly'
      ? current.weekly || current.availablePackages.find(p => p.packageType === 'WEEKLY')
      : current.annual || current.availablePackages.find(p => p.packageType === 'ANNUAL');
  };

  const getPriceStringForPlan = (plan) => {
    const pkg = getPackageForPlan(plan);
    if (pkg?.product?.priceString) return pkg.product.priceString;
    return `${(plan === 'weekly' ? weeklyPrice : yearlyPrice).toFixed(2)} ${currencyCode}`;
  };

  // 🎥 Watch rewarded ad → earn coins
  const handleWatchAd = () => {
    rewardedAd.load();

    const unsubscribeLoaded = rewardedAd.addAdEventListener(RewardedAdEventType.LOADED, () => {
      rewardedAd.show();
    });

    const unsubscribeEarned = rewardedAd.addAdEventListener(
      RewardedAdEventType.EARNED_REWARD,
      async () => {
        try {
          const res = await fetch(`${process.env.EXPO_PUBLIC_SERVER_URI}/api/users/watch-ad`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          });
          const data = await res.json();
          if (data.success) {
            setCoins(data.coins);
            Alert.alert('🎬 Video watched', `You earned +1 coin! You now have ${data.coins} coins.`);
          }
        } catch (err) {
          console.error(err);
          Alert.alert('Error', 'Failed to update coins after watching ad.');
        }
      }
    );

    const unsubscribeClosed = rewardedAd.addAdEventListener(RewardedAdEventType.CLOSED, () => {
      rewardedAd.load(); // preload next ad
    });

    return () => {
      unsubscribeLoaded();
      unsubscribeEarned();
      unsubscribeClosed();
    };
  };

  // 🪙 Spend coins to unlock design
  const handleUnlockDesign = async () => {
    if (coins <= 0) {
      Alert.alert('Not enough coins', 'You need at least 1 coin to unlock a design render.');
      return;
    }

    try {
      const res = await fetch(`${process.env.EXPO_PUBLIC_SERVER_URI}/api/users/unlock-design`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ decrement: 1 }),
      });
      const data = await res.json();
      if (data.success) {
        setCoins(data.coins);
        Alert.alert('🎨 Unlocked!', 'You successfully used 1 coin to unlock a design render.');
      }
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'Failed to unlock design.');
    }
  };

  const handleUpgrade = async () => {
    const chosenPackage = getPackageForPlan(selectedPlan);
    if (!chosenPackage) return;

    const plan = selectedPlan === 'weekly' ? 'Weekly Plan' : 'Yearly Plan';
    const billingCycle = selectedPlan;
    const price = chosenPackage.product?.price || 0;
    const startDate = new Date();
    const endDate = new Date(
      billingCycle === 'weekly'
        ? startDate.getTime() + 7 * 24 * 60 * 60 * 1000
        : startDate.getTime() + 365 * 24 * 60 * 60 * 1000
    );

    try {
      const purchaseResult = await purchases.purchasePackage(chosenPackage);
      const entitlements = purchaseResult?.customerInfo?.entitlements?.active;
      const activeEntitlement = Object.values(entitlements || {})[0];
      const entitlementId = activeEntitlement?.identifier;

      const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
      const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const transactionId = `TXN-${datePart}-${randomPart}`;

      const backendPayload = {
        plan,
        billingCycle,
        price,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        paymentStatus: 'paid',
        entitlementId,
        transactionId,
        autoRenew: true,
      };

      const endpoint = `${process.env.EXPO_PUBLIC_SERVER_URI}/api/orders`;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(backendPayload),
      });
      if (!res.ok) throw new Error('Failed to sync subscription with backend');

      await fetchUser();
      setIsSubscribed(true);
      router.replace('(tabs)/profile');
    } catch (error) {
      console.error('Purchase or backend sync failed:', error);
    }
  };

  if (loading) return <ActivityIndicator color={COLORS.primaryDark} size="large" style={styles.container} />;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Upgrade to Pro</Text>
      <Text style={styles.subtitle}>Unlock the full LIVINAI experience with premium features.</Text>

      {/* 🪙 Coins System */}
      <View style={styles.warningBox}>
        <Text style={styles.warningTitle}>Your Coins: {coins}</Text>
        <Text style={styles.warningText}>
          Watch ads to earn coins. Each render costs 1 coin.
        </Text>

        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 10 }}>
          <TouchableOpacity style={[styles.upgradeButton, { marginRight: 8 }]} onPress={handleWatchAd}>
            <Text style={styles.upgradeButtonText}>Watch Ad (+1 Coin)</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.upgradeButton} onPress={handleUnlockDesign}>
            <Text style={styles.upgradeButtonText}>Use 1 Coin</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.featureList}>
        {['Ad-free experience', 'Unlimited design renders'].map((feature, idx) => (
          <View key={idx} style={styles.featureItem}>
            <Ionicons name="checkmark-circle-outline" size={20} color={COLORS.primaryDark} />
            <Text style={styles.featureText}>{feature}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.planLabel}>Choose a plan:</Text>
      <View style={styles.planOptions}>
        <TouchableOpacity
          style={[styles.planCard, selectedPlan === 'weekly' && styles.planCardSelected]}
          onPress={() => setSelectedPlan('weekly')}
        >
          <Text style={styles.planTitle}>Weekly</Text>
          <Text style={styles.planPrice}>{getPriceStringForPlan('weekly')} / week</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.planCard, selectedPlan === 'yearly' && styles.planCardSelected]}
          onPress={() => setSelectedPlan('yearly')}
        >
          <View style={styles.bestValueBadge}>
            <Text style={styles.bestValueText}>Best Value</Text>
          </View>
          <Text style={styles.planTitle}>Yearly</Text>
          <Text style={styles.planPrice}>{getPriceStringForPlan('yearly')} / year</Text>
          <Text style={styles.planSavings}>Save 80%</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.upgradeButton} onPress={handleUpgrade}>
        <Text style={styles.upgradeButtonText}>{isSubscribed ? 'Change Plan' : 'Upgrade Now'}</Text>
      </TouchableOpacity>

      <Text style={styles.trustNote}>Cancel anytime</Text>
    </ScrollView>
  );
}
