import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";

import COLORS from "../../constants/colors";
import { RADIUS, SPACING, TYPE } from "../../constants/theme";
import { buildWalkthroughHtml, catalogKeysFor } from "../../lib/walkthroughScene";
import { loadFurnitureModel } from "../../lib/furnitureCatalog";
import { buildExactWalkthroughHtml } from "../../lib/exactWalkthroughScene";

/**
 * Hosts the three.js walkthrough document and forwards camera / scene commands
 * into it.
 *
 * The HTML is memoised on the *scene inputs only* (layout, room assignments,
 * design settings). Mode, night lighting and the active room are pushed in as
 * imperative commands instead, because rebuilding the document for those would
 * throw away the whole GPU scene and re-run the furnishing pass on every toggle.
 *
 * Furniture models are not part of the document. They are streamed in once the
 * scene reports itself ready — see `streamCatalog` — so the document stays a
 * few hundred kilobytes rather than the nine megabytes the full .glb catalogue
 * would add to it.
 */

/**
 * How much base64 to hand over per `injectJavaScript` call.
 *
 * The bridge copies the whole string, so a 5 MB model sent in one call stalls
 * the UI thread visibly. 96 KB is small enough to stay imperceptible and large
 * enough that even the biggest model is under sixty calls.
 */
const CHUNK_SIZE = 96 * 1024;

