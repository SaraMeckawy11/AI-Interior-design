import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  Pressable,
  Modal,
  StyleSheet,
  Dimensions,
  AccessibilityInfo,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  cancelAnimation,
} from "react-native-reanimated";
import { scale, verticalScale } from "react-native-size-matters";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import COLORS from "@/constants/colors";
import AuthModal from "../auth/auth.modal";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

// The hero carries the product's whole promise, so it gets the majority of the
// screen. The rest is enough for a title, one line of body copy and the CTA.
const HERO_HEIGHT = SCREEN_HEIGHT * 0.58;

const SLIDE_DURATION = 3800; // Long enough to actually look at a room.
const FADE_DURATION = 900; // Cross-dissolve between rooms, not a hard cut.

export default function Slide({ slide, index, setIndex, totalSlides }) {
  const { title, secondTitle, subTitle, color, image, images, imageLabels } = slide;
  const insets = useSafeAreaInsets();

  const [modalVisible, setModalVisible] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);

  const isLast = index === totalSlides - 1;
  const hasSlideshow = !!images && images.length > 0 && isLast;
  const surface = color || COLORS.background;

  // Respect the OS "reduce motion" setting: no drifting zoom, no cross-fade.
  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (!cancelled) setReduceMotion(enabled);
    });
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion
    );
    return () => {
      cancelled = true;
      sub?.remove?.();
    };
  }, []);

  // --- Auto slideshow for last slide ---
  useEffect(() => {
    if (!hasSlideshow) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % images.length);
    }, SLIDE_DURATION);
    return () => clearInterval(interval);
  }, [hasSlideshow, images]);

  // Slow Ken Burns drift so a still photo still feels alive. Runs on the UI
  // thread via Reanimated, so the cross-fade never stutters.
  const zoom = useSharedValue(1);
  useEffect(() => {
    if (reduceMotion || !hasSlideshow) {
      cancelAnimation(zoom);
      zoom.value = 1;
      return;
    }
    zoom.value = 1;
    zoom.value = withRepeat(
      withTiming(1.08, {
        duration: SLIDE_DURATION * 2,
        easing: Easing.inOut(Easing.quad),
      }),
      -1,
      true
    );
    return () => cancelAnimation(zoom);
  }, [reduceMotion, hasSlideshow, zoom]);

  const kenBurnsStyle = useAnimatedStyle(() => ({
    transform: [{ scale: zoom.value }],
  }));

  const handlePress = () => {
    if (isLast) {
      setModalVisible(true);
    } else {
      setIndex(index + 1);
    }
  };

  const source = hasSlideshow ? images[currentIndex] : image;

  return (
    <View style={[styles.root, { backgroundColor: surface }]}>
      <StatusBar style="light" translucent />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <View style={styles.hero}>
        <Animated.View style={[StyleSheet.absoluteFill, kenBurnsStyle]}>
          <Image
            source={source}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={reduceMotion ? 0 : FADE_DURATION}
            cachePolicy="memory-disk"
            accessible
            accessibilityLabel={
              imageLabels?.[currentIndex] || "A home space designed with Livinai"
            }
          />
        </Animated.View>

        {/* Keeps the status bar and progress bar readable over any room,
            bright or dark — the photos vary too much to rely on luck. */}
        <LinearGradient
          pointerEvents="none"
          colors={["rgba(15,20,16,0.60)", "rgba(15,20,16,0.18)", "transparent"]}
          locations={[0, 0.55, 1]}
          style={[styles.topScrim, { height: insets.top + verticalScale(72) }]}
        />

        {/* Melts the photo into the content surface instead of a hard edge. */}
        <LinearGradient
          pointerEvents="none"
          colors={["transparent", surface]}
          locations={[0, 0.92]}
          style={styles.bottomScrim}
        />

        {hasSlideshow && images.length > 1 && (
          <View
            accessibilityRole="tablist"
            style={[styles.progressRow, { top: insets.top + verticalScale(10) }]}
          >
            {images.map((_, i) => (
              <Pressable
                key={i}
                accessibilityRole="tab"
                accessibilityLabel={`Show design ${i + 1} of ${images.length}${
                  imageLabels?.[i] ? `, ${imageLabels[i]}` : ""
                }`}
                accessibilityState={{ selected: i === currentIndex }}
                hitSlop={{ top: 5, bottom: 5 }}
                style={styles.progressTarget}
                onPress={() => setCurrentIndex(i)}
              >
                <View
                  style={[
                    styles.progressSegment,
                    i === currentIndex && styles.progressSegmentActive,
                  ]}
                />
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {/* ── Content ──────────────────────────────────────────────────────── */}
      <View
        style={[
          styles.content,
          { paddingBottom: insets.bottom + verticalScale(20) },
        ]}
      >
        <View style={styles.copy}>
          <Text style={styles.title}>{title}</Text>
          {!!secondTitle && <Text style={styles.secondTitle}>{secondTitle}</Text>}
          {!!subTitle && <Text style={styles.subTitle}>{subTitle}</Text>}
        </View>

        <View>
          {totalSlides > 1 && (
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={styles.dotsRow}
            >
              {Array.from({ length: totalSlides }).map((_, i) => (
                <View
                  key={i}
                  style={[styles.dot, i === index && styles.dotActive]}
                />
              ))}
            </View>
          )}

          {isLast && (
            <Pressable
              onPress={handlePress}
              accessibilityRole="button"
              accessibilityLabel="Get started"
              style={({ pressed }) => [
                styles.ctaWrapper,
                pressed && styles.ctaPressed,
              ]}
            >
              <LinearGradient
                colors={[COLORS.primary, COLORS.primaryDark]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.cta}
              >
                <Text style={styles.ctaText}>Get Started</Text>
              </LinearGradient>
            </Pressable>
          )}
        </View>
      </View>

      {/* Modal */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <AuthModal setModalVisible={setModalVisible} />
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  hero: {
    width: SCREEN_WIDTH,
    height: HERO_HEIGHT,
    overflow: "hidden",
    backgroundColor: COLORS.surfaceSunken,
  },
  topScrim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
  },
  bottomScrim: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: verticalScale(110),
  },
  progressRow: {
    position: "absolute",
    left: scale(20),
    right: scale(20),
    flexDirection: "row",
    gap: scale(4),
  },
  progressTarget: {
    flex: 1,
    height: verticalScale(20),
    minHeight: 20,
    justifyContent: "center",
  },
  progressSegment: {
    width: "100%",
    height: 3,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.35)",
  },
  progressSegmentActive: {
    backgroundColor: "#FFFFFF",
  },
  content: {
    flex: 1,
    paddingHorizontal: scale(24),
    paddingTop: verticalScale(4),
    justifyContent: "space-between",
  },
  // Centring the copy splits the leftover height above and below it instead of
  // dumping it all into one gap between the paragraph and the button.
  copy: {
    flex: 1,
    justifyContent: "center",
  },
  title: {
    fontSize: scale(27),
    lineHeight: scale(33),
    color: COLORS.textPrimary,
    fontFamily: "Poppins_700Bold",
    letterSpacing: -0.4,
  },
  secondTitle: {
    fontSize: scale(19),
    lineHeight: scale(26),
    color: COLORS.primary,
    fontFamily: "Poppins_600SemiBold",
    marginTop: verticalScale(1),
  },
  subTitle: {
    fontSize: scale(14),
    lineHeight: scale(22),
    color: COLORS.textSecondary,
    fontFamily: "Poppins_300Light",
    marginTop: verticalScale(10),
    maxWidth: scale(300),
  },
  dotsRow: {
    flexDirection: "row",
    marginBottom: verticalScale(16),
  },
  dot: {
    height: verticalScale(4),
    width: scale(16),
    backgroundColor: COLORS.border,
    marginRight: scale(6),
    borderRadius: scale(4),
  },
  dotActive: {
    width: scale(36),
    backgroundColor: COLORS.primary,
  },
  ctaWrapper: {
    width: "76%",
    maxWidth: scale(250),
    alignSelf: "center",
    borderRadius: scale(28),
    // Lifts the CTA off the warm background without a heavy drop shadow.
    shadowColor: COLORS.primaryDark,
    shadowOpacity: 0.28,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 6,
  },
  ctaPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.985 }],
  },
  cta: {
    height: verticalScale(44),
    minHeight: 44,
    borderRadius: scale(28),
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: {
    color: COLORS.white,
    fontSize: scale(15),
    fontFamily: "Poppins_600SemiBold",
    letterSpacing: 0.2,
  },
});
