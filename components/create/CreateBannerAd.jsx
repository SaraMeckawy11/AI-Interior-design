import React, { useEffect, useState } from "react";
import { InteractionManager, Platform, View, Text, StyleSheet } from "react-native";
import { BannerAd, BannerAdSize, TestIds } from "react-native-google-mobile-ads";
import COLORS from "../../constants/colors";

const AD_UNIT_ID = __DEV__
  ? TestIds.BANNER
  : Platform.select({
      android: "ca-app-pub-4470538534931449/9120930286",
      ios: "ca-app-pub-4470538534931449/3114630339",
    });

/** 300 x 250, the MEDIUM_RECTANGLE this renders. */
const AD_HEIGHT = 250;

export default function CreateBannerAd() {
  // Mounting `BannerAd` attaches a native view and fires a network request. Doing
  // that in the first render put it on the JS thread while the navigator was
  // still animating the push from the hub, which is most of why opening Interior
  // or Exterior stuttered. The slot is reserved at its real height from the
  // start, so nothing below it moves when the ad arrives.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => setReady(true));
    return () => task.cancel();
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Sponsored</Text>

      <View style={styles.slot}>
        {ready ? (
          <BannerAd
            unitId={AD_UNIT_ID}
            size={BannerAdSize.MEDIUM_RECTANGLE} // 300x250 looks good in Create page
            requestOptions={{ requestNonPersonalizedAdsOnly: true }}
          />
        ) : null}
      </View>
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
  slot: { height: AD_HEIGHT, alignItems: "center", justifyContent: "center" },
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
