import { toCsv } from "@/modules/reporting/csv";
import {
  emergencyLocationKindLabels,
  emergencyProcedureKindLabels,
  formatPrintTimestamp,
  type EmergencyPlanSnapshot,
} from "@/modules/emergency-plans/domain";

/**
 * The printable emergency reference sheet (#114), as pure functions of a
 * snapshot. It reads nothing else: no database, no attendee, guardian,
 * medical, custody or incident data can reach it.
 */

export type EmergencyReferenceMeta = { versionNumber: number; publishedAt: Date };

export type EmergencyReferenceSheet = {
  eventName: string;
  dates: string;
  timezone: string;
  /** DRAFT sheets carry no version and no published date, and say so. */
  isDraft: boolean;
  banner: string | null;
  versionNumber: number | null;
  publishedAt: Date | null;
  assemblyLocations: EmergencyPlanSnapshot["locations"];
  shelters: EmergencyPlanSnapshot["locations"];
  procedures: EmergencyPlanSnapshot["procedures"];
  contacts: EmergencyPlanSnapshot["contacts"];
};

export const draftBanner = "DRAFT — not published";

function dateRange(snapshot: EmergencyPlanSnapshot): string {
  const { startsOn, endsOn } = snapshot.event;
  return startsOn === endsOn ? startsOn : `${startsOn} to ${endsOn}`;
}

/** `meta` null is a draft preview: marked as such, with no version claim. */
export function buildEmergencyReferenceSheet(snapshot: EmergencyPlanSnapshot, meta: EmergencyReferenceMeta | null): EmergencyReferenceSheet {
  return {
    eventName: snapshot.event.name,
    dates: dateRange(snapshot),
    timezone: snapshot.event.timezone,
    isDraft: meta === null,
    banner: meta === null ? draftBanner : null,
    versionNumber: meta?.versionNumber ?? null,
    publishedAt: meta?.publishedAt ?? null,
    assemblyLocations: snapshot.locations.filter((location) => location.kind === "ASSEMBLY"),
    shelters: snapshot.locations.filter((location) => location.kind === "SHELTER"),
    procedures: snapshot.procedures,
    contacts: snapshot.contacts,
  };
}

/** The footer's identifying part: version and published date; a draft names neither. */
export function emergencyReferenceFooterPrefix(sheet: EmergencyReferenceSheet): string {
  if (sheet.isDraft || sheet.versionNumber === null || sheet.publishedAt === null) return draftBanner;
  return `Version ${sheet.versionNumber}. Published ${formatPrintTimestamp(sheet.publishedAt, sheet.timezone)}`;
}

/** The footer line: version, published date and print timestamp; a draft names neither version nor date. */
export function emergencyReferenceFooter(sheet: EmergencyReferenceSheet, printedAt: Date): string {
  return `${emergencyReferenceFooterPrefix(sheet)}. Printed ${formatPrintTimestamp(printedAt, sheet.timezone)}`;
}

export const emergencyReferenceCsvHeader = ["Section", "Order", "Name", "Role or kind", "Phone", "Description", "Capacity", "Directions", "Map reference", "Steps"] as const;

/** One CSV: sheet details, then locations, procedures and contacts. Only the sheet's own fields. */
export function emergencyReferenceCsv(sheet: EmergencyReferenceSheet): string {
  const blank = (count: number) => Array.from({ length: count }, () => "");
  const rows: Array<Array<string | number>> = [
    [...emergencyReferenceCsvHeader],
    ["Event", "", sheet.eventName, "", "", sheet.dates, "", "", "", ""],
    [
      "Version",
      sheet.versionNumber ?? "",
      sheet.isDraft ? draftBanner : `Version ${sheet.versionNumber}`,
      "", "",
      sheet.publishedAt ? sheet.publishedAt.toISOString() : "",
      ...blank(4),
    ],
  ];
  const addLocations = (section: string, locations: EmergencyPlanSnapshot["locations"]) => {
    for (const [index, location] of locations.entries()) {
      rows.push([section, index + 1, location.name, emergencyLocationKindLabels[location.kind], "", location.description, location.capacityNote, location.directions, location.mapReference ?? "", ""]);
    }
  };
  addLocations("Assembly location", sheet.assemblyLocations);
  addLocations("Shelter", sheet.shelters);
  for (const [index, procedure] of sheet.procedures.entries()) {
    const steps = procedure.items.map((item, step) => `${step + 1}. ${item.title}${item.text ? `: ${item.text}` : ""}`).join("\n");
    rows.push(["Procedure", index + 1, procedure.title, emergencyProcedureKindLabels[procedure.kind], "", procedure.body, "", "", "", steps]);
  }
  for (const contact of sheet.contacts) {
    rows.push(["Contact", contact.escalationOrder, contact.name, contact.role, contact.phone, "", "", "", "", ""]);
  }
  return toCsv(rows);
}
