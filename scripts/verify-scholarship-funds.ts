/**
 * Proves event scholarship funds (#398) against a real PostgreSQL database, where the unit tests' in-memory stand-ins
 * can't:
 *
 * - one fund per event, created on first use even when several first contributions race (exactly one fund), with
 *   nothing carried between events: another event's fund, balance and sponsors are untouched;
 * - contributions in integer cents from a directory church (name snapshotted from the directory; an inactive or unknown
 *   organization is refused) or a typed sponsor name, and the fund balance as received minus awarded;
 * - an award is a scholarship adjustment line (#396) that draws on the fund in the same transaction: the registration
 *   total drops by exactly the award, a funded award larger than the balance is refused with nothing left behind (no
 *   line, no award, the total unchanged), and reversing the adjustment line through the existing reversal returns the
 *   money to the fund;
 * - a pledged award ("pledged, not yet received") may exceed the balance, needs a named sponsor, shows as outstanding
 *   for that sponsor, and only settles once the money is recorded and unspent; settling cannot take the fund below zero,
 *   happens once, and is refused on a reversed award;
 * - contribution reversals are new negative lines (the original stays), refused twice, on a reversal, and when awards
 *   already drew on the money;
 * - parallel awards never overspend the fund (race-safe at SERIALIZABLE with retries), and an award racing the reversal
 *   of the contribution that covers it leaves the balance at or above zero;
 * - per-sponsor money: a funded award attributed to a sponsor, settling that sponsor's pledge and reversing that
 *   sponsor's contribution are refused when they would spend more than that sponsor gave, even when the fund as a whole
 *   has the money; an award with no sponsor draws on the fund in general; and per-sponsor figures add up to the balance;
 * - a cancelled registration: its pledge cannot be settled, its award is flagged, and only a fund-linked scholarship
 *   line (nothing else) can be reversed on it, returning the money to the fund; a church-billed registration refuses a
 *   fund award on the server;
 * - the database itself refuses a negative contribution that is not a reversal, a pledge without a sponsor, a settled
 *   award that was never pledged, and a line whose fund belongs to another event;
 * - the finance export is formula-safe through csvCell and audited with counts only;
 * - every audit row holds ids and amounts only (no sponsor name, note, reason or church name), and deleting an event
 *   removes its fund.
 *
 * Uses fictitious rows it creates and removes itself.
 *
 *   npm run test:scholarship-funds
 */
import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";
import { toCsv } from "../modules/reporting/csv";
import { createRegistrationAdjustment, reverseRegistrationAdjustment } from "../modules/registrations/adjustments";
import { ScholarshipFundError, fundCsvRows } from "../modules/scholarship-funds/domain";
import {
  exportFund,
  getFundView,
  recordContribution,
  reverseContribution,
  settlePledgedAward,
} from "../modules/scholarship-funds/repository";

loadEnvConfig(process.cwd());
// Local-only, before any query runs.
assertLocalDatabase(process.env, "run this verification");

const prisma = new PrismaClient();
const P = `sf398_${randomUUID().slice(0, 8)}`;
const staff = `${P}_staff`;
const person = `${P}_person`;
const churchA = `${P}_church_a`;
const clubB = `${P}_club_b`;
const churchClosed = `${P}_church_closed`;
const CHURCH_A_NAME = "Scholarship Check Church Alpha";
const startsWithP = { startsWith: P };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function expectFundError(promise: Promise<unknown>, code: string, message: string) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  assert(error instanceof ScholarshipFundError && error.code === code, `${message}: expected ${code}, got ${String(error)}`);
}

async function cleanup() {
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: staff }, { eventId: startsWithP }] } });
  await prisma.event.deleteMany({ where: { id: startsWithP } });
  await prisma.registration.deleteMany({ where: { eventId: startsWithP } });
  await prisma.person.deleteMany({ where: { id: startsWithP } });
  await prisma.organization.deleteMany({ where: { id: startsWithP } });
  await prisma.user.deleteMany({ where: { id: staff } });
}

