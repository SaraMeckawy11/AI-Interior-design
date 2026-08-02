import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, {
  Circle,
  G,
  Image as SvgImage,
  Line,
  Polygon,
  Polyline,
  Rect,
  Text as SvgText,
} from "react-native-svg";

import COLORS from "../../constants/colors";
import { RADIUS, SHADOW, TYPE } from "../../constants/theme";

/**
 * Measured floor-plan canvas.
 *
 * The plan lives on a fixed "sheet" that is measured in real metres at a fixed
 * scale (`PLAN_PIXELS_PER_METER`). The sheet is deliberately larger than the
 * phone viewport: the canvas is a camera onto it, not a squeezed-down picture
 * of it. That is what keeps a half-metre grid square finger-sized, keeps room
 * areas identical on every device, and lets the plan be zoomed and dragged.
 *
 * Coordinates are stored in sheet pixels (what the 3D renderer expects) and
 * converted to metres only for on-screen labels.
 */

export const PLAN_WIDTH_METERS = 15;
// A deeper 15 m × 13 m workspace covers a whole apartment floor. Anything the
// user draws inside it is measured, so the sheet size is a limit, not a scale.
export const PLAN_HEIGHT_METERS = 13;
export const GRID_METERS = 0.5;

/**
 * The one number that fixes room areas.
 *
 * Previously the scale was derived from the phone's screen width, so the same
 * gesture produced a 120 m² living room on a small phone and a different area
 * on a large one — and every room came out far too big for its furniture. A
 * fixed 46 px per metre means a half-metre grid square is a comfortable 23 px
 * at 100% zoom and a drawn room lands in a believable range.
 */
export const PLAN_PIXELS_PER_METER = 46;
export const SHEET_WIDTH = PLAN_WIDTH_METERS * PLAN_PIXELS_PER_METER;
export const SHEET_HEIGHT = PLAN_HEIGHT_METERS * PLAN_PIXELS_PER_METER;

export const MAX_ZOOM = 4;

export const DEFAULT_CURVE_SETTINGS = {
  direction: 1,
  angle: 0,
  intensity: 45,
  position: 50,
};

export function buildCurveGeometry(start, end, settings = DEFAULT_CURVE_SETTINGS) {
  if (!start || !end) return null;
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (length < 0.001) return null;
  const position = Math.max(0.15, Math.min(0.85, Number(settings.position) / 100));
  const base = [start[0] + dx * position, start[1] + dy * position];
  const offsetAngle = Math.atan2(dy, dx) + Math.PI / 2 + (Number(settings.angle) * Math.PI) / 180;
  const offset = length * 0.65 * (Number(settings.intensity) / 100) * (Number(settings.direction) || 1);
  const control = [base[0] + Math.cos(offsetAngle) * offset, base[1] + Math.sin(offsetAngle) * offset];
  const sampleCount = Math.max(12, Math.min(28, Math.ceil(length / 18)));
  const samples = Array.from({ length: sampleCount }, (_, index) => {
    const t = (index + 1) / sampleCount;
    const oneMinus = 1 - t;
    return [
      oneMinus ** 2 * start[0] + 2 * oneMinus * t * control[0] + t ** 2 * end[0],
      oneMinus ** 2 * start[1] + 2 * oneMinus * t * control[1] + t ** 2 * end[1],
    ];
  });
  return { control, samples };
}

/**
 * `meters` is only the width used when an opening is *tapped* into place.
 * `minimumMeters` is a floor low enough to stay out of the way — a plan may
 * legitimately contain a 0.4 m slot window or a narrow balcony door, and the
 * previous 0.7–0.9 m floors quietly widened those back up. Width is otherwise
 * whatever the user drew or typed, bounded only by the wall it sits on.
 */
export const OPENING_SPECS = {
  door: { meters: 0.9, minimumMeters: 0.4, color: "#AE6740", label: "Door" },
  window: { meters: 1.2, minimumMeters: 0.3, color: "#2C6089", label: "Window" },
  balcony: { meters: 1.8, minimumMeters: 0.4, color: "#2E7350", label: "Balcony" },
};

export const OPENING_MIN_METERS = 0.3;

