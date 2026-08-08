import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import COLORS from "../constants/colors";
import { LAYOUT, RADIUS, SPACING, TYPE, ms } from "../constants/theme";

/**
 * A back arrow and a title, for every screen pushed on top of a tab.
 *
 * The policy, upgrade, billing and support screens had no way back on screen at
 * all — leaving them depended on knowing the platform gesture, which on Android
 * with gesture navigation is a guess. One shared header means the affordance is
 * in the same place on all of them, and the title stops being a centred banner
 * competing with the content underneath it.
 */
export default function ScreenHeader({ title, subtitle, onBack }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.header, { paddingTop: insets.top + SPACING.sm }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go back"
        hitSlop={LAYOUT.hitSlop}
        style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
        onPress={onBack || (() => router.back())}
      >
        <Ionicons name="chevron-back" size={21} color={COLORS.textPrimary} />
      </Pressable>

      <View style={styles.copy}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {!!subtitle && <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
    paddingHorizontal: SPACING.base,
    paddingBottom: SPACING.md,
    backgroundColor: COLORS.background,
  },
  back: {
    width: ms(40),
    height: ms(40),
    borderRadius: RADIUS.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  backPressed: { backgroundColor: COLORS.surfaceSunken },
  copy: { flex: 1, minWidth: 0 },
  title: { ...TYPE.h3, color: COLORS.textPrimary },
  subtitle: { ...TYPE.caption, color: COLORS.textTertiary, marginTop: 1 },
});
