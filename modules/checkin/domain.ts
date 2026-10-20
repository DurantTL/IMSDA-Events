import { z } from "zod";

export const checkInRequestSchema = z.strictObject({
  idempotencyKey: z.uuid(),
  /** Staff's typed reason for checking in an adult or staff member who isn't current with Sterling Volunteers (#874). */
  sterlingOverrideReason: z.string().trim().min(3).max(300).optional(),
});

export type CheckInRequest = z.infer<typeof checkInRequestSchema>;

export const offlineCheckInErrorCodeSchema = z.enum([
  "NETWORK_UNAVAILABLE",
  "SERVER_UNAVAILABLE",
  "AUTHORIZATION_REQUIRED",
  "ATTENDEE_NOT_FOUND",
  "REGISTRATION_NOT_ELIGIBLE",
  "STERLING_CHECK_NEEDED",
  "IDEMPOTENCY_KEY_REUSED",
  "CHECK_IN_OPERATION_REVERSED",
  "CHECK_IN_OPERATION_CONFLICT",
  "REQUEST_REJECTED",
]);

export type OfflineCheckInErrorCode =
  z.infer<typeof offlineCheckInErrorCodeSchema>;

export const offlineCheckInQueueItemSchema = z.strictObject({
  operation: z.literal("CHECK_IN"),
  attendeeId: z.string().trim().min(1).max(128),
  idempotencyKey: z.uuid(),
  queuedAt: z.iso.datetime({ offset: true }),
  attempts: z.number().int().nonnegative().max(10_000),
  state: z.enum(["QUEUED", "CONFLICT"]),
  lastErrorCode: offlineCheckInErrorCodeSchema,
});

export type OfflineCheckInQueueItem =
  z.infer<typeof offlineCheckInQueueItemSchema>;

/** What check-in shows in place of the Check in button (#874). */
export const STERLING_CHECK_NEEDED_MESSAGE = "Sterling Volunteers check needed before check-in";

export function offlineCheckInStorageKey(eventId: string) {
  return `imsda-events:check-in-queue:v1:${eventId}`;
}

export function inspectOfflineCheckInQueue(value: string | null): {
  items: OfflineCheckInQueueItem[];
  invalidItemCount: number;
} {
  if (!value) return { items: [], invalidItemCount: 0 };
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return { items: [], invalidItemCount: 1 };
    }
    const items: OfflineCheckInQueueItem[] = [];
    let invalidItemCount = 0;
    for (const item of parsed) {
      const result = offlineCheckInQueueItemSchema.safeParse(item);
      if (result.success) {
        items.push(result.data);
      } else {
        invalidItemCount += 1;
      }
    }
    return { items, invalidItemCount };
  } catch {
    return { items: [], invalidItemCount: 1 };
  }
}

export function parseOfflineCheckInQueue(value: string | null) {
  return inspectOfflineCheckInQueue(value).items;
}

export function queueItemForCheckIn(
  attendeeId: string,
  idempotencyKey: string,
  now = new Date(),
): OfflineCheckInQueueItem {
  return offlineCheckInQueueItemSchema.parse({
    operation: "CHECK_IN",
    attendeeId,
    idempotencyKey,
    queuedAt: now.toISOString(),
    attempts: 0,
    state: "QUEUED",
    lastErrorCode: "NETWORK_UNAVAILABLE",
  });
}

export function updateQueuedCheckIn(
  item: OfflineCheckInQueueItem,
  input: {
    state: OfflineCheckInQueueItem["state"];
    lastErrorCode: OfflineCheckInErrorCode;
  },
): OfflineCheckInQueueItem {
  return {
    ...item,
    attempts: item.attempts + 1,
    state: input.state,
    lastErrorCode: input.lastErrorCode,
  };
}

export function checkInQueueItemAfterOfflineRetry(
  item: OfflineCheckInQueueItem,
) {
  return item.state === "CONFLICT"
    ? item
    : updateQueuedCheckIn(item, {
        state: "QUEUED",
        lastErrorCode: "NETWORK_UNAVAILABLE",
      });
}

export function offlineCheckInErrorMessage(code: OfflineCheckInErrorCode) {
  switch (code) {
    case "NETWORK_UNAVAILABLE":
      return "Waiting for a connection. This attendee is not confirmed yet.";
    case "SERVER_UNAVAILABLE":
      return "The server did not answer. Keep this item and retry when the connection is stable.";
    case "AUTHORIZATION_REQUIRED":
      return "Your staff session needs attention. Sign in again, then retry this item.";
    case "ATTENDEE_NOT_FOUND":
      return "This attendee is no longer available in the selected event. Verify the event before retrying or discarding.";
    case "REGISTRATION_NOT_ELIGIBLE":
      return "This registration is cancelled, waitlisted, or otherwise not eligible. Resolve the registration before retrying.";
    case "STERLING_CHECK_NEEDED":
      return `${STERLING_CHECK_NEEDED_MESSAGE}.`;
    case "IDEMPOTENCY_KEY_REUSED":
      return "This saved retry key conflicts with another attendee. Discard it and start a new check-in.";
    case "CHECK_IN_OPERATION_REVERSED":
      return "This exact check-in was later undone. Discard it before starting a new check-in.";
    case "CHECK_IN_OPERATION_CONFLICT":
      return "Another staff action changed this attendee at the same time. Retry to load the final result.";
    case "REQUEST_REJECTED":
      return "The server rejected this saved action. Verify the attendee and retry, or discard it.";
  }
}

