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
import { useRouter } from "expo-router";  // ✅ import router
import { useAuthStore } from "../../authStore";
import styles from "../../assets/styles/authModal.styles";
import COLORS from "../../constants/colors";

export default function LoginForm({ setModalVisible }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const { isLoading, login } = useAuthStore();
  const router = useRouter(); // ✅ initialize router

  const handleLogin = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      Alert.alert("Email and password required", "Enter both fields to sign in.");
      return;
    }

    const result = await login(normalizedEmail, password);
    if (!result.success) {
      Alert.alert("Error", result.error);
      return;
    }
    setModalVisible(false);
    // `replace` so back from Create leaves the app rather than returning to the
    // login form the user has already cleared.
    router.replace("/create");
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
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
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
          autoComplete="current-password"
          textContentType="password"
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

      {/* Login Button */}
      <TouchableOpacity
        onPress={handleLogin}
        disabled={isLoading || !email.trim() || !password}
        accessibilityRole="button"
        accessibilityLabel="Sign in"
        style={[
          styles.signupButton,
          (isLoading || !email.trim() || !password) && { opacity: 0.6 },
        ]}
      >
        {isLoading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.signupButtonText}>Sign in</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}
