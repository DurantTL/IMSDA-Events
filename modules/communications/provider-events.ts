import type {
  MessageOutboxStatus,
  MessageProviderDeliveryStatus,
  Prisma,
} from "@prisma/client";

export type ProviderDeliveryTransition = {
  status: MessageProviderDeliveryStatus;
  outboxStatus: MessageOutboxStatus;
  occurredAt: Date;
  lastError: string | null;
};

const resendStatusByEvent = {
  "email.sent": "SENT",
  "email.delivered": "DELIVERED",
  "email.bounced": "BOUNCED",
  "email.failed": "FAILED",
  "email.complained": "COMPLAINED",
  "email.suppressed": "SUPPRESSED",
} as const satisfies Record<string, MessageProviderDeliveryStatus>;

export function mapResendDeliveryEvent(
  eventType: string,
  occurredAt: Date,
): ProviderDeliveryTransition | null {
  const status = resendStatusByEvent[eventType as keyof typeof resendStatusByEvent];
  if (!status) return null;

  if (status === "BOUNCED") {
    return {
      status,
      outboxStatus: "FAILED",
      occurredAt,
      lastError: "Resend reported a permanent bounce for this recipient.",
    };
  }
  if (status === "FAILED") {
    return {
      status,
      outboxStatus: "FAILED",
      occurredAt,
      lastError: "Resend reported that this email could not be sent.",
    };
  }
  if (status === "COMPLAINED") {
    return {
      status,
      outboxStatus: "SENT",
      occurredAt,
      lastError: "The recipient reported this message as spam.",
    };
  }
  if (status === "SUPPRESSED") {
    return {
      status,
      outboxStatus: "SUPPRESSED",
      occurredAt,
      lastError: "Resend suppressed delivery to this recipient.",
    };
  }
  return {
    status,
    outboxStatus: "SENT",
    occurredAt,
    lastError: null,
  };
}

export function providerTransitionUpdate(
  transition: ProviderDeliveryTransition,
): Prisma.MessageOutboxUpdateManyMutationInput {
  const common: Prisma.MessageOutboxUpdateManyMutationInput = {
    providerDeliveryStatus: transition.status,
    providerStatusAt: transition.occurredAt,
    status: transition.outboxStatus,
    lastError: transition.lastError,
  };
  if (transition.status === "SENT") {
    return { ...common, sentAt: transition.occurredAt };
  }
  if (transition.status === "DELIVERED") {
    return { ...common, deliveredAt: transition.occurredAt };
  }
  if (
    transition.status === "BOUNCED"
    || transition.status === "FAILED"
    || transition.status === "SUPPRESSED"
  ) {
    return { ...common, failedAt: transition.occurredAt };
  }
  return common;
}

// --- Amazon SES (#863) -----------------------------------------------------------------------------------------------

const sesStatusByEvent = {
  "ses.delivery": "DELIVERED",
  "ses.bounce.permanent": "BOUNCED",
  "ses.complaint": "COMPLAINED",
} as const satisfies Record<string, MessageProviderDeliveryStatus>;

/**
 * Maps a stored SES event type onto the shared delivery status. A transient or undetermined (soft) bounce maps to nothing:
 * it is recorded as an event and changes neither the message nor the address.
 */
export function mapSesDeliveryEvent(
  eventType: string,
  occurredAt: Date,
): ProviderDeliveryTransition | null {
  const status = sesStatusByEvent[eventType as keyof typeof sesStatusByEvent];
  if (!status) return null;
  if (status === "BOUNCED") {
    return {
      status,
      outboxStatus: "FAILED",
      occurredAt,
      lastError: "Amazon SES reported a permanent bounce for this recipient.",
    };
  }
  if (status === "COMPLAINED") {
    return {
      status,
      outboxStatus: "SENT",
      occurredAt,
      lastError: "The recipient reported this message as spam.",
    };
  }
  return { status, outboxStatus: "SENT", occurredAt, lastError: null };
}

/** The mapping for a stored event of any provider, so linking a held event later uses the provider's own vocabulary. */
export function mapProviderDeliveryEvent(
  provider: string,
  eventType: string,
  occurredAt: Date,
): ProviderDeliveryTransition | null {
  return provider === "SES"
    ? mapSesDeliveryEvent(eventType, occurredAt)
    : mapResendDeliveryEvent(eventType, occurredAt);
}

/** How far a message has got. A terminal outcome (bounce, failure, complaint, suppression) outranks everything. */
export function providerStatusRank(status: MessageProviderDeliveryStatus | null): number {
  switch (status) {
    case null: return -1;
    case "ACCEPTED": return 0;
    case "SENT": return 1;
    case "DELIVERED": return 2;
    default: return 3;
  }
}

export function isTerminalProviderStatus(status: MessageProviderDeliveryStatus | null): boolean {
  return providerStatusRank(status) >= 3;
}

/**
 * Whether an event may move a message from `current` to `next`. It only ever moves forward: a terminal state is final
 * (a duplicate or late delivery report never turns a bounce back into DELIVERED, and a second terminal event does not
 * replace the first), and a later report of the same stage replaces nothing. A complaint or bounce after DELIVERED does
 * apply (SES can report them after delivery).
 */
export function mayAdvanceProviderStatus(
  current: MessageProviderDeliveryStatus | null,
  next: MessageProviderDeliveryStatus,
): boolean {
  if (isTerminalProviderStatus(current)) return false;
  return providerStatusRank(next) > providerStatusRank(current);
}

/** The same rule as a database condition, so the check and the write are one statement and a race cannot undo it. */
export function providerAdvanceCondition(
  next: MessageProviderDeliveryStatus,
): Prisma.MessageOutboxWhereInput {
  const statuses = (["ACCEPTED", "SENT", "DELIVERED", "BOUNCED", "FAILED", "COMPLAINED", "SUPPRESSED"] as const)
    .filter((status) => mayAdvanceProviderStatus(status, next));
  return { OR: [{ providerDeliveryStatus: null }, { providerDeliveryStatus: { in: [...statuses] } }] };
}

/** Of several stored events for one message, the one that decides its state: the furthest stage, then the latest. */
export function strongestTransition(
  transitions: ProviderDeliveryTransition[],
): ProviderDeliveryTransition | null {
  let best: ProviderDeliveryTransition | null = null;
  for (const transition of transitions) {
    if (
      !best
      || providerStatusRank(transition.status) > providerStatusRank(best.status)
      || (providerStatusRank(transition.status) === providerStatusRank(best.status) && transition.occurredAt > best.occurredAt)
    ) {
      best = transition;
    }
  }
  return best;
}
