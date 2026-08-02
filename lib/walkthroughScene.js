/**
 * Livinai 3D walkthrough — scene document builder.
 *
 * This is the mobile port of the web studio's `Plan3DScene`. The web version
 * runs three.js directly in the DOM; React Native has no DOM, so the whole
 * renderer is emitted as a self-contained HTML document and mounted inside a
 * `react-native-webview`. The scene logic — palettes, measured wall extrusion,
 * opening cutting, curtains, the procedural furniture family and the
 * walk/orbit/plan cameras — is a faithful port of the desktop renderer.
 *
 * Two deliberate differences from the web build:
 *
 *  1. The matching Livinai_web GLB catalogue is baked into typed arrays instead
 *     of streamed from `/models`. Original style-aware furniture families use
 *     the same procedural builders as the web app so variants stay intact.
 *  2. Textures are synthesised on a canvas at runtime instead of being fetched
 *     as PBR maps. That keeps the document dependency-free (one CDN script) and
 *     avoids shipping tens of megabytes of image assets in the bundle.
 *
 * The document talks to React Native over `window.ReactNativeWebView.postMessage`
 * and receives commands through `window.LivinaiScene.*`, which the RN side calls
 * with `injectJavaScript`.
 */

import { FURNITURE_CATALOG } from "./furnitureCatalog";

// Keep this identical to Livinai_web/src/walkthroughRendererRevision.js so
// identical plans resolve to the same Interior_Plan scene cache.
export const WALKTHROUGH_RENDERER_REVISION = "intact-balcony-curtain-fabric-v26";

/**
 * Which catalogue models each room programme can actually ask for.
 *
 * These are the real .glb files now, not a stripped geometry bake, so an entry
 * that is never used is a genuine cost — `chair-modern.glb` alone is 5.4 MB of
 * base64. Each list is therefore the exact intersection of what `roomFurniture`
 * emits for that room type and what Livinai_web's MODEL_PATHS resolves.
 *
 * Living rooms and bedrooms load nothing: their hero pieces (sofaVariant,
 * coffeeTableVariant, tvUnitVariant, bedVariant, wardrobeVariant…) are the
 * style-aware procedural families in the web build too.
 */
const CATALOG_BY_ROOM = {
  "living room": [],
  bedroom: [],
  kitchen: ["island", "fridge"],
  bathroom: ["shower", "bathtub", "vanity", "toilet"],
  "dining room": ["diningChair", "tvUnit"],
  office: ["workDesk", "modernChair", "bookcase"],
  laundry: ["bookcase"],
  utility: ["bookcase"],
  closet: ["bookcase"],
  entryway: ["bookcase"],
  hallway: ["bookcase"],
};

/** Every model any room programme can reach, for unknown room types. */
const CATALOG_REACHABLE = [
  "island", "fridge", "shower", "bathtub", "vanity", "toilet",
  "diningChair", "tvUnit", "workDesk", "modernChair", "bookcase",
];

function catalogFor(roomConfigs = []) {
  const keys = new Set(["bookcase"]); // the generic-room fallback always needs it
  roomConfigs.forEach((room) => {
    const list = CATALOG_BY_ROOM[String(room?.roomType || "").toLowerCase()];
    (list || CATALOG_REACHABLE).forEach((key) => keys.add(key));
  });
  const subset = {};
  keys.forEach((key) => {
    if (FURNITURE_CATALOG[key]) subset[key] = FURNITURE_CATALOG[key];
  });
  return subset;
}

/**
 * Engine sources, in preference order.
 *
 * The module entry comes first because it is the only way to get the real
 * GLTFLoader: three dropped its UMD `examples/js` builds after r147, and the
 * furniture catalogue is now actual .glb files that need a real loader. This
 * pins the same three version Livinai_web depends on, loading the loader from
 * the same `examples/jsm` path its bundler resolves.
 *
 * The UMD entries stay as a fallback for WebViews without import-map support.
 * They render the identical scene, minus the catalogue models — the procedural
 * families take over, exactly as they do in the web build when a fetch fails.
 */
const THREE_VERSION = "0.185.1";
const THREE_MODULE_SOURCES = [
  "https://unpkg.com/three@" + THREE_VERSION,
  "https://cdn.jsdelivr.net/npm/three@" + THREE_VERSION,
];
const THREE_SOURCES = [
  "https://unpkg.com/three@0.159.0/build/three.min.js",
  "https://cdn.jsdelivr.net/npm/three@0.159.0/build/three.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.159.0/three.min.js",
];

export const ROOM_TYPES = [
  "Living Room",
  "Bedroom",
  "Kitchen",
  "Bathroom",
  "Dining Room",
  "Office",
  "Entryway",
  "Hallway",
  "Laundry",
  "Utility",
];

export const WALKTHROUGH_STYLES = [
  "Modern",
  "Modern Minimalist",
  "Scandinavian",
  "Japandi",
  "Industrial",
  "Bohemian",
  "Mid-Century Modern",
  "Contemporary",
  "Traditional",
  "Classic",
];

export const DESIGN_PROFILES = ["Curated", "Airy", "Layered"];
export const COLOR_MOODS = [
  "Warm neutral",
  "Cool neutral",
  "Earthy natural",
  "Light and airy",
  "Monochrome",
  "Bold accents",
];
export const FLOOR_FINISHES = [
  "Auto by style",
  "Light oak",
  "Warm oak",
  "Dark walnut",
  "Natural stone",
  "Polished concrete",
  "Terrazzo",
  "Large tile",
];
export const WALL_FINISHES = [
  "Auto by style",
  "Warm paint",
  "Cool paint",
  "Limewash",
  "Wallpaper",
  "Wood slats",
  "Panel moulding",
  "Concrete",
  "Accent color",
];
export const RUG_DESIGNS = ["Auto by style", "None", "Plain woven", "Bordered", "Geometric", "Vintage pattern"];
export const CURTAIN_DESIGNS = ["Auto by style", "None", "Sheer panels", "Linen drapes", "Layered sheers + drapes"];
export const DECOR_SETS = ["Auto by style", "Minimal", "Art & greenery", "Sculptural", "Layered"];

export const DEFAULT_WALKTHROUGH_SETTINGS = {
  designProfile: "Curated",
  colorMood: "Warm neutral",
  floorFinish: "Auto by style",
  wallFinish: "Auto by style",
  rugDesign: "Auto by style",
  curtainDesign: "Auto by style",
  decorSet: "Auto by style",
  useCatalog: true,
  freeExplore: true,
  notes: "",
};

/**
 * Normalise whatever the plan editor produced into the layout contract the
 * renderer expects: rooms as pixel-space polygons, openings as 2-point pixel
 * segments, plus the pixels-per-metre scale used to convert to world units.
 */
export function buildLayout({ rooms = [], doors = [], windows = [], balconies = [], width, height, pixelsPerMeter }) {
  const toPoint = (point) =>
    Array.isArray(point)
      ? [Number(point[0]) || 0, Number(point[1]) || 0]
      : [Number(point?.x) || 0, Number(point?.y) || 0];
  const toSegment = (segment) => {
    if (Array.isArray(segment)) {
      const points = segment.slice(0, 2).map(toPoint);
      return segment[2] && typeof segment[2] === "object" ? [...points, { ...segment[2] }] : points;
    }
    const sourcePoints = Array.isArray(segment?.points)
      ? segment.points.slice(0, 2).map(toPoint)
      : [
          [Number(segment?.x1) || 0, Number(segment?.y1) || 0],
          [Number(segment?.x2) || 0, Number(segment?.y2) || 0],
        ];
    return [
      ...sourcePoints,
      {
        variant: segment?.variant,
        height: Number(segment?.height) || undefined,
        sillHeight: Number(segment?.sillHeight) || undefined,
      },
    ];
  };
  return {
    width: Number(width) || 900,
    height: Number(height) || 600,
    pixelsPerMeter: Math.max(8, Number(pixelsPerMeter) || estimatePixelsPerMeter(rooms, doors)),
    rooms: rooms.map((room) => (room?.vertices || room).map(toPoint)).filter((room) => room.length >= 3),
    doors: doors.map(toSegment),
    windows: windows.map(toSegment),
    balconies: balconies.map(toSegment),
  };
}

/**
 * Mirror of the backend's `estimate_interior_plan_scale`: derive the drawing
 * scale from the median room area (assuming a ~12 m² typical room) and, when
 * doors were drawn, cross-check it against a standard 0.9 m door leaf.
 */
