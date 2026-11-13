import type { EventPermission } from "@/modules/access/permissions";

/**
 * Communication timeline policy (#179): which parts of a recorded message a viewer may be shown. Pure, so the same
 * decision is made (and tested) before anything is serialized. The loaders call it on the server; the client only
 * receives what it allows.
 */

/** `HEALTH`: the message is about a health record, so its text is shown only to people who may read health information. */
export type MessageContentClass = "HEALTH" | "ORDINARY";

/** Template keys whose messages are about health records. Add a key here when a new health message is introduced. */
const healthTemplateKeys: ReadonlySet<string> = new Set(["HEALTH_RECORD_LINK"]);

export function messageContentClass(templateKey: string): MessageContentClass {
  return healthTemplateKeys.has(templateKey) ? "HEALTH" : "ORDINARY";
}

export type ContentVisibility = {
  contentClass: MessageContentClass;
  showSubject: boolean;
  showBody: boolean;
};

/** What the viewer may see of one message's subject and body, given the permissions they hold for the event. */
export function contentVisibility(templateKey: string, permissions: readonly EventPermission[]): ContentVisibility {
  const contentClass = messageContentClass(templateKey);
  if (contentClass === "HEALTH" && !permissions.includes("VIEW_HEALTH_INFORMATION")) {
    return { contentClass, showSubject: false, showBody: false };
  }
  return { contentClass, showSubject: true, showBody: true };
}

/** The subject shown in place of a withheld one. */
export const WITHHELD_SUBJECT = "Health record message";

export type TimelineRecipientRole = "Registrant" | "Staff notice" | "Billing contact" | "Club director";

/** Recipient kinds that never appear on a timeline: test sends and account email belong to no registration's history. */
export const TIMELINE_EXCLUDED_RECIPIENT_KINDS = ["TEST", "ACCOUNT"] as const;

export function recipientRoleLabel(kind: string): TimelineRecipientRole {
  switch (kind) {
    case "INTERNAL": return "Staff notice";
    case "BILLING_CONTACT": return "Billing contact";
    case "CLUB_DIRECTOR": return "Club director";
    default: return "Registrant";
  }
}

/** A readable message type: "REGISTRATION_CONFIRMATION_PAID" becomes "Registration Confirmation Paid". */
export function messageTypeLabel(templateKey: string): string {
  return templateKey.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export const NO_TEMPLATE_VERSION_LABEL = "Written for this send";

export const REGISTRATION_TIMELINE_LIMIT = 50;
export const PERSON_COMMUNICATIONS_LIMIT = 100;

/** Newest first, with the id as the tie-break so the order is stable. */
export function newestFirst<T extends { createdAt: Date | string; id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const left = new Date(a.createdAt).valueOf();
    const right = new Date(b.createdAt).valueOf();
    if (left !== right) return right - left;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}

export type DeliveryTone = "green" | "coral" | "purple" | "gold";

export type DeliverySource = {
  status: string;
  providerDeliveryStatus: string | null;
  createdAt: string;
  capturedAt: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
};

/** The delivery label, tone and the date it refers to, as the registration page has always shown them. */
export function messageDeliverySummary(record: DeliverySource): { label: string; tone: DeliveryTone; date: string | null } {
  if (record.providerDeliveryStatus === "DELIVERED") {
    return { label: "Delivered", tone: "green", date: record.deliveredAt };
  }
  if (
    record.providerDeliveryStatus === "BOUNCED"
    || record.providerDeliveryStatus === "FAILED"
    || record.providerDeliveryStatus === "COMPLAINED"
    || record.providerDeliveryStatus === "SUPPRESSED"
    || record.status === "FAILED"
    || record.status === "SUPPRESSED"
    || record.status === "CANCELLED"
  ) {
    return {
      label: messageTypeLabel(record.providerDeliveryStatus ?? record.status),
      tone: "coral",
      date: record.failedAt ?? record.createdAt,
    };
  }
  if (record.status === "SENT") return { label: "Sent", tone: "green", date: record.sentAt };
  if (record.status === "CAPTURED") return { label: "Captured locally", tone: "purple", date: record.capturedAt };
  return { label: record.status === "PROCESSING" ? "Processing" : "Queued", tone: "gold", date: record.createdAt };
}
