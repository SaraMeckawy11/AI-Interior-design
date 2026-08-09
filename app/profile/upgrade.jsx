import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import purchases, { LOG_LEVEL } from 'react-native-purchases';

import styles from '../../assets/styles/upgrade.styles';
import { useAuthStore } from '../../authStore';
import { apiUrl } from '../../configs/api';
import COLORS from '../../constants/colors';
import {
  AD_COIN_REWARD,
  COIN_COST,
  COIN_PACKS,
  PLANS,
  YEARLY_SAVING_PERCENT,
  coinLabel,
  packSaving,
} from '../../constants/pricing';
import useRewardedCoins from '../../lib/useRewardedCoins';

/**
 * Upgrade to Pro.
 *
 * The layout is the one the screen has had since coins arrived: a title, a line
 * of copy, the coins card, a feature checklist, "Choose a plan:", two plan cards
 * side by side, a pill button and "Cancel anytime" — with the coin packs back
 * underneath, in the same visual language.
 *
 * Three ways to pay, and a person picks one: a subscription, a pack of coins, or
 * an ad. The screen has to make all three legible without any of them shouting
 * over the others, which is why the plan button is filled and the coins button
 * is outlined.
 *
 * Every number comes from `constants/pricing.js`. The store's own localised
 * price wins over the table's dollar figure whenever the store answers, because
 * a hardcoded USD amount shown to someone paying in rupees is wrong about both
 * the number and the currency.
 */
