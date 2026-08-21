import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Platform, ScrollView, Text, View } from 'react-native';
import {
  AdsConsent,
  AdsConsentPrivacyOptionsRequirementStatus,
} from 'react-native-google-mobile-ads';
import Purchases from 'react-native-purchases';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import styles from '../../assets/styles/profile.styles';
import { TAB_BAR_CLEARANCE } from '../../components/navigation/FloatingTabBar';
import { useAuthStore } from '../../authStore';
import LogoutButton from '../../components/profile/LogoutButton';
import ConfirmDialog from '../../components/profile/ConfirmDialog';
import ProfileHeader from '../../components/profile/ProfileHeader';
import SettingsRow from '../../components/profile/SettingsRow';
import SubscriptionSection from '../../components/profile/SubscriptionSection';
import { apiUrl } from '../../configs/api';

export default function Profile() {
  const { token, user, logout } = useAuthStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Seed from the cached user so the plan badge does not flash the wrong state
  // for as long as the network round-trip takes.
  const [isPremium, setIsPremium] = useState(
    !!(user?.isPremium || user?.isSubscribed),
  );
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [privacyOptionsRequired, setPrivacyOptionsRequired] = useState(false);

  useEffect(() => {
    let mounted = true;

    AdsConsent.getConsentInfo()
      .then((consent) => {
        if (mounted) {
          setPrivacyOptionsRequired(
            consent.privacyOptionsRequirementStatus
              === AdsConsentPrivacyOptionsRequirementStatus.REQUIRED,
          );
        }
      })
      .catch(() => undefined);

    return () => {
      mounted = false;
    };
  }, []);

  const openAdvertisingPrivacy = async () => {
    try {
      const consent = await AdsConsent.showPrivacyOptionsForm();
      setPrivacyOptionsRequired(
        consent.privacyOptionsRequirementStatus
          === AdsConsentPrivacyOptionsRequirementStatus.REQUIRED,
      );
    } catch {
      Alert.alert(
        'Privacy choices unavailable',
        'Please check your connection and try again.',
      );
    }
  };

  const deleteAccount = async () => {
    if (deleting) return;
    setConfirmingDelete(false);
    setDeleting(true);

    try {
      const response = await fetch(apiUrl('/api/users/me'), {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Your account could not be deleted.');
      }

      try {
        if (await Purchases.isConfigured()) await Purchases.logOut();
      } catch {
        // The server account is already gone; local RevenueCat cleanup is
        // best-effort and must not leave the user signed in to a deleted account.
      }

      await logout();
      router.replace('/(routes)/onboarding');
    } catch (error) {
      Alert.alert(
        'Could not delete account',
        error?.message || 'Check your connection and try again.',
      );
    } finally {
      setDeleting(false);
    }
  };

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
        // Active store subscribers and manually granted premium accounts both
        // get the paid profile experience.
        setIsPremium(
          data.user?.isPremium === true || data.user?.isSubscribed === true,
        );
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
          {privacyOptionsRequired ? (
            <SettingsRow
              icon="options-outline"
              label="Advertising Privacy"
              showDivider
              onPress={openAdvertisingPrivacy}
            />
          ) : null}
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

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        <View style={styles.card}>
          <SettingsRow
            icon="trash-outline"
            label={deleting ? 'Deleting Account…' : 'Delete Account'}
            danger
            onPress={deleting ? undefined : () => setConfirmingDelete(true)}
          />
        </View>
      </View>

      <LogoutButton />

      <ConfirmDialog
        visible={confirmingDelete}
        title="Permanently Delete Account?"
        // Names the one store this device actually buys from. Reading about
        // Google Play on an iPhone is confusing to a person and, on the screen
        // an App Review tester is asked to walk through, is a mention of another
        // platform's payments in an iOS build.
        message={
          'This deletes your profile, designs, saved plans, coin balance, and purchase '
          + 'history. It does not cancel an active '
          + (Platform.OS === 'ios' ? 'App Store' : 'Google Play')
          + ' subscription, so cancel that first in Manage Subscription. This cannot be undone.'
        }
        confirmLabel="Delete Forever"
        cancelLabel="Keep Account"
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={deleteAccount}
      />
    </ScrollView>
  );
}
