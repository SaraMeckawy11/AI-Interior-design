import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";

import COLORS from "../../constants/colors";
import { RADIUS, SPACING, TYPE } from "../../constants/theme";
import { buildWalkthroughHtml } from "../../lib/walkthroughScene";

/**
 * Hosts the three.js walkthrough document and forwards camera / scene commands
 * into it.
 *
 * The HTML is memoised on the *scene inputs only* (layout, room assignments,
 * design settings). Mode, night lighting and the active room are pushed in as
 * imperative commands instead, because rebuilding the document for those would
 * throw away the whole GPU scene and re-run the furnishing pass on every toggle.
 */
const WalkthroughViewer = forwardRef(function WalkthroughViewer(
  { layout, roomConfigs, settings, mode = "walk", roomIndex = 0, night = false, onReady, onSelect, onError, onSnapshot },
  ref,
) {
  const webRef = useRef(null);
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("");

  const html = useMemo(
    () => buildWalkthroughHtml({ layout, roomConfigs, settings, mode, roomIndex, night }),
    // Deliberately excludes mode/roomIndex/night — see the note above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layout, roomConfigs, settings],
  );

  const run = useCallback((expression) => {
    webRef.current?.injectJavaScript(`try{${expression}}catch(e){};true;`);
  }, []);

  useImperativeHandle(ref, () => ({
    move: (direction, amount) => run(`window.LivinaiScene.move(${JSON.stringify(direction)},${amount || 0.36})`),
    turn: (delta) => run(`window.LivinaiScene.turn(${delta})`),
    setJoystick: (x, y) => run(`window.LivinaiScene.setJoystick(${x},${y})`),
    setMode: (value) => run(`window.LivinaiScene.setMode(${JSON.stringify(value)})`),
    setNight: (value) => run(`window.LivinaiScene.setNight(${value ? "true" : "false"})`),
    setRoom: (index) => run(`window.LivinaiScene.setRoom(${index})`),
    setFreeExplore: (value) => run(`window.LivinaiScene.setFreeExplore(${value ? "true" : "false"})`),
    rotateSelected: (delta) => run(`window.LivinaiScene.rotateSelected(${delta})`),
    clearSelection: () => run("window.LivinaiScene.clearSelection()"),
    capture: () => run("window.LivinaiScene.capture()"),
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
        onReady?.(data);
      } else if (data.type === "select") {
        onSelect?.(data.info);
      } else if (data.type === "snapshot") {
        onSnapshot?.(data.image);
      } else if (data.type === "error") {
        setStatus("error");
        setMessage(data.message);
        onError?.(data.message);
      }
    },
    [onError, onReady, onSelect, onSnapshot],
  );

  return (
    <View style={styles.container}>
      <WebView
        ref={webRef}
        source={{ html, baseUrl: "https://livinai.local/" }}
        originWhitelist={["*"]}
        style={styles.web}
        containerStyle={styles.web}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess={false}
        androidLayerType="hardware"
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        setBuiltInZoomControls={false}
        mediaPlaybackRequiresUserAction={false}
        onError={() => {
          setStatus("error");
          setMessage("The 3D view failed to load on this device.");
        }}
      />

      {status !== "ready" && (
        <View style={styles.overlay} pointerEvents={status === "error" ? "auto" : "none"}>
          {status === "loading" ? (
            <>
              <ActivityIndicator color={COLORS.primaryDark} size="large" />
              <Text style={styles.overlayTitle}>Building your interior</Text>
              <Text style={styles.overlayBody}>
                Extruding measured walls, cutting your openings and furnishing every room.
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
