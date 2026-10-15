import { shirtSizeFromResponses } from "@/modules/registrations/shirt-sizes";

/**
 * THE compatibility boundary for the bespoke shirt-size subsystem (#104, #155).
 *
 * Everything outside `modules/registrations/shirt-sizes.ts`,
 * `modules/communications/shirt-size-audience.ts` and this directory reaches the
 * legacy shirt-size code through this file (answers, options, schemas) or
 * `legacy-shirt-size-audience-compat.ts` (the messaging audience, kept separate
 * because it needs Node crypto and must not enter client bundles). A guard test
 * (`tests/shared-module-event-neutrality-155.test.ts`) fails on any new direct
 * import of the legacy modules. Retirement plan: `docs/SHIRT-SIZES-RETIREMENT.md`.
 *
 * Until merchandise sizes are proven through #148, the size is still the
 * attendee's `shirt_size` response. When #148 lands, change what these exports
 * do, then delete them; callers go with them.
 */
export {
  eventCollectsShirtSizes,
  publicShirtSizeConfirmationSchema,
  shirtSizeConfirmedAtFromResponses,
  shirtSizeFromResponses,
  shirtSizeOptions,
  shirtSizeSchema,
} from "@/modules/registrations/shirt-sizes";
export type {
  PublicShirtSizeConfirmationInput,
  ShirtSize,
} from "@/modules/registrations/shirt-sizes";

export function legacyShirtSizeForAttendee(
  responses: Parameters<typeof shirtSizeFromResponses>[0],
  enabled: boolean,
): string | null {
  return enabled ? shirtSizeFromResponses(responses) : null;
}
