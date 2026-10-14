import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { getServerEnv } from "@/lib/env";
import { isSerializationFailure, pauseBeforeRetry } from "@/lib/prisma-errors";
import {
  clubDirectoryIdentity,
  clubLocationSelect,
  clubLocationView,
  clubPhase,
  ClubRegistrationError,
  locationSeatCounts,
  publishedClubForm,
  requireClubEvent,
  type ClubEvent,
} from "@/modules/club-registrations/repository";
import { clubDirectoryOwnedResponses, lockedClubDirectoryFieldKeys } from "@/modules/club-registrations/domain";
import { NO_TEAM_KEY, resolveTeamName, teamNameTakenMessage } from "@/modules/club-teams/domain";
import { ClubTeamError } from "@/modules/club-teams/errors";
import { peopleOnOtherTeams, throwIfOnOtherTeams } from "@/modules/club-teams/registration-guard";
import { getTeamSettings } from "@/modules/club-teams/settings-repository";
import { processQueuedMessageIdsAfterCommit } from "@/modules/communications/messaging-repository";
import {
  activeRegistrationStatuses,
  calendarDateInEventTimeZone,
  evaluateEventRegistrationAdmission,
  evaluateEventRegistrationPhase,
  hasEventEnded,
} from "@/modules/events/lifecycle";
import { checkLocationSeats, locationOpenProblem } from "@/modules/event-locations/admission";
import { locationTransactionTimeoutMs } from "@/modules/event-locations/errors";
import { evaluateLocationPhase, locationLifecycleSource } from "@/modules/event-locations/domain";
import type { RegistrationFormDefinition } from "@/modules/forms/definition";
import { preparePublicRegistration, type PublicRegistrationInput } from "@/modules/forms/public-domain";
import {
  getPublicRegistrationExperience,
  PublicRegistrationError,
  submitPublicRegistration,
  type ClubSubmissionContext,
  type PublicRegistrationConfirmation,
} from "@/modules/forms/public-repository";
import {
  attachedDirectorEmail,
  generalLinkClubAnswer,
  generalLinkFormProblem,
  GENERAL_LINK_RECEIVED_MESSAGE,
  GENERAL_LINK_TOO_MANY_MESSAGE,
  matchedConfirmationNote,
  normalizeDirectorEmail,
  pendingConfirmationCode,
  pendingDirectorEmail,
  PENDING_SUBMISSIONS_PER_HOUR,
  generalLinkPath,
  pendingRetentionCutoff,
  REJECT_REASON_MAX,
  rejectedDirectorEmail,
  staffDigestWindow,
  staffPendingDigestNotice,
} from "@/modules/general-link-registrations/domain";
import { readTypedInTeam, requestHash, typedInPersonId } from "@/modules/general-link-registrations/typed-team";
import { normalizeOrganizationName } from "@/modules/organizations/domain";

/**
 * The general registration link (#931): a club director with no account registers a team through the event's one public link,
 * and the team is matched to the club they pick on the form.
 *
 * - The submitted director email is a current director or deputy of that club: the team is registered at once as an ordinary
 *   club registration for the club (`submitPublicRegistration` with a club context, so pricing, the deferred church invoice,
 *   team rules, print form, reports and check-in are the portal's), with its people recorded as extra people. A
 *   `GeneralLinkSubmission` row (CONFIRMED, AUTO_EMAIL_MATCH) is written in the same transaction as a record of how.
 * - Otherwise the team waits as a PENDING `GeneralLinkSubmission`: no Registration, so it is in no club count, invoice,
 *   report, seat or check-in list. Staff confirm the club or choose another, which runs the same club submission once and
 *   links it; or reject it with a reason.
 */

export class GeneralLinkError extends Error {
  constructor(
    public readonly code:
      | "EVENT_NOT_FOUND"
      | "FORM_UNAVAILABLE"
      | "SUBMISSION_NOT_FOUND"
      | "ALREADY_RESOLVED"
      | "CLUB_INVALID"
      | "REASON_REQUIRED"
      | "LINK_NOT_AVAILABLE"
      | "TOO_MANY_PENDING",
    message: string,
  ) {
    super(message);
    this.name = "GeneralLinkError";
  }
}

export function generalLinkErrorStatus(code: GeneralLinkError["code"]) {
  switch (code) {
    case "EVENT_NOT_FOUND":
    case "SUBMISSION_NOT_FOUND":
      return 404;
    case "CLUB_INVALID":
    case "REASON_REQUIRED":
      return 422;
    case "TOO_MANY_PENDING":
      return 429;
    default:
      return 409;
  }
}

/** The draft key a general-link team carries: it never had a club draft, so nothing is deleted with it. */
const GENERAL_LINK_DRAFT_KEY = "general-link";

type Tx = Prisma.TransactionClient;

export type GeneralLinkConfirmation = PublicRegistrationConfirmation & {
  /** Always RECEIVED: the answer never says whether the team was attached at once or is waiting (#931). */
  outcome: "RECEIVED";
  clubName: null;
};

// ---------------------------------------------------------------------------------------------
// The people typed into the form
// ---------------------------------------------------------------------------------------------

/**
 * Turns the people typed into the form into extra people of the club, inside the submit transaction. Nobody is looked up on
 * the roster, and the client chooses nothing about who they are beyond the answers it typed. The team rules (size, alternate,
 * age on the age date) are checked here, and again on what was saved by `enforceTeamRegistrationRules`.
 */
export function typedInAttendeePreparer(options: {
  organizationId: string;
  /** The director's submission key: typed-in person ids derive from it, so a staff confirmation reproduces them. */
  seed: string;
}): ClubSubmissionContext["prepareAttendees"] {
  return async (tx, { definition, event, input }) => {
    const problem = generalLinkFormProblem(definition);
    if (problem) throw new PublicRegistrationError("CLUB_REGISTRATION_UNAVAILABLE", problem);
    const attendees = input.attendees ?? [];
    if (attendees.length === 0) throw new PublicRegistrationError("CLUB_ATTENDEES_INVALID", "Add at least one team member.");
    const teamSettings = await getTeamSettings(event.id, tx);
    const eventDate = calendarDateInEventTimeZone(event.startsAt, event.timezone);
    const team = readTypedInTeam(definition, attendees, teamSettings, eventDate);
    if (team.problems.length > 0) throw new ClubTeamError("TEAM_RULES", team.problems.join(" "), team.problems);
    if (teamSettings?.allowMultipleTeams) {
      throwIfOnOtherTeams((await peopleOnOtherTeams(tx, {
        eventId: event.id,
        organizationId: options.organizationId,
        people: team.people.map((person) => ({ personId: null, name: `${person.firstName} ${person.lastName}`.trim(), onRoster: false })),
      })).conflicts);
    }
    const resolved: Awaited<ReturnType<ClubSubmissionContext["prepareAttendees"]>>["attendees"] = new Map();
    for (const person of team.people) {
      resolved.set(person.clientId, {
        personId: null,
        rosterMemberId: null,
        ageOnEventDate: person.age,
        ...(teamSettings ? { teamRole: person.role } : {}),
        guest: { email: null, attendeeType: person.adult ? "ADULT" : "YOUTH", guestId: typedInPersonId(options.seed, person.clientId) },
      });
    }
    // The club question is the club's own, read here from the organization record, never from what the page sent.
    const directoryResponses = lockedClubDirectoryFieldKeys(definition).length > 0
      ? clubDirectoryOwnedResponses(definition as RegistrationFormDefinition, await clubDirectoryIdentity(tx, options.organizationId))
      : {};
    return { input: { ...input, responses: { ...input.responses, ...directoryResponses } } satisfies PublicRegistrationInput, attendees: resolved };
  };
}

