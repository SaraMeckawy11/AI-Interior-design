import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Purchases from 'react-native-purchases';
import styles from '../assets/styles/upgrade.styles';
import { useAuthStore } from '../authStore';
import Loader from '../components/Loader';

export default function Subscription() {
  const router = useRouter();
  const { token } = useAuthStore();
  const [currentPlan, setCurrentPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [offerings, setOfferings] = useState(null);

  // fetch RevenueCat offerings
  useEffect(() => {
    let mounted = true;
    async function fetchOfferings() {
      try {
        const rc = await Purchases.getOfferings();
        if (mounted) setOfferings(rc);
      } catch (err) {
        console.error('Failed to fetch offerings:', err);
      }
    }
    fetchOfferings();
    return () => {
      mounted = false;
    };
  }, []);

  // fetch user's latest subscription from backend and map to RC pricing
  useEffect(() => {
    if (!token) return;

    let mounted = true;
    async function fetchUserSubscription() {
      try {
        const response = await fetch(`${process.env.EXPO_PUBLIC_SERVER_URI}/api/orders/latest`, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText || 'Subscription fetch failed');
        }

        const data = await response.json();
        const latestOrder = data.order;

        // Try to find matching RC package to show localized price (best-effort)
        let rcPrice = '';
        if (offerings?.current?.availablePackages?.length) {
          const candidates = offerings.current.availablePackages;
          // crude match by billingCycle words (weekly/yearly) or plan id in product identifier
          const match = candidates.find(p => {
            const id = (p?.product?.identifier || '').toLowerCase();
            if (latestOrder.billingCycle === 'weekly') {
              return id.includes('week') || id.includes('weekly');
            }
            if (latestOrder.billingCycle === 'yearly' || latestOrder.billingCycle === 'annual') {
              return id.includes('year') || id.includes('annual');
            }
            return false;
          });
          if (match) rcPrice = match.product?.priceString || '';
        }

        const planName = `${capitalize(latestOrder.plan)} – ${capitalize(latestOrder.billingCycle)}`;
        const price =
          rcPrice ||
          `${latestOrder.price} ${latestOrder.billingCycle === 'weekly' ? '/ week' : '/ year'}`;

        const endDate = latestOrder.endDate ? new Date(latestOrder.endDate).toLocaleDateString() : '—';
        const canceledAt = latestOrder.canceledAt ? new Date(latestOrder.canceledAt).toLocaleDateString() : null;

        if (mounted) {
          setCurrentPlan({
            name: planName,
            price,
            nextBilling: endDate,
            autoRenew: latestOrder.autoRenew,
            isActive: latestOrder.isActive,
            canceledAt,
            // keep raws if needed
            plan: latestOrder.plan,
            billingCycle: latestOrder.billingCycle,
            priceRaw: latestOrder.price,
          });

          setIsSubscribed(Boolean(latestOrder.isActive));
        }
      } catch (error) {
        console.error('Failed to load subscription:', error);
        if (mounted) setIsSubscribed(false);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchUserSubscription();

    return () => {
      mounted = false;
    };
  }, [token, offerings]);

  const handleCancel = () => {
    Alert.alert('Cancel Subscription', 'Are you sure you want to cancel?', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes, Cancel',
        onPress: async () => {
          try {
            const res = await fetch(`${process.env.EXPO_PUBLIC_SERVER_URI}/api/orders/cancel-latest`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
            });

            if (!res.ok) throw new Error('Cancel failed');

            setCurrentPlan(prev => ({
              ...prev,
              autoRenew: false,
              canceledAt: new Date().toLocaleDateString(),
            }));

            Alert.alert('Canceled', 'Auto-renewal has been turned off.');
          } catch (err) {
            Alert.alert('Error', 'Failed to cancel subscription.');
            console.error('Cancel error:', err);
          }
        },
      },
    ]);
  };

  const capitalize = (text) => {
    if (!text || typeof text !== 'string') return '';
    return text.charAt(0).toUpperCase() + text.slice(1);
  };

  if (loading) return <Loader />;

  if (!isSubscribed) {
    return (
      <View style={styles.unsubscribedWrapper}>
        <View style={styles.unsubscribedCard}>
          <Text style={styles.unsubscribedTitle}>You’re not subscribed</Text>
          <Text style={styles.unsubscribedText}>
            Unlock premium features like unlimited renders and ad-free experience.
          </Text>
          <TouchableOpacity
            style={styles.unsubscribedButton}
            onPress={() => router.push('/upgrade')}
          >
            <Text style={styles.unsubscribedButtonText}>View Plans</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Manage Subscription</Text>
      <Text style={styles.subtitle}>
        Easily manage your current plan, billing settings, or support.
      </Text>

      <View style={[styles.card, styles.cardElevated]}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Ionicons name="star" size={24} color="#f7b731" />
          <View style={{ marginLeft: 12 }}>
            <Text style={styles.cardTitle}>{currentPlan?.name}</Text>
            <Text style={styles.cardSubtitle}>{currentPlan?.price}</Text>
            <Text style={styles.cardSmall}>
              {currentPlan?.autoRenew
                ? `Next billing: ${currentPlan?.nextBilling}`
                : `Subscription ends: ${currentPlan?.nextBilling}`}
            </Text>
            <Text style={styles.cardSmall}>
              Auto-renewal: {currentPlan?.autoRenew ? 'ON' : 'OFF'}
            </Text>
            {currentPlan?.canceledAt && (
              <Text style={styles.cardSmall}>Canceled at: {currentPlan.canceledAt}</Text>
            )}
          </View>
        </View>
      </View>

      <View style={{ marginTop: 12 }}>
        <TouchableOpacity
          style={[styles.card, styles.cardInteractive]}
          activeOpacity={0.9}
          onPress={() => router.push('/upgrade')}
        >
          <Ionicons name="repeat-outline" size={22} color="#444" />
          <View style={{ marginLeft: 12 }}>
            <Text style={styles.cardTitle}>Change Plan</Text>
            <Text style={styles.cardSmall}>Choose a different subscription plan</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.card, styles.cardInteractive]}
          activeOpacity={0.9}
          onPress={() => router.push('/payment-history')}
        >
          <Ionicons name="time-outline" size={22} color="#444" />
          <View style={{ marginLeft: 12 }}>
            <Text style={styles.cardTitle}>Payment History</Text>
            <Text style={styles.cardSmall}>View all your past payments</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.card, styles.cardDestructive]}
          activeOpacity={0.9}
          onPress={handleCancel}
        >
          <Ionicons name="close-circle-outline" size={22} color="#e74c3c" />
          <View style={{ marginLeft: 12 }}>
            <Text style={[styles.cardTitle, { color: '#e74c3c' }]}>Cancel Subscription</Text>
            <Text style={styles.cardSmall}>Auto-renewal will be turned off</Text>
          </View>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
