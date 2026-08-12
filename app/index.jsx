import React, { useEffect } from "react";
import { Redirect } from "expo-router";
import { Platform } from "react-native";
import { requestTrackingPermissionsAsync } from "expo-tracking-transparency";
import { useAuthStore } from "@/authStore";
import Loader from "@/components/Loader";
import mobileAds from "react-native-google-mobile-ads";

export default function Index() {
  const { token, isCheckingAuth, checkAuth } = useAuthStore();

  useEffect(() => {
    let cancelled = false;

    const initializeAds = async () => {
      // On iOS, ask before AdMob can access the advertising identifier. AdMob
      // still works with limited signals when permission is denied, so
      // declining never blocks the app.
      if (Platform.OS === "ios") {
        await requestTrackingPermissionsAsync().catch(() => undefined);
      }

      if (!cancelled) await mobileAds().initialize();
    };

    initializeAds().catch((error) => {
      if (__DEV__) console.info("AdMob initialization failed:", error?.message);
    });

    checkAuth();
    return () => {
      cancelled = true;
    };
  }, [checkAuth]);

  if (isCheckingAuth) return <Loader />;

  return <Redirect href={token ? "/create" : "/(routes)/onboarding"} />;
}
