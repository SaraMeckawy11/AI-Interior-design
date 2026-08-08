import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import styles from '../../assets/styles/profile.styles';
import COLORS from '../../constants/colors';
import { useAuthStore } from '../../authStore';

export default function ProfileHeader({ isPremium }) {
  const checkAuth = useAuthStore((state) => state.checkAuth);

  useEffect(() => {
    checkAuth(); // Load from AsyncStorage
  }, [checkAuth]);

  const { user } = useAuthStore();

  if (!user) return null;

  // The Google payload uses `name`/`avatar`; the record fetched from our own
  // API uses `username`/`profileImage`. The header has to survive both, or it
  // renders an empty line once the DB copy replaces the Google one.
  const displayName = user.username || user.name || 'Your account';
  const email = user.email || 'No email added';
  const premium = isPremium ?? user.isPremium ?? false;

  return (
    <View
      style={styles.profileHeader}
      accessibilityRole="summary"
      accessibilityLabel={`${displayName}, ${email}, ${premium ? 'Premium' : 'Free plan'}`}
    >
      <View style={styles.profileHeaderAccent} />

      {/* This is deliberately an account glyph rather than a fake avatar. It
          anchors the identity block without implying the user uploaded a photo. */}
      <View style={styles.profileIdentityIcon} importantForAccessibility="no">
        <Ionicons name="person-outline" size={22} color={COLORS.primaryDark} />
      </View>

      <View style={styles.profileInfo}>
        <View style={styles.profileMetaRow}>
          <Text style={styles.profileEyebrow}>Your account</Text>

          <View
            style={[
              styles.planBadge,
              premium ? styles.planBadgePremium : styles.planBadgeFree,
            ]}
          >
            <Ionicons
              name={premium ? 'sparkles' : 'leaf-outline'}
              size={11}
              color={premium ? COLORS.accentStrong : COLORS.primaryDark}
            />
            <Text
              style={[
                styles.planBadgeText,
                premium
                  ? styles.planBadgeTextPremium
                  : styles.planBadgeTextFree,
              ]}
            >
              {premium ? 'Premium' : 'Free plan'}
            </Text>
          </View>
        </View>

        <Text style={styles.username} numberOfLines={1} ellipsizeMode="tail">
          {displayName}
        </Text>

        <View style={styles.emailRow}>
          <Ionicons
            name="mail-outline"
            size={14}
            color={COLORS.textSecondary}
            importantForAccessibility="no"
          />
          <Text style={styles.email} numberOfLines={1} ellipsizeMode="tail">
            {email}
          </Text>
        </View>
      </View>
    </View>
  );
}
