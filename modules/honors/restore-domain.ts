/**
 * Bringing a registration's Honors Weekend class picks back (#880). A cancelled or waitlisted registration keeps its
 * pick rows but holds no seats (seats are counted by registration status), so reinstating or promoting it re-occupies
 * every old seat at once. Pure rules for which picks still fit; the transaction that applies them is in restore-seats.ts.
 *
 * Decisions (owner, 2026-10-15): before the class-change deadline a pick that no longer fits is dropped (the director is told,
 * and can pick again or join the waitlist); after class changes have closed for the registration's site nothing is dropped
 * and staff are told which picks are over capacity. A pick that already carries attendance or completion marks is never
 * dropped either, because deleting it would delete those records.
 */

export type DroppedPickReason = "CLASS_FULL" | "CLUB_LIMIT_REACHED";

/** Why a pick that doesn't fit was kept anyway. */
export type KeptBecause = "HAS_MARKS" | "CLASS_CHANGES_CLOSED";

export type RestorablePick = {
  id: string;
  offeringId: string;
  /** Staff, adults and underage children take no seat, so they always come back. */
  consumesSeat: boolean;
  /** The pick has an instructor attendance mark or a written-back completion: it can't be removed without losing them. */
  hasMarks?: boolean;
};

export type RestoreOffering = { capacity: number; perClubLimit: number | null };

export type RestoreCounts = {
  /** Seats held by registrations that hold seats now (this registration is not among them yet). */
  taken: ReadonlyMap<string, number>;
  /** Seats held back for live class waitlist offers (#831), including this registration's own. */
  reserved: ReadonlyMap<string, number>;
  /** This owner's seats only. */
  clubTaken: ReadonlyMap<string, number>;
  /** This owner's live offers. */
  clubReserved: ReadonlyMap<string, number>;
};

export type RestorePlan = {
  keep: string[];
  dropped: Array<{ pickId: string; offeringId: string; reason: DroppedPickReason }>;
  /** Kept although they don't fit: staff follow up. */
  keptOver: Array<{ pickId: string; offeringId: string; reason: DroppedPickReason; because: KeptBecause }>;
};

/**
 * Which picks fit. Picks with marks are placed first, since they can't be removed; then the rest in the order given (the
 * earliest pick keeps its seat). A class is full when seats taken, seats held for waitlist offers and the picks already kept
 * here reach its capacity; the owner's limit is checked the same way. A class that is no longer there (not in `offerings`)
 * is left alone: nothing can be checked against it. With `changesOpen` false nothing is dropped.
 */
export function planRestore(
  picks: readonly RestorablePick[],
  offerings: ReadonlyMap<string, RestoreOffering>,
  counts: RestoreCounts,
  changesOpen = true,
): RestorePlan {
  const plan: RestorePlan = { keep: [], dropped: [], keptOver: [] };
  const added = new Map<string, number>();
  const ordered = [...picks.filter((pick) => pick.hasMarks), ...picks.filter((pick) => !pick.hasMarks)];
  for (const pick of ordered) {
    const offering = offerings.get(pick.offeringId);
    if (!pick.consumesSeat || !offering) {
      plan.keep.push(pick.id);
      continue;
    }
    const mine = added.get(pick.offeringId) ?? 0;
    const used = (counts.taken.get(pick.offeringId) ?? 0) + (counts.reserved.get(pick.offeringId) ?? 0) + mine;
    const clubUsed = (counts.clubTaken.get(pick.offeringId) ?? 0) + (counts.clubReserved.get(pick.offeringId) ?? 0) + mine;
    const reason: DroppedPickReason | null = used + 1 > offering.capacity
      ? "CLASS_FULL"
      : offering.perClubLimit !== null && clubUsed + 1 > offering.perClubLimit ? "CLUB_LIMIT_REACHED" : null;
    // It takes a seat either way when it stays, so later picks are counted against it.
    if (reason === null) {
      added.set(pick.offeringId, mine + 1);
      plan.keep.push(pick.id);
    } else if (pick.hasMarks || !changesOpen) {
      added.set(pick.offeringId, mine + 1);
      plan.keep.push(pick.id);
      plan.keptOver.push({ pickId: pick.id, offeringId: pick.offeringId, reason, because: pick.hasMarks ? "HAS_MARKS" : "CLASS_CHANGES_CLOSED" });
    } else {
      plan.dropped.push({ pickId: pick.id, offeringId: pick.offeringId, reason });
    }
  }
  return plan;
}

