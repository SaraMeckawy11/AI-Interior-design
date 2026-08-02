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
  DEFAULT_CURVE_SETTINGS,
  GRID_METERS,
  OPENING_SPECS,
  OPENING_VARIANTS,
  PLAN_HEIGHT_METERS,
  PLAN_WIDTH_METERS,
  ROOM_TINTS,
  buildCurveGeometry,
  openingOnNearestWall,
  openingDefaults,
  polygonArea,
  snapOpeningToNearestWall,
} from "../../components/walkthrough/PlanCanvas";
import WalkthroughViewer from "../../components/walkthrough/WalkthroughViewer";
import { useAuthStore } from "../../authStore";
import COLORS from "../../constants/colors";
import { LAYOUT, RADIUS, SHADOW, SPACING, TYPE, ms } from "../../constants/theme";
import {
  COLOR_MOODS,
  CURTAIN_DESIGNS,
  DECOR_SETS,
  DEFAULT_WALKTHROUGH_SETTINGS,
  DESIGN_PROFILES,
  FLOOR_FINISHES,
  RUG_DESIGNS,
  ROOM_TYPES,
  WALKTHROUGH_STYLES,
  WALL_FINISHES,
  WALKTHROUGH_RENDERER_REVISION,
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
    label: "Rooms",
    title: "Assign every room",
    copy: "Name each space and choose its function. Room area stays visible while you make each choice.",
  },
  {
    key: "style",
    label: "Style",
    title: "Coordinate the whole home",
    copy: "Choose the shared finishes and mood before Livinai builds the exact furnished scene.",
  },
  {
    key: "walk",
    label: "Explore",
    title: "Explore and edit",
    copy: "Walk, orbit or use the bird view. Tap any furniture item to adjust it.",
  },
];

const CANVAS_RATIO = PLAN_HEIGHT_METERS / PLAN_WIDTH_METERS;
const STORAGE_KEY = "livinai-walkthrough-plan";
const PROJECTS_KEY = "livinai-walkthrough-project-library-v1";
const MAX_SAVED_PROJECTS = 12;

