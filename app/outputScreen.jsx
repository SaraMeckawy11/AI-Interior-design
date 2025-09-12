import React from 'react';
import { View, Text, Image, TouchableOpacity, Alert, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { useLocalSearchParams } from 'expo-router';
import styles from '../assets/styles/output.styles';
import { Ionicons } from '@expo/vector-icons';
import { Share } from 'expo-sharing' ;
import * as Sharing from 'expo-sharing';
import { useEffect, useState } from 'react'; 
import { Dimensions } from 'react-native';
import { Modal, TouchableWithoutFeedback } from 'react-native';

  export default function OutputScreen() {
  const { imageUri } = useLocalSearchParams();
  const [imageHeight, setImageHeight] = useState(240);
  const [modalVisible, setModalVisible] = useState(false);
const [modalMessage, setModalMessage] = useState("");


  useEffect(() => {
    if (imageUri) {
      Image.getSize(imageUri, (width, height) => {
        const screenWidth = Dimensions.get('window').width - 32; // match padding
        const ratio = height / width;
        setImageHeight(screenWidth * ratio);
      }, (error) => {
        console.error("Failed to get image size", error);
      });
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
      // if (!isAvailable) {
      //   Alert.alert('Not available', 'Sharing is not available on this device.');
      //   return;
      // }
      if (!isAvailable) {
        setModalMessage("Sharing is not available on this device.");
        setModalVisible(true);
        return;
      }

      await Sharing.shareAsync(downloadRes.uri);
      } catch (error) {
        // console.log('Sharing error:', error);
        // Alert.alert('Error', 'Failed to share image.');
        setModalMessage("Failed to share image.");
        setModalVisible(true);
      }
    };


  const handleDownload = async () => {
    try {
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (!permission.granted) {
        // Alert.alert('Permission denied', 'Cannot save image without permission.');
        setModalMessage("Cannot save image without permission.");
        setModalVisible(true);
        return;
      }

      const fileUri = FileSystem.documentDirectory + 'generated-image.jpg';
      const downloadRes = await FileSystem.downloadAsync(imageUri, fileUri);
      await MediaLibrary.saveToLibraryAsync(downloadRes.uri);
      //Alert.alert('Downloaded', 'Image saved to your gallery.');
      setModalMessage("Image saved to your gallery.");
      setModalVisible(true);
    } catch (error) {
      //Alert.alert('Error', 'Failed to download image.');
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
      <View style={styles.container}>
        <Text style={styles.title}>Your Design</Text>
        {/* <Image source={{ uri: imageUri }} style={styles.image} /> */}
        <View style={[styles.imageContainer, { height: imageHeight }]}>
          <Image
            source={{ uri: imageUri }}
            style={styles.image}
            resizeMode="contain"
          />
        </View>
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
      </View>
    );
}