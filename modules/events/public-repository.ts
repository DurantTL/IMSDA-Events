import "server-only";

import { cache } from "react";
import { getPrisma } from "@/lib/prisma";
import {
  buildPublicEventAnnouncementFeed,
  describePublicEventLifecycle,
  formatPublicEventSchedule,
  publicEventWebsiteLinks,
  summarizePublicRegistrationForm,
} from "@/modules/events/public-domain";
import { isListablePublishedDefinition, latestPublishedVersionArgs, publishedFormVersionWhere } from "@/modules/events/public-registration-status";
import { activeRegistrationStatuses } from "@/modules/events/lifecycle";
import { listPublishedEventContentSections } from "@/modules/events/content-repository";
import { registrationFormDefinitionSchema } from "@/modules/forms/definition";
import { groupFormDefinition, groupFormProblem } from "@/modules/group-registrations/domain";
import { pickClubPortalForm } from "@/modules/club-registrations/portal-form";
import { logWarn } from "@/lib/logger";
import { publicFormDifferentiators } from "@/modules/forms/duplicate-public-forms";
import { clubRegistrationEntryPath } from "@/modules/club-registrations/entry-path";
import { generalLinkFormProblem, generalLinkPath, GENERAL_LINK_LABEL } from "@/modules/general-link-registrations/domain";

