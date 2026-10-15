import "server-only";

import { getPrisma } from "@/lib/prisma";
import {
  matchingRegistrationIdsForVerifiedEmail,
} from "@/modules/attendee-accounts/registrations-repository";
import { listEventsForUser } from "@/modules/events/repository";
import { isExactAllAttendeesAudience } from "@/modules/events/public-domain";
import { publicAttendeeName } from "@/modules/public-access/domain";

export type AttendeeEventHub = NonNullable<
  Awaited<ReturnType<typeof getAttendeeEventHub>>
>;

const eventHubEventSelect = {
  id: true,
  slug: true,
  name: true,
  startsAt: true,
  endsAt: true,
  timezone: true,
  location: true,
  supportContact: true,
  hubTitle: true,
  hubIntro: true,
  announcements: {
    where: { status: "PUBLISHED" as const },
    orderBy: [
      { pinnedAt: "desc" as const },
      { publishedAt: "desc" as const },
      { updatedAt: "desc" as const },
    ],
    select: {
      id: true,
      title: true,
      body: true,
      // Read only to filter: the hub shows attendee-wide notices, never one aimed at a narrower audience.
      audience: true,
      priority: true,
      publishedAt: true,
      pinnedAt: true,
    },
  },
  contentSections: {
    where: { isPublished: true },
    orderBy: { position: "asc" as const },
    select: {
      id: true,
      kind: true,
      title: true,
      body: true,
      links: {
        orderBy: { position: "asc" as const },
        select: {
          label: true,
          description: true,
          url: true,
          assetId: true,
        },
      },
    },
  },
};

function eventHubEventRecord(event: {
  slug: string;
  name: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  location: string | null;
  supportContact: string | null;
  hubTitle: string | null;
  hubIntro: string | null;
}) {
  return {
    slug: event.slug,
    name: event.name,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    timezone: event.timezone,
    location: event.location,
    supportContact: event.supportContact,
    hubTitle: event.hubTitle,
    hubIntro: event.hubIntro,
  };
}

/**
 * The hub title a particular viewer may see in the document title, or null (the default title applies).
 * A draft or private event's custom title is never revealed to an unrelated visitor, so this mirrors
 * the hub page's own access rules: a staff preview needs access to the event (the same check as the
 * preview page), and an attendee needs to be registered for a published event.
 */
export async function getEventHubTitleForViewer(input: {
  eventSlug: string;
  staffUser?: { id: string; globalRole?: "SYSTEM_ADMIN" | null } | null;
  attendeeEmail?: string | null;
}) {
  if (input.staffUser) {
    const preview = await getStaffEventHubPreview(input.staffUser, input.eventSlug);
    return preview?.hub.event.hubTitle ?? null;
  }
  if (!input.attendeeEmail) return null;
  const hub = await getAttendeeEventHub(input.attendeeEmail, input.eventSlug);
  if (!hub) return null;
  const published = await getPrisma().event.findFirst({
    where: { slug: input.eventSlug, isPublished: true, archivedAt: null },
    select: { hubTitle: true },
  });
  return published?.hubTitle ?? null;
}

/**
 * The notices an attendee's hub shows (#743, notice privacy). Only an announcement
 * whose audience is exactly "all attendees" appears, the same rule as the public
 * event page and the account banner, so a notice written for club directors (or
 * any narrower audience) never reaches an attendee through the hub. The audience
 * is dropped from what is returned.
 */
export function eventHubAnnouncementRecords(event: {
  announcements: Array<{
    id: string;
    title: string;
    body: string;
    audience: unknown;
    priority: "NORMAL" | "IMPORTANT" | "URGENT";
    publishedAt: Date | null;
    pinnedAt: Date | null;
  }>;
}) {
  return event.announcements
    .filter((announcement) => isExactAllAttendeesAudience(announcement.audience))
    .map((announcement) => ({
      id: announcement.id,
      title: announcement.title,
      body: announcement.body,
      priority: announcement.priority,
      publishedAt: announcement.publishedAt?.toISOString() ?? null,
      pinnedAt: announcement.pinnedAt?.toISOString() ?? null,
    }));
}

