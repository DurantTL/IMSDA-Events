import { createHash } from "node:crypto";
import { z } from "zod";
import {
  AUDIENCE_QUERY_VERSION,
  AUDIENCE_ROLE_LABELS,
  AUDIENCE_ROLE_PRIORITY,
  type AudienceDimension,
  type AudienceRole,
  type NormalizedAudienceQuery,
} from "@/modules/communications/audience-query";
import type { OperationsSearchQuery, SearchCatalog } from "@/modules/registrations/operations-search-domain";

/**
 * Evaluates an audience query over already-loaded registration rows. Pure: no database, no clock, no randomness, so
 * the same rows and query always give the same audience, in the same order, with the same fingerprint.
 *
 * Which registrations qualify was decided before a row is loaded, by the operations search (#180): every row given
 * here already matched the query's `search`. What happens here is per message: which people on a matched registration
 * are written to (roles), the one readiness narrowing, de-duplication and the reasons.
 *
 * The row type is an allow-list. It carries the few normalized facts those steps need (a status, a balance, whether
 * responses exist, tag identifiers) and nothing protected: no profile snapshot, no form answers, no health, screening or
 * consent data, no note text. Nobody can be qualified by what is not in these rows, so protected data cannot qualify
 * anyone however a query is written.
 */

export const AUDIENCE_FINGERPRINT_VERSION = 1;

export type AudienceAttendeeRow = {
  attendeeId: string;
  /** The event's attendee-type code, the identifier the operations search filters on. */
  attendeeType: string;
  name: string;
  email: string | null;
  /** Whether any form response exists. The responses themselves never leave the loader. */
  hasResponses: boolean;
  tagIds: readonly string[];
};

/**
 * How an attendee type's configured age range classifies its attendees. Decided from the type only (ADR 0005 Addendum A:
 * never from a birth date). Fail closed: only a type whose minimum age is 18 or more is ADULT. A maximum age under 18 is
 * MINOR (checked first, so a contradictory range is never ADULT); everything else is UNKNOWN: no age range, an open-ended
 * range such as 10 and over, or no type definition at all.
 */
export type AttendeeAgeClass = "ADULT" | "MINOR" | "UNKNOWN";

export function classifyAttendeeType(type: { minimumAge: number | null; maximumAge: number | null }): AttendeeAgeClass {
  if (type.maximumAge !== null && type.maximumAge < 18) return "MINOR";
  if (type.minimumAge !== null && type.minimumAge >= 18) return "ADULT";
  return "UNKNOWN";
}

export type AudienceContactRow = { name: string; email: string | null };

export type AudienceRegistrationRow = {
  registrationId: string;
  confirmationCode: string;
  status: string;
  totalCents: number;
  netPaidCents: number;
  contact: AudienceContactRow;
  hasPublicSubmission: boolean;
  tagIds: readonly string[];
  attendees: readonly AudienceAttendeeRow[];
  groupLeader: AudienceContactRow | null;
  organizationContact: AudienceContactRow | null;
};

export type AudienceEvaluationContext = {
  /** The event bills the responsible organization, so an attendee never owes an online balance. */
  isOrganizationBilled: boolean;
  tagNames: ReadonlyMap<string, string>;
  attendeeTypeLabels: ReadonlyMap<string, string>;
  /**
   * Age class of each of the event's attendee types, by code. An attendee is written to only when their type is ADULT
   * (minimum age 18 or more). A MINOR one, an UNKNOWN one, and one with no type definition are all excluded as
   * MINOR_ATTENDEE; there is no event-level exception.
   */
  attendeeAge: ReadonlyMap<string, AttendeeAgeClass>;
  /**
   * What the search selected on, as the operations search read it. Only used to decide which ATTENDEES of a matched
   * registration are written to: an attendee qualifies on their own type, and on a tag of theirs or of the registration.
   */
  selection: { attendeeTypes: readonly string[]; tagIds: readonly string[] };
  /** The rule each search filter stands for, in words, the same for every matched registration. */
  searchReasons: readonly AudienceReason[];
};

export type AudienceReason = { dimension: AudienceDimension; value: string; label: string };

