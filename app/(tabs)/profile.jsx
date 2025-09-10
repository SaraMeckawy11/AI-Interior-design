import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import styles from '../../assets/styles/profile.styles';
import { useAuthStore } from '../../authStore';
import LogoutButton from '../../components/profile/LogoutButton';
import ProfileHeader from '../../components/profile/ProfileHeader';
import SubscriptionSection from '../../components/profile/SubscriptionSection';
import { Ionicons } from '@expo/vector-icons';

export default function Profile() {
  const { token } = useAuthStore();
  const router = useRouter();
  const [isPremium, setIsPremium] = useState(false);

  useEffect(() => {
    const fetchUserStatus = async () => {
      if (!token) return;

      const url = `${process.env.EXPO_PUBLIC_SERVER_URI}/me`;

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
    <View style={styles.container}>
      <ProfileHeader />
      <LogoutButton />

      {/* Show subscription section only if NOT premium */}
      {!isPremium ? (
        <SubscriptionSection />
      ) : (
        <View style={styles.familyMessage}>
          <Text style={styles.familyText}>
        Being part of our family gives you exclusive access! Keep creating and designing freely.          </Text>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Help & Legal</Text>

        <TouchableOpacity style={styles.item} onPress={() => router.push('/privacy')}>
          <Ionicons name="lock-closed-outline" size={18} color="#666" style={styles.itemIcon} />
          <Text style={styles.itemText}>Privacy Policy</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.item} onPress={() => router.push('/terms')}>
          <Ionicons name="document-text-outline" size={18} color="#666" style={styles.itemIcon} />
          <Text style={styles.itemText}>Terms & Conditions</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.item} onPress={() => router.push('/contact')}>
          <Ionicons name="help-circle-outline" size={18} color="#666" style={styles.itemIcon} />
          <Text style={styles.itemText}>Contact Support</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
