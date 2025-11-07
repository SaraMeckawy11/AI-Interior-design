import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { BannerAd, BannerAdSize, TestIds } from "react-native-google-mobile-ads";

const AD_UNIT_ID = __DEV__
  ? TestIds.BANNER // Test banner
  : "ca-app-pub-4470538534931449/9120930286"; // Replace with your real unit ID

export default function CreateBannerAd() {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>Sponsored</Text>

      <BannerAd
        unitId={AD_UNIT_ID}
        size={BannerAdSize.MEDIUM_RECTANGLE} // 300x250 looks good in Create page
        requestOptions={{ requestNonPersonalizedAdsOnly: true }}
        onAdLoaded={() => console.log("✅ Banner Ad loaded")}
        onAdFailedToLoad={(err) => console.log("❌ Banner Ad failed:", err)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 12,
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingVertical: 8,
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  label: {
    fontSize: 12,
    color: "#777",
    marginBottom: 4,
  },
});
