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
  Dimensions,
  Animated, 
  Easing
} from 'react-native';
import React, { useState, useEffect, useCallback, useRef } from 'react';
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
import GeneratingOverlay from '../../components/create/GeneratingOverlay';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { apiUrl } from '../../configs/api';
import { FREE_DESIGNS, coinCost } from '../../constants/pricing';
import useCreateFlowExit from '../../lib/useCreateFlowExit';
import useRewardedCoins from '../../lib/useRewardedCoins';

import { paletteForRequest } from '../../lib/colorPalettes';

/** What one render on this path costs, from the one table that decides. */
const PRICE = coinCost('design');

const INTERIOR_EXCLUDED_ROOM_TYPES = ['Full Apartment'];

const { width, height } = Dimensions.get("window");

// Scaling functions
const scale = (size) => (width / 375) * size; // horizontal scaling (base: iPhone 8 width)
const verticalScale = (size) => (height / 667) * size; // vertical scaling (base: iPhone 8 height)
const moderateScale = (size, factor = 0.5) =>
  size + (scale(size) - size) * factor;


export default function Interior() {
  const router = useRouter();
  // Back means "return to Create", in one press, however many copies of this
  // screen the hub happened to push. See lib/useCreateFlowExit.js.
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
  const [roomType, setRoomType] = useState('Living Room');
  const [designStyle, setDesignStyle] = useState('Modern');
  const [colorTone, setColorTone] = useState('Neutral');
  const [selectedColorPalette, setSelectedColorPalette] = useState(null);
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
  const [useCustomPrompt, setUseCustomPrompt] = useState(false);

  const animatedHeight = useRef(new Animated.Value(0)).current;

  const toggleCustomPrompt = () => {
    const toValue = useCustomPrompt ? 0 : 1;

    setUseCustomPrompt(!useCustomPrompt);

    Animated.timing(animatedHeight, {
      toValue,
      duration: 280,
      easing: Easing.out(Easing.ease),
      useNativeDriver: false,
    }).start();
  };

  
  
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
        // Preserve the source pixels Gen_klein.py would read from disk. Asking
        // Expo for base64 made it recompress the selected photo before the
        // model ever saw it.
        quality: 1,
        base64: Platform.OS === 'web',
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
        quality: 1,
        base64: Platform.OS === 'web',
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
        // The whole 60/30/10 scheme, not just the 60. The tone alone left the
        // secondary and the accent for the model to invent, so the same choice
        // produced a different room every run and the swatch the user tapped
        // described only part of the result. These are the three colours the
        // selector actually shows them.
        colorPalette: paletteForRequest(colorTone, selectedColorPalette),
        customPrompt: prompt,
        // Gen-Klein fields. `preserveGeometry` is what keeps the model from
        // moving walls, windows and the camera; the rest feed the 60/30/10
        // colour and hero-material clauses in the shared prompt engine.
        mode: "interior",
        material: "Natural oak",
        lighting: "Natural daylight",
        preserveGeometry: true,
        creativity: 42,
        // No `variation` is sent, which is what makes the same photo and the
        // same choices come back as the same design every time.
        //
        // This used to send `Date.now()`, on the reasoning that pressing
        // generate again should give something new. That was wrong twice over.
        // There is no regenerate button — a second attempt means changing the
        // style and generating again, which already changes the brief and so
        // the seed — and turning every render into a re-roll meant a design
        // could never be reproduced or compared against another build.
        //
        // The seed is hashed from the brief itself, so two different rooms
        // still cannot land on the same arrangement. The field stays supported
        // end to end for a "try another" control, which would pass an
        // incrementing number here.
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
            customPrompt: prompt.trim(),
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

      // The brief stays exactly as it was.
      //
      // Generating used to clear the photo, the note and nothing else — so
      // coming back from the result to try the same room in a different style
      // meant finding and re-uploading the photo you had just used, while the
      // room type and style you did *not* want to keep were still sitting there.
      // Trying a second variation is the normal next thing to do, and it now
      // costs one tap on the style you want. The screen is reset by leaving it,
      // which is what "start a new design" already means.
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
            <RoomTypeSelector
              roomType={roomType}
              setRoomType={setRoomType}
              excludeRoomTypes={INTERIOR_EXCLUDED_ROOM_TYPES}
              onInputFocus={revealFocusedInput}
            />

            {/* Design Style */}
            <DesignStyleSelector
              designStyle={designStyle}
              setDesignStyle={setDesignStyle}
              onInputFocus={revealFocusedInput}
            />

            {/* Color Tone */}
            <ColorToneSelector
              colorTone={colorTone}
              setColorTone={setColorTone}
              onPaletteChange={setSelectedColorPalette}
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
           {/* OR Separator */}
            {/* <View style={styles.orSeparatorContainer}>
              <View style={styles.orLine} />
              <Text style={styles.orText}>OR</Text>
              <View style={styles.orLine} />
            </View> */}

            {/* Toggle Card */}
            {/* <TouchableOpacity
              activeOpacity={0.9}
              onPress={toggleCustomPrompt}
              style={[
                styles.customToggleCard,
                useCustomPrompt && styles.customToggleCardActive
              ]}
            >
              <Ionicons
                name={useCustomPrompt ? "checkbox-outline" : "square-outline"}
                size={22}
                color={useCustomPrompt ? COLORS.primaryDark : COLORS.textSecondary}
                style={{ marginRight: 14 }}
              />

              <View style={{ flex: 1 }}>
                <Text style={styles.customToggleTitle}>Write My Own Vision</Text>
                <Text style={styles.customToggleSubtitle}>
                  Describe the design exactly how you imagine it
                </Text>
              </View>
            </TouchableOpacity> */}

            {/* Smooth Expandable Area */}
            {/* <Animated.View
              style={[
                styles.customAnimatedWrapper,
                {
                  height: animatedHeight.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 240], // height of expanded area
                  }),
                  opacity: animatedHeight,
                  marginTop: animatedHeight.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 12],
                  }),
                },
              ]}
            >
              {useCustomPrompt && (
                <View style={styles.customPromptWrapper}>
                  <Text style={styles.customPromptLabel}>Your Vision</Text>

                  <TextInput
                    style={styles.customPromptInput}
                    placeholder="Example: modern living room, interior design, warm soft ambient lighting, vanilla latte palette, professional interior designer style, photorealistic 8k, high detail, natural shadows, includes sofa set, coffee table, area rug, wall art, TV cabinet, plants, bookshelf, accent lighting, cohesive furniture arrangement matching room layout"
                    placeholderTextColor={COLORS.textSecondary}
                    value={prompt}
                    onChangeText={setPrompt}
                    multiline
                    textAlignVertical="top"
                  />
                </View>
              )}
            </Animated.View> */}

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

      {/* The wait. See components/create/GeneratingOverlay.jsx — a spinner
          over "up to 30 seconds" said nothing and promised a time this path
          regularly overruns. */}
      <GeneratingOverlay
        visible={loading}
        mode="interior"
        title="Designing your space"
        previewUri={image}
      />

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
