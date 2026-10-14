import { shirtSizeFromResponses } from "@/modules/registrations/shirt-sizes";

/**
 * Compatibility boundary for the bespoke shirt-size path (#155).
 *
 * Shared event modules (packets, hub) must not know where a shirt size lives.
 * Until merchandise sizes are proven through #148, the size is still the
 * attendee's `shirt_size` response, so this is the single place shared code
 * reads it. When #148 lands, change this function (and then delete it);
 * callers do not change.
 */
export function legacyShirtSizeForAttendee(
  responses: Parameters<typeof shirtSizeFromResponses>[0],
  enabled: boolean,
): string | null {
  return enabled ? shirtSizeFromResponses(responses) : null;
}
