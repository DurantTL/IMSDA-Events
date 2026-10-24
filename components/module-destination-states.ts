import { eventModuleCatalog, type EventModuleKey } from "@/modules/event-modules/catalog";
import { moduleFeatureState, moduleNotApplicableLabel, moduleRequestHref } from "@/modules/event-features/model";

/**
 * How an event module shows in the navigation (#1180). The state comes from the
 * same rule as the Event features page (`moduleFeatureState` in
 * `modules/event-features/model.ts`, which `buildFeatureRows` also uses), so the
 * navigation and that page cannot disagree about "On", "Off" or "Does not apply
 * to this event", and data that keeps a module usable counts the same way.
 * - `enabled`: the module is on, so its destination is a card or menu item.
 * - `requestable`: it is off but applies. A system administrator turns it on from
 *   Event features; an Event Admin asks for it on the Event modules page
 *   (`/more#request-a-feature`). Both are real pages.
 * - `not-applicable`: it cannot apply to this kind of event. Plain text, never a link.
 * A module nobody in the viewer's position can act on is not listed. Only what
 * the catalog defines can appear, so a planned capability can never become a
 * clickable dead entry. Relevance only: pages keep their own checks.
 */
export type ModuleDestinationState = "enabled" | "requestable" | "not-applicable";

export type ModuleDestinationEntry = {
  moduleKey: EventModuleKey;
  title: string;
  cardKey: string;
  state: ModuleDestinationState;
  /** A link target for `requestable` only; `null` means the entry is not clickable. */
  href: string | null;
};

export function moduleDestinationStates(input: {
  /** Card keys of modules that are off for the event (`disabledModuleCardKeys`). */
  hiddenCardKeys: ReadonlySet<string>;
  audience: "GENERAL" | "CLUB";
  /** Modules whose data keeps them usable (`dataPresentByEvent`), as the Event features page counts it. */
  dataPresent?: ReadonlySet<EventModuleKey>;
  isSystemAdmin: boolean;
  /** CONFIGURE_EVENT: an Event Admin can ask for a module. */
  canConfigure: boolean;
  eventQuery: string;
}): ModuleDestinationEntry[] {
  const entries: ModuleDestinationEntry[] = [];
  for (const definition of eventModuleCatalog) {
    if (definition.alwaysOn) continue;
    const base = { moduleKey: definition.key, title: definition.title, cardKey: definition.cardKey };
    const state = moduleFeatureState({
      key: definition.key,
      audience: input.audience,
      on: !input.hiddenCardKeys.has(definition.cardKey),
      dataPresent: input.dataPresent ?? new Set(),
    });
    if (state === "on") {
      entries.push({ ...base, state: "enabled", href: null });
    } else if (!input.isSystemAdmin && !input.canConfigure) {
      continue;
    } else if (state === "not-applicable") {
      entries.push({ ...base, state: "not-applicable", href: null });
    } else {
      entries.push({
        ...base,
        state: "requestable",
        href: input.isSystemAdmin ? `/more/features${input.eventQuery}` : moduleRequestHref(input.eventQuery),
      });
    }
  }
  return entries;
}

/** The words beside an entry. */
export const moduleStateLabels: Record<ModuleDestinationState, string> = {
  enabled: "On",
  requestable: "Off. Turn on or ask for it",
  "not-applicable": moduleNotApplicableLabel,
};
