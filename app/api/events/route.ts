import { Prisma } from "@prisma/client";
import { z } from "zod";
import { AccessDeniedError, requireAuthenticatedUser } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { CalendarError } from "@/modules/calendar/errors";
import { requireEventCreationPermission } from "@/modules/events/authorization";
import {
  createEvent,
  EventOperationError,
  listEventsForUser,
} from "@/modules/events/repository";
import { eventSettingsInputSchema } from "@/modules/events/schemas";
import { creationFeaturesSchema } from "@/modules/event-features/creation";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";

function eventApiError(error: unknown) {
  if (error instanceof z.ZodError) {
    return Response.json({
      error: "INVALID_EVENT",
      message: error.issues[0]?.message ?? "Review the event details and try again.",
      issues: error.issues,
    }, { status: 400 });
  }
  if (error instanceof AccessDeniedError) {
    return Response.json({ error: error.code, message: error.message }, { status: error.status });
  }
  if (error instanceof CalendarError) {
    return Response.json({ error: error.code, message: error.message }, { status: error.code === "ENTRY_NOT_FOUND" ? 404 : 409 });
  }
  if (error instanceof EventOperationError) {
    return Response.json(
      { error: error.code, message: error.message },
      { status: error.code === "EVENT_NOT_FOUND" ? 404 : 409 }
    );
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return Response.json({
      error: "EVENT_SLUG_TAKEN",
      message: "That event web address is already in use. Choose another short address.",
    }, { status: 409 });
  }
  logError("Event request failed", error);
  return Response.json({
    error: "EVENT_REQUEST_FAILED",
    message: "The event could not be saved.",
  }, { status: 500 });
}

async function getHandler() {
  try {
    const user = requireAuthenticatedUser(await getCurrentSession());
    const events = await listEventsForUser(user.id, user.globalRole === "SYSTEM_ADMIN");
    return Response.json({ events });
  } catch (error) { return eventApiError(error); }
}

async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const user = requireEventCreationPermission(await getCurrentSession());
    const body = await request.json();
    const input = eventSettingsInputSchema.parse(body);
    // Set when the event is set up from a calendar item (#445); the item decides the rest, never the request.
    const calendarEntryId = z.object({ calendarEntryId: z.string().trim().min(1).max(100).optional() }).parse(body ?? {}).calendarEntryId;
    // The "Which features does this event use?" step (#965): the chosen modules and calendar choice. Absent is the
    // step skipped, so the audience's defaults. The flags (waitlist, shirt sizes, ...) are ordinary settings fields.
    const features = z.object({ features: creationFeaturesSchema.optional() }).parse(body ?? {}).features;
    const options = {
      ...(calendarEntryId ? { calendarEntryId } : {}),
      ...(features?.modules ? { modules: features.modules } : {}),
      ...(features?.showOnCalendar === undefined ? {} : { showOnCalendar: features.showOnCalendar }),
    };
    const event = await (Object.keys(options).length > 0 ? createEvent(input, user.id, options) : createEvent(input, user.id));
    return Response.json({ event }, { status: 201 });
  } catch (error) { return eventApiError(error); }
}

export const GET = withRequestContext(getHandler);
export const POST = withRequestContext(postHandler);
