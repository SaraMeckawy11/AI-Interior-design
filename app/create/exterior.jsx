import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Dimensions,
    Image,
    KeyboardAvoidingView,
    Modal,
    Platform,
    ScrollView,
    Text,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import styles from '../../assets/styles/create/create.styles';
import { useAuthStore } from '../../authStore';
import ColorToneSelector from '../../components/create/ColorToneSelector';
import DesignStyleSelector from '../../components/create/DesignStyleSelector';
import ExtTypeSelector from '../../components/create/extTypeSelector';
import COLORS from '../../constants/colors';
import { apiUrl } from '../../configs/api';
import { FREE_DESIGNS, coinCost } from '../../constants/pricing';
import useRewardedCoins from '../../lib/useRewardedCoins';

import { paletteForRequest } from '../../lib/colorPalettes';

/** What one render on this path costs, from the one table that decides. */
const PRICE = coinCost('design');

const { width, height } = Dimensions.get("window");

// Scaling functions
const scale = (size) => (width / 375) * size; // horizontal scaling (base: iPhone 8 width)
const verticalScale = (size) => (height / 667) * size; // vertical scaling (base: iPhone 8 height)
const moderateScale = (size, factor = 0.5) =>
  size + (scale(size) - size) * factor;


export default function Exterior() {
  const router = useRouter();
  const { token } = useAuthStore();

  const [prompt, setPrompt] = useState('');
  const [image, setImage] = useState(null);
  const [imageBase64, setImageBase64] = useState(null);
  const [loading, setLoading] = useState(false);
  const [roomType, setRoomType] = useState('Balcony');
  const [designStyle, setDesignStyle] = useState('Modern');
  const [colorTone, setColorTone] = useState('Neutral');
  const [freeDesignsUsed, setFreeDesignsUsed] = useState(0);
  const [isSubscribed, setIsSubscribed] = useState(null);
  const [isPremium, setIsPremium] = useState(null);
  const [showImageSourceModal, setShowImageSourceModal] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalData, setModalData] = useState({ title: '', message: '' });
  const [isManualDisabled, setIsManualDisabled] = useState(false);
  // One ad instance owned by this screen, one coin per ad, and the wiring in
  // one place instead of copied into five. See lib/useRewardedCoins.js.
  const { coins, setCoins, watchAd: handleWatchAd } = useRewardedCoins(token);
  
  
 // Fetch user status
   useFocusEffect(
     useCallback(() => {
       const fetchUserStatus = async () => {
         if (!token) return;
 
         try {
           const res = await fetch(apiUrl('/api/users/me'), {
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
 
       // Refresh user on screen focus
       fetchUserStatus();
     }, [setCoins, token])
   );

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
    if (!isSubscribed && !isPremium && freeDesignsUsed >= FREE_DESIGNS && coins < PRICE) {
      router.push('/profile/upgrade');
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
        colorPalette: paletteForRequest(colorTone),
        customPrompt: prompt,
        // Gen-Klein fields — see the matching block in interior.jsx.
        mode: "exterior",
        material: "Natural stone",
        lighting: "Natural daylight",
        preserveGeometry: true,
        creativity: 42,
      };

      if (imageDataUrl) {
        requestBody.image = imageDataUrl;
      }

      const response = await fetch(apiUrl('/api/designs'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();

      // Out of coins is not a server fault, and it has its own way out. This
      // used to fall through to the generic 'there was a problem generating
      // your design', so running out of credit was reported as a failure.
      if (response.status === 403) {
        if (typeof data.adCoins === 'number') setCoins(data.adCoins);
        router.push('/profile/upgrade');
        return;
      }
      if (!response.ok) throw new Error(data.message || 'Something went wrong');

      const imageUri =
        data.generatedImageUrl || data.generatedImage || data.image || data.output || null;

      if (imageUri) {
        // The balance and the free-design count as the server now has
        // them. Subtracting locally drifted from what was charged.
        if (typeof data.adCoins === 'number') setCoins(data.adCoins);
        if (typeof data.freeDesignsUsed === 'number') setFreeDesignsUsed(data.freeDesignsUsed);

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
        {/* 🔙 Floating Back Button */}
        <SafeAreaView style={styles.backButtonContainer}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backArrow} hitSlop={10}>
            <Ionicons name="chevron-back" size={26} color={COLORS.textPrimary} />
        </TouchableOpacity>
        </SafeAreaView>

      <ScrollView contentContainerStyle={styles.container} style={styles.scrollViewStyle}>
        <View>
          <View style={styles.titleHeader}>
            <Text style={styles.title}>LIVINAI</Text>

            {!isSubscribed && !isPremium && freeDesignsUsed >= FREE_DESIGNS && (
              <View style={styles.coinsContainer}>
                <Text style={styles.coinsText}>{coins} Coins</Text>
              </View>
            )}
          </View>

          <View style={styles.form}>
            <View style={styles.formGroup}>
              <View style={styles.labelRow}>
                <Text style={styles.label}>Add photo</Text>

                {/* Small watch ad button for non-premium users */}
                {!isSubscribed && (
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
                style={[
                  styles.imagePickerPlan,
                  !image && styles.imagePickerEmpty,
                  image && styles.imagePickerSelected,
                ]}
                onPress={() => setShowImageSourceModal(true)}
                activeOpacity={0.9}
              >
                {image ? (
                  <>
                    <Image source={{ uri: image }} style={[styles.previewImageModern, styles.previewImagePlan]} />
                    <TouchableOpacity
                      style={styles.removeButtonModern}
                      onPress={() => setImage(null)}
                      hitSlop={10}
                    >
                      <Ionicons name="close-circle" size={28} color={COLORS.error} />
                    </TouchableOpacity>
                  </>
                ) : (
                  <View style={styles.placeholderContainerPlan}>
                    <View style={styles.uploadIconBadge}>
                      <Ionicons name="cloud-upload-outline" size={moderateScale(28)} color={COLORS.primaryDark} />
                    </View>
                    <Text style={styles.uploadTitle}>Upload your photo</Text>
                    <Text style={styles.uploadCaption}>JPG or PNG · camera or gallery</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>

            {/* Room Type */}
            <ExtTypeSelector roomType={roomType} setRoomType={setRoomType} />

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
                  colors={[COLORS.disabled, COLORS.disabled]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.buttonGradient}
                >
                  <ActivityIndicator color={COLORS.white} />
                </LinearGradient>
              ) : (
                <LinearGradient
                  colors={COLORS.gradientBrand}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.buttonGradient}
                >
                  <Ionicons name="cloud-upload-outline" size={20} color={COLORS.white} style={styles.buttonIcon} />
                  <Text style={styles.buttonText}>Generate</Text>
                </LinearGradient>
              )}
            </TouchableOpacity>

            {/* Banner ad for non-subscribed users */}
            {/* {!isSubscribed  && (
              <CreateBannerAd />
            )} */}

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
        <View style={styles.modalOverlay}>
          <TouchableWithoutFeedback onPress={() => setShowImageSourceModal(false)}>
            <View style={styles.modalBackdrop} />
          </TouchableWithoutFeedback>
          <SafeAreaView edges={['bottom']} style={styles.modalSheetSafe}>
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
          </SafeAreaView>
        </View>
      </Modal>

      {/* Fullscreen Loading Modal */}
      <Modal transparent animationType="fade" visible={loading}>
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={COLORS.primaryDark} />
            <Text style={styles.loadingText}>Designing your dream space...</Text>
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
