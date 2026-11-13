/**
 * Proves the event closeout and finance sign-off (#1515) against a real PostgreSQL database, on a synthetic event in
 * Financial reconciliation:
 *
 * - a pending refund blocks: the sign-off is refused and nothing is written; the generic lifecycle move to Closed and
 *   the generic reopen are refused and point at the Closeout page;
 * - once the refund settles, open warnings (a balance, a failed payment, a failed message, a waitlisted registration,
 *   Square not checked) must be acknowledged; a reports-only account may not sign off; a stale page version is refused;
 * - an account holding only finalize-invoices signs off: the event is Closed in the same transaction, the sign-off row
 *   holds the signer's name and a checklist snapshot of ids, states, counts and cents only (no attendee name or email),
 *   the transition's evidence carries the sign-off id and the sign-off carries the transition id, and the audit row holds
 *   ids and counts;
 * - a second sign-off is refused; reopening needs a reason, writes its own row pointing at the sign-off, and moves the
 *   event back; a second cycle keeps every sign-off and reopening in the history;
 * - the sign-off and reopening tables refuse every UPDATE and DELETE, survive the signer's account being deleted, and
 *   go only with their event.
 *
 * Uses fictitious rows it creates and removes itself. Square is not called (it is not configured here).
 *
 *   npm run test:event-closeout
 */
import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";
import { getCloseoutView, reopenClosedEvent, signOffEvent, CloseoutError } from "../modules/events/closeout-repository";
import { EventLifecycleError, transitionEventLifecycle } from "../modules/events/lifecycle-repository";

loadEnvConfig(process.cwd());
assertLocalDatabase(process.env, "run this verification");

const prisma = new PrismaClient();
const P = `eco1515_${randomUUID().slice(0, 8)}`;
const finance = { userId: `${P}_finance`, permissions: ["MANAGE_FINANCE"] as const };
const invoicer = { userId: `${P}_invoicer`, permissions: ["FINALIZE_INVOICES"] as const };
const reports = { userId: `${P}_reports`, permissions: ["VIEW_REPORTS"] as const };
const eventId = `${P}_event`;
const person = `${P}_person`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function caught(promise: Promise<unknown>) {
  try { await promise; return null; } catch (error) { return error; }
}

