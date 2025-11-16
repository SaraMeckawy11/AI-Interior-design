import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../authStore';
import Loader from '../../components/Loader';
import COLORS from '../../constants/colors';
import { scale, verticalScale } from 'react-native-size-matters';

export default function PaymentHistory() {
  const { token } = useAuthStore();
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;

    const fetchHistory = async () => {
      try {
        const response = await fetch(`${process.env.EXPO_PUBLIC_SERVER_URI}/api/orders/history`, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) throw new Error('Failed to fetch payment history');

        const data = await response.json();
        setHistory(data.orders);
      } catch (err) {
        console.error('Fetch history error:', err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();
  }, [token]);

  if (loading) return <Loader />;

  if (history.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>No payment history found.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Payment History</Text>

      {history.map((order, index) => (
        <View key={index} style={styles.card}>
          <View style={styles.headerRow}>
            <Ionicons name="receipt-outline" size={20} color={COLORS.iconGray} />
            <Text style={styles.planText}>
              {capitalize(order.plan)} – {capitalize(order.billingCycle)}
            </Text>
          </View>

          <Text style={styles.infoText}>Price: ${order.price}</Text>
          <Text style={styles.infoText}>Start: {formatDate(order.startDate)}</Text>
          <Text style={styles.infoText}>End: {formatDate(order.endDate)}</Text>
          <Text style={styles.infoText}>Status: {capitalize(order.paymentStatus)}</Text>
          {order.transactionId && (
            <Text style={styles.infoText}>Transaction ID: {order.transactionId}</Text>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

const capitalize = (text) => {
  if (!text || typeof text !== 'string') return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const formatDate = (dateString) => {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.white,
    paddingHorizontal: scale(20),
    paddingTop: verticalScale(20),
    paddingBottom: verticalScale(30),
    minHeight: '100%',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    padding: scale(20),
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '400',
    color: '#777',
    textAlign: 'center',
    lineHeight: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginBottom: verticalScale(20),
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: scale(14),
    marginBottom: verticalScale(14),
    borderWidth: 0.4,
    borderColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 4,
    elevation: 2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: verticalScale(8),
  },
  planText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textPrimary,
    marginLeft: scale(8),
  },
  infoText: {
    fontSize: 13,
    fontWeight: '400',
    color: '#555',
    marginTop: verticalScale(2),
    lineHeight: 18,
  },
});
