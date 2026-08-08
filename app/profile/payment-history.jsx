import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import styles from '../../assets/styles/profile.styles';
import { useAuthStore } from '../../authStore';
import ScreenHeader from '../../components/ScreenHeader';
import SettingsRow from '../../components/profile/SettingsRow';
import COLORS from '../../constants/colors';
import { apiUrl } from '../../configs/api';

const capitalize = (text) =>
  !text || typeof text !== 'string' ? '' : text.charAt(0).toUpperCase() + text.slice(1);

const formatDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? '—'
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

/**
 * Past payments, in the same visual language as the rest of the profile area.
 *
 * Each order used to be a bespoke card of stacked "Label: value" sentences on a
 * white background, with its own shadow, radius and grey — nothing in it came
 * from the app's tokens, so this was the one screen behind Profile that looked
 * like it belonged to a different app. It is now a titled section per order made
 * of the same rows the settings lists use.
 */
export default function PaymentHistory() {
  const { token } = useAuthStore();
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    const fetchHistory = async () => {
      try {
        const response = await fetch(apiUrl('/api/orders/history'), {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        if (!response.ok) throw new Error('Failed to fetch payment history');
        const data = await response.json();
        setHistory(Array.isArray(data.orders) ? data.orders : []);
      } catch {
        // Reported on screen rather than through a red console error.
        setFailed(true);
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();
  }, [token]);

  return (
    <View style={styles.container}>
      <ScreenHeader title="Payment History" />

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={COLORS.primaryDark} />
        </View>
      ) : history.length ? (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
        >
          {history.map((order, index) => (
            <View key={order._id || index} style={styles.section}>
              <Text style={styles.sectionTitle}>
                {capitalize(order.plan)} · {capitalize(order.billingCycle)}
              </Text>
              <View style={styles.card}>
                <SettingsRow icon="pricetag-outline" label="Amount" value={`$${order.price}`} />
                <SettingsRow
                  icon="calendar-outline"
                  label="Period"
                  value={`${formatDate(order.startDate)} – ${formatDate(order.endDate)}`}
                  showDivider
                />
                <SettingsRow
                  icon={order.paymentStatus === 'paid' ? 'checkmark-circle-outline' : 'alert-circle-outline'}
                  label="Status"
                  value={capitalize(order.paymentStatus)}
                  showDivider
                />
                {!!order.transactionId && (
                  <SettingsRow
                    icon="barcode-outline"
                    label="Transaction"
                    value={order.transactionId}
                    showDivider
                  />
                )}
              </View>
            </View>
          ))}
        </ScrollView>
      ) : (
        <View style={{ paddingHorizontal: 16 }}>
          <View style={styles.notice}>
            <View style={styles.noticeIcon}>
              <Ionicons
                name={failed ? 'cloud-offline-outline' : 'receipt-outline'}
                size={24}
                color={COLORS.primaryDark}
              />
            </View>
            <Text style={styles.noticeTitle}>
              {failed ? 'Could not load payments' : 'No payments yet'}
            </Text>
            <Text style={styles.noticeText}>
              {failed
                ? 'Check your connection and open this screen again.'
                : 'Subscription payments will appear here once you upgrade.'}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}
