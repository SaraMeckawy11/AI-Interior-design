import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system";
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

import PlanCanvas, {
  GRID_METERS,
  PLAN_WIDTH_METERS,
  polygonArea,
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
  ROOM_TYPES,
  RUG_DESIGNS,
  WALKTHROUGH_STYLES,
  WALL_FINISHES,
  buildLayout,
} from "../../lib/walkthroughScene";

const STAGES = [
  { key: "plan", label: "Floor plan", title: "Trace your floor plan", copy: "Tap to place corners on the metric grid. Every square is half a metre, so the 3D result is built at true scale." },
  { key: "rooms", label: "Rooms", title: "Tell us what each room is", copy: "Room type drives the furniture programme; style drives the material palette." },
  { key: "direction", label: "Direction", title: "Set the design direction", copy: "These choices are applied consistently to every room, exactly like the Livinai studio." },
  { key: "walk", label: "Walkthrough", title: "Walk through your home", copy: "Drag to look around, use the pad to move, and tap any object to inspect it." },
];

const CANVAS_RATIO = 1.12;

/** Ready-made layouts in metres, so a first-time user can reach 3D in one tap. */
const TEMPLATES = [
  {
    key: "studio",
    name: "Open studio",
    rooms: [
      { points: [[0.5, 0.5], [6.5, 0.5], [6.5, 5.5], [0.5, 5.5]], type: "Living Room" },
      { points: [[6.5, 0.5], [9.5, 0.5], [9.5, 3], [6.5, 3]], type: "Kitchen" },
      { points: [[6.5, 3], [9.5, 3], [9.5, 5.5], [6.5, 5.5]], type: "Bathroom" },
    ],
    doors: [[[6.5, 1.5], [6.5, 2.4]], [[6.5, 3.6], [6.5, 4.5]]],
    windows: [[[1.5, 0.5], [3.5, 0.5]], [[4.5, 5.5], [6, 5.5]]],
  },
  {
    key: "two-bed",
    name: "Two-bedroom flat",
    rooms: [
      { points: [[0.5, 0.5], [6, 0.5], [6, 4.5], [0.5, 4.5]], type: "Living Room" },
      { points: [[6, 0.5], [10, 0.5], [10, 4.5], [6, 4.5]], type: "Kitchen" },
      { points: [[0.5, 4.5], [4.5, 4.5], [4.5, 8], [0.5, 8]], type: "Bedroom" },
      { points: [[4.5, 4.5], [7.5, 4.5], [7.5, 8], [4.5, 8]], type: "Bedroom" },
      { points: [[7.5, 4.5], [10, 4.5], [10, 8], [7.5, 8]], type: "Bathroom" },
    ],
    doors: [
      [[6, 1.5], [6, 2.4]],
      [[2, 4.5], [2.9, 4.5]],
      [[5.6, 4.5], [6.5, 4.5]],
      [[8.4, 4.5], [9.3, 4.5]],
    ],
    windows: [[[1.5, 0.5], [3.5, 0.5]], [[7, 0.5], [9, 0.5]], [[1.5, 8], [3, 8]]],
  },
];

const TOOLS = [
  { key: "room", icon: "square-outline", label: "Room" },
  { key: "door", icon: "enter-outline", label: "Door" },
  { key: "window", icon: "tablet-landscape-outline", label: "Window" },
  { key: "balcony", icon: "sunny-outline", label: "Balcony" },
  { key: "select", icon: "hand-left-outline", label: "Select" },
];

const VIEW_MODES = [
  { key: "walk", icon: "walk-outline", label: "Walk" },
  { key: "orbit", icon: "sync-outline", label: "Orbit" },
  { key: "plan", icon: "grid-outline", label: "Plan" },
];

