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
  const { user } = useAuthStore(); // must contain user._id when logged in

  const [loaded] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
    Poppins_600SemiBold,
    Poppins_300Light,
    Poppins_700Bold,
    Poppins_400Regular,
    Poppins_500Medium,
  });

  useEffect(() => {
  if (!user?._id) return; // Wait until user is loaded

  const initRevenueCat = async () => {
    try {
      purchases.setLogLevel(LOG_LEVEL.DEBUG);

      await purchases.configure({
        apiKey: "goog_uVORiYiVgmggjNiOAHvBLferRyp",
        appUserID: user._id, // pass your real user ID here
      });

      const info = await purchases.getCustomerInfo();
      console.log("RevenueCat customer info:", info);
    } catch (error) {
      console.error("RevenueCat setup failed:", error);
    }
  };

  initRevenueCat();
}, [user?._id]);

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
