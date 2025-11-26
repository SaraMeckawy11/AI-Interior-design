import {
  View,
  Text,
  ScrollView,
  Animated,
  Pressable,
  Easing,
  Image,
} from "react-native";
import React, { useEffect, useState, useRef } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import COLORS from "../../constants/colors";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuthStore } from "../../authStore";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import InteriorImg from "../../assets/images/onboarding/i2.png";

// --- Google Mobile Ads (App Open) ---
import {
  AppOpenAd,
  AdEventType,
  TestIds,
} from "react-native-google-mobile-ads";

const APP_OPEN_AD_UNIT_ID = __DEV__
  ? TestIds.APP_OPEN
  : "ca-app-pub-4470538534931449/1696483792";

const appOpenAd = AppOpenAd.createForAdRequest(APP_OPEN_AD_UNIT_ID, {
  requestNonPersonalizedAdsOnly: false,
});

export default function Create() {
  const router = useRouter();
  const [isSubscribed, setIsSubscribed] = useState(null);
  const [isPremium, setIsPremium] = useState(null);
  const { token } = useAuthStore();

  // -----------------------------
  // Cards
  // -----------------------------
  const cards = [
    {
      title: "Interior Design",
      description: "Upload your room and get fresh interior styles instantly.",
      icon: "color-palette-outline",
      route: "/create/interior",
    },
    {
      title: "Exterior Makeover",
      description: "Transform facades, gardens, balconies and outdoor spaces.",
      icon: "home-outline",
      route: "/create/exterior",
    },
  ];

  // -----------------------------
  // Header animation
  // -----------------------------
  const headerOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(headerOpacity, {
      toValue: 1,
      duration: 550,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, []);

  // -----------------------------
  // Cards animations
  // -----------------------------
  const scaleAnimations = useRef(cards.map(() => new Animated.Value(1))).current;
  const opacityAnimations = useRef(cards.map(() => new Animated.Value(1))).current;
  const parallaxAnimations = useRef(cards.map(() => new Animated.Value(0))).current;

  const animatePressIn = (index) => {
    Animated.parallel([
      Animated.spring(scaleAnimations[index], {
        toValue: 0.97,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnimations[index], {
        toValue: 0.87,
        duration: 120,
        useNativeDriver: true,
      }),
      Animated.timing(parallaxAnimations[index], {
        toValue: 6,
        duration: 120,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const animatePressOut = (index) => {
    Animated.parallel([
      Animated.spring(scaleAnimations[index], {
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnimations[index], {
        toValue: 1,
        duration: 120,
        useNativeDriver: true,
      }),
      Animated.timing(parallaxAnimations[index], {
        toValue: 0,
        duration: 120,
        useNativeDriver: true,
      }),
    ]).start();
  };

  // -----------------------------
  // Fetch subscription
  // -----------------------------
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
        if (!res.ok) return;
        const data = await res.json();
        setIsSubscribed(data.user?.isSubscribed || false);
        setIsPremium(data.user?.isPremium || false);
      } catch {}
    };
    fetchUserStatus();
  }, [token]);

  // -----------------------------
  // Auto app-open ads
  // -----------------------------
  useEffect(() => {
    if (isSubscribed === null || isPremium === null) return;

    const showAd = async () => {
      try {
        if (isSubscribed || isPremium) return;

        const lastShown = await AsyncStorage.getItem("lastAppOpenAdTime");
        const now = Date.now();
        if (lastShown && now - lastShown < 12 * 60 * 1000) return;

        appOpenAd.load();

        const loaded = appOpenAd.addAdEventListener(
          AdEventType.LOADED,
          async () => {
            appOpenAd.show();
            await AsyncStorage.setItem("lastAppOpenAdTime", now.toString());
          }
        );

        return () => loaded();
      } catch {}
    };

    showAd();
  }, [isSubscribed, isPremium]);

  // -----------------------------
  // UI
  // -----------------------------
  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }}>
      
      {/* ⭐ HEADER */}
      <Animated.View style={{ opacity: headerOpacity }}>
        <LinearGradient
          colors={[COLORS.primary, COLORS.primaryDark]}
          style={{
            paddingTop: 60,
            paddingBottom: 40,
            paddingHorizontal: 24,
            borderBottomLeftRadius: 30,
            borderBottomRightRadius: 30,
            overflow: "hidden",
          }}
        >

          {/* Soft inner glow */}
          <LinearGradient
            colors={["rgba(255,255,255,0.10)", "transparent"]}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: "100%",
            }}
          />

          {/* 📸 Diagonal Interior Image */}
          <Image
            source={InteriorImg}
            resizeMode="contain"
            style={{
              position: "absolute",
              right: -30,
              top: -5,
              width: 260,
              height: 260,
              opacity: 0.18,
            }}
          />

          <View
            style={{
              position: "absolute",
              bottom: 0,
              right: 0,
              width: "60%",
              height: 55,
              backgroundColor: "rgba(0,0,0,0.06)",
              opacity: 0.18,
              borderBottomLeftRadius: 30,
            }}
          />
          {/* Brand */}
          <Text
            style={{
              fontSize: 28,
              fontWeight: "800",
              color: "white",
              marginBottom: 6,
              letterSpacing: 1.2,
            }}
          >
            LIVINAI
          </Text>

          {/* Title */}
          <Text
            style={{
              fontSize: 24,
              fontWeight: "700",
              color: "white",
              marginBottom: 8,
              letterSpacing: -0.5,
            }}
          >
            Design Your Space
          </Text>

          {/* Subtitle */}
          <Text
            style={{
              fontSize: 16,
              color: "#f0f0f0",
              opacity: 0.95,
            }}
          >
            Start your design journey
          </Text>
        </LinearGradient>
      </Animated.View>

      {/* ⭐ CONTENT */}
      <View style={{ padding: 24, paddingTop: 30 }}>
        {cards.map((card, index) => (
          <Pressable
            key={index}
            onPressIn={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              animatePressIn(index);
            }}
            onPressOut={() => animatePressOut(index)}
            onPress={() => router.push(card.route)}
          >
            <Animated.View
              style={{
                transform: [
                  { scale: scaleAnimations[index] },
                  { translateY: parallaxAnimations[index] },
                ],
                opacity: opacityAnimations[index],
                backgroundColor: "rgba(255,255,255,0.28)",
                borderRadius: 20,
                padding: 20,
                marginBottom: 24,
                height: 150,
                flexDirection: "row",
                alignItems: "center",
                borderWidth: 1.2,
                borderColor: "rgba(255,255,255,0.40)",
                shadowColor: "#000",
                shadowOpacity: 0.14,
                shadowRadius: 16,
                shadowOffset: { width: 0, height: 6 },
              }}
            >

              {/* Icon */}
              <View
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: 18,
                  backgroundColor: "rgba(255,255,255,0.32)",
                  justifyContent: "center",
                  alignItems: "center",
                  marginRight: 18,
                }}
              >
                <Ionicons name={card.icon} size={30} color={COLORS.primary} />
              </View>

              {/* Text */}
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontSize: 18.5,
                    fontWeight: "600",
                    color: COLORS.textPrimary,
                    letterSpacing: -0.3,
                  }}
                >
                  {card.title}
                </Text>

                <Text
                  style={{
                    fontSize: 14,
                    marginTop: 6,
                    color: COLORS.textSecondary,
                    lineHeight: 20,
                  }}
                >
                  {card.description}
                </Text>
              </View>

              <Ionicons
                name="chevron-forward"
                size={20}
                color={COLORS.textSecondary}
                style={{ marginLeft: 4 }}
              />
            </Animated.View>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}
