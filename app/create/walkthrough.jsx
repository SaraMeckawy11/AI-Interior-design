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
  Animated,
  Easing,
  Image,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import PlanCanvas, {
  DEFAULT_CURVE_SETTINGS,
  GRID_METERS,
  OPENING_MIN_METERS,
  OPENING_SPECS,
  OPENING_VARIANTS,
  PLAN_HEIGHT_METERS,
  PLAN_PIXELS_PER_METER,
  PLAN_WIDTH_METERS,
  ROOM_TINTS,
  SHEET_WIDTH,
  buildCurveGeometry,
  openingOnNearestWall,
  openingDefaults,
  openingWidthMeters,
  polygonArea,
  polygonBounds,
  snapOpeningToNearestWall,
  variantForWidth,
} from "../../components/walkthrough/PlanCanvas";
import WalkthroughViewer from "../../components/walkthrough/WalkthroughViewer";
import { useAuthStore } from "../../authStore";
import COLORS from "../../constants/colors";
import { LAYOUT, MOTION, RADIUS, SHADOW, SPACING, TYPE, ms } from "../../constants/theme";
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
  buildLayout,
} from "../../lib/walkthroughScene";
import { LIVINAI_WEB_RENDERER_REVISION } from "../../lib/exactWalkthroughScene";
import {
  createProjectId,
  deleteProject as deleteStoredProject,
  loadLibrary,
  loadProjectData,
  renameProject as renameStoredProject,
  saveLocally,
  syncProject,
} from "../../lib/walkthroughProjects";

/**
 * The four things a person actually does, in the order they do them.
 *
 * Choosing where the plan comes from used to be crammed into the first step
 * alongside the drawing surface, which meant the upload button and the canvas
 * competed for the same screen and the saved-plans list was buried in a modal
 * behind a folder icon. That decision now happens on its own screen — the
 * library — so every step here is one job.
 */
const STAGES = [
  {
    key: "draw",
    label: "Draw",
    title: "Draw the floor plan",
    copy: "Place rooms, then add the doors, windows and balconies between them.",
  },
  {
    key: "rooms",
    label: "Rooms",
    title: "Name every room",
    copy: "Give each space a name and a function. Its measured area stays visible while you choose.",
  },
  {
    key: "style",
    label: "Style",
    title: "Set the direction",
    copy: "One brief for the whole home, so every room is furnished to match.",
  },
  {
    key: "walk",
    label: "Explore",
    title: "Walk through it",
    copy: "Walk, orbit or look from above. Tap any piece of furniture to move it.",
  },
];

const CANVAS_RATIO = PLAN_HEIGHT_METERS / PLAN_WIDTH_METERS;

/**
 * The drawing tools, ordered the way a plan is built: the two ways to make a
 * room, the three things that go in its walls, then the two ways to correct what
 * is already there.
 *
 * They fill a fixed 4-column grid, so the order below is also the reading order
 * on screen. This replaced a horizontal scroll strip, where the Edit tool sat off
 * the right edge and was therefore never found.
 */
const TOOLS = [
  { key: "rect", icon: "square-outline", label: "Box" },
  { key: "room", icon: "shapes-outline", label: "Outline" },
  { key: "door", icon: "log-in-outline", label: "Door" },
  { key: "window", icon: "browsers-outline", label: "Window" },
  { key: "balcony", icon: "sunny-outline", label: "Balcony" },
  { key: "select", icon: "move-outline", label: "Edit" },
  { key: "pan", icon: "hand-left-outline", label: "Pan" },
];

const TOOL_HINTS = {
  pan: "Drag to move around the plan. Two fingers pan and pinch in any tool.",
  rect: "Drag on the grid to draw a rectangular room. Its size in metres shows as you drag.",
  room: "Tap each corner, then tap the first corner again to close the room.",
  door: "Tap a wall for a standard door, or drag along it for a wider opening.",
  window: "Tap a wall for a standard window, or drag along it to set its length.",
  balcony: "Tap an outside wall for a balcony door, or drag along it for a wide slider.",
  select: "Tap a room or opening, then drag the shape or one of its handles.",
};

const VIEW_MODES = [
  { key: "walk", icon: "walk-outline", label: "Walk" },
  { key: "orbit", icon: "sync-outline", label: "Orbit" },
  { key: "plan", icon: "map-outline", label: "Bird" },
];

/** How long the "drag to look around" coach mark stays up before fading. */
const HINT_VISIBLE_MS = 5200;

/**
 * What the exporter is doing, in the order it does it.
 *
 * These rotate under the progress bar during a build. They are honest about the
 * work rather than a percentage: the exporter reports no progress, and a
 * fabricated number that stalls at 80% is worse than no number at all.
 */
