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

/**
 * What one billing period is called.
 *
 * This used to be `billingCycle === 'weekly' ? '/ week' : '/ year'`, written
 * when weekly and yearly were the only two plans. Weekly has since gone and
 * monthly has arrived, so every monthly subscriber was shown their monthly
 * price labelled "/ year" — the single most misleading thing this screen could
 * get wrong.
 */
const PERIOD_LABEL = {
  weekly: '/ week',
  monthly: '/ month',
  yearly: '/ year',
  annual: '/ year',
};

const periodLabel = (cycle) => PERIOD_LABEL[String(cycle || '').toLowerCase()] || '';

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
    setNotice('');
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
        // `order.plan` is already "Monthly Plan"; appending the cycle made it
        // read "Monthly Plan · Monthly".
        name: capitalize(order.plan) || 'Livinai Pro',
        price: `${order.price} ${periodLabel(order.billingCycle)}`.trim(),
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
          contentContainerStyle={styles.subscriptionContent}
          showsVerticalScrollIndicator={false}
        >
          {!!notice && !!plan && (
            <View style={[styles.section, styles.notice]}>
              <Text style={styles.noticeText}>{notice}</Text>
            </View>
          )}

          {plan ? (
            <>
              {/* The plan, its price and whether it is still running, as one
                  card. The four equal rows this replaces gave the auto-renew
                  flag the same weight as the plan's name, and buried the date
                  of the next charge — the fact people open this screen for. */}
              <View style={styles.planSummary}>
                <View style={styles.planSummaryTop}>
                  <View style={styles.planSummaryIcon}>
                    <Ionicons name="sparkles" size={20} color={COLORS.primaryDark} />
                  </View>
                  <View style={styles.planSummaryCopy}>
                    <Text style={styles.planSummaryName} numberOfLines={1}>{plan.name}</Text>
                    <Text style={styles.planSummaryPrice}>{plan.price}</Text>
                  </View>
                  <View
                    style={[
                      styles.statusPill,
                      plan.autoRenew ? styles.statusPillActive : styles.statusPillEnding,
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusPillText,
                        plan.autoRenew ? styles.statusPillTextActive : styles.statusPillTextEnding,
                      ]}
                    >
                      {plan.autoRenew ? 'Active' : 'Ending'}
                    </Text>
                  </View>
                </View>

                <View style={styles.planFacts}>
                  <View style={styles.planFactRow}>
                    <Ionicons name="calendar-outline" size={16} color={COLORS.textSecondary} />
                    <Text style={styles.planFactLabel}>
                      {plan.autoRenew ? 'Renews on' : 'Access ends on'}
                    </Text>
                    <Text style={styles.planFactValue}>{plan.renewsOn}</Text>
                  </View>
                  <View style={styles.planFactRow}>
                    <Ionicons
                      name={plan.autoRenew ? 'refresh-outline' : 'pause-outline'}
                      size={16}
                      color={COLORS.textSecondary}
                    />
                    <Text style={styles.planFactLabel}>Auto-renewal</Text>
                    <Text style={styles.planFactValue}>{plan.autoRenew ? 'On' : 'Off'}</Text>
                  </View>
                  {!!plan.canceledAt && (
                    <View style={styles.planFactRow}>
                      <Ionicons name="close-circle-outline" size={16} color={COLORS.textSecondary} />
                      <Text style={styles.planFactLabel}>Cancelled on</Text>
                      <Text style={styles.planFactValue}>{plan.canceledAt}</Text>
                    </View>
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
            <View style={styles.subscriptionEmpty}>
              <View style={styles.subscriptionEmptyIcon}>
                <Ionicons
                  name={notice ? 'cloud-offline-outline' : 'diamond-outline'}
                  size={27}
                  color={COLORS.primaryDark}
                />
              </View>
              <Text style={styles.subscriptionEmptyTitle}>
                {notice ? 'Couldn\'t load your subscription' : 'No active subscription'}
              </Text>
              <Text style={styles.subscriptionEmptyText}>
                {notice || 'You are currently using Livinai Free. Explore Pro whenever you are ready for unlimited creating.'}
              </Text>
              <Pressable
                style={({ pressed }) => [
                  styles.subscriptionEmptyButton,
                  pressed && styles.subscriptionEmptyButtonPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={notice ? 'Try loading subscription again' : 'Explore Pro plans'}
                onPress={notice ? load : () => router.push('/profile/upgrade')}
              >
                <Text style={styles.subscriptionEmptyButtonText}>
                  {notice ? 'Try again' : 'Explore Pro plans'}
                </Text>
                <Ionicons name="arrow-forward" size={17} color={COLORS.white} />
              </Pressable>
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
