import "server-only";

import { redirect } from "next/navigation";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { signInCodeRedirectPath, twoStepRedirectPath } from "@/modules/attendee-accounts/return-redirect";
import {
  accountNeedsSecondStep,
  accountNeedsSignInStep,
  type SignInStep,
} from "@/modules/attendee-accounts/sign-in-gate";

/**
 * Two gates, one module (`sign-in-gate`), and two sets of wrappers here (#1410):
 *
 * - The CLUB gate (`attendeeSecondStepPending`, `requireAttendeeSecondStep`): club pages, rosters, area
 *   coordinator and honors instructor pages and APIs, club registration, health and medical data. Open only
 *   after a real second step (authenticator app or passkey) in this session.
 * - The SIGN-IN step (`attendeeSignInStep`, `attendeeSignInStepPending`, `requireAttendeeSignInStep`): the
 *   person's own registrations, profile, payments, events, forms, help and sign-in security. A club role
 *   without two-step sign-in clears it with the emailed code; everyone else is unchanged.
 */

/**
 * Whether this browser's attendee session belongs to a club role or Area
 * Coordinator that hasn't passed its second step yet (decision 2026-09-23).
 * The CLUB gate: an emailed code never clears it.
 */
export async function attendeeSecondStepPending() {
  const { account, via, sessionId } = await getCurrentAttendee();
  if (!account || via !== "attendee") return false;
  return (await accountNeedsSecondStep(account.id, sessionId)) !== "OK";
}

/**
 * For club pages that show the attendee's own club role. The portal layout
 * does not send club roles to /account/two-step while a staff "act as" is
 * active (#442) — act-as pages resolve purely from the staff session — so a
 * page that reads the attendee account checks the second step itself.
 */
export async function requireAttendeeSecondStep() {
  if (await attendeeSecondStepPending()) redirect(await twoStepRedirectPath());
}

/** What this browser's session still owes before the person's own pages open (OK for a staff "act as"). */
export async function attendeeSignInStep(): Promise<SignInStep> {
  const { account, via, sessionId } = await getCurrentAttendee();
  if (!account || via !== "attendee") return "OK";
  return accountNeedsSignInStep(account.id, sessionId);
}

/** The SIGN-IN step is still owed: the emailed code, or the authenticator or passkey this account already has. */
export async function attendeeSignInStepPending() {
  return (await attendeeSignInStep()) !== "OK";
}

/** Where a request that owes this sign-in step goes, carrying the page they wanted. */
export async function signInStepRedirectPath(step: Exclude<SignInStep, "OK">) {
  return step === "EMAIL_CODE" ? signInCodeRedirectPath() : twoStepRedirectPath();
}

/** For pages that show the attendee's own account: sends a session that owes the sign-in step to it. */
export async function requireAttendeeSignInStep() {
  const step = await attendeeSignInStep();
  if (step !== "OK") redirect(await signInStepRedirectPath(step));
}
