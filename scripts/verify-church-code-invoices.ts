/**
 * Proves church promo code invoices (#399) against a real PostgreSQL database, where the unit tests' in-memory
 * stand-ins can't. Owner decision (Caleb, Oct 14, 2026): a church is invoiced for what its code covered, through the
 * organization invoicing of #165-#168; the office finalizes and sends, and finalizing stays a named human action.
 *
 * - staff PREPARE a draft from a church's redemptions: the draft is the sum of the billed lines in whole cents (a
 *   whole-registration code and a per-person adjustment each counted once; cancelled, waitlisted and another church's
 *   lines left out); nothing billable means no draft; an unsponsored code, an event the church is not billed on, an
 *   organization that sponsors no code and an unknown organization are refused;
 * - preparing is idempotent and race-safe: repeating it changes and writes nothing, four at once make one invoice and one
 *   draft, a change to the redemptions or the contact refreshes the SAME draft, and a draft never gets a number, a
 *   receivable, a delivery or an outbox message (automation prepares, a human finalizes);
 * - finalizing needs the Finalize invoices permission, refuses a draft that no longer matches the redemptions or a church
 *   with no billing contact, assigns the number exactly once (a retry returns the same number), and creates one receivable;
 * - after finalization a change to the redemptions starts a REVISION draft beside the finalized version, which stays as
 *   it was until the revision is finalized (-R1, the earlier version SUPERSEDED);
 * - the church report agrees with the ledger: who used the code, covered, invoiced, paid and owed, in cents, through a
 *   partial payment and a change after invoicing, and an invoice of another event is never reached;
 * - the staff report shows the registrant's name as stored (#960), while the PDF text, the snapshot, the send preview
 *   and the audit rows carry no name;
 * - the PDF and the send preview work for it (to the church's own billing contact; nothing is sent), the invoice
 *   detail is reachable, the deferred-event invoice screens leave church promo code invoices out;
 * - the audit rows hold ids, counts and amounts only: no name, no email, no code.
 *
 * Uses fictitious rows it creates and removes itself.
 *
 *   npm run test:church-code-invoices
 */
import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { assertLocalDatabase } from "./support/local-only-guard";
import { fillBlankSyntheticEnv } from "./support/synthetic-env";
import { setOrganizationBillingContact } from "@/modules/billing-responsibility/repository";
import { ensureInvoiceDocument, getInvoiceSendPreview } from "@/modules/invoices/delivery-repository";
import { loadEventLedger, recordInvoicePayment } from "@/modules/invoices/ledger-repository";
import { InvoiceError, discardInvoiceDraft, finalizeInvoiceVersion, getInvoiceDetail, getInvoicesView } from "@/modules/invoices/repository";
import { churchPromoGroupKey } from "@/modules/promo-codes/church-invoice";
import { getChurchCodeReport, prepareChurchCodeInvoiceDraft } from "@/modules/promo-codes/church-invoice-repository";
import { listChurchSponsoredPromoLines } from "@/modules/promo-codes/church-sponsored-repository";
import { claimPromoCode, createPromoCode, recordPromoCodeRedemption } from "@/modules/promo-codes/repository";

loadEnvConfig(process.cwd());
// Local-only, before any Prisma client or connection exists.
assertLocalDatabase(process.env, "run this verification");
fillBlankSyntheticEnv("SECRET_ENCRYPTION_KEY", "verify-church-code-invoices-synthetic-key-not-a-secret");

