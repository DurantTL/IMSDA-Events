import "server-only";

import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  ScholarshipFundError,
  formatCents,
  fundTotals,
  sponsorKey,
  summarizeFund,
  type AwardLine,
  type ContributionMethod,
  type CreateContributionInput,
  type FundAwardInput,
  type FundExportData,
  type FundSummary,
} from "@/modules/scholarship-funds/domain";

/**
 * Event scholarship funds (#398). One fund per event, created the first time
 * something is recorded; nothing carries over to another event or year.
 *
 * Money is integer cents, in the same append-only style as registration
 * adjustments (#396): contribution lines are never edited (a reversal is a
 * new negative line), and an award is the scholarship adjustment line itself
 * plus a `ScholarshipAward` row that says which fund and sponsor it draws on.
 * There is no second ledger: reversing the adjustment line through the
 * existing adjustment reversal is what returns an award's money to the fund.
 *
 * Every write that reads a balance runs SERIALIZABLE and retries serialization
 * conflicts, so two staff members cannot together overspend the fund. A funded
 * award is refused when it would take received minus funded below zero. A
 * pledged award ("pledged, not yet received") is the one deliberate exception:
 * the sponsor has promised money that has not arrived, so it may exceed the
 * balance, is attributed to that sponsor, and shows as outstanding until staff
 * settle it (which requires the money to have been recorded first).
 *
 * Audit rows carry ids, amounts and counts only: never a sponsor name, a note,
 * a reason, or an attendee. Nothing here refunds, charges, or moves money.
 */

type Client = Prisma.TransactionClient;

export async function withSerializableRetry<T>(work: (tx: Client) => Promise<T>) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await getPrisma().$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
      if (!retryable || attempt === 4) throw error;
    }
  }
  throw new Error("unreachable");
}

function today() {
  return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
}

async function actorName(tx: Client, actorUserId: string) {
  const actor = await tx.user.findUnique({ where: { id: actorUserId }, select: { displayName: true } });
  return actor?.displayName ?? "Staff";
}

/** The event's fund, created on first use. A concurrent creation is a no-op, not an error. */
async function ensureFund(tx: Client, eventId: string) {
  const existing = await tx.scholarshipFund.findUnique({ where: { eventId }, select: { id: true } });
  if (existing) return existing.id;
  await tx.scholarshipFund.createMany({ data: [{ eventId }], skipDuplicates: true });
  const created = await tx.scholarshipFund.findUniqueOrThrow({ where: { eventId }, select: { id: true } });
  return created.id;
}

async function resolveSponsor(tx: Client, input: { organizationId?: string; sponsorName?: string }) {
  if (input.organizationId) {
    const organization = await tx.organization.findFirst({
      where: { id: input.organizationId, isActive: true },
      select: { id: true, name: true },
    });
    if (!organization) {
      throw new ScholarshipFundError("SPONSOR_NOT_FOUND", "That church or club is not in the directory.");
    }
    return { organizationId: organization.id, name: organization.name, key: sponsorKey({ organizationId: organization.id, name: organization.name }) };
  }
  const name = input.sponsorName?.trim();
  if (!name) throw new ScholarshipFundError("SPONSOR_REQUIRED", "Choose a church from the directory or type who it is from.");
  return { organizationId: null, name, key: sponsorKey({ name }) };
}

/** Received, funded and pledged cents for a fund, read inside the caller's transaction. */
async function loadTotals(tx: Client, fundId: string) {
  const active = { adjustment: { reversedBy: null } };
  const received = await tx.scholarshipContribution.aggregate({ where: { fundId }, _sum: { amountCents: true } });
  const funded = await tx.scholarshipAward.aggregate({
    where: { fundId, ...active, OR: [{ pledged: false }, { settledAt: { not: null } }] },
    _sum: { amountCents: true },
  });
  const pledged = await tx.scholarshipAward.aggregate({
    where: { fundId, ...active, pledged: true, settledAt: null },
    _sum: { amountCents: true },
  });
  return fundTotals(received._sum.amountCents ?? 0, funded._sum.amountCents ?? 0, pledged._sum.amountCents ?? 0);
}

