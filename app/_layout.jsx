import React, { useEffect } from "react";
import { SplashScreen, Stack } from "expo-router";
import { ThemeProvider, useTheme } from "@/context/theme.context";
import {
  Poppins_600SemiBold,
  Poppins_300Light,
  Poppins_400Regular,
  Poppins_700Bold,
  Poppins_500Medium,
  useFonts,
} from "@expo-google-fonts/poppins";
import { SafeAreaProvider } from "react-native-safe-area-context";
import purchases, {LOG_LEVEL} from "react-native-purchases";

export default function Rootlayout() {
  const [loaded] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
    Poppins_600SemiBold,
    Poppins_300Light,
    Poppins_700Bold,
    Poppins_400Regular,
    Poppins_500Medium,
  });

  useEffect(() => {
    purchases.setLogLevel(LOG_LEVEL.VERBOSE);
    purchases.configure({ apiKey: "goog_uVORiYiVgmggjNiOAHvBLferRyp" });
    //getCustomerInfo();
  }, []);

  async function getCustomerInfo() {
    try {
      const customerInfo = await purchases.getCustomerInfo();
      console.log("Customer Info:", customerInfo);
    } catch (error) {
      console.error("Failed to fetch customer info:", error);
    }
  }

  return (
    <SafeAreaProvider >
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(routes)/onboarding/index" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </SafeAreaProvider>
  )
}