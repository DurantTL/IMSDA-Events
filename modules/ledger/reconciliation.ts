import "server-only";

import type { PrismaClient } from "@prisma/client";
import { deriveRegistrationTotalCents } from "@/modules/ledger/domain";
import { moneyToCents } from "@/modules/payments/square-domain";

/**
 * Shadow reconciliation (#117): for each registration, the total derived from its ledger entries against the stored
 * `Registration.totalAmount`, which stays authoritative. Read-only. Slices 2 to 5 lean on this as their safety net.
 */
export type LedgerDiscrepancy = {
  registrationId: string;
  confirmationCode: string;
  status: string;
  expectedCents: number;
  ledgerCents: number;
  differenceCents: number;
  entryCount: number;
  hasNoEntries: boolean;
};

export type LedgerReconciliation = {
  checked: number;
  failing: LedgerDiscrepancy[];
};

type Reader = Pick<PrismaClient, "registration" | "registrationLedgerEntry">;

export async function reconcileRegistrationLedger(
  client: Reader,
  scope: { eventId: string; registrationIds?: readonly string[] },
): Promise<LedgerReconciliation> {
  const registrationFilter = scope.registrationIds ? { id: { in: [...scope.registrationIds] } } : {};
  const [registrations, entries] = await Promise.all([
    client.registration.findMany({
      where: { eventId: scope.eventId, ...registrationFilter },
      select: { id: true, confirmationCode: true, status: true, totalAmount: true },
      orderBy: [{ confirmationCode: "asc" }, { id: "asc" }],
    }),
    client.registrationLedgerEntry.findMany({
      where: {
        eventId: scope.eventId,
        ...(scope.registrationIds ? { registrationId: { in: [...scope.registrationIds] } } : {}),
      },
      select: { registrationId: true, amountCents: true },
    }),
  ]);
  const byRegistration = new Map<string, Array<{ amountCents: number }>>();
  for (const entry of entries) {
    const list = byRegistration.get(entry.registrationId);
    if (list) list.push(entry);
    else byRegistration.set(entry.registrationId, [entry]);
  }
  const failing: LedgerDiscrepancy[] = [];
  for (const registration of registrations) {
    const own = byRegistration.get(registration.id) ?? [];
    const ledgerCents = deriveRegistrationTotalCents(own);
    const expectedCents = moneyToCents(registration.totalAmount);
    if (own.length > 0 && ledgerCents === expectedCents) continue;
    failing.push({
      registrationId: registration.id,
      confirmationCode: registration.confirmationCode,
      status: registration.status,
      expectedCents,
      ledgerCents,
      differenceCents: expectedCents - ledgerCents,
      entryCount: own.length,
      hasNoEntries: own.length === 0,
    });
  }
  return { checked: registrations.length, failing };
}
