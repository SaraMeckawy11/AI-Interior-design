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
  const [freeDesignsUsed, setFreeDesignsUsed] = useState(0);
  const [offerings, setOfferings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [adsWatched, setAdsWatched] = useState(0);
  const router = useRouter();

  // Rewarded ad setup
  const adUnitId = __DEV__ ? TestIds.REWARDED : 'ca-app-pub-4470538534931449/2411201644';
  const rewardedAd = RewardedAd.createForAdRequest(adUnitId);

  useEffect(() => {
    const init = async () => {
      try {
        purchases.setLogLevel(LOG_LEVEL.DEBUG);

        // Fetch user info
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

        // RevenueCat init
        await purchases.configure({
          apiKey: "goog_uVORiYiVgmggjNiOAHvBLferRyp",
          appUserID: user._id.toString(),
        });

        // Fetch offerings
        const o = await purchases.getOfferings();
        if (o?.current?.availablePackages?.length > 0) {
          setOfferings(o);
          const weeklyPkg = o.current.weekly || o.current.availablePackages.find(p => p.packageType === 'WEEKLY');
          const annualPkg = o.current.annual || o.current.availablePackages.find(p => p.packageType === 'ANNUAL');
          const product = weeklyPkg?.product || annualPkg?.product;
          if (product?.currencyCode) setCurrencyCode(product.currencyCode);
        }

        setIsSubscribed(Boolean(user?.isSubscribed));
        setFreeDesignsUsed(Number(user?.freeDesignsUsed || 0));
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

  // Watch rewarded ad
  const handleWatchAd = () => {
    rewardedAd.load();

    const unsubscribeLoaded = rewardedAd.addAdEventListener(RewardedAdEventType.LOADED, () => {
      rewardedAd.show();
    });

    const unsubscribeEarned = rewardedAd.addAdEventListener(RewardedAdEventType.EARNED_REWARD, async () => {
      setAdsWatched(prev => {
        const newCount = prev + 1;
        if (newCount >= 3) {
          // Unlock 1 design render
          fetch(`${process.env.EXPO_PUBLIC_SERVER_URI}/api/users/unlock-design`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ decrement: 1 }),
          })
            .then(() => {
              setFreeDesignsUsed(prev => Math.max(0, prev - 1));
              Alert.alert('🎉 Unlocked!', 'You can now generate 1 extra design render.');
            })
            .catch(err => console.error(err));
          return 0; // reset counter after unlocking
        } else {
          Alert.alert('🎬 Video watched', `You watched ${newCount}/3 videos`);
          return newCount;
        }
      });
    });

    const unsubscribeClosed = rewardedAd.addAdEventListener(RewardedAdEventType.CLOSED, () => {
      rewardedAd.load(); // preload next ad
    });

    return () => {
      unsubscribeLoaded();
      unsubscribeEarned();
      unsubscribeClosed();
    };
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

      {freeDesignsUsed >= 2 && !isSubscribed && (
        <View style={styles.warningBox}>
          <Text style={styles.warningTitle}>You have used your 2 free designs.</Text>
          <Text style={styles.warningText}>
            Watch 3 ads to unlock 1 extra design render or upgrade for unlimited access.
          </Text>
          <TouchableOpacity style={styles.upgradeButton} onPress={handleWatchAd}>
            <Text style={styles.upgradeButtonText}>Watch Ad</Text>
          </TouchableOpacity>
        </View>
      )}

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
