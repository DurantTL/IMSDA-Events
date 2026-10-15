/**
 * Proves the "Which features does this event use?" step of event creation (#965)
 * against a real PostgreSQL database, where the unit tests' fake database can't:
 *
 * - a blank event is created with exactly the modules and calendar choice the step
 *   sent, plus public content, in the creating transaction; a skipped step gets the
 *   audience's defaults; a club module asked for on a general event is not stored;
 * - a creation that fails inside its transaction leaves no event and no module rows,
 *   and a repeated create with the same address changes nothing the first one made;
 * - a template applied with the step's overrides carries them, keeps the template's
 *   own settings where nothing was changed, and a retry with the same key returns the
 *   same event without rewriting its features;
 * - a copy from a past event carries the source's modules and flags, and the
 *   features the copy preview showed (`cloneCreationFeatures`) are what it creates;
 * - the module API's permission is untouched: an Event Admin still cannot turn a
 *   module on or off, and merchandise with products is still refused.
 *
 * Uses fictitious users and events it creates and removes itself.
 *
 *   npm run test:event-creation-features
 */
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";
import { cloneCreationFeatures, defaultCreationFeatures } from "../modules/event-features/creation";
import { defaultModuleKeys } from "../modules/event-modules/catalog";
import { disableModule, enableModule } from "../modules/event-modules/service";
import { AccessDeniedError } from "../modules/access/authorization";
import { createEvent, getEventSettings } from "../modules/events/repository";
import { eventSettingsInputSchema } from "../modules/events/schemas";
import { cloneEvent, previewEventClone } from "../modules/event-clones/repository";
import { cloneDomainKeys } from "../modules/event-clones/domain";
import {
  applyEventTemplate,
  createEventTemplate,
  publishEventTemplateVersion,
  saveEventTemplateDraft,
  getEventTemplate,
} from "../modules/event-templates/repository";
import { eventTemplatePayloadSchema } from "../modules/event-templates/domain";

loadEnvConfig(process.cwd());
assertLocalDatabase(process.env, "run this verification");

