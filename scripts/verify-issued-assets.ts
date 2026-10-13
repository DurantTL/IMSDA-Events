/**
 * Proves issued assets (#213, slice 1) against a real PostgreSQL database, where unit tests cannot:
 *
 * - the catalog: numbered and quantity kinds, a numbered range (K-201..K-260) that is safe to run twice, codes that
 *   resolve the same for a scan value and a typed identifier, and a kind that keeps its behaviour once it has items;
 * - issue: two room keys and a welcome packet in one request, linked to the exact lodging assignment; a repeated scan is
 *   a duplicate that changes nothing; a key held by someone else is refused; a partial group issue reports each item;
 *   an atomic one issues nothing; a saved retry key replays instead of issuing twice;
 * - concurrency: eight staff scanning one key leave one holder, five identical requests leave one issue, a lot of three
 *   is never over-issued by eight racers, and two overlapping group issues in opposite orders never deadlock;
 * - room moves: a key keeps the room and assignment it was issued against after the family moves, the desk shows the
 *   move, a replacement key follows the new assignment, and the room's own history lists both;
 * - transfer, replacement and correction end the old issue and append history; nothing is overwritten or deleted, and
 *   the database refuses a second open issue, an over-issue, a rewrite and a delete even from a writer that skips the service;
 * - offline entry: a saved time and the assignment as it was then are kept; the same entry made online is refused;
 * - nothing here changes a registration's charge, the audit log carries no names, and every row goes with its event.
 *
 * Uses fictitious rows it creates and removes itself.
 *
 *   npm run test:issued-assets
 */
import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";
import { fillBlankSyntheticEnv } from "./support/synthetic-env";
import { AssetError, type AssetErrorCode } from "@/modules/issued-assets/errors";
import { applyAssetAction, applyAssetTypeAction, applyIssuanceAction as applyIssuanceActionAs, issueAssets, type IssueResult } from "@/modules/issued-assets/service";
import { getCatalogView, getDeskPerson, listAssetHistory, listOutNow, listRoomIssuances, lookupAsset } from "@/modules/issued-assets/view";
import { applyAssignmentAction } from "@/modules/lodging/assignment-service";
import { selectEventProperty } from "@/modules/lodging/service";
import { syncLodgingTemplates } from "@/modules/lodging/sync";

loadEnvConfig(process.cwd());
// Local-only, before any connection exists.
assertLocalDatabase(process.env, "run this verification");
fillBlankSyntheticEnv("SECRET_ENCRYPTION_KEY", "verify-issued-assets-synthetic-key-not-a-secret");

const prisma = new PrismaClient();
/** Most steps act as an event administrator; the permission steps pass their own options. */
const applyIssuanceAction = (forEvent: string, actor: string, issuanceId: string, raw: unknown, options: { canConfigure: boolean; now?: Date } = { canConfigure: true }) => applyIssuanceActionAs(forEvent, actor, issuanceId, raw, options);
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const P = `asset213_${randomUUID().slice(0, 8)}`;
const userId = `${P}_user`;
const staffId = `${P}_staff`;
const eventId = `${P}_ev`;
const otherEventId = `${P}_ev_other`;
const surname = `Ast${P}`;
const N = ["2027-06-15", "2027-06-16", "2027-06-17", "2027-06-18"] as const;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function caught(promise: Promise<unknown>) {
  return promise.then(() => null, (error: unknown) => error);
}

/** The result, or the error it threw: for racing calls whose results are compared. */
const settle = <T,>(promise: Promise<T>) => promise.then((value): T | Error => value, (error: unknown): T | Error => (error instanceof Error ? error : new Error(String(error))));

async function expectAssetError(promise: Promise<unknown>, code: AssetErrorCode, message: string) {
  const error = await caught(promise);
  assert(error instanceof AssetError && error.code === code, `${message}: expected ${code}, got ${error instanceof AssetError ? error.code : String(error)}`);
  return error as AssetError;
}

async function expectDatabaseRefusal(promise: Promise<unknown>, message: string) {
  const error = await caught(promise);
  assert(error, `${message}: the database accepted it`);
}

async function expectDatabaseMessage(promise: Promise<unknown>, pattern: RegExp, message: string) {
  const error = await caught(promise);
  assert(error instanceof Error && pattern.test(error.message), `${message}: expected the database to refuse with ${pattern}, got ${error instanceof Error ? error.message.slice(0, 200) : "no error"}`);
}

async function cleanup() {
  const registrationIds = (await prisma.registration.findMany({ where: { eventId: { startsWith: `${P}_` } }, select: { id: true } })).map((row) => row.id);
  await prisma.messageOutbox.deleteMany({ where: { OR: [{ registrationId: { in: registrationIds } }, { eventId: { startsWith: `${P}_` } }] } });
  await prisma.$transaction([
    prisma.$executeRaw`SELECT set_config('imsda.event_deletion', 'on', true)`,
    prisma.assetIssuanceHistory.deleteMany({ where: { eventId: { startsWith: `${P}_` } } }),
    prisma.assetIssuance.deleteMany({ where: { eventId: { startsWith: `${P}_` } } }),
    prisma.issuedAsset.deleteMany({ where: { eventId: { startsWith: `${P}_` } } }),
    prisma.issuedAssetType.deleteMany({ where: { eventId: { startsWith: `${P}_` } } }),
    prisma.eventLodgingAssignmentHistory.deleteMany({ where: { eventId: { startsWith: `${P}_` } } }),
    prisma.eventLodgingAssignment.deleteMany({ where: { eventId: { startsWith: `${P}_` } } }),
  ]);
  await prisma.event.deleteMany({ where: { id: { startsWith: `${P}_` } } });
  await prisma.person.deleteMany({ where: { lastName: { startsWith: surname } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: userId }, { eventId: { startsWith: `${P}_` } }] } });
  await prisma.user.deleteMany({ where: { id: { in: [userId, staffId] } } });
}

async function createEvent(id: string) {
  await prisma.event.create({
    data: {
      id, slug: `${id}-slug`, name: `Issued assets check ${id}`,
      startsAt: new Date("2027-06-15T15:00:00Z"), endsAt: new Date("2027-06-19T15:00:00Z"), timezone: "America/Chicago",
      registrationClosesOn: "2027-06-01", attendeeEditPolicy: "TIERED", isPublished: true,
    },
  });
}

type Person = { attendeeId: string; registrationId: string; last: string; first: string };
let counter = 0;

async function makeReg(forEvent: string, status: "CONFIRMED" | "CANCELLED" = "CONFIRMED", size = 1): Promise<{ id: string; people: Person[] }> {
  counter += 1;
  const registrationId = randomUUID();
  const persons = [];
  for (let index = 0; index < size; index += 1) {
    const first = `Alder${counter}x${index}`;
    const last = `${surname}${counter}`;
    persons.push(await prisma.person.create({ data: { firstName: first, lastName: last, normalizedEmail: `${P}.${counter}.${index}@assets.example.test` } }));
  }
  await prisma.registration.create({
    data: { id: registrationId, eventId: forEvent, accountHolderPersonId: persons[0]!.id, confirmationCode: `AST-${P.slice(-6).toUpperCase()}${counter}`, status, totalAmount: 0, submittedAt: new Date("2027-05-20T12:00:00Z") },
  });
  const people: Person[] = [];
  for (const [index, person] of persons.entries()) {
    const attendee = await prisma.registrationAttendee.create({
      data: { eventId: forEvent, registrationId, personId: person.id, attendeeType: "adult", position: index, profileSnapshot: { firstName: person.firstName, lastName: person.lastName }, formResponses: {} },
    });
    people.push({ attendeeId: attendee.id, registrationId, first: person.firstName, last: person.lastName });
  }
  return { id: registrationId, people };
}