/**
 * One sponsor's position in a fund: what they gave (reversals included) minus the funded awards attributed to
 * them. Funded means not pledged, or pledged and settled; active means the adjustment line is unreversed.
 */
async function loadSponsorUnallocated(tx: Client, fundId: string, key: string) {
  const received = await tx.scholarshipContribution.aggregate({ where: { fundId, sponsorKey: key }, _sum: { amountCents: true } });
  const awarded = await tx.scholarshipAward.aggregate({
    where: { fundId, sponsorKey: key, adjustment: { reversedBy: null }, OR: [{ pledged: false }, { settledAt: { not: null } }] },
    _sum: { amountCents: true },
  });
  return (received._sum.amountCents ?? 0) - (awarded._sum.amountCents ?? 0);
}

/** Records money received into the event's fund. Records it only: no payment is taken or moved. */
export async function recordContribution(eventId: string, actorUserId: string, input: CreateContributionInput) {
  return withSerializableRetry(async (tx) => {
    const fundId = await ensureFund(tx, eventId);
    const sponsor = await resolveSponsor(tx, input);
    const contribution = await tx.scholarshipContribution.create({
      data: {
        eventId,
        fundId,
        organizationId: sponsor.organizationId,
        sponsorName: sponsor.name,
        sponsorKey: sponsor.key,
        amountCents: input.amountCents,
        receivedOn: new Date(`${input.receivedOn}T00:00:00.000Z`),
        method: input.method,
        note: input.note || null,
        createdByUserId: actorUserId,
        createdByNameSnapshot: await actorName(tx, actorUserId),
      },
      select: { id: true },
    });
    // Adding money reads no balance, so two contributions never conflict with each other.
    await writeAuditLog({
      eventId,
      actorUserId,
      action: "SCHOLARSHIP_CONTRIBUTION_RECORDED",
      entityType: "ScholarshipContribution",
      entityId: contribution.id,
      summary: "Recorded a scholarship fund contribution.",
      metadata: {
        fundId,
        amountCents: input.amountCents,
        method: input.method,
        organizationId: sponsor.organizationId,
      },
    }, tx);
    return contribution.id;
  });
}

/**
 * Cancels a contribution with an opposite line; the original stays on record.
 * Refused when awards already drawn on that money would be left uncovered.
 */
export async function reverseContribution(eventId: string, contributionId: string, actorUserId: string, reason: string) {
  return withSerializableRetry(async (tx) => {
    const original = await tx.scholarshipContribution.findFirst({
      where: { id: contributionId, eventId },
      select: {
        id: true, fundId: true, organizationId: true, sponsorName: true, sponsorKey: true, amountCents: true, method: true,
        reversesContributionId: true, reversedBy: { select: { id: true } },
      },
    });
    if (!original) throw new ScholarshipFundError("CONTRIBUTION_NOT_FOUND", "That contribution could not be found.");
    if (original.reversesContributionId) {
      throw new ScholarshipFundError("CONTRIBUTION_NOT_REVERSIBLE", "That line is already a reversal.");
    }
    if (original.reversedBy) {
      throw new ScholarshipFundError("CONTRIBUTION_ALREADY_REVERSED", "That contribution was already reversed.");
    }
    const totals = await loadTotals(tx, original.fundId);
    if (totals.balanceCents - original.amountCents < 0) {
      throw new ScholarshipFundError(
        "REVERSAL_EXCEEDS_BALANCE",
        `Awards already drawn on this money, and only ${formatCents(totals.balanceCents)} is unspent. Reverse those awards first.`,
      );
    }
    const sponsorUnallocated = await loadSponsorUnallocated(tx, original.fundId, original.sponsorKey);
    if (sponsorUnallocated - original.amountCents < 0) {
      throw new ScholarshipFundError(
        "REVERSAL_EXCEEDS_BALANCE",
        `Awards already drew on this sponsor's money, and only ${formatCents(Math.max(0, sponsorUnallocated))} of what they gave is unspent. Reverse those awards first.`,
      );
    }
    const reversal = await tx.scholarshipContribution.create({
      data: {
        eventId,
        fundId: original.fundId,
        organizationId: original.organizationId,
        sponsorName: original.sponsorName,
        sponsorKey: original.sponsorKey,
        amountCents: -original.amountCents,
        receivedOn: today(),
        method: original.method,
        note: reason,
        reversesContributionId: original.id,
        createdByUserId: actorUserId,
        createdByNameSnapshot: await actorName(tx, actorUserId),
      },
      select: { id: true },
    });
    await writeAuditLog({
      eventId,
      actorUserId,
      action: "SCHOLARSHIP_CONTRIBUTION_REVERSED",
      entityType: "ScholarshipContribution",
      entityId: reversal.id,
      summary: "Reversed a scholarship fund contribution.",
      metadata: {
        fundId: original.fundId,
        reversesContributionId: original.id,
        amountCents: -original.amountCents,
        balanceAfterCents: totals.balanceCents - original.amountCents,
      },
    }, tx);
    return reversal.id;
  });
}

