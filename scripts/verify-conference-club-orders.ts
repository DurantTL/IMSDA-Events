/**
 * Proves conference club orders (#1688) against a real PostgreSQL database, where the unit tests' in-memory stand-ins can't.
 * Owner decisions (Caleb, Nov 8, 2026): a club orders conference-supplied patches and pins from its Orders tab; the order goes to
 * the youth department (not AdventSource) and, once filled, is billed to the club's sponsoring church as lines on one hidden
 * billing container per club year, finalized by the treasurer as usual; postage is entered by staff when they fill the order and
 * billed as its own line; a director may cancel only while the order is Submitted.
 *
 * - a director submits an order: it is saved SUBMITTED with the church, item names and unit prices copied onto it, the hidden
 *   billing event for the club year is made (archived, unpublished, marked), one order email goes to the conference orders
 *   address (the setting, else youth@imsda.org) and one confirmation to the director, and the audit row holds ids and counts only;
 * - a club with no sponsoring church, an empty order and an item the conference does not supply are refused;
 * - a price change never alters a submitted order, and the next order uses the new price;
 * - a director cancels only their own club's order, only while Submitted (another club's order is never found);
 * - staff fill an order: postage is validated, the order becomes FILLED, the church's DRAFT invoice on the billing event gets a
 *   line for it (items and postage as their own charge), the club's stock grows only when asked, and filling twice is refused;
 * - a second order from a club of the same church refreshes the same draft; another church gets its own invoice;
 * - the treasurer finalizes it with the Finalize invoices permission (and not without), the church statement finds it, and a later
 *   fill starts a REVISION draft beside the finalized version (nothing is ever finalized automatically);
 * - staff cancel with a reason (required); every status change is audited;
 * - conference items never reach the AdventSource order list, its order, or its exports, and cannot be put on the helper list;
 * - the billing event is in no event picker or Archived events list and cannot be unarchived.
 *
 * Uses fictitious rows it creates and removes itself, in a far-future club year of its own.
 *
 *   npm run test:conference-club-orders
 */
import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";
import { fillBlankSyntheticEnv } from "./support/synthetic-env";

loadEnvConfig(process.cwd());
assertLocalDatabase(process.env, "run this verification");
fillBlankSyntheticEnv("SECRET_ENCRYPTION_KEY", "verify-conference-club-orders-synthetic-key-not-a-secret");
// Account email is "configured" for this check so the order emails are queued in the outbox (nothing is delivered).
process.env.ACCOUNT_EMAIL_SENDER_ADDRESS = "orders-check@example.test";

const prisma = new PrismaClient();
const P = `cco_${randomUUID().slice(0, 8)}`;
const ids = {
  staff: `${P}_staff`,
  treasurer: `${P}_treasurer`,
  directorAccount: `${P}_director`,
  person: `${P}_person`,
  churchA: `${P}_church_a`,
  churchB: `${P}_church_b`,
  clubMain: `${P}_club_main`,
  clubSibling: `${P}_club_sibling`,
  clubOrphan: `${P}_club_orphan`,
  clubOther: `${P}_club_other`,
  conf1: `${P}_item_conf1`,
  conf2: `${P}_item_conf2`,
  adv: `${P}_item_adv`,
};
const DIRECTOR_EMAIL = `${P}.director@example.test`;
const ORDERS_EMAIL = `${P}.orders@example.test`;
/** A club year of its own, so this check never touches a real billing event. */
const NOW = new Date("2031-01-15T18:00:00.000Z");
const CLUB_YEAR = "2030-31";
const CONTAINER_SLUG = `conference-club-orders-${CLUB_YEAR}`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}
/** The conference items this run added through the sync, so cleanup removes only those. */
const createdBySync: string[] = [];
const failure = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => error);
const codeOf = (error: unknown) => (error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : error instanceof Error ? `other:${error.message.slice(0, 120)}` : "none");

