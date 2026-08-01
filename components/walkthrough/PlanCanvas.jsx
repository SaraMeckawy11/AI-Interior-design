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
 * The web studio detects rooms in an uploaded plan and estimates
 * pixels-per-metre from the median room area. On a phone, drawing on a *metric
 * grid* is both easier and more accurate: every cell is a fixed 0.5 m, so the
 * geometry handed to the 3D renderer is already correctly scaled and openings
 * come out at believable widths with no estimation step.
 *
 * Coordinates are stored in canvas pixels (what the renderer expects) and
 * converted to metres only for on-screen labels.
 */

export const PLAN_WIDTH_METERS = 12;
export const GRID_METERS = 0.5;

export const OPENING_SPECS = {
  door: { meters: 0.9, color: "#AE6740", label: "Door" },
  window: { meters: 1.2, color: "#2C6089", label: "Window" },
  balcony: { meters: 1.8, color: "#2E7350", label: "Balcony" },
};

export const ROOM_TINTS = [
  { fill: "rgba(92,138,114,0.18)", stroke: "#41715A" },
  { fill: "rgba(174,103,64,0.18)", stroke: "#8D5031" },
  { fill: "rgba(44,96,137,0.16)", stroke: "#2C6089" },
  { fill: "rgba(156,111,34,0.18)", stroke: "#9C6F22" },
  { fill: "rgba(127,160,136,0.22)", stroke: "#5C8A72" },
  { fill: "rgba(134,106,146,0.16)", stroke: "#6D5578" },
];

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

