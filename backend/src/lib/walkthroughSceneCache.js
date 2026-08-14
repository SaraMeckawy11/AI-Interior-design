import { createHash } from "node:crypto";

/**
 * The key a built walkthrough scene is remembered under.
 *
 * This mirrors `render_worker.py::build`, which hashes exactly these inputs to
 * decide whether it can hand back a GLB it already has. Reproducing the same
 * decision one layer up is what lets the API answer a repeat view without waking
 * the exporter at all — the difference between a database lookup and a GPU
 * container.
 *
 * Two inputs the worker hashes are deliberately *not* reproduced here:
 *
 * - `interiorPlanSource`, a digest of the exporter's own Python and catalog
 *   files. It cannot be computed from this process, so a change to the renderer
 *   would not invalidate these rows on its own. That is what `rendererRevision`
 *   is for — the app sends it, the exporter hashes it, and bumping it in
 *   `lib/exactWalkthroughScene.js` invalidates both caches at once.
 * - The worker's `format` string, for the same reason and with the same answer.
 *
 * `CACHE_VERSION` below is the escape hatch: bump it (or set
 * WALKTHROUGH_SCENE_CACHE_VERSION) to drop every remembered scene without
 * shipping an app release.
 */

/**
 * Bumped to 2 for the style-kit furniture catalogue.
 *
 * `rendererRevision` is sent by the *app*, so it only invalidates for someone
 * running a build new enough to send the new value. Every phone with the
 * previous release installed keeps asking under the old key and keeps being
 * handed the scene its old renderer produced — which is exactly what happened
 * when the eight style kits shipped: the exporter had new furniture and nobody
 * saw it. This constant is the half of the key the server owns, so bumping it
 * rebuilds for every client at once, old builds included.
 */
const CACHE_VERSION = (process.env.WALKTHROUGH_SCENE_CACHE_VERSION || "2").trim();

/**
 * The settings that reach the exporter, and only those.
 *
 * `settings` carries viewer preferences too — `freeExplore` decides whether the
 * camera may pass through a wall, and has no bearing on what gets built. Hashing
 * the whole object would miss the cache every time someone toggled a control
 * that changes nothing about the scene.
 *
 * Kept in the same order and with the same defaults as
 * `render_worker.py::room_configs`, because a difference here is a cache that
 * silently never hits rather than a visible bug.
 */
const roomConfigsForKey = (roomConfigs = [], settings = {}) =>
  (Array.isArray(roomConfigs) ? roomConfigs : []).map((room, index) => ({
    name: room?.name ?? `Room ${index + 1}`,
    room_type: room?.roomType ?? "Living Room",
    style: room?.style ?? "Modern",
    design_profile: settings.designProfile ?? "Curated",
    color_mood: settings.colorMood ?? "Warm neutral",
    design_notes: settings.notes ?? "",
    floor_finish: settings.floorFinish ?? "Auto by style",
    wall_finish: settings.wallFinish ?? "Auto by style",
    rug_design: settings.rugDesign ?? "Auto by style",
    curtain_design: settings.curtainDesign ?? "Auto by style",
    decor_set: settings.decorSet ?? "Auto by style",
    kitchen_type: room?.kitchenType ?? "",
  }));

/**
 * JSON with its object keys sorted, at every depth.
 *
 * `JSON.stringify` preserves insertion order, so two requests carrying the same
 * plan with its fields in a different order would hash differently and each pay
 * for its own build. Arrays keep their order — in a plan, order is meaning.
 */
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  // Rounded before hashing: the geometry arrives as floating point from a
  // touch device, and 4.0000000001 and 4 are the same wall.
  if (typeof value === "number") return JSON.stringify(Number(value.toFixed(4)));
  return JSON.stringify(value === undefined ? null : value);
};

export function sceneCacheKey(payload = {}) {
  const input = {
    v: CACHE_VERSION,
    rooms: payload.rooms || [],
    doors: payload.doors || [],
    windows: payload.windows || [],
    balconies: payload.balconies || [],
    // Two plans with identical geometry can still differ here — the same gap in
    // the same wall is furnished around differently depending on whether it has
    // a door in it — so it has to be part of what identifies a scene.
    wallOpenings: payload.wallOpenings || [],
    pixelsPerMeter: payload.pixelsPerMeter ?? null,
    configs: roomConfigsForKey(payload.roomConfigs, payload.settings || {}),
    rendererRevision: payload.rendererRevision ?? null,
  };
  return createHash("sha256").update(canonical(input)).digest("hex");
}

export default sceneCacheKey;