// ---------------------------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------------------------

/** The directory club a name picks: the one `listClubDirectoryNames` shows for it (active, first by name then id). */
async function directoryClub(client: Pick<Tx, "organization">, name: string) {
  return client.organization.findFirst({
    where: { type: "CLUB", isActive: true, normalizedName: normalizeOrganizationName(name) },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, name: true },
  });
}

/**
 * Whether the email is a current director or deputy of the club: an unrevoked grant inside its dates, on an account that
 * is not shut out, compared as a normalized (trimmed, lowercase) email. A registrar or reporter does not match.
 */
export async function emailIsDirectorOrDeputyOf(
  client: Pick<Tx, "clubDirectorGrant">,
  organizationId: string,
  email: string,
  now: Date,
) {
  const grant = await client.clubDirectorGrant.findFirst({
    where: {
      organizationId,
      role: { in: ["DIRECTOR", "DEPUTY"] },
      revokedAt: null,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      attendeeAccount: { email: { equals: normalizeDirectorEmail(email), mode: "insensitive" }, disabledAt: null },
    },
    select: { id: true },
  });
  return grant !== null;
}

/** The active clubs this email is a current director or deputy of, for staff choosing where a waiting team belongs. */
async function clubsDirectedBy(email: string, now: Date) {
  const grants = await getPrisma().clubDirectorGrant.findMany({
    where: {
      role: { in: ["DIRECTOR", "DEPUTY"] },
      revokedAt: null,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      attendeeAccount: { email: { equals: normalizeDirectorEmail(email), mode: "insensitive" }, disabledAt: null },
      organization: { type: "CLUB", isActive: true },
    },
    select: { organization: { select: { id: true, name: true } } },
  });
  return [...new Map(grants.map((grant) => [grant.organization.id, grant.organization])).values()];
}

// ---------------------------------------------------------------------------------------------
// Event and form
// ---------------------------------------------------------------------------------------------

async function generalLinkEvent(eventSlug: string): Promise<ClubEvent> {
  const found = await getPrisma().event.findFirst({
    where: {
      slug: eventSlug,
      isPublished: true,
      audience: "CLUB",
      billingMode: "DEFERRED_ORGANIZATION_INVOICE",
      generalRegistrationLinkEnabled: true,
    },
    select: { id: true },
  });
  if (!found) throw new GeneralLinkError("EVENT_NOT_FOUND", "That event isn't taking team registrations through a general link.");
  return requireClubEvent(found.id).catch((error: unknown) => {
    if (error instanceof ClubRegistrationError) throw new GeneralLinkError("EVENT_NOT_FOUND", "That event isn't taking team registrations through a general link.");
    throw error;
  });
}

/** The location fields a public visitor needs: where and when, and whether it can still be picked. No seat counts. */
function publicLocation(location: ReturnType<typeof clubLocationView>) {
  return {
    id: location.id,
    name: location.name,
    address: location.address,
    firstDay: location.firstDay,
    lastDay: location.lastDay,
    registrationClosesOn: location.registrationClosesOn,
    ownClosingDate: location.ownClosingDate,
    full: location.full,
    waitlistOnFull: location.waitlistOnFull,
    phase: location.phase,
    open: location.open,
    isActive: location.isActive,
  };
}

/** What the public page needs: the event's form, its locations and the team rules in words. Throws EVENT_NOT_FOUND when the link is off. */
export async function getGeneralLinkExperience(eventSlug: string, now = new Date()) {
  const event = await generalLinkEvent(eventSlug);
  const form = await publishedClubForm(event.id);
  const problem = form ? generalLinkFormProblem(form.definition) : "The event has no published registration form yet.";
  const experience = form && !problem ? await getPublicRegistrationExperience(event.slug, form.slug) : null;
  const locations = await getPrisma().eventLocation.findMany({
    where: { eventId: event.id, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { name: "asc" }],
    select: clubLocationSelect,
  });
  const seats = locations.length > 0 ? await locationSeatCounts(getPrisma(), event.id) : new Map<string, number>();
  const teamSettings = await getTeamSettings(event.id);
  return {
    event: {
      name: event.name,
      slug: event.slug,
      eventDate: calendarDateInEventTimeZone(event.startsAt, event.timezone),
      phase: clubPhase(event, locations, null, now),
    },
    problem,
    experience,
    locations: locations.map((location) => publicLocation(clubLocationView(event, location, seats.get(location.id) ?? 0, now))),
    team: { named: teamSettings?.allowMultipleTeams === true },
  };
}

export type GeneralLinkExperience = Awaited<ReturnType<typeof getGeneralLinkExperience>>;

/** Whether `event` takes registrations at `location` now (or without one), as the club submit decides it. */
function assertOpen(event: ClubEvent, location: { name: string; firstDay: string | null; lastDay: string | null; registrationClosesOn: string | null } | null, now: Date) {
  const source = location ? locationLifecycleSource(event, location) : event;
  const phase = location ? evaluateLocationPhase(event, location, now) : evaluateEventRegistrationPhase(event, now);
  if (phase === "OPEN") return;
  const subject = location?.name ?? "this event";
  if (phase === "UPCOMING") {
    throw new PublicRegistrationError("REGISTRATION_NOT_OPEN", `Registration for ${subject} is not open yet.`);
  }
  throw new PublicRegistrationError(
    "REGISTRATION_CLOSED",
    hasEventEnded(source, now) ? `Registration for ${subject} has closed.` : `Registration for ${subject} is closed.`,
  );
}

// ---------------------------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------------------------

type Notice = {
  kind: string;
  recipientKind: "REGISTRANT" | "INTERNAL";
  email: string;
  name: string | null;
  subject: string;
  bodyText: string;
  /** A fixed key in place of the per-submission one, for a notice that is sent once per window (the staff digest). */
  dedupeKey?: string;
  /** Skip the notice when its key was already queued, instead of reusing the earlier message. */
  skipIfQueued?: boolean;
};

/**
 * Queues plain-text notices in the event's own outbox, inside the caller's transaction (sent after it commits). Delivery
 * follows the event's message settings like every other message: captured, sent, or suppressed when the event's delivery is off.
 */
