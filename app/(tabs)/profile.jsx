import { useRouter } from 'expo-router';
import { useEffect } from 'react';
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

  useEffect(() => { }, []);

  return (
    <View style={styles.container}>
      <ProfileHeader />
      <LogoutButton />
      <SubscriptionSection />

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Help & Legal</Text>

        <TouchableOpacity style={styles.item} onPress={() => router.push('/privacy')}>
          <Ionicons name="lock-closed-outline" size={20} color="#666" style={styles.itemIcon} />
          <Text style={styles.itemText}>Privacy Policy</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.item} onPress={() => router.push('/terms')}>
          <Ionicons name="document-text-outline" size={20} color="#666" style={styles.itemIcon} />
          <Text style={styles.itemText}>Terms & Conditions</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.item} onPress={() => router.push('/contact')}>
          <Ionicons name="help-circle-outline" size={20} color="#666" style={styles.itemIcon} />
          <Text style={styles.itemText}>Contact Support</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
