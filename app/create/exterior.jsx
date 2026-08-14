import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import styles from '../../assets/styles/create/create.styles';
import { useAuthStore } from '../../authStore';
import ColorToneSelector from '../../components/create/ColorToneSelector';
import DesignStyleSelector from '../../components/create/DesignStyleSelector';
import ExtTypeSelector from '../../components/create/extTypeSelector';
import COLORS from '../../constants/colors';
import { apiUrl } from '../../configs/api';
import { FREE_DESIGNS, coinCost } from '../../constants/pricing';
import useCreateFlowExit from '../../lib/useCreateFlowExit';
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
  // Back means "return to Create", in one press. See lib/useCreateFlowExit.js.
  const exitToCreate = useCreateFlowExit();
  // The header is a real bar, not a floating arrow, so it owns the top inset
  // itself. See createHeader in assets/styles/create/create.styles.js.
  const insets = useSafeAreaInsets();
  const scrollRef = useRef(null);
  const revealFocusedInput = useCallback((nodeHandle) => {
    setTimeout(() => {
      scrollRef.current?.scrollResponderScrollNativeHandleToKeyboard(
        nodeHandle,
        moderateScale(24),
        true,
      );
    }, 250);
  }, []);
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
  const { coins, setCoins, watchAd: handleWatchAd } = useRewardedCoins(token, {
    // Both are null until the account answers, so this stays false until we
    // know, and no ad is requested for someone who turns out to be subscribed.
    enabled: isSubscribed === false && isPremium === false,
  });
  
  
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
        // Exterior asks for one facade color, so do not silently invent the
        // interior selector's secondary and accent colors.
        // The whole 60/30/10 scheme with its hexes, the same as Interior sends.
        // The three colours the swatches show are the three the facade gets.
        colorPalette: paletteForRequest(colorTone),
        customPrompt: prompt,
        // Gen-Klein fields — see the matching block in interior.jsx.
        mode: "exterior",
        material: "Natural stone",
        lighting: "Natural daylight",
        preserveGeometry: true,
        // Buildings use the model's most conservative setting because their
        // facade grid and massing must remain identical to the source photo.
        creativity: roomType === "Building" ? 10 : 42,
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
      // A fair-use stop: one render at a time, and a ceiling on the day. Not a
      // paywall and not a failure — the account is already paid, so it gets the
      // reason and stays where it is rather than being sent to buy what it has.
      if (response.status === 429) {
        setModalData({
          title: data.limitKind === 'busy' ? 'One at a time' : "That's today's limit",
          message:
            data.reason || data.message || "You have reached today's fair-use limit on renders.",
        });
        setModalVisible(true);
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
            'There was a problem generating your design from the server. You have not been charged for it — please try again.',
        });
        setModalVisible(true);
      }

      // The brief stays exactly as it was — see the matching note in interior.jsx.
      // Generating cleared the photo and the note but kept the space type, the
      // style and the colour, which is the wrong half: the photo is the
      // expensive input and the style is the one you came back to change.
    } catch (error) {
      console.error('Error generating design:', error);
      setModalData({
        title: 'Design Generation Failed',
        message:
          'There was a problem generating your design. You have not been charged for it — please try again.',
      });
      setModalVisible(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      {/* Navigation bar: back, brand, balance — clear of the camera cutout. */}
      <View style={[styles.createHeader, { paddingTop: insets.top }]}>
        <View style={styles.createHeaderBar}>
          <View pointerEvents="none" style={styles.createHeaderTitleWrap}>
            <Text style={[styles.title, styles.createHeaderTitle]} numberOfLines={1}>LIVINAI</Text>
          </View>

          <TouchableOpacity
            onPress={exitToCreate}
            style={styles.createHeaderButton}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Back to Create"
          >
            <Ionicons name="chevron-back" size={26} color={COLORS.textPrimary} />
          </TouchableOpacity>

          <View style={styles.createHeaderSpacer} />

          {!isSubscribed && !isPremium && freeDesignsUsed >= FREE_DESIGNS && (
            <View style={styles.createHeaderCoins}>
              <Text style={styles.createHeaderCoinsText}>{coins} Coins</Text>
            </View>
          )}
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.container}
        style={styles.scrollViewStyle}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
        <View>
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
            <ExtTypeSelector
              roomType={roomType}
              setRoomType={setRoomType}
              onInputFocus={revealFocusedInput}
            />

            {/* Design Style */}
            <DesignStyleSelector
              designStyle={designStyle}
              setDesignStyle={setDesignStyle}
              onInputFocus={revealFocusedInput}
            />

            {/* Color Tone.
                Three colours here, exactly as Interior asks for them. Cutting
                the exterior back to a single facade colour left the model to
                invent whatever went on the trim, the frames and the front door
                — which is most of what anyone actually looks at on a house —
                and the swatches on this screen then described a fraction of the
                result. A facade is a 60/30/10 scheme like any other: a body, a
                secondary for base and trim, and one accent. */}
            <ColorToneSelector
              colorTone={colorTone}
              setColorTone={setColorTone}
            />
            
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
