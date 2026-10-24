import { canEnableForEvent, eventModuleCatalog, type EventModuleKey } from "@/modules/event-modules/catalog";

/**
 * How an event module shows in the navigation (#1180), from #741's real rules:
 * - `enabled`: the module is on, so its destination is a card or menu item.
 * - `requestable`: it is off but applies to this event, and the viewer is a
 *   system administrator (turns it on) or an Event Admin (asks for it). The
 *   entry points to the Event features page, a real destination.
 * - `not-applicable`: it does not apply to this kind of event (a club module on
 *   a general event). Shown as plain text, never as a link.
 * A module nobody in the viewer's position can act on is not listed. Only what
 * the catalog already defines can appear, so a planned capability can never
 * become a clickable dead entry. Relevance only: pages keep their own checks.
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
  isSystemAdmin: boolean;
  /** CONFIGURE_EVENT: an Event Admin can ask for a module. */
  canConfigure: boolean;
  eventQuery: string;
}): ModuleDestinationEntry[] {
  const mayAct = input.isSystemAdmin || input.canConfigure;
  const entries: ModuleDestinationEntry[] = [];
  for (const definition of eventModuleCatalog) {
    if (definition.alwaysOn) continue;
    const base = { moduleKey: definition.key, title: definition.title, cardKey: definition.cardKey };
    if (!input.hiddenCardKeys.has(definition.cardKey)) {
      entries.push({ ...base, state: "enabled", href: null });
    } else if (!mayAct) {
      continue;
    } else if (canEnableForEvent(definition.key, input.audience)) {
      entries.push({ ...base, state: "requestable", href: `/more/features${input.eventQuery}` });
    } else {
      entries.push({ ...base, state: "not-applicable", href: null });
    }
  }
  return entries;
}

/** The words beside an entry. */
export const moduleStateLabels: Record<ModuleDestinationState, string> = {
  enabled: "On",
  requestable: "Off. Turn on or ask for it",
  "not-applicable": "Not applicable to this event",
};
