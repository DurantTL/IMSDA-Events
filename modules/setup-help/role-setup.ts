import type { SetupHelp } from "./types";

/**
 * One "not set up / missing / blocked / empty" state a club director or area coordinator can meet (#1435): the setup
 * help it shows (a **Set up** link, or **How to do this** steps), who to ask when only someone else can fix it (H4),
 * and the Help guide for the longer story. Fixed words only; nothing here holds a person, a club or a value.
 */
export type RoleSetupEntry = {
  setup: SetupHelp;
  /** Said when only someone else can fix it, such as "Ask the conference office to add a director." */
  whoToAsk?: string;
  /** A guide id: a portal guide (`modules/help/portal-guides.ts`, `/account/help/<id>`), or a staff guide with `guideScope: "staff"` (`modules/help/guides.ts`, `/help/<id>`). */
  guideId: string | null;
  guideScope?: "portal" | "staff";
};

/** What the panel needs to show an entry. An entry with neither a Set up link nor steps nor who to ask is a dead end. */
export function roleSetupHasNextStep(entry: RoleSetupEntry): boolean {
  const setup = entry.setup;
  const hasLink = "href" in setup && setup.href.length > 0;
  const hasSteps = "steps" in setup && setup.steps.length > 0;
  return hasLink || hasSteps || Boolean(entry.whoToAsk?.trim());
}

/** Steps-only setup: no setting names, no longer guide in the repository (the Help guide is the longer guide). */
export const howTo = (steps: readonly string[], whenDone: string): SetupHelp => ({ steps, settingNames: [], docsLink: null, whenDone });

export const CONFERENCE_OFFICE = "the conference office";
export const askOffice = (what: string) => `Only ${CONFERENCE_OFFICE} can ${what}. Ask them.`;
export const askDirector = (what: string) => `Ask your club's director or deputy ${what}.`;

/** The Help guide's address in the account portal. */
export const portalGuideHref = (guideId: string) => `/account/help/${guideId}`;

/** Where an entry's Help guide opens. */
export const guideHrefFor = (entry: Pick<RoleSetupEntry, "guideId" | "guideScope">): string | null =>
  entry.guideId === null ? null : entry.guideScope === "staff" ? `/help/${entry.guideId}` : portalGuideHref(entry.guideId);

export const askSystemAdmin = (what: string) => `Only a system administrator can ${what}. Ask a system administrator.`;
