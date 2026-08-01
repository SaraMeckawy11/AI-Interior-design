import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import * as MediaLibrary from "expo-media-library";
import { useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import AsyncStorage from "@react-native-async-storage/async-storage";

import PlanCanvas, {
  GRID_METERS,
  OPENING_SPECS,
  PLAN_WIDTH_METERS,
  ROOM_TINTS,
  openingOnNearestWall,
  polygonArea,
  snapOpeningToNearestWall,
} from "../../components/walkthrough/PlanCanvas";
import WalkthroughViewer from "../../components/walkthrough/WalkthroughViewer";
import { useAuthStore } from "../../authStore";
import COLORS from "../../constants/colors";
import { LAYOUT, RADIUS, SHADOW, SPACING, TYPE, ms } from "../../constants/theme";
import {
  COLOR_MOODS,
  DEFAULT_WALKTHROUGH_SETTINGS,
  DESIGN_PROFILES,
  FLOOR_FINISHES,
  ROOM_TYPES,
  WALKTHROUGH_STYLES,
  WALL_FINISHES,
  buildLayout,
} from "../../lib/walkthroughScene";

const STAGES = [
  {
    key: "plan",
    label: "Plan",
    title: "Create your floor plan",
    copy: "Upload a plan to detect editable rooms, or draw a measured plan from scratch.",
  },
  {
    key: "rooms",
    label: "Design",
    title: "Name and style the rooms",
    copy: "Choose what each space is. Livinai will use the same room-aware furniture families as the web walkthrough.",
  },
  {
    key: "walk",
    label: "Walk",
    title: "Walk through your home",
    copy: "Drag to look, use the pad to move, tap anything to inspect it.",
  },
];

const CANVAS_RATIO = 1.0;
const STORAGE_KEY = "livinai-walkthrough-plan";

const TOOLS = [
  { key: "select", icon: "move-outline", label: "Edit" },
  { key: "rect", icon: "square-outline", label: "Quick room" },
  { key: "room", icon: "shapes-outline", label: "Outline" },
  { key: "door", icon: "log-in-outline", label: "Door" },
  { key: "window", icon: "browsers-outline", label: "Window" },
  { key: "balcony", icon: "sunny-outline", label: "Balcony" },
];

const TOOL_HINTS = {
  rect: "Drag on the grid to draw a rectangular room.",
  room: "Tap each corner, then tap the first corner again to close the shape.",
  door: "Tap for a standard door, or drag along a wall for a wider door or open passage.",
  window: "Tap for a standard window, or drag along a wall to set its exact length.",
  balcony: "Tap for a balcony door, or drag along an outside wall for a wide slider.",
  select: "Select a room or opening, then drag the shape or one of its handles.",
};

const VIEW_MODES = [
  { key: "walk", icon: "walk-outline", label: "Walk" },
  { key: "orbit", icon: "sync-outline", label: "Orbit" },
  { key: "plan", icon: "map-outline", label: "Bird" },
];

const clonePoints = (points = []) => points.map((point) => [...point]);
const clonePlanSnapshot = ({ rooms, openings, roomConfigs, selectedRoom }) => ({
  rooms: rooms.map(clonePoints),
  openings: openings.map((opening) => ({ ...opening, points: clonePoints(opening.points) })),
  roomConfigs: roomConfigs.map((room) => ({ ...room })),
  selectedRoom,
});

export default function WalkthroughScreen() {
  const router = useRouter();
  const { token } = useAuthStore();
  const viewerRef = useRef(null);

  // ── Plan state ───────────────────────────────────────────────────────────
  const [stage, setStage] = useState(0);
  const [tool, setTool] = useState("select");
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [rooms, setRooms] = useState([]);
  const [openings, setOpenings] = useState([]);
  const [draft, setDraft] = useState([]);
  const [roomConfigs, setRoomConfigs] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_WALKTHROUGH_SETTINGS);
  const [selectedRoom, setSelectedRoom] = useState(0);
  const [selection, setSelection] = useState(null);
  const [planImage, setPlanImage] = useState(null);
  const [canvasAspect, setCanvasAspect] = useState(CANVAS_RATIO);
  const [detectedPixelsPerMeter, setDetectedPixelsPerMeter] = useState(null);
  const [detecting, setDetecting] = useState(false);
  const [planError, setPlanError] = useState("");
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);

  // ── Viewer state ─────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState("walk");
  const [night, setNight] = useState(false);
  const [inspected, setInspected] = useState(null);
  const [sceneInfo, setSceneInfo] = useState(null);
  const [panel, setPanel] = useState(null); // null | 'ai'
  const [cameraSource, setCameraSource] = useState("designer"); // 'designer' | 'current'
  const [composition, setComposition] = useState(null);
  const [aiRenders, setAiRenders] = useState({});
  const [outputMode, setOutputMode] = useState("live"); // 'live' | 'ai'
  const [rendering, setRendering] = useState(false);
  const [snapshot, setSnapshot] = useState(null);
  // 'capture' for a frame grabbed from the canvas, 'ai' for a finished render.
  // An AI render already lives in the collection — /api/designs saved it — so
  // offering "add to collection" for one would create a duplicate.
  const [snapshotKind, setSnapshotKind] = useState("capture");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  const canvasWidth = Math.round(LAYOUT.screenWidth - SPACING.lg * 2);
  const canvasHeight = Math.round(canvasWidth * canvasAspect);
  const pixelsPerMeter = detectedPixelsPerMeter || canvasWidth / PLAN_WIDTH_METERS;

  const layout = useMemo(
    () =>
      buildLayout({
        rooms,
        doors: openings.filter((opening) => opening.kind === "door").map((opening) => opening.points),
        windows: openings.filter((opening) => opening.kind === "window").map((opening) => opening.points),
        balconies: openings.filter((opening) => opening.kind === "balcony").map((opening) => opening.points),
        width: canvasWidth,
        height: canvasHeight,
        pixelsPerMeter,
      }),
    [canvasHeight, canvasWidth, openings, pixelsPerMeter, rooms],
  );

  const totalArea = useMemo(
    () => rooms.reduce((sum, room) => sum + polygonArea(room), 0) / (pixelsPerMeter * pixelsPerMeter),
    [pixelsPerMeter, rooms],
  );

  const aiKey = viewMode === "plan" ? "bird" : `room-${selectedRoom}`;
  const currentRender = aiRenders[aiKey];

  // ── Autosave ─────────────────────────────────────────────────────────────
  // Drawing a home takes real effort; geometry is saved in normalized canvas
  // coordinates so uploaded plans restore correctly on a different phone.
  const restored = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const saved = JSON.parse(raw);
          const restoredAspect = Number(saved.canvasAspect) || CANVAS_RATIO;
          const restoredHeight = canvasWidth * restoredAspect;
          const toPixels = saved.coordinateSpace === "normalized"
            ? (point) => [point[0] * canvasWidth, point[1] * restoredHeight]
            : (point) => [point[0] * (canvasWidth / PLAN_WIDTH_METERS), point[1] * (canvasWidth / PLAN_WIDTH_METERS)];
          setCanvasAspect(restoredAspect);
          setDetectedPixelsPerMeter(saved.pixelsPerMeterRatio ? saved.pixelsPerMeterRatio * canvasWidth : null);
          setPlanImage(saved.planImage || null);
          if (saved.rooms?.length) {
            setRooms(saved.rooms.map((room) => room.map(toPixels)));
            setRoomConfigs(saved.roomConfigs || []);
            setOpenings((saved.openings || []).map((o) => ({ kind: o.kind, points: o.points.map(toPixels) })));
            setSettings({ ...DEFAULT_WALKTHROUGH_SETTINGS, ...(saved.settings || {}) });
          }
        }
      } catch {}
      restored.current = true;
    })();
    // Runs once; restored geometry is scaled to the current screen width.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!restored.current) return undefined;
    const timer = setTimeout(() => {
      const normalize = (point) => [point[0] / canvasWidth, point[1] / canvasHeight];
      AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          coordinateSpace: "normalized",
          canvasAspect,
          pixelsPerMeterRatio: pixelsPerMeter / canvasWidth,
          planImage,
          rooms: rooms.map((room) => room.map(normalize)),
          roomConfigs,
          openings: openings.map((o) => ({ kind: o.kind, points: o.points.map(normalize) })),
          settings,
          savedAt: Date.now(),
        }),
      ).catch(() => {});
    }, 600);
    return () => clearTimeout(timer);
  }, [canvasAspect, canvasHeight, canvasWidth, openings, pixelsPerMeter, planImage, roomConfigs, rooms, settings]);

  // ── Plan editing ─────────────────────────────────────────────────────────
  const configFor = (index) => ({
    name: `Room ${index + 1}`,
    roomType: ROOM_TYPES[index % ROOM_TYPES.length],
    style: "Modern",
  });

  const currentPlanSnapshot = useCallback(
    () => clonePlanSnapshot({ rooms, openings, roomConfigs, selectedRoom }),
    [openings, roomConfigs, rooms, selectedRoom],
  );

  const restorePlanSnapshot = useCallback((snapshot) => {
    setRooms(snapshot.rooms.map(clonePoints));
    setOpenings(snapshot.openings.map((opening) => ({ ...opening, points: clonePoints(opening.points) })));
    setRoomConfigs(snapshot.roomConfigs.map((room) => ({ ...room })));
    setSelectedRoom(snapshot.selectedRoom);
    setSelection(null);
    setDraft([]);
  }, []);

  const rememberPlan = useCallback(() => {
    const snapshot = currentPlanSnapshot();
    setHistory((items) => [...items, snapshot].slice(-50));
    setFuture([]);
  }, [currentPlanSnapshot]);

  const addVertex = useCallback((point) => setDraft((current) => [...current, point]), []);

  const commitRoom = useCallback((polygon) => {
    rememberPlan();
    setRooms((existing) => [...existing, polygon]);
    setRoomConfigs((configs) => [...configs, configFor(configs.length)]);
    setSelectedRoom(rooms.length);
    setSelection({ kind: "room", index: rooms.length });
    setTool("select");
  }, [rememberPlan, rooms.length]);

  const closeRoom = useCallback(() => {
    if (draft.length < 3) return;
    commitRoom(draft);
    setDraft([]);
  }, [commitRoom, draft]);

  const removeRoom = useCallback((index) => {
    rememberPlan();
    setRooms((current) => current.filter((_, i) => i !== index));
    setRoomConfigs((current) => current.filter((_, i) => i !== index));
    setSelectedRoom((current) => Math.max(0, Math.min(current, rooms.length - 2)));
    setSelection(null);
  }, [rememberPlan, rooms.length]);

  // ── Editing ──────────────────────────────────────────────────────────────
  const moveRoom = useCallback(
    (index, dx, dy) => {
      setRooms((current) =>
        current.map((room, i) => {
          if (i !== index) return room;
          // Clamp as a whole so a room slides along the edge of the canvas
          // instead of deforming when one corner reaches the boundary.
          const minX = Math.min(...room.map((p) => p[0]));
          const maxX = Math.max(...room.map((p) => p[0]));
          const minY = Math.min(...room.map((p) => p[1]));
          const maxY = Math.max(...room.map((p) => p[1]));
          const clampedDx = Math.max(-minX, Math.min(canvasWidth - maxX, dx));
          const clampedDy = Math.max(-minY, Math.min(canvasHeight - maxY, dy));
          return room.map(([x, y]) => [x + clampedDx, y + clampedDy]);
        }),
      );
    },
    [canvasHeight, canvasWidth],
  );

  const moveVertex = useCallback((index, vertexIndex, point) => {
    setRooms((current) =>
      current.map((room, i) => (i === index ? room.map((corner, c) => (c === vertexIndex ? point : corner)) : room)),
    );
  }, []);

  const insertVertex = useCallback((index, vertexIndex, point) => {
    setRooms((current) => current.map((room, roomIndex) => {
      if (roomIndex !== index) return room;
      return [...room.slice(0, vertexIndex), point, ...room.slice(vertexIndex)];
    }));
  }, []);

  const moveOpening = useCallback(
    (index, point) => {
      setOpenings((current) =>
        current.map((opening, i) => {
          if (i !== index) return opening;
          const width = Math.hypot(
            opening.points[1][0] - opening.points[0][0],
            opening.points[1][1] - opening.points[0][1],
          );
          // Re-snap to the nearest wall so a dragged opening can never end up
          // floating in the middle of a room.
          const placed = openingOnNearestWall(
            point,
            rooms,
            width,
            (pixelsPerMeter * GRID_METERS) * 3,
          );
          return placed ? { ...opening, points: placed } : opening;
        }),
      );
    },
    [pixelsPerMeter, rooms],
  );

  const moveOpeningPoint = useCallback((index, pointIndex, point) => {
    setOpenings((current) => current.map((opening, openingIndex) => {
      if (openingIndex !== index) return opening;
      const raw = opening.points.map((value, valueIndex) => (valueIndex === pointIndex ? point : value));
      const placed = snapOpeningToNearestWall(raw, rooms, opening.kind, pixelsPerMeter);
      return placed ? { ...opening, points: placed } : opening;
    }));
  }, [pixelsPerMeter, rooms]);

  const undo = useCallback(() => {
    if (draft.length) return setDraft((current) => current.slice(0, -1));
    const previous = history[history.length - 1];
    if (!previous) return;
    setFuture((items) => [currentPlanSnapshot(), ...items].slice(0, 50));
    restorePlanSnapshot(previous);
    setHistory((items) => items.slice(0, -1));
  }, [currentPlanSnapshot, draft.length, history, restorePlanSnapshot]);

  const redo = useCallback(() => {
    const next = future[0];
    if (!next) return;
    setHistory((items) => [...items, currentPlanSnapshot()].slice(-50));
    restorePlanSnapshot(next);
    setFuture((items) => items.slice(1));
  }, [currentPlanSnapshot, future, restorePlanSnapshot]);

  const clearAll = useCallback(() => {
    if (rooms.length || openings.length) rememberPlan();
    setRooms([]);
    setRoomConfigs([]);
    setOpenings([]);
    setDraft([]);
    setSelectedRoom(0);
    setSelection(null);
  }, [openings.length, rememberPlan, rooms.length]);

  const clearPlanLines = useCallback(() => {
    clearAll();
    setTool("room");
    setPlanError(planImage ? "The image is preserved. Trace rooms and openings directly over it." : "");
  }, [clearAll, planImage]);

  const addOpening = useCallback((opening) => {
    rememberPlan();
    setOpenings((current) => [...current, opening]);
    setSelection({ kind: "opening", index: openings.length });
  }, [openings.length, rememberPlan]);

  const removeOpening = useCallback((index) => {
    rememberPlan();
    setOpenings((current) => current.filter((_, i) => i !== index));
    setSelection(null);
  }, [rememberPlan]);

  const deleteSelection = useCallback(() => {
    if (!selection) return;
    if (selection.kind === "room") removeRoom(selection.index);
    if (selection.kind === "opening") removeOpening(selection.index);
  }, [removeOpening, removeRoom, selection]);

  const selectShape = useCallback((kind, index) => {
    if (!kind || index < 0) return setSelection(null);
    setSelection({ kind, index });
    if (kind === "room") setSelectedRoom(index);
  }, []);

  const startBlankPlan = useCallback(() => {
    setPlanImage(null);
    setCanvasAspect(CANVAS_RATIO);
    setDetectedPixelsPerMeter(null);
    setPlanError("");
    setRooms([]);
    setOpenings([]);
    setRoomConfigs([]);
    setDraft([]);
    setSelection(null);
    setSelectedRoom(0);
    setHistory([]);
    setFuture([]);
    setTool("rect");
  }, []);

  const uploadPlan = useCallback(async () => {
    let result;
    try {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 1,
      });
    } catch {
      setPlanError("Livinai could not open your photo library. Check photo access in device settings and try again.");
      return;
    }
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const sourceWidth = Math.max(1, asset.width || 1200);
    const sourceHeight = Math.max(1, asset.height || 800);
    const aspect = Math.max(0.3, Math.min(3, sourceHeight / sourceWidth));
    const extension = (asset.fileName?.split(".").pop() || asset.mimeType?.split("/").pop() || "jpg").replace(/[^a-z0-9]/gi, "");
    let stableUri = asset.uri;

    try {
      if (FileSystem.documentDirectory) {
        stableUri = `${FileSystem.documentDirectory}livinai-walkthrough-plan.${extension}`;
        await FileSystem.deleteAsync(stableUri, { idempotent: true });
        await FileSystem.copyAsync({ from: asset.uri, to: stableUri });
      }
    } catch {
      stableUri = asset.uri;
    }

    setPlanImage(stableUri);
    setCanvasAspect(aspect);
    setDetectedPixelsPerMeter(null);
    setRooms([]);
    setOpenings([]);
    setRoomConfigs([]);
    setDraft([]);
    setSelection(null);
    setSelectedRoom(0);
    setHistory([]);
    setFuture([]);
    setDetecting(true);
    setPlanError("");

    let detectionTimeout;
    try {
      const image = await FileSystem.readAsStringAsync(stableUri, { encoding: FileSystem.EncodingType.Base64 });
      const controller = new AbortController();
      detectionTimeout = setTimeout(() => controller.abort(), 60000);
      const response = await fetch(`${process.env.EXPO_PUBLIC_SERVER_URI}/api/floorplans/detect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ image, mimeType: asset.mimeType || "image/jpeg" }),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || data.message || "The plan could not be detected.");

      const detectedWidth = Math.max(1, Number(data.width) || sourceWidth);
      const detectedHeight = Math.max(1, Number(data.height) || sourceHeight);
      const detectedAspect = Math.max(0.3, Math.min(3, detectedHeight / detectedWidth));
      const displayScale = canvasWidth / detectedWidth;
      const toDisplay = (point) => [point[0] * displayScale, point[1] * displayScale];
      const detectedRooms = (data.rooms || []).map((room) => room.map(toDisplay));
      const detectedOpenings = [
        ...(data.doors || []).map((points) => ({ kind: "door", points: points.slice(0, 2).map(toDisplay) })),
        ...(data.windows || []).map((points) => ({ kind: "window", points: points.slice(0, 2).map(toDisplay) })),
        ...(data.balconies || []).map((points) => ({ kind: "balcony", points: points.slice(0, 2).map(toDisplay) })),
      ];

      setCanvasAspect(detectedAspect);
      setDetectedPixelsPerMeter(Math.max(8, (Number(data.pixelsPerMeter) || detectedWidth / 15) * displayScale));
      setRooms(detectedRooms);
      setOpenings(detectedOpenings);
      setRoomConfigs(detectedRooms.map((_, index) => configFor(index)));
      setSelection(detectedRooms.length ? { kind: "room", index: 0 } : null);
      setTool("select");
      setPlanError(detectedRooms.length ? "" : "No closed rooms were detected. Trace them directly over the uploaded plan.");
    } catch (error) {
      setTool("room");
      setPlanError(`${error.name === "AbortError" ? "Detection timed out." : error.message} The uploaded image is ready—trace the rooms directly over it.`);
    } finally {
      if (detectionTimeout) clearTimeout(detectionTimeout);
      setDetecting(false);
    }
  }, [canvasWidth, token]);

  const updateRoom = useCallback((index, key, value) => {
    setRoomConfigs((current) => current.map((room, i) => (i === index ? { ...room, [key]: value } : room)));
  }, []);

  const updateSetting = useCallback((key, value) => {
    setSettings((current) => ({ ...current, [key]: value }));
  }, []);

  // ── Viewer actions ───────────────────────────────────────────────────────
  const changeViewMode = (mode) => {
    setViewMode(mode);
    setOutputMode("live");
    setComposition(null);
    viewerRef.current?.setMode(mode);
  };

  const toggleNight = () => {
    const next = !night;
    setNight(next);
    viewerRef.current?.setNight(next);
  };

  const focusRoom = (index) => {
    setSelectedRoom(index);
    setOutputMode("live");
    setComposition(null);
    viewerRef.current?.setRoom(index);
  };

  const previewFraming = () => {
    setCameraSource("designer");
    setOutputMode("live");
    viewerRef.current?.frameRoom(selectedRoom);
  };

  // ── AI render (mirrors the web studio's generateAiRender) ────────────────
  const pendingPurpose = useRef("photo");

  const requestCapture = (purpose) => {
    pendingPurpose.current = purpose;
    if (purpose === "ai") {
      setRendering(true);
      viewerRef.current?.capture("ai", cameraSource === "designer" && viewMode !== "plan");
    } else {
      setBusy("capture");
      viewerRef.current?.capture("photo", false);
    }
  };

  const buildRenderPrompt = (frame) => {
    const room = roomConfigs[selectedRoom] || {};
    if (viewMode === "plan") {
      return (
        "Photorealistic static 3D architectural bird-view render. Preserve the exact camera, measured plan, " +
        "walls, openings, furniture and design. Show an open roof. Do not add any ceiling fixtures: no pendants, " +
        "chandeliers, flush mounts, recessed lights, downlights or overhead lamps."
      );
    }
    if (!frame) {
      return (
        `Preserve the exact room geometry, doors, windows, existing 3D furniture layout and camera. ` +
        `Do not add, remove, resize or move walls, openings or furniture. Create a photorealistic ` +
        `${room.roomType || "interior"} by improving only materials and lighting.`
      );
    }
    const pieces = (frame.furnitureLabels || []).join(", ").slice(0, 160);
    return (
      `Exact ${frame.viewpoint === "user" ? "user-selected" : "professional"} camera and room. ` +
      `Keep ${frame.doorCount} doors + ${frame.windowCount} windows + ${frame.balconyCount || 0} balcony openings ` +
      `at their exact sizes and positions. Keep ${pieces || `all ${frame.furnitureCount} existing 3D furniture pieces`} ` +
      `at their exact positions and orientations. Never move walls, openings or furniture. ` +
      `Photorealistic ${room.roomType || "interior"}; improve materials and lighting only.`
    );
  };

  const runAiRender = async (image, frame) => {
    const room = roomConfigs[selectedRoom] || {};
    try {
      const response = await fetch(`${process.env.EXPO_PUBLIC_SERVER_URI}/api/designs`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          image,
          mode: "interior",
          roomType: viewMode === "plan" ? "Floor Plan" : room.roomType || "Living Room",
          designStyle: room.style || "Modern",
          colorTone: settings.colorMood || "Warm neutral",
          material: settings.floorFinish === "Auto by style" ? "Natural oak" : settings.floorFinish,
          lighting: night ? "Warm ambient evening light" : "Natural daylight",
          preserveGeometry: true,
          // Very low creative freedom: the 3D scene is the ground truth and the
          // model's only job is to resolve materials and light on top of it.
          creativity: viewMode === "plan" ? 24 : 10,
          customPrompt: buildRenderPrompt(frame),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 403) {
        router.push("/profile/upgrade");
        return;
      }
      if (!response.ok) throw new Error(data.message || "The AI render could not be generated.");
      const result = data.generatedImage || data.image;
      if (!result) throw new Error("The AI service returned no image.");
      setAiRenders((current) => ({
        ...current,
        [aiKey]: {
          image: result,
          label:
            viewMode === "plan"
              ? "Whole-home bird view"
              : `${room.name || `Room ${selectedRoom + 1}`} · ${room.roomType || "Interior"}`,
          createdAt: new Date().toISOString(),
        },
      }));
      setOutputMode("ai");
    } catch (error) {
      setNotice(error.message || "The AI render could not be generated.");
    } finally {
      setRendering(false);
    }
  };

  const handleSnapshot = useCallback(
    (image, purpose, frame) => {
      if (purpose === "ai") {
        setComposition(frame || null);
        runAiRender(image, frame);
      } else {
        setSnapshotKind("capture");
        setSnapshot(image);
        setBusy("");
      }
    },
    // runAiRender closes over the current room/settings, which is what we want.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aiKey, cameraSource, night, roomConfigs, selectedRoom, settings, token, viewMode],
  );

  // ── Saving ───────────────────────────────────────────────────────────────
  /**
   * Two different things end up in this sheet: a frame captured from the WebGL
   * canvas (a `data:` URL) and an AI render returned by the backend (an https
   * Cloudinary URL). Only the first can be decoded locally.
   */
  const writeTemp = async (source) => {
    const fileUri = `${FileSystem.cacheDirectory}livinai-walkthrough.jpg`;
    if (source.startsWith("data:")) {
      await FileSystem.writeAsStringAsync(fileUri, source.split(",")[1], {
        encoding: FileSystem.EncodingType.Base64,
      });
      return fileUri;
    }
    const downloaded = await FileSystem.downloadAsync(source, fileUri);
    return downloaded.uri;
  };

  const shareSnapshot = async () => {
    if (!snapshot) return;
    try {
      const fileUri = await writeTemp(snapshot);
      if (!(await Sharing.isAvailableAsync())) return setNotice("Sharing is not available on this device.");
      await Sharing.shareAsync(fileUri);
    } catch {
      setNotice("That view could not be shared.");
    }
  };

  const saveToGallery = async () => {
    if (!snapshot) return;
    try {
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (!permission.granted) return setNotice("Photo permission is needed to save this view.");
      await MediaLibrary.saveToLibraryAsync(await writeTemp(snapshot));
      setNotice("Saved to your gallery.");
    } catch {
      setNotice("That view could not be saved.");
    }
  };

  const saveToCollection = async () => {
    if (!snapshot) return;
    setBusy("save");
    try {
      const response = await fetch(`${process.env.EXPO_PUBLIC_SERVER_URI}/api/designs/walkthrough`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          image: snapshot,
          roomType: roomConfigs[selectedRoom]?.roomType || "3D Walkthrough",
          designStyle: roomConfigs[selectedRoom]?.style || "Modern",
          colorTone: settings.colorMood,
          notes: settings.notes,
        }),
      });
      if (!response.ok) throw new Error();
      setNotice("Added to your collection.");
    } catch {
      setNotice("This view could not be added to your collection.");
    } finally {
      setBusy("");
    }
  };

  // ── Navigation ───────────────────────────────────────────────────────────
  const canContinue = stage === 0 ? rooms.length > 0 || draft.length >= 3 : true;
  const goNext = () => {
    if (stage === 0 && draft.length >= 3) closeRoom();
    setStage((current) => Math.min(STAGES.length - 1, current + 1));
  };
  const goBack = () => {
    if (stage === 0) return router.back();
    setStage((current) => current - 1);
  };

  const current = STAGES[stage];

  return (
    <View style={styles.screen}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <LinearGradient colors={COLORS.gradientBrandDeep} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
        <SafeAreaView edges={["top"]} style={styles.header}>
          <View style={styles.headerRow}>
            <Pressable onPress={goBack} hitSlop={LAYOUT.hitSlop} style={styles.headerButton}>
              <Ionicons name="chevron-back" size={20} color={COLORS.white} />
            </Pressable>
            <View style={styles.headerCopy}>
              <Text style={styles.headerEyebrow}>3D Walkthrough</Text>
              <Text style={styles.headerTitle}>{current.title}</Text>
            </View>
          </View>

          <View style={styles.stepper}>
            {STAGES.map((item, index) => (
              <Pressable
                key={item.key}
                style={styles.step}
                disabled={index > stage && !rooms.length}
                onPress={() => setStage(index)}
              >
                <View style={[styles.stepTrack, index <= stage && styles.stepTrackActive]} />
                <Text style={[styles.stepLabel, index === stage && styles.stepLabelActive]} numberOfLines={1}>
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      {stage === 2 ? (
        <WalkthroughStage
          viewerRef={viewerRef}
          layout={layout}
          roomConfigs={roomConfigs}
          settings={settings}
          viewMode={viewMode}
          night={night}
          selectedRoom={selectedRoom}
          inspected={inspected}
          sceneInfo={sceneInfo}
          panel={panel}
          cameraSource={cameraSource}
          composition={composition}
          currentRender={currentRender}
          outputMode={outputMode}
          rendering={rendering}
          busy={busy}
          onReady={setSceneInfo}
          onSelect={setInspected}
          onSnapshot={handleSnapshot}
          onComposition={setComposition}
          onChangeMode={changeViewMode}
          onToggleNight={toggleNight}
          onFocusRoom={focusRoom}
          onCapture={() => requestCapture("photo")}
          onRender={() => requestCapture("ai")}
          onPreviewFraming={previewFraming}
          onSetPanel={setPanel}
          onSetCameraSource={setCameraSource}
          onSetOutputMode={setOutputMode}
          onSaveRender={(image) => {
            setSnapshotKind("ai");
            setSnapshot(image);
          }}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <Text style={styles.stageCopy}>{current.copy}</Text>

          {stage === 0 && (
            <>
              <View style={styles.sourceRow}>
                <Pressable style={styles.sourcePrimary} onPress={uploadPlan} disabled={detecting}>
                  {detecting
                    ? <ActivityIndicator size="small" color={COLORS.white} />
                    : <Ionicons name="cloud-upload-outline" size={19} color={COLORS.white} />}
                  <View style={styles.sourceCopy}>
                    <Text style={styles.sourcePrimaryTitle}>{detecting ? "Detecting plan…" : planImage ? "Replace plan" : "Upload floor plan"}</Text>
                    <Text style={styles.sourcePrimaryMeta}>JPG, PNG or WEBP</Text>
                  </View>
                </Pressable>
                <Pressable style={styles.sourceSecondary} onPress={startBlankPlan} disabled={detecting}>
                  <Ionicons name="create-outline" size={19} color={COLORS.primaryDark} />
                  <Text style={styles.sourceSecondaryText}>Blank canvas</Text>
                </Pressable>
              </View>

              {!!planError && (
                <View style={styles.planNotice}>
                  <Ionicons name="information-circle-outline" size={17} color={COLORS.accentStrong} />
                  <Text style={styles.planNoticeText}>{planError}</Text>
                </View>
              )}

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.toolbar}
                style={styles.toolbarWrap}
              >
                {TOOLS.map((item) => {
                  const active = tool === item.key;
                  return (
                    <Pressable key={item.key} style={[styles.tool, active && styles.toolActive]} onPress={() => setTool(item.key)}>
                      <Ionicons name={item.icon} size={15} color={active ? COLORS.white : COLORS.textSecondary} />
                      <Text style={[styles.toolLabel, active && styles.toolLabelActive]}>{item.label}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <Text style={styles.toolHint}>{TOOL_HINTS[tool]}</Text>

              <PlanCanvas
                width={canvasWidth}
                height={canvasHeight}
                pixelsPerMeter={pixelsPerMeter}
                imageUri={planImage}
                detecting={detecting}
                tool={tool}
                rooms={rooms}
                roomLabels={roomConfigs.map((room) => room.name)}
                openings={openings}
                draft={draft}
                snapToGrid={snapToGrid}
                selectedRoom={selectedRoom}
                selection={selection}
                onAddVertex={addVertex}
                onCloseRoom={closeRoom}
                onAddRoom={commitRoom}
                onAddOpening={addOpening}
                onRemoveOpening={removeOpening}
                onSelectRoom={setSelectedRoom}
                onMoveRoom={moveRoom}
                onMoveVertex={moveVertex}
                onInsertVertex={insertVertex}
                onMoveOpening={moveOpening}
                onMoveOpeningPoint={moveOpeningPoint}
                onSelectShape={selectShape}
                onBeginEdit={rememberPlan}
              />

              {tool === "select" && selection && (
                <View style={styles.selectionBar}>
                  <View style={[
                    styles.roomSwatch,
                    { backgroundColor: selection.kind === "room"
                      ? ROOM_TINTS[selection.index % ROOM_TINTS.length].stroke
                      : (OPENING_SPECS[openings[selection.index]?.kind] || OPENING_SPECS.door).color },
                  ]} />
                  <Text style={styles.selectionName} numberOfLines={1}>
                    {selection.kind === "room"
                      ? roomConfigs[selection.index]?.name || `Room ${selection.index + 1}`
                      : `${(OPENING_SPECS[openings[selection.index]?.kind] || OPENING_SPECS.door).label} · ${(
                          Math.hypot(
                            (openings[selection.index]?.points?.[1]?.[0] || 0) - (openings[selection.index]?.points?.[0]?.[0] || 0),
                            (openings[selection.index]?.points?.[1]?.[1] || 0) - (openings[selection.index]?.points?.[0]?.[1] || 0),
                          ) / pixelsPerMeter
                        ).toFixed(1)} m`}
                  </Text>
                  <Pressable style={styles.selectionAction} onPress={deleteSelection}>
                    <Ionicons name="trash-outline" size={15} color={COLORS.danger} />
                    <Text style={[styles.selectionActionText, { color: COLORS.danger }]}>Delete</Text>
                  </Pressable>
                </View>
              )}

              <View style={styles.canvasActions}>
                <GhostButton icon="checkmark-done-outline" label="Close shape" disabled={draft.length < 3} onPress={closeRoom} />
                <GhostButton icon="arrow-undo-outline" label="Undo" disabled={!draft.length && !history.length} onPress={undo} />
                <GhostButton icon="arrow-redo-outline" label="Redo" disabled={!future.length} onPress={redo} />
                <GhostButton icon="options-outline" label={snapToGrid ? "Grid snap" : "Free move"} active={snapToGrid} onPress={() => setSnapToGrid((v) => !v)} />
                <GhostButton icon="trash-outline" label="Clear lines" tone="danger" disabled={!rooms.length && !openings.length && !draft.length} onPress={clearPlanLines} />
              </View>

              <View style={styles.metrics}>
                <Metric value={rooms.length} label="Rooms" />
                <Metric value={openings.length} label="Openings" />
                <Metric value={`${totalArea.toFixed(0)} m²`} label="Area" />
              </View>

            </>
          )}

          {stage === 1 && (
            <>
              {roomConfigs.length === 0 && <EmptyState text="Go back and draw at least one room." />}
              {roomConfigs.map((room, index) => (
                <View key={`config-${index}`} style={styles.card}>
                  <View style={styles.cardHead}>
                    <View style={[styles.roomSwatch, { backgroundColor: ROOM_TINTS[index % ROOM_TINTS.length].stroke }]} />
                    <TextInput
                      style={styles.roomName}
                      value={room.name}
                      onChangeText={(value) => updateRoom(index, "name", value)}
                      placeholder={`Room ${index + 1}`}
                      placeholderTextColor={COLORS.placeholderText}
                    />
                    <Text style={styles.roomArea}>
                      {(polygonArea(rooms[index] || []) / (pixelsPerMeter * pixelsPerMeter)).toFixed(1)} m²
                    </Text>
                    <Pressable onPress={() => removeRoom(index)} hitSlop={LAYOUT.hitSlop}>
                      <Ionicons name="trash-outline" size={17} color={COLORS.textTertiary} />
                    </Pressable>
                  </View>
                  <ChipRow label="Room type" options={ROOM_TYPES} value={room.roomType} onChange={(v) => updateRoom(index, "roomType", v)} />
                  <ChipRow label="Style" options={WALKTHROUGH_STYLES} value={room.style} onChange={(v) => updateRoom(index, "style", v)} />
                </View>
              ))}

              {!!roomConfigs.length && (
                <View style={styles.card}>
                  <Text style={styles.cardSectionTitle}>Whole-home direction</Text>
                  <Text style={styles.cardSectionCopy}>A short, focused brief keeps every room coordinated.</Text>
                  <ChipRow label="Design profile" options={DESIGN_PROFILES} value={settings.designProfile} onChange={(v) => updateSetting("designProfile", v)} />
                  <ChipRow label="Colour mood" options={COLOR_MOODS} value={settings.colorMood} onChange={(v) => updateSetting("colorMood", v)} />
                  <ChipRow label="Floor finish" options={FLOOR_FINISHES} value={settings.floorFinish} onChange={(v) => updateSetting("floorFinish", v)} />
                  <ChipRow label="Wall finish" options={WALL_FINISHES} value={settings.wallFinish} onChange={(v) => updateSetting("wallFinish", v)} />
                  <Text style={[styles.fieldLabel, { marginTop: SPACING.lg }]}>Optional notes</Text>
                  <TextInput
                    style={styles.notes}
                    value={settings.notes}
                    onChangeText={(value) => updateSetting("notes", value)}
                    placeholder="Natural materials, calm lighting, no glossy surfaces…"
                    placeholderTextColor={COLORS.placeholderText}
                    multiline
                    maxLength={240}
                  />
                </View>
              )}
            </>
          )}

        </ScrollView>
      )}

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      {stage < 2 && (
        <SafeAreaView edges={["bottom"]} style={styles.footer}>
          <Pressable style={styles.footerGhost} onPress={goBack}>
            <Ionicons name="arrow-back" size={16} color={COLORS.textPrimary} />
            <Text style={styles.footerGhostText}>Back</Text>
          </Pressable>
          <Pressable style={[styles.footerPrimary, !canContinue && styles.footerPrimaryDisabled]} disabled={!canContinue} onPress={goNext}>
            <Text style={styles.footerPrimaryText}>{stage === 1 ? "Enter the walkthrough" : "Continue"}</Text>
            <Ionicons name="arrow-forward" size={16} color={COLORS.white} />
          </Pressable>
        </SafeAreaView>
      )}

      <SnapshotModal
        snapshot={snapshot}
        kind={snapshotKind}
        busy={busy}
        onClose={() => setSnapshot(null)}
        onShare={shareSnapshot}
        onSaveGallery={saveToGallery}
        onSaveCollection={saveToCollection}
      />

      <Modal transparent visible={!!notice} animationType="fade" onRequestClose={() => setNotice("")}>
        <Pressable style={styles.noticeBackdrop} onPress={() => setNotice("")}>
          <View style={styles.noticeCard}>
            <Text style={styles.noticeText}>{notice}</Text>
            <Pressable style={styles.noticeButton} onPress={() => setNotice("")}>
              <Text style={styles.noticeButtonText}>Got it</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

// ── Walkthrough stage ──────────────────────────────────────────────────────
function WalkthroughStage({
  viewerRef,
  layout,
  roomConfigs,
  settings,
  viewMode,
  night,
  selectedRoom,
  inspected,
  sceneInfo,
  panel,
  cameraSource,
  composition,
  currentRender,
  outputMode,
  rendering,
  busy,
  onReady,
  onSelect,
  onSnapshot,
  onComposition,
  onChangeMode,
  onToggleNight,
  onFocusRoom,
  onCapture,
  onRender,
  onPreviewFraming,
  onSetPanel,
  onSetCameraSource,
  onSetOutputMode,
  onSaveRender,
}) {
  const hold = useRef(null);
  const stopMove = useCallback(() => {
    if (hold.current) clearInterval(hold.current);
    hold.current = null;
  }, []);
  const startMove = (direction) => {
    stopMove();
    viewerRef.current?.move(direction);
    hold.current = setInterval(() => viewerRef.current?.move(direction), 110);
  };
  // A finger lifted outside the pad, or a mid-gesture unmount, would otherwise
  // leave the repeat timer walking the camera forever.
  useEffect(() => stopMove, [stopMove]);

  const showingAi = outputMode === "ai" && currentRender;

  return (
    <View style={styles.viewerWrap}>
      <WalkthroughViewer
        ref={viewerRef}
        layout={layout}
        roomConfigs={roomConfigs}
        settings={settings}
        mode={viewMode}
        roomIndex={selectedRoom}
        night={night}
        onReady={onReady}
        onSelect={onSelect}
        onSnapshot={onSnapshot}
        onComposition={onComposition}
      />

      {showingAi && (
        <View style={styles.aiLayer}>
          <Image source={{ uri: currentRender.image }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          <View style={styles.aiLayerBar}>
            <View style={styles.aiLayerCopy}>
              <Text style={styles.aiLayerTag}>AI STATIC RENDER</Text>
              <Text style={styles.aiLayerLabel} numberOfLines={1}>{currentRender.label}</Text>
            </View>
            <Pressable style={styles.aiLayerButton} onPress={() => onSaveRender(currentRender.image)}>
              <Ionicons name="download-outline" size={16} color={COLORS.white} />
            </Pressable>
            <Pressable style={styles.aiLayerButton} onPress={() => onSetOutputMode("live")}>
              <Ionicons name="cube-outline" size={16} color={COLORS.white} />
            </Pressable>
          </View>
        </View>
      )}

      {rendering && (
        <View style={styles.renderOverlay}>
          <ActivityIndicator size="large" color={COLORS.white} />
          <Text style={styles.renderTitle}>Rendering this exact view with AI</Text>
          <Text style={styles.renderBody}>
            {composition
              ? `${composition.viewpoint === "user" ? "Your viewpoint" : "Designer camera"} · ${composition.visibleFurnitureCount} of ${composition.furnitureCount} pieces framed · ${composition.doorCount} doors · ${composition.windowCount} windows`
              : "Preserving the plan, camera, furniture and design direction…"}
          </Text>
        </View>
      )}

      {/* Top controls */}
      <View style={styles.viewerTop} pointerEvents="box-none">
        <View style={styles.segmented}>
          {VIEW_MODES.map((item) => {
            const active = viewMode === item.key;
            return (
              <Pressable key={item.key} style={[styles.segment, active && styles.segmentActive]} onPress={() => onChangeMode(item.key)}>
                <Ionicons name={item.icon} size={14} color={active ? COLORS.white : COLORS.textSecondary} />
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable style={[styles.roundButton, night && styles.roundButtonActive]} onPress={onToggleNight}>
          <Ionicons name={night ? "moon" : "sunny-outline"} size={17} color={night ? COLORS.white : COLORS.textPrimary} />
        </Pressable>
      </View>

      {roomConfigs.length > 1 && viewMode !== "plan" && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.roomStrip} contentContainerStyle={styles.roomStripContent}>
          {roomConfigs.map((room, index) => (
            <Pressable
              key={`jump-${index}`}
              style={[styles.roomPill, selectedRoom === index && styles.roomPillActive]}
              onPress={() => onFocusRoom(index)}
            >
              <Text style={[styles.roomPillText, selectedRoom === index && styles.roomPillTextActive]} numberOfLines={1}>
                {room.name || room.roomType}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {inspected && !showingAi && (
        <View style={styles.inspector}>
          <View style={styles.inspectorHead}>
            <Text style={styles.inspectorTitle} numberOfLines={1}>{inspected.name}</Text>
            <Pressable onPress={() => onSelect(null)} hitSlop={LAYOUT.hitSlop}>
              <Ionicons name="close" size={16} color={COLORS.textSecondary} />
            </Pressable>
          </View>
          <Text style={styles.inspectorMeta}>{inspected.material}</Text>
          <Text style={styles.inspectorBody}>{inspected.detail}</Text>

          <View style={styles.inspectorActions}>
            <Pressable style={styles.inspectorIcon} onPress={() => viewerRef.current?.rotateSelected(-Math.PI / 12)}>
              <Ionicons name="return-up-back-outline" size={16} color={COLORS.textPrimary} />
            </Pressable>
            <Pressable style={styles.inspectorIcon} onPress={() => viewerRef.current?.rotateSelected(Math.PI / 12)}>
              <Ionicons name="return-up-forward-outline" size={16} color={COLORS.textPrimary} />
            </Pressable>
            <View style={styles.inspectorDivider} />
            {[
              { direction: "left", icon: "chevron-back" },
              { direction: "forward", icon: "chevron-up" },
              { direction: "back", icon: "chevron-down" },
              { direction: "right", icon: "chevron-forward" },
            ].map((item) => (
              <Pressable
                key={item.direction}
                style={styles.inspectorIcon}
                onPress={() => viewerRef.current?.moveSelected(item.direction)}
              >
                <Ionicons name={item.icon} size={16} color={COLORS.textPrimary} />
              </Pressable>
            ))}
            <View style={styles.inspectorDivider} />
            <Pressable style={styles.inspectorIcon} onPress={() => viewerRef.current?.resetSelected()}>
              <Ionicons name="refresh-outline" size={16} color={COLORS.textSecondary} />
            </Pressable>
          </View>
          <Text style={styles.inspectorHint}>Rotate, nudge, or reset to the designer&rsquo;s placement.</Text>
        </View>
      )}

      {/* AI panel */}
      {panel === "ai" && (
        <View style={styles.aiPanel}>
          <View style={styles.aiPanelHead}>
            <Text style={styles.aiPanelTitle}>AI render</Text>
            <Pressable onPress={() => onSetPanel(null)} hitSlop={LAYOUT.hitSlop}>
              <Ionicons name="close" size={17} color={COLORS.textSecondary} />
            </Pressable>
          </View>

          <View style={styles.outputToggle}>
            <Pressable style={[styles.outputOption, outputMode === "live" && styles.outputOptionActive]} onPress={() => onSetOutputMode("live")}>
              <Ionicons name="cube-outline" size={14} color={outputMode === "live" ? COLORS.white : COLORS.textSecondary} />
              <Text style={[styles.outputText, outputMode === "live" && styles.outputTextActive]}>Live 3D</Text>
            </Pressable>
            <Pressable
              style={[styles.outputOption, outputMode === "ai" && styles.outputOptionActive, !currentRender && styles.outputOptionDisabled]}
              disabled={!currentRender}
              onPress={() => onSetOutputMode("ai")}
            >
              <Ionicons name="sparkles-outline" size={14} color={outputMode === "ai" ? COLORS.white : COLORS.textSecondary} />
              <Text style={[styles.outputText, outputMode === "ai" && styles.outputTextActive]}>AI result</Text>
            </Pressable>
          </View>

          {viewMode !== "plan" && (
            <>
              <Text style={styles.fieldLabel}>Camera</Text>
              <View style={styles.outputToggle}>
                <Pressable style={[styles.outputOption, cameraSource === "designer" && styles.outputOptionActive]} onPress={() => onSetCameraSource("designer")}>
                  <Text style={[styles.outputText, cameraSource === "designer" && styles.outputTextActive]}>Designer</Text>
                </Pressable>
                <Pressable style={[styles.outputOption, cameraSource === "current" && styles.outputOptionActive]} onPress={() => onSetCameraSource("current")}>
                  <Text style={[styles.outputText, cameraSource === "current" && styles.outputTextActive]}>My view</Text>
                </Pressable>
              </View>
              {cameraSource === "designer" && (
                <Pressable style={styles.previewButton} onPress={onPreviewFraming}>
                  <Ionicons name="scan-outline" size={14} color={COLORS.primaryDark} />
                  <Text style={styles.previewButtonText}>Preview designer framing</Text>
                </Pressable>
              )}
            </>
          )}

          <Text style={styles.aiNote}>
            {viewMode === "plan"
              ? "The furnished, roof-open plan is preserved and rendered without overhead lighting."
              : composition
                ? `${composition.viewpoint === "user" ? "Your camera" : "The designer camera"} frames ${composition.visibleFurnitureCount} of ${composition.furnitureCount} pieces and preserves ${composition.doorCount} doors and ${composition.windowCount} windows.`
                : cameraSource === "designer"
                  ? "The camera picks the corner that frames the most furniture before rendering."
                  : "No repositioning — the AI receives the exact frame you are looking at."}
          </Text>

          <Pressable style={[styles.renderButton, rendering && styles.renderButtonBusy]} disabled={rendering} onPress={onRender}>
            {rendering ? <ActivityIndicator size="small" color={COLORS.white} /> : <Ionicons name="sparkles" size={16} color={COLORS.white} />}
            <Text style={styles.renderButtonText}>
              {rendering ? "Generating…" : viewMode === "plan" ? "Render bird view" : "Render with AI"}
            </Text>
          </Pressable>
        </View>
      )}

      {/* Bottom controls */}
      <View style={styles.viewerBottom} pointerEvents="box-none">
        {viewMode === "walk" && !showingAi && panel !== "ai" && !inspected && (
          <View style={styles.pad}>
            <PadButton icon="chevron-up" onIn={() => startMove("forward")} onOut={stopMove} style={styles.padUp} />
            <PadButton icon="chevron-back" onIn={() => startMove("left")} onOut={stopMove} style={styles.padLeft} />
            <PadButton icon="chevron-forward" onIn={() => startMove("right")} onOut={stopMove} style={styles.padRight} />
            <PadButton icon="chevron-down" onIn={() => startMove("back")} onOut={stopMove} style={styles.padDown} />
          </View>
        )}

        <View style={styles.actionBar}>
          <View style={styles.sceneBadge}>
            <View style={styles.sceneDot} />
            <Text style={styles.sceneBadgeText} numberOfLines={1}>
              {sceneInfo ? `${sceneInfo.rooms} rooms ready` : "Building scene…"}
            </Text>
          </View>
          <Pressable style={styles.aiButton} onPress={() => onSetPanel(panel === "ai" ? null : "ai")}>
            <Ionicons name="sparkles" size={17} color={COLORS.white} />
            <Text style={styles.aiButtonText}>Render</Text>
          </Pressable>
          <Pressable style={styles.iconAction} onPress={onCapture} disabled={busy === "capture"}>
            {busy === "capture" ? (
              <ActivityIndicator color={COLORS.textPrimary} size="small" />
            ) : (
              <Ionicons name="camera-outline" size={19} color={COLORS.textPrimary} />
            )}
          </Pressable>
        </View>

      </View>
    </View>
  );
}

// ── Small building blocks ──────────────────────────────────────────────────
function PadButton({ icon, onIn, onOut, style }) {
  return (
    <Pressable style={[styles.padButton, style]} onPressIn={onIn} onPressOut={onOut}>
      <Ionicons name={icon} size={20} color={COLORS.textPrimary} />
    </Pressable>
  );
}

function GhostButton({ icon, label, onPress, disabled, active, tone }) {
  const color = disabled
    ? COLORS.textTertiary
    : tone === "danger"
      ? COLORS.danger
      : active
        ? COLORS.primaryDark
        : COLORS.textPrimary;
  return (
    <Pressable style={[styles.ghost, active && styles.ghostActive, disabled && styles.ghostDisabled]} onPress={onPress} disabled={disabled}>
      <Ionicons name={icon} size={14} color={color} />
      <Text style={[styles.ghostText, { color }]}>{label}</Text>
    </Pressable>
  );
}

function Metric({ value, label }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function ChipRow({ label, options, value, onChange }) {
  return (
    <View style={styles.chipBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {options.map((option) => {
          const active = value === option;
          return (
            <Pressable key={option} style={[styles.chip, active && styles.chipActive]} onPress={() => onChange(option)}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{option}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function EmptyState({ text }) {
  return (
    <View style={styles.empty}>
      <Ionicons name="cube-outline" size={26} color={COLORS.textTertiary} />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

function SnapshotModal({ snapshot, kind, busy, onClose, onShare, onSaveGallery, onSaveCollection }) {
  const isRender = kind === "ai";
  return (
    <Modal transparent visible={!!snapshot} animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>{isRender ? "Your AI render" : "Save this view"}</Text>
          {snapshot ? (
            <View style={styles.sheetPreview}>
              <Image source={{ uri: snapshot }} style={styles.sheetImage} resizeMode="cover" />
            </View>
          ) : null}
          {isRender && <Text style={styles.sheetNote}>Already saved to your collection.</Text>}
          <View style={styles.sheetActions}>
            {!isRender && <SheetAction icon="albums-outline" label="Collection" onPress={onSaveCollection} loading={busy === "save"} />}
            <SheetAction icon="download-outline" label="Gallery" onPress={onSaveGallery} />
            <SheetAction icon="share-social-outline" label="Share" onPress={onShare} />
          </View>
          <Pressable style={styles.sheetClose} onPress={onClose}>
            <Text style={styles.sheetCloseText}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function SheetAction({ icon, label, onPress, loading }) {
  return (
    <Pressable style={styles.sheetAction} onPress={onPress} disabled={loading}>
      {loading ? <ActivityIndicator size="small" color={COLORS.primaryDark} /> : <Ionicons name={icon} size={19} color={COLORS.primaryDark} />}
      <Text style={styles.sheetActionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },

  // Header
  header: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.base },
  headerRow: { flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingTop: SPACING.sm },
  headerButton: {
    width: ms(36), height: ms(36), borderRadius: RADIUS.md,
    alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.16)",
  },
  headerCopy: { flex: 1 },
  headerEyebrow: { ...TYPE.overline, color: "rgba(255,255,255,0.68)" },
  headerTitle: { ...TYPE.h2, color: COLORS.white, marginTop: 1 },

  stepper: { flexDirection: "row", marginTop: SPACING.base, gap: SPACING.sm },
  step: { flex: 1, gap: 6 },
  stepTrack: { height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.22)" },
  stepTrackActive: { backgroundColor: COLORS.white },
  stepLabel: { ...TYPE.caption, color: "rgba(255,255,255,0.6)", fontSize: 10.5 },
  stepLabelActive: { color: COLORS.white },

  // Body
  body: { padding: SPACING.lg, paddingBottom: SPACING.xxxl },
  stageCopy: { ...TYPE.small, color: COLORS.textSecondary, marginBottom: SPACING.base },

  sourceRow: { flexDirection: "row", gap: SPACING.sm, marginBottom: SPACING.md },
  sourcePrimary: {
    flex: 1.35, minHeight: ms(64), flexDirection: "row", alignItems: "center", gap: SPACING.md,
    paddingHorizontal: SPACING.base, borderRadius: RADIUS.lg, backgroundColor: COLORS.primaryDark, ...SHADOW.brand,
  },
  sourceCopy: { flex: 1 },
  sourcePrimaryTitle: { ...TYPE.bodyStrong, color: COLORS.white },
  sourcePrimaryMeta: { ...TYPE.caption, color: "rgba(255,255,255,0.68)", marginTop: 2 },
  sourceSecondary: {
    flex: 1, minHeight: ms(64), alignItems: "center", justifyContent: "center", gap: 5,
    paddingHorizontal: SPACING.md, borderRadius: RADIUS.lg, backgroundColor: COLORS.primaryTint,
    borderWidth: 1, borderColor: COLORS.primarySoft,
  },
  sourceSecondaryText: { ...TYPE.caption, color: COLORS.primaryDark, textAlign: "center" },
  planNotice: {
    flexDirection: "row", alignItems: "flex-start", gap: SPACING.sm, marginBottom: SPACING.md,
    padding: SPACING.md, borderRadius: RADIUS.md, backgroundColor: COLORS.accentTint,
    borderWidth: 1, borderColor: COLORS.accentSoft,
  },
  planNoticeText: { flex: 1, ...TYPE.caption, color: COLORS.textSecondary, lineHeight: 18 },

  toolbarWrap: { marginHorizontal: -SPACING.lg, marginBottom: SPACING.sm },
  toolbar: { paddingHorizontal: SPACING.lg, gap: SPACING.sm },
  tool: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: SPACING.base, paddingVertical: SPACING.sm,
    borderRadius: RADIUS.pill, backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.border,
  },
  toolActive: { backgroundColor: COLORS.primaryDark, borderColor: COLORS.primaryDark },
  toolLabel: { ...TYPE.caption, color: COLORS.textSecondary },
  toolLabelActive: { color: COLORS.white },
  toolHint: { ...TYPE.caption, color: COLORS.textTertiary, marginBottom: SPACING.md },

  canvasActions: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.sm, marginTop: SPACING.md },
  ghost: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  ghostActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryTint },
  ghostDisabled: { opacity: 0.5 },
  ghostText: { ...TYPE.caption },

  metrics: { flexDirection: "row", gap: SPACING.sm, marginTop: SPACING.base },
  metric: {
    flex: 1, backgroundColor: COLORS.surface, borderRadius: RADIUS.md,
    paddingVertical: SPACING.md, alignItems: "center", borderWidth: 1, borderColor: COLORS.border,
  },
  metricValue: { ...TYPE.h3, color: COLORS.textPrimary },
  metricLabel: { ...TYPE.caption, color: COLORS.textTertiary, marginTop: 1 },

  card: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.base,
    marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.border, ...SHADOW.xs,
  },
  cardSectionTitle: { ...TYPE.h3, color: COLORS.textPrimary },
  cardSectionCopy: { ...TYPE.small, color: COLORS.textSecondary, marginTop: 3, marginBottom: SPACING.sm },
  cardHead: { flexDirection: "row", alignItems: "center", gap: SPACING.md, marginBottom: SPACING.xs },
  roomSwatch: { width: ms(10), height: ms(28), borderRadius: RADIUS.xs },

  selectionBar: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md, marginTop: SPACING.md,
    padding: SPACING.sm, paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border,
  },
  selectionName: { flex: 1, ...TYPE.bodyStrong, color: COLORS.textPrimary },
  selectionAction: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: SPACING.md, paddingVertical: 6, borderRadius: RADIUS.pill, backgroundColor: COLORS.dangerSoft },
  selectionActionText: { ...TYPE.caption },
  roomName: { flex: 1, ...TYPE.bodyStrong, color: COLORS.textPrimary, paddingVertical: 4 },
  roomArea: { ...TYPE.caption, color: COLORS.textTertiary },

  chipBlock: { marginTop: SPACING.sm },
  fieldLabel: { ...TYPE.overline, color: COLORS.textTertiary, marginBottom: SPACING.sm },
  chipRow: { gap: SPACING.sm, paddingRight: SPACING.base },
  chip: {
    paddingHorizontal: SPACING.base, paddingVertical: SPACING.sm, borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surfaceSunken, borderWidth: 1, borderColor: "transparent",
  },
  chipActive: { backgroundColor: COLORS.primaryDark, borderColor: COLORS.primaryDark },
  chipText: { ...TYPE.caption, color: COLORS.textSecondary },
  chipTextActive: { color: COLORS.white },

  notes: {
    minHeight: 92, borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceSunken,
    padding: SPACING.md, ...TYPE.small, color: COLORS.textPrimary, textAlignVertical: "top",
  },

  empty: { alignItems: "center", gap: SPACING.sm, paddingVertical: SPACING.xxl },
  emptyText: { ...TYPE.small, color: COLORS.textTertiary },

  // Footer
  footer: {
    flexDirection: "row", gap: SPACING.md, paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md, paddingBottom: SPACING.md,
    backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  footerGhost: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md,
    borderRadius: RADIUS.pill, backgroundColor: COLORS.surfaceSunken,
  },
  footerGhostText: { ...TYPE.bodyStrong, color: COLORS.textPrimary },
  footerPrimary: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SPACING.sm,
    paddingVertical: SPACING.md, borderRadius: RADIUS.pill, backgroundColor: COLORS.primaryDark, ...SHADOW.brand,
  },
  footerPrimaryDisabled: { backgroundColor: COLORS.disabled, shadowOpacity: 0, elevation: 0 },
  footerPrimaryText: { ...TYPE.bodyStrong, color: COLORS.white },

  // Viewer
  viewerWrap: { flex: 1 },
  viewerTop: {
    position: "absolute", top: SPACING.md, left: SPACING.base, right: SPACING.base,
    flexDirection: "row", alignItems: "center", gap: SPACING.sm,
  },
  segmented: { flex: 1, flexDirection: "row", backgroundColor: "rgba(255,255,255,0.94)", borderRadius: RADIUS.pill, padding: 3, ...SHADOW.sm },
  segment: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: SPACING.sm, borderRadius: RADIUS.pill },
  segmentActive: { backgroundColor: COLORS.primaryDark },
  segmentText: { ...TYPE.caption, color: COLORS.textSecondary },
  segmentTextActive: { color: COLORS.white },
  roundButton: { width: ms(40), height: ms(40), borderRadius: RADIUS.pill, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.94)", ...SHADOW.sm },
  roundButtonActive: { backgroundColor: COLORS.brand800 },

  roomStrip: { position: "absolute", top: ms(62), left: 0, right: 0, maxHeight: ms(40) },
  roomStripContent: { paddingHorizontal: SPACING.base, gap: SPACING.sm, alignItems: "center" },
  roomPill: { paddingHorizontal: SPACING.base, paddingVertical: SPACING.sm, borderRadius: RADIUS.pill, backgroundColor: "rgba(255,255,255,0.92)", maxWidth: 150 },
  roomPillActive: { backgroundColor: COLORS.accent },
  roomPillText: { ...TYPE.caption, color: COLORS.textSecondary },
  roomPillTextActive: { color: COLORS.white },

  inspector: {
    position: "absolute", left: SPACING.base, right: SPACING.base, bottom: ms(94),
    backgroundColor: "rgba(255,255,255,0.97)", borderRadius: RADIUS.lg, padding: SPACING.base, ...SHADOW.md,
  },
  inspectorHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: SPACING.sm },
  inspectorTitle: { ...TYPE.h3, color: COLORS.textPrimary, flex: 1, textTransform: "capitalize" },
  inspectorMeta: { ...TYPE.caption, color: COLORS.accentStrong, marginTop: 2 },
  inspectorBody: { ...TYPE.small, color: COLORS.textSecondary, marginTop: SPACING.xs },
  inspectorActions: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: SPACING.md },
  inspectorIcon: {
    width: ms(34), height: ms(34), borderRadius: RADIUS.sm,
    alignItems: "center", justifyContent: "center", backgroundColor: COLORS.surfaceSunken,
  },
  inspectorDivider: { width: 1, height: ms(20), backgroundColor: COLORS.border, marginHorizontal: 3 },
  inspectorHint: { ...TYPE.caption, color: COLORS.textTertiary, marginTop: SPACING.sm },

  // AI
  aiLayer: { ...StyleSheet.absoluteFillObject, backgroundColor: COLORS.surfaceInverse },
  aiLayerBar: {
    position: "absolute", left: SPACING.base, right: SPACING.base, bottom: SPACING.xl,
    flexDirection: "row", alignItems: "center", gap: SPACING.sm,
    backgroundColor: COLORS.overlay, borderRadius: RADIUS.lg, padding: SPACING.md,
  },
  aiLayerCopy: { flex: 1 },
  aiLayerTag: { ...TYPE.overline, color: "rgba(255,255,255,0.62)", fontSize: 9 },
  aiLayerLabel: { ...TYPE.bodyStrong, color: COLORS.white },
  aiLayerButton: { width: ms(36), height: ms(36), borderRadius: RADIUS.pill, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.18)" },

  renderOverlay: {
    ...StyleSheet.absoluteFillObject, backgroundColor: COLORS.overlay,
    alignItems: "center", justifyContent: "center", paddingHorizontal: SPACING.xxl, gap: SPACING.md,
  },
  renderTitle: { ...TYPE.h3, color: COLORS.white, textAlign: "center" },
  renderBody: { ...TYPE.small, color: "rgba(255,255,255,0.78)", textAlign: "center" },

  aiPanel: {
    position: "absolute", left: SPACING.base, right: SPACING.base, bottom: ms(92),
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.base, ...SHADOW.lg,
  },
  aiPanelHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: SPACING.md },
  aiPanelTitle: { ...TYPE.h3, color: COLORS.textPrimary },
  outputToggle: { flexDirection: "row", gap: SPACING.xs, backgroundColor: COLORS.surfaceSunken, borderRadius: RADIUS.pill, padding: 3, marginBottom: SPACING.md },
  outputOption: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: SPACING.sm, borderRadius: RADIUS.pill },
  outputOptionActive: { backgroundColor: COLORS.primaryDark },
  outputOptionDisabled: { opacity: 0.45 },
  outputText: { ...TYPE.caption, color: COLORS.textSecondary },
  outputTextActive: { color: COLORS.white },
  previewButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: SPACING.sm, borderRadius: RADIUS.pill, backgroundColor: COLORS.primaryTint, marginBottom: SPACING.md },
  previewButtonText: { ...TYPE.caption, color: COLORS.primaryDark },
  aiNote: { ...TYPE.caption, color: COLORS.textTertiary, marginBottom: SPACING.md },
  renderButton: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SPACING.sm,
    paddingVertical: SPACING.md, borderRadius: RADIUS.pill, backgroundColor: COLORS.accent,
  },
  renderButtonBusy: { opacity: 0.8 },
  renderButtonText: { ...TYPE.bodyStrong, color: COLORS.white },

  viewerBottom: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: SPACING.base, paddingBottom: SPACING.lg },
  pad: { width: ms(126), height: ms(126), alignSelf: "flex-end", marginBottom: SPACING.md },
  padButton: {
    position: "absolute", width: ms(42), height: ms(42), borderRadius: RADIUS.pill,
    alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.94)", ...SHADOW.sm,
  },
  padUp: { top: 0, left: ms(42) },
  padDown: { bottom: 0, left: ms(42) },
  padLeft: { left: 0, top: ms(42) },
  padRight: { right: 0, top: ms(42) },

  actionBar: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  aiButton: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SPACING.sm,
    paddingHorizontal: SPACING.base, height: ms(44), borderRadius: RADIUS.pill, backgroundColor: COLORS.accent, ...SHADOW.md,
  },
  aiButtonText: { ...TYPE.bodyStrong, color: COLORS.white },
  iconAction: { width: ms(44), height: ms(44), borderRadius: RADIUS.pill, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.94)", ...SHADOW.sm },

  sceneBadge: { flex: 1, minWidth: 0, height: ms(44), flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: SPACING.md, borderRadius: RADIUS.pill, backgroundColor: "rgba(255,255,255,0.94)", ...SHADOW.sm },
  sceneDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.success },
  sceneBadgeText: { flex: 1, ...TYPE.caption, color: COLORS.textSecondary, fontSize: 10 },

  // Snapshot sheet
  sheetBackdrop: { flex: 1, backgroundColor: COLORS.scrim, justifyContent: "flex-end" },
  sheet: { backgroundColor: COLORS.surface, borderTopLeftRadius: RADIUS.xxl, borderTopRightRadius: RADIUS.xxl, padding: SPACING.xl, paddingBottom: SPACING.xxl },
  sheetHandle: { width: 44, height: 4, borderRadius: 2, backgroundColor: COLORS.borderStrong, alignSelf: "center", marginBottom: SPACING.base },
  sheetTitle: { ...TYPE.h2, color: COLORS.textPrimary, marginBottom: SPACING.base },
  sheetPreview: { borderRadius: RADIUS.lg, overflow: "hidden", backgroundColor: COLORS.surfaceSunken },
  sheetImage: { width: "100%", height: ms(190) },
  sheetNote: { ...TYPE.caption, color: COLORS.textTertiary, marginTop: SPACING.sm },
  sheetActions: { flexDirection: "row", gap: SPACING.md, marginTop: SPACING.lg },
  sheetAction: { flex: 1, alignItems: "center", gap: 6, paddingVertical: SPACING.base, borderRadius: RADIUS.md, backgroundColor: COLORS.primaryTint },
  sheetActionText: { ...TYPE.caption, color: COLORS.primaryDark },
  sheetClose: { alignItems: "center", paddingVertical: SPACING.base, marginTop: SPACING.sm },
  sheetCloseText: { ...TYPE.bodyStrong, color: COLORS.textSecondary },

  noticeBackdrop: { flex: 1, backgroundColor: COLORS.scrim, alignItems: "center", justifyContent: "center", padding: SPACING.xl },
  noticeCard: { width: "100%", backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.xl, ...SHADOW.lg },
  noticeText: { ...TYPE.body, color: COLORS.textPrimary, textAlign: "center" },
  noticeButton: { marginTop: SPACING.lg, paddingVertical: SPACING.md, borderRadius: RADIUS.pill, backgroundColor: COLORS.primaryDark },
  noticeButtonText: { ...TYPE.bodyStrong, color: COLORS.white, textAlign: "center" },
});