async function queueNotices(tx: Tx, input: { eventId: string; registrationId: string | null; submissionId: string; notices: Notice[] }) {
  if (input.notices.length === 0) return [] as string[];
  const settings = await tx.eventMessageSettings.findUnique({ where: { eventId: input.eventId } });
  const deliveryMode = settings?.deliveryMode ?? "LOCAL_CAPTURE";
  const correlationId = randomUUID();
  const ids: string[] = [];
  for (const notice of input.notices) {
    const suppressed = deliveryMode === "DISABLED";
    const idempotencyKey = notice.dedupeKey ?? `general-link:${notice.kind}:${input.submissionId}:${notice.email}`;
    if (notice.skipIfQueued && (await tx.messageOutbox.findUnique({ where: { idempotencyKey }, select: { id: true } }))) continue;
    const message = await tx.messageOutbox.upsert({
      where: { idempotencyKey },
      update: {},
      create: {
        eventId: input.eventId,
        registrationId: input.registrationId,
        templateKey: "CUSTOM_MESSAGE",
        recipientKind: notice.recipientKind,
        recipientEmail: notice.email,
        recipientName: notice.name,
        senderNameSnapshot: settings?.senderName ?? "IMSDA Events",
        senderEmailSnapshot: settings?.senderEmail ?? null,
        replyToEmailSnapshot: settings?.replyToEmail ?? null,
        subjectSnapshot: notice.subject,
        bodyTextSnapshot: notice.bodyText,
        metadata: { trigger: `GENERAL_LINK_${notice.kind}`, generalLinkSubmissionId: input.submissionId, deliveryMode, realDelivery: deliveryMode === "EXTERNAL_EMAIL" },
        idempotencyKey,
        correlationId,
        status: suppressed ? "SUPPRESSED" : "PENDING",
        lastError: suppressed ? "Delivery is disabled for this event." : null,
      },
      select: { id: true, status: true },
    });
    if (message.status === "PENDING") ids.push(message.id);
  }
  return ids;
}

async function staffEmails(tx: Tx, eventId: string) {
  const row = await tx.eventMessageSettings.findUnique({ where: { eventId }, select: { internalNotificationEmails: true } });
  const value = row?.internalNotificationEmails;
  if (!Array.isArray(value)) return [] as string[];
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim().toLowerCase()).filter((entry) => entry.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry)))];
}

async function sendAfterCommit(messageIds: string[]) {
  if (messageIds.length === 0) return { sent: false };
  try {
    const processed = await processQueuedMessageIdsAfterCommit(messageIds);
    return { sent: processed.sentIds.length > 0 };
  } catch {
    // The messages stay queued for the outbox worker; the registration is already saved.
    return { sent: false };
  }
}

// ---------------------------------------------------------------------------------------------
// Submitting
// ---------------------------------------------------------------------------------------------

const submitAttempts = 4;

function retryable(error: unknown) {
  return isSerializationFailure(error) || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002");
}

type SubmissionRow = Prisma.GeneralLinkSubmissionGetPayload<{ select: {
  id: true; status: true; resolution: true; confirmationCode: true; requestHash: true; clubNameAsEntered: true; organizationId: true;
  directorEmail: true; teamName: true; attendeeCount: true; registrationId: true; organization: { select: { name: true } };
} }>;

const submissionRowSelect = {
  id: true, status: true, resolution: true, confirmationCode: true, requestHash: true, clubNameAsEntered: true, organizationId: true,
  directorEmail: true, teamName: true, attendeeCount: true, registrationId: true, organization: { select: { name: true } },
} satisfies Prisma.GeneralLinkSubmissionSelect;

/**
 * The public answer to a submission: the same fields and the same words whether the team was attached at once or is waiting
 * for staff, with no manage link, no registration code, no club and no waitlist place. Only a team staff rejected is told so
 * (when a retry of the same request finds it).
 */
function receivedConfirmation(input: {
  reference: string;
  email: string;
  attendeeCount: number;
  attendeeNames: string[];
  pricingDate: string;
  emailSent: boolean;
  rejected?: boolean;
}): GeneralLinkConfirmation {
  return {
    outcome: "RECEIVED",
    clubName: null,
    confirmationCode: input.reference,
    message: input.rejected
      ? "This team registration was not accepted by the event team. Check your email for the reason, or contact the event team."
      : GENERAL_LINK_RECEIVED_MESSAGE,
    email: input.email,
    promoCode: null,
    lineItems: [],
    pricingDate: input.pricingDate,
    cardSelected: false,
    emailSent: input.emailSent,
    paymentCollected: false,
    notificationQueued: input.emailSent,
    notificationStatus: input.emailSent ? "SENT" : "PENDING",
    managePath: null,
    manageLinkExpiresAt: null,
    attendeeCount: input.attendeeCount,
    attendeeNames: input.attendeeNames,
    registrationStatus: "SUBMITTED",
    capacityDecision: "REGISTER",
    paymentEligible: false,
    waitlistPosition: null,
  };
}

function replayConfirmation(row: SubmissionRow, pricingDate: string, attendeeNames: string[]) {
  return receivedConfirmation({
    reference: row.confirmationCode,
    email: row.directorEmail,
    attendeeCount: row.attendeeCount,
    attendeeNames,
    pricingDate,
    emailSent: false,
    rejected: row.status === "REJECTED",
  });
}

/** The standard transaction's context for a club team, shared by the director's matched submission and a staff confirmation. */
function clubContext(input: {
  organizationId: string;
  team: { name: string; key: string } | null;
  locationId: string | null;
  seed: string;
}): Pick<ClubSubmissionContext, "organizationId" | "team" | "locationId" | "prepareAttendees"> {
  return {
    organizationId: input.organizationId,
    ...(input.team ? { team: { name: input.team.name, key: input.team.key, draftKey: GENERAL_LINK_DRAFT_KEY } } : {}),
    locationId: input.locationId,
    prepareAttendees: typedInAttendeePreparer({ organizationId: input.organizationId, seed: input.seed }),
  };
}

/**
 * Every refusal a general-link request can meet BEFORE it is known whether its email matches a club's director, run once for
 * every request with the same checks, the same words and the same order: the hourly cap, the site (required, real, open,
 * with room or a waitlist), the event's own dates and capacity, the team's name (registered or waiting, in any club), and
 * the picked club's own conflicts. The matched and the waiting path both call it first, so a visitor who sends bad input
 * learns nothing about whether an email is a director's, from the status, the message or their order. Reads only: it locks
 * nothing and writes nothing, so what the matched path's own transaction decides afterwards can differ only by a race.
 */
