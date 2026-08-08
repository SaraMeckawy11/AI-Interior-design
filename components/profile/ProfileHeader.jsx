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
  }, []);

  const { user } = useAuthStore();

  if (!user) return null;

  // The Google payload uses `name`/`avatar`; the record fetched from our own
  // API uses `username`/`profileImage`. The header has to survive both, or it
  // renders an empty line once the DB copy replaces the Google one.
  const displayName = user.username || user.name || 'Your account';
  const premium = isPremium ?? user.isPremium ?? false;

  return (
    // No avatar disc. Most accounts here sign in with Google and have no photo
    // set, and Google then serves a generated image of the first letter on a
    // coloured circle — a monogram is a placeholder pretending to be content, so
    // the name, the email and the plan take the full width instead.
    <View style={styles.profileHeader}>
      <View style={styles.profileInfo}>
        <Text style={styles.username} numberOfLines={1}>
          {displayName}
        </Text>
        <Text style={styles.email} numberOfLines={1}>
          {user.email}
        </Text>

        <View
          style={[
            styles.planBadge,
            premium ? styles.planBadgePremium : styles.planBadgeFree,
          ]}
        >
          <Ionicons
            name={premium ? 'sparkles' : 'person-outline'}
            size={11}
            color={premium ? COLORS.accentStrong : COLORS.textSecondary}
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
    </View>
  );
}
