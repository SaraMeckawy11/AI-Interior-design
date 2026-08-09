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

  /**
   * One choice across all five things this screen sells.
   *
   * Plans and packs used to hold separate selections with a button each, so the
   * screen always had two live answers to "what am I buying?" and two primary
   * actions competing to be pressed. They are one radio group now — picking a
   * coin pack clears the plan and the other way round — and one button below
   * them acts on whatever is chosen.
   */
  const [selection, setSelection] = useState({ kind: 'plan', id: 'yearly' });
  const isSelected = (kind, id) => selection.kind === kind && selection.id === id;
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

  const buyingPlan = selection.kind === 'plan';
  const activePlan = plans.find((plan) => plan.id === selection.id);
  const activePack = packs.find((pack) => pack.id === selection.id);

  // ── Buying ────────────────────────────────────────────────────────────────
  const handleUpgrade = async () => {
    const plan = plans.find((item) => item.id === selection.id);
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
    const pack = packs.find((item) => item.id === selection.id);
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
      <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
        <View style={styles.container}>{backButton}</View>
        <View style={styles.centered}>
          <ActivityIndicator color={COLORS.primaryDark} size="large" />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
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
            <Ionicons name="checkmark-circle" size={18} color={COLORS.primaryDark} />
            <Text style={styles.activeText}>Pro is active on this account.</Text>
          </View>
        ) : null}

        {/* ── Coins ──────────────────────────────────────────────────────── */}
        <View style={styles.coinCard}>
          <View style={styles.coinRow}>
            <Ionicons name="ellipse" size={16} color={COLORS.primaryDark} />
            <Text style={styles.coinValue}>{coins} Coins</Text>
          </View>
          <Text style={styles.coinSubtitle}>
            Watch ads to earn coins — each ad gives {coinLabel(AD_COIN_REWARD)}
          </Text>

          <View style={styles.coinPrices}>
            <View style={styles.coinPriceRow}>
              <Ionicons name="color-palette-outline" size={14} color={COLORS.textTertiary} />
              <Text style={styles.coinPriceLabel}>Interior or exterior design</Text>
              <Text style={styles.coinPriceValue}>{coinLabel(COIN_COST.design)}</Text>
            </View>
            <View style={styles.coinPriceRow}>
              <Ionicons name="cube-outline" size={14} color={COLORS.textTertiary} />
              <Text style={styles.coinPriceLabel}>3D walkthrough render</Text>
              <Text style={styles.coinPriceValue}>{coinLabel(COIN_COST.walkthrough)}</Text>
            </View>
          </View>

          {/* Quiet, because it is the free option. A filled pill here competed
              with the two buttons that actually take money. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Watch an ad to earn ${coinLabel(AD_COIN_REWARD)}`}
            accessibilityState={{ busy: adStatus === 'showing', disabled: adStatus === 'showing' }}
            android_ripple={{ color: 'rgba(30,36,31,0.08)' }}
            style={({ pressed }) => [styles.watchAdButton, pressed && styles.pressed]}
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
                <Ionicons name="play-circle-outline" size={15} color={COLORS.textPrimary} />
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
                <Ionicons name="checkmark" size={15} color={COLORS.primaryDark} />
                <Text style={styles.featureText}>{feature}</Text>
              </View>
            ),
          )}
        </View>

        {/* ── Plans ──────────────────────────────────────────────────────── */}
        <Text style={styles.sectionLabel}>
          {isSubscribed ? 'Your plan options' : 'Choose a plan'}
        </Text>

        <View style={styles.planOptions}>
          {plans.map((plan) => {
            const selected = isSelected('plan', plan.id);
            const price = priceFor(plan, plan.storePackage);
            return (
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
                onPress={() => setSelection({ kind: 'plan', id: plan.id })}
              >
                {/* Reserved on both cards, filled on one, so the titles line
                    up — and the same band the coin packs use below, rather
                    than a differently sized pill doing the same job. It used to
                    hang outside the card at top:-8/right:-8, where Android
                    clips it. */}
                <View style={[styles.badge, plan.badge && styles.badgeOn]}>
                  {plan.badge ? (
                    <Text style={styles.badgeText} numberOfLines={1}>{plan.badge}</Text>
                  ) : null}
                </View>
                <View style={styles.cardBody}>
                  <View style={[styles.radio, selected && styles.radioOn]}>
                    {selected ? <View style={styles.radioDot} /> : null}
                  </View>
                  <Text style={styles.planTitle}>{plan.title}</Text>
                  <Text style={styles.planPrice}>{price}</Text>
                  <Text style={styles.planPeriod}>per {plan.period}</Text>
                  {/* The saving from the price table. "Save 80%" used to be
                      printed here beside two prices that never supported it. */}
                  {plan.id === 'yearly' ? (
                    <Text style={styles.savings}>Save {YEARLY_SAVING_PERCENT}%</Text>
                  ) : (
                    <View style={styles.savingsPlaceholder} />
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* ── Or buy coins outright ──────────────────────────────────────── */}
        <View style={styles.sectionGap}>
          <Text style={styles.sectionLabel}>Or buy coins</Text>
        </View>

        <View style={styles.packRow}>
          {packs.map((pack) => {
            const selected = isSelected('pack', pack.id);
            const saving = packSaving(pack);
            return (
              <Pressable
                key={pack.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={`${pack.coins} coins for ${priceFor(pack, pack.storePackage)}`}
                android_ripple={{ color: 'rgba(30,36,31,0.06)' }}
                style={({ pressed }) => [
                  styles.planCard,
                  selected && styles.planCardSelected,
                  pressed && styles.pressed,
                ]}
                onPress={() => setSelection({ kind: 'pack', id: pack.id })}
              >
                <View style={[styles.badge, pack.badge && styles.badgeOn]}>
                  {pack.badge ? (
                    <Text style={styles.badgeText} numberOfLines={1}>{pack.badge}</Text>
                  ) : null}
                </View>
                <View style={styles.cardBody}>
                  <Text style={styles.packCoins}>{pack.coins}</Text>
                  <Text style={styles.packUnit}>coins</Text>
                  <Text style={styles.packPrice}>{priceFor(pack, pack.storePackage)}</Text>
                  {saving > 0 ? (
                    <Text style={styles.savings}>Save {saving}%</Text>
                  ) : (
                    <View style={styles.savingsPlaceholder} />
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* ── One button, for whichever of the five is selected ───────────── */}
        <View style={styles.summary}>
          <Text style={styles.summaryLabel} numberOfLines={1}>
            {buyingPlan
              ? `${activePlan?.title} plan · per ${activePlan?.period}`
              : `${activePack?.coins} coins · one-off`}
          </Text>
          <Text style={styles.summaryValue}>
            {buyingPlan
              ? priceFor(activePlan, activePlan?.storePackage)
              : priceFor(activePack, activePack?.storePackage)}
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            buyingPlan
              ? `${isSubscribed ? 'Change to' : 'Subscribe to'} the ${activePlan?.title} plan`
              : `Buy ${activePack?.coins} coins`
          }
          accessibilityState={{ busy: !!busy, disabled: !!busy }}
          android_ripple={busy ? undefined : { color: 'rgba(255,255,255,0.20)' }}
          style={({ pressed }) => [
            styles.primaryButton,
            !!busy && styles.primaryButtonDisabled,
            pressed && !busy && styles.pressed,
          ]}
          disabled={!!busy}
          onPress={buyingPlan ? handleUpgrade : buyCoins}
        >
          {busy ? (
            <ActivityIndicator size="small" color={COLORS.textTertiary} />
          ) : (
            <Text style={[styles.primaryButtonText, !!busy && styles.primaryButtonTextDisabled]}>
              {buyingPlan
                ? (isSubscribed ? 'Change plan' : 'Upgrade now')
                : `Buy ${activePack?.coins} coins`}
            </Text>
          )}
        </Pressable>

        {/* Housekeeping, so it sits under the thing this page is actually for. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Manage your subscription"
          android_ripple={{ color: 'rgba(30,36,31,0.06)' }}
          style={({ pressed }) => [styles.ghostButton, pressed && styles.pressed]}
          onPress={() => router.push('/profile/manageSubscription')}
        >
          <Ionicons name="settings-outline" size={15} color={COLORS.textSecondary} />
          <Text style={styles.ghostButtonText}>Manage subscription</Text>
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
