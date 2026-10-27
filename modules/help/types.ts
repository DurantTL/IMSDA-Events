import type { EventPermission } from "@/modules/access/permissions";

/**
 * Help & learning (#1077). Pure data and pure functions: nothing in `modules/help`
 * reads the database, a session or an event. A guide never holds an event name,
 * an attendee, a private link or a person's name.
 */
export type HelpWorkspace = "System" | "Event";

/**
 * Who sees a guide in the hub and in search. It decides visibility only; the
 * pages a guide points to keep their own authorization.
 */
export type GuideAudience =
  /** Every signed-in staff member, including staff with no event. */
  | { kind: "everyone" }
  /** System administrators only. */
  | { kind: "system" }
  /** Staff who hold the permission the guide's working page needs (system administrators hold every one). */
  | { kind: "event-permission"; permission: EventPermission };

/** A page a guide can point to. Whether a given viewer gets the link is decided in `visibility.ts`. */
export type HelpDestination = {
  id: string;
  label: string;
  /** The page's route path, no query string. The event is added for the viewer. */
  path: string;
  scope: "System" | "Event";
  /** Event destinations: the permission the page needs. */
  permission?: EventPermission;
};

export type HelpGuide = {
  /** Stable slug used in the URL. Never reuse or rename one. */
  id: string;
  title: string;
  summary: string;
  workspace: HelpWorkspace;
  audience: GuideAudience;
  /** What the reader needs before starting. Never tells the reader to ask for system administrator rights. */
  needs: readonly string[];
  /** What following the guide will change. */
  changes: readonly string[];
  steps: readonly string[];
  /** How to check the outcome. */
  verify: readonly string[];
  /** The next step once this one is done. */
  next: string;
  /** Ids from `helpDestinations`: the working pages this guide depends on. */
  destinationIds: readonly string[];
  /** Repository doc paths, such as `docs/STAFF-INVITATIONS.md`. */
  relatedDocs: readonly string[];
  /** Task words that find the guide but are not shown. */
  keywords: readonly string[];
  /** The role that keeps the guide current (a role, never a person's name). */
  owner: string;
  /** `YYYY-MM-DD` of the last check against the real pages. */
  lastReviewed: string;
};

export type GlossaryTerm = { term: string; meaning: string };
