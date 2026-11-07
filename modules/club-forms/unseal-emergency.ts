import "server-only";

import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { isSecretEncryptionConfigured } from "@/lib/secret-box";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { ClubFormError } from "@/modules/club-forms/errors";
import { EMERGENCY_PLAIN_DECISION_DATE, EMERGENCY_PLAIN_KEYS } from "@/modules/club-forms/plain-emergency";
import { openSensitiveAnswers, sealSensitiveAnswers } from "@/modules/club-forms/sealed-answers";
import { RESEAL_TRANSACTION } from "@/modules/club-forms/templates";
import { lockClubFormTemplateForReseal } from "@/modules/club-forms/template-lock";

/**
 * Moves the emergency contact and physician/clinic answers of the Off-Premises
 * Permission Slip and the Transportation Passenger List out of each existing
 * submission's sealed value and into its plain answers (owner decision,
 * 2026-11-07; `plain-emergency.ts`). Every other sealed answer stays sealed;
 * when nothing sensitive is left, the sealed value is dropped.
 *
 * Run by a human, after `npm run club-forms:sync` has made the keys plain on
 * the template (`npm run club-forms:unseal-emergency`). Dry run unless
 * `execute` is true. Idempotent: a submission with none of these keys in its
 * sealed value is left alone. One transaction per template, under the same
 * row lock a re-seal takes, so a failure changes nothing for that template.
 * Reports and audit rows carry template keys, submission ids and counts only,
 * never an answer.
 */

type Client = Prisma.TransactionClient | ReturnType<typeof getPrisma>;

export type UnsealTemplateReport = {
  templateKey: string;
  status: "DONE" | "DRY_RUN" | "NOT_PRESENT" | "NOT_SYNCED" | "FAILED";
  /** Submissions looked at that carry a sealed value. */
  scanned: number;
  /** Submissions that hold at least one of the keys in their sealed value (changed when executed). */
  submissionsMoved: number;
  /** Individual answers moved. */
  answersMoved: number;
  /** Submissions whose sealed value was dropped because nothing sensitive remained. */
  sealedDropped: number;
  failedSubmissionIds: string[];
  message?: string;
};

export type UnsealEmergencyResult = { execute: boolean; templates: UnsealTemplateReport[] };

export async function unsealEmergencyAnswers(
  client: Client = getPrisma(),
  options: { execute?: boolean; actorUserId?: string } = {},
): Promise<UnsealEmergencyResult> {
  const execute = options.execute === true;
  // Every executed run is attributed to a person: there is no fallback actor.
  if (execute && !options.actorUserId) throw new ClubFormError("INVALID_TEMPLATE", "An executed run needs the user who runs it (--actor <email>).");
  const templates: UnsealTemplateReport[] = [];
  for (const [templateKey, keys] of Object.entries(EMERGENCY_PLAIN_KEYS)) {
    templates.push(await unsealOneTemplate(client, templateKey, new Set(keys), execute, options.actorUserId));
  }
  return { execute, templates };
}

function emptyReport(templateKey: string, status: UnsealTemplateReport["status"], message?: string): UnsealTemplateReport {
  return { templateKey, status, scanned: 0, submissionsMoved: 0, answersMoved: 0, sealedDropped: 0, failedSubmissionIds: [], message };
}

