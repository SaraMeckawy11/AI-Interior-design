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

  const handleManualSignup = async () => {
    if (!username || !email || !password) {
      Alert.alert("All fields are required!");
      return;
    }
    setIsLoading(true);
    try {
      const result = await register(username, email, password);
      if (!result.success) {
        Alert.alert("Error", result.error);
      } else {
        setModalVisible(false);
        router.push("/create");
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
          autoCapitalize="none"
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
        style={styles.signupButton}
        disabled={isLoading}
      >
        {isLoading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.signupButtonText}>Sign Up</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}
