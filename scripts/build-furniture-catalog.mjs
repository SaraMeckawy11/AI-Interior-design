/**
 * Convert the Livinai furniture catalogue (.glb) into a plain data module the
 * walkthrough WebView can consume without a loader.
 *
 * Why not just use GLTFLoader? three.js dropped its UMD `examples/js` builds at
 * r148, so pulling GLTFLoader into a `<script>`-tag scene would mean shipping an
 * import map and an ES-module three — extra moving parts, and a hard failure on
 * older WebViews. These models are simple (no compression, no textures, no
 * animation), so baking the geometry out once at build time is both smaller and
 * more robust: the scene just rebuilds BufferGeometry from typed arrays.
 *
 * Node transforms are baked into the vertex data, so each model becomes a flat
 * list of parts with a material colour. Run:
 *
 *     node scripts/build-furniture-catalog.mjs
 */

/* global Buffer */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.join(here, "..", "assets", "models");
const OUTPUT = path.join(here, "..", "lib", "furnitureCatalog.js");

/** Catalogue key -> file. Keys match `spec.model` in the walkthrough scene. */
const CATALOG = {
  armchair: "armchair.glb",
  bathtub: "bathtub.glb",
  bed: "bed.glb",
  bookcase: "bookcase.glb",
  coffeeTable: "coffee-table.glb",
  diningChair: "dining-chair.glb",
  diningTable: "dining-table.glb",
  fridge: "fridge.glb",
  island: "kitchen-island.glb",
  shower: "shower.glb",
  compactSofa: "sofa-compact.glb",
  toilet: "toilet.glb",
  tvUnit: "tv-unit.glb",
  vanity: "vanity.glb",
  // The web catalogue reuses the dining table as a desk and a modern chair for
  // desk seating; chair-modern.glb is 4 MB, so the dining chair stands in.
  workDesk: "dining-table.glb",
  modernChair: "dining-chair.glb",
};

const COMPONENT = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
};
const NUM_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function parseGlb(buffer) {
  if (buffer.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB");
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset < buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (type === 0x4e4f534a) json = JSON.parse(buffer.slice(start, start + length).toString("utf8"));
    if (type === 0x004e4942) bin = buffer.slice(start, start + length);
    offset = start + length;
  }
  return { json, bin };
}

function readAccessor(gltf, bin, index) {
  const accessor = gltf.accessors[index];
  const view = gltf.bufferViews[accessor.bufferView];
  const Type = COMPONENT[accessor.componentType];
  const components = NUM_COMPONENTS[accessor.type];
  const base = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const stride = view.byteStride;

  // Interleaved data needs an element-by-element copy; tightly packed data can
  // be read as one typed-array view.
  if (stride && stride !== components * Type.BYTES_PER_ELEMENT) {
    const out = new Type(accessor.count * components);
    for (let i = 0; i < accessor.count; i += 1) {
      const elementOffset = base + i * stride;
      for (let c = 0; c < components; c += 1) {
        out[i * components + c] = new Type(bin.buffer, bin.byteOffset + elementOffset + c * Type.BYTES_PER_ELEMENT, 1)[0];
      }
    }
    return out;
  }
  return new Type(bin.buffer.slice(bin.byteOffset + base, bin.byteOffset + base + accessor.count * components * Type.BYTES_PER_ELEMENT));
}

// ── Minimal 4x4 matrix maths (column-major, glTF convention) ───────────────
const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

function fromTRS(translation = [0, 0, 0], rotation = [0, 0, 0, 1], scale = [1, 1, 1]) {
  const [x, y, z, w] = rotation;
  const [sx, sy, sz] = scale;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    translation[0], translation[1], translation[2], 1,
  ];
}

const nodeMatrix = (node) =>
  node.matrix ? node.matrix.slice() : fromTRS(node.translation, node.rotation, node.scale);

function transformPoint(matrix, x, y, z) {
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ];
}

function transformDirection(matrix, x, y, z) {
  const out = [
    matrix[0] * x + matrix[4] * y + matrix[8] * z,
    matrix[1] * x + matrix[5] * y + matrix[9] * z,
    matrix[2] * x + matrix[6] * y + matrix[10] * z,
  ];
  const length = Math.hypot(out[0], out[1], out[2]) || 1;
  return [out[0] / length, out[1] / length, out[2] / length];
}

