/**
 * Bringing a registration's Honors Weekend class picks back (#880). A cancelled or waitlisted registration keeps its
 * pick rows but holds no seats (seats are counted by registration status), so reinstating or promoting it re-occupies
 * every old seat at once. Pure rules for which picks still fit; the transaction that applies them is in restore-seats.ts.
 */

export type DroppedPickReason = "CLASS_FULL" | "CLUB_LIMIT_REACHED";

export type RestorablePick = {
  id: string;
  offeringId: string;
  /** Staff, adults and underage children take no seat, so they always come back. */
  consumesSeat: boolean;
};

export type RestoreOffering = { capacity: number; perClubLimit: number | null };

export type RestoreCounts = {
  /** Seats held by registrations that hold seats now (this registration is not among them yet). */
  taken: ReadonlyMap<string, number>;
  /** Seats held back for live class waitlist offers (#831). */
  reserved: ReadonlyMap<string, number>;
  /** This owner's seats only. */
  clubTaken: ReadonlyMap<string, number>;
  /** This owner's live offers. */
  clubReserved: ReadonlyMap<string, number>;
};

export type RestorePlan = {
  keep: string[];
  dropped: Array<{ pickId: string; offeringId: string; reason: DroppedPickReason }>;
};

/**
 * Which picks fit, in the order given (the earliest pick keeps its seat). A class is full when seats taken, seats held for
 * waitlist offers and the picks already kept here reach its capacity; the owner's limit is checked the same way. A class
 * that is no longer there (not in `offerings`) is left alone: nothing can be checked against it.
 */
export function planRestore(
  picks: readonly RestorablePick[],
  offerings: ReadonlyMap<string, RestoreOffering>,
  counts: RestoreCounts,
): RestorePlan {
  const plan: RestorePlan = { keep: [], dropped: [] };
  const added = new Map<string, number>();
  for (const pick of picks) {
    const offering = offerings.get(pick.offeringId);
    if (!pick.consumesSeat || !offering) {
      plan.keep.push(pick.id);
      continue;
    }
    const mine = added.get(pick.offeringId) ?? 0;
    const used = (counts.taken.get(pick.offeringId) ?? 0) + (counts.reserved.get(pick.offeringId) ?? 0) + mine;
    const clubUsed = (counts.clubTaken.get(pick.offeringId) ?? 0) + (counts.clubReserved.get(pick.offeringId) ?? 0) + mine;
    if (used + 1 > offering.capacity) {
      plan.dropped.push({ pickId: pick.id, offeringId: pick.offeringId, reason: "CLASS_FULL" });
    } else if (offering.perClubLimit !== null && clubUsed + 1 > offering.perClubLimit) {
      plan.dropped.push({ pickId: pick.id, offeringId: pick.offeringId, reason: "CLUB_LIMIT_REACHED" });
    } else {
      added.set(pick.offeringId, mine + 1);
      plan.keep.push(pick.id);
    }
  }
  return plan;
}

/** One pick that was not brought back, in words staff and the director can read. */
export type NotRestoredPick = {
  youthName: string;
  className: string;
  sessionName: string | null;
  reason: DroppedPickReason;
  perClubLimit: number | null;
  ownerKind: "club" | "group";
};

export function notRestoredReasonText(item: Pick<NotRestoredPick, "reason" | "perClubLimit" | "ownerKind">) {
  if (item.reason === "CLASS_FULL") return "the class filled up while the registration was not active";
  return `the class allows ${item.perClubLimit ?? 0} youth per ${item.ownerKind} and that limit was already reached`;
}

function where(item: Pick<NotRestoredPick, "className" | "sessionName">) {
  return item.sessionName ? `${item.className} (${item.sessionName})` : item.className;
}

/** The lines staff see: which pick was not restored and why. */
export function notRestoredReport(items: readonly NotRestoredPick[]) {
  return items.map((item) => `${item.youthName}: ${where(item)} was not restored because ${notRestoredReasonText(item)}.`);
}

/** The outbox template key of the director's notice (it is not an event template). */
export const notRestoredTemplateKey = "HONOR_CLASS_PICKS_NOT_RESTORED";

/** The one email to the director (queued through the outbox, never sent from the request). */
export function notRestoredNotice(input: { directorName: string; eventName: string; items: readonly NotRestoredPick[]; link: string }) {
  const count = input.items.length;
  const subject = `${count === 1 ? "A class pick was" : `${count} class picks were`} not restored for ${input.eventName}`;
  const text = [
    `Hello ${input.directorName || "there"},`,
    "",
    `Your registration for ${input.eventName} is active again. ${count === 1 ? "One Honors Weekend class pick" : `${count} Honors Weekend class picks`} could not come back with it, because the seat was no longer available:`,
    "",
    ...notRestoredReport(input.items).map((line) => `- ${line}`),
    "",
    "Every other pick was kept. You can choose another class for these youth, or join the class waitlist if the class is full, on your club's page:",
    input.link,
    "",
    "IMSDA Events",
  ].join("\n");
  return { subject, text };
}
