import { View, Text, Image, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import React, { useState } from 'react';
import { Ionicons } from "@expo/vector-icons";
import { Link } from 'expo-router';
import { useAuthStore } from '../../store/authStore';
import styles from "../../assets/styles/login.styles";
import COLORS from '../../constants/colors';
import { LinearGradient } from 'expo-linear-gradient';


export default function index() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showpassword, setShowPassword] = useState(false);
  const { isLoading, login, isCheckingAuth } = useAuthStore();

  const handleLogin = async () => {
    const result = await login(email, password);
    if (!result.success) Alert.alert("Error", result.error);
  };

  if (isCheckingAuth) return null;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* ILLUSTRATION */}
           <View style={styles.topIllustration}>
             <Image
              source={require("../../assets/images/i7.jpg")}
              style={styles.illustrationImage}
              resizeMode="contain"
            />
          </View>

      <View style={styles.container}>        
        {/* CARD */}
          <View style={styles.card}>

            <View style={styles.header}>
              <Text style={styles.title}>Roomify</Text>
              <Text style={styles.subtitle}>Inspired by you. Designed by Roomify</Text>
            </View>

          {/* Email */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email</Text>
            <View style={styles.inputContainer}>
              <Ionicons name="mail-outline" size={20} color={COLORS.primary} style={styles.inputIcon} />
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
          </View>

          {/* Password */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.inputContainer}>
              <Ionicons name="lock-closed-outline" size={20} color={COLORS.primary} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Enter your password"
                placeholderTextColor={COLORS.placeholderText}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showpassword}
              />
              <TouchableOpacity onPress={() => setShowPassword(!showpassword)} style={styles.eyeIcon}>
                <Ionicons name={showpassword ? "eye-outline" : "eye-off-outline"} size={20} color={COLORS.primary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Login Button */}
          {/* <TouchableOpacity
            style={[styles.button, isLoading && { opacity: 0.6 }]}
            onPress={handleLogin}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Login</Text>
            )}
          </TouchableOpacity> */}

          <TouchableOpacity
            onPress={handleLogin}
            disabled={isLoading}
            style={[styles.buttonWrapper, isLoading && { opacity: 0.6 }]}
          >
            <LinearGradient
              colors={[COLORS.primary, COLORS.secondary]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.buttonGradient}
            >
              {isLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Login</Text>
              )}
            </LinearGradient>
          </TouchableOpacity>


          {/* Footer */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>Don't have an account?</Text>
            <Link href="/signup" asChild>
              <TouchableOpacity>
                <Text style={styles.link}>Sign Up</Text>
              </TouchableOpacity>
            </Link>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