/** Letters NFD doesn't split into a base letter and an accent. */
const letterFolds: Record<string, string> = { ł: "l", ø: "o", æ: "ae", œ: "oe", ß: "ss", đ: "d", ð: "d", þ: "th", ı: "i" };

function foldForSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[łøæœßđðþı]/g, (letter) => letterFolds[letter] ?? letter);
}

function searchWords(value: string) {
  // Any letter or digit in any script counts; hyphens and apostrophes split words.
  return foldForSearch(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/**
 * The check-in search (#441): an attendee's first or last name, matched by
 * word prefix ("sam" finds Samantha; "sam riv" finds Samantha Rivera), plus
 * the club name and confirmation code. Email is deliberately left out: when
 * one email registered several people, it would match them all.
 */
export function looksLikeConfirmationCode(query: string) {
  return /[\d-]/.test(query.trim());
}

export function arrivalMatchesSearch(
  arrival: { firstName: string; lastName: string; confirmationCode: string },
  query: string,
  clubName = "",
) {
  const trimmed = query.trim();
  if (!trimmed) return true;
  // The code only matches a query that looks like one (a digit or hyphen), so
  // typing the start of a name ("w", "wr") doesn't list every "WR26-…" arrival.
  if (looksLikeConfirmationCode(trimmed) && arrival.confirmationCode.toLowerCase().includes(trimmed.toLowerCase())) return true;
  const queryWords = searchWords(trimmed);
  if (queryWords.length === 0) return false;
  const nameWords = searchWords(`${arrival.firstName} ${arrival.lastName}`);
  // "obrien" finds O'Brien and "maryjane" finds Mary-Jane.
  const joinedNames = [`${arrival.firstName}`, `${arrival.lastName}`].map((part) => searchWords(part).join(""));
  const clubWords = searchWords(clubName);
  const words = [...nameWords, ...joinedNames, ...clubWords];
  return queryWords.every((word) => words.some((candidate) => candidate.startsWith(word)));
}

/** People the scanner's pick list shows at once; a longer match list asks staff to narrow the search. */
export const scannerLookupListLimit = 8;

export type ScannerLookupPerson = {
  id: string;
  firstName: string;
  lastName: string;
  attendeeType: string;
  checkedIn: boolean;
  confirmationCode: string;
};

export type ScannerLookupMatches = {
  /** Distinct registrations (confirmation codes) any match belongs to. */
  confirmationCodes: string[];
  /** Matching people, in roster order, capped at `scannerLookupListLimit`. */
  people: ScannerLookupPerson[];
  /** True when more people matched than `people` holds. */
  truncated: boolean;
};

/**
 * The scanner's manual lookup (#889) runs the same search as the check-in
 * workspace (`arrivalMatchesSearch`) over the same server-projected arrivals,
 * so it can show staff nothing the desk does not already show them: name,
 * attendee type, checked-in state and confirmation code. A single matching
 * registration opens directly; several are offered as a short list.
 */
export function findScannerLookupMatches(
  arrivals: readonly ScannerLookupPerson[],
  query: string,
  clubNameByCode: Readonly<Record<string, { organizationName: string } | undefined>> = {},
): ScannerLookupMatches {
  if (!query.trim()) return { confirmationCodes: [], people: [], truncated: false };
  // An exact confirmation code opens that registration, even when it is a prefix of another (WL-12 vs WL-123).
  const exact = arrivals.filter((arrival) => arrival.confirmationCode.toLowerCase() === query.trim().toLowerCase());
  const matched = exact.length > 0 ? exact : arrivals.filter((arrival) => arrivalMatchesSearch(
    arrival,
    query,
    clubNameByCode[arrival.confirmationCode]?.organizationName,
  ));
  return {
    confirmationCodes: [...new Set(matched.map((arrival) => arrival.confirmationCode))],
    people: matched.slice(0, scannerLookupListLimit).map((arrival) => ({
      id: arrival.id,
      firstName: arrival.firstName,
      lastName: arrival.lastName,
      attendeeType: arrival.attendeeType,
      checkedIn: arrival.checkedIn,
      confirmationCode: arrival.confirmationCode,
    })),
    truncated: matched.length > scannerLookupListLimit,
  };
}
