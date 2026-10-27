import { helpDestinations, helpGuides } from "@/modules/help/guides";
import { portalDestinations, portalGuides, reservedPortalGuideIds } from "@/modules/help/portal-guides";
import type { HelpDestination, HelpGuide, PortalDestination, PortalGuide } from "@/modules/help/types";

/**
 * The outdated-guide check (#1259). Pure: it is given the page routes and a way to ask whether a doc exists, so a
 * test can pin the clock and the file system. The script `scripts/check-help-guides.ts` (`npm run help:check`)
 * supplies the real ones. It reports problems and never changes a guide.
 */

/** A guide not re-checked against the real pages for longer than this many days is reported. */
export const maxGuideAgeDays = 180;

export type GuideProblemKind =
  | "unknown-destination"
  | "missing-page"
  | "missing-doc"
  | "stale-review"
  | "invalid-review-date"
  | "reserved-id"
  | "missing-screenshot";

export type GuideProblem = {
  source: "staff" | "portal";
  /** A guide id, or a destination id for a problem with a destination itself. */
  subject: string;
  kind: GuideProblemKind;
  message: string;
};

export type GuideCheckInput = {
  now: Date;
  /** Page routes with route groups removed, such as `/account/clubs/[organizationId]`. */
  routes: readonly string[];
  docExists: (path: string) => boolean;
  /** Whether a site path such as `/help/example.png` is a file under `public/`. When left out, screenshots are not checked. */
  publicFileExists?: (path: string) => boolean;
  staffGuides?: readonly HelpGuide[];
  staffDestinations?: Record<string, HelpDestination>;
  portalGuides?: readonly PortalGuide[];
  portalDestinations?: Record<string, PortalDestination>;
};

/** Whether `path` is served by a page route. A `[param]` segment in a route matches any one segment. */
export function routeHasPage(path: string, routes: readonly string[]): boolean {
  const parts = path.split("/").filter(Boolean);
  return routes.some((route) => {
    const routeParts = route.split("/").filter(Boolean);
    return routeParts.length === parts.length && routeParts.every((part, index) => /^\[.+\]$/.test(part) || part === parts[index]);
  });
}

const dayMs = 24 * 60 * 60 * 1000;

/** Whole days from `YYYY-MM-DD` to `now`, or `null` when the text is not a real calendar date. */
export function daysSinceReview(lastReviewed: string, now: Date): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lastReviewed)) return null;
  const reviewed = new Date(`${lastReviewed}T00:00:00Z`);
  if (Number.isNaN(reviewed.getTime()) || reviewed.toISOString().slice(0, 10) !== lastReviewed) return null;
  return Math.floor((now.getTime() - reviewed.getTime()) / dayMs);
}

export function checkHelpGuides(input: GuideCheckInput): GuideProblem[] {
  const problems: GuideProblem[] = [];
  const staffGuides = input.staffGuides ?? helpGuides;
  const staffDestinations = input.staffDestinations ?? helpDestinations;
  const portal = input.portalGuides ?? portalGuides;
  const portalDests = input.portalDestinations ?? portalDestinations;
  const add = (source: GuideProblem["source"], subject: string, kind: GuideProblemKind, message: string) => problems.push({ source, subject, kind, message });

  const checkDestinations = (source: GuideProblem["source"], destinations: Record<string, { path: string }>) => {
    for (const [id, destination] of Object.entries(destinations)) {
      if (!routeHasPage(destination.path, input.routes)) add(source, id, "missing-page", `Destination "${id}" points to ${destination.path}, which has no page under app/.`);
    }
  };
  checkDestinations("staff", staffDestinations);
  checkDestinations("portal", portalDests);

  const checkGuide = (source: GuideProblem["source"], guide: Pick<HelpGuide, "id" | "destinationIds" | "relatedDocs" | "lastReviewed" | "screenshot">, destinations: Record<string, unknown>) => {
    for (const id of guide.destinationIds) {
      if (!destinations[id]) add(source, guide.id, "unknown-destination", `Guide "${guide.id}" uses destination "${id}", which is not defined.`);
    }
    for (const doc of guide.relatedDocs) {
      if (!input.docExists(doc)) add(source, guide.id, "missing-doc", `Guide "${guide.id}" links ${doc}, which does not exist.`);
    }
    if (guide.screenshot && input.publicFileExists && !input.publicFileExists(guide.screenshot.src)) {
      add(source, guide.id, "missing-screenshot", `Guide "${guide.id}" shows ${guide.screenshot.src}, which is not a file under public/.`);
    }
    const age = daysSinceReview(guide.lastReviewed, input.now);
    if (age === null) add(source, guide.id, "invalid-review-date", `Guide "${guide.id}" has lastReviewed "${guide.lastReviewed}", which is not a YYYY-MM-DD date.`);
    else if (age > maxGuideAgeDays) add(source, guide.id, "stale-review", `Guide "${guide.id}" was last reviewed ${age} days ago (${guide.lastReviewed}); the limit is ${maxGuideAgeDays}.`);
  };
  for (const guide of staffGuides) checkGuide("staff", guide, staffDestinations);
  for (const guide of portal) {
    checkGuide("portal", guide, portalDests);
    if (reservedPortalGuideIds.includes(guide.id)) add("portal", guide.id, "reserved-id", `Portal guide id "${guide.id}" is already a route below /account/help.`);
  }
  return problems;
}