export async function getAttendeeEventHub(
  verifiedEmail: string,
  eventSlug: string,
) {
  const registrationIds = await matchingRegistrationIdsForVerifiedEmail(
    verifiedEmail,
  );
  if (registrationIds.length === 0) return null;
  const event = await getPrisma().event.findUnique({
    where: { slug: eventSlug },
    select: {
      ...eventHubEventSelect,
      registrations: {
        where: {
          id: { in: registrationIds },
          status: { in: ["SUBMITTED", "CONFIRMED"] },
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          confirmationCode: true,
          status: true,
          attendees: {
            orderBy: [{ position: "asc" }, { createdAt: "asc" }],
            select: {
              id: true,
              profileSnapshot: true,
              person: { select: { firstName: true, lastName: true } },
              checkIns: {
                where: { undoneAt: null },
                orderBy: { checkedInAt: "desc" },
                take: 1,
                select: { checkedInAt: true },
              },
            },
          },
        },
      },
    },
  });
  if (!event || event.registrations.length === 0) return null;

  const attendeeIds = event.registrations.flatMap((registration) => (
    registration.attendees.map((attendee) => attendee.id)
  ));
  const runs = attendeeIds.length > 0
    ? await getPrisma().programAssignmentRun.findMany({
        where: {
          eventId: event.id,
          invalidatedAt: null,
          assignments: {
            some: { attendeeIdSnapshot: { in: attendeeIds } },
          },
        },
        orderBy: [{ appliedAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          fieldId: true,
          fieldLabelSnapshot: true,
          appliedAt: true,
          assignments: {
            where: { attendeeIdSnapshot: { in: attendeeIds } },
            orderBy: { stableOrder: "asc" },
            select: {
              attendeeIdSnapshot: true,
              firstNameSnapshot: true,
              lastNameSnapshot: true,
              optionValue: true,
              preferenceRank: true,
              outcome: true,
            },
          },
        },
      })
    : [];
  const latestFieldIds = new Set<string>();
  const currentRuns = runs.filter((run) => {
    if (latestFieldIds.has(run.fieldId)) return false;
    latestFieldIds.add(run.fieldId);
    return true;
  });

  return {
    event: eventHubEventRecord(event),
    announcements: eventHubAnnouncementRecords(event),
    contentSections: event.contentSections,
    registrations: event.registrations.map((registration) => ({
      id: registration.id,
      confirmationCode: registration.confirmationCode,
      status: registration.status,
      attendees: registration.attendees.map((attendee) => ({
        id: attendee.id,
        name: publicAttendeeName(attendee.profileSnapshot, attendee.person),
        checkedInAt: attendee.checkIns[0]?.checkedInAt.toISOString() ?? null,
      })),
    })),
    assignmentRuns: currentRuns.map((run) => ({
      id: run.id,
      fieldLabel: run.fieldLabelSnapshot,
      appliedAt: run.appliedAt.toISOString(),
      assignments: run.assignments.map((assignment) => ({
        attendeeId: assignment.attendeeIdSnapshot,
        attendeeName: `${assignment.firstNameSnapshot} ${assignment.lastNameSnapshot}`.trim(),
        option: assignment.optionValue,
        preferenceRank: assignment.preferenceRank,
        outcome: assignment.outcome,
      })),
    })),
  };
}

/**
 * Read-only staff preview of the attendee-facing event hub.
 *
 * The accessible-event lookup is the authorization boundary. It deliberately
 * returns no registrations, passes, or assignments: staff can inspect the
 * shared attendee experience without impersonating a registrant or receiving
 * access through somebody else's verified email.
 */
export async function getStaffEventHubPreview(
  user: {
    id: string;
    globalRole?: "SYSTEM_ADMIN" | null;
  },
  eventSlug: string,
) {
  const accessibleEvents = await listEventsForUser(
    user.id,
    user.globalRole === "SYSTEM_ADMIN",
  );
  const accessibleEvent = accessibleEvents.find(
    (event) => event.slug === eventSlug,
  );
  if (!accessibleEvent) return null;

  const event = await getPrisma().event.findUnique({
    where: { id: accessibleEvent.id },
    select: eventHubEventSelect,
  });
  if (!event) return null;

  return {
    eventId: event.id,
    hub: {
      event: eventHubEventRecord(event),
      announcements: eventHubAnnouncementRecords(event),
      contentSections: event.contentSections,
      registrations: [],
      assignmentRuns: [],
    } satisfies AttendeeEventHub,
  };
}

/** @deprecated Pre-#155 names, kept so existing imports resolve. Use the `*EventHub*` names. */
export const getAttendeeRetreatHub = getAttendeeEventHub;
export const getStaffRetreatHubPreview = getStaffEventHubPreview;
export const retreatHubAnnouncementRecords = eventHubAnnouncementRecords;
export type AttendeeRetreatHub = AttendeeEventHub;