/**
 * Called by the scholarship adjustment (#396) inside its own SERIALIZABLE
 * transaction when staff draw it on the fund. A funded award is checked
 * against the balance; a pledged one is not (see the module comment). The
 * adjustment line has already been created and its total checked.
 */
export async function recordFundAward(
  tx: Client,
  input: {
    eventId: string;
    registrationId: string;
    adjustmentId: string;
    actorUserId: string;
    amountCents: number;
    award: FundAwardInput;
  },
) {
  const { award } = input;
  const fundId = await ensureFund(tx, input.eventId);
  const sponsor = award.organizationId || award.sponsorName ? await resolveSponsor(tx, award) : null;
  if (award.pledged && !sponsor) throw new ScholarshipFundError("SPONSOR_REQUIRED", "Say who pledged the money.");
  // A pledged award is promised money, not drawn from the balance, so it reads none (and conflicts with nothing).
  let balanceBeforeCents: number | null = null;
  if (!award.pledged) {
    const totals = await loadTotals(tx, fundId);
    balanceBeforeCents = totals.balanceCents;
    if (input.amountCents > totals.balanceCents) {
      throw new ScholarshipFundError(
        "FUND_BALANCE_TOO_LOW",
        `The fund has ${formatCents(totals.balanceCents)} available, which is less than ${formatCents(input.amountCents)}. Record the contribution first, or mark the award pledged, not yet received.`,
      );
    }
    // Attributed to a sponsor, it is that sponsor's money being spent. With no sponsor it draws on the fund in general.
    if (sponsor) {
      const unallocated = await loadSponsorUnallocated(tx, fundId, sponsor.key);
      if (input.amountCents > unallocated) {
        throw new ScholarshipFundError(
          "SPONSOR_BALANCE_TOO_LOW",
          `${sponsor.name} has ${formatCents(Math.max(0, unallocated))} unspent in the fund, which is less than ${formatCents(input.amountCents)}. Record their contribution first, mark the award pledged, not yet received, or leave the sponsor blank to draw on the fund in general.`,
        );
      }
    }
  }
  const row = await tx.scholarshipAward.create({
    data: {
      eventId: input.eventId,
      fundId,
      registrationId: input.registrationId,
      adjustmentId: input.adjustmentId,
      amountCents: input.amountCents,
      pledged: award.pledged,
      organizationId: sponsor?.organizationId ?? null,
      sponsorName: sponsor?.name ?? null,
      sponsorKey: sponsor?.key ?? null,
      createdByUserId: input.actorUserId,
    },
    select: { id: true },
  });
  await writeAuditLog({
    eventId: input.eventId,
    actorUserId: input.actorUserId,
    action: "SCHOLARSHIP_AWARD_RECORDED",
    entityType: "ScholarshipAward",
    entityId: row.id,
    summary: award.pledged ? "Awarded a scholarship from the fund, pledged and not yet received." : "Awarded a scholarship from the fund.",
    metadata: {
      fundId,
      registrationId: input.registrationId,
      adjustmentId: input.adjustmentId,
      amountCents: input.amountCents,
      pledged: award.pledged,
      organizationId: sponsor?.organizationId ?? null,
      balanceBeforeCents,
    },
  }, tx);
  return row.id;
}

