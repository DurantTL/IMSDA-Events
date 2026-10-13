/**
 * Proves issued assets slice 2 (#214: returns, loss and damage, the cash key deposit, charges and waivers, facility
 * blocks and the closeout) against a real PostgreSQL database, where unit tests cannot. It is the Camp Meeting need:
 * two numbered keys per dorm room, a $5 to $10 cash deposit at check-in, each key returned at check-out, and the deposit
 * handed back in full only if both keys come back.
 *
 * - partial group checkout: one of two keys comes back, the deposit cannot settle; the second comes back and the whole
 *   deposit is recorded as handed back; it settles once, and the registration's balance never moved;
 * - a lost key replaced in the same step: the replacement is issued to the same holder, covered by the same deposit, and
 *   because a covered key was lost the deposit is kept (never a full refund); a damaged key under the keep-fees policy
 *   keeps only the replacement fee;
 * - a charge posts to the registration as an append-only ASSET line, check-in staff may record only the standard fee, a
 *   waiver needs finance or an administrator and a reason and is the reversing line, and nothing is rewritten or deleted;
 * - a lot returned in part ends the issue and leaves the remainder out as a new issue pointing back at it;
 * - duplicate returns, repeated and offline sheets, a key that was never out, and eight racing returns write one
 *   return, never two;
 * - a facility issue and a room block: the block takes the room out of availability for the nights and places no one
 *   differently (the assignment is untouched, and the rooming report lists the conflict); releasing it restores the room;
 * - the closeout lists what is out, lost, charged, held and unresolved, reconciles issued against returned, lost,
 *   damaged and still out, never writes, and exports CSV that cannot run as a formula;
 * - the database itself refuses a rewrite, a delete and an over-settlement of the money ledger, and a finished
 *   facility issue never changes again; every row goes with its event, in the deletion service's order.
 *
 * Uses fictitious rows it creates and removes itself.
 *
 *   npm run test:issued-assets-returns
 */
import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";
import { fillBlankSyntheticEnv } from "./support/synthetic-env";
import { removeEventOwnedRows } from "@/modules/events/deletion-repository";
import { AssetError, type AssetErrorCode } from "@/modules/issued-assets/errors";
import { closeoutCsv, closeoutSections, getCloseoutReport } from "@/modules/issued-assets/closeout";
import { applyFacilityAction } from "@/modules/issued-assets/facility-service";
import { recordOutcomeCorrection } from "@/modules/issued-assets/corrections";
import { depositHeldCents, postCharge, recordDeposit, recordLateDepositRefund, settleDeposit, waiveCharge } from "@/modules/issued-assets/money-service";
import { returnAssets, type ReturnItemResult } from "@/modules/issued-assets/returns-service";
import { getDeskMoney, listFacilityIssues } from "@/modules/issued-assets/returns-view";
import { applyAssetAction, applyAssetTypeAction, applyIssuanceAction, issueAssets } from "@/modules/issued-assets/service";
import { getDeskPerson } from "@/modules/issued-assets/view";
import { applyAssignmentAction } from "@/modules/lodging/assignment-service";
import { getRoomingReports } from "@/modules/lodging/assignment-view";
import { changeHold, getLodgingView, selectEventProperty } from "@/modules/lodging/service";
import { syncLodgingTemplates } from "@/modules/lodging/sync";
import { reverseRegistrationAdjustment } from "@/modules/registrations/adjustments";

loadEnvConfig(process.cwd());
// Local-only, before any connection exists.
assertLocalDatabase(process.env, "run this verification");
fillBlankSyntheticEnv("SECRET_ENCRYPTION_KEY", "verify-issued-assets-returns-synthetic-key-not-a-secret");

const prisma = new PrismaClient();
const P = `asset214_${randomUUID().slice(0, 8)}`;
const adminId = `${P}_admin`;
const staffId = `${P}_staff`;
const financeId = `${P}_finance`;
const eventId = `${P}_ev`;
const otherEventId = `${P}_ev_other`;
const surname = `Ret${P}`;
const N = ["2027-06-15", "2027-06-16", "2027-06-17", "2027-06-18"] as const;
const CHECK_IN = { canManageMoney: false };
const FINANCE = { canManageMoney: true };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function caught(promise: Promise<unknown>) {
  return promise.then(() => null, (error: unknown) => error);
}

const settle = <T,>(promise: Promise<T>) => promise.then((value): T | Error => value, (error: unknown): T | Error => (error instanceof Error ? error : new Error(String(error))));

async function expectAssetError(promise: Promise<unknown>, code: AssetErrorCode, message: string) {
  const error = await caught(promise);
  assert(error instanceof AssetError && error.code === code, `${message}: expected ${code}, got ${error instanceof AssetError ? error.code : String(error)}`);
  return error;
}

async function expectDatabaseRefusal(promise: Promise<unknown>, message: string) {
  assert(await caught(promise), `${message}: the database accepted it`);
}

async function cleanup() {
  const like = { startsWith: `${P}_` };
  const registrationIds = (await prisma.registration.findMany({ where: { eventId: like }, select: { id: true } })).map((row) => row.id);
  await prisma.messageOutbox.deleteMany({ where: { OR: [{ registrationId: { in: registrationIds } }, { eventId: like }] } });
  await prisma.$transaction([
    prisma.$executeRaw`SELECT set_config('imsda.event_deletion', 'on', true)`,
    prisma.assetDepositCover.deleteMany({ where: { eventId: like } }),
    prisma.assetLedgerEntry.deleteMany({ where: { eventId: like } }),
    prisma.facilityIssueHistory.deleteMany({ where: { eventId: like } }),
    prisma.facilityIssue.deleteMany({ where: { eventId: like } }),
    prisma.assetIssuanceHistory.deleteMany({ where: { eventId: like } }),
    prisma.assetIssuance.deleteMany({ where: { eventId: like } }),
    prisma.issuedAsset.deleteMany({ where: { eventId: like } }),
    prisma.issuedAssetType.deleteMany({ where: { eventId: like } }),
    prisma.eventLodgingAssignmentHistory.deleteMany({ where: { eventId: like } }),
    prisma.eventLodgingAssignment.deleteMany({ where: { eventId: like } }),
  ]);
  await prisma.event.deleteMany({ where: { id: like } });
  await prisma.person.deleteMany({ where: { lastName: { startsWith: surname } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: { in: [adminId, staffId, financeId] } }, { eventId: like }] } });
  await prisma.user.deleteMany({ where: { id: { in: [adminId, staffId, financeId] } } });
}

async function createEvent(id: string) {
  await prisma.event.create({
    data: {
      id, slug: `${id}-slug`, name: `Issued assets returns check ${id}`,
      startsAt: new Date("2027-06-15T15:00:00Z"), endsAt: new Date("2027-06-19T15:00:00Z"), timezone: "America/Chicago",
      registrationClosesOn: "2027-06-01", attendeeEditPolicy: "TIERED", isPublished: true,
    },
  });
}

type Person = { attendeeId: string; registrationId: string; last: string; first: string };
let counter = 0;

async function makeReg(forEvent: string, firstName?: string): Promise<Person> {
  counter += 1;
  const registrationId = randomUUID();
  const first = firstName ?? `Birch${counter}`;
  const last = `${surname}${counter}`;
  const person = await prisma.person.create({ data: { firstName: first, lastName: last, normalizedEmail: `${P}.${counter}@returns.example.test` } });
  await prisma.registration.create({
    data: { id: registrationId, eventId: forEvent, accountHolderPersonId: person.id, confirmationCode: `RET-${P.slice(-6).toUpperCase()}${counter}`, status: "CONFIRMED", totalAmount: 0, submittedAt: new Date("2027-05-20T12:00:00Z") },
  });
  const attendee = await prisma.registrationAttendee.create({
    data: { eventId: forEvent, registrationId, personId: person.id, attendeeType: "adult", position: 0, profileSnapshot: { firstName: first, lastName: last }, formResponses: {} },
  });
  return { attendeeId: attendee.id, registrationId, first, last };
}

const unitRow = (key: string) => prisma.eventLodgingUnit.findFirstOrThrow({ where: { eventId, unit: { key } }, include: { unit: true } });

async function place(person: Person, key: string, first: string = N[0], last: string = N[3]) {
  const row = await unitRow(key);
  await applyAssignmentAction(eventId, adminId, {
    action: "place", placements: [{ occupant: { kind: "ATTENDEE", id: person.attendeeId }, place: { kind: "UNIT", eventUnitId: row.id }, firstNight: first, lastNight: last, mode: "ASSIGN" }],
  }, prisma);
  return row;
}

const issue = (person: Person, codes: string[], extra: Record<string, unknown> = {}) =>
  issueAssets(eventId, staffId, { assignee: { kind: "ATTENDEE", attendeeId: person.attendeeId }, items: codes.map((code) => ({ code })), ...extra });
const issuanceOf = (person: Person, identifier: string) => prisma.assetIssuance.findFirstOrThrow({ where: { eventId, attendeeId: person.attendeeId, asset: { identifier } }, orderBy: { createdAt: "desc" } });
const openIssuanceOf = (person: Person, identifier: string) => prisma.assetIssuance.findFirstOrThrow({ where: { eventId, attendeeId: person.attendeeId, endedAt: null, asset: { identifier } } });
const assetOf = (identifier: string) => prisma.issuedAsset.findFirstOrThrow({ where: { eventId, identifier } });
const give = (items: unknown[], extra: Record<string, unknown> = {}) => returnAssets(eventId, staffId, { items, ...extra });
const statusOf = (item: ReturnItemResult | undefined) => `${item?.status}${item?.error ? `/${item.error.code}` : ""}`;
const registrationTotal = async (person: Person) => Number((await prisma.registration.findUniqueOrThrow({ where: { id: person.registrationId } })).totalAmount);
const historyOf = (issuanceId: string) => prisma.assetIssuanceHistory.findMany({ where: { issuanceId }, orderBy: [{ revision: "asc" }] });
const ledgerOf = (depositEntryId: string) => prisma.assetLedgerEntry.findMany({ where: { depositEntryId }, orderBy: { createdAt: "asc" } });
const takeDeposit = (person: Person, identifiers: string[], amountCents: number, extra: Record<string, unknown> = {}) =>
  (async () => {
    const ids = await Promise.all(identifiers.map(async (identifier) => (await openIssuanceOf(person, identifier)).id));
    return recordDeposit(eventId, staffId, { action: "record", issuanceIds: ids, amountCents, ...extra });
  })();

