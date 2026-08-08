import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import COLORS from "../../constants/colors";
import { LAYOUT, RADIUS, SHADOW, SPACING, TYPE, MOTION, ms } from "../../constants/theme";
import { TAB_BAR_CLEARANCE } from "../../components/navigation/FloatingTabBar";
import { useAuthStore } from "../../authStore";
import InteriorImg from "../../assets/images/onboarding/i2.png";
import { apiUrl } from "../../configs/api";

// --- Google Mobile Ads (App Open) ---
import { AppOpenAd, AdEventType, TestIds } from "react-native-google-mobile-ads";

const APP_OPEN_AD_UNIT_ID = __DEV__
  ? TestIds.APP_OPEN
  : "ca-app-pub-4470538534931449/1696483792";

const appOpenAd = AppOpenAd.createForAdRequest(APP_OPEN_AD_UNIT_ID, {
  requestNonPersonalizedAdsOnly: false,
});

/**
 * Three entry points, not four.
 *
 * "Floor Plan" used to sit here as its own card, but from the user's point of
 * view it answers the same question the walkthrough does — "I have a plan, show
 * me the space". The route still exists and is offered inside the walkthrough's
 * first step for anyone starting from a photo of a plan; pulling it out of the
 * hub keeps the top level to one clear choice per starting material: a room
 * photo, an outdoor photo, or a plan.
 */
const CARDS = [
  {
    title: "Interior Design",
    description: "Photograph a room and get a fully resolved interior concept.",
    icon: "color-palette-outline",
    route: "/create/interior",
    tint: COLORS.brand100,
    iconColor: COLORS.brand700,
  },
  {
    title: "Exterior Makeover",
    description: "Facades, gardens, balconies and every outdoor space.",
    icon: "home-outline",
    route: "/create/exterior",
    tint: COLORS.accentSoft,
    iconColor: COLORS.accentStrong,
  },
  {
    title: "3D Walkthrough",
    description: "Draw your home to scale, walk through it, then render it with AI.",
    icon: "cube-outline",
    route: "/create/walkthrough",
    tint: COLORS.infoSoft,
    iconColor: COLORS.info,
    badge: "New",
  },
];

