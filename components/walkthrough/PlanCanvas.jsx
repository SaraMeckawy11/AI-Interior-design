import React, { useMemo, useRef, useState } from "react";
import { PanResponder, StyleSheet, Text, View } from "react-native";
import Svg, {
  Circle,
  G,
  Line,
  Polygon,
  Polyline,
  Rect,
  Text as SvgText,
} from "react-native-svg";

import COLORS from "../../constants/colors";
import { RADIUS, TYPE } from "../../constants/theme";

/**
 * Measured floor-plan canvas.
 *
 * The web studio derives its scale by detecting rooms in an uploaded plan and
 * estimating pixels-per-metre from the median room area. On a phone, drawing on
 * a *metric grid* is both easier and far more accurate: every cell is a fixed
 * 0.5 m, so the geometry handed to the 3D renderer is already correctly scaled
 * and doors/windows come out at believable widths without any estimation.
 *
 * Coordinates are stored in canvas pixels (matching what the renderer expects)
 * and converted to metres purely for the on-screen labels.
 */

export const PLAN_WIDTH_METERS = 12;
export const GRID_METERS = 0.5;

export const OPENING_SPECS = {
  door: { meters: 0.9, color: "#B0653F", label: "Door" },
  window: { meters: 1.2, color: "#2F6497", label: "Window" },
  balcony: { meters: 1.8, color: "#2C7A57", label: "Balcony" },
};

const ROOM_FILLS = [
  "rgba(76,124,101,0.16)",
  "rgba(176,101,63,0.16)",
  "rgba(47,100,151,0.15)",
  "rgba(169,118,42,0.16)",
  "rgba(110,155,133,0.18)",
  "rgba(140,110,150,0.15)",
];
const ROOM_STROKES = ["#4C7C65", "#B0653F", "#2F6497", "#A9762A", "#6E9B85", "#8C6E96"];

export function polygonArea(points) {
  let twice = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    twice += point[0] * next[1] - next[0] * point[1];
  });
  return Math.abs(twice) / 2;
}

export function polygonCentroid(points) {
  let x = 0;
  let y = 0;
  let twice = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    const cross = point[0] * next[1] - next[0] * point[1];
    twice += cross;
    x += (point[0] + next[0]) * cross;
    y += (point[1] + next[1]) * cross;
  });
  if (!twice) {
    return [
      points.reduce((sum, point) => sum + point[0], 0) / points.length,
      points.reduce((sum, point) => sum + point[1], 0) / points.length,
    ];
  }
  return [x / (3 * twice), y / (3 * twice)];
}

function projectOnSegment(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSq = dx * dx + dy * dy;
  if (!lengthSq) return { point: start, t: 0, distance: Math.hypot(point[0] - start[0], point[1] - start[1]) };
  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSq));
  const nearest = [start[0] + dx * t, start[1] + dy * t];
  return { point: nearest, t, distance: Math.hypot(point[0] - nearest[0], point[1] - nearest[1]) };
}

/**
 * Place an opening of `widthPx` centred on the wall nearest to `tap`, clamped so
 * it always leaves a buildable return at each end of the wall.
 */
export function openingOnNearestWall(tap, rooms, widthPx, maxDistance) {
  let best = null;
  rooms.forEach((room) => {
    room.forEach((start, index) => {
      const end = room[(index + 1) % room.length];
      const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
      if (length < widthPx * 0.9) return;
      const hit = projectOnSegment(tap, start, end);
      if (!best || hit.distance < best.distance) best = { ...hit, start, end, length };
    });
  });
  if (!best || best.distance > maxDistance) return null;
  const direction = [(best.end[0] - best.start[0]) / best.length, (best.end[1] - best.start[1]) / best.length];
  const margin = Math.min(widthPx * 0.35, best.length * 0.12);
  const half = Math.min(widthPx, best.length - margin * 2) / 2;
  const centre = Math.max(margin + half, Math.min(best.length - margin - half, best.t * best.length));
  return [
    [best.start[0] + direction[0] * (centre - half), best.start[1] + direction[1] * (centre - half)],
    [best.start[0] + direction[0] * (centre + half), best.start[1] + direction[1] * (centre + half)],
  ];
}

