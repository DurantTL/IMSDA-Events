import { z } from "zod";
import {
  canEnableForEvent,
  defaultModuleKeys,
  eventModuleCatalog,
  eventModuleKeys,
  type EventModuleKey,
} from "@/modules/event-modules/catalog";

/**
 * What the "Which features does this event use?" step of event creation (#965)
 * can choose. Pure and database-free: the same shape travels from the form to
 * `POST /api/events` and `POST /api/event-templates/{id}/apply`, and the same
 * defaults are used by the form and the server, so skipping the step means
 * exactly what the form showed.
 *
 * Only a system administrator creates events, so choosing modules here never
 * widens who may turn a module on.
 */

/** The event columns the step switches. They are existing `Event` columns with existing meaning. */
export const creationFlagKeys = [
  "waitlistEnabled",
  "autoPromoteWaitlist",
  "collectsShirtSizes",
  "hostedPaymentLinkEnabled",
  "checksAdultBackgrounds",
] as const;

export type CreationFlagKey = (typeof creationFlagKeys)[number];

export type CreationFeatures = {
  modules: EventModuleKey[];
  showOnCalendar: boolean;
} & Record<CreationFlagKey, boolean>;

/** The optional modules (and calendar choice) a create request may carry. Absent means "use the defaults". */
export const creationFeaturesSchema = z.object({
  modules: z.array(z.enum(eventModuleKeys)).max(eventModuleKeys.length).optional(),
  showOnCalendar: z.boolean().optional(),
}).strict();

export type CreationFeaturesInput = z.infer<typeof creationFeaturesSchema>;

/** A template apply may also override the flags the template carries. */
export const templateFeatureOverridesSchema = z.object({
  modules: z.array(z.enum(eventModuleKeys)).max(eventModuleKeys.length).optional(),
  showOnCalendar: z.boolean().optional(),
  waitlistEnabled: z.boolean().optional(),
  autoPromoteWaitlist: z.boolean().optional(),
  collectsShirtSizes: z.boolean().optional(),
  hostedPaymentLinkEnabled: z.boolean().optional(),
  checksAdultBackgrounds: z.boolean().optional(),
}).strict();

export type TemplateFeatureOverrides = z.infer<typeof templateFeatureOverridesSchema>;

export type CreationAudience = "GENERAL" | "CLUB";

/**
 * The starting choices: the audience's modules, every flag off and the event on
 * the public calendar (the column's own default), then whatever a template or a
 * copied event carries.
 */
export function defaultCreationFeatures(
  audience: CreationAudience,
  carried: Partial<Record<CreationFlagKey, boolean>> & { modules?: readonly EventModuleKey[]; showOnCalendar?: boolean } = {},
): CreationFeatures {
  const waitlistEnabled = carried.waitlistEnabled ?? false;
  return {
    modules: [...(carried.modules ?? defaultModuleKeys(audience))],
    showOnCalendar: carried.showOnCalendar ?? true,
    waitlistEnabled,
    autoPromoteWaitlist: waitlistEnabled ? (carried.autoPromoteWaitlist ?? false) : false,
    collectsShirtSizes: carried.collectsShirtSizes ?? false,
    hostedPaymentLinkEnabled: carried.hostedPaymentLinkEnabled ?? false,
    checksAdultBackgrounds: carried.checksAdultBackgrounds ?? false,
  };
}

/** One switch on the creation step: its label, why it matters, and whether it is on. */
export type CreationFeatureItem =
  | { kind: "module"; key: EventModuleKey; title: string; description: string; on: boolean; locked: boolean }
  | { kind: "flag"; key: CreationFlagKey; title: string; description: string; on: boolean; locked: boolean }
  | { kind: "calendar"; key: "showOnCalendar"; title: string; description: string; on: boolean; locked: boolean };

const flagCopy: Record<CreationFlagKey, { title: string; description: string }> = {
  waitlistEnabled: { title: "Waitlist", description: "People can submit without taking a confirmed spot when the event is full." },
  autoPromoteWaitlist: { title: "Automatic waitlist promotion", description: "The next eligible registration is promoted when capacity opens. Needs the waitlist." },
  collectsShirtSizes: { title: "Shirt sizes", description: "Registrants choose a size on their private page." },
  hostedPaymentLinkEnabled: { title: "Pay on Square", description: "A backup button that opens Square's own payment page. For events where attendees pay online." },
  checksAdultBackgrounds: { title: "Sterling Volunteers check for adults", description: "Flags every adult registered until their Sterling Volunteers is current; adults and staff who aren't current can't be checked in without a staff override. Never blocks registration." },
};

/**
 * The switches the step shows for an audience, in the order the Event features
 * page lists them. Always-on modules are listed as locked and on; a module that
 * does not apply to the audience is not offered at all.
 */
