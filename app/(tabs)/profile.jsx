import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import styles from '../../assets/styles/profile.styles';
import { useAuthStore } from '../../authStore';
import LogoutButton from '../../components/profile/LogoutButton';
import ProfileHeader from '../../components/profile/ProfileHeader';
import SubscriptionSection from '../../components/profile/SubscriptionSection';

export default function Profile() {
  const { token } = useAuthStore();
  const router = useRouter();

  useEffect(() => { }, []);

  return (
    <View style={styles.container}>
      <ProfileHeader />
      <LogoutButton />
      <SubscriptionSection />

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Help & Legal</Text>

        <TouchableOpacity style={styles.item} onPress={() => router.push('/privacy')}>
          <Text style={styles.itemText}>Privacy Policy</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.item} onPress={() => router.push('/terms')}>
          <Text style={styles.itemText}>Terms & Conditions</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.item} onPress={() => router.push('/support')}>
          <Text style={styles.itemText}>Contact Support</Text>
        </TouchableOpacity>

      </View>
    </View>
  );
}
