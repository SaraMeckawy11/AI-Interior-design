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
import { useRouter } from "expo-router";
import { useAuthStore } from "../../authStore";
import styles from "../../assets/styles/authModal.styles"; // reuse same styles

export default function SignupForm({ setModalVisible }) {
  const router = useRouter();
  const register = useAuthStore((state) => state.register);

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Matched to the server's own rule so the two cannot disagree; the server
  // still enforces it, this only saves a round trip to be told so.
  const MIN_PASSWORD_LENGTH = 6;

  const handleManualSignup = async () => {
    const name = username.trim();
    // Lower-cased here as well as on the server, so the address shown back to
    // the person is the one their account will actually be keyed on.
    const normalizedEmail = email.trim().toLowerCase();

    if (!name || !normalizedEmail || !password) {
      Alert.alert("All fields are required", "Enter a name, an email address, and a password.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      Alert.alert("Check your email address", "That does not look like an email address.");
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      Alert.alert(
        "Password is too short",
        `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
      );
      return;
    }

    setIsLoading(true);
    try {
      const result = await register(name, normalizedEmail, password);
      if (!result.success) {
        Alert.alert("Could not create your account", result.error);
      } else {
        setModalVisible(false);
        // `replace` so back from Create leaves the app rather than returning to
        // the signup form for an account that now exists.
        router.replace("/create");
      }
    } catch (err) {
      console.error("Manual signup error:", err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.formContainer}>
      {/* Username */}
      <View style={styles.inputGroup}>
        <Ionicons name="person-outline" size={20} style={styles.inputIcon} />
        <TextInput
          placeholder="Username"
          value={username}
          onChangeText={setUsername}
          style={styles.input}
          autoCapitalize="words"
          autoCorrect={false}
          autoComplete="name"
          textContentType="name"
        />
      </View>

      {/* Email */}
      <View style={styles.inputGroup}>
        <Ionicons name="mail-outline" size={20} style={styles.inputIcon} />
        <TextInput
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          style={styles.input}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
        />
      </View>

      {/* Password */}
      <View style={styles.inputGroup}>
        <Ionicons name="lock-closed-outline" size={20} style={styles.inputIcon} />
        <TextInput
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          style={styles.input}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          autoCorrect={false}
          // `newPassword`, not `password`: this is what makes iOS offer to
          // generate and save a strong one rather than autofilling an old one.
          autoComplete="new-password"
          textContentType="newPassword"
        />
        <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
          <Ionicons
            name={showPassword ? "eye-outline" : "eye-off-outline"}
            size={20}
            style={styles.inputIcon}
          />
        </TouchableOpacity>
      </View>

      {/* Signup Button */}
      <TouchableOpacity
        onPress={handleManualSignup}
        accessibilityRole="button"
        accessibilityLabel="Create account"
        style={[
          styles.signupButton,
          (isLoading || !username.trim() || !email.trim() || !password) && { opacity: 0.6 },
        ]}
        disabled={isLoading || !username.trim() || !email.trim() || !password}
      >
        {isLoading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.signupButtonText}>Create account</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}
