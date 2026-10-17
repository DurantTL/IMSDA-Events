/**
 * The names and labels of scheduled email batches (#177). Client-safe (the staff page imports it): never import a module
 * that reaches `node:` here (#550). `scheduled-email-domain.ts` re-exports these.
 */

export const SCHEDULED_EMAIL_TRIGGERS = ["ONE_TIME", "BEFORE_REGISTRATION_CLOSE", "BEFORE_EVENT_START"] as const;
export type ScheduledEmailTrigger = (typeof SCHEDULED_EMAIL_TRIGGERS)[number];

export const SCHEDULED_EMAIL_TRIGGER_LABELS: Record<ScheduledEmailTrigger, string> = {
  ONE_TIME: "On a date and time",
  BEFORE_REGISTRATION_CLOSE: "Days before registration closes",
  BEFORE_EVENT_START: "Days before the event starts",
};

/** What a scheduled batch may send. Each describes the registration as it stands at send time. */
export const SCHEDULED_EMAIL_TEMPLATE_KEYS = ["BALANCE_REMINDER", "EVENT_ANNOUNCEMENT", "CUSTOM_MESSAGE"] as const;
export type ScheduledEmailTemplateKey = (typeof SCHEDULED_EMAIL_TEMPLATE_KEYS)[number];

export const SCHEDULED_EMAIL_TEMPLATE_LABELS: Record<ScheduledEmailTemplateKey, string> = {
  BALANCE_REMINDER: "Balance reminder",
  EVENT_ANNOUNCEMENT: "Event announcement",
  CUSTOM_MESSAGE: "Custom message",
};

export const SCHEDULED_EMAIL_STATUSES = ["SCHEDULED", "ACTIVE", "PAUSED", "CANCELLED", "COMPLETED", "FAILED"] as const;
export type ScheduledEmailStatus = (typeof SCHEDULED_EMAIL_STATUSES)[number];

export const SCHEDULED_EMAIL_STATUS_LABELS: Record<ScheduledEmailStatus, string> = {
  SCHEDULED: "Waiting for approval",
  ACTIVE: "Approved and scheduled",
  PAUSED: "Paused",
  CANCELLED: "Cancelled",
  COMPLETED: "Completed",
  FAILED: "Failed",
};

/**
 * When an approval is refused because the review moved (PREVIEW_CHANGED), the approval panel must show the review that is
 * true now, so the approver sees what changed before approving again. A panel that is not open stays closed.
 */
export function replaceApprovalReview<R, A extends { review: R }>(approval: A | null, moved: R): A | null {
  return approval ? { ...approval, review: moved } : approval;
}
