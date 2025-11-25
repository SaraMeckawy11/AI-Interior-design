import { View, Text, ScrollView, TouchableOpacity } from "react-native";
import React, { useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import COLORS from "../../constants/colors";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuthStore } from "../../authStore";

// --- Google Mobile Ads (App Open) ---
import {
  AppOpenAd,
  AdEventType,
  TestIds,
} from "react-native-google-mobile-ads";

// PRODUCTION APP-OPEN AD UNIT
const APP_OPEN_AD_UNIT_ID =  __DEV__? TestIds.APP_OPEN :"ca-app-pub-4470538534931449/1696483792";

const appOpenAd = AppOpenAd.createForAdRequest(APP_OPEN_AD_UNIT_ID, {
  requestNonPersonalizedAdsOnly: false,
});

export default function Create() {
  const router = useRouter();
  const [isSubscribed, setIsSubscribed] = useState(null);
  const [isPremium, setIsPremium] = useState(null);
  const { token } = useAuthStore();

  // -----------------------------------
  // FETCH USER STATUS (subscription)
  // -----------------------------------
  useEffect(() => {
    const fetchUserStatus = async () => {
      if (!token) return;

      try {
        const res = await fetch(`${process.env.EXPO_PUBLIC_SERVER_URI}/me`, {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });

        if (!res.ok) {
          console.error("Failed to fetch user status:", res.status);
          return;
        }

        const data = await res.json();
        const { isSubscribed, isPremium } = data.user || {};

        setIsSubscribed(isSubscribed || false);
        setIsPremium(isPremium || false);
      } catch (err) {
        console.error("Failed to fetch user status:", err);
      }
    };

    fetchUserStatus();
  }, [token]);

  // -----------------------------------
  // AUTO SHOW APP OPEN AD (policy safe, NO daily limit)
  // -----------------------------------
  useEffect(() => {
    let intervalId;

    if (isSubscribed === null || isPremium === null) return;

    const showAppOpenAd = async () => {
      try {
        // Skip premium/subscribed users
        if (isSubscribed || isPremium) {
          console.log("🚫 App-open ad skipped — premium user");
          return;
        }

        // FREQUENCY CAP: 12 minutes
        const lastShown = await AsyncStorage.getItem("lastAppOpenAdTime");
        const now = Date.now();
        const AD_INTERVAL_MINUTES = 12;

        if (lastShown && now - parseInt(lastShown) < AD_INTERVAL_MINUTES * 60 * 1000) {
          console.log(
            `⏩ App-open ad skipped — shown less than ${AD_INTERVAL_MINUTES} mins ago`
          );
          return;
        }

        console.log("⌛ Loading AppOpenAd...");
        appOpenAd.load();

        const loadedListener = appOpenAd.addAdEventListener(
          AdEventType.LOADED,
          async () => {
            console.log("✅ App open ad loaded — showing now");
            appOpenAd.show();

            // Save timestamp for frequency capping
            await AsyncStorage.setItem("lastAppOpenAdTime", now.toString());
          }
        );

        const closedListener = appOpenAd.addAdEventListener(
          AdEventType.CLOSED,
          () => {
            console.log("👋 App-open ad closed");
          }
        );

        return () => {
          loadedListener();
          closedListener();
        };

      } catch (err) {
        console.error("❌ Error showing App Open Ad:", err);
      }
    };

    // ===============================
    // RUN ONCE immediately
    // AND every 4 minutes afterward
    // ===============================
    showAppOpenAd();

    intervalId = setInterval(showAppOpenAd, 4 * 60 * 1000);

    return () => {
      if (intervalId) clearInterval(intervalId);
    };

  }, [isSubscribed, isPremium]);

  // -----------------------------------
  // Cards UI
  // -----------------------------------
  const cards = [
    {
      title: "Interior Redesign",
      description: "Upload a photo and redesign your room with AI.",
      icon: "color-palette-outline",
      route: "/create/interior",
    },
    {
      title: "Prompt Generator",
      description: "Generate designs only from text prompts.",
      icon: "create-outline",
      route: "/create/prompt",
    },
    {
      title: "Floor Plan Builder",
      description: "Create or redraw a floor plan with AI assistance.",
      icon: "grid-outline",
      route: "/create/plan",
    },
  ];

  // -----------------------------------
  // RENDER
  // -----------------------------------
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: COLORS.background }}
      contentContainerStyle={{ padding: 20 }}
    >
      <Text style={{ fontSize: 30, fontWeight: "700", marginBottom: 20 }}>
        Create Designs
      </Text>

      {cards.map((card, index) => (
        <TouchableOpacity
          key={index}
          style={{
            backgroundColor: COLORS.white,
            padding: 20,
            borderRadius: 18,
            marginBottom: 16,
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            elevation: 2,
          }}
          activeOpacity={0.85}
          onPress={() => router.push(card.route)}
        >
          <View style={{ width: "85%" }}>
            <Ionicons name={card.icon} size={32} color={COLORS.primary} />
            <Text
              style={{
                fontSize: 18,
                fontWeight: "600",
                marginTop: 10,
                color: COLORS.textPrimary,
              }}
            >
              {card.title}
            </Text>
            <Text
              style={{
                fontSize: 14,
                color: COLORS.textSecondary,
                marginTop: 4,
              }}
            >
              {card.description}
            </Text>
          </View>

          <Ionicons
            name="chevron-forward"
            size={24}
            color={COLORS.textSecondary}
          />
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}
