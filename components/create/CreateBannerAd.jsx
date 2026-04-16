import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { BannerAd, BannerAdSize, TestIds } from "react-native-google-mobile-ads";
import COLORS from "../../constants/colors";

// const AD_UNIT_ID = __DEV__ ? TestIds.BANNER : "ca-app-pub-4470538534931449/9120930286"; // real unit ID
  const AD_UNIT_ID = "ca-app-pub-4470538534931449/9120930286"; // real unit ID


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
    borderRadius: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.06)",
    elevation: 3,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
  },
  label: {
    fontSize: 12,
    color: COLORS.primaryDark,
    marginBottom: 8,
    fontWeight: "700",
    backgroundColor: "rgba(127,160,136,0.10)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
});
