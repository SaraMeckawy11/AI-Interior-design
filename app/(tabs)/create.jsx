import { View, Text, ScrollView, TouchableOpacity } from "react-native";
import React from "react";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import COLORS from "../../constants/colors";

export default function Create() {
  const router = useRouter();

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
