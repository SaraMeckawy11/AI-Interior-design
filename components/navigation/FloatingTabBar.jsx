import React, { useEffect, useRef } from "react";
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import COLORS from "../../constants/colors";
import { MOTION, RADIUS, SPACING, TYPE, ms } from "../../constants/theme";

/**
 * The floating navigation bar.
 *
 * It is detached from all four edges rather than docked, which is the shape most
 * current apps use and the reason the previous bar read as dated: a full-width
 * strip with a hairline on top belongs to a generation of UI where the bar was
 * part of the chrome. Floating it makes the content the surface and the bar an
 * object sitting on top of it.
 *
 * The trade-off a floating bar always brings is that the navigator no longer
 * reserves its space, so a scroll view's last row can hide underneath it. That
 * is solved once, here, by `TAB_BAR_CLEARANCE` — every tab screen pads its
 * scroll content by that number instead of each screen guessing.
 */

const BAR_HEIGHT = ms(62);
const BAR_INSET = SPACING.base;

/** Space a tab screen must leave at the bottom of its scrollable content. */
export const TAB_BAR_CLEARANCE = BAR_HEIGHT + BAR_INSET * 2;

/**
 * One destination.
 *
 * The selected state is a soft tinted capsule that hugs its label, with the icon
 * and text in the brand's dark sage — not a saturated block filling the whole
 * slot. A heavy fill makes the selected tab shout at the content above it and
 * leaves the other two looking switched off; a tint carries the same "you are
 * here" signal at a fraction of the weight, and keeps white text off a mid-green
 * that never had the contrast for it.
 *
 * Every item keeps an equal share of the bar whether or not it is selected, so
 * revealing the label on the active item cannot shuffle the others sideways —
 * a moving target is the fastest way to make a nav bar feel unreliable.
 */
function TabItem({ focused, icon, label, onPress, onLongPress, accessibilityLabel }) {
  const progress = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: focused ? 1 : 0,
      duration: MOTION.base,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [focused, progress]);

  const press = () => {
    if (!focused) Haptics.selectionAsync().catch(() => {});
    onPress();
  };

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={accessibilityLabel || label}
      style={styles.item}
      onPress={press}
      onLongPress={onLongPress}
    >
      {/* The capsule sizes itself to the content rather than to the slot, which
          is what keeps it reading as an object around the label instead of a
          block of colour behind it. */}
      <View style={styles.itemContent}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.pill,
            {
              opacity: progress,
              transform: [
                { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }) },
              ],
            },
          ]}
        />
        {icon}
        {focused ? (
          <Text style={styles.label} numberOfLines={1}>
            {label}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export default function FloatingTabBar({ state, descriptors, navigation }) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, BAR_INSET) }]}
      pointerEvents="box-none"
    >
      <View style={styles.bar} accessibilityRole="tablist">
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const focused = state.index === index;
          const label = options.tabBarLabel ?? options.title ?? route.name;
          const color = focused ? COLORS.primaryDark : COLORS.textTertiary;

          const onPress = () => {
            const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          return (
            <TabItem
              key={route.key}
              focused={focused}
              label={label}
              accessibilityLabel={options.tabBarAccessibilityLabel}
              icon={options.tabBarIcon?.({ focused, color, size: ms(22) })}
              onPress={onPress}
              onLongPress={() => navigation.emit({ type: "tabLongPress", target: route.key })}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: BAR_INSET,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    height: BAR_HEIGHT,
    paddingHorizontal: SPACING.xs + 2,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surface,
    // A hairline keeps the bar readable where it floats over a light photo; the
    // shadow alone disappears against the warm background.
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    ...Platform.select({
      ios: {
        shadowColor: "#16211D",
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.14,
        shadowRadius: 22,
      },
      android: { elevation: 12 },
      default: {},
    }),
  },
  item: {
    flex: 1,
    height: BAR_HEIGHT - (SPACING.xs + 2) * 2,
    alignItems: "center",
    justifyContent: "center",
  },
  itemContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs + 2,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  pill: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primarySoft,
  },
  label: {
    ...TYPE.caption,
    color: COLORS.primaryDark,
    flexShrink: 1,
  },
});
