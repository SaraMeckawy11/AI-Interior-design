import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "../../authStore";
import styles from "../../assets/styles/authModal.styles"; // reuse same styles
import COLORS from "../../constants/colors";

export default function LoginForm({ setModalVisible }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const { isLoading, login } = useAuthStore();

  const handleLogin = async () => {
    const result = await login(email, password);
    if (!result.success) {
      Alert.alert("Error", result.error);
      return;
    }
    setModalVisible(false);
  };

  return (
    <View style={styles.formContainer}>
      {/* Email */}
      <View style={styles.inputGroup}>
        <Ionicons
          name="mail-outline"
          size={20}
          color={COLORS.primary}
          style={styles.inputIcon}
        />
        <TextInput
          style={styles.input}
          placeholder="Enter your email"
          placeholderTextColor={COLORS.placeholderText}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />
      </View>

      {/* Password */}
      <View style={styles.inputGroup}>
        <Ionicons
          name="lock-closed-outline"
          size={20}
          color={COLORS.primary}
          style={styles.inputIcon}
        />
        <TextInput
          style={styles.input}
          placeholder="Enter your password"
          placeholderTextColor={COLORS.placeholderText}
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPassword}
        />
        <TouchableOpacity
          onPress={() => setShowPassword(!showPassword)}
          style={styles.eyeIcon}
        >
          <Ionicons
            name={showPassword ? "eye-outline" : "eye-off-outline"}
            size={20}
            color={COLORS.primary}
          />
        </TouchableOpacity>
      </View>

      {/* Login Button (no gradient) */}
      <TouchableOpacity
        onPress={handleLogin}
        disabled={isLoading}
        style={[styles.signupButton, isLoading && { opacity: 0.6 }]}
      >
        {isLoading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.signupButtonText}>Login</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}
