import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import purchases, { LOG_LEVEL } from 'react-native-purchases';

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

  const { coins, setCoins, status: adStatus, message: adMessage, watchAd } =
    useRewardedCoins(token);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      const init = async () => {
        try {
          purchases.setLogLevel(LOG_LEVEL.DEBUG);

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

            await purchases.configure({
              apiKey: 'goog_uVORiYiVgmggjNiOAHvBLferRyp',
              appUserID: user._id.toString(),
            });

            const current = await purchases.getOfferings();
            if (!cancelled && current?.current) setOfferings(current);
          }
        } catch (error) {
          console.error('Store initialisation error:', error);
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

  const packageForPlan = useCallback(
    (plan) => {
      const availablePackages = offerings?.current?.availablePackages || [];
      return (
        availablePackages.find((item) => item.packageType === plan.packageType) ||
        availablePackages.find((item) =>
          sameStoreProduct(item.product?.identifier, plan.productId),
        )
      );
    },
    [offerings],
  );

  const packageForPack = useCallback(
    (pack) =>
      (offerings?.current?.availablePackages || []).find((item) =>
        sameStoreProduct(item.product?.identifier, pack.productId),
      ),
    [offerings],
  );

  // Play/RevenueCat owns the displayed currency. For an Egyptian Play account
  // this is an EGP string (for example, "EGP 109.99"). Never replace a missing
  // store response with a hardcoded USD price; that can show the wrong currency
  // and amount immediately beside a button that charges something else.
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
          'Nothing has been charged. Please try again, or check your payment method in the Play Store.',
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
      onPurchase={buyingPlan ? handleUpgrade : buyCoins}
      packs={packs}
      plans={plans}
      priceFor={priceFor}
      selectPurchaseType={selectPurchaseType}
      setSelection={setSelection}
      watchAd={watchAd}
    />
  );
}
