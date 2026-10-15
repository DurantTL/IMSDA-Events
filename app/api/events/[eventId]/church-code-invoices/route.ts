import { z } from "zod";
import { AccessDeniedError, requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { findActiveMembership } from "@/modules/events/repository";
import { InvoiceError } from "@/modules/invoices/repository";
import { prepareChurchCodeInvoiceDraft } from "@/modules/promo-codes/church-invoice-repository";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";

/**
 * Create or refresh the DRAFT invoice for what one church's promo codes covered (#399). MANAGE_FINANCE on the event in
 * the URL, checked here on the server. This only prepares a draft: finalizing and sending stay the office's named
 * actions on the invoice (the Finalize invoices permission), and nothing here finalizes, numbers, sends or emails.
 * Same-origin only.
 */

type RouteContext = { params: Promise<{ eventId: string }> };

const bodySchema = z.object({ churchId: z.string().trim().min(1).max(64) }).strict();

function statusFor(error: InvoiceError) {
  switch (error.code) {
    case "EVENT_NOT_FOUND":
    case "PARTY_NOT_FOUND":
      return 404;
    case "INVALID_INPUT":
      return 400;
    default:
      return 409;
  }
}

async function postHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const { user } = await requirePermission(await getCurrentSession(), eventId, "MANAGE_FINANCE", findActiveMembership);
    const body = bodySchema.parse(await request.json().catch(() => ({})));
    return Response.json(await prepareChurchCodeInvoiceDraft({ eventId, churchId: body.churchId, actorUserId: user.id }));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "INVALID_CHURCH_CODE_INVOICE_REQUEST", message: "Choose a church and try again." }, { status: 400 });
    }
    if (error instanceof AccessDeniedError) return Response.json({ error: error.code, message: error.message }, { status: error.status });
    if (error instanceof InvoiceError) return Response.json({ error: error.code, message: error.message }, { status: statusFor(error) });
    logError("Church code invoice request failed", error);
    return Response.json({ error: "CHURCH_CODE_INVOICE_FAILED", message: "The draft could not be prepared." }, { status: 500 });
  }
}

export const POST = withRequestContext(postHandler);
