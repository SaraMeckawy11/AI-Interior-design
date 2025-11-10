import React, { useEffect } from "react";
import { Redirect } from "expo-router";
import { useAuthStore } from "@/authStore"; // Update if needed
import Loader from "@/components/Loader"; // Optional loader
import mobileAds from "react-native-google-mobile-ads"; // ✅ Import SDK

export default function Index() {
  const { token, isCheckingAuth, checkAuth } = useAuthStore();

  useEffect(() => {
    // Initialize AdMob SDK once on app startup
    mobileAds()
      .initialize()
      .then(adapterStatuses => {
        console.log("✅ AdMob initialized", adapterStatuses);
      });

    checkAuth(); // This loads token & user from AsyncStorage
  }, []);

  if (isCheckingAuth) return <Loader />; // or return null;

  return <Redirect href={token ? "/create" : "/(routes)/onboarding"} />;
}