const WalkthroughViewer = forwardRef(function WalkthroughViewer(
  {
    layout,
    roomConfigs,
    settings,
    furnitureEdits = {},
    exactScene = null,
    exactBaseUrl = "",
    mode = "walk",
    roomIndex = 0,
    night = false,
    onReady,
    onSceneUpdate,
    onSelect,
    onError,
    onSnapshot,
    onComposition,
    onFurnitureChange,
    onDiagnostic,
  },
  ref,
) {
  const webRef = useRef(null);
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("");

  const html = useMemo(
    () => exactScene
      ? buildExactWalkthroughHtml({ scene: exactScene, settings, furnitureEdits, mode, roomIndex, night })
      : buildWalkthroughHtml({ layout, roomConfigs, settings, furnitureEdits, mode, roomIndex, night }),
    // Deliberately excludes mode/roomIndex/night — see the note above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [exactScene, layout, roomConfigs, settings],
  );

  const catalogKeys = useMemo(
    () => exactScene ? [] : catalogKeysFor(roomConfigs),
    [exactScene, roomConfigs],
  );

  useEffect(() => {
    setStatus("loading");
    setMessage("");
  }, [html]);

  const run = useCallback((expression) => {
    webRef.current?.injectJavaScript(`try{${expression}}catch(e){};true;`);
  }, []);

  // Cancels an in-flight stream when the scene is rebuilt or the screen closes,
  // so models from the previous document never land in the new one.
  const streamToken = useRef(0);

  const streamCatalog = useCallback(() => {
    const token = (streamToken.current += 1);
    const keys = [...catalogKeys];

    const sendNext = () => {
      if (token !== streamToken.current) return;
      const key = keys.shift();
      if (!key) return;
      const base64 = loadFurnitureModel(key);
      if (!base64) {
        sendNext();
        return;
      }
      let offset = 0;
      const sendChunk = () => {
        if (token !== streamToken.current) return;
        const chunk = base64.slice(offset, offset + CHUNK_SIZE);
        offset += CHUNK_SIZE;
        const last = offset >= base64.length;
        run(`window.LivinaiScene.installModel(${JSON.stringify(key)},${JSON.stringify(chunk)},${last})`);
        // Yielding between chunks keeps the bridge — and the touch handlers the
        // user is already using to look around — responsive while a large model
        // is being sent.
        setTimeout(last ? sendNext : sendChunk, last ? 24 : 0);
      };
      sendChunk();
    };

    sendNext();
  }, [catalogKeys, run]);

  useEffect(() => () => { streamToken.current += 1; }, []);

  useImperativeHandle(ref, () => ({
    move: (direction, amount) => run(`window.LivinaiScene.move(${JSON.stringify(direction)},${amount || 0.36})`),
    turn: (delta) => run(`window.LivinaiScene.turn(${delta})`),
    setJoystick: (x, y) => run(`window.LivinaiScene.setJoystick(${x},${y})`),
    setMode: (value) => run(`window.LivinaiScene.setMode(${JSON.stringify(value)})`),
    setNight: (value) => run(`window.LivinaiScene.setNight(${value ? "true" : "false"})`),
    setRoom: (index) => run(`window.LivinaiScene.setRoom(${index})`),
    setFreeExplore: (value) => run(`window.LivinaiScene.setFreeExplore(${value ? "true" : "false"})`),
    setDesignerView: (value) => run(`window.LivinaiScene.setDesignerView(${value ? "true" : "false"})`),
    rotateSelected: (delta) => run(`window.LivinaiScene.rotateSelected(${delta})`),
    moveSelected: (direction, amount) =>
      run(`window.LivinaiScene.moveSelected(${JSON.stringify(direction)},${amount || 0.12})`),
    resetSelected: () => run("window.LivinaiScene.resetSelected()"),
    clearSelection: () => run("window.LivinaiScene.clearSelection()"),
    frameRoom: (index) => run(`window.LivinaiScene.frameRoom(${index})`),
    capture: (purpose = "photo", designerCamera = false) =>
      run(`window.LivinaiScene.capture(${JSON.stringify(purpose)},${designerCamera ? "true" : "false"})`),
  }));

  const handleMessage = useCallback(
    (event) => {
      let data;
      try {
        data = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }
      if (data.type === "ready") {
        setStatus("ready");
        if (__DEV__) {
          console.log(data.exact
            ? `[walkthrough] exact Livinai_web scene: ${data.rooms} rooms, ${data.objects} editable objects`
            : `[walkthrough] engine=${data.engine} three=r${data.threeVersion} `
              + `${data.objects} pieces staged, ${data.catalogRequested} models queued`);
        }
        onReady?.(data);
        if (!data.exact) streamCatalog();
      } else if (data.type === "sceneUpdate") {
        // A model finished streaming and swapped in. Same shape as `ready`, so
        // the furniture counters stay live as the room sharpens.
        onSceneUpdate?.(data);
      } else if (data.type === "diagnostic") {
        if (__DEV__) console.warn(`[walkthrough] ${data.message}`);
        onDiagnostic?.(data.message);
      } else if (data.type === "select") {
        onSelect?.(data.info);
      } else if (data.type === "composition") {
        onComposition?.(data.composition);
      } else if (data.type === "snapshot") {
        onSnapshot?.(data.image, data.purpose, data.composition);
      } else if (data.type === "furnitureChange") {
        onFurnitureChange?.(data.id, data.transform || null);
      } else if (data.type === "error") {
        setStatus("error");
        setMessage(data.message);
        onError?.(data.message);
      }
    },
    [onComposition, onDiagnostic, onError, onFurnitureChange, onReady, onSceneUpdate, onSelect, onSnapshot, streamCatalog],
  );

  return (
    <View style={styles.container}>
      <WebView
        ref={webRef}
        source={{
          html,
          baseUrl: exactScene && exactBaseUrl
            ? `${exactBaseUrl.replace(/\/$/, "")}/`
            : "https://livinai.local/",
        }}
        originWhitelist={["*"]}
        style={styles.web}
        containerStyle={styles.web}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled
        /* The scene metadata is kept by the app (see lib/walkthroughSceneStore.js),
           but the GLB is tens of megabytes and belongs in an HTTP cache, not in
           AsyncStorage. Model URLs are content-addressed and served
           `immutable` for a week, so reopening a plan re-reads the same file
           from disk instead of downloading it again — as long as this is on. It
           was only ever on by default, which is not the same as being decided. */
        cacheEnabled
        cacheMode="LOAD_DEFAULT"
        allowFileAccess={false}
        androidLayerType="hardware"
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        setBuiltInZoomControls={false}
        mediaPlaybackRequiresUserAction={false}
        onError={() => {
          const errorMessage = "The 3D view could not start on this device.";
          setStatus("error");
          setMessage(errorMessage);
          onError?.(errorMessage);
        }}
      />

      {status !== "ready" && (
        <View style={styles.overlay} pointerEvents={status === "error" ? "auto" : "none"}>
          {status === "loading" ? (
            <>
              <ActivityIndicator color={COLORS.primaryDark} size="large" />
              <Text style={styles.overlayTitle}>Building your interior</Text>
              <Text style={styles.overlayBody}>
                Measuring the rooms you drew and furnishing them to your chosen style.
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.overlayTitle}>Walkthrough unavailable</Text>
              <Text style={styles.overlayBody}>{message}</Text>
            </>
          )}
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1, overflow: "hidden", backgroundColor: COLORS.surfaceAlt },
  web: { flex: 1, backgroundColor: COLORS.surfaceAlt },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: SPACING.xxl,
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: RADIUS.lg,
  },
  overlayTitle: {
    ...TYPE.h3,
    color: COLORS.textPrimary,
    marginTop: SPACING.base,
    textAlign: "center",
  },
  overlayBody: {
    ...TYPE.small,
    color: COLORS.textSecondary,
    marginTop: SPACING.sm,
    textAlign: "center",
  },
});

export default WalkthroughViewer;
