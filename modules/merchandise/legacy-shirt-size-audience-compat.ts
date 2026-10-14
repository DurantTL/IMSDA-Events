/**
 * Compatibility boundary for the shirt-size request audience (#104).
 *
 * Server-only sibling of `legacy-shirt-size-compat.ts`. The messaging
 * repository and the `npm run event:shirt-sizes` script reach the legacy
 * audience builder through here, never directly. Remove with the rest of the
 * subsystem; see `docs/SHIRT-SIZES-RETIREMENT.md`.
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
