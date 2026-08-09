import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import purchases, { LOG_LEVEL } from 'react-native-purchases';

import styles from '../../assets/styles/upgrade.styles';
import { useAuthStore } from '../../authStore';
import { apiUrl } from '../../configs/api';
import COLORS from '../../constants/colors';
import { PLANS, YEARLY_SAVING_PERCENT } from '../../constants/pricing';
import useRewardedCoins from '../../lib/useRewardedCoins';

/**
 * Upgrade to Pro.
 *
 * The layout, the copy and the stylesheet are the ones this screen had when
 * coins were added, restored as they were: a title, a line of copy, the coins
 * card, a two-item feature list, two plan cards side by side, one pill button
 * and "Cancel anytime".
 *
 * What is not restored is the machinery underneath, because that version of it
 * has since been fixed elsewhere and putting it back would reintroduce bugs the
 * app no longer has:
 *
 * * The ad reward went through a module-level `RewardedAd` singleton with its
 *   listeners registered inside an effect that depended on the state its own
 *   handler set, so one ad could pay twice. It goes through `useRewardedCoins`,
 *   which owns its instance and claims once.
 * * Plans were hardcoded weekly/yearly. Weekly no longer exists in the store —
 *   see `constants/pricing.js` — so the two cards read from `PLANS`, which is
 *   monthly and yearly.
 * * "Save 80%" was printed beside two prices that never supported it. The
 *   figure is computed from the price table.
 * * Requests were built on a raw `process.env.EXPO_PUBLIC_SERVER_URI`; they go
 *   through `apiUrl` like every other call in the app.
 */
export default function Upgrade() {
  const { token, fetchUser } = useAuthStore();
  const router = useRouter();

  const [selectedPlan, setSelectedPlan] = useState('yearly');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [offerings, setOfferings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');

  const { coins, setCoins, message: adMessage, watchAd } = useRewardedCoins(token);

  // ── Account and store ─────────────────────────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      const init = async () => {
        try {
          purchases.setLogLevel(LOG_LEVEL.DEBUG);

          let user = null;
          if (token) {
            const res = await fetch(apiUrl('/api/users/me'), {
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            });
            if (res.ok) user = (await res.json()).user;
          }
          if (cancelled) return;

          if (user?._id) {
            setIsSubscribed(user.isSubscribed === true || user.isPremium === true);
            setCoins(Number(user.adCoins || 0));

            await purchases.configure({
              apiKey: 'goog_uVORiYiVgmggjNiOAHvBLferRyp',
              appUserID: user._id.toString(),
            });

            const current = await purchases.getOfferings();
            if (!cancelled && current?.current) setOfferings(current);
          }
        } catch (err) {
          console.error('Store initialisation error:', err);
        } finally {
          if (!cancelled) setLoading(false);
        }
      };

      init();
      return () => {
        cancelled = true;
      };
    }, [setCoins, token]),
  );

  // ── Store lookups ─────────────────────────────────────────────────────────
  /**
   * The store's own package for a plan, matched on package type first and on the
   * product identifier second — RevenueCat offerings are configured by hand and
   * either one can be the thing that was set up.
   */
  const packageForPlan = useCallback(
    (plan) => {
      const current = offerings?.current;
      if (!current) return undefined;
      const all = current.availablePackages || [];
      return (
        all.find((item) => item.packageType === plan.packageType)
        || all.find((item) => item.product?.identifier === plan.productId)
      );
    },
    [offerings],
  );

  const plans = useMemo(
    () => PLANS.map((plan) => ({ ...plan, storePackage: packageForPlan(plan) })),
    [packageForPlan],
  );

  /**
   * The localised price when the store answers, and the table's dollar figure
   * only as a last resort. A hardcoded USD amount shown to someone paying in
   * rupees is wrong about both the number and the currency.
   */
  const priceStringFor = (plan) =>
    plan.storePackage?.product?.priceString || `$${plan.priceUsd.toFixed(2)}`;

  // ── Buying ────────────────────────────────────────────────────────────────
  const handleUpgrade = async () => {
    const plan = plans.find((item) => item.id === selectedPlan);
    if (!plan?.storePackage) {
      setNotice('That plan is not available right now. Please try again in a moment.');
      return;
    }

    const startDate = new Date();
    const endDate = new Date(
      startDate.getTime() + (plan.id === 'monthly' ? 30 : 365) * 24 * 60 * 60 * 1000,
    );

    try {
      const result = await purchases.purchasePackage(plan.storePackage);
      const entitlements = result?.customerInfo?.entitlements?.active;
      const entitlementId = Object.values(entitlements || {})[0]?.identifier;

      const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
      const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');

      const res = await fetch(apiUrl('/api/orders'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: plan.id === 'monthly' ? 'Monthly Plan' : 'Yearly Plan',
          billingCycle: plan.id,
          price: plan.storePackage.product?.price || plan.priceUsd,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          paymentStatus: 'paid',
          entitlementId,
          transactionId: `TXN-${datePart}-${randomPart}`,
          autoRenew: true,
        }),
      });
      if (!res.ok) throw new Error('Failed to sync subscription with backend');

      await fetchUser();
      setIsSubscribed(true);
      router.replace('/(tabs)/profile');
    } catch (error) {
      // A cancelled purchase is not a failure and must not be reported as one.
      if (error?.userCancelled) return;
      console.error('Purchase failed:', error);
      setNotice('Purchase failed. Try again.');
    }
  };

  if (loading)
    return <ActivityIndicator color={COLORS.primaryDark} size="large" style={styles.container} />;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Upgrade to Pro</Text>
      <Text style={styles.subtitle}>Unlock the full LIVINAI experience with premium features.</Text>

      {/* Coins section */}
      <View style={styles.coinContainer}>
        <View style={styles.coinRow}>
          <Text style={styles.coinValue}>{coins} Coins</Text>
        </View>
        <Text style={styles.coinSubtitle}>Watch ads to earn coins — each ad gives 1 coin</Text>

        <TouchableOpacity style={styles.watchAdButton} onPress={watchAd}>
          <Ionicons name="play-circle-outline" size={18} color="#fff" style={{ marginRight: 6 }} />
          <Text style={styles.watchAdButtonText}>Watch Ad</Text>
        </TouchableOpacity>

        <Text style={styles.adStatusText}>
          {notice || adMessage || 'Watch an ad to earn a coin.'}
        </Text>
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
        {plans.map((plan) => (
          <TouchableOpacity
            key={plan.id}
            style={[styles.planCard, selectedPlan === plan.id && styles.planCardSelected]}
            onPress={() => setSelectedPlan(plan.id)}
          >
            {plan.badge ? (
              <View style={styles.bestValueBadge}>
                <Text style={styles.bestValueText}>{plan.badge}</Text>
              </View>
            ) : null}
            <Text style={styles.planTitle}>{plan.title}</Text>
            <Text style={styles.planPrice}>{priceStringFor(plan)} / {plan.period}</Text>
            {plan.id === 'yearly' ? (
              <Text style={styles.planSavings}>Save {YEARLY_SAVING_PERCENT}%</Text>
            ) : null}
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={styles.upgradeButton} onPress={handleUpgrade}>
        <Text style={styles.upgradeButtonText}>{isSubscribed ? 'Change Plan' : 'Upgrade Now'}</Text>
      </TouchableOpacity>

      <Text style={styles.trustNote}>Cancel anytime</Text>
    </ScrollView>
  );
}
