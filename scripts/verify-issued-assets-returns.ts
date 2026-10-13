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
import { postCharge, recordDeposit, settleDeposit, waiveCharge } from "@/modules/issued-assets/money-service";
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
  await applyAssetAction(eventId, adminId, { action: "bulk", typeId: keyType, prefix: "K-", from: 201, to: 240 });
  for (const identifier of ["L-1", "L-2", "L-3"]) await applyAssetAction(eventId, adminId, { action: "create", typeId: lodgeType, identifier });
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
  const recordOnly = await postCharge(eventId, financeId, { action: "charge", issuanceId: (await issuanceOf(erin, "L-1")).id, category: "DAMAGE", amountCents: 1500, reason: "Bent key", post: false }, FINANCE);
  assert(!recordOnly.posted && (await registrationTotal(erin)) === 0, "a charge recorded without posting leaves the registration alone");
  const recordOnlyWaiver = await waiveCharge(eventId, financeId, { action: "waive", chargeEntryId: recordOnly.chargeEntryId, reason: "Within normal wear" }, FINANCE);
  assert(!recordOnlyWaiver.reversedOnRegistration && (await registrationTotal(erin)) === 0, "waiving a record-only charge posts nothing");
  await expectDatabaseRefusal(prisma.assetLedgerEntry.update({ where: { id: charge.chargeEntryId }, data: { amountCents: 1 } }), "rewriting a ledger entry");
  await expectDatabaseRefusal(prisma.assetLedgerEntry.delete({ where: { id: charge.chargeEntryId } }), "deleting a ledger entry");
  await expectDatabaseRefusal(prisma.assetLedgerEntry.create({ data: { eventId, kind: "WAIVER", amountCents: 1, waivesEntryId: charge.chargeEntryId, issuanceId: lost219.id, settlement: "RECORD_ONLY", reason: "Different amount", actorUserId: financeId, actorNameSnapshot: "Finance person" } }), "a waiver of another amount, or a second waiver");
  await expectDatabaseRefusal(prisma.assetDepositCover.delete({ where: { issuanceId: (await prisma.assetDepositCover.findFirstOrThrow({ where: { depositEntryId: bobDeposit.depositEntryId } })).issuanceId } }), "deleting a deposit's coverage");
  const moneyAudit = await prisma.auditLog.findMany({ where: { eventId, action: { in: ["ASSET_DEPOSIT_RECORDED", "ASSET_DEPOSIT_SETTLED", "ASSET_CHARGE_RECORDED", "ASSET_CHARGE_WAIVED", "ASSET_RETURN_RECORDED"] } } });
  assert(moneyAudit.length >= 8 && !JSON.stringify(moneyAudit).includes(dana.last) && !JSON.stringify(moneyAudit).includes(alice.first), "the money and return audit entries carry no names");

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
  assert(report.money.depositsReceivedCents === 800 + 1000 + 1000 + 1000 + 1000 && report.money.depositsHandedBackCents === 800 + 600 && report.money.depositsKeptCents === 1000 + 400 && report.money.depositsHeldCents === 2000, `deposits held versus returned reconcile: ${JSON.stringify(report.money)}`);
  assert(report.money.chargedCents === 2500 + 1500 && report.money.waivedCents === 2500 + 1500 && report.money.netChargedCents === 0, "charged and waived totals reconcile");
  assert(report.charges.length === 2 && report.charges.every((row) => row.state === "WAIVED" && row.waiver), "charges list their waivers");
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
