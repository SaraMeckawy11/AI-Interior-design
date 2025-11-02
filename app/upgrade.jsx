import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { RewardedAd, RewardedAdEventType, TestIds } from 'react-native-google-mobile-ads';
import purchases, { LOG_LEVEL } from 'react-native-purchases';
import styles from '../assets/styles/upgrade.styles';
import { useAuthStore } from '../authStore';
import COLORS from '../constants/colors';

// ✅ Create the rewarded ad only once (outside component)
const adUnitId = __DEV__ ? TestIds.REWARDED : 'ca-app-pub-4470538534931449/2411201644';
const rewardedAd = RewardedAd.createForAdRequest(adUnitId);

export default function Upgrade() {
  const { token, fetchUser } = useAuthStore();
  const [selectedPlan, setSelectedPlan] = useState('weekly');
  const [currencyCode, setCurrencyCode] = useState('USD');
  const [weeklyPrice] = useState(5.99);
  const [yearlyPrice] = useState(50.99);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [coins, setCoins] = useState(0);
  const [offerings, setOfferings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [adMessage, setAdMessage] = useState('');
  const [isAdLoaded, setIsAdLoaded] = useState(false);
  const [userInitiatedLoad, setUserInitiatedLoad] = useState(false);
  const router = useRouter();

  // ✅ Initialize purchases and user data
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
          apiKey: 'goog_uVORiYiVgmggjNiOAHvBLferRyp',
          appUserID: user._id.toString(),
        });

        const o = await purchases.getOfferings();
        if (o?.current) {
          setOfferings(o);
          const product = o.current.weekly?.product || o.current.annual?.product;
          if (product?.currencyCode) setCurrencyCode(product.currencyCode);
        }

        // ✅ Ensure isSubscribed is strictly boolean
        setIsSubscribed(user?.isSubscribed === true || user?.isSubscribed === 'true');
        setCoins(Number(user?.adCoins || 0));
      } catch (err) {
        console.error('Initialization error:', err);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [token]);

  // ✅ Setup rewarded ad logic
  useEffect(() => {
    if (!RewardedAdEventType || typeof RewardedAdEventType !== 'object') {
      console.error('RewardedAdEventType is not defined properly');
      return;
    }

    const listeners = [];

    if (RewardedAdEventType.LOADED) {
      listeners.push(
        rewardedAd.addAdEventListener(RewardedAdEventType.LOADED, () => {
          setIsAdLoaded(true);
          if (userInitiatedLoad) {
            setAdMessage('Ad loaded. Playing now...');
            rewardedAd.show();
            setUserInitiatedLoad(false);
          }
        })
      );
    }

    if (RewardedAdEventType.EARNED_REWARD) {
      listeners.push(
        rewardedAd.addAdEventListener(RewardedAdEventType.EARNED_REWARD, async () => {
          try {
            const res = await fetch(`${process.env.EXPO_PUBLIC_SERVER_URI}/api/users/watch-ad`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            });
            const data = await res.json();
            if (data.success) {
              setCoins(Number(data.adCoins || coins + 1));
            } else {
              setCoins((prev) => prev + 1);
            }
          } catch (err) {
            console.error('reward error', err);
            setCoins((prev) => prev + 1);
          } finally {
            setAdMessage('');
          }
        })
      );
    }

    if (RewardedAdEventType.CLOSED) {
      listeners.push(
        rewardedAd.addAdEventListener(RewardedAdEventType.CLOSED, () => {
          setIsAdLoaded(false);
          rewardedAd.load();
        })
      );
    }

    return () => listeners.forEach((unsub) => unsub());
  }, [token, userInitiatedLoad]);

  const handleWatchAd = () => {
    setUserInitiatedLoad(true);
    setAdMessage('Loading ad...');
    rewardedAd.load();
  };

  const getPackageForPlan = (plan) => {
    if (!offerings?.current) return undefined;
    const current = offerings.current;
    return plan === 'weekly'
      ? current.weekly || current.availablePackages.find((p) => p.packageType === 'WEEKLY')
      : current.annual || current.availablePackages.find((p) => p.packageType === 'ANNUAL');
  };

  const getPriceStringForPlan = (plan) => {
    const pkg = getPackageForPlan(plan);
    if (pkg?.product?.priceString) return pkg.product.priceString;
    return `${(plan === 'weekly' ? weeklyPrice : yearlyPrice).toFixed(2)} ${currencyCode}`;
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
      console.error('Purchase failed:', error);
      setAdMessage('Purchase failed. Try again.');
    }
  };

  if (loading)
    return <ActivityIndicator color={COLORS.primaryDark} size="large" style={styles.container} />;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Upgrade to Pro</Text>
      <Text style={styles.subtitle}>Unlock the full LIVINAI experience with premium features.</Text>

      {/* Coins section - only show if NOT subscribed and loading finished */}
      {!loading && !isSubscribed && (
        <View style={styles.coinContainer}>
          <View style={styles.coinRow}>
            <Text style={styles.coinValue}>{coins} Coins</Text>
          </View>
          <Text style={styles.coinSubtitle}>
            Watch ads to earn coins and unlock new designs — each design costs 2 coins.
          </Text>

          <TouchableOpacity style={styles.watchAdButton} onPress={handleWatchAd}>
            <Ionicons name="play-circle-outline" size={18} color="#fff" style={{ marginRight: 6 }} />
            <Text style={styles.watchAdButtonText}>Watch Ad</Text>
          </TouchableOpacity>

          {adMessage ? <Text style={styles.adStatusText}>{adMessage}</Text> : null}
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
        <Text style={styles.upgradeButtonText}>
          {isSubscribed ? 'Change Plan' : 'Upgrade Now'}
        </Text>
      </TouchableOpacity>

      <Text style={styles.trustNote}>Cancel anytime</Text>
    </ScrollView>
  );
}