export const OPENING_VARIANTS = {
  door: [
    { label: "Single", meters: 0.9, height: 2.1 },
    { label: "Double", meters: 1.6, height: 2.1 },
    { label: "Open passage", meters: 1.4, height: 2.18 },
    // Floor to ceiling, so no lintel is built: this is how a room is opened
    // into the next one rather than given a door.
    { label: "Wall opening", meters: 2.6, height: 2.8 },
  ],
  window: [
    { label: "Slot", meters: 0.5, sillHeight: 1.2, height: 0.7 },
    { label: "Standard", meters: 1.2, sillHeight: 0.82, height: 1.24 },
    { label: "Picture", meters: 1.8, sillHeight: 0.72, height: 1.4 },
    { label: "Wide", meters: 2.4, sillHeight: 0.72, height: 1.4 },
  ],
  balcony: [
    { label: "Narrow", meters: 0.8, height: 2.32 },
    { label: "French", meters: 1.4, height: 2.32 },
    { label: "Sliding", meters: 1.8, height: 2.38 },
    { label: "Wide slider", meters: 2.8, height: 2.38 },
  ],
};

export function openingDefaults(kind, variantLabel) {
  const variants = OPENING_VARIANTS[kind] || OPENING_VARIANTS.door;
  const variant = variants.find((item) => item.label === variantLabel) || variants[0];
  return { variant: variant.label, height: variant.height, sillHeight: variant.sillHeight };
}

/**
 * The variant whose head height and sill suit a given width.
 *
 * Dragging a 3 m stroke used to produce something still labelled "Single door"
 * at door height, so a wide pass-through was rendered as an absurd doorway.
 * Picking the nearest variant by width keeps the drawn size *and* gives it a
 * sensible section.
 */
export function variantForWidth(kind, meters) {
  const variants = OPENING_VARIANTS[kind] || OPENING_VARIANTS.door;
  return variants.reduce(
    (best, item) => (Math.abs(item.meters - meters) < Math.abs(best.meters - meters) ? item : best),
    variants[0],
  ).label;
}

export function openingWidthMeters(opening, pixelsPerMeter) {
  if (!opening?.points?.[0] || !opening?.points?.[1]) return 0;
  return Math.hypot(
    opening.points[1][0] - opening.points[0][0],
    opening.points[1][1] - opening.points[0][1],
  ) / pixelsPerMeter;
}

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