export function estimatePixelsPerMeter(rooms = [], doors = [], fallback = 46) {
  const areas = [];
  rooms.forEach((room) => {
    const points = (room?.vertices || room || []).map((point) =>
      Array.isArray(point) ? point : [point.x, point.y],
    );
    if (points.length < 3) return;
    let twiceArea = 0;
    points.forEach((point, index) => {
      const next = points[(index + 1) % points.length];
      twiceArea += point[0] * next[1] - next[0] * point[1];
    });
    const area = Math.abs(twiceArea) / 2;
    if (area > 100) areas.push(area);
  });
  const median = (values) => {
    if (!values.length) return null;
    const sorted = [...values].sort((one, two) => one - two);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const areaMedian = median(areas);
  const fromArea = areaMedian ? Math.sqrt(areaMedian / 12) : null;
  const doorLengths = doors
    .map((door) => {
      const [a, b] = Array.isArray(door)
        ? door
        : [
            [door.x1, door.y1],
            [door.x2, door.y2],
          ];
      if (!a || !b) return 0;
      return Math.hypot((b[0] ?? b.x) - (a[0] ?? a.x), (b[1] ?? b.y) - (a[1] ?? a.y));
    })
    .filter((length) => length > 5);
  const doorMedian = median(doorLengths);
  const fromDoors = doorMedian ? doorMedian / 0.9 : null;
  if (fromDoors && fromArea) {
    const ratio = fromDoors / fromArea;
    return ratio >= 0.8 && ratio <= 1.25 ? fromDoors : fromArea;
  }
  return fromDoors || fromArea || fallback;
}

/** Everything below this line is stringified into the WebView document. */
const SCENE_SCRIPT = String.raw`
(function () {
  var THREE = window.THREE;
  var payload = window.__LIVINAI__;
  var post = function (message) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify(message)); } catch (error) {}
  };
  if (!THREE) { post({ type: 'error', message: 'The 3D engine could not be loaded. Check your connection and try again.' }); return; }

  var PALETTES = {
    'Modern': { wall: 0xeee7dd, floor: 0xb1845e, rug: 0xd8c5aa, fabric: 0x547a78, wood: 0x8e6548, accent: 0xed6259, metal: 0x9b7b54 },
    'Modern Minimalist': { wall: 0xf2efea, floor: 0xcdbd9f, rug: 0xe2ddd4, fabric: 0xb8b4ad, wood: 0x9f8a6b, accent: 0x73898a, metal: 0x6f7372 },
    'Minimalist': { wall: 0xf2efea, floor: 0xcdbd9f, rug: 0xe2ddd4, fabric: 0xb8b4ad, wood: 0x9f8a6b, accent: 0x73898a, metal: 0x6f7372 },
    'Scandinavian': { wall: 0xf4f3ed, floor: 0xd8c49c, rug: 0xe5e1d8, fabric: 0x9ea9a7, wood: 0xc2a77b, accent: 0x66878a, metal: 0x333b3d },
    'Japandi': { wall: 0xeeeae1, floor: 0xc7ae86, rug: 0xd9d2c2, fabric: 0xa39a89, wood: 0x9e8461, accent: 0x5c6258, metal: 0x302e2a },
    'Industrial': { wall: 0xc5c0b8, floor: 0x6d5949, rug: 0x8d8983, fabric: 0x8a5539, wood: 0x73583d, accent: 0xb58b55, metal: 0x292b2d },
    'Bohemian': { wall: 0xf0dfc8, floor: 0x9d7049, rug: 0xb8774c, fabric: 0xb66643, wood: 0x987249, accent: 0xc49a4f, metal: 0x806345 },
    'Boho': { wall: 0xf0dfc8, floor: 0x9d7049, rug: 0xb8774c, fabric: 0xb66643, wood: 0x987249, accent: 0xc49a4f, metal: 0x806345 },
    'Classic': { wall: 0xe8dfd0, floor: 0x76523a, rug: 0x7e5049, fabric: 0x9e8a72, wood: 0x65452e, accent: 0x76504b, metal: 0xc0a05e },
    'Traditional': { wall: 0xe8dfd0, floor: 0x76523a, rug: 0x7e5049, fabric: 0x9e8a72, wood: 0x65452e, accent: 0x76504b, metal: 0xc0a05e },
    'Contemporary': { wall: 0xe9e7e2, floor: 0xad8d6d, rug: 0xd3c7b8, fabric: 0x657e83, wood: 0x82664f, accent: 0xd66c61, metal: 0x777b7a },
    'Mid-Century Modern': { wall: 0xeadfcd, floor: 0x9e6e45, rug: 0xc5a77a, fabric: 0x647b6b, wood: 0x8b5836, accent: 0xd17c45, metal: 0x9f7d43 }
  };

  function paletteFor(style, colorMood) {
    var base = PALETTES[style] || PALETTES.Modern;
    var mood = colorMood || 'Warm neutral';
    var targets = /cool/i.test(mood) ? { wall: 0xe8eeee, floor: 0xa8aaa5, rug: 0xcbd6d6, fabric: 0x718d95, accent: 0x5c8397 }
      : /earthy/i.test(mood) ? { wall: 0xe9dfcf, floor: 0x9c704a, rug: 0xb8966e, fabric: 0x70806a, accent: 0xb36f4d }
      : /light/i.test(mood) ? { wall: 0xf5f3ee, floor: 0xd7c8ad, rug: 0xe8e3da, fabric: 0xb2c1c0, accent: 0x7ca4a5 }
      : /mono/i.test(mood) ? { wall: 0xe8e8e5, floor: 0x8f8b85, rug: 0xc4c2be, fabric: 0x777b7b, accent: 0x454b4d }
      : /bold/i.test(mood) ? { wall: base.wall, floor: base.floor, rug: base.rug, fabric: base.fabric, accent: 0xed6259 }
      : { wall: 0xeee7dd, floor: base.floor, rug: base.rug, fabric: base.fabric, accent: base.accent };
    var mix = function (one, two, amount) {
      return new THREE.Color(one).lerp(new THREE.Color(two), amount === undefined ? 0.38 : amount).getHex();
    };
    return {
      wall: mix(base.wall, targets.wall), floor: mix(base.floor, targets.floor), rug: mix(base.rug, targets.rug),
      fabric: mix(base.fabric, targets.fabric), wood: base.wood, metal: base.metal,
      accent: mix(base.accent, targets.accent, /bold/i.test(mood) ? 0.72 : 0.42)
    };
  }

  // ── Procedural PBR maps ──────────────────────────────────────────────────
  // The web build streams jpg/normal/roughness sets from its own origin. Here we
  // draw equivalents once on a 2D canvas so the document stays self-contained
  // and the walls/floors still read as material rather than flat colour.
  var textureCache = {};
  function canvasTexture(key, size, draw, repeat, srgb) {
    var cacheKey = key + '|' + repeat.join(',');
    if (textureCache[cacheKey]) return textureCache[cacheKey];
    var canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    draw(canvas.getContext('2d'), size);
    var map = new THREE.CanvasTexture(canvas);
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(repeat[0], repeat[1]);
    // r152 renamed texture.encoding to texture.colorSpace. The module engine is
    // current; the UMD fallback may not be, so set whichever this build has.
    if (srgb) {
      if ('colorSpace' in map) map.colorSpace = THREE.SRGBColorSpace;
      else map.encoding = THREE.sRGBEncoding;
    }
    textureCache[cacheKey] = map;
    return map;
  }

  function drawWoodGrain(ctx, size) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    var planks = 6;
    for (var p = 0; p < planks; p += 1) {
      var y = (size / planks) * p;
      var shade = 232 + Math.round(Math.sin(p * 2.7) * 14);
      ctx.fillStyle = 'rgb(' + shade + ',' + (shade - 6) + ',' + (shade - 14) + ')';
      ctx.fillRect(0, y, size, size / planks - 1);
      ctx.strokeStyle = 'rgba(120,98,74,0.30)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(size, y + 0.5); ctx.stroke();
      for (var g = 0; g < 26; g += 1) {
        ctx.strokeStyle = 'rgba(126,101,74,' + (0.05 + Math.random() * 0.07) + ')';
        ctx.beginPath();
        var gy = y + Math.random() * (size / planks);
        ctx.moveTo(0, gy);
        for (var x = 0; x <= size; x += 16) ctx.lineTo(x, gy + Math.sin((x + p * 40) * 0.05) * 1.6);
        ctx.stroke();
      }
    }
  }

  function drawPlaster(ctx, size) {
    ctx.fillStyle = '#f4f2ee';
    ctx.fillRect(0, 0, size, size);
    var image = ctx.getImageData(0, 0, size, size);
    for (var i = 0; i < image.data.length; i += 4) {
      var noise = (Math.random() - 0.5) * 15;
      image.data[i] += noise; image.data[i + 1] += noise; image.data[i + 2] += noise;
    }
    ctx.putImageData(image, 0, 0);
  }

  function drawTile(ctx, size) {
    var grid = 4;
    var cell = size / grid;
    for (var x = 0; x < grid; x += 1) {
      for (var y = 0; y < grid; y += 1) {
        var tone = 234 + Math.round((Math.random() - 0.5) * 10);
        ctx.fillStyle = 'rgb(' + tone + ',' + tone + ',' + (tone - 4) + ')';
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
    ctx.strokeStyle = 'rgba(150,148,142,0.6)';
    ctx.lineWidth = 2;
    for (var line = 0; line <= grid; line += 1) {
      ctx.beginPath(); ctx.moveTo(line * cell, 0); ctx.lineTo(line * cell, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, line * cell); ctx.lineTo(size, line * cell); ctx.stroke();
    }
  }

  function drawNoiseNormal(ctx, size) {
    var image = ctx.createImageData(size, size);
    for (var i = 0; i < image.data.length; i += 4) {
      image.data[i] = 122 + Math.round((Math.random() - 0.5) * 16);
      image.data[i + 1] = 122 + Math.round((Math.random() - 0.5) * 16);
      image.data[i + 2] = 255;
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }

  function surfaceMaps(kind, repeat) {
    var draw = kind === 'wood' ? drawWoodGrain : kind === 'tile' ? drawTile : drawPlaster;
    return {
      map: canvasTexture(kind, 256, draw, repeat, true),
      normalMap: canvasTexture('normal', 128, drawNoiseNormal, repeat, false)
    };
  }

  // ── Geometry helpers (ported verbatim from the web renderer) ─────────────
  function pointInPolygon(x, z, polygon) {
    var inside = false;
    for (var i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      var xi = polygon[i].x, zi = polygon[i].z, xj = polygon[j].x, zj = polygon[j].z;
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-9) + xi) inside = !inside;
    }
    return inside;
  }

  function pointToSegmentDistance(point, start, end) {
    var segment = end.clone().sub(start);
    var lengthSq = segment.lengthSq();
    if (!lengthSq) return point.distanceTo(start);
    var t = THREE.MathUtils.clamp(point.clone().sub(start).dot(segment) / lengthSq, 0, 1);
    return point.distanceTo(start.clone().add(segment.multiplyScalar(t)));
  }

  function wallMesh(start, end, y0, y1, material) {
    var direction = end.clone().sub(start);
    var length = direction.length();
    if (length < 0.03 || y1 <= y0) return null;
    var mesh = new THREE.Mesh(new THREE.BoxGeometry(length, y1 - y0, 0.13), material);
    mesh.position.set((start.x + end.x) / 2, (y0 + y1) / 2, (start.z + end.z) / 2);
    mesh.rotation.y = Math.atan2(-direction.z, direction.x);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { name: 'Architectural wall', material: 'Selected wall finish', detail: 'Measured directly from the plan you drew.' };
    return mesh;
  }

  function addOpeningCurtain(options) {
    var curtainDesign = options.curtainDesign || 'Auto by style';
    if (/none/i.test(curtainDesign)) return;
    var openingVector = options.openingEnd.clone().sub(options.openingStart);
    var openingLength = openingVector.length();
    if (openingLength < 0.3) return;
    var openingDirection = openingVector.clone().normalize();
    var sheer = /sheer|layered/i.test(curtainDesign);
    var curtainMaterial = new THREE.MeshStandardMaterial({
      color: sheer ? 0xf0eee8 : options.palette.fabric,
      transparent: sheer, opacity: sheer ? 0.62 : 1, roughness: 0.96, side: THREE.DoubleSide
    });
    var panelRatio = /layered/i.test(curtainDesign) ? 0.34 : 0.24;
    var panelWidth = Math.max(0.2, Math.min(options.referenceWindowWidth || openingLength, openingLength) * panelRatio);
    var leftCurtain = wallMesh(options.openingStart, options.openingStart.clone().addScaledVector(openingDirection, panelWidth), 0.12, 2.68, curtainMaterial);
    var rightCurtain = wallMesh(options.openingEnd.clone().addScaledVector(openingDirection, -panelWidth), options.openingEnd, 0.12, 2.68, curtainMaterial);
    var rodMaterial = new THREE.MeshStandardMaterial({ color: options.palette.metal, roughness: 0.5 });
    var rod = wallMesh(options.openingStart.clone().addScaledVector(openingDirection, -0.12), options.openingEnd.clone().addScaledVector(openingDirection, 0.12), 2.66, 2.70, rodMaterial);
    var inward = new THREE.Vector3(-options.wallDirection.z, 0, options.wallDirection.x);
    var midpoint = options.openingStart.clone().add(options.openingEnd).multiplyScalar(0.5);
    if (inward.dot(options.roomCentre.clone().sub(midpoint)) < 0) inward.multiplyScalar(-1);
    inward.multiplyScalar(0.11);
    [leftCurtain, rightCurtain, rod].forEach(function (curtain) {
      if (!curtain) return;
      curtain.position.add(inward);
      curtain.userData = { name: curtainDesign + ' curtains', material: 'Style-coordinated textile', detail: 'The same treatment is repeated on every window and balcony door in this room.' };
      options.parent.add(curtain);
    });
  }

  function setInteractiveInfo(group, info) {
    group.userData = Object.assign({}, info, { root: group });
    group.traverse(function (child) {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        child.userData = Object.assign({}, info, { root: group });
      }
    });
  }

  function stableVariant(signature, values) {
    var hash = 2166136261;
    for (var index = 0; index < signature.length; index += 1) {
      hash ^= signature.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return values[Math.abs(hash) % values.length];
  }

  function roomBounds(points) {
    var longest = { length: 0, axisX: new THREE.Vector3(1, 0, 0) };
    var twiceArea = 0;
    points.forEach(function (point, index) {
      var next = points[(index + 1) % points.length];
      var edge = next.clone().sub(point);
      var length = edge.length();
      if (length > longest.length) longest = { length: length, axisX: edge.clone().normalize() };
      twiceArea += point.x * next.z - next.x * point.z;
    });
    var axisX = longest.axisX;
    var axisZ = new THREE.Vector3(-axisX.z, 0, axisX.x);
    var xValues = points.map(function (point) { return point.dot(axisX); });
    var zValues = points.map(function (point) { return point.dot(axisZ); });
    var minLocalX = Math.min.apply(null, xValues), maxLocalX = Math.max.apply(null, xValues);
    var minLocalZ = Math.min.apply(null, zValues), maxLocalZ = Math.max.apply(null, zValues);
    var centre = axisX.clone().multiplyScalar((minLocalX + maxLocalX) / 2).add(axisZ.clone().multiplyScalar((minLocalZ + maxLocalZ) / 2));
    var xs = points.map(function (point) { return point.x; });
    var zs = points.map(function (point) { return point.z; });
    return {
      minX: Math.min.apply(null, xs), maxX: Math.max.apply(null, xs),
      minZ: Math.min.apply(null, zs), maxZ: Math.max.apply(null, zs),
      width: maxLocalX - minLocalX, depth: maxLocalZ - minLocalZ,
      area: Math.abs(twiceArea) / 2, centre: centre, axisX: axisX, axisZ: axisZ,
      rotation: Math.atan2(-axisX.z, axisX.x)
    };
  }

  // ── Catalogue furniture ─────────────────────────────────────────────────
  // The same meshes the Livinai web studio uses, baked out of its .glb files
  // into typed arrays at build time (see scripts/build-furniture-catalog.mjs)
  // so no glTF loader is needed here.

  // Parsed once during boot from the inlined .glb bytes, then cloned per piece —
  // the same shape as the web build's loadModel(path) + source.clone(true).
  var CATALOG = window.__LIVINAI_MODELS__ || {};
  var catalogUsed = 0;

  function catalogGroup(key) {
    var source = CATALOG[key];
    return source ? source.clone(true) : null;
  }

  /**
   * Livinai_web's tintModel, verbatim.
   *
   * The lighter 0.3 blend when a material carries a texture is the whole point
   * of loading real models: it lets the style palette colour a piece without
   * washing out the map it shipped with. The previous geometry bake had no maps
   * at all, so it always used the flat 0.72 blend.
   */
  function tintModel(group, color, preserveTexture) {
    var target = new THREE.Color(color);
    group.traverse(function (child) {
      if (!child.isMesh) return;
      var materials = Array.isArray(child.material) ? child.material : [child.material];
      child.material = materials.map(function (source) {
        var material = source.clone();
        if (material.color) material.color.lerp(target, preserveTexture !== false && material.map ? 0.3 : 0.72);
        material.roughness = Math.max(material.roughness === undefined ? 0.6 : material.roughness, 0.42);
        return material;
      });
      if (child.material.length === 1) child.material = child.material[0];
    });
  }

  /**
   * Scale a catalogue mesh into the slot the room programme reserved for it,
   * then sit it on the floor and centre it on the slot. Mirrors the desktop
   * renderer: "exact" stretches each axis, otherwise the model keeps its
   * proportions and fits inside the slot.
   *
   * Every model in the catalogue is authored with a corner origin — the bed's
   * geometry centre sits (0.48, 0.19, -0.56) away from its own origin, and the
   * others are similar. Compensating for that by offsetting the *group* (which
   * is what this used to do, and what the web build still does) puts the piece
   * in the right place but leaves the group's origin floating half a piece-width
   * outside it. Everything downstream then misbehaves: rotating swings the piece
   * around that phantom point instead of turning it on the spot, and the
   * "is it still in the room?" test that guards nudging reads a point that is
   * usually outside the wall, so the arrows silently do nothing.
   *
   * So the offset is applied to the model *inside* a wrapper instead. The
   * wrapper's origin is the piece's own floor centre, which makes its position
   * and rotation mean exactly what the edit controls assume.
   */
  function addCatalogModel(parent, spec, palette) {
    var loaded = catalogGroup(spec.catalogKey);
    if (!loaded) return null;
    // Scale and offset a holder around the loaded scene rather than overwriting
    // the glTF root's own transform, which is no longer guaranteed to be
    // identity now that real files are parsed instead of pre-flattened parts.
    var model = new THREE.Group();
    model.add(loaded);

    var box = new THREE.Box3().setFromObject(model);
    var size = box.getSize(new THREE.Vector3());
    if (spec.fitMode === 'exact') {
      model.scale.set(
        spec.size[0] / Math.max(size.x, 0.01),
        spec.size[1] / Math.max(size.y, 0.01),
        spec.size[2] / Math.max(size.z, 0.01)
      );
    } else {
      model.scale.setScalar(Math.min(
        spec.size[0] / Math.max(size.x, 0.01),
        spec.size[1] / Math.max(size.y, 0.01),
        spec.size[2] / Math.max(size.z, 0.01)
      ));
    }
    model.updateMatrixWorld(true);

    // Footprint centre onto the wrapper's origin, base onto its floor. A
    // Y-rotation of the wrapper then spins the piece about its own centre.
    var scaled = new THREE.Box3().setFromObject(model);
    var centre = scaled.getCenter(new THREE.Vector3());
    model.position.set(-centre.x, -scaled.min.y, -centre.z);

    var group = new THREE.Group();
    group.add(model);
    group.rotation.y = spec.rotation || 0;
    group.position.set(
      spec.position.x,
      spec.position.y + (spec.lift || 0),
      spec.position.z
    );

    tintModel(group, palette[spec.colorKey || 'wood'], spec.preserveTexture !== false);
    setInteractiveInfo(group, { name: spec.name, material: spec.material, detail: spec.detail, category: spec.model });
    parent.add(group);
    return group;
  }

  /**
   * Which programme items map onto a catalogue mesh.
   *
   * The variant families (wardrobes, media units, wall art) stay procedural
   * because the variation *is* the feature there — a single mesh would make
   * every bedroom identical. The hero pieces and fixed sanitaryware use the real
   * meshes, where a modelled silhouette beats stacked boxes outright.
   */
  /**
   * Livinai_web's MODEL_PATHS, as keys.
   *
   * The web resolves a spec straight through MODEL_PATHS[spec.model] and falls
   * back to procedural geometry when there is no entry — which is why the
   * variant families (sofaVariant, bedVariant, wardrobeVariant, coffeeTable-
   * Variant, tvUnitVariant, diningTableVariant, wallArtVariant, cabinetRun)
   * stay procedural on both platforms: that variation *is* the design. This
   * table is the same set, with roundDiningTable omitted for the same reason
   * it is null there.
   */
  var CATALOG_ALIAS = {
    sofa: 'sofa',
    compactSofa: 'compactSofa',
    armchair: 'armchair',
    coffeeTable: 'coffeeTable',
    diningTable: 'diningTable',
    diningChair: 'diningChair',
    workDesk: 'workDesk',
    bed: 'bed',
    island: 'island',
    fridge: 'fridge',
    vanity: 'vanity',
    toilet: 'toilet',
    shower: 'shower',
    bathtub: 'bathtub',
    tvUnit: 'tvUnit',
    bookcase: 'bookcase',
    modernChair: 'modernChair'
  };

  /** Catalogue mesh where one exists, procedural geometry otherwise. */
  function addFurniture(parent, spec, palette) {
    var key = spec.catalogKey || CATALOG_ALIAS[spec.model];
    if (settings.useCatalog !== false && key && CATALOG[key]) {
      var placed = addCatalogModel(parent, Object.assign({}, spec, { catalogKey: key }), palette);
      if (placed) { catalogUsed += 1; return placed; }
    }
    return addProceduralModel(parent, spec, palette);
  }

  // ── Procedural furniture family ─────────────────────────────────────────
  function addProceduralModel(parent, spec, palette) {
    var group = new THREE.Group();
    var width = spec.size[0], height = spec.size[1], depth = spec.size[2];
    var material = new THREE.MeshStandardMaterial({ color: palette[spec.colorKey || 'wood'], roughness: 0.72 });
    var fabricMaterial = new THREE.MeshStandardMaterial({ color: palette.fabric, roughness: 0.92 });
    var fabricLightMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(palette.fabric).lerp(new THREE.Color(0xffffff), 0.16), roughness: 0.94 });
    var woodMaterial = new THREE.MeshStandardMaterial({ color: palette.wood, roughness: 0.62 });
    var darkWoodMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(palette.wood).multiplyScalar(0.62), roughness: 0.68 });
    var metalMaterial = new THREE.MeshStandardMaterial({ color: palette.metal, roughness: 0.36, metalness: 0.58 });
    var stoneMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(palette.wall).lerp(new THREE.Color(0xffffff), 0.2), roughness: 0.38 });

    var addBox = function (size, position, boxMaterial) {
      var mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), boxMaterial || material);
      mesh.position.set(position[0], position[1], position[2]);
      group.add(mesh);
      return mesh;
    };
    var addCylinder = function (radiusTop, radiusBottom, cylinderHeight, position, cylinderMaterial, segments) {
      var mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, cylinderHeight, segments || 36), cylinderMaterial || material);
      mesh.position.set(position[0], position[1], position[2]);
      group.add(mesh);
      return mesh;
    };

    if (spec.model === 'sofaVariant') {
      var variant = spec.variant || 'tailored';
      var sectional = /chaise|modular/.test(variant);
      var chaiseLeft = variant === 'left-chaise';
      var mainDepth = sectional ? Math.min(0.98, depth * 0.62) : depth;
      var rearZ = sectional ? -depth / 2 + mainDepth / 2 : 0;
      addBox([width, height * 0.34, mainDepth], [0, height * 0.28, rearZ], fabricMaterial);
      var backRatio = /daybed/.test(variant) ? 0.44 : /camelback/.test(variant) ? 0.84 : /low|curved/.test(variant) ? 0.5 : 0.62;
      addBox([width, height * backRatio, 0.18], [0, height * (0.31 + backRatio / 2), -depth / 2 + 0.09], fabricMaterial);
      if (sectional) {
        var chaiseWidth = Math.min(0.9, width * 0.36);
        var chaiseX = (chaiseLeft ? -1 : 1) * (width / 2 - chaiseWidth / 2);
        addBox([chaiseWidth, height * 0.34, depth - 0.08], [chaiseX, height * 0.28, 0.02], fabricMaterial);
        addBox([chaiseWidth - 0.08, height * 0.15, depth - 0.28], [chaiseX, height * 0.49, 0.08], fabricLightMaterial);
        var openSide = chaiseLeft ? 1 : -1;
        addBox([0.17, height * 0.52, mainDepth], [openSide * (width / 2 - 0.085), height * 0.38, rearZ], fabricMaterial);
      } else if (/curved|camelback/.test(variant)) {
        [-1, 1].forEach(function (side) {
          var wing = addBox([width * 0.26, height * 0.54, 0.2], [side * width * 0.39, height * 0.52, -depth * 0.28], fabricMaterial);
          wing.rotation.y = side * 0.28;
        });
      } else if (variant === 'daybed') {
        [-1, 1].forEach(function (side) { addBox([0.26, height * 0.28, depth * 0.78], [side * (width / 2 - 0.15), height * 0.52, 0.04], fabricLightMaterial); });
      } else {
        [-1, 1].forEach(function (side) { addBox([0.17, height * 0.52, mainDepth], [side * (width / 2 - 0.085), height * 0.38, rearZ], fabricMaterial); });
      }
      var cushionCount = width > 2.35 ? 3 : 2;
      for (var cushion = 0; cushion < cushionCount; cushion += 1) {
        var cushionWidth = (width - 0.42) / cushionCount;
        addBox([cushionWidth - 0.04, height * 0.14, mainDepth - 0.32], [-width / 2 + 0.21 + cushionWidth * (cushion + 0.5), height * 0.5, rearZ + 0.06], fabricLightMaterial);
      }
      [-1, 1].forEach(function (x) { [-1, 1].forEach(function (z) { addCylinder(0.027, 0.027, 0.1, [x * (width / 2 - 0.11), 0.05, z * (depth / 2 - 0.11)], metalMaterial, 16); }); });
    } else if (spec.model === 'armchairVariant') {
      var chairVariant = spec.variant || 'barrel';
      addBox([width, height * 0.32, depth], [0, height * 0.30, 0], fabricMaterial);
      addBox([width - 0.08, height * (/wingback/.test(chairVariant) ? 0.74 : 0.58), 0.16], [0, height * 0.64, -depth / 2 + 0.08], fabricMaterial);
      if (/sling/.test(chairVariant)) {
        [-1, 1].forEach(function (side) { addBox([0.035, height * 0.72, depth * 0.82], [side * (width / 2 - 0.08), height * 0.36, 0], metalMaterial); });
      } else if (/cane/.test(chairVariant)) {
        for (var rib = -3; rib <= 3; rib += 1) addBox([0.015, height * 0.48, 0.02], [rib * width * 0.09, height * 0.67, -depth / 2 + 0.17], darkWoodMaterial);
        [-1, 1].forEach(function (side) { addBox([0.08, height * 0.56, depth * 0.78], [side * (width / 2 - 0.07), height * 0.32, 0], woodMaterial); });
      } else {
        [-1, 1].forEach(function (side) { addBox([0.16, height * 0.48, depth], [side * (width / 2 - 0.08), height * 0.35, 0], fabricMaterial); });
      }
    } else if (spec.model === 'coffeeTableVariant') {
      var tableVariant = spec.variant || 'original';
      if (tableVariant === 'round') {
        addCylinder(Math.min(width, depth) * 0.48, Math.min(width, depth) * 0.48, 0.07, [0, height * 0.84, 0], woodMaterial, 48);
        addCylinder(0.07, 0.14, height * 0.76, [0, height * 0.4, 0], metalMaterial, 28);
      } else if (tableVariant === 'nesting') {
        addCylinder(width * 0.3, width * 0.3, 0.06, [-width * 0.16, height * 0.76, 0], woodMaterial, 44);
        addCylinder(width * 0.22, width * 0.22, 0.06, [width * 0.25, height * 0.9, depth * 0.1], stoneMaterial, 44);
        addCylinder(0.045, 0.045, height * 0.72, [-width * 0.16, height * 0.38, 0], metalMaterial, 18);
        addCylinder(0.04, 0.04, height * 0.86, [width * 0.25, height * 0.45, depth * 0.1], metalMaterial, 18);
      } else if (tableVariant === 'plinth') {
        addBox([width, height * 0.16, depth], [0, height * 0.82, 0], woodMaterial);
        addBox([width * 0.68, height * 0.55, depth * 0.62], [0, height * 0.35, 0], darkWoodMaterial);
      } else if (tableVariant === 'stone-frame') {
        addBox([width, height * 0.12, depth], [0, height * 0.88, 0], stoneMaterial);
        [-1, 1].forEach(function (side) { addBox([0.04, height * 0.78, depth - 0.08], [side * (width / 2 - 0.08), height * 0.42, 0], metalMaterial); });
      } else if (tableVariant === 'glass-frame') {
        var glassMaterial = new THREE.MeshStandardMaterial({ color: 0xa9c0c2, transparent: true, opacity: 0.56, roughness: 0.12, metalness: 0.08 });
        addBox([width, height * 0.08, depth], [0, height * 0.88, 0], glassMaterial);
        [-1, 1].forEach(function (side) { addBox([0.04, height * 0.80, depth * 0.82], [side * (width / 2 - 0.08), height * 0.42, 0], metalMaterial); });
      } else if (tableVariant === 'sculptural') {
        addBox([width * 0.72, height * 0.16, depth], [-width * 0.14, height * 0.82, 0], woodMaterial);
        addBox([width * 0.58, height * 0.16, depth * 0.82], [width * 0.24, height * 0.94, depth * 0.08], stoneMaterial);
        addBox([width * 0.48, height * 0.58, depth * 0.48], [-width * 0.10, height * 0.31, 0], darkWoodMaterial);
      } else if (tableVariant === 'square-tray') {
        var side = Math.min(width, depth * 1.35);
        addBox([side, height * 0.12, side], [0, height * 0.88, 0], woodMaterial);
        addBox([side * 0.76, height * 0.76, 0.04], [0, height * 0.40, 0], metalMaterial);
        addBox([0.04, height * 0.76, side * 0.76], [0, height * 0.40, 0], metalMaterial);
      } else {
        addBox([width, height * 0.12, depth], [0, height * 0.9, 0], woodMaterial);
        [-0.38, 0.38].forEach(function (x) { [-0.35, 0.35].forEach(function (z) { addBox([width * 0.07, height * 0.82, depth * 0.07], [x * width, height * 0.42, z * depth], darkWoodMaterial); }); });
      }
    } else if (spec.model === 'wardrobeVariant') {
      var wardrobeVariant = spec.variant || 'panelled';
      addBox([width, height - 0.1, depth], [0, height / 2, 0], woodMaterial);
      addBox([width + 0.05, 0.08, depth + 0.04], [0, 0.04, 0], darkWoodMaterial);
      var doors = wardrobeVariant === 'sliding' ? 2 : Math.max(2, Math.round(width / 0.62));
      for (var doorIndex = 0; doorIndex < doors; doorIndex += 1) {
        var doorWidth = width / doors;
        var doorX = -width / 2 + doorWidth * (doorIndex + 0.5);
        var doorMaterial = /mirrored|smoked-glass/.test(wardrobeVariant) && doorIndex % 2 === 0
          ? new THREE.MeshStandardMaterial({ color: 0x9dacaf, roughness: 0.18, metalness: 0.22 })
          : wardrobeVariant === 'lacquer' ? new THREE.MeshStandardMaterial({ color: palette.wall, roughness: 0.22 })
          : (wardrobeVariant === 'two-tone' && doorIndex % 2) ? darkWoodMaterial : woodMaterial;
        addBox([doorWidth - 0.025, height - 0.28, 0.035], [doorX, height * 0.5, depth / 2 + 0.018], doorMaterial);
        if (/fluted|cane/.test(wardrobeVariant)) {
          for (var flute = -2; flute <= 2; flute += 1) addBox([0.016, height - 0.42, 0.018], [doorX + flute * doorWidth * 0.13, height * 0.5, depth / 2 + 0.045], darkWoodMaterial);
        }
        addBox([0.018, 0.38, 0.028], [doorX + doorWidth * 0.34, height * 0.5, depth / 2 + 0.055], metalMaterial);
      }
    } else if (spec.model === 'bedVariant') {
      var bedVariant = spec.variant || 'tufted';
      addBox([width, height * 0.3, depth], [0, height * 0.24, 0], darkWoodMaterial);
      addBox([width - 0.1, height * 0.25, depth - 0.18], [0, height * 0.48, 0.05], fabricLightMaterial);
      addBox([width, height * (/canopy/.test(bedVariant) ? 0.95 : 0.76), 0.16], [0, height * 0.62, -depth / 2 + 0.08], bedVariant === 'timber-slat' ? woodMaterial : fabricMaterial);
      [-1, 1].forEach(function (side) { addBox([width * 0.34, height * 0.18, depth * 0.18], [side * width * 0.2, height * 0.68, -depth * 0.28], fabricLightMaterial); });
      if (bedVariant === 'timber-slat') { for (var slat = -5; slat <= 5; slat += 1) addBox([0.025, height * 0.72, 0.025], [slat * width * 0.075, height * 0.62, -depth / 2 + 0.18], darkWoodMaterial); }
      if (bedVariant === 'low-platform') addBox([width + 0.20, height * 0.10, depth + 0.12], [0, height * 0.08, 0], darkWoodMaterial);
      if (bedVariant === 'wingback') { [-1, 1].forEach(function (side) { addBox([width * 0.14, height * 0.82, 0.24], [side * (width / 2 - width * 0.07), height * 0.62, -depth / 2 + 0.12], fabricMaterial); }); }
      if (bedVariant === 'sleigh') addBox([width, height * 0.52, 0.18], [0, height * 0.36, depth / 2 - 0.09], woodMaterial);
      if (bedVariant === 'canopy') { [-1, 1].forEach(function (x) { [-1, 1].forEach(function (z) { addBox([0.035, height * 1.8, 0.035], [x * (width / 2 - 0.04), height * 0.9, z * (depth / 2 - 0.05)], metalMaterial); }); }); }
    } else if (spec.model === 'nightstand') {
      addBox([width, height * 0.78, depth], [0, height * 0.45, 0], woodMaterial);
      addBox([width - 0.06, height * 0.3, 0.03], [0, height * 0.56, depth / 2 + 0.015], darkWoodMaterial);
      addCylinder(0.018, 0.018, 0.09, [0, height * 0.56, depth / 2 + 0.05], metalMaterial, 12);
      addCylinder(0.10, 0.13, 0.24, [0, height * 0.95, 0], stoneMaterial, 20);
    } else if (spec.model === 'diningTableVariant' || spec.model === 'roundDiningTable') {
      var shape = spec.shape || 'round';
      var timber = new THREE.MeshStandardMaterial({ color: palette.wood, roughness: 0.58 });
      var darkTimber = new THREE.MeshStandardMaterial({ color: new THREE.Color(palette.wood).multiplyScalar(0.62), roughness: 0.64 });
      if (shape === 'round') {
        addCylinder(width / 2, width / 2, 0.075, [0, height * 0.88, 0], timber, 48);
        addCylinder(width * 0.10, width * 0.18, height * 0.82, [0, height * 0.43, 0], darkTimber, 32);
        addCylinder(width * 0.27, width * 0.30, 0.06, [0, 0.03, 0], darkTimber, 32);
      } else {
        var topDepth = shape === 'square' ? width : depth;
        addBox([width, 0.075, topDepth], [0, height * 0.88, 0], timber);
        if (/oval|racetrack|rounded/.test(shape)) {
          [-1, 1].forEach(function (side) { addCylinder(0.10, 0.16, height * 0.80, [side * width * 0.27, height * 0.42, 0], darkTimber, 28); });
        } else {
          [-1, 1].forEach(function (x) { [-1, 1].forEach(function (z) { addBox([0.07, height * 0.82, 0.07], [x * (width / 2 - 0.10), height * 0.42, z * (topDepth / 2 - 0.10)], darkTimber); }); });
        }
      }
    } else if (spec.model === 'diningChair' || spec.model === 'modernChair') {
      addBox([width * 0.9, 0.06, depth * 0.9], [0, height * 0.48, 0], fabricMaterial);
      addBox([width * 0.86, height * 0.44, 0.06], [0, height * 0.72, -depth * 0.4], /modern/.test(spec.model) ? fabricMaterial : woodMaterial);
      [-1, 1].forEach(function (x) { [-1, 1].forEach(function (z) { addCylinder(0.022, 0.02, height * 0.46, [x * width * 0.36, height * 0.23, z * depth * 0.36], /modern/.test(spec.model) ? metalMaterial : darkWoodMaterial, 12); }); });
    } else if (spec.model === 'tvUnitVariant' || spec.model === 'tvUnit') {
      var mediaVariant = spec.variant || 'original';
      addBox([width, height * 0.50, depth], [0, height * 0.25, 0], woodMaterial);
      var screen = new THREE.MeshStandardMaterial({ color: 0x111416, roughness: 0.18, metalness: 0.12 });
      if (spec.model === 'tvUnitVariant') addBox([width * 0.82, height * 0.76, 0.035], [0, height * 1.06, -depth / 2 + 0.02], screen);
      if (/timber-wall|stone-wall/.test(mediaVariant)) addBox([width * 0.96, height * 1.34, 0.045], [0, height * 0.83, -depth / 2 - 0.03], mediaVariant === 'stone-wall' ? stoneMaterial : darkWoodMaterial);
      if (mediaVariant === 'floating') group.children[0].position.y += height * 0.24;
      if (mediaVariant === 'classic-hutch') { [-1, 1].forEach(function (side) { addBox([width * 0.13, height * 1.62, depth], [side * width * 0.43, height * 0.81, 0], woodMaterial); }); }
    } else if (spec.model === 'wallArtVariant') {
      var artVariant = spec.variant || 'single';
      var panelCount = artVariant === 'diptych' ? 2 : artVariant === 'triptych' ? 3 : artVariant === 'gallery' ? 4 : 1;
      var gap = 0.06;
      var panelWidth = (width - gap * (panelCount - 1)) / panelCount;
      for (var panel = 0; panel < panelCount; panel += 1) {
        var panelX = (panel - (panelCount - 1) / 2) * (panelWidth + gap);
        addBox([panelWidth, height, depth], [panelX, 1.32, 0], darkWoodMaterial);
        addBox([panelWidth - 0.05, height - 0.05, depth + 0.008], [panelX, 1.32, 0.01], panel % 2 ? fabricLightMaterial : stoneMaterial);
      }
    } else if (spec.model === 'cabinetRun') {
      var moduleCount = Math.max(3, Math.round(width / 0.62));
      for (var module = 0; module < moduleCount; module += 1) {
        var moduleWidth = width / moduleCount - 0.012;
        var moduleX = -width / 2 + moduleWidth / 2 + module * (width / moduleCount);
        addBox([moduleWidth, 0.78, depth], [moduleX, 0.39, 0]);
        addBox([moduleWidth, 0.72, depth * 0.62], [moduleX, 1.75, depth * 0.16]);
      }
      // Exactly the web build: modules, counter, backsplash. A sink and hob were
      // added here at one point; they are not in Livinai_web's cabinetRun, so
      // they are gone again to keep the kitchen run identical.
      var counterMaterial = new THREE.MeshStandardMaterial({ color: 0xeeeae3, roughness: 0.42 });
      var counter = new THREE.Mesh(new THREE.BoxGeometry(width + 0.08, 0.08, depth + 0.06), counterMaterial);
      counter.position.y = 0.84;
      group.add(counter);
      var backsplash = new THREE.Mesh(new THREE.BoxGeometry(width, 0.58, 0.035), new THREE.MeshStandardMaterial({ color: 0xb8cdca, roughness: 0.48 }));
      backsplash.position.set(0, 1.18, depth * 0.49);
      group.add(backsplash);
    } else if (spec.model === 'island') {
      addBox([width, height * 0.88, depth], [0, height * 0.44, 0], woodMaterial);
      addBox([width + 0.10, 0.07, depth + 0.10], [0, height * 0.91, 0], stoneMaterial);
    } else if (spec.model === 'fridge') {
      addBox([width, height, depth], [0, height / 2, 0], new THREE.MeshStandardMaterial({ color: 0xd3d7d8, roughness: 0.3, metalness: 0.5 }));
      addBox([0.03, height * 0.32, 0.05], [width * 0.36, height * 0.62, depth / 2 + 0.02], metalMaterial);
      addBox([width - 0.04, 0.02, 0.02], [0, height * 0.62, depth / 2 + 0.01], darkWoodMaterial);
    } else if (spec.model === 'vanity') {
      addBox([width, height * 0.62, depth], [0, height * 0.42, 0], woodMaterial);
      addBox([width + 0.04, 0.06, depth + 0.04], [0, height * 0.75, 0], stoneMaterial);
      addCylinder(width * 0.16, width * 0.18, 0.10, [0, height * 0.80, 0], stoneMaterial, 28);
      addCylinder(0.02, 0.02, 0.26, [0, height * 0.95, -depth * 0.28], metalMaterial, 12);
      addBox([width * 0.72, height * 0.62, 0.03], [0, height * 1.42, -depth / 2 + 0.02], new THREE.MeshStandardMaterial({ color: 0xc3d2d3, roughness: 0.1, metalness: 0.4 }));
    } else if (spec.model === 'toilet') {
      addBox([width, height * 0.5, depth * 0.72], [0, height * 0.25, depth * 0.1], stoneMaterial);
      addBox([width * 0.86, height * 0.62, depth * 0.24], [0, height * 0.45, -depth * 0.36], stoneMaterial);
      addCylinder(width * 0.44, width * 0.42, 0.05, [0, height * 0.52, depth * 0.1], stoneMaterial, 24);
    } else if (spec.model === 'shower') {
      var glass = new THREE.MeshStandardMaterial({ color: 0xbcd6d8, transparent: true, opacity: 0.34, roughness: 0.08, metalness: 0.1 });
      addBox([width, 0.06, depth], [0, 0.03, 0], stoneMaterial);
      addBox([width, height, 0.02], [0, height / 2, -depth / 2], glass);
      addBox([0.02, height, depth], [width / 2, height / 2, 0], glass);
      addCylinder(0.045, 0.045, 0.04, [0, height * 0.94, 0], metalMaterial, 18);
    } else if (spec.model === 'bathtub') {
      addBox([width, height, depth], [0, height / 2, 0], stoneMaterial);
      addBox([width - 0.16, height * 0.5, depth - 0.16], [0, height * 0.78, 0], new THREE.MeshStandardMaterial({ color: 0xdfeaea, roughness: 0.2 }));
    } else if (spec.model === 'bookcase') {
      addBox([width, height, depth], [0, height / 2, 0], woodMaterial);
      var shelves = Math.max(3, Math.round(height / 0.42));
      for (var shelf = 1; shelf < shelves; shelf += 1) addBox([width - 0.06, 0.025, depth - 0.03], [0, (height / shelves) * shelf, 0.01], darkWoodMaterial);
      for (var book = 0; book < shelves * 3; book += 1) {
        var shelfIndex = Math.floor(book / 3);
        addBox([0.07 + (book % 3) * 0.02, 0.22, depth * 0.6], [-width * 0.32 + (book % 3) * 0.11 + (shelfIndex % 2) * 0.2, (height / shelves) * (shelfIndex + 0.5), 0], book % 2 ? fabricMaterial : stoneMaterial);
      }
    } else if (spec.model === 'workDesk') {
      addBox([width, 0.05, depth], [0, height * 0.94, 0], woodMaterial);
      [-1, 1].forEach(function (x) { addBox([0.06, height * 0.92, depth * 0.9], [x * (width / 2 - 0.09), height * 0.46, 0], metalMaterial); });
      addBox([width * 0.34, height * 0.34, depth * 0.7], [width * 0.26, height * 0.72, 0], darkWoodMaterial);
    } else if (spec.model === 'washer') {
      addBox([width, height, depth], [0, height / 2, 0], new THREE.MeshStandardMaterial({ color: 0xe4e7e6, roughness: 0.34 }));
      addCylinder(width * 0.3, width * 0.3, 0.04, [0, height * 0.58, depth / 2], new THREE.MeshStandardMaterial({ color: 0x8fa3a6, roughness: 0.12, metalness: 0.3 }), 28).rotation.x = Math.PI / 2;
    } else if (spec.model === 'floorLamp') {
      addCylinder(width * 0.42, width * 0.46, 0.03, [0, 0.015, 0], metalMaterial, 28);
      addCylinder(0.018, 0.018, height * 0.82, [0, height * 0.42, 0], metalMaterial, 14);
      var shade = new THREE.Mesh(
        new THREE.CylinderGeometry(width * 0.46, width * 0.62, height * 0.2, 28, 1, true),
        new THREE.MeshStandardMaterial({ color: 0xf3eadb, emissive: 0xffe6b8, emissiveIntensity: 0.5, roughness: 0.9, side: THREE.DoubleSide })
      );
      shade.position.y = height * 0.9;
      group.add(shade);
    } else if (spec.model === 'tableLamp') {
      addCylinder(width * 0.34, width * 0.4, 0.025, [0, 0.012, 0], darkWoodMaterial, 20);
      addCylinder(0.016, 0.016, height * 0.52, [0, height * 0.28, 0], metalMaterial, 12);
      var smallShade = new THREE.Mesh(
        new THREE.CylinderGeometry(width * 0.4, width * 0.54, height * 0.34, 20, 1, true),
        new THREE.MeshStandardMaterial({ color: 0xf3eadb, emissive: 0xffe6b8, emissiveIntensity: 0.55, roughness: 0.9, side: THREE.DoubleSide })
      );
      smallShade.position.y = height * 0.78;
      group.add(smallShade);
    } else if (spec.model === 'sideTable') {
      addCylinder(width * 0.48, width * 0.48, 0.05, [0, height * 0.94, 0], woodMaterial, 32);
      addCylinder(width * 0.07, width * 0.14, height * 0.9, [0, height * 0.45, 0], metalMaterial, 20);
    } else if (spec.model === 'dresser') {
      addBox([width, height, depth], [0, height / 2, 0], woodMaterial);
      var drawerRows = Math.max(2, Math.round(height / 0.3));
      for (var row = 0; row < drawerRows; row += 1) {
        var rowY = (height / drawerRows) * (row + 0.5);
        addBox([width - 0.06, height / drawerRows - 0.03, 0.02], [0, rowY, depth / 2 + 0.012], darkWoodMaterial);
        addBox([width * 0.22, 0.016, 0.026], [0, rowY, depth / 2 + 0.03], metalMaterial);
      }
      [-1, 1].forEach(function (side) { addCylinder(0.02, 0.016, 0.09, [side * (width / 2 - 0.07), 0.045, depth / 2 - 0.07], darkWoodMaterial, 10); });
    } else if (spec.model === 'wallMirror') {
      addBox([width, height, depth], [0, height / 2 + (spec.mountHeight || 0.9), 0], darkWoodMaterial);
      addBox([width - 0.06, height - 0.06, depth * 0.4], [0, height / 2 + (spec.mountHeight || 0.9), depth * 0.4],
        new THREE.MeshStandardMaterial({ color: 0xc4d3d4, roughness: 0.06, metalness: 0.55 }));
    } else if (spec.model === 'bench') {
      addBox([width, height * 0.24, depth], [0, height * 0.82, 0], fabricLightMaterial);
      [-1, 1].forEach(function (x) { [-1, 1].forEach(function (z) { addBox([0.05, height * 0.72, 0.05], [x * (width / 2 - 0.08), height * 0.36, z * (depth / 2 - 0.07)], darkWoodMaterial); }); });
    } else if (spec.model === 'consoleTable') {
      addBox([width, 0.05, depth], [0, height * 0.94, 0], woodMaterial);
      addBox([width - 0.16, 0.03, depth - 0.1], [0, height * 0.42, 0], woodMaterial);
      [-1, 1].forEach(function (x) { [-1, 1].forEach(function (z) { addCylinder(0.02, 0.016, height * 0.92, [x * (width / 2 - 0.07), height * 0.46, z * (depth / 2 - 0.06)], metalMaterial, 12); }); });
    } else if (spec.model === 'barStool') {
      addCylinder(width * 0.48, width * 0.44, 0.06, [0, height * 0.92, 0], fabricMaterial, 24);
      addCylinder(0.026, 0.026, height * 0.9, [0, height * 0.45, 0], metalMaterial, 14);
      addCylinder(width * 0.44, width * 0.46, 0.02, [0, 0.01, 0], metalMaterial, 24);
      addCylinder(width * 0.3, width * 0.3, 0.015, [0, height * 0.26, 0], metalMaterial, 18);
    } else if (spec.model === 'towelRail') {
      var railY = spec.mountHeight || 1.1;
      addCylinder(0.014, 0.014, width, [0, railY, 0], metalMaterial, 12).rotation.z = Math.PI / 2;
      [-1, 1].forEach(function (side) {
        addBox([0.03, 0.03, 0.07], [side * (width / 2 - 0.02), railY, -0.04], metalMaterial);
        var towel = addBox([width * 0.34, 0.44, 0.035], [side * width * 0.2, railY - 0.22, 0.03], fabricLightMaterial);
        towel.castShadow = true;
      });
    } else if (spec.model === 'wallShelf') {
      var shelfY = spec.mountHeight || 1.35;
      addBox([width, 0.035, depth], [0, shelfY, 0], woodMaterial);
      addBox([width, 0.035, depth], [0, shelfY + 0.34, 0], woodMaterial);
      for (var item = 0; item < 5; item += 1) {
        addBox([0.07, 0.16 + (item % 3) * 0.05, depth * 0.6], [-width * 0.34 + item * width * 0.16, shelfY + 0.1, 0], item % 2 ? stoneMaterial : fabricMaterial);
      }
    } else if (spec.model === 'coatRack') {
      addCylinder(width * 0.4, width * 0.44, 0.03, [0, 0.015, 0], darkWoodMaterial, 20);
      addCylinder(0.022, 0.022, height, [0, height / 2, 0], woodMaterial, 14);
      for (var hook = 0; hook < 4; hook += 1) {
        var angle = (hook / 4) * Math.PI * 2;
        addBox([0.11, 0.02, 0.02], [Math.cos(angle) * 0.07, height * 0.9, Math.sin(angle) * 0.07], metalMaterial).rotation.y = -angle;
      }
    } else if (spec.model === 'toyStorage') {
      addBox([width, height, depth], [0, height / 2, 0], woodMaterial);
      for (var bin = 0; bin < 3; bin += 1) {
        addBox([width / 3 - 0.05, height * 0.4, depth * 0.8], [-width / 3 + bin * (width / 3), height * 0.28, 0.02],
          new THREE.MeshStandardMaterial({ color: bin % 2 ? palette.accent : palette.fabric, roughness: 0.85 }));
      }
    } else if (/sofa|chair/i.test(spec.model)) {
      addBox([width, height * 0.34, depth], [0, height * 0.3, 0]);
      addBox([width, height * 0.58, depth * 0.18], [0, height * 0.63, depth * 0.39]);
    } else if (/table/i.test(spec.model)) {
      addBox([width, height * 0.12, depth], [0, height * 0.9, 0]);
      [-0.38, 0.38].forEach(function (x) { [-0.35, 0.35].forEach(function (z) { addBox([width * 0.08, height * 0.82, depth * 0.08], [x * width, height * 0.42, z * depth]); }); });
    } else {
      addBox([width, height, depth], [0, height / 2, 0]);
    }

    group.position.copy(spec.position);
    // "lift" stacks an object on top of another (a lamp on a nightstand, say)
    // without needing a parent-child relationship in the scene graph.
    if (spec.lift) group.position.y += spec.lift;
    group.rotation.y = spec.rotation || 0;
    setInteractiveInfo(group, { name: spec.name, material: spec.material, detail: spec.detail, category: spec.model });
    parent.add(group);
    return group;
  }

  // ── Room programmes ─────────────────────────────────────────────────────
  function roomFurniture(type, bounds, style, context) {
    context = context || {};
    var centre = bounds.centre;
    var rotation = bounds.rotation;
    var offset = function (x, z) { return centre.clone().addScaledVector(bounds.axisX, x).addScaledVector(bounds.axisZ, z); };
    var loungeOffset = function (x, z) { return centre.clone().addScaledVector(bounds.axisX, x + (context.loungeOffsetX || 0)).addScaledVector(bounds.axisZ, z); };
    var items = [];
    var lower = (type || 'Living Room').toLowerCase();
    var styleKey = (style || 'Modern').toLowerCase();
    var signature = type + '|' + style + '|' + bounds.area.toFixed(2) + '|' + bounds.width.toFixed(2) + '|' + bounds.depth.toFixed(2);

    if (lower.indexOf('living') >= 0) {
      var sofaWidth = Math.min(2.55, bounds.width * 0.62);
      var styleSofas = /classic|traditional|industrial/.test(styleKey) ? ['tailored', 'track-arm', 'tuxedo', 'camelback']
        : /boho/.test(styleKey) ? ['curved', 'daybed', 'low-profile']
        : /scandinavian|japandi|minimal/.test(styleKey) ? ['low-profile', 'curved', 'daybed']
        : ['tailored', 'low-profile', 'curved', 'track-arm', 'tuxedo', 'daybed'];
      var largeSofaVariants = styleSofas.concat(['left-chaise', 'right-chaise', 'modular']);
      var sectionalRoomy = bounds.area >= 22 && bounds.depth >= (context.hasBalcony ? 4.2 : 3.65) && (!context.openPlan || bounds.area >= 42) && !context.hasBalcony;
      var sofaVariant = stableVariant(signature + '|sofa', sectionalRoomy ? largeSofaVariants : styleSofas);
      var sofaDepth = /chaise|modular/.test(sofaVariant) ? Math.min(1.72, bounds.depth * 0.43) : 0.96;
      var sofaLabel = sofaVariant === 'left-chaise' ? 'Left L-sectional sofa'
        : sofaVariant === 'right-chaise' ? 'Right L-sectional sofa'
        : sofaVariant === 'modular' ? 'Modular sectional sofa'
        : sofaVariant.replace('-', ' ') + ' sofa';
      items.push({ model: 'sofaVariant', variant: sofaVariant, name: sofaLabel, material: style + ' upholstery', detail: 'An original-source ' + sofaVariant.replace('-', ' ') + ' silhouette, squared to the room’s dominant wall with protected circulation.', size: [sofaWidth, 0.92, sofaDepth], position: loungeOffset(0, -bounds.depth / 2 + sofaDepth / 2 + 0.1), rotation: rotation, colorKey: 'fabric' });
      var tableVariant = stableVariant(signature + '|coffee-table', ['original', 'round', 'nesting', 'plinth', 'stone-frame', 'glass-frame', 'sculptural', 'square-tray']);
      items.push({ model: 'coffeeTableVariant', variant: tableVariant, name: tableVariant.replace('-', ' ') + ' coffee table', material: style + ' timber, stone and metal', detail: 'Selected from the original Livinai table family and aligned to the seating axis.', size: [Math.min(1.2, sofaWidth * 0.56), 0.48, 0.66], position: loungeOffset(0, -bounds.depth / 2 + Math.min(sofaDepth + 0.82, bounds.depth * 0.54)), rotation: rotation, colorKey: 'wood' });
      var tvVariants = /classic|traditional/.test(styleKey) ? ['original', 'stone-wall', 'classic-hutch'] : /industrial/.test(styleKey) ? ['fluted', 'stone-wall', 'asymmetric'] : ['original', 'fluted', 'timber-wall', 'stone-wall', 'floating', 'asymmetric'];
      var tvVariant = stableVariant(signature + '|tv-unit', tvVariants);
      items.push({ model: 'tvUnitVariant', variant: tvVariant, name: tvVariant.replace('-', ' ') + ' media unit', material: style + ' timber, stone and metal', detail: 'Centred directly on the sofa axis with an unobstructed viewing corridor.', size: [Math.min(2.0, bounds.width * 0.50), 0.92, 0.46], position: offset(0, bounds.depth / 2 - 0.3), rotation: rotation, colorKey: 'wood' });
      if (bounds.width > 3.8 && bounds.depth > 3.2) {
        var accentChair = stableVariant(signature + '|armchair', ['wingback', 'barrel', 'lounge-shell', 'sling', 'cane']);
        items.push({ model: 'armchairVariant', variant: accentChair, name: accentChair.replace('-', ' ') + ' accent chair', material: style + ' accent upholstery', detail: 'A coordinated secondary seat rotated toward the conversation zone.', size: [0.9, 0.92, 0.9], position: loungeOffset(-bounds.width * 0.3, 0.05), rotation: rotation + 0.45, colorKey: 'accent' });
      }
      var artVariant = stableVariant(signature + '|art', ['single', 'diptych', 'triptych', 'gallery']);
      items.push({ model: 'wallArtVariant', variant: artVariant, name: artVariant + ' wall-art composition', material: style + ' framed mixed media', detail: 'Scaled and centred over the sofa as part of the room’s coordinated decorative layer.', size: [Math.min(1.8, sofaWidth * 0.70), 0.78, 0.045], position: loungeOffset(0, -bounds.depth / 2 + 0.08), rotation: rotation, colorKey: 'accent' });
    } else if (lower.indexOf('bed') >= 0) {
      var bedWidth = Math.min(1.8, bounds.width * 0.58);
      var bedDepth = Math.min(2.15, bounds.depth * 0.62);
      var bedVariants = bounds.area >= 15 ? ['tufted', 'channel', 'timber-slat', 'canopy', 'storage', 'low-platform', 'wingback', 'sleigh'] : ['tufted', 'channel', 'timber-slat', 'storage', 'low-platform', 'wingback'];
      var bedVariant = stableVariant(signature + '|bed', bedVariants);
      items.push({ model: 'bedVariant', variant: bedVariant, name: bedVariant.replace('-', ' ') + ' bed', material: style + ' upholstery and timber', detail: 'An original-source bed variation centred on the longest wall with balanced bedside clearance.', size: [bedWidth, 1.0, bedDepth], position: offset(0, -bounds.depth / 2 + bedDepth / 2 + 0.12), rotation: rotation, colorKey: 'fabric' });
      var wardrobeVariant = stableVariant(signature + '|wardrobe', ['panelled', 'sliding', 'mirrored', 'fluted', 'two-tone', 'cane', 'smoked-glass', 'lacquer']);
      items.push({ model: 'wardrobeVariant', variant: wardrobeVariant, name: wardrobeVariant.replace('-', ' ') + ' wardrobe', material: style + ' coordinated cabinetry', detail: 'Full-height original-source storage aligned to a free perimeter wall.', size: [Math.min(1.7, bounds.width * 0.42), 2.1, 0.55], position: offset(bounds.width / 2 - 0.95, bounds.depth / 2 - 0.38), rotation: rotation, colorKey: 'wood' });
    } else if (lower.indexOf('kitchen') >= 0) {
      items.push({ model: 'cabinetRun', name: 'Complete kitchen run', material: 'Matte cabinetry, tile and quartz', detail: 'Cabinetry is squared and centred on the room’s longest service wall.', size: [Math.min(3.6, bounds.width * 0.78), 2.15, 0.64], position: offset(0, -bounds.depth / 2 + 0.38), rotation: rotation, colorKey: 'wood' });
      items.push({ model: 'island', name: 'Kitchen island', material: 'Cabinetry and worktop', detail: 'A central preparation surface with clear working space around it.', size: [Math.min(2.0, bounds.width * 0.56), 0.95, 0.9], position: offset(0, 0.05), rotation: rotation, colorKey: 'wood' });
      items.push({ model: 'fridge', name: 'Integrated refrigerator', material: 'Matte appliance finish', detail: 'Aligned with the service run instead of floating in the room.', size: [0.76, 1.95, 0.72], position: offset(bounds.width / 2 - 0.5, -bounds.depth / 2 + 0.42), rotation: rotation, colorKey: 'metal' });
    } else if (lower.indexOf('bath') >= 0) {
      var wet = bounds.width > 2.7 ? 'bathtub' : 'shower';
      items.push({ model: wet, name: wet === 'bathtub' ? 'Bathtub' : 'Walk-in shower', material: 'Stone and clear glass', detail: 'The wet fixture is staged first, matching the Interior_Plan bathroom logic.', size: wet === 'bathtub' ? [1.7, 0.65, 0.8] : [0.95, 2.05, 0.95], position: offset(-bounds.width * 0.22, -bounds.depth * 0.2), rotation: rotation, colorKey: 'wall' });
      items.push({ model: 'vanity', name: 'Bathroom vanity', material: 'Stone basin and cabinetry', detail: 'Placed around the primary wet fixture with safe circulation.', size: [1.05, 0.92, 0.55], position: offset(bounds.width * 0.25, 0.1), rotation: rotation, colorKey: 'wood' });
      items.push({ model: 'toilet', name: 'Toilet', material: 'Ceramic', detail: 'Functionally positioned with usable clearance.', size: [0.46, 0.78, 0.7], position: offset(bounds.width * 0.26, -bounds.depth * 0.28), rotation: rotation, colorKey: 'wall' });
    } else if (lower.indexOf('dining') >= 0) {
      var shortSide = Math.min(bounds.width, bounds.depth);
      var aspect = Math.max(bounds.width, bounds.depth) / Math.max(shortSide, 0.01);
      var seats = (bounds.area >= 28 && bounds.width >= 5 && shortSide >= 3.6) ? 8 : (bounds.area >= 15 && shortSide >= 2.8) ? 6 : (bounds.area >= 8 && shortSide >= 2.1) ? 4 : 2;
      var balanced = aspect <= 1.24;
      var useRound = balanced && seats <= 4 && !/industrial|traditional/.test(styleKey);
      var useSquare = balanced && seats === 4 && /classic|traditional|modern/.test(styleKey);
      if (useRound || useSquare) {
        var tableShape = useSquare ? 'square' : 'round';
        var diameter = seats === 2 ? 0.86 : useSquare ? 1.0 : 1.06;
        var chairRadius = diameter / 2 + 0.52;
        items.push({ model: 'diningTableVariant', shape: tableShape, name: seats + '-seat ' + tableShape + ' dining table', material: style + ' timber finish', detail: 'A ' + tableShape + ' table selected from the room’s actual pull-out and circulation clearance.', size: [diameter, 0.78, diameter], position: offset(0, 0), rotation: rotation, colorKey: 'wood', fitMode: 'exact' });
        var radial = seats === 2 ? [[chairRadius, 0, -Math.PI / 2], [-chairRadius, 0, Math.PI / 2]] : [[chairRadius, 0, -Math.PI / 2], [-chairRadius, 0, Math.PI / 2], [0, chairRadius, Math.PI], [0, -chairRadius, 0]];
        radial.forEach(function (entry) {
          items.push({ model: 'diningChair', name: 'Dining chair', material: 'Timber and textile', detail: 'Precisely aligned to the ' + tableShape + ' table.', size: [0.5, 0.9, 0.54], position: offset(entry[0], entry[1]), rotation: rotation + entry[2], colorKey: 'fabric' });
        });
      } else {
        var dimensions = seats === 8 ? [2.26, 1.02] : seats === 6 ? [1.78, 0.92] : seats === 4 ? [1.36, 0.82] : [1.02, 0.72];
        var tableWidth = Math.min(dimensions[0], bounds.width - 1.08);
        var tableDepth = dimensions[1];
        var sideZ = tableDepth / 2 + 0.48;
        var shapeOptions = /industrial|traditional/.test(styleKey) ? ['rectangular', 'racetrack'] : /scandinavian|japandi|minimal/.test(styleKey) ? ['oval', 'rounded-rectangle', 'rectangular'] : /classic|boho/.test(styleKey) ? ['oval', 'rectangular'] : ['rectangular', 'oval', 'racetrack', 'rounded-rectangle'];
        var dineShape = stableVariant(signature + '|dining-shape|' + seats, shapeOptions);
        items.push({ model: 'diningTableVariant', shape: dineShape, name: seats + '-seat ' + dineShape.replace('-', ' ') + ' dining table', material: style + ' timber, stone and metal', detail: 'A ' + dineShape.replace('-', ' ') + ' table sized from usable clearance rather than total room area.', size: [tableWidth, 0.78, tableDepth], position: offset(0, 0), rotation: rotation, colorKey: 'wood', fitMode: 'exact' });
        var sidePositions = seats === 2 ? [0] : seats <= 6 ? [-tableWidth * 0.27, tableWidth * 0.27] : [-tableWidth * 0.31, 0, tableWidth * 0.31];
        sidePositions.forEach(function (x) {
          [-sideZ, sideZ].forEach(function (z) {
            items.push({ model: 'diningChair', name: 'Dining chair', material: 'Timber and textile', detail: 'Symmetrically aligned with consistent pull-out clearance.', size: [0.5, 0.9, 0.54], position: offset(x, z), rotation: rotation + (z > 0 ? Math.PI : 0), colorKey: 'fabric' });
          });
        });
        if (seats >= 6) {
          var endX = tableWidth / 2 + 0.46;
          items.push({ model: 'diningChair', name: 'Dining chair', material: 'Timber and textile', detail: 'End chair aligned to the table centreline.', size: [0.5, 0.9, 0.54], position: offset(endX, 0), rotation: rotation - Math.PI / 2, colorKey: 'fabric' });
          items.push({ model: 'diningChair', name: 'Dining chair', material: 'Timber and textile', detail: 'End chair aligned to the table centreline.', size: [0.5, 0.9, 0.54], position: offset(-endX, 0), rotation: rotation + Math.PI / 2, colorKey: 'fabric' });
        }
      }
      if (bounds.width > 3.4 && bounds.depth > 2.7) items.push({ model: 'tvUnit', name: 'Dining sideboard', material: 'Dark timber cabinetry', detail: 'A sideboard is centred on a clear perimeter wall without crowding the table.', size: [Math.min(1.8, bounds.width * 0.44), 0.84, 0.46], position: offset(0, -bounds.depth / 2 + 0.3), rotation: rotation, colorKey: 'wood' });
    } else if (lower.indexOf('office') >= 0) {
      items.push({ model: 'workDesk', name: 'Work desk', material: 'Timber work surface', detail: 'Centred and squared to the longest wall while preserving the circulation centreline.', size: [Math.min(1.6, bounds.width * 0.54), 0.78, 0.72], position: offset(0, -bounds.depth / 2 + 0.48), rotation: rotation, colorKey: 'wood' });
      items.push({ model: 'modernChair', name: 'Desk chair', material: 'Performance textile', detail: 'Centred on the desk’s working axis.', size: [0.68, 1.0, 0.68], position: offset(0, -bounds.depth / 2 + 1.18), rotation: rotation + Math.PI, colorKey: 'fabric' });
      items.push({ model: 'bookcase', name: 'Open bookcase', material: 'Coordinated timber', detail: 'Vertical storage is aligned to the same architectural grid.', size: [1.25, 1.9, 0.4], position: offset(bounds.width / 2 - 0.75, bounds.depth / 2 - 0.28), rotation: rotation, colorKey: 'wood' });
    } else {
      items.push({ model: 'bookcase', name: 'Console storage', material: 'Coordinated timber', detail: 'Light-touch staging keeps circulation zones open.', size: [1.1, 1.2, 0.4], position: offset(0, -bounds.depth * 0.2), rotation: rotation, colorKey: 'wood' });
    }
    return items;
  }

  // ── Scene assembly ──────────────────────────────────────────────────────
  var layout = payload.layout;
  var roomConfigs = payload.roomConfigs || [];
  var settings = Object.assign({ freeExplore: true, useCatalog: true }, payload.settings || {});
  var furnitureEdits = payload.furnitureEdits || {};
  var state = { mode: payload.mode || 'walk', night: !!payload.night, roomIndex: payload.roomIndex || 0 };

  if (!layout || !layout.rooms || !layout.rooms.length) {
    post({ type: 'error', message: 'Draw at least one room before opening the walkthrough.' });
    return;
  }

  var scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe6e9e8);
  scene.fog = new THREE.Fog(0xe6e9e8, 48, 95);
  var camera = new THREE.PerspectiveCamera(70, 1, 0.05, 120);
  camera.rotation.order = 'YXZ';
  var renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
  else renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.16;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.getElementById('stage').appendChild(renderer.domElement);

  var flat = [];
  layout.rooms.forEach(function (room) { room.forEach(function (point) { flat.push(point); }); });
  var minX = Math.min.apply(null, flat.map(function (p) { return p[0]; }));
  var maxX = Math.max.apply(null, flat.map(function (p) { return p[0]; }));
  var minY = Math.min.apply(null, flat.map(function (p) { return p[1]; }));
  var maxY = Math.max.apply(null, flat.map(function (p) { return p[1]; }));
  var pixelCentre = [(minX + maxX) / 2, (minY + maxY) / 2];
  var pixelsPerMeter = Math.max(12, layout.pixelsPerMeter || 28);
  // One plan metre must remain one scene metre. The previous 1.28 spatial
  // multiplier enlarged every room by 63.8% in area while furniture retained
  // its authored metre dimensions, which made correctly-sized pieces look
  // miniature and disconnected the displayed room area from the 3D result.
  var worldScale = 1 / pixelsPerMeter;
  var toWorld = function (point) { return new THREE.Vector3((point[0] - pixelCentre[0]) * worldScale, 0, (point[1] - pixelCentre[1]) * worldScale); };
  var polygons = layout.rooms.map(function (room) { return room.map(toWorld); });
  var boundsList = polygons.map(roomBounds);
  var apartment = new THREE.Group();
  scene.add(apartment);
  var ceilingGroup = new THREE.Group();
  var trimGroup = new THREE.Group();
  apartment.add(ceilingGroup, trimGroup);

  var ambient = new THREE.HemisphereLight(0xfffcf5, 0x716b64, 2.85);
  scene.add(ambient);
  var sun = new THREE.DirectionalLight(0xfff3df, 3.25);
  sun.position.set(-7, 11, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -18; sun.shadow.camera.right = 18;
  sun.shadow.camera.top = 18; sun.shadow.camera.bottom = -18;
  scene.add(sun);

  var roomLights = [];
  polygons.forEach(function (polygon, index) {
    var config = roomConfigs[index] || { style: 'Modern', roomType: 'Living Room' };
    var palette = paletteFor(config.style, settings.colorMood);
    var shape = new THREE.Shape();
    polygon.forEach(function (point, pointIndex) { pointIndex ? shape.lineTo(point.x, -point.z) : shape.moveTo(point.x, -point.z); });
    shape.closePath();
    var hardFloor = /stone|tile|concrete|terrazzo/i.test(settings.floorFinish || '') || /bath|kitchen|laundry/i.test(config.roomType || '');
    var floorMaps = surfaceMaps(hardFloor ? 'tile' : 'wood', [3.2, 3.2]);
    var floorMaterial = new THREE.MeshStandardMaterial(Object.assign({}, floorMaps, {
      color: new THREE.Color(palette.floor).lerp(new THREE.Color(0xffffff), 0.66),
      roughness: hardFloor ? 0.58 : 0.72, normalScale: new THREE.Vector2(0.38, 0.38)
    }));
    var floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.005 + index * 0.0002;
    floor.receiveShadow = true;
    floor.userData = { name: (config.name || ('Room ' + (index + 1))) + ' floor', material: settings.floorFinish, detail: (settings.floorFinish || 'Auto by style') + ' selected for this ' + String(config.roomType || 'room').toLowerCase() + '.' };
    apartment.add(floor);

    // The ceiling plane's normal points away from the room, so a hemisphere
    // light gives its underside the dark ground colour and it reads as a muddy
    // slab from eye height. A small self-illumination stands in for the bounce
    // light a real room would get and keeps it reading as a clean white plane.
    var ceiling = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({
      color: 0xf4f3ef, roughness: 0.96, side: THREE.DoubleSide,
      emissive: 0xf1efe9, emissiveIntensity: 0.42
    }));
    ceiling.rotation.x = -Math.PI / 2;
    ceiling.position.y = 2.8;
    ceiling.receiveShadow = true;
    ceilingGroup.add(ceiling);

    var bounds = boundsList[index];
    if (!/none/i.test(settings.rugDesign || '') && !/kitchen|bath|hall|entry|utility|laundry|closet/i.test(config.roomType || '')) {
      var rug = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(bounds.width * 0.62, 3.2), Math.min(bounds.depth * 0.52, 2.3)), new THREE.MeshStandardMaterial({ color: palette.rug, roughness: 1 }));
      rug.rotation.x = -Math.PI / 2;
      rug.position.set(bounds.centre.x, 0.018, bounds.centre.z);
      rug.receiveShadow = true;
      rug.userData = { name: (settings.rugDesign || 'Style') + ' rug', material: 'Wool textile', detail: 'Coordinated with the ' + (config.style || 'Modern') + ' room.' };
      apartment.add(rug);
    }
    var pointLight = new THREE.PointLight(0xffd4a5, settings.designProfile === 'Layered' ? 3.1 : 2.25, Math.max(bounds.width, bounds.depth) * 1.75);
    pointLight.position.set(bounds.centre.x, 2.45, bounds.centre.z);
    scene.add(pointLight);
    roomLights.push(pointLight);

    var fixture = new THREE.Group();
    var cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.42, 8), new THREE.MeshStandardMaterial({ color: 0x4d493f, roughness: 0.62 }));
    cord.position.y = 2.57;
    var ring = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.055, 12, 36), new THREE.MeshStandardMaterial({ color: palette.metal, emissive: 0xffd9a4, emissiveIntensity: 0.22, roughness: 0.5 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 2.34;
    fixture.add(cord, ring);
    fixture.position.set(bounds.centre.x, 0, bounds.centre.z);
    setInteractiveInfo(fixture, { name: 'Pendant light', material: (config.style || 'Modern') + ' metal finish', detail: 'A room-specific pendant from the coordinated style family.' });
    apartment.add(fixture);

    var lightRows = bounds.width > 3.4 ? 2 : 1;
    var lightColumns = bounds.depth > 3.4 ? 2 : 1;
    for (var lx = 0; lx < lightRows; lx += 1) {
      for (var lz = 0; lz < lightColumns; lz += 1) {
        var downlight = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.025, 20), new THREE.MeshStandardMaterial({ color: 0xf2e2bd, emissive: 0xffdfa0, emissiveIntensity: 0.38, roughness: 0.55 }));
        downlight.position.set(bounds.minX + bounds.width * ((lx + 1) / (lightRows + 1)), 2.776, bounds.minZ + bounds.depth * ((lz + 1) / (lightColumns + 1)));
        ceilingGroup.add(downlight);
      }
    }
  });

  function measuredOpening(opening) {
    var segment = opening.slice(0, 2).map(toWorld);
    segment.settings = opening[2] || {};
    return segment;
  }
  var doorSegments = (layout.doors || []).map(measuredOpening);
  var windowSegments = (layout.windows || []).map(measuredOpening);
  var balconySegments = (layout.balconies || []).map(measuredOpening);
  var edgeKeys = {};

  polygons.forEach(function (polygon, roomIdx) {
    var config = roomConfigs[roomIdx] || {};
    var palette = paletteFor(config.style, settings.colorMood);
    var bounds = boundsList[roomIdx];
    var referenceWindowWidth = windowSegments.filter(function (segment) {
      var midpoint = segment[0].clone().add(segment[1]).multiplyScalar(0.5);
      return midpoint.x >= bounds.minX - 0.35 && midpoint.x <= bounds.maxX + 0.35 && midpoint.z >= bounds.minZ - 0.35 && midpoint.z <= bounds.maxZ + 0.35;
    }).map(function (segment) { return segment[0].distanceTo(segment[1]); }).sort(function (a, b) { return b - a; })[0] || null;

    var wallFinish = settings.wallFinish || 'Auto by style';
    var wallColor = /cool/i.test(wallFinish) ? 0xe4e8e7 : /concrete/i.test(wallFinish) ? 0xbcbcb7 : /accent/i.test(wallFinish) ? palette.accent : palette.wall;
    var wallMaps = surfaceMaps(/concrete|tile/i.test(wallFinish) ? 'tile' : 'plaster', [2.2, 1.2]);
    var wallMaterial = new THREE.MeshStandardMaterial(Object.assign({}, wallMaps, {
      color: new THREE.Color(wallColor).lerp(new THREE.Color(0xffffff), 0.73),
      roughness: /plaster|paint|auto/i.test(wallFinish) ? 0.9 : 0.78,
      normalScale: new THREE.Vector2(0.2, 0.2)
    }));
    var trimMaterial = new THREE.MeshStandardMaterial({ color: /classic|traditional/i.test(config.style || '') ? 0xd7c7a9 : 0xe7e1d5, roughness: 0.72 });

    polygon.forEach(function (start, edgeIndex) {
      var end = polygon[(edgeIndex + 1) % polygon.length];
      var a = start.x.toFixed(2) + ',' + start.z.toFixed(2);
      var b = end.x.toFixed(2) + ',' + end.z.toFixed(2);
      var key = a < b ? a + '|' + b : b + '|' + a;
      if (edgeKeys[key]) return;
      edgeKeys[key] = true;
      var edge = end.clone().sub(start);
      var length = edge.length();
      var direction = edge.clone().normalize();
      var baseboard = wallMesh(start, end, 0.025, 0.135, trimMaterial);
      var cove = wallMesh(start, end, 2.66, 2.76, trimMaterial);
      if (baseboard) trimGroup.add(baseboard);
      if (cove) trimGroup.add(cove);

      var openings = [];
      [['door', doorSegments], ['window', windowSegments], ['balcony', balconySegments]].forEach(function (entry) {
        entry[1].forEach(function (segment) {
          var midpoint = segment[0].clone().add(segment[1]).multiplyScalar(0.5);
          var openingDirection = segment[1].clone().sub(segment[0]).normalize();
          if (pointToSegmentDistance(midpoint, start, end) > 0.35 || Math.abs(openingDirection.dot(direction)) < 0.62) return;
          var t0 = THREE.MathUtils.clamp(segment[0].clone().sub(start).dot(direction), 0, length);
          var t1 = THREE.MathUtils.clamp(segment[1].clone().sub(start).dot(direction), 0, length);
          openings.push({ type: entry[0], from: Math.min(t0, t1), to: Math.max(t0, t1), settings: segment.settings || {} });
        });
      });
      openings.sort(function (one, two) { return one.from - two.from; });

      var cursor = 0;
      openings.forEach(function (opening) {
        var span = wallMesh(start.clone().addScaledVector(direction, cursor), start.clone().addScaledVector(direction, opening.from), 0, 2.8, wallMaterial);
        if (span) apartment.add(span);
        var openingStart = start.clone().addScaledVector(direction, opening.from);
        var openingEnd = start.clone().addScaledVector(direction, opening.to);
        if (opening.type === 'door') {
          // Up to the full 2.8 m wall: at that height no lintel is built at all,
          // so a wide opening reads as a real floor-to-ceiling wall opening
          // rather than an implausibly large doorway.
          var doorHeight = Math.max(1.95, Math.min(2.8, Number(opening.settings.height) || 2.1));
          var lintel = wallMesh(openingStart, openingEnd, doorHeight, 2.8, wallMaterial);
          if (lintel) apartment.add(lintel);
          var jambMaterial = new THREE.MeshStandardMaterial({ color: 0xe7e1d5, roughness: 0.6 });
          var doorDirection = openingEnd.clone().sub(openingStart).normalize();
          var jamb = Math.min(0.05, openingEnd.distanceTo(openingStart) * 0.08);
          [wallMesh(openingStart, openingStart.clone().addScaledVector(doorDirection, jamb), 0, doorHeight, jambMaterial),
           wallMesh(openingEnd.clone().addScaledVector(doorDirection, -jamb), openingEnd, 0, doorHeight, jambMaterial),
           wallMesh(openingStart, openingEnd, doorHeight - 0.05, doorHeight, jambMaterial)].forEach(function (frame) {
            if (!frame) return;
            frame.userData = { name: (opening.settings.variant || 'Single') + ' door opening', material: 'Painted timber lining', detail: doorHeight.toFixed(2) + ' m high and snapped to the exact wall span.' };
            apartment.add(frame);
          });
        } else if (opening.type === 'balcony') {
          var balconyHeight = Math.max(2.05, Math.min(2.55, Number(opening.settings.height) || 2.38));
          var balconyLintel = wallMesh(openingStart, openingEnd, balconyHeight, 2.8, wallMaterial);
          if (balconyLintel) apartment.add(balconyLintel);
          var frameMaterial = new THREE.MeshStandardMaterial({ color: palette.metal, roughness: 0.5 });
          var balconyDirection = openingEnd.clone().sub(openingStart).normalize();
          var jambWidth = Math.min(0.055, openingEnd.distanceTo(openingStart) * 0.08);
          [wallMesh(openingStart, openingStart.clone().addScaledVector(balconyDirection, jambWidth), 0, balconyHeight, frameMaterial),
           wallMesh(openingEnd.clone().addScaledVector(balconyDirection, -jambWidth), openingEnd, 0, balconyHeight, frameMaterial),
           wallMesh(openingStart, openingEnd, 0.005, 0.035, frameMaterial),
           wallMesh(openingStart, openingEnd, balconyHeight - 0.06, balconyHeight, frameMaterial)].forEach(function (frame) {
            if (!frame) return;
            frame.userData = { name: (opening.settings.variant || 'Sliding') + ' balcony opening', material: 'Slim metal perimeter trim', detail: 'A clear, floor-level balcony passage snapped to the traced exterior wall.' };
            apartment.add(frame);
          });
          addOpeningCurtain({ parent: apartment, openingStart: openingStart, openingEnd: openingEnd, wallDirection: direction, roomCentre: bounds.centre, curtainDesign: settings.curtainDesign, palette: palette, referenceWindowWidth: referenceWindowWidth });
        } else {
          var sillHeight = Math.max(0.35, Math.min(1.35, Number(opening.settings.sillHeight) || 0.82));
          var windowHeight = Math.max(0.65, Math.min(1.65, Number(opening.settings.height) || 1.24));
          var windowTop = Math.min(2.55, sillHeight + windowHeight);
          var below = wallMesh(openingStart, openingEnd, 0, sillHeight, wallMaterial);
          var above = wallMesh(openingStart, openingEnd, windowTop, 2.8, wallMaterial);
          if (below) apartment.add(below);
          if (above) apartment.add(above);
          var glass = wallMesh(openingStart, openingEnd, sillHeight + 0.05, windowTop - 0.05, new THREE.MeshPhysicalMaterial({ color: 0xaed3d8, transparent: true, opacity: 0.36, transmission: 0.4, roughness: 0.08 }));
          if (glass) apartment.add(glass);
          addOpeningCurtain({ parent: apartment, openingStart: openingStart, openingEnd: openingEnd, wallDirection: direction, roomCentre: bounds.centre, curtainDesign: settings.curtainDesign, palette: palette, referenceWindowWidth: referenceWindowWidth });
        }
        cursor = Math.max(cursor, opening.to);
      });
      var final = wallMesh(start.clone().addScaledVector(direction, cursor), end, 0, 2.8, wallMaterial);
      if (final) apartment.add(final);
    });
  });

  var engine = { yaw: 0, pitch: 0, orbitAngle: 0.7, selected: null, selectionBox: null, drag: false, moved: 0, lastX: 0, lastY: 0, joystick: { x: 0, y: 0 } };

  function lookAt(target, targetY) {
    var direction = new THREE.Vector3(
      target.x - camera.position.x,
      (targetY === undefined ? 1.05 : targetY) - camera.position.y,
      target.z - camera.position.z
    );
    if (direction.lengthSq() < 1e-6) direction.set(0, 0, -1);
    direction.normalize();
    engine.yaw = Math.atan2(-direction.x, -direction.z);
    engine.pitch = THREE.MathUtils.clamp(Math.asin(direction.y), -0.72, 0.6);
    camera.rotation.set(engine.pitch, engine.yaw, 0);
  }

  function focusRoom(index) {
    var bounds = boundsList[index];
    var polygon = polygons[index];
    if (!bounds || !polygon) return;
    // Stand back from the room centre along its short axis so the opening shot
    // has depth — but never step outside the polygon. The desktop renderer used
    // a fixed set-back, which on compact rooms puts the camera behind a wall and
    // renders a blank frame; there is no mouse to recover with on a phone.
    var back = Math.max(0.6, Math.min(bounds.depth * 0.34, 2.4));
    var position = bounds.centre.clone().addScaledVector(bounds.axisZ, back);
    if (!pointInPolygon(position.x, position.z, polygon)) {
      position = bounds.centre.clone().addScaledVector(bounds.axisZ, -back);
    }
    if (!pointInPolygon(position.x, position.z, polygon)) position = bounds.centre.clone();
    camera.position.set(position.x, 1.62, position.z);

    // Aim across the room rather than at its centre, so furniture on the far
    // side is in frame from the first render.
    lookAt(bounds.centre.clone().addScaledVector(bounds.axisZ, -bounds.depth * 0.45), 1.15);
  }

  focusRoom(state.roomIndex);

  var objectCount = 0;
  var furnitureIndex = [];
  var hasDedicatedDining = roomConfigs.some(function (room) { return /dining/i.test((room && room.roomType) || ''); });
  var kitchenBounds = boundsList.filter(function (_, index) { return /kitchen/i.test((roomConfigs[index] && roomConfigs[index].roomType) || ''); });

  boundsList.forEach(function (bounds, index) {
    var config = roomConfigs[index] || { style: 'Modern', roomType: 'Living Room' };
    var palette = paletteFor(config.style, settings.colorMood);
    var isLiving = /living/i.test(config.roomType || '');
    var hasBalcony = balconySegments.some(function (segment) {
      var midpoint = segment[0].clone().add(segment[1]).multiplyScalar(0.5);
      return midpoint.x >= bounds.minX - 0.35 && midpoint.x <= bounds.maxX + 0.35 && midpoint.z >= bounds.minZ - 0.35 && midpoint.z <= bounds.maxZ + 0.35;
    });
    var loungeOffsetX = 0;
    if (isLiving && !hasDedicatedDining && kitchenBounds.length) {
      var nearestKitchen = kitchenBounds.slice().sort(function (one, two) {
        return one.centre.distanceToSquared(bounds.centre) - two.centre.distanceToSquared(bounds.centre);
      })[0];
      var kitchenDirection = nearestKitchen.centre.clone().sub(bounds.centre).dot(bounds.axisX);
      var sofaWidth = Math.min(2.55, bounds.width * 0.62);
      var availableTravel = Math.max(0, (bounds.width - sofaWidth) / 2 - 0.38);
      if (Math.abs(kitchenDirection) > bounds.width * 0.12) {
        loungeOffsetX = -Math.sign(kitchenDirection) * Math.min(availableTravel, bounds.width * 0.22);
      }
    }
    var specs = roomFurniture(config.roomType, bounds, config.style || 'Modern', { hasBalcony: hasBalcony, loungeOffsetX: loungeOffsetX, openPlan: isLiving && !hasDedicatedDining });
    if (settings.designProfile === 'Airy') specs = specs.slice(0, Math.max(1, Math.ceil(specs.length * 0.62)));
    specs.forEach(function (spec, specIndex) {
      objectCount += 1;
      var placed = addFurniture(apartment, spec, palette);
      // The "v2" prefix marks the coordinate space. Positions used to be stored
      // relative to an off-centre group origin; replaying one of those into the
      // corrected space would fling the piece half a room away, so old ids are
      // deliberately never matched again.
      var editId = 'v2:' + index + ':' + specIndex + ':' + spec.model;
      // Remember where the furnisher put it so a user who drags a piece around
      // can always put it back.
      placed.userData.home = {
        x: placed.position.x, y: placed.position.y, z: placed.position.z,
        rotation: placed.rotation.y
      };
      placed.userData.editId = editId;
      var savedTransform = furnitureEdits[editId];
      if (savedTransform) {
        placed.position.set(
          Number(savedTransform.x) || 0,
          Number.isFinite(Number(savedTransform.y)) ? Number(savedTransform.y) : placed.position.y,
          Number(savedTransform.z) || 0
        );
        placed.rotation.y = Number(savedTransform.rotation) || 0;
      }
      // Kept so the AI-render camera can report exactly which pieces it framed,
      // which is what the prompt then tells the model to preserve.
      furnitureIndex.push({ group: placed, name: spec.name, room: index });
    });

    if (!/minimal/i.test(settings.decorSet || '') && !/bath|utility|laundry|closet/i.test(config.roomType || '')) {
      var plant = new THREE.Group();
      var pot = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.2, 0.42, 20), new THREE.MeshStandardMaterial({ color: palette.accent, roughness: 0.86 }));
      pot.position.y = 0.21;
      plant.add(pot);
      var leaves = settings.designProfile === 'Layered' ? 10 : 6;
      for (var leafIndex = 0; leafIndex < leaves; leafIndex += 1) {
        var leaf = new THREE.Mesh(new THREE.SphereGeometry(0.23, 12, 9), new THREE.MeshStandardMaterial({ color: leafIndex % 2 ? 0x55755d : 0x718c6f, roughness: 0.9 }));
        leaf.scale.y = 0.58;
        leaf.position.set(Math.sin(leafIndex * 2.3) * 0.32, 0.62 + (leafIndex % 3) * 0.23, Math.cos(leafIndex * 1.8) * 0.28);
        plant.add(leaf);
      }
      plant.position.set(bounds.minX + 0.45, 0, bounds.minZ + 0.45);
      setInteractiveInfo(plant, { name: 'Room greenery', material: 'Living foliage and ceramic', detail: 'Part of the ' + String(settings.decorSet || 'curated').toLowerCase() + ' decor set.', category: 'decor' });
      apartment.add(plant);
      objectCount += 1;
    }
  });

  // ── AI-render composition ───────────────────────────────────────────────
  // The web studio sends the AI a frame from the live scene plus a description
  // of exactly what that frame contains, so the prompt can order the model to
  // preserve it. These helpers produce both halves of that.

  function openingsInRoom(bounds) {
    var counts = { doors: 0, windows: 0, balconies: 0 };
    [['doors', doorSegments], ['windows', windowSegments], ['balconies', balconySegments]].forEach(function (entry) {
      entry[1].forEach(function (segment) {
        var midpoint = segment[0].clone().add(segment[1]).multiplyScalar(0.5);
        if (midpoint.x >= bounds.minX - 0.4 && midpoint.x <= bounds.maxX + 0.4
          && midpoint.z >= bounds.minZ - 0.4 && midpoint.z <= bounds.maxZ + 0.4) counts[entry[0]] += 1;
      });
    });
    return counts;
  }

  // Restricted to the room being rendered: an open-plan frame can see the
  // kitchen from the living room, and reporting "9 of 8 pieces framed" to the
  // user (and to the prompt) is worse than useless.
  function framedFurniture(roomIndex) {
    camera.updateMatrixWorld();
    var frustum = new THREE.Frustum();
    frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    var box = new THREE.Box3();
    var labels = [];
    var count = 0;
    furnitureIndex.forEach(function (item) {
      if (roomIndex !== undefined && item.room !== roomIndex) return;
      box.setFromObject(item.group);
      if (!frustum.intersectsBox(box)) return;
      count += 1;
      if (labels.indexOf(item.name) < 0 && labels.length < 8) labels.push(item.name);
    });
    return { count: count, labels: labels };
  }

  /**
   * Designer camera: stand in whichever corner of the room frames the most
   * furniture. Trying the corners and scoring them beats a fixed rule, because
   * the best viewpoint depends on where the furnisher actually put things.
   */
  function frameRoom(index) {
    var bounds = boundsList[index];
    var polygon = polygons[index];
    if (!bounds || !polygon) return null;
    var inset = 0.55;
    var candidates = [];
    [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(function (sign) {
      var point = bounds.centre.clone()
        .addScaledVector(bounds.axisX, sign[0] * Math.max(0, bounds.width / 2 - inset))
        .addScaledVector(bounds.axisZ, sign[1] * Math.max(0, bounds.depth / 2 - inset));
      if (pointInPolygon(point.x, point.z, polygon)) candidates.push(point);
    });
    if (!candidates.length) candidates.push(bounds.centre.clone());

    var best = null;
    candidates.forEach(function (point) {
      camera.position.set(point.x, 1.58, point.z);
      lookAt(bounds.centre, 1.0);
      var framed = framedFurniture(index);
      if (!best || framed.count > best.framed.count) best = { point: point, framed: framed };
    });

    camera.position.set(best.point.x, 1.58, best.point.z);
    lookAt(bounds.centre, 1.0);
    var openings = openingsInRoom(bounds);
    return {
      roomIndex: index,
      furnitureCount: furnitureIndex.filter(function (item) { return item.room === index; }).length,
      visibleFurnitureCount: best.framed.count,
      furnitureLabels: best.framed.labels,
      doorCount: openings.doors,
      windowCount: openings.windows,
      balconyCount: openings.balconies,
      viewpoint: 'designer'
    };
  }

  function currentComposition(index) {
    var bounds = boundsList[index];
    if (!bounds) return null;
    var framed = framedFurniture(index);
    var openings = openingsInRoom(bounds);
    return {
      roomIndex: index,
      furnitureCount: furnitureIndex.filter(function (item) { return item.room === index; }).length,
      visibleFurnitureCount: framed.count,
      furnitureLabels: framed.labels,
      doorCount: openings.doors,
      windowCount: openings.windows,
      balconyCount: openings.balconies,
      viewpoint: 'user'
    };
  }

  // ── Input ───────────────────────────────────────────────────────────────
  var raycaster = new THREE.Raycaster();
  var pointer = new THREE.Vector2();
  var canvas = renderer.domElement;
  canvas.style.touchAction = 'none';

  function resize() {
    var width = Math.max(1, window.innerWidth);
    var height = Math.max(1, window.innerHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // three.js fov is vertical. The desktop studio renders into a landscape
    // panel, so a fixed 68-70 deg works there; a phone in portrait has an
    // aspect near 0.45, which collapses the *horizontal* field to about 30 deg
    // and makes every room look like a corridor. Solve for the vertical angle
    // that yields a usable horizontal field instead, clamped so neither
    // orientation ends up with obvious wide-angle distortion.
    var horizontal = 66 * Math.PI / 180;
    var vertical = 2 * Math.atan(Math.tan(horizontal / 2) / Math.max(0.2, camera.aspect));
    camera.fov = THREE.MathUtils.clamp(vertical * 180 / Math.PI, 55, 92);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  canvas.addEventListener('pointerdown', function (event) {
    engine.drag = true; engine.moved = 0; engine.lastX = event.clientX; engine.lastY = event.clientY;
    if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', function (event) {
    if (!engine.drag) return;
    var dx = event.clientX - engine.lastX;
    var dy = event.clientY - engine.lastY;
    engine.lastX = event.clientX; engine.lastY = event.clientY;
    engine.moved += Math.abs(dx) + Math.abs(dy);
    if (state.mode === 'walk') {
      engine.yaw -= dx * 0.0052;
      engine.pitch = THREE.MathUtils.clamp(engine.pitch - dy * 0.0042, -0.72, 0.6);
    } else if (state.mode === 'orbit') {
      engine.orbitAngle -= dx * 0.007;
    }
  });
  function endPointer(event) {
    engine.drag = false;
    if (engine.moved > 10) return;
    var rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    var hits = raycaster.intersectObjects(apartment.children, true);
    var match = null;
    for (var i = 0; i < hits.length; i += 1) { if (hits[i].object.userData && hits[i].object.userData.root) { match = hits[i]; break; } }
    if (!match) return;
    engine.selected = match.object.userData.root;
    if (engine.selectionBox) scene.remove(engine.selectionBox);
    engine.selectionBox = new THREE.BoxHelper(engine.selected, 0xb0653f);
    scene.add(engine.selectionBox);
    post({ type: 'select', info: { name: match.object.userData.name, material: match.object.userData.material, detail: match.object.userData.detail, category: match.object.userData.category } });
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', function () { engine.drag = false; });

  function reportFurnitureChange(group) {
    if (!group || !group.userData.editId) return;
    post({
      type: 'furnitureChange',
      id: group.userData.editId,
      transform: {
        x: group.position.x,
        y: group.position.y,
        z: group.position.z,
        rotation: group.rotation.y
      }
    });
  }

  // ── Bridge exposed to React Native ──────────────────────────────────────
  window.LivinaiScene = {
    setMode: function (mode) { state.mode = mode; if (mode === 'walk') focusRoom(state.roomIndex); },
    setNight: function (night) { state.night = !!night; },
    setRoom: function (index) { state.roomIndex = index; if (state.mode === 'walk') focusRoom(index); },
    setFreeExplore: function (value) { settings.freeExplore = !!value; },
    move: function (direction, amount) {
      if (state.mode !== 'walk') return;
      var step = amount || 0.36;
      var forward = new THREE.Vector3(-Math.sin(engine.yaw), 0, -Math.cos(engine.yaw));
      var right = new THREE.Vector3(Math.cos(engine.yaw), 0, -Math.sin(engine.yaw));
      var next = camera.position.clone();
      if (direction === 'forward') next.addScaledVector(forward, step);
      if (direction === 'back') next.addScaledVector(forward, -step);
      if (direction === 'left') next.addScaledVector(right, -step);
      if (direction === 'right') next.addScaledVector(right, step);
      var allowed = settings.freeExplore || polygons.some(function (polygon) { return pointInPolygon(next.x, next.z, polygon); });
      if (allowed) camera.position.copy(next);
    },
    turn: function (delta) { engine.yaw += delta; },
    setJoystick: function (x, y) { engine.joystick.x = x; engine.joystick.y = y; },
    rotateSelected: function (delta) {
      if (!engine.selected) return;
      engine.selected.rotation.y += delta;
      if (engine.selectionBox) engine.selectionBox.update();
      reportFurnitureChange(engine.selected);
    },

    /**
     * Nudge the selected object relative to where the camera is looking, which
     * is the only mapping that feels right on a touch screen — "left" should
     * mean left on screen, not left along some world axis.
     */
    moveSelected: function (direction, amount) {
      if (!engine.selected) return;
      var forward = new THREE.Vector3(-Math.sin(engine.yaw), 0, -Math.cos(engine.yaw));
      var right = new THREE.Vector3(Math.cos(engine.yaw), 0, -Math.sin(engine.yaw));
      var axis = direction === 'forward' ? forward
        : direction === 'back' ? forward.clone().negate()
        : direction === 'left' ? right.clone().negate()
        : right;

      // Furniture has to stay on a floor, but most of it sits against a wall,
      // so rejecting the whole nudge the moment it would cross one makes the
      // control feel broken. Fall back to progressively smaller steps instead:
      // the piece slides right up to the wall and stops there.
      var full = amount || 0.12;
      var steps = [full, full * 0.5, full * 0.25];
      for (var i = 0; i < steps.length; i += 1) {
        var target = engine.selected.position.clone().addScaledVector(axis, steps[i]);
        var inside = polygons.some(function (polygon) { return pointInPolygon(target.x, target.z, polygon); });
        if (inside) {
          engine.selected.position.copy(target);
          if (engine.selectionBox) engine.selectionBox.update();
          reportFurnitureChange(engine.selected);
          return;
        }
      }
    },

    resetSelected: function () {
      if (!engine.selected || !engine.selected.userData.home) return;
      var home = engine.selected.userData.home;
      engine.selected.position.set(home.x, home.y, home.z);
      engine.selected.rotation.y = home.rotation;
      if (engine.selectionBox) engine.selectionBox.update();
      if (engine.selected.userData.editId) post({ type: 'furnitureChange', id: engine.selected.userData.editId, transform: null });
    },
    clearSelection: function () { if (engine.selectionBox) { scene.remove(engine.selectionBox); engine.selectionBox = null; } engine.selected = null; },

    /** Scene statistics — used by the app's diagnostics and by tests. */
    stats: function () {
      var triangles = 0;
      var meshes = 0;
      apartment.traverse(function (child) {
        if (!child.isMesh || !child.geometry) return;
        meshes += 1;
        var index = child.geometry.getIndex();
        var position = child.geometry.getAttribute('position');
        triangles += index ? index.count / 3 : (position ? position.count / 3 : 0);
      });
      return { meshes: meshes, triangles: Math.round(triangles), catalogModels: Object.keys(CATALOG).length, catalogUsed: catalogUsed };
    },

    /** Move to the designer camera and report what it frames. */
    frameRoom: function (index) {
      var composition = frameRoom(index === undefined ? state.roomIndex : index);
      post({ type: 'composition', composition: composition });
      return composition;
    },

    /**
     * Capture the current frame.
     *
     * The "purpose" flag is echoed back so the app knows whether the image is a photo
     * the user asked to save, or the source frame for an AI render. When it is
     * the latter the selection box is hidden first, and the composition is sent
     * alongside so the prompt can enumerate what must be preserved.
     */
    capture: function (purpose, useDesignerCamera) {
      var box = engine.selectionBox;
      if (box) scene.remove(box);
      var composition = null;
      if (purpose === 'ai' && state.mode !== 'plan') {
        composition = useDesignerCamera
          ? frameRoom(state.roomIndex)
          : currentComposition(state.roomIndex);
      }
      renderer.render(scene, camera);
      var image = null;
      try { image = renderer.domElement.toDataURL('image/jpeg', 0.9); }
      catch (error) { post({ type: 'error', message: 'The view could not be captured on this device.' }); }
      if (box) scene.add(box);
      if (image) post({ type: 'snapshot', image: image, purpose: purpose || 'photo', composition: composition });
    }
  };

  var clock = new THREE.Clock();
  var extentX = (maxX - minX) * worldScale;
  var extentY = (maxY - minY) * worldScale;

  function render() {
    requestAnimationFrame(render);
    var delta = Math.min(clock.getDelta(), 0.05);
    var target = new THREE.Color(state.night ? 0x142a38 : 0xd9e5e6);
    scene.background.lerp(target, 0.045);
    scene.fog.color.lerp(target, 0.045);
    ambient.intensity = THREE.MathUtils.lerp(ambient.intensity, state.night ? 0.48 : 2.85, 0.04);
    sun.intensity = THREE.MathUtils.lerp(sun.intensity, state.night ? 0.12 : 3.25, 0.04);
    var lampTarget = state.night ? 4.4 : (settings.designProfile === 'Layered' ? 3.1 : 2.25);
    roomLights.forEach(function (light) { light.intensity = THREE.MathUtils.lerp(light.intensity, lampTarget, 0.04); });
    ceilingGroup.visible = state.mode === 'walk';

    if (state.mode === 'walk') {
      if (engine.joystick.x || engine.joystick.y) {
        var forward = new THREE.Vector3(-Math.sin(engine.yaw), 0, -Math.cos(engine.yaw));
        var right = new THREE.Vector3(Math.cos(engine.yaw), 0, -Math.sin(engine.yaw));
        var next = camera.position.clone();
        var speed = delta * 2.6;
        next.addScaledVector(forward, -engine.joystick.y * speed);
        next.addScaledVector(right, engine.joystick.x * speed);
        if (settings.freeExplore || polygons.some(function (polygon) { return pointInPolygon(next.x, next.z, polygon); })) camera.position.copy(next);
      }
      camera.position.y = 1.62;
      camera.up.set(0, 1, 0);
      camera.rotation.set(engine.pitch, engine.yaw, 0);
    } else if (state.mode === 'orbit') {
      var radius = Math.max(extentX, extentY) * 0.82;
      camera.position.set(Math.cos(engine.orbitAngle) * radius, radius * 0.5, Math.sin(engine.orbitAngle) * radius);
      camera.up.set(0, 1, 0);
      camera.lookAt(0, 0.6, 0);
      engine.orbitAngle += delta * 0.06;
    } else {
      var extent = Math.max(extentX, extentY);
      camera.position.set(0, extent * 1.2, 0.01);
      camera.up.set(0, 0, -1);
      camera.lookAt(0, 0, 0);
    }
    if (engine.selectionBox) engine.selectionBox.update();
    renderer.render(scene, camera);
  }
  render();

  post({ type: 'ready', objects: objectCount, rooms: layout.rooms.length });
})();
`;

/**
 * Build the complete HTML document for the walkthrough WebView.
 *
 * @param {object} options
 * @param {object} options.layout        Output of `buildLayout`.
 * @param {Array}  options.roomConfigs   `[{ name, roomType, style }]`, index-matched to layout.rooms.
 * @param {object} options.settings      Design direction (see DEFAULT_WALKTHROUGH_SETTINGS).
 * @param {object} options.furnitureEdits Saved per-piece positions and rotations.
 * @param {string} options.mode          'walk' | 'orbit' | 'plan'
 * @param {number} options.roomIndex     Room to start in.
 * @param {boolean} options.night        Night lighting.
 */
export function buildWalkthroughHtml({
  layout,
  roomConfigs = [],
  settings = DEFAULT_WALKTHROUGH_SETTINGS,
  furnitureEdits = {},
  mode = "walk",
  roomIndex = 0,
  night = false,
}) {
  const payload = JSON.stringify({
    revision: WALKTHROUGH_RENDERER_REVISION,
    layout,
    roomConfigs,
    settings: { ...DEFAULT_WALKTHROUGH_SETTINGS, ...settings },
    furnitureEdits,
    mode,
    roomIndex,
    night,
    catalog: catalogFor(roomConfigs),
  })
    // `</script>` inside a string literal would close the tag early.
    .replace(/</g, "\\u003c");

  const loader = THREE_SOURCES.map((source) => `'${source}'`).join(",");
  const moduleRoots = THREE_MODULE_SOURCES.map((source) => `'${source}'`).join(",");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover" />
<style>
  html, body { margin:0; padding:0; height:100%; overflow:hidden; background:#e6e9e8; -webkit-tap-highlight-color:transparent; }
  #stage { position:fixed; inset:0; }
  #stage canvas { display:block; width:100%; height:100%; }
  #boot {
    position:fixed; inset:0; display:flex; align-items:center; justify-content:center;
    font:500 14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    color:#4A463F; background:#F5F2EC; text-align:center; padding:24px; transition:opacity .35s ease;
  }
  #boot.hidden { opacity:0; pointer-events:none; }
</style>
</head>
<body>
<div id="stage"></div>
<div id="boot">Preparing your measured 3D interior…</div>
<script>window.__LIVINAI__ = ${payload};</script>
<script>
(function () {
  var sources = [${loader}];
  var moduleRoots = [${moduleRoots}];
  var index = 0;
  var started = false;

  function fail(message) {
    var boot = document.getElementById('boot');
    if (boot) boot.textContent = message;
    try { window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'error', message: message })); } catch (error) {}
  }

  function start() {
    if (started) return;
    started = true;
    var boot = document.getElementById('boot');
    if (boot) boot.className = 'hidden';
    try { window.__LIVINAI_BOOT__(); }
    catch (error) { fail('The 3D scene could not be built: ' + error.message); }
  }

  /**
   * Parse the inlined .glb catalogue into reusable scenes before the walkthrough
   * builds, so furnishing itself can stay synchronous. A model that fails to
   * parse is simply absent, and that piece falls back to procedural geometry —
   * the same outcome the web build has when a model fetch fails.
   */
  function prepareModels(THREE, GLTFLoader) {
    var catalog = (window.__LIVINAI__ || {}).catalog || {};
    var keys = Object.keys(catalog);
    window.__LIVINAI_MODELS__ = {};
    if (!keys.length || !GLTFLoader) return start();
    var loader = new GLTFLoader();
    var pending = keys.length;
    var settle = function () { if (--pending <= 0) start(); };
    keys.forEach(function (key) {
      try {
        var binary = atob(catalog[key]);
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        loader.parse(bytes.buffer, '', function (gltf) {
          window.__LIVINAI_MODELS__[key] = gltf.scene;
          settle();
        }, settle);
      } catch (error) { settle(); }
    });
  }

  // Preferred path: the same three release and the same GLTFLoader module
  // Livinai_web builds against, so the furniture is the identical package.
  function tryModule(rootIndex) {
    if (rootIndex >= moduleRoots.length || !HTMLScriptElement.supports || !HTMLScriptElement.supports('importmap')) return next();
    var root = moduleRoots[rootIndex];
    var map = document.createElement('script');
    map.type = 'importmap';
    map.textContent = JSON.stringify({ imports: {
      'three': root + '/build/three.module.js',
      'three/addons/': root + '/examples/jsm/'
    } });
    document.head.appendChild(map);
    var module = document.createElement('script');
    module.type = 'module';
    module.textContent = [
      "import * as THREE from 'three';",
      "import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';",
      'window.THREE = THREE;',
      'window.__LIVINAI_PREPARE__(THREE, GLTFLoader);'
    ].join('\\n');
    module.onerror = function () { next(); };
    // A module script that fails to resolve its imports never runs and never
    // fires onerror in every engine, so fall back on a timer as well.
    setTimeout(function () { if (!started && !window.THREE) next(); }, 12000);
    document.head.appendChild(module);
  }

  window.__LIVINAI_PREPARE__ = prepareModels;

  // Fallback: UMD three with no loader. The scene renders identically minus the
  // catalogue models, which become procedural.
  function next() {
    if (window.THREE) return prepareModels(window.THREE, null);
    if (index >= sources.length) return fail('The 3D engine could not be downloaded. Check your connection and reopen the walkthrough.');
    var script = document.createElement('script');
    script.src = sources[index++];
    script.onload = function () { prepareModels(window.THREE, null); };
    script.onerror = next;
    document.head.appendChild(script);
  }

  tryModule(0);
})();
</script>
<script>
window.__LIVINAI_BOOT__ = function () {
${SCENE_SCRIPT}
};
</script>
</body>
</html>`;
}

export default buildWalkthroughHtml;