function toHex(factor = [0.8, 0.8, 0.8, 1]) {
  // glTF baseColorFactor is linear; the scene renders in sRGB, so convert.
  const channel = (value) => {
    const srgb = value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(srgb * 255)));
  };
  return (channel(factor[0]) << 16) | (channel(factor[1]) << 8) | channel(factor[2]);
}

function convert(file) {
  const { json, bin } = parseGlb(fs.readFileSync(file));
  const parts = [];

  const walk = (nodeIndex, parent) => {
    const node = json.nodes[nodeIndex];
    const world = multiply(parent, nodeMatrix(node));

    if (node.mesh !== undefined) {
      for (const primitive of json.meshes[node.mesh].primitives) {
        if (primitive.mode !== undefined && primitive.mode !== 4) continue; // triangles only
        const positions = readAccessor(json, bin, primitive.attributes.POSITION);
        const normals = primitive.attributes.NORMAL !== undefined
          ? readAccessor(json, bin, primitive.attributes.NORMAL)
          : null;
        const indices = primitive.indices !== undefined
          ? Uint32Array.from(readAccessor(json, bin, primitive.indices))
          : Uint32Array.from({ length: positions.length / 3 }, (_, i) => i);

        const worldPositions = new Float32Array(positions.length);
        for (let i = 0; i < positions.length; i += 3) {
          const [x, y, z] = transformPoint(world, positions[i], positions[i + 1], positions[i + 2]);
          worldPositions[i] = x;
          worldPositions[i + 1] = y;
          worldPositions[i + 2] = z;
        }

        let worldNormals = null;
        if (normals) {
          worldNormals = new Float32Array(normals.length);
          for (let i = 0; i < normals.length; i += 3) {
            const [x, y, z] = transformDirection(world, normals[i], normals[i + 1], normals[i + 2]);
            worldNormals[i] = x;
            worldNormals[i + 1] = y;
            worldNormals[i + 2] = z;
          }
        }

        const material = primitive.material !== undefined ? json.materials[primitive.material] : {};
        const pbr = material.pbrMetallicRoughness || {};
        parts.push({
          p: Buffer.from(worldPositions.buffer).toString("base64"),
          n: worldNormals ? Buffer.from(worldNormals.buffer).toString("base64") : null,
          i: Buffer.from(indices.buffer).toString("base64"),
          c: toHex(pbr.baseColorFactor),
          m: pbr.metallicFactor === undefined ? 0 : Number(pbr.metallicFactor.toFixed(2)),
          r: pbr.roughnessFactor === undefined ? 0.8 : Number(pbr.roughnessFactor.toFixed(2)),
          o: material.alphaMode === "BLEND" ? Number((pbr.baseColorFactor?.[3] ?? 1).toFixed(2)) : 1,
        });
      }
    }
    (node.children || []).forEach((child) => walk(child, world));
  };

  const scene = json.scenes[json.scene || 0];
  scene.nodes.forEach((nodeIndex) => walk(nodeIndex, identity()));
  return parts;
}

const catalogue = {};
let vertices = 0;
for (const [key, file] of Object.entries(CATALOG)) {
  const source = path.join(MODELS_DIR, file);
  if (!fs.existsSync(source)) {
    console.warn(`skip ${key}: ${file} not found`);
    continue;
  }
  const parts = convert(source);
  catalogue[key] = parts;
  vertices += parts.reduce((sum, part) => sum + Buffer.from(part.p, "base64").length / 12, 0);
  console.log(`${key.padEnd(14)} ${String(parts.length).padStart(2)} parts  ${file}`);
}

const banner = `/**
 * Generated by scripts/build-furniture-catalog.mjs — do not edit by hand.
 *
 * The Livinai furniture catalogue, baked out of the .glb files in
 * assets/models/ into plain base64 typed arrays. Node transforms are already
 * applied, so each entry is a flat list of parts the walkthrough scene turns
 * straight into BufferGeometry — no glTF loader required in the WebView.
 *
 * Positions and normals are Float32, indices Uint32, colours sRGB hex.
 */
`;

fs.writeFileSync(
  OUTPUT,
  `${banner}\nexport const FURNITURE_CATALOG = ${JSON.stringify(catalogue)};\n\nexport default FURNITURE_CATALOG;\n`,
  "utf8",
);

console.log(`\nwrote ${OUTPUT}`);
console.log(`${Object.keys(catalogue).length} models · ~${Math.round(vertices)} vertices · ${(fs.statSync(OUTPUT).size / 1024).toFixed(0)} KB`);
