import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Modal,
  TouchableWithoutFeedback,
  Platform,
  Linking,
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

  // Modal states
  const [showCancelConfirmModal, setShowCancelConfirmModal] = useState(false);
  const [showCancelSuccessModal, setShowCancelSuccessModal] = useState(false);
  const [showCancelErrorModal, setShowCancelErrorModal] = useState(false);

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

  // fetch user's latest subscription from backend
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

        const planName = `${capitalize(latestOrder.plan)} – ${capitalize(latestOrder.billingCycle)}`;
        const price = `${latestOrder.price} ${
          latestOrder.billingCycle === 'weekly' ? '/ week' : '/ year'
        }`;

        const endDate = latestOrder.endDate
          ? new Date(latestOrder.endDate).toLocaleDateString()
          : '—';
        const canceledAt = latestOrder.canceledAt
          ? new Date(latestOrder.canceledAt).toLocaleDateString()
          : null;

        if (mounted) {
          setCurrentPlan({
            name: planName,
            price,
            nextBilling: endDate,
            autoRenew: latestOrder.autoRenew,
            isActive: latestOrder.isActive,
            canceledAt,
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

  const handleCancelConfirm = () => setShowCancelConfirmModal(true);

  const handleCancel = async () => {
    setShowCancelConfirmModal(false);
    try {
      if (Platform.OS === 'ios') {
        await Linking.openURL('https://apps.apple.com/account/subscriptions');
      } else if (Platform.OS === 'android') {
        await Linking.openURL('https://play.google.com/store/account/subscriptions');
      }

      await fetch(`${process.env.EXPO_PUBLIC_SERVER_URI}/api/orders/mark-cancel-request`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      setCurrentPlan((prev) => ({
        ...prev,
        autoRenew: false,
        canceledAt: new Date().toLocaleDateString(),
      }));

      setShowCancelSuccessModal(true);
    } catch (err) {
      console.error('Cancel error:', err);
      setShowCancelErrorModal(true);
    }
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
    <>
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
            onPress={handleCancelConfirm}
          >
            <Ionicons name="close-circle-outline" size={22} color="#e74c3c" />
            <View style={{ marginLeft: 12 }}>
              <Text style={[styles.cardTitle, { color: '#e74c3c' }]}>Cancel Subscription</Text>
              <Text style={styles.cardSmall}>Auto-renewal will be turned off</Text>
            </View>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Cancel Confirmation Modal */}
      <Modal visible={showCancelConfirmModal} transparent animationType="fade">
        <TouchableWithoutFeedback onPress={() => setShowCancelConfirmModal(false)}>
          <View style={styles.modalMissingOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.modalMissingContainer}>
                <Text style={styles.modalTitle}>Cancel Subscription</Text>
                <Text style={styles.modalSubtitle}>
                  Are you sure you want to cancel your subscription?
                </Text>

                <View style={{ flexDirection: 'row', marginTop: 20 }}>
                  <TouchableOpacity
                    style={[styles.modalMissingButton, { flex: 1, marginRight: 10 }]}
                    onPress={() => setShowCancelConfirmModal(false)}
                  >
                    <Text style={styles.modalButtonText}>No</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.modalMissingButton, styles.modalConfirmButton, { flex: 1 }]}
                    onPress={handleCancel}
                  >
                    <Text style={styles.modalButtonText}>Yes, Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Error Modal */}
      <Modal visible={showCancelErrorModal} transparent animationType="fade">
        <TouchableWithoutFeedback onPress={() => setShowCancelErrorModal(false)}>
          <View style={styles.modalMissingOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.modalMissingContainer}>
                <Text style={styles.modalTitle}>Error</Text>
                <Text style={styles.modalSubtitle}>
                  Failed to open your subscription settings. Please try again later.
                </Text>

                <TouchableOpacity
                  style={[styles.modalMissingButton, styles.modalConfirmButton]}
                  onPress={() => setShowCancelErrorModal(false)}
                >
                  <Text style={styles.modalButtonText}>OK</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </>
  );
}
