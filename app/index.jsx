import React from "react";
import { Redirect } from "expo-router";
import { useAuthStore } from "@/authStore";
import Loader from "@/components/Loader";

export default function Index() {
  const { token, isCheckingAuth } = useAuthStore();

  // The app opening. This screen sits directly under the native launch screen
  // while the stored session is read, so it carries Livinai's own splash rather
  // than a bare spinner — the branded screen continues, it does not stop and
  // start again.
  if (isCheckingAuth) return <Loader branded />;

  return <Redirect href={token ? "/create" : "/(routes)/onboarding"} />;
}
