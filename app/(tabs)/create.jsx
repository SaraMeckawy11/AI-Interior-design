import {
  View,
  Text,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  Image,
  ActivityIndicator,
  Modal,
} from 'react-native';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'expo-router';
import styles from '../../assets/styles/create/create.styles';
import { Ionicons } from '@expo/vector-icons';
import COLORS from '../../constants/colors';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { useAuthStore } from '../../authStore';
import { LinearGradient } from 'expo-linear-gradient';
import RoomTypeSelector from '../../components/create/RoomTypeSelector';
import DesignStyleSelector from '../../components/create/DesignStyleSelector';
import ColorToneSelector from '../../components/create/ColorToneSelector';

export default function Create() {
  const [prompt, setPrompt] = useState('');
  const [image, setImage] = useState(null);
  const [imageBase64, setImageBase64] = useState(null);
  const [loading, setLoading] = useState(false);

  const [roomType, setRoomType] = useState('Living Room');
  const [designStyle, setDesignStyle] = useState('Modern');
  const [colorTone, setColorTone] = useState('Neutral');
  const [generatedImage, setGeneratedImage] = useState(null);
  const [freeDesignsUsed, setFreeDesignsUsed] = useState(0);
  const [isSubscribed, setIsSubscribed] = useState(false);

  const router = useRouter();
  const { token } = useAuthStore();

  useEffect(() => {
    const fetchUserStatus = async () => {
      try {
        const res = await fetch(`${process.env.EXPO_PUBLIC_SERVER_URI}/me`, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        if (res.ok) {
          const data = await res.json();
          setIsSubscribed(data.user?.isSubscribed || false);
          setFreeDesignsUsed(data.user?.freeDesignsUsed || 0);
        }
      } catch (err) {
        console.error('Failed to fetch user status:', err);
      }
    };

    if (token) fetchUserStatus();
  }, [token]);

  const pickImage = async () => {
    try {
      if (Platform.OS !== 'web') {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Denied', 'We need camera roll permissions to upload an image');
          return;
        }
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
        base64: true,
      });

      if (!result.canceled) {
        setImage(result.assets[0].uri);

        if (result.assets[0].base64) {
          setImageBase64(result.assets[0].base64);
        } else {
          const base64 = await FileSystem.readAsStringAsync(result.assets[0].uri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          setImageBase64(base64);
        }
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Error', 'There was a problem selecting your image');
    }
  };

  const handleSubmit = async () => {
    if (!roomType || !designStyle || !colorTone) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    if (!isSubscribed && freeDesignsUsed >= 2) {
      router.push('/upgrade');
      return;
    }

    try {
      setLoading(true);

      let imageDataUrl = null;
      if (image && imageBase64) {
        const uriParts = image.split('.');
        const fileType = uriParts[uriParts.length - 1];
        const imageType = fileType ? `image/${fileType.toLowerCase()}` : 'image/jpeg';
        imageDataUrl = `data:${imageType};base64,${imageBase64}`;
      }

      const requestBody = {
        roomType,
        designStyle,
        colorTone,
        customPrompt: prompt,
      };

      if (imageDataUrl) {
        requestBody.image = imageDataUrl;
      }

      const response = await fetch(`${process.env.EXPO_PUBLIC_SERVER_URI}/api/designs`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();
      console.log('Generated design response:', data);

      if (!response.ok) throw new Error(data.message || 'Something went wrong');

      const imageUri = data.generatedImageUrl || data.generatedImage || data.image || data.output || null;
      if (imageUri) {
        router.push({
          pathname: '/outputScreen',
          params: { imageUri },
        });
      } else {
        Alert.alert('Error', 'No image URL received from the server.');
      }

      setPrompt('');
      setImage(null);
      setImageBase64(null);
      // setRoomType('Living Room');
      // setDesignStyle('Modern');
      // setColorTone('Neutral');
    } catch (error) {
      console.error('Error generating design:', error);
      Alert.alert('Error', error.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.container} style={styles.scrollViewStyle}>
        <View>
          <View style={styles.header}>
            <Text style={styles.title}>Roomify</Text>
          </View>

          <View style={styles.form}>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Add photo</Text>
              <TouchableOpacity
                style={[styles.imagePickerModern, image && styles.imagePickerSelected]}
                onPress={pickImage}
                activeOpacity={0.9}
              >
                {image ? (
                  <>
                    <Image source={{ uri: image }} style={styles.previewImageModern} />
                    <TouchableOpacity
                      style={styles.removeButtonModern}
                      onPress={() => setImage(null)}
                      hitSlop={10}
                    >
                      <Ionicons name="close-circle" size={28} color={COLORS.error} />
                    </TouchableOpacity>
                  </>
                ) : (
                  <View style={styles.placeholderContainerModern}>
                    <Ionicons name="cloud-upload-outline" size={42} color={COLORS.textSecondary} />
                    <Text style={styles.placeholderTextModern}>Tap to upload an image</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>

            {/* Room Type */}
            <RoomTypeSelector roomType={roomType} setRoomType={setRoomType} />

            {/* Design Style */}
            <DesignStyleSelector designStyle={designStyle} setDesignStyle={setDesignStyle} />

            {/* Color Tone */}
            <ColorToneSelector colorTone={colorTone} setColorTone={setColorTone} />

            {/* Custom Prompt */}
            {/* <View style={styles.textGroup}>
              <Text style={styles.label}>Custom Prompt</Text>
              <TextInput
                style={styles.textArea}
                placeholder="Write your design preferences..."
                placeholderTextColor={COLORS.placeholderText}
                value={prompt}
                onChangeText={setPrompt}
                multiline
              />
            </View> */}

            {/* Submit Button */}
            <TouchableOpacity style={styles.buttonWrapper} onPress={handleSubmit} disabled={loading}>
              {loading ? (
                <LinearGradient
                  colors={[COLORS.primary, COLORS.secondary]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.buttonGradient}
                >
                  <ActivityIndicator color={COLORS.white} />
                </LinearGradient>
              ) : (
                <LinearGradient
                  colors={[COLORS.primary, COLORS.secondary]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.buttonGradient}
                >
                  <Ionicons name="cloud-upload-outline" size={20} color={COLORS.white} style={styles.buttonIcon} />
                  <Text style={styles.buttonText}>Generate</Text>
                </LinearGradient>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* Fullscreen Loading Modal */}
      <Modal transparent animationType="fade" visible={loading}>
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.loadingText}>Designing your dream room...</Text>
            <Text style={styles.loadingSubtext}>This may take up to 30 seconds</Text>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}