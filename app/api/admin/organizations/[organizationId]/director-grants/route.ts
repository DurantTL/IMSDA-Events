import { after } from "next/server";
import { logError } from "@/lib/logger";
import { processAccountEmailQueue } from "@/modules/communications/email-delivery";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { requireClubOrganizationAdministration } from "@/modules/organizations/access";
import { organizationApiError } from "@/modules/organizations/api-errors";
import {
  createDirectorGrant,
  listDirectorGrants,
} from "@/modules/organizations/director-grants-repository";
import { createDirectorGrantInputSchema } from "@/modules/organizations/director-grants-schemas";
import { withRequestContext } from "@/lib/request-context";

type RouteContext = { params: Promise<{ organizationId: string }> };

async function getHandler(_request: Request, context: RouteContext) {
  try {
    const { organizationId } = await context.params;
    await requireClubOrganizationAdministration(organizationId);
    return Response.json(await listDirectorGrants(organizationId));
  } catch (error) {
    return organizationApiError(error, "Loading club directors");
  }
}

async function postHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { organizationId } = await context.params;
    const actor = await requireClubOrganizationAdministration(organizationId);
    const input = createDirectorGrantInputSchema.parse(await request.json());
    const { given, ...listing } = await createDirectorGrant(organizationId, input, actor.id);
    const messageId = given?.messageId ?? null;
    // The one email for this grant leaves after the response; a failure leaves it queued for the sweep.
    if (messageId) {
      after(async () => {
        try {
          await processAccountEmailQueue({ messageIds: [messageId], limit: 1 });
        } catch (error) {
          logError("A club role email was queued but not delivered after the response.", error, { messageId });
        }
      });
    }
    // Only what the notice needs: names, a yes or no, and whether an email was queued. No ids of secrets.
    return Response.json(
      {
        ...listing,
        granted: given
          ? { displayName: given.displayName, email: given.email, twoStepOn: given.twoStepOn, emailQueued: Boolean(messageId) }
          : null,
      },
      { status: 201 },
    );
  } catch (error) {
    return organizationApiError(error, "Assigning a club director");
  }
}

export const GET = withRequestContext(getHandler);
export const POST = withRequestContext(postHandler);
