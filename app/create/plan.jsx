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
import Svg, { Circle, Path } from "react-native-svg";
import styles from "../../assets/styles/create/create.styles";
import { useAuthStore } from "../../authStore";
import RoomTypeSelector from "../../components/create/RoomTypeSelector";
import COLORS from "../../constants/colors";

const { width, height } = Dimensions.get("window");
const scale = (size) => (width / 375) * size;
const verticalScale = (size) => (height / 667) * size;
const moderateScale = (size, factor = 0.5) =>
  size + (scale(size) - size) * factor;

const adUnitId = "ca-app-pub-4470538534931449/2411201644";
const rewardedAd = RewardedAd.createForAdRequest(adUnitId);

/** Space options on plan — narrower list than the global selector */
const PLAN_EXCLUDED_ROOM_TYPES = [
  "Kids Room",
  "Laundry Room",
  "Hallway",
  "Entryway",
  "Basement",
  "Closet",
];

// ---------------------------------------------------------------------------
// CONSTANTS
// ---------------------------------------------------------------------------
const DEFAULT_DESIGN_STYLE = "Modern";
const DEFAULT_COLOR_TONE = "Neutral";

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
      vertices: vertices.map((v) => ({ x: v.x, y: v.y })),
      segmentCurvatures: [...segmentCurvatures],
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
  // Simple, compact prompt (CLIP-friendly) that also nudges the generator
  // to preserve the apartment's inner walls and room partitions.
  // ═══════════════════════════════════════════════════════════════
  const buildPrompt = () => {
    const style = DEFAULT_DESIGN_STYLE.toLowerCase();
    const tone = DEFAULT_COLOR_TONE.toLowerCase();

    if (mode === "quick") {
      return (
        `2D floor plan to 3D furnished ${roomType.toLowerCase()} interior, ` +
        `strictly respect all inner walls and room partitions from the plan, ` +
        `${style} style, ${tone} color palette, ` +
        `convert architectural floor plan to realistic 3D room visualization with furniture, ` +
        `preserve interior wall layout and room boundaries`
      );
    }

    // Guided mode
    const roomNames = paths
      .filter((p) => p.roomType)
      .map((p) => p.roomType.toLowerCase());
    const uniqueRooms = [...new Set(roomNames)];

    if (uniqueRooms.length === 0) {
      return (
        `2D floor plan to 3D furnished interior, ` +
        `strictly respect all inner walls and room partitions from the plan, ` +
        `${style} style, ${tone} color palette, ` +
        `convert architectural floor plan to realistic 3D visualization with furniture, ` +
        `preserve interior wall layout`
      );
    }

    const roomList = uniqueRooms.join(", ");
    return (
      `2D floor plan to 3D furnished interior with ${roomList}, ` +
      `strictly respect all inner walls and room partitions separating each room, ` +
      `${style} style, ${tone} color palette, ` +
      `convert architectural floor plan to realistic 3D visualization with furniture, ` +
      `preserve the exact interior wall layout and room boundaries as drawn`
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
    if (mode === "quick" && !roomType) {
      showModal("Missing Space", "Please select a space option.");
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
        designStyle: DEFAULT_DESIGN_STYLE,
        colorTone: DEFAULT_COLOR_TONE,
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
            designStyle: DEFAULT_DESIGN_STYLE,
            colorTone: DEFAULT_COLOR_TONE,
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
        style={styles.scrollViewStyle}
        scrollEnabled={scrollEnabled}
        keyboardShouldPersistTaps="handled"
      >
        <View>
        <View style={styles.titleHeader}>
          <Text style={styles.title}>LIVINAI</Text>
          <Text style={styles.planHeaderTagline}>Floor plan → 3D</Text>
          {!isSubscribed && !isPremium && freeDesignsUsed >= 2 && (
            <View style={styles.coinsContainer}>
              <Text style={styles.coinsText}>{coins} Coins</Text>
            </View>
          )}
        </View>

        {/* Quick / Guided toggle — hidden; flow stays on Quick (see mode state). */}
        {/* <View style={styles.planModeToggleContainer}>
          <TouchableOpacity
            style={[styles.planModeTab, mode === "quick" && styles.planModeTabActive]}
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
                styles.planModeTabText,
                mode === "quick" && styles.planModeTabTextActive,
              ]}
            >
              Quick
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.planModeTab, mode === "guided" && styles.planModeTabActive]}
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
                styles.planModeTabText,
                mode === "guided" && styles.planModeTabTextActive,
              ]}
            >
              Guided
            </Text>
          </TouchableOpacity>
        </View> */}

        <View style={styles.form}>
          <View style={styles.formGroup}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>Upload floor plan</Text>
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
                  <Image
                    source={{ uri: image }}
                    style={[styles.previewImageModern, styles.previewImagePlan]}
                  />
                  <TouchableOpacity
                    style={styles.removeButtonModern}
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
                <View style={styles.placeholderContainerPlan}>
                  <View style={styles.uploadIconBadge}>
                    <Ionicons
                      name="map-outline"
                      size={moderateScale(28)}
                      color={COLORS.primaryDark}
                    />
                  </View>
                  <Text style={styles.uploadTitle}>Upload your floor plan</Text>
                  <Text style={styles.uploadCaption}>
                    JPG or PNG · camera or gallery
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </View>

        {mode === "quick" && (
          <RoomTypeSelector
            label="Space options"
            roomType={roomType}
            setRoomType={setRoomType}
            showAllOptions
            excludeRoomTypes={PLAN_EXCLUDED_ROOM_TYPES}
          />
        )}

        {/* Design style & color tone use fixed defaults on this screen (see DEFAULT_* constants). */}

        {/* ══════════════════════════════════════════════════════ */}
        {/* GUIDED MODE CONTENT */}
        {/* ══════════════════════════════════════════════════════ */}
        {mode === "guided" && (
          <>
            {/* Drawing Canvas */}
            {image && imageDims && (
              <View style={styles.formGroup}>
                <View style={styles.labelRow}>
                  <Text style={styles.label}>Draw Room Outlines</Text>
                  <View style={styles.planCanvasToolbar}>
                    <View style={styles.planDrawToolPill}>
                      <Ionicons name="create-outline" size={18} color={COLORS.primaryDark} />
                      <Text style={styles.planDrawToolPillText}>Draw & Curve</Text>
                    </View>

                    <TouchableOpacity
                      style={styles.planToolBtn}
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
                        style={styles.planToolBtn}
                        onPress={closeShape}
                      >
                        <Ionicons name="checkmark-circle-outline" size={18} color={COLORS.primaryDark} />
                      </TouchableOpacity>
                    )}

                    <TouchableOpacity
                      style={styles.planToolBtn}
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

                <View style={styles.planCanvasHintContainer}>
                  <Ionicons name="information-circle-outline" size={16} color={COLORS.textSecondary} />
                  <Text style={styles.planCanvasHint}>
                    Tap to add points. Tap the first point to close. Drag a segment midpoint to curve.
                  </Text>
                </View>

                <View
                  style={[
                    styles.planCanvasContainer,
                    vertices.length > 0 && styles.planCanvasContainerActive,
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
              <View style={styles.formGroup}>
                <Text style={styles.label}>Rooms Identified</Text>
                {paths.map((p, i) => (
                  <TouchableOpacity
                    key={`room-${i}`}
                    style={styles.planRoomItem}
                    onPress={() => openRoomAssignForPath(i)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.planRoomItemAccent, { backgroundColor: p.color }]} />
                    <View style={[styles.planRoomDot, { backgroundColor: p.color }]} />
                    <Text style={styles.planRoomItemText}>
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
                      style={styles.planRoomItemDelete}
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

          </>
        )}

        <TouchableOpacity
          style={styles.buttonWrapper}
          onPress={handleSubmit}
          disabled={loading}
        >
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
              <Ionicons
                name="cloud-upload-outline"
                size={20}
                color={COLORS.white}
                style={styles.buttonIcon}
              />
              <Text style={styles.buttonText}>Generate</Text>
            </LinearGradient>
          )}
        </TouchableOpacity>

        </View>

        <View style={{ height: verticalScale(40) }} />
        </View>
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
        <View style={styles.modalOverlay}>
          <TouchableWithoutFeedback
            onPress={() => setShowImageSourceModal(false)}
          >
            <View style={styles.modalBackdrop} />
          </TouchableWithoutFeedback>
          <SafeAreaView edges={['bottom']} style={styles.modalSheetSafe}>
            <View style={styles.modalContainer}>
              <Text style={styles.modalTitle}>Upload floor plan</Text>
              <Text style={styles.modalSubtitle}>Choose an option</Text>

              <TouchableOpacity
                style={styles.modalButton}
                onPress={() => {
                  setShowImageSourceModal(false);
                  takePhoto();
                }}
              >
                <Ionicons
                  name="camera-outline"
                  size={20}
                  color={COLORS.white}
                  style={styles.modalIcon}
                />
                <Text style={styles.modalButtonText}>Take Photo</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalButton}
                onPress={() => {
                  setShowImageSourceModal(false);
                  pickImage();
                }}
              >
                <Ionicons
                  name="images-outline"
                  size={20}
                  color={COLORS.white}
                  style={styles.modalIcon}
                />
                <Text style={styles.modalButtonText}>Choose from Gallery</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalButton, styles.modalCancelButton]}
                onPress={() => setShowImageSourceModal(false)}
              >
                <Text
                  style={[
                    styles.modalButtonText,
                    { color: COLORS.textSecondary },
                  ]}
                >
                  Cancel
                </Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </View>
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
              <View style={styles.planRoomAssignSheet}>
                <Text style={styles.modalTitle}>Assign room type</Text>
                <Text style={styles.modalSubtitle}>What room is this outline?</Text>

                <View style={styles.planRoomAssignGrid}>
                  {GUIDED_ROOM_TYPES.map((rt) => (
                    <TouchableOpacity
                      key={rt.key}
                      style={styles.planRoomAssignChip}
                      onPress={() => assignRoom(rt.key)}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name={rt.icon}
                        size={16}
                        color={COLORS.primaryDark}
                        style={{ marginRight: 6 }}
                      />
                      <Text style={styles.planRoomAssignChipText}>{rt.key}</Text>
                    </TouchableOpacity>
                  ))}

                  <TouchableOpacity
                    style={[styles.planRoomAssignChip, styles.planRoomAssignChipAdd]}
                    onPress={() => setShowCustomInput(true)}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name="add-outline"
                      size={16}
                      color={COLORS.primaryDark}
                      style={{ marginRight: 6 }}
                    />
                    <Text style={styles.planRoomAssignChipText}>Custom</Text>
                  </TouchableOpacity>
                </View>

                {showCustomInput && (
                  <View style={styles.planCustomInputRow}>
                    <TextInput
                      style={styles.planCustomInput}
                      placeholder="Enter room type..."
                      placeholderTextColor={COLORS.placeholderText}
                      value={customRoomInput}
                      onChangeText={setCustomRoomInput}
                      autoFocus
                    />
                    <TouchableOpacity
                      style={styles.planCustomAddBtn}
                      onPress={handleCustomRoomAdd}
                    >
                      <Text style={styles.planCustomAddBtnText}>Add</Text>
                    </TouchableOpacity>
                  </View>
                )}

                <TouchableOpacity
                  style={[
                    styles.modalButton,
                    styles.modalCancelButton,
                    { marginTop: verticalScale(6) },
                  ]}
                  onPress={() => {
                    setShowRoomAssign(false);
                    setShowCustomInput(false);
                    setCustomRoomInput("");
                  }}
                >
                  <Text
                    style={[
                      styles.modalButtonText,
                      { color: COLORS.textSecondary },
                    ]}
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
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={COLORS.primaryDark} />
            <Text style={styles.loadingText}>Converting your plan…</Text>
            <Text style={styles.loadingSubtext}>
              This may take up to 30 seconds
            </Text>
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

