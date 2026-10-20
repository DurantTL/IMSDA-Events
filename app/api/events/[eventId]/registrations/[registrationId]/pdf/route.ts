import { AccessDeniedError, requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { findActiveMembership } from "@/modules/events/repository";
import { RegistrationPdfError, readRegistrationPdfForDownload } from "@/modules/registration-pdf/repository";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";

/**
 * The PDF copy of a registration (#1082), for staff. MANAGE_REGISTRATION on the event in the URL; a registration of
 * another event is a 404. The bytes are the stored document for the registration's current version, verified against its
 * recorded hash. Never public, and the response is not cacheable.
 */
const noStore = { "Cache-Control": "private, no-store, max-age=0" };

async function getHandler(_request: Request, context: { params: Promise<{ eventId: string; registrationId: string }> }) {
  try {
    const { eventId, registrationId } = await context.params;
    const access = await requirePermission(await getCurrentSession(), eventId, "MANAGE_REGISTRATION", findActiveMembership);
    const pdf = await readRegistrationPdfForDownload(eventId, registrationId, { userId: access.user.id });
    return new Response(Buffer.from(pdf.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${pdf.filename}"`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof AccessDeniedError) return Response.json({ error: error.code, message: error.message }, { status: error.status, headers: noStore });
    if (error instanceof RegistrationPdfError) return Response.json({ error: error.code, message: error.message }, { status: error.code === "NOT_AVAILABLE" ? 404 : 409, headers: noStore });
    logError("Unable to download a registration PDF", error);
    return Response.json({ error: "REGISTRATION_PDF_FAILED" }, { status: 500, headers: noStore });
  }
}

export const GET = withRequestContext(getHandler);