const BUILD_STEPS = [
  "Squaring up your walls and openings",
  "Choosing furniture that fits each room",
  "Leaving room to walk between the pieces",
  "Laying floors, paint and fabrics",
  "Lighting the rooms",
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

  // ── Where we are ─────────────────────────────────────────────────────────
  // 'library' is the front door: saved plans plus the two ways to start a new
  // one. 'editor' is the four-step flow.
  const [view, setView] = useState("library");

  // ── Plan state ───────────────────────────────────────────────────────────
  const [stage, setStage] = useState(0);
  const [tool, setTool] = useState("rect");
  const [canvasFocus, setCanvasFocus] = useState(false);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [roomEdgeType, setRoomEdgeType] = useState("straight");
  const [curveSettings, setCurveSettings] = useState(DEFAULT_CURVE_SETTINGS);
  const [curveControl, setCurveControl] = useState(null);
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

  // ── Library / project state ──────────────────────────────────────────────
  const [projectId, setProjectId] = useState(createProjectId);
  const [remoteId, setRemoteId] = useState(null);
  const [projectTitle, setProjectTitle] = useState("Untitled 3D plan");
  const [projects, setProjects] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [cloudSynced, setCloudSynced] = useState(false);
  const [syncState, setSyncState] = useState("idle"); // 'idle' | 'saving' | 'saved'
  const [renaming, setRenaming] = useState(null); // null | 'current' | project
  const [pendingDelete, setPendingDelete] = useState(null);
  const draftStepsRef = useRef([]);

  // ── Viewer state ─────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState("walk");
  const [night, setNight] = useState(false);
  const [inspected, setInspected] = useState(null);
  const [sceneInfo, setSceneInfo] = useState(null);
  const [panel, setPanel] = useState(null); // null | 'ai'
  const [cameraSource, setCameraSource] = useState("designer"); // 'designer' | 'current'
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
  // The sentence a person reads and the diagnostics an engineer needs are two
  // different things. Keeping them apart is what stopped a Python traceback
  // from being presented to someone as an explanation of their own home.
  const [exactSceneDetail, setExactSceneDetail] = useState("");
  const [exactSceneRetry, setExactSceneRetry] = useState(0);

  // The style step asks seven questions. Four of them decide how a home reads;
  // the rest are refinements, so they stay folded away until asked for.
  const [styleExpanded, setStyleExpanded] = useState(false);

  // The sheet is the measured drawing surface; the canvas is only the window
  // onto it. Keeping the sheet device-independent is what makes a room's area
  // identical on every phone and keeps furniture in proportion to the room.
  const sheetWidth = SHEET_WIDTH;
  const sheetHeight = Math.round(sheetWidth * canvasAspect);
  const canvasWidth = Math.round(canvasFocus ? LAYOUT.screenWidth : LAYOUT.screenWidth - SPACING.base * 2);
  const canvasHeight = Math.round(
    canvasFocus
      ? Math.max(320, LAYOUT.screenHeight * 0.66)
      : Math.max(280, Math.min(canvasWidth * 1.02, LAYOUT.screenHeight * 0.42)),
  );
  const pixelsPerMeter = detectedPixelsPerMeter || PLAN_PIXELS_PER_METER;

  const layout = useMemo(
    () =>
      buildLayout({
        rooms,
        doors: openings.filter((opening) => opening.kind === "door"),
        windows: openings.filter((opening) => opening.kind === "window"),
        balconies: openings.filter((opening) => opening.kind === "balcony"),
        width: sheetWidth,
        height: sheetHeight,
        pixelsPerMeter,
      }),
    [openings, pixelsPerMeter, rooms, sheetHeight, sheetWidth],
  );

  const totalArea = useMemo(
    () => rooms.reduce((sum, room) => sum + polygonArea(room), 0) / (pixelsPerMeter * pixelsPerMeter),
    [pixelsPerMeter, rooms],
  );

  const aiKey = viewMode === "plan" ? "bird" : `room-${selectedRoom}`;
  const currentRender = aiRenders[aiKey];

  // Build the scene with the canonical Livinai_web exporter. Rendering a
  // second, approximate room programme on-device was the source of mismatched
  // dimensions, furniture families, placement and finishes. The exporter owns
  // all of those decisions and returns one textured GLB for the phone to view.
  useEffect(() => {
    if (view !== "editor" || stage !== STAGES.length - 1 || !layout.rooms.length) return undefined;

    const rendererRoot = (process.env.EXPO_PUBLIC_SERVER_URI || "").replace(/\/$/, "");

    if (!rendererRoot) {
      setExactScene(null);
      setExactSceneBaseUrl("");
      setExactSceneLoading(false);
      setExactSceneError("This build of Livinai is not pointed at a server yet.");
      setExactSceneDetail("EXPO_PUBLIC_SERVER_URI is empty.");
      return undefined;
    }

    const controller = new AbortController();
    setExactScene(null);
    setExactSceneBaseUrl("");
    setSceneInfo(null);
    setExactSceneLoading(true);
    setExactSceneError("");
    setExactSceneDetail("");

    (async () => {
      try {
        const response = await fetch(`${rendererRoot}/api/walkthrough/realtime/session`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            rendererRevision: LIVINAI_WEB_RENDERER_REVISION,
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
        if (!response.ok) {
          // `message` is written for the person holding the phone; `detail`
          // carries whatever the server can say about the cause. Never promote
          // `detail` into the headline — that is how a stack trace becomes copy.
          const failure = new Error(
            data.message
              || (response.status >= 500
                ? "The 3D service could not build your home."
                : "Livinai could not start this walkthrough."),
          );
          failure.detail = data.detail || `HTTP ${response.status}`;
          throw failure;
        }
        if (!data.modelUrl || !Array.isArray(data.furniture) || !Array.isArray(data.roomCenters)) {
          const failure = new Error("Your home came back from the 3D service incomplete.");
          failure.detail = "The response was missing modelUrl, furniture or roomCenters.";
          throw failure;
        }
        if (controller.signal.aborted) return;
        const origin = rendererRoot.match(/^https?:\/\/[^/]+/)?.[0] || rendererRoot;
        setExactScene(data);
        setExactSceneBaseUrl(origin);
      } catch (error) {
        if (error.name === "AbortError") return;
        setExactScene(null);
        // A fetch that never reached the server throws a bare "Network request
        // failed", which tells someone on a hotel Wi-Fi nothing about what to do.
        const offline = !error.detail && /network|failed to fetch/i.test(error.message || "");
        setExactSceneError(
          offline
            ? "Livinai could not reach the 3D service."
            : error.message || "Your home could not be built in 3D.",
        );
        setExactSceneDetail(
          offline ? "The request never reached the server. Check your connection." : error.detail || "",
        );
      } finally {
        if (!controller.signal.aborted) setExactSceneLoading(false);
      }
    })();

    return () => controller.abort();
  }, [exactSceneRetry, layout, roomConfigs, settings, stage, token, view]);

  // ── Autosave ─────────────────────────────────────────────────────────────
  // Drawing a home takes real effort; geometry is saved in normalized canvas
  // coordinates so uploaded plans restore correctly on a different phone.
  const restored = useRef(false);

  const restoreSavedPlan = useCallback((saved) => {
    if (!saved) return;
    const sourceAspect = Number(saved.canvasAspect) || CANVAS_RATIO;
    const restoredAspect = Math.max(sourceAspect, CANVAS_RATIO);
    // Geometry is stored as a fraction of the sheet, so a plan drawn on any
    // phone reopens at exactly the same measured size on any other. Plans saved
    // before the fixed sheet used the same fractions relative to the device
    // canvas, and their pixels-per-metre was stored as the same ratio, so they
    // restore to identical metres without a migration step.
    const restoredSourceHeight = sheetWidth * sourceAspect;
    const toPixels = saved.coordinateSpace === "normalized"
      ? (point) => [point[0] * sheetWidth, point[1] * restoredSourceHeight]
      : (point) => [point[0] * PLAN_PIXELS_PER_METER, point[1] * PLAN_PIXELS_PER_METER];
    setCanvasAspect(restoredAspect);
    setDetectedPixelsPerMeter(saved.pixelsPerMeterRatio ? saved.pixelsPerMeterRatio * sheetWidth : null);
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
    setCurveControl(null);
    setHistory([]);
    setFuture([]);
  }, [sheetWidth]);

  /** Everything needed to reopen this plan, in device-independent coordinates. */
  const planData = useCallback(() => {
    const normalize = (point) => [point[0] / sheetWidth, point[1] / sheetHeight];
    return {
      coordinateSpace: "normalized",
      canvasAspect,
      pixelsPerMeterRatio: pixelsPerMeter / sheetWidth,
      planImage,
      rooms: rooms.map((room) => room.map(normalize)),
      roomConfigs,
      openings: openings.map((opening) => ({ ...opening, points: opening.points.map(normalize) })),
      settings,
      furnitureEdits,
      selectedRoom,
      stage,
      aiRenders,
      savedAt: new Date().toISOString(),
    };
  }, [aiRenders, canvasAspect, furnitureEdits, openings, pixelsPerMeter, planImage, roomConfigs, rooms, selectedRoom, settings, sheetHeight, sheetWidth, stage]);

  /** The library row for the plan currently open in the editor. */
  const projectRecord = useCallback(() => ({
    id: projectId,
    remoteId,
    title: projectTitle.trim() || "Untitled 3D plan",
    source: planImage ? "upload" : "blank",
    roomCount: rooms.length,
    openingCount: openings.length,
    areaMeters: Number(totalArea.toFixed(2)),
    planImage,
    thumbnail: Object.values(aiRenders).find((render) => render?.image)?.image || planImage || null,
    updatedAt: new Date().toISOString(),
    data: planData(),
  }), [aiRenders, openings.length, planData, planImage, projectId, projectTitle, remoteId, rooms.length, totalArea]);

  const refreshLibrary = useCallback(async () => {
    setLibraryLoading(true);
    const { projects: found, synced } = await loadLibrary(token);
    setProjects(found);
    setCloudSynced(synced);
    setLibraryLoading(false);
    return found;
  }, [token]);

  useEffect(() => {
    restored.current = true;
    refreshLibrary();
  }, [refreshLibrary]);

  /**
   * Autosave, on the device only.
   *
   * Drawing a home takes real effort, so the local copy is written constantly
   * and never asks permission. The account copy is not: pushing the whole
   * geometry on every dragged corner would be rude to both the user's data plan
   * and the server, so that happens when they save or leave the editor.
   */
  useEffect(() => {
    if (view !== "editor" || !restored.current || detecting || rendering) return undefined;
    const timer = setTimeout(() => {
      saveLocally(projectRecord()).catch(() => {});
    }, 700);
    return () => clearTimeout(timer);
  }, [detecting, projectRecord, rendering, view]);

  const pushToCloud = useCallback(async ({ announce } = {}) => {
    const record = projectRecord();
    await saveLocally(record).catch(() => {});

    if (!token) {
      if (announce) setNotice("Saved on this device. Sign in to keep this plan on your account.");
      await refreshLibrary();
      return;
    }

    setSyncState("saving");
    try {
      const saved = await syncProject(token, record);
      if (saved?.id) setRemoteId(saved.id);
      setSyncState("saved");
      if (announce) setNotice("3D plan saved to your account.");
    } catch (error) {
      setSyncState("idle");
      setNotice(
        error?.message === "offline"
          ? "Saved on this device. It will reach your account the next time you save with a connection."
          : error?.message || "Saved on this device, but your account copy could not be updated.",
      );
    }
    await refreshLibrary();
  }, [projectRecord, refreshLibrary, token]);

  // The tick on the save button is a confirmation, not a state to live in.
  useEffect(() => {
    if (syncState !== "saved") return undefined;
    const timer = setTimeout(() => setSyncState("idle"), 1800);
    return () => clearTimeout(timer);
  }, [syncState]);

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
    setCurveControl(null);
  }, [commitRoom, curveSettings, draft, roomEdgeType]);

  /**
   * Commit the rounded wall that is currently previewed. Staging the curve —
   * pick the far end, shape it, then apply — mirrors the web studio instead of
   * baking in whatever the sliders happened to say at the moment of the tap.
   */
  const applyCurve = useCallback(() => {
    if (!curveControl || !draft.length) return;
    const geometry = buildCurveGeometry(draft[draft.length - 1], curveControl, curveSettings);
    if (!geometry) return setCurveControl(null);
    addCurve(geometry.samples);
    setCurveControl(null);
  }, [addCurve, curveControl, curveSettings, draft]);

  const cancelCurve = useCallback(() => setCurveControl(null), []);

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
          const clampedDx = Math.max(-minX, Math.min(sheetWidth - maxX, dx));
          const clampedDy = Math.max(-minY, Math.min(sheetHeight - maxY, dy));
          return room.map(([x, y]) => [x + clampedDx, y + clampedDy]);
        }),
      );
    },
    [sheetHeight, sheetWidth],
  );

  /**
   * Resize a room to exact interior dimensions. Rooms drawn by finger are never
   * quite the size the user meant, and correcting a 4.2 m wall by dragging a
   * handle on a phone is hopeless — so the numbers are directly editable and the
   * polygon is scaled about its top-left corner to match.
   */
  const resizeRoom = useCallback(
    (index, widthMeters, depthMeters) => {
      const room = rooms[index];
      if (!room?.length) return;
      const bounds = polygonBounds(room);
      const targetWidth = Math.max(0.6, Number(widthMeters) || 0) * pixelsPerMeter;
      const targetDepth = Math.max(0.6, Number(depthMeters) || 0) * pixelsPerMeter;
      if (bounds.width < 0.01 || bounds.height < 0.01) return;
      const scaleX = targetWidth / bounds.width;
      const scaleY = targetDepth / bounds.height;
      rememberPlan();
      setRooms((current) => current.map((candidate, candidateIndex) => (
        candidateIndex === index
          ? candidate.map(([x, y]) => [
              Math.max(0, Math.min(sheetWidth, bounds.minX + (x - bounds.minX) * scaleX)),
              Math.max(0, Math.min(sheetHeight, bounds.minY + (y - bounds.minY) * scaleY)),
            ])
          : candidate
      )));
    },
    [pixelsPerMeter, rememberPlan, rooms, sheetHeight, sheetWidth],
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
    if (curveControl) return setCurveControl(null);
    if (draft.length) {
      const previousLength = draftStepsRef.current.pop();
      return setDraft((current) => current.slice(0, previousLength ?? Math.max(0, current.length - 1)));
    }
    const previous = history[history.length - 1];
    if (!previous) return;
    setFuture((items) => [currentPlanSnapshot(), ...items].slice(0, 50));
    restorePlanSnapshot(previous);
    setHistory((items) => items.slice(0, -1));
  }, [currentPlanSnapshot, curveControl, draft.length, history, restorePlanSnapshot]);

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
    setCurveControl(null);
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

  /**
   * The single place an opening's type, section and width are changed.
   *
   * Width is now first-class rather than a side effect of the chosen preset:
   * switching a door to a balcony keeps the span the user set, and a width can
   * be typed or stepped to anything the wall will take. That is what makes a
   * 3 m wall opening possible instead of only door-sized doors.
   */
  const editOpening = useCallback((index, changes = {}) => {
    rememberPlan();
    setOpenings((current) => current.map((opening, openingIndex) => {
      if (openingIndex !== index) return opening;
      const kind = changes.kind || opening.kind;
      const kindChanged = kind !== opening.kind;
      const variants = OPENING_VARIANTS[kind] || OPENING_VARIANTS.door;
      const [start, end] = opening.points;
      const midpoint = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
      const length = Math.max(0.001, Math.hypot(end[0] - start[0], end[1] - start[1]));
      const direction = [(end[0] - start[0]) / length, (end[1] - start[1]) / length];
      const currentMeters = length / pixelsPerMeter;

      // A named variant carries its own width; anything else keeps the width
      // the opening already has.
      const preset = changes.variant
        ? variants.find((item) => item.label === changes.variant) || variants[0]
        : null;
      const targetMeters = Math.max(
        OPENING_MIN_METERS,
        Number(changes.meters) || (preset ? preset.meters : currentMeters),
      );
      const variantLabel = preset
        ? preset.label
        : kindChanged || changes.meters !== undefined
          ? variantForWidth(kind, targetMeters)
          : opening.variant;

      const half = (targetMeters * pixelsPerMeter) / 2;
      const raw = [
        [midpoint[0] - direction[0] * half, midpoint[1] - direction[1] * half],
        [midpoint[0] + direction[0] * half, midpoint[1] + direction[1] * half],
      ];
      const points = snapOpeningToNearestWall(raw, rooms, kind, pixelsPerMeter) || opening.points;
      return { ...opening, kind, points, ...openingDefaults(kind, variantLabel) };
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

  /** Wipe the editor back to an empty sheet. Shared by every "start new" path. */
  const resetEditor = useCallback(() => {
    setStage(0);
    setTool("rect");
    setRooms([]);
    setOpenings([]);
    setDraft([]);
    setCurveControl(null);
    setRoomConfigs([]);
    setSettings({ ...DEFAULT_WALKTHROUGH_SETTINGS });
    setFurnitureEdits({});
    setSelectedRoom(0);
    setSelection(null);
    setPlanImage(null);
    setPlanError("");
    setCanvasAspect(CANVAS_RATIO);
    setDetectedPixelsPerMeter(null);
    setHistory([]);
    setFuture([]);
    setAiRenders({});
    setViewMode("walk");
    setOutputMode("live");
    setPanel(null);
    setInspected(null);
    setSceneInfo(null);
  }, []);

  const openSavedProject = useCallback(async (project) => {
    try {
      const data = await loadProjectData(token, project);
      if (!data) {
        setNotice("That plan's drawing could not be found on this device or your account.");
        return;
      }
      resetEditor();
      setProjectId(project.id);
      setRemoteId(project.remoteId || null);
      setProjectTitle(project.title || "Untitled 3D plan");
      restoreSavedPlan(data);
      setView("editor");
    } catch (error) {
      setNotice(error?.message || "That 3D plan could not be opened.");
    }
  }, [resetEditor, restoreSavedPlan, token]);

  const removeSavedProject = useCallback(async (project) => {
    if (!project?.id) return;
    setPendingDelete(null);
    setProjects((current) => current.filter((item) => item.id !== project.id));
    // The editor still holds this plan's id, and its autosave would write the
    // row straight back. Handing it a fresh id makes the deletion stick.
    if (project.id === projectId) {
      setProjectId(createProjectId());
      setRemoteId(null);
    }
    await deleteStoredProject(token, project);
    await refreshLibrary();
  }, [projectId, refreshLibrary, token]);

  const renameSavedProject = useCallback(async (project, title) => {
    const trimmed = title.trim().slice(0, 60);
    if (!trimmed) return;
    if (project === "current" || project?.id === projectId) setProjectTitle(trimmed);
    if (project !== "current") {
      await renameStoredProject(token, project, trimmed);
      await refreshLibrary();
    }
  }, [projectId, refreshLibrary, token]);

  const uploadPlan = useCallback(async (targetProjectId = projectId) => {
    let result;
    try {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 1,
      });
    } catch {
      setPlanError("Livinai could not open your photo library. Check photo access in device settings and try again.");
      return false;
    }
    if (result.canceled || !result.assets?.[0]) return false;
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
        stableUri = `${FileSystem.documentDirectory}livinai-walkthrough-plan-${targetProjectId}.${extension}`;
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
    setCurveControl(null);
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
      const displayScale = sheetWidth / detectedWidth;
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
    return true;
  }, [projectId, sheetWidth, token]);

  /**
   * Start a new plan.
   *
   * It always begins on the empty grid. Tracing a photo instead is offered on the
   * canvas itself, where the effect is visible — asking here as well would mean
   * the same question in two places, and a first-time user committing to an
   * answer before seeing what either option looks like.
   */
  const startNewProject = useCallback(() => {
    resetEditor();
    setProjectId(createProjectId());
    setRemoteId(null);
    setProjectTitle("New 3D plan");
    setView("editor");
  }, [resetEditor]);

  /** Leave the editor, pushing the plan to the account on the way out. */
  const exitToLibrary = useCallback(async () => {
    if (rooms.length || openings.length) await pushToCloud();
    else await refreshLibrary();
    setView("library");
  }, [openings.length, pushToCloud, refreshLibrary, rooms.length]);

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

  // A "drawing scale" card used to sit here with Smaller / Larger / Reset
  // buttons that moved every room's area by 10% at a time. It asked the user to
  // reason in pixels-per-metre to fix a number they can simply type on the room
  // itself, so it is gone: `resizeRoom` is the one honest way to set a size.

  // ── Viewer actions ───────────────────────────────────────────────────────
  const changeViewMode = (mode) => {
    setViewMode(mode);
    setOutputMode("live");
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
    viewerRef.current?.setRoom(index);
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
    if (stage === 0) return exitToLibrary();
    setStage((current) => current - 1);
  };

  const current = STAGES[stage];
  const activeTool = TOOLS.find((item) => item.key === tool);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <View style={styles.screen}>
      {view === "library" ? (
        <PlanLibrary
          projects={projects}
          loading={libraryLoading}
          synced={cloudSynced}
          signedIn={!!token}
          onBack={() => router.back()}
          onRefresh={refreshLibrary}
          onStart={startNewProject}
          onOpen={openSavedProject}
          onRename={setRenaming}
          onDelete={setPendingDelete}
        />
      ) : (
        <>
          {/* ── Header ─────────────────────────────────────────────────── */}
          <LinearGradient colors={COLORS.gradientBrandDeep} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
            <SafeAreaView edges={["top"]} style={styles.header}>
              <View style={styles.headerRow}>
                {/* One back button with one meaning: go back a step, and on the
                    first step leave the editor. The Explore step has no footer,
                    so without this it would have been a room with no door. */}
                <Pressable
                  accessibilityLabel={stage === 0 ? "Back to your 3D plans" : `Back to ${STAGES[stage - 1].label}`}
                  onPress={goBack}
                  hitSlop={LAYOUT.hitSlop}
                  style={styles.headerButton}
                >
                  <Ionicons name="chevron-back" size={20} color={COLORS.white} />
                </Pressable>

                <Pressable style={styles.headerCopy} onPress={() => setRenaming("current")}>
                  <Text style={styles.headerEyebrow} numberOfLines={1}>{current.title}</Text>
                  <View style={styles.headerTitleRow}>
                    <Text style={styles.headerTitle} numberOfLines={1}>{projectTitle}</Text>
                    <Ionicons name="create-outline" size={14} color="rgba(255,255,255,0.7)" />
                  </View>
                </Pressable>

                <Pressable
                  accessibilityLabel="Save this 3D plan"
                  onPress={() => pushToCloud({ announce: true })}
                  hitSlop={LAYOUT.hitSlop}
                  style={styles.headerButton}
                  disabled={syncState === "saving"}
                >
                  {syncState === "saving" ? (
                    <ActivityIndicator size="small" color={COLORS.white} />
                  ) : (
                    <Ionicons
                      name={syncState === "saved" ? "checkmark" : "save-outline"}
                      size={18}
                      color={COLORS.white}
                    />
                  )}
                </Pressable>
              </View>

              {/* Numbered dots joined by a connector, which is how a stepper is
                  normally read. Four full-width bars each with a label under it
                  said very little at a glance — on the first step nothing was
                  filled, so the whole row looked like an empty placeholder — and
                  the labels repeated the title directly above them. */}
              <View style={styles.stepper} accessibilityRole="tablist">
                {STAGES.map((item, index) => {
                  const done = index < stage;
                  const active = index === stage;
                  const reachable = index <= stage || rooms.length > 0;
                  return (
                    <React.Fragment key={item.key}>
                      {index > 0 && (
                        <View style={[styles.stepConnector, index <= stage && styles.stepConnectorDone]} />
                      )}
                      <Pressable
                        disabled={!reachable}
                        accessibilityRole="tab"
                        accessibilityLabel={`Step ${index + 1}, ${item.label}`}
                        accessibilityState={{ selected: active, disabled: !reachable }}
                        hitSlop={8}
                        style={[
                          styles.step,
                          (done || active) && styles.stepReached,
                          active && styles.stepActive,
                        ]}
                        onPress={() => setStage(index)}
                      >
                        {done ? (
                          <Ionicons name="checkmark" size={13} color={COLORS.brand800} />
                        ) : (
                          <Text style={[styles.stepNumber, active && styles.stepNumberActive]}>
                            {index + 1}
                          </Text>
                        )}
                      </Pressable>
                    </React.Fragment>
                  );
                })}
                <Text style={styles.stepCaption} numberOfLines={1}>
                  {current.label}
                </Text>
              </View>
            </SafeAreaView>
          </LinearGradient>

          {/* ── Body ───────────────────────────────────────────────────── */}
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
              exactSceneDetail={exactSceneDetail}
              viewMode={viewMode}
              night={night}
              selectedRoom={selectedRoom}
              inspected={inspected}
              sceneInfo={sceneInfo}
              panel={panel}
              cameraSource={cameraSource}
              currentRender={currentRender}
              outputMode={outputMode}
              rendering={rendering}
              busy={busy}
              onReady={setSceneInfo}
              onSceneUpdate={setSceneInfo}
              onSelect={setInspected}
              onSnapshot={handleSnapshot}
              onFurnitureChange={updateFurnitureEdit}
              onDiagnostic={setNotice}
              onExactError={(message) => {
                setExactScene(null);
                setExactSceneError("Your home was built, but it could not be opened here.");
                setExactSceneDetail(message);
              }}
              onRetryExact={() => setExactSceneRetry((value) => value + 1)}
              onBackToDesign={goBack}
              onChangeMode={changeViewMode}
              onToggleNight={toggleNight}
              onFocusRoom={focusRoom}
              onCapture={() => requestCapture("photo")}
              onRender={() => requestCapture("ai")}
              onSetPanel={setPanel}
              onSetCameraSource={setCameraSource}
              onSetOutputMode={setOutputMode}
              onSaveRender={(image) => {
                setSnapshotKind("ai");
                setSnapshot(image);
              }}
            />
          ) : (
            <ScrollView
              contentContainerStyle={styles.body}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* The Draw step's instruction is the tool hint, which is specific
                  and changes with the tool; a second generic sentence above it
                  said less and cost a whole line. */}
              {stage > 0 && <Text style={styles.stageCopy}>{current.copy}</Text>}

              {/* ── Step 1 · Draw ────────────────────────────────────── */}
              {stage === 0 && (
                <>
                  {!canvasFocus && (
                    <PlanSourceBar
                      planImage={planImage}
                      detecting={detecting}
                      error={planError}
                      onUpload={() => uploadPlan()}
                      onClear={() => {
                        setPlanImage(null);
                        setCanvasAspect(CANVAS_RATIO);
                        setDetectedPixelsPerMeter(null);
                        setPlanError("");
                      }}
                    />
                  )}

                  <ToolPalette
                    tool={tool}
                    onChange={setTool}
                    snapToGrid={snapToGrid}
                    onToggleSnap={() => setSnapToGrid((value) => !value)}
                  />

                  <View style={styles.hintRow}>
                    <Text style={styles.hintRowText}>
                      <Text style={styles.hintRowTool}>{activeTool?.label} · </Text>
                      {TOOL_HINTS[tool]}
                    </Text>
                  </View>

                  {tool === "room" && (
                    <CurveControls
                      edgeType={roomEdgeType}
                      onChangeEdgeType={(value) => {
                        setRoomEdgeType(value);
                        if (value !== "rounded") setCurveControl(null);
                      }}
                      settings={curveSettings}
                      onChangeSettings={setCurveSettings}
                      stage={!draft.length ? 0 : curveControl ? 2 : 1}
                      curveStaged={!!curveControl}
                      onApplyCurve={applyCurve}
                      onCancelCurve={cancelCurve}
                    />
                  )}

                  <View style={[styles.canvasFrame, canvasFocus && styles.canvasFrameFocused]}>
                    <PlanCanvas
                      width={canvasWidth}
                      height={canvasHeight}
                      sheetWidth={sheetWidth}
                      sheetHeight={sheetHeight}
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
                      curveControl={curveControl}
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
                      onSetCurveControl={setCurveControl}
                      onBeginEdit={rememberPlan}
                    />
                  </View>

                  {/* The only bar that ever sits directly under the canvas.
                      Anything else competing for that spot pushed the drawing
                      instructions off screen exactly when they were needed. */}
                  {(draft.length > 0 || !!curveControl) && (
                    <View style={styles.drawingBar}>
                      <Ionicons name="pencil-outline" size={15} color={COLORS.primaryDark} />
                      <Text style={styles.drawingBarText} numberOfLines={2}>
                        {curveControl
                          ? "Shape the rounded wall, then add it."
                          : draft.length < 3
                            ? `${draft.length} of at least 3 corners placed.`
                            : "Tap the first corner again, or finish the room."}
                      </Text>
                      <Pressable
                        style={styles.drawingBarGhost}
                        onPress={() => {
                          setDraft([]);
                          setCurveControl(null);
                        }}
                      >
                        <Ionicons name="close" size={15} color={COLORS.textSecondary} />
                      </Pressable>
                      <Pressable
                        style={[
                          styles.drawingBarPrimary,
                          !curveControl && draft.length < 3 && styles.drawingBarPrimaryDisabled,
                        ]}
                        disabled={!curveControl && draft.length < 3}
                        onPress={curveControl ? applyCurve : () => closeRoom()}
                      >
                        <Text style={styles.drawingBarPrimaryText}>
                          {curveControl ? "Add wall" : "Finish"}
                        </Text>
                      </Pressable>
                    </View>
                  )}

                  {selection && (
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
                        <Text style={styles.selectionActionText}>Delete</Text>
                      </Pressable>
                    </View>
                  )}

                  {/* Type and width, and nothing else. A "Presets" row of named
                      widths sat under the width field and set the same number a
                      second way, so the two controls could disagree on screen. */}
                  {selection?.kind === "opening" && openings[selection.index] && (
                    <View style={styles.openingEditor}>
                      <ChipRow
                        label="Type"
                        options={["door", "window", "balcony"]}
                        value={openings[selection.index].kind}
                        formatOption={(option) => (OPENING_SPECS[option] || OPENING_SPECS.door).label}
                        onChange={(kind) => editOpening(selection.index, { kind })}
                      />
                      <OpeningWidthControl
                        widthMeters={openingWidthMeters(openings[selection.index], pixelsPerMeter)}
                        onChange={(meters) => editOpening(selection.index, { meters })}
                      />
                    </View>
                  )}

                  {/* Four equal cells. They used to be pill buttons sized by
                      their own labels, so "Clear plan" was twice the width of
                      "Undo" and the row read as four unrelated things. */}
                  <View style={styles.actionRow}>
                    <ActionButton
                      icon="arrow-undo-outline"
                      label="Undo"
                      disabled={!draft.length && !history.length && !curveControl}
                      onPress={undo}
                    />
                    <ActionButton icon="arrow-redo-outline" label="Redo" disabled={!future.length} onPress={redo} />
                    <ActionButton
                      icon={canvasFocus ? "contract-outline" : "expand-outline"}
                      label={canvasFocus ? "Shrink" : "Expand"}
                      active={canvasFocus}
                      onPress={() => setCanvasFocus((value) => !value)}
                    />
                    <ActionButton
                      icon="trash-outline"
                      label="Clear"
                      tone="danger"
                      disabled={!rooms.length && !openings.length && !draft.length}
                      onPress={clearPlanLines}
                    />
                  </View>

                  {!!rooms.length && (
                    <View style={styles.card}>
                      <View style={styles.cardTitleRow}>
                        <Text style={styles.cardSectionTitle}>Room sizes</Text>
                        {/* The three metric tiles that used to sit above this
                            card said the same thing in three boxes. */}
                        <Text style={styles.cardTitleMeta}>
                          {rooms.length} · {openings.length} openings · {totalArea.toFixed(1)} m²
                        </Text>
                      </View>
                      {rooms.map((room, index) => (
                        <RoomSizeRow
                          key={`size-${index}`}
                          index={index}
                          label={roomConfigs[index]?.name || `Room ${index + 1}`}
                          room={room}
                          pixelsPerMeter={pixelsPerMeter}
                          active={selectedRoom === index}
                          onFocus={() => {
                            setSelectedRoom(index);
                            setSelection({ kind: "room", index });
                          }}
                          onResize={resizeRoom}
                        />
                      ))}
                    </View>
                  )}
                </>
              )}

              {/* ── Step 2 · Rooms ───────────────────────────────────── */}
              {stage === 1 && (
                <>
                  {roomConfigs.length === 0 ? (
                    <EmptyState text="Go back and draw at least one room." />
                  ) : (
                    <View style={styles.summaryBar}>
                      <Ionicons name="home-outline" size={17} color={COLORS.primaryDark} />
                      <Text style={styles.summaryBarText}>
                        {roomConfigs.length} {roomConfigs.length === 1 ? "room" : "rooms"} · {totalArea.toFixed(1)} m² measured
                      </Text>
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
                        {/* The area used to be printed here as well as on the
                            size row two lines below it. */}
                        <Pressable
                          accessibilityLabel={`Delete ${room.name || `room ${index + 1}`}`}
                          onPress={() => removeRoom(index)}
                          hitSlop={LAYOUT.hitSlop}
                          style={styles.roomDelete}
                        >
                          <Ionicons name="trash-outline" size={17} color={COLORS.danger} />
                        </Pressable>
                      </View>
                      <RoomSizeRow
                        index={index}
                        label="Exact size"
                        room={rooms[index] || []}
                        pixelsPerMeter={pixelsPerMeter}
                        active
                        compact
                        onFocus={() => setSelectedRoom(index)}
                        onResize={resizeRoom}
                      />
                      <ChipRow label="Room type" options={ROOM_TYPES} value={room.roomType} onChange={(v) => updateRoom(index, "roomType", v)} />
                      <ChipRow label="Style" options={WALKTHROUGH_STYLES} value={room.style} onChange={(v) => updateRoom(index, "style", v)} />
                    </View>
                  ))}
                </>
              )}

              {/* ── Step 3 · Style ───────────────────────────────────── */}
              {stage === 2 && (
                roomConfigs.length === 0 ? (
                  <EmptyState text="Draw and name a room first." />
                ) : (
                  <>
                    <View style={styles.card}>
                      <ChipRow label="Design profile" options={DESIGN_PROFILES} value={settings.designProfile} onChange={(v) => updateSetting("designProfile", v)} />
                      <ChipRow label="Colour mood" options={COLOR_MOODS} value={settings.colorMood} onChange={(v) => updateSetting("colorMood", v)} />
                      <ChipRow label="Floor finish" options={FLOOR_FINISHES} value={settings.floorFinish} onChange={(v) => updateSetting("floorFinish", v)} />
                      <ChipRow label="Wall finish" options={WALL_FINISHES} value={settings.wallFinish} onChange={(v) => updateSetting("wallFinish", v)} />
                    </View>

                    <Pressable
                      style={styles.disclosure}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: styleExpanded }}
                      onPress={() => setStyleExpanded((value) => !value)}
                    >
                      <Text style={styles.disclosureText}>Soft furnishings and decor</Text>
                      <Ionicons
                        name={styleExpanded ? "chevron-up" : "chevron-down"}
                        size={17}
                        color={COLORS.primaryDark}
                      />
                    </Pressable>

                    {styleExpanded && (
                      <View style={styles.card}>
                        <ChipRow label="Rug design" options={RUG_DESIGNS} value={settings.rugDesign} onChange={(v) => updateSetting("rugDesign", v)} />
                        <ChipRow label="Window treatment" options={CURTAIN_DESIGNS} value={settings.curtainDesign} onChange={(v) => updateSetting("curtainDesign", v)} />
                        <ChipRow label="Decor set" options={DECOR_SETS} value={settings.decorSet} onChange={(v) => updateSetting("decorSet", v)} />
                        <Text style={[styles.fieldLabel, { marginTop: SPACING.lg }]}>Notes (optional)</Text>
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

                    <Pressable
                      style={styles.settingToggle}
                      accessibilityRole="switch"
                      accessibilityState={{ checked: settings.freeExplore }}
                      onPress={() => updateSetting("freeExplore", !settings.freeExplore)}
                    >
                      <View style={[styles.settingToggleIcon, settings.freeExplore && styles.settingToggleIconActive]}>
                        {settings.freeExplore && <Ionicons name="checkmark" size={13} color={COLORS.white} />}
                      </View>
                      <View style={styles.settingToggleCopy}>
                        <Text style={styles.settingToggleTitle}>Walk through walls</Text>
                        <Text style={styles.settingToggleText}>Useful for reviewing furniture without using the doors.</Text>
                      </View>
                    </Pressable>
                  </>
                )
              )}
            </ScrollView>
          )}

          {/* ── Footer ─────────────────────────────────────────────────────
              Two buttons of equal width and equal height. Back used to be sized
              by its own label next to a flexing Continue, which made the pair
              look like a mistake rather than a choice. */}
          {stage < STAGES.length - 1 && (
            <SafeAreaView edges={["bottom"]} style={styles.footer}>
              <Pressable style={[styles.footerButton, styles.footerGhost]} onPress={goBack}>
                <Ionicons name="arrow-back" size={16} color={COLORS.textPrimary} />
                <Text style={styles.footerGhostText}>Back</Text>
              </Pressable>
              <Pressable
                style={[styles.footerButton, styles.footerPrimary, !canContinue && styles.footerPrimaryDisabled]}
                disabled={!canContinue}
                onPress={goNext}
              >
                <Text style={styles.footerPrimaryText} numberOfLines={1}>
                  {stage === STAGES.length - 2 ? "Walk through" : "Continue"}
                </Text>
                <Ionicons name="arrow-forward" size={16} color={COLORS.white} />
              </Pressable>
            </SafeAreaView>
          )}
        </>
      )}

      {/* ── Dialogs shared by both views ────────────────────────────────── */}
      <RenameSheet
        target={renaming}
        currentTitle={projectTitle}
        onClose={() => setRenaming(null)}
        onSubmit={(title) => {
          renameSavedProject(renaming, title);
          setRenaming(null);
        }}
      />

      <ConfirmSheet
        project={pendingDelete}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => removeSavedProject(pendingDelete)}
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
/**
 * The Explore screen.
 *
 * Everything on top of the 3D view lives in one overlay column that is pinned
 * to the safe area and split into a top and a bottom cluster. Controls used to
 * be positioned individually at hand-tuned offsets, which is why they collided
 * with each other, sat under the home indicator on tall phones, and moved
 * whenever anything above them changed height. Laying them out in flow instead
 * means each cluster stacks predictably and nothing needs a magic number.
 */
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
  exactSceneDetail,
  viewMode,
  night,
  selectedRoom,
  inspected,
  sceneInfo,
  panel,
  cameraSource,
  currentRender,
  outputMode,
  rendering,
  busy,
  onReady,
  onSceneUpdate,
  onSelect,
  onSnapshot,
  onFurnitureChange,
  onDiagnostic,
  onExactError,
  onRetryExact,
  onBackToDesign,
  onChangeMode,
  onToggleNight,
  onFocusRoom,
  onCapture,
  onRender,
  onSetPanel,
  onSetCameraSource,
  onSetOutputMode,
  onSaveRender,
}) {
  const insets = useSafeAreaInsets();
  const showingAi = outputMode === "ai" && currentRender;
  const sheetOpen = !!inspected || panel === "ai";
  const showStick = viewMode === "walk" && !showingAi && !sheetOpen;
  const showRooms = roomConfigs.length > 1 && !showingAi;
  // Controls only make sense once there is a home to point them at. Showing a
  // view switcher and a Render button over an error is an invitation to press
  // things that cannot work.
  const showControls = !!exactScene;

  const drive = useCallback(
    (x, y) => viewerRef.current?.setJoystick(x, y),
    [viewerRef],
  );

  // A coach mark is only useful the first time the controls mean something new.
  // Without this the tip replayed every time a furniture sheet was dismissed.
  const coached = useRef(new Set());
  const showHint = !showingAi && !sheetOpen && !coached.current.has(viewMode);

  const status = describeScene(sceneInfo);

  return (
    <View style={styles.viewerWrap}>
      {exactScene ? (
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
          onSceneUpdate={onSceneUpdate}
          onSelect={onSelect}
          onSnapshot={onSnapshot}
          onFurnitureChange={onFurnitureChange}
          onDiagnostic={onDiagnostic}
          onError={onExactError}
        />
      ) : (
        <View style={styles.exactSceneState}>
          {exactSceneLoading ? (
            <SceneBuildingState rooms={roomConfigs.length} />
          ) : (
            <SceneErrorState
              message={exactSceneError}
              detail={exactSceneDetail}
              onRetry={onRetryExact}
              onBack={onBackToDesign}
            />
          )}
        </View>
      )}

      {showingAi && (
        <View style={styles.aiLayer}>
          <Image source={{ uri: currentRender.image }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        </View>
      )}

      {rendering && (
        <View style={styles.renderOverlay}>
          <ActivityIndicator size="large" color={COLORS.white} />
          <Text style={styles.renderTitle}>Rendering this view</Text>
          <Text style={styles.renderBody}>
            Your walls, openings and furniture are kept exactly where they are.
          </Text>
        </View>
      )}

      {/* Floating white controls sit on top of whatever the camera happens to
          be looking at — a pale wall, a window, a bright render. These scrims
          are what keep them readable in every one of those cases without
          darkening the room itself. */}
      {showControls && (
        <>
          <LinearGradient
            colors={["rgba(20,26,21,0.34)", "rgba(20,26,21,0)"]}
            style={styles.scrimTop}
            pointerEvents="none"
          />
          <LinearGradient
            colors={["rgba(20,26,21,0)", "rgba(20,26,21,0.40)"]}
            style={styles.scrimBottom}
            pointerEvents="none"
          />
        </>
      )}

      {showControls && (
      <View
        style={[
          styles.viewerOverlay,
          { paddingTop: SPACING.md, paddingBottom: Math.max(insets.bottom, SPACING.md) },
        ]}
        pointerEvents="box-none"
      >
        {/* ── Top cluster ────────────────────────────────────────────────── */}
        <View style={styles.overlayTop} pointerEvents="box-none">
          <View style={styles.viewControls} pointerEvents="box-none">
            <View style={styles.segmented} accessibilityRole="tablist">
              {VIEW_MODES.map((item) => {
                const active = viewMode === item.key;
                return (
                  <Pressable
                    key={item.key}
                    accessibilityRole="tab"
                    accessibilityLabel={`${item.label} view`}
                    accessibilityState={{ selected: active }}
                    android_ripple={{ color: "rgba(30,36,31,0.12)", borderless: true }}
                    style={({ pressed }) => [
                      styles.segment,
                      active && styles.segmentActive,
                      pressed && !active && styles.segmentPressed,
                    ]}
                    onPress={() => onChangeMode(item.key)}
                  >
                    <Ionicons name={item.icon} size={16} color={active ? COLORS.white : COLORS.textSecondary} />
                    <Text style={[styles.segmentText, active && styles.segmentTextActive]} numberOfLines={1}>
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              accessibilityRole="switch"
              accessibilityLabel={night ? "Switch to daylight" : "Switch to evening light"}
              accessibilityState={{ checked: night }}
              android_ripple={{ color: "rgba(30,36,31,0.16)", borderless: true }}
              style={({ pressed }) => [
                styles.roundButton,
                night && styles.roundButtonActive,
                pressed && styles.pressedSurface,
              ]}
              onPress={onToggleNight}
            >
              <Ionicons name={night ? "moon" : "sunny-outline"} size={19} color={night ? COLORS.white : COLORS.textPrimary} />
            </Pressable>
          </View>

          {showRooms && (
            <RoomStrip rooms={roomConfigs} selected={selectedRoom} onSelect={onFocusRoom} />
          )}

          {showHint && (
            <CoachHint
              mode={viewMode}
              onDone={() => coached.current.add(viewMode)}
              text={
                viewMode === "walk"
                  ? "Drag to look around · Tap any piece to edit it"
                  : viewMode === "orbit"
                    ? "Drag to orbit the home · Tap any piece to edit it"
                    : "Drag to rotate the furnished plan"
              }
            />
          )}
        </View>

        {/* ── Bottom cluster ─────────────────────────────────────────────── */}
        <View style={styles.overlayBottom} pointerEvents="box-none">
          {showingAi && (
            <View style={styles.aiResultBar}>
              <View style={styles.aiResultCopy}>
                <Text style={styles.aiResultTag}>AI RENDER</Text>
                <Text style={styles.aiResultLabel} numberOfLines={1}>{currentRender.label}</Text>
              </View>
              <Pressable
                accessibilityLabel="Save this render"
                style={styles.aiResultButton}
                onPress={() => onSaveRender(currentRender.image)}
              >
                <Ionicons name="download-outline" size={18} color={COLORS.white} />
              </Pressable>
              <Pressable
                accessibilityLabel="Back to the live 3D view"
                style={styles.aiResultButton}
                onPress={() => onSetOutputMode("live")}
              >
                <Ionicons name="cube-outline" size={18} color={COLORS.white} />
              </Pressable>
            </View>
          )}

          {inspected && !showingAi && (
            <View style={styles.panelCard}>
              <View style={styles.panelHead}>
                <View style={styles.panelIcon}>
                  <Ionicons name="cube-outline" size={18} color={COLORS.primaryDark} />
                </View>
                <View style={styles.panelHeadCopy}>
                  <Text style={styles.panelEyebrow}>Selected piece</Text>
                  <Text style={styles.panelTitle} numberOfLines={1}>{inspected.name}</Text>
                </View>
                <Pressable
                  accessibilityLabel="Close"
                  style={styles.panelClose}
                  onPress={() => onSelect(null)}
                  hitSlop={LAYOUT.hitSlop}
                >
                  <Ionicons name="close" size={18} color={COLORS.textSecondary} />
                </Pressable>
              </View>

              <Text style={styles.panelMeta}>{inspected.material}</Text>
              <Text style={styles.panelBody} numberOfLines={3}>{inspected.detail}</Text>

              <View style={styles.editorRow}>
                <View style={styles.editorGroup}>
                  <Text style={styles.editorLabel}>Move</Text>
                  <View style={styles.editorButtons}>
                    {[
                      { direction: "left", icon: "chevron-back", label: "left" },
                      { direction: "forward", icon: "chevron-up", label: "forward" },
                      { direction: "back", icon: "chevron-down", label: "back" },
                      { direction: "right", icon: "chevron-forward", label: "right" },
                    ].map((item) => (
                      <Pressable
                        key={item.direction}
                        accessibilityLabel={`Move ${item.label}`}
                        style={styles.editorButton}
                        onPress={() => viewerRef.current?.moveSelected(item.direction)}
                      >
                        <Ionicons name={item.icon} size={18} color={COLORS.textPrimary} />
                      </Pressable>
                    ))}
                  </View>
                </View>
                <View style={styles.editorGroup}>
                  <Text style={styles.editorLabel}>Turn</Text>
                  <View style={styles.editorButtons}>
                    <Pressable
                      accessibilityLabel="Turn left"
                      style={styles.editorButton}
                      onPress={() => viewerRef.current?.rotateSelected(-Math.PI / 12)}
                    >
                      <Ionicons name="return-up-back-outline" size={18} color={COLORS.textPrimary} />
                    </Pressable>
                    <Pressable
                      accessibilityLabel="Turn right"
                      style={styles.editorButton}
                      onPress={() => viewerRef.current?.rotateSelected(Math.PI / 12)}
                    >
                      <Ionicons name="return-up-forward-outline" size={18} color={COLORS.textPrimary} />
                    </Pressable>
                  </View>
                </View>
              </View>

              <Pressable
                accessibilityRole="button"
                style={styles.panelGhost}
                onPress={() => viewerRef.current?.resetSelected()}
              >
                <Ionicons name="refresh-outline" size={16} color={COLORS.textSecondary} />
                <Text style={styles.panelGhostText}>Put it back where Livinai placed it</Text>
              </Pressable>
            </View>
          )}

          {panel === "ai" && !showingAi && (
            <View style={styles.panelCard}>
              <View style={styles.panelHead}>
                <View style={[styles.panelIcon, styles.panelIconAccent]}>
                  <Ionicons name="sparkles" size={18} color={COLORS.accentStrong} />
                </View>
                <View style={styles.panelHeadCopy}>
                  <Text style={styles.panelEyebrow}>Photoreal</Text>
                  <Text style={styles.panelTitle}>AI render</Text>
                </View>
                <Pressable
                  accessibilityLabel="Close"
                  style={styles.panelClose}
                  onPress={() => onSetPanel(null)}
                  hitSlop={LAYOUT.hitSlop}
                >
                  <Ionicons name="close" size={18} color={COLORS.textSecondary} />
                </Pressable>
              </View>

              {viewMode !== "plan" && (
                <>
                  <Text style={styles.fieldLabel}>Camera</Text>
                  <View style={styles.toggleGroup}>
                    <Pressable
                      accessibilityState={{ selected: cameraSource === "designer" }}
                      style={[styles.toggleOption, cameraSource === "designer" && styles.toggleOptionActive]}
                      onPress={() => onSetCameraSource("designer")}
                    >
                      <Text style={[styles.toggleText, cameraSource === "designer" && styles.toggleTextActive]}>
                        Designer
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityState={{ selected: cameraSource === "current" }}
                      style={[styles.toggleOption, cameraSource === "current" && styles.toggleOptionActive]}
                      onPress={() => onSetCameraSource("current")}
                    >
                      <Text style={[styles.toggleText, cameraSource === "current" && styles.toggleTextActive]}>
                        My view
                      </Text>
                    </Pressable>
                  </View>
                </>
              )}

              {/* One line, and only the line that answers "what will I get?".
                  This used to report how many of the furniture pieces the camera
                  had framed and how many doors and windows were preserved —
                  numbers that describe the renderer's bookkeeping, not the
                  picture the user is about to be handed. */}
              <Text style={styles.panelNote}>
                {viewMode === "plan"
                  ? "The plan is rendered from above with the roof open."
                  : cameraSource === "designer"
                    ? "The camera moves to the corner that shows the most of this room."
                    : "Rendered from exactly the view you are looking at."}
              </Text>

              <View style={styles.panelActions}>
                {!!currentRender && (
                  <Pressable style={styles.panelSecondary} onPress={() => onSetOutputMode("ai")}>
                    <Ionicons name="image-outline" size={17} color={COLORS.primaryDark} />
                    <Text style={styles.panelSecondaryText}>Last result</Text>
                  </Pressable>
                )}
                <Pressable
                  style={[styles.panelPrimary, rendering && styles.panelPrimaryBusy]}
                  disabled={rendering}
                  onPress={onRender}
                >
                  {rendering
                    ? <ActivityIndicator size="small" color={COLORS.white} />
                    : <Ionicons name="sparkles" size={17} color={COLORS.white} />}
                  <Text style={styles.panelPrimaryText}>
                    {rendering ? "Generating…" : viewMode === "plan" ? "Render bird view" : "Render this view"}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}

          {showStick && <MoveStick onChange={drive} />}

          {!showingAi && (
            <View style={styles.dock} pointerEvents="box-none">
              {/* The chip reports work the person did not start and cannot see
                  finish, so it is announced rather than only drawn. */}
              <View
                style={styles.statusChip}
                accessibilityRole="text"
                accessibilityLiveRegion="polite"
                accessibilityLabel={status.label}
              >
                {status.busy
                  ? <ActivityIndicator size="small" color={COLORS.primaryDark} />
                  : <View style={styles.statusDot} />}
                <Text style={styles.statusText} numberOfLines={1}>{status.label}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="AI render options"
                accessibilityState={{ expanded: panel === "ai" }}
                android_ripple={{ color: "rgba(255,255,255,0.18)", borderless: false }}
                style={({ pressed }) => [
                  styles.dockPrimary,
                  panel === "ai" && styles.dockPrimaryActive,
                  pressed && styles.pressedSurface,
                ]}
                onPress={() => onSetPanel(panel === "ai" ? null : "ai")}
              >
                <Ionicons name="sparkles" size={18} color={COLORS.white} />
                <Text style={styles.dockPrimaryText}>Render</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Take a photo of this view"
                accessibilityState={{ busy: busy === "capture", disabled: busy === "capture" }}
                android_ripple={{ color: "rgba(30,36,31,0.16)", borderless: true }}
                style={({ pressed }) => [
                  styles.dockIcon,
                  pressed && styles.pressedSurface,
                  busy === "capture" && styles.dockIconBusy,
                ]}
                onPress={onCapture}
                disabled={busy === "capture"}
              >
                {busy === "capture"
                  ? <ActivityIndicator color={COLORS.textPrimary} size="small" />
                  : <Ionicons name="camera-outline" size={20} color={COLORS.textPrimary} />}
              </Pressable>
            </View>
          )}
        </View>
      </View>
      )}
    </View>
  );
}

/**
 * The room jump strip.
 *
 * Two things it now does that a plain map over pills did not. It keeps the
 * selected room on screen — walking into room seven used to leave its pill
 * scrolled off the left with nothing to say so — and its targets clear the 44pt
 * minimum, which the previous 34pt pills did not.
 */
function RoomStrip({ rooms, selected, onSelect }) {
  const scroller = useRef(null);
  const offsets = useRef([]);

  useEffect(() => {
    const x = offsets.current[selected];
    if (typeof x !== "number") return;
    // Leave a pill's worth of room to the left so the selected one never sits
    // flush against the edge, where it reads as "the first room".
    scroller.current?.scrollTo({ x: Math.max(0, x - ms(64)), animated: true });
  }, [selected]);

  return (
    <ScrollView
      ref={scroller}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.roomStrip}
      contentContainerStyle={styles.roomStripContent}
      accessibilityRole="tablist"
    >
      {rooms.map((room, index) => {
        const active = selected === index;
        return (
          <Pressable
            key={`jump-${index}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            android_ripple={{ color: "rgba(30,36,31,0.12)", borderless: false }}
            hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
            onLayout={(event) => { offsets.current[index] = event.nativeEvent.layout.x; }}
            style={({ pressed }) => [
              styles.roomPill,
              active && styles.roomPillActive,
              pressed && !active && styles.pressedSurface,
            ]}
            onPress={() => onSelect(index)}
          >
            <Text style={[styles.roomPillText, active && styles.roomPillTextActive]} numberOfLines={1}>
              {room.name || room.roomType}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/**
 * The "drag to look around" coach mark.
 *
 * It used to be permanent. A tip that never leaves stops being a tip and
 * becomes a label covering the room the person came here to look at, so it now
 * fades out on its own and comes back only when the controls change meaning —
 * which is exactly when it is worth reading again.
 */
function CoachHint({ mode, text, onDone }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(true);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    setMounted(true);
    opacity.setValue(0);
    const animation = Animated.sequence([
      Animated.timing(opacity, {
        toValue: 1,
        duration: MOTION.base,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.delay(HINT_VISIBLE_MS),
      Animated.timing(opacity, {
        toValue: 0,
        duration: MOTION.slow,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]);
    animation.start(({ finished }) => {
      if (!finished) return;
      done.current?.();
      setMounted(false);
    });
    return () => animation.stop();
  }, [mode, opacity]);

  if (!mounted) return null;

  return (
    <Animated.View style={[styles.hintPill, { opacity }]} pointerEvents="none">
      <Ionicons name={mode === "walk" ? "hand-left-outline" : "sync-outline"} size={14} color={COLORS.white} />
      <Text style={styles.hintText} numberOfLines={2}>{text}</Text>
    </Animated.View>
  );
}

/**
 * Waiting for the home to be built.
 *
 * A bare spinner over a blank panel gave no sense of scale or progress on a job
 * that can take the better part of a minute. This says what is being built, how
 * big it is, and — through a moving track and rotating captions — that the wait
 * is proceeding rather than stuck.
 */
function SceneBuildingState({ rooms = 0 }) {
  const sweep = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const [step, setStep] = useState(0);
  // Measured rather than assumed: the card is a percentage of the viewport, so
  // a hard-coded travel distance would under- or overshoot on other phones.
  const [trackWidth, setTrackWidth] = useState(0);
  const barWidth = Math.max(ms(48), trackWidth * 0.36);

  useEffect(() => {
    const track = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 1400,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    );
    const breathe = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    track.start();
    breathe.start();
    const ticker = setInterval(() => setStep((value) => (value + 1) % BUILD_STEPS.length), 2600);
    return () => { track.stop(); breathe.stop(); clearInterval(ticker); };
  }, [pulse, sweep]);

  return (
    <View style={styles.stateCard} accessibilityRole="progressbar" accessibilityLabel={BUILD_STEPS[step]}>
      <Animated.View
        style={[
          styles.stateIconBrand,
          {
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) }],
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }),
          },
        ]}
      >
        <Ionicons name="home-outline" size={26} color={COLORS.primaryDark} />
      </Animated.View>

      <Text style={styles.stateTitle}>Building your home in 3D</Text>
      <Text style={styles.stateBody}>
        {rooms > 0
          ? `Measuring ${rooms === 1 ? "your room" : `all ${rooms} rooms`}, then furnishing them with the same pieces and finishes Livinai uses on the web.`
          : "Measuring your rooms, then furnishing them with the same pieces and finishes Livinai uses on the web."}
      </Text>

      {/* Indeterminate, because the exporter cannot report a percentage. A bar
          that invents one is worse than a bar that only proves it is alive. */}
      <View
        style={styles.progressTrack}
        onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
      >
        {trackWidth > 0 && (
          <Animated.View
            style={[
              styles.progressBar,
              {
                width: barWidth,
                transform: [{
                  translateX: sweep.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-barWidth, trackWidth],
                  }),
                }],
              },
            ]}
          />
        )}
      </View>

      <Text style={styles.stateStep} numberOfLines={1}>{BUILD_STEPS[step]}</Text>
    </View>
  );
}

/**
 * When the home could not be built.
 *
 * The previous version printed whatever the server said straight into the body
 * copy, which is how a Python traceback — file paths, line numbers,
 * `ModuleNotFoundError` — ended up being shown to someone decorating a flat as
 * the explanation for their own home. The sentence a person reads is now plain
 * language and the diagnostics live behind a disclosure, where they are still
 * one tap away for whoever is actually debugging the server.
 */
function SceneErrorState({ message, detail, onRetry, onBack }) {
  const [showDetail, setShowDetail] = useState(false);

  return (
    <View style={styles.stateCard} accessibilityRole="alert" accessibilityLiveRegion="assertive">
      <View style={styles.stateIconDanger}>
        <Ionicons name="cube-outline" size={26} color={COLORS.danger} />
      </View>

      <Text style={styles.stateTitle}>Your home could not be built</Text>
      <Text style={styles.stateBody}>
        {message || "The 3D service did not respond. Your plan and your rooms are safe."}
      </Text>
      <Text style={styles.stateReassure}>Nothing you drew has been lost.</Text>

      <Pressable
        accessibilityRole="button"
        android_ripple={{ color: "rgba(255,255,255,0.20)" }}
        style={({ pressed }) => [styles.statePrimary, pressed && styles.pressedSurface]}
        onPress={onRetry}
      >
        <Ionicons name="refresh" size={17} color={COLORS.white} />
        <Text style={styles.statePrimaryText}>Try again</Text>
      </Pressable>

      {!!onBack && (
        <Pressable
          accessibilityRole="button"
          android_ripple={{ color: "rgba(30,36,31,0.10)" }}
          style={({ pressed }) => [styles.stateSecondary, pressed && styles.pressedSurface]}
          onPress={onBack}
        >
          {/* Matches the header's own wording for the same destination. */}
          <Text style={styles.stateSecondaryText}>Back to Style</Text>
        </Pressable>
      )}

      {!!detail && (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showDetail }}
            hitSlop={LAYOUT.hitSlop}
            style={styles.stateDisclosure}
            onPress={() => setShowDetail((value) => !value)}
          >
            <Text style={styles.stateDisclosureText}>
              {showDetail ? "Hide technical details" : "Technical details"}
            </Text>
            <Ionicons
              name={showDetail ? "chevron-up" : "chevron-down"}
              size={14}
              color={COLORS.textTertiary}
            />
          </Pressable>
          {showDetail && (
            <ScrollView style={styles.stateDetail} contentContainerStyle={styles.stateDetailContent}>
              <Text style={styles.stateDetailText} selectable>{detail}</Text>
            </ScrollView>
          )}
        </>
      )}
    </View>
  );
}

/**
 * What the status chip says.
 *
 * The chip used to report which renderer had produced the scene, which meant
 * shipping an environment variable name to people who are decorating a flat.
 * It now says what someone standing in the room would want to know: whether the
 * home is still being furnished, and how much is in it.
 */
function describeScene(sceneInfo) {
  if (!sceneInfo) return { busy: true, label: "Furnishing your home…" };
  // "Settled", not "loaded": a model that failed to parse is still finished,
  // and the chip must not claim to be loading for the rest of the session.
  const streaming = (sceneInfo.catalogSettled ?? 0) < (sceneInfo.catalogRequested ?? 0);
  if (streaming) return { busy: true, label: "Adding furniture detail…" };
  const rooms = sceneInfo.rooms === 1 ? "1 room" : `${sceneInfo.rooms} rooms`;
  return { busy: false, label: `${rooms} · ${sceneInfo.objects} pieces` };
}

// ── Small building blocks ──────────────────────────────────────────────────
/**
 * Analog movement stick.
 *
 * This replaces four separate arrow buttons that each stepped the camera a
 * fixed distance on a repeat timer: walking anywhere took a sustained press on
 * a 42pt target, and moving diagonally was impossible. One stick gives
 * proportional speed and any direction from a single thumb, and the scene
 * already accepted a joystick vector — only the UI was missing.
 */
function MoveStick({ onChange }) {
  const travel = ms(34); // how far the knob can leave centre
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const latest = useRef(onChange);
  latest.current = onChange;

  const responder = useMemo(
    () => {
      const release = () => {
        setKnob({ x: 0, y: 0 });
        latest.current(0, 0);
      };
      const apply = (dx, dy) => {
        const distance = Math.hypot(dx, dy) || 1;
        const reach = Math.min(distance, travel);
        const x = (dx / distance) * reach;
        const y = (dy / distance) * reach;
        setKnob({ x, y });
        latest.current(x / travel, y / travel);
      };
      return PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => apply(0, 0),
        onPanResponderMove: (_, gesture) => apply(gesture.dx, gesture.dy),
        onPanResponderRelease: release,
        onPanResponderTerminate: release,
      });
    },
    [travel],
  );

  // A finger lifted outside the stick, or a mode change mid-gesture, would
  // otherwise leave the camera walking forward forever.
  useEffect(() => () => latest.current(0, 0), []);

  return (
    <View style={styles.stickBase} {...responder.panHandlers}>
      <Ionicons name="chevron-up" size={13} color={COLORS.textTertiary} style={styles.stickUp} />
      <Ionicons name="chevron-down" size={13} color={COLORS.textTertiary} style={styles.stickDown} />
      <Ionicons name="chevron-back" size={13} color={COLORS.textTertiary} style={styles.stickLeft} />
      <Ionicons name="chevron-forward" size={13} color={COLORS.textTertiary} style={styles.stickRight} />
      <View style={[styles.stickKnob, { transform: [{ translateX: knob.x }, { translateY: knob.y }] }]}>
        <Ionicons name="walk" size={20} color={COLORS.white} />
      </View>
    </View>
  );
}

/**
 * Editable width × depth for one room.
 *
 * Dragging a corner handle on a phone can never land on "4.20 m", so the
 * measured numbers are typed. The field keeps its own text while it is being
 * edited and only commits on blur, otherwise re-scaling the polygon on every
 * keystroke would fight the caret.
 */
function RoomSizeRow({ index, label, room, pixelsPerMeter, active, compact, onFocus, onResize }) {
  const bounds = polygonBounds(room);
  const widthMeters = bounds.width / pixelsPerMeter;
  const depthMeters = bounds.height / pixelsPerMeter;
  const areaMeters = polygonArea(room) / (pixelsPerMeter * pixelsPerMeter);
  const [drafts, setDrafts] = useState(null);

  const shown = drafts || {
    width: widthMeters.toFixed(2),
    depth: depthMeters.toFixed(2),
  };

  const commit = () => {
    if (!drafts) return;
    const nextWidth = Number.parseFloat(drafts.width);
    const nextDepth = Number.parseFloat(drafts.depth);
    setDrafts(null);
    if (!Number.isFinite(nextWidth) || !Number.isFinite(nextDepth)) return;
    if (Math.abs(nextWidth - widthMeters) < 0.005 && Math.abs(nextDepth - depthMeters) < 0.005) return;
    onResize(index, nextWidth, nextDepth);
  };

  return (
    <View style={[styles.roomSizeRow, active && !compact && styles.roomSizeRowActive]}>
      {!compact && <Text style={styles.roomSizeLabel} numberOfLines={1}>{label}</Text>}
      {compact && <Text style={styles.fieldLabel}>{label}</Text>}
      <View style={styles.roomSizeFields}>
        <View style={styles.roomSizeField}>
          <TextInput
            style={styles.roomSizeInput}
            keyboardType="decimal-pad"
            value={shown.width}
            selectTextOnFocus
            onFocus={onFocus}
            onChangeText={(value) => setDrafts({ ...shown, width: value })}
            onBlur={commit}
            onSubmitEditing={commit}
          />
          <Text style={styles.roomSizeUnit}>m</Text>
        </View>
        <Text style={styles.roomSizeTimes}>×</Text>
        <View style={styles.roomSizeField}>
          <TextInput
            style={styles.roomSizeInput}
            keyboardType="decimal-pad"
            value={shown.depth}
            selectTextOnFocus
            onFocus={onFocus}
            onChangeText={(value) => setDrafts({ ...shown, depth: value })}
            onBlur={commit}
            onSubmitEditing={commit}
          />
          <Text style={styles.roomSizeUnit}>m</Text>
        </View>
        <Text style={styles.roomSizeArea}>{areaMeters.toFixed(1)} m²</Text>
      </View>
    </View>
  );
}

/**
 * Free width for the selected opening, in metres.
 *
 * The presets below it are shortcuts, not a cage: the steppers and the typed
 * value can set anything from a 0.3 m slot to a full-wall opening. The value is
 * clamped to the host wall by the snapper, so an over-long entry lands on the
 * widest span that wall can actually give.
 */
function OpeningWidthControl({ widthMeters, onChange }) {
  const [draft, setDraft] = useState(null);
  const shown = draft ?? widthMeters.toFixed(2);
  const step = (delta) => {
    setDraft(null);
    onChange(Math.max(OPENING_MIN_METERS, Math.round((widthMeters + delta) * 100) / 100));
  };
  const commit = () => {
    if (draft === null) return;
    const value = Number.parseFloat(draft);
    setDraft(null);
    if (!Number.isFinite(value) || Math.abs(value - widthMeters) < 0.005) return;
    onChange(Math.max(OPENING_MIN_METERS, value));
  };
  return (
    <View style={styles.openingWidth}>
      <Text style={styles.fieldLabel}>Width</Text>
      <View style={styles.openingWidthRow}>
        <Pressable
          accessibilityLabel="Narrow this opening"
          style={[styles.openingWidthStep, widthMeters <= OPENING_MIN_METERS && styles.openingWidthStepDisabled]}
          disabled={widthMeters <= OPENING_MIN_METERS}
          onPress={() => step(-0.1)}
        >
          <Ionicons name="remove" size={16} color={COLORS.textPrimary} />
        </Pressable>
        <View style={styles.openingWidthField}>
          <TextInput
            style={styles.openingWidthInput}
            keyboardType="decimal-pad"
            value={String(shown)}
            selectTextOnFocus
            onChangeText={setDraft}
            onBlur={commit}
            onSubmitEditing={commit}
          />
          <Text style={styles.openingWidthUnit}>m</Text>
        </View>
        <Pressable
          accessibilityLabel="Widen this opening"
          style={styles.openingWidthStep}
          onPress={() => step(0.1)}
        >
          <Ionicons name="add" size={16} color={COLORS.textPrimary} />
        </Pressable>
      </View>
    </View>
  );
}

function CurveControls({
  edgeType,
  onChangeEdgeType,
  settings,
  onChangeSettings,
  stage = 0,
  curveStaged = false,
  onApplyCurve,
  onCancelCurve,
}) {
  const update = (key, value) => onChangeSettings((current) => ({ ...current, [key]: value }));
  return (
    <View style={styles.curveCard}>
      {/* A label and a two-way switch on one line. This used to be a title, a
          sentence about how curves are stored, and a full-width segmented
          control stacked below them — three rows to answer straight or not. */}
      <View style={styles.curveHead}>
        <Text style={styles.curveTitle}>Walls</Text>
        <View style={styles.curveSegmented}>
          {[
            ["straight", "Straight"],
            ["rounded", "Rounded"],
          ].map(([value, label]) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected: edgeType === value }}
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
          <Text style={styles.curveCopy}>
            {stage === 0
              ? "Tap the first corner of the room."
              : curveStaged
                ? "Adjust the shape, then add the wall."
                : "Tap where this wall ends, or tap the first corner to close the room."}
          </Text>

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
          <CurveStepper label="Curve strength" value={settings.intensity} min={0} max={100} step={5} suffix="%" onChange={(value) => update("intensity", value)} />
          <CurveStepper label="Bend position" value={settings.position} min={15} max={85} step={5} suffix="%" onChange={(value) => update("position", value)} />
          <CurveStepper label="Curve tilt" value={settings.angle} min={-55} max={55} step={5} suffix="°" onChange={(value) => update("angle", value)} />
          {curveStaged ? (
            <View style={styles.curveApplyRow}>
              <Pressable style={styles.curveCancel} onPress={onCancelCurve}>
                <Text style={styles.curveCancelText}>Cancel curve</Text>
              </Pressable>
              <Pressable style={styles.curveApply} onPress={onApplyCurve}>
                <Ionicons name="add" size={15} color={COLORS.white} />
                <Text style={styles.curveApplyText}>Add curved wall</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable style={styles.curveReset} onPress={() => onChangeSettings({ ...DEFAULT_CURVE_SETTINGS })}>
              <Ionicons name="refresh-outline" size={13} color={COLORS.primaryDark} />
              <Text style={styles.curveResetText}>Reset curve shape</Text>
            </Pressable>
          )}
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

/**
 * The library — the screen the 3D walkthrough opens on.
 *
 * It answers exactly one question: which plan? Either an existing one, or a new
 * one. Where a new plan's outline comes from — a traced photo or an empty grid —
 * is asked once, inside the editor, next to the canvas it affects. It used to be
 * asked here as well, so the same decision appeared twice in a two-screen flow
 * and the answer given on the first screen could be silently changed on the
 * second.
 */
function PlanLibrary({ projects, loading, synced, signedIn, onBack, onRefresh, onStart, onOpen, onRename, onDelete }) {
  return (
    <View style={styles.libraryScreen}>
      <LinearGradient colors={COLORS.gradientBrandDeep} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
        <SafeAreaView edges={["top"]} style={styles.libraryHeader}>
          <View style={styles.headerRow}>
            <Pressable accessibilityLabel="Back" onPress={onBack} hitSlop={LAYOUT.hitSlop} style={styles.headerButton}>
              <Ionicons name="chevron-back" size={20} color={COLORS.white} />
            </Pressable>
            <View style={styles.headerCopy}>
              <Text style={styles.headerEyebrow}>3D Walkthrough</Text>
              <Text style={styles.headerTitle}>Your plans</Text>
            </View>
            <Pressable
              accessibilityLabel="Refresh your saved plans"
              style={styles.headerButton}
              onPress={onRefresh}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator size="small" color={COLORS.white} />
                : <Ionicons name="refresh-outline" size={18} color={COLORS.white} />}
            </Pressable>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <ScrollView
        contentContainerStyle={styles.libraryBody}
        showsVerticalScrollIndicator={false}
      >
        {loading && !projects.length ? (
          <View style={styles.libraryLoading}>
            <ActivityIndicator color={COLORS.primaryDark} />
          </View>
        ) : projects.length ? (
          projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onOpen={() => onOpen(project)}
              onRename={() => onRename(project)}
              onDelete={() => onDelete(project)}
            />
          ))
        ) : (
          <View style={styles.libraryEmpty}>
            <Ionicons name="cube-outline" size={30} color={COLORS.textTertiary} />
            <Text style={styles.libraryEmptyTitle}>No plans yet</Text>
            <Text style={styles.libraryEmptyText}>
              Draw your home to scale, walk through it, then render it with AI.
            </Text>
          </View>
        )}

        {/* One line about where plans live, and only once there is a plan to
            worry about losing. */}
        {!!projects.length && (
          <View style={styles.syncNote}>
            <Ionicons
              name={synced ? "cloud-done-outline" : signedIn ? "cloud-offline-outline" : "phone-portrait-outline"}
              size={13}
              color={synced ? COLORS.success : COLORS.textTertiary}
            />
            <Text style={styles.syncNoteText}>
              {synced
                ? "Saved to your account."
                : signedIn
                  ? "Saved on this device — your account copy updates on the next save."
                  : "Saved on this device. Sign in to keep your plans on your account."}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* One primary action, docked, always reachable however long the list is. */}
      <SafeAreaView edges={["bottom"]} style={styles.libraryFooter}>
        <Pressable
          style={styles.libraryPrimary}
          accessibilityRole="button"
          accessibilityLabel="Start a new 3D plan"
          onPress={onStart}
        >
          <Ionicons name="add" size={20} color={COLORS.white} />
          <Text style={styles.libraryPrimaryText}>New plan</Text>
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

function ProjectCard({ project, onOpen, onRename, onDelete }) {
  const updated = project.updatedAt ? new Date(project.updatedAt) : null;
  const meta = [
    `${project.roomCount || 0} ${project.roomCount === 1 ? "room" : "rooms"}`,
    project.areaMeters ? `${Number(project.areaMeters).toFixed(1)} m²` : null,
    updated && !Number.isNaN(updated.valueOf()) ? updated.toLocaleDateString() : null,
  ].filter(Boolean).join(" · ");

  return (
    <Pressable style={styles.projectCard} onPress={onOpen} accessibilityRole="button">
      <View style={styles.projectThumbnail}>
        {project.thumbnail ? (
          <Image source={{ uri: project.thumbnail }} style={styles.projectThumbnailImage} resizeMode="cover" />
        ) : (
          <Ionicons name="cube-outline" size={22} color={COLORS.primaryDark} />
        )}
      </View>

      {/* Name and one line of facts. A row of "Traced"/"Drawn"/"This device"
          tags used to sit under this, repeating what the thumbnail shows and what
          the note at the foot of the list already says once for every plan. */}
      <View style={styles.projectCardCopy}>
        <Text style={styles.projectCardTitle} numberOfLines={1}>{project.title}</Text>
        <Text style={styles.projectCardMeta} numberOfLines={1}>{meta}</Text>
      </View>

      <View style={styles.projectActions}>
        <Pressable
          accessibilityLabel={`Rename ${project.title}`}
          hitSlop={LAYOUT.hitSlop}
          style={styles.projectAction}
          onPress={onRename}
        >
          <Ionicons name="create-outline" size={16} color={COLORS.textSecondary} />
        </Pressable>
        <Pressable
          accessibilityLabel={`Delete ${project.title}`}
          hitSlop={LAYOUT.hitSlop}
          style={[styles.projectAction, styles.projectActionDanger]}
          onPress={onDelete}
        >
          <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
        </Pressable>
      </View>
    </Pressable>
  );
}

/**
 * Where the plan being traced comes from — the one place that question is asked.
 *
 * A single line: what the canvas is showing, and the one action that changes it.
 * The state and the action used to be spread over an icon, a title, a subtitle,
 * a button and a clear button; four of those five described something the user
 * can see for themselves on the canvas directly below.
 */
function PlanSourceBar({ planImage, detecting, error, onUpload, onClear }) {
  return (
    <View style={styles.sourceBar}>
      <View style={styles.sourceBarRow}>
        {detecting
          ? <ActivityIndicator size="small" color={COLORS.primaryDark} />
          : <Ionicons name={planImage ? "image" : "grid-outline"} size={16} color={COLORS.primaryDark} />}
        <Text style={styles.sourceBarTitle} numberOfLines={1}>
          {detecting ? "Reading your plan…" : planImage ? "Tracing your plan" : "Blank grid"}
        </Text>
        <Pressable style={styles.sourceBarButton} onPress={onUpload} disabled={detecting} hitSlop={LAYOUT.hitSlop}>
          <Text style={styles.sourceBarButtonText}>{planImage ? "Replace" : "Trace a photo"}</Text>
        </Pressable>
        {!!planImage && (
          <Pressable
            accessibilityLabel="Remove the uploaded plan"
            onPress={onClear}
            hitSlop={LAYOUT.hitSlop}
          >
            <Ionicons name="close-circle" size={18} color={COLORS.textTertiary} />
          </Pressable>
        )}
      </View>
      {!!error && <Text style={styles.sourceBarError}>{error}</Text>}
    </View>
  );
}

/**
 * The drawing tools: one 4×2 grid, every cell the same size.
 *
 * The previous palette had a header, three labelled groups and pill buttons
 * sized by their own text, so eight controls occupied five stacked rows of
 * mismatched widths. A fixed grid says the same thing in two rows, and equal
 * cells make it read as one control rather than eight competing ones. Grid
 * snapping lives here too — it changes what a tap does, so it belongs with the
 * tools, not with undo and delete.
 */
function ToolPalette({ tool, onChange, snapToGrid, onToggleSnap }) {
  return (
    <View style={styles.palette}>
      {TOOLS.map((item) => {
        const active = tool === item.key;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: active }}
            style={styles.toolCell}
            onPress={() => onChange(item.key)}
          >
            <View style={[styles.tool, active && styles.toolActive]}>
              <Ionicons name={item.icon} size={18} color={active ? COLORS.white : COLORS.textSecondary} />
              <Text style={[styles.toolLabel, active && styles.toolLabelActive]} numberOfLines={1}>
                {item.label}
              </Text>
            </View>
          </Pressable>
        );
      })}

      <Pressable
        accessibilityRole="switch"
        accessibilityLabel="Snap to the grid"
        accessibilityState={{ checked: snapToGrid }}
        style={styles.toolCell}
        onPress={onToggleSnap}
      >
        <View style={[styles.tool, snapToGrid && styles.toolSnapActive]}>
          <Ionicons
            name={snapToGrid ? "magnet" : "magnet-outline"}
            size={18}
            color={snapToGrid ? COLORS.primaryDark : COLORS.textTertiary}
          />
          <Text
            style={[styles.toolLabel, snapToGrid && styles.toolSnapActiveLabel]}
            numberOfLines={1}
          >
            Snap
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

/** One cell of the equal-width action row under the canvas. */
function ActionButton({ icon, label, onPress, disabled, active, tone }) {
  const color = disabled
    ? COLORS.textTertiary
    : tone === "danger"
      ? COLORS.danger
      : active
        ? COLORS.primaryDark
        : COLORS.textSecondary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected: !!active }}
      style={styles.actionCell}
      onPress={onPress}
      disabled={disabled}
    >
      <View style={[styles.action, active && styles.actionActive, disabled && styles.actionDisabled]}>
        <Ionicons name={icon} size={17} color={color} />
        <Text style={[styles.actionLabel, { color }]} numberOfLines={1}>{label}</Text>
      </View>
    </Pressable>
  );
}

/**
 * Both dialogs are the app's existing confirm dialog, the one the Collection
 * screen uses to confirm deleting a design: a centred card, centred copy, and two
 * equal-width buttons — outlined Cancel beside a filled confirm. They previously
 * had their own shape, with a content-sized Cancel next to a flexing confirm, so
 * two screens asked the same question in two different visual languages.
 */
function ConfirmDialog({ visible, title, message, confirmLabel, confirmDisabled, onCancel, onConfirm, children }) {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.dialogOverlay} onPress={onCancel}>
        <Pressable style={styles.dialogContent} onPress={() => {}}>
          <Text style={styles.dialogTitle}>{title}</Text>
          {!!message && <Text style={styles.dialogMessage}>{message}</Text>}
          {children}
          <View style={styles.dialogActions}>
            <Pressable style={[styles.dialogButton, styles.dialogCancel]} onPress={onCancel}>
              <Text style={styles.dialogCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.dialogButton, styles.dialogConfirm, confirmDisabled && styles.dialogConfirmDisabled]}
              disabled={confirmDisabled}
              onPress={onConfirm}
            >
              <Text style={styles.dialogConfirmText}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function RenameSheet({ target, currentTitle, onClose, onSubmit }) {
  const [value, setValue] = useState("");

  useEffect(() => {
    if (!target) return;
    setValue(target === "current" ? currentTitle : target.title || "");
  }, [currentTitle, target]);

  return (
    <ConfirmDialog
      visible={!!target}
      title="Name this plan"
      confirmLabel="Save"
      confirmDisabled={!value.trim()}
      onCancel={onClose}
      onConfirm={() => onSubmit(value)}
    >
      <TextInput
        style={styles.dialogInput}
        value={value}
        onChangeText={setValue}
        placeholder="Untitled 3D plan"
        placeholderTextColor={COLORS.placeholderText}
        maxLength={60}
        autoFocus
        selectTextOnFocus
        onSubmitEditing={() => value.trim() && onSubmit(value)}
      />
    </ConfirmDialog>
  );
}

function ConfirmSheet({ project, onCancel, onConfirm }) {
  return (
    <ConfirmDialog
      visible={!!project}
      title="Delete Plan"
      message={`Are you sure you want to delete “${project?.title || "this plan"}”?`}
      confirmLabel="Delete"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
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

  // ── Header, shared by the library and the editor ─────────────────────────
  header: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.base },
  headerRow: { flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingTop: SPACING.sm },
  headerButton: {
    width: ms(40), height: ms(40), borderRadius: RADIUS.md,
    alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.16)",
  },
  headerCopy: { flex: 1, minWidth: 0 },
  headerEyebrow: { ...TYPE.overline, color: "rgba(255,255,255,0.68)" },
  headerTitleRow: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  headerTitle: { ...TYPE.h2, color: COLORS.white, marginTop: 1, flexShrink: 1 },

  stepper: { flexDirection: "row", alignItems: "center", marginTop: SPACING.base },
  step: {
    width: ms(22), height: ms(22), borderRadius: RADIUS.pill,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.34)",
  },
  stepReached: { backgroundColor: COLORS.white, borderColor: COLORS.white },
  // The current step is a size larger than the rest, so "where am I" is legible
  // from the shape alone — a filled dot on its own only says "done".
  stepActive: { width: ms(27), height: ms(27) },
  stepConnector: { width: ms(20), height: 2, backgroundColor: "rgba(255,255,255,0.24)" },
  stepConnectorDone: { backgroundColor: COLORS.white },
  stepNumber: { ...TYPE.caption, fontSize: 11, color: "rgba(255,255,255,0.72)" },
  stepNumberActive: { color: COLORS.brand800 },
  stepCaption: { ...TYPE.caption, color: COLORS.white, marginLeft: SPACING.md, flexShrink: 1 },

  // ── Library ──────────────────────────────────────────────────────────────
  libraryScreen: { flex: 1, backgroundColor: COLORS.background },
  libraryHeader: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.lg },
  libraryBody: { padding: SPACING.base, paddingBottom: SPACING.xl, gap: SPACING.sm },
  libraryFooter: {
    paddingHorizontal: SPACING.base, paddingTop: SPACING.sm + 2, paddingBottom: SPACING.sm + 2,
    backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  libraryPrimary: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SPACING.xs + 2,
    height: ms(46), borderRadius: RADIUS.md, backgroundColor: COLORS.primaryDark,
  },
  libraryPrimaryText: { ...TYPE.caption, fontSize: 13.5, color: COLORS.white },

  syncNote: {
    flexDirection: "row", alignItems: "center", gap: SPACING.sm,
    paddingHorizontal: SPACING.xs, marginBottom: SPACING.xs,
  },
  syncNoteText: { flex: 1, ...TYPE.caption, color: COLORS.textTertiary, lineHeight: 16 },
  libraryLoading: { paddingVertical: SPACING.xxl, alignItems: "center" },
  libraryEmpty: {
    alignItems: "center", padding: SPACING.xl, gap: SPACING.xs,
    borderRadius: RADIUS.xl, backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.border, borderStyle: "dashed",
  },
  libraryEmptyTitle: { ...TYPE.h3, color: COLORS.textPrimary },
  libraryEmptyText: { ...TYPE.small, color: COLORS.textSecondary, textAlign: "center", lineHeight: 19 },

  projectCard: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md,
    padding: SPACING.md, borderRadius: RADIUS.lg, backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.border, ...SHADOW.xs,
  },
  projectThumbnail: {
    width: ms(58), height: ms(58), borderRadius: RADIUS.md, overflow: "hidden",
    alignItems: "center", justifyContent: "center", backgroundColor: COLORS.surfaceSunken,
  },
  projectThumbnailImage: { width: "100%", height: "100%" },
  projectCardCopy: { flex: 1, minWidth: 0, gap: 3 },
  projectCardTitle: { ...TYPE.bodyStrong, color: COLORS.textPrimary },
  projectCardMeta: { ...TYPE.caption, color: COLORS.textTertiary },
  projectActions: { flexDirection: "row", gap: SPACING.xs },
  projectAction: {
    width: ms(32), height: ms(32), borderRadius: RADIUS.pill,
    alignItems: "center", justifyContent: "center", backgroundColor: COLORS.surfaceSunken,
  },
  projectActionDanger: { backgroundColor: COLORS.dangerSoft },

  // ── Editor body ──────────────────────────────────────────────────────────
  // One gutter for the whole flow, so the canvas, the controls under it and the
  // walkthrough overlay on the last step all line up with each other.
  body: { paddingHorizontal: SPACING.base, paddingTop: SPACING.base, paddingBottom: SPACING.xxxl },
  stageCopy: { ...TYPE.small, color: COLORS.textSecondary, marginBottom: SPACING.md },

  sourceBar: {
    marginBottom: SPACING.sm, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm + 2,
    borderRadius: RADIUS.md, backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.border,
  },
  sourceBarRow: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  sourceBarTitle: { flex: 1, minWidth: 0, ...TYPE.caption, color: COLORS.textPrimary },
  sourceBarButton: {
    paddingHorizontal: SPACING.base, height: ms(34), justifyContent: "center",
    borderRadius: RADIUS.pill, backgroundColor: COLORS.primaryTint,
  },
  sourceBarButtonText: { ...TYPE.caption, color: COLORS.primaryDark },
  sourceBarError: {
    ...TYPE.caption, color: COLORS.accentStrong, lineHeight: 17,
    marginTop: SPACING.sm, paddingTop: SPACING.sm,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },

  palette: {
    flexDirection: "row", flexWrap: "wrap",
    marginBottom: SPACING.sm, padding: SPACING.xs,
    borderRadius: RADIUS.lg, backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.border,
  },
  // A quarter each, so two rows of four line up exactly and no label's length
  // can change a button's size.
  toolCell: { width: "25%", padding: 3 },
  tool: {
    height: ms(52), alignItems: "center", justifyContent: "center", gap: 3,
    borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceSunken,
  },
  toolActive: { backgroundColor: COLORS.primaryDark },
  // Snapping is a mode, not a tool, so it is tinted rather than filled — it must
  // not compete with the one tool that is actually armed.
  toolSnapActive: { backgroundColor: COLORS.primaryTint, borderWidth: 1, borderColor: COLORS.primarySoft },
  toolSnapActiveLabel: { color: COLORS.primaryDark },
  toolLabel: { ...TYPE.caption, fontSize: 10, color: COLORS.textSecondary },
  toolLabelActive: { color: COLORS.white },

  hintRow: {
    flexDirection: "row", alignItems: "flex-start", gap: SPACING.sm,
    marginBottom: SPACING.md, paddingHorizontal: SPACING.xs,
  },
  hintRowText: { flex: 1, ...TYPE.caption, color: COLORS.textSecondary, lineHeight: 17 },
  hintRowTool: { color: COLORS.primaryDark },

  canvasFrame: { alignSelf: "center" },
  canvasFrameFocused: { marginHorizontal: -SPACING.base },

  drawingBar: {
    flexDirection: "row", alignItems: "center", gap: SPACING.sm,
    marginTop: SPACING.sm, padding: SPACING.sm, paddingLeft: SPACING.md,
    borderRadius: RADIUS.md, backgroundColor: COLORS.primaryTint,
    borderWidth: 1, borderColor: COLORS.primarySoft,
  },
  drawingBarText: { flex: 1, ...TYPE.caption, color: COLORS.textSecondary, lineHeight: 15 },
  drawingBarGhost: {
    width: ms(32), height: ms(32), borderRadius: RADIUS.pill,
    alignItems: "center", justifyContent: "center", backgroundColor: COLORS.surface,
  },
  drawingBarPrimary: {
    paddingHorizontal: SPACING.base, height: ms(32), alignItems: "center", justifyContent: "center",
    borderRadius: RADIUS.pill, backgroundColor: COLORS.primaryDark,
  },
  drawingBarPrimaryDisabled: { opacity: 0.4 },
  drawingBarPrimaryText: { ...TYPE.caption, color: COLORS.white },

  selectionBar: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md, marginTop: SPACING.sm,
    padding: SPACING.sm, paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border,
  },
  selectionName: { flex: 1, ...TYPE.bodyStrong, color: COLORS.textPrimary },
  selectionAction: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: SPACING.md, paddingVertical: 6,
    borderRadius: RADIUS.pill, backgroundColor: COLORS.dangerSoft,
  },
  selectionActionText: { ...TYPE.caption, color: COLORS.danger },
  openingEditor: {
    marginTop: SPACING.sm, padding: SPACING.base, borderRadius: RADIUS.lg,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, ...SHADOW.xs,
  },



  summaryBar: {
    flexDirection: "row", alignItems: "center", gap: SPACING.sm,
    marginBottom: SPACING.md, padding: SPACING.md, borderRadius: RADIUS.md,
    backgroundColor: COLORS.primaryTint, borderWidth: 1, borderColor: COLORS.primarySoft,
  },
  summaryBarText: { flex: 1, ...TYPE.caption, color: COLORS.primaryDark },

  card: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.base,
    marginTop: SPACING.md, borderWidth: 1, borderColor: COLORS.border, ...SHADOW.xs,
  },
  cardSectionTitle: { ...TYPE.h3, color: COLORS.textPrimary },
  cardHead: { flexDirection: "row", alignItems: "center", gap: SPACING.md, marginBottom: SPACING.xs },
  roomSwatch: { width: ms(10), height: ms(28), borderRadius: RADIUS.xs },
  roomName: { flex: 1, ...TYPE.bodyStrong, color: COLORS.textPrimary, paddingVertical: 4 },
  roomDelete: {
    width: ms(34), height: ms(34), borderRadius: RADIUS.pill,
    alignItems: "center", justifyContent: "center", backgroundColor: COLORS.dangerSoft,
  },

  roomSizeRow: {
    flexDirection: "row", alignItems: "center", gap: SPACING.sm,
    paddingVertical: 6, borderRadius: RADIUS.sm,
  },
  roomSizeRowActive: { backgroundColor: COLORS.primaryTint, paddingHorizontal: SPACING.sm },
  roomSizeLabel: { flex: 1, minWidth: 0, ...TYPE.caption, color: COLORS.textPrimary },
  roomSizeFields: { flexDirection: "row", alignItems: "center", gap: 5 },
  roomSizeField: {
    flexDirection: "row", alignItems: "center", gap: 2,
    paddingHorizontal: 7, height: ms(34), borderRadius: RADIUS.sm,
    backgroundColor: COLORS.surfaceSunken, borderWidth: 1, borderColor: COLORS.border,
  },
  roomSizeInput: { width: ms(42), ...TYPE.caption, color: COLORS.textPrimary, textAlign: "right", padding: 0 },
  roomSizeUnit: { ...TYPE.caption, color: COLORS.textTertiary },
  roomSizeTimes: { ...TYPE.caption, color: COLORS.textTertiary },
  roomSizeArea: { minWidth: ms(54), ...TYPE.caption, color: COLORS.textSecondary, textAlign: "right" },

  openingWidth: { marginTop: SPACING.sm },
  openingWidthRow: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, marginTop: 5 },
  openingWidthStep: {
    width: ms(38), height: ms(38), alignItems: "center", justifyContent: "center",
    borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceSunken,
    borderWidth: 1, borderColor: COLORS.border,
  },
  openingWidthStepDisabled: { opacity: 0.4 },
  openingWidthField: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3,
    paddingHorizontal: SPACING.md, height: ms(38), borderRadius: RADIUS.md,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.borderStrong,
  },
  openingWidthInput: { width: ms(54), ...TYPE.bodyStrong, color: COLORS.textPrimary, textAlign: "right", padding: 0 },
  openingWidthUnit: { ...TYPE.caption, color: COLORS.textTertiary },

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

  disclosure: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginTop: SPACING.md, paddingHorizontal: SPACING.base, height: ms(48),
    borderRadius: RADIUS.lg, backgroundColor: COLORS.primaryTint,
    borderWidth: 1, borderColor: COLORS.primarySoft,
  },
  disclosureText: { ...TYPE.bodyStrong, color: COLORS.primaryDark },

  settingToggle: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md, marginTop: SPACING.md,
    padding: SPACING.base, borderRadius: RADIUS.lg,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  settingToggleIcon: {
    width: ms(22), height: ms(22), borderRadius: 7, borderWidth: 1.5,
    borderColor: COLORS.borderStrong, alignItems: "center", justifyContent: "center",
  },
  settingToggleIconActive: { backgroundColor: COLORS.primaryDark, borderColor: COLORS.primaryDark },
  settingToggleCopy: { flex: 1 },
  settingToggleTitle: { ...TYPE.bodyStrong, color: COLORS.textPrimary },
  settingToggleText: { ...TYPE.caption, color: COLORS.textTertiary, marginTop: 2, lineHeight: 16 },

  notes: {
    minHeight: ms(92), borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceSunken,
    padding: SPACING.md, ...TYPE.small, color: COLORS.textPrimary, textAlignVertical: "top",
  },

  empty: { alignItems: "center", gap: SPACING.sm, paddingVertical: SPACING.xxl },
  emptyText: { ...TYPE.small, color: COLORS.textTertiary },

  // ── Curved-wall controls ─────────────────────────────────────────────────
  curveCard: {
    marginBottom: SPACING.md, padding: SPACING.md, borderRadius: RADIUS.lg,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  curveHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: SPACING.md },
  curveTitle: { ...TYPE.bodyStrong, color: COLORS.textPrimary },
  curveCopy: { ...TYPE.caption, color: COLORS.textTertiary, lineHeight: 17 },
  curveSegmented: { flexDirection: "row", padding: 3, borderRadius: RADIUS.pill, backgroundColor: COLORS.surfaceSunken },
  curveSegment: { minWidth: ms(78), alignItems: "center", paddingVertical: SPACING.sm, borderRadius: RADIUS.pill },
  curveSegmentActive: { backgroundColor: COLORS.primaryDark },
  curveSegmentText: { ...TYPE.caption, color: COLORS.textSecondary },
  curveSegmentTextActive: { color: COLORS.white },
  curveSettings: {
    marginTop: SPACING.md, gap: SPACING.sm,
    borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: SPACING.md,
  },
  curveDirection: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: SPACING.md },
  curveDirectionButtons: { flexDirection: "row", gap: 4 },
  curveDirectionButton: { paddingHorizontal: SPACING.md, paddingVertical: 6, borderRadius: RADIUS.pill, backgroundColor: COLORS.surfaceSunken },
  curveDirectionButtonActive: { backgroundColor: COLORS.primaryTint },
  curveDirectionText: { ...TYPE.caption, color: COLORS.textSecondary },
  curveDirectionTextActive: { color: COLORS.primaryDark },
  curveSettingLabel: { ...TYPE.caption, color: COLORS.textSecondary },
  curveStepper: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: ms(34) },
  curveStepperActions: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  curveStepButton: { width: ms(30), height: ms(30), alignItems: "center", justifyContent: "center", borderRadius: RADIUS.pill, backgroundColor: COLORS.surfaceSunken },
  curveStepValue: { minWidth: ms(46), ...TYPE.caption, color: COLORS.textPrimary, textAlign: "center" },
  curveReset: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 5, paddingVertical: 4 },
  curveResetText: { ...TYPE.caption, color: COLORS.primaryDark },
  curveApplyRow: { flexDirection: "row", gap: SPACING.sm, marginTop: 2 },
  curveCancel: {
    paddingHorizontal: SPACING.md, height: ms(38), alignItems: "center", justifyContent: "center",
    borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceSunken,
  },
  curveCancelText: { ...TYPE.caption, color: COLORS.textSecondary },
  curveApply: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
    height: ms(38), borderRadius: RADIUS.md, backgroundColor: COLORS.primaryDark,
  },
  curveApplyText: { ...TYPE.caption, color: COLORS.white },

  // ── Footer ───────────────────────────────────────────────────────────────
  footer: {
    flexDirection: "row", gap: SPACING.sm, paddingHorizontal: SPACING.base,
    paddingTop: SPACING.sm + 2, paddingBottom: SPACING.sm + 2,
    backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  footerGhost: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  footerGhostText: { ...TYPE.caption, fontSize: 13.5, color: COLORS.textPrimary },
  footerPrimary: { backgroundColor: COLORS.primaryDark },
  footerPrimaryDisabled: { backgroundColor: COLORS.disabled },
  footerPrimaryText: { ...TYPE.caption, fontSize: 13.5, color: COLORS.white },

  // ── Viewer ───────────────────────────────────────────────────────────────
  // One overlay column, pinned to the safe area, holding a top and a bottom
  // cluster. Nothing here is positioned at a hand-tuned offset: each cluster
  // stacks in flow, so adding or hiding a control cannot push another one off
  // screen or under the home indicator.
  viewerWrap: { flex: 1, backgroundColor: COLORS.surfaceAlt },
  // ── Building / failed states ─────────────────────────────────────────────
  // Both states are one card on the sunken background rather than loose text
  // floating in the middle of the screen. The card gives the copy a measured
  // line length and puts the actions where a person is already looking.
  //
  // The previous versions of these two blocks referenced `RADIUS.full` and
  // `TYPE.button`, neither of which exists in the design tokens, so the retry
  // button was rendering with no radius and no type at all.
  exactSceneState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: SPACING.lg,
    backgroundColor: COLORS.surfaceAlt,
  },
  stateCard: {
    width: "100%",
    maxWidth: ms(380),
    alignItems: "center",
    padding: SPACING.xl,
    borderRadius: RADIUS.xl,
    backgroundColor: COLORS.surface,
    ...SHADOW.lg,
  },
  stateIconBrand: {
    width: ms(60), height: ms(60), borderRadius: RADIUS.pill,
    alignItems: "center", justifyContent: "center",
    backgroundColor: COLORS.primaryTint,
  },
  stateIconDanger: {
    width: ms(60), height: ms(60), borderRadius: RADIUS.pill,
    alignItems: "center", justifyContent: "center",
    backgroundColor: COLORS.dangerSoft,
  },
  stateTitle: {
    ...TYPE.h3, color: COLORS.textPrimary,
    marginTop: SPACING.base, textAlign: "center",
  },
  stateBody: {
    ...TYPE.small, color: COLORS.textSecondary,
    marginTop: SPACING.sm, textAlign: "center",
  },
  stateReassure: {
    ...TYPE.caption, color: COLORS.textTertiary,
    marginTop: SPACING.sm, textAlign: "center",
  },
  progressTrack: {
    width: "100%", height: 4, marginTop: SPACING.lg,
    borderRadius: RADIUS.pill, backgroundColor: COLORS.surfaceSunken,
    overflow: "hidden",
  },
  progressBar: {
    height: 4, borderRadius: RADIUS.pill, backgroundColor: COLORS.primary,
  },
  stateStep: {
    ...TYPE.caption, color: COLORS.textTertiary,
    marginTop: SPACING.md, textAlign: "center",
  },
  statePrimary: {
    marginTop: SPACING.lg, alignSelf: "stretch",
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: SPACING.sm, height: ms(50),
    borderRadius: RADIUS.pill, backgroundColor: COLORS.primaryDark,
  },
  statePrimaryText: { ...TYPE.bodyStrong, color: COLORS.white },
  stateSecondary: {
    marginTop: SPACING.sm, alignSelf: "stretch",
    alignItems: "center", justifyContent: "center", height: ms(46),
    borderRadius: RADIUS.pill,
  },
  stateSecondaryText: { ...TYPE.bodyStrong, color: COLORS.primaryDark },
  stateDisclosure: {
    marginTop: SPACING.md,
    flexDirection: "row", alignItems: "center", gap: SPACING.xs,
    minHeight: ms(32), paddingHorizontal: SPACING.sm,
  },
  stateDisclosureText: { ...TYPE.caption, color: COLORS.textTertiary },
  stateDetail: {
    alignSelf: "stretch", maxHeight: ms(140), marginTop: SPACING.sm,
    borderRadius: RADIUS.sm, backgroundColor: COLORS.surfaceSunken,
  },
  stateDetailContent: { padding: SPACING.md },
  stateDetailText: {
    fontSize: 11.5, lineHeight: 17, color: COLORS.textSecondary,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
  },

  // Pressed feedback for the floating controls. Opacity rather than a scale
  // transform: these sit in a row, and scaling one nudges the others.
  pressedSurface: { opacity: 0.78 },
  // Legibility scrims. Without them the white control pills sit on whatever the
  // camera is pointed at, and a pale wall or a bright window leaves them as
  // white-on-white. They are drawn under the overlay and take no touches.
  scrimTop: {
    position: "absolute", top: 0, left: 0, right: 0, height: ms(180),
  },
  scrimBottom: {
    position: "absolute", bottom: 0, left: 0, right: 0, height: ms(220),
  },
  viewerOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "space-between",
    paddingHorizontal: SPACING.base,
  },
  overlayTop: { gap: SPACING.sm },
  overlayBottom: { gap: SPACING.md },

  viewControls: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  segmented: {
    flex: 1, flexDirection: "row", padding: 4,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.pill, ...SHADOW.md,
  },
  // 40 + the 4pt of track padding above and below clears the 44pt minimum.
  segment: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, height: ms(40), borderRadius: RADIUS.pill,
  },
  segmentActive: { backgroundColor: COLORS.primaryDark },
  segmentPressed: { backgroundColor: COLORS.surfaceSunken },
  segmentText: { ...TYPE.caption, color: COLORS.textSecondary },
  segmentTextActive: { color: COLORS.white },
  roundButton: {
    width: ms(48), height: ms(48), borderRadius: RADIUS.pill,
    alignItems: "center", justifyContent: "center",
    backgroundColor: COLORS.surface, ...SHADOW.md,
  },
  roundButtonActive: { backgroundColor: COLORS.brand800 },

  // Negative margins let the strip bleed to the screen edges so a long room
  // list scrolls off the side instead of stopping inside the gutter. The
  // vertical padding is what stops SHADOW.sm being clipped by the ScrollView.
  roomStrip: { marginHorizontal: -SPACING.base, flexGrow: 0 },
  roomStripContent: {
    paddingHorizontal: SPACING.base, paddingVertical: SPACING.xs, gap: SPACING.sm,
  },
  // Was 34pt tall — below the 44pt touch minimum, and these sit in a row where
  // a mis-tap jumps the camera into the wrong room. 40 plus hitSlop clears it.
  roomPill: {
    justifyContent: "center", height: ms(40), maxWidth: ms(170),
    paddingHorizontal: SPACING.base, borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surface, ...SHADOW.sm,
  },
  roomPillActive: { backgroundColor: COLORS.primaryDark },
  roomPillText: { ...TYPE.caption, color: COLORS.textSecondary },
  roomPillTextActive: { color: COLORS.white },

  hintPill: {
    alignSelf: "flex-start", maxWidth: "100%",
    flexDirection: "row", alignItems: "center", gap: SPACING.sm,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    borderRadius: RADIUS.lg, backgroundColor: "rgba(24, 30, 25, 0.82)",
  },
  hintText: { ...TYPE.caption, color: COLORS.white, flexShrink: 1 },

  // ── Contextual sheet (selection and AI) ──────────────────────────────────
  panelCard: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.xl,
    padding: SPACING.base, gap: SPACING.md, ...SHADOW.lg,
  },
  panelHead: { flexDirection: "row", alignItems: "center", gap: SPACING.md },
  panelIcon: {
    width: ms(42), height: ms(42), borderRadius: RADIUS.md,
    alignItems: "center", justifyContent: "center", backgroundColor: COLORS.primaryTint,
  },
  panelIconAccent: { backgroundColor: COLORS.accentTint },
  panelHeadCopy: { flex: 1, minWidth: 0 },
  panelEyebrow: { ...TYPE.overline, color: COLORS.textTertiary },
  panelTitle: { ...TYPE.h3, color: COLORS.textPrimary, textTransform: "capitalize" },
  panelClose: {
    width: ms(38), height: ms(38), borderRadius: RADIUS.pill,
    alignItems: "center", justifyContent: "center", backgroundColor: COLORS.surfaceSunken,
  },
  panelMeta: { ...TYPE.caption, color: COLORS.accentStrong, marginTop: -SPACING.sm },
  panelBody: { ...TYPE.small, color: COLORS.textSecondary, marginTop: -SPACING.sm },
  panelNote: { ...TYPE.small, color: COLORS.textTertiary },

  editorRow: { flexDirection: "row", gap: SPACING.md },
  editorGroup: { gap: SPACING.xs },
  editorLabel: { ...TYPE.overline, color: COLORS.textTertiary },
  editorButtons: { flexDirection: "row", gap: SPACING.xs },
  editorButton: {
    width: ms(44), height: ms(44), borderRadius: RADIUS.md,
    alignItems: "center", justifyContent: "center",
    backgroundColor: COLORS.surfaceSunken, borderWidth: 1, borderColor: COLORS.borderSubtle,
  },

  panelGhost: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SPACING.sm,
    height: ms(44), borderRadius: RADIUS.pill, backgroundColor: COLORS.surfaceSunken,
  },
  panelGhostText: { ...TYPE.caption, color: COLORS.textSecondary },

  toggleGroup: {
    flexDirection: "row", gap: SPACING.xs, padding: 4,
    backgroundColor: COLORS.surfaceSunken, borderRadius: RADIUS.pill,
  },
  toggleOption: { flex: 1, alignItems: "center", justifyContent: "center", height: ms(38), borderRadius: RADIUS.pill },
  toggleOptionActive: { backgroundColor: COLORS.primaryDark },
  toggleText: { ...TYPE.caption, color: COLORS.textSecondary },
  toggleTextActive: { color: COLORS.white },

  panelActions: { flexDirection: "row", gap: SPACING.sm },
  // Both panel actions flex, so when the second one appears the pair splits the
  // row evenly instead of one of them being sized by its own label.
  panelSecondary: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SPACING.xs,
    height: ms(48), paddingHorizontal: SPACING.base,
    borderRadius: RADIUS.pill, backgroundColor: COLORS.primaryTint,
  },
  panelSecondaryText: { ...TYPE.caption, color: COLORS.primaryDark },
  panelPrimary: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SPACING.sm,
    height: ms(48), borderRadius: RADIUS.pill, backgroundColor: COLORS.accent,
  },
  panelPrimaryBusy: { opacity: 0.75 },
  panelPrimaryText: { ...TYPE.bodyStrong, color: COLORS.white },

  // ── AI result ────────────────────────────────────────────────────────────
  aiLayer: { ...StyleSheet.absoluteFillObject, backgroundColor: COLORS.surfaceInverse },
  aiResultBar: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md,
    padding: SPACING.md, borderRadius: RADIUS.lg, backgroundColor: COLORS.overlay,
  },
  aiResultCopy: { flex: 1, minWidth: 0 },
  aiResultTag: { ...TYPE.overline, color: "rgba(255,255,255,0.66)" },
  aiResultLabel: { ...TYPE.bodyStrong, color: COLORS.white },
  aiResultButton: {
    width: ms(44), height: ms(44), borderRadius: RADIUS.pill,
    alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.18)",
  },

  renderOverlay: {
    ...StyleSheet.absoluteFillObject, backgroundColor: COLORS.overlay,
    alignItems: "center", justifyContent: "center",
    paddingHorizontal: SPACING.xxl, gap: SPACING.md,
  },
  renderTitle: { ...TYPE.h3, color: COLORS.white, textAlign: "center" },
  renderBody: { ...TYPE.small, color: "rgba(255,255,255,0.80)", textAlign: "center" },

  // ── Movement stick ───────────────────────────────────────────────────────
  stickBase: {
    alignSelf: "flex-end", width: ms(116), height: ms(116), borderRadius: RADIUS.pill,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.86)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.9)", ...SHADOW.md,
  },
  stickKnob: {
    width: ms(48), height: ms(48), borderRadius: RADIUS.pill,
    alignItems: "center", justifyContent: "center",
    backgroundColor: COLORS.primaryDark, ...SHADOW.sm,
  },
  stickUp: { position: "absolute", top: ms(8) },
  stickDown: { position: "absolute", bottom: ms(8) },
  stickLeft: { position: "absolute", left: ms(8) },
  stickRight: { position: "absolute", right: ms(8) },

  // ── Dock ─────────────────────────────────────────────────────────────────
  dock: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  statusChip: {
    flex: 1, minWidth: 0, height: ms(48),
    flexDirection: "row", alignItems: "center", gap: SPACING.sm,
    paddingHorizontal: SPACING.base, borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surface, ...SHADOW.md,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.success },
  statusText: { flex: 1, ...TYPE.caption, color: COLORS.textSecondary },
  dockPrimary: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SPACING.sm,
    height: ms(48), paddingHorizontal: SPACING.lg,
    borderRadius: RADIUS.pill, backgroundColor: COLORS.accent, ...SHADOW.md,
  },
  dockPrimaryActive: { backgroundColor: COLORS.accentStrong },
  dockPrimaryText: { ...TYPE.bodyStrong, color: COLORS.white },
  dockIcon: {
    width: ms(48), height: ms(48), borderRadius: RADIUS.pill,
    alignItems: "center", justifyContent: "center",
    backgroundColor: COLORS.surface, ...SHADOW.md,
  },
  dockIconBusy: { backgroundColor: COLORS.surfaceSunken },

  // ── Snapshot sheet ───────────────────────────────────────────────────────
  sheetBackdrop: { flex: 1, backgroundColor: COLORS.scrim, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: RADIUS.xxl, borderTopRightRadius: RADIUS.xxl,
    padding: SPACING.xl, paddingBottom: SPACING.xxl,
  },
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
  noticeCard: { width: "100%", maxWidth: LAYOUT.maxContentWidth, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.xl, ...SHADOW.lg },
  noticeText: { ...TYPE.body, color: COLORS.textPrimary, textAlign: "center" },
  noticeButton: { marginTop: SPACING.lg, paddingVertical: SPACING.md, borderRadius: RADIUS.pill, backgroundColor: COLORS.primaryDark },
  noticeButtonText: { ...TYPE.bodyStrong, color: COLORS.white, textAlign: "center" },

  // Four equal cells under the canvas — same grid logic as the tool palette.
  actionRow: { flexDirection: "row", marginTop: SPACING.sm, marginHorizontal: -3 },
  actionCell: { flex: 1, paddingHorizontal: 3 },
  action: {
    height: ms(46), alignItems: "center", justifyContent: "center", gap: 2,
    borderRadius: RADIUS.md, backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.border,
  },
  actionActive: { backgroundColor: COLORS.primaryTint, borderColor: COLORS.primarySoft },
  actionDisabled: { opacity: 0.45 },
  actionLabel: { ...TYPE.caption, fontSize: 10 },

  cardTitleRow: {
    flexDirection: "row", alignItems: "baseline", justifyContent: "space-between",
    gap: SPACING.sm, marginBottom: SPACING.sm,
  },
  cardTitleMeta: { ...TYPE.caption, color: COLORS.textTertiary, flexShrink: 1 },

  footerButton: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: SPACING.xs + 2, height: ms(44), borderRadius: RADIUS.md,
  },

  // ── Confirm dialog, matching the Collection screen's delete dialog ────────
  dialogOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center", justifyContent: "center", padding: SPACING.xl,
  },
  dialogContent: {
    width: "86%", maxWidth: LAYOUT.maxContentWidth,
    backgroundColor: COLORS.background, borderRadius: RADIUS.xl,
    padding: SPACING.lg, alignItems: "center", ...SHADOW.lg,
  },
  dialogTitle: { ...TYPE.h3, color: COLORS.primaryDark, textAlign: "center" },
  dialogMessage: {
    ...TYPE.small, color: COLORS.textSecondary, textAlign: "center",
    marginTop: SPACING.xs, lineHeight: 20,
  },
  dialogInput: {
    width: "100%", marginTop: SPACING.base, paddingHorizontal: SPACING.base, height: ms(46),
    borderRadius: RADIUS.md, backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.border,
    ...TYPE.bodyStrong, color: COLORS.textPrimary, textAlign: "center",
  },
  dialogActions: { flexDirection: "row", gap: SPACING.sm, width: "100%", marginTop: SPACING.lg },
  dialogButton: {
    flex: 1, height: ms(44), alignItems: "center", justifyContent: "center",
    borderRadius: RADIUS.md,
  },
  dialogCancel: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  dialogCancelText: { ...TYPE.bodyStrong, color: COLORS.textSecondary },
  dialogConfirm: { backgroundColor: COLORS.primaryDark },
  dialogConfirmDisabled: { backgroundColor: COLORS.disabled },
  dialogConfirmText: { ...TYPE.bodyStrong, color: COLORS.white },
});