const prisma = new PrismaClient();
const P = `cci_${randomUUID().slice(0, 8)}`;
const letters = (seed: string, count: number) => [...seed.replace(/[^0-9a-f]/g, "").padEnd(count, "0")].slice(0, count).map((char) => String.fromCharCode(65 + parseInt(char, 16))).join("");
const INVOICE_CODE = letters(randomUUID().replace(/-/g, "").slice(0, 6), 4);
const ids = {
  staff: `${P}_staff`,
  treasurer: `${P}_treasurer`,
  holder: `${P}_holder`,
  churchA: `${P}_church_a`,
  churchB: `${P}_church_b`,
  churchC: `${P}_church_c`,
  churchNoCode: `${P}_church_nocode`,
  general: `${P}_ev_general`,
  other: `${P}_ev_other`,
  club: `${P}_ev_club`,
};
/** The registrant's stored name (synthetic, and distinctive so a leak is found): on the staff report, nowhere on the church invoice. */
const REGISTRANT = { first: "Quillon", last: "Fernsby" };
const events = [ids.general, ids.other, ids.club];
const EMAIL = { tina: `${P}.tina@contact.test`, sam: `${P}.sam@contact.test` };
const NAMES = { churchA: `Church Code Check A ${P}`, churchB: `Church Code Check B ${P}`, churchC: `Church Code Check C ${P}` };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}
const failure = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => error);
const code = (error: unknown) => (error instanceof InvoiceError ? error.code : error instanceof Error ? `other:${error.message.slice(0, 120)}` : "none");
const key = (label: string) => `${label}-${P}-${randomUUID()}`;

async function cleanup() {
  const registrationIds = (await prisma.registration.findMany({ where: { eventId: { in: events } }, select: { id: true } })).map((row) => row.id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ eventId: { in: events } }, { actorUserId: { in: [ids.staff, ids.treasurer] } }, { entityId: { in: registrationIds } }] } });
  await prisma.messageOutbox.deleteMany({ where: { eventId: { in: events } } });
  await prisma.event.deleteMany({ where: { id: { in: events } } });
  await prisma.registration.deleteMany({ where: { id: { in: registrationIds } } });
  // A contact is never deleted by the application; this local cleanup turns the guard off for one transaction.
  await prisma.$transaction([
    prisma.$executeRawUnsafe('ALTER TABLE "OrganizationBillingContact" DISABLE TRIGGER "OrganizationBillingContact_no_delete"'),
    prisma.organizationBillingContact.deleteMany({ where: { organizationId: { in: [ids.churchA, ids.churchB, ids.churchC, ids.churchNoCode] } } }),
    prisma.$executeRawUnsafe('ALTER TABLE "OrganizationBillingContact" ENABLE TRIGGER "OrganizationBillingContact_no_delete"'),
  ]);
  await prisma.organization.deleteMany({ where: { id: { in: [ids.churchA, ids.churchB, ids.churchC, ids.churchNoCode] } } });
  await prisma.person.deleteMany({ where: { id: ids.holder } });
  await prisma.user.deleteMany({ where: { id: { in: [ids.staff, ids.treasurer] } } });
}

const baseInput = {
  isActive: true,
  discountType: "FIXED_CENTS" as const,
  discountValue: 2_500,
  startsOn: null,
  endsOn: null,
  minimumSubtotalCents: null,
  maximumUses: null,
  maximumDiscountCents: null,
};

let counter = 0;
/** The same claim and record the public registration does, in a serializable transaction that retries like the app. */
async function redeem(eventId: string, promo: string, status: "SUBMITTED" | "CONFIRMED" | "WAITLISTED" | "DRAFT" = "CONFIRMED", discountCents = 2_500) {
  counter += 1;
  const number = counter;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const claimed = await claimPromoCode(tx, { eventId, submittedCode: promo, eligibleSubtotalCents: Math.max(discountCents, 10_000), pricingDate: "2027-01-01", fieldId: "promo_field" });
        const registration = await tx.registration.create({
          data: { eventId, accountHolderPersonId: ids.holder, confirmationCode: `${P.toUpperCase()}-${number}`, status, totalAmount: 75 },
        });
        await recordPromoCodeRedemption(tx, { eventId, registrationId: registration.id, claimed });
        return registration;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const retryable = (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" || error.code === "P2002"))
        || (typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "PROMO_CODE_CLAIM_CONFLICT");
      if (!retryable || attempt === 7) throw error;
    }
  }
  throw new Error("unreachable");
}

