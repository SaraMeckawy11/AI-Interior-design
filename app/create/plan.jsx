import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Dimensions,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import {
  RewardedAd,
  RewardedAdEventType,
} from "react-native-google-mobile-ads";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Path, Circle } from "react-native-svg";
import styles from "../../assets/styles/create/plan.styles";
import { useAuthStore } from "../../authStore";
import COLORS from "../../constants/colors";

const { width, height } = Dimensions.get("window");
const scale = (size) => (width / 375) * size;
const verticalScale = (size) => (height / 667) * size;
const moderateScale = (size, factor = 0.5) =>
  size + (scale(size) - size) * factor;

const adUnitId = "ca-app-pub-4470538534931449/2411201644";
const rewardedAd = RewardedAd.createForAdRequest(adUnitId);

// ---------------------------------------------------------------------------
// CONSTANTS
// ---------------------------------------------------------------------------
const ROOM_TYPES = [
  { key: "Living Room", icon: "tv-outline" },
  { key: "Bedroom", icon: "bed-outline" },
  { key: "Kitchen", icon: "restaurant-outline" },
  { key: "Bathroom", icon: "water-outline" },
  { key: "Dining Room", icon: "cafe-outline" },
  { key: "Office", icon: "desktop-outline" },
  { key: "Kids Room", icon: "happy-outline" },
  { key: "Studio", icon: "easel-outline" },
  { key: "Full Apartment", icon: "home-outline" },
];

const GUIDED_ROOM_TYPES = [
  { key: "Living Room", icon: "tv-outline" },
  { key: "Bedroom", icon: "bed-outline" },
  { key: "Kitchen", icon: "restaurant-outline" },
  { key: "Bathroom", icon: "water-outline" },
  { key: "Dining Room", icon: "cafe-outline" },
  { key: "Office", icon: "desktop-outline" },
  { key: "Kids Room", icon: "happy-outline" },
  { key: "Hallway", icon: "walk-outline" },
  { key: "Closet", icon: "cube-outline" },
  { key: "Laundry Room", icon: "shirt-outline" },
  { key: "Entryway", icon: "log-in-outline" },
  { key: "Basement", icon: "download-outline" },
];

const DESIGN_STYLES = [
  "Modern",
  "Minimalist",
  "Scandinavian",
  "Industrial",
  "Bohemian",
  "Mid-Century",
  "Contemporary",
  "Rustic",
  "Traditional",
  "Art Deco",
  "Japanese",
  "Coastal",
];

const COLOR_TONES = [
  "Neutral",
  "Warm",
  "Cool",
  "Earthy",
  "Pastel",
  "Bold",
  "Monochrome",
  "Natural",
];

const OUTLINE_COLORS = [
  "#FF6B6B",
  "#4ECDC4",
  "#45B7D1",
  "#96CEB4",
  "#FFEAA7",
  "#DDA0DD",
  "#FF8C69",
  "#98D8C8",
  "#F7DC6F",
  "#BB8FCE",
  "#85C1E9",
  "#82E0AA",
];

const MAX_CANVAS_WIDTH = width - moderateScale(48);
const MAX_CANVAS_HEIGHT = height * 0.45;

// ---------------------------------------------------------------------------
// SMOOTH PATH FROM TOUCH POINTS
// ---------------------------------------------------------------------------
function buildPathFromVertices(
  vertices,
  segmentCurvatures,
  closed = false,
  previewPoint = null
) {
  if (!vertices || vertices.length === 0) return "";

  const CURVE_CONTROL_OFFSET_RATIO = 0.18; // how far the control point can go

  let d = `M ${vertices[0].x.toFixed(1)} ${vertices[0].y.toFixed(1)}`;

  // Completed segments (between vertices)
  for (let i = 0; i < vertices.length - 1; i++) {
    const prev = vertices[i];
    const curr = vertices[i + 1];
    const curvature = segmentCurvatures?.[i] ?? 0; // -1..1

    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;

    const mx = prev.x + dx / 2;
    const my = prev.y + dy / 2;

    // Perpendicular (normal) vector
    const nx = -dy / len;
    const ny = dx / len;

    const offset = curvature * len * CURVE_CONTROL_OFFSET_RATIO;
    const cx = mx + nx * offset;
    const cy = my + ny * offset;

    d += ` Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${curr.x.toFixed(
      1
    )} ${curr.y.toFixed(1)}`;
  }

  // Preview segment (straight by default)
  if (previewPoint) {
    const last = vertices[vertices.length - 1];
    const dx = previewPoint.x - last.x;
    const dy = previewPoint.y - last.y;
    const len = Math.hypot(dx, dy) || 1;

    const mx = last.x + dx / 2;
    const my = last.y + dy / 2;

    // curvature=0 => control point at midpoint
    const nx = -dy / len;
    const ny = dx / len;
    const offset = 0 * len * CURVE_CONTROL_OFFSET_RATIO;
    const cx = mx + nx * offset;
    const cy = my + ny * offset;

    d += ` Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${previewPoint.x.toFixed(
      1
    )} ${previewPoint.y.toFixed(1)}`;
  }

  if (closed) d += ` Z`;
  return d;
}