export default function Create() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { token } = useAuthStore();
  const [isSubscribed, setIsSubscribed] = useState(null);
  const [isPremium, setIsPremium] = useState(null);

  // ── Entrance animation ────────────────────────────────────────────────────
  const reveal = useRef(new Animated.Value(0)).current;
  const cardReveals = useRef(CARDS.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    Animated.timing(reveal, {
      toValue: 1,
      duration: MOTION.reveal,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    Animated.stagger(
      70,
      cardReveals.map((value) =>
        Animated.timing(value, {
          toValue: 1,
          duration: MOTION.slow,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ),
    ).start();
  }, [cardReveals, reveal]);

  const pressScales = useRef(CARDS.map(() => new Animated.Value(1))).current;
  const pressIn = (index) =>
    Animated.spring(pressScales[index], {
      toValue: MOTION.pressScale,
      useNativeDriver: true,
      ...MOTION.spring,
    }).start();
  const pressOut = (index) =>
    Animated.spring(pressScales[index], { toValue: 1, useNativeDriver: true, ...MOTION.spring }).start();

  // ── Subscription status ───────────────────────────────────────────────────
  useEffect(() => {
    const fetchUserStatus = async () => {
      if (!token) return;
      try {
        const res = await fetch(apiUrl("/api/users/me"), {
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        });
        if (!res.ok) return;
        const data = await res.json();
        setIsSubscribed(data.user?.isSubscribed || false);
        setIsPremium(data.user?.isPremium || false);
      } catch {}
    };
    fetchUserStatus();
  }, [token]);

  // ── App-open ads for free accounts ────────────────────────────────────────
  useEffect(() => {
    if (isSubscribed === null || isPremium === null) return;
    if (isSubscribed || isPremium) return;

    let unsubscribe;
    (async () => {
      try {
        const lastShown = await AsyncStorage.getItem("lastAppOpenAdTime");
        const now = Date.now();
        if (lastShown && now - Number(lastShown) < 12 * 60 * 1000) return;

        unsubscribe = appOpenAd.addAdEventListener(AdEventType.LOADED, async () => {
          appOpenAd.show();
          await AsyncStorage.setItem("lastAppOpenAdTime", String(now));
        });
        appOpenAd.load();
      } catch {}
    })();

    return () => unsubscribe?.();
  }, [isSubscribed, isPremium]);

  const premium = isSubscribed || isPremium;

  return (
    <View style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: TAB_BAR_CLEARANCE + SPACING.sm }}
      >
        <Animated.View style={{ opacity: reveal }}>
          <LinearGradient
            colors={COLORS.gradientBrandDeep}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.header, { paddingTop: insets.top + SPACING.xl }]}
          >
            {/* Depth: a soft top highlight plus the interior photograph bled
                into the corner at low opacity. */}
            <LinearGradient colors={COLORS.gradientGlass} style={StyleSheet.absoluteFill} />
            <Image source={InteriorImg} resizeMode="contain" style={styles.headerArt} />

            <View style={styles.brandRow}>
              <Text style={styles.brand}>LIVINAI</Text>
              {premium ? (
                <View style={styles.planPill}>
                  <Ionicons name="sparkles" size={11} color={COLORS.brand800} />
                  <Text style={styles.planPillText}>Premium</Text>
                </View>
              ) : null}
            </View>

            <Text style={styles.headline}>Design your space</Text>
            <Text style={styles.subhead}>
              Three ways to go from what you have to what it could be.
            </Text>
          </LinearGradient>
        </Animated.View>

        <View style={styles.content}>
          {CARDS.map((card, index) => (
            <Animated.View
              key={card.route}
              style={{
                opacity: cardReveals[index],
                transform: [
                  { scale: pressScales[index] },
                  {
                    translateY: cardReveals[index].interpolate({
                      inputRange: [0, 1],
                      outputRange: [18, 0],
                    }),
                  },
                ],
              }}
            >
              <Pressable
                style={styles.card}
                onPressIn={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  pressIn(index);
                }}
                onPressOut={() => pressOut(index)}
                onPress={() => router.push(card.route)}
                accessibilityRole="button"
                accessibilityLabel={`${card.title}. ${card.description}`}
              >
                <View style={[styles.cardIcon, { backgroundColor: card.tint }]}>
                  <Ionicons name={card.icon} size={23} color={card.iconColor} />
                </View>

                <View style={styles.cardCopy}>
                  <View style={styles.cardTitleRow}>
                    <Text style={styles.cardTitle}>{card.title}</Text>
                    {card.badge ? (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{card.badge}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.cardBody}>{card.description}</Text>
                </View>

                <Ionicons name="chevron-forward" size={18} color={COLORS.textTertiary} />
              </Pressable>
            </Animated.View>
          ))}

          {!premium && (
            <Pressable style={styles.upsell} onPress={() => router.push("/profile/upgrade")}>
              <View style={styles.upsellIcon}>
                <Ionicons name="diamond-outline" size={18} color={COLORS.accentStrong} />
              </View>
              <View style={styles.cardCopy}>
                <Text style={styles.upsellTitle}>Unlimited designs</Text>
                <Text style={styles.cardBody}>Remove ads and generate without limits.</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.accentStrong} />
            </Pressable>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },

  header: {
    paddingHorizontal: LAYOUT.gutter,
    paddingBottom: SPACING.xxl,
    borderBottomLeftRadius: RADIUS.xxl,
    borderBottomRightRadius: RADIUS.xxl,
    overflow: "hidden",
  },
  headerArt: {
    position: "absolute",
    right: ms(-34),
    top: ms(-14),
    width: ms(240),
    height: ms(240),
    opacity: 0.14,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: SPACING.md },
  brand: { ...TYPE.overline, color: "rgba(255,255,255,0.82)", letterSpacing: 3 },
  planPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.brand200,
  },
  planPillText: { ...TYPE.caption, color: COLORS.brand800, fontSize: 10 },

  headline: { ...TYPE.display, color: COLORS.white, marginTop: SPACING.base },
  subhead: {
    ...TYPE.body,
    color: "rgba(255,255,255,0.82)",
    marginTop: SPACING.sm,
    maxWidth: "88%",
  },

  content: { padding: LAYOUT.gutter, gap: SPACING.md },

  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.base,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.base,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOW.sm,
  },
  cardIcon: {
    width: ms(52),
    height: ms(52),
    borderRadius: RADIUS.md,
    alignItems: "center",
    justifyContent: "center",
  },
  cardCopy: { flex: 1, gap: 3 },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  cardTitle: { ...TYPE.h3, color: COLORS.textPrimary },
  cardBody: { ...TYPE.small, color: COLORS.textSecondary },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.accent,
  },
  badgeText: { ...TYPE.caption, color: COLORS.white, fontSize: 9.5 },

  upsell: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.base,
    backgroundColor: COLORS.accentTint,
    borderRadius: RADIUS.lg,
    padding: SPACING.base,
    borderWidth: 1,
    borderColor: COLORS.accentSoft,
    marginTop: SPACING.sm,
  },
  upsellIcon: {
    width: ms(44),
    height: ms(44),
    borderRadius: RADIUS.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.accentSoft,
  },
  upsellTitle: { ...TYPE.bodyStrong, color: COLORS.textPrimary },
});