const prisma = new PrismaClient();
const P = "evtfeat";
const adminId = `${P}_admin`;
const staffId = `${P}_staff`;
const users = [adminId, staffId];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function cleanup() {
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: users } } });
  await prisma.eventTemplateApplication.deleteMany({ where: { actorUserId: { in: users } } });
  await prisma.eventCloneRecord.deleteMany({ where: { actorUserId: { in: users } } });
  await prisma.event.deleteMany({ where: { slug: { startsWith: `${P}-` } } });
  await prisma.eventTemplate.deleteMany({ where: { createdByUserId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
}

const basics = (slug: string, overrides: Record<string, unknown> = {}) => eventSettingsInputSchema.parse({
  name: `Evtfeat ${slug}`,
  slug: `${P}-${slug}`,
  startsOn: "2027-05-01",
  endsOn: "2027-05-03",
  timezone: "America/Chicago",
  location: "Camp Example",
  publicInfoUrl: null,
  supportContact: "help@evtfeat.example.test",
  capacity: null,
  registrationOpensOn: null,
  registrationClosesOn: null,
  waitlistEnabled: false,
  autoPromoteWaitlist: false,
  collectsShirtSizes: false,
  ...overrides,
});

async function moduleKeys(eventId: string) {
  return (await prisma.eventModule.findMany({ where: { eventId }, select: { moduleKey: true } })).map((row) => row.moduleKey).sort();
}

async function run() {
  await prisma.user.createMany({ data: [
    { id: adminId, email: `${P}-admin@example.test`, displayName: "Features Check Admin", globalRole: "SYSTEM_ADMIN" },
    { id: staffId, email: `${P}-staff@example.test`, displayName: "Features Check Event Admin" },
  ] });

  // 1. The step's choices become the event's modules and calendar choice, in the creating transaction.
  const chosen = await createEvent(basics("chosen", { waitlistEnabled: true, autoPromoteWaitlist: true, collectsShirtSizes: true }), adminId, {
    modules: ["merchandise", "attendee-community"],
    showOnCalendar: false,
  });
  assert(chosen, "the event was created");
  assert(JSON.stringify(await moduleKeys(chosen.id)) === JSON.stringify(["attendee-community", "merchandise", "public-content"]), "the event has exactly the chosen modules plus public content");
  const chosenRow = await prisma.event.findUniqueOrThrow({ where: { id: chosen.id }, select: { showOnCalendar: true, waitlistEnabled: true, autoPromoteWaitlist: true, collectsShirtSizes: true, isPublished: true } });
  assert(!chosenRow.showOnCalendar && chosenRow.waitlistEnabled && chosenRow.autoPromoteWaitlist && chosenRow.collectsShirtSizes && !chosenRow.isPublished, "the flags and the calendar choice were saved, and the event is a draft");
  const audit = await prisma.auditLog.findFirstOrThrow({ where: { eventId: chosen.id, action: "EVENT_CREATED" } });
  assert((audit.metadata as { featuresChosen?: boolean }).featuresChosen === true, "the creation audit records that the features were chosen");
  console.log("ok  the chosen modules, flags and calendar choice are saved with the event");

  // 2. A skipped step gets the audience's defaults; a club module on a general event is not stored.
  const skippedGeneral = await createEvent(basics("skipped-general"), adminId);
  assert(skippedGeneral && JSON.stringify(await moduleKeys(skippedGeneral.id)) === JSON.stringify([...defaultModuleKeys("GENERAL")].sort()), "a skipped step gives a general event the general defaults");
  assert((await prisma.event.findUniqueOrThrow({ where: { id: skippedGeneral.id }, select: { showOnCalendar: true } })).showOnCalendar, "a skipped step leaves the event on the calendar");
  const skippedClub = await createEvent(basics("skipped-club", { audience: "CLUB", billingMode: "DEFERRED_ORGANIZATION_INVOICE" }), adminId);
  assert(skippedClub && JSON.stringify(await moduleKeys(skippedClub.id)) === JSON.stringify([...defaultModuleKeys("CLUB")].sort()), "a skipped step gives a club event the club defaults");
  const droppedClubModule = await createEvent(basics("dropped"), adminId, { modules: ["honors", "event-patches", "merchandise"] });
  assert(droppedClubModule && JSON.stringify(await moduleKeys(droppedClubModule.id)) === JSON.stringify(["merchandise", "public-content"]), "club modules asked for on a general event are not stored");
  const noModules = await createEvent(basics("none"), adminId, { modules: [] });
  assert(noModules && JSON.stringify(await moduleKeys(noModules.id)) === JSON.stringify(["public-content"]), "choosing nothing still leaves public content, which is always on");
  console.log("ok  a skipped step gets the audience's defaults, and modules that do not apply are dropped");

  // 3. Atomic: a creation that fails inside its transaction leaves no event and no module rows. Repeating is harmless.
  const modulesBefore = await prisma.eventModule.count();
  const eventsBefore = await prisma.event.count();
  const failed = await createEvent(basics("rolled-back"), adminId, { modules: ["merchandise"], calendarEntryId: `${P}-no-such-calendar-item` }).then(() => null, (error: unknown) => error);
  assert(failed instanceof Error, "a creation with a calendar item that does not exist fails");
  assert(await prisma.event.count({ where: { slug: `${P}-rolled-back` } }) === 0, "the failed creation left no event");
  assert(await prisma.event.count() === eventsBefore && await prisma.eventModule.count() === modulesBefore, "the failed creation left no module rows either");
  const repeated = await createEvent(basics("chosen"), adminId, { modules: ["honors"] }).then(() => null, (error: unknown) => error);
  assert(repeated instanceof Error, "creating the same address again is refused");
  assert(JSON.stringify(await moduleKeys(chosen.id)) === JSON.stringify(["attendee-community", "merchandise", "public-content"]), "the repeat changed nothing the first creation made");
  assert(await prisma.event.count({ where: { slug: `${P}-chosen` } }) === 1, "there is still one event at that address");
  console.log("ok  a failed creation leaves nothing behind, and a repeated one changes nothing");

  // 4. A template carries its own settings, takes the step's overrides, and a retry returns the same event.
  const template = await createEventTemplate(adminId, { name: "Evtfeat Template", description: "", audience: "GENERAL" });
  const payload = eventTemplatePayloadSchema.parse({
    audience: "GENERAL",
    formTemplateKeys: [],
    moduleEnablement: { waitlistEnabled: true, autoPromoteWaitlist: true, collectsShirtSizes: true, checksAdultBackgrounds: false, hostedPaymentLinkEnabled: false },
  });
  const draft = (await getEventTemplate(template.id)).versions.find((version) => version.status === "DRAFT")!;
  await saveEventTemplateDraft(template.id, adminId, { name: "Evtfeat Template", description: "", payload, expectedUpdatedAt: draft.updatedAt });
  await publishEventTemplateVersion(template.id, adminId);
  const own = await applyEventTemplate(template.id, adminId, { name: "Evtfeat Own", slug: `${P}-tpl-own`, startsOn: "2027-06-01", endsOn: "2027-06-02", requestKey: `${P}-key-own` });
  assert(own.event.waitlistEnabled && own.event.collectsShirtSizes && !own.event.checksAdultBackgrounds, "with the step skipped the event has the template's own settings");
  assert(JSON.stringify(await moduleKeys(own.event.id)) === JSON.stringify([...defaultModuleKeys("GENERAL")].sort()), "with the step skipped the event has the audience's default modules");
  const features = { modules: ["merchandise" as const], showOnCalendar: false, collectsShirtSizes: false, checksAdultBackgrounds: true, waitlistEnabled: false };
  const changed = await applyEventTemplate(template.id, adminId, { name: "Evtfeat Changed", slug: `${P}-tpl-changed`, startsOn: "2027-06-01", endsOn: "2027-06-02", requestKey: `${P}-key-changed`, features });
  assert(!changed.event.waitlistEnabled && !changed.event.autoPromoteWaitlist, "turning the waitlist off on the step also turns automatic promotion off");
  assert(!changed.event.collectsShirtSizes && changed.event.checksAdultBackgrounds, "the step's flag overrides replace the template's");
  assert(JSON.stringify(await moduleKeys(changed.event.id)) === JSON.stringify(["merchandise", "public-content"]), "the step's modules replace the defaults");
  assert(!(await prisma.event.findUniqueOrThrow({ where: { id: changed.event.id }, select: { showOnCalendar: true } })).showOnCalendar, "the step's calendar choice was saved");
  const retried = await applyEventTemplate(template.id, adminId, { name: "Evtfeat Changed", slug: `${P}-tpl-changed`, startsOn: "2027-06-01", endsOn: "2027-06-02", requestKey: `${P}-key-changed`, features: { modules: ["attendee-community"], waitlistEnabled: true } });
  assert(retried.alreadyApplied && retried.event.id === changed.event.id, "a retry with the same key returns the event the first attempt created");
  assert(JSON.stringify(await moduleKeys(changed.event.id)) === JSON.stringify(["merchandise", "public-content"]) && !(await getEventSettings(changed.event.id))!.waitlistEnabled, "the retry did not rewrite the event's features");
  console.log("ok  a template keeps its own settings, takes the step's overrides, and a retry changes nothing");

  // 5. A copy carries the source's modules and flags, and creates what the copy preview showed.
  const plan = await previewEventClone(adminId, { sourceEventId: chosen.id });
  const shown = cloneCreationFeatures(plan.features, { eventDetails: true, moduleToggles: true });
  const include = Object.fromEntries(cloneDomainKeys.map((key) => [key, key === "eventDetails" || key === "moduleToggles"]));
  const copy = await cloneEvent(adminId, {
    sourceEventId: chosen.id,
    expectedFingerprint: plan.fingerprint,
    requestKey: `${P}-key-copy`,
    name: "Evtfeat Copy",
    slug: `${P}-copy`,
    startsOn: "2028-05-01",
    endsOn: "2028-05-03",
    capacity: { value: null, none: true },
    registrationOpensOn: { value: null, none: true },
    registrationClosesOn: { value: null, none: true },
    include,
    formLatePricingDates: [],
    formChoiceLimits: [],
    promoCodeWindows: [],
    honorOfferingCapacities: [],
  });
  const copied = await prisma.event.findUniqueOrThrow({ where: { id: copy.event.id }, select: { showOnCalendar: true, waitlistEnabled: true, autoPromoteWaitlist: true, collectsShirtSizes: true, checksAdultBackgrounds: true, hostedPaymentLinkEnabled: true } });
  const createdModules = await moduleKeys(copy.event.id);
  assert(JSON.stringify(createdModules) === JSON.stringify([...shown.features.modules].sort()), "the copy's modules are the ones the copy preview showed");
  assert(createdModules.includes("merchandise") && createdModules.includes("attendee-community"), "the copy carries the source's modules");
  assert(copied.showOnCalendar === shown.features.showOnCalendar && copied.waitlistEnabled === shown.features.waitlistEnabled && copied.collectsShirtSizes === shown.features.collectsShirtSizes
    && copied.autoPromoteWaitlist === shown.features.autoPromoteWaitlist && copied.checksAdultBackgrounds === shown.features.checksAdultBackgrounds && copied.hostedPaymentLinkEnabled === shown.features.hostedPaymentLinkEnabled,
  "the copy's flags and calendar choice are the ones the copy preview showed");
  assert(defaultCreationFeatures("GENERAL").modules.length === 1, "the shared defaults stay the server's defaults");
  console.log("ok  a copy carries the source's modules and flags, exactly as the preview showed");

  // 6. The permission and the data rules of the module API are untouched.
  await prisma.eventMembership.create({ data: { eventId: chosen.id, userId: staffId, role: "EVENT_ADMIN", status: "ACTIVE" } });
  const staff = { id: staffId, globalRole: null } as never;
  const admin = { id: adminId, globalRole: "SYSTEM_ADMIN" } as never;
  const refusedOn = await enableModule(staff, chosen.id, "event-patches").then(() => null, (error: unknown) => error);
  const refusedOff = await disableModule(staff, chosen.id, "merchandise").then(() => null, (error: unknown) => error);
  assert(refusedOn instanceof AccessDeniedError && refusedOff instanceof AccessDeniedError, "an Event Admin still cannot turn a module on or off");
  assert(JSON.stringify(await moduleKeys(chosen.id)) === JSON.stringify(["attendee-community", "merchandise", "public-content"]), "the refused changes changed nothing");
  await prisma.merchandiseProduct.create({ data: { eventId: chosen.id, name: "Evtfeat Shirt" } });
  const forced = await disableModule(admin, chosen.id, "merchandise").then(() => null, (error: unknown) => error);
  assert(forced instanceof Error && /stays on/.test(forced.message), "merchandise with products is still refused");
  assert((await moduleKeys(chosen.id)).includes("merchandise"), "the refused change left merchandise on");
  console.log("ok  modules stay a system administrator's switch, and data still keeps merchandise on");
}

async function main() {
  await cleanup();
  try {
    await run();
    console.log("All event creation feature checks passed.");
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