const unitRow = (key: string) => prisma.eventLodgingUnit.findFirstOrThrow({ where: { eventId, unit: { key } }, include: { unit: true } });

async function place(person: Person, key: string, first: string = N[0], last: string = N[3], mode: "ASSIGN" | "MOVE" = "ASSIGN", reason?: string) {
  const row = await unitRow(key);
  await applyAssignmentAction(eventId, userId, {
    action: "place", ...(reason ? { reason } : {}),
    placements: [{ occupant: { kind: "ATTENDEE", id: person.attendeeId }, place: { kind: "UNIT", eventUnitId: row.id }, firstNight: first, lastNight: last, mode }],
  }, prisma);
  return row;
}

const currentAssignment = (person: Person) => prisma.eventLodgingAssignment.findFirstOrThrow({ where: { eventId, attendeeId: person.attendeeId, cancelledAt: null } });
const issue = (person: Person, codes: string[], extra: Record<string, unknown> = {}) =>
  issueAssets(eventId, userId, { assignee: { kind: "ATTENDEE", attendeeId: person.attendeeId }, items: codes.map((code) => ({ code })), ...extra });
const statuses = (result: IssueResult) => result.items.map((item) => `${item.code}:${item.status}${item.error ? `/${item.error.code}` : ""}`).join(" ");
const openCount = (assetCode: string) => prisma.assetIssuance.count({ where: { eventId, endedAt: null, asset: { identifier: assetCode } } });
const assetId = async (identifier: string) => (await prisma.issuedAsset.findFirstOrThrow({ where: { eventId, identifier } })).id;