export type AudienceCandidate = {
  role: AudienceRole;
  name: string;
  email: string | null;
  registrationId: string;
  confirmationCode: string;
  balanceCents: number;
  reasons: AudienceReason[];
  /** Set when this contact may not be written to; the contact is then an exclusion that carries no address. */
  blocked?: "MINOR_ATTENDEE";
  /** Why: under 18, or an age group that is not known. Only used to word the exclusion. */
  blockedAge?: "MINOR" | "UNKNOWN";
  /** For an UNKNOWN age: no attendee type at all, or a type whose age range does not show an adult. */
  blockedCause?: "NO_TYPE" | "NO_RANGE";
};

const emailSchema = z.email();

export function normalizeAudienceEmail(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

export function audienceBalanceCents(row: Pick<AudienceRegistrationRow, "totalCents" | "netPaidCents">, isOrganizationBilled: boolean) {
  return isOrganizationBilled ? 0 : Math.max(row.totalCents - row.netPaidCents, 0);
}

function readinessIncomplete(row: AudienceRegistrationRow) {
  return row.hasPublicSubmission && row.attendees.some((attendee) => !attendee.hasResponses);
}

function words(value: string) {
  return value.toLowerCase().replace(/_/g, " ");
}

/**
 * The rule each search filter stands for, in words, for the reasons on every recipient. Labels come from the viewer's
 * own catalog, so a name the viewer may not see (a tag, an organization) is never written into a reason. Status,
 * attendee type and tag reasons are made per registration from the row, so they are left out here.
 */
export function buildSearchReasons(search: OperationsSearchQuery, catalog: SearchCatalog): AudienceReason[] {
  const reasons: AudienceReason[] = [];
  const add = (dimension: AudienceDimension, values: readonly string[], label: string) => {
    reasons.push({ dimension, value: values.join(","), label });
  };
  const named = (values: readonly string[], names: ReadonlyArray<{ id: string; name: string }>) => (
    values.map((value) => names.find((candidate) => candidate.id === value)?.name ?? value).join(" or ")
  );
  if (search.text) add("q", ["text"], "Matched the search text");
  if (search.source.length) add("source", search.source, `Source ${search.source.map(words).join(" or ")}`);
  if (search.organization.length) add("organization", search.organization, `Organization ${named(search.organization, catalog.organizations)}`);
  if (search.location.length) add("location", search.location, `Location ${named(search.location, catalog.locations)}`);
  if (search.waitlist.length) add("waitlist", search.waitlist, `Waitlist ${search.waitlist.map(words).join(" or ")}`);
  if (search.payment.length) add("payment", search.payment, `Payment ${search.payment.map(words).join(" or ")}`);
  if (search.checkIn) add("checkIn", [search.checkIn], `Check-in ${{ ANY: "some checked in", ALL: "everyone checked in", NONE: "no one checked in" }[search.checkIn]}`);
  for (const answer of search.answers) {
    const question = catalog.questions.find((candidate) => candidate.id === answer.question);
    const choices = answer.values.map((value) => question?.choices.find((choice) => choice.value === value)?.label ?? value);
    reasons.push({
      dimension: "answer",
      value: `${answer.question}=${answer.values.join(",")}`,
      label: `Answered "${question?.label ?? answer.question}": ${choices.join(" or ")}`,
    });
  }
  return reasons;
}

/**
 * Applies the readiness narrowing and returns the candidates (one per selected role that has a contact) with the reason
 * each qualified. The row already matched the operations search; the reasons say which of its rules it matched.
 */
export function evaluateAudienceRegistration(
  row: AudienceRegistrationRow,
  query: NormalizedAudienceQuery,
  context: AudienceEvaluationContext,
): AudienceCandidate[] {
  const reasons: AudienceReason[] = [
    { dimension: "status", value: row.status, label: `Registration ${row.status.toLowerCase()}` },
    ...context.searchReasons.filter((reason) => reason.dimension !== "status"),
  ];

  if (query.readinessStates.length > 0) {
    if (!query.readinessStates.includes("ATTENDEE_RESPONSES_INCOMPLETE") || !readinessIncomplete(row)) return [];
    reasons.push({ dimension: "readiness", value: "ATTENDEE_RESPONSES_INCOMPLETE", label: "Attendee responses incomplete" });
  }

  const { attendeeTypes, tagIds } = context.selection;
  if (attendeeTypes.length > 0) {
    // The search kept the registration because an attendee has one of the types; say which, from the row itself.
    for (const type of new Set(row.attendees.map((attendee) => attendee.attendeeType))) {
      if (attendeeTypes.includes(type)) {
        reasons.push({ dimension: "attendeeType", value: type, label: `Attendee type ${context.attendeeTypeLabels.get(type) ?? type}` });
      }
    }
  }
  if (tagIds.length > 0) {
    const tagged = new Set<string>();
    for (const tagId of row.tagIds) if (tagIds.includes(tagId)) tagged.add(tagId);
    for (const attendee of row.attendees) {
      for (const tagId of attendee.tagIds) if (tagIds.includes(tagId)) tagged.add(tagId);
    }
    for (const tagId of tagged) {
      reasons.push({ dimension: "tag", value: tagId, label: `Tag ${context.tagNames.get(tagId) ?? "(removed tag)"}` });
    }
  }

  const balanceCents = audienceBalanceCents(row, context.isOrganizationBilled);
  const candidates: AudienceCandidate[] = [];
  const push = (role: AudienceRole, contact: AudienceContactRow, blockedAge?: "MINOR" | "UNKNOWN", blockedCause?: "NO_TYPE" | "NO_RANGE") => {
    candidates.push({
      ...(blockedAge ? { blocked: "MINOR_ATTENDEE" as const, blockedAge, ...(blockedCause ? { blockedCause } : {}) } : {}),
      role,
      name: contact.name.trim() || "Recipient",
      email: contact.email,
      registrationId: row.registrationId,
      confirmationCode: row.confirmationCode,
      balanceCents,
      reasons: sortReasons(reasons),
    });
  };

  for (const role of query.roles) {
    if (role === "REGISTRATION_CONTACT") push(role, row.contact);
    else if (role === "GROUP_LEADER" && row.groupLeader) push(role, row.groupLeader);
    else if (role === "ORGANIZATION_CONTACT" && row.organizationContact) push(role, row.organizationContact);
    else if (role === "ATTENDEE") {
      for (const attendee of row.attendees) {
        if (attendeeTypes.length > 0 && !attendeeTypes.includes(attendee.attendeeType)) continue;
        if (tagIds.length > 0) {
          const hit = row.tagIds.some((id) => tagIds.includes(id)) || attendee.tagIds.some((id) => tagIds.includes(id));
          if (!hit) continue;
        }
        const age = context.attendeeAge.get(attendee.attendeeType) ?? "UNKNOWN";
        if (age === "ADULT") push(role, { name: attendee.name, email: attendee.email });
        else push(role, { name: "", email: null }, age, age === "UNKNOWN" ? (attendee.attendeeType ? "NO_RANGE" : "NO_TYPE") : undefined);
      }
    }
  }
  return candidates;
}

function sortReasons(reasons: readonly AudienceReason[]) {
  const seen = new Set<string>();
  const unique: AudienceReason[] = [];
  for (const reason of reasons) {
    const key = `${reason.dimension}:${reason.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(reason);
  }
  return unique.sort((a, b) => (a.dimension + ":" + a.value).localeCompare(b.dimension + ":" + b.value));
}

export type AudienceSuppressionCode =
  | "OPTED_OUT_EVENT"
  | "OPTED_OUT_ALL"
  | "PROVIDER_BOUNCED"
  | "PROVIDER_COMPLAINED";

export type AudienceExclusionCode = "NO_EMAIL" | "INVALID_EMAIL" | "MINOR_ATTENDEE" | AudienceSuppressionCode;

const MINOR_EXCLUSION_LABELS = {
  MINOR: "Attendee is under 18, so they are not messaged directly",
  UNKNOWN: "Attendee's age group is unknown, so they are not messaged directly",
} as const;

export const AUDIENCE_EXCLUSION_LABELS: Record<AudienceExclusionCode, string> = {
  NO_EMAIL: "No email address on file",
  INVALID_EMAIL: "Email address is not valid",
  MINOR_ATTENDEE: "Attendee is under 18 or their age group is unknown, so they are not messaged directly",
  OPTED_OUT_EVENT: "Opted out of this event's announcements",
  OPTED_OUT_ALL: "Opted out of all announcements",
  PROVIDER_BOUNCED: "The last email to this address bounced",
  PROVIDER_COMPLAINED: "The last email to this address was marked as spam",
};

export type AudienceRegistrationEntry = {
  registrationId: string;
  confirmationCode: string;
  roles: AudienceRole[];
  /** This registration's own balance: never merged with another registration that shares the address. */
  balanceCents: number;
  reasons: AudienceReason[];
};

export type AudienceRecipient = {
  email: string;
  displayName: string;
  /** Every role this address holds across the audience, sorted. */
  roles: AudienceRole[];
  /** One entry per registration, so each message keeps its own balance and private link. */
  registrations: AudienceRegistrationEntry[];
  /** Every rule that qualified the address, across its registrations. */
  reasons: AudienceReason[];
};

export type AudienceExclusion = {
  key: string;
  code: AudienceExclusionCode;
  label: string;
  /** Null when the contact has no usable address. */
  email: string | null;
  roles: AudienceRole[];
  registrations: Array<{ registrationId: string; confirmationCode: string }>;
  /** How many contacts this row stands for: several attendees of one registration can all lack an address. */
  contactCount: number;
  reasons: AudienceReason[];
  /** For a MINOR_ATTENDEE exclusion: a known minor, or an unknown age (and why). Absent on every other exclusion. */
  blockedAge?: "MINOR" | "UNKNOWN";
  /** For an UNKNOWN age: how many of `contactCount` have no attendee type at all, and how many have a type with no adult age range. */
  unknownCauses?: { noType: number; noRange: number };
};

export type AudienceCounts = {
  consideredRegistrationCount: number;
  matchedRegistrationCount: number;
  recipientCount: number;
  exclusionCount: number;
  /** Distinct registrations behind at least one recipient. */
  recipientRegistrationCount: number;
  /** One message target per (address, registration): the number of distinct financial contexts to message. */
  messageTargetCount: number;
  /** Qualifying contacts folded into an address already counted (same email, another role or registration). */
  duplicateMergedCount: number;
  totalBalanceCents: number;
  byRole: Record<AudienceRole, number>;
  exclusionsByCode: Partial<Record<AudienceExclusionCode, number>>;
};

export type AudienceResult = {
  sourceQueryVersion: string;
  fingerprint: string;
  counts: AudienceCounts;
  recipients: AudienceRecipient[];
  exclusions: AudienceExclusion[];
};

type RecipientDraft = {
  email: string;
  names: Array<{ priority: number; confirmationCode: string; name: string }>;
  entries: Map<string, {
    registrationId: string;
    confirmationCode: string;
    roles: Set<AudienceRole>;
    balanceCents: number;
    reasons: AudienceReason[];
  }>;
};

/**
 * Folds candidates into one recipient per normalized email, in any arrival order, with the same result. Registrations
 * stay separate inside a recipient: de-duplicating the address must never merge two registrations' balances or links.
 */
export class AudienceAccumulator {
  private readonly drafts = new Map<string, RecipientDraft>();
  private readonly contactExclusions = new Map<string, AudienceExclusion>();
  private readonly matched = new Set<string>();
  private considered = 0;
  private reachableCandidates = 0;

  constructor(
    private readonly query: NormalizedAudienceQuery,
    private readonly context: AudienceEvaluationContext,
    private readonly eventId: string,
  ) {}

  consider(row: AudienceRegistrationRow) {
    this.considered += 1;
    const candidates = evaluateAudienceRegistration(row, this.query, this.context);
    if (candidates.length > 0) this.matched.add(row.registrationId);
    for (const candidate of candidates) this.add(candidate);
  }

  /** Every address that will be in the audience, for one suppression lookup. */
  emails() {
    return [...this.drafts.keys()].sort();
  }

  private add(candidate: AudienceCandidate) {
    const email = candidate.blocked ? "" : normalizeAudienceEmail(candidate.email);
    if (candidate.blocked || !email || !emailSchema.safeParse(email).success) {
      const code: AudienceExclusionCode = candidate.blocked ?? (email ? "INVALID_EMAIL" : "NO_EMAIL");
      const key = [code, candidate.blockedAge ?? "", candidate.confirmationCode, candidate.role].join("\u0000");
      const existing = this.contactExclusions.get(key);
      if (existing) {
        existing.contactCount += 1;
        if (existing.unknownCauses && candidate.blockedCause) existing.unknownCauses[candidate.blockedCause === "NO_TYPE" ? "noType" : "noRange"] += 1;
        return;
      }
      this.contactExclusions.set(key, {
        key,
        code,
        label: candidate.blockedAge ? MINOR_EXCLUSION_LABELS[candidate.blockedAge] : AUDIENCE_EXCLUSION_LABELS[code],
        email: null,
        roles: [candidate.role],
        registrations: [{ registrationId: candidate.registrationId, confirmationCode: candidate.confirmationCode }],
        contactCount: 1,
        reasons: candidate.reasons,
        ...(candidate.blockedAge ? { blockedAge: candidate.blockedAge } : {}),
        ...(candidate.blockedCause ? { unknownCauses: { noType: candidate.blockedCause === "NO_TYPE" ? 1 : 0, noRange: candidate.blockedCause === "NO_RANGE" ? 1 : 0 } } : {}),
      });
      return;
    }
    this.reachableCandidates += 1;
    let draft = this.drafts.get(email);
    if (!draft) {
      draft = { email, names: [], entries: new Map() };
      this.drafts.set(email, draft);
    }
    draft.names.push({
      priority: AUDIENCE_ROLE_PRIORITY[candidate.role],
      confirmationCode: candidate.confirmationCode,
      name: candidate.name,
    });
    const entry = draft.entries.get(candidate.registrationId);
    if (entry) {
      entry.roles.add(candidate.role);
      entry.reasons = mergeReasons(entry.reasons, candidate.reasons);
    } else {
      draft.entries.set(candidate.registrationId, {
        registrationId: candidate.registrationId,
        confirmationCode: candidate.confirmationCode,
        roles: new Set([candidate.role]),
        balanceCents: candidate.balanceCents,
        reasons: candidate.reasons,
      });
    }
  }

  finalize(suppressions: ReadonlyMap<string, AudienceSuppressionCode> = new Map()): AudienceResult {
    const recipients: AudienceRecipient[] = [];
    const exclusions: AudienceExclusion[] = [...this.contactExclusions.values()];
    let reachableAfterSuppression = 0;
    const roleSets = new Map<AudienceRole, Set<string>>();

    for (const email of [...this.drafts.keys()].sort()) {
      const draft = this.drafts.get(email)!;
      const registrations: AudienceRegistrationEntry[] = [...draft.entries.values()]
        .map((entry) => ({
          registrationId: entry.registrationId,
          confirmationCode: entry.confirmationCode,
          roles: [...entry.roles].sort(),
          balanceCents: entry.balanceCents,
          reasons: sortReasons([
            ...entry.reasons,
            ...[...entry.roles].map((role): AudienceReason => ({ dimension: "roles", value: role, label: AUDIENCE_ROLE_LABELS[role] })),
          ]),
        }))
        .sort((a, b) => a.confirmationCode.localeCompare(b.confirmationCode) || a.registrationId.localeCompare(b.registrationId));
      const roles = [...new Set(registrations.flatMap((entry) => entry.roles))].sort() as AudienceRole[];
      const reasons = sortReasons(registrations.flatMap((entry) => entry.reasons));
      const suppression = suppressions.get(email);
      if (suppression) {
        exclusions.push({
          key: [suppression, email, registrations[0]!.confirmationCode, roles[0]!].join("\u0000"),
          code: suppression,
          label: AUDIENCE_EXCLUSION_LABELS[suppression],
          email,
          roles,
          registrations: registrations.map(({ registrationId, confirmationCode }) => ({ registrationId, confirmationCode })),
          contactCount: 1,
          reasons,
        });
        continue;
      }
      const name = [...draft.names].sort((a, b) => (
        a.priority - b.priority || a.confirmationCode.localeCompare(b.confirmationCode) || a.name.localeCompare(b.name)
      ))[0]!.name;
      reachableAfterSuppression += draft.names.length;
      for (const entry of registrations) {
        for (const role of entry.roles) {
          if (!roleSets.has(role)) roleSets.set(role, new Set());
          roleSets.get(role)!.add(email);
        }
      }
      recipients.push({ email, displayName: name, roles, registrations, reasons });
    }

    // Code-unit order, the same order the cursor comparison uses, so paging never skips or repeats a row.
    exclusions.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

    const recipientRegistrationIds = new Set<string>();
    let messageTargetCount = 0;
    const balanceByRegistration = new Map<string, number>();
    for (const recipient of recipients) {
      for (const entry of recipient.registrations) {
        recipientRegistrationIds.add(entry.registrationId);
        balanceByRegistration.set(entry.registrationId, entry.balanceCents);
        messageTargetCount += 1;
      }
    }
    const exclusionsByCode: Partial<Record<AudienceExclusionCode, number>> = {};
    for (const exclusion of exclusions) exclusionsByCode[exclusion.code] = (exclusionsByCode[exclusion.code] ?? 0) + 1;

    const counts: AudienceCounts = {
      consideredRegistrationCount: this.considered,
      matchedRegistrationCount: this.matched.size,
      recipientCount: recipients.length,
      exclusionCount: exclusions.length,
      recipientRegistrationCount: recipientRegistrationIds.size,
      messageTargetCount,
      duplicateMergedCount: Math.max(reachableAfterSuppression - recipients.length, 0),
      // Each registration's balance once, however many addresses or roles reach it.
      totalBalanceCents: [...balanceByRegistration.values()].reduce((sum, cents) => sum + cents, 0),
      byRole: {
        REGISTRATION_CONTACT: roleSets.get("REGISTRATION_CONTACT")?.size ?? 0,
        ATTENDEE: roleSets.get("ATTENDEE")?.size ?? 0,
        GROUP_LEADER: roleSets.get("GROUP_LEADER")?.size ?? 0,
        ORGANIZATION_CONTACT: roleSets.get("ORGANIZATION_CONTACT")?.size ?? 0,
      },
      exclusionsByCode,
    };

    return {
      sourceQueryVersion: AUDIENCE_QUERY_VERSION,
      fingerprint: audienceFingerprint(this.eventId, this.query, recipients, exclusions),
      counts,
      recipients,
      exclusions,
    };
  }
}

function mergeReasons(a: readonly AudienceReason[], b: readonly AudienceReason[]) {
  return sortReasons([...a, ...b]);
}

/**
 * Covers what decides who is messaged and with which registration's facts: the query and its version, each address, its
 * roles, each registration with its own balance, and every exclusion. It leaves out display names and timestamps, so a
 * name correction or a re-run never changes it, while a changed email, tag, balance, role or suppression always does.
 */
export function audienceFingerprint(
  eventId: string,
  query: NormalizedAudienceQuery,
  recipients: readonly AudienceRecipient[],
  exclusions: readonly AudienceExclusion[],
) {
  return createHash("sha256").update(JSON.stringify({
    fingerprintVersion: AUDIENCE_FINGERPRINT_VERSION,
    queryVersion: AUDIENCE_QUERY_VERSION,
    eventId,
    query,
    recipients: recipients.map((recipient) => ({
      email: recipient.email,
      roles: recipient.roles,
      registrations: recipient.registrations.map((entry) => ({
        registrationId: entry.registrationId,
        confirmationCode: entry.confirmationCode,
        roles: entry.roles,
        balanceCents: entry.balanceCents,
      })),
    })),
    exclusions: exclusions.map((exclusion) => ({
      key: exclusion.key,
      code: exclusion.code,
      roles: exclusion.roles,
      contactCount: exclusion.contactCount,
      registrationIds: exclusion.registrations.map((entry) => entry.registrationId),
    })),
  })).digest("hex");
}

export const AUDIENCE_PAGE_DEFAULT = 50;
export const AUDIENCE_PAGE_MAX = 200;

export const audiencePageSchema = z.strictObject({
  limit: z.number().int().min(1).max(AUDIENCE_PAGE_MAX).default(AUDIENCE_PAGE_DEFAULT),
  /** Opaque cursor returned as `nextCursor` by the previous page. */
  after: z.string().trim().min(1).max(512).optional(),
});

export type AudiencePageInput = z.input<typeof audiencePageSchema>;

function encodeCursor(key: string) {
  return Buffer.from(key, "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined) {
  if (!cursor) return null;
  return Buffer.from(cursor, "base64url").toString("utf8");
}

/** Keyset paging over a list already sorted by `keyOf`, so a page never repeats or skips an item between requests. */
export function pageAudienceList<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  page: { limit: number; after?: string | undefined },
) {
  const after = decodeCursor(page.after);
  let start = 0;
  if (after !== null) {
    let low = 0;
    let high = items.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (keyOf(items[middle]!) <= after) low = middle + 1;
      else high = middle;
    }
    start = low;
  }
  const slice = items.slice(start, start + page.limit);
  const hasMore = start + slice.length < items.length;
  return {
    items: slice,
    nextCursor: hasMore && slice.length > 0 ? encodeCursor(keyOf(slice[slice.length - 1]!)) : null,
  };
}
