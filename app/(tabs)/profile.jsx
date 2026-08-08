import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import styles from '../../assets/styles/profile.styles';
import { TAB_BAR_CLEARANCE } from '../../components/navigation/FloatingTabBar';
import { useAuthStore } from '../../authStore';
import LogoutButton from '../../components/profile/LogoutButton';
import ProfileHeader from '../../components/profile/ProfileHeader';
import SettingsRow from '../../components/profile/SettingsRow';
import SubscriptionSection from '../../components/profile/SubscriptionSection';
import { apiUrl } from '../../configs/api';

export default function Profile() {
  const { token, user } = useAuthStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Seed from the cached user so the plan badge does not flash the wrong state
  // for as long as the network round-trip takes.
  const [isPremium, setIsPremium] = useState(!!user?.isPremium);

  useEffect(() => {
    const fetchUserStatus = async () => {
      if (!token) return;

      const url = apiUrl('/api/users/me');

      try {
        const res = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });

        const text = await res.text(); // read raw text first

        if (!res.ok) {
          console.error("Failed to fetch user info:", res.status);
          return;
        }

        const data = JSON.parse(text); // parse JSON
        setIsPremium(data.user?.isPremium || false);
      } catch (err) {
        console.error("Failed to fetch user status:", err);
      }
    };

    fetchUserStatus();
  }, [token]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{
        // `styles.container` carries `flex: 1`, which would cap the content
        // instead of letting it scroll, so the padding is restated here rather
        // than reusing that style for the content container.
        flexGrow: 1,
        paddingHorizontal: 16,
        paddingTop: insets.top + 12,
        paddingBottom: TAB_BAR_CLEARANCE,
      }}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.screenTitle}>Profile</Text>

      <ProfileHeader isPremium={isPremium} />

      {isPremium ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Subscription</Text>
          <View style={styles.card}>
            <SettingsRow
              icon="card-outline"
              label="Manage Subscription"
              onPress={() => router.push('/profile/manageSubscription')}
            />
            <SettingsRow
              icon="receipt-outline"
              label="Payment History"
              showDivider
              onPress={() => router.push('/profile/payment-history')}
            />
          </View>
        </View>
      ) : (
        <SubscriptionSection />
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Help &amp; Legal</Text>

        <View style={styles.card}>
          <SettingsRow
            icon="lock-closed-outline"
            label="Privacy Policy"
            onPress={() => router.push('/profile/privacy')}
          />
          <SettingsRow
            icon="document-text-outline"
            label="Terms & Conditions"
            showDivider
            onPress={() => router.push('/profile/terms')}
          />
          <SettingsRow
            icon="help-circle-outline"
            label="Contact Support"
            showDivider
            onPress={() => router.push('/profile/contact')}
          />
        </View>
      </View>

      <LogoutButton />
    </ScrollView>
  );
}
