/**
 * Real-database check of merchandise on an individual public registration (#146): a catalog that is off or not approved
 * offers nothing, an approved one is offered with sold-out sizes marked and no stock counts, merchandise becomes its own
 * PENDING order linked to the registration (no fee, no tax, not in the registration total), a replayed submission
 * returns the same order, a sold-out size refuses the whole submission, a waitlisted registration orders nothing, two
 * registrations racing for the last tracked item leave exactly one order, and the staff list is scoped to its event.
 * Synthetic data only.
 */
import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import { PrismaClient, RegistrationFormStatus } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";
import { fillBlankSyntheticEnv } from "./support/synthetic-env";
import { futureEventWindow } from "./support/fixture-dates";
import { registrationFormDefinitionSchema } from "@/modules/forms/definition";
import { getPublicRegistrationExperience, PublicRegistrationError, submitPublicRegistration } from "@/modules/forms/public-repository";
import type { PublicRegistrationInput } from "@/modules/forms/public-domain";
import { listMerchandiseOrders } from "@/modules/merchandise/order-list";

loadEnvConfig(process.cwd());
assertLocalDatabase(process.env, "run this verification");
fillBlankSyntheticEnv("SECRET_ENCRYPTION_KEY", "verify-registration-merchandise-synthetic-key-not-a-secret");

const prisma = new PrismaClient();
const P = `merch146_${randomUUID().slice(0, 8)}`;
const userId = `${P}_user`;
const surname = `Merch${P}`;
const formSlug = `${P}-form`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}
async function caught(promise: Promise<unknown>) {
  return promise.then(() => null, (error: unknown) => error);
}

const definition = registrationFormDefinitionSchema.parse({
  title: "Merchandise verification", description: "Synthetic.", confirmationMessage: "Received.",
  sections: [{ id: "contact", title: "Contact", description: "", fields: [
    { id: "f_first", key: "first_name", label: "First name", helpText: "", type: "TEXT", scope: "REGISTRATION", required: true, options: [] },
    { id: "f_last", key: "last_name", label: "Last name", helpText: "", type: "TEXT", scope: "REGISTRATION", required: true, options: [] },
    { id: "f_email", key: "email", label: "Email", helpText: "", type: "EMAIL", scope: "REGISTRATION", required: true, options: [] },
    { id: "f_type", key: "registration_type", label: "Registration type", helpText: "", type: "SELECT", scope: "REGISTRATION", required: true, options: ["Adult", "Youth"], choicePricesCents: { Adult: 10000, Youth: 5000 } },
  ] }],
});

type Fixture = { eventId: string; slug: string; versionId: string; variants: { medium: string; large: string; cap: string } };

async function makeEvent(name: string, options: { capacity?: number; waitlist?: boolean; catalog?: "APPROVED" | "DRAFT" | "NONE" } = {}): Promise<Fixture> {
  const eventId = `${P}_${name}`;
  const slug = `${eventId}-slug`;
  await prisma.event.create({ data: { id: eventId, slug, name: `Merch ${name}`, ...futureEventWindow(), timezone: "America/Chicago", location: "Synthetic venue", capacity: options.capacity ?? 100, waitlistEnabled: options.waitlist ?? false, isPublished: true } });
  const versionId = `${eventId}_v1`;
  await prisma.registrationForm.create({ data: { id: `${eventId}_form`, eventId, createdByUserId: userId, name: definition.title, slug: formSlug, status: RegistrationFormStatus.PUBLISHED,
    versions: { create: { id: versionId, createdByUserId: userId, versionNumber: 1, status: RegistrationFormStatus.PUBLISHED, publishedAt: new Date(), definition } } } });
  const variants = { medium: `${eventId}_vm`, large: `${eventId}_vl`, cap: `${eventId}_vc` };
  const catalogStatus = options.catalog ?? "APPROVED";
  if (catalogStatus !== "NONE") {
    // A human approves a catalog; this script writes the status directly the way a human would.
    await prisma.merchandiseCatalog.create({ data: { eventId, isEnabled: true, status: catalogStatus } });
    const avail = (priceCents: number, tracked: number | null) => ({ create: { versionNumber: 1, priceCents, taxTreatment: "TAXABLE" as const, feePolicy: "PASSED_TO_BUYER" as const, inventoryPolicy: tracked === null ? "UNLIMITED" as const : "TRACKED" as const, inventoryQuantity: tracked, createdByUserId: userId, maxQuantity: 5 } });
    await prisma.merchandiseProduct.create({ data: { id: `${eventId}_p1`, eventId, name: "Camp Shirt", description: "Synthetic shirt", position: 0, variants: { create: [
      { id: variants.medium, label: "Medium", position: 0, availability: avail(2500, 1) },
      { id: variants.large, label: "Large", position: 1, availability: avail(3000, null) },
    ] } } });
    await prisma.merchandiseProduct.create({ data: { id: `${eventId}_p2`, eventId, name: "Camp Mug", position: 1, variants: { create: [
      { id: variants.cap, label: "One size", position: 0, availability: avail(1000, 1) },
    ] } } });
  }
  return { eventId, slug, versionId, variants };
}

