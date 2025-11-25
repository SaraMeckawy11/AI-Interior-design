import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  Dimensions,
  Modal,
  TouchableWithoutFeedback,
  ScrollView,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import { formatPublishDate } from '../lib/utils';
import Slider from '@react-native-community/slider';
import styles from '../assets/styles/output.styles';
import COLORS from '../constants/colors';

export default function OutputScreen() {
  const { generatedImage, image, customPrompt, roomType, designStyle, colorTone, createdAt } =
    useLocalSearchParams();

  const router = useRouter();

  const [imageHeight, setImageHeight] = useState(240);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalMessage, setModalMessage] = useState('');
  const [sliderValue, setSliderValue] = useState(1);

  const screenWidth = Dimensions.get('window').width - 32;

  useEffect(() => {
    const uri = generatedImage || image;
    if (uri) {
      Image.getSize(
        uri,
        (width, height) => {
          const ratio = height / width;
          setImageHeight(screenWidth * ratio);
        },
        (error) => console.error("Failed to get image size", error)
      );
    }
  }, [generatedImage, image]);

  const handleShare = async () => {
    if (!generatedImage) return;
    try {
      const fileUri = FileSystem.documentDirectory + 'temp-share.jpg';
      const downloadRes = await FileSystem.downloadAsync(generatedImage, fileUri);
      const isAvailable = await Sharing.isAvailableAsync();
      if (!isAvailable) {
        setModalMessage("Sharing is not available on this device.");
        setModalVisible(true);
        return;
      }
      await Sharing.shareAsync(downloadRes.uri);
    } catch {
      setModalMessage("Failed to share image.");
      setModalVisible(true);
    }
  };

  const handleDownload = async () => {
    if (!generatedImage) return;
    try {
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (!permission.granted) {
        setModalMessage("Cannot save image without permission.");
        setModalVisible(true);
        return;
      }
      const fileUri = FileSystem.documentDirectory + 'generated-image.jpg';
      const downloadRes = await FileSystem.downloadAsync(generatedImage, fileUri);
      await MediaLibrary.saveToLibraryAsync(downloadRes.uri);
      setModalMessage("Image saved to your gallery.");
      setModalVisible(true);
    } catch {
      setModalMessage("Failed to download image.");
      setModalVisible(true);
    }
  };

  const FeedbackModal = () => (
    <Modal
      visible={modalVisible}
      transparent
      animationType="fade"
      onRequestClose={() => setModalVisible(false)}
    >
      <TouchableWithoutFeedback onPress={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalMessage}>{modalMessage}</Text>
            <TouchableOpacity
              style={styles.modalButton}
              onPress={() => setModalVisible(false)}
            >
              <Text style={styles.modalButtonText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );

  if (!generatedImage || !image) {
    return (
      <View style={[styles.container, { backgroundColor: '#f5f5f5' }]}>
        <Text style={styles.errorText}>Images not available.</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>

      {/* 🔙 BACK BUTTON */}
      <View style={styles.backButtonContainer}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backArrow}
          hitSlop={10}
        >
          <Ionicons name="chevron-back" size={28} color={COLORS.textPrimary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, alignItems: 'center' }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Your Design</Text>

        {/* Image Compare */}
        <View style={{ width: screenWidth, height: imageHeight, marginVertical: 16 }}>
          <Image
            source={{ uri: image }}
            style={{ width: '100%', height: '100%', borderRadius: 12 }}
            resizeMode="cover"
          />

          <View
            style={{
              width: `${sliderValue * 100}%`,
              overflow: 'hidden',
              position: 'absolute',
              top: 0,
              left: 0,
              height: '100%',
              borderRadius: 12,
            }}
          >
            <Image
              source={{ uri: generatedImage }}
              style={{ width: '100%', height: '100%' }}
              resizeMode="cover"
            />
          </View>
        </View>

        {/* Slider */}
        <View style={styles.sliderContainer}>
          <Slider
            minimumValue={0}
            maximumValue={1}
            value={sliderValue}
            onValueChange={setSliderValue}
            minimumTrackTintColor={COLORS.primaryDark}
            maximumTrackTintColor="#d0d0d0"
            thumbTintColor={COLORS.primaryDark}
            style={styles.slider}
          />
          <Text style={styles.sliderLabel}>Slide to compare before & after</Text>
        </View>

        {/* Details */}
        <View style={styles.detailsContainer}>
          <View style={styles.bookDetails}>

            {/* CASE 1 — Prompt-based design */}
            {customPrompt ? (
              <>
                <Text style={styles.caption}>
                  {customPrompt}
                </Text>

                {createdAt && (
                  <Text style={styles.date}>
                    Created on {formatPublishDate(createdAt)}
                  </Text>
                )}
              </>
            ) : (
              <>
                {/* CASE 2 — RoomType / Style / ColorTone based design */}
                {roomType && (
                  <Text style={styles.bookTitle}>
                    <Text style={styles.label}>Room Type: </Text>{roomType}
                  </Text>
                )}

                {designStyle && (
                  <Text style={styles.caption}>
                    <Text style={styles.label}>Design Style: </Text>{designStyle}
                  </Text>
                )}

                {colorTone && (
                  <Text style={styles.caption}>
                    <Text style={styles.label}>Color Tone: </Text>{colorTone}
                  </Text>
                )}

                {createdAt && (
                  <Text style={styles.date}>
                    Created on {formatPublishDate(createdAt)}
                  </Text>
                )}
              </>
            )}

          </View>
        </View>

        {/* Buttons */}
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.button} onPress={handleDownload}>
            <Ionicons name="download-outline" size={20} color="#fff" />
            <Text style={styles.buttonText}>Download</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.button} onPress={handleShare}>
            <Ionicons name="share-social-outline" size={20} color="#fff" />
            <Text style={styles.buttonText}>Share</Text>
          </TouchableOpacity>
        </View>

        <FeedbackModal />
      </ScrollView>
    </View>
  );
}
