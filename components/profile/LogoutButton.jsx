import {
  View,
  Text,
  Pressable,
  Modal,
  TouchableWithoutFeedback,
} from 'react-native';
import React, { useState } from 'react';
import { useAuthStore } from '../../authStore';
import styles from '../../assets/styles/profile.styles';
import { Ionicons } from '@expo/vector-icons';
import COLORS from '../../constants/colors';
import { useRouter } from 'expo-router';

export default function LogoutButton() {
  const router = useRouter();
  const { logout } = useAuthStore();
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const confirmLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await logout();
      setShowLogoutModal(false);
      router.replace('/onboarding');
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <>
      <Pressable
        onPress={() => setShowLogoutModal(true)}
        accessibilityRole="button"
        accessibilityLabel="Log out"
        style={({ pressed }) => [
          styles.logoutButton,
          pressed && styles.logoutButtonPressed,
        ]}
      >
        <Ionicons name="log-out-outline" size={19} color={COLORS.error} />
        <Text style={styles.logoutText}>Log out</Text>
      </Pressable>

      {/* Logout Confirmation Modal */}
      <Modal
        visible={showLogoutModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLogoutModal(false)}
      >
        <TouchableWithoutFeedback onPress={() => setShowLogoutModal(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.logoutModalContainer}>
                <Text style={styles.logoutModalTitle}>Log out?</Text>
                <Text style={styles.logoutModalSubtitle}>
                  You&apos;ll need to sign in again to reach your saved designs.
                </Text>

                <View style={styles.logoutModalButtons}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Cancel"
                    style={[styles.logoutModalButton, styles.cancelButton]}
                    onPress={() => setShowLogoutModal(false)}
                  >
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Confirm log out"
                    disabled={isLoggingOut}
                    style={[
                      styles.logoutModalButton,
                      styles.confirmButton,
                      isLoggingOut && { opacity: 0.6 },
                    ]}
                    onPress={confirmLogout}
                  >
                    <Text style={styles.confirmButtonText}>
                      {isLoggingOut ? 'Logging out…' : 'Log out'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </>
  );
}
