import "server-only";

import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { createPendingAreaCoordinatorInvite, inviteMinistries } from "@/modules/organizations/area-coordinator-invites";
import { areaGrantActive } from "@/modules/organizations/area-coordinators";
import {
  areaCoordinatorPublicStep,
  parseAreaCoordinatorCsv,
  planAreaCoordinatorImport,
} from "@/modules/organizations/area-coordinator-import-domain";

/**
 * Area Coordinator CSV import (#1608). The preview and the save share one plan, so what the administrator confirmed is
 * what is saved. Saving creates PENDING invites only; nothing is emailed until Send.
 */

async function planFor(csv: string, now: Date) {
  const rows = parseAreaCoordinatorCsv(csv);
  const prisma = getPrisma();
  const emails = [...new Set(rows.filter((row) => !row.problem).map((row) => row.email))];
  const [accounts, openInvites] = emails.length === 0 ? [[], []] : await Promise.all([
    prisma.attendeeAccount.findMany({
      where: { email: { in: emails } },
      select: { id: true, email: true, areaCoordinatorGrant: { select: { revokedAt: true, expiresAt: true } } },
    }),
    prisma.areaCoordinatorInvite.findMany({ where: { email: { in: emails }, status: { in: ["PENDING", "SENT"] } }, select: { email: true } }),
  ]);
  return planAreaCoordinatorImport(rows, {
    grantEmails: new Set(accounts.filter((account) => areaGrantActive(account.areaCoordinatorGrant, now)).map((account) => account.email.trim().toLowerCase())),
    openInviteEmails: new Set(openInvites.map((invite) => invite.email)),
  });
}

export async function previewAreaCoordinatorImport(csv: string, now = new Date()) {
  const plan = await planFor(csv, now);
  return { steps: plan.map(areaCoordinatorPublicStep) };
}

/** Creates one PENDING invite per Add row (a row that lost a race becomes a skip) and writes one audit entry: the count only. */
export async function confirmAreaCoordinatorImport(csv: string, actorUserId: string, now = new Date(), ministries?: readonly string[]) {
  // One choice for the whole file (#843); refused before anything is written.
  const chosen = inviteMinistries(ministries);
  const plan = await planFor(csv, now);
  const prisma = getPrisma();
  const steps = [];
  let added = 0;
  for (const step of plan) {
    if (step.action !== "ADD") {
      steps.push(areaCoordinatorPublicStep(step));
      continue;
    }
    const { created } = await createPendingAreaCoordinatorInvite(prisma, { email: step.email, name: step.inviteName, actorUserId, ministries: chosen });
    if (created) {
      added += 1;
      steps.push({ ...areaCoordinatorPublicStep(step), message: "Added as a pending invite. Not emailed yet." });
    } else {
      steps.push({ ...areaCoordinatorPublicStep(step), action: "SKIP" as const, message: "Already has an open Area Coordinator invite." });
    }
  }
  if (added > 0) {
    await writeAuditLog({
      actorUserId,
      action: "AREA_COORDINATOR_INVITES_IMPORTED",
      entityType: "AreaCoordinatorInvite",
      summary: `Imported ${added} Area Coordinator invite${added === 1 ? "" : "s"} from a CSV.`,
      metadata: { count: added, rows: plan.length, ministries: chosen },
    });
  }
  return { steps, added };
}
