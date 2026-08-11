import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import * as MediaLibrary from "expo-media-library";
import { useFocusEffect, useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  BackHandler,
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
  maxOpeningMeters,
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
import { SERVER_URI, apiUrl } from "../../configs/api";
import { paletteForRequest, paletteForTone } from "../../lib/colorPalettes";
import COLORS from "../../constants/colors";
import { COIN_COST, FREE_DESIGNS, coinLabel } from "../../constants/pricing";
import useRewardedCoins from "../../lib/useRewardedCoins";
import { LAYOUT, MOTION, RADIUS, SHADOW, SPACING, TYPE, ms } from "../../constants/theme";
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
import {
  forgetScene as forgetStoredScene,
  readScene as readStoredScene,
  writeScene as writeStoredScene,
} from "../../lib/walkthroughSceneStore";

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
    icon: "grid-outline",
    label: "Draw",
    title: "Draw the floor plan",
    copy: "Place rooms, then add the doors, windows and balconies between them.",
  },
  {
    key: "rooms",
    icon: "home-outline",
    label: "Rooms",
    title: "Name every room",
    copy: "Give each space a name and a function. Its measured area stays visible while you choose.",
  },
  {
    key: "style",
    icon: "color-palette-outline",
    label: "Style",
    title: "Set the direction",
    copy: "One brief for the whole home, so every room is furnished to match.",
  },
  {
    key: "walk",
    icon: "cube-outline",
    label: "Explore",
    title: "Walk through it",
    copy: "Walk through it, or look down on the whole floor. Tap any piece of furniture to move it.",
  },
];

const CANVAS_RATIO = PLAN_HEIGHT_METERS / PLAN_WIDTH_METERS;

/**
 * The drawing tools.
 *
 * They are split into two labelled groups rather than poured into one
 * undifferentiated grid of eight: the four that shape the plan, and the three
 * that go into a wall. A person looking for "how do I add a window" was
 * previously scanning eight equal cells with no structure to narrow the search.
 *
 * Pan leads the first group because it is the tool the canvas starts in —
 * looking around a plan is safe, and no tap can accidentally draw a room.
 */
const TOOLS = [
  { key: "pan", icon: "hand-left-outline", label: "Pan" },
  { key: "rect", icon: "square-outline", label: "Box" },
  { key: "room", icon: "shapes-outline", label: "Outline" },
  { key: "select", icon: "move-outline", label: "Edit" },
  { key: "door", icon: "log-in-outline", label: "Door" },
  { key: "window", icon: "browsers-outline", label: "Window" },
  { key: "balcony", icon: "sunny-outline", label: "Balcony" },
];


/** The tools that need a wall to aim at. */
const OPENING_TOOLS = new Set(["door", "window", "balcony"]);

const TOOL_HINTS = {
  pan: "Drag to move around the plan. Two fingers pan and pinch in any tool.",
  rect: "Drag on the grid to draw a rectangular room. Its size in metres shows as you drag.",
  room: "Tap each corner, then tap the first corner again to close the room.",
  door: "Tap a wall for a standard door, or drag along it for a wider opening.",
  window: "Tap a wall for a standard window, or drag along it to set its length.",
  balcony: "Tap an outside wall for a balcony door, or drag along it for a wide slider.",
  select: "Tap a room or opening, then drag the shape or one of its handles.",
};

/**
 * Two ways to look at a home: from inside it, or from above it.
 *
 * Orbit was a third, and it did not work. It flew the camera around the outside
 * of a building that has a roof on it, so what it actually showed — most of the
 * time, from most angles — was the top of the ceiling and the backs of the
 * pendants hanging under it. A control whose ordinary result is a grey slab is
 * not a view of anyone's home, and Bird already answers the question it was
 * there to answer.
 */
