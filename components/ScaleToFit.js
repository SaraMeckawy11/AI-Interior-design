// ScaleToFit.js
import React, { useEffect, useState } from "react";
import { View, useWindowDimensions } from "react-native";

/**
 * Wrap your screen with <ScaleToFit> ...children... </ScaleToFit>
 * It measures the natural layout (at available width) then scales it down
 * proportionally to fit the available width/height.
 */
export default function ScaleToFit({
  children,
  maxScale = 1,     // don't scale up past 1
  minScale = 0.55,  // optional lower bound so text doesn't become unreadable
  center = true,
  style,
}) {
  const { width: availW, height: availH } = useWindowDimensions();
  const [measured, setMeasured] = useState({ w: 0, h: 0 });
  const [ready, setReady] = useState(false);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (measured.w && measured.h) {
      const scaleW = availW / measured.w;
      const scaleH = availH / measured.h;
      const s = Math.min(scaleW, scaleH, maxScale);
      setScale(Math.max(minScale, s));
      setReady(true);
    }
  }, [measured, availW, availH, maxScale, minScale]);

  return (
    <View
      style={[
        { flex: 1, alignItems: center ? "center" : "flex-start", justifyContent: "flex-start" },
        style,
      ]}
    >
      {/* Invisible measuring pass: render children with width = available width
          so children that use width: "100%" measure correctly. */}
      <View
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          if (width && height && (width !== measured.w || height !== measured.h)) {
            setMeasured({ w: width, h: height });
          }
        }}
        style={{ position: "absolute", left: 0, top: 0, opacity: 0, width: availW }}
        pointerEvents="none"
      >
        {children}
      </View>

      {/* Visible scaled content — rendered only after we measured */}
      {ready ? (
        <View
          style={{
            width: measured.w * scale,
            height: measured.h * scale,
            overflow: "hidden",
            transform: [{ scale }],
          }}
        >
          {children}
        </View>
      ) : null}
    </View>
  );
}
