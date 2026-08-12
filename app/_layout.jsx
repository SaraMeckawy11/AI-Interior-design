import React, { useEffect } from "react";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useAuthStore } from "../authStore";
import { ensureRevenueCatConfigured } from "../lib/revenueCat";
import AndroidBackGuard from "../components/navigation/AndroidBackGuard";
import {
  Poppins_600SemiBold,
  Poppins_300Light,
  Poppins_400Regular,
  Poppins_700Bold,
  Poppins_500Medium,
  useFonts,
} from "@expo-google-fonts/poppins";

// Keep iOS on the native Livinai launch screen until the fonts needed by the
// first React frame are ready. Without this, iOS briefly replaced the splash
// with an unstyled/blank frame while Poppins was still loading.
SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const { user, token, isCheckingAuth, checkAuth, fetchUser } = useAuthStore();

  const [fontsLoaded, fontError] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
    Poppins_600SemiBold,
    Poppins_300Light,
    Poppins_700Bold,
    Poppins_400Regular,
    Poppins_500Medium,
  });

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [fontError, fontsLoaded]);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      if (isCheckingAuth) return;

      let currentUser = user;
      if ((!user || !user._id) && token) {
        currentUser = await fetchUser();
      }

      if (cancelled || !currentUser?._id) return;

      try {
        await ensureRevenueCatConfigured(currentUser._id);
      } catch (error) {
        // Store access is optional during app startup. The pricing screen gives
        // a calm unavailable state if Play/App Store cannot be reached.
        if (__DEV__) console.info('RevenueCat is unavailable:', error?.message);
      }
    };

    init();
    return () => {
      cancelled = true;
    };
  }, [fetchUser, isCheckingAuth, token, user]);

  // Where back lands when a screen has nothing under it. Signing out is a
  // `replace` to onboarding, so an unauthenticated session's home is that
  // screen, not a Create tab the user cannot use.
  const home = token ? "/create" : "/(routes)/onboarding";

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <AndroidBackGuard home={home} />
      {/*
        `gestureEnabled` is the iOS swipe back. It is the default for a stack,
        but every screen here draws its own header with `headerShown: false`, so
        the gesture is the only affordance the platform contributes — worth
        stating rather than inheriting.
      */}
      <Stack screenOptions={{ headerShown: false, gestureEnabled: true }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(routes)/onboarding/index" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </SafeAreaProvider>
  );
}
