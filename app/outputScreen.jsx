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
import { useLocalSearchParams } from 'expo-router';
import styles from '../assets/styles/output.styles';
import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import { formatPublishDate } from '../lib/utils';

export default function OutputScreen() {
  const { imageUri, roomType, designStyle, colorTone, createdAt } = useLocalSearchParams();
  const [imageHeight, setImageHeight] = useState(240);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalMessage, setModalMessage] = useState('');

  useEffect(() => {
    if (imageUri) {
      Image.getSize(
        imageUri,
        (width, height) => {
          const screenWidth = Dimensions.get('window').width - 32; // match padding
          const ratio = height / width;
          setImageHeight(screenWidth * ratio);
        },
        (error) => {
          console.error("Failed to get image size", error);
        }
      );
    }
  }, [imageUri]);

  if (!imageUri) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>No image URI provided.</Text>
      </View>
    );
  }

  const handleShare = async () => {
    try {
      const fileUri = FileSystem.documentDirectory + 'temp-share.jpg';
      const downloadRes = await FileSystem.downloadAsync(imageUri, fileUri);

      const isAvailable = await Sharing.isAvailableAsync();
      if (!isAvailable) {
        setModalMessage("Sharing is not available on this device.");
        setModalVisible(true);
        return;
      }

      await Sharing.shareAsync(downloadRes.uri);
    } catch (error) {
      setModalMessage("Failed to share image.");
      setModalVisible(true);
    }
  };

  const handleDownload = async () => {
    try {
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (!permission.granted) {
        setModalMessage("Cannot save image without permission.");
        setModalVisible(true);
        return;
      }

      const fileUri = FileSystem.documentDirectory + 'generated-image.jpg';
      const downloadRes = await FileSystem.downloadAsync(imageUri, fileUri);
      await MediaLibrary.saveToLibraryAsync(downloadRes.uri);
      setModalMessage("Image saved to your gallery.");
      setModalVisible(true);
    } catch (error) {
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

  return (
    <ScrollView
      style={{ flex: 1 }} // full screen
      contentContainerStyle={{
        padding: 16,
        alignItems: 'center', // center content horizontally
      }}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.title}>Your Design</Text>

      <View style={[styles.imageContainer, { height: imageHeight }]}>
        <Image
          source={{ uri: imageUri }}
          style={styles.image}
          resizeMode="contain"
        />
      </View>

      {/* Item Details Section */}
      <View style={styles.detailsContainer}>
        <View style={styles.bookDetails}>
          {roomType && (
            <Text style={styles.bookTitle}>
              <Text style={styles.label}>Room Type: </Text>
              {roomType}
            </Text>
          )}
          {designStyle && (
            <Text style={styles.caption}>
              <Text style={styles.label}>Design Style: </Text>
              {designStyle}
            </Text>
          )}
          {colorTone && (
            <Text style={styles.caption}>
              <Text style={styles.label}>Color Tone: </Text>
              {colorTone}
            </Text>
          )}
          {createdAt && (
            <Text style={styles.date}>
              Created on {formatPublishDate(createdAt)}
            </Text>
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
  );
}