/** Every shown string in the PDF's content streams (pdf-lib writes them as hex or literal strings). */
async function extractPdfText(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const texts: string[] = [];
  for (const page of doc.getPages()) {
    const contents = page.node.Contents();
    const array = page.node.get(PDFName.of("Contents"));
    const resolved = array ? doc.context.lookup(array) : undefined;
    const refs = resolved && "asArray" in resolved ? (resolved as unknown as { asArray(): unknown[] }).asArray().map((entry) => doc.context.lookup(entry as never)) : [];
    for (const stream of [...(contents ? [contents] : []), ...refs]) {
      if (!(stream instanceof PDFRawStream)) continue;
      const decoded = Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
      for (const match of decoded.matchAll(/<([0-9A-Fa-f]+)>\s*Tj|\(((?:\\.|[^\\)])*)\)\s*Tj/g)) {
        texts.push(match[1] ? Buffer.from(match[1], "hex").toString("latin1") : match[2]!);
      }
    }
  }
  return texts.join("\n");
}

const prepare = (churchId: string, eventId = ids.general) => prepareChurchCodeInvoiceDraft({ eventId, churchId, actorUserId: ids.staff });
const finalize = (versionId: string, options: { canFinalize?: boolean; idempotencyKey?: string; eventId?: string } = {}) =>
  finalizeInvoiceVersion({
    eventId: options.eventId ?? ids.general,
    versionId,
    actorUserId: ids.treasurer,
    idempotencyKey: options.idempotencyKey ?? key("fin"),
    confirm: true,
    canFinalizeInvoices: options.canFinalize ?? true,
  });

const countsOf = async (eventId: string) => ({
  invoices: await prisma.invoice.count({ where: { eventId } }),
  versions: await prisma.invoiceVersion.count({ where: { eventId } }),
  receivables: await prisma.invoiceReceivable.count({ where: { eventId } }),
  deliveries: await prisma.invoiceDelivery.count({ where: { eventId } }),
  outbox: await prisma.messageOutbox.count({ where: { eventId } }),
  audits: await prisma.auditLog.count({ where: { eventId, action: "CHURCH_CODE_INVOICE_DRAFT_PREPARED" } }),
});