/**
 * Marks a pledged award as received. The money must already be recorded as a
 * contribution and unspent, so settling can never take the fund below zero.
 */
export async function settlePledgedAward(eventId: string, awardId: string, actorUserId: string) {
  return withSerializableRetry(async (tx) => {
    const award = await tx.scholarshipAward.findFirst({
      where: { id: awardId, eventId },
      select: {
        id: true, fundId: true, amountCents: true, pledged: true, settledAt: true, sponsorKey: true, sponsorName: true,
        registration: { select: { status: true } },
        adjustment: { select: { reversedBy: { select: { id: true } } } },
      },
    });
    if (!award) throw new ScholarshipFundError("AWARD_NOT_FOUND", "That award could not be found.");
    if (!award.pledged) throw new ScholarshipFundError("AWARD_NOT_PLEDGED", "That award was not marked pledged.");
    if (award.settledAt) throw new ScholarshipFundError("AWARD_ALREADY_SETTLED", "That pledge was already marked received.");
    if (award.adjustment.reversedBy) throw new ScholarshipFundError("AWARD_REVERSED", "That award was reversed, so there is nothing to settle.");
    if (award.registration.status !== "SUBMITTED" && award.registration.status !== "CONFIRMED") {
      throw new ScholarshipFundError(
        "AWARD_REGISTRATION_INACTIVE",
        "That registration is no longer active, so its pledge can't be marked received. Reverse the scholarship to release the pledge instead.",
      );
    }
    const totals = await loadTotals(tx, award.fundId);
    if (award.sponsorKey) {
      const unallocated = await loadSponsorUnallocated(tx, award.fundId, award.sponsorKey);
      if (award.amountCents > unallocated) {
        throw new ScholarshipFundError(
          "SETTLE_EXCEEDS_BALANCE",
          `${award.sponsorName ?? "That sponsor"} has ${formatCents(Math.max(0, unallocated))} unspent in the fund. Record their contribution that covers this ${formatCents(award.amountCents)} pledge first.`,
        );
      }
    }
    if (award.amountCents > totals.balanceCents) {
      throw new ScholarshipFundError(
        "SETTLE_EXCEEDS_BALANCE",
        `Only ${formatCents(totals.balanceCents)} is unspent in the fund. Record the contribution that covers this ${formatCents(award.amountCents)} pledge first.`,
      );
    }
    await tx.scholarshipAward.update({ where: { id: award.id }, data: { settledAt: new Date(), settledByUserId: actorUserId } });
    await writeAuditLog({
      eventId,
      actorUserId,
      action: "SCHOLARSHIP_PLEDGE_SETTLED",
      entityType: "ScholarshipAward",
      entityId: award.id,
      summary: "Marked a pledged scholarship as received.",
      metadata: { fundId: award.fundId, amountCents: award.amountCents, balanceBeforeCents: totals.balanceCents },
    }, tx);
    return award.id;
  });
}

export type ContributionView = {
  id: string;
  receivedOn: string;
  sponsorName: string;
  organizationId: string | null;
  method: ContributionMethod;
  amountCents: number;
  note: string | null;
  reversesContributionId: string | null;
  reversed: boolean;
  createdBy: string;
};

export type AwardView = {
  id: string;
  registrationId: string;
  confirmationCode: string;
  sponsorName: string | null;
  amountCents: number;
  pledged: boolean;
  settled: boolean;
  active: boolean;
  /** The award is active but its registration was cancelled: staff should reverse it to return the money. */
  registrationCancelled: boolean;
  createdOn: string;
};

export type FundView = {
  summary: FundSummary;
  contributions: ContributionView[];
  awards: AwardView[];
};

const dateOnly = (value: Date) => value.toISOString().slice(0, 10);

