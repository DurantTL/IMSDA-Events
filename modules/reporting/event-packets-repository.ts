import "server-only";

import { getPrisma } from "@/lib/prisma";
import { activeRegistrationStatuses } from "@/modules/events/lifecycle";
import { listRegistrations } from "@/modules/registrations/repository";
import { parseEventPacketConfig } from "@/modules/reporting/event-packet-config";
import { buildOperationalReport } from "@/modules/reporting/operational-reports";
import {
  buildEventPacketGroups,
  type EventPacketAssignment,
} from "@/modules/reporting/event-packets";

export async function getEventPackets(eventId: string) {
  const [event, registrations, runs] = await Promise.all([
    getPrisma().event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        slug: true,
        name: true,
        startsAt: true,
        endsAt: true,
        timezone: true,
        location: true,
        supportContact: true,
        operationalPacketConfig: true,
        collectsShirtSizes: true,
        contentSections: {
          where: { isPublished: true },
          orderBy: { position: "asc" },
          select: {
            id: true,
            kind: true,
            title: true,
            body: true,
            links: {
              orderBy: { position: "asc" },
              select: { label: true, description: true, url: true, assetId: true },
            },
          },
        },
      },
    }),
    listRegistrations(eventId, { statuses: activeRegistrationStatuses }),
    getPrisma().programAssignmentRun.findMany({
      where: { eventId, invalidatedAt: null },
      orderBy: [{ appliedAt: "desc" }, { id: "desc" }],
      select: {
        fieldId: true,
        fieldLabelSnapshot: true,
        assignments: {
          orderBy: { stableOrder: "asc" },
          select: { attendeeIdSnapshot: true, optionValue: true },
        },
      },
    }),
  ]);
  if (!event) return null;

  const latestFields = new Set<string>();
  const assignments: EventPacketAssignment[] = [];
  for (const run of runs) {
    if (latestFields.has(run.fieldId)) continue;
    latestFields.add(run.fieldId);
    assignments.push(...run.assignments.map((assignment) => ({
      fieldLabel: run.fieldLabelSnapshot,
      attendeeId: assignment.attendeeIdSnapshot,
      option: assignment.optionValue,
    })));
  }
  const { operationalPacketConfig, collectsShirtSizes, ...eventRecord } = event;
  const stored = parseEventPacketConfig(operationalPacketConfig);
  // Compatibility (#155, until #148): the shirt column only prints where the event collects sizes.
  const config = {
    ...stored,
    sections: { ...stored.sections, shirtSize: stored.sections.shirtSize && collectsShirtSizes },
  };
  const report = buildOperationalReport(registrations, { groupingFieldKey: config.groupingFieldKey });
  return {
    event: {
      ...eventRecord,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt.toISOString(),
    },
    summary: report.summary,
    config,
    groups: buildEventPacketGroups(registrations, report.rosterGroups, assignments, config),
  };
}

/** @deprecated Pre-#155 name, kept so existing imports resolve. */
export const getRetreatPackets = getEventPackets;
