/**
 * One way to fix something that is "not set up" (#1434). It is general on purpose: the System report uses it now and
 * the event admin, club director and area coordinator screens (#1435) reuse it. It carries fixed words and setting
 * NAMES only; there is no field for a value, and nothing here is ever read from the environment.
 */
export type InAppSetup = {
  /** The in-app page where it is set up. Shown as a "Set up" link. */
  href: string;
  /** The link text when it should say more than "Set up". */
  label?: string;
};

export type ServerSetup = {
  /** Plain, numbered steps with the exact clicks. Never a value, a key or a sample key. */
  steps: readonly string[];
  /** The setting names to add, such as `TURNSTILE_SITE_KEY`. Names only. */
  settingNames: readonly string[];
  /** A repository path such as `docs/TURNSTILE.md` for the longer guide, or `null`. It never repeats the steps. */
  docsLink: string | null;
  /** What the row will show once it works. */
  whenDone: string;
};

export type SetupHelp = InAppSetup | ServerSetup;

/** A not-set-up part of a row that lists several services (for example Connected services). */
export type ServiceSetup = { id: string; label: string; setup: SetupHelp };

export function isInAppSetup(setup: SetupHelp): setup is InAppSetup {
  return "href" in setup;
}