async function cleanup() {
  const containers = (await prisma.event.findMany({ where: { slug: CONTAINER_SLUG }, select: { id: true } })).map((row) => row.id);
  const orders = (await prisma.conferenceClubOrder.findMany({ where: { organizationId: { startsWith: `${P}_` } }, select: { id: true } })).map((row) => row.id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: { in: [ids.staff, ids.treasurer] } }, { entityId: { in: orders } }, { eventId: { in: containers } }] } });
  if (orders.length > 0) await prisma.messageOutbox.deleteMany({ where: { OR: orders.map((id) => ({ idempotencyKey: { startsWith: `conference-club-order:${id}:` } })) } });
  await prisma.conferenceClubOrder.deleteMany({ where: { id: { in: orders } } });
  // Deleting the billing event removes its invoices (the guards allow it when the event is going away).
  await prisma.event.deleteMany({ where: { id: { in: containers } } });
  await prisma.clubSupplyStock.deleteMany({ where: { organizationId: { startsWith: `${P}_` } } });
  await prisma.clubOrderNeed.deleteMany({ where: { organizationId: { startsWith: `${P}_` } } });
  const batches = (await prisma.clubSupplyOrderBatch.findMany({ where: { organizationId: { startsWith: `${P}_` } }, select: { id: true } })).map((row) => row.id);
  await prisma.clubSupplyOrderLine.deleteMany({ where: { batchId: { in: batches } } });
  await prisma.clubSupplyOrderBatch.deleteMany({ where: { id: { in: batches } } });
  await prisma.clubOrderListLine.deleteMany({ where: { organizationId: { startsWith: `${P}_` } } });
  await prisma.clubSupplyItem.deleteMany({ where: { id: { startsWith: `${P}_` } } });
  // The three conference items this check added through the sync (an empty catalog is what the catalog check needs); any that were already there stay.
  if (createdBySync.length > 0) await prisma.clubSupplyItem.deleteMany({ where: { name: { in: createdBySync }, supplier: "CONFERENCE" } });
  await prisma.person.deleteMany({ where: { id: ids.person } });
  await prisma.clubDirectorGrant.deleteMany({ where: { organizationId: { startsWith: `${P}_` } } });
  await prisma.attendeeAccount.deleteMany({ where: { id: ids.directorAccount } });
  // A contact is never deleted by the application; this local cleanup turns the guard off for one transaction.
  await prisma.$transaction([
    prisma.$executeRawUnsafe('ALTER TABLE "OrganizationBillingContact" DISABLE TRIGGER "OrganizationBillingContact_no_delete"'),
    prisma.organizationBillingContact.deleteMany({ where: { organizationId: { startsWith: `${P}_` } } }),
    prisma.$executeRawUnsafe('ALTER TABLE "OrganizationBillingContact" ENABLE TRIGGER "OrganizationBillingContact_no_delete"'),
  ]);
  await prisma.organization.deleteMany({ where: { id: { startsWith: `${P}_` }, type: "CLUB" } });
  await prisma.organization.deleteMany({ where: { id: { startsWith: `${P}_` } } });
  await prisma.user.deleteMany({ where: { id: { in: [ids.staff, ids.treasurer] } } });
}

