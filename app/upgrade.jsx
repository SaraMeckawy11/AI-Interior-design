import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import styles from '../assets/styles/upgrade.styles';
import COLORS from '../constants/colors';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../authStore';

export default function Upgrade() {
  const { token } = useAuthStore();
  const [selectedPlan, setSelectedPlan] = useState('weekly');
  const [currencySymbol, setCurrencySymbol] = useState('$');
  const [weeklyPrice, setWeeklyPrice] = useState(5.00);
  const [yearlyPrice, setYearlyPrice] = useState(50.00);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [freeDesignsUsed, setFreeDesignsUsed] = useState(0);
  const router = useRouter();

  useEffect(() => {
    const userCountry = 'EG';
    if (userCountry === 'EG') {
      setCurrencySymbol('EGP');
      setWeeklyPrice(49.99);
      setYearlyPrice(449.99);
    }

    async function fetchUserStatus() {
      try {
        const res = await fetch(`${process.env.EXPO_PUBLIC_SERVER_URI}/api/users/me`, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        if (res.ok) {
          const data = await res.json();
          setIsSubscribed(data.user?.isSubscribed || false);
          setFreeDesignsUsed(data.user?.freeDesignsUsed || 0);
        }
      } catch (err) {
        console.error('Failed to fetch user status:', err);
      }
    }

    if (token) fetchUserStatus();
  }, [token]);

  const handleUpgrade = async () => {
    const price = selectedPlan === 'weekly' ? weeklyPrice : yearlyPrice;
    const plan = 'pro';
    const billingCycle = selectedPlan;
    const startDate = new Date();
    const endDate = new Date();

    if (billingCycle === 'weekly') {
      endDate.setDate(startDate.getDate() + 7);
    } else {
      endDate.setFullYear(startDate.getFullYear() + 1);
    }

    if (isSubscribed) {
      Alert.alert(
        'Already Subscribed',
        'You are already subscribed. Do you want to change your plan?',
        [
          { text: 'No', style: 'cancel' },
          {
            text: 'Yes, Change Plan',
            onPress: async () => {
              try {
                const res = await fetch(`${process.env.EXPO_PUBLIC_SERVER_URI}/api/orders/update-latest`, {
                  method: 'PUT',
                  headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    plan,
                    billingCycle,
                    price,
                    startDate: startDate.toISOString(),
                    endDate: endDate.toISOString(),
                    autoRenew: true,
                  }),
                });

                if (!res.ok) throw new Error('Failed to update subscription');

                Alert.alert('Updated', `Your plan has been changed to ${plan} (${billingCycle}).`);
                router.replace('(tabs)/profile');
              } catch (error) {
                console.error(error);
                Alert.alert('Error', 'Failed to change plan. Please try again.');
              }
            },
          },
        ]
      );
    } else {
      try {
        const res = await fetch(`${process.env.EXPO_PUBLIC_SERVER_URI}/api/orders`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            plan,
            billingCycle,
            price,
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
            paymentStatus: 'paid',
            autoRenew: true,
          }),
        });

        if (!res.ok) throw new Error('Failed to create new subscription');

        Alert.alert('Success', `Upgraded to ${plan} (${billingCycle})!`);
        router.replace('(tabs)/profile');
      } catch (error) {
        console.error(error);
        Alert.alert('Error', 'Something went wrong. Please try again.');
      }
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Upgrade to Pro</Text>
      <Text style={styles.subtitle}>
        Unlock the full Roomify experience with premium features.
      </Text>

      {/* 🔴 Show warning if user hit 2 free designs and not subscribed */}
      {freeDesignsUsed >= 2 && !isSubscribed && (
        <View style={styles.warningBox}>
          <Text style={styles.warningTitle}>You’ve used your 2 free designs.</Text>
          <Text style={styles.warningText}>
            Upgrade now to continue using Roomify without limits.
          </Text>
        </View>
      )}

      <View style={styles.featureList}>
        {['Ad-free experience', 'Unlimited design renders'].map((feature, idx) => (
          <View key={idx} style={styles.featureItem}>
            <Ionicons name="checkmark-circle-outline" size={20} color={COLORS.primary} />
            <Text style={styles.featureText}>{feature}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.planLabel}>Choose a plan:</Text>
      <View style={styles.planOptions}>
        <TouchableOpacity
          style={[styles.planCard, selectedPlan === 'weekly' && styles.planCardSelected]}
          onPress={() => setSelectedPlan('weekly')}
        >
          <Text style={styles.planTitle}>Weekly</Text>
          <Text style={styles.planPrice}>{currencySymbol} {weeklyPrice.toFixed(2)} / week</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.planCard, selectedPlan === 'yearly' && styles.planCardSelected]}
          onPress={() => setSelectedPlan('yearly')}
        >
          <View style={styles.bestValueBadge}>
            <Text style={styles.bestValueText}>Best Value</Text>
          </View>
          <Text style={styles.planTitle}>Yearly</Text>
          <Text style={styles.planPrice}>{currencySymbol} {yearlyPrice.toFixed(2)} / year</Text>
          <Text style={styles.planSavings}>Save 80%</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.upgradeButton} onPress={handleUpgrade}>
        <Text style={styles.upgradeButtonText}>Upgrade Now</Text>
      </TouchableOpacity>

      <Text style={styles.trustNote}>Cancel anytime</Text>
    </ScrollView>
  );
}
