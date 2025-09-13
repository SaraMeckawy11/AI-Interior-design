import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Pressable,
  Platform, Modal, Image
} from "react-native";
import { scale, verticalScale } from "react-native-size-matters";
import { fontSizes, windowWidth } from "@/themes/app.constant";
import { BlurView } from "expo-blur";
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import JWT from "expo-jwt";
import axios from "axios";
import { useRouter } from "expo-router";
import { useAuthStore } from "../../authStore";
import { requestTrackingPermissionAsync } from 'expo-tracking-transparency';

export default function AuthModal({ setModalVisible }) {
  const router = useRouter();
  const login = useAuthStore((state) => state.login);

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

      const res = await axios.post(`${process.env.EXPO_PUBLIC_SERVER_URI}/api/auth/login`, {
        signedToken,
      });

      const accessToken = res.data.accessToken;

      // Use Zustand authStore instead of SecureStore
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
    await GoogleSignin.signOut(); // force fresh login

    const userInfo = await GoogleSignin.signIn();
    console.log("userInfo:", userInfo);

    //  Destructure safely from userInfo.data
    const { name, email, photo } = userInfo?.data?.user || {};

    if (!name || !email) {
      console.warn("Incomplete user info from Google.");
      return;
    }

    await authHandler({
      name,
      email,
      avatar: photo,
    });
  } catch (error) {
    console.log("Google sign-in error:", error.message || error);
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
          marginTop: 16,
          fontFamily: "Poppins_500Medium",
        }}>
          Join to LIVINAI
        </Text>
        <Text style={{
          fontSize: fontSizes.FONT17,
          paddingTop: verticalScale(4),
          fontFamily: "Poppins_300Light",
        }}>
          It's easier than your imagination!
        </Text>
        <View style={{
          paddingVertical: scale(24),
          flexDirection: "row",
          gap: windowWidth(24),
        }}>
          <Pressable onPress={handleGoogleSignIn}>
            <Image
              source={require("@/assets/images/onboarding/google.png")}
              style={{
                width: scale(32),
                height: scale(32),
                resizeMode: "contain",
              }}
            />
          </Pressable>
        </View>
      </Pressable>
    </BlurView>
  );
}
