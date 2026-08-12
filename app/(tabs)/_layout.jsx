import React from "react";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import FloatingTabBar from "../../components/navigation/FloatingTabBar";
import { ms } from "../../constants/theme";

const TABS = [
  { name: "create", title: "Create", icon: "add-circle", iconOutline: "add-circle-outline" },
  { name: "collection", title: "Collection", icon: "albums", iconOutline: "albums-outline" },
  { name: "profile", title: "Profile", icon: "person", iconOutline: "person-outline" },
];

/**
 * A floating navigation bar rather than a docked one.
 *
 * The bar is rendered by `FloatingTabBar` and drawn over the screen, so the
 * navigator reserves no space for it. Each tab screen therefore pads its own
 * scrollable content by `TAB_BAR_CLEARANCE` — see that module for why the
 * clearance is defined in one place instead of per screen.
 *
 * `backBehavior="history"` because back should undo the last thing the user did.
 * The default jumps straight to Create from any tab, which loses a step: from
 * Profile opened out of Collection, back belongs on Collection.
 */
export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      backBehavior="history"
      screenOptions={{ headerShown: false }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarIcon: ({ focused, color }) => (
              <Ionicons name={focused ? tab.icon : tab.iconOutline} size={ms(22)} color={color} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
