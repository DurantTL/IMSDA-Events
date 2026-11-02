/**
 * Putting the local database back after a walkthrough run (#1482). A run changes three things outside its own fixtures: it
 * switches passkeys on, switches some club form templates on, and (for coordinator walkthroughs) hides the clubs already in
 * the database. The "before" state is written to a marker file BEFORE anything changes, so a run that was killed (Ctrl-C,
 * SIGTERM, a crash) is repaired by the next one, which restores from the marker first and then removes it.
 * The marker lives in the OS temp directory, never in the repository.
 */
import { existsSync, lstatSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { restoreOtherClubs, restorePasskeys, restoreTemplateStates, setEventsPublished, type TemplateState } from "./help-walkthrough-fixtures";

export type RestoreState = {
  /** The database the state belongs to (its name), so a marker from another database is never applied here. */
  database: string;
  hiddenClubs: string[];
  /** Published club events that were unpublished for the run. */
  hiddenEvents: string[];
  templates: TemplateState[];
  /** The passkey relying-party id before the run: null when passkeys were off. */
  passkeyRpId: string | null;
};

/** The marker's path: in the OS temp directory, named for the user who runs the script, so two users never share one. */
export const restoreMarkerFile = (env: Record<string, string | undefined> = process.env) =>
  env.HELP_SHOTS_RESTORE_FILE || path.join(os.tmpdir(), `imsda-help-walkthroughs-restore-${os.userInfo().uid}.json`);

/** The database name in a connection URL, or "" when it cannot be read. */
export function databaseNameOf(url: string | undefined): string {
  try {
    return new URL(url ?? "").pathname.replace(/^\//, "");
  } catch {
    return "";
  }
}

/**
 * Writes the marker. `wx` refuses to write over anything that already exists (a file, or a symlink someone planted), and the
 * file is private to the user.
 */
export function writeRestoreMarker(file: string, state: RestoreState) {
  try {
    writeFileSync(file, JSON.stringify(state, null, 2), { mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`Refusing to write ${file}: something is already there that this run cannot use as its restore marker. Look at it, and delete it if it is yours.`);
    throw error;
  }
}

/** Whether `file` is a regular file (never a symlink) owned by this user. A marker that is not is ignored. */
export function isOwnRegularFile(file: string): boolean {
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    return typeof process.getuid !== "function" || stat.uid === process.getuid();
  } catch {
    return false;
  }
}

/** The saved state, or null when there is no marker or it is not a valid one. */
export function readRestoreMarker(file: string): RestoreState | null {
  if (!isOwnRegularFile(file)) return null;
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as Partial<RestoreState>;
    const validTemplates = Array.isArray(value.templates) && value.templates.every((row) => row && typeof row.key === "string" && typeof row.enabled === "boolean" && typeof row.requirement === "string" && Array.isArray(row.requiredRoles));
    if (typeof value.database !== "string" || !Array.isArray(value.hiddenClubs) || !value.hiddenClubs.every((id) => typeof id === "string") || !validTemplates) return null;
    // A marker written before events were hidden has no list: nothing to put back.
    if (value.hiddenEvents === undefined) value.hiddenEvents = [];
    if (!Array.isArray(value.hiddenEvents) || !value.hiddenEvents.every((id) => typeof id === "string")) return null;
    if (value.passkeyRpId !== null && typeof value.passkeyRpId !== "string") return null;
    return value as RestoreState;
  } catch {
    return null;
  }
}

/** Removes the marker, but only when it is this user's own regular file. */
export function removeRestoreMarker(file: string) {
  if (isOwnRegularFile(file)) rmSync(file, { force: true });
}

/** Applies a saved state. Each part runs on its own, so one failure does not stop the others; failures are returned. */
export async function applyRestoreState(prisma: PrismaClient, state: RestoreState): Promise<string[]> {
  const failures: string[] = [];
  const attempt = async (what: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (error) {
      failures.push(`${what}: ${(error as Error).message}`);
    }
  };
  await attempt("form templates", () => restoreTemplateStates(prisma, state.templates));
  await attempt("seeded clubs", () => restoreOtherClubs(prisma, state.hiddenClubs));
  await attempt("club events", () => setEventsPublished(prisma, state.hiddenEvents, true));
  await attempt("passkey setting", () => restorePasskeys(prisma, state.passkeyRpId));
  return failures;
}

/**
 * At the start of a run: when an earlier run left a marker, put the database back and remove it. A marker for another database
 * is left alone. A marker that could not be applied is kept, so nothing is forgotten. Returns true when something was restored.
 */
export async function recoverFromLeftoverMarker(prisma: PrismaClient, file: string, database: string, log: (line: string) => void): Promise<boolean> {
  const state = readRestoreMarker(file);
  if (!state) {
    if (existsSync(file)) log(`Ignoring ${file}: it is not a valid restore marker.`);
    return false;
  }
  if (state.database !== database) {
    log(`Leaving ${file} alone: it belongs to the database "${state.database}", not "${database}".`);
    return false;
  }
  log("An earlier run did not finish. Restoring the database from its marker first.");
  const failures = await applyRestoreState(prisma, state);
  if (failures.length > 0) throw new Error(`Could not restore from ${file}: ${failures.join("; ")}`);
  removeRestoreMarker(file);
  return true;
}
