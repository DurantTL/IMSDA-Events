import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import {
  AREA_PAUSE_KEY_PREFIX,
  AREA_PAUSE_RETRY_AFTER_SECONDS,
  classifyPausableArea,
  areaFromSettingKey,
  areaPauseDefinitions,
  areaPauseSettingKey,
  getAreaPauseDefinition,
  type AreaPauseKey,
} from "@/modules/system-admin/area-pause-model";

export * from "@/modules/system-admin/area-pause-model";

/**
 * The per-area pause switch (#1518), for a system administrator who needs a few quiet minutes to fix something.
 *
 * Storage: no table of its own. Each switch is one row of the existing `NotificationSetting` key/boolean table, keyed
 * `AREA_PAUSE:<AREA>`. Here `enabled = true` means the area is PAUSED, and a missing row means it is running. The
 * notification catalog never lists these keys, so the alert switches ignore them.
 *
 * The rule that matters most: a pause can only ever be switched ON by a person. A failed or slow read counts as "not
 * paused" (and is logged), so a struggling database never locks visitors out on top of its other trouble.
 *
 * (There is deliberately no `server-only` import: `withRequestContext` loads this module on demand and route tests run it
 * without the Next.js server runtime. Only server code imports it; the client-safe half is `area-pause-model.ts`.)
 *
 * Enforcement is on the server, in `withRequestContext`, before a route handler runs; see `refuseIfAreaPaused`.
 */

/** How long a read is trusted. A change made on one server is seen at once there and within this long on another. */
const CACHE_TTL_MS = 5_000;
/** A read that takes longer than this counts as failed, so a slow database cannot hold a request up. */
const READ_TIMEOUT_MS = 1_000;

type Snapshot = { loadedAt: number; paused: Set<AreaPauseKey> };

let snapshot: Snapshot | null = null;
/** Bumped by every reset, so a read that began before a change never overwrites the cache after it. */
let generation = 0;
let inFlight: { generation: number; promise: Promise<Snapshot> } | null = null;

/** Forgets what was read. Called after every change, and by tests. */
export function resetAreaPauseCache() {
  generation += 1;
  snapshot = null;
  inFlight = null;
}

async function readRows(): Promise<Array<{ key: string; enabled: boolean }>> {
  return getPrisma().notificationSetting.findMany({
    where: { key: { startsWith: AREA_PAUSE_KEY_PREFIX } },
    select: { key: true, enabled: true },
  });
}

async function readWithTimeout(): Promise<Array<{ key: string; enabled: boolean }>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      readRows(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Reading the area pauses timed out.")), READ_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function load(): Promise<Snapshot> {
  if (inFlight && inFlight.generation === generation) return inFlight.promise;
  const startedIn = generation;
  const promise = (async (): Promise<Snapshot> => {
    let loaded: Snapshot;
    try {
      const rows = await readWithTimeout();
      const paused = new Set<AreaPauseKey>();
      for (const row of rows) {
        const area = areaFromSettingKey(row.key);
        if (area && row.enabled) paused.add(area);
      }
      loaded = { loadedAt: Date.now(), paused };
    } catch (error) {
      logError("Reading the area pauses failed; treating every area as running.", error);
      loaded = { loadedAt: Date.now(), paused: new Set() };
    }
    // A change was saved while this read was running: its answer may be out of date, so it is not kept.
    if (startedIn === generation) snapshot = loaded;
    return loaded;
  })();
  inFlight = { generation: startedIn, promise };
  const clear = () => {
    if (inFlight?.promise === promise) inFlight = null;
  };
  promise.then(clear, clear);
  return promise;
}

/** Whether an area is paused right now. Cached for a few seconds; fails open (not paused) on any read error. */
export async function isAreaPaused(area: AreaPauseKey): Promise<boolean> {
  try {
    const current = snapshot && Date.now() - snapshot.loadedAt <= CACHE_TTL_MS ? snapshot : await load();
    return current.paused.has(area);
  } catch (error) {
    logError("Reading the area pauses failed; treating the area as running.", error, { area });
    return false;
  }
}

export type AreaPauseStatus = {
  area: AreaPauseKey;
  paused: boolean;
  updatedAt: string | null;
  updatedByName: string | null;
};

/** Every area with its switch, for the admin page. A fresh read, never the cache. */
export async function listAreaPauses(): Promise<AreaPauseStatus[]> {
  const rows = await getPrisma().notificationSetting.findMany({
    where: { key: { startsWith: AREA_PAUSE_KEY_PREFIX } },
    select: { key: true, enabled: true, updatedAt: true, updatedBy: { select: { displayName: true } } },
  });
  const byKey = new Map(rows.map((row) => [row.key, row]));
  return areaPauseDefinitions.map((definition) => {
    const row = byKey.get(areaPauseSettingKey(definition.key));
    return {
      area: definition.key,
      paused: row?.enabled ?? false,
      updatedAt: row ? row.updatedAt.toISOString() : null,
      updatedByName: row?.updatedBy?.displayName ?? null,
    };
  });
}

/**
 * Pauses or resumes an area and records who did it. The audit row is written in the same transaction, with the old and
 * new values. Setting a switch to the value it already has writes nothing.
 */
export async function setAreaPaused(
  area: AreaPauseKey,
  paused: boolean,
  actorUserId: string,
): Promise<{ changed: boolean }> {
  const definition = getAreaPauseDefinition(area);
  const key = areaPauseSettingKey(area);
  const prisma = getPrisma();
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.notificationSetting.findUnique({ where: { key }, select: { enabled: true } });
    const previous = existing?.enabled ?? false;
    if (previous === paused) return { changed: false };
    await tx.notificationSetting.upsert({
      where: { key },
      update: { enabled: paused, updatedByUserId: actorUserId },
      create: { key, enabled: paused, updatedByUserId: actorUserId },
    });
    await tx.auditLog.create({
      data: {
        actorUserId,
        action: "AREA_PAUSE_CHANGED",
        entityType: "NotificationSetting",
        entityId: key,
        correlationId: `area-pause:${area}:${Date.now()}`,
        summary: `${paused ? "Paused" : "Resumed"} ${definition.name.toLowerCase()}.`,
        metadata: { area, key, oldValue: previous, newValue: paused, changedByUserId: actorUserId },
      },
    });
    return { changed: true };
  });
  resetAreaPauseCache();
  return result;
}

/**
 * The refusal for a paused area, or `null` to let the request through. `withRequestContext` calls this before every
 * route handler. A request that is not a change, or that matches no area, never reads the switch.
 */
export async function refuseIfAreaPaused(request: Request): Promise<Response | null> {
  let pathname: string;
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return null;
  }
  const area = classifyPausableArea(request.method, pathname);
  if (!area) return null;
  if (!(await isAreaPaused(area))) return null;
  return Response.json(
    // `retryable` tells the card form to keep the typed card and the attempt key, so a retry after the pause is safe.
    { error: "AREA_PAUSED", message: getAreaPauseDefinition(area).message, retryable: true },
    { status: 503, headers: { "Retry-After": String(AREA_PAUSE_RETRY_AFTER_SECONDS) } },
  );
}