/** The fund page's data: the balance, the matching view, and every line. Empty (all zero) until something is recorded. */
export async function getFundView(eventId: string): Promise<FundView> {
  const prisma = getPrisma();
  const fund = await prisma.scholarshipFund.findUnique({
    where: { eventId },
    select: {
      contributions: {
        orderBy: [{ receivedOn: "desc" }, { createdAt: "desc" }, { id: "asc" }],
        select: {
          id: true, receivedOn: true, sponsorName: true, sponsorKey: true, organizationId: true, method: true, amountCents: true, note: true,
          reversesContributionId: true, reversedBy: { select: { id: true } }, createdByNameSnapshot: true,
        },
      },
      awards: {
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        select: {
          id: true, registrationId: true, amountCents: true, pledged: true, settledAt: true, createdAt: true,
          sponsorName: true, sponsorKey: true, organizationId: true,
          registration: { select: { confirmationCode: true, status: true } },
          adjustment: { select: { reversedBy: { select: { id: true } } } },
        },
      },
    },
  });
  const contributions = fund?.contributions ?? [];
  const awards = fund?.awards ?? [];
  const awardLines: AwardLine[] = awards.map((award) => ({
    id: award.id,
    sponsorKey: award.sponsorKey,
    sponsorName: award.sponsorName,
    organizationId: award.organizationId,
    amountCents: award.amountCents,
    pledged: award.pledged,
    settled: Boolean(award.settledAt),
    active: !award.adjustment.reversedBy,
  }));
  return {
    summary: summarizeFund(contributions, awardLines),
    contributions: contributions.map((line) => ({
      id: line.id,
      receivedOn: dateOnly(line.receivedOn),
      sponsorName: line.sponsorName,
      organizationId: line.organizationId,
      method: line.method,
      amountCents: line.amountCents,
      note: line.note,
      reversesContributionId: line.reversesContributionId,
      reversed: Boolean(line.reversedBy),
      createdBy: line.createdByNameSnapshot,
    })),
    awards: awards.map((award, index) => ({
      id: award.id,
      registrationId: award.registrationId,
      confirmationCode: award.registration.confirmationCode,
      sponsorName: award.sponsorName,
      amountCents: award.amountCents,
      pledged: award.pledged,
      settled: Boolean(award.settledAt),
      active: awardLines[index]!.active,
      registrationCancelled: awardLines[index]!.active && award.registration.status === "CANCELLED",
      createdOn: dateOnly(award.createdAt),
    })),
  };
}

export type SponsorDirectoryEntry = { id: string; name: string; place: string };

/**
 * Active churches, clubs, companies and groups from the shared directory, for the sponsor picker. Names and the
 * town only: no contact detail leaves the directory.
 */
export async function listSponsorDirectory(): Promise<SponsorDirectoryEntry[]> {
  const rows = await getPrisma().organization.findMany({
    where: { isActive: true, type: { in: ["CHURCH", "CLUB", "COMPANY", "GROUP"] } },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 3000,
    select: { id: true, name: true, city: true, state: true },
  });
  return rows.map((row) => ({ id: row.id, name: row.name, place: [row.city, row.state].filter(Boolean).join(", ") }));
}

/** The finance export's data, audited with counts only. */
export async function exportFund(eventId: string, actorUserId: string): Promise<FundExportData> {
  const prisma = getPrisma();
  const [event, view] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId }, select: { name: true } }),
    getFundView(eventId),
  ]);
  await writeAuditLog({
    eventId,
    actorUserId,
    action: "SCHOLARSHIP_FUND_EXPORTED",
    entityType: "ScholarshipFund",
    summary: "Exported the scholarship fund.",
    metadata: { contributionLines: view.contributions.length, awardLines: view.awards.length, balanceCents: view.summary.balanceCents },
  });
  return {
    eventName: event?.name ?? "",
    summary: view.summary,
    contributions: view.contributions.map((line) => ({
      id: line.id, receivedOn: line.receivedOn, sponsorName: line.sponsorName, method: line.method, amountCents: line.amountCents,
      reversesContributionId: line.reversesContributionId, note: line.note,
    })),
    awards: view.awards.map((award) => ({
      id: award.id, confirmationCode: award.confirmationCode, sponsorName: award.sponsorName, amountCents: award.amountCents,
      pledged: award.pledged, settled: award.settled, active: award.active, createdOn: award.createdOn,
    })),
  };
}