export default function WalkthroughScreen() {
  const router = useRouter();
  const { token } = useAuthStore();
  const viewerRef = useRef(null);

  const [stage, setStage] = useState(0);
  const [tool, setTool] = useState("room");
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [rooms, setRooms] = useState([]);
  const [openings, setOpenings] = useState([]);
  const [draft, setDraft] = useState([]);
  const [roomConfigs, setRoomConfigs] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_WALKTHROUGH_SETTINGS);
  const [selectedRoom, setSelectedRoom] = useState(0);
  const [viewMode, setViewMode] = useState("walk");
  const [night, setNight] = useState(false);
  const [inspected, setInspected] = useState(null);
  const [sceneInfo, setSceneInfo] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  const canvasWidth = Math.round(LAYOUT.screenWidth - SPACING.xl * 2);
  const canvasHeight = Math.round(canvasWidth * CANVAS_RATIO);
  const pixelsPerMeter = canvasWidth / PLAN_WIDTH_METERS;

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

  // ── Plan editing ─────────────────────────────────────────────────────────
  const addVertex = useCallback((point) => setDraft((current) => [...current, point]), []);

  const closeRoom = useCallback(() => {
    if (draft.length < 3) return;
    setRooms((existing) => [...existing, draft]);
    setRoomConfigs((existing) => [
      ...existing,
      {
        name: `Room ${existing.length + 1}`,
        roomType: ROOM_TYPES[existing.length % ROOM_TYPES.length],
        style: "Modern",
      },
    ]);
    setDraft([]);
  }, [draft]);

  const undo = useCallback(() => {
    if (draft.length) {
      setDraft((current) => current.slice(0, -1));
      return;
    }
    if (openings.length) {
      setOpenings((current) => current.slice(0, -1));
      return;
    }
    if (rooms.length) {
      setRooms((current) => current.slice(0, -1));
      setRoomConfigs((current) => current.slice(0, -1));
    }
  }, [draft.length, openings.length, rooms.length]);

  const clearAll = useCallback(() => {
    setRooms([]);
    setRoomConfigs([]);
    setOpenings([]);
    setDraft([]);
    setSelectedRoom(0);
  }, []);

  const applyTemplate = useCallback(
    (template) => {
      const toPixels = (point) => [point[0] * pixelsPerMeter, point[1] * pixelsPerMeter];
      setRooms(template.rooms.map((room) => room.points.map(toPixels)));
      setRoomConfigs(
        template.rooms.map((room, index) => ({
          name: `${room.type} ${index + 1}`,
          roomType: room.type,
          style: "Modern",
        })),
      );
      setOpenings([
        ...(template.doors || []).map((points) => ({ kind: "door", points: points.map(toPixels) })),
        ...(template.windows || []).map((points) => ({ kind: "window", points: points.map(toPixels) })),
      ]);
      setDraft([]);
      setSelectedRoom(0);
    },
    [pixelsPerMeter],
  );

  const updateRoom = useCallback((index, key, value) => {
    setRoomConfigs((current) => current.map((room, roomIndex) => (roomIndex === index ? { ...room, [key]: value } : room)));
  }, []);

  const updateSetting = useCallback((key, value) => {
    setSettings((current) => ({ ...current, [key]: value }));
  }, []);

  // ── Walkthrough actions ──────────────────────────────────────────────────
  const changeViewMode = (mode) => {
    setViewMode(mode);
    viewerRef.current?.setMode(mode);
  };

  const toggleNight = () => {
    setNight((current) => {
      viewerRef.current?.setNight(!current);
      return !current;
    });
  };

  const focusRoom = (index) => {
    setSelectedRoom(index);
    viewerRef.current?.setRoom(index);
  };

  const handleSnapshot = useCallback((image) => {
    setSnapshot(image);
    setBusy("");
  }, []);

  const capture = () => {
    setBusy("capture");
    viewerRef.current?.capture();
  };

  const shareSnapshot = async () => {
    if (!snapshot) return;
    try {
      const base64 = snapshot.split(",")[1];
      const fileUri = `${FileSystem.cacheDirectory}livinai-walkthrough.jpg`;
      await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });
      if (!(await Sharing.isAvailableAsync())) {
        setNotice("Sharing is not available on this device.");
        return;
      }
      await Sharing.shareAsync(fileUri);
    } catch {
      setNotice("That view could not be shared.");
    }
  };

  const saveToGallery = async () => {
    if (!snapshot) return;
    try {
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (!permission.granted) {
        setNotice("Photo permission is needed to save this view.");
        return;
      }
      const base64 = snapshot.split(",")[1];
      const fileUri = `${FileSystem.cacheDirectory}livinai-walkthrough.jpg`;
      await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });
      await MediaLibrary.saveToLibraryAsync(fileUri);
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
          roomType: roomConfigs[selectedRoom]?.roomType || "Walkthrough",
          designStyle: roomConfigs[selectedRoom]?.style || "Modern",
          colorTone: settings.colorMood,
          notes: settings.notes,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Save failed");
      setNotice("Added to your collection.");
    } catch {
      setNotice("This view could not be added to your collection.");
    } finally {
      setBusy("");
    }
  };

  // ── Stage gating ─────────────────────────────────────────────────────────
  const canContinue = stage === 0 ? rooms.length > 0 : true;
  const goNext = () => {
    if (stage === 0 && draft.length >= 3) closeRoom();
    setStage((current) => Math.min(STAGES.length - 1, current + 1));
  };

  const current = STAGES[stage];

  return (
    <View style={styles.screen}>
      <LinearGradient colors={COLORS.gradientBrandDeep} style={styles.header}>
        <SafeAreaView edges={["top"]}>
          <View style={styles.headerRow}>
            <Pressable onPress={() => router.back()} hitSlop={LAYOUT.hitSlop} style={styles.headerButton}>
              <Ionicons name="chevron-back" size={20} color={COLORS.white} />
            </Pressable>
            <View style={styles.headerCopy}>
              <Text style={styles.headerEyebrow}>3D Walkthrough</Text>
              <Text style={styles.headerTitle}>{current.title}</Text>
            </View>
            <View style={styles.headerButton}>
              <Ionicons name="cube-outline" size={19} color={COLORS.white} />
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
                <View style={[styles.stepDot, index <= stage && styles.stepDotActive]}>
                  {index < stage ? (
                    <Ionicons name="checkmark" size={11} color={COLORS.brand700} />
                  ) : (
                    <Text style={[styles.stepNumber, index === stage && styles.stepNumberActive]}>{index + 1}</Text>
                  )}
                </View>
                <Text style={[styles.stepLabel, index === stage && styles.stepLabelActive]} numberOfLines={1}>
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </SafeAreaView>
      </LinearGradient>

      {stage === 3 ? (
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
          busy={busy}
          onReady={setSceneInfo}
          onSelect={setInspected}
          onSnapshot={handleSnapshot}
          onChangeMode={changeViewMode}
          onToggleNight={toggleNight}
          onFocusRoom={focusRoom}
          onCapture={capture}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <Text style={styles.stageCopy}>{current.copy}</Text>

          {stage === 0 && (
            <>
              <View style={styles.toolbar}>
                {TOOLS.map((item) => {
                  const active = tool === item.key;
                  return (
                    <Pressable
                      key={item.key}
                      style={[styles.tool, active && styles.toolActive]}
                      onPress={() => setTool(item.key)}
                    >
                      <Ionicons name={item.icon} size={16} color={active ? COLORS.white : COLORS.textSecondary} />
                      <Text style={[styles.toolLabel, active && styles.toolLabelActive]}>{item.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <PlanCanvas
                width={canvasWidth}
                height={canvasHeight}
                tool={tool}
                rooms={rooms}
                openings={openings}
                draft={draft}
                snapToGrid={snapToGrid}
                selectedRoom={selectedRoom}
                onAddVertex={addVertex}
                onCloseRoom={closeRoom}
                onAddOpening={(opening) => setOpenings((current) => [...current, opening])}
                onRemoveOpening={(index) => setOpenings((current) => current.filter((_, i) => i !== index))}
                onSelectRoom={setSelectedRoom}
              />

              <View style={styles.canvasActions}>
                <GhostButton icon="grid-outline" label={snapToGrid ? "Grid snap on" : "Grid snap off"} onPress={() => setSnapToGrid((value) => !value)} active={snapToGrid} />
                <GhostButton icon="checkmark-done-outline" label="Close room" onPress={closeRoom} disabled={draft.length < 3} />
                <GhostButton icon="arrow-undo-outline" label="Undo" onPress={undo} disabled={!draft.length && !rooms.length && !openings.length} />
                <GhostButton icon="trash-outline" label="Clear" onPress={clearAll} disabled={!rooms.length && !draft.length} tone="danger" />
              </View>

              <View style={styles.metrics}>
                <Metric value={rooms.length} label="Rooms" />
                <Metric value={openings.filter((o) => o.kind === "door").length} label="Doors" />
                <Metric value={openings.filter((o) => o.kind !== "door").length} label="Openings" />
                <Metric value={`${totalArea.toFixed(1)} m²`} label="Floor area" />
              </View>

              <Text style={styles.sectionLabel}>Start from a template</Text>
              <View style={styles.templateRow}>
                {TEMPLATES.map((template) => (
                  <Pressable key={template.key} style={styles.template} onPress={() => applyTemplate(template)}>
                    <Ionicons name="albums-outline" size={18} color={COLORS.primaryDark} />
                    <Text style={styles.templateName}>{template.name}</Text>
                    <Text style={styles.templateMeta}>{template.rooms.length} rooms</Text>
                  </Pressable>
                ))}
              </View>

              <View style={styles.hint}>
                <Ionicons name="information-circle-outline" size={16} color={COLORS.primaryDark} />
                <Text style={styles.hintText}>
                  Each grid square is {GRID_METERS} m. Tap the first corner again to close a room, then switch to the
                  door tool and tap a wall to punch an opening.
                </Text>
              </View>
            </>
          )}

          {stage === 1 && (
            <>
              {roomConfigs.length === 0 && <EmptyState text="Go back and trace at least one room." />}
              {roomConfigs.map((room, index) => (
                <View key={`config-${index}`} style={styles.card}>
                  <View style={styles.cardHead}>
                    <View style={[styles.roomBadge, { backgroundColor: COLORS.primarySoft }]}>
                      <Text style={styles.roomBadgeText}>{index + 1}</Text>
                    </View>
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
                  </View>
                  <ChipRow
                    label="Room type"
                    options={ROOM_TYPES}
                    value={room.roomType}
                    onChange={(value) => updateRoom(index, "roomType", value)}
                  />
                  <ChipRow
                    label="Style"
                    options={WALKTHROUGH_STYLES}
                    value={room.style}
                    onChange={(value) => updateRoom(index, "style", value)}
                  />
                </View>
              ))}
            </>
          )}

          {stage === 2 && (
            <View style={styles.card}>
              <ChipRow label="Design profile" options={DESIGN_PROFILES} value={settings.designProfile} onChange={(value) => updateSetting("designProfile", value)} />
              <ChipRow label="Colour mood" options={COLOR_MOODS} value={settings.colorMood} onChange={(value) => updateSetting("colorMood", value)} />
              <ChipRow label="Floor finish" options={FLOOR_FINISHES} value={settings.floorFinish} onChange={(value) => updateSetting("floorFinish", value)} />
              <ChipRow label="Wall finish" options={WALL_FINISHES} value={settings.wallFinish} onChange={(value) => updateSetting("wallFinish", value)} />
              <ChipRow label="Rugs" options={RUG_DESIGNS} value={settings.rugDesign} onChange={(value) => updateSetting("rugDesign", value)} />
              <ChipRow label="Curtains" options={CURTAIN_DESIGNS} value={settings.curtainDesign} onChange={(value) => updateSetting("curtainDesign", value)} />
              <ChipRow label="Decor" options={DECOR_SETS} value={settings.decorSet} onChange={(value) => updateSetting("decorSet", value)} />

              <Pressable style={styles.toggleRow} onPress={() => updateSetting("freeExplore", !settings.freeExplore)}>
                <View style={[styles.toggle, settings.freeExplore && styles.toggleOn]}>
                  <View style={[styles.toggleKnob, settings.freeExplore && styles.toggleKnobOn]} />
                </View>
                <View style={styles.toggleCopy}>
                  <Text style={styles.toggleTitle}>Free exploration</Text>
                  <Text style={styles.toggleBody}>Walk through walls to inspect the whole plan. Turn off to stay inside the rooms.</Text>
                </View>
              </Pressable>

              <Text style={styles.fieldLabel}>Notes for this home</Text>
              <TextInput
                style={styles.notes}
                value={settings.notes}
                onChangeText={(value) => updateSetting("notes", value)}
                placeholder="For example: keep the living room open to the kitchen, no glossy surfaces…"
                placeholderTextColor={COLORS.placeholderText}
                multiline
                maxLength={280}
              />
            </View>
          )}
        </ScrollView>
      )}

      {stage < 3 && (
        <SafeAreaView edges={["bottom"]} style={styles.footer}>
          <Pressable style={[styles.footerGhost, stage === 0 && styles.footerGhostDisabled]} disabled={stage === 0} onPress={() => setStage((value) => Math.max(0, value - 1))}>
            <Ionicons name="arrow-back" size={16} color={stage === 0 ? COLORS.textTertiary : COLORS.textPrimary} />
            <Text style={[styles.footerGhostText, stage === 0 && { color: COLORS.textTertiary }]}>Back</Text>
          </Pressable>
          <Pressable style={[styles.footerPrimary, !canContinue && styles.footerPrimaryDisabled]} disabled={!canContinue} onPress={goNext}>
            <Text style={styles.footerPrimaryText}>{stage === 2 ? "Enter the walkthrough" : "Continue"}</Text>
            <Ionicons name="arrow-forward" size={16} color={COLORS.white} />
          </Pressable>
        </SafeAreaView>
      )}

      <SnapshotModal
        snapshot={snapshot}
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
  busy,
  onReady,
  onSelect,
  onSnapshot,
  onChangeMode,
  onToggleNight,
  onFocusRoom,
  onCapture,
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
      />

      <View style={styles.viewerTop} pointerEvents="box-none">
        <View style={styles.segmented}>
          {VIEW_MODES.map((item) => {
            const active = viewMode === item.key;
            return (
              <Pressable key={item.key} style={[styles.segment, active && styles.segmentActive]} onPress={() => onChangeMode(item.key)}>
                <Ionicons name={item.icon} size={15} color={active ? COLORS.white : COLORS.textSecondary} />
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable style={[styles.roundButton, night && styles.roundButtonActive]} onPress={onToggleNight}>
          <Ionicons name={night ? "moon" : "sunny-outline"} size={17} color={night ? COLORS.white : COLORS.textPrimary} />
        </Pressable>
      </View>

      {roomConfigs.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.roomStrip}
          contentContainerStyle={styles.roomStripContent}
        >
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

      {inspected && (
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
            <Pressable style={styles.inspectorAction} onPress={() => viewerRef.current?.rotateSelected(-Math.PI / 12)}>
              <Ionicons name="return-up-back-outline" size={15} color={COLORS.textPrimary} />
              <Text style={styles.inspectorActionText}>Rotate</Text>
            </Pressable>
            <Pressable style={styles.inspectorAction} onPress={() => viewerRef.current?.rotateSelected(Math.PI / 12)}>
              <Ionicons name="return-up-forward-outline" size={15} color={COLORS.textPrimary} />
              <Text style={styles.inspectorActionText}>Rotate</Text>
            </Pressable>
          </View>
        </View>
      )}

      <View style={styles.viewerBottom} pointerEvents="box-none">
        {viewMode === "walk" && (
          <View style={styles.pad}>
            <PadButton icon="chevron-up" onIn={() => startMove("forward")} onOut={stopMove} style={styles.padUp} />
            <PadButton icon="chevron-back" onIn={() => startMove("left")} onOut={stopMove} style={styles.padLeft} />
            <PadButton icon="chevron-forward" onIn={() => startMove("right")} onOut={stopMove} style={styles.padRight} />
            <PadButton icon="chevron-down" onIn={() => startMove("back")} onOut={stopMove} style={styles.padDown} />
          </View>
        )}

        <View style={styles.viewerFooter}>
          <View style={styles.sceneBadge}>
            <View style={styles.sceneDot} />
            <Text style={styles.sceneBadgeText}>
              {sceneInfo ? `${sceneInfo.rooms} rooms · ${sceneInfo.objects} objects` : "Building scene…"}
            </Text>
          </View>
          <Pressable style={styles.captureButton} onPress={onCapture} disabled={busy === "capture"}>
            {busy === "capture" ? (
              <ActivityIndicator color={COLORS.white} size="small" />
            ) : (
              <Ionicons name="camera-outline" size={19} color={COLORS.white} />
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
  const color = disabled ? COLORS.textTertiary : tone === "danger" ? COLORS.danger : active ? COLORS.primaryDark : COLORS.textPrimary;
  return (
    <Pressable style={[styles.ghost, active && styles.ghostActive, disabled && styles.ghostDisabled]} onPress={onPress} disabled={disabled}>
      <Ionicons name={icon} size={15} color={color} />
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

function SnapshotModal({ snapshot, busy, onClose, onShare, onSaveGallery, onSaveCollection }) {
  return (
    <Modal transparent visible={!!snapshot} animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Save this view</Text>
          {snapshot ? (
            <View style={styles.sheetPreview}>
              <Image source={{ uri: snapshot }} style={styles.sheetImage} resizeMode="cover" />
            </View>
          ) : null}
          <View style={styles.sheetActions}>
            <SheetAction icon="albums-outline" label="Collection" onPress={onSaveCollection} loading={busy === "save"} />
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

  header: { paddingHorizontal: SPACING.xl, paddingBottom: SPACING.base, borderBottomLeftRadius: RADIUS.xl, borderBottomRightRadius: RADIUS.xl },
  headerRow: { flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingTop: SPACING.sm },
  headerButton: {
    width: ms(38), height: ms(38), borderRadius: RADIUS.md,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  headerCopy: { flex: 1 },
  headerEyebrow: { ...TYPE.overline, color: "rgba(255,255,255,0.72)" },
  headerTitle: { ...TYPE.h2, color: COLORS.white, marginTop: 2 },

  stepper: { flexDirection: "row", marginTop: SPACING.lg, gap: SPACING.xs },
  step: { flex: 1, alignItems: "center", gap: 5 },
  stepDot: {
    width: ms(24), height: ms(24), borderRadius: RADIUS.pill,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  stepDotActive: { backgroundColor: COLORS.white },
  stepNumber: { ...TYPE.caption, color: "rgba(255,255,255,0.8)" },
  stepNumberActive: { color: COLORS.brand700 },
  stepLabel: { ...TYPE.caption, color: "rgba(255,255,255,0.66)" },
  stepLabelActive: { color: COLORS.white },

  body: { padding: SPACING.xl, paddingBottom: SPACING.huge },
  stageCopy: { ...TYPE.small, color: COLORS.textSecondary, marginBottom: SPACING.base },
  sectionLabel: { ...TYPE.overline, color: COLORS.textTertiary, marginTop: SPACING.xl, marginBottom: SPACING.sm },

  toolbar: {
    flexDirection: "row", gap: SPACING.xs, marginBottom: SPACING.md,
    backgroundColor: COLORS.surfaceAlt, padding: SPACING.xs, borderRadius: RADIUS.md,
  },
  tool: { flex: 1, alignItems: "center", gap: 3, paddingVertical: SPACING.sm, borderRadius: RADIUS.sm },
  toolActive: { backgroundColor: COLORS.primaryDark, ...SHADOW.sm },
  toolLabel: { ...TYPE.caption, color: COLORS.textSecondary, fontSize: 10 },
  toolLabelActive: { color: COLORS.white },

  canvasActions: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.sm, marginTop: SPACING.md },
  ghost: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  ghostActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryTint },
  ghostDisabled: { opacity: 0.5 },
  ghostText: { ...TYPE.caption },

  metrics: { flexDirection: "row", gap: SPACING.sm, marginTop: SPACING.base },
  metric: { flex: 1, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, paddingVertical: SPACING.md, alignItems: "center", borderWidth: 1, borderColor: COLORS.border },
  metricValue: { ...TYPE.h3, color: COLORS.textPrimary },
  metricLabel: { ...TYPE.caption, color: COLORS.textTertiary, marginTop: 2 },

  templateRow: { flexDirection: "row", gap: SPACING.md },
  template: { flex: 1, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: SPACING.base, borderWidth: 1, borderColor: COLORS.border, gap: 4 },
  templateName: { ...TYPE.bodyStrong, color: COLORS.textPrimary },
  templateMeta: { ...TYPE.caption, color: COLORS.textTertiary },

  hint: { flexDirection: "row", gap: SPACING.sm, marginTop: SPACING.lg, padding: SPACING.md, backgroundColor: COLORS.primaryTint, borderRadius: RADIUS.md },
  hintText: { ...TYPE.small, color: COLORS.textSecondary, flex: 1 },

  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.base, marginBottom: SPACING.base, borderWidth: 1, borderColor: COLORS.border, ...SHADOW.xs },
  cardHead: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, marginBottom: SPACING.sm },
  roomBadge: { width: ms(28), height: ms(28), borderRadius: RADIUS.sm, alignItems: "center", justifyContent: "center" },
  roomBadgeText: { ...TYPE.caption, color: COLORS.brand700 },
  roomName: { flex: 1, ...TYPE.bodyStrong, color: COLORS.textPrimary, paddingVertical: 4 },
  roomArea: { ...TYPE.caption, color: COLORS.textTertiary },

  chipBlock: { marginTop: SPACING.sm },
  fieldLabel: { ...TYPE.overline, color: COLORS.textTertiary, marginBottom: SPACING.sm },
  chipRow: { gap: SPACING.sm, paddingRight: SPACING.base },
  chip: { paddingHorizontal: SPACING.base, paddingVertical: SPACING.sm, borderRadius: RADIUS.pill, backgroundColor: COLORS.surfaceAlt, borderWidth: 1, borderColor: "transparent" },
  chipActive: { backgroundColor: COLORS.primaryDark, borderColor: COLORS.primaryDark },
  chipText: { ...TYPE.caption, color: COLORS.textSecondary },
  chipTextActive: { color: COLORS.white },

  toggleRow: { flexDirection: "row", gap: SPACING.md, alignItems: "flex-start", marginTop: SPACING.lg },
  toggle: { width: 46, height: 27, borderRadius: RADIUS.pill, backgroundColor: COLORS.surfaceSunken, padding: 3, justifyContent: "center" },
  toggleOn: { backgroundColor: COLORS.primary },
  toggleKnob: { width: 21, height: 21, borderRadius: RADIUS.pill, backgroundColor: COLORS.white, ...SHADOW.xs },
  toggleKnobOn: { alignSelf: "flex-end" },
  toggleCopy: { flex: 1 },
  toggleTitle: { ...TYPE.bodyStrong, color: COLORS.textPrimary },
  toggleBody: { ...TYPE.small, color: COLORS.textSecondary, marginTop: 2 },

  notes: {
    minHeight: 92, borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceAlt,
    padding: SPACING.md, ...TYPE.small, color: COLORS.textPrimary, textAlignVertical: "top",
  },

  empty: { alignItems: "center", gap: SPACING.sm, paddingVertical: SPACING.xxl },
  emptyText: { ...TYPE.small, color: COLORS.textTertiary },

  footer: {
    flexDirection: "row", gap: SPACING.md, paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.md, paddingBottom: SPACING.md,
    backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  footerGhost: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md, borderRadius: RADIUS.pill, backgroundColor: COLORS.surfaceAlt },
  footerGhostDisabled: { opacity: 0.55 },
  footerGhostText: { ...TYPE.bodyStrong, color: COLORS.textPrimary },
  footerPrimary: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SPACING.sm,
    paddingVertical: SPACING.md, borderRadius: RADIUS.pill, backgroundColor: COLORS.primaryDark, ...SHADOW.brand,
  },
  footerPrimaryDisabled: { backgroundColor: COLORS.disabled, shadowOpacity: 0, elevation: 0 },
  footerPrimaryText: { ...TYPE.bodyStrong, color: COLORS.white },

  // Walkthrough stage
  viewerWrap: { flex: 1 },
  viewerTop: { position: "absolute", top: SPACING.md, left: SPACING.base, right: SPACING.base, flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  segmented: { flex: 1, flexDirection: "row", backgroundColor: "rgba(255,255,255,0.92)", borderRadius: RADIUS.pill, padding: 3, ...SHADOW.sm },
  segment: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: SPACING.sm, borderRadius: RADIUS.pill },
  segmentActive: { backgroundColor: COLORS.primaryDark },
  segmentText: { ...TYPE.caption, color: COLORS.textSecondary },
  segmentTextActive: { color: COLORS.white },
  roundButton: { width: ms(40), height: ms(40), borderRadius: RADIUS.pill, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.92)", ...SHADOW.sm },
  roundButtonActive: { backgroundColor: COLORS.brand700 },

  roomStrip: { position: "absolute", top: ms(64), left: 0, right: 0, maxHeight: ms(42) },
  roomStripContent: { paddingHorizontal: SPACING.base, gap: SPACING.sm, alignItems: "center" },
  roomPill: { paddingHorizontal: SPACING.base, paddingVertical: SPACING.sm, borderRadius: RADIUS.pill, backgroundColor: "rgba(255,255,255,0.9)", maxWidth: 150 },
  roomPillActive: { backgroundColor: COLORS.accent },
  roomPillText: { ...TYPE.caption, color: COLORS.textSecondary },
  roomPillTextActive: { color: COLORS.white },

  inspector: {
    position: "absolute", left: SPACING.base, right: SPACING.base, bottom: ms(190),
    backgroundColor: "rgba(255,255,255,0.96)", borderRadius: RADIUS.lg, padding: SPACING.base, ...SHADOW.md,
  },
  inspectorHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: SPACING.sm },
  inspectorTitle: { ...TYPE.h3, color: COLORS.textPrimary, flex: 1, textTransform: "capitalize" },
  inspectorMeta: { ...TYPE.caption, color: COLORS.accentStrong, marginTop: 2 },
  inspectorBody: { ...TYPE.small, color: COLORS.textSecondary, marginTop: SPACING.xs },
  inspectorActions: { flexDirection: "row", gap: SPACING.sm, marginTop: SPACING.md },
  inspectorAction: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: RADIUS.pill, backgroundColor: COLORS.surfaceAlt },
  inspectorActionText: { ...TYPE.caption, color: COLORS.textPrimary },

  viewerBottom: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: SPACING.base, paddingBottom: SPACING.xl },
  pad: { width: ms(150), height: ms(150), alignSelf: "flex-end", marginBottom: SPACING.md },
  padButton: {
    position: "absolute", width: ms(48), height: ms(48), borderRadius: RADIUS.pill,
    alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.92)", ...SHADOW.sm,
  },
  padUp: { top: 0, left: ms(51) },
  padDown: { bottom: 0, left: ms(51) },
  padLeft: { left: 0, top: ms(51) },
  padRight: { right: 0, top: ms(51) },

  viewerFooter: { flexDirection: "row", alignItems: "center", gap: SPACING.md },
  sceneBadge: { flex: 1, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: SPACING.base, paddingVertical: SPACING.md, borderRadius: RADIUS.pill, backgroundColor: "rgba(255,255,255,0.92)" },
  sceneDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.success },
  sceneBadgeText: { ...TYPE.caption, color: COLORS.textSecondary },
  captureButton: { width: ms(52), height: ms(52), borderRadius: RADIUS.pill, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.primaryDark, ...SHADOW.brand },

  // Snapshot sheet
  sheetBackdrop: { flex: 1, backgroundColor: COLORS.scrim, justifyContent: "flex-end" },
  sheet: { backgroundColor: COLORS.surface, borderTopLeftRadius: RADIUS.xxl, borderTopRightRadius: RADIUS.xxl, padding: SPACING.xl, paddingBottom: SPACING.xxl },
  sheetHandle: { width: 44, height: 4, borderRadius: 2, backgroundColor: COLORS.borderStrong, alignSelf: "center", marginBottom: SPACING.base },
  sheetTitle: { ...TYPE.h2, color: COLORS.textPrimary, marginBottom: SPACING.base },
  sheetPreview: { borderRadius: RADIUS.lg, overflow: "hidden", backgroundColor: COLORS.surfaceAlt },
  sheetImage: { width: "100%", height: ms(190) },
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
