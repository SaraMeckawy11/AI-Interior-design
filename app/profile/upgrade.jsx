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
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import purchases, { LOG_LEVEL } from 'react-native-purchases';

import ScreenHeader from '../../components/ScreenHeader';
import styles from '../../assets/styles/upgrade.styles';
import { useAuthStore } from '../../authStore';
import { apiUrl } from '../../configs/api';
import COLORS from '../../constants/colors';
import { SPACING } from '../../constants/theme';
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
 * The store.
 *
 * Two ways to pay, for two different people: a subscription for anyone who uses
 * Livinai, and coins for anyone who wants a handful of renders and nothing
 * ongoing. Ads are the third door and cost nothing but time.
 *
 * A segmented control picks which of the two you are looking at, and the price
 * and the single button that applies to it live in a bar docked to the bottom.
 * Both tabs are there whether or not you are subscribed: hiding the coin packs
 * from Pro members meant someone who wanted to top up before letting a
 * subscription lapse had nowhere on the screen to do it, and the screen simply
 * lied about what Livinai sells.
 *
 * Weekly billing is gone — see `constants/pricing.js` for why — and the coin
 * price list is on the screen, because "43 coins" is not information until you
 * know what a design costs.
 */

/** What Pro is, said once and plainly. */
const PRO_BENEFITS = [
  'Unlimited interior and exterior designs',
  'Unlimited 3D walkthrough renders',
  'No ads anywhere in the app',
];