const VIEW_MODES = [
  { key: "walk", icon: "walk-outline", label: "Walk" },
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

/** What one AI render on this path costs, from the one table that decides. */
const RENDER_PRICE = COIN_COST.walkthrough;

/**
 * This screen's room names, in the words the design engine knows.
 *
 * The prompt engine turns the space into a *programme* — "a bedroom contains an
 * upholstered bed, two nightstands, layered bedding…" — by looking the name up
 * in a table. A name that misses the table falls through to "the essential
 * functional elements of a premium Utility", which briefs the model on nothing
 * and leaves it to fill the room from imagination.
 *
 * Only the names that actually differ are listed; everything else this screen
 * offers is already a word the engine has a programme for, so it passes
 * through untouched rather than being restated here and drifting out of date.
 * "Utility" has no programme of its own anywhere in the app, and the nearest
 * honest one is the laundry: appliances, a folding surface, hard-wearing
 * surfaces, concealed storage.
 */
const INTERIOR_ROOM_TYPES = {
  Laundry: "Laundry Room",
  Utility: "Laundry Room",
};

const interiorRoomType = (roomType) => {
  const value = String(roomType || "").trim();
  return INTERIOR_ROOM_TYPES[value] || value || "Living Room";
};

/**
 * How many finished renders a plan carries with it.
 *
 * A render used to be kept one-per-viewpoint in a map, so the second render of
 * a living room silently replaced the first and the only way back to it was the
 * Collection tab — a flat list of every design the account has ever made, with
 * nothing on a card to say which plan it came from. They are a list now, saved
 * with the plan, and the plan is where they are looked at.
 */
const RENDER_HISTORY_LIMIT = 40;

const createRenderId = () =>
  `render-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** When a render was made, in the shortest form that is still unambiguous. */
const renderDay = (value) => {
  const then = value ? new Date(value) : null;
  if (!then || Number.isNaN(then.valueOf())) return null;
  const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).valueOf();
  const days = Math.round((startOfDay(new Date()) - startOfDay(then)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

/**
 * The renders belonging to a saved plan, newest first.
 *
 * Plans written before the gallery existed stored `aiRenders` as a map keyed by
 * viewpoint. Those are read back as a list so nobody's finished work disappears
 * when they open an old plan.
 */
const restoreRenders = (saved = {}) => {
  if (Array.isArray(saved.renderGallery)) {
    return saved.renderGallery
      .filter((entry) => entry?.image)
      .map((entry) => ({ ...entry, id: entry.id || createRenderId() }))
      .slice(0, RENDER_HISTORY_LIMIT);
  }
  const legacy = saved.aiRenders && typeof saved.aiRenders === "object" ? saved.aiRenders : {};
  return Object.entries(legacy)
    .filter(([, entry]) => entry?.image)
    .map(([key, entry]) => ({
      id: `legacy-${key}`,
      image: entry.image,
      label: entry.label || "AI render",
      view: key === "bird" ? "plan" : "walk",
      createdAt: entry.createdAt || null,
    }))
    .sort((one, two) => String(two.createdAt || "").localeCompare(String(one.createdAt || "")))
    .slice(0, RENDER_HISTORY_LIMIT);
};

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
  // Pan, not Box. Opening the canvas already armed to draw meant the first
  // exploratory drag on a traced photo left a room behind it.
  const [tool, setTool] = useState("pan");
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
  // The plan whose "more" sheet is open. Rename and delete used to be two
  // buttons on every row of the library, so a six-plan list showed six ways to
  // delete an evening's work next to six ways to open it.
  const [planActions, setPlanActions] = useState(null);
  // Two destructive actions that used to fire on one tap. Clearing the plan is
  // undoable, but Undo lives in the Draw step's action row and says nothing
  // about what it would bring back; deleting a room happens on the Rooms step,
  // where there is no Undo control on screen at all.
  const [confirmClear, setConfirmClear] = useState(false);
  // Asked before rebuilding, because a rebuild throws away hand-placed
  // furniture and costs a real export.
  const [confirmRebuild, setConfirmRebuild] = useState(false);
  const [pendingRoomDelete, setPendingRoomDelete] = useState(null);
  const draftStepsRef = useRef([]);

  // ── Viewer state ─────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState("walk");
  const [night, setNight] = useState(false);
  const [inspected, setInspected] = useState(null);
  const [sceneInfo, setSceneInfo] = useState(null);
  const [panel, setPanel] = useState(null); // null | 'ai' | 'renders'
  /**
   * Every AI render this plan has produced, newest first, saved with the plan.
   *
   * There is no camera choice beside it any more. The sheet used to offer
   * "Designer" or "My view", defaulted to Designer, and moved the camera out
   * from under the person the moment they opened it — so the picture they paid
   * for was framed from somewhere they had not chosen and could not see. A
   * render is now always the view on screen, which is the one thing about it
   * nobody has to be told.
   */
  const [renderGallery, setRenderGallery] = useState([]);
  const [activeRenderId, setActiveRenderId] = useState(null);
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

  // ── What a render costs this account ─────────────────────────────────────
  /**
   * The same allowance the Interior path reads, read here too.
   *
   * This screen used to know nothing about it. It fired the render, spent the
   * GPU time to capture and upload a frame, and found out the account could not
   * pay from a 403 — after which the person was dropped onto the paywall with
   * no idea what they had been short of. The server is still the authority on
   * whether a charge happens; these numbers only let the screen say the price
   * up front and stop a render that is going to be refused.
   */
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isPremium, setIsPremium] = useState(false);
  const [freeDesignsUsed, setFreeDesignsUsed] = useState(0);
  const [renderBlocked, setRenderBlocked] = useState(false);
  const {
    coins,
    setCoins,
    watchAd,
    status: adStatus,
    message: adMessage,
    clearMessage: clearAdMessage,
  } = useRewardedCoins(token);

  // The ad hook reports what happened — a coin added, a daily cap reached, no
  // ad available. Interior drops that on the floor; here it goes through the
  // screen's own notice, because somebody who watched an ad in order to afford
  // the render in front of them needs to know whether it worked.
  useEffect(() => {
    if (!adMessage) return;
    setNotice(adMessage);
    clearAdMessage();
  }, [adMessage, clearAdMessage]);

  const unlimited = isSubscribed || isPremium;
  const freeRendersLeft = Math.max(0, FREE_DESIGNS - freeDesignsUsed);
  const canAffordRender = unlimited || freeRendersLeft > 0 || coins >= RENDER_PRICE;

  const refreshAccount = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch(apiUrl("/api/users/me"), {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      if (!response.ok) return;
      const data = await response.json();
      const account = data.user || {};
      setIsSubscribed(!!account.isSubscribed);
      setIsPremium(!!account.isPremium);
      setFreeDesignsUsed(Number(account.freeDesignsUsed || 0));
      setRenderBlocked(!!account.manualDisabled);
      setCoins(Number(account.adCoins || 0));
    } catch {
      // A balance that could not be fetched must not block a render: the server
      // decides, and it will answer 403 if this account cannot pay.
    }
  }, [setCoins, token]);

  // Coins can be bought or earned on another screen, so the balance is re-read
  // every time this one comes back into view rather than once on mount.
  useFocusEffect(
    useCallback(() => {
      refreshAccount();
    }, [refreshAccount]),
  );

  // ── Leaving ──────────────────────────────────────────────────────────────
  /**
   * Going out is a one-way door, and it is only opened once.
   *
   * `leaving` is a ref rather than state because the guard has to hold on the
   * very next tap, before React has re-rendered anything. `closing` is state
   * because it has to change what is on screen: the live WebGL viewer is torn
   * down one commit *before* the navigator pops, rather than during the pop.
   */
  const leaving = useRef(false);
  const [closing, setClosing] = useState(false);

  // The sheet is the measured drawing surface; the canvas is only the window
  // onto it. Keeping the sheet device-independent is what makes a room's area
  // identical on every phone and keeps furniture in proportion to the room.
  const sheetWidth = SHEET_WIDTH;
  const sheetHeight = Math.round(sheetWidth * canvasAspect);
  // Minus the two hairlines of the card the canvas sits in, so the drawing
  // surface is not clipped by its own frame.
  const canvasWidth = Math.round(LAYOUT.screenWidth - SPACING.base * 2 - 2);
  /**
   * As tall as the step can afford, always.
   *
   * There used to be an Expand button that swapped a 42%-of-screen canvas for a
   * 66% one. It is gone, and this is the reason: a drawing surface is not a
   * setting. Every plan is easier to draw on the big one, nobody wants the small
   * one, and the button cost a control in the action row, a piece of state, a
   * full-bleed layout variant of the canvas card, and a re-layout of the whole
   * step in the middle of drawing. The canvas is now simply as large as the
   * gutter and the phone allow.
   */
  const canvasHeight = Math.round(
    Math.max(300, Math.min(canvasWidth * 1.16, LAYOUT.screenHeight * 0.54)),
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

  /**
   * The room list as the exporter wants it: every room carrying the home's one
   * style.
   *
   * The exporter's contract is still per-room — it furnishes each space against
   * its own config — so the single choice is stamped onto all of them here
   * rather than being pushed into every room's stored config on every change.
   * That also means a plan saved when the style was still asked per room reopens
   * under whichever style the home now has, instead of keeping five answers to a
   * question that is no longer asked.
   */
  const sceneRoomConfigs = useMemo(
    () => roomConfigs.map((room) => ({ ...room, style: settings.style || "Modern" })),
    [roomConfigs, settings.style],
  );

  const activeRender = useMemo(
    () => renderGallery.find((entry) => entry.id === activeRenderId) || null,
    [activeRenderId, renderGallery],
  );

  // Clearing the plan while a door was armed left the canvas with a tool that
  // cannot do anything — every tap looking for a wall that no longer exists.
  useEffect(() => {
    if (rooms.length) return;
    setTool((current) => (OPENING_TOOLS.has(current) ? "pan" : current));
  }, [rooms.length]);

  /**
   * Everything about this plan that changes what gets built — and nothing else.
   *
   * The build effect used to re-run on the identity of `layout`, `roomConfigs`
   * and `settings`, all three of which are new objects on almost every render.
   * Stepping back to Style and forward to Explore, or flipping a viewer-only
   * preference like "walk through walls", therefore asked the server to build a
   * home it had built thirty seconds earlier. The exporter is deterministic, so
   * the answer was always the same one — the request was pure cost.
   */
  const sceneSignature = useMemo(
    () => JSON.stringify({
      revision: LIVINAI_WEB_RENDERER_REVISION,
      rooms: layout.rooms,
      doors: layout.doors.map((opening) => opening.slice(0, 2)),
      windows: layout.windows.map((opening) => opening.slice(0, 2)),
      balconies: layout.balconies.map((opening) => opening.slice(0, 2)),
      pixelsPerMeter: layout.pixelsPerMeter,
      configs: sceneRoomConfigs.map((room) => [room.name, room.roomType, room.style, room.kitchenType || ""]),
      // The design fields the exporter reads. `freeExplore` is not among them:
      // it decides whether the camera may walk through a wall, which is a
      // property of the viewer, not of the home.
      design: [
        settings.designProfile,
        settings.colorMood,
        settings.notes,
        settings.floorFinish,
        settings.wallFinish,
        settings.rugDesign,
        settings.curtainDesign,
        settings.decorSet,
      ],
    }),
    [layout, sceneRoomConfigs, settings],
  );

  /**
   * Scenes this session has already been handed, by signature.
   *
   * The in-memory half of a two-level store. This one answers "leave Explore,
   * come straight back", which has to be instant and must not throw away the
   * GPU scene: holding the same object identity keeps the WebView's memoised
   * document stable, so nothing is rebuilt on the way back in.
   *
   * The other half is `lib/walkthroughSceneStore.js`, which survives the app
   * being closed. Between them, a plan that has not been edited never asks the
   * server for a session again.
   */
  const sceneCache = useRef(new Map());

  /**
   * Set by Retry, cleared by the build that answers it.
   *
   * The stored copy is cleared asynchronously, and the effect below re-runs
   * immediately — so without this the retry could read the entry it is in the
   * middle of deleting and hand back the very scene that just failed.
   */
  const forceRebuild = useRef(false);

  /**
   * The request body, as of this render.
   *
   * The effect below must not depend on `layout`, `sceneRoomConfigs` or
   * `settings`: all three are new objects on almost every render, which is
   * exactly what `sceneSignature` exists to paper over — and the effect went on
   * listing them as dependencies anyway, so the fix never took. Every render
   * re-ran the effect, and a re-run *aborts the fetch in flight*. Reaching
   * Explore while anything at all was still settling therefore cancelled the
   * build and started another one, repeatedly: the step could sit on its
   * progress card indefinitely, and one home could cost several builds.
   *
   * Read from a ref instead, so the effect runs once per plan that is actually
   * different and the body it sends is still the current one.
   */
  const scenePayload = useRef(null);
  scenePayload.current = { layout, sceneRoomConfigs, settings };

  // A boolean, not `layout.rooms.length`, for the same reason: the guard needs
  // to know whether there is anything to build, not which object said so.
  const hasRooms = layout.rooms.length > 0;

  // The styles on offer, plus whatever this plan was actually built as — see
  // the note on WALKTHROUGH_STYLES about the two that were retired.
  const styleOptions = useMemo(
    () => (WALKTHROUGH_STYLES.includes(settings.style)
      ? WALKTHROUGH_STYLES
      : [...WALKTHROUGH_STYLES, settings.style]),
    [settings.style],
  );

  // Build the scene with the canonical Livinai_web exporter. Rendering a
  // second, approximate room programme on-device was the source of mismatched
  // dimensions, furniture families, placement and finishes. The exporter owns
  // all of those decisions and returns one textured GLB for the phone to view.
  //
  // Three places are asked before it comes to that, cheapest first: this
  // session's memory, then the device's store, then the network. Reopening an
  // untouched plan stops at the second and costs one AsyncStorage read.
  useEffect(() => {
    if (view !== "editor" || stage !== STAGES.length - 1 || !hasRooms) return undefined;

    const remembered = sceneCache.current.get(sceneSignature);
    if (remembered) {
      setExactScene(remembered.scene);
      setExactSceneBaseUrl(remembered.origin);
      setExactSceneLoading(false);
      setExactSceneError("");
      setExactSceneDetail("");
      return undefined;
    }

    const rendererRoot = SERVER_URI;

    const controller = new AbortController();
    setExactScene(null);
    setExactSceneBaseUrl("");
    setSceneInfo(null);
    setExactSceneLoading(true);
    setExactSceneError("");
    setExactSceneDetail("");

    (async () => {
      try {
        // The device's copy of this exact scene. `rebuildScene` is what clears
        // it, so pressing Retry after a dead model still goes to the network.
        const rebuilding = forceRebuild.current;
        const stored = rebuilding ? null : await readStoredScene(sceneSignature);
        if (controller.signal.aborted) return;
        if (stored) {
          const origin = stored.origin || rendererRoot.match(/^https?:\/\/[^/]+/)?.[0] || rendererRoot;
          sceneCache.current.set(sceneSignature, { scene: stored.scene, origin });
          setExactScene(stored.scene);
          setExactSceneBaseUrl(origin);
          return;
        }
        forceRebuild.current = false;

        const { layout: planLayout, sceneRoomConfigs: configs, settings: brief } = scenePayload.current;
        const response = await fetch(`${rendererRoot}/api/walkthrough/realtime/session`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            rendererRevision: LIVINAI_WEB_RENDERER_REVISION,
            // Clearing the two copies on the device is only half of a rebuild:
            // without this the server answers the identical request from its
            // own row and hands back the very scene being replaced.
            ...(rebuilding ? { forceRebuild: true } : {}),
            rooms: planLayout.rooms,
            doors: planLayout.doors.map((opening) => opening.slice(0, 2)),
            windows: planLayout.windows.map((opening) => opening.slice(0, 2)),
            balconies: planLayout.balconies.map((opening) => opening.slice(0, 2)),
            pixelsPerMeter: planLayout.pixelsPerMeter,
            roomConfigs: configs,
            settings: { ...brief, useCatalog: true },
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
        sceneCache.current.set(sceneSignature, { scene: data, origin });
        // Written, not awaited: the scene is already on screen, and a store
        // that is slow or full must not hold up the walkthrough.
        writeStoredScene(sceneSignature, { scene: data, origin }).catch(() => {});
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
  }, [exactSceneRetry, hasRooms, sceneSignature, stage, token, view]);

  /**
   * Try again, and mean it.
   *
   * Retry has to be the one path that bypasses every cache, because the reason
   * someone presses it is that what they were handed did not work — a scene
   * whose GLB has been evicted, most often. The server drops its own row when it
   * serves the 404 that produced this state, so this has to forget both of ours:
   * the session's, and the device's. `forceRebuild` (declared above the build
   * effect) covers the gap between clearing the stored copy and the effect
   * re-running, which is asynchronous.
   */
  const rebuildScene = useCallback(() => {
    forceRebuild.current = true;
    sceneCache.current.delete(sceneSignature);
    forgetStoredScene(sceneSignature).catch(() => {});
    setExactSceneRetry((value) => value + 1);
  }, [sceneSignature]);

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
    // Plans saved while the style was still asked per room have no home style at
    // all, so the first room's answer becomes the home's. Taking the default
    // instead would silently re-decorate a plan someone had already finished.
    const savedSettings = saved.settings || {};
    setSettings({
      ...DEFAULT_WALKTHROUGH_SETTINGS,
      ...savedSettings,
      style: savedSettings.style
        || (saved.roomConfigs || []).find((room) => room?.style)?.style
        || DEFAULT_WALKTHROUGH_SETTINGS.style,
      useCatalog: true,
    });
    /**
     * Re-furnish a plan drawn against an older renderer.
     *
     * The geometry and the brief always reopen as they were, and the scene is
     * rebuilt from them — so a plan furnished last month picks up the new
     * furniture, the doorway kept clear and the cushions that no longer clip
     * through the sofa, simply by being opened. That much falls out of the
     * revision being part of every cache key.
     *
     * What does *not* survive is the hand-placed furniture. An edit is stored as
     * "piece number seven sits here", and after a re-furnish piece seven is a
     * different object in a different room — so replaying those offsets would
     * take the new layout and shove random items out of place, which looks far
     * more broken than the old layout ever did. They are dropped, and the
     * designer's own placement stands. Nothing else about the plan is touched.
     */
    const editedUnder = saved.furnitureRevision;
    const editsStillApply = editedUnder === LIVINAI_WEB_RENDERER_REVISION;
    const savedEdits = saved.furnitureEdits || {};
    setFurnitureEdits(editsStillApply ? savedEdits : {});
    if (!editsStillApply && Object.keys(savedEdits).length) {
      setNotice(
        "This plan was furnished by an earlier version of Livinai. It has been "
        + "rebuilt with the current furniture, so the pieces you moved by hand are "
        + "back where Livinai places them.",
      );
    }
    setSelectedRoom(Number(saved.selectedRoom) || 0);
    setStage(Math.max(0, Math.min(STAGES.length - 1, Number(saved.stage) || 0)));
    setRenderGallery(restoreRenders(saved));
    setActiveRenderId(null);
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
      // Which renderer furnished the plan these edits were made against. See
      // `restoreSavedPlan`: an edit is a position for furniture piece *number
      // seven*, so it only means anything while piece seven is the same object.
      furnitureRevision: LIVINAI_WEB_RENDERER_REVISION,
      selectedRoom,
      stage,
      // The plan's own renders travel with it, so opening a plan on another
      // phone opens the pictures it produced too.
      renderGallery,
      savedAt: new Date().toISOString(),
    };
  }, [canvasAspect, furnitureEdits, openings, pixelsPerMeter, planImage, renderGallery, roomConfigs, rooms, selectedRoom, settings, sheetHeight, sheetWidth, stage]);

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
    /**
     * No cover image at all, deliberately.
     *
     * The library card does not show one any more, so a thumbnail is an upload
     * nobody looks at — and rows written by older builds still carry an AI
     * render in this field, which is exactly the picture that had to go: a
     * generated room standing in for the user's own drawing on the card they
     * use to recognise it. Sending an explicit null is what clears those, since
     * the sync layer reads null as "remove it" and undefined as "keep it".
     *
     * The renders themselves are untouched — they live with the plan and in the
     * user's collection.
     */
    thumbnail: null,
    updatedAt: new Date().toISOString(),
    data: planData(),
  }), [openings.length, planData, planImage, projectId, projectTitle, remoteId, rooms.length, totalArea]);

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
  // No `style` here. A room is a name, a purpose and a measured shape; how it is
  // decorated is a property of the home, and lives in `settings.style`.
  const configFor = (index) => ({
    name: `Room ${index + 1}`,
    roomType: ROOM_TYPES[index % ROOM_TYPES.length],
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
    setTool("pan");
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
    setRenderGallery([]);
    setActiveRenderId(null);
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
      const response = await fetch(apiUrl("/api/floorplans/detect"), {
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

  /**
   * Leave the editor, pushing the plan to the account on the way out.
   *
   * The push is started, not waited for. Uploading a traced photo and the whole
   * geometry can take the better part of a minute on a weak connection, and the
   * screen used to sit there unchanged for all of it — so the button read as
   * broken and got pressed again. The device copy is already written by autosave
   * before either call is made, so nothing is at risk in leaving early.
   */
  const exitToLibrary = useCallback(() => {
    if (rooms.length || openings.length) pushToCloud().catch(() => {});
    else refreshLibrary().catch(() => {});
    setView("library");
  }, [openings.length, pushToCloud, refreshLibrary, rooms.length]);

  const updateRoom = useCallback((index, key, value) => {
    setRoomConfigs((current) => current.map((room, i) => {
      if (i !== index) return room;
      const next = { ...room, [key]: value };
      // Choosing "Kitchen" names the room Kitchen, unless the person has named it
      // themselves. Every card opened holding "Room 3" — a label that says only
      // where it is in the list — and typing the room's purpose a second time
      // into the field directly under the chip row is work the app can do.
      if (key === "roomType") {
        const untouched = !room.name
          || room.name === room.roomType
          || room.name === `Room ${index + 1}`;
        if (untouched) next.name = value;
      }
      return next;
    }));
    if (key === "roomType") setFurnitureEdits({});
  }, []);

  const updateSetting = useCallback((key, value) => {
    setSettings((current) => ({ ...current, [key]: value }));
    // Furniture edits are keyed by the piece's index in the exported scene, and
    // a different style furnishes a room with different pieces in a different
    // order. Keeping them would move whatever happened to land at index 7.
    if (key === "style") setFurnitureEdits({});
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
  // The purpose comes back from the viewer with the frame, so there is nothing
  // for this side to remember about it. What does have to survive the round
  // trip is the brief, because the sheet that made it is closed by the time the
  // capture arrives.
  const pendingRenderBrief = useRef(null);

  const requestCapture = (purpose, renderBrief = null) => {
    if (purpose !== "ai") {
      setBusy("capture");
      viewerRef.current?.capture("photo", false);
      return;
    }

    if (renderBlocked) {
      setPanel(null);
      setNotice(
        "This account cannot generate designs at the moment. Please contact support if that is a mistake.",
      );
      return;
    }

    /**
     * Stop here rather than at the 403, and say the same thing Interior says.
     *
     * Everything past this line costs something before the server ever refuses
     * it: a full-resolution frame is grabbed off the GPU and uploaded. Checking
     * the allowance first is what turns "your render failed" into "you are out
     * of coins, here is where to get more" — and, for a subscriber, into
     * nothing at all, because `unlimited` short-circuits the whole test.
     */
    if (!canAffordRender) {
      setPanel(null);
      setNotice(
        `A render costs ${coinLabel(RENDER_PRICE)}. You have ${coinLabel(coins)} — `
        + "watch an ad for one more, or go unlimited with Livinai Pro.",
      );
      router.push("/profile/upgrade");
      return;
    }

    // The canvas capture returns asynchronously. Keep the choices made in the
    // sheet with that capture instead of reading a later UI selection.
    pendingRenderBrief.current = renderBrief;
    // The sheet closes on submit so the progress overlay is over the room being
    // rendered. It used to stay up, which left a spinner on a button as the only
    // sign anything was happening and hid the "your geometry is preserved"
    // reassurance behind it for the whole wait.
    setPanel(null);
    setRendering(true);
    // Never a designer camera: the render is the view on screen. See the note
    // on `renderGallery` for why the alternative is gone.
    viewerRef.current?.capture("ai", false);
  };

  /**
   * Render the captured frame through the brief the Interior path uses —
   * the same request, field for field, with this view's answers in it.
   *
   * It used to be *almost* Interior's, and the three places it differed were
   * the three places the picture went wrong. The engine builds one prompt for
   * every path in the app, so a field that carries a word the engine does not
   * recognise, or a word Interior never sends, changes the brief for the whole
   * render:
   *
   *  - **`material` carried the floor finish.** The engine reads that field as
   *    "make this the *hero material*", so choosing Polished concrete on the
   *    Style step did not floor the room in concrete — it briefed the whole
   *    space around concrete. Interior always sends `Natural oak`; so does this
   *    now, and the floor finish keeps doing its real job, which is telling the
   *    3D exporter what to lay on the floor.
   *  - **`lighting` carried the day/night toggle.** "Warm ambient evening
   *    light" over an interior invites the model to put a lit opening in a wall
   *    to justify the glow — which is exactly the window that was appearing
   *    where the plan has none. The toggle is a property of the 3D viewer, not
   *    of the design brief. Interior always sends `Natural daylight`.
   *  - **`roomType` used this screen's own room names.** The engine looks the
   *    space up in a table of room programmes to write "a bedroom contains…".
   *    "Laundry" and "Utility" are not in that table, so those rooms got the
   *    generic fallback — no programme, and a model with nothing to furnish
   *    from invents architecture instead. They are translated below.
   *
   * Everything else already matched and is left alone: `mode`, the 60/30/10
   * palette, `preserveGeometry`, `creativity`, and the notes field, which is
   * the same optional client note Interior sends. `product` names the price
   * list row and never reaches the prompt.
   */
  const runAiRender = async (image, renderBrief = null) => {
    const room = roomConfigs[selectedRoom] || {};
    const chosenRoom = viewMode === "plan"
      ? "Floor Plan"
      : renderBrief?.roomType || room.roomType || "Living Room";
    const roomType = interiorRoomType(chosenRoom);
    const designStyle = renderBrief?.designStyle || settings.style || "Modern";
    const colorTone = renderBrief?.colorTone || settings.colorMood || "Warm neutral";
    try {
      const response = await fetch(apiUrl("/api/designs"), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          image,
          mode: "interior",
          roomType,
          designStyle,
          colorTone,
          colorPalette: paletteForRequest(colorTone),
          // Interior's two constants, verbatim. See the note above.
          material: "Natural oak",
          lighting: "Natural daylight",
          preserveGeometry: true,
          creativity: 42,
          // Billed against the walkthrough line of the price list, not the flat
          // design one. Naming the row is all this does — the price attached to
          // the name is decided by the server, and the prompt never sees it.
          product: "walkthrough",
          // The one piece of text that is the user's own — the Notes field on
          // the Style step — exactly as Interior sends its optional prompt.
          // The note written for this render, falling back to the plan's own
          // notes so a plan saved under the old Style step keeps its brief.
          customPrompt: (renderBrief?.note || settings.notes || "").trim(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      // Whatever the outcome, the server's numbers replace the local ones.
      // Subtracting a coin here instead is how the balance on screen drifts
      // away from the balance that gets charged.
      if (typeof data.adCoins === "number") setCoins(data.adCoins);
      if (typeof data.freeDesignsUsed === "number") setFreeDesignsUsed(data.freeDesignsUsed);

      if (response.status === 403) {
        // Say what was short before the paywall opens. The screen that comes
        // next sells coins; arriving there without being told the number is how
        // "not enough coins" reads as "pay us" rather than as an answer.
        setNotice(
          data.reason
            || `A walkthrough render costs ${coinLabel(RENDER_PRICE)}, and you do not have enough.`,
        );
        router.push("/profile/upgrade");
        return;
      }
      if (!response.ok) throw new Error(data.message || "The AI render could not be generated.");
      const result = data.generatedImage || data.image;
      if (!result) throw new Error("The AI service returned no image.");

      const entry = {
        id: createRenderId(),
        image: result,
        label:
          viewMode === "plan"
            ? "Whole floor, from above"
            : room.name || roomType || `Room ${selectedRoom + 1}`,
        roomType,
        designStyle,
        colorTone,
        view: viewMode === "plan" ? "plan" : "walk",
        createdAt: new Date().toISOString(),
      };
      setRenderGallery((current) => [entry, ...current].slice(0, RENDER_HISTORY_LIMIT));
      setActiveRenderId(entry.id);
      setOutputMode("ai");
    } catch (error) {
      setNotice(error.message || "The AI render could not be generated.");
    } finally {
      pendingRenderBrief.current = null;
      setRendering(false);
    }
  };

  const handleSnapshot = useCallback(
    (image, purpose) => {
      if (purpose === "ai") {
        runAiRender(image, pendingRenderBrief.current);
      } else {
        setSnapshotKind("capture");
        setSnapshot(image);
        setBusy("");
      }
    },
    // runAiRender closes over the current room/settings, which is what we want.
    // `night` is not among them any more: it moves the 3D lighting and nothing
    // else, and the brief this sends is daylight whichever way the toggle sits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roomConfigs, selectedRoom, settings, token, viewMode],
  );

  /** Open one of this plan's renders over the 3D view. */
  const showRender = useCallback((id) => {
    setPanel(null);
    setActiveRenderId(id);
    setOutputMode("ai");
  }, []);

  /**
   * Forget a render, in the plan only.
   *
   * The design itself stays in the account's collection — /api/designs made it
   * and owns it — so this removes the copy filed against this plan rather than
   * deleting something the person may have paid for from under them.
   */
  const removeRender = useCallback((id) => {
    setRenderGallery((current) => current.filter((entry) => entry.id !== id));
    setActiveRenderId((current) => {
      if (current !== id) return current;
      setOutputMode("live");
      return null;
    });
  }, []);

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
      const response = await fetch(apiUrl("/api/designs/walkthrough"), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          image: snapshot,
          roomType: roomConfigs[selectedRoom]?.roomType || "3D Walkthrough",
          designStyle: settings.style || "Modern",
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

  /**
   * The footer's Back: one step up the flow, and off the first step back to the
   * list of plans. This is the movement *within* the walkthrough.
   */
  const goBack = useCallback(() => {
    if (stage === 0) return exitToLibrary();
    setStage((current) => current - 1);
  }, [exitToLibrary, stage]);

  /**
   * The header's Back: out of the walkthrough entirely, to the Create screen the
   * person came in from.
   *
   * These were the same action, which meant the top-left chevron changed meaning
   * four times as someone moved through the flow — sometimes a step, sometimes
   * the way out — and leaving took up to five taps from the last step. A back
   * arrow in a screen header is expected to leave the screen; stepping is the
   * job of the control that sits next to Continue.
   *
   * It used to await the whole cloud push and then call `router.back()`. Three
   * things went wrong with that on the way to Create, and all three are fixed
   * here rather than in one place:
   *
   *  - Nothing happened for as long as the upload took, so the arrow got pressed
   *    again — and the hardware back key got used — while the first press was
   *    still in flight. Every one of those queued another `goBack()` against a
   *    stack that had already popped. `leaving` makes the second press a no-op.
   *  - `router.back()` was called unconditionally. Opened from a notification or
   *    a deep link there is nothing under this screen to go back *to*, and the
   *    navigator has no action to handle. `canGoBack()` decides, and the fallback
   *    goes to Create by name.
   *  - The last step holds a live WebGL context in a WebView. Tearing that down
   *    inside the pop transition is what takes the Android renderer with it, so
   *    `closing` unmounts the viewer first and the pop happens on the next commit.
   */
  const leaveWalkthrough = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    // Fire and forget: the device already has this plan from autosave.
    if (view === "editor" && (rooms.length || openings.length)) pushToCloud().catch(() => {});
    setClosing(true);
  }, [openings.length, pushToCloud, rooms.length, view]);

  // The pop, one commit after the 3D view has left the tree.
  //
  // `dismissTo` rather than `back()`: the hub can push more than one copy of a
  // create screen when a tap lands while it is busy, and a single `back()` then
  // lands on an identical screen instead of on Create. This collapses however
  // many are stacked, and puts Create there if it is somehow not in the stack
  // at all — which is what `canGoBack()` was guarding against.
  useEffect(() => {
    if (!closing) return undefined;
    const timer = setTimeout(() => {
      try {
        router.dismissTo("/create");
      } catch {
        router.replace("/create");
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [closing, router]);

  /**
   * Android's back key means the same thing as the button under the thumb.
   *
   * Without this it popped the navigator directly, which is how a plan could be
   * left behind unsaved and how a second press raced the header's own exit.
   *
   * Bound to focus, not to mount. `BackHandler` subscriptions are global and the
   * most recent one wins, so a handler still listening from behind the paywall
   * this screen can push would swallow *that* screen's back press and quietly
   * step the walkthrough back a stage instead.
   */
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        if (closing) return true;
        if (view === "editor") goBack();
        else leaveWalkthrough();
        return true;
      });
      return () => subscription.remove();
    }, [closing, goBack, leaveWalkthrough, view]),
  );

  const current = STAGES[stage];
  const activeTool = TOOLS.find((item) => item.key === tool);

  // ── Render ───────────────────────────────────────────────────────────────
  /**
   * On the way out the screen is emptied first.
   *
   * One frame of the page's own background, under a screen that is already
   * sliding away, is invisible. What it buys is that the WebView, its GL context
   * and every listener attached to them are released while this screen is still
   * mounted and still owns them — instead of during the navigator's transition,
   * where the teardown has nowhere safe to happen.
   */
  if (closing) return <View style={styles.screen} />;

  return (
    <View style={styles.screen}>
      {view === "library" ? (
        <PlanLibrary
          projects={projects}
          loading={libraryLoading}
          synced={cloudSynced}
          signedIn={!!token}
          onBack={leaveWalkthrough}
          onRefresh={refreshLibrary}
          onStart={startNewProject}
          onOpen={openSavedProject}
          onMore={setPlanActions}
        />
      ) : (
        <>
          {/* ── Header ─────────────────────────────────────────────────── */}
          <LinearGradient
            colors={[COLORS.surface, COLORS.brand100]}
            start={{ x: 0.08, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.editorHeaderSurface}
          >
            <SafeAreaView edges={["top"]} style={styles.header}>
              <View style={styles.headerRow}>
                {/* Leaves the walkthrough. Moving between steps is the footer's
                    job, so this arrow means the same thing on all four steps. */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Leave the 3D walkthrough"
                  accessibilityHint="Saves this plan and returns to Create"
                  onPress={leaveWalkthrough}
                  hitSlop={LAYOUT.hitSlop}
                  android_ripple={{ color: "rgba(30,36,31,0.10)", borderless: true }}
                  style={({ pressed }) => [styles.headerButton, pressed && styles.headerButtonPressed]}
                >
                  <Ionicons name="chevron-back" size={20} color={COLORS.textPrimary} />
                </Pressable>

                {/* The plan's name is what this screen is *about*, so it is the
                    heading; which of its four steps is open is the position
                    within it, so it is the eyebrow. These were the other way
                    round, which put the one editable thing on the screen in
                    10.5pt uppercase and gave the h2 to a sentence that changed
                    under the reader every time they pressed Continue.
                    Where you are, then what you are working on. The step used
                    to be set in the same 10.5pt uppercase the library uses for
                    a section kicker, which made a value that changes four times
                    read as a fixed label; it is a chip now, because that is what
                    a chip is for. */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Plan name, ${projectTitle}`}
                  accessibilityHint="Rename this plan"
                  style={({ pressed }) => [styles.headerCopy, pressed && styles.pressedSurface]}
                  onPress={() => setRenaming("current")}
                >
                  <View style={styles.headerTitleRow}>
                    <Text style={styles.headerTitle} numberOfLines={1}>{projectTitle}</Text>
                    <Ionicons name="create-outline" size={14} color={COLORS.textTertiary} />
                  </View>
                  <Text style={styles.headerEyebrow}>3D Walkthrough</Text>
                </Pressable>

                {/* The icon alone said "save"; it never said whether the last
                    save had happened. Screen reader users got "Save this 3D
                    plan" whether it was mid-save, saved, or never saved. */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    syncState === "saving"
                      ? "Saving this 3D plan"
                      : syncState === "saved"
                        ? "Saved. Save again"
                        : "Save this 3D plan"
                  }
                  accessibilityState={{ busy: syncState === "saving", disabled: syncState === "saving" }}
                  onPress={() => pushToCloud({ announce: true })}
                  hitSlop={LAYOUT.hitSlop}
                  android_ripple={{ color: "rgba(30,36,31,0.10)", borderless: true }}
                  style={({ pressed }) => [
                    styles.headerButton,
                    syncState === "saved" && styles.headerButtonSaved,
                    pressed && styles.headerButtonPressed,
                  ]}
                  disabled={syncState === "saving"}
                >
                  {syncState === "saving" ? (
                    <ActivityIndicator size="small" color={COLORS.primaryDark} />
                  ) : (
                    <Ionicons
                      name={syncState === "saved" ? "checkmark" : "save-outline"}
                      size={18}
                      color={syncState === "saved" ? COLORS.success : COLORS.textPrimary}
                    />
                  )}
                </Pressable>
              </View>

              {/* No rule between the title row and the step bar. The header is
                  already one tinted surface closed by its own bottom border, so
                  a second full-bleed hairline inside it cut the bar in two and
                  drew the eye to a divider instead of to the progress it sits
                  above. Space separates them now. */}
              <View style={styles.stageBar}>
                <View style={styles.stageBarRow}>
                  <LinearGradient colors={COLORS.gradientBrandDeep} style={styles.stageBarMark}>
                    <Ionicons name={current.icon} size={16} color={COLORS.white} />
                  </LinearGradient>
                  <View style={styles.stageBarCopy}>
                    <Text style={styles.stageBarMeta} numberOfLines={1}>
                      {`STEP ${stage + 1} OF ${STAGES.length}  /  ${current.label}`}
                    </Text>
                    <Text style={styles.stageBarTitle} numberOfLines={1}>{current.title}</Text>
                  </View>
                </View>

                <View style={styles.stepper} accessibilityRole="tablist">
                {STAGES.map((item, index) => {
                  const done = index < stage;
                  const active = index === stage;
                  const reachable = index <= stage || rooms.length > 0;
                  return (
                    <Pressable
                      key={item.key}
                      disabled={!reachable}
                      accessibilityRole="tab"
                      accessibilityLabel={`Step ${index + 1}, ${item.label}`}
                      accessibilityState={{ selected: active, disabled: !reachable }}
                      hitSlop={{ top: 10, bottom: 10, left: 2, right: 2 }}
                      style={({ pressed }) => [
                        styles.step,
                        (done || active) && styles.stepReached,
                        active && styles.stepActive,
                        pressed && reachable && styles.stepPressed,
                      ]}
                      onPress={() => setStage(index)}
                    />
                  );
                })}
                </View>
              </View>
            </SafeAreaView>
          </LinearGradient>

          {/* ── Body ───────────────────────────────────────────────────── */}
          {stage === STAGES.length - 1 ? (
            <WalkthroughStage
              viewerRef={viewerRef}
              layout={layout}
              roomConfigs={sceneRoomConfigs}
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
              renders={renderGallery}
              activeRender={activeRender}
              outputMode={outputMode}
              rendering={rendering}
              busy={busy}
              renderPrice={RENDER_PRICE}
              unlimited={unlimited}
              freeRendersLeft={freeRendersLeft}
              coins={coins}
              adStatus={adStatus}
              onWatchAd={watchAd}
              onUpgrade={() => {
                setPanel(null);
                router.push("/profile/upgrade");
              }}
              onReady={setSceneInfo}
              onSceneUpdate={setSceneInfo}
              onSelect={setInspected}
              onSnapshot={handleSnapshot}
              onFurnitureChange={updateFurnitureEdit}
              onDiagnostic={setNotice}
              onExactError={(message) => {
                // A scene that will not open must not be served from the device
                // again. Most often this is a model URL whose GLB has been
                // evicted, and holding on to it would mean this plan never
                // worked again — the stored copy would keep answering before
                // the network ever got the chance to rebuild it.
                sceneCache.current.delete(sceneSignature);
                forgetStoredScene(sceneSignature).catch(() => {});
                setExactScene(null);
                setExactSceneError("Your home was built, but it could not be opened here.");
                setExactSceneDetail(message);
              }}
              onRetryExact={rebuildScene}
              onConfirmRebuild={() => setConfirmRebuild(true)}
              onBackToDesign={goBack}
              onChangeMode={changeViewMode}
              onToggleNight={toggleNight}
              onFocusRoom={focusRoom}
              onRender={(renderBrief) => requestCapture("ai", renderBrief)}
              onSetPanel={setPanel}
              onSetOutputMode={setOutputMode}
              onShowRender={showRender}
              onRemoveRender={removeRender}
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
              {/* Every step opens with what it is for. The title used to live in
                  the header as a 10.5pt overline and the copy appeared on three
                  of the four steps, so the one screen in the flow that asks the
                  most of a person — Draw — began with no statement of the job at
                  all, only a tool hint. */}
              {/* ── Step 1 · Draw ────────────────────────────────────── */}
              {stage === 0 && (
                <>
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

                  <ToolPalette
                    tool={tool}
                    onChange={setTool}
                    snapToGrid={snapToGrid}
                    onToggleSnap={() => setSnapToGrid((value) => !value)}
                    hasRooms={rooms.length > 0}
                  />

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

                  {/* One frame around the drawing surface, with the instruction
                      for the armed tool attached to the top of it. The canvas
                      used to draw a rounded border and a shadow of its own
                      *inside* this card, so the plan sat in two nested frames a
                      hairline apart, and the instruction floated above both as
                      loose grey text that read as page furniture. */}
                  <View style={styles.canvasCard}>
                    <View style={styles.canvasHint} accessibilityLiveRegion="polite">
                      <Ionicons
                        name={activeTool?.icon || "grid-outline"}
                        size={14}
                        color={COLORS.primaryDark}
                        style={styles.canvasHintIcon}
                      />
                      <Text style={styles.canvasHintText}>
                        <Text style={styles.canvasHintTool}>{activeTool?.label} · </Text>
                        {TOOL_HINTS[tool]}
                      </Text>
                    </View>
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
                      onSelectRoom={setSelectedRoom}
                      onMoveRoom={moveRoom}
                      onMoveVertex={moveVertex}
                      onInsertVertex={insertVertex}
                      onMoveOpening={moveOpening}
                      onMoveOpeningPoint={moveOpeningPoint}
                      onSelectShape={selectShape}
                      onSetCurveControl={setCurveControl}
                      onBeginEdit={rememberPlan}
                      onStartDrawing={() => setTool("rect")}
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
                        accessibilityRole="button"
                        accessibilityLabel={curveControl ? "Discard this wall" : "Discard these corners"}
                        android_ripple={{ color: "rgba(30,36,31,0.14)", borderless: true }}
                        style={({ pressed }) => [styles.drawingBarGhost, pressed && styles.pressedSurface]}
                        onPress={() => {
                          setDraft([]);
                          setCurveControl(null);
                        }}
                      >
                        <Ionicons name="close" size={16} color={COLORS.textSecondary} />
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ disabled: !curveControl && draft.length < 3 }}
                        android_ripple={{ color: "rgba(255,255,255,0.20)" }}
                        style={({ pressed }) => [
                          styles.drawingBarPrimary,
                          !curveControl && draft.length < 3 && styles.drawingBarPrimaryDisabled,
                          pressed && styles.pressedSurface,
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

                  {/* One selected thing, one card.
                      Selecting a door used to produce two stacked cards — a bar
                      naming it with a Delete button, and immediately under it a
                      second bordered card holding its type and width. Two
                      surfaces, two borders and a gap, for one object. The name
                      row is now the card's header and the controls are its
                      body, so a selected room is a one-row card and a selected
                      opening is the same card with its settings inside. */}
                  {selection && (
                    <View style={styles.selectionCard}>
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
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Delete the selected shape"
                          android_ripple={{ color: "rgba(190,58,47,0.16)" }}
                          style={({ pressed }) => [styles.selectionAction, pressed && styles.pressedSurface]}
                          onPress={deleteSelection}
                        >
                          <Ionicons name="trash-outline" size={15} color={COLORS.danger} />
                          <Text style={styles.selectionActionText}>Delete</Text>
                        </Pressable>
                      </View>

                      {/* Type and width, and nothing else. A "Presets" row of
                          named widths sat under the width field and set the
                          same number a second way, so the two controls could
                          disagree on screen. */}
                      {selection.kind === "opening" && openings[selection.index] && (
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
                            maxMeters={maxOpeningMeters(openings[selection.index], rooms, pixelsPerMeter)}
                            onChange={(meters) => editOpening(selection.index, { meters })}
                          />
                        </View>
                      )}
                    </View>
                  )}

                  {/* Three equal cells: the two that take back a mistake, and
                      the one that takes back all of them. Expand used to sit
                      between Redo and Clear, which put a harmless view control
                      next to the only destructive button on the step. */}
                  <View style={styles.actionRow}>
                    <ActionButton
                      icon="arrow-undo-outline"
                      label="Undo"
                      disabled={!draft.length && !history.length && !curveControl}
                      onPress={undo}
                    />
                    <ActionButton icon="arrow-redo-outline" label="Redo" disabled={!future.length} onPress={redo} />
                    <ActionButton
                      icon="trash-outline"
                      label="Clear"
                      tone="danger"
                      disabled={!rooms.length && !openings.length && !draft.length}
                      onPress={() => setConfirmClear(true)}
                    />
                  </View>

                  {/* What is on the sheet, in one line.
                      A "Room sizes" card used to sit here listing every room
                      with an editable width and depth — the same two fields the
                      Rooms step already shows on each room's own card, under the
                      heading "Exact size". Two places to type the same number is
                      one place too many, and on a five-room plan it doubled the
                      length of the step that is hardest to scroll while drawing.
                      Typing a size lives on the Rooms step; this step draws. */}
                  {!!rooms.length && (
                    <View style={styles.planSummary}>
                      <Ionicons name="analytics-outline" size={15} color={COLORS.primaryDark} />
                      <Text style={styles.planSummaryText} numberOfLines={1}>
                        {rooms.length === 1 ? "1 room" : `${rooms.length} rooms`}
                        {" · "}
                        {openings.length === 1 ? "1 opening" : `${openings.length} openings`}
                        {" · "}
                        {totalArea.toFixed(1)} m²
                      </Text>
                    </View>
                  )}
                </>
              )}

              {/* ── Step 2 · Rooms ───────────────────────────────────── */}
              {stage === 1 && (
                <>
                  {roomConfigs.length === 0 ? (
                    <EmptyState
                      text="There is nothing to name yet. Draw at least one room on the plan first."
                      actionLabel="Back to Draw"
                      onAction={() => setStage(0)}
                    />
                  ) : (
                    <View style={styles.summaryBar}>
                      <Ionicons name="home-outline" size={17} color={COLORS.primaryDark} />
                      <Text style={styles.summaryBarText}>
                        {roomConfigs.length} {roomConfigs.length === 1 ? "room" : "rooms"} · {totalArea.toFixed(1)} m² measured
                      </Text>
                    </View>
                  )}

                  {/* Purpose first, then the name, then the size.
                      The card used to open with a name field the person had
                      nothing to base an answer on yet, with the delete button
                      sitting immediately beside it — a destructive control one
                      thumb-width from the field they were typing in. Choosing
                      what a room is *for* is the decision the renderer needs and
                      the one that makes the name obvious, so it leads; delete
                      moved out of the typing hand's way into the card's header
                      row, beside the room's number. */}
                  {roomConfigs.map((room, index) => (
                    <View key={`config-${index}`} style={styles.card}>
                      <View style={styles.roomCardHead}>
                        <View style={[styles.roomSwatch, { backgroundColor: ROOM_TINTS[index % ROOM_TINTS.length].stroke }]} />
                        <Text style={styles.roomIndexLabel}>
                          {`Room ${index + 1} of ${roomConfigs.length}`}
                        </Text>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Delete ${room.name || `room ${index + 1}`}`}
                          onPress={() => setPendingRoomDelete(index)}
                          hitSlop={LAYOUT.hitSlop}
                          android_ripple={{ color: "rgba(190,58,47,0.16)", borderless: true }}
                          style={({ pressed }) => [styles.roomDelete, pressed && styles.pressedSurface]}
                        >
                          <Ionicons name="trash-outline" size={17} color={COLORS.danger} />
                        </Pressable>
                      </View>

                      <ChipRow label="What is this room for?" options={ROOM_TYPES} value={room.roomType} onChange={(v) => updateRoom(index, "roomType", v)} />

                      <Text style={[styles.fieldLabel, { marginTop: SPACING.base }]}>Name</Text>
                      <View style={styles.roomNameField}>
                        <TextInput
                          style={styles.roomName}
                          value={room.name}
                          accessibilityLabel={`Name of room ${index + 1}`}
                          onChangeText={(value) => updateRoom(index, "name", value)}
                          placeholder={room.roomType || `Room ${index + 1}`}
                          placeholderTextColor={COLORS.placeholderText}
                          maxLength={40}
                        />
                        <Ionicons name="create-outline" size={14} color={COLORS.textTertiary} />
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
                    </View>
                  ))}
                </>
              )}

              {/* ── Step 3 · Style ───────────────────────────────────── */}
              {stage === 2 && (
                roomConfigs.length === 0 ? (
                  <EmptyState
                    text="These settings furnish your rooms, so there has to be a room first."
                    actionLabel="Back to Draw"
                    onAction={() => setStage(0)}
                  />
                ) : (
                  <>
                    {/* Two questions, and they are the two that decide what gets
                        built: what the home looks like, and how much is in it.
                        This was five, across two cards, and the other three are
                        refinements with working defaults — so they wait behind
                        the disclosure below rather than standing between someone
                        and their home.

                        Colour mood is gone rather than moved. It mixed 34% into
                        the walls, but a wall finish then mixes 72% over the top,
                        so once any finish is chosen the mood moves a wall by
                        under 1% and a sofa by at most 7%. The only thing it
                        visibly changed was the accent — cushions and one object.
                        It read as a colour control and behaved like a rounding
                        error, which is what made it feel broken.

                        The colour decision now lives in the one place it is
                        actually honoured: the Render sheet picks a tone and
                        sends it to a model that paints with it. Asking here as
                        well was asking twice and answering once. */}
                    <View style={[styles.card, styles.cardFirst]}>
                      <View style={styles.cardSectionHead}>
                        <View style={styles.cardSectionIcon}>
                          <Ionicons name="color-palette-outline" size={16} color={COLORS.primaryDark} />
                        </View>
                        <Text style={styles.cardSectionTitle}>Direction</Text>
                      </View>
                      {/* A plan saved under a style that has since been retired
                          keeps it, and keeps it selectable, rather than opening
                          with nothing highlighted and no way back to what it was
                          actually built as. */}
                      <ChipRow label="Design style" options={styleOptions} value={settings.style} onChange={(v) => updateSetting("style", v)} />
                      <ChipRow label="Design profile" options={DESIGN_PROFILES} value={settings.designProfile} onChange={(v) => updateSetting("designProfile", v)} />
                    </View>

                    <Pressable
                      style={({ pressed }) => [styles.disclosure, pressed && styles.pressedSurface]}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: styleExpanded }}
                      android_ripple={{ color: "rgba(51,96,74,0.10)" }}
                      onPress={() => setStyleExpanded((value) => !value)}
                    >
                      <Text style={styles.disclosureText}>More detail</Text>
                      <Ionicons
                        name={styleExpanded ? "chevron-up" : "chevron-down"}
                        size={17}
                        color={COLORS.primaryDark}
                      />
                    </Pressable>

                    {/* Everything past the two questions above lives behind one
                        disclosure, closed by default. Every field in here
                        defaults to "Auto by style" and is read by the same
                        designer that reads the profile, so a plan is complete
                        without ever opening it.

                        Floor and wall finish moved down here with the rest.
                        They do change what you see — a finish replaces the
                        floor colour outright — but they are a choice about
                        materials, and the style above has already made a good
                        one. Someone who wants oak instead of stone comes
                        looking; someone who wants a home does not have to
                        answer first.

                        "Walk through walls" is here because it is a preference
                        about the camera rather than a decision about the home —
                        the only control on the step that changes nothing about
                        what gets built. */}
                    {styleExpanded && (
                      <View style={styles.card}>
                        {/* The two materials people actually want to change, and
                            nothing else.

                            Rug design, window treatment and decor set were here
                            too, and all three are exactly what "Auto by style"
                            already decides well — the same designer that reads
                            the profile reads them, and picking a style has
                            picked them. Three more chip rows to scroll past on
                            the way to a home, to arrive at the answer the
                            default was going to give.

                            The notes box has moved to the Render sheet. In 3D it
                            was a fourteen-word keyword match — nine colours plus
                            walnut, oak, minimal and luxury — so "calm lighting,
                            no glossy surfaces" did nothing at all. Where it is
                            read properly is the AI brief, which is written next
                            to the button that pays for it. */}
                        <ChipRow label="Floor finish" options={FLOOR_FINISHES} value={settings.floorFinish} onChange={(v) => updateSetting("floorFinish", v)} />
                        <ChipRow label="Wall finish" options={WALL_FINISHES} value={settings.wallFinish} onChange={(v) => updateSetting("wallFinish", v)} />

                        <Pressable
                          style={({ pressed }) => [styles.settingToggle, pressed && styles.pressedSurface]}
                          accessibilityRole="switch"
                          accessibilityLabel="Walk through walls"
                          accessibilityState={{ checked: settings.freeExplore }}
                          android_ripple={{ color: "rgba(30,36,31,0.08)" }}
                          onPress={() => updateSetting("freeExplore", !settings.freeExplore)}
                        >
                          <View style={styles.settingToggleCopy}>
                            <Text style={styles.settingToggleTitle}>Walk through walls</Text>
                            {/* Off by default now that walls are solid and the
                                camera slides along them. This is the escape
                                hatch for a plan whose rooms were drawn without
                                doors between them, not the normal way round. */}
                            <Text style={styles.settingToggleText}>
                              Off, you use the doors. On, you can step straight through a wall.
                            </Text>
                          </View>
                          <View style={[styles.switchTrack, settings.freeExplore && styles.switchTrackOn]}>
                            <View style={[styles.switchKnob, settings.freeExplore && styles.switchKnobOn]} />
                          </View>
                        </Pressable>
                      </View>
                    )}
                  </>
                )
              )}
            </ScrollView>
          )}

          {/* ── Footer ─────────────────────────────────────────────────────
              Two buttons of equal width and equal height. Back used to be sized
              by its own label next to a flexing Continue, which made the pair
              look like a mistake rather than a choice.

              Both now say where they go rather than only which direction they
              point: "Back" and "Continue" on a four-step flow are the two labels
              a person has to translate into steps in their head every time, and
              the step they name is already on screen a few hundred pixels away
              in the header. The arrows stay, because direction is read faster
              from a shape than from a word. */}
          {stage < STAGES.length - 1 && (
            <SafeAreaView edges={["bottom"]} style={styles.footer}>
              <View style={styles.footerRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={stage === 0 ? "Back to your plans" : `Back to ${STAGES[stage - 1].label}`}
                  android_ripple={{ color: "rgba(30,36,31,0.10)" }}
                  style={({ pressed }) => [styles.footerButton, styles.footerGhost, pressed && styles.pressedSurface]}
                  onPress={goBack}
                >
                  <Ionicons name="chevron-back" size={18} color={COLORS.primaryDark} />
                  <Text style={styles.footerGhostText} numberOfLines={1}>
                    {stage === 0 ? "Plans" : "Back"}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    stage === STAGES.length - 2
                      ? "Walk through your home"
                      : `Continue to ${STAGES[stage + 1].label}`
                  }
                  accessibilityState={{ disabled: !canContinue }}
                  accessibilityHint={canContinue ? undefined : "Draw at least one room first"}
                  android_ripple={canContinue ? { color: "rgba(255,255,255,0.20)" } : undefined}
                  style={({ pressed }) => [
                    styles.footerButton,
                    styles.footerPrimary,
                    !canContinue && styles.footerPrimaryDisabled,
                    pressed && canContinue && styles.pressedSurface,
                  ]}
                  disabled={!canContinue}
                  onPress={goNext}
                >
                  <Text
                    style={[styles.footerPrimaryText, !canContinue && styles.footerPrimaryTextDisabled]}
                    numberOfLines={1}
                  >
                    {!canContinue
                      ? "Add a room first"
                      : stage === STAGES.length - 2
                        ? "Explore in 3D"
                        : "Continue"}
                  </Text>
                  <Ionicons
                    name={canContinue ? "arrow-forward" : "lock-closed-outline"}
                    size={canContinue ? 18 : 15}
                    color={canContinue ? COLORS.white : COLORS.textTertiary}
                  />
                </Pressable>
              </View>
            </SafeAreaView>
          )}
        </>
      )}

      {/* ── Dialogs shared by both views ────────────────────────────────── */}
      <PlanActionSheet
        project={planActions}
        onClose={() => setPlanActions(null)}
        onRename={() => {
          setRenaming(planActions);
          setPlanActions(null);
        }}
        onDelete={() => {
          setPendingDelete(planActions);
          setPlanActions(null);
        }}
      />

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

      {/* Both of these say what will be lost, in the numbers on screen, rather
          than asking "are you sure?" about an unnamed amount of work. */}
      <ConfirmDialog
        visible={confirmClear}
        title="Clear this plan?"
        message={
          `This removes ${rooms.length === 1 ? "1 room" : `${rooms.length} rooms`}`
          + `${openings.length ? ` and ${openings.length === 1 ? "1 opening" : `${openings.length} openings`}` : ""}`
          + `.${planImage ? " The traced photo stays." : ""}`
        }
        confirmLabel="Clear"
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          setConfirmClear(false);
          clearPlanLines();
        }}
      />

      {/* Furnishing is deterministic, so a rebuild of an unchanged plan under an
          unchanged renderer returns the same home — this is only worth pressing
          when the furniture is a renderer behind, and the copy says so rather
          than promising a different result. */}
      <ConfirmDialog
        visible={confirmRebuild}
        title="Rebuild this home?"
        message={
          "Livinai will furnish your rooms again from scratch, with the latest furniture."
          + (Object.keys(furnitureEdits).length
            ? " Any pieces you moved yourself go back where Livinai placed them."
            : "")
        }
        confirmLabel="Rebuild"
        onCancel={() => setConfirmRebuild(false)}
        onConfirm={() => {
          setConfirmRebuild(false);
          setFurnitureEdits({});
          rebuildScene();
        }}
      />

      <ConfirmDialog
        visible={pendingRoomDelete !== null}
        title="Delete this room?"
        message={
          pendingRoomDelete === null
            ? ""
            : `“${roomConfigs[pendingRoomDelete]?.name || `Room ${pendingRoomDelete + 1}`}” and its measurements will be removed from the plan.`
        }
        confirmLabel="Delete"
        onCancel={() => setPendingRoomDelete(null)}
        onConfirm={() => {
          removeRoom(pendingRoomDelete);
          setPendingRoomDelete(null);
        }}
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
  renders,
  activeRender,
  outputMode,
  rendering,
  busy,
  renderPrice,
  unlimited,
  freeRendersLeft,
  coins,
  adStatus,
  onWatchAd,
  onUpgrade,
  onReady,
  onSceneUpdate,
  onSelect,
  onSnapshot,
  onFurnitureChange,
  onDiagnostic,
  onExactError,
  onRetryExact,
  onConfirmRebuild,
  onBackToDesign,
  onChangeMode,
  onToggleNight,
  onFocusRoom,
  onRender,
  onSetPanel,
  onSetOutputMode,
  onShowRender,
  onRemoveRender,
  onSaveRender,
}) {
  const insets = useSafeAreaInsets();
  const showingAi = outputMode === "ai" && !!activeRender;
  const sheetOpen = !!inspected || panel === "ai" || panel === "renders";
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

      {showingAi && <AiRenderLayer render={activeRender} />}

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
          {/* One row: leave, look, light.
              The switcher is the control this step is for, so it takes the
              middle and every pixel the two fixed-width buttons either side do
              not need. Back and the light toggle are icon-led and their labels
              give way first, which is what keeps all three on one line on a
              narrow phone. */}
          <View style={styles.viewControls} pointerEvents="box-none">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to Style"
              android_ripple={{ color: "rgba(30,36,31,0.16)" }}
              style={({ pressed }) => [styles.viewerBack, pressed && styles.pressedSurface]}
              onPress={onBackToDesign}
            >
              <Ionicons name="chevron-back" size={18} color={COLORS.textPrimary} />
              <Text style={styles.viewerBackText} numberOfLines={1}>Style</Text>
            </Pressable>

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

            {/* The time of day, named.
                This was a bare icon in a circle, and a circle holding a moon is
                unreadable: it means "you are in night" or "press for night"
                depending on which you assume, and there was nothing on screen to
                settle it. Worse, the "on" fill was the brand's sage green, so
                the one control in the app whose whole subject is light and dark
                signalled evening with a mid-green disc.
                It now says which one you are in, and looks like it: white paper
                and a warm sun by day, near-black and a moon at night. */}
            <Pressable
              accessibilityRole="switch"
              accessibilityLabel={night ? "Evening light. Switch to daylight" : "Daylight. Switch to evening light"}
              accessibilityState={{ checked: night }}
              android_ripple={{ color: night ? "rgba(255,255,255,0.20)" : "rgba(30,36,31,0.16)" }}
              style={({ pressed }) => [
                styles.lightToggle,
                night && styles.lightToggleNight,
                pressed && styles.pressedSurface,
              ]}
              onPress={onToggleNight}
            >
              <Ionicons
                name={night ? "moon" : "sunny"}
                size={16}
                color={night ? COLORS.white : COLORS.accent}
              />
              <Text
                style={[styles.lightToggleText, night && styles.lightToggleTextNight]}
                numberOfLines={1}
              >
                {night ? "Night" : "Day"}
              </Text>
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
                  ? "Drag to look · Tap the floor to walk there · Tap a piece to edit"
                  : "Drag to turn · Pinch to zoom · Two fingers to pan"
              }
            />
          )}
        </View>

        {/* ── Bottom cluster ─────────────────────────────────────────────── */}
        <View style={styles.overlayBottom} pointerEvents="box-none">
          {/* Which render is on screen, and the three things anyone wants next:
              keep it, look at the others this plan has made, or go back to the
              live room. "All renders" is here because this bar is where a person
              already is when they finish looking at one. */}
          {showingAi && (
            <View style={styles.aiResultBar}>
              <View style={styles.aiResultCopy}>
                <Text style={styles.aiResultTag}>AI RENDER</Text>
                <Text style={styles.aiResultLabel} numberOfLines={1}>{activeRender.label}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Save this render"
                style={({ pressed }) => [styles.aiResultButton, pressed && styles.pressedSurface]}
                onPress={() => onSaveRender(activeRender.image)}
              >
                <Ionicons name="download-outline" size={18} color={COLORS.white} />
              </Pressable>
              {renders.length > 1 && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`All ${renders.length} renders in this plan`}
                  style={({ pressed }) => [styles.aiResultButton, pressed && styles.pressedSurface]}
                  onPress={() => onSetPanel("renders")}
                >
                  <Ionicons name="images-outline" size={18} color={COLORS.white} />
                </Pressable>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back to the live 3D view"
                style={({ pressed }) => [styles.aiResultButton, pressed && styles.pressedSurface]}
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

          {showStick && <MoveStick onChange={drive} />}

          {/* The status chip taking the width, then the two things this step
              offers: the renders this plan already has, and making another.
              The gallery button only exists once there is something in it, so
              the dock is never wider than it has reason to be. */}
          {!showingAi && (
            <View style={styles.dock} pointerEvents="box-none">
              {/* The chip reports what is in the room, and is also the way to
                  say "this is not what I should be seeing".

                  A built scene is remembered in three places, and until now the
                  only control that could clear them was the Retry button on the
                  error screen — which never appears for a scene that opens
                  perfectly well and is merely out of date. Anyone whose home was
                  furnished under an older renderer had no way to ask for it
                  again, and no reason to suspect a cache was why. */}
              <Pressable
                style={({ pressed }) => [styles.statusChip, pressed && styles.pressedSurface]}
                accessibilityRole="button"
                accessibilityLiveRegion="polite"
                accessibilityLabel={status.label}
                accessibilityHint="Rebuilds this home in 3D"
                android_ripple={{ color: "rgba(255,255,255,0.18)" }}
                onPress={() => onConfirmRebuild()}
              >
                {status.busy
                  ? <ActivityIndicator size="small" color={COLORS.white} />
                  : <View style={styles.statusDot} />}
                <Text style={styles.statusText} numberOfLines={1}>{status.label}</Text>
                <Ionicons name="refresh-outline" size={14} color="rgba(255,255,255,0.72)" />
              </Pressable>

              {renders.length > 0 && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    renders.length === 1
                      ? "1 render in this plan"
                      : `${renders.length} renders in this plan`
                  }
                  accessibilityState={{ expanded: panel === "renders" }}
                  android_ripple={{ color: "rgba(30,36,31,0.14)" }}
                  style={({ pressed }) => [
                    styles.dockSecondary,
                    panel === "renders" && styles.dockSecondaryActive,
                    pressed && styles.pressedSurface,
                  ]}
                  onPress={() => onSetPanel(panel === "renders" ? null : "renders")}
                >
                  <Ionicons name="images-outline" size={17} color={COLORS.primaryDark} />
                  <Text style={styles.dockSecondaryText}>{renders.length}</Text>
                </Pressable>
              )}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Render this view with AI"
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
                <Text style={styles.dockPrimaryText}>AI render</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
      )}

      {/* The render brief is a sheet, not a card floating over the room.
          It used to be a panel wedged into the bottom overlay between the
          movement stick and the dock, so the two decisions it asks for competed
          with the walking controls, and its "close" was an 18pt × in the corner
          of a translucent stack. A sheet dims what is behind it, can be
          dismissed by tapping away, and gives its primary action the full width
          of the screen — which is what a paid, one-tap-costs-a-credit action
          should look like. */}
      <RenderSheet
        visible={panel === "ai" && !showingAi}
        viewMode={viewMode}
        night={night}
        defaultRoomType={roomConfigs[selectedRoom]?.roomType || "Living Room"}
        defaultDesignStyle={settings.style || "Modern"}
        defaultColorTone={settings.colorMood || "Warm neutral"}
        renderCount={renders.length}
        rendering={rendering}
        price={renderPrice}
        unlimited={unlimited}
        freeRendersLeft={freeRendersLeft}
        coins={coins}
        adStatus={adStatus}
        onWatchAd={onWatchAd}
        onUpgrade={onUpgrade}
        onClose={() => onSetPanel(null)}
        onOpenGallery={() => onSetPanel("renders")}
        onRender={onRender}
      />

      {/* The plan's own renders, in the plan. Before this the only way back to
          a finished render was the Collection tab, which lists every design the
          account has ever made with nothing on a card to say which plan it came
          from — so the picture of your kitchen was findable, but not from the
          home it belongs to. */}
      <RenderGallerySheet
        visible={panel === "renders"}
        renders={renders}
        activeId={activeRender?.id || null}
        onClose={() => onSetPanel(null)}
        onOpen={onShowRender}
        onRemove={onRemoveRender}
        // Close this sheet before the save sheet opens. Presenting one modal
        // from inside another's hierarchy is the sort of thing that works on
        // one platform and silently does nothing on the other.
        onSave={(image) => {
          onSetPanel(null);
          onSaveRender(image);
        }}
        onRenderMore={() => {
          // Back to the live room first. The brief renders the view on screen,
          // so opening it over a finished picture would offer to re-render
          // something the camera is not pointing at.
          onSetOutputMode("live");
          onSetPanel("ai");
        }}
      />
    </View>
  );
}

/**
 * The finished render, over the 3D view.
 *
 * Two bugs lived in the one line this replaces. The layer was a near-black slab
 * with an `<Image>` on it, so between the render finishing and the file arriving
 * from Cloudinary the user was shown a black screen — the render appearing to
 * have produced nothing. And because the element was reused across renders,
 * React kept the decoded bitmap of the *previous* one until the new file
 * decoded, so generating a second view showed the first one again for a moment
 * and it was impossible to tell a stale frame from a finished one.
 *
 * Keying on the URL forces a fresh element per render, so nothing stale can be
 * shown; the load is tracked, so the wait says it is a wait; and the backdrop is
 * the app's own sunken surface rather than black.
 */
function AiRenderLayer({ render }) {
  const [state, setState] = useState("loading");

  // A new render is a new wait, even though this component did not unmount.
  useEffect(() => setState("loading"), [render.image]);

  return (
    <View style={styles.aiLayer}>
      <Image
        key={render.image}
        source={{ uri: render.image }}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
        onLoad={() => setState("ready")}
        onError={() => setState("error")}
      />
      {state !== "ready" && (
        <View style={styles.aiLayerState}>
          {state === "loading" ? (
            <>
              <ActivityIndicator size="large" color={COLORS.primaryDark} />
              <Text style={styles.aiLayerStateText}>Loading your render…</Text>
            </>
          ) : (
            <>
              <Ionicons name="cloud-offline-outline" size={26} color={COLORS.textTertiary} />
              <Text style={styles.aiLayerStateText}>
                This render is saved to your collection, but it could not be loaded here.
              </Text>
            </>
          )}
        </View>
      )}
    </View>
  );
}

/**
 * "Render with AI" — the one action in the walkthrough that spends a coin.
 *
 * Three things changed here, and all three were about the same thing: a person
 * pressing a paid button should know what they are buying and what it costs.
 *
 *  - **The camera choice is gone.** It offered "Designer" or "My view",
 *    defaulted to Designer, and moved the camera the moment it was opened — so
 *    the picture someone paid for was framed from a corner they had not chosen,
 *    of a room they were no longer looking at. A render is the view on screen.
 *    That needs no control and no explanatory sentence underneath it.
 *  - **The price is on the button.** It was nowhere on this sheet. The first
 *    time anybody learned a render costs a coin was a 403 after the frame had
 *    already been captured and uploaded.
 *  - **"Show the last render" is gone**, replaced by the whole gallery. It could
 *    only ever reach one picture — the most recent one for this exact
 *    viewpoint — and it sat under the primary action as a second, competing
 *    button on a sheet whose job is to make one.
 */
function RenderSheet({
  visible,
  viewMode,
  night,
  defaultRoomType,
  defaultDesignStyle,
  defaultColorTone,
  renderCount,
  rendering,
  price,
  unlimited,
  freeRendersLeft,
  coins,
  adStatus,
  onWatchAd,
  onUpgrade,
  onClose,
  onOpenGallery,
  onRender,
}) {
  const insets = useSafeAreaInsets();
  const bird = viewMode === "plan";
  const [roomType, setRoomType] = useState(defaultRoomType || "Living Room");
  const [designStyle, setDesignStyle] = useState(defaultDesignStyle || "Modern");
  const [colorTone, setColorTone] = useState(defaultColorTone || "Warm neutral");
  const [note, setNote] = useState("");

  // Start each render from the room and whole-home choices already made. The
  // brief stays local until Render is pressed, so exploring options here does
  // not silently rewrite the plan.
  useEffect(() => {
    if (!visible) return;
    setRoomType(defaultRoomType || "Living Room");
    setDesignStyle(defaultDesignStyle || "Modern");
    setColorTone(defaultColorTone || "Warm neutral");
    setNote("");
  }, [defaultColorTone, defaultDesignStyle, defaultRoomType, visible]);

  const submitRender = () => {
    onRender({
      roomType: bird ? "Floor Plan" : roomType,
      designStyle,
      colorTone,
      note: note.trim(),
    });
  };

  const affordable = unlimited || freeRendersLeft > 0 || coins >= price;

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, styles.renderSheet, { paddingBottom: Math.max(insets.bottom, SPACING.lg) }]}
          onPress={() => {}}
        >
          <View style={styles.sheetHandle} />

          <View style={styles.sheetHead}>
            <View style={[styles.sheetIcon, styles.sheetIconAccent]}>
              <Ionicons name="sparkles" size={18} color={COLORS.primaryDark} />
            </View>
            <View style={styles.sheetHeadCopy}>
              <Text style={styles.sheetTitle}>Render with AI</Text>
              <Text style={styles.sheetSubtitle}>
                {bird ? "The whole floor, from above" : "This room, photorealistic"}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={LAYOUT.hitSlop}
              android_ripple={{ color: "rgba(30,36,31,0.14)", borderless: true }}
              style={({ pressed }) => [styles.sheetCloseIcon, pressed && styles.pressedSurface]}
              onPress={onClose}
            >
              <Ionicons name="close" size={18} color={COLORS.textSecondary} />
            </Pressable>
          </View>

          {/* What this will cost, before the brief rather than after it — the
              same three states the Interior screen has: included, free-trial
              renders remaining, or a coin balance with a way to add to it. */}
          <RenderCostBar
            price={price}
            unlimited={unlimited}
            freeRendersLeft={freeRendersLeft}
            coins={coins}
            affordable={affordable}
            adStatus={adStatus}
            onWatchAd={onWatchAd}
            onUpgrade={onUpgrade}
          />

          <ScrollView
            style={styles.renderBriefScroll}
            contentContainerStyle={styles.renderBriefContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {bird ? (
              <View style={styles.renderScopeBlock}>
                <Text style={styles.fieldLabel}>Render scope</Text>
                <View
                  style={styles.renderScopeValue}
                  accessibilityRole="text"
                  accessibilityLabel="Render scope, whole floor plan"
                >
                  <Ionicons name="map-outline" size={17} color={COLORS.primaryDark} />
                  <Text style={styles.renderScopeText}>Whole floor plan</Text>
                  <Ionicons name="lock-closed-outline" size={14} color={COLORS.textTertiary} />
                </View>
                <Text style={styles.renderFieldHint}>Switch to Walk view to render a specific room type.</Text>
              </View>
            ) : (
              <ChipRow label="Room type" options={ROOM_TYPES} value={roomType} onChange={setRoomType} />
            )}

            <ChipRow
              label="Design style"
              options={WALKTHROUGH_STYLES}
              value={designStyle}
              onChange={setDesignStyle}
            />

            <View style={styles.renderToneBlock}>
              <ChipRow label="Color tone" options={COLOR_MOODS} value={colorTone} onChange={setColorTone} />
              <PalettePreview tone={colorTone} />
            </View>

            {/* The one place free text is read properly.
                This lived on the Style step, where the 3D exporter matched it
                against fourteen words — nine colours plus walnut, oak, minimal
                and luxury — so most of what anyone wrote there did nothing. It
                reaches the image model in full, as the client note in the brief,
                which is why it belongs next to the button that pays for one. */}
            <View style={styles.notesHead}>
              <Text style={styles.fieldLabel}>Anything else? (optional)</Text>
              {/* The field silently stopped accepting characters at 240 with
                  nothing to say it had. */}
              <Text style={styles.notesCount}>{note.length}/240</Text>
            </View>
            <TextInput
              style={styles.notes}
              value={note}
              accessibilityLabel="Notes for this render"
              onChangeText={setNote}
              placeholder="Keep the olive tree · warm evening feel · nothing glossy"
              placeholderTextColor={COLORS.placeholderText}
              multiline
              maxLength={240}
            />

            {/* One line, and only the line that answers "what will I get?". */}
            <View style={styles.sheetNoteRow}>
              <Ionicons name="information-circle-outline" size={15} color={COLORS.textTertiary} />
              <Text style={styles.sheetNoteText}>
                {bird
                  ? "Rendered from above with the roof open, exactly as you see it."
                  : "Rendered from exactly the view you are looking at. Your walls, openings and furniture stay where they are."}
              </Text>
            </View>

            {/* Said before the coin is spent, not discovered afterwards.
                Every Livinai design is briefed as daylight — an evening brief
                is what had the model adding a lit window to a wall that has
                none — so the night toggle moves the 3D lighting and stops
                there. */}
            {night && (
              <View style={styles.sheetNoteRow}>
                <Ionicons name="sunny-outline" size={15} color={COLORS.textTertiary} />
                <Text style={styles.sheetNoteText}>
                  Renders are always lit as daylight, whichever way the Day/Night
                  toggle sits.
                </Text>
              </View>
            )}
          </ScrollView>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              unlimited
                ? "Generate this render"
                : `Generate this render for ${coinLabel(price)}`
            }
            accessibilityState={{ busy: rendering, disabled: rendering }}
            android_ripple={{ color: "rgba(255,255,255,0.20)" }}
            style={({ pressed }) => [
              styles.sheetPrimary,
              rendering && styles.sheetPrimaryBusy,
              pressed && !rendering && styles.pressedSurface,
            ]}
            disabled={rendering}
            onPress={submitRender}
          >
            {rendering
              ? <ActivityIndicator size="small" color={COLORS.white} />
              : <Ionicons name="sparkles" size={18} color={COLORS.white} />}
            <Text style={styles.sheetPrimaryText}>
              {rendering ? "Generating…" : bird ? "Render the floor" : "Render this room"}
            </Text>
            {!rendering && !unlimited && freeRendersLeft === 0 && (
              <View style={styles.sheetPrimaryPrice}>
                <Text style={styles.sheetPrimaryPriceText}>{coinLabel(price)}</Text>
              </View>
            )}
          </Pressable>

          {renderCount > 0 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                renderCount === 1
                  ? "See the 1 render in this plan"
                  : `See all ${renderCount} renders in this plan`
              }
              android_ripple={{ color: "rgba(51,96,74,0.12)" }}
              style={({ pressed }) => [styles.sheetSecondary, pressed && styles.pressedSurface]}
              onPress={onOpenGallery}
            >
              <Ionicons name="images-outline" size={17} color={COLORS.primaryDark} />
              <Text style={styles.sheetSecondaryText}>
                {renderCount === 1 ? "See this plan's 1 render" : `See this plan's ${renderCount} renders`}
              </Text>
            </Pressable>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * The price of the button below it, and the way to afford it.
 *
 * Three states, and never more than one of them at a time: a subscriber is told
 * it is included and offered nothing; an account still inside its free
 * allowance is told how many are left; everyone else sees their balance beside
 * the price, and a way to add to it that does not cost money.
 */
function RenderCostBar({
  price,
  unlimited,
  freeRendersLeft,
  coins,
  affordable,
  adStatus,
  onWatchAd,
  onUpgrade,
}) {
  if (unlimited) {
    return (
      <View style={[styles.costBar, styles.costBarIncluded]} accessibilityRole="text">
        <Ionicons name="checkmark-circle" size={17} color={COLORS.success} />
        <Text style={styles.costBarText} numberOfLines={1}>
          Included with your plan — render as often as you like.
        </Text>
      </View>
    );
  }

  if (freeRendersLeft > 0) {
    return (
      <View style={styles.costBar} accessibilityRole="text">
        <Ionicons name="gift-outline" size={17} color={COLORS.primaryDark} />
        <Text style={styles.costBarText} numberOfLines={1}>
          {freeRendersLeft === 1 ? "1 free render left" : `${freeRendersLeft} free renders left`}
          {" · then "}
          {coinLabel(price)} each
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.costBar, !affordable && styles.costBarShort]}>
      <Ionicons
        name={affordable ? "ellipse-outline" : "alert-circle-outline"}
        size={17}
        color={affordable ? COLORS.primaryDark : COLORS.warning}
      />
      <Text style={styles.costBarText} numberOfLines={1}>
        {coinLabel(price)} per render · you have {coins}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={affordable ? "Watch an ad to earn a coin" : "Get more coins"}
        accessibilityState={{ busy: adStatus === "showing", disabled: adStatus === "showing" }}
        android_ripple={{ color: "rgba(51,96,74,0.16)" }}
        style={({ pressed }) => [styles.costBarAction, pressed && styles.pressedSurface]}
        disabled={adStatus === "showing"}
        onPress={affordable ? onWatchAd : onUpgrade}
      >
        {adStatus === "showing" ? (
          <ActivityIndicator size="small" color={COLORS.primaryDark} />
        ) : (
          <>
            <Ionicons
              name={affordable ? "play" : "add"}
              size={13}
              color={COLORS.primaryDark}
            />
            <Text style={styles.costBarActionText}>{affordable ? "Watch ad" : "Get coins"}</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

/**
 * Every render this plan has made, inside the plan that made them.
 *
 * A render is saved to the account's collection the moment it is generated, and
 * for a long time that was the only place to find one again — a single reverse
 * chronological list of every design across every path, with nothing on a card
 * tying it back to the home it came from. So the pictures produced *by a plan*
 * were unreachable *from* that plan, which is the one place a person looks.
 *
 * Two columns of thumbnails, tapping one opens it over the 3D view, and each
 * carries its own remove — which unfiles it from the plan and leaves the design
 * itself untouched in the collection.
 */
function RenderGallerySheet({ visible, renders, activeId, onClose, onOpen, onRemove, onSave, onRenderMore }) {
  const insets = useSafeAreaInsets();

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, styles.renderSheet, { paddingBottom: Math.max(insets.bottom, SPACING.lg) }]}
          onPress={() => {}}
        >
          <View style={styles.sheetHandle} />

          <View style={styles.sheetHead}>
            <View style={[styles.sheetIcon, styles.sheetIconAccent]}>
              <Ionicons name="images-outline" size={18} color={COLORS.primaryDark} />
            </View>
            <View style={styles.sheetHeadCopy}>
              <Text style={styles.sheetTitle}>Renders in this plan</Text>
              <Text style={styles.sheetSubtitle}>
                {renders.length === 1 ? "1 picture" : `${renders.length} pictures`}
                {" · also in your collection"}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={LAYOUT.hitSlop}
              android_ripple={{ color: "rgba(30,36,31,0.14)", borderless: true }}
              style={({ pressed }) => [styles.sheetCloseIcon, pressed && styles.pressedSurface]}
              onPress={onClose}
            >
              <Ionicons name="close" size={18} color={COLORS.textSecondary} />
            </Pressable>
          </View>

          {renders.length === 0 ? (
            <View style={styles.galleryEmpty}>
              <Ionicons name="sparkles-outline" size={26} color={COLORS.textTertiary} />
              <Text style={styles.galleryEmptyText}>
                Renders you make from this plan are kept here.
              </Text>
            </View>
          ) : (
            <ScrollView
              style={styles.renderBriefScroll}
              contentContainerStyle={styles.galleryGrid}
              showsVerticalScrollIndicator={false}
            >
              {renders.map((entry) => (
                <View key={entry.id} style={styles.galleryCell}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Open the render of ${entry.label}`}
                    accessibilityState={{ selected: entry.id === activeId }}
                    android_ripple={{ color: "rgba(30,36,31,0.10)" }}
                    style={({ pressed }) => [
                      styles.galleryCard,
                      entry.id === activeId && styles.galleryCardActive,
                      pressed && styles.pressedSurface,
                    ]}
                    onPress={() => onOpen(entry.id)}
                  >
                    <Image
                      source={{ uri: entry.image }}
                      style={styles.galleryImage}
                      resizeMode="cover"
                    />
                    <View style={styles.galleryCopy}>
                      <Text style={styles.galleryLabel} numberOfLines={1}>{entry.label}</Text>
                      <Text style={styles.galleryMeta} numberOfLines={1}>
                        {[entry.designStyle, renderDay(entry.createdAt)].filter(Boolean).join(" · ")}
                      </Text>
                    </View>
                  </Pressable>

                  <View style={styles.galleryActions}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Save the render of ${entry.label}`}
                      hitSlop={LAYOUT.hitSlop}
                      android_ripple={{ color: "rgba(51,96,74,0.16)", borderless: true }}
                      style={({ pressed }) => [styles.galleryAction, pressed && styles.pressedSurface]}
                      onPress={() => onSave(entry.image)}
                    >
                      <Ionicons name="download-outline" size={16} color={COLORS.primaryDark} />
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove the render of ${entry.label} from this plan`}
                      hitSlop={LAYOUT.hitSlop}
                      android_ripple={{ color: "rgba(190,58,47,0.16)", borderless: true }}
                      style={({ pressed }) => [styles.galleryAction, pressed && styles.pressedSurface]}
                      onPress={() => onRemove(entry.id)}
                    >
                      <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
                    </Pressable>
                  </View>
                </View>
              ))}
            </ScrollView>
          )}

          <Pressable
            accessibilityRole="button"
            android_ripple={{ color: "rgba(255,255,255,0.20)" }}
            style={({ pressed }) => [styles.sheetPrimary, pressed && styles.pressedSurface]}
            onPress={onRenderMore}
          >
            <Ionicons name="sparkles" size={18} color={COLORS.white} />
            <Text style={styles.sheetPrimaryText}>Render another view</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
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
/**
 * A glyph for a room's kind.
 *
 * Matched on a substring rather than the exact label, so a room typed as
 * "Master Bedroom" or "Guest Bathroom" still gets the right icon, and anything
 * unrecognised falls back to a plain outline rather than to nothing.
 */
const ROOM_ICONS = [
  ["bath", "water-outline"],
  ["bed", "bed-outline"],
  ["kitchen", "restaurant-outline"],
  ["dining", "restaurant-outline"],
  ["living", "tv-outline"],
  ["office", "laptop-outline"],
  ["study", "laptop-outline"],
  ["entry", "enter-outline"],
  ["hall", "walk-outline"],
  ["corridor", "walk-outline"],
  ["laundry", "shirt-outline"],
  ["utility", "construct-outline"],
  ["closet", "file-tray-stacked-outline"],
  ["balcony", "sunny-outline"],
];

function roomIcon(roomType) {
  const key = String(roomType || "").toLowerCase();
  const hit = ROOM_ICONS.find(([word]) => key.includes(word));
  return hit ? hit[1] : "square-outline";
}

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
        const label = room.name || room.roomType || `Room ${index + 1}`;
        return (
          <Pressable
            key={`jump-${index}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            // A tab in a set has to say which set and where in it, or a screen
            // reader announces five identical "tab, selected" controls.
            accessibilityLabel={`${label}, room ${index + 1} of ${rooms.length}`}
            accessibilityHint={active ? undefined : "Walks you into this room"}
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
            {/* The room's own kind, as a glyph.
                Every pill was a word in the same weight and the same colour, so
                finding the bathroom in a seven-room flat meant reading seven
                labels. An icon is read before a word is, and it is the one
                thing about a room that a glyph can say faster. */}
            <Ionicons
              name={roomIcon(room.roomType)}
              size={14}
              color={active ? COLORS.white : COLORS.textTertiary}
            />
            <Text style={[styles.roomPillText, active && styles.roomPillTextActive]} numberOfLines={1}>
              {label}
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
const STICK_BASE = ms(140);
const STICK_KNOB = ms(60);
const STICK_TRAVEL = Math.round((STICK_BASE - STICK_KNOB) / 2);

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
  /**
   * The stick was 116pt across with 34pt of travel, so its whole usable range
   * sat under the pad of the thumb that was also covering it — a control you
   * steer by feel, sized so that feel is the one thing it cannot give you. The
   * base is now 140 with 44pt of travel and a 60pt knob, comfortably past the
   * 44pt minimum target and wide enough to know where centre is without looking.
   */
  const travel = STICK_TRAVEL;
  /** Fades up while the stick is held, so the control says it is listening. */
  const held = useRef(new Animated.Value(0)).current;
  /**
   * The knob moves natively, not through React.
   *
   * It was a `useState` written on every `onPanResponderMove`, so walking meant
   * re-rendering the whole overlay — the room strip, the status chip, the dock —
   * sixty times a second, on the one screen already holding a live WebGL
   * context. Two `Animated.Value`s write the transform straight to the view and
   * React never hears about the drag at all.
   */
  const knobX = useRef(new Animated.Value(0)).current;
  const knobY = useRef(new Animated.Value(0)).current;
  const latest = useRef(onChange);
  latest.current = onChange;

  const responder = useMemo(
    () => {
      /**
       * Under this the stick reads as held, not pushed.
       *
       * There was no dead zone, so a thumb resting on the knob crept the camera
       * across the room, and the smallest deliberate nudge jumped straight to a
       * real walking speed. Past the threshold the remaining travel is
       * re-scaled from zero, so the first millimetre of push is a slow step
       * rather than an instant lurch to 14%.
       */
      const deadZone = 0.14;

      const setHeld = (value) => {
        Animated.timing(held, { toValue: value, duration: MOTION.fast, useNativeDriver: true }).start();
      };
      const release = () => {
        Animated.spring(knobX, { toValue: 0, useNativeDriver: true, ...MOTION.spring }).start();
        Animated.spring(knobY, { toValue: 0, useNativeDriver: true, ...MOTION.spring }).start();
        setHeld(0);
        latest.current(0, 0);
      };
      const apply = (dx, dy) => {
        const distance = Math.hypot(dx, dy) || 1;
        const reach = Math.min(distance, travel);
        const x = (dx / distance) * reach;
        const y = (dy / distance) * reach;
        knobX.setValue(x);
        knobY.setValue(y);
        const magnitude = reach / travel;
        if (magnitude < deadZone) {
          latest.current(0, 0);
          return;
        }
        const scaled = (magnitude - deadZone) / (1 - deadZone);
        // Gentle at the start of the throw and linear by the end of it. A
        // straight ramp made the usable half of the travel — creeping up to a
        // chair, easing round a doorway — the first few millimetres of it.
        const shaped = scaled * (0.45 + 0.55 * scaled);
        latest.current((x / reach) * shaped, (y / reach) * shaped);
      };
      return PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // The stick keeps the gesture once it has it, so a fast drag cannot be
        // claimed halfway through by the view underneath and turn a walk into a
        // look.
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          setHeld(1);
          apply(0, 0);
        },
        onPanResponderMove: (_, gesture) => apply(gesture.dx, gesture.dy),
        onPanResponderRelease: release,
        onPanResponderTerminate: release,
      });
    },
    [held, knobX, knobY, travel],
  );

  // A finger lifted outside the stick, or a mode change mid-gesture, would
  // otherwise leave the camera walking forward forever.
  useEffect(() => () => latest.current(0, 0), []);

  return (
    <View
      style={styles.stickBase}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Movement stick"
      accessibilityHint="Hold and drag to walk. Push further to walk faster."
      {...responder.panHandlers}
    >
      <Animated.View style={[styles.stickRing, { opacity: held }]} pointerEvents="none" />
      <Ionicons name="chevron-up" size={14} color={COLORS.textTertiary} style={styles.stickUp} />
      <Ionicons name="chevron-down" size={14} color={COLORS.textTertiary} style={styles.stickDown} />
      <Ionicons name="chevron-back" size={14} color={COLORS.textTertiary} style={styles.stickLeft} />
      <Ionicons name="chevron-forward" size={14} color={COLORS.textTertiary} style={styles.stickRight} />
      <Animated.View
        style={[styles.stickKnob, { transform: [{ translateX: knobX }, { translateY: knobY }] }]}
        pointerEvents="none"
      >
        <Ionicons name="walk" size={24} color={COLORS.white} />
      </Animated.View>
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
        {/* Two bare number fields with an "m" beside them: a screen reader read
            them out as "edit box, 4.20" twice with nothing to tell them apart. */}
        <View style={styles.roomSizeField}>
          <TextInput
            style={styles.roomSizeInput}
            keyboardType="decimal-pad"
            accessibilityLabel={`${label} width in metres`}
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
            accessibilityLabel={`${label} depth in metres`}
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
 * There is no preset cage here: the steppers and the typed value set anything
 * from a 0.3 m slot to an opening that takes almost the whole wall, and the type
 * chip above only decides the section — a head height and a sill — not a width.
 *
 * The one real limit is the wall, and it is now stated. Widening simply stopped
 * at some number the user could not see, which reads as a broken stepper rather
 * than as a fact about the plan; the cap is shown next to the label and the +
 * button disables when it is reached.
 */
function OpeningWidthControl({ widthMeters, maxMeters, onChange }) {
  const [draft, setDraft] = useState(null);
  const shown = draft ?? widthMeters.toFixed(2);
  const ceiling = Number.isFinite(maxMeters) ? maxMeters : Infinity;
  const atMax = widthMeters >= ceiling - 0.005;
  const clamp = (value) => Math.min(ceiling, Math.max(OPENING_MIN_METERS, value));
  const step = (delta) => {
    setDraft(null);
    onChange(clamp(Math.round((widthMeters + delta) * 100) / 100));
  };
  const commit = () => {
    if (draft === null) return;
    const value = Number.parseFloat(draft);
    setDraft(null);
    if (!Number.isFinite(value) || Math.abs(value - widthMeters) < 0.005) return;
    onChange(clamp(value));
  };
  return (
    <View style={styles.openingWidth}>
      <View style={styles.openingWidthHead}>
        <Text style={styles.fieldLabel}>Width</Text>
        {Number.isFinite(maxMeters) && (
          <Text style={styles.openingWidthMax}>{`this wall takes ${maxMeters.toFixed(2)} m`}</Text>
        )}
      </View>
      <View style={styles.openingWidthRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Narrow this opening by 10 centimetres"
          accessibilityState={{ disabled: widthMeters <= OPENING_MIN_METERS }}
          android_ripple={{ color: "rgba(30,36,31,0.12)" }}
          style={({ pressed }) => [
            styles.openingWidthStep,
            widthMeters <= OPENING_MIN_METERS && styles.openingWidthStepDisabled,
            pressed && styles.pressedSurface,
          ]}
          disabled={widthMeters <= OPENING_MIN_METERS}
          onPress={() => step(-0.1)}
        >
          <Ionicons name="remove" size={16} color={COLORS.textPrimary} />
        </Pressable>
        <View style={styles.openingWidthField}>
          <TextInput
            style={styles.openingWidthInput}
            keyboardType="decimal-pad"
            accessibilityLabel="Opening width in metres"
            value={String(shown)}
            selectTextOnFocus
            onChangeText={setDraft}
            onBlur={commit}
            onSubmitEditing={commit}
          />
          <Text style={styles.openingWidthUnit}>m</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Widen this opening by 10 centimetres"
          accessibilityState={{ disabled: atMax }}
          android_ripple={{ color: "rgba(30,36,31,0.12)" }}
          style={({ pressed }) => [
            styles.openingWidthStep,
            atMax && styles.openingWidthStepDisabled,
            pressed && styles.pressedSurface,
          ]}
          disabled={atMax}
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
              accessibilityRole="tab"
              accessibilityLabel={`${label} walls`}
              accessibilityState={{ selected: edgeType === value }}
              android_ripple={{ color: "rgba(30,36,31,0.10)" }}
              style={({ pressed }) => [
                styles.curveSegment,
                edgeType === value && styles.curveSegmentActive,
                pressed && edgeType !== value && styles.pressedSurface,
              ]}
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
              {[[-1, "Left"], [1, "Right"]].map(([value, label]) => (
                <Pressable
                  key={label}
                  accessibilityRole="radio"
                  accessibilityLabel={`Curve ${label.toLowerCase()}`}
                  accessibilityState={{ checked: settings.direction === value, selected: settings.direction === value }}
                  android_ripple={{ color: "rgba(30,36,31,0.10)" }}
                  style={({ pressed }) => [
                    styles.curveDirectionButton,
                    settings.direction === value && styles.curveDirectionButtonActive,
                    pressed && settings.direction !== value && styles.pressedSurface,
                  ]}
                  onPress={() => update("direction", value)}
                >
                  <Text style={[styles.curveDirectionText, settings.direction === value && styles.curveDirectionTextActive]}>
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          <CurveStepper label="Curve strength" value={settings.intensity} min={0} max={100} step={5} suffix="%" onChange={(value) => update("intensity", value)} />
          <CurveStepper label="Bend position" value={settings.position} min={15} max={85} step={5} suffix="%" onChange={(value) => update("position", value)} />
          <CurveStepper label="Curve tilt" value={settings.angle} min={-55} max={55} step={5} suffix="°" onChange={(value) => update("angle", value)} />
          {curveStaged ? (
            <View style={styles.curveApplyRow}>
              <Pressable
                accessibilityRole="button"
                android_ripple={{ color: "rgba(30,36,31,0.10)" }}
                style={({ pressed }) => [styles.curveCancel, pressed && styles.pressedSurface]}
                onPress={onCancelCurve}
              >
                <Text style={styles.curveCancelText}>Cancel curve</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                android_ripple={{ color: "rgba(255,255,255,0.20)" }}
                style={({ pressed }) => [styles.curveApply, pressed && styles.pressedSurface]}
                onPress={onApplyCurve}
              >
                <Ionicons name="add" size={15} color={COLORS.white} />
                <Text style={styles.curveApplyText}>Add curved wall</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.curveReset, pressed && styles.pressedSurface]}
              onPress={() => onChangeSettings({ ...DEFAULT_CURVE_SETTINGS })}
            >
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${label.toLowerCase()}`}
          accessibilityState={{ disabled: value <= min }}
          android_ripple={{ color: "rgba(30,36,31,0.12)", borderless: true }}
          style={({ pressed }) => [styles.curveStepButton, pressed && value > min && styles.pressedSurface]}
          disabled={value <= min}
          onPress={() => onChange(Math.max(min, value - step))}
        >
          <Ionicons name="remove" size={15} color={value <= min ? COLORS.textTertiary : COLORS.textPrimary} />
        </Pressable>
        <Text style={styles.curveStepValue} accessibilityLabel={`${label}, ${value}${suffix}`}>{value}{suffix}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Increase ${label.toLowerCase()}`}
          accessibilityState={{ disabled: value >= max }}
          android_ripple={{ color: "rgba(30,36,31,0.12)", borderless: true }}
          style={({ pressed }) => [styles.curveStepButton, pressed && value < max && styles.pressedSurface]}
          disabled={value >= max}
          onPress={() => onChange(Math.min(max, value + step))}
        >
          <Ionicons name="add" size={15} color={value >= max ? COLORS.textTertiary : COLORS.textPrimary} />
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
function PlanLibrary({ projects, loading, synced, signedIn, onBack, onRefresh, onStart, onOpen, onMore }) {
  return (
    <View style={styles.libraryScreen}>
      <SafeAreaView edges={["top"]} style={styles.libraryHeader}>
          <View style={styles.headerRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              onPress={onBack}
              hitSlop={LAYOUT.hitSlop}
              android_ripple={{ color: "rgba(30,36,31,0.10)", borderless: true }}
              style={({ pressed }) => [styles.headerButton, pressed && styles.headerButtonPressed]}
            >
              <Ionicons name="chevron-back" size={20} color={COLORS.textPrimary} />
            </Pressable>
            <View style={styles.headerCopy}>
              <Text style={styles.headerTitle} numberOfLines={1}>3D Walkthrough</Text>
              <Text style={styles.headerEyebrow}>Your saved plans</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Refresh your saved plans"
              accessibilityState={{ busy: loading, disabled: loading }}
              android_ripple={{ color: "rgba(30,36,31,0.10)", borderless: true }}
              style={({ pressed }) => [styles.headerButton, pressed && styles.headerButtonPressed]}
              onPress={onRefresh}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator size="small" color={COLORS.primaryDark} />
                : <Ionicons name="refresh-outline" size={18} color={COLORS.textPrimary} />}
            </Pressable>
          </View>

          <LinearGradient
            colors={[COLORS.surface, COLORS.brand100]}
            start={{ x: 0.08, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.libraryHero}
          >
            <View style={styles.flowHeroOrb} />
            <View style={styles.flowHeroMeta}>
              <LinearGradient colors={COLORS.gradientBrandDeep} style={styles.flowHeroMark}>
                <Ionicons name="cube-outline" size={18} color={COLORS.white} />
              </LinearGradient>
              <Text style={styles.libraryHeroEyebrow}>YOUR 3D WORKSPACE</Text>
            </View>
            <Text style={styles.flowHeroTitle}>Bring your floor plan to life</Text>
            <Text style={styles.flowHeroCopy}>
              Draw, furnish, and explore every room in one guided flow.
            </Text>

          {/* The size of the list, and where it lives, on one line at the foot
              of the bar. The count used to be a third line inside the title
              block — which pushed the title off its own optical centre — and
              where plans are stored was a separate grey note pinned under the
              last card, so the two facts about the list as a whole sat at
              opposite ends of the screen. */}
          {!!projects.length && (
            <View style={styles.libraryHeaderMeta}>
              <Text style={styles.headerMeta}>
                {projects.length === 1 ? "1 plan" : `${projects.length} plans`}
              </Text>
              <View style={styles.libraryHeaderDot} />
              <Ionicons
                name={synced ? "cloud-done-outline" : signedIn ? "cloud-offline-outline" : "phone-portrait-outline"}
                size={13}
                color={COLORS.textSecondary}
              />
              <Text style={styles.headerMeta} numberOfLines={1}>
                {synced ? "Saved to your account" : signedIn ? "Saved on this device" : "On this device only"}
              </Text>
            </View>
          )}
          </LinearGradient>
        </SafeAreaView>

      <ScrollView
        contentContainerStyle={styles.libraryBody}
        showsVerticalScrollIndicator={false}
      >
        {loading && !projects.length ? (
          // Three placeholder rows in the shape of the real thing, rather than a
          // spinner on an empty screen. The list stops changing height when the
          // plans arrive, and the wait reads as "loading a list", not "broken".
          <View style={styles.librarySkeleton} accessibilityLabel="Loading your plans">
            {[0, 1, 2].map((row) => (
              <View key={row} style={styles.skeletonCard}>
                <View style={styles.skeletonTile} />
                {/* Three bars for the row's three lines, so the list does not
                    change height when the real plans arrive. */}
                <View style={styles.skeletonCopy}>
                  <View style={[styles.skeletonLine, { width: "58%" }]} />
                  <View style={[styles.skeletonLine, styles.skeletonLineSmall, { width: "40%" }]} />
                  <View style={[styles.skeletonLine, styles.skeletonLineSmall, { width: "28%" }]} />
                </View>
              </View>
            ))}
          </View>
        ) : projects.length ? (
          projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onOpen={() => onOpen(project)}
              onMore={() => onMore(project)}
            />
          ))
        ) : (
          // An invitation, not an apology, and with the action in it. The dock at
          // the foot of the screen carries the same action, but a person reading
          // "draw your home to scale" should not have to look elsewhere to start.
          <View style={styles.libraryEmpty}>
            <View style={styles.libraryEmptyIcon}>
              <Ionicons name="home-outline" size={28} color={COLORS.primaryDark} />
            </View>
            <Text style={styles.libraryEmptyTitle}>Draw your first home</Text>
            <Text style={styles.libraryEmptyText}>
              Trace a floor plan or draw it to scale, walk through it in 3D, then render it with AI.
            </Text>
            <Pressable
              accessibilityRole="button"
              android_ripple={{ color: "rgba(255,255,255,0.20)" }}
              style={({ pressed }) => [styles.libraryEmptyAction, pressed && styles.pressedSurface]}
              onPress={onStart}
            >
              <Ionicons name="add" size={18} color={COLORS.white} />
              <Text style={styles.libraryEmptyActionText}>Start a plan</Text>
            </Pressable>
          </View>
        )}

        {/* Only worth a card of its own when there is something to act on. The
            header carries the storage state for the two cases where nothing is
            wrong; this is the one where signing in would actually help. */}
        {!!projects.length && !signedIn && (
          <View style={styles.syncNote}>
            <Ionicons name="phone-portrait-outline" size={15} color={COLORS.warning} />
            <Text style={styles.syncNoteText}>
              These plans live on this phone only. Sign in to keep them on your account.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* One primary action, docked, always reachable however long the list is.
          Hidden only when the empty state is showing, because that already
          carries the same button and two of them on one screen is one too many.
          It stays up while the list loads — waiting for plans is no reason to
          lose the way to start a new one. */}
      {(!!projects.length || loading) && (
        <SafeAreaView edges={["bottom"]} style={styles.libraryFooter}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start a new 3D plan"
            accessibilityHint="Opens an empty grid to draw your home on"
            android_ripple={{ color: "rgba(255,255,255,0.20)" }}
            style={({ pressed }) => [styles.libraryPrimary, pressed && styles.pressedSurface]}
            onPress={onStart}
          >
            <Ionicons name="add" size={19} color={COLORS.white} />
            <Text style={styles.libraryPrimaryText}>New plan</Text>
          </Pressable>
        </SafeAreaView>
      )}
    </View>
  );
}

/**
 * How long ago a plan was touched, in the words a person would use.
 *
 * A recents list answers "which one was I working on?", and a locale date
 * string makes that a subtraction problem. "Yesterday" does not.
 */
function relativeDay(value) {
  const then = value ? new Date(value) : null;
  if (!then || Number.isNaN(then.valueOf())) return null;
  const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).valueOf();
  const days = Math.round((startOfDay(new Date()) - startOfDay(then)) / 86_400_000);
  if (days <= 0) return "Edited today";
  if (days === 1) return "Edited yesterday";
  if (days < 7) return `Edited ${days} days ago`;
  if (days < 14) return "Edited last week";
  // Past a fortnight the exact day stops being the useful fact, so fall back to
  // the calendar rather than counting out "27 days ago".
  return `Edited ${then.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}

/**
 * One saved plan.
 *
 * A plan is a drawing, so the drawing is the biggest thing on the card. It used
 * to be a 58pt square — too small to recognise a floor plan in — sitting beside
 * three stacked lines of grey text and, on the right, two coloured icon buttons
 * *per row*, one of which deletes an evening's work. A list of six plans was
 * therefore a list of twelve buttons, half of them destructive, competing with
 * the six that actually open something.
 *
 * Now: a wide preview, the name, and the two facts about a plan that are worth
 * comparing across rows, as pills rather than a run-on grey string. Rename and
 * delete moved behind the one control that means "more about this row", where
 * neither can be hit by mistake on the way to opening a plan.
 */
function ProjectCard({ project, onOpen, onMore }) {
  const edited = relativeDay(project.updatedAt);
  const rooms = `${project.roomCount || 0} ${project.roomCount === 1 ? "room" : "rooms"}`;
  const area = project.areaMeters ? `${Number(project.areaMeters).toFixed(1)} m²` : null;
  const openings = project.openingCount
    ? `${project.openingCount} ${project.openingCount === 1 ? "opening" : "openings"}`
    : null;
  const traced = project.source === "upload";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        `${project.title}, ${[rooms, area, openings].filter(Boolean).join(", ")}`
        + `, ${traced ? "traced from a photo" : "drawn"}${edited ? `, ${edited.toLowerCase()}` : ""}`
      }
      accessibilityHint="Opens this plan in the editor"
      android_ripple={{ color: "rgba(30,36,31,0.08)" }}
      style={({ pressed }) => [styles.projectCard, pressed && styles.projectCardPressed]}
      onPress={onOpen}
    >
      {/* How big the home is, in the leading tile.
          This was a generic grid glyph, which meant every drawn plan opened its
          row with the same picture — a leading element that took the eye first
          and then told it nothing. Floor area is the one number that is
          comparable between plans and the one people describe a home by, so it
          takes the position instead, and the glyph stays for a plan too new to
          have been measured. */}
      <View style={styles.projectTile}>
        {area ? (
          <>
            <Text style={styles.projectTileValue}>{Math.round(project.areaMeters)}</Text>
            <Text style={styles.projectTileUnit}>m²</Text>
          </>
        ) : (
          <Ionicons
            name={traced ? "image-outline" : "grid-outline"}
            size={22}
            color={COLORS.primaryDark}
          />
        )}
      </View>

      {/* Three lines, in the order the questions get asked: which plan, how big
          is it, and how recently did I touch it. The measurements used to be
          three tinted chips — three boxes of equal weight for three short facts,
          none of them more important than the others, so the emphasis went
          nowhere and the row read as busier than it is. */}
      <View style={styles.projectCardCopy}>
        <Text style={styles.projectCardTitle} numberOfLines={1}>{project.title}</Text>
        <Text style={styles.projectCardMeta} numberOfLines={1}>
          {[rooms, openings].filter(Boolean).join("  ·  ")}
        </Text>
        <Text style={styles.projectCardTime} numberOfLines={1}>
          {[traced ? "Traced" : "Drawn", edited].filter(Boolean).join("  ·  ")}
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`More options for ${project.title}`}
        hitSlop={LAYOUT.hitSlop}
        android_ripple={{ color: "rgba(30,36,31,0.14)", borderless: true }}
        style={({ pressed }) => [styles.projectAction, pressed && styles.pressedSurface]}
        onPress={onMore}
      >
        <Ionicons name="ellipsis-horizontal" size={18} color={COLORS.textSecondary} />
      </Pressable>
    </Pressable>
  );
}

/** Rename or delete one plan, asked away from the row that opens it. */
function PlanActionSheet({ project, onClose, onRename, onDelete }) {
  return (
    <Modal transparent visible={!!project} animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.sheetHandle} />
          <Text style={styles.actionSheetTitle} numberOfLines={1}>{project?.title || "This plan"}</Text>

          <Pressable
            accessibilityRole="button"
            android_ripple={{ color: "rgba(30,36,31,0.08)" }}
            style={({ pressed }) => [styles.actionSheetRow, pressed && styles.pressedSurface]}
            onPress={onRename}
          >
            <Ionicons name="create-outline" size={20} color={COLORS.textPrimary} />
            <Text style={styles.actionSheetRowText}>Rename</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            android_ripple={{ color: "rgba(190,58,47,0.12)" }}
            style={({ pressed }) => [styles.actionSheetRow, pressed && styles.pressedSurface]}
            onPress={onDelete}
          >
            <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
            <Text style={[styles.actionSheetRowText, styles.actionSheetRowDanger]}>Delete</Text>
          </Pressable>

          <Pressable style={styles.sheetClose} onPress={onClose}>
            <Text style={styles.sheetCloseText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
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
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: detecting }}
          android_ripple={{ color: "rgba(51,96,74,0.14)" }}
          style={({ pressed }) => [styles.sourceBarButton, pressed && styles.pressedSurface]}
          onPress={onUpload}
          disabled={detecting}
          hitSlop={LAYOUT.hitSlop}
        >
          <Text style={styles.sourceBarButtonText}>{planImage ? "Replace" : "Trace a photo"}</Text>
        </Pressable>
        {!!planImage && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Remove the uploaded plan"
            onPress={onClear}
            hitSlop={LAYOUT.hitSlop}
            android_ripple={{ color: "rgba(30,36,31,0.14)", borderless: true }}
            style={({ pressed }) => [styles.sourceBarClear, pressed && styles.pressedSurface]}
          >
            <Ionicons name="close" size={17} color={COLORS.textSecondary} />
          </Pressable>
        )}
      </View>
      {/* Announced, not just coloured: this is the only place the plan reader
          can report that it could not measure the photo. */}
      {!!error && (
        <Text style={styles.sourceBarError} accessibilityRole="alert" accessibilityLiveRegion="polite">
          {error}
        </Text>
      )}
    </View>
  );
}

/**
 * The drawing tools, in two labelled groups.
 *
 * Eight equal cells in one undifferentiated grid gave a person looking for "how
 * do I add a window" nothing to narrow the search with — every control had the
 * same weight and the same shape, so the row had to be read end to end. Naming
 * the two things the tools do splits that search in half before it starts.
 *
 * Snapping left the grid entirely. It is a mode, not a tool: it does not arm the
 * canvas, it changes what every other tool does, and drawn as a ninth tile it
 * competed with the one tool that was actually selected. A labelled switch says
 * "on or off" without having to be interpreted.
 */
/**
 * The drawing tools, on one line.
 *
 * They were two labelled groups stacked vertically — four tools, a heading, a
 * second heading, three tools — which cost two headings and a row of vertical
 * space above a canvas that is the whole point of the step, and put "Door" on a
 * different line from "Box" as though they were different kinds of thing. They
 * are all one kind of thing: what the next tap on the sheet will do.
 *
 * One horizontally scrolling row instead. Seven cells at 78pt overflow every
 * phone, so the row is visibly cut at the edge, which is what tells you it
 * scrolls — no hint text required. The selected tool is scrolled into view when
 * it changes, so arming a door from the canvas never leaves the lit tool
 * offscreen.
 *
 * The opening tools still lock until a room exists, but the lock is now on the
 * cell rather than announced by a heading: a padlock on the icon, and the one
 * line of explanation appears under the row only while it applies.
 */
function ToolPalette({ tool, onChange, snapToGrid, onToggleSnap, hasRooms }) {
  const scroller = useRef(null);
  const offsets = useRef([]);

  useEffect(() => {
    const x = offsets.current[TOOLS.findIndex((item) => item.key === tool)];
    if (typeof x !== "number") return;
    scroller.current?.scrollTo({ x: Math.max(0, x - ms(78)), animated: true });
  }, [tool]);

  const openingLocked = !hasRooms;

  return (
    <View style={styles.palette}>
      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.paletteStrip}
        contentContainerStyle={styles.paletteStripContent}
        accessibilityRole="radiogroup"
      >
        {TOOLS.map((item, index) => {
          // A door has to go into a wall, and until a room is drawn there are no
          // walls. Arming one of these on an empty sheet used to leave the canvas
          // silently inert: every tap landed on nothing and the tool stayed lit,
          // which reads as a broken app rather than as a step out of order.
          const locked = OPENING_TOOLS.has(item.key) && openingLocked;
          const active = tool === item.key;
          return (
            <Pressable
              key={item.key}
              accessibilityRole="radio"
              accessibilityLabel={locked ? `${item.label}, draw a room first` : item.label}
              accessibilityState={{ selected: active, checked: active, disabled: locked }}
              disabled={locked}
              onLayout={(event) => { offsets.current[index] = event.nativeEvent.layout.x; }}
              style={({ pressed }) => [pressed && !active && styles.pressedSurface]}
              onPress={() => onChange(item.key)}
            >
              <View style={[styles.tool, active && styles.toolActive, locked && styles.toolLocked]}>
                <Ionicons
                  name={locked ? "lock-closed-outline" : item.icon}
                  size={19}
                  color={active ? COLORS.primaryDark : locked ? COLORS.textTertiary : COLORS.textSecondary}
                />
                <Text
                  style={[
                    styles.toolLabel,
                    active && styles.toolLabelActive,
                    locked && styles.toolLabelLocked,
                  ]}
                  numberOfLines={1}
                >
                  {item.label}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      {openingLocked && (
        <Text style={styles.paletteLocked}>
          Doors, windows and balconies go into a wall — draw a room first.
        </Text>
      )}

      <Pressable
        accessibilityRole="switch"
        accessibilityLabel="Snap to the grid"
        accessibilityState={{ checked: snapToGrid }}
        android_ripple={{ color: "rgba(30,36,31,0.08)" }}
        style={({ pressed }) => [styles.snapRow, pressed && styles.pressedSurface]}
        onPress={onToggleSnap}
      >
        <Ionicons
          name={snapToGrid ? "magnet" : "magnet-outline"}
          size={18}
          color={snapToGrid ? COLORS.primaryDark : COLORS.textTertiary}
        />
        <View style={styles.snapCopy}>
          <Text style={styles.snapTitle}>Snap to the grid</Text>
          <Text style={styles.snapText} numberOfLines={1}>Corners land on the nearest grid line.</Text>
        </View>
        <View style={[styles.switchTrack, snapToGrid && styles.switchTrackOn]}>
          <View style={[styles.switchKnob, snapToGrid && styles.switchKnobOn]} />
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
      style={({ pressed }) => [
        styles.actionCell,
        active && styles.actionActive,
        disabled && styles.actionDisabled,
        pressed && !disabled && styles.pressedSurface,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <Ionicons name={icon} size={16} color={color} />
      <Text style={[styles.actionLabel, { color }]} numberOfLines={1}>{label}</Text>
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
            <Pressable
              accessibilityRole="button"
              android_ripple={{ color: "rgba(30,36,31,0.10)" }}
              style={({ pressed }) => [styles.dialogButton, styles.dialogCancel, pressed && styles.pressedSurface]}
              onPress={onCancel}
            >
              <Text style={styles.dialogCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !!confirmDisabled }}
              android_ripple={{ color: "rgba(255,255,255,0.20)" }}
              style={({ pressed }) => [
                styles.dialogButton,
                styles.dialogConfirm,
                confirmDisabled && styles.dialogConfirmDisabled,
                pressed && !confirmDisabled && styles.pressedSurface,
              ]}
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

/**
 * One labelled row of mutually exclusive options.
 *
 * Some of these rows are long — there are more room types than fit on a phone —
 * and the chosen one was frequently scrolled off the right, so a card could show
 * a "Room type" row with nothing selected in it. The row now brings the current
 * answer into view, and each chip is a tab rather than an unlabelled button.
 */
function ChipRow({ label, options, value, onChange, formatOption = (option) => option }) {
  const scroller = useRef(null);
  const offsets = useRef([]);
  const index = options.indexOf(value);

  useEffect(() => {
    const x = offsets.current[index];
    if (typeof x !== "number") return;
    scroller.current?.scrollTo({ x: Math.max(0, x - ms(56)), animated: true });
  }, [index]);

  return (
    <View style={styles.chipBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
        accessibilityRole="tablist"
        accessibilityLabel={label}
      >
        {options.map((option, optionIndex) => {
          const active = value === option;
          return (
            <Pressable
              key={option}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              android_ripple={{ color: "rgba(30,36,31,0.10)" }}
              onLayout={(event) => { offsets.current[optionIndex] = event.nativeEvent.layout.x; }}
              style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && !active && styles.pressedSurface]}
              onPress={() => onChange(option)}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{formatOption(option)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/**
 * The 60/30/10 scheme behind the chosen colour mood.
 *
 * Same derivation the Interior path shows on its tone picker, so a mood means
 * the same three colours wherever it is chosen.
 */
function PalettePreview({ tone }) {
  const palette = useMemo(() => paletteForTone(tone), [tone]);
  if (!palette) return null;
  const swatches = [palette.dominant, palette.secondary, palette.accent];
  return (
    <View style={styles.palettePreview} accessibilityLabel={
      `${tone}: ${swatches.map((swatch) => `${swatch.share} per cent ${swatch.name}`).join(", ")}`
    }>
      {swatches.map((swatch) => (
        <View key={swatch.role} style={styles.paletteSwatchCell}>
          <View style={[styles.paletteSwatch, { backgroundColor: swatch.hex }]} />
          <Text style={styles.paletteShare}>{swatch.share}%</Text>
          <Text style={styles.paletteName} numberOfLines={1}>{swatch.name}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * A step that cannot be done yet.
 *
 * It used to be an icon and a sentence telling the person to go back — an
 * instruction with no way to follow it, on the one screen where they are most
 * obviously stuck. The way back is now a button.
 */
function EmptyState({ text, actionLabel, onAction }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name="grid-outline" size={24} color={COLORS.primaryDark} />
      </View>
      <Text style={styles.emptyText}>{text}</Text>
      {!!onAction && (
        <Pressable
          accessibilityRole="button"
          android_ripple={{ color: "rgba(255,255,255,0.20)" }}
          style={({ pressed }) => [styles.emptyAction, pressed && styles.pressedSurface]}
          onPress={onAction}
        >
          <Ionicons name="arrow-back" size={15} color={COLORS.white} />
          <Text style={styles.emptyActionText}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

function SnapshotModal({ snapshot, kind, busy, onClose, onShare, onSaveGallery, onSaveCollection }) {
  const isRender = kind === "ai";
  return (
    <Modal transparent visible={!!snapshot} animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.sheetHandle} />

          <View style={styles.sheetHead}>
            <View style={[styles.sheetIcon, isRender && styles.sheetIconAccent]}>
              <Ionicons
                name={isRender ? "sparkles" : "camera-outline"}
                size={18}
                color={COLORS.primaryDark}
              />
            </View>
            <View style={styles.sheetHeadCopy}>
              <Text style={styles.sheetTitle}>{isRender ? "Your AI render" : "Save this view"}</Text>
              {isRender && <Text style={styles.sheetSubtitle}>Already in your collection</Text>}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={LAYOUT.hitSlop}
              android_ripple={{ color: "rgba(30,36,31,0.14)", borderless: true }}
              style={({ pressed }) => [styles.sheetCloseIcon, pressed && styles.pressedSurface]}
              onPress={onClose}
            >
              <Ionicons name="close" size={18} color={COLORS.textSecondary} />
            </Pressable>
          </View>

          {/* The preview is the point of the sheet, so it waits for the file
              rather than showing an empty grey box that looks like a failure. */}
          {!!snapshot && <SheetPreview uri={snapshot} />}

          <View style={styles.sheetActions}>
            {!isRender && <SheetAction icon="albums-outline" label="Collection" onPress={onSaveCollection} loading={busy === "save"} />}
            <SheetAction icon="download-outline" label="Gallery" onPress={onSaveGallery} />
            <SheetAction icon="share-social-outline" label="Share" onPress={onShare} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** The captured frame or finished render, with its own loading state. */
function SheetPreview({ uri }) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => setLoaded(false), [uri]);
  return (
    <View style={styles.sheetPreview}>
      <Image
        key={uri}
        source={{ uri }}
        style={styles.sheetImage}
        resizeMode="cover"
        onLoad={() => setLoaded(true)}
      />
      {!loaded && (
        <View style={styles.sheetPreviewState}>
          <ActivityIndicator color={COLORS.primaryDark} />
        </View>
      )}
    </View>
  );
}

function SheetAction({ icon, label, onPress, loading }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: !!loading, disabled: !!loading }}
      android_ripple={{ color: "rgba(51,96,74,0.14)" }}
      style={({ pressed }) => [styles.sheetAction, pressed && styles.pressedSurface]}
      onPress={onPress}
      disabled={loading}
    >
      {loading ? <ActivityIndicator size="small" color={COLORS.primaryDark} /> : <Ionicons name={icon} size={19} color={COLORS.primaryDark} />}
      <Text style={styles.sheetActionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },

  // ── Header, shared by the library and the editor ─────────────────────────
  // One bar in two places, so moving between the library and the editor is not
  // also a change of visual language. The icon buttons were 42pt squares filled
  // at 16% white — under the touch minimum, and so low-contrast against a deep
  // gradient that they read as embossing rather than as buttons.
  editorHeaderSurface: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.brand200,
  },
  header: {
    paddingHorizontal: SPACING.base,
    paddingBottom: 0,
    backgroundColor: "transparent",
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingTop: SPACING.sm },
  headerButton: {
    width: ms(44), height: ms(44), borderRadius: RADIUS.md,
    alignItems: "center", justifyContent: "center",
    backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.border,
  },
  headerButtonPressed: { backgroundColor: COLORS.surfaceSunken },
  headerButtonSaved: { backgroundColor: COLORS.successSoft, borderColor: COLORS.successSoft },
  headerCopy: { flex: 1, minWidth: 0, gap: 1 },
  headerEyebrow: { ...TYPE.caption, color: COLORS.textTertiary },
  stageBar: {
    marginHorizontal: -SPACING.base,
    paddingHorizontal: SPACING.base,
    paddingTop: SPACING.base,
    paddingBottom: SPACING.md,
  },
  stageBarRow: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  stageBarMark: {
    width: ms(32), height: ms(32), borderRadius: RADIUS.sm,
    alignItems: "center", justifyContent: "center",
  },
  stageBarCopy: { flex: 1, minWidth: 0 },
  stageBarMeta: { ...TYPE.overline, fontSize: 8.5, lineHeight: ms(12), color: COLORS.primaryDark },
  stageBarTitle: { ...TYPE.small, fontFamily: TYPE.bodyStrong.fontFamily, color: COLORS.textPrimary },
  stepper: { flexDirection: "row", alignItems: "center", gap: SPACING.xs, marginTop: SPACING.sm },
  step: {
    flex: 1, height: 3, borderRadius: RADIUS.pill,
    backgroundColor: COLORS.brand200,
  },
  stepReached: { backgroundColor: COLORS.brand500 },
  stepActive: { backgroundColor: COLORS.primaryDark },
  stepPressed: { opacity: 0.7 },
  flowHero: {
    marginTop: SPACING.md,
    padding: SPACING.base,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.brand200,
    overflow: "hidden",
  },
  flowHeroOrb: {
    position: "absolute",
    width: ms(150), height: ms(150), borderRadius: RADIUS.pill,
    top: ms(-80), right: ms(-58), backgroundColor: "rgba(255,255,255,0.48)",
  },
  flowHeroMeta: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  flowHeroMark: {
    width: ms(36), height: ms(36), borderRadius: RADIUS.md,
    alignItems: "center", justifyContent: "center", ...SHADOW.xs,
  },
  headerTitleRow: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  headerTitle: { ...TYPE.h3, color: COLORS.textPrimary, flexShrink: 1 },
  headerMeta: { ...TYPE.caption, color: COLORS.textSecondary },
  flowHeroTitle: { ...TYPE.h3, color: COLORS.textPrimary, marginTop: SPACING.md },
  flowHeroCopy: { ...TYPE.caption, color: COLORS.textSecondary, marginTop: 2, lineHeight: ms(17) },

  // ── Library ──────────────────────────────────────────────────────────────
  libraryScreen: { flex: 1, backgroundColor: COLORS.background },
  libraryHeader: {
    paddingHorizontal: SPACING.base,
    paddingBottom: SPACING.sm,
    backgroundColor: COLORS.background,
  },
  libraryHero: {
    marginTop: SPACING.md,
    padding: SPACING.base,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.brand200,
    overflow: "hidden",
  },
  libraryHeroEyebrow: { ...TYPE.overline, fontSize: 9, color: COLORS.primaryDark },
  libraryHeaderMeta: {
    flexDirection: "row", alignItems: "center", gap: SPACING.sm,
    marginTop: SPACING.md, paddingTop: SPACING.md,
    borderTopWidth: 1, borderTopColor: COLORS.brand200,
  },
  libraryHeaderDot: {
    width: 3, height: 3, borderRadius: 2, backgroundColor: COLORS.brand400,
  },
  libraryBody: { padding: SPACING.base, paddingTop: SPACING.sm, paddingBottom: SPACING.xl, gap: SPACING.md },
  // Same docked-bar treatment as the editor's step footer, so the one primary
  // action sits on the same layer wherever you are in the walkthrough.
  libraryFooter: {
    paddingHorizontal: SPACING.base, paddingTop: SPACING.xs, paddingBottom: SPACING.sm,
    backgroundColor: COLORS.background,
    alignItems: "flex-end",
  },
  /**
   * The one thing this screen is for.
   *
   * It was a 46pt bar with its label set in `TYPE.caption` — the 11.5pt medium
   * used elsewhere for pill text and metadata. So the single most important
   * control on the screen was typographically a caption, and shorter than the
   * rows it sat under. It is now the height and weight of a primary action, and
   * it carries the brand shadow, which is the app's one signal for "this is the
   * button".
   */
  libraryPrimary: {
    minWidth: ms(132), height: ms(46), borderRadius: RADIUS.md,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SPACING.sm,
    paddingHorizontal: SPACING.lg, backgroundColor: COLORS.primaryDark,
  },
  libraryPrimaryText: { ...TYPE.bodyStrong, fontSize: 15, color: COLORS.white },

  syncNote: {
    flexDirection: "row", alignItems: "flex-start", gap: SPACING.sm,
    padding: SPACING.md, borderRadius: RADIUS.md,
    backgroundColor: COLORS.warningSoft,
  },
  syncNoteText: { flex: 1, ...TYPE.caption, color: COLORS.warning, lineHeight: 16 },
  // Placeholder rows in the shape of a ProjectCard, so the list does not jump
  // when the real plans replace them.
  librarySkeleton: { gap: SPACING.md },
  skeletonCard: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md,
    padding: SPACING.md, minHeight: ms(85),
    borderRadius: RADIUS.lg, backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.border,
  },
  skeletonTile: {
    width: ms(52), height: ms(52), borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceSunken,
  },
  skeletonCopy: { flex: 1, gap: SPACING.xs + 2 },
  skeletonLine: { height: ms(12), borderRadius: RADIUS.xs, backgroundColor: COLORS.surfaceSunken },
  skeletonLineSmall: { height: ms(9) },

  libraryEmpty: {
    alignItems: "center", padding: SPACING.xl, gap: SPACING.md,
    borderRadius: RADIUS.lg, backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.border,
  },
  libraryEmptyIcon: {
    width: ms(60), height: ms(60), borderRadius: RADIUS.lg,
    alignItems: "center", justifyContent: "center", backgroundColor: COLORS.primaryTint,
  },
  libraryEmptyTitle: { ...TYPE.h3, color: COLORS.textPrimary },
  libraryEmptyText: { ...TYPE.small, color: COLORS.textSecondary, textAlign: "center", lineHeight: 19 },
  libraryEmptyAction: {
    marginTop: SPACING.xs, flexDirection: "row", alignItems: "center", gap: SPACING.sm,
    height: ms(48), paddingHorizontal: SPACING.xl,
    borderRadius: RADIUS.md, backgroundColor: COLORS.primaryDark,
  },
  libraryEmptyActionText: { ...TYPE.bodyStrong, color: COLORS.white },

  // A row, not a poster. Everything on it is text or a glyph, so a list of forty
  // plans costs nothing to paint and four of them fit on a phone screen at once
  // instead of one and a half.
  projectCard: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md,
    padding: SPACING.md, paddingRight: SPACING.sm,
    borderRadius: RADIUS.lg, backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.border,
  },
  projectCardPressed: { borderColor: COLORS.brand300, backgroundColor: COLORS.primaryTint },
  // The hairline is what makes this read as a tile rather than a tinted patch:
  // primaryTint is pale enough on the card's own white that without an edge it
  // dissolves into it.
  projectTile: {
    width: ms(52), height: ms(52), borderRadius: RADIUS.md,
    alignItems: "center", justifyContent: "center",
    backgroundColor: COLORS.primaryTint,
    borderWidth: 1, borderColor: COLORS.primarySoft,
  },
  // Tabular figures so a column of areas lines up on its digits rather than
  // wandering with the width of a 1.
  projectTileValue: {
    ...TYPE.bodyStrong, fontSize: ms(17), lineHeight: ms(20),
    color: COLORS.primaryDark, fontVariant: ["tabular-nums"],
  },
  projectTileUnit: { ...TYPE.caption, fontSize: 9.5, lineHeight: 12, color: COLORS.brand400 },
  projectCardCopy: { flex: 1, minWidth: 0, gap: 3 },
  projectCardTitle: { ...TYPE.h3, color: COLORS.textPrimary },
  projectCardMeta: { ...TYPE.caption, color: COLORS.textSecondary },
  projectCardTime: { ...TYPE.caption, fontSize: 10.5, color: COLORS.textTertiary },
  projectAction: {
    width: ms(40), height: ms(40), borderRadius: RADIUS.pill,
    alignItems: "center", justifyContent: "center",
  },

  // ── "More" sheet for one plan ────────────────────────────────────────────
  actionSheetTitle: {
    ...TYPE.caption, color: COLORS.textTertiary,
    textAlign: "center", marginBottom: SPACING.md,
  },
  actionSheetRow: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md,
    height: ms(56), paddingHorizontal: SPACING.base,
    borderRadius: RADIUS.md, backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.border,
    marginBottom: SPACING.sm,
  },
  actionSheetRowText: { ...TYPE.bodyStrong, color: COLORS.textPrimary },
  actionSheetRowDanger: { color: COLORS.danger },

  // ── Editor body ──────────────────────────────────────────────────────────
  // One gutter for the whole flow, so the canvas, the controls under it and the
  // walkthrough overlay on the last step all line up with each other.
  body: { paddingHorizontal: SPACING.base, paddingTop: SPACING.sm, paddingBottom: SPACING.xxxl },

  // Padded on all four sides. It used to set a horizontal padding and a
  // `minHeight` and nothing else, so its row sat pinned to the top of a taller
  // box with the dead space underneath, and the error line — the one thing on
  // this bar that has to be read — ran flush into the bottom border.
  sourceBar: {
    marginBottom: SPACING.md,
    paddingHorizontal: SPACING.sm, paddingVertical: SPACING.sm,
    justifyContent: "center",
    borderRadius: RADIUS.md, backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.borderSubtle,
  },
  sourceBarRow: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  sourceBarTitle: { flex: 1, minWidth: 0, ...TYPE.caption, color: COLORS.textPrimary },
  sourceBarButton: {
    paddingHorizontal: SPACING.md, height: ms(36), justifyContent: "center",
    borderRadius: RADIUS.sm, backgroundColor: COLORS.primaryTint,
  },
  sourceBarButtonText: { ...TYPE.caption, color: COLORS.primaryDark },
  // The same 36pt square the rest of the flow gives an icon-only control. It
  // was a bare 18pt glyph with no surface, sitting next to a filled button —
  // half the size of every other target on the step, and the one that throws
  // away an uploaded plan.
  sourceBarClear: {
    width: ms(36), height: ms(36), borderRadius: RADIUS.sm,
    alignItems: "center", justifyContent: "center", backgroundColor: COLORS.surfaceSunken,
  },
  sourceBarError: {
    ...TYPE.caption, color: COLORS.danger, lineHeight: 17,
    marginTop: SPACING.sm, paddingTop: SPACING.sm,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },

  palette: {
    marginBottom: SPACING.md,
  },
  // Says why the row below it is grey, on the row itself. A disabled control
  // that does not explain itself is indistinguishable from a broken one.
  // One four-column grid, not one grid per group.
  //
  // Every cell used to be `flex: 1` within its own row, so the three wall tools
  // stretched to fill the width the four shape tools shared — a third wider
  // each, with none of the seven buttons lining up with the one above it. Two
  // rows of the same kind of control at two different sizes reads as a layout
  // fault before it reads as a grouping. A fixed quarter-width cell keeps the
  // columns true and leaves the short row short, which is what says "there are
  // three of these" without saying it.
  // Full-bleed, so the row is cut by the screen edge rather than by the card's
  // padding — which is what makes it read as "there is more this way".
  paletteStrip: { marginHorizontal: -SPACING.base, flexGrow: 0 },
  paletteStripContent: {
    paddingHorizontal: SPACING.base, gap: SPACING.sm, alignItems: "center",
  },
  paletteLocked: {
    ...TYPE.caption, fontSize: 10.5, color: COLORS.textTertiary,
    marginTop: SPACING.sm,
  },
  // A fixed width now that the cells sit in a scroller rather than a 25% grid.
  // 78 fits "Balcony" without truncating and puts roughly four and a half cells
  // on a 390pt screen, so the row is always visibly cut.
  tool: {
    width: ms(78), height: ms(54), alignItems: "center", justifyContent: "center", gap: 3,
    borderRadius: RADIUS.md, backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.borderSubtle,
  },
  toolActive: { backgroundColor: COLORS.primaryTint, borderColor: COLORS.brand300 },
  toolLocked: { backgroundColor: COLORS.surfaceAlt, opacity: 0.6 },
  toolLabel: { ...TYPE.caption, fontSize: 10, color: COLORS.textSecondary },
  toolLabelActive: { color: COLORS.primaryDark },
  toolLabelLocked: { color: COLORS.textTertiary },

  // Two lines of copy in a 42pt box with no vertical padding put the second
  // line against the border on a small phone.
  snapRow: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md,
    marginTop: SPACING.sm,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, minHeight: ms(48),
    borderRadius: RADIUS.md, backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.borderSubtle,
  },
  snapCopy: { flex: 1, minWidth: 0 },
  snapTitle: { ...TYPE.caption, color: COLORS.textPrimary },
  snapText: { ...TYPE.caption, fontSize: 10.5, color: COLORS.textTertiary, marginTop: 1 },

  canvasCard: {
    borderRadius: RADIUS.lg, overflow: "hidden", backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.border,
  },
  canvasHint: {
    flexDirection: "row", alignItems: "flex-start", gap: SPACING.sm,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    backgroundColor: COLORS.primaryTint,
    borderBottomWidth: 1, borderBottomColor: COLORS.primarySoft,
  },
  // The hint wraps, so the icon is top-aligned with the block — and nudged down
  // to sit on the optical centre of the first line rather than above its cap
  // height, which is where a 14pt glyph next to 11.5/17 text lands by default.
  canvasHintIcon: { marginTop: 1.5 },
  canvasHintText: { flex: 1, ...TYPE.caption, color: COLORS.textSecondary, lineHeight: 17 },
  canvasHintTool: { color: COLORS.primaryDark },

  drawingBar: {
    flexDirection: "row", alignItems: "center", gap: SPACING.sm,
    marginTop: SPACING.sm, padding: SPACING.sm, paddingLeft: SPACING.md,
    borderRadius: RADIUS.md, backgroundColor: COLORS.primaryTint,
    borderWidth: 1, borderColor: COLORS.primarySoft,
  },
  // 15pt of leading on 11.5pt type over two lines clipped descenders on
  // Android. The caption ramp's own 16 is the floor, and this text is the only
  // thing telling someone how to finish the room they are drawing.
  drawingBarText: { flex: 1, ...TYPE.caption, color: COLORS.textSecondary, lineHeight: ms(16) },
  // "Finish" and "discard" 8pt apart at 32pt each: the two most consequential
  // buttons on the Draw step were also the smallest.
  drawingBarGhost: {
    width: ms(40), height: ms(40), borderRadius: RADIUS.pill,
    alignItems: "center", justifyContent: "center", backgroundColor: COLORS.surface,
  },
  drawingBarPrimary: {
    paddingHorizontal: SPACING.lg, height: ms(40), alignItems: "center", justifyContent: "center",
    borderRadius: RADIUS.pill, backgroundColor: COLORS.primaryDark,
  },
  drawingBarPrimaryDisabled: { opacity: 0.4 },
  drawingBarPrimaryText: { ...TYPE.caption, color: COLORS.white },

  // The card the selected shape lives in: its name row, and — for an opening —
  // its settings, inside one border instead of two.
  selectionCard: {
    marginTop: SPACING.sm, borderRadius: RADIUS.md,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  selectionBar: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md,
    padding: SPACING.sm, paddingHorizontal: SPACING.md,
  },
  selectionName: { flex: 1, ...TYPE.bodyStrong, color: COLORS.textPrimary },
  selectionAction: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: SPACING.base, minHeight: ms(40),
    borderRadius: RADIUS.pill, backgroundColor: COLORS.dangerSoft,
  },
  selectionActionText: { ...TYPE.caption, color: COLORS.danger },
  openingEditor: {
    paddingHorizontal: SPACING.md, paddingBottom: SPACING.md,
    borderTopWidth: 1, borderTopColor: COLORS.borderSubtle,
  },



  summaryBar: {
    flexDirection: "row", alignItems: "center", gap: SPACING.sm,
    marginBottom: SPACING.sm, paddingHorizontal: SPACING.xs, minHeight: ms(36),
  },
  summaryBarText: { flex: 1, ...TYPE.caption, color: COLORS.primaryDark },

  planSummary: {
    flexDirection: "row", alignItems: "center", gap: SPACING.sm,
    marginTop: SPACING.sm, paddingHorizontal: SPACING.xs, minHeight: ms(36),
  },
  planSummaryText: { flex: 1, ...TYPE.caption, color: COLORS.primaryDark },

  card: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.md,
    marginTop: SPACING.sm, borderWidth: 1, borderColor: COLORS.borderSubtle,
  },
  cardFirst: { marginTop: 0 },
  cardSectionHead: {
    flexDirection: "row", alignItems: "center", gap: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  cardSectionIcon: {
    width: ms(30), height: ms(30), borderRadius: RADIUS.sm,
    alignItems: "center", justifyContent: "center", backgroundColor: COLORS.primaryTint,
  },
  cardSectionTitle: { ...TYPE.bodyStrong, color: COLORS.textPrimary },

  palettePreview: {
    flexDirection: "row", gap: SPACING.sm, marginTop: SPACING.md,
    paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.borderSubtle,
  },
  paletteSwatchCell: { flex: 1, minWidth: 0, alignItems: "center", gap: 4 },
  paletteSwatch: {
    width: "100%", height: ms(34), borderRadius: RADIUS.xs,
    borderWidth: 1, borderColor: COLORS.borderSubtle,
  },
  paletteShare: { ...TYPE.caption, fontSize: 11, color: COLORS.textPrimary },
  paletteName: { ...TYPE.caption, fontSize: 10, color: COLORS.textTertiary },
  roomIndexLabel: { flex: 1, minWidth: 0, ...TYPE.overline, color: COLORS.textTertiary },
  roomCardHead: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md,
    marginBottom: SPACING.sm,
  },
  roomSwatch: { width: ms(10), height: ms(28), borderRadius: RADIUS.xs },
  roomNameField: {
    flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: SPACING.sm,
    minHeight: ms(44), paddingHorizontal: SPACING.md, borderRadius: RADIUS.sm,
    backgroundColor: COLORS.surfaceAlt, borderWidth: 1, borderColor: COLORS.border,
  },
  roomName: { flex: 1, minWidth: 0, ...TYPE.bodyStrong, color: COLORS.textPrimary, paddingVertical: 0 },
  roomDelete: {
    width: ms(40), height: ms(40), borderRadius: RADIUS.md,
    alignItems: "center", justifyContent: "center",
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
    paddingHorizontal: SPACING.sm, height: ms(40), borderRadius: RADIUS.sm,
    backgroundColor: COLORS.surfaceSunken, borderWidth: 1, borderColor: COLORS.border,
  },
  roomSizeInput: { width: ms(42), ...TYPE.caption, color: COLORS.textPrimary, textAlign: "right", padding: 0 },
  roomSizeUnit: { ...TYPE.caption, color: COLORS.textTertiary },
  roomSizeTimes: { ...TYPE.caption, color: COLORS.textTertiary },
  roomSizeArea: { minWidth: ms(54), ...TYPE.caption, color: COLORS.textSecondary, textAlign: "right" },

  openingWidth: { marginTop: SPACING.sm },
  openingWidthHead: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: SPACING.sm,
  },
  openingWidthMax: { ...TYPE.caption, fontSize: 10.5, color: COLORS.textTertiary, marginBottom: SPACING.sm },
  openingWidthRow: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, marginTop: 5 },
  openingWidthStep: {
    width: ms(44), height: ms(44), alignItems: "center", justifyContent: "center",
    borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceSunken,
    borderWidth: 1, borderColor: COLORS.border,
  },
  openingWidthStepDisabled: { opacity: 0.4 },
  openingWidthField: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3,
    paddingHorizontal: SPACING.md, height: ms(44), borderRadius: RADIUS.md,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.borderStrong,
  },
  openingWidthInput: { width: ms(54), ...TYPE.bodyStrong, color: COLORS.textPrimary, textAlign: "right", padding: 0 },
  openingWidthUnit: { ...TYPE.caption, color: COLORS.textTertiary },

  chipBlock: { marginTop: SPACING.sm },
  fieldLabel: { ...TYPE.overline, color: COLORS.textTertiary, marginBottom: SPACING.sm },
  chipRow: { gap: SPACING.sm, paddingRight: SPACING.base },
  // 32pt tall was under the touch minimum for controls sitting 8pt apart in a
  // scrolling row — the easiest place in the flow to pick the wrong answer.
  chip: {
    minHeight: ms(40), justifyContent: "center",
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceAlt, borderWidth: 1, borderColor: COLORS.borderSubtle,
  },
  chipActive: { backgroundColor: COLORS.primaryTint, borderColor: COLORS.brand300 },
  chipText: { ...TYPE.caption, color: COLORS.textSecondary },
  chipTextActive: { color: COLORS.primaryDark },

  disclosure: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginTop: SPACING.md, paddingHorizontal: SPACING.base, height: ms(48),
    borderRadius: RADIUS.md, backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.borderSubtle,
  },
  disclosureText: { ...TYPE.bodyStrong, color: COLORS.primaryDark },

  settingToggle: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md, marginTop: SPACING.lg,
    padding: SPACING.md, borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceSunken, borderWidth: 1, borderColor: COLORS.border,
  },
  settingToggleCopy: { flex: 1, minWidth: 0 },
  settingToggleTitle: { ...TYPE.bodyStrong, color: COLORS.textPrimary },
  settingToggleText: { ...TYPE.caption, color: COLORS.textTertiary, marginTop: 2, lineHeight: 16 },
  switchTrack: {
    width: ms(46), height: ms(28), borderRadius: RADIUS.pill, padding: 3,
    justifyContent: "center", alignItems: "flex-start",
    backgroundColor: COLORS.surfaceSunken,
    borderWidth: 1, borderColor: COLORS.border,
  },
  switchTrackOn: { backgroundColor: COLORS.primaryDark, borderColor: COLORS.primaryDark },
  switchKnob: {
    width: ms(20), height: ms(20), borderRadius: RADIUS.pill,
    backgroundColor: COLORS.white, ...SHADOW.xs,
  },
  switchKnobOn: { alignSelf: "flex-end" },

  notesHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  notesCount: { ...TYPE.caption, fontSize: 10.5, color: COLORS.textTertiary, marginBottom: SPACING.sm },
  notes: {
    minHeight: ms(92), borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceSunken,
    padding: SPACING.md, ...TYPE.small, color: COLORS.textPrimary, textAlignVertical: "top",
  },

  empty: {
    alignItems: "center", gap: SPACING.md, paddingVertical: SPACING.xxl,
    paddingHorizontal: SPACING.lg, borderRadius: RADIUS.lg,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  emptyIcon: {
    width: ms(52), height: ms(52), borderRadius: RADIUS.lg,
    alignItems: "center", justifyContent: "center", backgroundColor: COLORS.primaryTint,
  },
  emptyText: { ...TYPE.small, color: COLORS.textSecondary, textAlign: "center" },
  emptyAction: {
    flexDirection: "row", alignItems: "center", gap: SPACING.sm,
    height: ms(44), paddingHorizontal: SPACING.lg,
    borderRadius: RADIUS.pill, backgroundColor: COLORS.primaryDark,
  },
  emptyActionText: { ...TYPE.bodyStrong, color: COLORS.white },

  // ── Curved-wall controls ─────────────────────────────────────────────────
  curveCard: {
    marginBottom: SPACING.md, padding: SPACING.md, borderRadius: RADIUS.lg,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  curveHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: SPACING.md },
  curveTitle: { ...TYPE.bodyStrong, color: COLORS.textPrimary },
  curveCopy: { ...TYPE.caption, color: COLORS.textTertiary, lineHeight: 17 },
  curveSegmented: { flexDirection: "row", padding: 3, borderRadius: RADIUS.pill, backgroundColor: COLORS.surfaceSunken },
  curveSegment: {
    minWidth: ms(78), minHeight: ms(40), alignItems: "center", justifyContent: "center",
    paddingHorizontal: SPACING.md, borderRadius: RADIUS.pill,
  },
  curveSegmentActive: { backgroundColor: COLORS.primaryDark },
  curveSegmentText: { ...TYPE.caption, color: COLORS.textSecondary },
  curveSegmentTextActive: { color: COLORS.white },
  curveSettings: {
    marginTop: SPACING.md, gap: SPACING.sm,
    borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: SPACING.md,
  },
  curveDirection: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: SPACING.md },
  curveDirectionButtons: { flexDirection: "row", gap: 4 },
  curveDirectionButton: {
    minHeight: ms(38), justifyContent: "center",
    paddingHorizontal: SPACING.base, borderRadius: RADIUS.pill, backgroundColor: COLORS.surfaceSunken,
  },
  curveDirectionButtonActive: { backgroundColor: COLORS.primaryTint },
  curveDirectionText: { ...TYPE.caption, color: COLORS.textSecondary },
  curveDirectionTextActive: { color: COLORS.primaryDark },
  curveSettingLabel: { ...TYPE.caption, color: COLORS.textSecondary },
  curveStepper: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: ms(34) },
  curveStepperActions: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  curveStepButton: { width: ms(38), height: ms(38), alignItems: "center", justifyContent: "center", borderRadius: RADIUS.pill, backgroundColor: COLORS.surfaceSunken },
  curveStepValue: { minWidth: ms(46), ...TYPE.caption, color: COLORS.textPrimary, textAlign: "center" },
  curveReset: {
    flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 5,
    minHeight: ms(38), paddingHorizontal: SPACING.xs,
  },
  curveResetText: { ...TYPE.caption, color: COLORS.primaryDark },
  curveApplyRow: { flexDirection: "row", gap: SPACING.sm, marginTop: 2 },
  curveCancel: {
    paddingHorizontal: SPACING.base, height: ms(44), alignItems: "center", justifyContent: "center",
    borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceSunken,
  },
  curveCancelText: { ...TYPE.caption, color: COLORS.textSecondary },
  curveApply: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
    height: ms(44), borderRadius: RADIUS.md, backgroundColor: COLORS.primaryDark,
  },
  curveApplyText: { ...TYPE.caption, color: COLORS.white },

  // ── Footer ───────────────────────────────────────────────────────────────
  // A docked action bar, so it has to read as a layer above the step rather than
  // as the last row of it: the surface lifts off the page with a shadow thrown
  // upwards, and the hairline is there for the case where the shadow cannot be
  // seen (Android's `elevation` casts downwards only).
  footer: {
    paddingHorizontal: SPACING.base,
    paddingTop: SPACING.xs, paddingBottom: SPACING.sm,
    backgroundColor: COLORS.background,
  },
  footerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: SPACING.sm },

  /**
   * Secondary, not outlined.
   *
   * An outlined button beside a filled one at equal width is the pairing that
   * reads as a mistake: two different button *languages* on one row, arguing
   * about which is the real one. A tonal fill keeps the two in the same family
   * and still puts the whole of the row's weight on Continue, which is the
   * hierarchy the step actually has.
   */
  footerGhost: {
    paddingHorizontal: SPACING.xs,
    backgroundColor: "transparent",
  },
  footerGhostText: { ...TYPE.caption, color: COLORS.primaryDark },
  footerPrimary: {
    minWidth: ms(132), paddingHorizontal: SPACING.lg,
    backgroundColor: COLORS.primaryDark,
  },
  /**
   * Disabled, and still readable.
   *
   * This was white on `COLORS.disabled` — a pale warm grey — which is about
   * 1.6:1. A disabled control is exempt from WCAG contrast, but a label nobody
   * can read is not a design decision, and this is the one button in the flow
   * people meet while they are still working out what the step wants from them.
   */
  footerPrimaryDisabled: { backgroundColor: COLORS.surfaceSunken, ...SHADOW.none },
  footerPrimaryText: { ...TYPE.bodyStrong, fontSize: 15, color: COLORS.white },
  footerPrimaryTextDisabled: { color: COLORS.textTertiary },

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
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  stateIconBrand: {
    width: ms(60), height: ms(60), borderRadius: RADIUS.lg,
    alignItems: "center", justifyContent: "center",
    backgroundColor: COLORS.primaryTint,
  },
  stateIconDanger: {
    width: ms(60), height: ms(60), borderRadius: RADIUS.lg,
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
    borderRadius: RADIUS.lg, backgroundColor: COLORS.primaryDark,
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

  // One row, one height. Back, the view switcher and the light toggle were 48,
  // 48 and 40 tall with three different shadow weights, so a row of three
  // related controls read as three unrelated ones.
  // Back, the switcher, the light toggle — one row, one height. The two buttons
  // hold their size (`flexShrink: 0`) and the switcher takes everything else, so
  // the control the step is for is never the one that gets squeezed.
  viewControls: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  viewerBack: {
    flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 1,
    height: ms(46), paddingLeft: SPACING.xs + 2, paddingRight: SPACING.md,
    borderRadius: RADIUS.lg, backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.borderSubtle, ...SHADOW.sm,
  },
  viewerBackText: { ...TYPE.caption, color: COLORS.textPrimary },
  lightToggle: {
    flexShrink: 0, flexDirection: "row", alignItems: "center", gap: SPACING.xs + 1,
    height: ms(46), paddingHorizontal: SPACING.sm + 2,
    borderRadius: RADIUS.lg, backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.borderSubtle, ...SHADOW.sm,
  },
  // Near-black, not brand green. The one control in the app that is literally
  // about light has to be legible as light or dark before it is legible as
  // Livinai.
  lightToggleNight: { backgroundColor: COLORS.surfaceInverse, borderColor: COLORS.surfaceInverse },
  lightToggleText: { ...TYPE.caption, color: COLORS.textPrimary },
  lightToggleTextNight: { color: COLORS.white },
  segmented: {
    flex: 1, minWidth: 0, flexDirection: "row", padding: 4,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.borderSubtle, ...SHADOW.sm,
  },
  // 36 + the 4pt of track padding above and below matches the 46pt of the two
  // buttons either side of it.
  segment: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, height: ms(36), borderRadius: RADIUS.md,
  },
  segmentActive: { backgroundColor: COLORS.primaryDark },
  segmentPressed: { backgroundColor: COLORS.surfaceSunken },
  segmentText: { ...TYPE.caption, color: COLORS.textSecondary },
  segmentTextActive: { color: COLORS.white },

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
    flexDirection: "row", alignItems: "center", gap: SPACING.xs,
    justifyContent: "center", height: ms(40), maxWidth: ms(180),
    paddingHorizontal: SPACING.md, borderRadius: RADIUS.md,
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
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    padding: SPACING.base, gap: SPACING.md, ...SHADOW.lg,
  },
  panelHead: { flexDirection: "row", alignItems: "center", gap: SPACING.md },
  panelIcon: {
    width: ms(42), height: ms(42), borderRadius: RADIUS.md,
    alignItems: "center", justifyContent: "center", backgroundColor: COLORS.primaryTint,
  },
  panelHeadCopy: { flex: 1, minWidth: 0 },
  panelEyebrow: { ...TYPE.overline, color: COLORS.textTertiary },
  panelTitle: { ...TYPE.h3, color: COLORS.textPrimary, textTransform: "capitalize" },
  panelClose: {
    width: ms(38), height: ms(38), borderRadius: RADIUS.pill,
    alignItems: "center", justifyContent: "center", backgroundColor: COLORS.surfaceSunken,
  },
  panelMeta: { ...TYPE.caption, color: COLORS.primaryDark, marginTop: -SPACING.sm },
  panelBody: { ...TYPE.small, color: COLORS.textSecondary, marginTop: -SPACING.sm },

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
    height: ms(44), borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceSunken,
  },
  panelGhostText: { ...TYPE.caption, color: COLORS.textSecondary },

  // ── AI result ────────────────────────────────────────────────────────────
  // The app's sunken surface, not black. A near-black slab under an image that
  // has not arrived yet reads as a render that produced nothing.
  aiLayer: { ...StyleSheet.absoluteFillObject, backgroundColor: COLORS.surfaceAlt },
  aiLayerState: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center", justifyContent: "center",
    gap: SPACING.md, paddingHorizontal: SPACING.xxl,
    backgroundColor: COLORS.surfaceAlt,
  },
  aiLayerStateText: { ...TYPE.small, color: COLORS.textSecondary, textAlign: "center" },
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
  // Bottom left, not bottom right. Looking around is a drag anywhere on the
  // room, so putting the stick under the same thumb meant one hand doing both
  // jobs and neither of them well. On the left it belongs to the left thumb and
  // the right one is free to look, which is how every phone app that asks for
  // both has laid this out for fifteen years.
  stickBase: {
    alignSelf: "flex-start", width: STICK_BASE, height: STICK_BASE, borderRadius: RADIUS.pill,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.80)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.9)", ...SHADOW.md,
  },
  stickRing: {
    ...StyleSheet.absoluteFillObject, borderRadius: RADIUS.pill,
    borderWidth: 2, borderColor: COLORS.primaryDark, backgroundColor: "rgba(255,255,255,0.14)",
  },
  stickKnob: {
    width: STICK_KNOB, height: STICK_KNOB, borderRadius: RADIUS.pill,
    alignItems: "center", justifyContent: "center",
    backgroundColor: COLORS.primaryDark, ...SHADOW.sm,
  },
  stickUp: { position: "absolute", top: ms(9) },
  stickDown: { position: "absolute", bottom: ms(9) },
  stickLeft: { position: "absolute", left: ms(9) },
  stickRight: { position: "absolute", right: ms(9) },

  // ── Dock ─────────────────────────────────────────────────────────────────
  // A bare row again: the chip and the pill each carry their own surface and
  // shadow, so the dock floats over the room instead of laying a white panel
  // across the bottom of it.
  dock: {
    flexDirection: "row", alignItems: "center", gap: SPACING.xs,
    justifyContent: "flex-end",
  },
  statusChip: {
    flex: 1, minWidth: 0, height: ms(44),
    flexDirection: "row", alignItems: "center", gap: SPACING.sm,
    paddingHorizontal: SPACING.xs,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.success },
  statusText: { flex: 1, ...TYPE.caption, color: COLORS.white },
  dockPrimary: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SPACING.sm,
    height: ms(42), paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.sm, backgroundColor: COLORS.primaryDark,
  },
  dockPrimaryActive: { backgroundColor: COLORS.brand800 },
  dockPrimaryText: { ...TYPE.bodyStrong, color: COLORS.white },
  // The way back into this plan's finished pictures. Same height as the primary
  // beside it, on the app's surface rather than its brand fill, so the two read
  // as "look at what you have" and "make another" rather than as two primaries.
  dockSecondary: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SPACING.xs,
    height: ms(42), minWidth: ms(52), paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.sm, backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.border,
  },
  dockSecondaryActive: { backgroundColor: COLORS.primaryTint, borderColor: COLORS.brand300 },
  dockSecondaryText: { ...TYPE.bodyStrong, color: COLORS.primaryDark },

  // ── Sheets ───────────────────────────────────────────────────────────────
  // One shape for everything that slides up in this flow — the render brief, the
  // snapshot actions, a plan's rename/delete. They used to be three different
  // objects with three different paddings, three title sizes and three ideas of
  // what a close control looks like.
  sheetBackdrop: { flex: 1, backgroundColor: COLORS.scrim, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: RADIUS.xxl, borderTopRightRadius: RADIUS.xxl,
    paddingHorizontal: SPACING.lg, paddingTop: SPACING.base, paddingBottom: SPACING.xxl,
  },
  renderSheet: { maxHeight: "92%" },
  renderBriefScroll: { flexShrink: 1, marginHorizontal: -SPACING.xs },
  renderBriefContent: { paddingHorizontal: SPACING.xs, paddingBottom: SPACING.xs, gap: SPACING.base },
  sheetHandle: { width: 44, height: 4, borderRadius: 2, backgroundColor: COLORS.borderStrong, alignSelf: "center", marginBottom: SPACING.lg },
  sheetHead: { flexDirection: "row", alignItems: "center", gap: SPACING.md, marginBottom: SPACING.lg },
  sheetIcon: {
    width: ms(44), height: ms(44), borderRadius: RADIUS.md,
    alignItems: "center", justifyContent: "center", backgroundColor: COLORS.primaryTint,
  },
  sheetIconAccent: { backgroundColor: COLORS.primaryTint },
  sheetHeadCopy: { flex: 1, minWidth: 0 },
  sheetTitle: { ...TYPE.h3, color: COLORS.textPrimary },
  sheetSubtitle: { ...TYPE.caption, color: COLORS.textTertiary, marginTop: 2 },
  sheetCloseIcon: {
    width: ms(36), height: ms(36), borderRadius: RADIUS.pill,
    alignItems: "center", justifyContent: "center", backgroundColor: COLORS.surfaceSunken,
  },
  // ── What a render costs ──────────────────────────────────────────────────
  // One line above the brief, in the app's own tinted-card language: an icon,
  // the price in plain words, and — only when there is something to do about
  // it — one action on the right.
  costBar: {
    flexDirection: "row", alignItems: "center", gap: SPACING.sm,
    minHeight: ms(48), paddingLeft: SPACING.md, paddingRight: SPACING.xs,
    marginBottom: SPACING.base, borderRadius: RADIUS.md,
    backgroundColor: COLORS.primaryTint,
    borderWidth: 1, borderColor: COLORS.primarySoft,
  },
  costBarIncluded: { backgroundColor: COLORS.successSoft, borderColor: COLORS.successSoft },
  costBarShort: { backgroundColor: COLORS.warningSoft, borderColor: COLORS.warningSoft },
  costBarText: { flex: 1, minWidth: 0, ...TYPE.caption, color: COLORS.textPrimary },
  costBarAction: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
    height: ms(36), minWidth: ms(84), paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.sm, backgroundColor: COLORS.surface,
  },
  costBarActionText: { ...TYPE.caption, color: COLORS.primaryDark },

  // ── This plan's renders ──────────────────────────────────────────────────
  // The scroll it lives in already pulls 4pt out on each side (see
  // `renderBriefScroll`, so a chip row can bleed to the edge), and the cell's
  // own 4pt of padding puts it back — so the cards land exactly on the sheet's
  // gutter, in line with the title above them.
  galleryGrid: {
    flexDirection: "row", flexWrap: "wrap",
    paddingBottom: SPACING.base,
  },
  galleryCell: { width: "50%", paddingHorizontal: SPACING.xs, paddingBottom: SPACING.md },
  galleryCard: {
    borderRadius: RADIUS.md, overflow: "hidden", backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.borderSubtle,
  },
  galleryCardActive: { borderColor: COLORS.brand500, borderWidth: 2 },
  galleryImage: { width: "100%", height: ms(104), backgroundColor: COLORS.surfaceSunken },
  galleryCopy: { paddingHorizontal: SPACING.sm, paddingVertical: SPACING.sm, gap: 1 },
  galleryLabel: { ...TYPE.caption, color: COLORS.textPrimary },
  galleryMeta: { ...TYPE.caption, fontSize: 10.5, color: COLORS.textTertiary },
  galleryActions: {
    flexDirection: "row", justifyContent: "flex-end", gap: SPACING.xs, marginTop: SPACING.xs,
  },
  galleryAction: {
    width: ms(36), height: ms(36), borderRadius: RADIUS.sm,
    alignItems: "center", justifyContent: "center", backgroundColor: COLORS.surfaceSunken,
  },
  galleryEmpty: {
    alignItems: "center", justifyContent: "center", gap: SPACING.sm,
    paddingVertical: SPACING.xxl, paddingHorizontal: SPACING.lg,
  },
  galleryEmptyText: { ...TYPE.small, color: COLORS.textSecondary, textAlign: "center" },

  renderScopeBlock: { gap: SPACING.xs },
  renderScopeValue: {
    minHeight: ms(48), flexDirection: "row", alignItems: "center", gap: SPACING.sm,
    paddingHorizontal: SPACING.base, borderRadius: RADIUS.md,
    backgroundColor: COLORS.primaryTint, borderWidth: 1, borderColor: COLORS.primarySoft,
  },
  renderScopeText: { flex: 1, ...TYPE.bodyStrong, color: COLORS.primaryDark },
  renderFieldHint: { ...TYPE.caption, color: COLORS.textTertiary, lineHeight: 17 },
  renderToneBlock: { gap: SPACING.sm },
  sheetNoteRow: {
    flexDirection: "row", alignItems: "flex-start", gap: SPACING.sm,
    marginBottom: SPACING.lg, paddingHorizontal: SPACING.xs,
  },
  sheetNoteText: { flex: 1, ...TYPE.caption, color: COLORS.textTertiary, lineHeight: 17 },
  // Full width, 52pt, and the only filled thing on the sheet: this is the tap
  // that spends a design credit.
  sheetPrimary: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SPACING.sm,
    height: ms(52), borderRadius: RADIUS.lg, backgroundColor: COLORS.primaryDark, ...SHADOW.sm,
  },
  sheetPrimaryBusy: { backgroundColor: COLORS.disabled },
  sheetPrimaryText: { ...TYPE.bodyStrong, color: COLORS.white },
  // The price, on the button that charges it. Same shape the upgrade screen's
  // primary uses, so "this button costs something" looks the same in both places.
  sheetPrimaryPrice: {
    paddingHorizontal: SPACING.sm, paddingVertical: 3,
    borderRadius: RADIUS.pill, backgroundColor: "rgba(255,255,255,0.20)",
  },
  sheetPrimaryPriceText: { ...TYPE.caption, fontSize: 10.5, color: COLORS.white },
  sheetSecondary: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SPACING.sm,
    height: ms(48), marginTop: SPACING.sm,
    borderRadius: RADIUS.md, backgroundColor: COLORS.primaryTint,
  },
  sheetSecondaryText: { ...TYPE.caption, color: COLORS.primaryDark },
  sheetPreview: { borderRadius: RADIUS.lg, overflow: "hidden", backgroundColor: COLORS.surfaceSunken },
  sheetPreviewState: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  sheetImage: { width: "100%", height: ms(190) },
  sheetActions: { flexDirection: "row", gap: SPACING.sm, marginTop: SPACING.lg },
  sheetAction: {
    flex: 1, alignItems: "center", gap: 6, paddingVertical: SPACING.md,
    borderRadius: RADIUS.md, backgroundColor: COLORS.primaryTint,
  },
  sheetActionText: { ...TYPE.caption, color: COLORS.primaryDark },
  sheetClose: { alignItems: "center", justifyContent: "center", height: ms(48), marginTop: SPACING.md },
  sheetCloseText: { ...TYPE.bodyStrong, color: COLORS.textSecondary },

  // The one-line message. It was a white card with body text and a pill button —
  // a fourth dialog shape in a flow that already had three. It is the confirm
  // dialog with one button.
  noticeBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center", padding: SPACING.xl },
  noticeCard: {
    width: "86%", maxWidth: LAYOUT.maxContentWidth,
    backgroundColor: COLORS.background, borderRadius: RADIUS.xl,
    padding: SPACING.lg, ...SHADOW.lg,
  },
  noticeText: { ...TYPE.small, color: COLORS.textSecondary, textAlign: "center", lineHeight: 20 },
  noticeButton: {
    marginTop: SPACING.lg, height: ms(44), alignItems: "center", justifyContent: "center",
    borderRadius: RADIUS.md, backgroundColor: COLORS.primaryDark,
  },
  noticeButtonText: { ...TYPE.bodyStrong, color: COLORS.white, textAlign: "center" },

  // Equal cells under the canvas — same grid logic as the tool palette.
  actionRow: {
    flexDirection: "row", marginTop: SPACING.sm, padding: 3,
    borderRadius: RADIUS.md, backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.borderSubtle,
  },
  // The transparent border is what makes the active state below visible: it set
  // a `borderColor` on a cell that had no `borderWidth`, so selecting one
  // changed nothing but its fill and the row jumped by a pixel if it ever did.
  actionCell: {
    flex: 1, minHeight: ms(44), flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: 5,
    borderRadius: RADIUS.sm, borderWidth: 1, borderColor: "transparent",
  },
  actionActive: { backgroundColor: COLORS.primaryTint, borderColor: COLORS.primarySoft },
  actionDisabled: { opacity: 0.45 },
  actionLabel: { ...TYPE.caption, fontSize: 10 },

  // 54pt — comfortably over the 48dp minimum for a control this consequential,
  // and the primary carries the row's only elevation, so which of the two
  // equal-width buttons is the way forward reads before either label does.
  footerButton: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: SPACING.xs, height: ms(46), borderRadius: RADIUS.md,
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