// ---------------------------------------------------------------------------
// COMPONENT
// ---------------------------------------------------------------------------
export default function PlanEditor() {
  const router = useRouter();
  const { token } = useAuthStore();

  // ── Mode ──
  const [mode, setMode] = useState("quick"); // 'quick' | 'guided'

  // ── Image ──
  const [image, setImage] = useState(null);
  const [imageBase64, setImageBase64] = useState(null);
  const [imageDims, setImageDims] = useState(null);

  // ── Quick mode selections ──
  const [roomType, setRoomType] = useState("Living Room");
  const [designStyle, setDesignStyle] = useState("Modern");
  const [colorTone, setColorTone] = useState("Neutral");

  // ── Guided mode drawing ──
  const [paths, setPaths] = useState([]);
  const [vertices, setVertices] = useState([]);
  const [segmentCurvatures, setSegmentCurvatures] = useState([]); // one per segment (between vertices)
  const [curveEditSegmentIndex, setCurveEditSegmentIndex] = useState(null);
  const [previewPoint, setPreviewPoint] = useState(null);

  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [showRoomAssign, setShowRoomAssign] = useState(false);
  const [assigningPathIndex, setAssigningPathIndex] = useState(null);
  const [customRoomInput, setCustomRoomInput] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);

  // ── UI ──
  const [loading, setLoading] = useState(false);
  const [showImageSourceModal, setShowImageSourceModal] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalData, setModalData] = useState({ title: "", message: "" });

  // ── Monetization ──
  const [freeDesignsUsed, setFreeDesignsUsed] = useState(0);
  const [isSubscribed, setIsSubscribed] = useState(null);
  const [isPremium, setIsPremium] = useState(null);
  const [isManualDisabled, setIsManualDisabled] = useState(false);
  const [coins, setCoins] = useState(0);
  const [userInitiatedLoad, setUserInitiatedLoad] = useState(false);

  const pathsRef = useRef([]);

  useEffect(() => {
    pathsRef.current = paths;
  }, [paths]);

  // ── Canvas display size ──
  const canvasSize = useMemo(() => {
    if (!imageDims)
      return { width: MAX_CANVAS_WIDTH, height: moderateScale(200) };
    const ratio = imageDims.width / imageDims.height;
    let w = MAX_CANVAS_WIDTH;
    let h = w / ratio;
    if (h > MAX_CANVAS_HEIGHT) {
      h = MAX_CANVAS_HEIGHT;
      w = h * ratio;
    }
    return { width: Math.round(w), height: Math.round(h) };
  }, [imageDims]);

  // ── Next outline color ──
  const nextColor = OUTLINE_COLORS[paths.length % OUTLINE_COLORS.length];

  // ═══════════════════════════════════════════════════════════════
  // DRAWING HANDLERS
  // ═══════════════════════════════════════════════════════════════
  const SNAP_RADIUS = 18; // tap the first vertex to close
  const VERTEX_TAP_RADIUS = 12;
  const SEGMENT_HANDLE_RADIUS = 22;

  const getCurvatureForSegment = (touchX, touchY, segIndex) => {
    const a = vertices[segIndex];
    const b = vertices[segIndex + 1];
    if (!a || !b) return 0;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;

    // Perpendicular (normal) vector
    const nx = -dy / len;
    const ny = dx / len;

    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;

    const signedDist = (touchX - mx) * nx + (touchY - my) * ny;

    // Map signed perpendicular distance into -1..1
    const curvature = signedDist / (len * 0.25);
    return Math.max(-1, Math.min(1, curvature));
  };

  const handleCanvasTap = (evt) => {
    const { locationX: x, locationY: y } = evt.nativeEvent;
    
    if (vertices.length > 2) {
      const first = vertices[0];
      const dist = Math.hypot(first.x - x, first.y - y);
      if (dist < SNAP_RADIUS) {
        closeShape();
        return;
      }
    }

    // When dragging a curve handle, avoid adding new points.
    if (curveEditSegmentIndex != null) return;

    // Enter curve-edit mode when user taps near a segment midpoint.
    if (vertices.length >= 2) {
      let nearestSegIndex = null;
      let nearestDist = Infinity;
      for (let i = 0; i < vertices.length - 1; i++) {
        const a = vertices[i];
        const b = vertices[i + 1];
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const dist = Math.hypot(mx - x, my - y);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestSegIndex = i;
        }
      }

      if (
        nearestSegIndex != null &&
        nearestDist < SEGMENT_HANDLE_RADIUS
      ) {
        const nearVertex = vertices.some(
          (v) => Math.hypot(v.x - x, v.y - y) < VERTEX_TAP_RADIUS
        );
        if (!nearVertex) {
          setCurveEditSegmentIndex(nearestSegIndex);
          setPreviewPoint(null);
          setScrollEnabled(false);
          return;
        }
      }
    }

    // Add new point
    if (vertices.length === 0) {
      setVertices([{ x, y }]);
    } else {
      setVertices((prev) => [...prev, { x, y }]);
      setSegmentCurvatures((prev) => [...prev, 0]); // new segment starts straight
    }

    setPreviewPoint(null);
    setScrollEnabled(false);
  };

  const handleCanvasMove = (evt) => {
    if (vertices.length === 0) return;
    const { locationX: x, locationY: y } = evt.nativeEvent;

    // Curve handle drag
    if (curveEditSegmentIndex != null) {
      const newCurvature = getCurvatureForSegment(x, y, curveEditSegmentIndex);
      setSegmentCurvatures((prev) =>
        prev.map((c, i) => (i === curveEditSegmentIndex ? newCurvature : c))
      );
      return;
    }

    setPreviewPoint({ x, y });
  };

  const handleCanvasRelease = () => {
    setCurveEditSegmentIndex(null);
    setPreviewPoint(null);
    setScrollEnabled(true);
  };

  const closeShape = () => {
    if (vertices.length < 3) return;
    
    const pathData = buildPathFromVertices(vertices, segmentCurvatures, true);
    const colorIdx = pathsRef.current.length % OUTLINE_COLORS.length;
    const newPath = {
      pathData,
      color: OUTLINE_COLORS[colorIdx],
      roomType: null,
    };
    
    setPaths((prev) => {
      const updated = [...prev, newPath];
      pathsRef.current = updated;
      return updated;
    });
    
    setVertices([]);
    setSegmentCurvatures([]);
    setCurveEditSegmentIndex(null);
    setPreviewPoint(null);
    setAssigningPathIndex(pathsRef.current.length);
    setShowRoomAssign(true);
  };

  // ═══════════════════════════════════════════════════════════════
  // AD SETUP
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!RewardedAdEventType || typeof RewardedAdEventType !== "object") return;
    const listeners = [];

    if (RewardedAdEventType.LOADED) {
      listeners.push(
        rewardedAd.addAdEventListener(RewardedAdEventType.LOADED, () => {
          if (userInitiatedLoad) {
            rewardedAd.show();
            setUserInitiatedLoad(false);
          }
        }),
      );
    }

    if (RewardedAdEventType.EARNED_REWARD) {
      listeners.push(
        rewardedAd.addAdEventListener(
          RewardedAdEventType.EARNED_REWARD,
          async () => {
            try {
              const res = await fetch(
                `${process.env.EXPO_PUBLIC_SERVER_URI}/api/users/watch-ad`,
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                  },
                },
              );
              const data = await res.json();
              if (data.success) setCoins(Number(data.adCoins || coins + 1));
              else setCoins((prev) => prev + 1);
            } catch {
              setCoins((prev) => prev + 1);
            }
          },
        ),
      );
    }

    if (RewardedAdEventType.CLOSED) {
      listeners.push(
        rewardedAd.addAdEventListener(RewardedAdEventType.CLOSED, () => {
          rewardedAd.load();
        }),
      );
    }

    return () => listeners.forEach((unsub) => unsub());
  }, [token, userInitiatedLoad]);

  const handleWatchAd = () => {
    setUserInitiatedLoad(true);
    rewardedAd.load();
  };

  // ═══════════════════════════════════════════════════════════════
  // FETCH USER STATUS
  // ═══════════════════════════════════════════════════════════════
  useFocusEffect(
    useCallback(() => {
      const fetchUserStatus = async () => {
        if (!token) return;
        try {
          const res = await fetch(`${process.env.EXPO_PUBLIC_SERVER_URI}/me`, {
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          });
          if (!res.ok) return;
          const data = await res.json();
          const u = data.user || {};
          setIsSubscribed(u.isSubscribed || false);
          setFreeDesignsUsed(u.freeDesignsUsed || 0);
          setIsPremium(u.isPremium || false);
          setIsManualDisabled(u.manualDisabled || false);
          setCoins(Number(u.adCoins || 0));
        } catch (err) {
          console.error("Failed to fetch user status:", err);
        }
      };
      fetchUserStatus();
    }, [token]),
  );

  // ═══════════════════════════════════════════════════════════════
  // IMAGE PICKING
  // ═══════════════════════════════════════════════════════════════
  const pickImage = async () => {
    try {
      if (Platform.OS !== "web") {
        const { status } =
          await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== "granted") {
          showModal(
            "Access Needed",
            "We need permission to access your photos.",
          );
          return;
        }
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.3,
        base64: true,
      });
      if (!result.canceled) handleImageResult(result.assets[0]);
    } catch {
      showModal(
        "Image Issue",
        "Something went wrong while selecting your image.",
      );
    }
  };

  const takePhoto = async () => {
    try {
      if (Platform.OS !== "web") {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== "granted") {
          showModal(
            "Access Needed",
            "We need permission to access your camera.",
          );
          return;
        }
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.3,
        base64: true,
      });
      if (!result.canceled) handleImageResult(result.assets[0]);
    } catch {
      showModal("Camera Error", "There was a problem taking your photo.");
    }
  };

  const handleImageResult = async (asset) => {
    setImage(asset.uri);
    if (asset.width && asset.height) {
      setImageDims({ width: asset.width, height: asset.height });
    }
    // Clear guided mode drawings when new image is picked
    setPaths([]);
    setVertices([]);
    setSegmentCurvatures([]);
    setCurveEditSegmentIndex(null);
    setPreviewPoint(null);
    pathsRef.current = [];

    if (asset.base64) {
      setImageBase64(asset.base64);
    } else {
      const base64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      setImageBase64(base64);
    }
  };

  const removeImage = () => {
    setImage(null);
    setImageBase64(null);
    setImageDims(null);
    setPaths([]);
    setVertices([]);
    setSegmentCurvatures([]);
    setCurveEditSegmentIndex(null);
    setPreviewPoint(null);
    pathsRef.current = [];
  };

  const showModal = (title, message) => {
    setModalData({ title, message });
    setModalVisible(true);
  };

  // ═══════════════════════════════════════════════════════════════
  // MODE SWITCHING
  // ═══════════════════════════════════════════════════════════════
  const switchMode = (newMode) => {
    if (newMode === mode) return;
    setMode(newMode);
    setPaths([]);
    setVertices([]);
    setSegmentCurvatures([]);
    setCurveEditSegmentIndex(null);
    setPreviewPoint(null);
    pathsRef.current = [];
  };

  // ═══════════════════════════════════════════════════════════════
  // GUIDED MODE HANDLERS
  // ═══════════════════════════════════════════════════════════════
  const handleUndo = () => {
    if (curveEditSegmentIndex != null) {
      setCurveEditSegmentIndex(null);
      setPreviewPoint(null);
      return;
    }
    if (vertices.length > 0) {
      setVertices((prev) => prev.slice(0, -1));
      setSegmentCurvatures((prev) => prev.slice(0, -1));
      setPreviewPoint(null);
    } else if (paths.length > 0) {
      setPaths((prev) => {
        const updated = prev.slice(0, -1);
        pathsRef.current = updated;
        return updated;
      });
    }
  };

  const handleClearAll = () => {
    setPaths([]);
    setVertices([]);
    setSegmentCurvatures([]);
    setCurveEditSegmentIndex(null);
    setPreviewPoint(null);
    pathsRef.current = [];
  };

  const removePath = (index) => {
    setPaths((prev) => {
      const updated = prev.filter((_, i) => i !== index);
      pathsRef.current = updated;
      return updated;
    });
  };

  const assignRoom = (type) => {
    if (assigningPathIndex == null) return;
    setPaths((prev) =>
      prev.map((p, i) =>
        i === assigningPathIndex ? { ...p, roomType: type } : p,
      ),
    );
    setShowRoomAssign(false);
    setAssigningPathIndex(null);
    setShowCustomInput(false);
    setCustomRoomInput("");
  };

  const handleCustomRoomAdd = () => {
    const trimmed = customRoomInput.trim();
    if (!trimmed) return;
    assignRoom(trimmed);
  };

  const openRoomAssignForPath = (index) => {
    setAssigningPathIndex(index);
    setShowRoomAssign(true);
    setShowCustomInput(false);
    setCustomRoomInput("");
  };

  // ═══════════════════════════════════════════════════════════════
  // PROMPT BUILDING
  // ═══════════════════════════════════════════════════════════════
  const buildPrompt = () => {
    const style = designStyle.toLowerCase();
    const tone = colorTone.toLowerCase();

    if (mode === "quick") {
      return (
        `2D floor plan to 3D furnished ${roomType.toLowerCase()} interior, ` +
        `${style} style, ${tone} color palette, ` +
        `convert architectural floor plan to realistic 3D room visualization with furniture`
      );
    }

    // Guided mode
    const roomNames = paths
      .filter((p) => p.roomType)
      .map((p) => p.roomType.toLowerCase());
    const uniqueRooms = [...new Set(roomNames)];

    if (uniqueRooms.length === 0) {
      return (
        `2D floor plan to 3D furnished interior, ${style} style, ${tone} color palette, ` +
        `convert architectural floor plan to realistic 3D room visualization with furniture`
      );
    }

    const roomList = uniqueRooms.join(", ");
    return (
      `2D floor plan to 3D furnished interior with ${roomList}, ` +
      `${style} style, ${tone} color palette, ` +
      `convert architectural floor plan to realistic 3D room visualization with furniture`
    );
  };

  // ═══════════════════════════════════════════════════════════════
  // SUBMIT
  // ═══════════════════════════════════════════════════════════════
  const handleSubmit = async () => {
    if (!image) {
      showModal("Missing Plan", "Please upload a floor plan image first.");
      return;
    }
    if (mode === "guided" && paths.length === 0) {
      showModal(
        "No Rooms Drawn",
        "Please draw at least one room outline on your plan.",
      );
      return;
    }
    if (isManualDisabled) {
      showModal(
        "Access Denied",
        "Your account is blocked. Please contact support.",
      );
      return;
    }
    if (!isSubscribed && !isPremium && freeDesignsUsed >= 2 && coins < 2) {
      router.push("/profile/upgrade");
      return;
    }

    try {
      setLoading(true);

      let imageDataUrl = null;
      if (image && imageBase64) {
        const uriParts = image.split(".");
        const fileType = uriParts[uriParts.length - 1];
        const imageType = fileType
          ? `image/${fileType.toLowerCase()}`
          : "image/jpeg";
        imageDataUrl = `data:${imageType};base64,${imageBase64}`;
      }

      const customPrompt = buildPrompt();

      const requestBody = {
        roomType: mode === "quick" ? roomType : "Floor Plan",
        designStyle,
        colorTone,
        customPrompt,
        image: imageDataUrl,
      };

      const response = await fetch(
        `${process.env.EXPO_PUBLIC_SERVER_URI}/api/designs`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        },
      );

      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Something went wrong");

      const imageUri =
        data.generatedImageUrl ||
        data.generatedImage ||
        data.image ||
        data.output ||
        null;

      if (imageUri) {
        if (!isSubscribed && !isPremium && freeDesignsUsed >= 2 && coins >= 2) {
          setCoins((prev) => prev - 2);
        }
        router.push({
          pathname: "/outputScreen",
          params: {
            generatedImage: imageUri,
            image: image || null,
            roomType: mode === "quick" ? roomType : "Floor Plan",
            designStyle,
            colorTone,
            createdAt: new Date().toISOString(),
          },
        });
      } else {
        showModal(
          "Generation Failed",
          "There was a problem generating your design. Please try again later.",
        );
      }
    } catch (error) {
      console.error("Error generating design:", error);
      showModal(
        "Generation Failed",
        "There was a problem generating your design. Please try again later.",
      );
    } finally {
      setLoading(false);
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <SafeAreaView style={styles.backButtonContainer}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backArrow}
          hitSlop={10}
        >
          <Ionicons name="chevron-back" size={26} color={COLORS.textPrimary} />
        </TouchableOpacity>
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={styles.container}
        style={styles.scrollView}
        scrollEnabled={scrollEnabled}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <Text style={styles.title}>LIVINAI</Text>
          <Text style={styles.subtitle}>Floor Plan to 3D</Text>
          {!isSubscribed && !isPremium && freeDesignsUsed >= 2 && (
            <View style={styles.coinsRow}>
              <Text style={styles.coinsText}>{coins} Coins</Text>
            </View>
          )}
        </View>

        {/* ── Mode Toggle ── */}
        <View style={styles.modeToggleContainer}>
          <TouchableOpacity
            style={[styles.modeTab, mode === "quick" && styles.modeTabActive]}
            onPress={() => switchMode("quick")}
            activeOpacity={0.7}
          >
            <Ionicons
              name="flash-outline"
              size={16}
              color={mode === "quick" ? "#fff" : COLORS.textSecondary}
              style={{ marginRight: 6 }}
            />
            <Text
              style={[
                styles.modeTabText,
                mode === "quick" && styles.modeTabTextActive,
              ]}
            >
              Quick
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.modeTab, mode === "guided" && styles.modeTabActive]}
            onPress={() => switchMode("guided")}
            activeOpacity={0.7}
          >
            <Ionicons
              name="create-outline"
              size={16}
              color={mode === "guided" ? "#fff" : COLORS.textSecondary}
              style={{ marginRight: 6 }}
            />
            <Text
              style={[
                styles.modeTabText,
                mode === "guided" && styles.modeTabTextActive,
              ]}
            >
              Guided
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── Upload Section ── */}
        <View style={styles.section}>
          <View style={styles.labelRow}>
            <Text style={styles.label}>Upload Floor Plan</Text>
            {!isSubscribed && (
              <TouchableOpacity
                onPress={handleWatchAd}
                activeOpacity={0.8}
                style={styles.watchAdBtn}
              >
                <Ionicons name="play-circle-outline" size={14} color="#fff" />
                <Text style={styles.watchAdText}>Watch Ad</Text>
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity
            style={[styles.imagePicker, image && styles.imagePickerActive]}
            onPress={() => setShowImageSourceModal(true)}
            activeOpacity={0.9}
          >
            {image ? (
              <>
                <Image source={{ uri: image }} style={styles.previewImage} />
                <TouchableOpacity
                  style={styles.removeBtn}
                  onPress={removeImage}
                  hitSlop={10}
                >
                  <Ionicons
                    name="close-circle"
                    size={28}
                    color={COLORS.error}
                  />
                </TouchableOpacity>
              </>
            ) : (
              <View style={styles.placeholderBox}>
                <View style={styles.iconCircle}>
                  <Ionicons
                    name="map-outline"
                    size={30}
                    color={COLORS.primaryDark}
                  />
                </View>
                <Text style={styles.placeholderTitle}>
                  Upload your floor plan
                </Text>
                <Text style={styles.placeholderSub}>
                  Tap to take a photo or choose from gallery
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* ══════════════════════════════════════════════════════ */}
        {/* QUICK MODE CONTENT */}
        {/* ══════════════════════════════════════════════════════ */}
        {mode === "quick" && (
          <>
            {/* Room Type Grid */}
            <View style={styles.section}>
              <Text style={styles.label}>What space is this?</Text>
              <View style={styles.roomGrid}>
                {ROOM_TYPES.map((rt) => {
                  const active = roomType === rt.key;
                  return (
                    <TouchableOpacity
                      key={rt.key}
                      style={[styles.roomChip, active && styles.roomChipActive]}
                      onPress={() => setRoomType(rt.key)}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name={rt.icon}
                        size={18}
                        color={
                          active ? COLORS.primaryDark : COLORS.textSecondary
                        }
                        style={{ marginRight: 6 }}
                      />
                      <Text
                        style={[
                          styles.roomChipText,
                          active && styles.roomChipTextActive,
                        ]}
                      >
                        {rt.key}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Design Style */}
            <View style={styles.section}>
              <Text style={styles.label}>Design Style</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.chipScroll}
              >
                {DESIGN_STYLES.map((style) => (
                  <TouchableOpacity
                    key={style}
                    style={[
                      styles.chip,
                      designStyle === style && styles.chipActive,
                    ]}
                    onPress={() => setDesignStyle(style)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        designStyle === style && styles.chipTextActive,
                      ]}
                    >
                      {style}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {/* Color Tone */}
            <View style={styles.section}>
              <Text style={styles.label}>Color Tone</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.chipScroll}
              >
                {COLOR_TONES.map((tone) => (
                  <TouchableOpacity
                    key={tone}
                    style={[
                      styles.chip,
                      colorTone === tone && styles.chipActive,
                    ]}
                    onPress={() => setColorTone(tone)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        colorTone === tone && styles.chipTextActive,
                      ]}
                    >
                      {tone}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </>
        )}

        {/* ══════════════════════════════════════════════════════ */}
        {/* GUIDED MODE CONTENT */}
        {/* ══════════════════════════════════════════════════════ */}
        {mode === "guided" && (
          <>
            {/* Drawing Canvas */}
            {image && imageDims && (
              <View style={styles.section}>
                <View style={styles.labelRow}>
                  <Text style={styles.label}>Draw Room Outlines</Text>
                  <View style={styles.canvasToolbar}>
                    <View style={styles.drawToolPill}>
                      <Ionicons name="create-outline" size={18} color={COLORS.primaryDark} />
                      <Text style={styles.drawToolPillText}>Draw & Curve</Text>
                    </View>

                    <TouchableOpacity
                      style={styles.toolBtn}
                      onPress={handleUndo}
                      disabled={paths.length === 0 && vertices.length === 0}
                    >
                      <Ionicons
                        name="arrow-undo-outline"
                        size={18}
                        color={
                          paths.length === 0 && vertices.length === 0
                            ? COLORS.disabled
                            : COLORS.primaryDark
                        }
                      />
                    </TouchableOpacity>

                    {vertices.length > 2 && (
                      <TouchableOpacity
                        style={styles.toolBtn}
                        onPress={closeShape}
                      >
                        <Ionicons name="checkmark-circle-outline" size={18} color={COLORS.primaryDark} />
                      </TouchableOpacity>
                    )}

                    <TouchableOpacity
                      style={styles.toolBtn}
                      onPress={handleClearAll}
                      disabled={paths.length === 0 && vertices.length === 0}
                    >
                      <Ionicons
                        name="trash-outline"
                        size={18}
                        color={
                          paths.length === 0 && vertices.length === 0 ? COLORS.disabled : COLORS.error
                        }
                      />
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.canvasHintContainer}>
                  <Ionicons name="information-circle-outline" size={16} color={COLORS.textSecondary} />
                  <Text style={styles.canvasHint}>
                    Tap to add points. Tap the first point to close. Drag a segment midpoint to curve.
                  </Text>
                </View>

                <View
                  style={[
                    styles.canvasContainer,
                    vertices.length > 0 && styles.canvasContainerActive,
                    { width: canvasSize.width, height: canvasSize.height },
                  ]}
                  onTouchStart={handleCanvasTap}
                  onTouchMove={handleCanvasMove}
                  onTouchEnd={handleCanvasRelease}
                >
                  <Image
                    source={{ uri: image }}
                    style={{
                      width: "100%",
                      height: "100%",
                      borderRadius: 16,
                    }}
                    resizeMode="cover"
                  />
                  <Svg
                    style={StyleSheet.absoluteFill}
                    width={canvasSize.width}
                    height={canvasSize.height}
                  >
                    {/* Completed paths */}
                    {paths.map((p, i) => (
                      <Path
                        key={`path-${i}`}
                        d={p.pathData}
                        stroke={p.color}
                        strokeWidth={3}
                        fill={p.color + "25"}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ))}
                    
                    {/* Current drawing preview path */}
                    {(vertices.length > 0) && (
                      <Path
                        d={buildPathFromVertices(
                          vertices,
                          segmentCurvatures,
                          false,
                          previewPoint
                        )}
                        stroke={nextColor}
                        strokeWidth={3}
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeDasharray="6,3"
                      />
                    )}
                    
                    {/* Segment midpoint handles (drag to adjust curvature) */}
                    {vertices.length >= 2 &&
                      vertices.slice(0, vertices.length - 1).map((_, i) => {
                        const a = vertices[i];
                        const b = vertices[i + 1];
                        const mx = (a.x + b.x) / 2;
                        const my = (a.y + b.y) / 2;
                        const curvature = segmentCurvatures[i] ?? 0;
                        const isActive = curveEditSegmentIndex === i;
                        const opacity =
                          isActive ? 1 : Math.abs(curvature) > 0.02 ? 0.75 : 0.35;

                        return (
                          <Circle
                            key={`mid-${i}`}
                            cx={mx}
                            cy={my}
                            r={isActive ? 7 : 5}
                            fill={COLORS.primaryDark}
                            opacity={opacity}
                            stroke="#fff"
                            strokeWidth={1.5}
                          />
                        );
                      })}

                    {/* Vertices */}
                    {vertices.map((v, i) => (
                      <Circle
                        key={`v-${i}`}
                        cx={v.x}
                        cy={v.y}
                        r={i === 0 && vertices.length > 2 ? 8 : 4}
                        fill={i === 0 ? COLORS.primaryDark : nextColor}
                        stroke="#fff"
                        strokeWidth={1.5}
                      />
                    ))}
                  </Svg>
                </View>
              </View>
            )}

            {/* Rooms list */}
            {paths.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.label}>Rooms Identified</Text>
                {paths.map((p, i) => (
                  <TouchableOpacity
                    key={`room-${i}`}
                    style={styles.roomItem}
                    onPress={() => openRoomAssignForPath(i)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.roomItemAccent, { backgroundColor: p.color }]} />
                    <View style={[styles.roomDot, { backgroundColor: p.color }]} />
                    <Text style={styles.roomItemText}>
                      {p.roomType || "Tap to assign room type"}
                    </Text>
                    {!p.roomType && (
                      <Ionicons
                        name="chevron-forward"
                        size={16}
                        color={COLORS.textSecondary}
                      />
                    )}
                    <TouchableOpacity
                      style={styles.roomItemDelete}
                      onPress={() => removePath(i)}
                      hitSlop={8}
                    >
                      <Ionicons
                        name="close-circle-outline"
                        size={20}
                        color={COLORS.textSecondary}
                      />
                    </TouchableOpacity>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Design Style */}
            <View style={styles.section}>
              <Text style={styles.label}>Design Style</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.chipScroll}
              >
                {DESIGN_STYLES.map((style) => (
                  <TouchableOpacity
                    key={style}
                    style={[styles.chip, designStyle === style && styles.chipActive]}
                    onPress={() => setDesignStyle(style)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        designStyle === style && styles.chipTextActive,
                      ]}
                    >
                      {style}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {/* Color Tone */}
            <View style={styles.section}>
              <Text style={styles.label}>Color Tone</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.chipScroll}
              >
                {COLOR_TONES.map((tone) => (
                  <TouchableOpacity
                    key={tone}
                    style={[styles.chip, colorTone === tone && styles.chipActive]}
                    onPress={() => setColorTone(tone)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        colorTone === tone && styles.chipTextActive,
                      ]}
                    >
                      {tone}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </>
        )}

        {/* ── Generate Button ── */}
        <TouchableOpacity
          style={styles.btnWrapper}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading ? (
            <LinearGradient
              colors={[COLORS.primary, COLORS.primary]}
              style={styles.btnGradient}
            >
              <ActivityIndicator color={COLORS.white} />
            </LinearGradient>
          ) : (
            <LinearGradient
              colors={[COLORS.primaryDark, COLORS.primary]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.btnGradient}
            >
              <Ionicons
                name="sparkles-outline"
                size={20}
                color={COLORS.white}
                style={{ marginRight: 8 }}
              />
              <Text style={styles.btnText}>Generate 3D Design</Text>
            </LinearGradient>
          )}
        </TouchableOpacity>

        <View style={{ height: verticalScale(40) }} />
      </ScrollView>

      {/* ═══════════════════════════════════════════════════════ */}
      {/* IMAGE SOURCE MODAL */}
      {/* ═══════════════════════════════════════════════════════ */}
      <Modal
        visible={showImageSourceModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowImageSourceModal(false)}
      >
        <TouchableWithoutFeedback
          onPress={() => setShowImageSourceModal(false)}
        >
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.modalSheet}>
                <Text style={styles.modalTitle}>Upload Floor Plan</Text>
                <Text style={styles.modalSubtitle}>Choose an option</Text>

                <TouchableOpacity
                  style={styles.modalBtn}
                  onPress={() => {
                    setShowImageSourceModal(false);
                    takePhoto();
                  }}
                >
                  <Ionicons
                    name="camera-outline"
                    size={20}
                    color="#fff"
                    style={{ marginRight: 8 }}
                  />
                  <Text style={styles.modalBtnText}>Take Photo</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.modalBtn}
                  onPress={() => {
                    setShowImageSourceModal(false);
                    pickImage();
                  }}
                >
                  <Ionicons
                    name="images-outline"
                    size={20}
                    color="#fff"
                    style={{ marginRight: 8 }}
                  />
                  <Text style={styles.modalBtnText}>Choose from Gallery</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.modalBtn, styles.modalCancelBtn]}
                  onPress={() => setShowImageSourceModal(false)}
                >
                  <Text
                    style={[styles.modalBtnText, { color: COLORS.textSecondary }]}
                  >
                    Cancel
                  </Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* ═══════════════════════════════════════════════════════ */}
      {/* ROOM TYPE ASSIGNMENT MODAL (GUIDED) */}
      {/* ═══════════════════════════════════════════════════════ */}
      <Modal
        visible={showRoomAssign}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setShowRoomAssign(false);
          setShowCustomInput(false);
          setCustomRoomInput("");
        }}
      >
        <TouchableWithoutFeedback
          onPress={() => {
            setShowRoomAssign(false);
            setShowCustomInput(false);
            setCustomRoomInput("");
          }}
        >
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.roomAssignSheet}>
                <Text style={styles.modalTitle}>Assign Room Type</Text>
                <Text style={styles.modalSubtitle}>What room is this outline?</Text>

                <View style={styles.roomAssignGrid}>
                  {GUIDED_ROOM_TYPES.map((rt) => (
                    <TouchableOpacity
                      key={rt.key}
                      style={styles.roomAssignChip}
                      onPress={() => assignRoom(rt.key)}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name={rt.icon}
                        size={16}
                        color={COLORS.primaryDark}
                        style={{ marginRight: 6 }}
                      />
                      <Text style={styles.roomAssignChipText}>{rt.key}</Text>
                    </TouchableOpacity>
                  ))}

                  {/* Custom / Add option */}
                  <TouchableOpacity
                    style={[styles.roomAssignChip, styles.roomAssignChipAdd]}
                    onPress={() => setShowCustomInput(true)}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name="add-outline"
                      size={16}
                      color={COLORS.primaryDark}
                      style={{ marginRight: 6 }}
                    />
                    <Text style={styles.roomAssignChipText}>Custom</Text>
                  </TouchableOpacity>
                </View>

                {showCustomInput && (
                  <View style={styles.customInputRow}>
                    <TextInput
                      style={styles.customInput}
                      placeholder="Enter room type..."
                      placeholderTextColor={COLORS.placeholderText}
                      value={customRoomInput}
                      onChangeText={setCustomRoomInput}
                      autoFocus
                    />
                    <TouchableOpacity
                      style={styles.customAddBtn}
                      onPress={handleCustomRoomAdd}
                    >
                      <Text style={styles.customAddBtnText}>Add</Text>
                    </TouchableOpacity>
                  </View>
                )}

                <TouchableOpacity
                  style={[
                    styles.modalBtn,
                    styles.modalCancelBtn,
                    { marginTop: verticalScale(6) },
                  ]}
                  onPress={() => {
                    setShowRoomAssign(false);
                    setShowCustomInput(false);
                    setCustomRoomInput("");
                  }}
                >
                  <Text
                    style={[styles.modalBtnText, { color: COLORS.textSecondary }]}
                  >
                    Skip
                  </Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* ═══════════════════════════════════════════════════════ */}
      {/* LOADING MODAL */}
      {/* ═══════════════════════════════════════════════════════ */}
      <Modal transparent animationType="fade" visible={loading}>
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={COLORS.primaryDark} />
            <Text style={styles.loadingTitle}>Converting your plan...</Text>
            <Text style={styles.loadingSub}>Generating a 3D furnished view</Text>
            <Text style={styles.loadingSub}>This may take up to 30 seconds</Text>
          </View>
        </View>
      </Modal>

      {/* ═══════════════════════════════════════════════════════ */}
      {/* INFO / ERROR MODAL */}
      {/* ═══════════════════════════════════════════════════════ */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setModalVisible(false)}>
          <View style={styles.infoOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.infoBox}>
                <Text style={styles.modalTitle}>{modalData.title}</Text>
                <Text style={styles.modalSubtitle}>{modalData.message}</Text>
                <TouchableOpacity
                  style={[styles.modalBtn, { marginTop: 8 }]}
                  onPress={() => setModalVisible(false)}
                >
                  <Text style={styles.modalBtnText}>OK</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </KeyboardAvoidingView>
  );
}

