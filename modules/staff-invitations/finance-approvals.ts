import "server-only";

import { formatPersonName } from "@/lib/person-name";
import { getPrisma } from "@/lib/prisma";

export type StaffApprovalFinanceRow = {
  id: string;
  /** The staff member who approved it; null when that account no longer exists. */
  approvedBy: string | null;
  worker: string;
  group: "STAFF" | "PASTOR" | "VOLUNTEER";
  decidedAt: string | null;
  confirmationCode: string;
  /** Active conference-paid meals recorded for the registration, and what the conference rate makes of them. */
  conferenceMeals: number;
  conferenceMealCents: number;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Every approved staff, pastor or volunteer registration for the event, for the finance report: who approved it, the worker,
 * the date, and the conference-paid meals recorded on it. Read from the invitation and meal records; nothing is stored twice.
 */
export async function listStaffApprovalsForFinance(eventId: string) {
  const invitations = await getPrisma().staffInvitation.findMany({
    where: { eventId, approval: "APPROVED", registrationId: { not: null } },
    orderBy: [{ decidedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      group: true,
      decidedAt: true,
      registrationId: true,
      decidedBy: { select: { displayName: true } },
      registration: { select: { confirmationCode: true, contactSnapshot: true } },
    },
  });
  if (invitations.length === 0) return { rows: [] as StaffApprovalFinanceRow[], totals: { approvals: 0, conferenceMeals: 0, conferenceMealCents: 0 } };

  const selections = await getPrisma().eventMealSelection.findMany({
    where: {
      eventId,
      payer: "CONFERENCE",
      status: "ACTIVE",
      registrationId: { in: invitations.flatMap((row) => (row.registrationId ? [row.registrationId] : [])) },
    },
    select: { registrationId: true, quantity: true, conferenceRateCents: true },
  });
  const byRegistration = new Map<string, { meals: number; cents: number }>();
  for (const selection of selections) {
    if (!selection.registrationId) continue;
    const entry = byRegistration.get(selection.registrationId) ?? { meals: 0, cents: 0 };
    entry.meals += selection.quantity;
    entry.cents += selection.quantity * selection.conferenceRateCents;
    byRegistration.set(selection.registrationId, entry);
  }

  const rows = invitations.flatMap((row): StaffApprovalFinanceRow[] => {
    if (!row.registration || !row.registrationId) return [];
    const contact = record(row.registration.contactSnapshot);
    const meals = byRegistration.get(row.registrationId) ?? { meals: 0, cents: 0 };
    return [{
      id: row.id,
      approvedBy: row.decidedBy?.displayName ?? null,
      worker: formatPersonName({ firstName: String(contact.firstName ?? ""), lastName: String(contact.lastName ?? "") }),
      group: row.group,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      confirmationCode: row.registration.confirmationCode,
      conferenceMeals: meals.meals,
      conferenceMealCents: meals.cents,
    }];
  });
  return {
    rows,
    totals: {
      approvals: rows.length,
      conferenceMeals: rows.reduce((sum, row) => sum + row.conferenceMeals, 0),
      conferenceMealCents: rows.reduce((sum, row) => sum + row.conferenceMealCents, 0),
    },
  };
}