export function creationFeatureItems(audience: CreationAudience, features: CreationFeatures): CreationFeatureItem[] {
  const on = new Set(features.modules);
  const items: CreationFeatureItem[] = [];
  for (const definition of eventModuleCatalog) {
    if (!definition.alwaysOn && !canEnableForEvent(definition.key, audience)) continue;
    items.push({
      kind: "module",
      key: definition.key,
      title: definition.title,
      description: definition.description,
      on: definition.alwaysOn || on.has(definition.key),
      locked: definition.alwaysOn,
    });
  }
  for (const key of creationFlagKeys) {
    items.push({
      kind: "flag",
      key,
      title: flagCopy[key].title,
      description: flagCopy[key].description,
      on: features[key],
      locked: key === "autoPromoteWaitlist" && !features.waitlistEnabled,
    });
  }
  items.push({
    kind: "calendar",
    key: "showOnCalendar",
    title: "Show on the public calendar",
    description: "Once published, the event appears on the conference calendar. A system administrator can hide it later.",
    on: features.showOnCalendar,
    locked: false,
  });
  return items;
}

/** A flag change that keeps the waitlist rule: automatic promotion needs the waitlist. */
export function withFlag(features: CreationFeatures, key: CreationFlagKey, value: boolean): CreationFeatures {
  const next = { ...features, [key]: value };
  if (key === "waitlistEnabled" && !value) next.autoPromoteWaitlist = false;
  return next;
}

/** A module change: always-on modules cannot be removed, and the order stays the catalog's. */
export function withModule(features: CreationFeatures, key: EventModuleKey, value: boolean): CreationFeatures {
  const wanted = new Set(features.modules);
  if (value) wanted.add(key);
  else wanted.delete(key);
  return { ...features, modules: eventModuleCatalog.filter((entry) => entry.alwaysOn || wanted.has(entry.key)).map((entry) => entry.key) };
}

/**
 * The same choices after the audience changed on the form, before staff touched
 * the step: the modules follow the new audience; the flags stay as they were.
 */
export function featuresForAudience(features: CreationFeatures, audience: CreationAudience): CreationFeatures {
  return { ...features, modules: defaultModuleKeys(audience) };
}

/**
 * The switches a copy from a past event will start with (#965), following the
 * "What to copy" choices exactly as `cloneEvent` does: the module rows and the
 * calendar choice come with the event details (the audience is read from them),
 * the flags come with the module toggles, and a source with no usable module rows
 * gets its audience's defaults. Everything else starts at the defaults of a
 * general event.
 */
export function cloneCreationFeatures(
  source: { audience: CreationAudience; sourceModules: readonly EventModuleKey[]; flags: Record<CreationFlagKey, boolean>; showOnCalendar: boolean },
  include: { eventDetails: boolean; moduleToggles: boolean },
): { audience: CreationAudience; features: CreationFeatures } {
  const audience: CreationAudience = include.eventDetails ? source.audience : "GENERAL";
  const carriesModules = include.eventDetails && source.sourceModules.length > 0;
  return {
    audience,
    features: defaultCreationFeatures(audience, {
      ...(include.moduleToggles ? source.flags : {}),
      ...(carriesModules ? { modules: source.sourceModules } : {}),
      showOnCalendar: include.eventDetails ? source.showOnCalendar : true,
    }),
  };
}

/**
 * The blank form's module choice after the step changed. A module is "chosen" only when a module checkbox actually
 * changed the list; touching a flag or the calendar choice leaves the choice as it was (null still follows the audience),
 * so opening the step never pins the modules before the audience is picked.
 */
export function chosenModulesAfter(
  previous: EventModuleKey[] | null,
  current: CreationFeatures,
  next: CreationFeatures,
): EventModuleKey[] | null {
  const same = current.modules.length === next.modules.length && current.modules.every((key, index) => key === next.modules[index]);
  return same ? previous : next.modules;
}

/** The modules the form shows and sends: the person's choice, else the audience's defaults (`featuresForAudience`). */
export function creationFeaturesFor(
  audience: CreationAudience,
  chosen: EventModuleKey[] | null,
  base: CreationFeatures,
): CreationFeatures {
  return chosen === null ? featuresForAudience(base, audience) : { ...base, modules: chosen };
}

/** The club-only features that need the event to exist first, so the step only names them. */
export const clubFeaturesAfterCreation = [
  { key: "general-link", title: "General registration link", description: "Needs a published registration form, so turn it on from the Event features page once the event exists." },
  { key: "teams", title: "Several teams per club", description: "Turn it on from the Event features page; the team rules are set on Event settings." },
] as const;
