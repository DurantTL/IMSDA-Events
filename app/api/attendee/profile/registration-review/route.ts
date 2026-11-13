import { z } from "zod";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { attendeeSignInStepPending } from "@/modules/attendee-accounts/portal-second-step";
import {
  applyRegistrationProfileReview,
  applyReviewSchema,
  getRegistrationProfileReview,
  ProfileReviewError,
} from "@/modules/attendee-accounts/profile-review-service";
import { withRequestContext } from "@/lib/request-context";

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
};

function json(body: unknown, init?: ResponseInit) {
  return Response.json(body, {
    ...init,
    headers: { ...privateHeaders, ...init?.headers },
  });
}

async function account() {
  const current = await getCurrentAttendee();
  return current.via === "attendee" ? current.account : null;
}

/** Same role-dependent second step the profile route enforces (decision 2026-09-23, #736). */
function secondStepRequired() {
  return json(
    { code: "SECOND_STEP_REQUIRED", message: "Finish two-step sign-in to review your profile." },
    { status: 403 },
  );
}

const notFound = () => json({ message: "That registration was not found." }, { status: 404 });

async function getHandler(request: Request) {
  const attendee = await account();
  if (!attendee) return json({ message: "Sign in to review your profile." }, { status: 401 });
  if (await attendeeSignInStepPending()) return secondStepRequired();
  const registrationId = new URL(request.url).searchParams.get("registrationId")?.trim() ?? "";
  if (!registrationId || registrationId.length > 100) return notFound();
  const review = await getRegistrationProfileReview(attendee, registrationId);
  return review ? json({ review }) : notFound();
}

async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  const attendee = await account();
  if (!attendee) return json({ message: "Sign in to review your profile." }, { status: 401 });
  if (await attendeeSignInStepPending()) return secondStepRequired();
  try {
    const input = applyReviewSchema.parse(await request.json());
    const result = await applyRegistrationProfileReview(attendee, input);
    return json({ applied: result.applied });
  } catch (error) {
    if (error instanceof ProfileReviewError) {
      return error.code === "NOT_FOUND"
        ? notFound()
        : json({ code: "STALE", message: error.message }, { status: 409 });
    }
    if (error instanceof z.ZodError) {
      return json({
        message: error.issues[0]?.message ?? "Review your profile and try again.",
        issues: error.issues,
      }, { status: 400 });
    }
    throw error;
  }
}

export const GET = withRequestContext(getHandler);
export const POST = withRequestContext(postHandler);
