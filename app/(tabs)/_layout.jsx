import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import COLORS from "../../constants/colors";
import { RADIUS, SPACING, TYPE, ms } from "../../constants/theme";

const TABS = [
  { name: "create", title: "Create", icon: "add-circle", iconOutline: "add-circle-outline" },
  { name: "collection", title: "Collection", icon: "albums", iconOutline: "albums-outline" },
  { name: "profile", title: "Profile", icon: "person", iconOutline: "person-outline" },
];

/**
 * The tab bar is a floating surface rather than a full-width strip, and the
 * active item gets a filled pill with its label. The previous bar relied on a
 * pale tint alone to signal the current section, which was not distinguishable
 * at that contrast level.
 */
function TabIcon({ focused, icon, iconOutline, title }) {
  return (
    <View style={[styles.item, focused && styles.itemActive]}>
      <Ionicons
        name={focused ? icon : iconOutline}
        size={20}
        color={focused ? COLORS.white : COLORS.textTertiary}
      />
      {focused ? <Text style={styles.itemLabel}>{title}</Text> : null}
    </View>
  );
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: {
          position: "absolute",
          left: SPACING.base,
          right: SPACING.base,
          bottom: Math.max(insets.bottom, SPACING.md),
          height: ms(62),
          paddingTop: 0,
          paddingBottom: 0,
          borderRadius: RADIUS.pill,
          borderTopWidth: 0,
          backgroundColor: COLORS.surface,
          ...Platform.select({
            ios: {
              shadowColor: "#16211D",
              shadowOffset: { width: 0, height: 10 },
              shadowOpacity: 0.12,
              shadowRadius: 24,
            },
            android: { elevation: 10 },
          }),
        },
        tabBarItemStyle: { height: ms(62) },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarIcon: ({ focused }) => (
              <TabIcon
                focused={focused}
                icon={tab.icon}
                iconOutline={tab.iconOutline}
                title={tab.title}
              />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  item: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: SPACING.base,
    height: ms(42),
    borderRadius: RADIUS.pill,
    minWidth: ms(46),
  },
  itemActive: { backgroundColor: COLORS.primaryDark },
  itemLabel: { ...TYPE.caption, color: COLORS.white },
});