let eventCounter = 0;
async function mkEvent(billingMode: "ATTENDEE_PAY" | "DEFERRED_ORGANIZATION_INVOICE" = "ATTENDEE_PAY") {
  eventCounter += 1;
  const id = `${P}_event_${eventCounter}`;
  const day = 86_400_000;
  await prisma.event.create({
    data: { id, slug: `${id.replace(/_/g, "-")}-slug`, name: `Scholarship Check Event ${eventCounter}`, startsAt: new Date(Date.now() + day), endsAt: new Date(Date.now() + 2 * day), isPublished: false, audience: "GENERAL", billingMode },
  });
  return id;
}

let registrationCounter = 0;
async function mkRegistration(eventId: string, totalDollars = 300) {
  registrationCounter += 1;
  return prisma.registration.create({
    data: { eventId, accountHolderPersonId: person, confirmationCode: `SF-${registrationCounter}`, status: "SUBMITTED", totalAmount: totalDollars },
    select: { id: true, confirmationCode: true },
  });
}

const totalCents = async (registrationId: string) => Math.round(Number((await prisma.registration.findUniqueOrThrow({ where: { id: registrationId }, select: { totalAmount: true } })).totalAmount) * 100);

function contribute(eventId: string, cents: number, sponsor: { organizationId?: string; sponsorName?: string }, note?: string) {
  return recordContribution(eventId, staff, { ...sponsor, amountCents: cents, receivedOn: "2027-01-15", method: "CHECK", note });
}

function award(eventId: string, registrationId: string, cents: number, fundAward: { pledged: boolean; organizationId?: string; sponsorName?: string }) {
  return createRegistrationAdjustment(eventId, registrationId, staff, { kind: "SCHOLARSHIP", amountCents: cents, reason: "Scholarship check award reason", fundAward });
}

async function awardRow(registrationId: string) {
  return prisma.scholarshipAward.findFirst({ where: { registrationId }, orderBy: { createdAt: "desc" } });
}

