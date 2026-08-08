import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Purchases from 'react-native-purchases';

import styles from '../../assets/styles/profile.styles';
import { useAuthStore } from '../../authStore';
import ConfirmDialog from '../../components/profile/ConfirmDialog';
import ScreenHeader from '../../components/ScreenHeader';
import SettingsRow from '../../components/profile/SettingsRow';
import COLORS from '../../constants/colors';
import { apiUrl } from '../../configs/api';

const capitalize = (text) =>
  !text || typeof text !== 'string' ? '' : text.charAt(0).toUpperCase() + text.slice(1);

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '—' : date.toLocaleDateString();
};

export default function Subscription() {
  const router = useRouter();
  const { token } = useAuthStore();

  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState('');

  /**
   * Load the current subscription.
   *
   * Having no subscription is a normal state, not a failure: the API answers 404
   * and this screen shows the "no plan" card. It used to `console.error` on that
   * path — and on RevenueCat not being configured — which in a development build
   * throws a red error box over the screen the moment it opens. That red box was
   * the "error" on this screen; there was never anything actually broken.
   */
  const load = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(apiUrl('/api/orders/latest'), {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });

      if (response.status === 404) {
        setPlan(null);
        return;
      }
      if (!response.ok) throw new Error('Subscription lookup failed');

      const { order } = await response.json();
      if (!order) {
        setPlan(null);
        return;
      }

      setPlan({
        name: `${capitalize(order.plan)} · ${capitalize(order.billingCycle)}`,
        price: `${order.price} ${order.billingCycle === 'weekly' ? '/ week' : '/ year'}`,
        renewsOn: formatDate(order.endDate),
        autoRenew: !!order.autoRenew,
        canceledAt: order.canceledAt ? formatDate(order.canceledAt) : null,
        isActive: !!order.isActive,
      });
    } catch {
      // A lookup that genuinely failed is reported in the UI, not the console.
      setPlan(null);
      setNotice("Your subscription details could not be loaded. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const cancelSubscription = async () => {
    setConfirming(false);
    // Cancelling actually happens in the store; the app only records that the
    // user asked, so the plan card stops promising a renewal.
    const storeUrl = Platform.OS === 'ios'
      ? 'https://apps.apple.com/account/subscriptions'
      : 'https://play.google.com/store/account/subscriptions';

    try {
      await Linking.openURL(storeUrl);
    } catch {
      setNotice('Open your device store to finish cancelling this subscription.');
    }

    try {
      await fetch(apiUrl('/api/orders/cancel-latest'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      setPlan((current) => (current ? { ...current, autoRenew: false, canceledAt: formatDate(Date.now()) } : current));
    } catch {
      setNotice('We could not record the cancellation. It will update the next time you open this screen.');
    }
  };

  // RevenueCat's offerings are only needed to change plans, which happens on the
  // upgrade screen. Warming them here is best-effort and must never be visible.
  useEffect(() => {
    Purchases.getOfferings?.().catch(() => {});
  }, []);

  return (
    <View style={styles.container}>
      <ScreenHeader title="Manage Subscription" />

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={COLORS.primaryDark} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
        >
          {!!notice && (
            <View style={[styles.section, styles.notice]}>
              <Text style={styles.noticeText}>{notice}</Text>
            </View>
          )}

          {plan ? (
            <>
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Current plan</Text>
                <View style={styles.card}>
                  <SettingsRow icon="sparkles" label="Plan" value={plan.name} accent />
                  <SettingsRow icon="pricetag-outline" label="Price" value={plan.price} showDivider />
                  <SettingsRow
                    icon="calendar-outline"
                    label={plan.autoRenew ? 'Renews on' : 'Ends on'}
                    value={plan.renewsOn}
                    showDivider
                  />
                  <SettingsRow
                    icon={plan.autoRenew ? 'refresh-outline' : 'pause-outline'}
                    label="Auto-renewal"
                    value={plan.autoRenew ? 'On' : 'Off'}
                    showDivider
                  />
                  {!!plan.canceledAt && (
                    <SettingsRow
                      icon="close-circle-outline"
                      label="Cancelled"
                      value={plan.canceledAt}
                      showDivider
                    />
                  )}
                </View>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Manage</Text>
                <View style={styles.card}>
                  <SettingsRow
                    icon="repeat-outline"
                    label="Change plan"
                    onPress={() => router.push('/profile/upgrade')}
                  />
                  <SettingsRow
                    icon="receipt-outline"
                    label="Payment history"
                    showDivider
                    onPress={() => router.push('/profile/payment-history')}
                  />
                  {plan.autoRenew && (
                    <SettingsRow
                      icon="close-circle-outline"
                      label="Cancel subscription"
                      showDivider
                      danger
                      onPress={() => setConfirming(true)}
                    />
                  )}
                </View>
              </View>
            </>
          ) : (
            <View style={styles.section}>
              <View style={styles.notice}>
                <View style={styles.noticeIcon}>
                  <Ionicons name="sparkles-outline" size={24} color={COLORS.primaryDark} />
                </View>
                <Text style={styles.noticeTitle}>No active subscription</Text>
                <Text style={styles.noticeText}>
                  Go premium for unlimited designs, no ads, and every render in full quality.
                </Text>
                <Pressable
                  style={styles.noticeButton}
                  accessibilityRole="button"
                  onPress={() => router.push('/profile/upgrade')}
                >
                  <Text style={styles.noticeButtonText}>View plans</Text>
                </Pressable>
              </View>
            </View>
          )}
        </ScrollView>
      )}

      <ConfirmDialog
        visible={confirming}
        title="Cancel Subscription"
        message="Auto-renewal will be turned off. You keep premium until the end of the current period."
        confirmLabel="Cancel plan"
        cancelLabel="Keep it"
        onCancel={() => setConfirming(false)}
        onConfirm={cancelSubscription}
      />
    </View>
  );
}
