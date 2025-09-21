import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Platform,
  Modal,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Image, ImageBackground } from 'expo-image';
import { Ionicons } from "@expo/vector-icons";

import {
  moderateScale,
  scale,
  verticalScale,
} from "react-native-size-matters";
import {
  fontSizes,
  SCREEN_WIDTH,
  windowHeight,
  windowWidth,
} from "@/themes/app.constant";
import COLORS from "@/constants/colors";
import {BlurView} from 'expo-blur';
import AuthModal from "../auth/auth.modal";

// Define the Slide component
export default function Slide({ slide, index, setIndex, totalSlides }) {
  const [modalVisible, setModalVisible] = useState(false);

  const handlePress = (index, setIndex) => {
    if (index === totalSlides - 1) {
      setModalVisible(true);
    } else {
      setIndex(index + 1);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: COLORS.background }]}>
      
      <View style={styles.image}>{slide.image}</View>

      <View style={{ width: SCREEN_WIDTH, paddingHorizontal: verticalScale(24) }}>
        <Text style={styles.title}>{slide.title}</Text>
        <Text style={styles.secondTitle}>{slide.secondTitle}</Text>
        <Text style={styles.subTitle}>{slide.subTitle}</Text>
      </View>

      {/* Dots Indicator */}
      <View style={styles.indicatorContainer}>
        {Array.from({ length: totalSlides }).map((_, i) => (
          <TouchableOpacity
            key={i}
            style={[styles.indicator, i === index && styles.activeIndicator]}
          />
        ))}
      </View>

      {/* Get Started / Next Button */}
      {index <= totalSlides - 1 && (
        <LinearGradient colors={[COLORS.primary, COLORS.primaryDark]} style={styles.nextButton}>
          <Pressable
            style={styles.nextPressable}
            onPress={() => handlePress(index, setIndex)}
          >
            <Text style={styles.nextButtonText}>Next</Text>
          </Pressable>
        </LinearGradient>
      )}

      {/* Chevron Arrow for intermediate slides */}
      {/* {index < totalSlides - 1 && (
        <TouchableOpacity
          style={styles.arrowButton}
          onPress={() => handlePress(index, setIndex)}
        >
          <Ionicons
            name="chevron-forward-outline"
            size={scale(18)}
            color={COLORS.textPrimary}
          />
        </TouchableOpacity>
      )} */}

      {/* Modal Placeholder */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(!modalVisible)}
      >
        <Pressable style={{ flex: 1 }} onPress={() => setModalVisible(false)}>
          <AuthModal setModalVisible={setModalVisible} />                
        </Pressable>
      </Modal>
    </View>
  );
}

// StyleSheet
const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    padding:scale(16),
    //paddingTop: verticalScale(24),
    alignItems: "center",
  },
  image: {
    //padding:scale(16),
    //width:'75%',
  },
  title: {
    marginTop:32,
    fontSize: 20,
    fontWeight: "700",
    color: COLORS.textPrimary,
    fontFamily: "Poppins_600SemiBold",
  },
  secondTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: COLORS.textPrimary,
    fontFamily: "Poppins_500Medium",
    marginTop: verticalScale(8),
    marginBottom:verticalScale(8)
  },

  subTitle: {
    paddingVertical: verticalScale(8),
    fontSize: 16,
    color: COLORS.textPrimary,
    fontFamily: "Poppins_300Light",
  },

  indicatorContainer: {
    flexDirection: "row",
    marginTop: verticalScale(32),
    position: "absolute",
    bottom: verticalScale(56),
    left: scale(32),
  },
  indicator: {
    height: verticalScale(4),
    width: scale(16),
    backgroundColor: "rgba(0, 0, 0, 0.2)",
    marginHorizontal: scale(4),
    borderRadius: scale(4),
  },
  activeIndicator: {
    width: scale(40),
    backgroundColor: COLORS.primary,
  },
  nextButton: {
    position: "absolute",
    right: scale(24),
    bottom: verticalScale(48),
    alignItems: "center",
    justifyContent: "center",
    width: scale(96),
    height: verticalScale(32),
    borderRadius: scale(24),
    zIndex: 999,
},

  nextButtonText: {
    color: COLORS.white,
    fontSize: fontSizes.FONT22,
    fontWeight: "bold",
  },
  nextPressable: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
    height: "100%",
  },
  arrowButton: {
    position: "absolute",
    width: scale(24),
    height: scale(24),
    borderRadius: scale(24),
    backgroundColor: "rgba(0, 0, 0, 0.1)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
    right: moderateScale(4),
    top: Platform.OS === "ios" ? verticalScale(345) : verticalScale(385),
    transform: [{ translateY: -30 }],
  },
});
