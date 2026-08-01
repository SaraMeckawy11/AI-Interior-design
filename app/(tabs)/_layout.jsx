import React from "react";
import { Platform } from "react-native";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import COLORS from "../../constants/colors";
import { FONTS, ms } from "../../constants/theme";

const TABS = [
  { name: "create", title: "Create", icon: "add-circle", iconOutline: "add-circle-outline" },
  { name: "collection", title: "Collection", icon: "albums", iconOutline: "albums-outline" },
  { name: "profile", title: "Profile", icon: "person", iconOutline: "person-outline" },
];

/**
 * A conventional docked tab bar.
 *
 * An earlier revision floated a rounded pill over the content. It looked
 * tidier in isolation but every scrollable screen then needed bespoke bottom
 * padding to avoid hiding its last row behind it, and the gesture area on
 * Android sat awkwardly underneath. Docking the bar removes that whole class
 * of problem: the navigator reserves the space itself.
 */
export default function TabLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.primaryDark,
        tabBarInactiveTintColor: COLORS.textTertiary,
        tabBarLabelStyle: {
          fontFamily: FONTS.medium,
          fontSize: ms(11),
          marginTop: -2,
          marginBottom: 4,
        },
        tabBarStyle: {
          backgroundColor: COLORS.surface,
          borderTopWidth: 1,
          borderTopColor: COLORS.border,
          height: ms(58) + insets.bottom,
          paddingTop: 8,
          paddingBottom: insets.bottom || 8,
          ...Platform.select({
            ios: {
              shadowColor: "#1E241F",
              shadowOffset: { width: 0, height: -2 },
              shadowOpacity: 0.05,
              shadowRadius: 10,
            },
            android: { elevation: 8 },
          }),
        },
        tabBarItemStyle: { paddingTop: 2 },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarIcon: ({ focused, color }) => (
              <Ionicons name={focused ? tab.icon : tab.iconOutline} size={ms(23)} color={color} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
