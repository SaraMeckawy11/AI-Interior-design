import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { BannerAd, BannerAdSize } from "react-native-google-mobile-ads";


const AD_UNIT_ID = __DEV__? "ca-app-pub-3940256099942544/6300978111" : "ca-app-pub-4470538534931449/9120930286";

// const AD_UNIT_ID = "ca-app-pub-4470538534931449/9120930286";

export default function NativeCollectionAd() {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>Sponsored</Text>

      <BannerAd
        unitId={AD_UNIT_ID}
        size={BannerAdSize.MEDIUM_RECTANGLE}
        requestOptions={{
          requestNonPersonalizedAdsOnly: true,
        }}
        onAdLoaded={() => console.log("✅ Ad loaded successfully")}
        onAdFailedToLoad={(error) =>
          console.log("❌ Ad failed to load:", JSON.stringify(error))
        }
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