async function main() {
  await cleanup();
  await prisma.user.create({ data: { id: userId, email: `${P}@assets.example.test`, displayName: "Asset verifier" } });
  await prisma.user.create({ data: { id: staffId, email: `${P}.staff@assets.example.test`, displayName: "Asset staff" } });
  await syncLodgingTemplates(prisma);
  await createEvent(eventId);
  await createEvent(otherEventId);
  await prisma.eventMembership.create({ data: { eventId, userId: staffId, role: "CHECK_IN_STAFF", status: "ACTIVE" } });
  await selectEventProperty(eventId, userId, { propertyKey: "sunnydale-academy" }, prisma);

  // ---- Catalog -------------------------------------------------------------
  const keyType = (await applyAssetTypeAction(eventId, userId, { action: "create", name: "Dorm room key", mode: "SERIALIZED", assigneeKinds: ["ATTENDEE", "REGISTRATION", "ROOM"], roomLinked: true, depositPolicyRef: "CM26 key deposit" })).id;
  const packetType = (await applyAssetTypeAction(eventId, userId, { action: "create", name: "Welcome packet", mode: "QUANTITY", assigneeKinds: ["ATTENDEE", "REGISTRATION"] })).id;
  const radioType = (await applyAssetTypeAction(eventId, userId, { action: "create", name: "Radio", mode: "SERIALIZED", assigneeKinds: ["STAFF", "TEAM", "VEHICLE"] })).id;
  const retiredType = (await applyAssetTypeAction(eventId, userId, { action: "create", name: "Old wristband", mode: "SERIALIZED", assigneeKinds: ["ATTENDEE"] })).id;
  await expectAssetError(applyAssetTypeAction(eventId, userId, { action: "create", name: "Dorm room key", mode: "SERIALIZED", assigneeKinds: ["ATTENDEE"] }), "TYPE_EXISTS", "a second type with the same name");
  const keyRow = await prisma.issuedAssetType.findUniqueOrThrow({ where: { id: keyType } });
  assert(keyRow.depositPolicyRef === "CM26 key deposit" && keyRow.roomLinked && keyRow.active, "a type keeps its policy reference, room link and active state");
  assert(!("depositAmount" in keyRow), "a type carries a policy reference only, never an amount");

  const range = await applyAssetAction(eventId, userId, { action: "bulk", typeId: keyType, prefix: "k-", from: 201, to: 260 });
  assert(range.created === 60 && range.skipped === 0, `the range K-201..K-260 adds sixty numbered keys, got ${range.created}`);
  assert((await applyAssetAction(eventId, userId, { action: "bulk", typeId: keyType, prefix: "K-", from: 201, to: 262 })).created === 2, "running an overlapping range adds only the new numbers");
  const again = await applyAssetAction(eventId, userId, { action: "bulk", typeId: keyType, prefix: "K-", from: 201, to: 262 });
  assert(again.created === 0 && again.skipped === 62, "running the same range twice changes nothing");
  await expectAssetError(applyAssetAction(eventId, userId, { action: "bulk", typeId: keyType, prefix: "K-", from: 5, to: 1 }), "RANGE_INVALID", "a range that runs backwards");
  await expectAssetError(applyAssetAction(eventId, userId, { action: "bulk", typeId: packetType, prefix: "P-", from: 1, to: 5 }), "RANGE_INVALID", "a numbered range of a quantity kind");
  await applyAssetAction(eventId, userId, { action: "create", typeId: keyType, identifier: "K-300", scanCode: "bc0000300" });
  await expectAssetError(applyAssetAction(eventId, userId, { action: "create", typeId: keyType, identifier: "K-301", scanCode: "K-214" }), "ASSET_EXISTS", "a scan value that is another item's identifier");
  await applyAssetAction(eventId, userId, { action: "create", typeId: packetType, identifier: "WP-27", quantityTotal: 5 });
  await applyAssetAction(eventId, userId, { action: "create", typeId: packetType, identifier: "TOWELS", quantityTotal: 3 });
  for (const identifier of ["R-1", "R-2", "R-3", "R-4", "R-5", "R-6", "R-7", "R-8"]) await applyAssetAction(eventId, userId, { action: "create", typeId: radioType, identifier });
  await applyAssetAction(eventId, userId, { action: "create", typeId: retiredType, identifier: "WB-1" });
  await applyAssetTypeAction(eventId, userId, { action: "update", typeId: retiredType, active: false });
  await expectAssetError(applyAssetAction(eventId, userId, { action: "create", typeId: keyType, identifier: "K-400", quantityTotal: 2 }), "QUANTITY_INVALID", "a numbered item that is two");
  await expectDatabaseRefusal(prisma.issuedAssetType.update({ where: { id: keyType }, data: { mode: "QUANTITY" } }), "changing a kind that has items from numbered to quantity")
  const catalog = await getCatalogView(eventId);
  assert(catalog.assets.length === 62 + 1 + 2 + 8 + 1 && catalog.types.find((type) => type.id === keyType)!.assetCount === 63, "the catalog lists every item");
  assert(catalog.assets.findIndex((asset) => asset.identifier === "K-9" ) === -1 && catalog.assets.map((asset) => asset.identifier).indexOf("K-201") < catalog.assets.map((asset) => asset.identifier).indexOf("K-210"), "the catalog sorts numbers as numbers");

  // ---- Issue: two keys and a welcome packet, linked to the exact assignment ----
  const alice = (await makeReg(eventId)).people[0]!;
  const registrationBefore = await prisma.registration.findUniqueOrThrow({ where: { id: alice.registrationId } });
  const room201 = await place(alice, "girls-201");
  const a1 = await currentAssignment(alice);
  const roomless = await issue((await makeReg(eventId)).people[0]!, ["K-214", "WP-27"]);
  assert(roomless.items[0]!.error?.code === "ROOM_ASSIGNMENT_REQUIRED" && roomless.items[1]!.status === "ISSUED", `a room key needs a room, a packet does not: ${statuses(roomless)}`);
  const first = await issue(alice, ["K-214", "k-215 ", "WP-27"], { purpose: "Issued at check-in" });
  assert(first.issued === 3 && first.rejected === 0 && first.duplicates === 0, `two keys and a packet are issued: ${statuses(first)}`);
  const issued = await prisma.assetIssuance.findMany({ where: { eventId, attendeeId: alice.attendeeId }, include: { asset: true }, orderBy: { asset: { identifier: "asc" } } });
  assert(issued.length === 3 && issued.map((row) => row.asset.identifier).join() === "K-214,K-215,WP-27", "three issuances exist");
  const keys = issued.filter((row) => row.asset.identifier.startsWith("K-"));
  assert(keys.every((row) => row.roomUnitId === room201.id && row.sourceAssignmentId === a1.id && row.issuedByUserId === userId && row.entryMethod === "MANUAL" && row.serialized && row.quantity === 1), "each key records the room, the exact assignment, the actor and the method");
  const packet = issued.find((row) => row.asset.identifier === "WP-27")!;
  assert(packet.roomUnitId === null && packet.sourceAssignmentId === null && !packet.serialized, "a welcome packet is a quantity item with no room");
  const firstHistory = await prisma.assetIssuanceHistory.findMany({ where: { eventId, issuanceId: { in: issued.map((row) => row.id) } } });
  assert(firstHistory.length === 3 && firstHistory.every((row) => row.type === "ISSUED" && row.revision === 1 && row.actorUserId === userId), "every issue appended one history row");
  const issuedAudit = await prisma.auditLog.findMany({ where: { eventId, action: "ASSET_ISSUED" } });
  assert(issuedAudit.length >= 1 && !JSON.stringify(issuedAudit).includes(alice.last) && !JSON.stringify(issuedAudit).includes(alice.first), "the audit log carries no name");
  assert((await prisma.registration.findUniqueOrThrow({ where: { id: alice.registrationId } })).totalAmount.toString() === registrationBefore.totalAmount.toString() && (await prisma.payment.count({ where: { eventId } })) === 0, "issuing never changes a charge or creates a payment");

  // ---- Duplicate scans, other holders, partial and atomic group issue ----------
  const rowsBefore = await prisma.assetIssuance.count({ where: { eventId } });
  const historyBefore = await prisma.assetIssuanceHistory.count({ where: { eventId } });
  const repeat = await issue(alice, ["K-214", "K-215", "WP-27"]);
  assert(repeat.issued === 0 && repeat.duplicates === 3 && repeat.items.every((item) => item.status === "DUPLICATE"), `a repeated scan is a duplicate: ${statuses(repeat)}`);
  assert((await prisma.assetIssuance.count({ where: { eventId } })) === rowsBefore && (await prisma.assetIssuanceHistory.count({ where: { eventId } })) === historyBefore, "a duplicate scan writes nothing");
  const bob = (await makeReg(eventId)).people[0]!;
  await place(bob, "girls-202");
  const partial = await issue(bob, ["K-214", "K-216", "K-NOPE", "K-216"]);
  assert(partial.issued === 1 && partial.rejected === 3, `a partial group issue issues what it can: ${statuses(partial)}`);
  assert(partial.items[0]!.error?.code === "ALREADY_ISSUED" && partial.items[2]!.error?.code === "ASSET_NOT_FOUND" && partial.items[3]!.error?.code === "DUPLICATE_IN_REQUEST", "and says why for each item");
  assert((await openCount("K-216")) === 1 && (await openCount("K-214")) === 1, "the key held by someone else stays with them");
  const atomicBefore = await prisma.assetIssuance.count({ where: { eventId } });
  const atomic = await expectAssetError(issue(bob, ["K-217", "K-214"], { atomic: true }), "ITEMS_REJECTED", "an all-or-nothing issue with one taken key");
  assert((atomic.details as { items: unknown[] }).items.length === 2 && (await prisma.assetIssuance.count({ where: { eventId } })) === atomicBefore, "an all-or-nothing issue writes nothing and reports each item");
  // A scan value and a typed identifier are the same lookup.
  const scanned = await issue(bob, ["BC0000300"], { entryMethod: "SCAN" });
  assert(scanned.issued === 1 && scanned.items[0]!.identifier === "K-300", "a barcode value finds the key by its scan code");
  assert((await issue(bob, ["k-300"])).duplicates === 1, "and the typed identifier finds the same key");
  assert((await prisma.assetIssuance.findFirstOrThrow({ where: { eventId, asset: { identifier: "K-300" } } })).entryMethod === "SCAN", "the entry method is recorded");
  // Rules every path shares.
  assert((await issue(bob, ["R-1"])).items[0]!.error?.code === "ASSIGNEE_KIND_NOT_ALLOWED", "a radio cannot go to an attendee")
  assert((await issue(bob, ["WB-1"])).items[0]!.error?.code === "TYPE_INACTIVE", "a switched-off kind is refused");
  await applyAssetAction(eventId, userId, { action: "update", assetId: await assetId("K-218"), availability: "UNAVAILABLE" });
  assert((await issue(bob, ["K-218"])).items[0]!.error?.code === "ASSET_UNAVAILABLE", "an unavailable key is refused");
  const gone = await makeReg(eventId, "CANCELLED");
  await expectAssetError(issue(gone.people[0]!, ["WP-27"]), "REGISTRATION_NOT_ACTIVE", "a cancelled registration");
  const stranger = await makeReg(otherEventId);
  await expectAssetError(issue(stranger.people[0]!, ["WP-27"]), "ASSIGNEE_NOT_FOUND", "an attendee of another event");
  assert((await issueAssets(otherEventId, userId, { assignee: { kind: "ATTENDEE", attendeeId: stranger.people[0]!.attendeeId }, items: [{ code: "WP-27" }] })).items[0]!.error?.code === "ASSET_NOT_FOUND", "another event cannot see this event's items");
  // Staff, team, vehicle and room holders.
  assert((await issueAssets(eventId, userId, { assignee: { kind: "STAFF", userId: staffId }, items: [{ code: "R-1" }], purpose: "Parking crew" })).issued === 1, "a radio to a staff member");
  await expectAssetError(issueAssets(eventId, userId, { assignee: { kind: "STAFF", userId }, items: [{ code: "R-2" }] }), "STAFF_NOT_ON_EVENT", "a user who is not event staff");
  assert((await issueAssets(eventId, userId, { assignee: { kind: "TEAM", label: "Kitchen" }, items: [{ code: "R-2" }] })).issued === 1, "a radio to a team");
  const room203 = await unitRow("girls-203");
  assert((await issueAssets(eventId, userId, { assignee: { kind: "ROOM", eventUnitId: room203.id }, items: [{ code: "K-220" }] })).issued === 1, "a key to a room");
  assert((await prisma.assetIssuance.findFirstOrThrow({ where: { eventId, asset: { identifier: "K-220" } } })).roomUnitId === room203.id, "the room is the holder");

  // ---- Saved retry keys ------------------------------------------------------
  const carol = (await makeReg(eventId)).people[0]!;
  await place(carol, "girls-204");
  const retryKey = `retry-${randomUUID()}`;
  const sent = await issue(carol, ["K-221", "K-222"], { idempotencyKey: retryKey });
  const resent = await issue(carol, ["K-221", "K-222"], { idempotencyKey: retryKey });
  assert(sent.issued === 2 && resent.issued === 0 && resent.items.every((item) => item.status === "REPLAYED" && item.issuanceId), "a retry with the saved key returns the original issue and writes nothing twice");
  assert((await prisma.assetIssuance.count({ where: { eventId, attendeeId: carol.attendeeId } })) === 2, "so there are still two issues");
  await expectAssetError(issue(carol, ["K-223", "K-222"], { idempotencyKey: retryKey }), "IDEMPOTENCY_KEY_REUSED", "a key reused for different items");

  // ---- Quantity ---------------------------------------------------------------
  const holders: Person[] = [];
  for (let index = 0; index < 4; index += 1) holders.push((await makeReg(eventId)).people[0]!);
  const [q1, q2, q3] = holders;
  assert((await issue(q1!, ["TOWELS"], { items: [{ code: "TOWELS", quantity: 2 }] })).issued === 1, "two of three towels");
  assert((await issue(q2!, ["TOWELS"], { items: [{ code: "TOWELS", quantity: 2 }] })).items[0]!.error?.code === "INSUFFICIENT_QUANTITY", "two more than are left is refused");
  assert((await issue(q2!, ["TOWELS"], { items: [{ code: "TOWELS", quantity: 1 }] })).issued === 1, "the last towel");
  const dry = (await issue(q3!, ["TOWELS"]));
  assert(dry.items[0]!.error?.code === "INSUFFICIENT_QUANTITY" && dry.items[0]!.error.message === "None left to issue.", "an exhausted lot says none are left");
  assert((await issue(q1!, ["TOWELS"])).duplicates === 1, "a repeated tap for the same holder is not a second helping");
  assert((await issue(q1!, ["TOWELS"], { items: [{ code: "TOWELS", quantity: 1, addMore: true }] })).items[0]!.error?.code === "INSUFFICIENT_QUANTITY", "even asking for more finds none left");
  const towelIssue = await prisma.assetIssuance.findFirstOrThrow({ where: { eventId, attendeeId: q1!.attendeeId, asset: { identifier: "TOWELS" } } });
  await applyIssuanceAction(eventId, userId, towelIssue.id, { action: "correct", reason: "Counted wrong" });
  assert((await issue(q3!, ["TOWELS"], { items: [{ code: "TOWELS", quantity: 2 }] })).issued === 1, "a corrected issue frees its quantity");
  await expectDatabaseRefusal(prisma.issuedAsset.update({ where: { id: await assetId("TOWELS") }, data: { quantityTotal: 2 } }), "shrinking a lot below what is out");
  await expectAssetError(applyAssetAction(eventId, userId, { action: "update", assetId: await assetId("TOWELS"), quantityTotal: 2 }), "ASSET_IN_USE", "shrinking a lot below what is out through the service");

  // ---- Concurrency --------------------------------------------------------------
  const racers: Person[] = [];
  for (const key of ["girls-301", "girls-302", "girls-303", "girls-304", "girls-305", "girls-307", "girls-311", "girls-312"]) {
    const person = (await makeReg(eventId)).people[0]!;
    await place(person, key, N[0], N[1]);
    racers.push(person);
  }
  // Eight staff scan the same key for eight different people.
  const keyRace = await Promise.all(racers.map((person) => settle(issue(person, ["K-230"], { items: [{ code: "K-230" }] }))));
  assert(keyRace.every((outcome) => !(outcome instanceof Error)), `no racer errors out: ${keyRace.filter((outcome) => outcome instanceof Error).map((outcome) => String(outcome)).join(" | ")}`);
  const raced = keyRace as IssueResult[];
  assert(raced.filter((result) => result.issued === 1).length === 1, `exactly one of eight racers gets the key: ${raced.map(statuses).join(" | ")}`);
  assert(raced.filter((result) => result.items[0]!.error?.code === "ALREADY_ISSUED").length === 7, "the other seven are told it is already issued");
  assert((await openCount("K-230")) === 1, "one open issue holds the key");
  // Five identical requests (a double-tapped scan) leave one issue.
  const twin = racers[0]!;
  const taps = await Promise.all(Array.from({ length: 5 }, () => settle(issue(twin, ["K-231", "WP-27"]))));
  assert(taps.every((outcome) => !(outcome instanceof Error)), `no double-tap errors: ${taps.filter((outcome) => outcome instanceof Error).map(String).join(" | ")}`);
  assert((await openCount("K-231")) === 1 && (await prisma.assetIssuance.count({ where: { eventId, attendeeId: twin.attendeeId, asset: { identifier: "WP-27" }, endedAt: null } })) === 1, "five identical requests leave one issue of each item");
  // A lot of three is never over-issued by eight racers.
  await applyAssetAction(eventId, userId, { action: "create", typeId: packetType, identifier: "LANYARD", quantityTotal: 3 });
  const lotRace = await Promise.all(racers.map((person) => settle(issue(person, ["LANYARD"]))));
  assert(lotRace.every((outcome) => !(outcome instanceof Error)), `no lot racer errors out: ${lotRace.filter((outcome) => outcome instanceof Error).map(String).join(" | ")}`);
  assert((lotRace as IssueResult[]).filter((result) => result.issued === 1).length === 3, "exactly three of eight get one of three");
  const lotOut = (await prisma.assetIssuance.aggregate({ where: { eventId, endedAt: null, asset: { identifier: "LANYARD" } }, _sum: { quantity: true } }))._sum.quantity;
  assert(lotOut === 3, `the lot is exactly spent, not over-issued: ${lotOut}`);
  // Two group issues that overlap, in opposite orders, never deadlock and never double-assign.
  const crossA = racers[1]!;
  const crossB = racers[2]!;
  const cross = await Promise.all([
    settle(issue(crossA, ["K-240", "K-241", "K-242"])),
    settle(issue(crossB, ["K-242", "K-241", "K-240"])),
  ]);
  assert(cross.every((outcome) => !(outcome instanceof Error)), `overlapping group issues do not fail: ${cross.filter((outcome) => outcome instanceof Error).map(String).join(" | ")}`);
  for (const key of ["K-240", "K-241", "K-242"]) assert((await openCount(key)) === 1, `${key} has exactly one holder`);
  assert((cross as IssueResult[]).reduce((sum, result) => sum + result.issued, 0) === 3, "between them the two requests issue each key once");
  // The database says the same, independent of the service.
  const k230 = await assetId("K-230");
  await expectDatabaseMessage(prisma.assetIssuance.create({
    data: { eventId, assetId: k230, serialized: true, quantity: 1, assigneeKind: "TEAM", assigneeLabel: "Rogue", purpose: "Bypass", issuedAt: new Date(), issuedByUserId: userId, entryMethod: "MANUAL" },
  }), /Unique constraint|serialized_open_key|23505/, "a second open issue of a serialized key, written around the service");
  const lanyard = await assetId("LANYARD");
  await expectDatabaseMessage(prisma.assetIssuance.create({
    data: { eventId, assetId: lanyard, serialized: false, quantity: 1, assigneeKind: "TEAM", assigneeLabel: "Rogue", purpose: "Bypass", issuedAt: new Date(), issuedByUserId: userId, entryMethod: "MANUAL" },
  }), /Not enough left to issue/, "an over-issue of a lot, written around the service");

  // ---- Room moves keep correct current and historical references ----------------
  const dana = (await makeReg(eventId, "CONFIRMED", 2));
  const [danaA, danaB] = dana.people;
  const oldRoom = await place(danaA!, "girls-214");
  await place(danaB!, "girls-214");
  const preMove = new Set((await prisma.eventLodgingAssignment.findMany({ where: { eventId, attendeeId: { in: [danaA!.attendeeId, danaB!.attendeeId] }, cancelledAt: null } })).map((row) => row.id));
  assert(preMove.size === 2, "both family members are placed");
  const family = await issueAssets(eventId, userId, { assignee: { kind: "REGISTRATION", registrationId: dana.id }, items: [{ code: "K-250" }, { code: "K-251" }, { code: "WP-27" }] });
  assert(family.issued === 3, "a registration (a family) is issued two keys and a packet");
  const familyKeys = await prisma.assetIssuance.findMany({ where: { eventId, registrationId: dana.id, asset: { identifier: { in: ["K-250", "K-251"] } } } });
  assert(familyKeys.length === 2 && familyKeys.every((row) => row.roomUnitId === oldRoom.id && row.sourceAssignmentId !== null && preMove.has(row.sourceAssignmentId)), "a family's keys are linked to the room the registration's attendees share");
  const deskBefore = await getDeskPerson(eventId, danaA!.attendeeId, prisma);
  assert(deskBefore!.issuances.filter((row) => row.lodging).every((row) => row.lodging!.status === "CURRENT"), "before any move the desk shows the keys as current");
  // The whole family moves rooms.
  const newRoom = await place(danaA!, "girls-213", N[0], N[3], "MOVE", "Closer to the dining hall");
  await place(danaB!, "girls-213", N[0], N[3], "MOVE", "Closer to the dining hall");
  assert((await prisma.eventLodgingAssignment.count({ where: { id: { in: [...preMove] }, cancelledAt: { not: null } } })) === 2, "the move cancelled the old assignments");
  const deskMoved = await getDeskPerson(eventId, danaA!.attendeeId, prisma);
  const movedKey = deskMoved!.issuances.find((row) => row.identifier === "K-250")!;
  assert(movedKey.roomName?.startsWith(oldRoom.unit.name) && preMove.has(movedKey.sourceAssignmentId!), "the key still names the room and assignment it was issued against");
  assert(movedKey.lodging?.status === "MOVED" && movedKey.lodging.currentRooms.some((room) => room.startsWith(newRoom.unit.name)), "and the desk shows the family now stays in the new room");
  assert(deskMoved!.rooms.length === 1 && deskMoved!.rooms[0]!.roomName.startsWith(newRoom.unit.name), "the person's current room is the new one");
  // Replace one key: the new key follows the current assignment; the old record is untouched.
  const k250 = familyKeys.find((row) => row.assetId === movedKey.assetId)!;
  const replaced = await applyIssuanceAction(eventId, userId, k250.id, { action: "replace", replacementCode: "K-252", reason: "Moved rooms, new key for the new room" });
  const oldK250 = await prisma.assetIssuance.findUniqueOrThrow({ where: { id: k250.id } });
  const newK252 = await prisma.assetIssuance.findUniqueOrThrow({ where: { id: replaced.issuanceId! } });
  const postMove = new Set((await prisma.eventLodgingAssignment.findMany({ where: { eventId, attendeeId: { in: [danaA!.attendeeId, danaB!.attendeeId] }, cancelledAt: null, eventLodgingUnitId: newRoom.id } })).map((row) => row.id));
  const dA2 = { id: [...postMove][0]! };
  assert(oldK250.endedAt !== null && oldK250.endReason === "REPLACED" && oldK250.roomUnitId === oldRoom.id && preMove.has(oldK250.sourceAssignmentId!) && oldK250.endNote === "Moved rooms, new key for the new room", "the old issue ends as REPLACED and keeps its original room and assignment");
  assert(newK252.roomUnitId === newRoom.id && postMove.has(newK252.sourceAssignmentId!) && newK252.previousIssuanceId === k250.id && newK252.endedAt === null, "the replacement follows the current assignment and points back");
  assert((await prisma.issuedAsset.findUniqueOrThrow({ where: { id: k250.assetId } })).availability === "UNAVAILABLE", "the replaced key is held out until its return is recorded");
  const k250History = await listAssetHistory(eventId, k250.assetId, prisma);
  assert(k250History.map((entry) => entry.type).join() === "ISSUED,REPLACED_OUT", `the replaced key's history is ISSUED then REPLACED_OUT: ${k250History.map((entry) => entry.type).join()}`);
  assert((await listAssetHistory(eventId, newK252.assetId, prisma))[0]!.type === "REPLACED_IN", "the replacement's history starts REPLACED_IN");
  const oldRoomIssues = await listRoomIssuances(eventId, oldRoom.id, prisma);
  const newRoomIssues = await listRoomIssuances(eventId, newRoom.id, prisma);
  assert(oldRoomIssues.some((row) => row.identifier === "K-250" && !row.open) && oldRoomIssues.some((row) => row.identifier === "K-251"), "the old room's history lists its keys, ended and still out");
  assert(newRoomIssues.length === 1 && newRoomIssues[0]!.identifier === "K-252", "the new room's history lists only the new key");
  // Replace the other key and put the original straight back in stock; another guest can then have it.
  const k251 = familyKeys.find((row) => row.assetId !== k250.assetId)!;
  await applyIssuanceAction(eventId, userId, k251.id, { action: "replace", replacementCode: "K-253", reason: "Moved rooms", originalAvailability: "AVAILABLE", assignmentId: dA2.id });
  const erin = (await makeReg(eventId)).people[0]!;
  await place(erin, "girls-216");
  assert((await issue(erin, ["K-251"])).issued === 1, "a key put back in stock can be issued to someone else");
  const k251History = await listAssetHistory(eventId, k251.assetId, prisma);
  assert(k251History.map((entry) => entry.type).join() === "ISSUED,REPLACED_OUT,ISSUED", "its history keeps the first holder, then the second");
  await expectAssetError(applyIssuanceAction(eventId, userId, k250.id, { action: "replace", replacementCode: "K-254", reason: "Again" }), "ISSUANCE_NOT_OPEN", "replacing an issue that already ended");
  await expectAssetError(applyIssuanceAction(eventId, userId, newK252.id, { action: "replace", replacementCode: "K-252", reason: "Same" }), "SAME_ASSET", "replacing a key with itself");
  await expectAssetError(applyIssuanceAction(eventId, userId, newK252.id, { action: "replace", replacementCode: "WP-27", reason: "Wrong kind" }), "REPLACEMENT_TYPE_MISMATCH", "replacing a key with a packet");
  await expectAssetError(applyIssuanceAction(eventId, userId, newK252.id, { action: "replace", replacementCode: "K-230", reason: "Taken" }), "ALREADY_ISSUED", "replacing with a key someone else holds");

  // ---- Transfer and correction ----------------------------------------------------
  const frank = (await makeReg(eventId)).people[0]!;
  const room217 = await place(frank, "girls-217");
  const fa = await currentAssignment(frank);
  const transferred = await applyIssuanceAction(eventId, userId, newK252.id, { action: "transfer", to: { kind: "ATTENDEE", attendeeId: frank.attendeeId }, reason: "Substitute attendee" });
  const afterTransfer = await prisma.assetIssuance.findUniqueOrThrow({ where: { id: transferred.issuanceId! } });
  assert(afterTransfer.attendeeId === frank.attendeeId && afterTransfer.roomUnitId === room217.id && afterTransfer.sourceAssignmentId === fa.id && afterTransfer.previousIssuanceId === newK252.id, "a transferred room key links to the new holder's own assignment");
  const endedK252 = await prisma.assetIssuance.findUniqueOrThrow({ where: { id: newK252.id } });
  assert(endedK252.endReason === "TRANSFERRED" && endedK252.attendeeId === null && endedK252.registrationId === dana.id && postMove.has(endedK252.sourceAssignmentId!), "the original issue keeps its holder and assignment");
  await expectAssetError(applyIssuanceAction(eventId, userId, transferred.issuanceId!, { action: "transfer", to: { kind: "ATTENDEE", attendeeId: frank.attendeeId }, reason: "Same" }), "SAME_HOLDER", "a transfer to the current holder");
  await expectAssetError(applyIssuanceAction(eventId, userId, transferred.issuanceId!, { action: "transfer", to: { kind: "TEAM", label: "Kitchen" }, reason: "No teams" }), "ASSIGNEE_KIND_NOT_ALLOWED", "a key to a kind of holder it cannot go to");
  const k252History = await listAssetHistory(eventId, newK252.assetId, prisma);
  assert(k252History.map((entry) => entry.type).join() === "REPLACED_IN,TRANSFERRED_OUT,TRANSFERRED_IN", `the key's history shows its whole life: ${k252History.map((entry) => entry.type).join()}`);
  const mistake = await prisma.assetIssuance.findFirstOrThrow({ where: { eventId, attendeeId: bob.attendeeId, asset: { identifier: "K-216" } } });
  assert(await caught(applyIssuanceAction(eventId, userId, mistake.id, { action: "correct", reason: "" })), "a correction without a reason is refused before anything happens")
  await applyIssuanceAction(eventId, userId, mistake.id, { action: "correct", reason: "Scanned the wrong key" });
  const corrected = await prisma.assetIssuance.findUniqueOrThrow({ where: { id: mistake.id } });
  assert(corrected.endReason === "CORRECTED" && corrected.endedByUserId === userId && corrected.endNote === "Scanned the wrong key", "a correction ends the issue with its reason and actor");
  assert((await issue(frank, ["K-216"])).issued === 1, "the corrected key can be issued again");
  assert((await listAssetHistory(eventId, mistake.assetId, prisma)).map((entry) => entry.type).join() === "ISSUED,CORRECTED,ISSUED", "and the history keeps the mistake");
  await expectAssetError(applyIssuanceAction(eventId, userId, mistake.id, { action: "correct", reason: "Again" }), "ISSUANCE_NOT_OPEN", "correcting twice");

  // ---- Offline and manual entry -----------------------------------------------------
  const eve = (await makeReg(eventId)).people[0]!;
  const room221 = await place(eve, "girls-221");
  const e1 = await currentAssignment(eve);
  await sleep(40);
  const handedOver = new Date().toISOString();
  await sleep(40);
  await place(eve, "girls-222", N[0], N[3], "MOVE", "Swapped rooms");
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const manualMoved = await issue(eve, ["K-255"], { assignmentId: e1.id });
  assert(manualMoved.items[0]!.error?.code === "ROOM_ASSIGNMENT_MOVED" && manualMoved.issued === 0, "a manual entry against an assignment that has since moved is refused");
  const offline = await issue(eve, ["K-255"], { entryMethod: "OFFLINE", occurredAt: handedOver, assignmentId: e1.id, idempotencyKey: `offline-${randomUUID()}` });
  assert(offline.issued === 1, "an offline entry made before the move is accepted");
  const offlineRow = await prisma.assetIssuance.findFirstOrThrow({ where: { eventId, asset: { identifier: "K-255" } } });
  assert(offlineRow.entryMethod === "OFFLINE" && offlineRow.issuedAt.toISOString() === handedOver && offlineRow.sourceAssignmentId === e1.id && offlineRow.roomUnitId === room221.id, "it keeps when it happened and the room it was handed out for");
  assert(offlineRow.createdAt.getTime() > offlineRow.issuedAt.getTime(), "and the server records when it learned of it separately");
  const deskEve = await getDeskPerson(eventId, eve.attendeeId, prisma);
  assert(deskEve!.issuances[0]!.lodging?.status === "MOVED", "the desk flags the key as opening the old room");
  await expectAssetError(issue(eve, ["K-256"], { entryMethod: "OFFLINE", occurredAt: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString() }), "OCCURRED_AT_INVALID", "an offline time from a month ago");
  const typed = await caught(issue(eve, ["K-256"], { occurredAt: hourAgo }));
  assert(typed !== null, "only an offline entry may say when it happened");
  const nobody = await lookupAsset(eventId, "k-255", prisma);
  assert(nobody!.open.length === 1 && nobody!.open[0]!.holderLabel.includes(eve.first) && nobody!.history.length === 1, "manual lookup shows who holds a key");
  assert((await lookupAsset(eventId, "NO-SUCH", prisma)) === null, "manual lookup of an unknown code finds nothing");
  assert((await listOutNow(eventId, {}, prisma)).length > 10, "the out-now list shows what is issued");

  // ---- Offline without naming an assignment, across a move ---------------------------------
  const fay = (await makeReg(eventId)).people[0]!;
  const room223 = await place(fay, "girls-223");
  const f1 = await currentAssignment(fay);
  await sleep(40);
  const fayHandover = new Date().toISOString();
  await sleep(40);
  const room224 = await place(fay, "girls-224", N[0], N[3], "MOVE", "Swapped rooms");
  const fayOffline = await issue(fay, ["K-258"], { entryMethod: "OFFLINE", occurredAt: fayHandover });
  assert(fayOffline.issued === 1, `an offline entry with no assignment named is accepted: ${statuses(fayOffline)}`);
  const fayKey = await prisma.assetIssuance.findFirstOrThrow({ where: { eventId, asset: { identifier: "K-258" } } });
  assert(fayKey.roomUnitId === room223.id && fayKey.sourceAssignmentId === f1.id, "it is linked to the room the person was in when the key was handed over, not the room they moved into");
  const deskFay = await getDeskPerson(eventId, fay.attendeeId, prisma);
  const fayRow = deskFay!.issuances.find((row) => row.identifier === "K-258")!;
  assert(fayRow.lodging?.status === "MOVED" && fayRow.lodging.currentRooms.some((room) => room.startsWith(room224.unit.name)) && fayRow.roomName?.startsWith(room223.unit.name), "and the desk shows the swap warning");
  const fayOnline = await issue(fay, ["K-257"]);
  assert(fayOnline.issued === 1 && (await prisma.assetIssuance.findFirstOrThrow({ where: { eventId, asset: { identifier: "K-257" } } })).roomUnitId === room224.id, "an online issue after the move is linked to the new room");
  const offlineHistory = (await listAssetHistory(eventId, fayKey.assetId, prisma))[0]!;
  assert(new Date(offlineHistory.recordedAt).getTime() > new Date(offlineHistory.at).getTime(), "history shows both when it happened and when the server recorded it");

  // ---- Backdating --------------------------------------------------------------------------
  const radio = (code: string, extra: Record<string, unknown> = {}, label = "Gate") => issueAssets(eventId, userId, { assignee: { kind: "TEAM", label }, items: [{ code }], ...extra });
  assert((await radio("R-3")).issued === 1, "a radio to the gate team");
  const r3 = await prisma.assetIssuance.findFirstOrThrow({ where: { eventId, asset: { identifier: "R-3" } } });
  await applyIssuanceAction(eventId, userId, r3.id, { action: "correct", reason: "Wrong radio" });
  const r3Ended = (await prisma.assetIssuance.findUniqueOrThrow({ where: { id: r3.id } })).endedAt!;
  const tooEarly = await radio("R-3", { entryMethod: "OFFLINE", occurredAt: new Date(r3Ended.getTime() - 1).toISOString() }, "Parking");
  assert(tooEarly.items[0]!.error?.code === "OCCURRED_AT_INVALID" && tooEarly.issued === 0, "an offline entry cannot claim a moment before the previous holder gave the item up");
  assert((await radio("R-3", { entryMethod: "OFFLINE", occurredAt: new Date(r3Ended.getTime() + 1).toISOString() }, "Parking")).issued === 1, "but one after it is fine");
  const r4 = await prisma.issuedAsset.findFirstOrThrow({ where: { eventId, identifier: "R-4" } });
  const beforeExisted = await radio("R-4", { entryMethod: "OFFLINE", occurredAt: new Date(r4.createdAt.getTime() - 1000).toISOString() });
  assert(beforeExisted.items[0]!.error?.code === "OCCURRED_AT_INVALID", "nor before the item existed");
  const gus = (await makeReg(eventId)).people[0]!;
  await place(gus, "girls-225");
  const g1 = await currentAssignment(gus);
  const beforeAssigned = new Date(g1.createdAt.getTime() - 1000).toISOString();
  assert((await issue(gus, ["K-262"], { entryMethod: "OFFLINE", occurredAt: beforeAssigned })).items[0]!.error?.code === "ROOM_ASSIGNMENT_REQUIRED", "an offline room key cannot be linked to a room the person was not yet assigned to");
  assert((await issue(gus, ["K-262"], { entryMethod: "OFFLINE", occurredAt: beforeAssigned, assignmentId: g1.id })).items[0]!.error?.code === "ROOM_ASSIGNMENT_INVALID", "nor to an assignment named before it began");
  // A clock a few minutes fast must not let an issue end before it began.
  const fast = await radio("R-5", { entryMethod: "OFFLINE", occurredAt: new Date(Date.now() + 3 * 60 * 1000).toISOString() });
  assert(fast.issued === 1, "a device clock three minutes fast is forgiven");
  const r5 = await prisma.assetIssuance.findFirstOrThrow({ where: { eventId, asset: { identifier: "R-5" } } });
  await applyIssuanceAction(eventId, userId, r5.id, { action: "correct", reason: "Entered on a fast clock" }, { canConfigure: false });
  const r5After = await prisma.assetIssuance.findUniqueOrThrow({ where: { id: r5.id } });
  assert(r5After.endedAt!.getTime() >= r5After.issuedAt.getTime(), "an issue never ends before it began");
  const k231Open = await prisma.assetIssuance.findFirstOrThrow({ where: { eventId, endedAt: null, asset: { identifier: "K-231" } } });
  await expectDatabaseMessage(prisma.assetIssuance.update({ where: { id: k231Open.id }, data: { endedAt: new Date(0), endReason: "CORRECTED", endedByUserId: userId, revision: { increment: 1 } } }), /ended_after_issued/, "an issue that ends before it began, written around the service");

  // ---- Who may correct, and who may put a replaced item straight back in stock --------------------
  assert((await radio("R-6", {}, "Medical")).issued === 1, "a radio to the medical team");
  const r6 = await prisma.assetIssuance.findFirstOrThrow({ where: { eventId, asset: { identifier: "R-6" } } });
  await expectAssetError(applyIssuanceAction(eventId, userId, r6.id, { action: "correct", reason: "Late fix" }, { canConfigure: false, now: new Date(Date.now() + 31 * 60 * 1000) }), "CONFIGURE_REQUIRED", "check-in staff correcting an issue older than 30 minutes");
  assert((await prisma.assetIssuance.findUniqueOrThrow({ where: { id: r6.id } })).endedAt === null, "and nothing changed");
  await applyIssuanceAction(eventId, userId, r6.id, { action: "correct", reason: "Late fix" }, { canConfigure: true, now: new Date(Date.now() + 31 * 60 * 1000) });
  assert((await prisma.assetIssuance.findUniqueOrThrow({ where: { id: r6.id } })).endReason === "CORRECTED", "an administrator can");
  assert((await radio("R-7", {}, "Safety")).issued === 1, "a radio to the safety team");
  const r7 = await prisma.assetIssuance.findFirstOrThrow({ where: { eventId, asset: { identifier: "R-7" } } });
  await expectAssetError(applyIssuanceAction(eventId, userId, r7.id, { action: "replace", replacementCode: "R-8", reason: "Dead battery", originalAvailability: "AVAILABLE" }, { canConfigure: false }), "CONFIGURE_REQUIRED", "check-in staff putting a replaced radio straight back in stock");
  assert((await prisma.assetIssuance.findUniqueOrThrow({ where: { id: r7.id } })).endedAt === null, "and nothing changed");

  // ---- Retrying a transfer or a replacement returns the original result ------------------------------
  const tKey = `transfer-${randomUUID()}`;
  const t1 = await applyIssuanceAction(eventId, userId, r7.id, { action: "transfer", to: { kind: "VEHICLE", label: "Truck 2" }, reason: "Hand over", idempotencyKey: tKey });
  const t2 = await applyIssuanceAction(eventId, userId, r7.id, { action: "transfer", to: { kind: "VEHICLE", label: "Truck 2" }, reason: "Hand over", idempotencyKey: tKey });
  assert(t1.issuanceId && t2.issuanceId === t1.issuanceId, "a retried transfer returns the original new issue");
  assert((await prisma.assetIssuance.count({ where: { eventId, previousIssuanceId: r7.id } })) === 1, "and writes nothing twice");
  await expectAssetError(applyIssuanceAction(eventId, userId, r6.id, { action: "transfer", to: { kind: "TEAM", label: "Other" }, reason: "Wrong", idempotencyKey: tKey }), "IDEMPOTENCY_KEY_REUSED", "a retry key reused for another issue");
  const rKey = `replace-${randomUUID()}`;
  const rep1 = await applyIssuanceAction(eventId, userId, t1.issuanceId!, { action: "replace", replacementCode: "R-8", reason: "Dead battery", idempotencyKey: rKey }, { canConfigure: false });
  const rep2 = await applyIssuanceAction(eventId, userId, t1.issuanceId!, { action: "replace", replacementCode: "R-8", reason: "Dead battery", idempotencyKey: rKey }, { canConfigure: false });
  assert(rep1.issuanceId && rep2.issuanceId === rep1.issuanceId, "a retried replacement returns the original result");
  assert((await prisma.assetIssuance.count({ where: { eventId, previousIssuanceId: t1.issuanceId! } })) === 1, "and writes nothing twice");

  await expectAssetError(applyIssuanceAction(eventId, userId, t1.issuanceId!, { action: "transfer", to: { kind: "TEAM", label: "Other" }, reason: "x", idempotencyKey: rKey }, { canConfigure: false }), "IDEMPOTENCY_KEY_REUSED", "a replacement's key reused for a transfer");
  await expectAssetError(applyIssuanceAction(eventId, userId, r7.id, { action: "replace", replacementCode: "R-6", reason: "x", idempotencyKey: tKey }, { canConfigure: false }), "IDEMPOTENCY_KEY_REUSED", "a transfer's key reused for a replacement");
  await expectAssetError(applyIssuanceAction(eventId, userId, t1.issuanceId!, { action: "replace", replacementCode: "R-6", reason: "x", idempotencyKey: rKey }, { canConfigure: false }), "IDEMPOTENCY_KEY_REUSED", "a replacement's key reused for another replacement item");
  // The 30-minute window cannot be restarted by transferring or replacing an old issue.
  await expectAssetError(applyIssuanceAction(eventId, userId, rep1.issuanceId!, { action: "correct", reason: "Fresh row, old issue" }, { canConfigure: false }), "CONFIGURE_REQUIRED", "check-in staff correcting an issue made by a replacement");
  await expectAssetError(applyIssuanceAction(eventId, userId, t1.issuanceId!, { action: "correct", reason: "x" }, { canConfigure: false }), "ISSUANCE_NOT_OPEN", "the replaced issue is already ended");
  assert((await prisma.assetIssuance.findUniqueOrThrow({ where: { id: rep1.issuanceId! } })).endedAt === null, "and the replacement is untouched");

  // ---- Replacing a quantity item never takes the lot out of stock ------------------------------------
  await applyAssetAction(eventId, userId, { action: "create", typeId: packetType, identifier: "WP-A", quantityTotal: 10 });
  await applyAssetAction(eventId, userId, { action: "create", typeId: packetType, identifier: "WP-B", quantityTotal: 10 });
  const gina = (await makeReg(eventId)).people[0]!;
  assert((await issue(gina, ["WP-A"], { items: [{ code: "WP-A", quantity: 2 }] })).issued === 1, "two packets from lot A");
  const ginaIssue = await prisma.assetIssuance.findFirstOrThrow({ where: { eventId, attendeeId: gina.attendeeId, asset: { identifier: "WP-A" } } });
  await applyIssuanceAction(eventId, userId, ginaIssue.id, { action: "replace", replacementCode: "WP-B", reason: "Lot A was the wrong colour", originalAvailability: "UNAVAILABLE" }, { canConfigure: false });
  assert((await prisma.issuedAsset.findFirstOrThrow({ where: { eventId, identifier: "WP-A" } })).availability === "AVAILABLE", "replacing a family's packets leaves the lot available");
  assert((await prisma.assetIssuance.findFirstOrThrow({ where: { eventId, attendeeId: gina.attendeeId, endedAt: null } })).quantity === 2, "and the holder keeps the same number, from the other lot");
  const hal = (await makeReg(eventId)).people[0]!;
  assert((await issue(hal, ["WP-A"])).issued === 1, "lot A can still be issued to someone else");
  await expectAssetError(applyAssetAction(eventId, userId, { action: "update", assetId: await assetId("WP-A"), availability: "UNAVAILABLE" }), "ASSET_IN_USE", "taking a lot out of stock while it is issued");

  // ---- Updates that would break an open issue -----------------------------------------
  await expectAssetError(applyAssetAction(eventId, userId, { action: "update", assetId: await assetId("K-255"), availability: "RETIRED" }), "ASSET_IN_USE", "retiring a key that is issued");
  await applyAssetAction(eventId, userId, { action: "update", assetId: await assetId("K-260"), availability: "RETIRED", condition: "DAMAGED", location: "Front desk" });
  assert((await issue(eve, ["K-260"])).items[0]!.error?.code === "ASSET_UNAVAILABLE", "a retired key cannot be issued");
  const retiredAttempt = await caught(prisma.assetIssuance.create({
    data: { eventId, assetId: await assetId("K-260"), serialized: true, quantity: 1, assigneeKind: "TEAM", assigneeLabel: "Rogue", purpose: "Bypass", issuedAt: new Date(), issuedByUserId: userId, entryMethod: "MANUAL" },
  }));
  assert(retiredAttempt instanceof Error && /not available to issue/.test(retiredAttempt.message), "the database refuses to issue a retired key around the service");

  // ---- Append-only ---------------------------------------------------------------------
  const sampleHistory = await prisma.assetIssuanceHistory.findFirstOrThrow({ where: { eventId } });
  await expectDatabaseRefusal(prisma.assetIssuanceHistory.update({ where: { id: sampleHistory.id }, data: { reason: "Rewritten" } }), "rewriting a history row");
  await expectDatabaseRefusal(prisma.assetIssuanceHistory.delete({ where: { id: sampleHistory.id } }), "deleting a history row");
  await expectDatabaseRefusal(prisma.assetIssuance.delete({ where: { id: mistake.id } }), "deleting an issuance");
  await expectDatabaseRefusal(prisma.issuedAsset.delete({ where: { id: await assetId("K-260") } }), "deleting an item");
  await expectDatabaseRefusal(prisma.issuedAssetType.delete({ where: { id: retiredType } }), "deleting a kind of item");
  await expectDatabaseRefusal(prisma.assetIssuance.update({ where: { id: mistake.id }, data: { endNote: "Rewritten" } }), "changing an ended issuance");
  const openOne = await prisma.assetIssuance.findFirstOrThrow({ where: { eventId, endedAt: null, asset: { identifier: "K-231" } } });
  await expectDatabaseRefusal(prisma.assetIssuance.update({ where: { id: openOne.id }, data: { purpose: "Rewritten", revision: { increment: 1 } } }), "rewriting who or why on an open issuance");
  await expectDatabaseRefusal(prisma.assetIssuance.update({ where: { id: openOne.id }, data: { endedAt: new Date(), endReason: "CORRECTED", endedByUserId: userId, revision: { increment: 1 } } }), "ending an issuance without its history row");
  const previousIds = (await prisma.assetIssuance.findMany({ where: { eventId, previousIssuanceId: { not: null } } })).length;
  assert(previousIds >= 3, "transfers and replacements point back at what they continue");

  // ---- Nothing crosses events ----------------------------------------------------------------------
  const otherKey = (await applyAssetTypeAction(otherEventId, userId, { action: "create", name: "Door key", mode: "SERIALIZED", assigneeKinds: ["ATTENDEE", "ROOM", "STAFF"], roomLinked: true })).id;
  await applyAssetAction(otherEventId, userId, { action: "create", typeId: otherKey, identifier: "OK-1" });
  const outsider2 = (await makeReg(otherEventId)).people[0]!;
  await expectAssetError(issueAssets(otherEventId, userId, { assignee: { kind: "STAFF", userId: staffId }, items: [{ code: "OK-1" }] }), "STAFF_NOT_ON_EVENT", "another event's staff member");
  await expectAssetError(issueAssets(otherEventId, userId, { assignee: { kind: "ROOM", eventUnitId: room203.id }, items: [{ code: "OK-1" }] }), "ASSIGNEE_NOT_FOUND", "another event's room");
  const foreignAssignment = await issueAssets(otherEventId, userId, { assignee: { kind: "ATTENDEE", attendeeId: outsider2.attendeeId }, assignmentId: a1.id, items: [{ code: "OK-1" }] });
  assert(foreignAssignment.items[0]!.error?.code === "ROOM_ASSIGNMENT_INVALID" && foreignAssignment.issued === 0, "another event's lodging assignment");
  const foreignIssuance = await prisma.assetIssuance.findFirstOrThrow({ where: { eventId, endedAt: null } });
  await expectAssetError(applyIssuanceAction(otherEventId, userId, foreignIssuance.id, { action: "correct", reason: "Not yours" }), "ISSUANCE_NOT_FOUND", "another event's issue");
  assert((await prisma.assetIssuance.findUniqueOrThrow({ where: { id: foreignIssuance.id } })).endedAt === null, "and it is untouched");

  // ---- Deletion with the event ----------------------------------------------------------
  // The event deletion service deletes these rows in order, with the transaction-local setting.
  const counts = () => Promise.all([
    prisma.issuedAssetType.count({ where: { eventId } }), prisma.issuedAsset.count({ where: { eventId } }),
    prisma.assetIssuance.count({ where: { eventId } }), prisma.assetIssuanceHistory.count({ where: { eventId } }),
  ]);
  assert((await counts()).every((count) => count > 0), `the event holds rows of every kind before deletion: ${(await counts()).join()}`);
  assert(await caught(prisma.$transaction(async (tx) => { await tx.assetIssuanceHistory.deleteMany({ where: { eventId } }); })), "without the event-deletion setting a delete is refused");
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('imsda.event_deletion', 'on', true)`;
    await tx.assetIssuanceHistory.deleteMany({ where: { eventId } });
    await tx.assetIssuance.deleteMany({ where: { eventId } });
    await tx.issuedAsset.deleteMany({ where: { eventId } });
    await tx.issuedAssetType.deleteMany({ where: { eventId } });
  });
  assert((await counts()).every((count) => count === 0), "the deletion service's ordered deletes remove every asset row");
  // A plain event delete (the cascade) removes them too, with their triggers allowing it once the event is gone.
  const otherType = (await applyAssetTypeAction(otherEventId, userId, { action: "create", name: "Packet", mode: "QUANTITY", assigneeKinds: ["ATTENDEE"] })).id;
  await applyAssetAction(otherEventId, userId, { action: "create", typeId: otherType, identifier: "WP-1", quantityTotal: 3 });
  const outsider = (await makeReg(otherEventId)).people[0]!;
  assert((await issueAssets(otherEventId, userId, { assignee: { kind: "ATTENDEE", attendeeId: outsider.attendeeId }, items: [{ code: "WP-1" }] })).issued === 1, "another event issues its own item");
  await prisma.event.delete({ where: { id: otherEventId } });
  assert((await prisma.assetIssuance.count({ where: { eventId: otherEventId } })) === 0 && (await prisma.issuedAsset.count({ where: { eventId: otherEventId } })) === 0, "deleting an event removes its asset rows with it");
  console.log("Issued assets verified.");
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
