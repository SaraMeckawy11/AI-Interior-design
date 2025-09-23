import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  Pressable,
  Platform,
  Image,
  TouchableOpacity,
} from "react-native";
import { BlurView } from "expo-blur";
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import JWT from "expo-jwt";
import axios from "axios";
import { useRouter } from "expo-router";
import { useAuthStore } from "../../authStore";
import SignupForm from "./signup";
import LoginForm from "./login"; // ✅ new component
import styles from "../../assets/styles/authModal.styles";
import COLORS from "@/constants/colors";

export default function AuthModal({ setModalVisible }) {
  const router = useRouter();
  const login = useAuthStore((state) => state.login);
  const [isLogin, setIsLogin] = useState(true); // ✅ toggle

  const configureGoogleSignIn = () => {
    if (Platform.OS === "ios") {
      GoogleSignin.configure({
        iosClientId: process.env.EXPO_PUBLIC_IOS_GOOGLE_API_KEY,
      });
    } else {
      GoogleSignin.configure({
        webClientId: process.env.EXPO_PUBLIC_EXPO_GOOGLE_API_KEY,
        scopes: ["profile", "email"],
      });
    }
  };

  useEffect(() => {
    configureGoogleSignIn();
  }, []);

  const authHandler = async ({ name, email, avatar }) => {
    const JWT_SECRET = "cSG+pNycQqHhGFj0qqDqkPfhNDxCBgv2Kv6EJOAHCz0=";
    try {
      const user = { name, email, avatar };
      const signedToken = JWT.encode(user, JWT_SECRET);

      const res = await axios.post(
        `${process.env.EXPO_PUBLIC_SERVER_URI}/api/auth/login`,
        { signedToken }
      );

      const accessToken = res.data.accessToken;
      await login(user, accessToken);

      setModalVisible(false);
      router.push("/create");
    } catch (err) {
      console.error("authHandler error:", err.response?.data || err.message);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      await GoogleSignin.hasPlayServices();
      await GoogleSignin.signOut();

      const userInfo = await GoogleSignin.signIn();
      const { name, email, photo } = userInfo?.data?.user || {};

      if (!name || !email) {
        console.warn("Incomplete user info from Google.");
        return;
      }

      await authHandler({ name, email, avatar: photo });
    } catch (error) {
      console.log("Google sign-in error:", error.message || error);
    }
  };

  return (
    <BlurView intensity={100} tint="dark" style={styles.overlay}>
      <Pressable style={styles.modalBox} onPress={(e) => e.stopPropagation?.()}>
        <Text style={styles.title}>
          {isLogin ? "LIVINAI" : "Join to LIVINAI"}
        </Text>
        <Text style={styles.subtitle}>
          {isLogin
            ? "Log in to continue"
            : "It's easier than your imagination!"}
        </Text>

        {/* ✅ Toggle between Login and Signup */}
        {isLogin ? (
          <LoginForm setModalVisible={setModalVisible} />
        ) : (
          <SignupForm setModalVisible={setModalVisible} />
        )}

        {/* Switcher */}
        <View style={{ marginTop: 12, flexDirection: "row" }}>
          <Text style={{ color: "#555" }}>
            {isLogin ? "Don’t have an account? " : "Already have an account? "}
          </Text>
          <TouchableOpacity onPress={() => setIsLogin(!isLogin)}>
            <Text style={{ color: COLORS.primaryDark, fontWeight: "600" }}>
              {isLogin ? "Sign Up" : "Login"}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Divider */}
        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>OR</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Google Sign-in */}
        <View style={styles.googleContainer}>
          <Pressable onPress={handleGoogleSignIn}>
            <Image
              source={require("@/assets/images/onboarding/google.png")}
              style={styles.googleIcon}
            />
          </Pressable>
        </View>
      </Pressable>
    </BlurView>
  );
}
