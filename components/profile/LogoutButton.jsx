import {
  View,
  Text,
  TouchableOpacity,
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

  return (
    <>
      {/* Logout Button */}
      <TouchableOpacity
        style={styles.logoutButton}
        onPress={() => setShowLogoutModal(true)}
      >
        <Ionicons name="log-out-outline" size={20} color={COLORS.white} />
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>

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
                {/* <Ionicons
                  name="log-out-outline"
                  size={40}
                  color={COLORS.primaryDark}
                  style={{ marginBottom: 12 }}
                /> */}
                <Text style={styles.logoutModalTitle}>Logout</Text>
                <Text style={styles.logoutModalSubtitle}>
                  Are you sure you want to logout?
                </Text>

                <View style={styles.logoutModalButtons}>
                  <TouchableOpacity
                    style={[styles.logoutModalButton, styles.cancelButton]}
                    onPress={() => setShowLogoutModal(false)}
                  >
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.logoutModalButton, styles.confirmButton]}
                    onPress={async () => {
                      setShowLogoutModal(false);
                      await logout();
                      router.replace('/onboarding');
                    }}
                  >
                    <Text style={styles.confirmButtonText}>Logout</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </>
  );
}
