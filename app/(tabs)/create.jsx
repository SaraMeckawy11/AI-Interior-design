import { View, Text, ScrollView, TouchableOpacity } from "react-native";
import React from "react";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import COLORS from "../../constants/colors";
import { RewardedAd, RewardedInterstitialAd,RewardedAdEventType, TestIds } from 'react-native-google-mobile-ads';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from "react";
import { useAuthStore } from "../../authStore";

// const adUnitId = __DEV__ ? TestIds.REWARDED : 'ca-app-pub-4470538534931449/2411201644';
const adUnitId = 'ca-app-pub-4470538534931449/2411201644';
const rewardedAd = RewardedAd.createForAdRequest(adUnitId);
const autoAd = RewardedAd.createForAdRequest(adUnitId);

export default function Create() {
  const router = useRouter();
  const [isSubscribed, setIsSubscribed] = useState(null);
  const [isPremium, setIsPremium] = useState(null);
  const { token } = useAuthStore();

  // Fetch user status
    useEffect(() => {
      const fetchUserStatus = async () => {
        if (!token) return;
  
        try {
          const res = await fetch(`${process.env.EXPO_PUBLIC_SERVER_URI}/me`, {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          });
  
          if (!res.ok) {
            console.error('Failed to fetch user status:', res.status);
            return;
          }
  
          const data = await res.json();
          const { isSubscribed, freeDesignsUsed, isPremium, manualDisabled, adCoins } = data.user || {};
  
          setIsSubscribed(isSubscribed || false);
          setIsPremium(isPremium || false);
        } catch (err) {
          console.error('Failed to fetch user status:', err);
        }
      };
  
      fetchUserStatus();
    }, [token]);

  // Automatically show one ad when user opens the app, respecting frequency
  useEffect(() => {
    let intervalId;
    let hasLoadedListener = false;
    let hasClosedListener = false;

    const showAutoAd = async () => {
      try {
        // 🛑 Skip for premium or subscribed users
        if (isSubscribed || isPremium) {
          console.log("🚫 Auto ad skipped — user has premium or subscription");
          return;
        }

        const lastShown = await AsyncStorage.getItem('lastAutoAdTime');
        const now = Date.now();
        const AD_INTERVAL_MINUTES = 15;

        if (lastShown && now - parseInt(lastShown) < AD_INTERVAL_MINUTES * 60 * 1000) {
          console.log(`⏩ Auto ad skipped — shown less than ${AD_INTERVAL_MINUTES} mins ago`);
          return;
        }

        console.log('⌛ Loading autoAd...');
        autoAd.load();

        // ✅ Attach listeners only once
        if (!hasLoadedListener) {
          hasLoadedListener = true;
          autoAd.addAdEventListener(RewardedAdEventType.LOADED, async () => {
            console.log('✅ Auto ad loaded — showing now');
            autoAd.show();
            await AsyncStorage.setItem('lastAutoAdTime', Date.now().toString());
          });
        }

        if (!hasClosedListener) {
          hasClosedListener = true;
          autoAd.addAdEventListener(RewardedAdEventType.CLOSED, () => {
            console.log('👋 Auto ad closed');
          });
        }
      } catch (error) {
        console.error('❌ Error handling autoAd:', error);
      }
    };

    // ✅ Run once and then every minute
    if (isSubscribed !== null && isPremium !== null) {
      showAutoAd();
      intervalId = setInterval(showAutoAd, 5 * 60 * 1000);
    }

    return () => clearInterval(intervalId);
  }, [isSubscribed, isPremium]);
  
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
