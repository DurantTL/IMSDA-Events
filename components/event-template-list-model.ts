import type { EventTemplateRecord } from "@/modules/event-templates/repository";

export type TemplateStatusTone = "green" | "gold" | "coral" | "neutral";

/** One status chip on a template row: the word and its tone from the shared status table (Draft gold, Published green, Archived neutral, Needs repair coral). */
export type TemplateChip = { label: string; tone: TemplateStatusTone };

export type EventTemplateRowModel = {
  statusChip: TemplateChip;
  /** The audience, in words ("General events" or "Club events"). */
  audienceLabel: string;
  /** Which versions exist: "Version 2 published; version 3 is a draft". */
  versionLine: string;
  /** Where the newest version came from: an event it was saved from, or who created the template. */
  provenanceLine: string;
  /** Whether Create event offers it, and when it does not, why. */
  availabilityLine: string;
};

/**
 * What one row of the event template list says, from the template's real status and versions (#1593). It reads
 * `canApply` (the same check `applyEventTemplate` makes), so the row never promises a template Create event would refuse.
 */
export function eventTemplateRowModel(template: EventTemplateRecord): EventTemplateRowModel {
  const published = template.versions.find((version) => version.status === "PUBLISHED") ?? null;
  const draft = template.versions.find((version) => version.status === "DRAFT") ?? null;
  const archived = template.status === "ARCHIVED";
  const needsRepair = !archived && published !== null && !template.canApply;

  const statusChip: TemplateChip = archived
    ? { label: "Archived", tone: "neutral" }
    : needsRepair
      ? { label: "Needs repair", tone: "coral" }
      : published
        ? { label: "Published", tone: "green" }
        : { label: "Draft", tone: "gold" };

  const parts: string[] = [];
  if (published) parts.push(`Version ${published.versionNumber} published`);
  if (draft) parts.push(`version ${draft.versionNumber} is a draft`);
  const versionLine = parts.length === 0 ? "No versions" : `${parts.join("; ")}`.replace(/^./, (first) => first.toUpperCase());

  const newest = template.versions.find((version) => version.source !== null) ?? null;
  const provenanceLine = newest?.source
    ? `Version ${newest.versionNumber} saved from ${newest.source.sourceEventName}${newest.source.sourceEventId ? "" : " (deleted event)"}`
    : `Created by ${template.createdBy}`;

  const availabilityLine = archived
    ? "Not offered in Create event while archived."
    : needsRepair
      ? "Not offered in Create event: the published version no longer passes validation."
      : published
        ? "Offered in Create event. New events start with a copy of the published version."
        : "Not offered in Create event until a version is published.";

  return {
    statusChip,
    audienceLabel: template.audience === "CLUB" ? "Club events" : "General events",
    versionLine,
    provenanceLine,
    availabilityLine,
  };
}

/** The chip for one stored version in a template's version list: older published versions are kept as history. */
export function templateVersionChip(status: string): TemplateChip {
  if (status === "DRAFT") return { label: "Draft", tone: "gold" };
  if (status === "PUBLISHED") return { label: "Published", tone: "green" };
  return { label: "Earlier version", tone: "neutral" };
}