export default function Upgrade() {
  const { token, fetchUser } = useAuthStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState('pro'); // 'pro' | 'coins'
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

  const monthly = PLANS.find((plan) => plan.id === 'monthly');
  const activePlan = plans.find((plan) => plan.id === selectedPlan);
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

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Livinai Pro" />
        <View style={styles.container}>
          <View style={styles.skeletonHero} />
          <View style={styles.skeletonBar} />
          <View style={styles.skeletonRow} />
          <View style={styles.skeletonRow} />
        </View>
      </View>
    );
  }

  // ── What the docked bar says, for each of the three states ────────────────
  const bar = mode === 'coins'
    ? {
        label: coinLabel(activePack?.coins ?? 0),
        value: priceFor(activePack, activePack?.storePackage),
        icon: 'wallet-outline',
        cta: `Buy ${activePack?.coins} coins`,
        note: 'A one-off purchase. Nothing renews and there is nothing to cancel.',
        busyHere: busy === 'pack',
        onPress: buyCoins,
      }
    : isSubscribed
      ? {
          label: 'Billing, receipts and cancellation',
          value: 'Pro',
          icon: 'settings-outline',
          cta: 'Manage subscription',
          note: 'Plan changes are handled by the Play Store.',
          busyHere: false,
          onPress: () => router.push('/profile/manageSubscription'),
        }
      : {
          label: `${activePlan?.title} plan`,
          value: priceFor(activePlan, activePlan?.storePackage),
          icon: 'sparkles',
          cta: 'Start Pro',
          note: `Renews every ${activePlan?.period}. Cancel any time in the Play Store.`,
          busyHere: busy === 'plan',
          onPress: buyPlan,
        };

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Livinai Pro" />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        <LinearGradient
          colors={COLORS.gradientBrandDeep}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={styles.heroPill}>
            <Ionicons name="sparkles" size={11} color={COLORS.white} />
            <Text style={styles.heroPillText}>{isSubscribed ? 'Pro active' : 'Livinai Pro'}</Text>
          </View>
          <Text style={styles.heroTitle}>
            {isSubscribed ? 'Your ideas, without limits.' : 'Make every space feel possible.'}
          </Text>
          <Text style={styles.heroText}>
            {isSubscribed
              ? 'Designs, walkthroughs and an ad-free app, all unlimited.'
              : 'Unlimited room designs and walkthrough renders, with nothing to count.'}
          </Text>
        </LinearGradient>

        {/* ── One question at a time, for everyone ───────────────────────── */}
        <View accessibilityRole="tablist" style={styles.segment}>
          {[
            { id: 'pro', label: isSubscribed ? 'Your plan' : 'Go unlimited' },
            { id: 'coins', label: 'Buy coins' },
          ].map((tab) => {
            const on = mode === tab.id;
            return (
              <Pressable
                key={tab.id}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={tab.label}
                android_ripple={{ color: 'rgba(30,36,31,0.06)' }}
                style={({ pressed }) => [
                  styles.segmentTab,
                  on && styles.segmentTabOn,
                  pressed && !on && styles.pressed,
                ]}
                onPress={() => setMode(tab.id)}
              >
                <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{tab.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {mode === 'pro' ? (
          <View style={styles.panel}>
            {isSubscribed ? (
              <>
                <View style={styles.statusRow}>
                  <Ionicons name="checkmark-circle" size={20} color={COLORS.primaryDark} />
                  <Text style={styles.statusText}>Your Pro access is active.</Text>
                </View>

                <View>
                  <Text style={styles.sectionTitle}>What Pro costs</Text>
                  <Text style={styles.sectionHint}>
                    Your membership stays active while you review these.
                  </Text>
                </View>
              </>
            ) : (
              <>
                <View style={styles.benefitList}>
                  {PRO_BENEFITS.map((benefit) => (
                    <View key={benefit} style={styles.benefitRow}>
                      <Ionicons name="checkmark-circle" size={20} color={COLORS.primaryDark} />
                      <Text style={styles.benefitText}>{benefit}</Text>
                    </View>
                  ))}
                </View>

                <Text style={styles.sectionTitle}>Choose how you pay</Text>
              </>
            )}

            {plans.map((plan) => {
              const price = priceFor(plan, plan.storePackage);
              const selected = selectedPlan === plan.id;
              const note = plan.id === 'yearly'
                ? `About $${(plan.priceUsd / 12).toFixed(2)} a month — ${YEARLY_SAVING_PERCENT}% less than monthly`
                : `Billed every month at $${monthly.priceUsd.toFixed(2)}`;

              const copy = (
                <>
                  <View style={styles.planCopy}>
                    <View style={styles.planTitleRow}>
                      <Text style={styles.planTitle}>{plan.title}</Text>
                      {plan.badge ? (
                        <View style={styles.badge}>
                          <Text style={styles.badgeText}>{plan.badge}</Text>
                        </View>
                      ) : null}
                    </View>
                    {/* The saving as arithmetic rather than as a badge. The
                        original screen claimed "Save 80%" beside two prices
                        that did not support it. */}
                    <Text style={styles.planNote}>{note}</Text>
                  </View>
                  <View style={styles.planPriceBlock}>
                    <Text style={styles.planPrice}>{price}</Text>
                    <Text style={styles.planPeriod}>per {plan.period}</Text>
                  </View>
                </>
              );

              // A subscriber is reading, not choosing: no radio, no border, no
              // press state, because none of it would do anything.
              return isSubscribed ? (
                <View
                  key={plan.id}
                  accessibilityRole="text"
                  accessibilityLabel={`${plan.title} plan, ${price} per ${plan.period}`}
                  style={styles.planCardStatic}
                >
                  {copy}
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
                  <View style={[styles.radio, selected && styles.radioOn]}>
                    {selected ? <View style={styles.radioDot} /> : null}
                  </View>
                  {copy}
                </Pressable>
              );
            })}
          </View>
        ) : (
          <View style={styles.panel}>
            {/* ── Balance, and what a coin is worth ─────────────────────── */}
            <View>
              <Text style={styles.balanceValue}>{coins}</Text>
              <Text style={styles.balanceLabel}>
                {coins === 1 ? 'coin on your account' : 'coins on your account'}
              </Text>

              <View style={styles.priceList}>
                <View style={styles.priceRow}>
                  <Ionicons name="color-palette-outline" size={16} color={COLORS.textSecondary} />
                  <Text style={styles.priceLabel}>Interior or exterior design</Text>
                  <Text style={styles.priceValue}>{coinLabel(COIN_COST.design)}</Text>
                </View>
                <View style={styles.priceRow}>
                  <Ionicons name="cube-outline" size={16} color={COLORS.textSecondary} />
                  <Text style={styles.priceLabel}>3D walkthrough render</Text>
                  <Text style={styles.priceValue}>{coinLabel(COIN_COST.walkthrough)}</Text>
                </View>
              </View>
            </View>

            {/* Coins are on sale to subscribers now, so the screen has to be
                straight about the fact that Pro already covers every render.
                Selling someone something their plan makes redundant, without
                saying so, is the kind of thing stores remove apps for. */}
            {isSubscribed ? (
              <Text style={styles.note}>
                Pro already covers every design and walkthrough, so you do not need coins while
                your membership is active. They keep working if it ever lapses.
              </Text>
            ) : null}

            <View>
              <Text style={styles.sectionTitle}>Top up</Text>
              <Text style={styles.sectionHint}>
                Coins never expire and there is nothing to cancel.
              </Text>
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
                    {/* Always rendered, badge or not, so the coin figures on
                        all three tiles sit on one line. */}
                    <View style={[styles.packBadge, pack.badge && styles.packBadgeOn]}>
                      {pack.badge ? (
                        <Text style={styles.packBadgeText} numberOfLines={1}>
                          {pack.badge}
                        </Text>
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

            {/* ── Or pay with time ─────────────────────────────────────── */}
            <View style={styles.earnRow}>
              <View style={styles.earnCopy}>
                <Text style={styles.earnTitle}>Watch an ad, earn {coinLabel(AD_COIN_REWARD)}</Text>
                <Text style={styles.earnText} numberOfLines={2}>
                  {adMessage || 'Free, and it takes about thirty seconds.'}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Watch an ad to earn ${coinLabel(AD_COIN_REWARD)}`}
                accessibilityState={{
                  busy: adStatus === 'showing',
                  disabled: adStatus === 'showing',
                }}
                android_ripple={{ color: 'rgba(255,255,255,0.24)' }}
                style={({ pressed }) => [
                  styles.earnButton,
                  adStatus === 'showing' && styles.earnButtonBusy,
                  pressed && styles.pressed,
                ]}
                // Only while an ad is actually on screen. The hook reports
                // `loading` for the whole background warm-up, which had this
                // button disabled and spinning from the moment you arrived.
                disabled={adStatus === 'showing'}
                onPress={watchAd}
              >
                {adStatus === 'showing' ? (
                  <ActivityIndicator size="small" color={COLORS.textTertiary} />
                ) : (
                  <Text style={styles.earnButtonText}>Watch</Text>
                )}
              </Pressable>
            </View>
          </View>
        )}

        <Text style={styles.note}>
          Subscriptions renew automatically until cancelled, and can be cancelled any time in the
          Play Store. Coin packs are a one-off purchase and are not refundable once the coins are
          spent.
        </Text>
      </ScrollView>

      {/* ── The price, and the one button that pays it ───────────────────── */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + SPACING.md }]}>
        <View style={styles.footerSummary}>
          <Text style={styles.footerLabel} numberOfLines={1}>{bar.label}</Text>
          <Text style={styles.footerValue}>{bar.value}</Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={bar.cta}
          accessibilityState={{ busy: bar.busyHere, disabled: !!busy }}
          android_ripple={busy ? undefined : { color: 'rgba(255,255,255,0.20)' }}
          style={({ pressed }) => [
            styles.primary,
            !!busy && styles.primaryDisabled,
            pressed && !busy && styles.pressed,
          ]}
          disabled={!!busy}
          onPress={bar.onPress}
        >
          {bar.busyHere ? (
            <ActivityIndicator color={COLORS.textTertiary} />
          ) : (
            <>
              <Ionicons
                name={bar.icon}
                size={17}
                color={busy ? COLORS.textTertiary : COLORS.white}
              />
              <Text style={[styles.primaryText, !!busy && styles.primaryTextDisabled]}>
                {bar.cta}
              </Text>
            </>
          )}
        </Pressable>

        <Text style={styles.footerNote}>{bar.note}</Text>
      </View>

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
