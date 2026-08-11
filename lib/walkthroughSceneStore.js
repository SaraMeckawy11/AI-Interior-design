/**
 * Built 3D scenes, kept on the device.
 *
 * Reaching the Explore step used to mean a round trip to
 * `/api/walkthrough/realtime/session` *every single time*, including the case
 * that is by far the most common: opening a plan you finished last week and
 * have not touched since. Nothing about that plan had changed, the exporter had
 * already built it, and the answer was byte-for-byte the one from the last
 * visit — but the app still assembled the whole geometry into a request, sent
 * it, and sat on the "building your home" state until the network answered.
 *
 * The server does cache (`WalkthroughScene`), so the *GPU* was usually not
 * being paid for twice. What was being paid for every time was the request: the
 * upload of every wall and opening, the latency, and the failure mode where a
 * plan someone drew on a train could not be opened on the same train.
 *
 * So the finished scene is written here, next to the plan that produced it, and
 * an unchanged plan reopens with no network at all.
 *
 * ## What makes an entry valid
 *
 * The key is the *scene signature* the editor already computes — the geometry,
 * the room programme, the design settings that reach the exporter, and the
 * renderer revision. That is precisely the set of things that change what gets
 * built, so an entry can only be found again by a plan that would have produced
 * an identical scene. Move a wall, change the style, ship a new renderer, and
 * the signature moves with it and the scene is built once more.
 *
 * ## What is not stored
 *
 * The GLB. It runs to tens of megabytes and it already has the right home: the
 * model URL is content-addressed and served `immutable` for a week, so the
 * WebView's own HTTP cache keeps it without this module holding a copy. What is
 * stored is the metadata around it — furniture pivots, room centres, walkable
 * polygons, the spawn point — which is what the session call actually costs
 * time to produce and is a few tens of kilobytes.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFIX = "livinai-walkthrough-scene-v1:";
const INDEX_KEY = "livinai-walkthrough-scene-index-v1";

/**
 * How many built scenes the device keeps.
 *
 * One per plan the person actually returns to, with room to spare. Past this
 * the oldest are dropped: an evicted entry costs one session call to rebuild,
 * which is exactly what the app did for every plan before this existed.
 */
const MAX_SCENES = 16;

/**
 * How long a remembered scene may answer before the server is asked again.
 *
 * `savedAt` was written on every entry and never read, so a device copy lived
 * until it was evicted for space — which for anyone with fewer than sixteen
 * plans meant forever. That is the failure this store shipped with: the app
 * cannot see that a renderer has moved on, because it never asks. The signature
 * carries the renderer revision, so a *new build* can never read an old entry —
 * but the build already on the phone keeps answering itself, and no amount of
 * deploying reaches it.
 *
 * A week is long enough that the common case — reopening a plan you are working
 * on — still costs nothing, and short enough that a renderer change reaches
 * everyone without a release, a reinstall, or knowing to press anything.
 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A signature is a long JSON string; a storage key should not be.
 *
 * FNV-1a over the signature, hex. Collisions would mean handing back the wrong
 * scene, so the full signature is stored inside the entry and checked on read —
 * the hash only has to be short and fast, not trusted.
 */
const digest = (value) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36) + value.length.toString(36);
};

const keyFor = (signature) => `${PREFIX}${digest(signature)}`;

const readIndex = async () => {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.filter((entry) => entry?.key) : [];
  } catch {
    return [];
  }
};

const writeIndex = async (entries) => {
  try {
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(entries));
  } catch {
    // An index that cannot be written costs eviction accuracy, nothing else.
  }
};

/**
 * The scene built for this signature, or null.
 *
 * Never throws: a store that cannot be read has to look exactly like a store
 * that has never seen this plan, because the caller's answer to both is the
 * same one — build it.
 */
export async function readScene(signature) {
  if (!signature) return null;
  try {
    const raw = await AsyncStorage.getItem(keyFor(signature));
    if (!raw) return null;
    const entry = JSON.parse(raw);
    // The hash is short enough to collide; the signature it stands for is not.
    if (!entry || entry.signature !== signature) return null;
    if (!entry.scene?.modelUrl || !Array.isArray(entry.scene.furniture)) return null;
    // Past its age this is a miss, not an entry: the request that follows is
    // cheap when nothing has changed — the server answers from its own row —
    // and is the only way a renderer change ever reaches an installed build.
    if (!entry.savedAt || Date.now() - entry.savedAt > MAX_AGE_MS) {
      await forgetScene(signature);
      return null;
    }
    return { scene: entry.scene, origin: entry.origin || "" };
  } catch {
    return null;
  }
}

/** Remember a built scene, evicting the least recently written past the cap. */
export async function writeScene(signature, { scene, origin } = {}) {
  if (!signature || !scene?.modelUrl) return;
  const key = keyFor(signature);
  try {
    await AsyncStorage.setItem(
      key,
      JSON.stringify({ signature, scene, origin: origin || "", savedAt: Date.now() }),
    );
  } catch {
    // Out of storage, most likely. The scene still works for this session; it
    // just will not survive to the next one.
    return;
  }

  const index = [{ key, at: Date.now() }, ...(await readIndex()).filter((entry) => entry.key !== key)];
  const kept = index.slice(0, MAX_SCENES);
  const dropped = index.slice(MAX_SCENES).map((entry) => entry.key);
  if (dropped.length) {
    try {
      await AsyncStorage.multiRemove(dropped);
    } catch {}
  }
  await writeIndex(kept);
}

/**
 * Forget one scene.
 *
 * Called when the stored scene turns out not to work — the GLB it points at has
 * been evicted from the renderer's volume, or the viewer could not open it. The
 * next visit then rebuilds properly instead of handing the same dead URL back
 * for as long as the plan exists.
 */
export async function forgetScene(signature) {
  if (!signature) return;
  const key = keyFor(signature);
  try {
    await AsyncStorage.removeItem(key);
  } catch {}
  await writeIndex((await readIndex()).filter((entry) => entry.key !== key));
}

/** Drop every remembered scene. */
export async function clearScenes() {
  const index = await readIndex();
  try {
    await AsyncStorage.multiRemove([...index.map((entry) => entry.key), INDEX_KEY]);
  } catch {}
}
