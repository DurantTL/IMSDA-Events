import type { Prisma } from "@prisma/client";
import { eventHasCancellationPolicy } from "@/modules/cancellation-policy/policy-in-effect";

type Client = Pick<Prisma.TransactionClient, "platformSettings" | "eventAttendeeType">;

/**
 * What the required publish items read beyond the event row (#1408): the saved central sender address and the event's
 * attendee types. One loader for the server gate, the settings page and the readiness report, so they cannot disagree.
 * "Saved" means the address is set; the email environment is not consulted.
 */
export async function loadRequiredReadinessInputs(client: Client, eventId: string) {
  const [sender, types] = await Promise.all([
    // The same row and trim as `loadCentralSender` (the sender every send path uses), read directly so a light caller
    // (readiness) does not pull in the email delivery module.
    client.platformSettings.findUnique({ where: { id: "platform" }, select: { defaultSenderEmail: true } }),
    client.eventAttendeeType.findMany({
      where: { eventId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      select: { label: true, minimumAge: true },
    }),
  ]);
  return {
    centralSenderEmail: sender?.defaultSenderEmail?.trim() || null,
    attendeeTypeNames: types.map((type) => type.label),
    attendeeTypesWithAgeRangeCount: types.filter((type) => type.minimumAge !== null && type.minimumAge >= 18).length,
  };
}

/** The recommended items' input: whether a cancellation policy is in effect now (the same rule attendees see). */
export async function loadRecommendedReadinessInputs(client: Pick<Prisma.TransactionClient, "eventCancellationPolicyVersion">, eventId: string, now = new Date()) {
  return { hasCancellationPolicy: await eventHasCancellationPolicy(client, eventId, now) };
}