export default function Upgrade() {
  const { token, fetchUser } = useAuthStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [selectedPlan, setSelectedPlan] = useState('yearly');
  const [selectedPack, setSelectedPack] = useState(COIN_PACKS[1].id);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [offerings, setOfferings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(''); // '' | 'plan' | 'pack'
  const [dialog, setDialog] = useState(null);

  const { coins, setCoins, status: adStatus, message: adMessage, watchAd } = useRewardedCoins(token);

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

  const packageForPack = useCallback(
    (pack) => (offerings?.current?.availablePackages || []).find(
      (item) => item.product?.identifier === pack.productId,
    ),
    [offerings],
  );

  const priceFor = useCallback(
    (entry, storePackage) =>
      storePackage?.product?.priceString || `$${entry.priceUsd.toFixed(2)}`,
    [],
  );

  const plans = useMemo(
    () => PLANS.map((plan) => ({ ...plan, storePackage: packageForPlan(plan) })),
    [packageForPlan],
  );
  const packs = useMemo(
    () => COIN_PACKS.map((pack) => ({ ...pack, storePackage: packageForPack(pack) })),
    [packageForPack],
  );

  const activePack = packs.find((pack) => pack.id === selectedPack);

  // ── Buying ────────────────────────────────────────────────────────────────
  const handleUpgrade = async () => {
    const plan = plans.find((item) => item.id === selectedPlan);
    if (!plan?.storePackage) {
      setDialog({
        title: 'This plan is not available yet',
        message:
          'The store did not return this subscription. Check your connection and try again in a moment.',
      });
      return;
    }

    setBusy('plan');
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
      if (!res.ok) throw new Error('Your subscription could not be recorded on your account.');

      await fetchUser();
      setIsSubscribed(true);
      router.replace('/(tabs)/profile');
    } catch (error) {
      // A cancelled purchase is not a failure and must not be reported as one.
      if (error?.userCancelled) return;
      console.error('Purchase failed:', error);
      setDialog({
        title: 'That purchase did not go through',
        message:
          error?.message
          || 'Nothing has been charged. Please try again, or check your payment method in the Play Store.',
      });
    } finally {
      setBusy('');
    }
  };

  const buyCoins = async () => {
    const pack = packs.find((item) => item.id === selectedPack);
    if (!pack?.storePackage) {
      setDialog({
        title: 'This pack is not available yet',
        message:
          'The store did not return this coin pack. Check your connection and try again in a moment.',
      });
      return;
    }

    setBusy('pack');
    try {
      const result = await purchases.purchasePackage(pack.storePackage);
      const transactionId =
        result?.transaction?.transactionIdentifier
        || result?.customerInfo?.originalAppUserId
        || `${pack.productId}-${Date.now()}`;

      // The server decides how many coins this pack is worth. The app only says
      // which pack was bought and what receipt it was bought with — so a
      // tampered client cannot credit itself a thousand coins for $1.99.
      const res = await fetch(apiUrl('/api/users/coins/purchase'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packId: pack.id,
          productId: pack.productId,
          transactionId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Your coins could not be added to your account.');
      }

      if (typeof data.adCoins === 'number') setCoins(data.adCoins);
      setDialog({
        title: 'Coins added',
        message: `${coinLabel(pack.coins)} are on your account. You now have ${data.adCoins}.`,
      });
    } catch (error) {
      if (error?.userCancelled) return;
      console.error('Coin purchase failed:', error);
      setDialog({
        title: 'That purchase did not complete',
        message:
          error?.message
          || 'If you were charged, your coins will appear the next time you open this screen.',
      });
    } finally {
      setBusy('');
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const backButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Go back"
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      style={({ pressed }) => [styles.back, pressed && styles.pressed]}
      onPress={() => router.back()}
    >
      <Ionicons name="chevron-back" size={21} color={COLORS.textPrimary} />
    </Pressable>
  );

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background, paddingTop: insets.top + 12 }}>
        <View style={styles.container}>{backButton}</View>
        <View style={styles.centered}>
          <ActivityIndicator color={COLORS.primaryDark} size="large" />
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background, paddingTop: insets.top + 12 }}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        {backButton}

        <Text style={styles.title}>Upgrade to Pro</Text>
        <Text style={styles.subtitle}>
          {isSubscribed
            ? 'Your Pro membership is active — every premium feature is unlocked.'
            : 'Unlock the full LIVINAI experience with premium features.'}
        </Text>

        {isSubscribed ? (
          <View style={styles.activeCard}>
            <Ionicons name="checkmark-circle" size={24} color={COLORS.primaryDark} />
            <View style={styles.activeCopy}>
              <Text style={styles.activeTitle}>Pro is active on this account</Text>
              <Text style={styles.activeText}>
                Designs, walkthroughs and an ad-free app, all unlimited.
              </Text>
            </View>
          </View>
        ) : null}

        {/* ── Coins ──────────────────────────────────────────────────────── */}
        <View style={styles.coinContainer}>
          <View style={styles.coinRow}>
            <Ionicons name="ellipse" size={20} color={COLORS.primaryDark} />
            <Text style={styles.coinValue}>{coins} Coins</Text>
          </View>
          <Text style={styles.coinSubtitle}>
            Watch ads to earn coins — each ad gives {coinLabel(AD_COIN_REWARD)}
          </Text>

          <View style={styles.coinPrices}>
            <View style={styles.coinPriceRow}>
              <Ionicons name="color-palette-outline" size={16} color={COLORS.textSecondary} />
              <Text style={styles.coinPriceLabel}>Interior or exterior design</Text>
              <Text style={styles.coinPriceValue}>{coinLabel(COIN_COST.design)}</Text>
            </View>
            <View style={styles.coinPriceRow}>
              <Ionicons name="cube-outline" size={16} color={COLORS.textSecondary} />
              <Text style={styles.coinPriceLabel}>3D walkthrough render</Text>
              <Text style={styles.coinPriceValue}>{coinLabel(COIN_COST.walkthrough)}</Text>
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Watch an ad to earn ${coinLabel(AD_COIN_REWARD)}`}
            accessibilityState={{ busy: adStatus === 'showing', disabled: adStatus === 'showing' }}
            android_ripple={{ color: 'rgba(255,255,255,0.24)' }}
            style={({ pressed }) => [
              styles.watchAdButton,
              adStatus === 'showing' && styles.watchAdButtonBusy,
              pressed && styles.pressed,
            ]}
            // Only while an ad is on screen. Gating on "not idle" left this
            // disabled and spinning from the moment the screen opened, because
            // the hook reports `loading` for the whole background warm-up.
            disabled={adStatus === 'showing'}
            onPress={watchAd}
          >
            {adStatus === 'showing' ? (
              <ActivityIndicator size="small" color={COLORS.textTertiary} />
            ) : (
              <>
                <Ionicons name="play-circle-outline" size={18} color={COLORS.white} />
                <Text style={styles.watchAdButtonText}>Watch Ad</Text>
              </>
            )}
          </Pressable>

          <Text style={styles.adStatusText}>
            {adMessage || 'Watch an ad to earn a coin.'}
          </Text>
        </View>

        {/* ── What Pro includes ──────────────────────────────────────────── */}
        <View style={styles.featureList}>
          {['Ad-free experience', 'Unlimited design renders', 'Unlimited 3D walkthroughs'].map(
            (feature) => (
              <View key={feature} style={styles.featureItem}>
                <Ionicons name="checkmark-circle-outline" size={20} color={COLORS.primaryDark} />
                <Text style={styles.featureText}>{feature}</Text>
              </View>
            ),
          )}
        </View>

        {/* ── Plans ──────────────────────────────────────────────────────── */}
        <Text style={styles.planLabel}>
          {isSubscribed ? 'Your plan options' : 'Choose a plan:'}
        </Text>

        <View style={styles.planOptions}>
          {plans.map((plan) => {
            const selected = !isSubscribed && selectedPlan === plan.id;
            const price = priceFor(plan, plan.storePackage);

            const body = (
              <>
                {/* Reserved on both cards, filled on one, so the titles line
                    up. This badge used to hang outside the card at
                    top:-8/right:-8, where Android clipped it. */}
                <View style={[styles.bestValueBadge, plan.badge && styles.bestValueBadgeOn]}>
                  {plan.badge ? (
                    <Text style={styles.bestValueText} numberOfLines={1}>{plan.badge}</Text>
                  ) : null}
                </View>
                <View style={styles.planBody}>
                  {isSubscribed ? null : (
                    <View style={[styles.radio, selected && styles.radioOn]}>
                      {selected ? <View style={styles.radioDot} /> : null}
                    </View>
                  )}
                  <Text style={styles.planTitle}>{plan.title}</Text>
                  <Text style={styles.planPrice}>{price}</Text>
                  <Text style={styles.planPeriod}>per {plan.period}</Text>
                  {/* The saving from the price table. "Save 80%" used to be
                      printed here beside two prices that never supported it. */}
                  {plan.id === 'yearly' ? (
                    <Text style={styles.planSavings}>Save {YEARLY_SAVING_PERCENT}%</Text>
                  ) : (
                    <View style={styles.planSavingsPlaceholder} />
                  )}
                </View>
              </>
            );

            return isSubscribed ? (
              <View
                key={plan.id}
                accessibilityRole="text"
                accessibilityLabel={`${plan.title} plan, ${price} per ${plan.period}`}
                style={styles.planCard}
              >
                {body}
              </View>
            ) : (
              <Pressable
                key={plan.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={`${plan.title} plan, ${price} per ${plan.period}`}
                android_ripple={{ color: 'rgba(30,36,31,0.06)' }}
                style={({ pressed }) => [
                  styles.planCard,
                  selected && styles.planCardSelected,
                  pressed && styles.pressed,
                ]}
                onPress={() => setSelectedPlan(plan.id)}
              >
                {body}
              </Pressable>
            );
          })}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isSubscribed ? 'Manage your subscription' : 'Upgrade to Pro'}
          accessibilityState={{ busy: busy === 'plan', disabled: !!busy }}
          android_ripple={busy ? undefined : { color: 'rgba(255,255,255,0.20)' }}
          style={({ pressed }) => [
            styles.upgradeButton,
            !!busy && styles.upgradeButtonDisabled,
            pressed && !busy && styles.pressed,
          ]}
          disabled={!!busy}
          onPress={isSubscribed ? () => router.push('/profile/manageSubscription') : handleUpgrade}
        >
          {busy === 'plan' ? (
            <ActivityIndicator color={COLORS.textTertiary} />
          ) : (
            <>
              <Ionicons
                name={isSubscribed ? 'settings-outline' : 'sparkles'}
                size={18}
                color={busy ? COLORS.textTertiary : COLORS.white}
              />
              <Text style={[styles.upgradeButtonText, !!busy && styles.upgradeButtonTextDisabled]}>
                {isSubscribed ? 'Manage Subscription' : 'Upgrade Now'}
              </Text>
            </>
          )}
        </Pressable>

        {/* ── Or buy coins outright ──────────────────────────────────────── */}
        <View style={styles.sectionGap}>
          <Text style={styles.planLabel}>Or buy coins:</Text>
        </View>

        <View style={styles.packRow}>
          {packs.map((pack) => {
            const selected = selectedPack === pack.id;
            const saving = packSaving(pack);
            return (
              <Pressable
                key={pack.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={`${pack.coins} coins for ${priceFor(pack, pack.storePackage)}`}
                android_ripple={{ color: 'rgba(30,36,31,0.06)' }}
                style={({ pressed }) => [
                  styles.pack,
                  selected && styles.packSelected,
                  pressed && styles.pressed,
                ]}
                onPress={() => setSelectedPack(pack.id)}
              >
                <View style={[styles.packBadge, pack.badge && styles.packBadgeOn]}>
                  {pack.badge ? (
                    <Text style={styles.packBadgeText} numberOfLines={1}>{pack.badge}</Text>
                  ) : null}
                </View>
                <View style={styles.packBody}>
                  <Text style={styles.packCoins}>{pack.coins}</Text>
                  <Text style={styles.packUnit}>coins</Text>
                  <Text style={styles.packPrice}>{priceFor(pack, pack.storePackage)}</Text>
                  {saving > 0 ? (
                    <Text style={styles.packSaving}>Save {saving}%</Text>
                  ) : (
                    <View style={styles.packSavingPlaceholder} />
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Buy the selected coin pack"
          accessibilityState={{ busy: busy === 'pack', disabled: !!busy }}
          android_ripple={busy ? undefined : { color: 'rgba(51,96,74,0.12)' }}
          style={({ pressed }) => [styles.buyCoinsButton, pressed && !busy && styles.pressed]}
          disabled={!!busy}
          onPress={buyCoins}
        >
          {busy === 'pack' ? (
            <ActivityIndicator color={COLORS.primaryDark} />
          ) : (
            <Text style={styles.buyCoinsButtonText}>Buy {activePack?.coins} coins</Text>
          )}
        </Pressable>

        <Text style={styles.trustNote}>
          Cancel anytime. Subscriptions renew automatically until cancelled and can be cancelled in
          the Play Store. Coin packs are a one-off purchase and never expire.
        </Text>
      </ScrollView>

      <Modal visible={!!dialog} transparent animationType="fade" onRequestClose={() => setDialog(null)}>
        <TouchableWithoutFeedback onPress={() => setDialog(null)}>
          <View style={styles.dialogBackdrop}>
            <TouchableWithoutFeedback>
              <View style={styles.dialog}>
                <Text style={styles.dialogTitle}>{dialog?.title}</Text>
                <Text style={styles.dialogMessage}>{dialog?.message}</Text>
                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.dialogButton, pressed && styles.pressed]}
                  onPress={() => setDialog(null)}
                >
                  <Text style={styles.dialogButtonText}>Got it</Text>
                </Pressable>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
}
