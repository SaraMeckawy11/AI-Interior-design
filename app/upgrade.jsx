import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import styles from '../assets/styles/upgrade.styles';
import COLORS from '../constants/colors';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../authStore';
import purchases, { LOG_LEVEL } from 'react-native-purchases';

export default function Upgrade() {
  const { token } = useAuthStore();
  const [selectedPlan, setSelectedPlan] = useState('weekly');
  const [currencyCode, setCurrencyCode] = useState('USD');
  const [weeklyPrice, setWeeklyPrice] = useState(5.99);
  const [yearlyPrice, setYearlyPrice] = useState(50.99);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [freeDesignsUsed, setFreeDesignsUsed] = useState(0);
  const [offerings, setOfferings] = useState(null);
  const router = useRouter();

  useEffect(() => {
    try {
      purchases.setLogLevel(LOG_LEVEL.DEBUG);
    } catch (e) {}

    async function initOfferings() {
      try {
        const o = await purchases.getOfferings();
        if (o?.current?.availablePackages?.length > 0) {
          setOfferings(o);

          const weeklyPkg = o.current.weekly || o.current.availablePackages.find(p => p.packageType === 'WEEKLY');
          const annualPkg = o.current.annual || o.current.availablePackages.find(p => p.packageType === 'ANNUAL');

          const product = weeklyPkg?.product || annualPkg?.product;
          if (product?.currencyCode) {
            setCurrencyCode(product.currencyCode);
          }
        }
      } catch (err) {
        console.error('Failed to fetch offerings:', err);
      }
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
          setIsSubscribed(Boolean(data.user?.isSubscribed));
          setFreeDesignsUsed(Number(data.user?.freeDesignsUsed || 0));
        }
      } catch (err) {
        console.error('Failed to fetch user status:', err);
      }
    }

    initOfferings();
    if (token) fetchUserStatus();
  }, [token]);

  const getPackageForPlan = (plan) => {
    if (!offerings?.current) return undefined;
    const current = offerings.current;
    if (plan === 'weekly') {
      return current.weekly || current.availablePackages.find(p => p.packageType === 'WEEKLY');
    } else {
      return current.annual || current.availablePackages.find(p => p.packageType === 'ANNUAL');
    }
  };

  const getPriceStringForPlan = (plan) => {
    const pkg = getPackageForPlan(plan);
    if (pkg?.product?.priceString) {
      return pkg.product.priceString;
    }
    return `${(plan === 'weekly' ? weeklyPrice : yearlyPrice).toFixed(2)} ${currencyCode}`;
  };

  const handleUpgrade = async () => {
    const chosenPackage = getPackageForPlan(selectedPlan);
    if (!chosenPackage) {
      Alert.alert('Error', 'Selected plan not available right now.');
      return;
    }

    // get values for backend
    const plan = selectedPlan === 'weekly' ? 'Weekly Plan' : 'Yearly Plan';
    const billingCycle = selectedPlan;
    const price = chosenPackage.product?.price || 0;
    const startDate = new Date();
    const endDate = new Date(
      billingCycle === 'weekly'
        ? startDate.getTime() + 7 * 24 * 60 * 60 * 1000
        : startDate.getTime() + 365 * 24 * 60 * 60 * 1000
    );

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
                // RevenueCat purchase
                await purchases.purchasePackage(chosenPackage);

                // Backend update
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
        // RevenueCat purchase
        await purchases.purchasePackage(chosenPackage);

        // Backend create
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
        Unlock the full LIVINAI experience with premium features.
      </Text>

      {freeDesignsUsed >= 2 && !isSubscribed && (
        <View style={styles.warningBox}>
          <Text style={styles.warningTitle}>You’ve used your 2 free designs.</Text>
          <Text style={styles.warningText}>
            Upgrade now to continue using LIVINAI without limits.
          </Text>
        </View>
      )}

      <View style={styles.featureList}>
        {['Ad-free experience', 'Unlimited design renders'].map((feature, idx) => (
          <View key={idx} style={styles.featureItem}>
            <Ionicons name="checkmark-circle-outline" size={20} color={COLORS.primaryDark} />
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
          <Text style={styles.planPrice}>{getPriceStringForPlan('weekly')} / week</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.planCard, selectedPlan === 'yearly' && styles.planCardSelected]}
          onPress={() => setSelectedPlan('yearly')}
        >
          <View style={styles.bestValueBadge}>
            <Text style={styles.bestValueText}>Best Value</Text>
          </View>
          <Text style={styles.planTitle}>Yearly</Text>
          <Text style={styles.planPrice}>{getPriceStringForPlan('yearly')} / year</Text>
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