/** Axis-aligned bounds, used by the metre-accurate room resize controls. */
export function polygonBounds(points = []) {
  if (!points.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
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
  sheetWidth = SHEET_WIDTH,
  sheetHeight = SHEET_HEIGHT,
  pixelsPerMeter: suppliedPixelsPerMeter,
  imageUri,
  detecting = false,
  tool,
  rooms,
  roomLabels = [],
  openings,
  draft,
  snapToGrid = true,
  roomEdgeType = "straight",
  curveSettings = DEFAULT_CURVE_SETTINGS,
  curveControl = null,
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
  onSetCurveControl,
  onBeginEdit,
}) {
  const [pointer, setPointer] = useState(null);
  const [rectDraft, setRectDraft] = useState(null);
  const [openingDraft, setOpeningDraft] = useState(null);

  const fitZoom = Math.min(width / sheetWidth, height / sheetHeight);
  const minZoom = Math.min(1, fitZoom * 0.85);
  const [viewport, setViewport] = useState(() => ({
    zoom: 1,
    x: (sheetWidth - width) / 2,
    y: (sheetHeight - height) / 2,
  }));
  const viewportRef = useRef(viewport);
  const gesture = useRef({
    moved: 0,
    drag: null,
    lastX: 0,
    lastY: 0,
    historyStarted: false,
    rectDraft: null,
    openingDraft: null,
    viewport: null,
    pinch: null,
  });

  const pixelsPerMeter = suppliedPixelsPerMeter || PLAN_PIXELS_PER_METER;
  const gridStep = pixelsPerMeter * GRID_METERS;
  const zoom = viewport.zoom;
  // Everything drawn inside the SVG lives in sheet units, so on-screen sizes
  // have to be divided by the zoom to stay finger- and eye-sized.
  const px = (value) => value / zoom;
  // Touch tolerance is generous, and grows when zoomed out so handles stay
  // grabbable rather than becoming pixel-hunting.
  const touchSlop = Math.max(gridStep * 0.55, 20 / zoom);

  const snap = (value) => (snapToGrid ? Math.round(value / gridStep) * gridStep : value);
  const clampX = (value) => Math.max(0, Math.min(sheetWidth, value));
  const clampY = (value) => Math.max(0, Math.min(sheetHeight, value));
  const snapPoint = (point) => [clampX(snap(point[0])), clampY(snap(point[1]))];
  const metres = (pixels) => pixels / pixelsPerMeter;

  const clampViewport = useCallback(
    (next) => {
      const nextZoom = Math.max(minZoom, Math.min(MAX_ZOOM, Number(next.zoom) || 1));
      const visibleWidth = width / nextZoom;
      const visibleHeight = height / nextZoom;
      // Half a screen of pasteboard in every direction: edges of the plan can be
      // dragged into the middle of the viewport instead of being pinned against
      // the bezel where fingers and toolbars get in the way.
      const marginX = visibleWidth * 0.5;
      const marginY = visibleHeight * 0.5;
      return {
        zoom: nextZoom,
        x: Math.max(-marginX, Math.min(sheetWidth - visibleWidth + marginX, Number(next.x) || 0)),
        y: Math.max(-marginY, Math.min(sheetHeight - visibleHeight + marginY, Number(next.y) || 0)),
      };
    },
    [height, minZoom, sheetHeight, sheetWidth, width],
  );

  const updateViewport = useCallback(
    (next) => {
      const clamped = clampViewport(next);
      viewportRef.current = clamped;
      setViewport(clamped);
    },
    [clampViewport],
  );

  const zoomAt = useCallback(
    (nextZoom, screenX = width / 2, screenY = height / 2) => {
      const current = viewportRef.current;
      const anchorX = current.x + screenX / current.zoom;
      const anchorY = current.y + screenY / current.zoom;
      const clamped = Math.max(minZoom, Math.min(MAX_ZOOM, nextZoom));
      updateViewport({
        zoom: clamped,
        x: anchorX - screenX / clamped,
        y: anchorY - screenY / clamped,
      });
    },
    [height, minZoom, updateViewport, width],
  );

  const fitToSheet = useCallback(() => {
    updateViewport({
      zoom: fitZoom,
      x: (sheetWidth - width / fitZoom) / 2,
      y: (sheetHeight - height / fitZoom) / 2,
    });
  }, [fitZoom, height, sheetHeight, sheetWidth, updateViewport, width]);

  const screenToPlan = (x, y) => {
    const current = viewportRef.current;
    return [clampX(current.x + x / current.zoom), clampY(current.y + y / current.zoom)];
  };

  // Re-centre only when a different sheet is loaded, never on every re-render:
  // otherwise the plan would snap back while the user was working on it.
  useEffect(() => {
    updateViewport({
      zoom: Math.max(minZoom, Math.min(1, MAX_ZOOM)),
      x: (sheetWidth - width) / 2,
      y: (sheetHeight - height) / 2,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetWidth, sheetHeight, imageUri]);

  // Growing or shrinking the viewport (expanding into focus mode, rotating the
  // device) keeps the current framing but has to respect the new pan limits.
  useEffect(() => {
    updateViewport(viewportRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]);

  const handleTap = (x, y) => {
    const raw = screenToPlan(x, y);
    if (tool === "room") {
      const point = snapPoint(raw);
      const first = draft[0];
      if (!curveControl && draft.length >= 3 && first
        && Math.hypot(point[0] - first[0], point[1] - first[1]) <= touchSlop) {
        onCloseRoom?.();
        return;
      }
      if (!draft.length || roomEdgeType !== "rounded") {
        onAddVertex?.(point);
        return;
      }
      // Rounded walls are staged exactly like the web studio: the tap sets the
      // far end of the wall, the shape is then adjusted live and applied.
      onSetCurveControl?.(point);
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
      (opening) => projectOnSegment(raw, opening.points[0], opening.points[1]).distance < touchSlop,
    );
    if (existing >= 0) {
      onRemoveOpening?.(existing);
      return;
    }
    const placed = openingOnNearestWall(raw, rooms, spec.meters * pixelsPerMeter, touchSlop * 2.4);
    if (placed) onAddOpening?.({ kind: tool, points: placed, ...openingDefaults(tool) });
  };

  /**
   * What is under the finger, in priority order. A vertex handle beats the room
   * it belongs to, and an opening beats the room it is cut into — otherwise
   * neither would ever be grabbable, since both sit inside a room's area.
   */
  const hitTest = (point) => {
    if (selection?.kind === "opening" && openings[selection.index]) {
      const endpoint = openings[selection.index].points.findIndex(
        (value) => Math.hypot(value[0] - point[0], value[1] - point[1]) <= touchSlop,
      );
      if (endpoint >= 0) return { kind: "openingEndpoint", index: selection.index, pointIndex: endpoint };
    }
    const room = rooms[selectedRoom];
    if (room) {
      const vertex = room.findIndex((corner) => Math.hypot(corner[0] - point[0], corner[1] - point[1]) <= touchSlop);
      if (vertex >= 0) return { kind: "vertex", room: selectedRoom, index: vertex };
      const edge = room.findIndex((corner, index) => {
        const next = room[(index + 1) % room.length];
        const midpoint = [(corner[0] + next[0]) / 2, (corner[1] + next[1]) / 2];
        return Math.hypot(midpoint[0] - point[0], midpoint[1] - point[1]) <= touchSlop * 0.7;
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
      (item) => projectOnSegment(point, item.points[0], item.points[1]).distance < touchSlop * 0.8,
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
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,

        onPanResponderGrant: (event) => {
          const { locationX, locationY } = event.nativeEvent;
          const point = screenToPlan(locationX, locationY);
          gesture.current = {
            moved: 0,
            drag: null,
            lastX: locationX,
            lastY: locationY,
            historyStarted: false,
            rectDraft: null,
            openingDraft: null,
            viewport: { ...viewportRef.current },
            pinch: null,
          };
          setPointer(point);

          if (tool === "pan") return;

          if (tool === "rect") {
            const nextDraft = { from: snapPoint(point), to: snapPoint(point) };
            gesture.current.rectDraft = nextDraft;
            setRectDraft(nextDraft);
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
            const nextDraft = { from: point, to: point, kind: tool };
            gesture.current.openingDraft = nextDraft;
            setOpeningDraft(nextDraft);
          }
        },

        onPanResponderMove: (event, state) => {
          const touches = event.nativeEvent.touches || [];

          // Two fingers always mean "move the camera", whichever tool is armed.
          // Being able to reframe without leaving the drawing tool is the single
          // biggest difference between a canvas that feels alive and one that
          // feels nailed down.
          if (touches.length >= 2) {
            const distance = Math.max(
              1,
              Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY),
            );
            // Some platforms omit locationX on the individual touches; zooming
            // about the centre of the canvas is a safe fallback.
            const focusX = Number.isFinite(touches[0].locationX) && Number.isFinite(touches[1].locationX)
              ? (touches[0].locationX + touches[1].locationX) / 2
              : width / 2;
            const focusY = Number.isFinite(touches[0].locationY) && Number.isFinite(touches[1].locationY)
              ? (touches[0].locationY + touches[1].locationY) / 2
              : height / 2;
            if (!gesture.current.pinch) {
              gesture.current.pinch = {
                distance,
                zoom: viewportRef.current.zoom,
                focusX,
                focusY,
                viewport: { ...viewportRef.current },
              };
            } else {
              const pinch = gesture.current.pinch;
              const nextZoom = Math.max(minZoom, Math.min(MAX_ZOOM, pinch.zoom * (distance / pinch.distance)));
              const anchorX = pinch.viewport.x + pinch.focusX / pinch.zoom;
              const anchorY = pinch.viewport.y + pinch.focusY / pinch.zoom;
              updateViewport({
                zoom: nextZoom,
                x: anchorX - focusX / nextZoom,
                y: anchorY - focusY / nextZoom,
              });
            }
            gesture.current.moved = 999;
            gesture.current.drag = null;
            gesture.current.rectDraft = null;
            gesture.current.openingDraft = null;
            setRectDraft(null);
            setOpeningDraft(null);
            setPointer(null);
            return;
          }

          gesture.current.moved = Math.max(gesture.current.moved, Math.abs(state.dx) + Math.abs(state.dy));
          const { locationX, locationY } = event.nativeEvent;

          if (tool === "pan") {
            const start = gesture.current.viewport || viewportRef.current;
            updateViewport({
              ...start,
              x: start.x - state.dx / start.zoom,
              y: start.y - state.dy / start.zoom,
            });
            setPointer(null);
            return;
          }

          const point = screenToPlan(locationX, locationY);
          setPointer(point);

          if (tool === "rect") {
            const current = gesture.current.rectDraft;
            if (current) {
              const nextDraft = { ...current, to: snapPoint(point) };
              gesture.current.rectDraft = nextDraft;
              setRectDraft(nextDraft);
            }
            return;
          }

          if (OPENING_SPECS[tool]) {
            const current = gesture.current.openingDraft;
            if (current) {
              const nextDraft = { ...current, to: point };
              gesture.current.openingDraft = nextDraft;
              setOpeningDraft(nextDraft);
            }
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
            onMoveRoom?.(
              drag.index,
              (locationX - gesture.current.lastX) / viewportRef.current.zoom,
              (locationY - gesture.current.lastY) / viewportRef.current.zoom,
            );
          }
          gesture.current.lastX = locationX;
          gesture.current.lastY = locationY;
        },

        onPanResponderRelease: (event) => {
          const { locationX, locationY } = event.nativeEvent;
          const releasePoint = screenToPlan(locationX, locationY);
          const activeRectDraft = gesture.current.rectDraft;
          const activeOpeningDraft = gesture.current.openingDraft;
          const moved = gesture.current.moved;

          if (tool === "pan" || gesture.current.pinch) {
            // The gesture only changed the viewport.
          } else if (tool === "rect" && activeRectDraft && moved >= 8) {
            const [x1, y1] = activeRectDraft.from;
            const [x2, y2] = snapPoint(releasePoint);
            const minSide = gridStep;
            if (Math.abs(x2 - x1) >= minSide && Math.abs(y2 - y1) >= minSide) {
              onAddRoom?.([
                [Math.min(x1, x2), Math.min(y1, y2)],
                [Math.max(x1, x2), Math.min(y1, y2)],
                [Math.max(x1, x2), Math.max(y1, y2)],
                [Math.min(x1, x2), Math.max(y1, y2)],
              ]);
            } else {
              // Too small to be a room: treat the stroke as a tap so the gesture
              // is never silently swallowed.
              handleTap(locationX, locationY);
            }
          } else if (OPENING_SPECS[tool] && activeOpeningDraft && moved >= 8) {
            const placed = snapOpeningToNearestWall(
              [activeOpeningDraft.from, releasePoint],
              rooms,
              tool,
              pixelsPerMeter,
            );
            if (placed) {
              // Keep the width that was actually drawn and give it the matching
              // section, rather than forcing the default variant's width.
              const drawnMeters = Math.hypot(placed[1][0] - placed[0][0], placed[1][1] - placed[0][1]) / pixelsPerMeter;
              onAddOpening?.({
                kind: tool,
                points: placed,
                ...openingDefaults(tool, variantForWidth(tool, drawnMeters)),
              });
            }
          } else if (moved < 16) {
            // A finger is never perfectly still. The old 12 px threshold meant
            // roughly one tap in three was discarded as an aborted drag, which
            // is what made drawing feel unreliable.
            handleTap(locationX, locationY);
          }

          gesture.current.drag = null;
          gesture.current.rectDraft = null;
          gesture.current.openingDraft = null;
          gesture.current.pinch = null;
          setRectDraft(null);
          setOpeningDraft(null);
          setPointer(null);
        },

        onPanResponderTerminate: () => {
          gesture.current.drag = null;
          gesture.current.rectDraft = null;
          gesture.current.openingDraft = null;
          gesture.current.pinch = null;
          setRectDraft(null);
          setOpeningDraft(null);
          setPointer(null);
        },
      }),
    // Recreated whenever the drawing context changes so the closure never
    // captures stale rooms/draft state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tool, rooms, openings, draft, snapToGrid, width, height, sheetWidth, sheetHeight, suppliedPixelsPerMeter, selectedRoom, selection, roomEdgeType, curveSettings, curveControl, minZoom],
  );

  const visibleWidth = width / zoom;
  const visibleHeight = height / zoom;
  const viewBox = `${viewport.x} ${viewport.y} ${visibleWidth} ${visibleHeight}`;

  // Only draw the grid that is actually on screen. At 4× zoom on a 690 px sheet
  // the full grid is thousands of lines that never reach the viewport.
  const gridLines = useMemo(() => {
    const lines = [];
    const startX = Math.max(0, Math.floor(viewport.x / gridStep) * gridStep);
    const endX = Math.min(sheetWidth, viewport.x + visibleWidth);
    const startY = Math.max(0, Math.floor(viewport.y / gridStep) * gridStep);
    const endY = Math.min(sheetHeight, viewport.y + visibleHeight);
    for (let x = startX; x <= endX + 0.5; x += gridStep) {
      lines.push({ key: `v${Math.round(x)}`, x1: x, y1: 0, x2: x, y2: sheetHeight, major: Math.round(x / gridStep) % 2 === 0 });
    }
    for (let y = startY; y <= endY + 0.5; y += gridStep) {
      lines.push({ key: `h${Math.round(y)}`, x1: 0, y1: y, x2: sheetWidth, y2: y, major: Math.round(y / gridStep) % 2 === 0 });
    }
    return lines;
  }, [gridStep, sheetHeight, sheetWidth, viewport.x, viewport.y, visibleHeight, visibleWidth]);

  const snappedPointer = pointer && (tool === "room" || tool === "rect") ? snapPoint(pointer) : pointer;
  const lastDraftPoint = draft.length ? draft[draft.length - 1] : null;
  const stagedCurve = curveControl && lastDraftPoint
    ? buildCurveGeometry(lastDraftPoint, curveControl, curveSettings)
    : null;
  const hoverCurve = !curveControl && roomEdgeType === "rounded" && tool === "room" && lastDraftPoint && snappedPointer
    ? buildCurveGeometry(lastDraftPoint, snappedPointer, curveSettings)
    : null;
  const draftPreviewPoints = [
    ...draft,
    ...(stagedCurve?.samples || hoverCurve?.samples || (tool === "room" && snappedPointer ? [snappedPointer] : [])),
  ];

  const rectPreview = rectDraft
    ? {
        x: Math.min(rectDraft.from[0], rectDraft.to[0]),
        y: Math.min(rectDraft.from[1], rectDraft.to[1]),
        w: Math.abs(rectDraft.to[0] - rectDraft.from[0]),
        h: Math.abs(rectDraft.to[1] - rectDraft.from[1]),
      }
    : null;

  return (
    <View style={[styles.canvas, { width, height }]}>
      <Svg width={width} height={height} viewBox={viewBox}>
        <Rect
          x={viewport.x}
          y={viewport.y}
          width={visibleWidth}
          height={visibleHeight}
          fill={COLORS.surfaceSunken}
        />
        <Rect x={0} y={0} width={sheetWidth} height={sheetHeight} fill={imageUri ? "rgba(255,255,255,0.08)" : COLORS.surface} />
        {imageUri ? (
          <SvgImage href={{ uri: imageUri }} x={0} y={0} width={sheetWidth} height={sheetHeight} preserveAspectRatio="xMidYMid meet" opacity={0.78} />
        ) : null}
        <G opacity={imageUri ? 0.2 : 0.62}>
          {gridLines.map((line) => (
            <Line
              key={line.key}
              x1={line.x1}
              y1={line.y1}
              x2={line.x2}
              y2={line.y2}
              stroke={line.major ? COLORS.border : COLORS.surfaceSunken}
              strokeWidth={px(line.major ? 1 : 0.75)}
            />
          ))}
        </G>
        <Rect
          x={0}
          y={0}
          width={sheetWidth}
          height={sheetHeight}
          fill="none"
          stroke={COLORS.borderStrong}
          strokeWidth={px(1.5)}
        />

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
                strokeWidth={px(active ? 4 : 2.5)}
                strokeLinejoin="round"
              />
              <SvgText x={centroid[0]} y={centroid[1] - px(1)} fill={COLORS.textPrimary} fontSize={px(11.5)} fontWeight="600" textAnchor="middle">
                {roomLabels[index] || `Room ${index + 1}`}
              </SvgText>
              <SvgText x={centroid[0]} y={centroid[1] + px(13)} fill={COLORS.textSecondary} fontSize={px(10)} textAnchor="middle">
                {`${areaMeters.toFixed(1)} m²`}
              </SvgText>
            </G>
          );
        })}

        {openings.map((opening, index) => {
          const spec = OPENING_SPECS[opening.kind] || OPENING_SPECS.door;
          const active = selection?.kind === "opening" && selection.index === index;
          const midpoint = [
            (opening.points[0][0] + opening.points[1][0]) / 2,
            (opening.points[0][1] + opening.points[1][1]) / 2,
          ];
          const openingWidth = metres(Math.hypot(
            opening.points[1][0] - opening.points[0][0],
            opening.points[1][1] - opening.points[0][1],
          ));
          return (
            <G key={`opening-${index}`}>
              <Line
                x1={opening.points[0][0]}
                y1={opening.points[0][1]}
                x2={opening.points[1][0]}
                y2={opening.points[1][1]}
                stroke={COLORS.surface}
                strokeWidth={px(9)}
                strokeLinecap="round"
              />
              <Line
                x1={opening.points[0][0]}
                y1={opening.points[0][1]}
                x2={opening.points[1][0]}
                y2={opening.points[1][1]}
                stroke={spec.color}
                strokeWidth={px(active ? 7 : 5)}
                strokeLinecap="round"
              />
              {active && (
                <SvgText
                  x={midpoint[0]}
                  y={midpoint[1] - px(9)}
                  fill={spec.color}
                  fontSize={px(9.5)}
                  fontWeight="700"
                  textAnchor="middle"
                >
                  {`${opening.variant || spec.label} · ${openingWidth.toFixed(1)} m`}
                </SvgText>
              )}
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
                  r={px(5)}
                  fill={COLORS.primaryTint}
                  stroke={COLORS.primary}
                  strokeWidth={px(1.5)}
                />
              );
            })}
            {rooms[selectedRoom].map((corner, index) => (
              <Circle
                key={`handle-${index}`}
                cx={corner[0]}
                cy={corner[1]}
                r={px(8)}
                fill={COLORS.surface}
                stroke={COLORS.accent}
                strokeWidth={px(2.5)}
              />
            ))}
          </G>
        )}

        {tool === "select" && selection?.kind === "opening" && openings[selection.index] && (
          <G>
            {openings[selection.index].points.map((point, index) => (
              <Circle key={`opening-handle-${index}`} cx={point[0]} cy={point[1]} r={px(9)} fill={COLORS.surface} stroke={COLORS.accent} strokeWidth={px(2.5)} />
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
            strokeWidth={px(6)}
            strokeLinecap="round"
            strokeDasharray={`${px(8)} ${px(5)}`}
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
              strokeWidth={px(2.5)}
              strokeDasharray={`${px(8)} ${px(5)}`}
            />
            <SvgText
              x={rectPreview.x + rectPreview.w / 2}
              y={rectPreview.y + rectPreview.h / 2 - px(2)}
              fill={COLORS.primaryDark}
              fontSize={px(12)}
              fontWeight="700"
              textAnchor="middle"
            >
              {`${metres(rectPreview.w).toFixed(1)} × ${metres(rectPreview.h).toFixed(1)} m`}
            </SvgText>
            <SvgText
              x={rectPreview.x + rectPreview.w / 2}
              y={rectPreview.y + rectPreview.h / 2 + px(12)}
              fill={COLORS.primaryDark}
              fontSize={px(10.5)}
              textAnchor="middle"
            >
              {`${(metres(rectPreview.w) * metres(rectPreview.h)).toFixed(1)} m²`}
            </SvgText>
          </G>
        )}

        {draft.length > 0 && (
          <G>
            <Polyline
              points={draftPreviewPoints.map((point) => point.join(",")).join(" ")}
              fill="none"
              stroke={COLORS.primaryDark}
              strokeWidth={px(2.5)}
              strokeDasharray={`${px(8)} ${px(5)}`}
              strokeLinejoin="round"
            />
            {draft.map((point, index) => {
              const next = draft[index + 1];
              return (
                <G key={`draft-${index}`}>
                  {next && (
                    <SvgText
                      x={(point[0] + next[0]) / 2}
                      y={(point[1] + next[1]) / 2 - px(6)}
                      fill={COLORS.primaryDark}
                      fontSize={px(10)}
                      fontWeight="600"
                      textAnchor="middle"
                    >
                      {`${metres(Math.hypot(next[0] - point[0], next[1] - point[1])).toFixed(1)} m`}
                    </SvgText>
                  )}
                  <Circle
                    cx={point[0]}
                    cy={point[1]}
                    r={px(index === 0 ? 8.5 : 5)}
                    fill={index === 0 ? COLORS.primaryDark : COLORS.surface}
                    stroke={COLORS.primaryDark}
                    strokeWidth={px(2)}
                  />
                </G>
              );
            })}
            {draft.length >= 3 && !curveControl && (
              <Circle
                cx={draft[0][0]}
                cy={draft[0][1]}
                r={px(15)}
                fill="none"
                stroke={COLORS.primaryDark}
                strokeWidth={px(1.4)}
                strokeDasharray={`${px(4)} ${px(4)}`}
              />
            )}
          </G>
        )}

        {/* Staged rounded wall: chord, control arm and draggable endpoint, the
            same three-step flow the web studio uses. */}
        {stagedCurve && lastDraftPoint && (
          <G>
            <Line
              x1={lastDraftPoint[0]}
              y1={lastDraftPoint[1]}
              x2={curveControl[0]}
              y2={curveControl[1]}
              stroke={COLORS.textTertiary}
              strokeWidth={px(1.2)}
              strokeDasharray={`${px(5)} ${px(5)}`}
            />
            <Line
              x1={lastDraftPoint[0]}
              y1={lastDraftPoint[1]}
              x2={stagedCurve.control[0]}
              y2={stagedCurve.control[1]}
              stroke={COLORS.accent}
              strokeWidth={px(1)}
              strokeDasharray={`${px(3)} ${px(4)}`}
            />
            <Line
              x1={curveControl[0]}
              y1={curveControl[1]}
              x2={stagedCurve.control[0]}
              y2={stagedCurve.control[1]}
              stroke={COLORS.accent}
              strokeWidth={px(1)}
              strokeDasharray={`${px(3)} ${px(4)}`}
            />
            <Polyline
              points={[lastDraftPoint, ...stagedCurve.samples].map((point) => point.join(",")).join(" ")}
              fill="none"
              stroke={COLORS.accentStrong}
              strokeWidth={px(3.5)}
              strokeLinejoin="round"
            />
            <Circle cx={stagedCurve.control[0]} cy={stagedCurve.control[1]} r={px(7)} fill={COLORS.accentTint} stroke={COLORS.accentStrong} strokeWidth={px(2)} />
            <Circle cx={curveControl[0]} cy={curveControl[1]} r={px(9)} fill={COLORS.surface} stroke={COLORS.accentStrong} strokeWidth={px(2.5)} />
          </G>
        )}

        {snappedPointer && !curveControl && (
          <G opacity={0.85}>
            <Line x1={snappedPointer[0]} y1={0} x2={snappedPointer[0]} y2={sheetHeight} stroke={COLORS.accent} strokeWidth={px(0.9)} strokeDasharray={`${px(4)} ${px(6)}`} />
            <Line x1={0} y1={snappedPointer[1]} x2={sheetWidth} y2={snappedPointer[1]} stroke={COLORS.accent} strokeWidth={px(0.9)} strokeDasharray={`${px(4)} ${px(6)}`} />
            <Circle cx={snappedPointer[0]} cy={snappedPointer[1]} r={px(7)} fill="none" stroke={COLORS.accent} strokeWidth={px(2)} />
          </G>
        )}
      </Svg>

      {/*
        One flat, childless view owns every touch.

        Attaching the responder to the container meant `locationX`/`locationY`
        arrived relative to whichever SVG shape happened to be under the finger,
        so taps that landed on an existing room, wall or label were converted to
        nonsense coordinates and silently dropped. That is why drawing only
        worked "some of the time".
      */}
      <View style={StyleSheet.absoluteFill} {...responder.panHandlers} />

      <View style={styles.viewportControls} pointerEvents="box-none">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Zoom out"
          style={[styles.viewportButton, zoom <= minZoom + 0.001 && styles.viewportButtonDisabled]}
          disabled={zoom <= minZoom + 0.001}
          onPress={() => zoomAt(viewportRef.current.zoom / 1.35)}
        >
          <Text style={styles.viewportButtonText}>−</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Fit the whole plan on screen"
          style={styles.viewportValue}
          onPress={fitToSheet}
        >
          <Text style={styles.viewportValueText}>{Math.round(zoom * 100)}%</Text>
          <Text style={styles.viewportValueHint}>Fit</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Zoom in"
          style={[styles.viewportButton, zoom >= MAX_ZOOM - 0.001 && styles.viewportButtonDisabled]}
          disabled={zoom >= MAX_ZOOM - 0.001}
          onPress={() => zoomAt(viewportRef.current.zoom * 1.35)}
        >
          <Text style={styles.viewportButtonText}>+</Text>
        </Pressable>
      </View>

      {rooms.length === 0 && draft.length === 0 && !rectDraft && !imageUri && (
        <View style={styles.empty} pointerEvents="none">
          <Text style={styles.emptyTitle}>
            {tool === "rect" ? "Drag to draw a room" : tool === "room" ? "Tap to place each corner" : "Pick a tool to start"}
          </Text>
          <Text style={styles.emptyBody}>Each square is half a metre · pinch to zoom, two fingers to move</Text>
        </View>
      )}

      {detecting && (
        <View style={styles.detecting} pointerEvents="none">
          <ActivityIndicator color={COLORS.white} />
          <Text style={styles.detectingText}>Detecting editable rooms and openings…</Text>
        </View>
      )}

      <View style={styles.scaleBadge} pointerEvents="none">
        <View style={[styles.scaleBar, { width: Math.max(12, Math.min(width * 0.34, pixelsPerMeter * zoom)) }]} />
        <Text style={styles.scaleLabel}>1 m</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    borderRadius: RADIUS.xl,
    overflow: "hidden",
    borderWidth: 1.5,
    borderColor: COLORS.borderStrong,
    backgroundColor: COLORS.surfaceSunken,
    ...SHADOW.md,
  },
  empty: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    gap: 4,
  },
  emptyTitle: { ...TYPE.bodyStrong, color: COLORS.textSecondary },
  emptyBody: { ...TYPE.caption, color: COLORS.textTertiary, textAlign: "center" },
  viewportControls: {
    position: "absolute",
    right: 10,
    top: 10,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: RADIUS.pill,
    padding: 3,
    backgroundColor: "rgba(255,255,255,0.94)",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  viewportButton: {
    width: 34,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surfaceSunken,
  },
  viewportButtonDisabled: { opacity: 0.36 },
  viewportButtonText: { ...TYPE.h3, color: COLORS.textPrimary, lineHeight: 21 },
  viewportValue: { minWidth: 54, height: 32, alignItems: "center", justifyContent: "center" },
  viewportValueText: { ...TYPE.caption, color: COLORS.textSecondary, fontSize: 10 },
  viewportValueHint: { ...TYPE.caption, color: COLORS.textTertiary, fontSize: 8 },
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
