import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { attendeeSecondStepPending } from "@/modules/attendee-accounts/portal-second-step";
import { authorizeAttendeeRegistration } from "@/modules/attendee-accounts/registrations-repository";
import { privateJson, registrantAction, registrantView, requestError } from "@/modules/cancellation-requests/api";
import { withRequestContext } from "@/lib/request-context";

/**
 * Cancellation requests from the signed-in attendee portal (#170). Only an account that is signed in as an attendee
 * (not a staff user looking at the portal) and whose verified address owns the registration can ask, after the same
 * two-step check the payment routes use. The registration comes from the URL and is checked against the account, never
 * trusted from the body. A request is only a request: nothing here cancels, refunds or credits anything.
 */

type Context = { params: Promise<{ registrationId: string }> };

async function authorize(context: Context) {
  const { account, via } = await getCurrentAttendee();
  if (!account || via !== "attendee") {
    return { ok: false as const, response: privateJson({ error: "SIGN_IN_REQUIRED", message: "Sign in to manage cancellation requests." }, { status: 401 }) };
  }
  if (await attendeeSecondStepPending()) {
    return { ok: false as const, response: privateJson({ code: "SECOND_STEP_REQUIRED", message: "Finish two-step sign-in to manage cancellation requests." }, { status: 403 }) };
  }
  const { registrationId } = await context.params;
  const authorized = await authorizeAttendeeRegistration(account.verifiedEmail, registrationId);
  if (!authorized) {
    return { ok: false as const, response: privateJson({ error: "REGISTRATION_UNAVAILABLE", message: "This registration is unavailable." }, { status: 404 }) };
  }
  return { ok: true as const, target: { registrationId: authorized.registrationId, eventId: authorized.eventId }, accountId: account.id };
}

async function getHandler(_request: Request, context: Context) {
  try {
    const access = await authorize(context);
    if (!access.ok) return access.response;
    return await registrantView(access.target);
  } catch (error) {
    return requestError(error, "Loading cancellation requests");
  }
}

async function postHandler(request: Request, context: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const access = await authorize(context);
    if (!access.ok) return access.response;
    return await registrantAction(access.target, { via: "ATTENDEE_PORTAL", accountId: access.accountId }, await request.text());
  } catch (error) {
    return requestError(error, "Saving a cancellation request");
  }
}

export const GET = withRequestContext(getHandler);
export const POST = withRequestContext(postHandler);
