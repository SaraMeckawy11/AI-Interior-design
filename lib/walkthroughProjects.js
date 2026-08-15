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

const LIBRARY_KEY_PREFIX = "livinai-walkthrough-library-v3";
const LEGACY_LIBRARY_KEY = "livinai-walkthrough-library-v2";

// Signed-out work has a device-only owner of its own. Signed-in callers must
// pass the database user id; display names and email addresses are deliberately
// never accepted as ownership boundaries.
export const ANONYMOUS_PLAN_OWNER = "anonymous";

const storageKeyForOwner = (ownerId) => {
  const stableId = String(ownerId || "").trim();
  if (!stableId) return null;
  const scope = stableId === ANONYMOUS_PLAN_OWNER
    ? ANONYMOUS_PLAN_OWNER
    : `user:${encodeURIComponent(stableId)}`;
  return `${LIBRARY_KEY_PREFIX}:${scope}`;
};

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
  /**
   * Which revision the geometry cached on THIS device belongs to.
   *
   * `updatedAt` is the revision that exists — it is refreshed from the account
   * every time the library loads. `dataAt` is the revision this phone actually
   * holds the drawing for. They are usually equal and that is the whole point:
   * when they are not, the phone is holding an older copy of a plan that has
   * since been edited somewhere else, and the geometry has to be fetched again
   * before the plan is opened.
   *
   * Rows written before this field existed have no value here. They fall back
   * to their own `updatedAt`, which is correct for them: at the moment they
   * were written, the row and its geometry were the same revision.
   */
  dataAt: project.dataAt || project.updatedAt || null,
});

// ── Local store ────────────────────────────────────────────────────────────

async function readLocal(ownerId) {
  const storageKey = storageKeyForOwner(ownerId);
  if (!storageKey) return [];
  try {
    const raw = await AsyncStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((item) => item?.id && (item?.data || item?.remoteId));
      }
    }
  } catch {}
  return migrateLegacy(ownerId);
}

/**
 * Pull forward the plans saved by the previous version of the editor.
 *
 * Those rows carried the same `data` shape, only under a different key and with
 * `thumbnail` pointing at a local file. Anything that cannot be read is skipped
 * rather than failing the whole load — one corrupt row must not empty a library.
 */
async function migrateLegacy(ownerId) {
  const storageKey = storageKeyForOwner(ownerId);
  if (!storageKey) return [];

  // The old cache had no owner at all. Assigning it to whichever account opens
  // the app next would reproduce the privacy bug this migration fixes. Keep it
  // in the signed-out device bucket; authenticated accounts are rebuilt only
  // from their own server rows.
  if (ownerId !== ANONYMOUS_PLAN_OWNER) {
    try {
      await AsyncStorage.setItem(storageKey, "[]");
    } catch {}
    return [];
  }

  try {
    const values = await AsyncStorage.multiGet([
      LEGACY_LIBRARY_KEY,
      LEGACY_PROJECTS_KEY,
      LEGACY_PLAN_KEY,
    ]);
    const sharedLibrary = JSON.parse(values[0][1] || "[]");
    const legacyProjects = JSON.parse(values[1][1] || "[]");
    const migrated = (Array.isArray(sharedLibrary) ? sharedLibrary : [])
      .filter((project) => project?.id && project?.data)
      .map((project) => ({ ...project, remoteId: null, syncedAt: null }));

    if (!migrated.length) migrated.push(...(Array.isArray(legacyProjects) ? legacyProjects : [])
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
      })));

    if (!migrated.length) {
      const solo = JSON.parse(values[2][1] || "null");
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

    await AsyncStorage.setItem(storageKey, JSON.stringify(migrated));
    return migrated;
  } catch {
    return [];
  }
}

async function writeLocal(ownerId, projects) {
  const trimmed = [...projects].sort(byNewest).slice(0, MAX_LOCAL_PROJECTS);
  const storageKey = storageKeyForOwner(ownerId);
  if (!storageKey) return trimmed;
  try {
    await AsyncStorage.setItem(storageKey, JSON.stringify(trimmed));
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
export async function loadLibrary(token, ownerId) {
  const local = await readLocal(ownerId);
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
        // The account has a newer revision of this plan than this device does
        // — it was edited on another phone. Take the server's summary, and keep
        // the local geometry rather than dropping it, because it is what opens
        // the plan when there is no signal.
        //
        // What must NOT happen is the old geometry inheriting the new revision's
        // timestamp, which is what used to happen here: the card then said
        // "updated a minute ago" while `loadProjectData` went on returning the
        // drawing from before the edit, and the plan looked identical on both
        // phones forever. `dataAt` stays on the revision the drawing is really
        // from, so opening the plan knows to fetch the new one.
        merged.set(key, {
          ...remote,
          data: existing.data,
          dataAt: existing.dataAt || existing.updatedAt || null,
        });
      } else {
        merged.set(key, { ...existing, remoteId: plan.id, syncedAt: plan.updatedAt });
      }
    }
    await writeLocal(ownerId, [...merged.values()]);
  } catch {
    // Offline, signed out, or the server is down — the local library still works.
  }

  return { projects: [...merged.values()].sort(byNewest).map(toSummary), synced };
}

