import { View, Text, TouchableOpacity, Alert } from 'react-native'
import React from 'react'
import { useAuthStore } from '../../authStore'
import styles from '../../assets/styles/profile.styles'
import { Ionicons } from '@expo/vector-icons';
import COLORS from '../../constants/colors';
import { useRouter } from 'expo-router';


export default function LogoutButton() {
  
  const router = useRouter();
  const { logout } = useAuthStore();

  const confirmLogout = () => {
    Alert.alert(
      "Logout",
      "Are you sure you want to logout?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Logout",
          style: "destructive",
          onPress: async () => {
            await logout();
            router.replace("/onboarding"); // ⬅️ navigate to onboarding
          }
        }
      ]
    );
  };

  return (
    <TouchableOpacity style={styles.logoutButton} onPress={confirmLogout}>
      <Ionicons name="log-out-outline" size={20} color={COLORS.white}/>
      <Text style={styles.logoutText}>Logout</Text>
    </TouchableOpacity>
  )
}