import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { instructorApiError, instructorClassEmailsSchema, requireInstructorAccount } from "@/modules/honors/instructor-api";
import { setInstructorClassChangeEmails } from "@/modules/honors/instructor-repository";

/**
 * The signed-in instructor chooses how they hear about youth joining or leaving their classes (#1098): a daily summary,
 * one email right away, or none. Only the person themselves, and only their own accepted assignment; staff never set it.
 */
async function putHandler(request: Request, context: { params: Promise<{ instructorId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const account = await requireInstructorAccount();
    const { instructorId } = await context.params;
    const input = instructorClassEmailsSchema.parse(await request.json().catch(() => ({})));
    const saved = await setInstructorClassChangeEmails(account.id, instructorId, input.classChangeEmails);
    return Response.json({ ok: true, classChangeEmails: saved.classChangeEmails }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return instructorApiError(error, "Saving the class change email choice");
  }
}

export const PUT = withRequestContext(putHandler);