/**
 * The geometry for one plan — the current revision of it, not merely a copy.
 *
 * This used to return the device's cached drawing whenever it had one, without
 * ever asking whether it was still the current one. That is correct for the
 * only-phone case and wrong for the case the account exists to serve: edit a
 * plan on one phone, open it on another signed into the same account, and the
 * second phone had geometry cached from the last time it opened that plan, so
 * it returned it and never called the server. The change was on the account the
 * whole time. It just was not being asked for.
 *
 * So the cache is used when it is current and refreshed when it is not, which
 * is what `dataAt` records. When the network is not there, the older drawing is
 * still returned — a plan that opens a revision behind is a great deal better
 * than a plan that will not open.
 */
export async function loadProjectData(token, ownerId, project) {
  const local = await readLocal(ownerId);
  const stored = local.find((item) => item.id === project.id);
  const cached = stored?.data || null;

  // The revision this device holds, against the revision the library resolved
  // for this plan — which came from the account if the library reached it.
  const haveRevision = String(stored?.dataAt || stored?.updatedAt || "");
  const wantRevision = String(project.updatedAt || stored?.updatedAt || "");
  if (cached && haveRevision >= wantRevision) return cached;

  if (!project.remoteId || !token) return cached;

  try {
    const { plan } = await request(`/api/walkthrough/plans/${project.remoteId}`, { token });
    if (!plan?.data) return cached;

    const next = local.filter((item) => item.id !== project.id);
    await writeLocal(ownerId, [
      ...next,
      {
        ...toSummary({ ...project, updatedAt: plan.updatedAt || project.updatedAt }),
        // Stamped with the revision that was actually downloaded, so the next
        // open of this plan on this device is a cache hit rather than a fetch.
        dataAt: plan.updatedAt || project.updatedAt || nowIso(),
        syncedAt: plan.updatedAt || null,
        data: plan.data,
      },
    ]);
    return plan.data;
  } catch {
    // Offline, or the account could not be reached. The older drawing is what
    // this device has, and opening it is the useful answer.
    return cached;
  }
}

/** Write a plan to the device. Fast, always succeeds, never touches the network. */
export async function saveLocally(ownerId, project) {
  if (!ownerId) throw new Error("A stable plan owner is required.");
  const local = await readLocal(ownerId);
  const updatedAt = project.updatedAt || nowIso();
  const merged = [
    {
      ...toSummary(project),
      data: project.data,
      updatedAt,
      // A local edit is a new revision and this device is the one holding it,
      // so the two stay level. Without this the row would keep the `dataAt` of
      // whatever it was before the edit and the next library refresh would
      // decide this phone's own drawing was stale.
      dataAt: updatedAt,
    },
    ...local.filter((item) => item.id !== project.id),
  ];
  await writeLocal(ownerId, merged);
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
export async function syncProject(token, ownerId, project) {
  if (!token) return null;
  if (!ownerId || ownerId === ANONYMOUS_PLAN_OWNER) {
    throw new Error("A signed-in user id is required to sync this plan.");
  }

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

  const local = await readLocal(ownerId);
  const stored = local.find((item) => item.id === project.id);
  await writeLocal(ownerId, [
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
      // This device just sent the geometry the account now stores, so the copy
      // it holds is that revision by definition.
      dataAt: plan.updatedAt,
    },
    ...local.filter((item) => item.id !== project.id),
  ]);

  return plan;
}

export async function renameProject(token, ownerId, project, title) {
  const local = await readLocal(ownerId);
  const updatedAt = nowIso();
  await writeLocal(
    ownerId,
    // `dataAt` moves with `updatedAt` even though a rename does not touch the
    // drawing. This device is the one that made the new revision and it holds
    // that revision's geometry — the same geometry as before. Leaving `dataAt`
    // behind would mark its own copy stale and re-download the drawing every
    // time somebody renamed a plan.
    local.map((item) =>
      item.id === project.id ? { ...item, title, updatedAt, dataAt: updatedAt } : item,
    ),
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
export async function deleteProject(token, ownerId, project) {
  const local = await readLocal(ownerId);
  await writeLocal(ownerId, local.filter((item) => item.id !== project.id));

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
