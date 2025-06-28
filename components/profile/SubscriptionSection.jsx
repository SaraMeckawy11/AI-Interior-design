import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import styles from '../../assets/styles/profile.styles';

export default function SubscriptionSection() {
  const router = useRouter();

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Subscription</Text>

      <TouchableOpacity
        style={styles.item}
        activeOpacity={0.8}
        onPress={() => router.push('/upgrade')}
      >
        <Ionicons name="star-outline" size={20} color="#888" style={styles.itemIcon} />
        <Text style={styles.itemText}>Upgrade to Pro</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.item}
        activeOpacity={0.8}
        onPress={() => router.push('/manageSubscription')}
      >
        <Ionicons name="settings-outline" size={20} color="#888" style={styles.itemIcon} />
        <Text style={styles.itemText}>Manage Subscription</Text>
      </TouchableOpacity>
    </View>
  );
}