async function validateGeneralLinkRequest(
  client: Tx | ReturnType<typeof getPrisma>,
  input: {
    event: ClubEvent;
    locationId: string | null;
    team: { name: string; key: string } | null;
    attendeeCount: number;
    people: Array<{ firstName: string; lastName: string }>;
    pickedOrganizationId: string | null;
    allowMultipleTeams: boolean;
    now: Date;
  },
) {
  const db = client as Tx;
  const hourAgo = new Date(input.now.getTime() - 60 * 60 * 1000);
  const recent = await db.generalLinkSubmission.count({
    where: {
      eventId: input.event.id,
      createdAt: { gt: hourAgo },
      OR: [{ resolution: null }, { resolution: { not: "AUTO_EMAIL_MATCH" } }],
    },
  });
  if (recent >= PENDING_SUBMISSIONS_PER_HOUR) throw new GeneralLinkError("TOO_MANY_PENDING", GENERAL_LINK_TOO_MANY_MESSAGE);

  // Where and when: the same location and closing-date rules a registration at that location follows, in the club submit's words.
  const admitted = await checkLocationSeats(
    db,
    {
      eventId: input.event.id,
      locationId: input.locationId,
      requestedSeats: input.attendeeCount,
      requirePick: true,
      lock: false,
      waitlistIfFull: input.event.waitlistEnabled,
    },
    (location) => {
      const closed = locationOpenProblem(input.event, location, input.now);
      if (closed) throw new PublicRegistrationError(evaluateLocationPhase(input.event, location, input.now) === "UPCOMING" ? "REGISTRATION_NOT_OPEN" : "REGISTRATION_CLOSED", closed);
    },
  );
  if (!admitted) assertOpen(input.event, null, input.now);
  const lifecycle = admitted ? locationLifecycleSource(input.event, admitted) : input.event;
  const occupied = await db.registrationAttendee.count({
    where: { eventId: input.event.id, registration: { status: { in: [...activeRegistrationStatuses] } } },
  });
  const capacity = (await db.event.findUnique({ where: { id: input.event.id }, select: { capacity: true } }))?.capacity ?? null;
  const admission = evaluateEventRegistrationAdmission({ ...lifecycle, capacity }, { occupied, requested: input.attendeeCount }, input.now);
  if (admission.capacityDecision === "FULL") {
    const remaining = admission.remainingSpots ?? 0;
    throw new PublicRegistrationError("EVENT_FULL", `Only ${remaining} attendee spot${remaining === 1 ? "" : "s"} remain for this event, and its waitlist is not enabled.`);
  }

  if (input.team) {
    // A team name is unique in the event whichever club holds it, registered or waiting. Read in the caller's transaction when
    // it has one, so a registered and a waiting team racing for one name cannot both land.
    const taken = await db.clubEventRegistration.findFirst({ where: { eventId: input.event.id, teamKey: input.team.key }, select: { id: true } })
      ?? await db.generalLinkSubmission.findFirst({ where: { eventId: input.event.id, teamKey: input.team.key, status: "PENDING" }, select: { id: true } });
    if (taken) throw new PublicRegistrationError("CLUB_TEAM_NAME_TAKEN", teamNameTakenMessage(input.team.name));
  }
  if (input.pickedOrganizationId) {
    // The picked club's own conflicts are checked for every email, so they cannot tell a director from anyone else.
    if (!input.team) {
      const registered = await db.clubEventRegistration.findFirst({ where: { eventId: input.event.id, organizationId: input.pickedOrganizationId, teamKey: "" }, select: { id: true } });
      if (registered) throw new PublicRegistrationError("CLUB_ALREADY_REGISTERED", "Your club is already registered for this event.");
    }
    if (input.allowMultipleTeams) {
      throwIfOnOtherTeams((await peopleOnOtherTeams(db, {
        eventId: input.event.id,
        organizationId: input.pickedOrganizationId,
        people: input.people.map((person) => ({ personId: null, name: `${person.firstName} ${person.lastName}`.trim(), onRoster: false })),
      })).conflicts);
    }
  }
}

/**
 * Registers a team through the general link. The director's answers are validated here exactly as the form is, every request
 * is then checked once by `validateGeneralLinkRequest` (the same refusals whatever the email), and only after all of that does
 * the email choose the path: attached at once (it matches a current director or deputy of the club picked) or saved to wait
 * for staff. Both paths answer with the same public confirmation.
 */
export async function submitGeneralLinkRegistration(
  eventSlug: string,
  input: PublicRegistrationInput,
  options: { locationId?: string | null; teamName?: string | null } = {},
  now = new Date(),
): Promise<GeneralLinkConfirmation> {
  const prisma = getPrisma();
  const event = await generalLinkEvent(eventSlug);
  const form = await publishedClubForm(event.id);
  if (!form) throw new GeneralLinkError("FORM_UNAVAILABLE", "The event has no published registration form yet.");
  const problem = generalLinkFormProblem(form.definition);
  if (problem) throw new GeneralLinkError("FORM_UNAVAILABLE", problem);
  const experience = await getPublicRegistrationExperience(event.slug, form.slug);
  if (!experience) throw new GeneralLinkError("FORM_UNAVAILABLE", "The event has no published registration form yet.");
  if (experience.form.versionId !== input.versionId) {
    throw new PublicRegistrationError("FORM_VERSION_CHANGED", "This form was updated while it was open. Refresh the page before submitting.");
  }
  const definition = experience.form.definition;

  const teamSettings = await getTeamSettings(event.id);
  const team = resolveTeamName(teamSettings, options.teamName);
  if (!team.ok) throw new ClubRegistrationError("TEAM_INVALID", team.message);
  const teamIdentity = team.teamName !== null ? { name: team.teamName, key: team.teamKey } : null;
  const locationId = options.locationId ?? null;
  const hash = requestHash({ versionId: input.versionId, responses: input.responses, attendees: (input.attendees ?? []).map((attendee) => attendee.responses), locationId, teamName: team.teamName });

  // A retried POST (same key) is answered from what the first one did.
  const existing = await prisma.generalLinkSubmission.findUnique({
    where: { eventId_idempotencyKey: { eventId: event.id, idempotencyKey: input.idempotencyKey } },
    select: submissionRowSelect,
  });
  if (existing) {
    if (existing.requestHash !== hash) {
      throw new PublicRegistrationError("IDEMPOTENCY_CONFLICT", "This submission key was already used for different answers. Refresh the form before trying again.");
    }
    return replayConfirmation(existing, experience.pricingDate, typedNames(definition, input, teamSettings, event));
  }
  // Two POSTs with one key at the same moment: the one that lost the race answers with what the winner stored.
  const answerFromWinner = async (error: unknown) => {
    const winner = await prisma.generalLinkSubmission.findUnique({
      where: { eventId_idempotencyKey: { eventId: event.id, idempotencyKey: input.idempotencyKey } },
      select: submissionRowSelect,
    });
    if (winner && winner.requestHash === hash) return replayConfirmation(winner, experience.pricingDate, typedNames(definition, input, teamSettings, event));
    throw error;
  };

  // The same checks the club submit makes, on the answers as typed, so a team that can never be registered is refused now.
  const prepared = preparePublicRegistration(definition, input, { timeZone: event.timezone, now, ignoreAvailability: true });
  if (!prepared.isValid || !prepared.identity) {
    throw new PublicRegistrationError("INVALID_SUBMISSION", "Review the highlighted fields and submit again.", prepared.issues);
  }
  const typed = readTypedInTeam(definition, input.attendees ?? [], teamSettings, calendarDateInEventTimeZone(event.startsAt, event.timezone));
  if (typed.problems.length > 0) throw new ClubTeamError("TEAM_RULES", typed.problems.join(" "), typed.problems);

  const answer = generalLinkClubAnswer(definition, prepared.registrationResponses);
  const directorEmail = normalizeDirectorEmail(prepared.identity.email);
  const picked = answer.directoryName ? await directoryClub(prisma, answer.directoryName) : null;
  // Every refusal that does not depend on the email, before the email is looked at.
  await validateGeneralLinkRequest(prisma, {
    event, locationId, team: teamIdentity, attendeeCount: input.attendees?.length ?? 0, people: typed.people,
    pickedOrganizationId: picked?.id ?? null, allowMultipleTeams: teamSettings?.allowMultipleTeams === true, now,
  });
  const matches = picked ? await emailIsDirectorOrDeputyOf(prisma, picked.id, directorEmail, now) : false;
  const directorName = `${prepared.identity.firstName} ${prepared.identity.lastName}`.trim();
  const attendeeNames = typed.people.map((person) => `${person.firstName} ${person.lastName}`.trim());
  if (picked && matches) {
    return submitMatched({
      event, form, input, organizationId: picked.id, clubName: picked.name, team: teamIdentity, locationId, hash, now,
      pricingDate: experience.pricingDate, attendeeNames,
      director: { email: directorEmail, name: directorName },
    }).catch(answerFromWinner);
  }
  return createPending({
    event, definition, input, hash, team: teamIdentity, locationId, now, pricingDate: experience.pricingDate,
    directorName,
    directorEmail,
    clubNameAsEntered: answer.asEntered || answer.directoryName || "",
    suggestedOrganizationId: picked?.id ?? null,
    attendeeNames,
    typedPeople: typed.people,
    allowMultipleTeams: teamSettings?.allowMultipleTeams === true,
  }).catch(answerFromWinner);
}

