import "server-only";

import { getPrisma } from "@/lib/prisma";
import { buildStaffMealServiceCounts, type CoveredMealRow, type StaffMealServiceCount } from "@/modules/meals/staff-coverage-domain";

/**
 * How many approved staff, pastor and volunteer people the conference-paid meal plan covers at each meal service (#1027).
 * Read from the meals module's own selections, so there is one source of truth: an active conference-paid selection at a service,
 * on a submitted or confirmed registration whose staff invitation is APPROVED. A waiting registration is a draft with no
 * selections, and a declined one is cancelled, so neither is ever counted. Names and codes are never read.
 */
export async function loadStaffMealServiceCounts(eventId: string): Promise<StaffMealServiceCount[]> {
  const selections = await getPrisma().eventMealSelection.findMany({
    where: {
      eventId,
      status: "ACTIVE",
      payer: "CONFERENCE",
      serviceId: { not: null },
      service: { is: { status: "ACTIVE" } },
      registration: { is: { status: { in: ["SUBMITTED", "CONFIRMED"] }, staffInvitation: { is: { approval: "APPROVED" } } } },
    },
    select: {
      id: true,
      registrationAttendeeId: true,
      service: { select: { id: true, name: true, serviceDate: true, startTime: true, mealType: true } },
      registration: { select: { staffInvitation: { select: { group: true } } } },
    },
  });
  const rows: CoveredMealRow[] = selections.flatMap((selection) => {
    const group = selection.registration?.staffInvitation?.group;
    if (!selection.service || !group) return [];
    return [{
      serviceId: selection.service.id,
      serviceName: selection.service.name,
      serviceDate: selection.service.serviceDate,
      startTime: selection.service.startTime,
      mealType: selection.service.mealType,
      group,
      personKey: selection.registrationAttendeeId ?? selection.id,
    }];
  });
  return buildStaffMealServiceCounts(rows);
}
