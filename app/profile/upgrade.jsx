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
 * The store.
 *
 * Two ways to pay, and they are for different people, so they are two sections
 * rather than two buttons: a subscription for anyone who uses Livinai, and coins
 * for anyone who wants a handful of renders and nothing ongoing. Ads are the
 * third door and cost nothing but time.
 *
 * Weekly billing is gone — see `constants/pricing.js` for why — and the coin
 * price list is on the screen now, because "43 coins" is not information until
 * you know what a design costs.
 */
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

  const monthly = PLANS.find((plan) => plan.id === 'monthly');

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
        <ScreenHeader title="Livinai Pro" />
        <View style={styles.centered}>
          <ActivityIndicator color={COLORS.primaryDark} size="large" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Livinai Pro" />

      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <LinearGradient
          colors={COLORS.gradientBrandDeep}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={styles.heroGlow} />
          <View style={styles.heroTopRow}>
            <View style={styles.heroPill}>
              <Ionicons name="sparkles" size={12} color={COLORS.white} />
              <Text style={styles.heroPillText}>{isSubscribed ? 'PRO ACTIVE' : 'LIVINAI PRO'}</Text>
            </View>
            <View style={styles.heroMark}>
              <Ionicons name="diamond-outline" size={20} color={COLORS.white} />
            </View>
          </View>
          <Text style={styles.heroTitle}>
            {isSubscribed ? 'Your ideas, without limits.' : 'Make every space feel possible.'}
          </Text>
          <Text style={styles.heroText}>
            Unlimited room designs and walkthrough renders, with no ads or credits to count.
          </Text>
          <View style={styles.heroBenefits}>
            {['Unlimited renders', 'No ads', 'Full quality'].map((benefit) => (
              <View key={benefit} style={styles.heroBenefit}>
                <Ionicons name="checkmark" size={13} color={COLORS.white} />
                <Text style={styles.heroBenefitText}>{benefit}</Text>
              </View>
            ))}
          </View>
        </LinearGradient>

        {isSubscribed ? (
          <>
            <View style={styles.activeCard}>
              <View style={styles.activeIcon}>
                <Ionicons name="checkmark" size={22} color={COLORS.primaryDark} />
              </View>
              <View style={styles.activeCopy}>
                <Text style={styles.activeTitle}>Your Pro access is active</Text>
                <Text style={styles.activeText}>Every premium feature is unlocked on this account.</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Manage your subscription"
                style={({ pressed }) => [styles.activeAction, pressed && styles.pressed]}
                onPress={() => router.push('/profile/manageSubscription')}
              >
                <Ionicons name="chevron-forward" size={18} color={COLORS.primaryDark} />
              </Pressable>
            </View>

            <View style={styles.sectionHead}>
              <Text style={styles.sectionEyebrow}>PLAN OPTIONS</Text>
              <Text style={styles.sectionTitle}>Compare every Pro plan</Text>
              <Text style={styles.sectionHint}>Your membership stays active while you review the available billing options.</Text>
            </View>

            <View style={styles.plansPanel}>
              {plans.map((plan) => {
                const price = priceFor(plan, plan.storePackage);
                return (
                  <View
                    key={plan.id}
                    accessibilityRole="text"
                    accessibilityLabel={`${plan.title} plan, ${price} per ${plan.period}`}
                    style={styles.availablePlanCard}
                  >
                    <View style={styles.availablePlanIcon}>
                      <Ionicons name={plan.id === 'yearly' ? 'calendar-outline' : 'repeat-outline'} size={17} color={COLORS.primaryDark} />
                    </View>
                    <View style={styles.planCopy}>
                      <View style={styles.planTitleRow}>
                        <Text style={styles.planTitle}>{plan.title}</Text>
                        {plan.badge ? <View style={styles.badge}><Text style={styles.badgeText}>{plan.badge}</Text></View> : null}
                      </View>
                      <Text style={styles.planNote}>
                        {plan.id === 'yearly' ? `Save ${YEARLY_SAVING_PERCENT}% compared with monthly` : 'Flexible monthly billing'}
                      </Text>
                    </View>
                    <View style={styles.planPriceBlock}>
                      <Text style={styles.planPrice}>{price}</Text>
                      <Text style={styles.planPeriod}>per {plan.period}</Text>
                    </View>
                  </View>
                );
              })}
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Manage your Pro subscription"
              style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
              onPress={() => router.push('/profile/manageSubscription')}
            >
              <Ionicons name="settings-outline" size={18} color={COLORS.white} />
              <Text style={styles.primaryText}>Manage subscription</Text>
              <Ionicons name="arrow-forward" size={18} color={COLORS.white} />
            </Pressable>
          </>
        ) : (
          <>
            {/* ── Balance and the price list ─────────────────────────────── */}
            <View style={styles.balanceCard}>
              <View style={styles.balanceRow}>
                <View style={styles.balanceIcon}>
                  <Ionicons name="ellipse" size={20} color={COLORS.primaryDark} />
                </View>
                <View style={styles.balanceCopy}>
                  <Text style={styles.balanceValue}>{coins}</Text>
                  <Text style={styles.balanceLabel}>
                    {coins === 1 ? 'coin on your account' : 'coins on your account'}
                  </Text>
                </View>
              </View>

              {/* What a coin buys. Without this the balance is a number with no
                  unit, and the only place the old screen said so was a sentence
                  that had gone out of date. */}
              <View style={styles.priceList}>
                <View style={styles.priceRow}>
                  <Ionicons name="color-palette-outline" size={15} color={COLORS.textSecondary} />
                  <Text style={styles.priceLabel}>Interior or exterior design</Text>
                  <Text style={styles.priceValue}>{coinLabel(COIN_COST.design)}</Text>
                </View>
                <View style={styles.priceRow}>
                  <Ionicons name="cube-outline" size={15} color={COLORS.textSecondary} />
                  <Text style={styles.priceLabel}>3D walkthrough render</Text>
                  <Text style={styles.priceValue}>{coinLabel(COIN_COST.walkthrough)}</Text>
                </View>
              </View>

              <View style={styles.earnRow}>
                <View style={styles.earnIcon}>
                  <Ionicons name="play" size={17} color={COLORS.accentStrong} />
                </View>
                <View style={styles.earnCopy}>
                  <Text style={styles.earnTitle}>Watch an ad, earn {coinLabel(AD_COIN_REWARD)}</Text>
                  <Text style={styles.earnText} numberOfLines={2}>
                    {adMessage || 'Free, and it takes about thirty seconds.'}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Watch an ad to earn ${coinLabel(AD_COIN_REWARD)}`}
                  accessibilityState={{ busy: adStatus !== 'idle', disabled: adStatus !== 'idle' }}
                  android_ripple={{ color: 'rgba(255,255,255,0.24)' }}
                  style={({ pressed }) => [
                    styles.earnButton,
                    adStatus !== 'idle' && styles.earnButtonBusy,
                    pressed && styles.pressed,
                  ]}
                  disabled={adStatus !== 'idle'}
                  onPress={watchAd}
                >
                  {adStatus === 'idle' ? (
                    <Text style={styles.earnButtonText}>Watch</Text>
                  ) : (
                    <ActivityIndicator size="small" color={COLORS.accentStrong} />
                  )}
                </Pressable>
              </View>
            </View>

            {/* ── Subscribe ─────────────────────────────────────────────── */}
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>Go unlimited</Text>
              <Text style={styles.sectionHint}>
                No coins, no ads, no counting. Cancel whenever you like.
              </Text>
            </View>

            <View style={styles.featureList}>
              {[
                'Unlimited interior and exterior designs',
                'Unlimited 3D walkthrough renders',
                'No ads anywhere in the app',
              ].map((feature) => (
                <View key={feature} style={styles.featureItem}>
                  <Ionicons name="checkmark-circle" size={18} color={COLORS.primaryDark} />
                  <Text style={styles.featureText}>{feature}</Text>
                </View>
              ))}
            </View>

            {plans.map((plan) => {
              const selected = selectedPlan === plan.id;
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
                  onPress={() => setSelectedPlan(plan.id)}
                >
                  <View style={[styles.radio, selected && styles.radioOn]}>
                    {selected ? <View style={styles.radioDot} /> : null}
                  </View>
                  <View style={styles.planCopy}>
                    <View style={styles.planTitleRow}>
                      <Text style={styles.planTitle}>{plan.title}</Text>
                      {plan.badge ? (
                        <View style={styles.badge}>
                          <Text style={styles.badgeText}>{plan.badge}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.planPrice}>
                      {price} <Text style={styles.planNote}>/ {plan.period}</Text>
                    </Text>
                    {/* The saving, as arithmetic rather than as a badge. The old
                        screen claimed "Save 80%" beside two prices that did not
                        support it. */}
                    <Text style={styles.planNote}>
                      {plan.id === 'yearly'
                        ? `Works out at $${(plan.priceUsd / 12).toFixed(2)} a month — ${YEARLY_SAVING_PERCENT}% less than monthly`
                        : `Billed every month at $${monthly.priceUsd.toFixed(2)}`}
                    </Text>
                  </View>
                </Pressable>
              );
            })}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Subscribe to Livinai Pro"
              accessibilityState={{ busy: busy === 'plan', disabled: !!busy }}
              android_ripple={busy ? undefined : { color: 'rgba(255,255,255,0.20)' }}
              style={({ pressed }) => [
                styles.primary,
                !!busy && styles.primaryDisabled,
                pressed && !busy && styles.pressed,
              ]}
              disabled={!!busy}
              onPress={buyPlan}
            >
              {busy === 'plan' ? (
                <ActivityIndicator color={COLORS.textTertiary} />
              ) : (
                <>
                  <Ionicons
                    name="sparkles"
                    size={17}
                    color={busy ? COLORS.textTertiary : COLORS.white}
                  />
                  <Text style={[styles.primaryText, !!busy && styles.primaryTextDisabled]}>
                    Subscribe
                  </Text>
                </>
              )}
            </Pressable>

            {/* ── Or buy coins ──────────────────────────────────────────── */}
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>Or just buy coins</Text>
              <Text style={styles.sectionHint}>
                A one-off purchase. They never expire and there is nothing to cancel.
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
                    {pack.badge ? (
                      <View style={styles.packBadge}>
                        <Text style={styles.packBadgeText}>{pack.badge}</Text>
                      </View>
                    ) : null}
                    <Text style={styles.packCoins}>{pack.coins}</Text>
                    <Text style={styles.packUnit}>coins</Text>
                    <Text style={styles.packPrice}>{priceFor(pack, pack.storePackage)}</Text>
                    {saving > 0 ? (
                      <Text style={styles.packSaving}>Save {saving}%</Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Buy the selected coin pack"
              accessibilityState={{ busy: busy === 'pack', disabled: !!busy }}
              android_ripple={busy ? undefined : { color: 'rgba(255,255,255,0.20)' }}
              style={({ pressed }) => [
                styles.primary,
                !!busy && styles.primaryDisabled,
                pressed && !busy && styles.pressed,
              ]}
              disabled={!!busy}
              onPress={buyCoins}
            >
              {busy === 'pack' ? (
                <ActivityIndicator color={COLORS.textTertiary} />
              ) : (
                <Text style={[styles.primaryText, !!busy && styles.primaryTextDisabled]}>
                  Buy {packs.find((pack) => pack.id === selectedPack)?.coins} coins
                </Text>
              )}
            </Pressable>

            <Text style={styles.trustNote}>
              Subscriptions renew automatically until cancelled, and can be cancelled any time in
              the Play Store. Coin packs are a one-off purchase and are not refundable once the
              coins are spent.
            </Text>
          </>
        )}
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