/** The names of the people typed into a request, for the confirmation shown to the person who typed them. */
function typedNames(definition: RegistrationFormDefinition, input: PublicRegistrationInput, settings: Parameters<typeof readTypedInTeam>[2], event: ClubEvent) {
  return readTypedInTeam(definition, input.attendees ?? [], settings, calendarDateInEventTimeZone(event.startsAt, event.timezone))
    .people.map((person) => `${person.firstName} ${person.lastName}`.trim());
}

async function submitMatched(input: {
  event: ClubEvent;
  form: { slug: string };
  input: PublicRegistrationInput;
  organizationId: string;
  clubName: string;
  director: { email: string; name: string };
  team: { name: string; key: string } | null;
  locationId: string | null;
  hash: string;
  now: Date;
  pricingDate: string;
  attendeeNames: string[];
}): Promise<GeneralLinkConfirmation> {
  const submissionId = randomUUID();
  // The reference the screen shows and the email repeats: the same format as a waiting team's, so the screen never differs.
  const reference = pendingConfirmationCode(randomUUID().replaceAll("-", ""));
  const confirmation = await submitPublicRegistration(input.event.slug, input.form.slug, input.input, input.now, {
    ...clubContext({ organizationId: input.organizationId, team: input.team, locationId: input.locationId, seed: input.input.idempotencyKey }),
    auditMetadata: { generalLinkSubmissionId: submissionId, matchBasis: "DIRECTOR_EMAIL" },
    // One email to the director: the ordinary confirmation, with the club the team was attached to as its first line. A team
    // that lands on the event's waitlist gets the ordinary waitlist notice instead, which never says "attached".
    confirmationNote: () => matchedConfirmationNote({ teamName: input.team?.name ?? "your team", clubName: input.clubName, confirmationCode: reference }),
    inTransaction: async (tx, created) => {
      await tx.generalLinkSubmission.create({
        data: {
          id: submissionId,
          eventId: input.event.id,
          status: "CONFIRMED",
          resolution: "AUTO_EMAIL_MATCH",
          confirmationCode: reference,
          idempotencyKey: input.input.idempotencyKey,
          requestHash: input.hash,
          clubNameAsEntered: input.clubName,
          suggestedOrganizationId: input.organizationId,
          organizationId: input.organizationId,
          directorEmail: input.director.email,
          directorName: input.director.name,
          teamName: input.team?.name ?? "",
          teamKey: input.team?.key ?? NO_TEAM_KEY,
          locationId: input.locationId,
          attendeeCount: input.input.attendees?.length ?? 0,
          registrationId: created.registrationId,
          resolvedAt: new Date(),
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          eventId: input.event.id,
          action: "GENERAL_LINK_TEAM_ATTACHED",
          entityType: "GeneralLinkSubmission",
          entityId: submissionId,
          correlationId: randomUUID(),
          summary: "A team registered through the general link was attached to its club because the director's email matched.",
          metadata: {
            generalLinkSubmissionId: submissionId,
            registrationId: created.registrationId,
            organizationId: input.organizationId,
            resolution: "AUTO_EMAIL_MATCH",
            attendeeCount: input.input.attendees?.length ?? 0,
            waitlisted: created.waitlisted,
          },
        },
      });
    },
  });
  return receivedConfirmation({
    reference,
    email: input.director.email,
    attendeeCount: input.input.attendees?.length ?? 0,
    attendeeNames: input.attendeeNames,
    pricingDate: input.pricingDate,
    emailSent: confirmation.emailSent,
  });
}

async function createPending(input: {
  event: ClubEvent;
  definition: RegistrationFormDefinition;
  input: PublicRegistrationInput;
  hash: string;
  team: { name: string; key: string } | null;
  locationId: string | null;
  now: Date;
  pricingDate: string;
  directorName: string;
  directorEmail: string;
  clubNameAsEntered: string;
  suggestedOrganizationId: string | null;
  attendeeNames: string[];
  typedPeople: Array<{ firstName: string; lastName: string }>;
  allowMultipleTeams: boolean;
}): Promise<GeneralLinkConfirmation> {
  const prisma = getPrisma();
  const submissionId = randomUUID();
  const confirmationCode = pendingConfirmationCode(randomUUID().replaceAll("-", ""));
  let noticeIds: string[] = [];
  for (let attempt = 0; attempt < submitAttempts; attempt += 1) {
    try {
      const row = await prisma.$transaction(async (tx) => {
        const replay = await tx.generalLinkSubmission.findUnique({
          where: { eventId_idempotencyKey: { eventId: input.event.id, idempotencyKey: input.input.idempotencyKey } },
          select: submissionRowSelect,
        });
        if (replay) {
          if (replay.requestHash !== input.hash) throw new PublicRegistrationError("IDEMPOTENCY_CONFLICT", "This submission key was already used for different answers. Refresh the form before trying again.");
          return { row: replay, created: false };
        }
        // The same checks as before the email was looked at, now inside this Serializable transaction, so a registered and a
        // waiting team racing for one name, or the last seats, cannot both land.
        await validateGeneralLinkRequest(tx, {
          event: input.event, locationId: input.locationId, team: input.team, attendeeCount: input.input.attendees?.length ?? 0,
          people: input.typedPeople, pickedOrganizationId: input.suggestedOrganizationId, allowMultipleTeams: input.allowMultipleTeams, now: input.now,
        });
        const created = await tx.generalLinkSubmission.create({
          data: {
            id: submissionId,
            eventId: input.event.id,
            status: "PENDING",
            confirmationCode,
            idempotencyKey: input.input.idempotencyKey,
            requestHash: input.hash,
            clubNameAsEntered: input.clubNameAsEntered,
            suggestedOrganizationId: input.suggestedOrganizationId,
            directorEmail: input.directorEmail,
            directorName: input.directorName,
            teamName: input.team?.name ?? "",
            teamKey: input.team?.key ?? NO_TEAM_KEY,
            locationId: input.locationId,
            attendeeCount: input.input.attendees?.length ?? 0,
            payload: {
              versionId: input.input.versionId,
              responses: input.input.responses,
              attendees: input.input.attendees ?? [],
            } as Prisma.InputJsonValue,
          },
          select: submissionRowSelect,
        });
        await tx.auditLog.create({
          data: {
            eventId: input.event.id,
            action: "GENERAL_LINK_TEAM_PENDING",
            entityType: "GeneralLinkSubmission",
            entityId: submissionId,
            correlationId: randomUUID(),
            summary: "A team registered through the general link is waiting for staff to confirm its club.",
            metadata: {
              generalLinkSubmissionId: submissionId,
              suggestedOrganizationId: input.suggestedOrganizationId,
              clubNotListed: input.suggestedOrganizationId === null,
              attendeeCount: input.input.attendees?.length ?? 0,
              locationId: input.locationId,
            },
          },
        });
        // Staff get one digest per event per 15 minutes, with the count, never one email per team.
        const staff = await staffEmails(tx, input.event.id);
        const waitingCount = await tx.generalLinkSubmission.count({ where: { eventId: input.event.id, status: "PENDING" } });
        const reviewUrl = `${getServerEnv().APP_BASE_URL.replace(/\/+$/, "")}/people/pending-teams?event=${encodeURIComponent(input.event.id)}`;
        const window = staffDigestWindow(input.now);
        noticeIds = await queueNotices(tx, {
          eventId: input.event.id,
          registrationId: null,
          submissionId,
          notices: [
            {
              kind: "PENDING",
              recipientKind: "REGISTRANT",
              email: input.directorEmail,
              name: input.directorName || null,
              ...pendingDirectorEmail({ eventName: input.event.name, teamName: input.team?.name ?? "your team", confirmationCode }),
            },
            ...staff.map((email) => ({
              kind: "STAFF_PENDING_DIGEST",
              recipientKind: "INTERNAL" as const,
              email,
              name: "IMSDA event team",
              dedupeKey: `general-link:STAFF_PENDING_DIGEST:${input.event.id}:${window}:${email}`,
              skipIfQueued: true,
              ...staffPendingDigestNotice({ eventName: input.event.name, waitingCount, reviewUrl }),
            })),
          ],
        });
        return { row: created, created: true };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: locationTransactionTimeoutMs });
      const { sent } = row.created ? await sendAfterCommit(noticeIds) : { sent: false };
      return receivedConfirmation({
        reference: row.row.confirmationCode,
        email: row.row.directorEmail,
        attendeeCount: row.row.attendeeCount,
        attendeeNames: input.attendeeNames,
        pricingDate: input.pricingDate,
        emailSent: sent,
      });
    } catch (error) {
      // Two waiting teams with one name racing: the partial unique index decides.
      if (input.team && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && String(error.meta?.target ?? "").includes("pending_team_name")) {
        throw new PublicRegistrationError("CLUB_TEAM_NAME_TAKEN", teamNameTakenMessage(input.team.name));
      }
      if (!retryable(error)) throw error;
      if (attempt < submitAttempts - 1) await pauseBeforeRetry(attempt);
    }
  }
  throw new PublicRegistrationError("SUBMISSION_CONFLICT", "Another registration changed at the same time. Please submit again. Your entries are kept.");
}

