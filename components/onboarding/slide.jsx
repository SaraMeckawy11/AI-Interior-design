import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  Pressable,
  Modal,
  StyleSheet,
  Dimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { scale, verticalScale } from "react-native-size-matters";
import COLORS from "@/constants/colors";
import AuthModal from "../auth/auth.modal";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

export default function Slide({ slide, index, setIndex, totalSlides }) {
  const { title, secondTitle, subTitle, color, image, images } = slide;

  const [modalVisible, setModalVisible] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);

  // --- Auto slideshow for last slide ---
  useEffect(() => {
    if (!images || images.length === 0 || index !== totalSlides - 1) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % images.length);
    }, 1500); // 1.5s per image
    return () => clearInterval(interval);
  }, [images, index]);

  const handlePress = () => {
    if (index === totalSlides - 1) {
      setModalVisible(true);
    } else {
      setIndex(index + 1);
    }
  };

  // --- Render image or slideshow ---
  const renderImage = () => {
    const containerWidth = SCREEN_WIDTH - scale(24); // margin from sides
    const containerHeight = verticalScale(200);

    return (
      <View
        style={{
          width: containerWidth,
          height: containerHeight,
          alignSelf: "center",
          borderRadius: 20,
          overflow: "hidden",
          marginTop: verticalScale(64),
          marginBottom: verticalScale(20),
          shadowColor: "#000",
          shadowOpacity: 0.1,
          shadowOffset: { width: 0, height: 3 },
          shadowRadius: 6,
          elevation: 3,
        }}
      >
        <Image
          source={images && images.length > 0 ? images[currentIndex] : image}
          style={{ width: "100%", height: "100%" }}
          resizeMode="cover"
        />
      </View>
    );
  };

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: color || COLORS.background,
        alignItems: "center",
        // justifyContent: "center",
        paddingHorizontal: scale(20),
      }}
    >
      {renderImage()}

      <Text
        style={{
          fontSize: scale(18),
          fontWeight: "700",
          color: COLORS.textPrimary,
          textAlign: "center",
          fontFamily: "Poppins_600SemiBold",
          marginTop: verticalScale(40),
          marginBottom: verticalScale(8),
        }}
      >
        {title}
      </Text>

      <Text
        style={{
          fontSize: scale(14),
          fontWeight: "700",
          color: COLORS.textPrimary,
          fontFamily: "Poppins_500Medium",
          marginTop: verticalScale(4),
          marginBottom: verticalScale(8),
          // textAlign: "center",
        }}
      >
        {secondTitle}
      </Text>

      <Text
        style={{
          fontSize: scale(13),
          color: COLORS.textPrimary,
          textAlign: "center",
          marginTop: verticalScale(8),
          paddingHorizontal: scale(8),
          fontFamily: "Poppins_300Light",
        }}
      >
        {subTitle}
      </Text>

      {/* Dots indicator */}
      <View style={styles.indicatorContainer}>
        {Array.from({ length: totalSlides }).map((_, i) => (
          <TouchableOpacity
            key={i}
            style={[styles.indicator, i === index && styles.activeIndicator]}
          />
        ))}
      </View>

      {/* Next / Get Started Button */}
      {index <= totalSlides - 1 && (
        <LinearGradient
          colors={[COLORS.primary, COLORS.primaryDark]}
          style={styles.nextButton}
        >
          <Pressable style={styles.nextPressable} onPress={handlePress}>
            <Text style={styles.nextButtonText}>
              {index === totalSlides - 1 ? "Get Started" : "Next"}
            </Text>
          </Pressable>
        </LinearGradient>
      )}

      {/* Modal */}
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

const styles = StyleSheet.create({
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
    fontSize: scale(13),
    fontWeight: "bold",
  },
  nextPressable: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
    height: "100%",
  },
});
