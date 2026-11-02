// The History tab's rows and the Restore as draft rules (#1140). Pure, so the
// wording and the stale-save token are testable without React. Restore reuses
// the draft save (PATCH), so the server's validation, price sync, policy checks
// and expectedUpdatedAt rule all apply unchanged.
import type { FormVersionView } from "./builder-types";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";

type VersionLike = Pick<FormVersionView, "status" | "versionNumber" | "updatedAt" | "publishedAt" | "createdBy">;

/** The state as the page words it: Live, Draft, Withdrawn, and Superseded for an older published version. */
export function versionStateLabel(version: VersionLike, versions: Pick<VersionLike, "versionNumber" | "publishedAt">[]) {
  if (version.status === "PUBLISHED") return "Live";
  if (version.status === "DRAFT") return "Draft";
  // An archived version is Withdrawn only while nothing newer was published; otherwise a newer version replaced it.
  const newerPublished = versions.some((other) => other.versionNumber > version.versionNumber && other.publishedAt);
  return newerPublished ? "Superseded" : "Withdrawn";
}

export function formatVersionDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return formatInConferenceTime(date, { dateStyle: "medium", timeStyle: "short" });
}

/** Published versions say when they went live; others say when they were last saved. `createdBy` is whoever last saved it. */
export function versionWhoWhen(version: VersionLike) {
  // An information form's versions carry no name (#1149), so the "by" is left out rather than shown empty.
  if (version.publishedAt) return `Published ${formatVersionDate(version.publishedAt)}${version.createdBy ? `, last saved by ${version.createdBy}` : ""}`;
  return `Saved ${formatVersionDate(version.updatedAt)}${version.createdBy ? ` by ${version.createdBy}` : ""}`;
}

/** Only a version that is not the draft can be copied into the draft. */
export function canRestoreVersion(version: Pick<VersionLike, "status">) {
  return version.status !== "DRAFT";
}

/**
 * The version whose updatedAt the save compares: the existing draft, otherwise
 * the newest version (the save creates the next draft from it).
 */
export function restoreSaveTarget<T extends Pick<VersionLike, "status" | "versionNumber" | "updatedAt">>(versions: T[]) {
  const draft = versions.find((version) => version.status === "DRAFT") ?? null;
  const newest = [...versions].sort((a, b) => b.versionNumber - a.versionNumber)[0] ?? null;
  return { draft, expectedUpdatedAt: (draft ?? newest)?.updatedAt ?? null };
}

export function restoreNotice(versionNumber: number) {
  return `Version ${versionNumber} copied into the draft. Publish to make it live.`;
}

export function restoreConfirmation({ versionNumber, draftVersionNumber, unsavedEdits }: { versionNumber: number; draftVersionNumber: number | null; unsavedEdits: boolean }) {
  const lines: string[] = [];
  if (unsavedEdits) lines.push("Your unsaved edits will be discarded first.");
  if (draftVersionNumber !== null) lines.push(`The current draft (version ${draftVersionNumber}) will be replaced by a copy of version ${versionNumber}.`);
  if (lines.length === 0) return null;
  lines.push("The live version and existing registrations are not changed.");
  return {
    title: `Restore version ${versionNumber} as the draft`,
    lines,
    confirmLabel: restoreConfirmLabel({ versionNumber, draftVersionNumber, unsavedEdits }),
  };
}

export function restoreConfirmLabel({ versionNumber, draftVersionNumber, unsavedEdits }: { versionNumber: number; draftVersionNumber: number | null; unsavedEdits: boolean }) {
  if (unsavedEdits && draftVersionNumber !== null) return `Discard edits and replace the draft with version ${versionNumber}`;
  if (draftVersionNumber !== null) return `Replace the draft with version ${versionNumber}`;
  return `Discard edits and restore version ${versionNumber}`;
}

export type FocusRequest = { kind: "draft-chip" } | { kind: "restore-button"; versionId: string };

export function restoreButtonId(versionId: string) {
  return `fb-restore-${versionId}`;
}

export function focusTargetId(request: FocusRequest) {
  return request.kind === "draft-chip" ? "fb-version-chip-draft" : restoreButtonId(request.versionId);
}
