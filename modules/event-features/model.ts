import type { MoreDirectoryCard } from "@/components/staff-navigation";
import {
  canEnableForEvent,
  dataDrivenReasons,
  eventModuleCatalog,
  type EventModuleKey,
} from "@/modules/event-modules/catalog";

/**
 * The rows of the Event features page (`/more/features`, #965): every feature an
 * event can have on or off, in one list, with its state, the switch where one
 * exists, and a Settings link. Pure, so who sees which switch is testable
 * without rendering the page.
 *
 * The page adds no write path and no permission. Each switch is the control that
 * already exists elsewhere, and `action` says which request the page sends for
 * it: the module API (system administrators), the event settings update (event
 * settings access), the general link and team APIs (event settings access), the
 * publish and unpublish actions, and the calendar API (system administrators).
 * The server checks the same permission again on every one of those requests.
 * A viewer without the permission gets the state and no switch.
 */

export type FeatureAction =
  | { type: "module"; moduleKey: EventModuleKey }
  | { type: "event-column"; field: "waitlistEnabled" | "autoPromoteWaitlist" | "collectsShirtSizes" | "hostedPaymentLinkEnabled" | "checksAdultBackgrounds" }
  | { type: "general-link" }
  | { type: "teams" }
  | { type: "publish" }
  | { type: "calendar" };

export type FeatureStateKind = "on" | "off" | "always-on" | "set-up" | "not-set-up" | "not-applicable";

export type FeatureConfirmation = { title: string; body: string; confirmLabel: string };

export type FeatureControl = {
  /** The switch's position: on is true. */
  on: boolean;
  /** Whether this viewer may flip it now. False renders the state with no usable switch. */
  canChange: boolean;
  /** Why it cannot be flipped, shown beside the state (a missing permission, or a rule). */
  reason: string | null;
  /** Asked before the switch is turned off. */
  confirmOff: FeatureConfirmation | null;
  /** Asked before the switch is turned on (publishing only). */
  confirmOn: FeatureConfirmation | null;
};

export type FeatureRow = {
  id: string;
  title: string;
  description: string;
  state: FeatureStateKind;
  stateLabel: string;
  /** The switch, or null for a feature that has none (always on, set up or not, or not for this event). */
  control: FeatureControl | null;
  action: FeatureAction | null;
  /** Where this feature is configured, or null when this viewer may not open it. */
  settings: { href: string; label: string } | null;
  /** A note for a viewer who cannot change it but may ask (Event Admins can request a module). */
  request: { href: string; label: string } | null;
};

export type FeatureFlags = {
  waitlistEnabled: boolean;
  autoPromoteWaitlist: boolean;
  collectsShirtSizes: boolean;
  hostedPaymentLinkEnabled: boolean;
  checksAdultBackgrounds: boolean;
  isPublished: boolean;
  showOnCalendar: boolean;
};

export type FeatureRowsInput = {
  audience: "GENERAL" | "CLUB";
  eventQuery: string;
  isSystemAdmin: boolean;
  permissions: readonly string[];
  flags: FeatureFlags;
  modules: {
    stored: ReadonlySet<EventModuleKey>;
    effective: ReadonlySet<EventModuleKey>;
    dataPresent: ReadonlySet<EventModuleKey>;
    dataForced: ReadonlySet<EventModuleKey>;
  };
  /** The More directory cards with their permission result, for the module, lodging and meals Settings links. */
  cards: readonly Pick<MoreDirectoryCard, "key" | "allowed" | "href">[];
  generalLink: { enabled: boolean; eligible: boolean; problem: string | null } | null;
  /** Whether the event has team rules with several teams per club turned on. */
  teamsEnabled: boolean;
  lodgingSetUp: boolean;
  mealsSetUp: boolean;
  /** Event Admins ask for a module a system administrator turns on (`/more#request-a-feature`). */
  moduleRequestsEnabled: boolean;
};

const needsSystemAdmin = "A system administrator turns this on or off.";
const needsEventSettings = "Event settings access is needed to change this.";

const moduleOffCopy = "Its pages and links are hidden for this event. Nothing is deleted, and you can turn it back on.";

/** What turning each event column off does, stated in full before it happens. */
const columnCopy = {
  waitlistEnabled: {
    title: "Waitlist",
    description: "People can submit without taking a confirmed spot when the event is full.",
    off: "Nobody new can join a waitlist when the event is full. Automatic promotion turns off with it.",
  },
  autoPromoteWaitlist: {
    title: "Automatic waitlist promotion",
    description: "The next eligible registration is promoted when capacity opens, in the saved queue order.",
    off: "Waiting registrations are no longer promoted automatically. Staff promote them by hand.",
  },
  collectsShirtSizes: {
    title: "Shirt sizes",
    description: "Registrants choose a size on their private page, and staff can ask everyone still missing one.",
    off: "The shirt size question is hidden and the reminder request stops being sent. Sizes already given are kept.",
  },
  hostedPaymentLinkEnabled: {
    title: "Pay on Square",
    description: "A backup button beside the card form that opens Square's own payment page for the same balance.",
    off: "The Pay on Square button is removed from the payment page. The card form stays.",
  },
  checksAdultBackgrounds: {
    title: "Sterling Volunteers check for adults",
    description: "Every adult registered is flagged until their Sterling Volunteers is current. Never blocks registration.",
    off: "Adults are no longer flagged for Sterling Volunteers. Registration and check-in are never blocked either way.",
  },
} as const;