const createWalkthroughProjectId = () => `walkthrough-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const TOOLS = [
  { key: "pan", icon: "hand-left-outline", label: "Pan & zoom" },
  { key: "select", icon: "move-outline", label: "Edit" },
  { key: "rect", icon: "square-outline", label: "Quick room" },
  { key: "room", icon: "shapes-outline", label: "Outline" },
  { key: "door", icon: "log-in-outline", label: "Door" },
  { key: "window", icon: "browsers-outline", label: "Window" },
  { key: "balcony", icon: "sunny-outline", label: "Balcony" },
];

const TOOL_HINTS = {
  pan: "Drag to move around the plan. Pinch or use + and − to zoom at any time.",
  rect: "Drag on the grid to draw a rectangular room.",
  room: "Tap each corner, then tap the first corner again—or use Finish room—to close it.",
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
  const [canvasFocus, setCanvasFocus] = useState(false);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [roomEdgeType, setRoomEdgeType] = useState("straight");
  const [curveSettings, setCurveSettings] = useState(DEFAULT_CURVE_SETTINGS);
  const [rooms, setRooms] = useState([]);
  const [openings, setOpenings] = useState([]);
  const [draft, setDraft] = useState([]);
  const [roomConfigs, setRoomConfigs] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_WALKTHROUGH_SETTINGS);
  const [furnitureEdits, setFurnitureEdits] = useState({});
  const [selectedRoom, setSelectedRoom] = useState(0);
  const [selection, setSelection] = useState(null);
  const [planImage, setPlanImage] = useState(null);
  const [canvasAspect, setCanvasAspect] = useState(CANVAS_RATIO);
  const [detectedPixelsPerMeter, setDetectedPixelsPerMeter] = useState(null);
  const [detecting, setDetecting] = useState(false);
  const [planError, setPlanError] = useState("");
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);
  const [projectId, setProjectId] = useState(createWalkthroughProjectId);
  const [projectTitle, setProjectTitle] = useState("New 3D plan");
  const [projects, setProjects] = useState([]);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [projectReady, setProjectReady] = useState(false);
  const [saveTick, setSaveTick] = useState(0);
  const draftStepsRef = useRef([]);
  const explicitSaveRef = useRef(false);

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
  const [exactScene, setExactScene] = useState(null);
  const [exactSceneBaseUrl, setExactSceneBaseUrl] = useState("");
  const [exactSceneLoading, setExactSceneLoading] = useState(false);
  const [exactSceneError, setExactSceneError] = useState("");

  const canvasWidth = Math.round(LAYOUT.screenWidth - SPACING.md * 2);
  const canvasHeight = Math.round(canvasWidth * canvasAspect);
  const pixelsPerMeter = detectedPixelsPerMeter || canvasWidth / PLAN_WIDTH_METERS;

  const layout = useMemo(
    () =>
      buildLayout({
        rooms,
        doors: openings.filter((opening) => opening.kind === "door"),
        windows: openings.filter((opening) => opening.kind === "window"),
        balconies: openings.filter((opening) => opening.kind === "balcony"),
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

  useEffect(() => {
    if (stage !== STAGES.length - 1 || !layout.rooms.length) return undefined;
    const rendererRoot = (process.env.EXPO_PUBLIC_WALKTHROUGH_SERVER_URI || process.env.EXPO_PUBLIC_SERVER_URI || "").replace(/\/$/, "");
    if (!rendererRoot) {
      setExactScene(null);
      setExactSceneError("Exact renderer URL is not configured.");
      return undefined;
    }
    const controller = new AbortController();
    setExactScene(null);
    setExactSceneBaseUrl("");
    setSceneInfo(null);
    setExactSceneLoading(true);
    setExactSceneError("");
    (async () => {
      try {
        const response = await fetch(`${rendererRoot}/api/walkthrough/realtime/session`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            rendererRevision: WALKTHROUGH_RENDERER_REVISION,
            rooms: layout.rooms,
            doors: layout.doors.map((opening) => opening.slice(0, 2)),
            windows: layout.windows.map((opening) => opening.slice(0, 2)),
            balconies: layout.balconies.map((opening) => opening.slice(0, 2)),
            pixelsPerMeter: layout.pixelsPerMeter,
            roomConfigs,
            settings: { ...settings, useCatalog: true },
            width: 960,
            height: 600,
          }),
          signal: controller.signal,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.detail || data.message || "The exact Livinai scene is unavailable.");
        if (!data.modelUrl || !Array.isArray(data.furniture)) throw new Error("The exact renderer returned an incomplete scene.");
        if (controller.signal.aborted) return;
        const origin = rendererRoot.match(/^https?:\/\/[^/]+/)?.[0] || rendererRoot;
        setExactScene(data);
        setExactSceneBaseUrl(origin);
      } catch (error) {
        if (error.name === "AbortError") return;
        setExactScene(null);
        setExactSceneError(error.message || "The exact Livinai scene is unavailable.");
      } finally {
        if (!controller.signal.aborted) setExactSceneLoading(false);
      }
    })();
    return () => controller.abort();
  }, [layout, roomConfigs, settings, stage, token]);

  // ── Autosave ─────────────────────────────────────────────────────────────
  // Drawing a home takes real effort; geometry is saved in normalized canvas
  // coordinates so uploaded plans restore correctly on a different phone.
  const restored = useRef(false);

  const restoreSavedPlan = useCallback((saved) => {
    if (!saved) return;
    const sourceAspect = Number(saved.canvasAspect) || CANVAS_RATIO;
    const restoredAspect = Math.max(sourceAspect, CANVAS_RATIO);
    const restoredSourceHeight = canvasWidth * sourceAspect;
    const toPixels = saved.coordinateSpace === "normalized"
      ? (point) => [point[0] * canvasWidth, point[1] * restoredSourceHeight]
      : (point) => [point[0] * (canvasWidth / PLAN_WIDTH_METERS), point[1] * (canvasWidth / PLAN_WIDTH_METERS)];
    setCanvasAspect(restoredAspect);
    setDetectedPixelsPerMeter(saved.pixelsPerMeterRatio ? saved.pixelsPerMeterRatio * canvasWidth : null);
    setPlanImage(saved.planImage || null);
    setRooms((saved.rooms || []).map((room) => room.map(toPixels)));
    setRoomConfigs((saved.roomConfigs || []).map((room) => ({ ...room })));
    setOpenings((saved.openings || []).map((opening) => ({
      ...openingDefaults(opening.kind, opening.variant),
      ...opening,
      points: opening.points.map(toPixels),
    })));
    setSettings({ ...DEFAULT_WALKTHROUGH_SETTINGS, ...(saved.settings || {}), useCatalog: true });
    setFurnitureEdits(saved.furnitureEdits || {});
    setSelectedRoom(Number(saved.selectedRoom) || 0);
    setStage(Math.max(0, Math.min(STAGES.length - 1, Number(saved.stage) || 0)));
    setAiRenders(saved.aiRenders || {});
    setDraft([]);
    setSelection(null);
    setHistory([]);
    setFuture([]);
  }, [canvasWidth]);

  useEffect(() => {
    if (restored.current) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const values = await AsyncStorage.multiGet([PROJECTS_KEY, STORAGE_KEY]);
        if (cancelled) return;
        const savedProjects = JSON.parse(values[0][1] || "[]")
          .filter((project) => project?.id && project?.data)
          .sort((one, two) => String(two.updatedAt).localeCompare(String(one.updatedAt)));
        setProjects(savedProjects);
        if (savedProjects[0]) {
          setProjectId(savedProjects[0].id);
          setProjectTitle(savedProjects[0].title || "3D walkthrough");
          restoreSavedPlan(savedProjects[0].data);
        } else if (values[1][1]) {
          restoreSavedPlan(JSON.parse(values[1][1]));
        }
      } catch {}
      restored.current = true;
      setProjectReady(true);
    })();
    return () => { cancelled = true; };
  }, [restoreSavedPlan]);

  useEffect(() => {
    if (!restored.current || !projectReady || detecting || rendering) return undefined;
    const timer = setTimeout(async () => {
      const normalize = (point) => [point[0] / canvasWidth, point[1] / canvasHeight];
      const savedAt = new Date().toISOString();
      const data = {
        coordinateSpace: "normalized",
        canvasAspect,
        pixelsPerMeterRatio: pixelsPerMeter / canvasWidth,
        planImage,
        rooms: rooms.map((room) => room.map(normalize)),
        roomConfigs,
        openings: openings.map((opening) => ({ ...opening, points: opening.points.map(normalize) })),
        settings,
        furnitureEdits,
        selectedRoom,
        stage,
        aiRenders,
        savedAt,
      };
      try {
        const rawProjects = await AsyncStorage.getItem(PROJECTS_KEY);
        const storedProjects = JSON.parse(rawProjects || "[]").filter((project) => project?.id !== projectId);
        const project = {
          id: projectId,
          title: projectTitle.trim() || `${rooms.length || "New"} room walkthrough`,
          updatedAt: savedAt,
          thumbnail: Object.values(aiRenders).find((render) => render?.image)?.image || planImage || null,
          roomCount: rooms.length,
          data,
        };
        const nextProjects = [project, ...storedProjects]
          .sort((one, two) => String(two.updatedAt).localeCompare(String(one.updatedAt)))
          .slice(0, MAX_SAVED_PROJECTS);
        await AsyncStorage.multiSet([
          [STORAGE_KEY, JSON.stringify(data)],
          [PROJECTS_KEY, JSON.stringify(nextProjects)],
        ]);
        setProjects(nextProjects);
        if (explicitSaveRef.current) {
          explicitSaveRef.current = false;
          setNotice("3D plan saved to Projects.");
        }
      } catch {
        setNotice("This 3D plan could not be saved on this device.");
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [aiRenders, canvasAspect, canvasHeight, canvasWidth, detecting, furnitureEdits, openings, pixelsPerMeter, planImage, projectId, projectReady, projectTitle, rendering, roomConfigs, rooms, saveTick, selectedRoom, settings, stage]);

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
    // Architectural edits can change room-relative furnishing rules (including
    // balcony-aware seating), so stale world-space nudges must not be replayed
    // into a newly measured layout.
    setFurnitureEdits({});
  }, [currentPlanSnapshot]);

  useEffect(() => {
    if (!draft.length) draftStepsRef.current = [];
  }, [draft.length]);

  const addVertex = useCallback((point) => setDraft((current) => {
    draftStepsRef.current.push(current.length);
    return [...current, point];
  }), []);

  const addCurve = useCallback((samples) => {
    if (!samples?.length) return;
    setDraft((current) => {
      draftStepsRef.current.push(current.length);
      return [...current, ...samples];
    });
  }, []);

  const commitRoom = useCallback((polygon) => {
    rememberPlan();
    setRooms((existing) => [...existing, polygon]);
    setRoomConfigs((configs) => [...configs, configFor(configs.length)]);
    setSelectedRoom(rooms.length);
    setSelection({ kind: "room", index: rooms.length });
  }, [rememberPlan, rooms.length]);

  const closeRoom = useCallback((closingPoints) => {
    const automaticCurve = roomEdgeType === "rounded" && draft.length > 1
      ? buildCurveGeometry(draft[draft.length - 1], draft[0], curveSettings)?.samples?.slice(0, -1) || []
      : [];
    const extraPoints = Array.isArray(closingPoints) ? closingPoints : automaticCurve;
    const polygon = [...draft, ...extraPoints];
    if (polygon.length < 3) return;
    commitRoom(polygon);
    setDraft([]);
  }, [commitRoom, curveSettings, draft, roomEdgeType]);

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
    if (draft.length) {
      const previousLength = draftStepsRef.current.pop();
      return setDraft((current) => current.slice(0, previousLength ?? Math.max(0, current.length - 1)));
    }
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

  const applyOpeningPreset = useCallback((index, nextKind, variantLabel) => {
    const variants = OPENING_VARIANTS[nextKind] || OPENING_VARIANTS.door;
    const preset = variants.find((item) => item.label === variantLabel) || variants[0];
    rememberPlan();
    setOpenings((current) => current.map((opening, openingIndex) => {
      if (openingIndex !== index) return opening;
      const [start, end] = opening.points;
      const midpoint = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
      const length = Math.max(0.001, Math.hypot(end[0] - start[0], end[1] - start[1]));
      const direction = [(end[0] - start[0]) / length, (end[1] - start[1]) / length];
      const half = (preset.meters * pixelsPerMeter) / 2;
      const raw = [
        [midpoint[0] - direction[0] * half, midpoint[1] - direction[1] * half],
        [midpoint[0] + direction[0] * half, midpoint[1] + direction[1] * half],
      ];
      const points = snapOpeningToNearestWall(raw, rooms, nextKind, pixelsPerMeter) || opening.points;
      return { ...opening, kind: nextKind, points, ...openingDefaults(nextKind, preset.label) };
    }));
  }, [pixelsPerMeter, rememberPlan, rooms]);

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
    setFurnitureEdits({});
    setTool("rect");
  }, []);

  const saveCurrentProject = useCallback(() => {
    explicitSaveRef.current = true;
    setSaveTick((value) => value + 1);
  }, []);

  const openSavedProject = useCallback((project) => {
    if (!project?.data) return;
    setProjectId(project.id);
    setProjectTitle(project.title || "3D walkthrough");
    restoreSavedPlan(project.data);
    setProjectsOpen(false);
    setViewMode("walk");
    setOutputMode("live");
    setPanel(null);
    setInspected(null);
    setSceneInfo(null);
    setNotice("Saved 3D plan opened.");
  }, [restoreSavedPlan]);

  const newWalkthroughProject = useCallback(() => {
    setProjectId(createWalkthroughProjectId());
    setProjectTitle("New 3D plan");
    setStage(0);
    setTool("rect");
    setRooms([]);
    setOpenings([]);
    setDraft([]);
    setRoomConfigs([]);
    setSettings({ ...DEFAULT_WALKTHROUGH_SETTINGS });
    setFurnitureEdits({});
    setSelectedRoom(0);
    setSelection(null);
    setPlanImage(null);
    setCanvasAspect(CANVAS_RATIO);
    setDetectedPixelsPerMeter(null);
    setHistory([]);
    setFuture([]);
    setAiRenders({});
    setViewMode("walk");
    setOutputMode("live");
    setProjectsOpen(false);
    setNotice("New 3D plan ready.");
  }, []);

  const removeSavedProject = useCallback(async (project) => {
    if (!project?.id) return;
    try {
      const nextProjects = projects.filter((item) => item.id !== project.id);
      await AsyncStorage.setItem(PROJECTS_KEY, JSON.stringify(nextProjects));
      setProjects(nextProjects);
      if (project.id === projectId) newWalkthroughProject();
    } catch {
      setNotice("This saved plan could not be removed.");
    }
  }, [newWalkthroughProject, projectId, projects]);

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
    const aspect = Math.max(CANVAS_RATIO, Math.min(3, sourceHeight / sourceWidth));
    const extension = (asset.fileName?.split(".").pop() || asset.mimeType?.split("/").pop() || "jpg").replace(/[^a-z0-9]/gi, "");
    let stableUri = asset.uri;

    try {
      if (FileSystem.documentDirectory) {
        // Each saved project owns its source image. Reusing one filename made
        // a later upload silently replace the plan underneath older projects.
        stableUri = `${FileSystem.documentDirectory}livinai-walkthrough-plan-${projectId}.${extension}`;
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
    setFurnitureEdits({});
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
      const detectedAspect = Math.max(CANVAS_RATIO, Math.min(3, detectedHeight / detectedWidth));
      const displayScale = canvasWidth / detectedWidth;
      const toDisplay = (point) => [point[0] * displayScale, point[1] * displayScale];
      const detectedRooms = (data.rooms || []).map((room) => room.map(toDisplay));
      const detectedOpenings = [
        ...(data.doors || []).map((points) => ({ kind: "door", points: points.slice(0, 2).map(toDisplay), ...openingDefaults("door") })),
        ...(data.windows || []).map((points) => ({ kind: "window", points: points.slice(0, 2).map(toDisplay), ...openingDefaults("window") })),
        ...(data.balconies || []).map((points) => ({ kind: "balcony", points: points.slice(0, 2).map(toDisplay), ...openingDefaults("balcony") })),
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
  }, [canvasWidth, projectId, token]);

  const updateRoom = useCallback((index, key, value) => {
    setRoomConfigs((current) => current.map((room, i) => (i === index ? { ...room, [key]: value } : room)));
    if (key === "roomType" || key === "style") setFurnitureEdits({});
  }, []);

  const updateSetting = useCallback((key, value) => {
    setSettings((current) => ({ ...current, [key]: value }));
  }, []);

  const updateFurnitureEdit = useCallback((id, transform) => {
    if (!id) return;
    setFurnitureEdits((current) => {
      if (transform) return { ...current, [id]: transform };
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  const adjustCalculatedArea = useCallback((multiplier) => {
    setDetectedPixelsPerMeter(Math.max(8, Math.min(canvasWidth, pixelsPerMeter / Math.sqrt(multiplier))));
    setFurnitureEdits({});
  }, [canvasWidth, pixelsPerMeter]);

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
            <Pressable accessibilityLabel="Open saved 3D projects" onPress={() => setProjectsOpen(true)} hitSlop={LAYOUT.hitSlop} style={styles.headerButton}>
              <Ionicons name="folder-open-outline" size={19} color={COLORS.white} />
            </Pressable>
            <Pressable accessibilityLabel="Save 3D plan" onPress={saveCurrentProject} hitSlop={LAYOUT.hitSlop} style={styles.headerButton}>
              <Ionicons name="save-outline" size={19} color={COLORS.white} />
            </Pressable>
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
      {stage === STAGES.length - 1 ? (
        <WalkthroughStage
          viewerRef={viewerRef}
          layout={layout}
          roomConfigs={roomConfigs}
          settings={settings}
          furnitureEdits={furnitureEdits}
          exactScene={exactScene}
          exactSceneBaseUrl={exactSceneBaseUrl}
          exactSceneLoading={exactSceneLoading}
          exactSceneError={exactSceneError}
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
          onFurnitureChange={updateFurnitureEdit}
          onExactError={(message) => {
            setExactScene(null);
            setExactSceneError(message || "The exact scene could not be opened. Showing the offline preview.");
          }}
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
        <ScrollView contentContainerStyle={[styles.body, stage === 0 && styles.planBody]} showsVerticalScrollIndicator={false}>
          {!(stage === 0 && canvasFocus) && <Text style={styles.stageCopy}>{current.copy}</Text>}

          {!(stage === 0 && canvasFocus) && <Pressable style={styles.projectStatus} onPress={() => setProjectsOpen(true)}>
            <View style={styles.projectStatusIcon}>
              <Ionicons name="folder-open-outline" size={17} color={COLORS.primaryDark} />
            </View>
            <View style={styles.projectStatusCopy}>
              <Text style={styles.projectStatusTitle} numberOfLines={1}>{projectTitle || "New 3D plan"}</Text>
              <Text style={styles.projectStatusMeta}>{rooms.length} rooms · {openings.length} openings · Autosaves on this device</Text>
            </View>
            <Ionicons name="chevron-forward" size={17} color={COLORS.textTertiary} />
          </Pressable>}

          {stage === 0 && (
            <>
              {!canvasFocus && <>
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
              </>}

              <View style={styles.workspaceHeader}>
                <View style={styles.workspaceIcon}>
                  <Ionicons name="grid-outline" size={18} color={COLORS.primaryDark} />
                </View>
                <View style={styles.workspaceCopy}>
                  <Text style={styles.workspaceEyebrow}>Plan workspace · {TOOLS.find((item) => item.key === tool)?.label}</Text>
                  <Text style={styles.workspaceHint}>{TOOL_HINTS[tool]}</Text>
                </View>
                <View style={styles.workspaceBadge}>
                  <Text style={styles.workspaceBadgeValue}>{rooms.length}</Text>
                  <Text style={styles.workspaceBadgeLabel}>rooms</Text>
                </View>
                <Pressable
                  accessibilityLabel={canvasFocus ? "Exit canvas focus mode" : "Focus canvas editor"}
                  style={[styles.workspaceExpand, canvasFocus && styles.workspaceExpandActive]}
                  onPress={() => setCanvasFocus((value) => !value)}
                >
                  <Ionicons name={canvasFocus ? "contract-outline" : "expand-outline"} size={17} color={canvasFocus ? COLORS.white : COLORS.primaryDark} />
                </Pressable>
              </View>

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

              {tool === "room" && (
                <CurveControls
                  edgeType={roomEdgeType}
                  onChangeEdgeType={setRoomEdgeType}
                  settings={curveSettings}
                  onChangeSettings={setCurveSettings}
                />
              )}

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
                roomEdgeType={roomEdgeType}
                curveSettings={curveSettings}
                selectedRoom={selectedRoom}
                selection={selection}
                onAddVertex={addVertex}
                onAddCurve={addCurve}
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

              {tool === "select" && selection?.kind === "opening" && openings[selection.index] && (
                <View style={styles.openingEditor}>
                  <View style={styles.openingEditorHead}>
                    <View style={styles.openingEditorIcon}>
                      <Ionicons
                        name={openings[selection.index].kind === "door" ? "log-in-outline" : openings[selection.index].kind === "window" ? "browsers-outline" : "sunny-outline"}
                        size={18}
                        color={(OPENING_SPECS[openings[selection.index].kind] || OPENING_SPECS.door).color}
                      />
                    </View>
                    <View style={styles.openingEditorCopy}>
                      <Text style={styles.openingEditorTitle}>Opening settings</Text>
                      <Text style={styles.openingEditorText}>Change the type or preset; it stays centred and snapped to this wall.</Text>
                    </View>
                  </View>
                  <ChipRow
                    label="Opening type"
                    options={["door", "window", "balcony"]}
                    value={openings[selection.index].kind}
                    formatOption={(option) => (OPENING_SPECS[option] || OPENING_SPECS.door).label}
                    onChange={(kind) => applyOpeningPreset(selection.index, kind, OPENING_VARIANTS[kind][0].label)}
                  />
                  <ChipRow
                    label="Size and style"
                    options={OPENING_VARIANTS[openings[selection.index].kind].map((item) => item.label)}
                    value={openings[selection.index].variant || OPENING_VARIANTS[openings[selection.index].kind][0].label}
                    onChange={(variant) => applyOpeningPreset(selection.index, openings[selection.index].kind, variant)}
                  />
                </View>
              )}

              <View style={styles.canvasActions}>
                <GhostButton icon="checkmark-done-outline" label="Finish room" disabled={draft.length < 3} onPress={() => closeRoom()} />
                <GhostButton icon="arrow-undo-outline" label="Undo" disabled={!draft.length && !history.length} onPress={undo} />
                {!!draft.length && <GhostButton icon="close-outline" label="Cancel room" tone="danger" onPress={() => setDraft([])} />}
                <GhostButton icon="arrow-redo-outline" label="Redo" disabled={!future.length} onPress={redo} />
                <GhostButton icon="options-outline" label={snapToGrid ? "Grid snap" : "Free move"} active={snapToGrid} onPress={() => setSnapToGrid((v) => !v)} />
                <GhostButton icon="trash-outline" label="Clear lines" tone="danger" disabled={!rooms.length && !openings.length && !draft.length} onPress={clearPlanLines} />
              </View>

              <View style={styles.metrics}>
                <Metric value={rooms.length} label="Rooms" />
                <Metric value={openings.length} label="Openings" />
                <Metric value={`${totalArea.toFixed(0)} m²`} label="Area" />
              </View>

              {!!rooms.length && (
                <View style={styles.scaleEditor}>
                  <View style={styles.scaleEditorCopy}>
                    <Text style={styles.scaleEditorTitle}>Measured area</Text>
                    <Text style={styles.scaleEditorText}>
                      1 metre = {pixelsPerMeter.toFixed(0)} px. Adjust once if the plan has no printed dimensions; room areas and furniture update together.
                    </Text>
                  </View>
                  <View style={styles.scaleEditorActions}>
                    <GhostButton icon="remove-outline" label="Smaller" onPress={() => adjustCalculatedArea(0.9)} />
                    <GhostButton icon="add-outline" label="Larger" onPress={() => adjustCalculatedArea(1.1)} />
                  </View>
                </View>
              )}

            </>
          )}

          {stage === 1 && (
            <>
              {roomConfigs.length === 0 && <EmptyState text="Go back and draw at least one room." />}
              {!!roomConfigs.length && (
                <View style={styles.stageSummary}>
                  <View style={styles.stageSummaryIcon}>
                    <Ionicons name="home-outline" size={19} color={COLORS.primaryDark} />
                  </View>
                  <View style={styles.stageSummaryCopy}>
                    <Text style={styles.stageSummaryTitle}>{roomConfigs.length} rooms ready to assign</Text>
                    <Text style={styles.stageSummaryText}>{totalArea.toFixed(1)} m² total measured area</Text>
                  </View>
                </View>
              )}
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

            </>
          )}

          {stage === 2 && (
            <>
              {!!roomConfigs.length && (
                <View style={styles.exactSourceCard}>
                  <View style={styles.exactSourceIcon}>
                    <Ionicons name="shield-checkmark-outline" size={22} color={COLORS.primaryDark} />
                  </View>
                  <View style={styles.exactSourceCopy}>
                    <Text style={styles.exactSourceTitle}>Exact Livinai furniture engine</Text>
                    <Text style={styles.exactSourceText}>
                      Explore loads the same Interior_Plan models, dimensions and placement used by Livinai_web.
                    </Text>
                  </View>
                </View>
              )}
              {!!roomConfigs.length && (
                <View style={styles.card}>
                  <Text style={styles.cardSectionTitle}>Whole-home direction</Text>
                  <Text style={styles.cardSectionCopy}>A short, focused brief keeps every room coordinated.</Text>
                  <ChipRow label="Design profile" options={DESIGN_PROFILES} value={settings.designProfile} onChange={(v) => updateSetting("designProfile", v)} />
                  <ChipRow label="Colour mood" options={COLOR_MOODS} value={settings.colorMood} onChange={(v) => updateSetting("colorMood", v)} />
                  <ChipRow label="Floor finish" options={FLOOR_FINISHES} value={settings.floorFinish} onChange={(v) => updateSetting("floorFinish", v)} />
                  <ChipRow label="Wall finish" options={WALL_FINISHES} value={settings.wallFinish} onChange={(v) => updateSetting("wallFinish", v)} />
                  <ChipRow label="Rug design" options={RUG_DESIGNS} value={settings.rugDesign} onChange={(v) => updateSetting("rugDesign", v)} />
                  <ChipRow label="Window treatment" options={CURTAIN_DESIGNS} value={settings.curtainDesign} onChange={(v) => updateSetting("curtainDesign", v)} />
                  <ChipRow label="Decor set" options={DECOR_SETS} value={settings.decorSet} onChange={(v) => updateSetting("decorSet", v)} />
                  <Pressable style={styles.settingToggle} onPress={() => updateSetting("freeExplore", !settings.freeExplore)}>
                    <View style={[styles.settingToggleIcon, settings.freeExplore && styles.settingToggleIconActive]}>
                      {settings.freeExplore && <Ionicons name="checkmark" size={13} color={COLORS.white} />}
                    </View>
                    <View style={styles.settingToggleCopy}>
                      <Text style={styles.settingToggleTitle}>Free explore</Text>
                      <Text style={styles.settingToggleText}>Walk through walls while reviewing furniture placement.</Text>
                    </View>
                    <Ionicons name="move-outline" size={18} color={COLORS.textTertiary} />
                  </Pressable>
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
      {stage < STAGES.length - 1 && (
        <SafeAreaView edges={["bottom"]} style={styles.footer}>
          <Pressable style={styles.footerGhost} onPress={goBack}>
            <Ionicons name="arrow-back" size={16} color={COLORS.textPrimary} />
            <Text style={styles.footerGhostText}>Back</Text>
          </Pressable>
          <Pressable style={[styles.footerPrimary, !canContinue && styles.footerPrimaryDisabled]} disabled={!canContinue} onPress={goNext}>
            <Text style={styles.footerPrimaryText}>{stage === STAGES.length - 2 ? "Open exact walkthrough" : "Continue"}</Text>
            <Ionicons name="arrow-forward" size={16} color={COLORS.white} />
          </Pressable>
        </SafeAreaView>
      )}

      <ProjectLibraryModal
        visible={projectsOpen}
        projects={projects}
        currentId={projectId}
        title={projectTitle}
        onChangeTitle={setProjectTitle}
        onClose={() => setProjectsOpen(false)}
        onSave={saveCurrentProject}
        onOpen={openSavedProject}
        onNew={newWalkthroughProject}
        onRemove={removeSavedProject}
      />

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
  furnitureEdits,
  exactScene,
  exactSceneBaseUrl,
  exactSceneLoading,
  exactSceneError,
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
  onFurnitureChange,
  onExactError,
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
        furnitureEdits={furnitureEdits}
        exactScene={exactScene}
        exactBaseUrl={exactSceneBaseUrl}
        mode={viewMode}
        roomIndex={selectedRoom}
        night={night}
        onReady={onReady}
        onSelect={onSelect}
        onSnapshot={onSnapshot}
        onComposition={onComposition}
        onFurnitureChange={onFurnitureChange}
        onError={exactScene ? onExactError : undefined}
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

      {roomConfigs.length > 1 && viewMode === "walk" && (
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

      {!showingAi && !inspected && panel !== "ai" && (
        <View style={[styles.viewerGuidance, roomConfigs.length > 1 && viewMode === "walk" && styles.viewerGuidanceWithRooms]} pointerEvents="none">
          <Ionicons name={viewMode === "plan" ? "scan-outline" : "hand-left-outline"} size={14} color={COLORS.white} />
          <Text style={styles.viewerGuidanceText} numberOfLines={1}>
            {viewMode === "walk" ? "Drag to look · Tap furniture to edit" : viewMode === "orbit" ? "Drag to orbit · Tap an item to edit" : "Drag to rotate the furnished plan"}
          </Text>
        </View>
      )}

      {inspected && !showingAi && (
        <View style={styles.inspector}>
          <View style={styles.inspectorHead}>
            <View style={styles.inspectorObjectIcon}>
              <Ionicons name="cube-outline" size={17} color={COLORS.primaryDark} />
            </View>
            <View style={styles.inspectorHeadingCopy}>
              <Text style={styles.inspectorEyebrow}>Selected furniture</Text>
              <Text style={styles.inspectorTitle} numberOfLines={1}>{inspected.name}</Text>
            </View>
            <Pressable style={styles.inspectorClose} onPress={() => onSelect(null)} hitSlop={LAYOUT.hitSlop}>
              <Ionicons name="close" size={16} color={COLORS.textSecondary} />
            </Pressable>
          </View>
          <Text style={styles.inspectorMeta}>{inspected.material}</Text>
          <Text style={styles.inspectorBody}>{inspected.detail}</Text>

          <View style={styles.inspectorActions}>
            <View style={styles.inspectorActionGroup}>
              <Text style={styles.inspectorActionLabel}>Rotate</Text>
              <View style={styles.inspectorActionRow}>
                <Pressable accessibilityLabel="Rotate furniture left" style={styles.inspectorIcon} onPress={() => viewerRef.current?.rotateSelected(-Math.PI / 12)}>
                  <Ionicons name="return-up-back-outline" size={17} color={COLORS.textPrimary} />
                </Pressable>
                <Pressable accessibilityLabel="Rotate furniture right" style={styles.inspectorIcon} onPress={() => viewerRef.current?.rotateSelected(Math.PI / 12)}>
                  <Ionicons name="return-up-forward-outline" size={17} color={COLORS.textPrimary} />
                </Pressable>
              </View>
            </View>
            <View style={[styles.inspectorActionGroup, styles.inspectorPositionGroup]}>
              <Text style={styles.inspectorActionLabel}>Position</Text>
              <View style={styles.inspectorActionRow}>
                {[
                  { direction: "left", icon: "chevron-back" },
                  { direction: "forward", icon: "chevron-up" },
                  { direction: "back", icon: "chevron-down" },
                  { direction: "right", icon: "chevron-forward" },
                ].map((item) => (
                  <Pressable
                    accessibilityLabel={`Move furniture ${item.direction}`}
                    key={item.direction}
                    style={styles.inspectorIcon}
                    onPress={() => viewerRef.current?.moveSelected(item.direction)}
                  >
                    <Ionicons name={item.icon} size={17} color={COLORS.textPrimary} />
                  </Pressable>
                ))}
              </View>
            </View>
            <View style={styles.inspectorActionGroup}>
              <Text style={styles.inspectorActionLabel}>Reset</Text>
              <Pressable accessibilityLabel="Reset furniture placement" style={styles.inspectorIcon} onPress={() => viewerRef.current?.resetSelected()}>
                <Ionicons name="refresh-outline" size={17} color={COLORS.textSecondary} />
              </Pressable>
            </View>
          </View>
          <Text style={styles.inspectorHint}>Every adjustment is saved automatically with this 3D project.</Text>
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
              {sceneInfo?.exact
                ? `${sceneInfo.objects} exact Livinai pieces`
                : exactSceneLoading
                  ? "Syncing exact Livinai scene…"
                  : exactSceneError
                    ? "Offline preview"
                    : sceneInfo
                      ? `${sceneInfo.rooms} rooms ready`
                      : "Building scene…"}
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

function CurveControls({ edgeType, onChangeEdgeType, settings, onChangeSettings }) {
  const update = (key, value) => onChangeSettings((current) => ({ ...current, [key]: value }));
  return (
    <View style={styles.curveCard}>
      <View style={styles.curveHead}>
        <View style={styles.curveHeadCopy}>
          <Text style={styles.curveTitle}>Wall shape</Text>
          <Text style={styles.curveCopy}>Rounded walls are stored as editable plan points and carry into 3D.</Text>
        </View>
        <View style={styles.curveSegmented}>
          {[
            ["straight", "Straight"],
            ["rounded", "Rounded"],
          ].map(([value, label]) => (
            <Pressable
              key={value}
              style={[styles.curveSegment, edgeType === value && styles.curveSegmentActive]}
              onPress={() => onChangeEdgeType(value)}
            >
              <Text style={[styles.curveSegmentText, edgeType === value && styles.curveSegmentTextActive]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      {edgeType === "rounded" && (
        <View style={styles.curveSettings}>
          <View style={styles.curveDirection}>
            <Text style={styles.curveSettingLabel}>Curve direction</Text>
            <View style={styles.curveDirectionButtons}>
              <Pressable style={[styles.curveDirectionButton, settings.direction === -1 && styles.curveDirectionButtonActive]} onPress={() => update("direction", -1)}>
                <Text style={[styles.curveDirectionText, settings.direction === -1 && styles.curveDirectionTextActive]}>Left</Text>
              </Pressable>
              <Pressable style={[styles.curveDirectionButton, settings.direction === 1 && styles.curveDirectionButtonActive]} onPress={() => update("direction", 1)}>
                <Text style={[styles.curveDirectionText, settings.direction === 1 && styles.curveDirectionTextActive]}>Right</Text>
              </Pressable>
            </View>
          </View>
          <CurveStepper label="Strength" value={settings.intensity} min={0} max={100} step={10} suffix="%" onChange={(value) => update("intensity", value)} />
          <CurveStepper label="Bend position" value={settings.position} min={15} max={85} step={5} suffix="%" onChange={(value) => update("position", value)} />
          <CurveStepper label="Tilt" value={settings.angle} min={-55} max={55} step={5} suffix="°" onChange={(value) => update("angle", value)} />
          <Pressable style={styles.curveReset} onPress={() => onChangeSettings({ ...DEFAULT_CURVE_SETTINGS })}>
            <Ionicons name="refresh-outline" size={13} color={COLORS.primaryDark} />
            <Text style={styles.curveResetText}>Reset curve</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function CurveStepper({ label, value, min, max, step, suffix, onChange }) {
  return (
    <View style={styles.curveStepper}>
      <Text style={styles.curveSettingLabel}>{label}</Text>
      <View style={styles.curveStepperActions}>
        <Pressable style={styles.curveStepButton} disabled={value <= min} onPress={() => onChange(Math.max(min, value - step))}>
          <Ionicons name="remove" size={14} color={value <= min ? COLORS.textTertiary : COLORS.textPrimary} />
        </Pressable>
        <Text style={styles.curveStepValue}>{value}{suffix}</Text>
        <Pressable style={styles.curveStepButton} disabled={value >= max} onPress={() => onChange(Math.min(max, value + step))}>
          <Ionicons name="add" size={14} color={value >= max ? COLORS.textTertiary : COLORS.textPrimary} />
        </Pressable>
      </View>
    </View>
  );
}

function ProjectLibraryModal({ visible, projects, currentId, title, onChangeTitle, onClose, onSave, onOpen, onNew, onRemove }) {
  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.projectBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <SafeAreaView edges={["bottom"]} style={styles.projectSheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.projectHead}>
            <View style={styles.projectHeadCopy}>
              <Text style={styles.projectEyebrow}>Saved on this device</Text>
              <Text style={styles.projectTitle}>3D projects</Text>
            </View>
            <Pressable style={styles.projectClose} onPress={onClose}>
              <Ionicons name="close" size={20} color={COLORS.textPrimary} />
            </Pressable>
          </View>

          <View style={styles.currentProjectCard}>
            <Text style={styles.fieldLabel}>Current project name</Text>
            <TextInput
              value={title}
              onChangeText={onChangeTitle}
              style={styles.projectNameInput}
              placeholder="Name this 3D plan"
              placeholderTextColor={COLORS.placeholderText}
              maxLength={60}
            />
            <View style={styles.currentProjectActions}>
              <Pressable style={styles.projectSaveButton} onPress={onSave}>
                <Ionicons name="save-outline" size={16} color={COLORS.white} />
                <Text style={styles.projectSaveText}>Save current plan</Text>
              </Pressable>
              <Pressable style={styles.projectNewButton} onPress={onNew}>
                <Ionicons name="add" size={17} color={COLORS.primaryDark} />
                <Text style={styles.projectNewText}>New plan</Text>
              </Pressable>
            </View>
          </View>

          <ScrollView style={styles.projectList} contentContainerStyle={styles.projectListContent} showsVerticalScrollIndicator={false}>
            {projects.length ? projects.map((project) => (
              <Pressable key={project.id} style={[styles.projectCard, project.id === currentId && styles.projectCardActive]} onPress={() => onOpen(project)}>
                <View style={styles.projectThumbnail}>
                  {project.thumbnail
                    ? <Image source={{ uri: project.thumbnail }} style={styles.projectThumbnailImage} resizeMode="cover" />
                    : <Ionicons name="cube-outline" size={23} color={COLORS.primaryDark} />}
                </View>
                <View style={styles.projectCardCopy}>
                  <Text style={styles.projectCardTitle} numberOfLines={1}>{project.title || "3D walkthrough"}</Text>
                  <Text style={styles.projectCardMeta}>
                    {project.roomCount || project.data?.rooms?.length || 0} rooms · {new Date(project.updatedAt).toLocaleDateString()}
                  </Text>
                </View>
                {project.id === currentId ? (
                  <View style={styles.projectCurrentPill}><Text style={styles.projectCurrentText}>Current</Text></View>
                ) : (
                  <Ionicons name="chevron-forward" size={17} color={COLORS.textTertiary} />
                )}
                <Pressable
                  hitSlop={LAYOUT.hitSlop}
                  style={styles.projectDelete}
                  onPress={(event) => {
                    event.stopPropagation();
                    onRemove(project);
                  }}
                >
                  <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
                </Pressable>
              </Pressable>
            )) : (
              <View style={styles.projectEmpty}>
                <Ionicons name="folder-open-outline" size={27} color={COLORS.textTertiary} />
                <Text style={styles.projectEmptyTitle}>No saved 3D plans yet</Text>
                <Text style={styles.projectEmptyText}>Save the current plan, then reopen it here whenever you want.</Text>
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
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

function ChipRow({ label, options, value, onChange, formatOption = (option) => option }) {
  return (
    <View style={styles.chipBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {options.map((option) => {
          const active = value === option;
          return (
            <Pressable key={option} style={[styles.chip, active && styles.chipActive]} onPress={() => onChange(option)}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{formatOption(option)}</Text>
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
  planBody: { paddingHorizontal: SPACING.md },
  stageCopy: { ...TYPE.small, color: COLORS.textSecondary, marginBottom: SPACING.base },
  projectStatus: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md,
    marginBottom: SPACING.base, padding: SPACING.md, borderRadius: RADIUS.lg,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, ...SHADOW.xs,
  },
  projectStatusIcon: {
    width: 36, height: 36, alignItems: "center", justifyContent: "center",
    borderRadius: RADIUS.md, backgroundColor: COLORS.primaryTint,
  },
  projectStatusCopy: { flex: 1, minWidth: 0 },
  projectStatusTitle: { ...TYPE.bodyStrong, color: COLORS.textPrimary },
  projectStatusMeta: { ...TYPE.caption, color: COLORS.textTertiary, marginTop: 2, fontSize: 9.5 },

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

  workspaceHeader: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md,
    marginBottom: SPACING.sm, paddingHorizontal: SPACING.xs,
  },
  workspaceIcon: {
    width: 40, height: 40, borderRadius: RADIUS.md,
    alignItems: "center", justifyContent: "center", backgroundColor: COLORS.primaryTint,
  },
  workspaceCopy: { flex: 1 },
  workspaceEyebrow: { ...TYPE.overline, color: COLORS.primaryDark, fontSize: 9.5 },
  workspaceHint: { ...TYPE.caption, color: COLORS.textSecondary, marginTop: 2, lineHeight: 16 },
  workspaceBadge: {
    minWidth: 48, alignItems: "center", paddingHorizontal: SPACING.sm, paddingVertical: 5,
    borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceSunken,
  },
  workspaceBadgeValue: { ...TYPE.bodyStrong, color: COLORS.textPrimary, lineHeight: 18 },
  workspaceBadgeLabel: { ...TYPE.caption, color: COLORS.textTertiary, fontSize: 9 },
  workspaceExpand: {
    width: 40, height: 40, borderRadius: RADIUS.md,
    alignItems: "center", justifyContent: "center", backgroundColor: COLORS.primaryTint,
  },
  workspaceExpandActive: { backgroundColor: COLORS.primaryDark },
  toolbarWrap: {
    marginBottom: SPACING.sm, borderRadius: RADIUS.lg,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  toolbar: { padding: 5, gap: 4 },
  tool: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md, backgroundColor: "transparent",
    borderWidth: 1, borderColor: "transparent",
  },
  toolActive: { backgroundColor: COLORS.primaryDark, borderColor: COLORS.primaryDark },
  toolLabel: { ...TYPE.caption, color: COLORS.textSecondary },
  toolLabelActive: { color: COLORS.white },
  toolHint: { ...TYPE.caption, color: COLORS.textTertiary, marginBottom: SPACING.md },

  curveCard: {
    marginBottom: SPACING.md, padding: SPACING.md, borderRadius: RADIUS.lg,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  curveHead: { gap: SPACING.md },
  curveHeadCopy: { gap: 2 },
  curveTitle: { ...TYPE.bodyStrong, color: COLORS.textPrimary },
  curveCopy: { ...TYPE.caption, color: COLORS.textTertiary, lineHeight: 17 },
  curveSegmented: { flexDirection: "row", padding: 3, borderRadius: RADIUS.pill, backgroundColor: COLORS.surfaceSunken },
  curveSegment: { flex: 1, alignItems: "center", paddingVertical: SPACING.sm, borderRadius: RADIUS.pill },
  curveSegmentActive: { backgroundColor: COLORS.primaryDark },
  curveSegmentText: { ...TYPE.caption, color: COLORS.textSecondary },
  curveSegmentTextActive: { color: COLORS.white },
  curveSettings: { marginTop: SPACING.md, gap: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: SPACING.md },
  curveDirection: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: SPACING.md },
  curveDirectionButtons: { flexDirection: "row", gap: 4 },
  curveDirectionButton: { paddingHorizontal: SPACING.md, paddingVertical: 6, borderRadius: RADIUS.pill, backgroundColor: COLORS.surfaceSunken },
  curveDirectionButtonActive: { backgroundColor: COLORS.primaryTint },
  curveDirectionText: { ...TYPE.caption, color: COLORS.textSecondary },
  curveDirectionTextActive: { color: COLORS.primaryDark },
  curveSettingLabel: { ...TYPE.caption, color: COLORS.textSecondary },
  curveStepper: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 34 },
  curveStepperActions: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  curveStepButton: { width: 30, height: 30, alignItems: "center", justifyContent: "center", borderRadius: RADIUS.pill, backgroundColor: COLORS.surfaceSunken },
  curveStepValue: { minWidth: 46, ...TYPE.caption, color: COLORS.textPrimary, textAlign: "center" },
  curveReset: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 5, paddingVertical: 4 },
  curveResetText: { ...TYPE.caption, color: COLORS.primaryDark },

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
  scaleEditor: {
    marginTop: SPACING.md, padding: SPACING.md, gap: SPACING.md,
    borderRadius: RADIUS.md, backgroundColor: COLORS.primaryTint,
    borderWidth: 1, borderColor: COLORS.primarySoft,
  },
  scaleEditorCopy: { gap: 2 },
  scaleEditorTitle: { ...TYPE.bodyStrong, color: COLORS.primaryDark },
  scaleEditorText: { ...TYPE.caption, color: COLORS.textSecondary, lineHeight: 17 },
  scaleEditorActions: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.sm },

  stageSummary: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md,
    marginBottom: SPACING.md, padding: SPACING.base, borderRadius: RADIUS.lg,
    backgroundColor: COLORS.primaryTint, borderWidth: 1, borderColor: COLORS.primarySoft,
  },
  stageSummaryIcon: {
    width: 42, height: 42, alignItems: "center", justifyContent: "center",
    borderRadius: RADIUS.md, backgroundColor: COLORS.surface,
  },
  stageSummaryCopy: { flex: 1 },
  stageSummaryTitle: { ...TYPE.bodyStrong, color: COLORS.primaryDark },
  stageSummaryText: { ...TYPE.caption, color: COLORS.textSecondary, marginTop: 2 },
  exactSourceCard: {
    flexDirection: "row", alignItems: "flex-start", gap: SPACING.md,
    marginBottom: SPACING.md, padding: SPACING.base, borderRadius: RADIUS.lg,
    backgroundColor: COLORS.primaryTint, borderWidth: 1, borderColor: COLORS.primarySoft,
  },
  exactSourceIcon: {
    width: 44, height: 44, alignItems: "center", justifyContent: "center",
    borderRadius: RADIUS.md, backgroundColor: COLORS.surface,
  },
  exactSourceCopy: { flex: 1 },
  exactSourceTitle: { ...TYPE.bodyStrong, color: COLORS.primaryDark },
  exactSourceText: { ...TYPE.caption, color: COLORS.textSecondary, marginTop: 3, lineHeight: 17 },

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
  openingEditor: {
    marginTop: SPACING.sm, padding: SPACING.base, borderRadius: RADIUS.lg,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, ...SHADOW.xs,
  },
  openingEditorHead: { flexDirection: "row", alignItems: "center", gap: SPACING.md },
  openingEditorIcon: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceSunken },
  openingEditorCopy: { flex: 1 },
  openingEditorTitle: { ...TYPE.bodyStrong, color: COLORS.textPrimary },
  openingEditorText: { ...TYPE.caption, color: COLORS.textTertiary, marginTop: 2, lineHeight: 16 },
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

  settingToggle: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md, marginTop: SPACING.lg,
    padding: SPACING.md, borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceSunken,
  },
  settingToggleIcon: { width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, borderColor: COLORS.border, alignItems: "center", justifyContent: "center" },
  settingToggleIconActive: { backgroundColor: COLORS.primaryDark, borderColor: COLORS.primaryDark },
  settingToggleCopy: { flex: 1 },
  settingToggleTitle: { ...TYPE.bodyStrong, color: COLORS.textPrimary },
  settingToggleText: { ...TYPE.caption, color: COLORS.textTertiary, marginTop: 2 },

  notes: {
    minHeight: 92, borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceSunken,
    padding: SPACING.md, ...TYPE.small, color: COLORS.textPrimary, textAlignVertical: "top",
  },

  projectBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: COLORS.scrim },
  projectSheet: {
    maxHeight: "88%", backgroundColor: COLORS.background,
    borderTopLeftRadius: RADIUS.xxl, borderTopRightRadius: RADIUS.xxl,
    paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm,
  },
  projectHead: { flexDirection: "row", alignItems: "center", gap: SPACING.md, marginBottom: SPACING.base },
  projectHeadCopy: { flex: 1 },
  projectEyebrow: { ...TYPE.overline, color: COLORS.primary },
  projectTitle: { ...TYPE.h2, color: COLORS.textPrimary, marginTop: 2 },
  projectClose: { width: 38, height: 38, borderRadius: RADIUS.pill, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.surfaceSunken },
  currentProjectCard: { padding: SPACING.base, borderRadius: RADIUS.lg, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, ...SHADOW.xs },
  projectNameInput: { ...TYPE.bodyStrong, color: COLORS.textPrimary, paddingHorizontal: SPACING.md, paddingVertical: SPACING.md, borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceSunken },
  currentProjectActions: { flexDirection: "row", gap: SPACING.sm, marginTop: SPACING.md },
  projectSaveButton: { flex: 1.2, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: SPACING.md, borderRadius: RADIUS.pill, backgroundColor: COLORS.primaryDark },
  projectSaveText: { ...TYPE.caption, color: COLORS.white },
  projectNewButton: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: SPACING.md, borderRadius: RADIUS.pill, backgroundColor: COLORS.primaryTint },
  projectNewText: { ...TYPE.caption, color: COLORS.primaryDark },
  projectList: { marginTop: SPACING.base },
  projectListContent: { gap: SPACING.sm, paddingBottom: SPACING.xl },
  projectCard: { flexDirection: "row", alignItems: "center", gap: SPACING.md, padding: SPACING.md, borderRadius: RADIUS.lg, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  projectCardActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryTint },
  projectThumbnail: { width: 52, height: 52, borderRadius: RADIUS.md, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: COLORS.surfaceSunken },
  projectThumbnailImage: { width: "100%", height: "100%" },
  projectCardCopy: { flex: 1 },
  projectCardTitle: { ...TYPE.bodyStrong, color: COLORS.textPrimary },
  projectCardMeta: { ...TYPE.caption, color: COLORS.textTertiary, marginTop: 3 },
  projectCurrentPill: { paddingHorizontal: SPACING.sm, paddingVertical: 4, borderRadius: RADIUS.pill, backgroundColor: COLORS.primaryDark },
  projectCurrentText: { ...TYPE.caption, color: COLORS.white, fontSize: 9.5 },
  projectDelete: { width: 30, height: 30, borderRadius: RADIUS.pill, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.dangerSoft },
  projectEmpty: { alignItems: "center", paddingVertical: SPACING.xxl, paddingHorizontal: SPACING.xl },
  projectEmptyTitle: { ...TYPE.bodyStrong, color: COLORS.textSecondary, marginTop: SPACING.sm },
  projectEmptyText: { ...TYPE.caption, color: COLORS.textTertiary, textAlign: "center", marginTop: 4, lineHeight: 17 },

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

  viewerGuidance: {
    position: "absolute", top: ms(62), left: SPACING.base,
    maxWidth: "78%", flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: SPACING.md, paddingVertical: 7, borderRadius: RADIUS.pill,
    backgroundColor: "rgba(25,32,29,0.72)",
  },
  viewerGuidanceWithRooms: { top: ms(106) },
  viewerGuidanceText: { ...TYPE.caption, color: COLORS.white, fontSize: 10 },

  inspector: {
    position: "absolute", left: SPACING.base, right: SPACING.base, bottom: ms(94),
    backgroundColor: "rgba(255,255,255,0.98)", borderRadius: RADIUS.xl, padding: SPACING.base,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.78)", ...SHADOW.lg,
  },
  inspectorHead: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  inspectorObjectIcon: { width: 38, height: 38, borderRadius: RADIUS.md, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.primaryTint },
  inspectorHeadingCopy: { flex: 1, minWidth: 0 },
  inspectorEyebrow: { ...TYPE.overline, color: COLORS.primary, fontSize: 9 },
  inspectorTitle: { ...TYPE.h3, color: COLORS.textPrimary, textTransform: "capitalize" },
  inspectorClose: { width: 34, height: 34, borderRadius: RADIUS.pill, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.surfaceSunken },
  inspectorMeta: { ...TYPE.caption, color: COLORS.accentStrong, marginTop: SPACING.sm },
  inspectorBody: { ...TYPE.small, color: COLORS.textSecondary, marginTop: 2, lineHeight: 18 },
  inspectorActions: { flexDirection: "row", alignItems: "flex-end", gap: SPACING.sm, marginTop: SPACING.md },
  inspectorActionGroup: { gap: 5 },
  inspectorPositionGroup: { flex: 1 },
  inspectorActionLabel: { ...TYPE.overline, color: COLORS.textTertiary, fontSize: 8.5 },
  inspectorActionRow: { flexDirection: "row", gap: 4 },
  inspectorIcon: {
    flex: 1, minWidth: ms(34), height: ms(38), borderRadius: RADIUS.md,
    alignItems: "center", justifyContent: "center", backgroundColor: COLORS.surfaceSunken,
    borderWidth: 1, borderColor: COLORS.border,
  },
  inspectorHint: { ...TYPE.caption, color: COLORS.textTertiary, marginTop: SPACING.sm, textAlign: "center" },

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
