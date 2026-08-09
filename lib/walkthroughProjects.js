/**
 * The saved-3D-plan library.
 *
 * A plan lives in two places and this module is the only thing that knows it.
 * The device copy in AsyncStorage is what makes the editor usable on a train:
 * it is written on every autosave, never needs a connection, and is the source
 * the editor reopens from. The account copy on the server is what makes a plan
 * outlive the phone, and it is written when the user saves or leaves the editor.
 *
 * Every function here is written so a dead network degrades the feature rather
 * than breaking it: the library still lists, opens, renames and deletes local
 * plans, and the cloud catches up on the next successful call.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system";

import { apiUrl } from "../configs/api";

const LIBRARY_KEY = "livinai-walkthrough-library-v2";

// Legacy keys from the AsyncStorage-only era. Read once so nobody loses the
// plans they had before the library existed, then left alone.
const LEGACY_PROJECTS_KEY = "livinai-walkthrough-project-library-v1";
const LEGACY_PLAN_KEY = "livinai-walkthrough-plan";

export const MAX_LOCAL_PROJECTS = 40;

// Base64 inflates by a third and the request also carries the geometry, so this
// keeps a plan upload comfortably inside the 100 MB body limit while still
// accepting a full-resolution phone photo of a floor plan.
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export const createProjectId = () =>
  `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const nowIso = () => new Date().toISOString();

const byNewest = (one, two) => String(two.updatedAt || "").localeCompare(String(one.updatedAt || ""));

/** Everything the library card shows, without the geometry. */
const toSummary = (project) => ({
  id: project.id,
  remoteId: project.remoteId || null,
  title: project.title || "Untitled 3D plan",
  source: project.source === "upload" ? "upload" : "blank",
  roomCount: project.roomCount || 0,
  openingCount: project.openingCount || 0,
  areaMeters: project.areaMeters || 0,
  planImage: project.planImage || null,
  thumbnail: project.thumbnail || project.planImage || null,
  updatedAt: project.updatedAt || nowIso(),
  syncedAt: project.syncedAt || null,
});

// ── Local store ────────────────────────────────────────────────────────────

async function readLocal() {
  try {
    const raw = await AsyncStorage.getItem(LIBRARY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((item) => item?.id && item?.data);
    }
  } catch {}
  return migrateLegacy();
}

/**
 * Pull forward the plans saved by the previous version of the editor.
 *
 * Those rows carried the same `data` shape, only under a different key and with
 * `thumbnail` pointing at a local file. Anything that cannot be read is skipped
 * rather than failing the whole load — one corrupt row must not empty a library.
 */
