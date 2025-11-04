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
  TouchableWithoutFeedback,
  Dimensions
} from 'react-native';
import React, { useState, useEffect, useCallback } from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { RewardedAd, RewardedAdEventType, TestIds } from 'react-native-google-mobile-ads';

const { width, height } = Dimensions.get("window");

// Scaling functions
const scale = (size) => (width / 375) * size; // horizontal scaling (base: iPhone 8 width)
const verticalScale = (size) => (height / 667) * size; // vertical scaling (base: iPhone 8 height)
const moderateScale = (size, factor = 0.5) =>
  size + (scale(size) - size) * factor;

// const adUnitId = __DEV__ ? TestIds.REWARDED : 'ca-app-pub-4470538534931449/2411201644';
const adUnitId = 'ca-app-pub-4470538534931449/2411201644';
const rewardedAd = RewardedAd.createForAdRequest(adUnitId);

export default function Create() {
  const router = useRouter();
  const { token } = useAuthStore();

  const [prompt, setPrompt] = useState('');
  const [image, setImage] = useState(null);
  const [imageBase64, setImageBase64] = useState(null);
  const [loading, setLoading] = useState(false);
  const [roomType, setRoomType] = useState('Living Room');
  const [designStyle, setDesignStyle] = useState('Modern');
  const [colorTone, setColorTone] = useState('Neutral');
  const [freeDesignsUsed, setFreeDesignsUsed] = useState(0);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isPremium, setIsPremium] = useState(false);
  const [showImageSourceModal, setShowImageSourceModal] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalData, setModalData] = useState({ title: '', message: '' });
  const [isManualDisabled, setIsManualDisabled] = useState(false);
  const [coins, setCoins] = useState(0);
  const [adMessage, setAdMessage] = useState('');
  const [isAdLoaded, setIsAdLoaded] = useState(false);
  const [userInitiatedLoad, setUserInitiatedLoad] = useState(false);

  // Setup rewarded ad logic
  useEffect(() => {
    if (!RewardedAdEventType || typeof RewardedAdEventType !== 'object') {
      console.error('RewardedAdEventType is not defined properly');
      return;
    }

    const listeners = [];

    if (RewardedAdEventType.LOADED) {
      listeners.push(
        rewardedAd.addAdEventListener(RewardedAdEventType.LOADED, () => {
          setIsAdLoaded(true);
          if (userInitiatedLoad) {
            setAdMessage('Ad loaded. Playing now...');
            rewardedAd.show();
            setUserInitiatedLoad(false);
          }
        })
      );
    }

    if (RewardedAdEventType.EARNED_REWARD) {
      listeners.push(
        rewardedAd.addAdEventListener(RewardedAdEventType.EARNED_REWARD, async () => {
          try {
            const res = await fetch(`${process.env.EXPO_PUBLIC_SERVER_URI}/api/users/watch-ad`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            });
            const data = await res.json();
            if (data.success) {
              setCoins(Number(data.adCoins || coins + 1));
            } else {
              setCoins((prev) => prev + 1);
            }
          } catch (err) {
            console.error('reward error', err);
            setCoins((prev) => prev + 1);
          } finally {
            setAdMessage('');
          }
        })
      );
    }

    if (RewardedAdEventType.CLOSED) {
      listeners.push(
        rewardedAd.addAdEventListener(RewardedAdEventType.CLOSED, () => {
          setIsAdLoaded(false);
          rewardedAd.load();
        })
      );
    }

    return () => listeners.forEach((unsub) => unsub());
  }, [token, userInitiatedLoad]);

  const handleWatchAd = () => {
    setUserInitiatedLoad(true);
    setAdMessage('Loading ad...');
    rewardedAd.load();
  };

  // Fetch user status
  useEffect(() => {
    const fetchUserStatus = async () => {
      if (!token) return;

      try {
        const res = await fetch(`${process.env.EXPO_PUBLIC_SERVER_URI}/me`, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        if (!res.ok) {
          console.error('Failed to fetch user status:', res.status);
          return;
        }

        const data = await res.json();
        const { isSubscribed, freeDesignsUsed, isPremium, manualDisabled, adCoins } = data.user || {};

        setIsSubscribed(isSubscribed || false);
        setFreeDesignsUsed(freeDesignsUsed || 0);
        setIsPremium(isPremium || false);
        setIsManualDisabled(manualDisabled || false);
        setCoins(Number(adCoins || 0));
      } catch (err) {
        console.error('Failed to fetch user status:', err);
      }
    };

    fetchUserStatus();
  }, [token]);

  // Pick image
  const pickImage = async () => {
    try {
      if (Platform.OS !== 'web') {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          setModalData({
            title: 'Access Needed',
            message: 'We need permission to access your photos or camera. Please enable access in your device settings.',
          });
          setModalVisible(true);
          return;
        }
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.3,
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
      setModalData({
        title: 'Image Issue',
        message: 'Something went wrong while selecting your image. Please try again.',
      });
      setModalVisible(true);
    }
  };

  // Take photo
  const takePhoto = async () => {
    try {
      if (Platform.OS !== 'web') {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          setModalData({
            title: 'Access Needed',
            message: 'We need permission to access your camera. Please enable access in your device settings.',
          });
          setModalVisible(true);
          return;
        }
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.3,
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
      console.error('Error taking photo:', error);
      setModalData({
        title: 'Camera Error',
        message: 'There was a problem taking your photo. Please try again.',
      });
      setModalVisible(true);
    }
  };

  // Handle design generation
  const handleSubmit = async () => {
    if (!roomType || !designStyle || !colorTone || !image) {
      setModalData({
        title: 'Missing Information',
        message: 'Please upload a photo before continuing.',
      });
      setModalVisible(true);
      return;
    }

    // Block user if manualDisabled is true
    if (isManualDisabled) {
      setModalData({
        title: 'Access Denied',
        message:
          'Your account is blocked from generating designs. Please contact support if this is a mistake.',
      });
      setModalVisible(true);
      return;
    }

    // ✅ Access logic for non-premium / non-subscribed users
    if (!isSubscribed && !isPremium && freeDesignsUsed >= 2 && coins < 2) {
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

      const imageUri =
        data.generatedImageUrl || data.generatedImage || data.image || data.output || null;

      if (imageUri) {
        router.push({
          pathname: '/outputScreen',
          params: {
            generatedImage: imageUri, 
            image: image || null, 
            roomType,
            designStyle,
            colorTone,
            createdAt: new Date().toISOString(),
          },
        });
      } else {
        setModalData({
          title: 'Design Generation Failed',
          message:
            'There was a problem generating your design from the server. Please try again later.',
        });
        setModalVisible(true);
      }

      setPrompt('');
      setImage(null);
      setImageBase64(null);
      // setRoomType('Living Room');
      // setDesignStyle('Modern');
      // setColorTone('Neutral');
    } catch (error) {
      console.error('Error generating design:', error);
      setModalData({
        title: 'Design Generation Failed',
        message: 'There was a problem generating your design. Please try again later.',
      });
      setModalVisible(true);
    } finally {
      setLoading(false);
    }
  };


  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.container} style={styles.scrollViewStyle}>
        <View>
          <View style={styles.header}>
            <Text style={styles.title}>LIVINAI</Text>

            {/* Coins Balance */}
            {/* {!isSubscribed && !isPremium && freeDesignsUsed >= 2 && (
              <View style={styles.coinsContainer}>
                <Text style={styles.coinsText}>{coins} Coins</Text>
              </View>
            )} */}
          </View>

          <View style={styles.form}>
            <View style={styles.formGroup}>
              <View style={styles.labelRow}>
                <Text style={styles.label}>Add photo</Text>

                {/* Small watch ad button for non-premium users */}
                {!isSubscribed && !isPremium && (
                  <TouchableOpacity
                    onPress={handleWatchAd}
                    activeOpacity={0.8}
                    style={styles.watchAdButton}
                  >
                    <Ionicons name="play-circle-outline" size={14} color="#fff" />
                    <Text style={styles.watchAdText}>Watch Ad</Text>
                  </TouchableOpacity>
                )}
              </View>
              <TouchableOpacity
                style={[styles.imagePickerModern, image && styles.imagePickerSelected]}
                onPress={() => setShowImageSourceModal(true)}
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
                    <Ionicons name="cloud-upload-outline" size={moderateScale(38)} color={COLORS.textSecondary} />
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
            
            {/* Custom Prompt (Optional) */}
            {/* <View style={styles.formGroup}>
              <Text style={styles.label}>
                Add a Personal Touch <Text style={{ color: COLORS.textSecondary, fontWeight: '400' }}>(optional)</Text>
              </Text>

              <View style={styles.promptCard}>
                <TextInput
                  style={styles.promptInput}
                  placeholder="Add any ideas or elements you’d like in your space..."
                  placeholderTextColor={COLORS.textSecondary}
                  value={prompt}
                  onChangeText={setPrompt}
                  multiline
                  textAlignVertical="top"
                  returnKeyType="done"
                />
              </View>
            </View> */}

            {/* Submit Button */}
            <TouchableOpacity style={styles.buttonWrapper} onPress={handleSubmit} disabled={loading}>
              {loading ? (
                <LinearGradient
                  colors={[COLORS.primary, COLORS.primary]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.buttonGradient}
                >
                  <ActivityIndicator color={COLORS.white} />
                </LinearGradient>
              ) : (
                <LinearGradient
                  colors={[COLORS.primaryDark, COLORS.primary]}
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

      {/* Image Source Picker Modal */}
      <Modal
        visible={showImageSourceModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowImageSourceModal(false)}
      >
        <TouchableWithoutFeedback onPress={() => setShowImageSourceModal(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.modalContainer}>
                <Text style={styles.modalTitle}>Upload Photo</Text>
                <Text style={styles.modalSubtitle}>Choose an option</Text>

                <TouchableOpacity
                  style={styles.modalButton}
                  onPress={() => {
                    setShowImageSourceModal(false);
                    takePhoto();
                  }}
                >
                  <Ionicons name="camera-outline" size={20} color={COLORS.white} style={styles.modalIcon} />
                  <Text style={styles.modalButtonText}>Take Photo</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.modalButton}
                  onPress={() => {
                    setShowImageSourceModal(false);
                    pickImage();
                  }}
                >
                  <Ionicons name="images-outline" size={20} color={COLORS.white} style={styles.modalIcon} />
                  <Text style={styles.modalButtonText}>Choose from Gallery</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.modalButton, styles.modalCancelButton]}
                  onPress={() => setShowImageSourceModal(false)}
                >
                  <Text style={[styles.modalButtonText, { color: COLORS.textSecondary }]}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

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

      {/* Info / Error Modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setModalVisible(false)}>
          <View style={styles.modalMissingOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.modalMissingContainer}>
                <Text style={styles.modalTitle}>{modalData.title}</Text>
                <Text style={styles.modalSubtitle}>{modalData.message}</Text>

                <TouchableOpacity
                  style={[styles.modalMissingButton, styles.modalConfirmButton]}
                  onPress={() => setModalVisible(false)}
                >
                  <Text style={styles.modalButtonText}>OK</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </KeyboardAvoidingView>
  );
}