async function main() {
  await cleanup();
  await prisma.user.create({ data: { id: adminId, email: `${P}@returns.example.test`, displayName: "Returns verifier" } });
  await prisma.user.create({ data: { id: staffId, email: `${P}.staff@returns.example.test`, displayName: "Desk staff" } });
  await prisma.user.create({ data: { id: financeId, email: `${P}.finance@returns.example.test`, displayName: "Finance person" } });
  await syncLodgingTemplates(prisma);
  await createEvent(eventId);
  await createEvent(otherEventId);
  await prisma.eventMembership.create({ data: { eventId, userId: staffId, role: "CHECK_IN_STAFF", status: "ACTIVE" } });
  await prisma.eventMembership.create({ data: { eventId, userId: financeId, role: "FINANCE_MANAGER", status: "ACTIVE" } });
  await selectEventProperty(eventId, adminId, { propertyKey: "sunnydale-academy" }, prisma);

  // ---- Kinds of item: the Camp Meeting key and its policy -----------------------------------
  const keyType = (await applyAssetTypeAction(eventId, adminId, { action: "create", name: "Dorm room key", mode: "SERIALIZED", assigneeKinds: ["ATTENDEE", "REGISTRATION"], roomLinked: true, depositCents: 1000, depositShortfall: "KEEP_ALL", replacementFeeCents: 2500 })).id;
  const lodgeType = (await applyAssetTypeAction(eventId, adminId, { action: "create", name: "Lodge key", mode: "SERIALIZED", assigneeKinds: ["ATTENDEE"], depositCents: 1000, depositShortfall: "KEEP_FEES", replacementFeeCents: 400 })).id;
  const towelType = (await applyAssetTypeAction(eventId, adminId, { action: "create", name: "Towels", mode: "QUANTITY", assigneeKinds: ["ATTENDEE"] })).id;
  const bandType = (await applyAssetTypeAction(eventId, adminId, { action: "create", name: "Wristband", mode: "SERIALIZED", assigneeKinds: ["ATTENDEE"] })).id;
  const typeRow = await prisma.issuedAssetType.findUniqueOrThrow({ where: { id: keyType } });
  assert(typeRow.depositCents === 1000 && typeRow.depositShortfall === "KEEP_ALL" && typeRow.replacementFeeCents === 2500, "a kind keeps its deposit, shortfall policy and replacement fee");
  await expectDatabaseRefusal(prisma.issuedAssetType.update({ where: { id: keyType }, data: { depositCents: -1 } }), "a negative deposit");
  await expectAssetError(applyAssetTypeAction(eventId, adminId, { action: "create", name: "Free-fee key", mode: "SERIALIZED", assigneeKinds: ["ATTENDEE"], depositCents: 500, depositShortfall: "KEEP_FEES", replacementFeeCents: 0 }), "POLICY_INVALID", "keeping fees with no fee to keep");
  await expectAssetError(applyAssetTypeAction(eventId, adminId, { action: "update", typeId: bandType, depositShortfall: "KEEP_FEES" }), "POLICY_INVALID", "switching a kind with no fee to keep-fees");
  await expectAssetError(applyAssetTypeAction(eventId, adminId, { action: "update", typeId: lodgeType, replacementFeeCents: 0 }), "POLICY_INVALID", "removing the fee of a keep-fees kind");
  await expectDatabaseRefusal(prisma.issuedAssetType.update({ where: { id: lodgeType }, data: { replacementFeeCents: 0 } }), "keep-fees with no fee, around the service");
  await applyAssetAction(eventId, adminId, { action: "bulk", typeId: keyType, prefix: "K-", from: 201, to: 260 });
  for (const identifier of ["L-1", "L-2", "L-3", "L-4", "L-5", "L-6", "L-7", "L-8"]) await applyAssetAction(eventId, adminId, { action: "create", typeId: lodgeType, identifier });
  await applyAssetAction(eventId, adminId, { action: "create", typeId: towelType, identifier: "TOWELS", quantityTotal: 10 });
  for (const identifier of ["W-1", "W-2", "W-3"]) await applyAssetAction(eventId, adminId, { action: "create", typeId: bandType, identifier });

  // ---- Camp Meeting: two keys, a cash deposit, a partial group checkout ----------------------
  const alice = await makeReg(eventId);
  await place(alice, "girls-201");
  const registrationBefore = await prisma.registration.findUniqueOrThrow({ where: { id: alice.registrationId } });
  const adjustmentsBefore = await prisma.registrationAdjustment.count({ where: { eventId } });
  assert((await issue(alice, ["K-214", "K-215"])).issued === 2, "two keys are issued for the room");
  assert((await issue(alice, ["W-1"])).issued === 1, "a wristband is issued too");
  await expectAssetError(takeDeposit(alice, ["W-1"], 500), "DEPOSIT_NOT_REQUIRED", "a deposit on a kind that has none");
  await expectAssetError(takeDeposit(alice, ["K-214", "W-1"], 500), "DEPOSIT_COVER_INVALID", "one deposit for two kinds of item");
  const bobForMix = await makeReg(eventId);
  await place(bobForMix, "girls-213");
  assert((await issue(bobForMix, ["K-239"])).issued === 1, "another holder has a key");
  const mixed = await Promise.all([openIssuanceOf(alice, "K-214"), openIssuanceOf(bobForMix, "K-239")]);
  await expectAssetError(recordDeposit(eventId, staffId, { action: "record", issuanceIds: mixed.map((row) => row.id), amountCents: 800 }), "DEPOSIT_COVER_INVALID", "one deposit for two holders' keys");
  const depositKey = `deposit-${randomUUID()}`;
  const deposit = await takeDeposit(alice, ["K-214", "K-215"], 800, { idempotencyKey: depositKey });
  assert(deposit.covered === 2 && deposit.amountCents === 800 && !deposit.replayed, "an $8 cash deposit covers both keys");
  const resent = await takeDeposit(alice, ["K-214", "K-215"], 800, { idempotencyKey: depositKey });
  assert(resent.replayed && resent.depositEntryId === deposit.depositEntryId, "a retry of the deposit with the saved key records nothing twice");
  await expectAssetError(takeDeposit(alice, ["K-214"], 800), "DEPOSIT_COVER_INVALID", "covering an item twice");
  const depositRow = await prisma.assetLedgerEntry.findUniqueOrThrow({ where: { id: deposit.depositEntryId }, include: { covers: true } });
  assert(depositRow.kind === "DEPOSIT_RECEIVED" && depositRow.settlement === "CASH_AT_DESK" && depositRow.registrationId === alice.registrationId && depositRow.actorUserId === staffId && depositRow.actorNameSnapshot === "Desk staff" && depositRow.reason.length > 0 && depositRow.covers.length === 2, "the deposit is a ledger entry with actor, reason, time and what it covers");
  assert((await registrationTotal(alice)) === Number(registrationBefore.totalAmount) && (await prisma.registrationAdjustment.count({ where: { eventId } })) === adjustmentsBefore && (await prisma.payment.count({ where: { eventId } })) === 0, "taking a cash deposit never changes the registration or creates a payment");
  const unsettled = await expectAssetError(settleDeposit(eventId, staffId, { action: "settle", depositEntryId: deposit.depositEntryId }), "DEPOSIT_UNRESOLVED", "settling while both keys are out");
  assert((unsettled.details as { unresolved: number }).unresolved === 2, "and it says how many keys are still out");

  const partial = await give([{ code: "K-214", outcome: "RETURNED", condition: "WORN" }]);
  assert(partial.returned === 1 && statusOf(partial.items[0]) === "RETURNED", "one of the two keys comes back");
  const k214 = await issuanceOf(alice, "K-214");
  assert(k214.endReason === "RETURNED" && k214.endedByUserId === staffId && k214.endQuantity === 1 && k214.endedAt !== null, "the issue ends as returned, with who and when");
  assert((await assetOf("K-214")).condition === "WORN" && (await assetOf("K-214")).availability === "AVAILABLE", "a returned key goes back in stock with the condition it came back in");
  assert((await prisma.assetIssuance.count({ where: { eventId, attendeeId: alice.attendeeId, endedAt: null, asset: { identifier: "K-215" } } })) === 1, "the other key is still out");
  const stillOut = await expectAssetError(settleDeposit(eventId, staffId, { action: "settle", depositEntryId: deposit.depositEntryId }), "DEPOSIT_UNRESOLVED", "settling a partial group checkout");
  assert((stillOut.details as { unresolved: number }).unresolved === 1 && (await ledgerOf(deposit.depositEntryId)).length === 0, "the deposit stays held until the second key is back");
  const historyBeforeDuplicate = await prisma.assetIssuanceHistory.count({ where: { eventId } });
  const duplicate = await give([{ code: "K-214" }, { issuanceId: k214.id }]);
  assert(duplicate.duplicates === 2 && duplicate.items.every((item) => item.status === "DUPLICATE") && (await prisma.assetIssuanceHistory.count({ where: { eventId } })) === historyBeforeDuplicate, "returning a key twice is a duplicate that writes nothing");
  const k215 = await openIssuanceOf(alice, "K-215");
  const returnKey = `return-${randomUUID()}`;
  assert((await give([{ issuanceId: k215.id }], { idempotencyKey: returnKey })).returned === 1, "the second key comes back");
  const replay = await give([{ issuanceId: k215.id }], { idempotencyKey: returnKey });
  assert(replay.items[0]!.status === "REPLAYED" && replay.returned === 0, "sending the same sheet again with its saved key replays it");
  assert((await prisma.assetIssuanceHistory.count({ where: { issuanceId: k215.id, type: "RETURNED" } })) === 1, "and writes one return, not two");
  const settled = await settleDeposit(eventId, staffId, { action: "settle", depositEntryId: deposit.depositEntryId, idempotencyKey: `settle-${randomUUID()}` });
  assert(settled.outcome === "FULL_REFUND" && settled.refundCents === 800 && settled.keepCents === 0, `both keys back: the full deposit goes back: ${JSON.stringify(settled)}`);
  const settlement = await ledgerOf(deposit.depositEntryId);
  assert(settlement.length === 1 && settlement[0]!.kind === "DEPOSIT_RETURNED" && settlement[0]!.amountCents === 800 && settlement[0]!.settlement === "CASH_AT_DESK" && settlement[0]!.actorUserId === staffId && settlement[0]!.reason.length > 0, "recorded as handed back, in full, with actor and reason");
  await expectAssetError(settleDeposit(eventId, staffId, { action: "settle", depositEntryId: deposit.depositEntryId }), "DEPOSIT_ALREADY_SETTLED", "settling a deposit twice");
  await expectDatabaseRefusal(prisma.assetLedgerEntry.create({ data: { eventId, kind: "DEPOSIT_RETURNED", amountCents: 800, depositEntryId: deposit.depositEntryId, assetTypeId: keyType, settlement: "CASH_AT_DESK", reason: "Again", actorUserId: staffId, actorNameSnapshot: "Desk staff" } }), "a second hand-back of one deposit");
  await expectDatabaseRefusal(prisma.assetLedgerEntry.create({ data: { eventId, kind: "DEPOSIT_KEPT", amountCents: 1, depositEntryId: deposit.depositEntryId, assetTypeId: keyType, settlement: "CASH_AT_DESK", reason: "More than was taken", actorUserId: staffId, actorNameSnapshot: "Desk staff" } }), "keeping more than the deposit received");
  assert((await registrationTotal(alice)) === Number(registrationBefore.totalAmount) && (await prisma.payment.count({ where: { eventId } })) === 0, "handing a deposit back never moves a balance or creates a refund");
  const aliceDesk = await getDeskPerson(eventId, alice.attendeeId);
  const aliceMoney = await getDeskMoney(eventId, aliceDesk!.issuances.map((row) => row.id));
  assert(aliceMoney.deposits.length === 1 && aliceMoney.deposits[0]!.settled?.refundCents === 800 && aliceMoney.deposits[0]!.covers.every((cover) => cover.state === "RETURNED"), "the desk shows the settled deposit and each key's state");
  assert((await issue(bobForMix, ["K-214"])).issued === 1, "a returned key can be issued again");

  // ---- A lost key, replaced in the same step; the deposit is kept ----------------------------------
  const bob = await makeReg(eventId);
  const bobRoom = await place(bob, "girls-202");
  await issue(bob, ["K-216", "K-217"]);
  const bobDeposit = await takeDeposit(bob, ["K-216", "K-217"], 1000);
  const bad = await give([
    { code: "K-217", outcome: "LOST", note: "Not in the room", replacementCode: "L-1" },
    { code: "K-216", outcome: "RETURNED", replacementCode: "K-216" },
  ]);
  assert(bad.items.every((item) => item.status === "REJECTED" && item.error?.code === "REPLACEMENT_INVALID"), `a replacement of another kind, or the same item, is refused: ${bad.items.map(statusOf).join(" ")}`);
  assert((await prisma.assetIssuance.count({ where: { eventId, attendeeId: bob.attendeeId, endedAt: null } })) === 2, "and nothing was ended");
  const lostResult = await give([
    { code: "K-216", outcome: "RETURNED" },
    { code: "K-217", outcome: "LOST", note: "Not in the room at check-out", evidenceRef: "photo-77", replacementCode: "K-218" },
  ]);
  assert(statusOf(lostResult.items[0]) === "RETURNED" && statusOf(lostResult.items[1]) === "LOST" && lostResult.items[1]!.replacementIdentifier === "K-218", `one key back, one lost and replaced: ${lostResult.items.map(statusOf).join(" ")}`);
  const k217 = await issuanceOf(bob, "K-217");
  const k218 = await openIssuanceOf(bob, "K-218");
  assert(k217.endReason === "LOST" && k218.previousIssuanceId === k217.id && k218.roomUnitId === bobRoom.id && k218.sourceAssignmentId === k217.sourceAssignmentId, "the replacement is issued to the same holder for the same room, pointing back at the lost key");
  assert((await assetOf("K-217")).availability === "UNAVAILABLE", "a lost key is held out of stock");
  const lostHistory = (await historyOf(k217.id)).find((row) => row.type === "LOST")!;
  assert(lostHistory.reason === "Not in the room at check-out" && lostHistory.evidenceRef === "photo-77" && lostHistory.actorUserId === staffId, "the loss keeps its reason, evidence reference and actor");
  assert((await historyOf(k218.id))[0]!.type === "REPLACED_IN", "the replacement's history says it replaced a key");
  assert((await prisma.assetDepositCover.count({ where: { depositEntryId: bobDeposit.depositEntryId } })) === 3, "the deposit covers the replacement key too");
  await expectAssetError(settleDeposit(eventId, staffId, { action: "settle", depositEntryId: bobDeposit.depositEntryId }), "DEPOSIT_UNRESOLVED", "settling while the replacement key is out");
  assert((await give([{ code: "K-218" }])).returned === 1, "the replacement key comes back");
  const kept = await settleDeposit(eventId, staffId, { action: "settle", depositEntryId: bobDeposit.depositEntryId, note: "Guest agreed" });
  assert(kept.outcome === "KEPT" && kept.keepCents === 1000 && kept.refundCents === 0, `a key was lost, so the deposit is not refunded in full: ${JSON.stringify(kept)}`);
  const keptRows = await ledgerOf(bobDeposit.depositEntryId);
  assert(keptRows.length === 1 && keptRows[0]!.kind === "DEPOSIT_KEPT" && keptRows[0]!.reason.includes("Guest agreed"), "recorded as kept, with the note");

  // ---- A damaged key under the keep-fees policy ---------------------------------------------------
  const erin = await makeReg(eventId);
  await issue(erin, ["L-1", "L-2"]);
  const erinDeposit = await takeDeposit(erin, ["L-1", "L-2"], 1000);
  const damaged = await give([{ code: "L-1", outcome: "DAMAGED", note: "Bent in the lock", evidenceRef: "INC-5" }, { code: "L-2" }]);
  assert(damaged.damaged === 1 && damaged.returned === 1, "one key back damaged, one back whole");
  const l1 = await assetOf("L-1");
  assert(l1.condition === "DAMAGED" && l1.availability === "UNAVAILABLE", "a damaged key is marked damaged and held out of stock");
  const damagedHistory = (await historyOf((await issuanceOf(erin, "L-1")).id)).find((row) => row.type === "DAMAGED")!;
  assert(damagedHistory.condition === "DAMAGED" && damagedHistory.evidenceRef === "INC-5", "the damage keeps its condition and evidence reference");
  const feeSettled = await settleDeposit(eventId, staffId, { action: "settle", depositEntryId: erinDeposit.depositEntryId });
  assert(feeSettled.outcome === "PARTIAL_REFUND" && feeSettled.keepCents === 400 && feeSettled.refundCents === 600, `the policy keeps only the replacement fee: ${JSON.stringify(feeSettled)}`);
  const feeRows = await ledgerOf(erinDeposit.depositEntryId);
  assert(feeRows.map((row) => `${row.kind}:${row.amountCents}`).sort().join() === "DEPOSIT_KEPT:400,DEPOSIT_RETURNED:600", "recorded as $6 handed back and $4 kept");

  // ---- Charges, a waiver, and who may do what ------------------------------------------------------
  const dana = await makeReg(eventId);
  await place(dana, "girls-203");
  await issue(dana, ["K-219", "K-220"]);
  await give([{ code: "K-219", outcome: "LOST", note: "Lost at the lake" }, { code: "K-220" }]);
  const lost219 = await issuanceOf(dana, "K-219");
  const returned220 = await issuanceOf(dana, "K-220");
  await expectAssetError(postCharge(eventId, staffId, { action: "charge", issuanceId: lost219.id, category: "REPLACEMENT", amountCents: 3000, reason: "Lost key", post: true }, CHECK_IN), "MONEY_PERMISSION_REQUIRED", "check-in staff charging a non-standard amount");
  await expectAssetError(postCharge(eventId, staffId, { action: "charge", issuanceId: lost219.id, category: "DAMAGE", amountCents: 2500, reason: "Lost key", post: true }, CHECK_IN), "MONEY_PERMISSION_REQUIRED", "check-in staff recording a damage charge");
  await expectAssetError(postCharge(eventId, financeId, { action: "charge", issuanceId: returned220.id, category: "REPLACEMENT", amountCents: 2500, reason: "It came back", post: true }, FINANCE), "CHARGE_NOT_ALLOWED", "a replacement charge for a key that came back");
  assert((await caught(postCharge(eventId, financeId, { action: "charge", issuanceId: lost219.id, category: "REPLACEMENT", amountCents: 2500, reason: "", post: true }, FINANCE))) !== null, "a charge needs a reason");
  const totalBeforeCharge = await registrationTotal(dana);
  const chargeKey = `charge-${randomUUID()}`;
  const charge = await postCharge(eventId, staffId, { action: "charge", issuanceId: lost219.id, category: "REPLACEMENT", amountCents: 2500, reason: "Replacement fee for K-219", post: true, idempotencyKey: chargeKey }, CHECK_IN);
  assert(charge.posted && !charge.replayed, "check-in staff record the standard replacement fee and post it to the registration");
  assert((await postCharge(eventId, staffId, { action: "charge", issuanceId: lost219.id, category: "REPLACEMENT", amountCents: 2500, reason: "Replacement fee for K-219", post: true, idempotencyKey: chargeKey }, CHECK_IN)).replayed, "a retry of the charge with its key writes nothing twice");
  await expectAssetError(postCharge(eventId, financeId, { action: "charge", issuanceId: lost219.id, category: "REPLACEMENT", amountCents: 2500, reason: "Again", post: true }, FINANCE), "CHARGE_EXISTS", "charging the same loss twice");
  assert((await registrationTotal(dana)) === totalBeforeCharge + 25, "the charge shows in the registration total");
  const chargeEntry = await prisma.assetLedgerEntry.findUniqueOrThrow({ where: { id: charge.chargeEntryId }, include: { adjustment: true } });
  assert(chargeEntry.kind === "CHARGE" && chargeEntry.settlement === "REGISTRATION_ADJUSTMENT" && chargeEntry.adjustment?.kind === "ASSET" && chargeEntry.adjustment.amountCents === 2500 && chargeEntry.actorUserId === staffId && chargeEntry.reason.length > 0, "the charge is an append-only ledger entry linked to an ASSET adjustment line");
  await expectAssetError(waiveCharge(eventId, staffId, { action: "waive", chargeEntryId: charge.chargeEntryId, reason: "Guest found it" }, CHECK_IN), "MONEY_PERMISSION_REQUIRED", "check-in staff waiving a charge");
  assert((await caught(waiveCharge(eventId, financeId, { action: "waive", chargeEntryId: charge.chargeEntryId, reason: "" }, FINANCE))) !== null, "a waiver needs a reason");
  assert((await registrationTotal(dana)) === totalBeforeCharge + 25, "a refused waiver changes nothing");
  const waiveKey = `waive-${randomUUID()}`;
  const waiver = await waiveCharge(eventId, financeId, { action: "waive", chargeEntryId: charge.chargeEntryId, reason: "Guest returned it to the lodge the next day", idempotencyKey: waiveKey }, FINANCE);
  assert(waiver.reversedOnRegistration && !waiver.replayed, "finance waives it with a reason");
  assert((await waiveCharge(eventId, financeId, { action: "waive", chargeEntryId: charge.chargeEntryId, reason: "Guest returned it to the lodge the next day", idempotencyKey: waiveKey }, FINANCE)).replayed, "a retry of the waiver replays");
  await expectAssetError(waiveCharge(eventId, financeId, { action: "waive", chargeEntryId: charge.chargeEntryId, reason: "Second time" }, FINANCE), "CHARGE_ALREADY_WAIVED", "waiving twice");
  assert((await registrationTotal(dana)) === totalBeforeCharge, "the waiver takes the charge off the balance");
  const waiverEntry = await prisma.assetLedgerEntry.findUniqueOrThrow({ where: { id: waiver.waiverEntryId }, include: { adjustment: true } });
  assert(waiverEntry.kind === "WAIVER" && waiverEntry.waivesEntryId === charge.chargeEntryId && waiverEntry.actorUserId === financeId && waiverEntry.adjustment?.amountCents === -2500 && waiverEntry.adjustment.reversesAdjustmentId === chargeEntry.registrationAdjustmentId, "the waiver is the reversing ledger entry and adjustment line, by finance");
  assert((await prisma.assetLedgerEntry.findUniqueOrThrow({ where: { id: charge.chargeEntryId } })).amountCents === 2500, "the original charge stays on record");
  const reverseAttempt = await caught(reverseRegistrationAdjustment(eventId, dana.registrationId, chargeEntry.registrationAdjustmentId!, financeId, "Reverse it by hand"));
  assert(reverseAttempt instanceof Error && (reverseAttempt as { code?: string }).code === "ASSET_ADJUSTMENT_NOT_REVERSIBLE", "an asset charge cannot be reversed from the finance screen, only waived with its record");
  // Settle, then charge (keep-fees): the deposit already kept $4 for the damaged key, so the same loss is not charged in full as well.
  const erinL1 = (await issuanceOf(erin, "L-1")).id;
  await expectAssetError(postCharge(eventId, staffId, { action: "charge", issuanceId: erinL1, category: "REPLACEMENT", amountCents: 400, reason: "Standard fee", post: true }, CHECK_IN), "DEPOSIT_ALREADY_KEPT", "check-in staff charging the standard fee for a loss the deposit already kept money for");
  await expectAssetError(postCharge(eventId, financeId, { action: "charge", issuanceId: erinL1, category: "DAMAGE", amountCents: 1500, reason: "Bent key", post: false }, FINANCE), "DEPOSIT_ALREADY_KEPT", "finance charging without confirming the kept deposit");
  await expectAssetError(postCharge(eventId, financeId, { action: "charge", issuanceId: erinL1, category: "DAMAGE", amountCents: 300, reason: "Bent key", post: false, confirmKeptDeposit: true }, FINANCE), "CHARGE_NOT_ALLOWED", "a charge the kept deposit already covers");
  assert((await prisma.assetLedgerEntry.count({ where: { eventId, kind: "CHARGE", issuanceId: erinL1 } })) === 0, "refused charges wrote nothing");
  const recordOnly = await postCharge(eventId, financeId, { action: "charge", issuanceId: erinL1, category: "DAMAGE", amountCents: 1500, reason: "Bent key", post: false, confirmKeptDeposit: true }, FINANCE);
  const recordOnlyEntry = await prisma.assetLedgerEntry.findUniqueOrThrow({ where: { id: recordOnly.chargeEntryId } });
  assert(!recordOnly.posted && recordOnly.offsetCents === 400 && recordOnlyEntry.amountCents === 1100 && recordOnlyEntry.depositOffsetCents === 400 && (await registrationTotal(erin)) === 0, "a confirmed charge is only the part above what the deposit kept, and recording it without posting leaves the registration alone");
  const recordOnlyWaiver = await waiveCharge(eventId, financeId, { action: "waive", chargeEntryId: recordOnly.chargeEntryId, reason: "Within normal wear" }, FINANCE);
  assert(!recordOnlyWaiver.reversedOnRegistration && (await registrationTotal(erin)) === 0, "waiving a record-only charge posts nothing");
  // Settle, then charge (keep-all): Bob's deposit was kept for the lost K-217.
  const bobTotal = await registrationTotal(bob);
  const bobLost = (await issuanceOf(bob, "K-217")).id;
  await expectAssetError(postCharge(eventId, staffId, { action: "charge", issuanceId: bobLost, category: "REPLACEMENT", amountCents: 2500, reason: "Lost key", post: true }, CHECK_IN), "DEPOSIT_ALREADY_KEPT", "check-in staff charging a lost key whose deposit was kept");
  await expectAssetError(postCharge(eventId, financeId, { action: "charge", issuanceId: bobLost, category: "REPLACEMENT", amountCents: 2500, reason: "Lost key", post: true }, FINANCE), "DEPOSIT_ALREADY_KEPT", "finance charging a kept deposit's loss without confirming");
  assert((await registrationTotal(bob)) === bobTotal, "and nothing was posted");
  const bobCharge = await postCharge(eventId, financeId, { action: "charge", issuanceId: bobLost, category: "REPLACEMENT", amountCents: 2500, reason: "Lost key, replacement cost above the kept deposit", post: true, confirmKeptDeposit: true }, FINANCE);
  assert(bobCharge.amountCents === 1500 && bobCharge.offsetCents === 1000 && (await registrationTotal(bob)) === bobTotal + 15, "keep-all: only the $15 above the $10 kept deposit is charged");
  await expectDatabaseRefusal(prisma.assetLedgerEntry.update({ where: { id: charge.chargeEntryId }, data: { amountCents: 1 } }), "rewriting a ledger entry");
  await expectDatabaseRefusal(prisma.assetLedgerEntry.delete({ where: { id: charge.chargeEntryId } }), "deleting a ledger entry");
  await expectDatabaseRefusal(prisma.assetLedgerEntry.create({ data: { eventId, kind: "WAIVER", amountCents: 1, waivesEntryId: charge.chargeEntryId, issuanceId: lost219.id, settlement: "RECORD_ONLY", reason: "Different amount", actorUserId: financeId, actorNameSnapshot: "Finance person" } }), "a waiver of another amount, or a second waiver");
  await expectDatabaseRefusal(prisma.assetDepositCover.delete({ where: { issuanceId: (await prisma.assetDepositCover.findFirstOrThrow({ where: { depositEntryId: bobDeposit.depositEntryId } })).issuanceId } }), "deleting a deposit's coverage");
  const moneyAudit = await prisma.auditLog.findMany({ where: { eventId, action: { in: ["ASSET_DEPOSIT_RECORDED", "ASSET_DEPOSIT_SETTLED", "ASSET_CHARGE_RECORDED", "ASSET_CHARGE_WAIVED", "ASSET_RETURN_RECORDED"] } } });
  assert(moneyAudit.length >= 8 && !JSON.stringify(moneyAudit).includes(dana.last) && !JSON.stringify(moneyAudit).includes(alice.first), "the money and return audit entries carry no names");

  // ---- Charge first, then settle: a loss already charged is not also kept (both policies) -------------------
  const pat = await makeReg(eventId);
  await place(pat, "girls-218");
  await issue(pat, ["K-231", "K-232"]);
  const patDeposit = await takeDeposit(pat, ["K-231", "K-232"], 1000);
  await give([{ code: "K-232", outcome: "LOST", note: "Lost at the lake" }]);
  await postCharge(eventId, staffId, { action: "charge", issuanceId: (await issuanceOf(pat, "K-232")).id, category: "REPLACEMENT", amountCents: 2500, reason: "Standard fee", post: true }, CHECK_IN);
  await give([{ code: "K-231" }]);
  const patSettled = await settleDeposit(eventId, staffId, { action: "settle", depositEntryId: patDeposit.depositEntryId });
  assert(patSettled.outcome === "FULL_REFUND" && patSettled.refundCents === 1000 && patSettled.keepCents === 0 && patSettled.message.includes("already charged"), `keep-all: the lost key was charged, so the deposit is not kept as well: ${JSON.stringify(patSettled)}`);
  assert((await ledgerOf(patDeposit.depositEntryId)).map((row) => row.kind).join() === "DEPOSIT_RETURNED", "and only a hand-back is recorded");
  const quinn = await makeReg(eventId);
  await issue(quinn, ["L-4", "L-5"]);
  const quinnDeposit = await takeDeposit(quinn, ["L-4", "L-5"], 1000);
  await give([{ code: "L-5", outcome: "LOST", note: "Lost at the lake" }, { code: "L-4" }]);
  await postCharge(eventId, staffId, { action: "charge", issuanceId: (await issuanceOf(quinn, "L-5")).id, category: "REPLACEMENT", amountCents: 400, reason: "Standard fee", post: true }, CHECK_IN);
  const quinnSettled = await settleDeposit(eventId, staffId, { action: "settle", depositEntryId: quinnDeposit.depositEntryId });
  assert(quinnSettled.outcome === "FULL_REFUND" && quinnSettled.keepCents === 0, `keep-fees: the same, the fee is charged and not also kept: ${JSON.stringify(quinnSettled)}`);

  // ---- Deposit terms are snapshotted: editing the kind later never changes a deposit already held -----------
  const wade = await makeReg(eventId);
  await issue(wade, ["L-6", "L-7"]);
  const wadeDeposit = await takeDeposit(wade, ["L-6", "L-7"], 1000);
  const wadeEntry = await prisma.assetLedgerEntry.findUniqueOrThrow({ where: { id: wadeDeposit.depositEntryId } });
  assert(wadeEntry.depositShortfallSnapshot === "KEEP_FEES" && wadeEntry.replacementFeeSnapshotCents === 400, "a deposit remembers the policy and fee it was taken under");
  await applyAssetTypeAction(eventId, adminId, { action: "update", typeId: lodgeType, replacementFeeCents: 900, depositShortfall: "KEEP_ALL" });
  await give([{ code: "L-6", outcome: "LOST", note: "Lost" }, { code: "L-7" }]);
  const wadeSettled = await settleDeposit(eventId, staffId, { action: "settle", depositEntryId: wadeDeposit.depositEntryId });
  assert(wadeSettled.outcome === "PARTIAL_REFUND" && wadeSettled.keepCents === 400 && wadeSettled.refundCents === 600, `settled by the terms it was taken under, not the edited kind: ${JSON.stringify(wadeSettled)}`);
  await applyAssetTypeAction(eventId, adminId, { action: "update", typeId: lodgeType, replacementFeeCents: 400, depositShortfall: "KEEP_FEES" });

  // ---- Corrections: a key found, a settled deposit that needs review, replaced originals, write-offs ---------
  const rita = await makeReg(eventId);
  await place(rita, "girls-219");
  await issue(rita, ["K-233", "K-234"]);
  const ritaDeposit = await takeDeposit(rita, ["K-233", "K-234"], 1000);
  await give([{ code: "K-233", outcome: "LOST", note: "Not in the room" }, { code: "K-234" }]);
  const ritaLost = await issuanceOf(rita, "K-233");
  await expectAssetError(recordOutcomeCorrection(eventId, staffId, { action: "correct", issuanceId: ritaLost.id, fate: "RETURNED", reason: "Found under the bed" }, CHECK_IN), "MONEY_PERMISSION_REQUIRED", "check-in staff correcting an outcome");
  assert((await caught(recordOutcomeCorrection(eventId, financeId, { action: "correct", issuanceId: ritaLost.id, fate: "RETURNED", reason: "" }, FINANCE))) !== null, "a correction needs a reason");
  await expectAssetError(recordOutcomeCorrection(eventId, financeId, { action: "correct", issuanceId: ritaLost.id, fate: "LOST", reason: "Same again" }, FINANCE), "CORRECTION_INVALID", "correcting to the fate already recorded");
  const found = await recordOutcomeCorrection(eventId, financeId, { action: "correct", issuanceId: ritaLost.id, fate: "RETURNED", reason: "Found under the bed", idempotencyKey: `found-${randomUUID()}` }, FINANCE);
  assert(found.from === "LOST" && found.to === "RETURNED", "a lost key found later is LOST corrected to RETURNED");
  const foundHistory = (await historyOf(ritaLost.id)).find((row) => row.type === "OUTCOME_CORRECTED")!;
  assert(foundHistory.correctedEndReason === "RETURNED" && foundHistory.actorUserId === financeId && foundHistory.reason === "Found under the bed", "the correction is an append-only history row with actor and reason");
  assert((await prisma.assetIssuance.findUniqueOrThrow({ where: { id: ritaLost.id } })).endReason === "LOST" && (await assetOf("K-233")).availability === "AVAILABLE", "the ended issue never changed, and the found key is back in stock");
  await expectDatabaseRefusal(prisma.assetIssuanceHistory.update({ where: { id: foundHistory.id }, data: { reason: "Rewritten" } }), "rewriting a correction");
  const ritaSettled = await settleDeposit(eventId, staffId, { action: "settle", depositEntryId: ritaDeposit.depositEntryId });
  assert(ritaSettled.outcome === "FULL_REFUND", "an unsettled deposit is settled by the corrected fates: the found key means a full refund");

  const sam = await makeReg(eventId);
  await place(sam, "girls-220");
  await issue(sam, ["K-235", "K-236"]);
  const samDeposit = await takeDeposit(sam, ["K-235", "K-236"], 1000);
  await give([{ code: "K-235", outcome: "LOST", note: "Not in the room" }, { code: "K-236" }]);
  assert((await settleDeposit(eventId, staffId, { action: "settle", depositEntryId: samDeposit.depositEntryId })).outcome === "KEPT", "a lost key's deposit is kept");
  const ledgerBeforeLate = await prisma.assetLedgerEntry.count({ where: { eventId } });
  await recordOutcomeCorrection(eventId, financeId, { action: "correct", issuanceId: (await issuanceOf(sam, "K-235")).id, fate: "RETURNED", reason: "Found after the deposit was settled" }, FINANCE);
  assert((await prisma.assetLedgerEntry.count({ where: { eventId } })) === ledgerBeforeLate, "a correction after settlement refunds nothing by itself");

  const tess = await makeReg(eventId);
  await place(tess, "girls-221");
  await issue(tess, ["K-237"]);
  const tessDeposit = await takeDeposit(tess, ["K-237"], 1000);
  await applyIssuanceAction(eventId, adminId, (await openIssuanceOf(tess, "K-237")).id, { action: "replace", replacementCode: "K-238", reason: "Key does not turn", originalAvailability: "UNAVAILABLE" }, { canConfigure: true });
  await give([{ code: "K-238" }]);
  await expectAssetError(settleDeposit(eventId, staffId, { action: "settle", depositEntryId: tessDeposit.depositEntryId }), "DEPOSIT_UNRESOLVED", "a replaced original with no recorded fate");
  const tessOriginal = await issuanceOf(tess, "K-237");
  await expectAssetError(recordOutcomeCorrection(eventId, staffId, { action: "write_off", issuanceId: tessOriginal.id, reason: "Written off" }, CHECK_IN), "MONEY_PERMISSION_REQUIRED", "check-in staff writing off");
  await recordOutcomeCorrection(eventId, adminId, { action: "write_off", issuanceId: tessOriginal.id, reason: "The old key was scrapped" }, FINANCE);
  await expectAssetError(recordOutcomeCorrection(eventId, adminId, { action: "write_off", issuanceId: tessOriginal.id, reason: "Again" }, FINANCE), "CORRECTION_INVALID", "writing the same item off twice");
  assert((await settleDeposit(eventId, staffId, { action: "settle", depositEntryId: tessDeposit.depositEntryId })).outcome === "FULL_REFUND", "a written-off replaced original no longer blocks the deposit");

  const uma = await makeReg(eventId);
  await place(uma, "girls-222");
  await issue(uma, ["K-241"]);
  const umaDeposit = await takeDeposit(uma, ["K-241"], 1000);
  await applyIssuanceAction(eventId, adminId, (await openIssuanceOf(uma, "K-241")).id, { action: "replace", replacementCode: "K-242", reason: "Key does not turn", originalAvailability: "UNAVAILABLE" }, { canConfigure: true });
  await give([{ code: "K-242" }]);
  await recordOutcomeCorrection(eventId, financeId, { action: "correct", issuanceId: (await issuanceOf(uma, "K-241")).id, fate: "LOST", reason: "The old key never came back" }, FINANCE);
  assert((await settleDeposit(eventId, staffId, { action: "settle", depositEntryId: umaDeposit.depositEntryId })).outcome === "KEPT", "the fate given to a replaced original decides the deposit");

  const vic = await makeReg(eventId);
  await place(vic, "girls-223");
  await issue(vic, ["K-243"]);
  await give([{ code: "K-243", outcome: "LOST", note: "Left the camp" }]);
  await expectAssetError(recordOutcomeCorrection(eventId, staffId, { action: "write_off", issuanceId: (await issuanceOf(vic, "K-243")).id, reason: "Nothing to collect" }, CHECK_IN), "MONEY_PERMISSION_REQUIRED", "check-in staff writing off a loss");
  await recordOutcomeCorrection(eventId, financeId, { action: "write_off", issuanceId: (await issuanceOf(vic, "K-243")).id, reason: "Guest left the camp; nothing to collect" }, FINANCE);
  assert((await historyOf((await issuanceOf(vic, "K-243")).id)).some((row) => row.type === "WRITTEN_OFF" && row.actorUserId === financeId), "a write-off is an append-only history row");

  // ---- A waiver after the registration was cancelled is recorded without posting -----------------------------
  const xena = await makeReg(eventId);
  await place(xena, "girls-224");
  await issue(xena, ["K-244"]);
  await give([{ code: "K-244", outcome: "LOST", note: "Lost" }]);
  const xenaCharge = await postCharge(eventId, financeId, { action: "charge", issuanceId: (await issuanceOf(xena, "K-244")).id, category: "REPLACEMENT", amountCents: 2500, reason: "Lost key", post: true }, FINANCE);
  await prisma.registration.update({ where: { id: xena.registrationId }, data: { status: "CANCELLED" } });
  const adjustmentsBeforeWaiver = await prisma.registrationAdjustment.count({ where: { eventId } });
  const xenaWaiver = await waiveCharge(eventId, financeId, { action: "waive", chargeEntryId: xenaCharge.chargeEntryId, reason: "Registration was cancelled and refunded in full" }, FINANCE);
  const xenaWaiverEntry = await prisma.assetLedgerEntry.findUniqueOrThrow({ where: { id: xenaWaiver.waiverEntryId } });
  assert(xenaWaiver.registrationInactive && !xenaWaiver.reversedOnRegistration && xenaWaiverEntry.settlement === "RECORD_ONLY" && xenaWaiverEntry.reason.includes("not active") && (await prisma.registrationAdjustment.count({ where: { eventId } })) === adjustmentsBeforeWaiver, "waiving on a cancelled registration records the waiver in the ledger and says no line was reversed");

  // ---- A charge that is only recorded never excuses the deposit --------------------------------------------
  const yara = await makeReg(eventId);
  await place(yara, "girls-225");
  await issue(yara, ["K-245", "K-246"]);
  const yaraDeposit = await takeDeposit(yara, ["K-245", "K-246"], 1000);
  await give([{ code: "K-246", outcome: "LOST", note: "Lost" }, { code: "K-245" }]);
  const yaraLost = (await issuanceOf(yara, "K-246")).id;
  await expectAssetError(postCharge(eventId, staffId, { action: "charge", issuanceId: yaraLost, category: "REPLACEMENT", amountCents: 2500, reason: "Standard fee", post: false }, CHECK_IN), "MONEY_PERMISSION_REQUIRED", "check-in staff recording a charge without posting it");
  const yaraRecorded = await postCharge(eventId, financeId, { action: "charge", issuanceId: yaraLost, category: "REPLACEMENT", amountCents: 2500, reason: "Recorded, collected at the desk later", post: false }, FINANCE);
  assert(!yaraRecorded.posted, "finance records a charge without posting it");
  const yaraSettled = await settleDeposit(eventId, staffId, { action: "settle", depositEntryId: yaraDeposit.depositEntryId });
  assert(yaraSettled.outcome === "KEPT" && yaraSettled.keepCents === 1000, `a charge nobody collects does not excuse the lost key: the deposit is kept: ${JSON.stringify(yaraSettled)}`);
  const yaraNoReg = await prisma.assetLedgerEntry.findFirstOrThrow({ where: { eventId, kind: "CHARGE", issuanceId: yaraLost } });
  assert(yaraNoReg.settlement === "RECORD_ONLY", "and it stays record-only");

  // ---- Corrections after money: reviews, cash handed back, found keys, a lot, replay, condition -----------
  const zed = await makeReg(eventId);
  await place(zed, "girls-227");
  await issue(zed, ["K-247", "K-248"]);
  const zedDeposit = await takeDeposit(zed, ["K-247", "K-248"], 1000);
  await give([{ code: "K-247", outcome: "LOST", note: "Lost" }, { code: "K-248", outcome: "DAMAGED", note: "Bent" }]);
  assert((await settleDeposit(eventId, staffId, { action: "settle", depositEntryId: zedDeposit.depositEntryId })).outcome === "KEPT", "both keys were a loss, so the deposit is kept");
  assert((await assetOf("K-248")).condition === "DAMAGED", "the damaged key is marked damaged");
  const zedLost = (await issuanceOf(zed, "K-247")).id;
  const zedDamaged = (await issuanceOf(zed, "K-248")).id;
  const foundKey = `found-${randomUUID()}`;
  await recordOutcomeCorrection(eventId, financeId, { action: "correct", issuanceId: zedLost, fate: "RETURNED", reason: "Found in the laundry", idempotencyKey: foundKey }, FINANCE);
  assert((await recordOutcomeCorrection(eventId, financeId, { action: "correct", issuanceId: zedLost, fate: "RETURNED", reason: "Found in the laundry", idempotencyKey: foundKey }, FINANCE)).replayed, "the same correction sent again replays");
  await expectAssetError(recordOutcomeCorrection(eventId, financeId, { action: "correct", issuanceId: zedLost, fate: "DAMAGED", reason: "Found in the laundry", idempotencyKey: foundKey }, FINANCE), "IDEMPOTENCY_KEY_REUSED", "a retry key reused for a different fate");
  await expectAssetError(recordOutcomeCorrection(eventId, financeId, { action: "write_off", issuanceId: zedLost, reason: "Found in the laundry", idempotencyKey: foundKey }, FINANCE), "IDEMPOTENCY_KEY_REUSED", "a retry key reused for a different action");
  await recordOutcomeCorrection(eventId, financeId, { action: "correct", issuanceId: zedDamaged, fate: "RETURNED", reason: "It was only scuffed" }, FINANCE);
  const zedKey = await assetOf("K-248");
  assert(zedKey.condition === "GOOD" && zedKey.availability === "AVAILABLE", "a damaged key corrected to returned loses its damaged mark and is back in stock");
  const zedReport = await getCloseoutReport(eventId);
  assert(zedReport.exceptions.some((row) => row.code === "CORRECTION_NEEDS_REVIEW" && row.subject.startsWith("K-247") && row.depositId === zedDeposit.depositEntryId), "both keys came back after the deposit was kept: flagged for staff, with the deposit to record cash against");
  const handBack = { action: "refund_after_correction" as const, depositEntryId: zedDeposit.depositEntryId, amountCents: 600, reason: "Both keys found; handed the guest $6 back at the desk" };
  await expectAssetError(recordLateDepositRefund(eventId, staffId, handBack, CHECK_IN), "MONEY_PERMISSION_REQUIRED", "check-in staff recording cash handed back after a correction");
  await expectAssetError(recordLateDepositRefund(eventId, financeId, { ...handBack, amountCents: 1200 }, FINANCE), "CORRECTION_INVALID", "more than the deposit kept");
  await expectAssetError(recordLateDepositRefund(eventId, financeId, { ...handBack, depositEntryId: bobDeposit.depositEntryId }, FINANCE), "CORRECTION_INVALID", "a deposit with no corrected item");
  const lateKey = `late-${randomUUID()}`;
  assert((await recordLateDepositRefund(eventId, financeId, { ...handBack, idempotencyKey: lateKey }, FINANCE)).remainingKeptCents === 400, "finance records $6 of the $10 kept deposit handed back");
  assert((await recordLateDepositRefund(eventId, financeId, { ...handBack, idempotencyKey: lateKey }, FINANCE)).replayed, "the same hand-back sent again replays");
  const zedPartly = (await getCloseoutReport(eventId)).deposits.find((row) => row.entryId === zedDeposit.depositEntryId);
  assert(zedPartly?.state === "PARTLY_HANDED_BACK" && zedPartly.refundCents === 600 && zedPartly.keepCents === 400 && zedPartly.stillHeldCents === 400, `the closeout shows the deposit partly handed back: ${JSON.stringify(zedPartly)}`);
  await expectAssetError(recordLateDepositRefund(eventId, financeId, { ...handBack, amountCents: 500, idempotencyKey: `late-${randomUUID()}` }, FINANCE), "CORRECTION_INVALID", "more than is left of the kept deposit");
  await recordLateDepositRefund(eventId, financeId, { ...handBack, amountCents: 400 }, FINANCE);
  await expectDatabaseRefusal(prisma.assetLedgerEntry.create({ data: { eventId, kind: "DEPOSIT_HANDED_BACK_LATE", amountCents: 1, depositEntryId: zedDeposit.depositEntryId, assetTypeId: keyType, settlement: "CASH_AT_DESK", reason: "Past the cap", actorUserId: financeId, actorNameSnapshot: "Finance person" } }), "the database refusing more than the kept amount handed back");
  assert((await prisma.registrationAdjustment.count({ where: { eventId, kind: "ASSET", reversesAdjustmentId: null, registration: { id: zed.registrationId } } })) === 0 && (await prisma.payment.count({ where: { eventId } })) === 0, "cash handed back is a ledger record, never a payment or a registration change");
  assert(!(await getCloseoutReport(eventId)).exceptions.some((row) => row.code === "CORRECTION_NEEDS_REVIEW" && (row.subject.startsWith("K-247") || row.subject.startsWith("K-248"))), "the cash recorded as handed back clears the exception");

  // Waived after the deposit was refunded for the charge: nobody paid. A recorded review clears it.
  const will = await makeReg(eventId);
  await place(will, "girls-228");
  await issue(will, ["K-249", "K-250"]);
  const willDeposit = await takeDeposit(will, ["K-249", "K-250"], 1000);
  await give([{ code: "K-250", outcome: "LOST", note: "Lost" }, { code: "K-249" }]);
  const willLost = (await issuanceOf(will, "K-250")).id;
  const willCharge = await postCharge(eventId, financeId, { action: "charge", issuanceId: willLost, category: "REPLACEMENT", amountCents: 2500, reason: "Lost key", post: true }, FINANCE);
  assert((await settleDeposit(eventId, staffId, { action: "settle", depositEntryId: willDeposit.depositEntryId })).outcome === "FULL_REFUND", "a posted charge excuses the lost key: the deposit goes back");
  await waiveCharge(eventId, financeId, { action: "waive", chargeEntryId: willCharge.chargeEntryId, reason: "Goodwill" }, FINANCE);
  const afterWaiver = await getCloseoutReport(eventId);
  assert(afterWaiver.exceptions.some((row) => row.code === "WAIVED_AFTER_REFUND" && row.subject.startsWith("K-250")), "a charge waived after the deposit was refunded for it is flagged");
  await expectAssetError(recordOutcomeCorrection(eventId, staffId, { action: "review", issuanceId: willLost, exceptionCode: "WAIVED_AFTER_REFUND", reason: "Seen" }, CHECK_IN), "MONEY_PERMISSION_REQUIRED", "check-in staff marking an exception reviewed");
  const reviewKey = `review-${randomUUID()}`;
  await recordOutcomeCorrection(eventId, financeId, { action: "review", issuanceId: willLost, exceptionCode: "WAIVED_AFTER_REFUND", reason: "Manager agreed to waive the fee", idempotencyKey: reviewKey }, FINANCE);
  assert((await recordOutcomeCorrection(eventId, financeId, { action: "review", issuanceId: willLost, exceptionCode: "WAIVED_AFTER_REFUND", reason: "Manager agreed to waive the fee", idempotencyKey: reviewKey }, FINANCE)).replayed, "a review sent again replays");
  assert(!(await getCloseoutReport(eventId)).exceptions.some((row) => row.code === "WAIVED_AFTER_REFUND"), "a recorded review clears the exception");
  assert((await historyOf(willLost)).some((row) => row.type === "EXCEPTION_REVIEWED" && row.actorUserId === financeId && (row.reason ?? "").length > 0), "the review is an append-only history row with actor and reason");


  // ---- One definition of "held": kept, less handed back late, less charge offsets (#214 review) -------------
  const heldOf = (depositEntryId: string) => depositHeldCents(prisma, eventId, depositEntryId);
  const chargeEntryOf = (chargeEntryId: string) => prisma.assetLedgerEntry.findUniqueOrThrow({ where: { id: chargeEntryId } });
  // The one free room holds one guest, so the three deposit scenarios below share that guest (one deposit each).
  // A: a key found, the kept deposit handed back in full, and then a loss charged in full posts with no offset (nothing is held).
  const ada = await makeReg(eventId);
  await place(ada, "girls-213");
  await issue(ada, ["K-251", "K-252", "K-253"]);
  const adaDeposit = await takeDeposit(ada, ["K-251", "K-252", "K-253"], 1000);
  await give([{ code: "K-251", outcome: "LOST", note: "Lost" }, { code: "K-253", outcome: "LOST", note: "Lost" }, { code: "K-252" }]);
  assert((await settleDeposit(eventId, staffId, { action: "settle", depositEntryId: adaDeposit.depositEntryId })).outcome === "KEPT", "A: two lost keys, the deposit is kept");
  await recordOutcomeCorrection(eventId, financeId, { action: "correct", issuanceId: (await issuanceOf(ada, "K-251")).id, fate: "RETURNED", reason: "Found behind the bed" }, FINANCE);
  await recordLateDepositRefund(eventId, financeId, { action: "refund_after_correction", depositEntryId: adaDeposit.depositEntryId, amountCents: 1000, reason: "Key found; handed the whole deposit back" }, FINANCE);
  assert((await heldOf(adaDeposit.depositEntryId)) === 0, "A: nothing is held once the kept deposit was handed back");
  const adaTotalBefore = await registrationTotal(ada);
  const adaCharge = await postCharge(eventId, financeId, { action: "charge", issuanceId: (await issuanceOf(ada, "K-253")).id, category: "REPLACEMENT", amountCents: 2500, reason: "Lost key", post: true, confirmKeptDeposit: true }, FINANCE);
  assert(adaCharge.offsetCents === 0 && (await chargeEntryOf(adaCharge.chargeEntryId)).depositOffsetCents === 0 && (await registrationTotal(ada)) - adaTotalBefore === 25, `A: the $25 charge posts in full, nothing offset against a deposit already handed back: ${JSON.stringify(adaCharge)}`);
  const adaRow = (await getCloseoutReport(eventId)).deposits.find((row) => row.entryId === adaDeposit.depositEntryId);
  assert(adaRow?.state === "HANDED_BACK" && adaRow.refundCents === 1000 && adaRow.keepCents === 0 && adaRow.stillHeldCents === 0, `A: the closeout row counts the late hand-back: ${JSON.stringify(adaRow)}`);

  // B: a charge that offset the kept deposit leaves nothing held, so a later hand-back is refused; waiving the charge restores it.
  const bea = ada;
  await issue(bea, ["K-254", "K-255"]);
  const beaDeposit = await takeDeposit(bea, ["K-254", "K-255"], 1000);
  await give([{ code: "K-254", outcome: "LOST", note: "Lost" }, { code: "K-255" }]);
  assert((await settleDeposit(eventId, staffId, { action: "settle", depositEntryId: beaDeposit.depositEntryId })).keepCents === 1000, "B: the lost key keeps the deposit");
  const beaLost = (await issuanceOf(bea, "K-254")).id;
  const beaCharge = await postCharge(eventId, financeId, { action: "charge", issuanceId: beaLost, category: "REPLACEMENT", amountCents: 2500, reason: "Lost key, beyond the kept deposit", post: true, confirmKeptDeposit: true }, FINANCE);
  assert(beaCharge.offsetCents === 1000 && (await heldOf(beaDeposit.depositEntryId)) === 0, "B: the charge counts the whole kept deposit against it, so nothing is held");
  await recordOutcomeCorrection(eventId, financeId, { action: "correct", issuanceId: beaLost, fate: "RETURNED", reason: "Found later" }, FINANCE);
  await expectAssetError(recordLateDepositRefund(eventId, financeId, { action: "refund_after_correction", depositEntryId: beaDeposit.depositEntryId, amountCents: 100, reason: "Found; handed back at the desk" }, FINANCE), "CORRECTION_INVALID", "B: a hand-back above what is held (nothing)");
  await expectDatabaseRefusal(prisma.assetLedgerEntry.create({ data: { eventId, kind: "DEPOSIT_HANDED_BACK_LATE", amountCents: 100, depositEntryId: beaDeposit.depositEntryId, assetTypeId: keyType, settlement: "CASH_AT_DESK", reason: "Past what is held", actorUserId: financeId, actorNameSnapshot: "Finance person" } }), "D: the database refusing a late hand-back above what is held");
  const beaBefore = (await getCloseoutReport(eventId)).deposits.find((row) => row.entryId === beaDeposit.depositEntryId);
  assert(beaBefore?.stillHeldCents === 0, `B: the closeout shows nothing still held: ${JSON.stringify(beaBefore)}`);
  await waiveCharge(eventId, financeId, { action: "waive", chargeEntryId: beaCharge.chargeEntryId, reason: "Goodwill" }, FINANCE);
  assert((await heldOf(beaDeposit.depositEntryId)) === 1000, "B: waiving the charge restores what it offset");
  assert((await getCloseoutReport(eventId)).deposits.find((row) => row.entryId === beaDeposit.depositEntryId)?.stillHeldCents === 1000, "B: and the closeout reflects it");

  // C: a returned key corrected to lost does not unlock a hand-back.
  const cy = ada;
  await issue(cy, ["K-256", "K-257"]);
  const cyDeposit = await takeDeposit(cy, ["K-256", "K-257"], 1000);
  await give([{ code: "K-256", outcome: "LOST", note: "Lost" }, { code: "K-257" }]);
  assert((await settleDeposit(eventId, staffId, { action: "settle", depositEntryId: cyDeposit.depositEntryId })).keepCents === 1000, "C: the deposit is kept");
  await recordOutcomeCorrection(eventId, financeId, { action: "correct", issuanceId: (await issuanceOf(cy, "K-257")).id, fate: "LOST", reason: "It was never handed in" }, FINANCE);
  await expectAssetError(recordLateDepositRefund(eventId, financeId, { action: "refund_after_correction", depositEntryId: cyDeposit.depositEntryId, amountCents: 500, reason: "Handed back at the desk" }, FINANCE), "CORRECTION_INVALID", "C: no item was found after the deposit was kept");
  // D: straight into the table, a charge counting more than is held against a deposit is refused too.
  await expectDatabaseRefusal(prisma.assetLedgerEntry.create({ data: { eventId, kind: "CHARGE", amountCents: 2500, depositOffsetCents: 2000, issuanceId: (await issuanceOf(cy, "K-256")).id, chargeCategory: "REPLACEMENT", settlement: "RECORD_ONLY", reason: "Past what is held", actorUserId: financeId, actorNameSnapshot: "Finance person", registrationId: cy.registrationId } }), "D: the database refusing a charge offset above what is held");

  // Two open exceptions on one key: a review clears only the one it names.
  const ines = await makeReg(eventId);
  await issue(ines, ["L-3", "L-8"]);
  const inesDeposit = await takeDeposit(ines, ["L-3", "L-8"], 1000);
  await give([{ code: "L-8", outcome: "LOST", note: "Lost at the lake" }, { code: "L-3" }]);
  const inesLost = (await issuanceOf(ines, "L-8")).id;
  const inesCharge = await postCharge(eventId, financeId, { action: "charge", issuanceId: inesLost, category: "REPLACEMENT", amountCents: 400, reason: "Standard fee", post: true }, FINANCE);
  assert((await settleDeposit(eventId, staffId, { action: "settle", depositEntryId: inesDeposit.depositEntryId })).outcome === "FULL_REFUND", "the charged loss does not keep the deposit");
  await waiveCharge(eventId, financeId, { action: "waive", chargeEntryId: inesCharge.chargeEntryId, reason: "Goodwill" }, FINANCE);
  await recordOutcomeCorrection(eventId, financeId, { action: "correct", issuanceId: inesLost, fate: "RETURNED", reason: "Found in the boat house" }, FINANCE);
  const inesCodes = async () => (await getCloseoutReport(eventId)).exceptions.filter((row) => row.refId === inesLost).map((row) => row.code).sort();
  assert((await inesCodes()).join() === "CORRECTION_NEEDS_REVIEW,WAIVED_AFTER_REFUND", `two exceptions are open on one key: ${(await inesCodes()).join()}`);
  await recordOutcomeCorrection(eventId, financeId, { action: "review", issuanceId: inesLost, exceptionCode: "WAIVED_AFTER_REFUND", reason: "Manager approved the waiver" }, FINANCE);
  assert((await inesCodes()).join() === "CORRECTION_NEEDS_REVIEW", "reviewing the waiver leaves the correction exception open");
  await recordOutcomeCorrection(eventId, financeId, { action: "review", issuanceId: inesLost, exceptionCode: "CORRECTION_NEEDS_REVIEW", reason: "Deposit already handed back in full" }, FINANCE);
  assert((await inesCodes()).length === 0, "reviewing the correction clears the other one");
  await recordOutcomeCorrection(eventId, financeId, { action: "correct", issuanceId: inesLost, fate: "LOST", reason: "Not that key after all" }, FINANCE);
  assert((await inesCodes()).includes("CORRECTION_NEEDS_REVIEW"), "a later correction raises the exception again; the old review does not clear it");

  // ---- A lot returned in part ---------------------------------------------------------------------
  const fay = await makeReg(eventId);
  const gus = await makeReg(eventId);
  assert((await issue(fay, ["TOWELS"], { items: [{ code: "TOWELS", quantity: 5 }] })).issued === 1, "five towels out");
  const towels5 = await openIssuanceOf(fay, "TOWELS");
  const partTowels = await give([{ issuanceId: towels5.id, quantity: 3 }]);
  assert(partTowels.returned === 1 && partTowels.items[0]!.quantity === 3 && partTowels.items[0]!.remainingQuantity === 2, "three of five come back");
  const endedTowels = await prisma.assetIssuance.findUniqueOrThrow({ where: { id: towels5.id } });
  const remainder = await openIssuanceOf(fay, "TOWELS");
  assert(endedTowels.endReason === "RETURNED" && endedTowels.endQuantity === 3 && endedTowels.quantity === 5 && remainder.quantity === 2 && remainder.previousIssuanceId === towels5.id, "the issue ends and the two still out continue it as a new issue");
  assert((await historyOf(towels5.id)).map((row) => `${row.type}:${row.quantity}`).join() === "ISSUED:5,RETURNED:3" && (await historyOf(remainder.id)).map((row) => `${row.type}:${row.quantity}`).join() === "REMAINDER_ISSUED:2", "history records both halves");
  const tooMany = await give([{ issuanceId: remainder.id, quantity: 3 }]);
  assert(statusOf(tooMany.items[0]) === "REJECTED/QUANTITY_INVALID", "returning more than is out is refused");
  const lostTowel = await give([{ issuanceId: remainder.id, outcome: "LOST", quantity: 1, note: "Left at the lake" }]);
  assert(lostTowel.lost === 1, "one of the two is lost");
  assert((await assetOf("TOWELS")).quantityTotal === 9, "a lost unit of a lot comes off the lot");
  await recordOutcomeCorrection(eventId, financeId, { action: "correct", issuanceId: remainder.id, fate: "RETURNED", reason: "The towel was found" }, FINANCE);
  assert((await assetOf("TOWELS")).quantityTotal === 10, "a lost unit found later goes back on the lot");
  await recordOutcomeCorrection(eventId, financeId, { action: "correct", issuanceId: remainder.id, fate: "LOST", reason: "It was another lot's towel after all" }, FINANCE);
  assert((await assetOf("TOWELS")).quantityTotal === 9, "and a returned unit corrected to lost comes off it again");
  for (let cycle = 0; cycle < 3; cycle += 1) {
    await recordOutcomeCorrection(eventId, financeId, { action: "correct", issuanceId: remainder.id, fate: "RETURNED", reason: `Found again, round ${cycle}` }, FINANCE);
    assert((await assetOf("TOWELS")).quantityTotal === 10, "repeated corrections: back on the lot");
    await recordOutcomeCorrection(eventId, financeId, { action: "correct", issuanceId: remainder.id, fate: "LOST", reason: `Lost again, round ${cycle}` }, FINANCE);
    assert((await assetOf("TOWELS")).quantityTotal === 9, "repeated corrections: off the lot again, with no drift");
  }
  assert((await historyOf(remainder.id)).find((row) => row.type === "LOST")?.stockDelta === -1, "the loss records the stock change it made");
  // A lot lost entirely cannot be shortened below one, so nothing came off it and nothing is added back by a correction.
  const blanketsType = (await applyAssetTypeAction(eventId, adminId, { action: "create", name: "Blankets", mode: "QUANTITY", assigneeKinds: ["ATTENDEE"] })).id;
  await applyAssetAction(eventId, adminId, { action: "create", typeId: blanketsType, identifier: "BLANKETS", quantityTotal: 3 });
  const lou = await makeReg(eventId);
  assert((await issue(lou, ["BLANKETS"], { items: [{ code: "BLANKETS", quantity: 3 }] })).issued === 1, "all three blankets are out");
  const blankets = await openIssuanceOf(lou, "BLANKETS");
  assert((await give([{ issuanceId: blankets.id, outcome: "LOST", quantity: 3, note: "Gone" }])).lost === 1, "all three are lost");
  assert((await assetOf("BLANKETS")).quantityTotal === 3, "a lot lost entirely keeps its count (it cannot go below one)");
  await recordOutcomeCorrection(eventId, financeId, { action: "correct", issuanceId: blankets.id, fate: "RETURNED", reason: "They were in the van" }, FINANCE);
  assert((await assetOf("BLANKETS")).quantityTotal === 3, "and correcting it does not add three that never came off");
  assert((await prisma.assetIssuance.aggregate({ where: { eventId, attendeeId: fay.attendeeId, endedAt: null, asset: { identifier: "TOWELS" } }, _sum: { quantity: true } }))._sum.quantity === 1, "one is still out");
  assert((await issue(gus, ["TOWELS"], { items: [{ code: "TOWELS", quantity: 2 }] })).issued === 1, "another holder has towels too");
  assert(statusOf((await give([{ code: "TOWELS" }])).items[0]) === "REJECTED/AMBIGUOUS_HOLDER", "a lot held by two people cannot be returned by its code alone");

  // ---- Duplicates, offline sheets and conflicts -----------------------------------------------------
  const hal = await makeReg(eventId);
  await place(hal, "girls-204");
  await issue(hal, ["K-221", "K-222", "K-223"]);
  const sheetKey = `sheet-${randomUUID()}`;
  assert((await give([{ code: "K-221" }], { idempotencyKey: sheetKey })).returned === 1, "a return is recorded with a saved key");
  await expectAssetError(give([{ code: "K-222" }], { idempotencyKey: sheetKey }), "IDEMPOTENCY_KEY_REUSED", "a saved key reused for a different key");
  const twice = await give([{ code: "K-222" }, { code: "K-222" }]);
  assert(statusOf(twice.items[0]) === "RETURNED" && statusOf(twice.items[1]) === "REJECTED/DUPLICATE_IN_REQUEST", "the same key twice in one sheet is returned once");
  assert(statusOf((await give([{ code: "K-240" }])).items[0]) === "REJECTED/NOT_OUT", "a key that was never issued is not out");
  assert(statusOf((await give([{ code: "NOPE-1" }])).items[0]) === "REJECTED/ASSET_NOT_FOUND", "an unknown code is not found");
  const earlier = new Date(Date.now() - 3_600_000).toISOString();
  const tooEarly = await give([{ code: "K-223" }], { entryMethod: "OFFLINE", occurredAt: earlier, idempotencyKey: `offline-${randomUUID()}` });
  assert(statusOf(tooEarly.items[0]) === "REJECTED/OCCURRED_AT_INVALID" && (await prisma.assetIssuance.count({ where: { eventId, attendeeId: hal.attendeeId, endedAt: null, asset: { identifier: "K-223" } } })) === 1, "an offline return dated before the key was issued is a conflict, not a return");
  await expectAssetError(give([{ code: "K-223" }], { entryMethod: "OFFLINE", occurredAt: new Date(Date.now() - 20 * 86_400_000).toISOString() }), "OCCURRED_AT_INVALID", "an offline sheet from twenty days ago");
  const offlineKey = `offline-${randomUUID()}`;
  const offlineAt = new Date().toISOString();
  const offline1 = await give([{ code: "K-223" }], { entryMethod: "OFFLINE", occurredAt: offlineAt, idempotencyKey: offlineKey });
  const offline2 = await give([{ code: "K-223" }], { entryMethod: "OFFLINE", occurredAt: offlineAt, idempotencyKey: offlineKey });
  assert(offline1.returned === 1 && offline2.items[0]!.status === "REPLAYED" && offline2.returned === 0, "an offline sheet sent twice reconciles to one return");
  const offlineRow = await issuanceOf(hal, "K-223");
  const offlineHistory = (await historyOf(offlineRow.id)).find((row) => row.type === "RETURNED")!;
  assert(offlineRow.endedAt!.toISOString() === offlineAt && offlineHistory.entryMethod === "OFFLINE" && offlineHistory.recordedAt.getTime() >= offlineHistory.at.getTime() && offlineHistory.idempotencyKey === `${offlineKey}:0`, "it keeps when it happened and how it was entered");
  const ivy = await makeReg(eventId);
  await place(ivy, "girls-214");
  await issue(ivy, ["K-224"]);
  const ivyIssue = await openIssuanceOf(ivy, "K-224");
  const race = await Promise.all(Array.from({ length: 6 }, () => settle(give([{ issuanceId: ivyIssue.id }]))));
  assert(race.every((outcome) => !(outcome instanceof Error)), `no racing return errors out: ${race.filter((outcome) => outcome instanceof Error).map(String).join(" | ")}`);
  const raceResults = race as Awaited<ReturnType<typeof give>>[];
  assert(raceResults.filter((result) => result.returned === 1).length === 1 && raceResults.filter((result) => result.duplicates === 1).length === 5, "six staff return one key at once: one wins, five are told it is already back");
  assert((await prisma.assetIssuanceHistory.count({ where: { issuanceId: ivyIssue.id, type: "RETURNED" } })) === 1, "one return is recorded");

  // ---- Facility issue and room block --------------------------------------------------------------
  const leo = await makeReg(eventId);
  const room205 = await place(leo, "girls-205", N[0], N[3]);
  const assignmentBefore = await prisma.eventLodgingAssignment.findFirstOrThrow({ where: { eventId, attendeeId: leo.attendeeId, cancelledAt: null } });
  const assignmentHistoryBefore = await prisma.eventLodgingAssignmentHistory.count({ where: { eventId } });
  const block = { kind: "DAMAGE", reason: "Window will not close", firstNight: N[2], lastNight: N[3] };
  await expectAssetError(applyFacilityAction(eventId, staffId, { action: "report", targetKind: "UNIT", eventUnitId: room205.id, title: "Window will not close", block }, { canConfigure: false }), "CONFIGURE_REQUIRED", "check-in staff blocking a room");
  assert((await prisma.facilityIssue.count({ where: { eventId } })) === 0, "and nothing was reported by the refused request");
  const reported = await applyFacilityAction(eventId, staffId, { action: "report", targetKind: "UNIT", eventUnitId: room205.id, title: "Window will not close", description: "Latch is bent", severity: "HIGH", source: "CHECKOUT_INSPECTION", sourceIssuanceId: (await issuanceOf(ivy, "K-224")).id }, { canConfigure: false });
  const issueRow = await prisma.facilityIssue.findUniqueOrThrow({ where: { id: reported.issueId }, include: { history: true } });
  assert(issueRow.status === "OPEN" && issueRow.severity === "HIGH" && issueRow.source === "CHECKOUT_INSPECTION" && issueRow.reportedByUserId === staffId && issueRow.history.length === 1 && issueRow.history[0]!.type === "REPORTED", "a check-out inspection reports an issue with severity, status, reporter and history");
  await expectAssetError(applyFacilityAction(eventId, staffId, { action: "block", issueId: reported.issueId, block }, { canConfigure: false }), "CONFIGURE_REQUIRED", "check-in staff placing a block on a reported issue");
  const holdsBefore = await prisma.eventLodgingHold.count({ where: { eventId } });
  const blocked = await applyFacilityAction(eventId, adminId, { action: "block", issueId: reported.issueId, block }, { canConfigure: true });
  assert(blocked.holdId && (await prisma.eventLodgingHold.count({ where: { eventId } })) === holdsBefore + 1, "an administrator blocks the room for the nights");
  const hold = await prisma.eventLodgingHold.findUniqueOrThrow({ where: { id: blocked.holdId! } });
  assert(hold.kind === "DAMAGE" && hold.firstNight.toISOString().slice(0, 10) === N[2] && hold.lastNight.toISOString().slice(0, 10) === N[3] && hold.createdByUserId === adminId && hold.releasedAt === null, "the block is a lodging hold of the damage kind, with its window and actor");
  const view = await getLodgingView(eventId, prisma);
  const blockedUnit = view.buildings.flatMap((building) => building.units).find((unit) => unit.key === "girls-205")!;
  assert(blockedUnit.nightStatuses.join() === "AVAILABLE,AVAILABLE,HELD,HELD", `availability reads the block: ${blockedUnit.nightStatuses.join()}`);
  const assignmentAfter = await prisma.eventLodgingAssignment.findUniqueOrThrow({ where: { id: assignmentBefore.id } });
  assert(assignmentAfter.cancelledAt === null && assignmentAfter.eventLodgingUnitId === room205.id && assignmentAfter.firstNight.getTime() === assignmentBefore.firstNight.getTime() && assignmentAfter.lastNight.getTime() === assignmentBefore.lastNight.getTime() && assignmentAfter.updatedAt.getTime() === assignmentBefore.updatedAt.getTime() && (await prisma.eventLodgingAssignmentHistory.count({ where: { eventId } })) === assignmentHistoryBefore, "the existing assignment is not altered by the block");
  const rooming = await getRoomingReports(eventId, { canSeeSensitive: false }, prisma);
  assert(rooming.conflicts.some((row) => row.kind === "UNIT_OUT_OF_SERVICE" && row.unitId === room205.id), "the rooming report lists the person still placed in the blocked room");
  const newcomer = await makeReg(eventId);
  const placement = await caught(place(newcomer, "girls-205", N[2], N[3]));
  assert(placement instanceof Error && (placement as { code?: string }).code === "UNIT_OUT_OF_SERVICE", `nobody new can be placed in the blocked nights: ${String(placement)}`);
  assert(!(await caught(place(newcomer, "girls-205", N[0], N[1]))), "the open nights of the room can still be used");
  await expectAssetError(applyFacilityAction(eventId, adminId, { action: "block", issueId: reported.issueId, block: { ...block, kind: "SAFETY" } }, { canConfigure: true }), "BLOCK_EXISTS", "a second block on one issue");
  const second = await applyFacilityAction(eventId, staffId, { action: "report", targetKind: "UNIT", eventUnitId: room205.id, title: "Ceiling stain" }, { canConfigure: false });
  await expectAssetError(applyFacilityAction(eventId, adminId, { action: "block", issueId: second.issueId, block: { kind: "SAFETY", reason: "Stain", firstNight: N[3], lastNight: N[3] } }, { canConfigure: true }), "BLOCK_REFUSED", "a block that overlaps another block");
  const inline = await applyFacilityAction(eventId, adminId, { action: "report", targetKind: "UNIT", eventUnitId: (await unitRow("girls-207")).id, title: "Smoke detector chirps", severity: "CRITICAL", block: { kind: "SAFETY", reason: "Smoke detector", firstNight: N[1], lastNight: N[1] } }, { canConfigure: true });
  assert(inline.holdId && (await prisma.eventLodgingHold.findUniqueOrThrow({ where: { id: inline.holdId } })).kind === "SAFETY", "a report can place a safety block in one step");
  const asset = await applyFacilityAction(eventId, staffId, { action: "report", targetKind: "ASSET", assetCode: "K-217", title: "Key was cut badly" }, { canConfigure: false });
  const other = await applyFacilityAction(eventId, staffId, { action: "report", targetKind: "OTHER", targetLabel: "Dining hall", title: "Leak by the door" }, { canConfigure: false });
  assert(asset.issueId && other.issueId, "an item and a place can have issues too");
  await expectAssetError(applyFacilityAction(eventId, staffId, { action: "update", issueId: reported.issueId, status: "RESOLVED" }, { canConfigure: false }), "FACILITY_INVALID", "resolving without saying how");
  await applyFacilityAction(eventId, staffId, { action: "update", issueId: reported.issueId, status: "IN_PROGRESS", assigneeUserId: staffId, note: "Parts ordered" }, { canConfigure: false });
  await expectAssetError(applyFacilityAction(eventId, staffId, { action: "update", issueId: reported.issueId, assigneeUserId: `${P}_nobody` }, { canConfigure: false }), "STAFF_NOT_ON_EVENT", "assigning someone who is not event staff");
  assert((await listFacilityIssues(eventId, { open: true })).some((row) => row.id === reported.issueId && row.status === "IN_PROGRESS" && row.assigneeName === "Desk staff" && row.block?.active === true), "an open issue lists its assignee and its active block");
  await applyFacilityAction(eventId, staffId, { action: "update", issueId: reported.issueId, status: "RESOLVED", resolution: "Latch replaced" }, { canConfigure: false });
  await expectAssetError(applyFacilityAction(eventId, staffId, { action: "update", issueId: reported.issueId, note: "More" }, { canConfigure: false }), "FACILITY_FINISHED", "changing a resolved issue");
  const finished = await prisma.facilityIssue.findUniqueOrThrow({ where: { id: reported.issueId }, include: { history: { orderBy: { revision: "asc" } } } });
  assert(finished.status === "RESOLVED" && finished.resolvedAt && finished.resolvedByUserId === staffId && finished.resolution === "Latch replaced" && finished.history.map((row) => row.type).join() === "REPORTED,BLOCK_PLACED,UPDATED,RESOLVED", `the issue's history keeps every change: ${finished.history.map((row) => row.type).join()}`);
  assert(finished.history.every((row) => row.actorUserId.length > 0), "each change names its actor");
  await expectDatabaseRefusal(prisma.facilityIssue.update({ where: { id: reported.issueId }, data: { severity: "LOW", revision: { increment: 1 } } }), "changing a resolved issue in the database");
  await expectDatabaseRefusal(prisma.facilityIssueHistory.update({ where: { id: finished.history[0]!.id }, data: { note: "Rewritten" } }), "rewriting facility history");
  await expectDatabaseRefusal(prisma.facilityIssueHistory.delete({ where: { id: finished.history[0]!.id } }), "deleting facility history");
  await expectDatabaseRefusal(prisma.facilityIssue.delete({ where: { id: reported.issueId } }), "deleting a facility issue");
  await expectDatabaseRefusal(prisma.facilityIssue.update({ where: { id: second.issueId }, data: { title: "Rewritten", revision: { increment: 1 } } }), "rewriting what an open issue is about");
  await expectDatabaseRefusal(prisma.facilityIssue.update({ where: { id: second.issueId }, data: { severity: "LOW", revision: { increment: 1 } } }), "changing an issue without its history row");

  // Blocks are placed and linked in one transaction: two staff racing to block one issue leave exactly one hold, and a closed issue cannot be blocked.
  const raceUnit = await unitRow("girls-226");
  const raceIssue = await applyFacilityAction(eventId, staffId, { action: "report", targetKind: "UNIT", eventUnitId: raceUnit.id, title: "Door will not lock" }, { canConfigure: false });
  const holdsBeforeRace = await prisma.eventLodgingHold.count({ where: { eventId } });
  const raced = await Promise.all([N[2], N[3]].map((night) => settle(applyFacilityAction(eventId, adminId, { action: "block", issueId: raceIssue.issueId, block: { kind: "MAINTENANCE", reason: "Door will not lock", firstNight: night, lastNight: night } }, { canConfigure: true }))));
  const winners = raced.filter((outcome) => !(outcome instanceof Error));
  const losers = raced.filter((outcome): outcome is Error => outcome instanceof Error);
  assert(winners.length === 1 && losers.length === 1 && losers[0] instanceof AssetError && losers[0].code === "BLOCK_EXISTS", `one block wins and the other is told the issue is already blocked: ${raced.map((outcome) => (outcome instanceof Error ? outcome.message : "ok")).join(" | ")}`);
  assert((await prisma.eventLodgingHold.count({ where: { eventId } })) === holdsBeforeRace + 1 && (await prisma.facilityIssue.findUniqueOrThrow({ where: { id: raceIssue.issueId } })).holdId !== null, "exactly one hold exists and it is linked to the issue");
  const holdsBeforeRefusal = await prisma.eventLodgingHold.count({ where: { eventId } });
  await expectAssetError(applyFacilityAction(eventId, adminId, { action: "block", issueId: reported.issueId, block: { kind: "SAFETY", reason: "Too late", firstNight: N[0], lastNight: N[0] } }, { canConfigure: true }), "FACILITY_FINISHED", "blocking a resolved issue");
  assert((await prisma.eventLodgingHold.count({ where: { eventId } })) === holdsBeforeRefusal, "a refused block leaves no hold behind");

  // ---- Unresolved assets for the closeout ---------------------------------------------------------------
  const jules = await makeReg(eventId);
  await place(jules, "girls-215");
  await issue(jules, ["K-225"]);
  const julesDeposit = await takeDeposit(jules, ["K-225"], 1000);
  await applyIssuanceAction(eventId, adminId, (await openIssuanceOf(jules, "K-225")).id, { action: "correct", reason: "Wrong person" }, { canConfigure: true });
  const kim = await makeReg(eventId);
  await place(kim, "girls-216");
  await issue(kim, ["K-226"]);
  const kimDeposit = await takeDeposit(kim, ["K-226"], 1000);
  await applyIssuanceAction(eventId, adminId, (await openIssuanceOf(kim, "K-226")).id, { action: "replace", replacementCode: "K-227", reason: "Key does not turn", originalAvailability: "UNAVAILABLE" }, { canConfigure: true });
  assert((await prisma.assetDepositCover.count({ where: { depositEntryId: kimDeposit.depositEntryId } })) === 2, "the older replace also carries the deposit to the replacement key");
  await give([{ code: "K-227" }]);
  await expectAssetError(settleDeposit(eventId, staffId, { action: "settle", depositEntryId: kimDeposit.depositEntryId }), "DEPOSIT_UNRESOLVED", "a deposit whose replaced key has no recorded outcome");
  const nora = await makeReg(eventId);
  await place(nora, "girls-211");
  await issue(nora, ["K-228", "K-229"]);
  await give([{ code: "K-228", outcome: "LOST", note: "Never seen again" }]);
  const odd = await makeReg(eventId, "=HYPERLINK(\"http://example.test\")");
  await place(odd, "girls-217");
  await issue(odd, ["K-230"]);
  await give([{ code: "K-230", outcome: "LOST", note: "+cmd lost" }]);

  const ledgerBefore = await prisma.assetLedgerEntry.count({ where: { eventId } });
  const adjustmentsNow = await prisma.registrationAdjustment.count({ where: { eventId } });
  const historyNow = await prisma.assetIssuanceHistory.count({ where: { eventId } });
  const report = await getCloseoutReport(eventId);
  for (const section of closeoutSections) {
    const csv = closeoutCsv(report, section);
    assert(csv.length > 0 && !/(^|,)"[=+\-@\t\r]/m.test(csv), `the ${section} CSV has no cell that could run as a formula`);
  }
  assert(closeoutCsv(report, "lost").includes("\"'=HYPERLINK("), "a holder whose name starts with = is exported as text");
  assert(closeoutCsv(report, "lost").includes("\"'+cmd lost\""), "and so is a note that starts with +");
  assert((await prisma.assetLedgerEntry.count({ where: { eventId } })) === ledgerBefore && (await prisma.registrationAdjustment.count({ where: { eventId } })) === adjustmentsNow && (await prisma.assetIssuanceHistory.count({ where: { eventId } })) === historyNow, "the closeout reads only: it charged, waived, settled and released nothing");
  const codes = new Set(report.exceptions.map((row) => row.code));
  for (const code of ["OUTSTANDING_ITEM", "REPLACED_UNACCOUNTED", "UNCHARGED_LOSS", "DEPOSIT_UNSETTLED", "CORRECTED_WITH_DEPOSIT", "FACILITY_OPEN", "BLOCK_ON_FINISHED_ISSUE"] as const) {
    assert(codes.has(code), `the closeout lists ${code}: ${[...codes].join()}`);
  }
  assert(report.unresolvedCount === report.exceptions.length && report.unresolvedCount > 0, "unresolved assets are counted for a financial closeout to read");
  assert(report.outstanding.some((row) => row.identifier === "K-229") && !report.outstanding.some((row) => row.identifier === "K-215"), "still out lists the key nobody returned, and not the ones that came back");
  assert(report.lost.some((row) => row.identifier === "K-228") && report.lost.some((row) => row.identifier === "K-217") && report.damaged.some((row) => row.identifier === "L-1"), "lost and damaged are listed");
  assert(report.exceptions.some((row) => row.code === "UNCHARGED_LOSS" && row.subject.startsWith("K-228")) && !report.exceptions.some((row) => row.code === "UNCHARGED_LOSS" && row.subject.startsWith("K-219")) && !report.exceptions.some((row) => row.code === "UNCHARGED_LOSS" && row.subject.startsWith("K-217")), "a loss with no charge is flagged; a charged loss and a kept deposit are not");
  assert(report.exceptions.some((row) => row.code === "CORRECTED_WITH_DEPOSIT" && row.subject.startsWith("K-225")), "an issue withdrawn as an error while a deposit is open is an exception, not an ordinary return");
  assert(report.deposits.some((row) => row.entryId === julesDeposit.depositEntryId && row.state === "HELD") && report.deposits.some((row) => row.entryId === deposit.depositEntryId && row.state === "HANDED_BACK") && report.deposits.some((row) => row.entryId === bobDeposit.depositEntryId && row.state === "KEPT") && report.deposits.some((row) => row.entryId === erinDeposit.depositEntryId && row.state === "PARTLY_KEPT"), "deposits are listed held, handed back, kept and partly kept");
  const sumKind = async (kind: "DEPOSIT_RECEIVED" | "DEPOSIT_RETURNED" | "DEPOSIT_KEPT") => (await prisma.assetLedgerEntry.aggregate({ where: { eventId, kind }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;
  const [received, handedBack, keptTotal] = await Promise.all([sumKind("DEPOSIT_RECEIVED"), sumKind("DEPOSIT_RETURNED"), sumKind("DEPOSIT_KEPT")]);
  const lateBack = (await prisma.assetLedgerEntry.aggregate({ where: { eventId, kind: "DEPOSIT_HANDED_BACK_LATE" }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;
  assert(lateBack === 2000 && report.money.depositsReceivedCents === received && report.money.depositsHandedBackCents === handedBack + lateBack && report.money.depositsKeptCents === keptTotal - lateBack && report.money.depositsHeldCents === received - handedBack - keptTotal && report.money.depositsHeldCents === 2000, `deposits held versus returned reconcile (only Jules and Kim are still held): ${JSON.stringify(report.money)}`);
  assert(report.money.chargedCents === 2500 + 1100 + 1500 + 2500 + 400 + 2500 + 2500 + 2500 + 2500 + 1500 + 400 && report.money.waivedCents === 2500 + 1100 + 2500 + 2500 + 1500 + 400 && report.money.netChargedCents === 1500 + 2500 + 400 + 2500 + 2500, `charged and waived totals reconcile: ${JSON.stringify(report.money)}`);
  assert(report.charges.length === 11 && report.charges.filter((row) => row.state === "WAIVED" && row.waiver).length === 6, "charges list their waivers");
  assert(report.exceptions.some((row) => row.code === "WAIVED_ON_INACTIVE_REGISTRATION" && row.subject.startsWith("K-244")), "a charge waived on a cancelled registration is flagged: the line is still on its total");
  assert(report.lost.find((row) => row.identifier === "TOWELS")?.quantity === 1, "a lot lost in part shows the quantity lost, not the quantity of the issue");
  assert(report.lost.some((row) => row.identifier === "K-241") && !report.lost.some((row) => row.identifier === "K-235" || row.identifier === "K-233"), "the closeout reads the corrected fates: a replaced original corrected to lost is lost, a found key is not");
  assert(report.exceptions.some((row) => row.code === "CORRECTION_NEEDS_REVIEW" && row.subject.startsWith("K-235")), "a correction after the deposit was settled is flagged for staff");
  assert(!report.exceptions.some((row) => row.code === "UNCHARGED_LOSS" && (row.subject.startsWith("K-243") || row.subject.startsWith("K-241") || row.subject.startsWith("L-6"))) && report.exceptions.some((row) => row.code === "UNCHARGED_LOSS" && row.subject.startsWith("K-228")), "a written-off loss and a loss whose deposit was settled are not flagged; an untouched one is");
  assert(report.exceptions.some((row) => row.code === "REPLACED_UNACCOUNTED" && row.subject.startsWith("K-226")) && !report.exceptions.some((row) => row.code === "REPLACED_UNACCOUNTED" && (row.subject.startsWith("K-237") || row.subject.startsWith("K-241"))), "a replaced original given a fate or written off leaves the exceptions");
  assert(report.types.every((row) => row.balanced), `issued, returned, outstanding, lost and damaged reconcile for every kind: ${report.types.filter((row) => !row.balanced).map((row) => `${row.typeName} ${JSON.stringify(row)}`).join(" | ")}`);
  const towelCounts = report.types.find((row) => row.typeName === "Towels")!;
  assert(towelCounts.inflow === 7 && towelCounts.returned === 3 && towelCounts.lost === 1 && towelCounts.outstanding === 3, `the lot's counts add up: ${JSON.stringify(towelCounts)}`);
  assert(report.facility.some((row) => row.id === second.issueId) && !report.facility.some((row) => row.id === reported.issueId), "open facility issues are listed, resolved ones are not");

  // Releasing the block restores the room, still without touching the assignment.
  await changeHold(eventId, blocked.holdId!, adminId, { action: "release", reason: "Latch replaced" }, prisma);
  const restored = (await getLodgingView(eventId, prisma)).buildings.flatMap((building) => building.units).find((unit) => unit.key === "girls-205")!;
  assert(restored.nightStatuses.every((status) => status === "AVAILABLE"), "releasing the block returns the room to the inventory");
  assert((await prisma.eventLodgingAssignment.findUniqueOrThrow({ where: { id: assignmentBefore.id } })).cancelledAt === null, "and the assignment was never touched");
  assert(!(await getCloseoutReport(eventId)).exceptions.some((row) => row.code === "BLOCK_ON_FINISHED_ISSUE" && row.refId === reported.issueId), "a resolved issue whose block was released leaves the closeout");

  // ---- Nothing crosses events and everything goes with the event ----------------------------------------------
  const foreign = await returnAssets(otherEventId, adminId, { items: [{ issuanceId: (await openIssuanceOf(nora, "K-229")).id }] });
  assert(statusOf(foreign.items[0]) === "REJECTED/ISSUANCE_NOT_FOUND", "another event cannot return this event's key");
  assert((await openIssuanceOf(nora, "K-229")).endedAt === null, "and the key is untouched");
  await expectAssetError(recordDeposit(otherEventId, adminId, { action: "record", issuanceIds: [(await openIssuanceOf(nora, "K-229")).id], amountCents: 500 }), "ISSUANCE_NOT_FOUND", "another event taking a deposit for this event's key");
  await expectAssetError(settleDeposit(otherEventId, adminId, { action: "settle", depositEntryId: deposit.depositEntryId }), "DEPOSIT_NOT_FOUND", "another event settling this event's deposit");
  await expectAssetError(waiveCharge(otherEventId, adminId, { action: "waive", chargeEntryId: charge.chargeEntryId, reason: "Not yours" }, FINANCE), "CHARGE_NOT_FOUND", "another event waiving this event's charge");
  await expectAssetError(applyFacilityAction(otherEventId, adminId, { action: "update", issueId: second.issueId, note: "Not yours" }, { canConfigure: true }), "FACILITY_NOT_FOUND", "another event changing this event's facility issue");
  const counts = () => Promise.all([
    prisma.assetLedgerEntry.count({ where: { eventId } }), prisma.assetDepositCover.count({ where: { eventId } }),
    prisma.facilityIssue.count({ where: { eventId } }), prisma.facilityIssueHistory.count({ where: { eventId } }),
    prisma.assetIssuance.count({ where: { eventId } }), prisma.registrationAdjustment.count({ where: { eventId, kind: "ASSET" } }),
  ]);
  assert((await counts()).every((count) => count > 0), `the event holds rows of every slice 2 kind: ${(await counts()).join()}`);
  assert(await caught(prisma.$transaction(async (tx) => { await tx.assetLedgerEntry.deleteMany({ where: { eventId } }); })), "without the event-deletion setting the ledger cannot be deleted");
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('imsda.event_deletion', 'on', true)`;
    await removeEventOwnedRows(tx, eventId);
  }, { timeout: 60_000 });
  assert((await prisma.event.count({ where: { id: eventId } })) === 0 && (await counts()).every((count) => count === 0), "the event deletion service's ordered deletes remove every slice 2 row, then the event");
  console.log("Issued assets slice 2 verified.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await cleanup(); } catch (error) { console.error("Cleanup failed:", error instanceof Error ? error.message : error); process.exitCode = 1; }
    await prisma.$disconnect();
  });
