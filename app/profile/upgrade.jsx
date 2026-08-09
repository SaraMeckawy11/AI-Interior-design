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
import purchases, { LOG_LEVEL } from 'react-native-purchases';

import ScreenHeader from '../../components/ScreenHeader';
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
 * The screen's original shape, kept deliberately: a line of copy, the coins
 * card, a feature checklist, two plan cards side by side and a pill button.
 * What sits underneath it is not the original — the prices come from
 * `constants/pricing.js` rather than from literals scattered across six files,
 * the ad reward goes through `useRewardedCoins` (one ad, one coin, claimed
 * once), and the store's own localised price wins over any dollar figure typed
 * into this repository.
 *
 * Three claims the old screen made that were not true have gone with it: a
 * weekly plan that billed eleven times for the two months someone actually
 * redecorates, "Save 80%" printed beside two prices that did not support it,
 * and "each design costs 2 coins" when the server charges one.
 *
 * Coin packs are offered to subscribers as well. Hiding them meant a Pro member
 * who wanted to top up before letting a membership lapse had nowhere to do it.
 */

/** What Pro includes. */
const PRO_FEATURES = [
  'Ad-free experience',
  'Unlimited interior and exterior designs',
  'Unlimited 3D walkthrough renders',
];

export default function Upgrade() {
  const { token, fetchUser } = useAuthStore();
  const router = useRouter();

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

  /**
   * The localised price when the store answers, and the table's dollar figure
   * only as a last resort. A hardcoded USD amount shown to someone paying in
   * rupees is wrong about both the number and the currency.
   */
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
  const buyPlan = async () => {
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
      startDate.getTime()
        + (plan.id === 'monthly' ? 30 : 365) * 24 * 60 * 60 * 1000,
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
  if (loading) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Upgrade to Pro" />
        <View style={styles.centered}>
          <ActivityIndicator color={COLORS.primaryDark} size="large" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Upgrade to Pro" />

      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <Text style={styles.subtitle}>
          {isSubscribed
            ? 'Your Pro membership is active — every premium feature is unlocked.'
            : 'Unlock the full Livinai experience with premium features.'}
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
        <View style={styles.coinCard}>
          <View style={styles.coinTopRow}>
            <View style={styles.coinBadge}>
              <Ionicons name="ellipse" size={20} color={COLORS.accentStrong} />
            </View>
            <View style={styles.coinCopy}>
              <Text style={styles.coinValue}>{coins}</Text>
              <Text style={styles.coinLabel}>
                {coins === 1 ? 'coin on your account' : 'coins on your account'}
              </Text>
            </View>
          </View>

          {/* What a coin buys. The old card said "each design costs 2 coins" in
              a sentence nothing kept in step with the server, which charges
              one. These come from the shared price table. */}
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
            // Only while an ad is actually on screen. This used to be gated on
            // "not idle", and the hook reports `loading` for the whole
            // background warm-up — so the button arrived disabled and spinning.
            disabled={adStatus === 'showing'}
            onPress={watchAd}
          >
            {adStatus === 'showing' ? (
              <ActivityIndicator size="small" color={COLORS.textTertiary} />
            ) : (
              <>
                <Ionicons name="play-circle-outline" size={18} color={COLORS.white} />
                <Text style={styles.watchAdButtonText}>
                  Watch an ad, earn {coinLabel(AD_COIN_REWARD)}
                </Text>
              </>
            )}
          </Pressable>

          {adMessage ? <Text style={styles.adStatusText}>{adMessage}</Text> : null}
        </View>

        {/* ── What Pro includes ──────────────────────────────────────────── */}
        <View style={styles.featureList}>
          {PRO_FEATURES.map((feature) => (
            <View key={feature} style={styles.featureItem}>
              <Ionicons name="checkmark-circle-outline" size={20} color={COLORS.primaryDark} />
              <Text style={styles.featureText}>{feature}</Text>
            </View>
          ))}
        </View>

        {/* ── Plans, side by side ────────────────────────────────────────── */}
        <Text style={styles.planLabel}>
          {isSubscribed ? 'Your plan options' : 'Choose a plan'}
        </Text>

        <View style={styles.planOptions}>
          {plans.map((plan) => {
            const selected = !isSubscribed && selectedPlan === plan.id;
            const price = priceFor(plan, plan.storePackage);
            // The saving as arithmetic from the price table. "Save 80%" used to
            // be printed here beside two prices that did not support it.
            const saving = plan.id === 'yearly' ? `Save ${YEARLY_SAVING_PERCENT}%` : null;

            const body = (
              <>
                {/* Reserved on both cards, filled on one, so the titles align.
                    This badge used to hang outside the card at top:-8 right:-8,
                    where Android clipped it. */}
                <View style={[styles.planBadge, plan.badge && styles.planBadgeOn]}>
                  {plan.badge ? (
                    <Text style={styles.planBadgeText} numberOfLines={1}>{plan.badge}</Text>
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
                  {saving ? (
                    <Text style={styles.planSavings}>{saving}</Text>
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
          onPress={isSubscribed ? () => router.push('/profile/manageSubscription') : buyPlan}
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
                {isSubscribed ? 'Manage subscription' : 'Upgrade now'}
              </Text>
            </>
          )}
        </Pressable>

        {/* ── Or buy coins outright ──────────────────────────────────────── */}
        <View style={styles.sectionGap}>
          <Text style={styles.planLabel}>Or buy coins</Text>
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
          style={({ pressed }) => [styles.secondaryButton, pressed && !busy && styles.pressed]}
          disabled={!!busy}
          onPress={buyCoins}
        >
          {busy === 'pack' ? (
            <ActivityIndicator color={COLORS.primaryDark} />
          ) : (
            <Text style={styles.secondaryButtonText}>Buy {activePack?.coins} coins</Text>
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