export function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi + 1e-9) + xi) inside = !inside;
  }
  return inside;
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
 * Place an opening of `widthPx` centred on the wall nearest to `tap`, clamped
 * so it always leaves a buildable return at each end of the wall.
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
  roomLabels = [],
  openings,
  draft,
  snapToGrid = true,
  selectedRoom,
  onAddVertex,
  onCloseRoom,
  onAddRoom,
  onAddOpening,
  onRemoveOpening,
  onSelectRoom,
  onMoveRoom,
  onMoveVertex,
  onMoveOpening,
}) {
  const [pointer, setPointer] = useState(null);
  const [rectDraft, setRectDraft] = useState(null);
  const gesture = useRef({ x: 0, y: 0, moved: 0, startedAt: 0, drag: null, lastX: 0, lastY: 0 });

  const pixelsPerMeter = width / PLAN_WIDTH_METERS;
  const gridStep = pixelsPerMeter * GRID_METERS;

  const snap = (value) => (snapToGrid ? Math.round(value / gridStep) * gridStep : value);
  const clampX = (value) => Math.max(0, Math.min(width, value));
  const clampY = (value) => Math.max(0, Math.min(height, value));
  const snapPoint = (point) => [clampX(snap(point[0])), clampY(snap(point[1]))];
  const metres = (pixels) => pixels / pixelsPerMeter;

  const handleTap = (x, y) => {
    const raw = [clampX(x), clampY(y)];
    if (tool === "room") {
      const point = snapPoint(raw);
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
    if (tool === "select" || tool === "rect") {
      const hit = rooms.findIndex((room) => pointInPolygon(raw, room));
      if (hit >= 0) onSelectRoom?.(hit);
      return;
    }
    const spec = OPENING_SPECS[tool];
    if (!spec) return;
    const existing = openings.findIndex(
      (opening) => projectOnSegment(raw, opening.points[0], opening.points[1]).distance < gridStep * 0.7,
    );
    if (existing >= 0) {
      onRemoveOpening?.(existing);
      return;
    }
    const placed = openingOnNearestWall(raw, rooms, spec.meters * pixelsPerMeter, gridStep * 2.2);
    if (placed) onAddOpening?.({ kind: tool, points: placed });
  };

  /**
   * What is under the finger, in priority order. A vertex handle beats the room
   * it belongs to, and an opening beats the room it is cut into — otherwise
   * neither would ever be grabbable, since both sit inside a room's area.
   */
  const hitTest = (point) => {
    const room = rooms[selectedRoom];
    if (room) {
      const vertex = room.findIndex((corner) => Math.hypot(corner[0] - point[0], corner[1] - point[1]) <= gridStep * 0.7);
      if (vertex >= 0) return { kind: "vertex", room: selectedRoom, index: vertex };
    }
    const opening = openings.findIndex(
      (item) => projectOnSegment(point, item.points[0], item.points[1]).distance < gridStep * 0.6,
    );
    if (opening >= 0) return { kind: "opening", index: opening };
    const inside = rooms.findIndex((candidate) => pointInPolygon(point, candidate));
    if (inside >= 0) return { kind: "room", index: inside };
    return null;
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_event, state) => Math.abs(state.dx) + Math.abs(state.dy) > 4,

        onPanResponderGrant: (event) => {
          const { locationX, locationY } = event.nativeEvent;
          const point = [clampX(locationX), clampY(locationY)];
          gesture.current = {
            x: locationX, y: locationY, moved: 0, startedAt: Date.now(),
            drag: null, lastX: locationX, lastY: locationY,
          };
          setPointer(point);

          if (tool === "rect") {
            setRectDraft({ from: snapPoint(point), to: snapPoint(point) });
            return;
          }
          if (tool === "select") {
            const hit = hitTest(point);
            gesture.current.drag = hit;
            if (hit?.kind === "room" && hit.index !== selectedRoom) onSelectRoom?.(hit.index);
          }
        },

        onPanResponderMove: (event, state) => {
          gesture.current.moved = Math.abs(state.dx) + Math.abs(state.dy);
          const { locationX, locationY } = event.nativeEvent;
          const point = [clampX(locationX), clampY(locationY)];
          setPointer(point);

          if (tool === "rect") {
            setRectDraft((current) => (current ? { ...current, to: snapPoint(point) } : current));
            return;
          }

          const drag = gesture.current.drag;
          if (tool !== "select" || !drag || gesture.current.moved < 8) return;

          if (drag.kind === "vertex") {
            onMoveVertex?.(drag.room, drag.index, snapPoint(point));
          } else if (drag.kind === "opening") {
            onMoveOpening?.(drag.index, point);
          } else if (drag.kind === "room") {
            // Deltas rather than absolute positions: the room keeps its shape
            // and does not jump to centre itself under the finger.
            onMoveRoom?.(drag.index, locationX - gesture.current.lastX, locationY - gesture.current.lastY);
          }
          gesture.current.lastX = locationX;
          gesture.current.lastY = locationY;
        },

        onPanResponderRelease: (event) => {
          const { locationX, locationY } = event.nativeEvent;
          const quick = Date.now() - gesture.current.startedAt < 700;

          if (tool === "rect" && rectDraft && gesture.current.moved >= 10) {
            const [x1, y1] = rectDraft.from;
            const [x2, y2] = snapPoint([clampX(locationX), clampY(locationY)]);
            const minSide = gridStep * 1.5;
            if (Math.abs(x2 - x1) >= minSide && Math.abs(y2 - y1) >= minSide) {
              onAddRoom?.([
                [Math.min(x1, x2), Math.min(y1, y2)],
                [Math.max(x1, x2), Math.min(y1, y2)],
                [Math.max(x1, x2), Math.max(y1, y2)],
                [Math.min(x1, x2), Math.max(y1, y2)],
              ]);
            }
          } else if (gesture.current.moved < 10 && quick) {
            handleTap(locationX, locationY);
          }

          gesture.current.drag = null;
          setRectDraft(null);
          setPointer(null);
        },

        onPanResponderTerminate: () => {
          gesture.current.drag = null;
          setRectDraft(null);
          setPointer(null);
        },
      }),
    // Recreated whenever the drawing context changes so the closure never
    // captures stale rooms/draft state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tool, rooms, openings, draft, snapToGrid, width, height, rectDraft, selectedRoom],
  );

  const gridLines = useMemo(() => {
    const lines = [];
    for (let x = 0; x <= width + 0.5; x += gridStep) {
      lines.push({ key: `v${Math.round(x)}`, x1: x, y1: 0, x2: x, y2: height, major: Math.round(x / gridStep) % 2 === 0 });
    }
    for (let y = 0; y <= height + 0.5; y += gridStep) {
      lines.push({ key: `h${Math.round(y)}`, x1: 0, y1: y, x2: width, y2: y, major: Math.round(y / gridStep) % 2 === 0 });
    }
    return lines;
  }, [gridStep, height, width]);

  const snappedPointer = pointer && (tool === "room" || tool === "rect") ? snapPoint(pointer) : pointer;

  const rectPreview = rectDraft
    ? {
        x: Math.min(rectDraft.from[0], rectDraft.to[0]),
        y: Math.min(rectDraft.from[1], rectDraft.to[1]),
        w: Math.abs(rectDraft.to[0] - rectDraft.from[0]),
        h: Math.abs(rectDraft.to[1] - rectDraft.from[1]),
      }
    : null;

  return (
    <View style={[styles.canvas, { width, height }]} {...responder.panHandlers}>
      <Svg width={width} height={height}>
        <Rect x={0} y={0} width={width} height={height} fill={COLORS.surface} />
        <G opacity={0.6}>
          {gridLines.map((line) => (
            <Line
              key={line.key}
              x1={line.x1}
              y1={line.y1}
              x2={line.x2}
              y2={line.y2}
              stroke={line.major ? COLORS.border : COLORS.surfaceSunken}
              strokeWidth={line.major ? 1 : 0.75}
            />
          ))}
        </G>

        {rooms.map((room, index) => {
          const centroid = polygonCentroid(room);
          const areaMeters = polygonArea(room) / (pixelsPerMeter * pixelsPerMeter);
          const tint = ROOM_TINTS[index % ROOM_TINTS.length];
          const active = selectedRoom === index;
          return (
            <G key={`room-${index}`}>
              <Polygon
                points={room.map((point) => point.join(",")).join(" ")}
                fill={tint.fill}
                stroke={tint.stroke}
                strokeWidth={active ? 4 : 2.5}
                strokeLinejoin="round"
              />
              <SvgText x={centroid[0]} y={centroid[1] - 1} fill={COLORS.textPrimary} fontSize={11.5} fontWeight="600" textAnchor="middle">
                {roomLabels[index] || `Room ${index + 1}`}
              </SvgText>
              <SvgText x={centroid[0]} y={centroid[1] + 13} fill={COLORS.textSecondary} fontSize={10} textAnchor="middle">
                {`${areaMeters.toFixed(1)} m²`}
              </SvgText>
            </G>
          );
        })}

        {openings.map((opening, index) => {
          const spec = OPENING_SPECS[opening.kind] || OPENING_SPECS.door;
          return (
            <G key={`opening-${index}`}>
              <Line
                x1={opening.points[0][0]}
                y1={opening.points[0][1]}
                x2={opening.points[1][0]}
                y2={opening.points[1][1]}
                stroke={COLORS.surface}
                strokeWidth={9}
                strokeLinecap="round"
              />
              <Line
                x1={opening.points[0][0]}
                y1={opening.points[0][1]}
                x2={opening.points[1][0]}
                y2={opening.points[1][1]}
                stroke={spec.color}
                strokeWidth={5}
                strokeLinecap="round"
              />
            </G>
          );
        })}

        {/* Edit handles: only on the selected room, and only while the select
            tool is active, so they never clutter the drawing tools. */}
        {tool === "select" && rooms[selectedRoom] && (
          <G>
            {rooms[selectedRoom].map((corner, index) => (
              <Circle
                key={`handle-${index}`}
                cx={corner[0]}
                cy={corner[1]}
                r={7}
                fill={COLORS.surface}
                stroke={COLORS.accent}
                strokeWidth={2.5}
              />
            ))}
          </G>
        )}

        {rectPreview && (
          <G>
            <Rect
              x={rectPreview.x}
              y={rectPreview.y}
              width={rectPreview.w}
              height={rectPreview.h}
              fill="rgba(92,138,114,0.16)"
              stroke={COLORS.primaryDark}
              strokeWidth={2.5}
              strokeDasharray="8 5"
            />
            <SvgText
              x={rectPreview.x + rectPreview.w / 2}
              y={rectPreview.y + rectPreview.h / 2 + 4}
              fill={COLORS.primaryDark}
              fontSize={12}
              fontWeight="600"
              textAnchor="middle"
            >
              {`${metres(rectPreview.w).toFixed(1)} × ${metres(rectPreview.h).toFixed(1)} m`}
            </SvgText>
          </G>
        )}

        {draft.length > 0 && (
          <G>
            <Polyline
              points={[...draft, ...(snappedPointer && tool === "room" ? [snappedPointer] : [])].map((point) => point.join(",")).join(" ")}
              fill="none"
              stroke={COLORS.primaryDark}
              strokeWidth={2.5}
              strokeDasharray="8 5"
              strokeLinejoin="round"
            />
            {draft.map((point, index) => {
              const next = draft[index + 1];
              return (
                <G key={`draft-${index}`}>
                  {next && (
                    <SvgText
                      x={(point[0] + next[0]) / 2}
                      y={(point[1] + next[1]) / 2 - 6}
                      fill={COLORS.primaryDark}
                      fontSize={10}
                      fontWeight="600"
                      textAnchor="middle"
                    >
                      {`${metres(Math.hypot(next[0] - point[0], next[1] - point[1])).toFixed(1)} m`}
                    </SvgText>
                  )}
                  <Circle
                    cx={point[0]}
                    cy={point[1]}
                    r={index === 0 ? 7.5 : 4.5}
                    fill={index === 0 ? COLORS.primaryDark : COLORS.surface}
                    stroke={COLORS.primaryDark}
                    strokeWidth={2}
                  />
                </G>
              );
            })}
          </G>
        )}

        {snappedPointer && (
          <G opacity={0.85}>
            <Line x1={snappedPointer[0]} y1={0} x2={snappedPointer[0]} y2={height} stroke={COLORS.accent} strokeWidth={0.9} strokeDasharray="4 6" />
            <Line x1={0} y1={snappedPointer[1]} x2={width} y2={snappedPointer[1]} stroke={COLORS.accent} strokeWidth={0.9} strokeDasharray="4 6" />
            <Circle cx={snappedPointer[0]} cy={snappedPointer[1]} r={6.5} fill="none" stroke={COLORS.accent} strokeWidth={2} />
          </G>
        )}
      </Svg>

      {rooms.length === 0 && draft.length === 0 && !rectDraft && (
        <View style={styles.empty} pointerEvents="none">
          <Text style={styles.emptyTitle}>
            {tool === "rect" ? "Drag to draw a room" : "Tap to place each corner"}
          </Text>
          <Text style={styles.emptyBody}>Each square is half a metre</Text>
        </View>
      )}

      <View style={styles.scaleBadge} pointerEvents="none">
        <View style={[styles.scaleBar, { width: gridStep * 2 }]} />
        <Text style={styles.scaleLabel}>1 m</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    borderRadius: RADIUS.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  empty: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  emptyTitle: { ...TYPE.bodyStrong, color: COLORS.textSecondary },
  emptyBody: { ...TYPE.caption, color: COLORS.textTertiary },
  scaleBadge: {
    position: "absolute",
    left: 10,
    bottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.92)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: RADIUS.pill,
  },
  scaleBar: { height: 3, backgroundColor: COLORS.textSecondary, borderRadius: 2 },
  scaleLabel: { ...TYPE.caption, color: COLORS.textSecondary },
});