async function cleanup() {
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: { startsWith: P } }, { eventId: { startsWith: P } }] } });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('imsda.event_deletion', 'on', true)`;
    await tx.event.deleteMany({ where: { id: { startsWith: P } } });
  });
  await prisma.registration.deleteMany({ where: { eventId: { startsWith: P } } });
  await prisma.person.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
}

const version = async () => (await prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { lifecycleVersion: true } })).lifecycleVersion;
const stateOf = async () => (await prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { lifecycleState: true } })).lifecycleState;
const signoffCount = () => prisma.eventCloseoutSignoff.count({ where: { eventId } });

async function main() {
  await cleanup();
  try {
    for (const [actor, name] of [[finance, "Pat Finance"], [invoicer, "Ivy Invoices"], [reports, "Rae Reports"]] as const) {
      await prisma.user.create({ data: { id: actor.userId, email: `${actor.userId}@example.test`, displayName: name } });
    }
    await prisma.person.create({ data: { id: person, firstName: "Sample", lastName: "Registrant" } });
    const day = 86_400_000;
    await prisma.event.create({
      data: {
        id: eventId, slug: `${P.replace(/_/g, "-")}-slug`, name: "Closeout Check Event", startsAt: new Date(Date.now() - 5 * day), endsAt: new Date(Date.now() - 4 * day),
        isPublished: true, lifecycleState: "FINANCIAL_RECONCILIATION", audience: "GENERAL", billingMode: "ATTENDEE_PAY",
      },
    });
    const reg = await prisma.registration.create({ data: { eventId, accountHolderPersonId: person, confirmationCode: "ECO-1", status: "CONFIRMED", totalAmount: 50 }, select: { id: true } });
    const waiting = await prisma.registration.create({ data: { eventId, accountHolderPersonId: person, confirmationCode: "ECO-2", status: "WAITLISTED", totalAmount: 0 }, select: { id: true } });
    await prisma.registrationWaitlistEntry.create({ data: { eventId, registrationId: waiting.id, position: 1, attendeeCount: 1, status: "WAITING" } });
    const paid = await prisma.payment.create({ data: { eventId, registrationId: reg.id, amount: 50, method: "CASH", status: "SUCCEEDED" }, select: { id: true } });
    await prisma.payment.create({ data: { eventId, registrationId: reg.id, amount: 5, method: "CHECK", status: "FAILED" } });
    const pendingRefund = await prisma.refund.create({ data: { eventId, paymentId: paid.id, amount: 10, status: "PENDING" }, select: { id: true } });
    await prisma.messageOutbox.create({
      data: {
        eventId, registrationId: reg.id, templateKey: "REGISTRATION_CONFIRMATION_PAID", recipientKind: "REGISTRANT", recipientEmail: `${P}@example.test`,
        senderNameSnapshot: "Synthetic Sender", subjectSnapshot: "Synthetic", bodyTextSnapshot: "Synthetic", idempotencyKey: `${P}_msg`, correlationId: `${P}_corr`, status: "FAILED",
      },
    });

    // 1. A pending refund blocks.
    const before = await getCloseoutView(eventId, { canReadText: true });
    assert(before && before.state === "FINANCIAL_RECONCILIATION", "the view reads the state");
    const byId = new Map(before.checks.map((check) => [check.id, check]));
    assert(byId.get("pending-refunds")?.state === "blocking" && byId.get("pending-refunds")?.count === 1, "a pending refund is blocking");
    assert(byId.get("failed-payments")?.state === "warning" && byId.get("failed-messages")?.state === "warning" && byId.get("waitlist")?.state === "warning", "failed payment, failed message and waitlist are warnings");
    assert(byId.get("unmatched-square")?.state === "warning", "Square not checked is a warning, never ready");
    assert(before.summary.canSignOff === false, "blocked");
    const blocked = await caught(signOffEvent({ eventId, actor: finance, acknowledgeWarnings: true, expectedVersion: before.lifecycleVersion, seenOpenChecks: before.openChecks }));
    assert(blocked instanceof CloseoutError && blocked.code === "BLOCKING_CHECKS", "sign-off is refused while a check blocks");
    assert((await signoffCount()) === 0 && (await stateOf()) === "FINANCIAL_RECONCILIATION" && (await version()) === before.lifecycleVersion, "a refused sign-off writes nothing");

    // 2. The generic move to Closed (and the generic reopen) is refused.
    const plain = await caught(transitionEventLifecycle({ eventId, toState: "CLOSED", expectedFromState: "FINANCIAL_RECONCILIATION", actor: finance }));
    assert(plain instanceof EventLifecycleError && plain.code === "CLOSEOUT_REQUIRED" && /Closeout page/.test(plain.message), "a plain close is refused and points at the Closeout page");
    assert((await stateOf()) === "FINANCIAL_RECONCILIATION", "the plain close changed nothing");

    // 3. Settle the refund: warnings now need acknowledging.
    await prisma.refund.update({ where: { id: pendingRefund.id }, data: { status: "SUCCEEDED" } });
    const cleared = await getCloseoutView(eventId, { canReadText: true });
    assert(cleared && cleared.summary.blocking === 0 && cleared.summary.warning >= 5, `no blocking check, several warnings (${JSON.stringify(cleared?.summary)})`);
    assert(cleared.checks.find((check) => check.id === "outstanding-balances")?.count === 1, "the refunded registration owes a balance");
    const unacknowledged = await caught(signOffEvent({ eventId, actor: finance, acknowledgeWarnings: false, expectedVersion: cleared.lifecycleVersion, seenOpenChecks: cleared.openChecks }));
    assert(unacknowledged instanceof CloseoutError && unacknowledged.code === "WARNINGS_NOT_ACKNOWLEDGED", "open warnings must be acknowledged");
    const viewer = await caught(signOffEvent({ eventId, actor: reports, acknowledgeWarnings: true, expectedVersion: cleared.lifecycleVersion, seenOpenChecks: cleared.openChecks }));
    assert(viewer instanceof EventLifecycleError && viewer.code === "PERMISSION_DENIED", "a reports-only account may not sign off");
    const stale = await caught(signOffEvent({ eventId, actor: finance, acknowledgeWarnings: true, expectedVersion: cleared.lifecycleVersion - 1, seenOpenChecks: cleared.openChecks }));
    assert(stale instanceof CloseoutError && stale.code === "STALE_VERSION", "a stale page version is refused");
    const tooLong = await caught(signOffEvent({ eventId, actor: finance, acknowledgeWarnings: true, note: "x".repeat(501), expectedVersion: cleared.lifecycleVersion, seenOpenChecks: cleared.openChecks }));
    assert(tooLong instanceof CloseoutError && tooLong.code === "NOTE_TOO_LONG", "a long note is refused");
    assert((await signoffCount()) === 0 && (await stateOf()) === "FINANCIAL_RECONCILIATION", "every refusal left nothing behind");

    // The warnings tick belongs to the list the signer saw: a different open set is refused as stale.
    const staleSet = await caught(signOffEvent({ eventId, actor: finance, acknowledgeWarnings: true, expectedVersion: cleared.lifecycleVersion, seenOpenChecks: cleared.openChecks.filter((entry) => !entry.startsWith("waitlist:")) }));
    assert(staleSet instanceof CloseoutError && staleSet.code === "STALE_CHECKLIST" && staleSet.message === "The checklist changed; review it again.", "an open set the signer did not see is refused as stale");
    const noneSeen = await caught(signOffEvent({ eventId, actor: finance, acknowledgeWarnings: true, expectedVersion: cleared.lifecycleVersion, seenOpenChecks: [] }));
    assert(noneSeen instanceof CloseoutError && noneSeen.code === "STALE_CHECKLIST", "an empty seen set is refused as stale");
    assert((await signoffCount()) === 0 && (await stateOf()) === "FINANCIAL_RECONCILIATION", "stale refusals left nothing behind");

    // 4. A finalize-invoices account signs off.
    const signed = await signOffEvent({ eventId, actor: invoicer, acknowledgeWarnings: true, note: "Reviewed the open items.", expectedVersion: cleared.lifecycleVersion, seenOpenChecks: cleared.openChecks });
    assert((await stateOf()) === "CLOSED", "the event is Closed");
    const signoff = await prisma.eventCloseoutSignoff.findUniqueOrThrow({ where: { id: signed.signoffId } });
    assert(signoff.signedByNameSnapshot === "Ivy Invoices" && signoff.signedByUserId === invoicer.userId && signoff.warningsAcknowledged && signoff.note === "Reviewed the open items.", "the sign-off records the name, acknowledgement and note");
    const snapshotText = JSON.stringify(signoff.checklistSnapshot);
    const stored = signoff.checklistSnapshot as { checkedAt?: string; checks?: unknown[] };
    assert(typeof stored.checkedAt === "string" && !Number.isNaN(Date.parse(stored.checkedAt)) && Array.isArray(stored.checks) && stored.checks.length === 12, "the snapshot holds a checkedAt time and all twelve checks");
    assert(!/Sample|Registrant|@|ECO-/.test(snapshotText), "the snapshot holds no name, email or code");
    for (const row of stored.checks as Array<Record<string, unknown>>) assert(Object.keys(row).sort().join() === "cents,count,id,state", "each snapshot row is id, state, count, cents");
    const closing = await prisma.eventLifecycleTransition.findUniqueOrThrow({ where: { id: signoff.transitionId! } });
    assert(closing.fromState === "FINANCIAL_RECONCILIATION" && closing.toState === "CLOSED" && closing.actorUserId === invoicer.userId, "the transition to Closed is the sign-off's");
    assert((closing.evidence as { signoffId?: string } | null)?.signoffId === signoff.id, "the transition evidence carries the sign-off id");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { eventId, action: "EVENT_CLOSEOUT_SIGNED_OFF" } });
    assert(audit.entityId === signoff.id && !/Ivy|Sample|Reviewed/.test(JSON.stringify(audit)), "the audit row holds ids and counts, no name or note");
    const again = await caught(signOffEvent({ eventId, actor: finance, acknowledgeWarnings: true, expectedVersion: signed.lifecycleVersion, seenOpenChecks: cleared.openChecks }));
    assert(again instanceof CloseoutError && again.code === "ALREADY_DONE", "a second sign-off is refused");

    // 5. Reopen.
    const closedView = await getCloseoutView(eventId, { canReadText: true });
    assert(closedView && closedView.state === "CLOSED" && closedView.history.length === 1 && closedView.history[0]!.reopened === null, "closed, one sign-off, not reopened");
    const plainReopen = await caught(transitionEventLifecycle({ eventId, toState: "FINANCIAL_RECONCILIATION", expectedFromState: "CLOSED", actor: finance, reason: "plain" }));
    assert(plainReopen instanceof EventLifecycleError && plainReopen.code === "CLOSEOUT_REQUIRED", "a plain reopen is refused");
    const noReason = await caught(reopenClosedEvent({ eventId, actor: finance, reason: "   ", expectedVersion: closedView.lifecycleVersion }));
    assert(noReason instanceof CloseoutError && noReason.code === "REASON_REQUIRED", "reopening needs a reason");
    const reopenDenied = await caught(reopenClosedEvent({ eventId, actor: reports, reason: "Late invoice", expectedVersion: closedView.lifecycleVersion }));
    assert(reopenDenied instanceof EventLifecycleError && reopenDenied.code === "PERMISSION_DENIED", "a reports-only account may not reopen");
    assert((await stateOf()) === "CLOSED", "refused reopenings changed nothing");
    const reopened = await reopenClosedEvent({ eventId, actor: finance, reason: "Late invoice arrived", expectedVersion: closedView.lifecycleVersion });
    assert((await stateOf()) === "FINANCIAL_RECONCILIATION", "back in Financial reconciliation");
    const reopening = await prisma.eventCloseoutReopening.findUniqueOrThrow({ where: { id: reopened.reopeningId } });
    assert(reopening.signoffId === signoff.id && reopening.reopenedByNameSnapshot === "Pat Finance" && reopening.reason === "Late invoice arrived" && reopening.transitionId, "the reopening points at the sign-off and records who and why");
    const afterReopen = await getCloseoutView(eventId, { canReadText: true });
    assert(afterReopen && afterReopen.history.length === 1 && afterReopen.history[0]!.reopened?.reason === "Late invoice arrived" && afterReopen.history[0]!.signedByName === "Ivy Invoices", "the sign-off stays listed with its reopening");
    const hidden = await getCloseoutView(eventId, { canReadText: false });
    assert(hidden && hidden.history[0]!.note === null && hidden.history[0]!.reopened?.reason === null && hidden.history[0]!.reopened?.byName === "Pat Finance", "a viewer who may not read free text gets no note and no reopening reason, only the names");
    assert(!JSON.stringify(hidden).includes("Late invoice arrived") && !JSON.stringify(hidden).includes("Reviewed the open items"), "no free text anywhere in that view");
    const unchanged = await prisma.eventCloseoutSignoff.findUniqueOrThrow({ where: { id: signoff.id } });
    assert(JSON.stringify(unchanged) === JSON.stringify(signoff), "reopening left the sign-off row exactly as it was");

    // 6. A second cycle keeps both.
    const second = await signOffEvent({ eventId, actor: finance, acknowledgeWarnings: true, expectedVersion: afterReopen.lifecycleVersion, seenOpenChecks: afterReopen.openChecks });
    const closedAgain = await getCloseoutView(eventId, { canReadText: true });
    assert(closedAgain && closedAgain.history.length === 2 && closedAgain.history[0]!.id === second.signoffId && closedAgain.history[0]!.reopened === null && closedAgain.history[1]!.reopened !== null, "two sign-offs, the newest in force");
    await reopenClosedEvent({ eventId, actor: invoicer, reason: "Second look", expectedVersion: closedAgain.lifecycleVersion });
    const final = await getCloseoutView(eventId, { canReadText: true });
    assert(final && final.history.length === 2 && final.history.every((entry) => entry.reopened !== null), "both sign-offs stay, both reopened");
    assert((await prisma.eventLifecycleTransition.count({ where: { eventId, toState: "CLOSED" } })) === 2 && (await prisma.auditLog.count({ where: { eventId, action: "EVENT_CLOSEOUT_REOPENED" } })) === 2, "history and audit rows for both cycles");

    // 7. Append-only, and the signer's account can go.
    for (const statement of [
      () => prisma.$executeRaw`UPDATE "EventCloseoutSignoff" SET "note" = 'changed' WHERE "id" = ${signoff.id}`,
      () => prisma.$executeRaw`DELETE FROM "EventCloseoutSignoff" WHERE "id" = ${signoff.id}`,
      () => prisma.$executeRaw`UPDATE "EventCloseoutReopening" SET "reason" = 'changed' WHERE "id" = ${reopening.id}`,
      () => prisma.$executeRaw`DELETE FROM "EventCloseoutReopening" WHERE "id" = ${reopening.id}`,
    ]) {
      assert((await caught(statement())) !== null, "the history tables refuse update and delete");
    }
    await prisma.user.delete({ where: { id: invoicer.userId } });
    assert((await prisma.eventCloseoutSignoff.findUniqueOrThrow({ where: { id: signoff.id } })).signedByNameSnapshot === "Ivy Invoices", "deleting the signer's account leaves the sign-off and its name");
    await cleanup();
    assert((await prisma.eventCloseoutSignoff.count({ where: { eventId } })) === 0, "event deletion takes the history with it");
    console.log("Event closeout verified.");
  } finally {
    await cleanup().catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