async function loadPublicEventLanding(
  eventSlug: string,
  now = new Date(),
) {
  const prisma = getPrisma();
  const event = await prisma.event.findFirst({
    where: { slug: eventSlug, isPublished: true, archivedAt: null },
    select: {
      id: true,
      slug: true,
      name: true,
      startsAt: true,
      endsAt: true,
      timezone: true,
      location: true,
      // Active sites only, for the per-site "Get directions" links (#1213).
      locations: {
        where: { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
        select: { name: true, address: true },
      },
      capacity: true,
      publicInfoUrl: true,
      supportContact: true,
      refundPolicy: true,
      audience: true,
      isPublished: true,
      archivedAt: true,
      lifecycleState: true,
      registrationOpensOn: true,
      registrationClosesOn: true,
      waitlistEnabled: true,
      billingMode: true,
      teamSettings: { select: { eventId: true } },
      generalRegistrationLinkEnabled: true,
      announcements: {
        where: {
          status: "PUBLISHED",
          publishedAt: { lte: now },
          audience: { equals: { type: "ALL_ATTENDEES" } },
        },
        orderBy: [
          { priority: "desc" },
          { publishedAt: "desc" },
          { createdAt: "desc" },
          { id: "asc" },
        ],
        select: {
          title: true,
          body: true,
          audience: true,
          placement: true,
          status: true,
          priority: true,
          publishedAt: true,
        },
      },
      registrationForms: {
        where: publishedFormVersionWhere,
        orderBy: [{ name: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          name: true,
          slug: true,
          createdAt: true,
          versions: {
            ...latestPublishedVersionArgs,
            select: {
              id: true,
              versionNumber: true,
              definition: true,
            },
          },
        },
      },
    },
  });
  if (!event) return null;

  const occupiedSpots = await prisma.registrationAttendee.count({
    where: {
      eventId: event.id,
      registration: { status: { in: [...activeRegistrationStatuses] } },
    },
  });
  const schedule = formatPublicEventSchedule(
    event.startsAt,
    event.endsAt,
    event.timezone
  );
  const links = publicEventWebsiteLinks(event.slug, event.publicInfoUrl);
  const announcements = buildPublicEventAnnouncementFeed(
    event.announcements,
    event.timezone,
    now
  );

  // A club-audience event billed to the church takes its roster registrations
  // through the club portal (the director's roster, the club's own sign-in),
  // never the anonymous public form (#720).
  const clubPortalEvent = event.audience === "CLUB" && event.billingMode === "DEFERRED_ORGANIZATION_INVOICE";
  // The portal serves exactly one form per event: the oldest published one, and
  // only when it passes `clubFormProblem` (the same pick as `publishedClubForm`).
  // Only that card may open the portal; every other form keeps its public link.
  const portal = pickClubPortalForm(event.registrationForms.flatMap((form) => {
    const version = form.versions[0];
    return version ? [{ id: form.id, createdAt: form.createdAt, definition: version.definition }] : [];
  }));
  const portalFormId = clubPortalEvent && portal && portal.problem === null ? portal.form.id : null;
  const publicForms = event.registrationForms.flatMap((form) => {
    const version = form.versions[0];
    if (!version) return [];
    if (!isListablePublishedDefinition(version.definition)) {
      logWarn(
        "A published registration form has an invalid definition and was omitted from the public event page.",
        { formId: form.id },
      );
      return [];
    }
    const summary = summarizePublicRegistrationForm(registrationFormDefinitionSchema.parse(version.definition));
    const viaClubPortal = portalFormId === form.id;
    return [{
      id: form.id,
      slug: form.slug,
      versionId: version.id,
      versionNumber: version.versionNumber,
      name: form.name,
      ...summary,
      registrationPath: viaClubPortal ? ("CLUB_PORTAL" as const) : ("PUBLIC_FORM" as const),
      href: viaClubPortal
        ? clubRegistrationEntryPath(event.slug)
        : `/register/${event.slug}/${form.slug}`,
    }];
  });
  const differentiators = publicFormDifferentiators(publicForms);
  const forms = publicForms.map((form, index) => ({ ...form, differentiator: differentiators[index] ?? null }));
  const lifecycle = describePublicEventLifecycle(event, occupiedSpots, now, forms.length > 0);

  // "Register as a group or individual" (#650): a club event also takes people who are not in a
  // club, when one of its published forms can be used for them. Labelled only "Group".
  // The club's own form (the first one created, as club registration picks it) is the one a group uses.
  const primaryForm = portal ? event.registrationForms.find((form) => form.id === portal.form.id) : undefined;
  const primaryDefinition = registrationFormDefinitionSchema.safeParse(primaryForm?.versions[0]?.definition);
  const groupForm = event.audience === "CLUB" && !event.teamSettings && event.billingMode === "DEFERRED_ORGANIZATION_INVOICE"
    && primaryDefinition.success && groupFormProblem(groupFormDefinition(primaryDefinition.data)) === null
    ? primaryForm
    : undefined;

  // The general registration link (#931): club directors with no account register a team. Offered only when staff turned it on
  // and the club's own form can carry it (a club question that picks from the directory).
  const generalLink = event.generalRegistrationLinkEnabled && clubPortalEvent && primaryDefinition.success && generalLinkFormProblem(primaryDefinition.data) === null
    ? { href: generalLinkPath(event.slug), title: GENERAL_LINK_LABEL }
    : null;

  return {
    generalLink,
    groupRegistration: groupForm
      ? { href: `/register/${event.slug}/group`, title: "Register as a group or individual", label: "Group" }
      : null,
    event: {
      slug: event.slug,
      name: event.name,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt.toISOString(),
      timezone: event.timezone,
      location: event.location,
      sites: event.locations.map((site) => ({ name: site.name, address: site.address })),
      isPublished: event.isPublished,
      archivedAt: event.archivedAt ? event.archivedAt.toISOString() : null,
      capacity: event.capacity,
      supportContact: event.supportContact,
      refundPolicy: event.refundPolicy,
      audience: event.audience,
      dateLabel: schedule.dateLabel,
      timeLabel: schedule.timeLabel,
    },
    lifecycle,
    announcements,
    forms,
    links,
    contentSections: await listPublishedEventContentSections(event.id),
    /** The server's clock for this render, so the countdown block paints the same on the client. */
    renderedAtMs: now.getTime(),
  };
}

export type PublicEventLanding = NonNullable<
  Awaited<ReturnType<typeof loadPublicEventLanding>>
>;

export const getPublicEventLanding = cache(loadPublicEventLanding);

export async function listPublicEventSitemapEntries() {
  return getPrisma().event.findMany({
    where: {
      isPublished: true,
      archivedAt: null,
      registrationForms: {
        some: { versions: { some: { status: "PUBLISHED" } } },
      },
    },
    orderBy: { startsAt: "asc" },
    select: {
      slug: true,
      updatedAt: true,
    },
  });
}