// ---------------------------------------------------------------------------------------------
// Staff: the waiting list, confirm, reassign, reject
// ---------------------------------------------------------------------------------------------

export type PendingTeamMemberView = {
  firstName: string;
  lastName: string;
  /** Team member or coach; null on an event without team rules. */
  role: "MEMBER" | "COACH" | null;
  alternate: boolean;
};

export type PendingTeamView = {
  id: string;
  confirmationCode: string;
  createdAt: string;
  teamName: string;
  clubNameAsEntered: string;
  /** The club the director picked from the directory, if it was one. */
  suggestedClub: { id: string; name: string } | null;
  directorName: string;
  directorEmail: string;
  /** Active clubs this email is a current director or deputy of: the likeliest answers when the pick did not match. */
  emailClubs: Array<{ id: string; name: string }>;
  attendeeCount: number;
  locationName: string | null;
  /** The team's members (names, role, alternate mark), so staff can tell which club it really is. No ages, no other answers. */
  members: PendingTeamMemberView[];
  /** The team's coaches. */
  coaches: PendingTeamMemberView[];
};

/**
 * The teams waiting for a club, oldest first (MANAGE_REGISTRATION only, checked by the page and the route). Shows the team's
 * members' names and roles, its coaches, the picked club and the director's contact, because staff cannot tell which club a team
 * really is without them. Ages and every other answer stay out, and the audit log never holds any of it.
 */
export async function listPendingTeams(eventId: string, now = new Date()): Promise<PendingTeamView[]> {
  const rows = await getPrisma().generalLinkSubmission.findMany({
    where: { eventId, status: "PENDING" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true, confirmationCode: true, createdAt: true, teamName: true, clubNameAsEntered: true, directorName: true, directorEmail: true,
      attendeeCount: true, payload: true, suggestedOrganization: { select: { id: true, name: true } }, location: { select: { name: true } },
    },
  });
  const event = rows.length > 0
    ? await getPrisma().event.findUnique({ where: { id: eventId }, select: { slug: true, startsAt: true, timezone: true } })
    : null;
  const form = event ? await publishedClubForm(eventId) : null;
  const definition = event && form ? (await getPublicRegistrationExperience(event.slug, form.slug))?.form.definition ?? null : null;
  const settings = event ? await getTeamSettings(eventId) : null;
  return Promise.all(rows.map(async (row) => {
    const stored = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? (row.payload as { attendees?: Array<{ clientId: string; responses: Record<string, unknown> }> }).attendees ?? []
      : [];
    const people = event && definition
      ? readTypedInTeam(definition, stored, settings, calendarDateInEventTimeZone(event.startsAt, event.timezone)).people
      : [];
    const view = (person: (typeof people)[number]): PendingTeamMemberView => ({
      firstName: person.firstName,
      lastName: person.lastName,
      role: settings ? person.role : null,
      alternate: person.alternate,
    });
    return {
      id: row.id,
      confirmationCode: row.confirmationCode,
      createdAt: row.createdAt.toISOString(),
      teamName: row.teamName,
      clubNameAsEntered: row.clubNameAsEntered,
      suggestedClub: row.suggestedOrganization,
      directorName: row.directorName,
      directorEmail: row.directorEmail,
      emailClubs: await clubsDirectedBy(row.directorEmail, now),
      attendeeCount: row.attendeeCount,
      locationName: row.location?.name ?? null,
      members: people.filter((person) => !settings || person.role === "MEMBER").map(view),
      coaches: settings ? people.filter((person) => person.role === "COACH").map(view) : [],
    };
  }));
}

export async function countPendingTeams(eventId: string) {
  return getPrisma().generalLinkSubmission.count({ where: { eventId, status: "PENDING" } });
}

/** The active clubs staff can attach a team to. Names only. */
export async function listAttachableClubs() {
  return getPrisma().organization.findMany({
    where: { type: "CLUB", isActive: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, name: true },
  });
}

/** One event's attached and rejected counts, for the staff page's summary line. */
export async function resolvedTeamCounts(eventId: string) {
  const [attached, rejected] = await Promise.all([
    getPrisma().generalLinkSubmission.count({ where: { eventId, status: "CONFIRMED" } }),
    getPrisma().generalLinkSubmission.count({ where: { eventId, status: "REJECTED" } }),
  ]);
  return { attached, rejected };
}

export type ResolveTeamInput =
  | { action: "CONFIRM" | "REASSIGN"; organizationId: string }
  | { action: "REJECT"; reason: string };

/**
 * One staff action on a waiting team (MANAGE_REGISTRATION, checked by the route):
 * - CONFIRM or REASSIGN attach it to `organizationId` by running the ordinary club submission once, with the answers the
 *   director typed and the club's own name in the club question. The row turns CONFIRMED in the same transaction, so a second
 *   click, a second staff member, or a retry can never create a second registration. REASSIGN to the club the director
 *   picked is recorded as a confirmation.
 * - REJECT needs a reason, removes the typed answers, and tells the director.
 * Safe under concurrency: the first transaction to move the row out of PENDING wins; the others answer ALREADY_RESOLVED, or,
 * when they asked for the very same outcome, see it done.
 */
