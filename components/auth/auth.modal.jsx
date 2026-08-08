import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Pressable,
  Platform, Modal, Image
} from "react-native";
import { scale, verticalScale } from "react-native-size-matters";
import { fontSizes, windowWidth } from "@/themes/app.constant";
import { BlurView } from "expo-blur";
import { GoogleSignin, statusCodes } from "@react-native-google-signin/google-signin";
import JWT from "expo-jwt";
import axios from "axios";
import { useRouter } from "expo-router";
import { useAuthStore } from "../../authStore";
import SignupForm from "./signup";
import LoginForm from "./login"; // ✅ new component
import styles from "../../assets/styles/authModal.styles";
import COLORS from "@/constants/colors";
import { apiUrl } from "../../configs/api";

export default function AuthModal({ setModalVisible }) {
  const router = useRouter();
  const loginGoogle = useAuthStore((state) => state.loginGoogle);
  const [isLogin, setIsLogin] = useState(true); // ✅ toggle
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [signInError, setSignInError] = useState(null);

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
        apiUrl("/api/auth/login"),
        { signedToken }
      );

      const accessToken = res.data.accessToken;
      await loginGoogle(user, accessToken);

      setModalVisible(false);
      router.push("/create");
    } catch (err) {
      const detail = err.response?.data?.message || err.response?.data || err.message;
      console.error("authHandler error:", detail);
      throw new Error(
        typeof detail === "string" ? detail : "Could not reach the Livinai server."
      );
    }
  };

  // Google returns codes, not sentences. Map the ones a user can actually act on.
  const describeSignInError = (error) => {
    switch (error?.code) {
      case statusCodes.SIGN_IN_CANCELLED:
        return null; // The user backed out on purpose; nothing to report.
      case statusCodes.IN_PROGRESS:
        return null; // A sign-in is already running; the guard below covers this.
      case statusCodes.PLAY_SERVICES_NOT_AVAILABLE:
        return "Google Play services isn't available on this device.";
      case statusCodes.DEVELOPER_ERROR:
        return "This build isn't registered for Google Sign-In. Check the app's signing certificate.";
      default:
        return error?.message || "Sign-in failed. Please try again.";
    }
  };

  const handleGoogleSignIn = async () => {
    if (isSigningIn) return; // Overlapping signIn() calls reject each other.
    setIsSigningIn(true);
    setSignInError(null);

    try {
      await GoogleSignin.hasPlayServices();
      await GoogleSignin.signOut();

      const userInfo = await GoogleSignin.signIn();
      const { name, email, photo } = userInfo?.data?.user || {};

      if (!name || !email) {
        setSignInError("Google didn't return your name and email.");
        return;
      }

      await authHandler({ name, email, avatar: photo });
    } catch (error) {
      console.log("Google sign-in error:", error.message || error);
      setSignInError(describeSignInError(error));
    } finally {
      setIsSigningIn(false);
    }
  };

  return (
    <BlurView
      intensity={100}
      tint="dark"
      style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
    >
      <Pressable
        style={{
          width: scale(320),
          height: verticalScale(160),
          backgroundColor: "#fff",
          borderRadius: 24,
          alignItems: "center",
          justifyContent: "center",
        }}
        onPress={(e) => e.stopPropagation?.()}
      >
        <Text style={{
          fontSize: 24,
          marginTop: verticalScale(4),
          fontFamily: "Poppins_500Medium",
        }}>
          Join to LIVINAI
        </Text>
        <Text style={{
          fontSize: fontSizes.FONT17,
          paddingTop: verticalScale(4),
          fontFamily: "Poppins_300Light",
        }}>
          It&apos;s easier than your imagination!
        </Text>
        
        <View style={styles.googleContainer}>
          <Pressable
            onPress={handleGoogleSignIn}
            disabled={isSigningIn}
            style={[styles.googleButton, isSigningIn && { opacity: 0.6 }]}
          >
            <Image
              source={require("@/assets/images/onboarding/google.png")}
              style={styles.googleIcon}
            />
            <Text style={styles.googleText}>
              {isSigningIn ? "Signing in…" : "Sign in with Google"}
            </Text>
          </Pressable>
        </View>

        {signInError && (
          <Text
            style={{
              color: "#c0392b",
              fontSize: fontSizes.FONT15,
              fontFamily: "Poppins_300Light",
              paddingHorizontal: scale(20),
              paddingTop: verticalScale(4),
              textAlign: "center",
            }}
          >
            {signInError}
          </Text>
        )}

      </Pressable>
    </BlurView>

     // <BlurView intensity={100} tint="dark" style={styles.overlay}>
    //   <Pressable style={styles.modalBox} onPress={(e) => e.stopPropagation?.()}>
    //     <Text style={styles.title}>
    //       {isLogin ? "LIVINAI" : "Join to LIVINAI"}
    //     </Text>
    //     <Text style={styles.subtitle}>
    //       {isLogin
    //         ? "Log in to continue"
    //         : "It's easier than your imagination!"}
    //     </Text>

    //     {/* ✅ Toggle between Login and Signup */}
    //     {isLogin ? (
    //       <LoginForm setModalVisible={setModalVisible} />
    //     ) : (
    //       <SignupForm setModalVisible={setModalVisible} />
    //     )}

    //     {/* Switcher */}
    //     <View style={{ marginTop: 12, flexDirection: "row" }}>
    //       <Text style={{ color: "#555" }}>
    //         {isLogin ? "Don’t have an account? " : "Already have an account? "}
    //       </Text>
    //       <TouchableOpacity onPress={() => setIsLogin(!isLogin)}>
    //         <Text style={{ color: COLORS.primaryDark, fontWeight: "600" }}>
    //           {isLogin ? "Sign Up" : "Login"}
    //         </Text>
    //       </TouchableOpacity>
    //     </View>

    //     {/* Divider */}
    //     <View style={styles.divider}>
    //       <View style={styles.dividerLine} />
    //       <Text style={styles.dividerText}>OR</Text>
    //       <View style={styles.dividerLine} />
    //     </View>

    //     {/* Google Sign-in */}
    //     <View style={styles.googleContainer}>
    //       <Pressable onPress={handleGoogleSignIn}>
    //         <Image
    //           source={require("@/assets/images/onboarding/google.png")}
    //           style={styles.googleIcon}
    //         />
    //       </Pressable>
    //     </View>
    //   </Pressable>
    // </BlurView>
    
  );
}
