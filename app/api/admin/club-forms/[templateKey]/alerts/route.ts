import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { clubFormApiError, readClubFormJson } from "@/modules/club-forms/api-errors";
import { templateAlertRecipientsSchema } from "@/modules/club-forms/schemas";
import { setClubFormAlertRecipients } from "@/modules/club-forms/templates";
import { requireSystemAdministrator } from "@/modules/organizations/access";

type RouteContext = { params: Promise<{ templateKey: string }> };

/** A system administrator sets who is emailed when this club form is submitted (#1017). Nobody else can. */
async function putHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const admin = await requireSystemAdministrator();
    const { templateKey } = await context.params;
    const { emails } = templateAlertRecipientsSchema.parse(await readClubFormJson(request));
    return Response.json(await setClubFormAlertRecipients(templateKey, emails, admin.id), {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return clubFormApiError(error, "Changing a club form's alert recipients");
  }
}

export const PUT = withRequestContext(putHandler);
