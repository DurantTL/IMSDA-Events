/**
 * Compatibility boundary for the shirt-size request audience (#104).
 *
 * Server-side sibling of `legacy-shirt-size-compat.ts`. The messaging
 * repository and the `npm run event:shirt-sizes` script reach the legacy
 * audience builder through here, never directly.
 *
 * It is not marked `server-only` because that script runs under plain tsx, so
 * the rule is enforced by a test instead: no `"use client"` file may import this
 * file or `modules/communications/shirt-size-audience.ts`
 * (tests/shared-module-event-neutrality-155.test.ts).
 *
 * Remove with the rest of the subsystem; see `docs/SHIRT-SIZES-RETIREMENT.md`.
 */
export {
  computeShirtSizeRequestPreview,
  shirtSizeAttendeeSummary,
} from "@/modules/communications/shirt-size-audience";
export type {
  ShirtSizeCandidate,
  ShirtSizeCandidateAttendee,
  ShirtSizePreviewContext,
  ShirtSizeRecipient,
  ShirtSizeRequestPreview,
  ShirtSizeSkipReasonCode,
} from "@/modules/communications/shirt-size-audience";
