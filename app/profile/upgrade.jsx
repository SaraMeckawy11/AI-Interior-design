import React, { useCallback, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import purchases from 'react-native-purchases';

import UpgradeExperience from '../../components/upgrade/UpgradeExperience';
import { useAuthStore } from '../../authStore';
import { apiUrl } from '../../configs/api';
import {
  COIN_PACKS,
  PLANS,
  coinLabel,
  sameStoreProduct,
} from '../../constants/pricing';
import useRewardedCoins from '../../lib/useRewardedCoins';
import { ensureRevenueCatConfigured } from '../../lib/revenueCat';

export default function Upgrade() {
  const { token, fetchUser } = useAuthStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [selection, setSelection] = useState({ kind: 'plan', id: 'yearly' });
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [offerings, setOfferings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [dialog, setDialog] = useState(null);

  // `loading` is what separates "not subscribed" from "not asked yet" here, and
  // it clears in a `finally`, so a failed account fetch still leaves ads
  // working rather than stranding the watch-ad button.
  const { coins, setCoins, status: adStatus, message: adMessage, watchAd } =
    useRewardedCoins(token, { enabled: !loading && !isSubscribed });

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      const init = async () => {
        try {
          let user = null;
          if (token) {
            const response = await fetch(apiUrl('/api/users/me'), {
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
            });
            if (response.ok) user = (await response.json()).user;
          }
          if (cancelled) return;

          if (user?._id) {
            setIsSubscribed(user.isSubscribed === true || user.isPremium === true);
            setCoins(Number(user.adCoins || 0));

            const storeReady = await ensureRevenueCatConfigured(user._id);
            if (!storeReady || cancelled) return;

            const current = await purchases.getOfferings();
            // Kept whether or not a *current* offering is set. On iOS the
            // Livinai products live in App Store Connect and are attached to
            // RevenueCat separately from the Play ones, and an offering that
            // has not been marked current there answered `current: null` — so
            // this screen threw away a perfectly good StoreKit response and
            // rendered every price as "Unavailable". Which is the whole bug:
            // Egyptian users saw no EGP prices on iOS because they saw no
            // prices at all.
            if (!cancelled && current) setOfferings(current);
            if (__DEV__ && current) {
              const names = Object.keys(current.all || {});
              console.info(
                `[store] current offering: ${current.current?.identifier || 'none'}; `
                + `all: ${names.join(', ') || 'none'}`,
              );
            }
          }
        } catch (error) {
          // Opening pricing should never surface a native-store error. Missing
          // products simply render as unavailable and can be retried next time.
          if (__DEV__) console.info('Store is unavailable:', error?.message);
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

  /**
   * Every package the store answered with, current offering first.
   *
   * `constants/pricing.js` names products in Google Play's `product:base-plan`
   * form, because that is the store this app shipped on first. App Store Connect
   * has no such syntax and no reason to have picked the same identifiers, so
   * matching iOS packages by product id alone was always going to be brittle —
   * and when it missed, the screen had nothing to show a price with.
   *
   * Deduplicated on the product identifier, so a product that appears in more
   * than one offering is one entry and the current offering's copy is the one
   * kept.
   */
  const storePackages = useMemo(() => {
    if (!offerings) return [];
    const seen = new Set();
    const packages = [];
    const collect = (offering) => {
      for (const item of offering?.availablePackages || []) {
        const key = item.product?.identifier || item.identifier;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        packages.push(item);
      }
    };
    collect(offerings.current);
    for (const offering of Object.values(offerings.all || {})) collect(offering);
    return packages;
  }, [offerings]);

  // Subscriptions are found by package type first. That is the one identifier
  // RevenueCat defines itself, so it means the same thing on both stores however
  // the products underneath are named.
  const packageForPlan = useCallback(
    (plan) =>
      storePackages.find((item) => item.packageType === plan.packageType) ||
      storePackages.find((item) => sameStoreProduct(item.product?.identifier, plan.productId)) ||
      storePackages.find((item) => sameStoreProduct(item.identifier, plan.productId)),
    [storePackages],
  );

  // Coin packs are consumables, so every one of them is packageType CUSTOM and
  // the type cannot tell them apart. The package's own identifier is the second
  // chance: it is set in the RevenueCat dashboard rather than in the store, so it
  // can agree across platforms even when the SKUs do not.
  const packageForPack = useCallback(
    (pack) =>
      storePackages.find((item) => sameStoreProduct(item.product?.identifier, pack.productId)) ||
      storePackages.find((item) => sameStoreProduct(item.identifier, pack.productId)) ||
      storePackages.find((item) => sameStoreProduct(item.identifier, pack.id)),
    [storePackages],
  );

  // StoreKit/Play Billing owns the displayed currency. For an Egyptian store
  // account this is an EGP string. Never replace a missing store response with
  // a converted USD price: the label must exactly match the purchase sheet.
  const priceFor = useCallback(
    (_entry, storePackage) => storePackage?.product?.priceString || 'Unavailable',
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
  const isSelected = (kind, id) => selection.kind === kind && selection.id === id;

  const selectPurchaseType = (kind) => {
    setSelection(
      kind === 'plan'
        ? { kind: 'plan', id: 'yearly' }
        : { kind: 'pack', id: 'coins_30' },
    );
  };

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
    try {
      const result = await purchases.purchasePackage(plan.storePackage);
      const entitlements = result?.customerInfo?.entitlements?.active;
      const productId = result?.productIdentifier || plan.storePackage.product?.identifier;
      const transactionId = result?.transaction?.transactionIdentifier;
      const entitlement = Object.values(entitlements || {}).find((item) =>
        sameStoreProduct(item?.productIdentifier, productId),
      );

      if (!transactionId || !entitlement) {
        throw new Error(
          'The store accepted the purchase, but Pro is still waiting for confirmation. It will activate automatically.',
        );
      }

      const response = await fetch(apiUrl('/api/orders'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          productId,
          price: plan.storePackage.product?.price || plan.priceUsd,
          transactionId,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Your subscription could not be recorded on your account.');
      }

      if (data.pending) {
        setDialog({ title: 'Purchase received', message: data.message });
        return;
      }

      await fetchUser();
      setIsSubscribed(true);
      router.replace('/(tabs)/profile');
    } catch (error) {
      if (error?.userCancelled) return;
      console.error('Purchase failed:', error);
      setDialog({
        title: 'That purchase did not go through',
        message:
          error?.message ||
          `Nothing has been charged. Please try again, or check your payment method in the ${
            Platform.OS === 'ios' ? 'App Store' : 'Play Store'
          }.`,
      });
    } finally {
      setBusy('');
    }
  };

  const restorePurchases = async () => {
    setBusy('restore');
    try {
      const user = await fetchUser();
      if (!user?._id) throw new Error('Sign in to restore purchases.');

      const storeReady = await ensureRevenueCatConfigured(user._id);
      if (!storeReady) throw new Error('The store is not available on this device.');

      const customerInfo = await purchases.restorePurchases();
      const activeEntitlements = customerInfo?.entitlements?.active || {};
      if (!Object.keys(activeEntitlements).length) {
        setDialog({
          title: 'No active purchases found',
          message: 'Make sure you are signed in with the Apple ID or Google account that made the purchase.',
        });
        return;
      }

      const response = await fetch(apiUrl('/api/orders/restore'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Your subscription could not be restored.');
      }

      await fetchUser();
      setIsSubscribed(true);
      setDialog({
        title: 'Purchases restored',
        message: 'Your Livinai Pro access is active on this device again.',
      });
    } catch (error) {
      setDialog({
        title: 'Could not restore purchases',
        message: error?.message || 'Check your connection and try again.',
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
      const transactionId = result?.transaction?.transactionIdentifier;
      const purchasedProductId = result?.productIdentifier || pack.storePackage.product?.identifier;

      if (!transactionId) {
        throw new Error(
          'The store accepted the purchase but has not returned its receipt yet. Your coins will be added automatically.',
        );
      }

      const response = await fetch(apiUrl('/api/users/coins/purchase'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          packId: pack.id,
          productId: purchasedProductId,
          transactionId,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Your coins could not be added to your account.');
      }

      if (typeof data.adCoins === 'number') setCoins(data.adCoins);
      setDialog(
        data.pending
          ? { title: 'Purchase received', message: data.message }
          : {
              title: 'Coins added',
              message: `${coinLabel(pack.coins)} are on your account. You now have ${data.adCoins}.`,
            },
      );
    } catch (error) {
      if (error?.userCancelled) return;
      console.error('Coin purchase failed:', error);
      setDialog({
        title: 'That purchase did not complete',
        message:
          error?.message ||
          'If you were charged, your coins will appear the next time you open this screen.',
      });
    } finally {
      setBusy('');
    }
  };

  return (
    <UpgradeExperience
      activePack={activePack}
      activePlan={activePlan}
      adMessage={adMessage}
      adStatus={adStatus}
      busy={busy}
      buyingPlan={buyingPlan}
      coins={coins}
      dialog={dialog}
      insets={insets}
      isSelected={isSelected}
      isSubscribed={isSubscribed}
      loading={loading}
      onBack={() => router.back()}
      onCloseDialog={() => setDialog(null)}
      onManageSubscription={() => router.push('/profile/manageSubscription')}
      onOpenPrivacy={() => router.push('/profile/privacy')}
      onOpenTerms={() => router.push('/profile/terms')}
      onPurchase={buyingPlan ? handleUpgrade : buyCoins}
      onRestorePurchases={restorePurchases}
      packs={packs}
      plans={plans}
      priceFor={priceFor}
      selectPurchaseType={selectPurchaseType}
      setSelection={setSelection}
      watchAd={watchAd}
    />
  );
}