async function main() {
  await cleanup();
  await prisma.user.create({ data: { id: staff, email: `${P}-staff@example.test`, displayName: "Scholarship Check Staff", globalRole: "SYSTEM_ADMIN" } });
  await prisma.person.create({ data: { id: person, firstName: "Sample", lastName: "Registrant" } });
  await prisma.organization.createMany({
    data: [
      { id: churchA, type: "CHURCH", name: CHURCH_A_NAME, normalizedName: CHURCH_A_NAME.toLowerCase() },
      { id: clubB, type: "CLUB", name: "Scholarship Check Club Bravo", normalizedName: "scholarship check club bravo" },
      { id: churchClosed, type: "CHURCH", name: "Scholarship Check Closed Church", normalizedName: "scholarship check closed church", isActive: false },
    ],
  });
  const e1 = await mkEvent();
  const e2 = await mkEvent();
  const noteText = "check 1001 secret-note";

  // ---- Contributions: directory church (name snapshotted) and a typed sponsor; integer cents.
  await contribute(e1, 50_000, { organizationId: churchA }, noteText);
  await contribute(e1, 10_000, { sponsorName: "  Test   Friend " });
  await contribute(e1, 2_500, { sponsorName: "test friend" });
  let view = await getFundView(e1);
  assert(view.summary.receivedCents === 62_500 && view.summary.balanceCents === 62_500, "received and balance in cents");
  const churchLine = view.contributions.find((line) => line.organizationId === churchA);
  assert(churchLine?.sponsorName === CHURCH_A_NAME, "the directory name is snapshotted, not taken from the request");
  assert(view.summary.sponsors.length === 2, `a typed name matches however it is spaced or cased (got ${view.summary.sponsors.length} sponsors)`);
  assert(view.summary.sponsors.find((sponsor) => sponsor.name.toLowerCase().includes("friend"))?.receivedCents === 12_500, "one typed sponsor, summed");
  await expectFundError(contribute(e1, 1_000, { organizationId: churchClosed }), "SPONSOR_NOT_FOUND", "an inactive church");
  await expectFundError(contribute(e1, 1_000, { organizationId: `${P}_missing` }), "SPONSOR_NOT_FOUND", "an unknown organization");
  await expectFundError(contribute(e1, 1_000, {}), "SPONSOR_REQUIRED", "no sponsor at all");
  await contribute(e1, 700, { organizationId: clubB });
  assert((await getFundView(e1)).summary.receivedCents === 63_200, "a club from the directory can contribute");

  // ---- One fund per event; nothing carried between events.
  assert((await getFundView(e2)).summary.receivedCents === 0, "another event starts with an empty fund");
  assert(await prisma.scholarshipFund.count({ where: { eventId: e1 } }) === 1, "one fund for the event");
  const raceEvent = await mkEvent();
  await Promise.all([1, 2, 3, 4].map((n) => contribute(raceEvent, 1_000 * n, { sponsorName: `Race Sponsor ${n}` })));
  assert(await prisma.scholarshipFund.count({ where: { eventId: raceEvent } }) === 1, "racing first contributions create exactly one fund");
  assert((await getFundView(raceEvent)).summary.receivedCents === 10_000, "no racing contribution was lost");

  // ---- A funded award is a scholarship adjustment line that draws on the fund.
  const r1 = await mkRegistration(e1);
  await award(e1, r1.id, 20_000, { pledged: false, organizationId: churchA });
  assert(await totalCents(r1.id) === 10_000, "the registration total dropped by exactly the award");
  const line = await prisma.registrationAdjustment.findFirstOrThrow({ where: { registrationId: r1.id } });
  assert(line.kind === "SCHOLARSHIP" && line.amountCents === -20_000, "the award is a SCHOLARSHIP adjustment line of -$200");
  const firstAward = await awardRow(r1.id);
  assert(firstAward?.adjustmentId === line.id && firstAward.amountCents === 20_000 && !firstAward.pledged, "the award row points at the line");
  view = await getFundView(e1);
  assert(view.summary.balanceCents === 63_200 - 20_000 && view.summary.fundedCents === 20_000, "the balance drops by the award");
  const churchMatch = view.summary.sponsors.find((sponsor) => sponsor.organizationId === churchA);
  assert(churchMatch?.receivedCents === 50_000 && churchMatch.awardedCents === 20_000 && churchMatch.outstandingCents === 0, "matching per church");

  // ---- A funded award bigger than the balance is refused and leaves nothing behind.
  const r2 = await mkRegistration(e1, 500);
  const before = await getFundView(e1);
  const refusal = await award(e1, r2.id, 43_201, { pledged: false }).then(() => null, (caught: unknown) => caught);
  assert(refusal instanceof ScholarshipFundError && refusal.code === "FUND_BALANCE_TOO_LOW", `over-balance award refused (got ${String(refusal)})`);
  assert(await totalCents(r2.id) === 50_000, "a refused award leaves the registration total unchanged");
  assert(await prisma.registrationAdjustment.count({ where: { registrationId: r2.id } }) === 0, "a refused award leaves no adjustment line");
  assert(await awardRow(r2.id) === null, "a refused award leaves no award row");
  assert((await getFundView(e1)).summary.balanceCents === before.summary.balanceCents, "a refused award leaves the balance unchanged");
  await award(e1, r2.id, 43_200, { pledged: false });
  assert((await getFundView(e1)).summary.balanceCents === 0, "an award can use the balance exactly, to $0");

  // ---- A pledged award may exceed the balance, names who pledged it, and shows outstanding for that sponsor.
  const r3 = await mkRegistration(e1, 400);
  await expectFundError(award(e1, r3.id, 10_000, { pledged: true }), "SPONSOR_REQUIRED", "a pledge with no sponsor");
  assert(await totalCents(r3.id) === 40_000 && await awardRow(r3.id) === null, "a refused pledge leaves nothing behind");
  await award(e1, r3.id, 30_000, { pledged: true, sponsorName: "Test Pledger" });
  assert(await totalCents(r3.id) === 10_000, "a pledged award still lowers what the attendee owes");
  view = await getFundView(e1);
  assert(view.summary.balanceCents === 0 && view.summary.pledgedCents === 30_000 && view.summary.afterPledgesCents === -30_000, "pledged money is outside the balance and shows the fund short");
  const pledger = view.summary.sponsors.find((sponsor) => sponsor.name === "Test Pledger");
  assert(pledger?.outstandingCents === 30_000 && pledger.receivedCents === 0, "outstanding per sponsor");
  const pledgedAward = await awardRow(r3.id);
  assert(pledgedAward?.pledged && !pledgedAward.settledAt, "the award is pledged and unsettled");

  // ---- Settling needs the money recorded and unspent first; once only; never on a non-pledge.
  await expectFundError(settlePledgedAward(e1, pledgedAward.id, staff), "SETTLE_EXCEEDS_BALANCE", "settle before the money arrives");
  await contribute(e1, 30_000, { sponsorName: "test pledger" });
  assert((await getFundView(e1)).summary.sponsors.find((sponsor) => sponsor.key === "name:test pledger")?.receivedCents === 30_000, "the sponsor's money is matched to the typed name, however it is cased");
  await settlePledgedAward(e1, pledgedAward.id, staff);
  view = await getFundView(e1);
  assert(view.summary.balanceCents === 0 && view.summary.pledgedCents === 0 && view.summary.fundedCents === 93_200, "a settled pledge becomes funded and no longer outstanding");
  await expectFundError(settlePledgedAward(e1, pledgedAward.id, staff), "AWARD_ALREADY_SETTLED", "settle twice");
  const funded = await awardRow(r1.id);
  await expectFundError(settlePledgedAward(e1, funded!.id, staff), "AWARD_NOT_PLEDGED", "settle a funded award");
  await expectFundError(settlePledgedAward(e2, pledgedAward.id, staff), "AWARD_NOT_FOUND", "settle another event's award");

  // ---- Reversing the adjustment line through the existing reversal returns the money to the fund.
  await reverseRegistrationAdjustment(e1, r1.id, line.id, staff, "Scholarship check reversal reason");
  assert(await totalCents(r1.id) === 30_000, "the reversal restores what the attendee owes");
  view = await getFundView(e1);
  assert(view.summary.balanceCents === 20_000, "the reversed award's money is back in the fund");
  assert(!view.awards.find((entry) => entry.id === firstAward.id)!.active, "the reversed award is inactive");
  assert(view.summary.sponsors.find((sponsor) => sponsor.organizationId === churchA)?.awardedCents === 0, "a reversed award stops counting for its sponsor");
  // A pledged award reversed before it was received cannot be settled.
  const r4 = await mkRegistration(e1, 400);
  await award(e1, r4.id, 5_000, { pledged: true, organizationId: churchA });
  const r4Line = await prisma.registrationAdjustment.findFirstOrThrow({ where: { registrationId: r4.id } });
  const r4Award = await awardRow(r4.id);
  assert((await getFundView(e1)).summary.sponsors.find((sponsor) => sponsor.organizationId === churchA)?.outstandingCents === 5_000, "outstanding for the directory church");
  await reverseRegistrationAdjustment(e1, r4.id, r4Line.id, staff, "Scholarship check reversal reason");
  assert((await getFundView(e1)).summary.pledgedCents === 0, "a reversed pledge is no longer outstanding");
  await expectFundError(settlePledgedAward(e1, r4Award!.id, staff), "AWARD_REVERSED", "settle a reversed award");

  // ---- Contribution reversals: a new negative line; refused when awards drew on the money, twice, or on a reversal.
  const e3 = await mkEvent();
  const gift = await contribute(e3, 10_000, { sponsorName: "Reversal Sponsor" });
  const r5 = await mkRegistration(e3, 400);
  await award(e3, r5.id, 6_000, { pledged: false });
  await expectFundError(reverseContribution(e3, gift, staff, "Check bounced"), "REVERSAL_EXCEEDS_BALANCE", "reverse money awards drew on");
  const r5Line = await prisma.registrationAdjustment.findFirstOrThrow({ where: { registrationId: r5.id } });
  await reverseRegistrationAdjustment(e3, r5.id, r5Line.id, staff, "Scholarship check reversal reason");
  const reversalId = await reverseContribution(e3, gift, staff, "Check bounced");
  const reversalLine = await prisma.scholarshipContribution.findUniqueOrThrow({ where: { id: reversalId } });
  assert(reversalLine.amountCents === -10_000 && reversalLine.reversesContributionId === gift, "the reversal is a negative line pointing at the original");
  assert(await prisma.scholarshipContribution.count({ where: { id: gift } }) === 1, "the original stays on record");
  assert((await getFundView(e3)).summary.receivedCents === 0, "the fund no longer holds the reversed money");
  await expectFundError(reverseContribution(e3, gift, staff, "Again"), "CONTRIBUTION_ALREADY_REVERSED", "reverse twice");
  await expectFundError(reverseContribution(e3, reversalId, staff, "Reverse the reversal"), "CONTRIBUTION_NOT_REVERSIBLE", "reverse a reversal");
  await expectFundError(reverseContribution(e1, gift, staff, "Wrong event"), "CONTRIBUTION_NOT_FOUND", "reverse another event's line");

  // ---- Races: parallel awards never overspend; an award racing the reversal of its funding leaves the balance >= 0.
  const e4 = await mkEvent();
  await contribute(e4, 10_000, { sponsorName: "Race Funder" });
  const racers = await Promise.all([1, 2, 3, 4, 5].map(async () => {
    const registration = await mkRegistration(e4, 300);
    return award(e4, registration.id, 3_000, { pledged: false }).then(() => "ok", (caught: unknown) => caught);
  }));
  const wins = racers.filter((outcome) => outcome === "ok").length;
  for (const outcome of racers.filter((entry) => entry !== "ok")) {
    const expected = outcome instanceof ScholarshipFundError ? outcome.code === "FUND_BALANCE_TOO_LOW" : (outcome as { code?: string }).code === "P2034";
    assert(expected, `a losing racer is refused for the balance or a retryable conflict, got ${String(outcome)}`);
  }
  const raceView = await getFundView(e4);
  assert(wins <= 3 && wins >= 1, `at most three $30 awards fit in $100 (got ${wins})`);
  assert(raceView.summary.balanceCents === 10_000 - wins * 3_000 && raceView.summary.balanceCents >= 0, "the balance matches the awards that won and never goes negative");
  assert(await prisma.scholarshipAward.count({ where: { eventId: e4 } }) === wins, "exactly the winning awards were recorded");

  for (let round = 0; round < 3; round += 1) {
    const e = await mkEvent();
    const funding = await contribute(e, 10_000, { sponsorName: "Funding Sponsor" });
    const registration = await mkRegistration(e, 300);
    const outcomes = await Promise.all([
      award(e, registration.id, 10_000, { pledged: false }).then(() => "award", (caught: unknown) => caught),
      reverseContribution(e, funding, staff, "Check bounced").then(() => "reversal", (caught: unknown) => caught),
    ]);
    const succeeded = outcomes.filter((outcome) => outcome === "award" || outcome === "reversal");
    assert(succeeded.length <= 1, `an award and the reversal of its funding never both succeed (round ${round}: ${outcomes.map(String).join(", ")})`);
    assert((await getFundView(e)).summary.balanceCents >= 0, `the balance never goes negative (round ${round})`);
  }

  // ---- Per-sponsor money: a sponsor's awards, settlements and reversals are bounded by what that sponsor gave.
  const e6 = await mkEvent();
  const giftA = await contribute(e6, 10_000, { sponsorName: "Sponsor A" });
  await contribute(e6, 20_000, { sponsorName: "Sponsor C" });
  const r6 = await mkRegistration(e6, 500);
  const sponsorRefusal = await award(e6, r6.id, 10_001, { pledged: false, sponsorName: "Sponsor A" }).then(() => null, (caught: unknown) => caught);
  assert(sponsorRefusal instanceof ScholarshipFundError && sponsorRefusal.code === "SPONSOR_BALANCE_TOO_LOW", `a sponsored award above the sponsor's own money is refused although the fund has it (got ${String(sponsorRefusal)})`);
  assert(await totalCents(r6.id) === 50_000 && await awardRow(r6.id) === null, "the refused sponsored award leaves nothing behind");
  await expectFundError(award(e6, r6.id, 1_000, { pledged: false, sponsorName: "Never Gave" }), "SPONSOR_BALANCE_TOO_LOW", "a sponsor who gave nothing");
  await award(e6, r6.id, 8_000, { pledged: false, sponsorName: "sponsor a" });
  let v6 = await getFundView(e6);
  const sponsorA = v6.summary.sponsors.find((sponsor) => sponsor.key === "name:sponsor a")!;
  assert(sponsorA.receivedCents === 10_000 && sponsorA.awardedCents === 8_000 && sponsorA.unallocatedCents === 2_000, "per-sponsor matching after a sponsored award");
  // An award with no sponsor draws on the fund in general and shows on its own line.
  const r6b = await mkRegistration(e6, 500);
  await award(e6, r6b.id, 5_000, { pledged: false });
  v6 = await getFundView(e6);
  const unallocatedTotal = v6.summary.sponsors.reduce((total, sponsor) => total + sponsor.unallocatedCents, 0);
  assert(v6.summary.generalAwardedCents === 5_000 && unallocatedTotal - v6.summary.generalAwardedCents === v6.summary.balanceCents, "per-sponsor figures and the general draw add up to the fund balance");
  // Reversing a sponsor's contribution cannot leave their awards uncovered, even with a healthy fund balance.
  assert(v6.summary.balanceCents >= 10_000, "the fund as a whole could absorb the reversal");
  await expectFundError(reverseContribution(e6, giftA, staff, "Check bounced"), "REVERSAL_EXCEEDS_BALANCE", "reverse money that sponsor's awards drew on");
  // Settling a pledge needs that sponsor's own money, not just money in the fund.
  const r6c = await mkRegistration(e6, 500);
  await award(e6, r6c.id, 5_000, { pledged: true, sponsorName: "Sponsor P" });
  const pledgeP = (await awardRow(r6c.id))!;
  await expectFundError(settlePledgedAward(e6, pledgeP.id, staff), "SETTLE_EXCEEDS_BALANCE", "settle with only other sponsors' money in the fund");
  await contribute(e6, 5_000, { sponsorName: "Sponsor P" });
  await settlePledgedAward(e6, pledgeP.id, staff);
  assert((await getFundView(e6)).summary.sponsors.find((sponsor) => sponsor.key === "name:sponsor p")?.unallocatedCents === 0, "a settled pledge spends exactly that sponsor's money");

  // ---- A cancelled registration: no settling, flagged, and only a fund-linked scholarship can be reversed to release money.
  const r7 = await mkRegistration(e6, 500);
  await award(e6, r7.id, 2_000, { pledged: true, sponsorName: "Sponsor P" });
  const pledge7 = (await awardRow(r7.id))!;
  await contribute(e6, 2_000, { sponsorName: "Sponsor P" });
  const plainDiscount = await createRegistrationAdjustment(e6, r7.id, staff, { kind: "DISCOUNT", amountCents: 1_000, reason: "Plain discount reason" }).then(() => prisma.registrationAdjustment.findFirstOrThrow({ where: { registrationId: r7.id, kind: "DISCOUNT" } }));
  await prisma.registration.update({ where: { id: r7.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
  await expectFundError(settlePledgedAward(e6, pledge7.id, staff), "AWARD_REGISTRATION_INACTIVE", "settle a pledge on a cancelled registration");
  const cancelledView = (await getFundView(e6)).awards.find((entry) => entry.id === pledge7.id)!;
  assert(cancelledView.active && cancelledView.registrationCancelled, "an active award on a cancelled registration is flagged");
  const pledgedBefore = (await getFundView(e6)).summary.pledgedCents;
  const discountRefusal = await reverseRegistrationAdjustment(e6, r7.id, plainDiscount.id, staff, "Release it").then(() => null, (caught: unknown) => caught);
  assert((discountRefusal as { code?: string } | null)?.code === "REGISTRATION_NOT_ADJUSTABLE", "a plain discount on a cancelled registration still cannot be reversed");
  const pledgeLine = await prisma.registrationAdjustment.findFirstOrThrow({ where: { id: pledge7.adjustmentId } });
  await reverseRegistrationAdjustment(e6, r7.id, pledgeLine.id, staff, "Registration cancelled, release the pledge");
  const releasedView = await getFundView(e6);
  assert(!releasedView.awards.find((entry) => entry.id === pledge7.id)!.active && !releasedView.awards.find((entry) => entry.id === pledge7.id)!.registrationCancelled, "the reversed award is released and no longer flagged");
  assert(releasedView.summary.pledgedCents === pledgedBefore - 2_000, "the released pledge is no longer outstanding");
  // A funded award on a cancelled registration returns its money to the fund the same way.
  const r8 = await mkRegistration(e6, 500);
  await award(e6, r8.id, 1_500, { pledged: false });
  const balanceWithAward = (await getFundView(e6)).summary.balanceCents;
  await prisma.registration.update({ where: { id: r8.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
  await reverseRegistrationAdjustment(e6, r8.id, (await prisma.registrationAdjustment.findFirstOrThrow({ where: { registrationId: r8.id } })).id, staff, "Registration cancelled, release it");
  assert((await getFundView(e6)).summary.balanceCents === balanceWithAward + 1_500, "reversing a cancelled registration's award returns its money to the fund");
  // Other statuses stay closed.
  await prisma.registration.update({ where: { id: r8.id }, data: { status: "WAITLISTED" } });
  const waitlistedRefusal = await award(e6, r8.id, 100, { pledged: false }).then(() => null, (caught: unknown) => caught);
  assert((waitlistedRefusal as { code?: string } | null)?.code === "REGISTRATION_NOT_ADJUSTABLE", "a waitlisted registration still cannot be adjusted");

  // ---- A church-billed registration refuses a fund award on the server.
  const eBilled = await mkEvent("DEFERRED_ORGANIZATION_INVOICE");
  await contribute(eBilled, 10_000, { sponsorName: "Billed Sponsor" });
  const rBilled = await mkRegistration(eBilled, 300);
  const billedRefusal = await award(eBilled, rBilled.id, 1_000, { pledged: false }).then(() => null, (caught: unknown) => caught);
  assert((billedRefusal as { code?: string } | null)?.code === "FUND_AWARD_NOT_ALLOWED", `a church-billed registration refuses a fund award (got ${String(billedRefusal)})`);
  assert(await totalCents(rBilled.id) === 30_000 && await prisma.scholarshipAward.count({ where: { eventId: eBilled } }) === 0, "and records nothing");
  await createRegistrationAdjustment(eBilled, rBilled.id, staff, { kind: "SCHOLARSHIP", amountCents: 1_000, reason: "Plain scholarship reason" });
  assert(await totalCents(rBilled.id) === 29_000, "a plain scholarship on a church-billed registration still works");

  // ---- The database refuses what the application never writes.
  const fund1 = await prisma.scholarshipFund.findUniqueOrThrow({ where: { eventId: e1 }, select: { id: true } });
  const refuses = async (work: () => Promise<unknown>, message: string) => {
    const error = await work().then(() => null, (caught: unknown) => caught);
    assert(error !== null, `the database refuses ${message}`);
  };
  const baseLine = { eventId: e1, fundId: fund1.id, sponsorName: "Raw", sponsorKey: "name:raw", receivedOn: new Date("2027-01-15T00:00:00Z"), method: "CASH" as const, createdByNameSnapshot: "Raw" };
  await refuses(() => prisma.scholarshipContribution.create({ data: { ...baseLine, amountCents: -100 } }), "a negative contribution that is not a reversal");
  await refuses(() => prisma.scholarshipContribution.create({ data: { ...baseLine, amountCents: 0 } }), "a zero contribution");
  await refuses(() => prisma.scholarshipContribution.create({ data: { ...baseLine, eventId: e2, amountCents: 100 } }), "a line whose fund belongs to another event");
  await refuses(() => prisma.scholarshipAward.updateMany({ where: { id: funded!.id }, data: { settledAt: new Date() } }), "a settled award that was never pledged");
  await refuses(() => prisma.scholarshipAward.updateMany({ where: { id: funded!.id }, data: { pledged: true, sponsorKey: null } }), "a pledge with no sponsor");
  await refuses(() => prisma.scholarshipAward.updateMany({ where: { id: funded!.id }, data: { amountCents: 0 } }), "a zero award");

  // ---- Export: formula-safe, audited with counts only.
  const e5 = await mkEvent();
  await contribute(e5, 1_234, { sponsorName: "=HYPERLINK(\"http://example.test\")" }, "+1 check");
  const exportData = await exportFund(e5, staff);
  const csv = toCsv(fundCsvRows(exportData));
  assert(csv.includes(`"'=HYPERLINK(""http://example.test"")"`), "a formula-like sponsor name is exported as text");
  assert(csv.includes(`"'+1 check"`), "a formula-like note is exported as text");
  assert(!/(^|,)"[=+\-@]/m.test(csv), "no cell in the export starts with a formula character");
  assert(csv.includes('"12.34"'), "amounts are exported as dollars from integer cents");
  const exportAudit = await prisma.auditLog.findFirstOrThrow({ where: { eventId: e5, action: "SCHOLARSHIP_FUND_EXPORTED" } });
  const exportMeta = exportAudit.metadata as Record<string, unknown>;
  assert(Object.keys(exportMeta).sort().join() === "awardLines,balanceCents,contributionLines" && exportMeta.contributionLines === 1 && exportMeta.awardLines === 0 && exportMeta.balanceCents === 1_234, "the export audit holds counts and an amount only");

  // ---- Audit rows hold ids and amounts only.
  const audits = await prisma.auditLog.findMany({ where: { eventId: startsWithP, action: { startsWith: "SCHOLARSHIP_" } } });
  const actions = new Set(audits.map((entry) => entry.action));
  for (const action of ["SCHOLARSHIP_CONTRIBUTION_RECORDED", "SCHOLARSHIP_CONTRIBUTION_REVERSED", "SCHOLARSHIP_AWARD_RECORDED", "SCHOLARSHIP_PLEDGE_SETTLED", "SCHOLARSHIP_FUND_EXPORTED"]) {
    assert(actions.has(action), `${action} is audited`);
  }
  const adjustmentAudits = await prisma.auditLog.findMany({ where: { eventId: startsWithP, action: { startsWith: "REGISTRATION_ADJUSTMENT" } } });
  for (const entry of [...audits, ...adjustmentAudits]) {
    const text = JSON.stringify([entry.summary, entry.metadata]);
    for (const secret of [CHURCH_A_NAME, "Test Friend", "Test Pledger", "Race Sponsor", "Funding Sponsor", "Check bounced", noteText, "secret-note", "Scholarship check award reason", "Scholarship check reversal reason", "HYPERLINK"]) {
      assert(!text.toLowerCase().includes(secret.toLowerCase()), `an audit row never holds "${secret}" (${entry.action})`);
    }
  }
  assert(audits.every((entry) => entry.actorUserId === staff), "every audit row names the actor");

  // ---- Deleting an event removes its fund and everything on it.
  const fundIds = (await prisma.scholarshipFund.findMany({ where: { eventId: { in: [e1, e3] } }, select: { id: true } })).map((row) => row.id);
  assert(fundIds.length === 2, "the events have funds to delete");
  await prisma.event.deleteMany({ where: { id: { in: [e1, e3] } } });
  assert(await prisma.scholarshipFund.count({ where: { id: { in: fundIds } } }) === 0, "event deletion removes the fund");
  assert(await prisma.scholarshipContribution.count({ where: { fundId: { in: fundIds } } }) === 0, "and its contributions");
  assert(await prisma.scholarshipAward.count({ where: { fundId: { in: fundIds } } }) === 0, "and its awards");
  assert((await getFundView(e2)).summary.receivedCents === 0 && await prisma.scholarshipFund.count({ where: { eventId: e4 } }) === 1, "another event's fund is untouched");

  console.log("Scholarship fund verification passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((error) => { console.error("Cleanup failed", error); process.exitCode = 1; });
    await prisma.$disconnect();
  });
