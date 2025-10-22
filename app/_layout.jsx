import React, { useEffect } from "react";
import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import purchases, { LOG_LEVEL } from "react-native-purchases";
import { useAuthStore } from "../authStore";

import {
  Poppins_600SemiBold,
  Poppins_300Light,
  Poppins_400Regular,
  Poppins_700Bold,
  Poppins_500Medium,
  useFonts,
} from "@expo-google-fonts/poppins";

export default function RootLayout() {
  const { user, token, isCheckingAuth, checkAuth, fetchUserFromDB } = useAuthStore();

  const [loaded] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
    Poppins_600SemiBold,
    Poppins_300Light,
    Poppins_700Bold,
    Poppins_400Regular,
    Poppins_500Medium,
  });

  // Step 1: Run checkAuth on first load
  useEffect(() => {
    checkAuth();
  }, []);

  // Step 2: Initialize RevenueCat only when auth check is done
  useEffect(() => {
    const init = async () => {
      if (isCheckingAuth) {
        console.log("Still checking auth...");
        return;
      }

      console.log("Auth store user before fetch:", user);
      console.log("Token:", token ? " token loaded" : " no token");

      let currentUser = user;
      if ((!user || !user._id) && token) {
        console.log("Fetching user from DB...");
        currentUser = await fetchUserFromDB();
      }

      if (!currentUser || !currentUser._id) {
        console.log("User not ready yet, skipping RevenueCat init.");
        return;
      }

      console.log("Initializing RevenueCat with user ID:", currentUser._id);

      try {
        purchases.setLogLevel(LOG_LEVEL.DEBUG);
        await purchases.configure({
          apiKey: "goog_uVORiYiVgmggjNiOAHvBLferRyp",
          appUserID: currentUser._id,
        });

        const info = await purchases.getCustomerInfo();
        console.log("RevenueCat customer info:", info);
      } catch (error) {
        console.error("RevenueCat setup failed:", error);
      }
    };

    init();
  }, [isCheckingAuth, user, token]);

  return (
    <SafeAreaProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(routes)/onboarding/index" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </SafeAreaProvider>
  );
}
