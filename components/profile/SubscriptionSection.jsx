import React from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import styles from '../../assets/styles/profile.styles';
import SettingsRow from './SettingsRow';

export default function SubscriptionSection() {
  const router = useRouter();

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Subscription</Text>

      <View style={styles.card}>
        <SettingsRow
          icon="sparkles"
          label="Upgrade to Pro"
          accent
          onPress={() => router.push('/profile/upgrade')}
        />
        <SettingsRow
          icon="card-outline"
          label="Manage Subscription"
          showDivider
          onPress={() => router.push('/profile/manageSubscription')}
        />
      </View>
    </View>
  );
}
