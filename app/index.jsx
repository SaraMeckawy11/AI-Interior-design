import React, { useEffect } from "react";
import { Redirect } from "expo-router";
import { useAuthStore } from "@/authStore"; // Update if needed
import Loader from "@/components/Loader"; // Optional loader

export default function Index() {
  const { token, isCheckingAuth, checkAuth } = useAuthStore();

  useEffect(() => {
    checkAuth(); // This loads token & user from AsyncStorage
  }, []);

if (isCheckingAuth) return <Loader />; // or return null;

  return <Redirect href={token ? "/create" : "/(routes)/onboarding"} />;
}