async function main() {
  await cleanup();
  await prisma.user.createMany({
    data: [
      { id: ids.staff, email: `${P}.staff@example.test`, displayName: "Code Check Staff" },
      { id: ids.treasurer, email: `${P}.treasurer@example.test`, displayName: "Code Check Treasurer" },
    ],
  });
  await prisma.person.create({ data: { id: ids.holder, firstName: REGISTRANT.first, lastName: REGISTRANT.last } });
  await prisma.organization.createMany({
    data: [
      { id: ids.churchA, type: "CHURCH", name: NAMES.churchA, normalizedName: NAMES.churchA.toLowerCase() },
      { id: ids.churchB, type: "CHURCH", name: NAMES.churchB, normalizedName: NAMES.churchB.toLowerCase() },
      { id: ids.churchC, type: "CHURCH", name: NAMES.churchC, normalizedName: NAMES.churchC.toLowerCase() },
      { id: ids.churchNoCode, type: "CHURCH", name: `Church Code Check None ${P}`, normalizedName: `church code check none ${P}` },
    ],
  });
  const day = 86_400_000;
  const startsAt = new Date("2027-04-10T15:00:00Z");
  const mkEvent = (id: string, audience: "CLUB" | "GENERAL", billingMode: "ATTENDEE_PAY" | "DEFERRED_ORGANIZATION_INVOICE", invoiceCode: string | null) =>
    prisma.event.create({
      data: { id, slug: `${P}-${id.slice(-5)}`, name: `Church Code Check ${id.slice(-5)}`, startsAt, endsAt: new Date(startsAt.getTime() + 2 * day), isPublished: true, audience, billingMode, invoiceCode },
    });
  await mkEvent(ids.general, "GENERAL", "ATTENDEE_PAY", INVOICE_CODE);
  await mkEvent(ids.other, "GENERAL", "ATTENDEE_PAY", null);
  await mkEvent(ids.club, "CLUB", "DEFERRED_ORGANIZATION_INVOICE", null);
  // Church A has a verified-looking contact (added by the same function staff use); church B has none; church C one that will change.
  await setOrganizationBillingContact({ organizationId: ids.churchA, contact: { name: "Tina Treasurer", email: EMAIL.tina, phone: null, roleLabel: "Treasurer" }, actor: { id: ids.staff, globalRole: "SYSTEM_ADMIN" } });
  await setOrganizationBillingContact({ organizationId: ids.churchC, contact: { name: "Sam Clerk", email: EMAIL.sam, phone: null, roleLabel: "Clerk" }, actor: { id: ids.staff, globalRole: "SYSTEM_ADMIN" } });
  await createPromoCode(ids.general, { ...baseInput, code: "CHURCHA", sponsoringOrganizationId: ids.churchA }, ids.staff);
  await createPromoCode(ids.general, { ...baseInput, code: "CHURCHB", sponsoringOrganizationId: ids.churchB }, ids.staff);
  await createPromoCode(ids.general, { ...baseInput, code: "CHURCHC", sponsoringOrganizationId: ids.churchC }, ids.staff);
  await createPromoCode(ids.general, { ...baseInput, code: "PLAINCODE" }, ids.staff);
  await createPromoCode(ids.other, { ...baseInput, code: "OTHERA", sponsoringOrganizationId: ids.churchA }, ids.staff);

  // ---- Nothing billable: no draft, and nothing is created.
  let before = await countsOf(ids.general);
  assert(code(await failure(prepare(ids.churchA))) === "NOTHING_TO_INVOICE", "no redemption: nothing to invoice");
  assert(JSON.stringify(await countsOf(ids.general)) === JSON.stringify(before), "a refused draft leaves nothing behind");
  assert(code(await failure(prepare(ids.churchNoCode))) === "NOT_A_SPONSOR", "an organization that sponsors no code here is refused");
  assert(code(await failure(prepare(`${P}_missing`))) === "PARTY_NOT_FOUND", "an unknown organization is refused");
  assert(code(await failure(prepare(ids.churchA, `${P}_missing_event`))) === "PARTY_NOT_FOUND", "an unknown event is refused");
  assert(code(await failure(prepare(ids.churchA, ids.club))) === "CHURCH_CODE_NOT_ELIGIBLE", "a club event bills no church promo code");

  // ---- The draft is the church's billed lines, in cents.
  await redeem(ids.general, "CHURCHA", "CONFIRMED");
  await redeem(ids.general, "CHURCHA", "SUBMITTED");
  await redeem(ids.general, "CHURCHA", "WAITLISTED");
  await redeem(ids.general, "CHURCHA", "DRAFT");
  await redeem(ids.general, "CHURCHB", "CONFIRMED");
  await redeem(ids.general, "PLAINCODE", "CONFIRMED");
  // A per-person (adjustment) line on its own registration, counted once, at its own amount.
  const personReg = await redeem(ids.general, "PLAINCODE", "CONFIRMED");
  const churchACode = await prisma.promoCode.findFirstOrThrow({ where: { eventId: ids.general, normalizedCode: "CHURCHA" } });
  await prisma.registrationAdjustment.create({
    data: { eventId: ids.general, registrationId: personReg.id, kind: "PROMO_CODE", amountCents: -1_234, reason: "Synthetic per-person line.", promoCodeId: churchACode.id, promoCodeSnapshot: "CHURCHA", createdByNameSnapshot: "Check" },
  });
  const lines = (await listChurchSponsoredPromoLines(ids.general)).filter((line) => line.churchId === ids.churchA);
  assert(lines.length === 3 && lines.reduce((total, line) => total + line.amountCents, 0) === 2_500 + 2_500 + 1_234, "the church has three billed lines");

  before = await countsOf(ids.general);
  const created = await prepare(ids.churchA);
  assert(created.outcome === "CREATED" && created.amountDueCents === 6_234 && created.lineCount === 3 && created.revision === 0, "the first draft is the sum of the billed lines");
  const draft = await prisma.invoiceVersion.findUniqueOrThrow({ where: { id: created.versionId }, include: { invoice: true } });
  assert(draft.status === "DRAFT" && draft.basis === "CHURCH_PROMO_CODES" && draft.reconciliationVersionId === null, "a draft on the church promo code basis, with no reconciliation");
  assert(draft.number === null && draft.invoice.baseNumber === null && draft.finalizedAt === null && draft.finalizedByUserId === null, "a prepared draft has no number and is not finalized");
  assert(draft.invoice.groupKey === churchPromoGroupKey(ids.churchA) && draft.invoice.partyKind === "ORGANIZATION" && draft.invoice.partyId === ids.churchA && draft.invoice.invoiceGrouping === "PER_CHURCH", "the invoice belongs to the church");
  assert(draft.amountDueCents === 6_234 && draft.contactName === "Tina Treasurer" && draft.contactEmail === EMAIL.tina, "the draft carries the amount and the church's billing contact");
  const after = await countsOf(ids.general);
  assert(after.invoices === before.invoices + 1 && after.versions === before.versions + 1 && after.audits === before.audits + 1, "one invoice, one version, one audit");
  assert(after.receivables === 0 && after.deliveries === 0 && after.outbox === 0, "no receivable, no delivery and no email from preparing a draft");

  // ---- Idempotent and race-safe.
  const again = await prepare(ids.churchA);
  assert(again.outcome === "UNCHANGED" && again.versionId === created.versionId && again.amountDueCents === 6_234, "repeating changes nothing");
  assert(JSON.stringify(await countsOf(ids.general)) === JSON.stringify(after), "repeating writes nothing, not even an audit row");
  const raced = await Promise.all([1, 2, 3, 4].map(() => prepare(ids.churchB)));
  const racedVersions = new Set(raced.map((result) => result.versionId));
  assert(racedVersions.size === 1 && raced.filter((result) => result.outcome === "CREATED").length === 1, "four at once make exactly one draft");
  assert(await prisma.invoice.count({ where: { eventId: ids.general, groupKey: churchPromoGroupKey(ids.churchB) } }) === 1, "one invoice for the church");
  assert(await prisma.invoiceVersion.count({ where: { eventId: ids.general, invoice: { groupKey: churchPromoGroupKey(ids.churchB) } } }) === 1, "one version for the church");

  // ---- A change refreshes the same draft; a cancelled registration drops out.
  const a3 = await redeem(ids.general, "CHURCHA", "CONFIRMED");
  const refreshed = await prepare(ids.churchA);
  assert(refreshed.outcome === "REFRESHED" && refreshed.versionId === created.versionId && refreshed.amountDueCents === 8_734, "a new use refreshes the same draft");
  assert((await prisma.invoiceVersion.findUniqueOrThrow({ where: { id: created.versionId } })).regenerationCount === 1, "the refresh is counted");
  await prisma.registration.update({ where: { id: a3.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
  const shrunk = await prepare(ids.churchA);
  assert(shrunk.outcome === "REFRESHED" && shrunk.amountDueCents === 6_234 && shrunk.lineCount === 3, "a cancelled registration drops out of the draft");

  // ---- Church C: the contact changing refreshes the draft too.
  await redeem(ids.general, "CHURCHC", "CONFIRMED");
  const cDraft = await prepare(ids.churchC);
  assert(cDraft.outcome === "CREATED" && cDraft.amountDueCents === 2_500, "church C draft");
  await setOrganizationBillingContact({ organizationId: ids.churchC, contact: { name: "Sue Secretary", email: `${P}.sue@contact.test`, phone: null, roleLabel: "Secretary" }, actor: { id: ids.staff, globalRole: "SYSTEM_ADMIN" } });
  const cRefreshed = await prepare(ids.churchC);
  assert(cRefreshed.outcome === "REFRESHED" && cRefreshed.versionId === cDraft.versionId, "a new billing contact refreshes the draft");
  assert((await prisma.invoiceVersion.findUniqueOrThrow({ where: { id: cDraft.versionId } })).contactName === "Sue Secretary", "the draft carries the new contact");

  // ---- The deferred-event invoice screens leave church promo code invoices out.
  const deferredView = await getInvoicesView(ids.club);
  assert(deferredView.isDeferred && deferredView.invoices.length === 0, "a deferred event lists none of them");
  const detail = await getInvoiceDetail(ids.general, created.invoiceId);
  assert(detail && detail.shown.basis === "CHURCH_PROMO_CODES" && detail.snapshot.kind === "CHURCH_PROMO_CODES" && detail.churchDraftStale === false && detail.needsFinalizePermission, "the invoice detail loads, current, and needs the permission");
  assert(detail.currentContact?.email === EMAIL.tina, "the detail shows the church's current contact");

  // ---- Finalizing is a named human action with a permission, and never for a stale draft or a church with no contact.
  assert(code(await failure(finalize(created.versionId, { canFinalize: false }))) === "FINALIZE_PERMISSION_REQUIRED", "finalizing needs the Finalize invoices permission");
  assert((await prisma.invoiceVersion.findUniqueOrThrow({ where: { id: created.versionId } })).status === "DRAFT", "a refused finalization changes nothing");
  const staleVictim = await redeem(ids.general, "CHURCHA", "CONFIRMED");
  assert(code(await failure(finalize(created.versionId))) === "DRAFT_STALE", "a draft that no longer matches the redemptions is not finalized");
  const refreshedAgain = await prepare(ids.churchA);
  assert(refreshedAgain.outcome === "REFRESHED" && refreshedAgain.amountDueCents === 8_734, "refreshed after another use");
  assert(code(await failure(finalize(created.versionId, { eventId: ids.other }))) === "VERSION_NOT_FOUND", "another event's version is not found");
  assert((await prisma.invoiceVersion.findUniqueOrThrow({ where: { id: created.versionId } })).status === "DRAFT", "and it is still a draft");
  assert(code(await failure(finalize(raced[0]!.versionId))) === "CONTACT_MISSING", "a church with no billing contact cannot be invoiced yet");

  const finalKey = key("fin-a");
  const finalized = await finalize(created.versionId, { idempotencyKey: finalKey });
  assert(finalized.changed && finalized.revision === 0 && finalized.amountDueCents === 8_734 && new RegExp(`^${INVOICE_CODE}27-0001$`).test(finalized.number), `numbered once: ${finalized.number}`);
  const retried = await finalize(created.versionId, { idempotencyKey: finalKey });
  assert(!retried.changed && retried.number === finalized.number, "a retry returns the same number");
  const racedFinal = await Promise.all([1, 2, 3].map(() => finalize(created.versionId, { idempotencyKey: finalKey })));
  assert(racedFinal.every((result) => result.number === finalized.number), "parallel retries give the same number");
  assert(await prisma.invoiceReceivable.count({ where: { invoiceVersionId: created.versionId } }) === 1, "one receivable for the finalized version");
  assert((await prisma.invoiceReceivable.findUniqueOrThrow({ where: { invoiceVersionId: created.versionId } })).amountCents === 8_734, "the receivable is the invoice amount");
  const noChange = await prepare(ids.churchA);
  assert(noChange.outcome === "UNCHANGED" && noChange.versionId === created.versionId, "a finalized invoice that matches the redemptions is left alone");

  // ---- Report, payments and the PDF/send preview (nothing is sent).
  let report = await getChurchCodeReport(ids.general);
  let rowA = report.rows.find((row) => row.churchId === ids.churchA)!;
  assert(rowA.coveredCents === 8_734 && rowA.invoicedCents === 8_734 && rowA.paidCents === 0 && rowA.owedOnInvoiceCents === 8_734 && rowA.notInvoicedCents === 0 && rowA.state === "FINALIZED_CURRENT" && rowA.invoiceNumber === finalized.number, "report: covered, invoiced, paid and owed");
  assert(rowA.lines.length === 4 && rowA.lines.every((line) => line.registrantName === `${REGISTRANT.first} ${REGISTRANT.last}` && line.confirmationCode.length > 0), "report: who used the code, by registrant name as stored and registration (staff report only)");
  assert(report.rows.every((row) => row.lines.every((line) => line.registrantName === `${REGISTRANT.first} ${REGISTRANT.last}`)), "report: every church's lines carry the registrant name");
  assert(rowA.codes.length === 1 && rowA.codes[0]!.code === "CHURCHA" && rowA.codes[0]!.redeemedCount >= 4, "report: the code and its uses");
  assert(rowA.contact?.email === EMAIL.tina, "report: the church's contact");
  const rowB = report.rows.find((row) => row.churchId === ids.churchB)!;
  assert(rowB.state === "DRAFT_CURRENT" && rowB.invoicedCents === 0 && rowB.draftAmountCents === 2_500 && rowB.contact === null, "report: a draft is not owed until it is finalized");
  assert(report.totals.invoicedCents === 8_734, "report totals add up the finalized invoices");

  const pdf = await ensureInvoiceDocument(ids.general, created.versionId);
  assert(pdf.id.length > 0, "the PDF is made for a church promo code invoice");
  const preview = await getInvoiceSendPreview(ids.general, created.versionId);
  assert(preview.recipients.length === 1 && preview.currentContact?.email === EMAIL.tina && !preview.contactChanged, "the send preview goes to the church's own billing contact");
  assert((await countsOf(ids.general)).deliveries === 0 && (await countsOf(ids.general)).outbox === 0, "previewing sends nothing");
  // Names stay off everything the church receives: the PDF text, the stored snapshot, the send preview and its email text.
  const attachment = await prisma.messageAttachment.findUniqueOrThrow({ where: { id: pdf.attachmentId }, select: { content: true } });
  const pdfText = await extractPdfText(new Uint8Array(attachment.content));
  assert(pdfText.includes("Total"), "the PDF text was read back");
  for (const forbidden of [REGISTRANT.first, REGISTRANT.last]) {
    assert(!pdfText.includes(forbidden), `the invoice PDF never shows ${forbidden}`);
    assert(!JSON.stringify(draft.snapshot).includes(forbidden), `the invoice snapshot never holds ${forbidden}`);
    assert(!JSON.stringify(preview).includes(forbidden), `the send preview and its email text never show ${forbidden}`);
  }

  const paid1 = await recordInvoicePayment({ eventId: ids.general, invoiceId: created.invoiceId, amount: "50.00", checkNumber: "1001", receivedOn: "2027-04-20", requestKey: key("pay1"), actorUserId: ids.treasurer });
  assert(paid1.paymentId.length > 0, "a payment is recorded against the invoice");
  report = await getChurchCodeReport(ids.general);
  rowA = report.rows.find((row) => row.churchId === ids.churchA)!;
  assert(rowA.paidCents === 5_000 && rowA.owedOnInvoiceCents === 3_734 && rowA.overpaidCents === 0, "report: a partial payment leaves the balance owed");
  const ledgerRow = (await loadEventLedger(ids.general)).find((row) => row.invoiceId === created.invoiceId);
  assert(ledgerRow && ledgerRow.figures.paidCents === rowA.paidCents && ledgerRow.figures.outstandingCents === rowA.owedOnInvoiceCents, "the report agrees with the ledger");

  // ---- A change after finalization starts a revision draft; the finalized version stays as it was.
  await prisma.registration.update({ where: { id: staleVictim.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
  report = await getChurchCodeReport(ids.general);
  rowA = report.rows.find((row) => row.churchId === ids.churchA)!;
  assert(rowA.state === "FINALIZED_STALE" && rowA.coveredCents === 6_234 && rowA.invoicedCents === 8_734 && rowA.notInvoicedCents === -2_500 && rowA.owedOnInvoiceCents === 3_734, "report: a cancellation after invoicing is shown, and what is owed on the invoice does not move");
  const revision = await prepare(ids.churchA);
  assert(revision.outcome === "REVISION_STARTED" && revision.revision === 1 && revision.amountDueCents === 6_234, "a revision draft is started");
  const prior = await prisma.invoiceVersion.findUniqueOrThrow({ where: { id: created.versionId } });
  assert(prior.status === "FINALIZED" && prior.amountDueCents === 8_734, "the finalized version is untouched");
  const revisionAgain = await prepare(ids.churchA);
  assert(revisionAgain.outcome === "UNCHANGED" && revisionAgain.versionId === revision.versionId, "preparing again keeps the one revision draft");
  assert(code(await failure(finalize(revision.versionId, { canFinalize: false }))) === "FINALIZE_PERMISSION_REQUIRED", "a revision that changes an amount needs the permission");
  const revisionFinal = await finalize(revision.versionId);
  assert(revisionFinal.revision === 1 && revisionFinal.number === `${finalized.number}-R1`, "the revision is numbered -R1");
  assert((await prisma.invoiceVersion.findUniqueOrThrow({ where: { id: created.versionId } })).status === "SUPERSEDED", "the earlier version is superseded");
  report = await getChurchCodeReport(ids.general);
  rowA = report.rows.find((row) => row.churchId === ids.churchA)!;
  assert(rowA.state === "FINALIZED_CURRENT" && rowA.invoicedCents === 6_234 && rowA.paidCents === 5_000 && rowA.owedOnInvoiceCents === 1_234 && rowA.invoiceNumber === revisionFinal.number, "report: after the revision the payment carries over");

  // ---- A draft can be discarded like any other; an invoice of another event is never reached.
  const discardable = await prepare(ids.churchB);
  assert(discardable.outcome === "UNCHANGED", "church B's draft is still current");
  await discardInvoiceDraft({ eventId: ids.general, invoiceId: discardable.invoiceId, actorUserId: ids.staff });
  assert((await prisma.invoiceVersion.findUniqueOrThrow({ where: { id: discardable.versionId } })).status === "DISCARDED", "a church draft can be discarded");
  assert(code(await failure(discardInvoiceDraft({ eventId: ids.other, invoiceId: discardable.invoiceId, actorUserId: ids.staff }))) !== "none", "another event cannot discard it");
  const fresh = await prepare(ids.churchB);
  assert(fresh.outcome === "CREATED" && fresh.versionId !== discardable.versionId, "after a discard, preparing makes a fresh draft");
  assert((await getChurchCodeReport(ids.other)).rows.every((row) => row.invoicedCents === 0 && row.coveredCents === 0), "the other event's report is its own");

  // ---- Audit rows hold ids, counts and amounts only.
  const audits = await prisma.auditLog.findMany({ where: { eventId: ids.general, action: "CHURCH_CODE_INVOICE_DRAFT_PREPARED" } });
  assert(audits.length > 0, "audited");
  for (const entry of audits) {
    const metadata = entry.metadata as Record<string, unknown>;
    assert(Object.keys(metadata).sort().join() === "amountDueCents,churchId,eventId,invoiceId,lineCount,outcome,previousAmountDueCents,revision,versionId", "audit metadata keys are ids, counts and amounts");
    const text = JSON.stringify(entry);
    for (const forbidden of [EMAIL.tina, EMAIL.sam, "Tina", "Sam Clerk", "Sue", "CHURCHA", "CHURCHB", NAMES.churchA, NAMES.churchB, "Treasurer", REGISTRANT.first, REGISTRANT.last]) {
      assert(!text.includes(forbidden), `an audit row never holds ${forbidden}`);
    }
  }
  const finalizeAudits = await prisma.auditLog.findMany({ where: { eventId: ids.general, action: "INVOICE_FINALIZED" } });
  assert(finalizeAudits.length === 2 && finalizeAudits.every((entry) => !JSON.stringify(entry).includes(EMAIL.tina)), "finalization audits carry no contact");

  // ---- Deleting the event removes all of it.
  await prisma.event.delete({ where: { id: ids.general } });
  assert(await prisma.invoice.count({ where: { eventId: ids.general } }) === 0 && await prisma.invoiceVersion.count({ where: { eventId: ids.general } }) === 0, "deleting the event removes its invoices");

  console.log("Church code invoice checks passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((error) => console.error("cleanup failed", error));
    await prisma.$disconnect();
  });