export default function PlanCanvas({
  width,
  height,
  tool,
  rooms,
  openings,
  draft,
  snapToGrid = true,
  onAddVertex,
  onCloseRoom,
  onAddOpening,
  onRemoveOpening,
  onSelectRoom,
  selectedRoom,
}) {
  const [pointer, setPointer] = useState(null);
  const gesture = useRef({ x: 0, y: 0, moved: 0, startedAt: 0 });

  const pixelsPerMeter = width / PLAN_WIDTH_METERS;
  const gridStep = pixelsPerMeter * GRID_METERS;

  const snap = (value) => (snapToGrid ? Math.round(value / gridStep) * gridStep : value);
  const clampX = (value) => Math.max(0, Math.min(width, value));
  const clampY = (value) => Math.max(0, Math.min(height, value));

  const handleTap = (x, y) => {
    const raw = [clampX(x), clampY(y)];
    if (tool === "room") {
      const point = [clampX(snap(raw[0])), clampY(snap(raw[1]))];
      if (draft.length >= 3) {
        const first = draft[0];
        if (Math.hypot(point[0] - first[0], point[1] - first[1]) <= gridStep * 0.9) {
          onCloseRoom?.();
          return;
        }
      }
      onAddVertex?.(point);
      return;
    }
    if (tool === "select") {
      const hit = rooms.findIndex((room) => pointInPolygon(raw, room));
      if (hit >= 0) onSelectRoom?.(hit);
      return;
    }
    const spec = OPENING_SPECS[tool];
    if (!spec) return;
    const existing = openings.findIndex(
      (opening) => opening.kind === tool && projectOnSegment(raw, opening.points[0], opening.points[1]).distance < gridStep * 0.7,
    );
    if (existing >= 0) {
      onRemoveOpening?.(existing);
      return;
    }
    const placed = openingOnNearestWall(raw, rooms, spec.meters * pixelsPerMeter, gridStep * 2.2);
    if (placed) onAddOpening?.({ kind: tool, points: placed });
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_event, state) => Math.abs(state.dx) + Math.abs(state.dy) > 4,
        onPanResponderGrant: (event) => {
          const { locationX, locationY } = event.nativeEvent;
          gesture.current = { x: locationX, y: locationY, moved: 0, startedAt: Date.now() };
          setPointer([clampX(locationX), clampY(locationY)]);
        },
        onPanResponderMove: (event, state) => {
          gesture.current.moved = Math.abs(state.dx) + Math.abs(state.dy);
          const { locationX, locationY } = event.nativeEvent;
          setPointer([clampX(locationX), clampY(locationY)]);
        },
        onPanResponderRelease: (event) => {
          const { locationX, locationY } = event.nativeEvent;
          const quick = Date.now() - gesture.current.startedAt < 700;
          if (gesture.current.moved < 10 && quick) handleTap(locationX, locationY);
          setPointer(null);
        },
        onPanResponderTerminate: () => setPointer(null),
      }),
    // Recreated whenever the drawing context changes so the closure never
    // captures stale rooms/draft state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tool, rooms, openings, draft, snapToGrid, width, height],
  );

  const gridLines = useMemo(() => {
    const lines = [];
    for (let x = 0; x <= width + 0.5; x += gridStep) lines.push({ key: `v${x}`, x1: x, y1: 0, x2: x, y2: height, major: Math.round(x / gridStep) % 2 === 0 });
    for (let y = 0; y <= height + 0.5; y += gridStep) lines.push({ key: `h${y}`, x1: 0, y1: y, x2: width, y2: y, major: Math.round(y / gridStep) % 2 === 0 });
    return lines;
  }, [gridStep, height, width]);

  const snappedPointer = pointer && tool === "room" ? [snap(pointer[0]), snap(pointer[1])] : pointer;

  return (
    <View style={[styles.canvas, { width, height }]} {...responder.panHandlers}>
      <Svg width={width} height={height}>
        <Rect x={0} y={0} width={width} height={height} fill={COLORS.surface} />
        <G opacity={0.55}>
          {gridLines.map((line) => (
            <Line
              key={line.key}
              x1={line.x1}
              y1={line.y1}
              x2={line.x2}
              y2={line.y2}
              stroke={line.major ? COLORS.borderStrong : COLORS.border}
              strokeWidth={line.major ? 1 : 0.6}
            />
          ))}
        </G>

        {rooms.map((room, index) => {
          const centroid = polygonCentroid(room);
          const areaMeters = polygonArea(room) / (pixelsPerMeter * pixelsPerMeter);
          const active = selectedRoom === index;
          return (
            <G key={`room-${index}`}>
              <Polygon
                points={room.map((point) => point.join(",")).join(" ")}
                fill={ROOM_FILLS[index % ROOM_FILLS.length]}
                stroke={ROOM_STROKES[index % ROOM_STROKES.length]}
                strokeWidth={active ? 4 : 2.5}
                strokeLinejoin="round"
              />
              <SvgText
                x={centroid[0]}
                y={centroid[1] - 2}
                fill={COLORS.textPrimary}
                fontSize={11}
                fontWeight="600"
                textAnchor="middle"
              >
                {`Room ${index + 1}`}
              </SvgText>
              <SvgText
                x={centroid[0]}
                y={centroid[1] + 12}
                fill={COLORS.textSecondary}
                fontSize={10}
                textAnchor="middle"
              >
                {`${areaMeters.toFixed(1)} m²`}
              </SvgText>
            </G>
          );
        })}

        {openings.map((opening, index) => {
          const spec = OPENING_SPECS[opening.kind] || OPENING_SPECS.door;
          return (
            <Line
              key={`opening-${index}`}
              x1={opening.points[0][0]}
              y1={opening.points[0][1]}
              x2={opening.points[1][0]}
              y2={opening.points[1][1]}
              stroke={spec.color}
              strokeWidth={7}
              strokeLinecap="round"
            />
          );
        })}

        {draft.length > 0 && (
          <G>
            <Polyline
              points={[...draft, ...(snappedPointer && tool === "room" ? [snappedPointer] : [])]
                .map((point) => point.join(","))
                .join(" ")}
              fill="none"
              stroke={COLORS.primaryDark}
              strokeWidth={2.5}
              strokeDasharray="7 5"
              strokeLinejoin="round"
            />
            {draft.map((point, index) => (
              <Circle
                key={`draft-${index}`}
                cx={point[0]}
                cy={point[1]}
                r={index === 0 ? 7 : 4.5}
                fill={index === 0 ? COLORS.primaryDark : COLORS.surface}
                stroke={COLORS.primaryDark}
                strokeWidth={2}
              />
            ))}
          </G>
        )}

        {snappedPointer && (
          <G opacity={0.9}>
            <Line x1={snappedPointer[0]} y1={0} x2={snappedPointer[0]} y2={height} stroke={COLORS.accent} strokeWidth={0.8} strokeDasharray="4 6" />
            <Line x1={0} y1={snappedPointer[1]} x2={width} y2={snappedPointer[1]} stroke={COLORS.accent} strokeWidth={0.8} strokeDasharray="4 6" />
            <Circle cx={snappedPointer[0]} cy={snappedPointer[1]} r={6} fill="none" stroke={COLORS.accent} strokeWidth={2} />
          </G>
        )}
      </Svg>

      <View style={styles.scaleBadge} pointerEvents="none">
        <View style={[styles.scaleBar, { width: gridStep * 2 }]} />
        <Text style={styles.scaleLabel}>1 m</Text>
      </View>
    </View>
  );
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi + 1e-9) + xi) inside = !inside;
  }
  return inside;
}

const styles = StyleSheet.create({
  canvas: {
    borderRadius: RADIUS.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  scaleBadge: {
    position: "absolute",
    left: 10,
    bottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.9)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: RADIUS.pill,
  },
  scaleBar: { height: 3, backgroundColor: COLORS.textSecondary, borderRadius: 2 },
  scaleLabel: { ...TYPE.caption, color: COLORS.textSecondary },
});
