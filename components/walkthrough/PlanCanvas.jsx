import React, { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, PanResponder, StyleSheet, Text, View } from "react-native";
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
 * Uploaded plans use the detector's estimated pixels-per-metre scale; blank
 * plans use a fixed 0.5 m grid. Both paths therefore hand measured geometry to
 * the 3D renderer and share the same room/opening editing controls.
 *
 * Coordinates are stored in canvas pixels (what the renderer expects) and
 * converted to metres only for on-screen labels.
 */

export const PLAN_WIDTH_METERS = 12;
export const GRID_METERS = 0.5;

export const OPENING_SPECS = {
  door: { meters: 0.9, minimumMeters: 0.9, color: "#AE6740", label: "Door" },
  window: { meters: 1.2, minimumMeters: 0.7, color: "#2C6089", label: "Window" },
  balcony: { meters: 1.8, minimumMeters: 0.9, color: "#2E7350", label: "Balcony" },
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

/**
 * Project a user-drawn opening onto one wall while preserving its requested
 * length. This is the mobile equivalent of the web studio's opening editor:
 * a short stroke becomes the minimum valid opening, while a long stroke can
 * create a double door, wide opening, window wall, or balcony slider.
 */
export function snapOpeningToNearestWall(opening, rooms, kind, pixelsPerMeter) {
  if (!opening?.[0] || !opening?.[1] || !rooms?.length) return null;
  const [start, end] = opening;
  const midpoint = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
  const drawn = [end[0] - start[0], end[1] - start[1]];
  const drawnLength = Math.max(0.001, Math.hypot(drawn[0], drawn[1]));
  const spec = OPENING_SPECS[kind] || OPENING_SPECS.door;
  const margin = Math.max(2, pixelsPerMeter * 0.05);
  let best = null;

  rooms.forEach((room) => room.forEach((edgeStart, index) => {
    const edgeEnd = room[(index + 1) % room.length];
    const edge = [edgeEnd[0] - edgeStart[0], edgeEnd[1] - edgeStart[1]];
    const length = Math.hypot(edge[0], edge[1]);
    if (length < margin * 2 + 1) return;
    const direction = [edge[0] / length, edge[1] / length];
    const midpointT = Math.max(0, Math.min(
      length,
      (midpoint[0] - edgeStart[0]) * direction[0] + (midpoint[1] - edgeStart[1]) * direction[1],
    ));
    const nearest = [edgeStart[0] + direction[0] * midpointT, edgeStart[1] + direction[1] * midpointT];
    const distance = Math.hypot(midpoint[0] - nearest[0], midpoint[1] - nearest[1]);
    const alignment = Math.abs((drawn[0] * direction[0] + drawn[1] * direction[1]) / drawnLength);
    const score = distance + (1 - alignment) * pixelsPerMeter * 0.45;
    if (!best || score < best.score) best = { edgeStart, direction, length, midpointT, score };
  }));

  if (!best || best.score > pixelsPerMeter * 1.25) return null;
  const projectedStart = (start[0] - best.edgeStart[0]) * best.direction[0]
    + (start[1] - best.edgeStart[1]) * best.direction[1];
  const projectedEnd = (end[0] - best.edgeStart[0]) * best.direction[0]
    + (end[1] - best.edgeStart[1]) * best.direction[1];
  const requestedLength = Math.max(
    Math.abs(projectedEnd - projectedStart),
    spec.minimumMeters * pixelsPerMeter,
  );
  const openingLength = Math.min(requestedLength, Math.max(1, best.length - margin * 2));
  const centre = Math.max(
    margin + openingLength / 2,
    Math.min(best.length - margin - openingLength / 2, best.midpointT),
  );
  const from = centre - openingLength / 2;
  const to = centre + openingLength / 2;
  return [
    [best.edgeStart[0] + best.direction[0] * from, best.edgeStart[1] + best.direction[1] * from],
    [best.edgeStart[0] + best.direction[0] * to, best.edgeStart[1] + best.direction[1] * to],
  ];
}

export default function PlanCanvas({
  width,
  height,
  pixelsPerMeter: suppliedPixelsPerMeter,
  imageUri,
  detecting = false,
  tool,
  rooms,
  roomLabels = [],
  openings,
  draft,
  snapToGrid = true,
  selectedRoom,
  selection,
  onAddVertex,
  onCloseRoom,
  onAddRoom,
  onAddOpening,
  onRemoveOpening,
  onSelectRoom,
  onMoveRoom,
  onMoveVertex,
  onInsertVertex,
  onMoveOpening,
  onMoveOpeningPoint,
  onSelectShape,
  onBeginEdit,
}) {
  const [pointer, setPointer] = useState(null);
  const [rectDraft, setRectDraft] = useState(null);
  const [openingDraft, setOpeningDraft] = useState(null);
  const gesture = useRef({ x: 0, y: 0, moved: 0, startedAt: 0, drag: null, lastX: 0, lastY: 0, historyStarted: false });

  const pixelsPerMeter = suppliedPixelsPerMeter || width / PLAN_WIDTH_METERS;
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
    if (tool === "select") {
      const target = hitTest(raw);
      if (target?.kind === "room") {
        onSelectRoom?.(target.index);
        onSelectShape?.("room", target.index);
      } else if (target?.kind === "vertex" || target?.kind === "insertVertex") {
        onSelectRoom?.(target.room);
        onSelectShape?.("room", target.room);
      } else if (target?.kind === "opening" || target?.kind === "openingEndpoint") {
        onSelectShape?.("opening", target.index);
      } else {
        onSelectShape?.(null, -1);
      }
      return;
    }
    if (tool === "rect") {
      const hit = rooms.findIndex((room) => pointInPolygon(raw, room));
      if (hit >= 0) {
        onSelectRoom?.(hit);
        onSelectShape?.("room", hit);
      } else {
        onSelectShape?.(null, -1);
      }
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
    if (selection?.kind === "opening" && openings[selection.index]) {
      const endpoint = openings[selection.index].points.findIndex(
        (value) => Math.hypot(value[0] - point[0], value[1] - point[1]) <= gridStep * 0.72,
      );
      if (endpoint >= 0) return { kind: "openingEndpoint", index: selection.index, pointIndex: endpoint };
    }
    const room = rooms[selectedRoom];
    if (room) {
      const vertex = room.findIndex((corner) => Math.hypot(corner[0] - point[0], corner[1] - point[1]) <= gridStep * 0.7);
      if (vertex >= 0) return { kind: "vertex", room: selectedRoom, index: vertex };
      const edge = room.findIndex((corner, index) => {
        const next = room[(index + 1) % room.length];
        const midpoint = [(corner[0] + next[0]) / 2, (corner[1] + next[1]) / 2];
        return Math.hypot(midpoint[0] - point[0], midpoint[1] - point[1]) <= gridStep * 0.48;
      });
      if (edge >= 0) {
        const start = room[edge];
        const end = room[(edge + 1) % room.length];
        return {
          kind: "insertVertex",
          room: selectedRoom,
          index: edge + 1,
          point: [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2],
        };
      }
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
            historyStarted: false,
          };
          setPointer(point);

          if (tool === "rect") {
            setRectDraft({ from: snapPoint(point), to: snapPoint(point) });
            return;
          }
          if (tool === "select") {
            const hit = hitTest(point);
            gesture.current.drag = hit;
            if (hit?.kind === "room") {
              if (hit.index !== selectedRoom) onSelectRoom?.(hit.index);
              onSelectShape?.("room", hit.index);
            } else if (hit?.kind === "vertex") {
              onSelectShape?.("room", hit.room);
            } else if (hit?.kind === "insertVertex") {
              onSelectShape?.("room", hit.room);
              onBeginEdit?.();
              gesture.current.historyStarted = true;
              onInsertVertex?.(hit.room, hit.index, hit.point);
              gesture.current.drag = { kind: "vertex", room: hit.room, index: hit.index };
            } else if (hit?.kind === "opening" || hit?.kind === "openingEndpoint") {
              onSelectShape?.("opening", hit.index);
            } else {
              onSelectShape?.(null, -1);
            }
            return;
          }
          if (OPENING_SPECS[tool]) {
            setOpeningDraft({ from: point, to: point, kind: tool });
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

          if (OPENING_SPECS[tool]) {
            setOpeningDraft((current) => (current ? { ...current, to: point } : current));
            return;
          }

          const drag = gesture.current.drag;
          if (tool !== "select" || !drag || gesture.current.moved < 8) return;

          if (!gesture.current.historyStarted) {
            gesture.current.historyStarted = true;
            onBeginEdit?.();
          }

          if (drag.kind === "vertex") {
            onMoveVertex?.(drag.room, drag.index, snapPoint(point));
          } else if (drag.kind === "opening") {
            onMoveOpening?.(drag.index, point);
          } else if (drag.kind === "openingEndpoint") {
            onMoveOpeningPoint?.(drag.index, drag.pointIndex, point);
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
          } else if (OPENING_SPECS[tool] && openingDraft && gesture.current.moved >= 10) {
            const placed = snapOpeningToNearestWall(
              [openingDraft.from, [clampX(locationX), clampY(locationY)]],
              rooms,
              tool,
              pixelsPerMeter,
            );
            if (placed) onAddOpening?.({ kind: tool, points: placed });
          } else if (gesture.current.moved < 10 && quick) {
            handleTap(locationX, locationY);
          }

          gesture.current.drag = null;
          setRectDraft(null);
          setOpeningDraft(null);
          setPointer(null);
        },

        onPanResponderTerminate: () => {
          gesture.current.drag = null;
          setRectDraft(null);
          setOpeningDraft(null);
          setPointer(null);
        },
      }),
    // Recreated whenever the drawing context changes so the closure never
    // captures stale rooms/draft state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tool, rooms, openings, draft, snapToGrid, width, height, suppliedPixelsPerMeter, rectDraft, openingDraft, selectedRoom, selection],
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
      {imageUri ? <Image source={{ uri: imageUri }} style={StyleSheet.absoluteFill} resizeMode="stretch" /> : null}
      <Svg width={width} height={height}>
        <Rect x={0} y={0} width={width} height={height} fill={imageUri ? "rgba(255,255,255,0.08)" : COLORS.surface} />
        <G opacity={imageUri ? 0.18 : 0.6}>
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
          const active = selection?.kind === "room" ? selection.index === index : selectedRoom === index;
          return (
            <G key={`room-${index}`}>
              <Polygon
                points={room.map((point) => point.join(",")).join(" ")}
                fill={imageUri ? tint.fill.replace(/0\.(1[68]|22)/, "0.10") : tint.fill}
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
          const active = selection?.kind === "opening" && selection.index === index;
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
                strokeWidth={active ? 7 : 5}
                strokeLinecap="round"
              />
            </G>
          );
        })}

        {/* Edit handles: only on the selected room, and only while the select
            tool is active, so they never clutter the drawing tools. */}
        {tool === "select" && selection?.kind !== "opening" && rooms[selectedRoom] && (
          <G>
            {rooms[selectedRoom].map((corner, index) => {
              const next = rooms[selectedRoom][(index + 1) % rooms[selectedRoom].length];
              return (
                <Circle
                  key={`midpoint-${index}`}
                  cx={(corner[0] + next[0]) / 2}
                  cy={(corner[1] + next[1]) / 2}
                  r={4.5}
                  fill={COLORS.primaryTint}
                  stroke={COLORS.primary}
                  strokeWidth={1.5}
                />
              );
            })}
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

        {tool === "select" && selection?.kind === "opening" && openings[selection.index] && (
          <G>
            {openings[selection.index].points.map((point, index) => (
              <Circle key={`opening-handle-${index}`} cx={point[0]} cy={point[1]} r={8} fill={COLORS.surface} stroke={COLORS.accent} strokeWidth={2.5} />
            ))}
          </G>
        )}

        {openingDraft && (
          <Line
            x1={openingDraft.from[0]}
            y1={openingDraft.from[1]}
            x2={openingDraft.to[0]}
            y2={openingDraft.to[1]}
            stroke={(OPENING_SPECS[openingDraft.kind] || OPENING_SPECS.door).color}
            strokeWidth={6}
            strokeLinecap="round"
            strokeDasharray="8 5"
          />
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

      {rooms.length === 0 && draft.length === 0 && !rectDraft && !imageUri && (
        <View style={styles.empty} pointerEvents="none">
          <Text style={styles.emptyTitle}>
            {tool === "rect" ? "Drag to draw a room" : "Tap to place each corner"}
          </Text>
          <Text style={styles.emptyBody}>Each square is half a metre</Text>
        </View>
      )}


      {detecting && (
        <View style={styles.detecting} pointerEvents="none">
          <ActivityIndicator color={COLORS.white} />
          <Text style={styles.detectingText}>Detecting editable rooms and openings…</Text>
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
  detecting: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "rgba(24,35,31,0.62)",
  },
  detectingText: { ...TYPE.small, color: COLORS.white },
});