/** One pick that was not brought back (or was kept over capacity), in words staff and the director can read. */
export type NotRestoredPick = {
  youthName: string;
  className: string;
  sessionName: string | null;
  reason: DroppedPickReason;
  perClubLimit: number | null;
  ownerKind: "club" | "group";
  /** Absent: the pick was dropped. Present: it was kept over capacity, for this reason. */
  keptBecause?: KeptBecause;
};

export function notRestoredReasonText(item: Pick<NotRestoredPick, "reason" | "perClubLimit" | "ownerKind">) {
  if (item.reason === "CLASS_FULL") return "the class filled up while the registration was not active";
  return `the class allows ${item.perClubLimit ?? 0} youth per ${item.ownerKind} and that limit was already reached`;
}

export function keptBecauseText(because: KeptBecause) {
  return because === "HAS_MARKS"
    ? ": already has attendance or completion marks"
    : " after class changes closed";
}

function where(item: Pick<NotRestoredPick, "className" | "sessionName">) {
  return item.sessionName ? `${item.className} (${item.sessionName})` : item.className;
}

/** The lines staff see: which pick was not restored and why, and which were kept over capacity. */
export function notRestoredReport(items: readonly NotRestoredPick[]) {
  return items.map((item) => item.keptBecause
    ? `${item.youthName}: ${where(item)} kept over capacity${keptBecauseText(item.keptBecause)} (${notRestoredReasonText(item)}).`
    : `${item.youthName}: ${where(item)} was not restored because ${notRestoredReasonText(item)}.`);
}

/** The outbox template key of the director's notice (it is not an event template). */
export const notRestoredTemplateKey = "HONOR_CLASS_PICKS_NOT_RESTORED";

/**
 * The one email to the director (queued through the outbox, never sent from the request). It promises no more than is
 * available: choosing another class only while class changes are open, joining the waitlist only for a club (a group has
 * none), and for picks kept over capacity only that staff will follow up.
 */
export function notRestoredNotice(input: {
  directorName: string;
  eventName: string;
  items: readonly NotRestoredPick[];
  link: string;
  /** Whether class changes are still open for the registration's site. */
  changesOpen: boolean;
  ownerKind: "club" | "group";
}) {
  const dropped = input.items.filter((item) => !item.keptBecause);
  const kept = input.items.filter((item) => item.keptBecause);
  const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);
  const lines: string[] = [`Hello ${input.directorName || "there"},`, "", `Your registration for ${input.eventName} is active again.`];
  if (dropped.length > 0) {
    lines.push(
      "",
      `${dropped.length === 1 ? "One Honors Weekend class pick" : `${dropped.length} Honors Weekend class picks`} could not come back with it, because the seat was no longer available:`,
      "",
      ...notRestoredReport(dropped).map((line) => `- ${line}`),
    );
  }
  if (kept.length > 0) {
    lines.push(
      "",
      `${kept.length === 1 ? "One Honors Weekend class pick is" : `${kept.length} Honors Weekend class picks are`} kept, although ${plural(kept.length, "its class is", "their classes are")} over ${plural(kept.length, "its limit", "their limits")}. Staff will follow up with you:`,
      "",
      ...kept.map((item) => `- ${item.youthName}: ${where(item)}`),
    );
  }
  if (dropped.length > 0) {
    lines.push("");
    if (input.changesOpen) {
      lines.push(
        input.ownerKind === "club"
          ? "Every other pick was kept. You can choose another class for these youth, or join the class waitlist if the class is full, on your club's page:"
          : "Every other pick was kept. You can choose another class for these youth on your registration page:",
        input.link,
      );
    } else {
      lines.push("Class changes have closed, so please contact the event office about these picks.");
    }
  }
  lines.push("", "IMSDA Events");
  const total = input.items.length;
  const subject = dropped.length > 0
    ? `${dropped.length === 1 ? "A class pick was" : `${dropped.length} class picks were`} not restored for ${input.eventName}`
    : `${total === 1 ? "A class pick needs" : `${total} class picks need`} follow-up for ${input.eventName}`;
  return { subject, text: lines.join("\n") };
}