export async function resolvePendingTeam(
  eventId: string,
  submissionId: string,
  actorUserId: string,
  action: ResolveTeamInput,
): Promise<{ status: "CONFIRMED" | "REJECTED"; alreadyDone: boolean; registrationId: string | null; clubName: string | null }> {
  const prisma = getPrisma();
  const row = await prisma.generalLinkSubmission.findFirst({
    where: { id: submissionId, eventId },
    select: {
      id: true, status: true, organizationId: true, registrationId: true, suggestedOrganizationId: true, idempotencyKey: true, payload: true,
      teamName: true, teamKey: true, locationId: true, createdAt: true, directorEmail: true, directorName: true, confirmationCode: true,
      organization: { select: { name: true } }, event: { select: { slug: true, name: true } },
    },
  });
  if (!row) throw new GeneralLinkError("SUBMISSION_NOT_FOUND", "That team could not be found.");

  if (action.action === "REJECT") {
    const reason = action.reason.trim();
    if (!reason) throw new GeneralLinkError("REASON_REQUIRED", "Enter a reason for rejecting this team.");
    if (reason.length > REJECT_REASON_MAX) throw new GeneralLinkError("REASON_REQUIRED", `Keep the reason to ${REJECT_REASON_MAX} characters or fewer.`);
    if (row.status === "REJECTED") return { status: "REJECTED", alreadyDone: true, registrationId: null, clubName: null };
    if (row.status !== "PENDING") throw new GeneralLinkError("ALREADY_RESOLVED", "That team was already handled by someone else.");
    let noticeIds: string[] = [];
    for (let attempt = 0; attempt < submitAttempts; attempt += 1) {
      try {
        await prisma.$transaction(async (tx) => {
          const updated = await tx.generalLinkSubmission.updateMany({
            where: { id: row.id, status: "PENDING" },
            data: { status: "REJECTED", resolution: "STAFF_REJECTED", rejectReason: reason, resolvedByUserId: actorUserId, resolvedAt: new Date(), payload: Prisma.DbNull },
          });
          if (updated.count !== 1) throw new GeneralLinkError("ALREADY_RESOLVED", "That team was already handled by someone else.");
          await tx.auditLog.create({
            data: {
              eventId,
              actorUserId,
              action: "GENERAL_LINK_TEAM_REJECTED",
              entityType: "GeneralLinkSubmission",
              entityId: row.id,
              correlationId: randomUUID(),
              summary: "Staff rejected a team registered through the general link.",
              // Ids and flags only: the reason is kept on the submission, where staff read it.
              metadata: { generalLinkSubmissionId: row.id, suggestedOrganizationId: row.suggestedOrganizationId, reasonRecorded: true },
            },
          });
          noticeIds = await queueNotices(tx, {
            eventId,
            registrationId: null,
            submissionId: row.id,
            notices: [{
              kind: "REJECTED",
              recipientKind: "REGISTRANT",
              email: row.directorEmail,
              name: row.directorName || null,
              ...rejectedDirectorEmail({ eventName: row.event.name, teamName: row.teamName || "your team", confirmationCode: row.confirmationCode, reason }),
            }],
          });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        break;
      } catch (error) {
        if (error instanceof GeneralLinkError) {
          // Lost the race: if the winner rejected it too, that is the outcome asked for.
          const now = await prisma.generalLinkSubmission.findUnique({ where: { id: row.id }, select: { status: true } });
          if (now?.status === "REJECTED") return { status: "REJECTED", alreadyDone: true, registrationId: null, clubName: null };
          throw error;
        }
        if (!retryable(error)) throw error;
        if (attempt === submitAttempts - 1) throw error;
        await pauseBeforeRetry(attempt);
      }
    }
    await sendAfterCommit(noticeIds);
    return { status: "REJECTED", alreadyDone: false, registrationId: null, clubName: null };
  }

  // Attaching to a club.
  const club = await prisma.organization.findFirst({ where: { id: action.organizationId, type: "CLUB", isActive: true }, select: { id: true, name: true } });
  if (!club) throw new GeneralLinkError("CLUB_INVALID", "Choose an active club from the list.");
  if (row.status === "CONFIRMED") {
    if (row.organizationId === club.id) return { status: "CONFIRMED", alreadyDone: true, registrationId: row.registrationId, clubName: row.organization?.name ?? club.name };
    throw new GeneralLinkError("ALREADY_RESOLVED", "That team was already attached to a club by someone else.");
  }
  if (row.status !== "PENDING" || !row.payload || typeof row.payload !== "object" || Array.isArray(row.payload)) {
    throw new GeneralLinkError("ALREADY_RESOLVED", "That team was already handled by someone else.");
  }
  const form = await publishedClubForm(eventId);
  if (!form) throw new GeneralLinkError("FORM_UNAVAILABLE", "The event has no published registration form yet.");
  const experience = await getPublicRegistrationExperience(row.event.slug, form.slug);
  if (!experience) throw new GeneralLinkError("FORM_UNAVAILABLE", "The event has no published registration form yet.");
  const stored = row.payload as { responses?: Record<string, unknown>; attendees?: Array<{ clientId: string; responses: Record<string, unknown> }> };
  const resolution = row.suggestedOrganizationId === club.id ? "STAFF_CONFIRMED" as const : "STAFF_REASSIGNED" as const;
  let noticeIds: string[] = [];
  let attachedHere = false;
  try {
    await submitPublicRegistration(
      row.event.slug,
      form.slug,
      {
        // The form as it stands now: a team received before a form revision is attached under the current form's rules.
        versionId: experience.form.versionId,
        idempotencyKey: `general-link-confirm:${row.id}`,
        responses: stored.responses ?? {},
        attendees: stored.attendees ?? [],
        website: "",
      },
      // As of the day the director submitted: a team received before the deadline is not refused because staff confirmed it after.
      row.createdAt,
      {
        ...clubContext({
          organizationId: club.id,
          team: row.teamKey !== NO_TEAM_KEY ? { name: row.teamName, key: row.teamKey } : null,
          locationId: row.locationId,
          seed: row.idempotencyKey,
        }),
        auditMetadata: { generalLinkSubmissionId: row.id, matchBasis: "STAFF" },
        auditActorUserId: actorUserId,
        // This submission's own waiting name is released by this very confirmation; every other waiting name stays reserved.
        confirmsPendingSubmissionId: row.id,
        inTransaction: async (tx, created) => {
          attachedHere = true;
          const updated = await tx.generalLinkSubmission.updateMany({
            where: { id: row.id, status: "PENDING" },
            data: {
              status: "CONFIRMED", resolution, organizationId: club.id, registrationId: created.registrationId,
              resolvedByUserId: actorUserId, resolvedAt: new Date(), payload: Prisma.DbNull,
            },
          });
          if (updated.count !== 1) throw new GeneralLinkError("ALREADY_RESOLVED", "That team was already handled by someone else.");
          await tx.auditLog.create({
            data: {
              eventId,
              actorUserId,
              action: resolution === "STAFF_CONFIRMED" ? "GENERAL_LINK_TEAM_CONFIRMED" : "GENERAL_LINK_TEAM_REASSIGNED",
              entityType: "GeneralLinkSubmission",
              entityId: row.id,
              correlationId: randomUUID(),
              summary: resolution === "STAFF_CONFIRMED"
                ? "Staff confirmed the club of a team registered through the general link."
                : "Staff attached a team registered through the general link to a different club than the one picked.",
              metadata: {
                generalLinkSubmissionId: row.id,
                registrationId: created.registrationId,
                organizationId: club.id,
                suggestedOrganizationId: row.suggestedOrganizationId,
                resolution,
              },
            },
          });
          noticeIds = await queueNotices(tx, {
            eventId,
            registrationId: created.registrationId,
            submissionId: row.id,
            notices: [{
              kind: "ATTACHED",
              recipientKind: "REGISTRANT",
              email: row.directorEmail,
              name: row.directorName || null,
              ...attachedDirectorEmail({ eventName: row.event.name, teamName: row.teamName || club.name, clubName: club.name, confirmationCode: row.confirmationCode, waitlisted: created.waitlisted }),
            }],
          });
        },
      },
    );
  } catch (error) {
    // A second staff member, or a retry, reached the same transaction. Whatever stopped this attempt (the winner's own rows
    // can trip the one-team rule on a retry), the row says what happened: if it is no longer waiting, someone else decided it.
    const now = await prisma.generalLinkSubmission.findUnique({ where: { id: row.id }, select: { status: true, organizationId: true, registrationId: true } });
    if (now && now.status !== "PENDING") {
      if (now.status === "CONFIRMED" && now.organizationId === club.id) return { status: "CONFIRMED", alreadyDone: true, registrationId: now.registrationId, clubName: club.name };
      throw new GeneralLinkError("ALREADY_RESOLVED", "That team was already handled by someone else.");
    }
    throw error;
  }
  await sendAfterCommit(noticeIds);
  // A replay (a lost response on the first click, or the same click twice) commits nothing new: the row says what happened.
  const done = await prisma.generalLinkSubmission.findUnique({ where: { id: row.id }, select: { status: true, organizationId: true, registrationId: true } });
  if (done?.status !== "CONFIRMED" || done.organizationId !== club.id) {
    throw new GeneralLinkError("ALREADY_RESOLVED", "That team was already handled by someone else.");
  }
  return { status: "CONFIRMED", alreadyDone: !attachedHere, registrationId: done.registrationId, clubName: club.name };
}

// ---------------------------------------------------------------------------------------------
// Staff: the event setting
// ---------------------------------------------------------------------------------------------

/** The link's setting for the staff event settings page: whether it is on, its path, and what would stop it working. */
export async function getGeneralLinkSettings(eventId: string) {
  const event = await getPrisma().event.findUnique({
    where: { id: eventId },
    select: { slug: true, audience: true, billingMode: true, isPublished: true, generalRegistrationLinkEnabled: true },
  });
  if (!event) return null;
  const eligible = event.audience === "CLUB" && event.billingMode === "DEFERRED_ORGANIZATION_INVOICE";
  const form = eligible ? await publishedClubForm(eventId) : null;
  return {
    enabled: event.generalRegistrationLinkEnabled,
    eligible,
    slug: event.slug,
    isPublished: event.isPublished,
    /** Why the link would not work yet (no usable published form), or null. */
    problem: !eligible ? "The general registration link is for club events billed to the church." : form ? generalLinkFormProblem(form.definition) : "The event has no published registration form yet.",
    pendingCount: await countPendingTeams(eventId),
  };
}

/** Turns the link on or off (CONFIGURE_EVENT, checked by the route). Audited. Turning it off hides the page; waiting teams stay for staff. */
export async function setGeneralRegistrationLink(eventId: string, enabled: boolean, actorUserId: string) {
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    const event = await tx.event.findUnique({ where: { id: eventId }, select: { audience: true, billingMode: true, generalRegistrationLinkEnabled: true } });
    if (!event) throw new GeneralLinkError("EVENT_NOT_FOUND", "That event no longer exists.");
    if (enabled && !(event.audience === "CLUB" && event.billingMode === "DEFERRED_ORGANIZATION_INVOICE")) {
      throw new GeneralLinkError("LINK_NOT_AVAILABLE", "The general registration link is for club events billed to the church.");
    }
    if (event.generalRegistrationLinkEnabled === enabled) return;
    await tx.event.update({ where: { id: eventId }, data: { generalRegistrationLinkEnabled: enabled } });
    await tx.auditLog.create({
      data: {
        eventId,
        actorUserId,
        action: "GENERAL_LINK_SETTING_CHANGED",
        entityType: "Event",
        entityId: eventId,
        correlationId: randomUUID(),
        summary: enabled ? "Turned on the general registration link." : "Turned off the general registration link.",
        metadata: { enabled },
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return getGeneralLinkSettings(eventId);
}

// ---------------------------------------------------------------------------------------------
// Retention and the old generic page
// ---------------------------------------------------------------------------------------------

/**
 * Removes the typed answers (the team members' names and ages) of teams still waiting 30 days after their event ended, marking
 * them EXPIRED so the table's own check holds (a submission that is not PENDING has no payload and a resolution). Run by the
 * outbox sweep; safe to repeat. One audit entry per event, with the submission ids and a count, never any answer.
 */
export async function expireStalePendingTeams(now = new Date(), options: { eventId?: string } = {}) {
  const prisma = getPrisma();
  const stale = await prisma.generalLinkSubmission.findMany({
    where: { status: "PENDING", ...(options.eventId ? { eventId: options.eventId } : {}), event: { endsAt: { lt: pendingRetentionCutoff(now) } } },
    select: { id: true, eventId: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 500,
  });
  const byEvent = new Map<string, string[]>();
  for (const row of stale) byEvent.set(row.eventId, [...(byEvent.get(row.eventId) ?? []), row.id]);
  let expired = 0;
  for (const [eventId, ids] of byEvent) {
    expired += await prisma.$transaction(async (tx) => {
      const updated = await tx.generalLinkSubmission.findMany({ where: { id: { in: ids }, status: "PENDING" }, select: { id: true } });
      const done = await tx.generalLinkSubmission.updateMany({
        where: { id: { in: updated.map((row) => row.id) }, status: "PENDING" },
        data: { status: "EXPIRED", resolution: "RETENTION_EXPIRED", resolvedAt: now, payload: Prisma.DbNull },
      });
      if (done.count > 0) {
        await tx.auditLog.create({
          data: {
            eventId,
            action: "GENERAL_LINK_TEAMS_EXPIRED",
            entityType: "GeneralLinkSubmission",
            entityId: updated[0]!.id,
            correlationId: randomUUID(),
            summary: "Waiting general-link teams that nobody resolved had their typed answers removed 30 days after the event ended.",
            metadata: { generalLinkSubmissionIds: updated.map((row) => row.id), count: done.count },
          },
        });
      }
      return done.count;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  return { expired, events: byEvent.size };
}

/**
 * Where the generic `/register/<event>/<form>` page sends a visitor to a club-audience event (#931): that page shows the full
 * individual form, but a club event takes teams only through the portal or the general link. The general link when it is on,
 * else the event page. Null for any other event (the page shows its form as ever).
 */
export async function clubEventEntryRedirect(eventSlug: string): Promise<string | null> {
  const event = await getPrisma().event.findFirst({
    where: { slug: eventSlug, isPublished: true, audience: "CLUB" },
    select: { slug: true, billingMode: true, generalRegistrationLinkEnabled: true },
  });
  if (!event) return null;
  return event.generalRegistrationLinkEnabled && event.billingMode === "DEFERRED_ORGANIZATION_INVOICE"
    ? generalLinkPath(event.slug)
    : `/events/${encodeURIComponent(event.slug)}`;
}
