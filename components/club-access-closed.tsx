import { AccessRestricted } from "@/components/access-restricted";

/**
 * The states where the club layout already answers for the page: it shows the own-sign-in / two-step step, sends a
 * signed-out person to sign in and turns away someone with no tie to the club with a 404. A page adds nothing there
 * (and never says a club exists to someone who gets the 404).
 */
const LAYOUT_SHOWS_THE_STEP = new Set(["OWN_SESSION_REQUIRED", "MFA_SETUP", "MFA_UNLOCK", "SIGN_IN", "NOT_FOUND"]);

/**
 * What a club portal page shows when its access check is not open (rule 14). The club layout already shows the
 * own-sign-in / two-step prompt, so those states add nothing here; every other closed state (a role without this
 * section, such as a Reporter on the roster) says so and who to ask, instead of leaving the page blank. It never
 * names a record: the layout has already turned away anyone who has no relationship to the club with a 404.
 */
export function clubAccessClosed(access: { state: string }) {
  if (LAYOUT_SHOWS_THE_STEP.has(access.state)) return null;
  return (
    <AccessRestricted
      title="This page isn't part of your club role"
      detail="Your role in this club doesn't include this section."
      whoToAsk="your club director"
    />
  );
}