async function migrateLegacy() {
  try {
    const values = await AsyncStorage.multiGet([LEGACY_PROJECTS_KEY, LEGACY_PLAN_KEY]);
    const legacyProjects = JSON.parse(values[0][1] || "[]");
    const migrated = (Array.isArray(legacyProjects) ? legacyProjects : [])
      .filter((project) => project?.id && project?.data)
      .map((project) => ({
        id: project.id,
        remoteId: null,
        title: project.title || "3D walkthrough",
        source: project.data?.planImage ? "upload" : "blank",
        roomCount: project.roomCount || project.data?.rooms?.length || 0,
        openingCount: project.data?.openings?.length || 0,
        areaMeters: 0,
        planImage: project.data?.planImage || null,
        thumbnail: project.thumbnail || null,
        updatedAt: project.updatedAt || nowIso(),
        syncedAt: null,
        data: project.data,
      }));

    if (!migrated.length) {
      const solo = JSON.parse(values[1][1] || "null");
      if (solo?.rooms?.length) {
        migrated.push({
          id: createProjectId(),
          remoteId: null,
          title: "My 3D plan",
          source: solo.planImage ? "upload" : "blank",
          roomCount: solo.rooms.length,
          openingCount: solo.openings?.length || 0,
          areaMeters: 0,
          planImage: solo.planImage || null,
          thumbnail: null,
          updatedAt: solo.savedAt || nowIso(),
          syncedAt: null,
          data: solo,
        });
      }
    }

    if (migrated.length) await AsyncStorage.setItem(LIBRARY_KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    return [];
  }
}

async function writeLocal(projects) {
  const trimmed = [...projects].sort(byNewest).slice(0, MAX_LOCAL_PROJECTS);
  try {
    await AsyncStorage.setItem(LIBRARY_KEY, JSON.stringify(trimmed));
  } catch {}
  return trimmed;
}

// ── Cloud ──────────────────────────────────────────────────────────────────

async function request(path, { token, method = "GET", body, timeout = 45000 } = {}) {
  if (!token) throw new Error("offline");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(apiUrl(path), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || "The request failed.");
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Turn a local image into something the server can store.
 *
 * An image that is already an https URL has been uploaded before and is returned
 * untouched; a local `file://` is read into a data URI. A file that is missing or
 * too large yields null, which the caller treats as "leave whatever the server
 * already has" rather than as an error worth interrupting a save for.
 */
async function readImageForUpload(uri) {
  if (!uri || typeof uri !== "string") return null;
  if (uri.startsWith("http")) return uri;
  if (uri.startsWith("data:")) return uri.length > MAX_UPLOAD_BYTES ? null : uri;
  try {
    const info = await FileSystem.getInfoAsync(uri, { size: true });
    if (!info.exists || (info.size || 0) > MAX_UPLOAD_BYTES) return null;
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    return `data:image/jpeg;base64,${base64}`;
  } catch {
    return null;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Every plan the user has, from both stores.
 *
 * Rows are merged on the device-generated id. The newer `updatedAt` wins, which
 * is what lets a plan edited offline on one phone survive a sync from another
 * without either copy silently overwriting the other.
 */
export async function loadLibrary(token) {
  const local = await readLocal();
  const merged = new Map(local.map((project) => [project.id, project]));
  let synced = false;

  try {
    const { plans = [] } = await request("/api/walkthrough/plans", { token });
    synced = true;
    for (const plan of plans) {
      const key = plan.clientId || plan.id;
      const existing = merged.get(key);
      const remote = {
        id: key,
        remoteId: plan.id,
        title: plan.title,
        source: plan.source,
        roomCount: plan.roomCount,
        openingCount: plan.openingCount,
        areaMeters: plan.areaMeters,
        planImage: plan.planImage,
        thumbnail: plan.thumbnail,
        updatedAt: plan.updatedAt,
        syncedAt: plan.updatedAt,
        // The list endpoint omits geometry on purpose; it is fetched when the
        // plan is actually opened.
        data: existing?.data || null,
      };
      if (!existing) merged.set(key, remote);
      else if (String(plan.updatedAt) > String(existing.updatedAt || "")) {
        merged.set(key, { ...remote, data: existing.data });
      } else {
        merged.set(key, { ...existing, remoteId: plan.id, syncedAt: plan.updatedAt });
      }
    }
    await writeLocal([...merged.values()]);
  } catch {
    // Offline, signed out, or the server is down — the local library still works.
  }

  return { projects: [...merged.values()].sort(byNewest).map(toSummary), synced };
}

/** The geometry for one plan, from the device if it has it, otherwise the cloud. */
export async function loadProjectData(token, project) {
  const local = await readLocal();
  const stored = local.find((item) => item.id === project.id);
  if (stored?.data) return stored.data;

  if (!project.remoteId) return null;
  const { plan } = await request(`/api/walkthrough/plans/${project.remoteId}`, { token });
  if (!plan?.data) return null;

  const next = local.filter((item) => item.id !== project.id);
  await writeLocal([...next, { ...toSummary(project), data: plan.data }]);
  return plan.data;
}

/** Write a plan to the device. Fast, always succeeds, never touches the network. */
export async function saveLocally(project) {
  const local = await readLocal();
  const merged = [
    { ...toSummary(project), data: project.data, updatedAt: project.updatedAt || nowIso() },
    ...local.filter((item) => item.id !== project.id),
  ];
  await writeLocal(merged);
}

/**
 * Push a plan to the account.
 *
 * Returns the summary the server stored so the caller can hold on to the remote
 * id and the uploaded image URLs, or null when the plan could only be kept on the
 * device. A rejected save is reported through the thrown message so the editor
 * can say *why* — "you have reached 40 plans" needs a different answer from
 * "you are offline".
 */
export async function syncProject(token, project) {
  if (!token) return null;

  const [planImage, thumbnail] = await Promise.all([
    readImageForUpload(project.planImage),
    readImageForUpload(project.thumbnail),
  ]);

  // `null` tells the server to clear the field and `undefined` tells it to keep
  // what it has — a distinction that matters, because `readImageForUpload`
  // also returns null when a file is simply too big or has been evicted from
  // the cache. Sending that through as "clear it" would delete the user's
  // uploaded plan from their account the first time a save ran low on room.
  const body = {
    clientId: project.id,
    title: project.title,
    source: project.source,
    roomCount: project.roomCount,
    openingCount: project.openingCount,
    areaMeters: project.areaMeters,
    planImage: project.planImage ? planImage ?? undefined : null,
    // Same three-way distinction as `planImage`. Without the explicit null, a
    // plan that no longer has a thumbnail kept whatever the account last stored
    // — which is how an AI render saved under an older build stayed on the card
    // long after the app stopped setting one.
    thumbnail: project.thumbnail ? thumbnail ?? undefined : null,
    data: project.data,
  };

  const { plan } = await request("/api/walkthrough/plans", { token, method: "POST", body });

  const local = await readLocal();
  const stored = local.find((item) => item.id === project.id);
  await writeLocal([
    {
      ...toSummary(project),
      remoteId: plan.id,
      // Keep the local file URI for the plan image: it renders instantly and
      // without a round trip. The cloud copy is the backup, not the display copy.
      planImage: project.planImage || plan.planImage,
      thumbnail: project.thumbnail || plan.thumbnail,
      updatedAt: plan.updatedAt,
      syncedAt: plan.updatedAt,
      data: project.data || stored?.data || null,
    },
    ...local.filter((item) => item.id !== project.id),
  ]);

  return plan;
}

export async function renameProject(token, project, title) {
  const local = await readLocal();
  const updatedAt = nowIso();
  await writeLocal(
    local.map((item) => (item.id === project.id ? { ...item, title, updatedAt } : item)),
  );
  if (!token || !project.remoteId) return;
  try {
    await request(`/api/walkthrough/plans/${project.remoteId}`, {
      token,
      method: "PATCH",
      body: { title },
    });
  } catch {}
}

/**
 * Remove a plan from both stores.
 *
 * The device copy goes first and unconditionally: a user who taps delete has
 * decided, and leaving the plan in the list because the server was unreachable
 * would read as the button not working.
 */
export async function deleteProject(token, project) {
  const local = await readLocal();
  await writeLocal(local.filter((item) => item.id !== project.id));

  if (project.planImage?.startsWith("file://")) {
    try {
      await FileSystem.deleteAsync(project.planImage, { idempotent: true });
    } catch {}
  }

  if (!token || !project.remoteId) return;
  try {
    await request(`/api/walkthrough/plans/${project.remoteId}`, { token, method: "DELETE" });
  } catch {}
}
