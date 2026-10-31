import type { CancellationScope } from "@/modules/cancellation-policy/rules";
import type { ActorKind, RequestConflict, RequestStatus, RegistrantProposal } from "@/modules/cancellation-requests/domain";

/**
 * Plain data the pages and client components receive. No server-only import, so a client component can import these
 * types. The registrant's view never carries the staff decision reason, a staff member's name, or another person's data.
 */

export type RegistrantRequestSummary = {
  id: string;
  status: RequestStatus;
  statusLabel: string;
  statusDetail: string;
  scope: CancellationScope;
  /** Names of the attendees the request is for, from this registration only. */
  attendeeNames: string[];
  chargeLabels: string[];
  proposedRefundCents: number;
  policyVersion: number | null;
  createdAt: string;
  updatedAt: string;
  /** What staff asked the registrant to provide; only while information is needed. */
  registrantNote: string | null;
  canWithdraw: boolean;
  timeline: Array<{ status: RequestStatus; label: string; at: string }>;
};

export type RegistrantRequestView = {
  /** False when requests are not offered for this registration, with the reason to show. */
  available: boolean;
  unavailableReason: string | null;
  allowedScopes: CancellationScope[];
  attendees: Array<{ id: string; name: string }>;
  components: Array<{ id: string; label: string; amountCents: number }>;
  requests: RegistrantRequestSummary[];
  /** True when any request is open, so the screen warns before another overlapping one replaces it. */
  hasOpenRequest: boolean;
  /**
   * True when the registration is otherwise eligible but the event has no cancellation policy in effect (#1408), so
   * My registrations tells the attendee to contact the event team. The same rule as the event's readiness item.
   */
  noPolicy?: boolean;
};

export const noRequestsView: RegistrantRequestView = {
  available: false,
  unavailableReason: null,
  allowedScopes: [],
  attendees: [],
  components: [],
  requests: [],
  hasOpenRequest: false,
};

export type StaffTimelineStep = {
  status: RequestStatus;
  label: string;
  actorKind: ActorKind;
  actorName: string | null;
  note: string | null;
  at: string;
};

export type StaffQueueRow = {
  id: string;
  registrationId: string;
  confirmationCode: string;
  registrantName: string;
  status: RequestStatus;
  statusLabel: string;
  scope: CancellationScope;
  proposedRefundCents: number;
  afterDeadline: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CapacityEffects = {
  registrationWouldBeCancelled: boolean;
  seatsReleased: number;
  componentsReleased: number;
  waitlistPlaceReleased: boolean;
  /** Registrations on the event's waitlist right now. */
  waitlistedInEvent: number;
  note: string;
};

export type StaffRequestDetail = {
  id: string;
  eventId: string;
  registrationId: string;
  confirmationCode: string;
  registrationStatus: string;
  registrantName: string;
  status: RequestStatus;
  statusLabel: string;
  scope: CancellationScope;
  attendeeNames: string[];
  chargeLabels: string[];
  requestedVia: string;
  contactMethod: string;
  /** The registrant's own words. Staff only. */
  reason: string;
  registrantNote: string | null;
  createdAt: string;
  updatedAt: string;
  calculationId: string;
  policyVersion: number | null;
  /** The proposal the registrant was shown, from the recorded calculation, never recalculated. */
  proposal: RegistrantProposal;
  conflicts: RequestConflict[];
  capacity: CapacityEffects;
  otherOpenRequests: Array<{ id: string; status: RequestStatus; scope: CancellationScope; createdAt: string }>;
  decision: { byName: string; reason: string; at: string; withChanges: boolean } | null;
  timeline: StaffTimelineStep[];
  /** What this person may do next, so the screen offers only valid buttons. */
  actions: Array<"START_REVIEW" | "REQUEST_INFORMATION" | "APPROVE" | "DECLINE">;
};