const emailFor = (tag: string) => `${P}.${tag}@example.test`;
function input(fixture: Fixture, tag: string, merchandise?: Array<{ variantId: string; quantity: number; shownUnitPriceCents?: number }>, idempotencyKey = randomUUID()): PublicRegistrationInput {
  return { versionId: fixture.versionId, idempotencyKey, responses: { first_name: tag, last_name: surname, email: emailFor(tag), registration_type: "Adult" }, website: "", ...(merchandise ? { merchandise } : {}) } as PublicRegistrationInput;
}

async function cleanup() {
  const registrationIds = (await prisma.registration.findMany({ where: { eventId: { startsWith: `${P}_` } }, select: { id: true } })).map((row) => row.id);
  await prisma.messageOutbox.deleteMany({ where: { registrationId: { in: registrationIds } } });
  await prisma.event.deleteMany({ where: { id: { startsWith: `${P}_` } } });
  await prisma.person.deleteMany({ where: { lastName: surname } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: userId }, { eventId: { startsWith: `${P}_` } }] } });
  await prisma.user.deleteMany({ where: { id: userId } });
}

async function main() {
  await cleanup();
  await prisma.user.create({ data: { id: userId, email: `${P}.actor@example.test`, displayName: "Merch Verification Actor" } });

  // Off by default: no catalog, and a catalog that is not approved, offer nothing.
  const none = await makeEvent("none", { catalog: "NONE" });
  assert((await getPublicRegistrationExperience(none.slug, formSlug))?.merchandise === null, "an event with no catalog offers no merchandise");
  const draft = await makeEvent("draft", { catalog: "DRAFT" });
  assert((await getPublicRegistrationExperience(draft.slug, formSlug))?.merchandise === null, "a draft catalog offers no merchandise");
  const refusedDraft = await caught(submitPublicRegistration(draft.slug, formSlug, input(draft, "draft", [{ variantId: draft.variants.large, quantity: 1 }])));
  assert(refusedDraft instanceof PublicRegistrationError && refusedDraft.issues[0]?.key === "merchandise", "merchandise from a draft catalog is refused");
  assert(await prisma.registration.count({ where: { eventId: draft.eventId } }) === 0, "a refused merchandise order leaves no registration");

  // An approved catalog is offered, with no stock counts.
  const main = await makeEvent("main");
  const offer = (await getPublicRegistrationExperience(main.slug, formSlug))?.merchandise;
  assert(offer && offer.products.length === 2, "an approved catalog is offered");
  assert(!JSON.stringify(offer).toLowerCase().includes("inventory"), "the offer carries no stock counts");

  // A registration without merchandise is unchanged and has no order.
  const plain = await submitPublicRegistration(main.slug, formSlug, input(main, "plain"));
  assert(plain.totalCents === 10000 && !plain.merchandise, "a plain registration has no merchandise");
  assert(await prisma.merchandiseOrder.count({ where: { eventId: main.eventId } }) === 0, "a plain registration makes no order");

  // With merchandise: a separate pending order, not part of the registration total.
  const key = randomUUID();
  const lines = [{ variantId: main.variants.medium, quantity: 1 }, { variantId: main.variants.large, quantity: 2 }];
  const withMerch = await submitPublicRegistration(main.slug, formSlug, input(main, "buyer", lines, key));
  assert(withMerch.totalCents === 10000, "the registration total is unchanged by merchandise");
  assert(withMerch.merchandise?.totalCents === 8500 && withMerch.merchandise.lines.length === 2, "the confirmation shows the merchandise order");
  const registration = await prisma.registration.findFirstOrThrow({ where: { eventId: main.eventId, confirmationCode: withMerch.confirmationCode } });
  assert(Number(registration.totalAmount) === 100, "the stored registration total is unchanged by merchandise");
  const order = await prisma.merchandiseOrder.findFirstOrThrow({ where: { registrationId: registration.id }, include: { lines: true } });
  assert(order.status === "PENDING" && order.paymentMethod === null, "the order is pending and unpaid");
  assert(order.clientRequestId === `registration:${registration.id}`, "the order carries the registration request id");
  assert(order.subtotalCents === 8500 && order.feeCents === 0 && order.taxCents === 0 && order.totalCents === 8500, "the order has no fee and no tax");
  assert(order.lines.length === 2 && order.lines.every((line) => line.eventId === main.eventId && line.availabilityId), "the order lines are snapshots of persisted terms");
  assert(JSON.stringify(order.purchaserSnapshot).includes(withMerch.confirmationCode), "the purchaser snapshot carries the confirmation code");

  // A replay returns the same order and makes no second one.
  const replay = await submitPublicRegistration(main.slug, formSlug, input(main, "buyer", lines, key));
  assert(replay.confirmationCode === withMerch.confirmationCode && replay.merchandise?.totalCents === 8500, "a replay shows the same merchandise order");
  assert(await prisma.merchandiseOrder.count({ where: { registrationId: registration.id } }) === 1, "a replay makes no second order");
  assert(await caught(submitPublicRegistration(main.slug, formSlug, input(main, "buyer", [{ variantId: main.variants.large, quantity: 1 }], key))) instanceof PublicRegistrationError, "the same key with different merchandise is a conflict");

  // The last medium shirt is gone: marked sold out, and a new order for it is refused whole.
  const after = (await getPublicRegistrationExperience(main.slug, formSlug))?.merchandise;
  assert(after?.products[0]?.variants.find((v) => v.label === "Medium")?.soldOut === true, "a sold-out size is marked");
  const soldOut = await caught(submitPublicRegistration(main.slug, formSlug, input(main, "toolate", [{ variantId: main.variants.medium, quantity: 1 }])));
  assert(soldOut instanceof PublicRegistrationError && soldOut.code === "INVALID_SUBMISSION" && soldOut.issues[0]?.key === "merchandise" && soldOut.message.includes("sold out"), "a sold-out size is refused plainly");
  assert(await prisma.registration.count({ where: { eventId: main.eventId, accountHolderPerson: { normalizedEmail: emailFor("toolate") } } }) === 0, "a refused submission leaves no registration");
  const unknown = await caught(submitPublicRegistration(main.slug, formSlug, input(main, "unknown", [{ variantId: "not-a-variant", quantity: 1 }])));
  assert(unknown instanceof PublicRegistrationError && unknown.issues[0]?.key === "merchandise", "an unknown variant is refused");

  // Two registrations racing for the last tracked mug: exactly one order.
  const race = await Promise.all(["racer1", "racer2"].map((tag) => caught(submitPublicRegistration(main.slug, formSlug, input(main, tag, [{ variantId: main.variants.cap, quantity: 1 }])))));
  assert(race.filter((result) => result === null).length === 1 && race.filter((result) => result instanceof PublicRegistrationError).length === 1, `exactly one racer wins the last mug (${race.map((r) => (r ? String((r as Error).message) : "ok")).join(" | ")})`);
  assert(await prisma.merchandiseOrderLine.count({ where: { variantId: main.variants.cap } }) === 1, "one order line exists for the last mug");

  // A cancelled order frees its stock.
  await prisma.merchandiseOrder.updateMany({ where: { registrationId: registration.id }, data: { status: "CANCELLED" } });
  assert((await getPublicRegistrationExperience(main.slug, formSlug))?.merchandise?.products[0]?.variants.find((v) => v.label === "Medium")?.soldOut === false, "a cancelled order frees its stock");

  // A cancelled registration's pending order no longer holds stock, but stays on the staff list, marked and not counted.
  await prisma.merchandiseOrder.updateMany({ where: { registrationId: registration.id }, data: { status: "PENDING" } });
  assert((await getPublicRegistrationExperience(main.slug, formSlug))?.merchandise?.products[0]?.variants.find((v) => v.label === "Medium")?.soldOut === true, "a pending order holds the last medium again");
  await prisma.registration.update({ where: { id: registration.id }, data: { status: "CANCELLED" } });
  assert((await getPublicRegistrationExperience(main.slug, formSlug))?.merchandise?.products[0]?.variants.find((v) => v.label === "Medium")?.soldOut === false, "a cancelled registration releases its order's stock");
  const cancelledList = await listMerchandiseOrders(main.eventId);
  assert(cancelledList.orders.some((o) => o.id === order.id && !o.registrationActive), "the order stays listed, marked as having a cancelled registration");
  assert(!cancelledList.totals.some((row) => row.variantLabel === "Large" && row.quantity >= 2), "its units are left out of the totals");
  const stale = await caught(submitPublicRegistration(main.slug, formSlug, input(main, "stale", [{ variantId: main.variants.large, quantity: 1, shownUnitPriceCents: 100 }])));
  assert(stale instanceof PublicRegistrationError && stale.message.includes("price of Camp Shirt Large changed to $30.00") && stale.issues[0]?.merchandise?.currentUnitPriceCents === 3000 && stale.issues[0].merchandise.variantId === main.variants.large, "a stale shown price is refused");
  assert((await caught(submitPublicRegistration(main.slug, formSlug, input(main, "toomany", [{ variantId: main.variants.large, quantity: 6 }])))) instanceof PublicRegistrationError, "a quantity over the maximum is refused");

  // A waitlisted registration orders nothing, and says so.
  const waitEvent = await makeEvent("wait", { capacity: 1, waitlist: true });
  await submitPublicRegistration(waitEvent.slug, formSlug, input(waitEvent, "first"));
  const waitlisted = await submitPublicRegistration(waitEvent.slug, formSlug, input(waitEvent, "second", [{ variantId: waitEvent.variants.large, quantity: 1 }]));
  assert(waitlisted.registrationStatus === "WAITLISTED" && !waitlisted.merchandise && waitlisted.message.includes("merchandise was not ordered"), "a waitlisted registration orders no merchandise and says so");
  assert(await prisma.merchandiseOrder.count({ where: { eventId: waitEvent.eventId } }) === 0, "a waitlisted registration makes no order");

  // The staff list is scoped to its event.
  const list = await listMerchandiseOrders(main.eventId);
  assert(list.orders.length === 2 && list.orders.every((o) => o.confirmationCode), "the staff list shows this event's orders");
  assert(list.totals.every((row) => row.variantLabel !== "Medium"), "a cancelled registration's order is left out of the totals");
  assert((await listMerchandiseOrders(waitEvent.eventId)).orders.length === 0, "another event's list is separate");

  console.log("Registration merchandise verification passed.");
}

main()
  .finally(cleanup)
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