async function unsealOneTemplate(client: Client, templateKey: string, keys: ReadonlySet<string>, execute: boolean, actorUserId?: string): Promise<UnsealTemplateReport> {
  const template = await client.clubFormTemplate.findUnique({ where: { key: templateKey }, select: { id: true } });
  if (!template) return emptyReport(templateKey, "NOT_PRESENT", "No such template here.");
  if (!isSecretEncryptionConfigured()) {
    throw new ClubFormError("ENCRYPTION_NOT_CONFIGURED", "Encryption isn't set up, so sealed answers can't be read.");
  }
  const report = emptyReport(templateKey, execute ? "DONE" : "DRY_RUN");

  const apply = async (tx: Prisma.TransactionClient) => {
    // A dry run only reads: it takes no lock. A real run waits for in-flight saves and holds off new ones until it commits.
    const locked = execute
      ? await lockClubFormTemplateForReseal(tx, template.id)
      : await tx.clubFormTemplate.findUnique({ where: { id: template.id }, select: { sensitiveFieldKeys: true } });
    // While the template still lists a key as sensitive, a save would seal it again: sync first.
    if (!locked || locked.sensitiveFieldKeys.some((key) => keys.has(key))) {
      return emptyReport(templateKey, "NOT_SYNCED", "The template still lists these answers as sensitive. Run npm run club-forms:sync first.");
    }
    // Pass 1 reads and decrypts everything and plans every change, so an unreadable value stops the run before
    // any write, even when this runs inside a caller's transaction that cannot be rolled back from here.
    const planned: Array<{ id: string; plain: Record<string, unknown>; remaining: Record<string, unknown> }> = [];
    let cursor: string | undefined;
    for (;;) {
      const batch = await tx.clubFormSubmission.findMany({
        where: { templateId: template.id, sealedSensitiveAnswers: { not: null } },
        orderBy: { id: "asc" },
        take: 100,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        select: { id: true, answers: true, sealedSensitiveAnswers: true },
      });
      if (batch.length === 0) break;
      cursor = batch[batch.length - 1].id;
      for (const row of batch) {
        report.scanned += 1;
        let sealed: Record<string, unknown>;
        try {
          sealed = openSensitiveAnswers(row.id, row.sealedSensitiveAnswers!);
        } catch {
          report.failedSubmissionIds.push(row.id);
          continue;
        }
        const toMove = Object.keys(sealed).filter((key) => keys.has(key));
        if (toMove.length === 0) continue;
        const plain = { ...(row.answers as Record<string, unknown>) };
        for (const key of toMove) {
          plain[key] = sealed[key];
          delete sealed[key];
        }
        report.submissionsMoved += 1;
        report.answersMoved += toMove.length;
        if (Object.keys(sealed).length === 0) report.sealedDropped += 1;
        if (execute) planned.push({ id: row.id, plain, remaining: sealed });
      }
    }
    if (report.failedSubmissionIds.length > 0) throw new UnsealFailed(report.failedSubmissionIds);
    // Pass 2: the writes. A failure here propagates, so the transaction (ours or the caller's) rolls back.
    for (const change of planned) {
      const remaining = Object.keys(change.remaining).length > 0;
      await tx.clubFormSubmission.update({
        where: { id: change.id },
        data: {
          answers: change.plain as Prisma.InputJsonValue,
          sealedSensitiveAnswers: remaining ? sealSensitiveAnswers(change.id, change.remaining) : null,
          hasSensitiveAnswers: remaining,
        },
      });
    }
    if (execute && report.submissionsMoved > 0) {
      await writeAuditLog({
        actorUserId,
        action: "CLUB_FORM_EMERGENCY_ANSWERS_UNSEALED",
        entityType: "ClubFormTemplate",
        entityId: template.id,
        summary: "Moved emergency contact and physician/clinic answers from sealed to plain (owner decision).",
        metadata: {
          templateKey,
          decision: EMERGENCY_PLAIN_DECISION_DATE,
          scanned: report.scanned,
          submissionsMoved: report.submissionsMoved,
          answersMoved: report.answersMoved,
          sealedDropped: report.sealedDropped,
        },
      }, tx);
    }
    return report;
  };

  try {
    // A dry run writes nothing, so it needs no transaction.
    return execute && "$transaction" in client ? await client.$transaction(apply, RESEAL_TRANSACTION) : await apply(client as Prisma.TransactionClient);
  } catch (error) {
    if (error instanceof UnsealFailed) {
      return {
        ...emptyReport(templateKey, "FAILED", "Some sealed values could not be read on this server, so nothing was changed for this template."),
        scanned: report.scanned,
        failedSubmissionIds: error.ids,
      };
    }
    throw error;
  }
}

class UnsealFailed extends Error {
  constructor(readonly ids: string[]) {
    super("Sealed values could not be read.");
  }
}