async function main() {
  const repo = await import("../modules/club-orders/conference-repository");
  const clubOrders = await import("../modules/club-orders/repository");
  const clubOrdersDomain = await import("../modules/club-orders/domain");
  const supplies = await import("../modules/club-supplies/repository");
  const invoices = await import("../modules/invoices/repository");
  const ledger = await import("../modules/invoices/ledger-repository");
  const eventsRepo = await import("../modules/events/repository");
  const archive = await import("../modules/events/archive-repository");
  const { syncConferenceSupplyItems } = await import("../modules/club-orders/conference-items-sync");

  await cleanup();
  const settingsBefore = await prisma.platformSettings.findUnique({ where: { id: "platform" }, select: { conferenceOrdersEmail: true } });

  try {
    // -------------------------------------------------------------- fixtures
    await prisma.user.createMany({
      data: [
        { id: ids.staff, email: `${P}-staff@example.test`, displayName: "Orders Check Staff", globalRole: "SYSTEM_ADMIN" },
        { id: ids.treasurer, email: `${P}-treasurer@example.test`, displayName: "Orders Check Treasurer", globalRole: "SYSTEM_ADMIN" },
      ],
    });
    await prisma.organization.createMany({
      data: [
        { id: ids.churchA, type: "CHURCH", name: `Hills Check Church ${P}`, normalizedName: `hills check church ${P}` },
        { id: ids.churchB, type: "CHURCH", name: `Valley Check Church ${P}`, normalizedName: `valley check church ${P}` },
      ],
    });
    await prisma.organization.createMany({
      data: [
        { id: ids.clubMain, type: "CLUB", name: `Trailblazers ${P}`, normalizedName: `trailblazers ${P}`, parentOrganizationId: ids.churchA },
        { id: ids.clubSibling, type: "CLUB", name: `Explorers ${P}`, normalizedName: `explorers ${P}`, parentOrganizationId: ids.churchA },
        { id: ids.clubOrphan, type: "CLUB", name: `Drifters ${P}`, normalizedName: `drifters ${P}` },
        { id: ids.clubOther, type: "CLUB", name: `Voyagers ${P}`, normalizedName: `voyagers ${P}`, parentOrganizationId: ids.churchB },
      ],
    });
    await prisma.attendeeAccount.create({ data: { id: ids.directorAccount, email: DIRECTOR_EMAIL, displayName: "Dana Director", status: "ACTIVE" } });
    await prisma.clubDirectorGrant.create({
      data: { organizationId: ids.clubMain, attendeeAccountId: ids.directorAccount, role: "DIRECTOR", effectiveFrom: new Date("2030-01-01T00:00:00.000Z"), reason: "Synthetic director for the check" },
    });
    await prisma.organizationBillingContact.create({
      data: { organizationId: ids.churchA, name: "Tina Treasurer", email: `${P}.tina@contact.test`, roleLabel: "Treasurer", verifiedAt: new Date("2030-06-01T00:00:00.000Z") },
    });
    await prisma.clubSupplyItem.createMany({
      data: [
        { id: ids.conf1, section: "MISCELLANEOUS", name: `Check Shoulder Patch ${P}`, normalizedName: `check shoulder patch ${P}`, supplier: "CONFERENCE", unitPriceCents: 125 },
        { id: ids.conf2, section: "MISCELLANEOUS", name: `Check Conference Pin ${P}`, normalizedName: `check conference pin ${P}`, supplier: "CONFERENCE", unitPriceCents: 275 },
        { id: ids.adv, section: "OUTDOOR_INDUSTRIES", name: `Check Camping Patch ${P}`, normalizedName: `check camping patch ${P}`, catalogNumber: "009901" },
      ],
    });
    await prisma.person.create({ data: { id: ids.person, firstName: "Alex", lastName: "Sample" } });
    await prisma.platformSettings.upsert({ where: { id: "platform" }, update: { conferenceOrdersEmail: null }, create: { id: "platform" } });

    const director = { accountId: ids.directorAccount };
    const staff = ids.staff;

    // -------------------------------------------------------------- the seeded items are idempotent
    const syncOnce = await syncConferenceSupplyItems(prisma);
    createdBySync.push(...syncOnce.created);
    const syncTwice = await syncConferenceSupplyItems(prisma);
    assert(syncTwice.created.length === 0 && syncTwice.existing.length === 3, "syncing the three conference items twice adds nothing the second time");
    assert(syncOnce.created.length + syncOnce.existing.length === 3, "the sync knows exactly three items");
    const seeded = await prisma.clubSupplyItem.findMany({ where: { name: { in: ["Pathfinder Shoulder Patch", "Pathfinder Conference Pin", "Adventurer Shoulder Patch"] }, supplier: "CONFERENCE" }, select: { name: true } });
    assert(seeded.length === 3, "the three conference items are in the catalog as conference-supplied");

    // -------------------------------------------------------------- 1. a director submits
    const first = await repo.submitConferenceOrder(ids.clubMain, { quantities: { [ids.conf1]: 20, [ids.conf2]: "4" }, patchesToExchange: 7 }, director, NOW);
    assert(first.status === "SUBMITTED" && first.clubYear === CLUB_YEAR, "a submitted order waits as SUBMITTED in the club year");
    assert(first.itemsTotalCents === 20 * 125 + 4 * 275 && first.postageCents === null, "the items total is quantity times unit price, with no postage yet");
    assert(first.patchesToExchange === 7, "patches to exchange are kept on the order");
    const saved = await prisma.conferenceClubOrder.findUniqueOrThrow({ where: { id: first.id }, include: { lines: true, event: true } });
    assert(saved.churchId === ids.churchA, "the club's sponsoring church is copied onto the order");
    assert(saved.lines.length === 2 && saved.lines.some((line) => line.itemId === ids.conf1 && line.unitPriceCents === 125 && line.itemName === `Check Shoulder Patch ${P}`), "item names and unit prices are copied onto the lines");
    assert(saved.submittedByAccountId === ids.directorAccount, "the submitting account is recorded");
    assert(saved.event.isBillingContainer && saved.event.archivedAt !== null && !saved.event.isPublished && !saved.event.showOnCalendar, "the billing event is marked, archived, unpublished and off the calendar");
    assert(saved.event.slug === CONTAINER_SLUG && saved.event.billingMode === "ATTENDEE_PAY", "it is the club year's own billing event");
    const containerId = saved.eventId;

    // The emails: one order email to the default address, one confirmation to the director; the audit row holds no name or email.
    const mail = await prisma.messageOutbox.findMany({ where: { idempotencyKey: { startsWith: `conference-club-order:${first.id}:` } } });
    assert(mail.length === 2, `one order email and one confirmation per submit, found ${mail.length}`);
    const staffMail = mail.find((row) => row.templateKey === "CONFERENCE_CLUB_ORDER_SUBMITTED");
    const directorMail = mail.find((row) => row.templateKey === "CONFERENCE_CLUB_ORDER_CONFIRMATION");
    assert(staffMail && staffMail.recipientEmail === "youth@imsda.org", "with no setting the order email goes to youth@imsda.org");
    assert(staffMail.bodyTextSnapshot?.includes(`Trailblazers ${P}`) && staffMail.bodyTextSnapshot.includes(`Hills Check Church ${P}`) && staffMail.bodyTextSnapshot.includes("Dana Director") && staffMail.bodyTextSnapshot.includes("$1.25") && staffMail.bodyTextSnapshot.includes("exchange: 7") && staffMail.bodyTextSnapshot.includes("$36.00"), "the order email names the club, church, director, items, exchanges and total");
    assert(directorMail && directorMail.recipientEmail === DIRECTOR_EMAIL, "the confirmation goes to the club's director");
    assert(mail.every((row) => row.eventId === null && row.status === "PENDING"), "both are queued in the outbox, not sent in the request");
    const submitAudit = await prisma.auditLog.findFirstOrThrow({ where: { action: "CONFERENCE_CLUB_ORDER_SUBMITTED", entityId: first.id } });
    const submitMeta = JSON.stringify(submitAudit.metadata);
    assert(submitMeta.includes(first.id) && submitMeta.includes('"itemsTotalCents":3600') && !submitMeta.includes("Dana") && !submitMeta.includes(DIRECTOR_EMAIL), "the audit row holds ids, counts and amounts, no name or email");

    // The setting changes where the order email goes (and only that email).
    await prisma.platformSettings.update({ where: { id: "platform" }, data: { conferenceOrdersEmail: ORDERS_EMAIL } });
    const viaSetting = await repo.submitConferenceOrder(ids.clubMain, { quantities: { [ids.conf1]: 1 }, patchesToExchange: 0 }, director, NOW);
    const settingMail = await prisma.messageOutbox.findFirstOrThrow({ where: { idempotencyKey: `conference-club-order:${viaSetting.id}:submitted` } });
    assert(settingMail.recipientEmail === ORDERS_EMAIL, "the conference orders email setting is where the order email goes");
    await prisma.platformSettings.update({ where: { id: "platform" }, data: { conferenceOrdersEmail: null } });

    // -------------------------------------------------------------- 2. refusals
    assert(codeOf(await failure(repo.submitConferenceOrder(ids.clubOrphan, { quantities: { [ids.conf1]: 2 } }, director, NOW))) === "NO_SPONSORING_CHURCH", "a club with no sponsoring church cannot submit");
    assert(await prisma.conferenceClubOrder.count({ where: { organizationId: ids.clubOrphan } }) === 0, "and nothing was saved for it");
    assert(codeOf(await failure(repo.submitConferenceOrder(ids.clubMain, { quantities: { [ids.conf1]: 0 }, patchesToExchange: 3 }, director, NOW))) === "INVALID_ORDER", "an order of nothing (patches to exchange alone) is refused");
    assert(codeOf(await failure(repo.submitConferenceOrder(ids.clubMain, { quantities: { [ids.adv]: 2 } }, director, NOW))) === "ITEM_NOT_ORDERABLE", "an AdventSource item cannot be ordered from the conference");
    assert(codeOf(await failure(repo.submitConferenceOrder(ids.clubMain, { quantities: { no_such_item: 2 } }, director, NOW))) === "ITEM_NOT_ORDERABLE", "an unknown item is refused");
    assert(codeOf(await failure(repo.submitConferenceOrder("no_such_club", { quantities: { [ids.conf1]: 2 } }, director, NOW))) === "CLUB_NOT_FOUND", "an unknown club is not found");

    // -------------------------------------------------------------- 3. a price change never alters a submitted order
    await supplies.setClubSupplyItemOrdering(ids.conf1, { supplier: "CONFERENCE", unitPriceCents: 500 }, staff);
    const afterPrice = await prisma.conferenceClubOrder.findUniqueOrThrow({ where: { id: first.id }, include: { lines: true } });
    assert(afterPrice.itemsTotalCents === 3600 && afterPrice.lines.find((line) => line.itemId === ids.conf1)?.unitPriceCents === 125, "a price change leaves the submitted order's lines and total as they were");
    const repriced = await repo.submitConferenceOrder(ids.clubMain, { quantities: { [ids.conf1]: 2 } }, director, NOW);
    assert(repriced.itemsTotalCents === 1000, "the next order uses the new price");
    assert(await prisma.auditLog.count({ where: { action: "CLUB_SUPPLY_ITEM_ORDERING_UPDATED", entityId: ids.conf1 } }) === 1, "the price change is audited");
    assert(codeOf(await failure(supplies.setClubSupplyItemOrdering(ids.conf1, { supplier: "CONFERENCE", unitPriceCents: null }, staff))) === "INVALID_PRICE", "a conference item needs a price");
    await supplies.setClubSupplyItemOrdering(ids.conf1, { supplier: "CONFERENCE", unitPriceCents: 125 }, staff);

    // -------------------------------------------------------------- 4. a director cancels only their own club's submitted order
    assert(codeOf(await failure(repo.cancelConferenceOrderAsDirector(ids.clubSibling, first.id, { accountId: ids.directorAccount }))) === "ORDER_NOT_FOUND", "another club's order is never found by a director of a different club");
    assert((await prisma.conferenceClubOrder.findUniqueOrThrow({ where: { id: first.id } })).status === "SUBMITTED", "and it stays submitted");
    await repo.cancelConferenceOrderAsDirector(ids.clubMain, repriced.id, director, NOW);
    const cancelled = await prisma.conferenceClubOrder.findUniqueOrThrow({ where: { id: repriced.id } });
    assert(cancelled.status === "CANCELLED" && cancelled.cancelledByAccountId === ids.directorAccount && cancelled.cancelledAt !== null, "a director cancels a submitted order of their club");
    assert(codeOf(await failure(repo.cancelConferenceOrderAsDirector(ids.clubMain, repriced.id, director, NOW))) === "ORDER_NOT_SUBMITTED", "cancelling twice is refused");
    assert(codeOf(await failure(repo.fillConferenceOrder(repriced.id, { postage: "1.00", addToStock: false }, staff))) === "ORDER_NOT_SUBMITTED", "a cancelled order cannot be filled");
    assert(await prisma.auditLog.count({ where: { action: "CONFERENCE_CLUB_ORDER_CANCELLED", entityId: repriced.id } }) === 1, "the cancellation is audited");

    // -------------------------------------------------------------- 5. staff fill with postage
    assert(codeOf(await failure(repo.fillConferenceOrder(first.id, { postage: "abc", addToStock: false }, staff))) === "INVALID_POSTAGE", "postage must be dollars and cents");
    assert(codeOf(await failure(repo.fillConferenceOrder(first.id, { postage: "-2", addToStock: false }, staff))) === "INVALID_POSTAGE", "postage is never negative");
    assert((await prisma.conferenceClubOrder.findUniqueOrThrow({ where: { id: first.id } })).status === "SUBMITTED", "a refused fill changes nothing");
    assert(await prisma.invoice.count({ where: { eventId: containerId } }) === 0, "and starts no invoice");
    const filled = await repo.fillConferenceOrder(first.id, { postage: "4.50", addToStock: true }, staff, NOW);
    assert(filled.invoiceOutcome === "CREATED" && filled.invoiceId, "filling creates the church's draft invoice");
    const order = await prisma.conferenceClubOrder.findUniqueOrThrow({ where: { id: first.id } });
    assert(order.status === "FILLED" && order.postageCents === 450 && order.filledByUserId === staff && order.addedToStock, "the order is FILLED with its postage in cents and who filled it");
    assert(codeOf(await failure(repo.fillConferenceOrder(first.id, { postage: "1", addToStock: false }, staff))) === "ORDER_NOT_SUBMITTED", "filling twice is refused");
    const stock1 = await prisma.clubSupplyStock.findUnique({ where: { organizationId_itemId: { organizationId: ids.clubMain, itemId: ids.conf1 } } });
    const stock2 = await prisma.clubSupplyStock.findUnique({ where: { organizationId_itemId: { organizationId: ids.clubMain, itemId: ids.conf2 } } });
    assert(stock1?.quantityOnHand === 20 && stock2?.quantityOnHand === 4, "asked to, the quantities join the club's stock");

    const invoiceA = await prisma.invoice.findUniqueOrThrow({ where: { id: filled.invoiceId }, include: { versions: true } });
    assert(invoiceA.eventId === containerId && invoiceA.groupKey === `club-orders:${ids.churchA}` && invoiceA.partyId === ids.churchA && invoiceA.baseNumber === null, "the invoice is the church's, on the billing event, with no number yet");
    assert(invoiceA.versions.length === 1 && invoiceA.versions[0]!.status === "DRAFT" && invoiceA.versions[0]!.basis === "CLUB_ORDERS" && invoiceA.versions[0]!.reconciliationVersionId === null, "one DRAFT version built from club orders, with no reconciliation behind it");
    assert(invoiceA.versions[0]!.amountDueCents === 3600 + 450, "the draft total is the items plus the postage");
    const snapshot = invoiceA.versions[0]!.snapshot as unknown as { kind: string; lines: Array<{ registrationId: string; label: string; clubId: string; amountCents: number; chargesNotTiedToPerson: Array<{ label: string; amountCents: number }> }> };
    assert(snapshot.kind === "CLUB_ORDERS" && snapshot.lines.length === 1 && snapshot.lines[0]!.registrationId === first.id && snapshot.lines[0]!.clubId === ids.clubMain, "the invoice line is the filled order");
    const charges = snapshot.lines[0]!.chargesNotTiedToPerson;
    assert(charges.some((charge) => charge.label === "Postage" && charge.amountCents === 450), "postage is its own charge");
    assert(charges.some((charge) => charge.label.includes("20 at $1.25") && charge.amountCents === 2500) && charges.some((charge) => charge.label.includes("4 at $2.75") && charge.amountCents === 1100), "each item is a charge at its snapshot price");
    assert(await prisma.invoiceReceivable.count({ where: { invoiceId: invoiceA.id } }) === 0, "a draft has no receivable: nothing is finalized automatically");
    const fillAudit = await prisma.auditLog.findFirstOrThrow({ where: { action: "CONFERENCE_CLUB_ORDER_FILLED", entityId: first.id } });
    const fillMeta = JSON.stringify(fillAudit.metadata);
    assert(fillAudit.actorUserId === staff && fillMeta.includes('"postageCents":450') && fillMeta.includes(invoiceA.id) && !fillMeta.includes("Trailblazers") && !fillMeta.includes("Dana"), "the fill is audited with ids and amounts only");
    assert(await prisma.auditLog.count({ where: { action: "CONFERENCE_ORDERS_INVOICE_DRAFT_PREPARED", eventId: containerId } }) === 1, "preparing the church draft is audited");

    // A sibling club of the same church refreshes the same draft; another church gets its own invoice.
    const sibling = await repo.submitConferenceOrder(ids.clubSibling, { quantities: { [ids.conf2]: 3 } }, director, NOW);
    assert(sibling.itemsTotalCents === 825 && (await prisma.messageOutbox.count({ where: { idempotencyKey: { startsWith: `conference-club-order:${sibling.id}:` } } })) === 1, "a club with no director email on file still sends the order email, with no confirmation");
    const siblingFilled = await repo.fillConferenceOrder(sibling.id, { postage: "", addToStock: false }, staff, NOW);
    assert(siblingFilled.invoiceOutcome === "REFRESHED" && siblingFilled.invoiceId === invoiceA.id, "a second order of the same church refreshes the same draft");
    const refreshed = await prisma.invoiceVersion.findFirstOrThrow({ where: { invoiceId: invoiceA.id, status: "DRAFT" } });
    assert(refreshed.amountDueCents === 3600 + 450 + 825 && (refreshed.snapshot as unknown as { lines: unknown[] }).lines.length === 2, "the draft now has both orders and the right total");
    assert(await prisma.clubSupplyStock.count({ where: { organizationId: ids.clubSibling } }) === 0, "without asking, stock is not touched");
    const otherOrder = await repo.submitConferenceOrder(ids.clubOther, { quantities: { [ids.conf1]: 2 } }, director, NOW);
    const otherFilled = await repo.fillConferenceOrder(otherOrder.id, { postage: "1.25", addToStock: false }, staff, NOW);
    assert(otherFilled.invoiceOutcome === "CREATED" && otherFilled.invoiceId !== invoiceA.id, "another church gets its own invoice");
    assert(await prisma.invoice.count({ where: { eventId: containerId } }) === 2, "one invoice per church on the club year's billing event");

    // -------------------------------------------------------------- 6. the treasurer finalizes (a named human action)
    const draftA = refreshed;
    const withoutPermission = await failure(invoices.finalizeInvoiceVersion({ eventId: containerId, versionId: draftA.id, actorUserId: ids.treasurer, idempotencyKey: `${P}-no`, confirm: true, canFinalizeInvoices: false }));
    assert(codeOf(withoutPermission) === "FINALIZE_PERMISSION_REQUIRED", "finalizing needs the Finalize invoices permission");
    const noContact = await failure(invoices.finalizeInvoiceVersion({ eventId: containerId, versionId: (await prisma.invoiceVersion.findFirstOrThrow({ where: { invoice: { id: otherFilled.invoiceId! }, status: "DRAFT" } })).id, actorUserId: ids.treasurer, idempotencyKey: `${P}-nocontact`, confirm: true, canFinalizeInvoices: true }));
    assert(codeOf(noContact) === "CONTACT_MISSING", "a church with no billing contact cannot be finalized");
    const detail = await invoices.getInvoiceDetail(containerId, invoiceA.id);
    assert(detail && !detail.churchDraftStale && detail.currentContact?.email === `${P}.tina@contact.test`, "the invoice detail opens, is current, and carries the church's billing contact");
    const done = await invoices.finalizeInvoiceVersion({ eventId: containerId, versionId: draftA.id, actorUserId: ids.treasurer, idempotencyKey: `${P}-fin`, confirm: true, canFinalizeInvoices: true });
    assert(done.changed && done.number && done.amountDueCents === 3600 + 450 + 825, "the treasurer finalizes it with a number and the total");
    const statement = await ledger.getPartyStatement(containerId, ids.churchA);
    assert(statement && statement.invoices.length === 1 && statement.totals.invoicedCents === 4875, "the church's statement finds the invoice on the billing event");

    // A later fill starts a revision draft beside the finalized version.
    const late = await repo.submitConferenceOrder(ids.clubMain, { quantities: { [ids.conf1]: 1 } }, director, NOW);
    const lateFilled = await repo.fillConferenceOrder(late.id, { postage: "0.75", addToStock: false }, staff, NOW);
    assert(lateFilled.invoiceOutcome === "REVISION_STARTED" && lateFilled.invoiceId === invoiceA.id, "after finalization a later fill starts a revision draft");
    const versionsA = await prisma.invoiceVersion.findMany({ where: { invoiceId: invoiceA.id }, orderBy: { revision: "asc" } });
    assert(versionsA.length === 2 && versionsA[0]!.status === "FINALIZED" && versionsA[0]!.amountDueCents === 4875 && versionsA[1]!.status === "DRAFT" && versionsA[1]!.revision === 1 && versionsA[1]!.amountDueCents === 4875 + 125 + 75, "the finalized version is untouched and the revision draft has the new total");
    assert(await prisma.invoiceReceivable.count({ where: { invoiceId: invoiceA.id } }) === 1, "still one receivable: the revision is not finalized for anyone");

    // -------------------------------------------------------------- 7. staff cancel with a reason
    const toCancel = await repo.submitConferenceOrder(ids.clubMain, { quantities: { [ids.conf2]: 1 } }, director, NOW);
    assert(codeOf(await failure(repo.cancelConferenceOrderAsStaff(toCancel.id, "  ", staff))) === "REASON_REQUIRED", "a staff cancellation needs a reason");
    await repo.cancelConferenceOrderAsStaff(toCancel.id, "Duplicate of another order", staff, NOW);
    const staffCancelled = await prisma.conferenceClubOrder.findUniqueOrThrow({ where: { id: toCancel.id } });
    assert(staffCancelled.status === "CANCELLED" && staffCancelled.cancelledReason === "Duplicate of another order" && staffCancelled.cancelledByUserId === staff, "staff cancel with their reason");
    assert(codeOf(await failure(repo.cancelConferenceOrderAsStaff(first.id, "too late", staff, NOW))) === "ORDER_NOT_SUBMITTED", "a filled order is not cancelled here");
    const staffList = await repo.loadConferenceOrdersForStaff();
    assert(staffList.orders.some((row) => row.id === first.id && row.status === "FILLED" && row.churchName.includes("Hills Check")), "the staff list shows the order with its church");
    assert(staffList.bills.some((bill) => bill.invoiceId === invoiceA.id && bill.hasOpenRevision), "and the church bills, with the open revision");
    const clubView = await repo.loadClubConferenceOrders(ids.clubMain);
    assert(clubView.churchName?.includes("Hills Check") && clubView.orders.length >= 4 && clubView.items.some((item) => item.itemId === ids.conf2), "the club's own view shows its orders and the items to order");
    assert((await repo.loadClubConferenceOrders(ids.clubOrphan)).churchName === null, "a club with no church sees no billed church");

    // -------------------------------------------------------------- 8. conference items never reach AdventSource
    await prisma.clubOrderNeed.createMany({
      data: [
        { organizationId: ids.clubMain, sourceType: "HONOR", sourceId: `${ids.person}:${P}_need_adv`, personId: ids.person, itemId: ids.adv, sourceLabel: "Synthetic award" },
        { organizationId: ids.clubMain, sourceType: "HONOR", sourceId: `${ids.person}:${P}_need_conf`, personId: ids.person, itemId: ids.conf1, sourceLabel: "Synthetic camporee patch" },
      ],
    });
    const list = await clubOrders.listOrderList(ids.clubMain);
    assert(list.lines.length === 1 && list.lines[0]!.item.itemId === ids.adv, "the AdventSource order list holds only the AdventSource item");
    const helper = await clubOrders.listHelperLines(ids.clubMain);
    assert(helper.every((line) => line.itemId !== ids.conf1) && helper.some((line) => line.itemId === ids.adv), "the helper list leaves the conference item out");
    assert(!clubOrdersDomain.adventSourceOrderCsv(list.lines).includes("Check Shoulder") && clubOrdersDomain.adventSourceOrderCsv(list.lines).includes("009901"), "the AdventSource quick-order file has no conference item");
    assert(!clubOrdersDomain.orderEverythingCsv(helper).includes(`Check Shoulder Patch ${P}`), "the helper list export has no conference item");
    assert(codeOf(await failure(clubOrders.setOrderListQuantity(ids.clubMain, ids.conf1, 5, director))) === "ITEM_NOT_ORDERABLE", "a conference item cannot be put on the AdventSource helper list");
    const batch = await clubOrders.createOrderBatch(ids.clubMain, {}, director);
    assert(batch.lines.length === 1 && batch.lines[0]!.item.itemId === ids.adv, "placing the AdventSource order includes only the AdventSource item");
    assert((await prisma.clubOrderNeed.findFirstOrThrow({ where: { sourceId: `${ids.person}:${P}_need_conf` } })).status === "NEEDED", "and leaves the conference item's need alone");

    // -------------------------------------------------------------- 9. the billing event is hidden
    const pickable = await eventsRepo.listEventsForUser(ids.staff, true);
    assert(!pickable.some((event) => event.id === containerId), "the billing event is in no event picker");
    const withArchived = await eventsRepo.listEventsForUser(ids.staff, true, { archived: "include" });
    assert(withArchived.find((event) => event.id === containerId)?.isBillingContainer === true, "it opens only by an explicit link, and says what it is");
    const archivedList = await archive.listArchivedEventsForUser(ids.staff, true);
    assert(!archivedList.some((event) => event.id === containerId), "it is not in the Archived events list");
    const unarchive = await failure(archive.unarchiveEvent({ eventId: containerId, actor: { globalRole: "SYSTEM_ADMIN", eventRole: null, userId: ids.staff } }));
    assert(unarchive instanceof Error && unarchive.name === "EventArchiveForbiddenError", "it cannot be unarchived");
    const view = await invoices.getInvoicesView(containerId);
    assert(view.isDeferred === false, "it is not a deferred-invoice event, so no reconciliation screen takes it over");
    const pdfReady = await prisma.invoiceVersion.findFirstOrThrow({ where: { id: done.versionId } });
    assert(pdfReady.number === done.number, "the finalized version keeps its number");

    console.log("Conference club orders: all checks passed.");
  } finally {
    await prisma.platformSettings.updateMany({ where: { id: "platform" }, data: { conferenceOrdersEmail: settingsBefore?.conferenceOrdersEmail ?? null } });
    await cleanup().catch((error) => console.error("cleanup failed", error));
  }
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    await prisma.$disconnect();
    process.exit(1);
  });