type ColumnField = keyof typeof columnCopy;

function settingsLink(input: FeatureRowsInput, path: string) {
  return { href: `${path}${input.eventQuery}`, label: "Settings" };
}

function cardLink(input: FeatureRowsInput, cardKey: string, label = "Settings") {
  const card = input.cards.find((candidate) => candidate.key === cardKey);
  return card?.allowed ? { href: card.href, label } : null;
}

export function buildFeatureRows(input: FeatureRowsInput): FeatureRow[] {
  const can = (permission: string) => input.permissions.includes(permission);
  const canConfigure = can("CONFIGURE_EVENT");
  const rows: FeatureRow[] = [];
  const club = input.audience === "CLUB";

  // The catalog modules, in the catalog's order. Public content is always on.
  for (const definition of eventModuleCatalog) {
    const key = definition.key;
    const settings = cardLink(input, definition.cardKey);
    if (definition.alwaysOn) {
      rows.push({
        id: `module:${key}`,
        title: definition.title,
        description: definition.description,
        state: "always-on",
        stateLabel: "Always on",
        control: null,
        action: null,
        settings,
        request: null,
      });
      continue;
    }
    const on = input.modules.effective.has(key);
    const forced = input.modules.dataForced.has(key);
    const applies = canEnableForEvent(key, input.audience, input.modules.dataPresent);
    // A module with a stored row that no longer applies (a change of audience) can still be turned off.
    if (!on && !applies) {
      rows.push({
        id: `module:${key}`,
        title: definition.title,
        description: definition.description,
        state: "not-applicable",
        stateLabel: "Does not apply to this event",
        control: null,
        action: null,
        settings: null,
        request: null,
      });
      continue;
    }
    // Data keeps Merchandise and Seminar assignments on while the event has products or a ranked field: refused, as on the Event
    // modules page and by `disableModule`. Everything else is a system administrator's switch.
    const canChange = input.isSystemAdmin && !forced;
    const reason = forced
      ? (dataDrivenReasons[key] ?? "The event's data keeps this on.")
      : input.isSystemAdmin ? null : needsSystemAdmin;
    const asks = !on && !input.isSystemAdmin && canConfigure && input.moduleRequestsEnabled;
    rows.push({
      id: `module:${key}`,
      title: definition.title,
      description: definition.description,
      state: on ? "on" : "off",
      stateLabel: on ? "On" : "Off",
      control: {
        on,
        canChange,
        reason: canChange ? null : reason,
        confirmOff: {
          title: `Turn off ${definition.title}?`,
          body: `${moduleOffCopy} Turning off ${definition.title} never removes the data behind it.`,
          confirmLabel: `Turn off ${definition.title}`,
        },
        confirmOn: null,
      },
      action: { type: "module", moduleKey: key },
      settings: on ? settings : null,
      request: asks ? { href: `/more${input.eventQuery}#request-a-feature`, label: "Request this" } : null,
    });
  }

  // The event columns, changed through the existing settings update.
  const columnRow = (field: ColumnField, extra: { disabledReason?: string } = {}): FeatureRow => {
    const copy = columnCopy[field];
    const on = input.flags[field];
    const canChange = canConfigure && !extra.disabledReason;
    return {
      id: `column:${field}`,
      title: copy.title,
      description: copy.description,
      state: on ? "on" : "off",
      stateLabel: on ? "On" : "Off",
      control: {
        on,
        canChange,
        reason: canChange ? null : (canConfigure ? (extra.disabledReason ?? null) : needsEventSettings),
        confirmOff: { title: `Turn off ${copy.title}?`, body: copy.off, confirmLabel: `Turn off ${copy.title}` },
        confirmOn: null,
      },
      action: { type: "event-column", field },
      settings: canConfigure ? settingsLink(input, "/more/event-settings") : null,
      request: null,
    };
  };
  rows.push(columnRow("waitlistEnabled"));
  rows.push(columnRow("autoPromoteWaitlist", input.flags.waitlistEnabled ? {} : { disabledReason: "Turn on the waitlist first." }));
  rows.push(columnRow("collectsShirtSizes"));
  rows.push(columnRow("hostedPaymentLinkEnabled"));
  rows.push(columnRow("checksAdultBackgrounds"));

  // The general registration link and teams: club events only.
  if (club && input.generalLink) {
    const link = input.generalLink;
    const canChange = canConfigure && (link.enabled || link.eligible);
    rows.push({
      id: "general-link",
      title: "General registration link",
      description: "One public link for every club to register a team, with no account needed.",
      state: link.enabled ? "on" : "off",
      stateLabel: link.enabled ? "On" : "Off",
      control: {
        on: link.enabled,
        canChange,
        reason: canChange ? null : (!canConfigure ? needsEventSettings : link.problem),
        confirmOff: {
          title: "Turn off the general registration link?",
          body: "The public page is hidden. Teams already waiting for a club stay in the list.",
          confirmLabel: "Turn off the link",
        },
        confirmOn: null,
      },
      action: { type: "general-link" },
      settings: canConfigure ? { href: `/more/event-settings${input.eventQuery}#general-link`, label: "Settings" } : null,
      request: null,
    });
    rows.push({
      id: "teams",
      title: "Several teams per club",
      description: "Clubs register named teams, with team size and alternate rules, instead of one registration each.",
      state: input.teamsEnabled ? "on" : "off",
      stateLabel: input.teamsEnabled ? "On" : "Off",
      control: {
        on: input.teamsEnabled,
        canChange: canConfigure,
        reason: canConfigure ? null : needsEventSettings,
        confirmOff: {
          title: "Turn off several teams per club?",
          body: "Each club goes back to one registration. It is refused once any team has registered.",
          confirmLabel: "Turn off teams",
        },
        confirmOn: null,
      },
      action: { type: "teams" },
      settings: canConfigure ? settingsLink(input, "/more/event-settings") : null,
      request: null,
    });
  } else {
    for (const [id, title, description] of [
      ["general-link", "General registration link", "One public link for every club to register a team, with no account needed."],
      ["teams", "Several teams per club", "Clubs register named teams, with team size and alternate rules."],
    ] as const) {
      rows.push({ id, title, description, state: "not-applicable", stateLabel: "Club events only", control: null, action: null, settings: null, request: null });
    }
  }

  // Publishing: its own action, with the readiness check on the server.
  const published = input.flags.isPublished;
  rows.push({
    id: "publish",
    title: "Published",
    description: "Public registration for this event. Publishing needs a published registration form and the event details.",
    state: published ? "on" : "off",
    stateLabel: published ? "Published" : "Private draft",
    control: {
      on: published,
      canChange: canConfigure,
      reason: canConfigure ? null : needsEventSettings,
      confirmOff: {
        title: "Unpublish this event?",
        body: "Every public registration form closes immediately. Anyone with the link sees the event as unavailable until it is published again. Registrations already submitted are not affected.",
        confirmLabel: "Unpublish event",
      },
      confirmOn: {
        title: "Publish this event?",
        body: "Publishing turns on the event's public registration links. Form versions and registration dates still control what attendees can submit. If something is missing, nothing is published and you are told what.",
        confirmLabel: "Publish event",
      },
    },
    action: { type: "publish" },
    settings: canConfigure ? settingsLink(input, "/more/event-settings") : null,
    request: null,
  });

  // The public calendar: a system administrator's switch, and only for a published event.
  const showing = input.flags.showOnCalendar;
  const calendarCanChange = input.isSystemAdmin && published;
  rows.push({
    id: "calendar",
    title: "Show on the public calendar",
    description: "A published event appears on the conference calendar unless it is hidden here.",
    state: showing ? "on" : "off",
    stateLabel: !published ? (showing ? "On once published" : "Hidden") : showing ? "On the calendar" : "Hidden",
    control: {
      on: showing,
      canChange: calendarCanChange,
      reason: calendarCanChange ? null : (!input.isSystemAdmin ? needsSystemAdmin : "Publish the event first."),
      confirmOff: {
        title: "Hide this event from the public calendar?",
        body: "The event stays published and keeps its registration links. It no longer appears on the public calendar.",
        confirmLabel: "Hide from the calendar",
      },
      confirmOn: null,
    },
    action: { type: "calendar" },
    settings: input.isSystemAdmin ? { href: "/admin/calendar", label: "Settings" } : null,
    request: null,
  });

  // Lodging and meals have no switch: set up or not, with a link to their pages.
  rows.push({
    id: "lodging",
    title: "Lodging",
    description: "Rooms, beds and sites for this event, with capacity, holds and assignments.",
    state: input.lodgingSetUp ? "set-up" : "not-set-up",
    stateLabel: input.lodgingSetUp ? "Set up" : "Not set up",
    control: null,
    action: null,
    settings: cardLink(input, "lodging", input.lodgingSetUp ? "Settings" : "Set up"),
    request: null,
  });
  rows.push({
    id: "meals",
    title: "Meals",
    description: "Meal services, plans and prices, walk-up orders and meal tickets.",
    state: input.mealsSetUp ? "set-up" : "not-set-up",
    stateLabel: input.mealsSetUp ? "Set up" : "Not set up",
    control: null,
    action: null,
    settings: cardLink(input, "meals", input.mealsSetUp ? "Settings" : "Set up"),
    request: null,
  });

  return rows;
}
