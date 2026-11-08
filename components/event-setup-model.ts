import { eventFeaturesItem, matchesVisibility, type MoreDirectoryCard } from "@/components/staff-navigation";
import type { EventModulesView } from "@/components/event-modules-page-model";
import type { EventPermission } from "@/modules/access/permissions";
import { mergeLoneCards, splitGroup, type HubBody, type HubCard, type HubGroup } from "@/modules/system-admin/admin-hubs-model";

/**
 * The Event setup page (`/more`, #1586): everything an event is set up with, as grouped cards. Pure model, so what each
 * person is offered is testable without rendering the page.
 *
 * Rules the model keeps:
 * - A card shows only when the viewer may open its page (the directory card's own permission result) and, for a module-owned
 *   page, the module is on for this event. Both come from `buildEventModulesView`, the rule the page used before it became
 *   cards, so the two cannot disagree. Nothing planned and nothing the viewer cannot reach is listed.
 * - Every card is a link and carries `?event=`. Nothing here saves, publishes or changes a record.
 * - Pages that belong to another tab (the attendee list, imports, reports, health, community) are not setup cards.
 * - A group a gate leaves with one card joins its smaller neighbour (`mergeLoneCards`) and its heading names both groups ("Registration / Program");
 *   a group over six is split in two.
 */

/** One entry of a group: a More directory card by key, or Event features, which is a navigation item and not a directory card. */
type SetupEntry = { key: string };

const groupDefs: ReadonlyArray<{ title: string; entries: readonly SetupEntry[] }> = [
  { title: "Basics", entries: [{ key: "event-settings" }, { key: "event-features" }, { key: "emergency-plans" }, { key: "event-content" }] },
  { title: "Registration", entries: [{ key: "registration-builder" }, { key: "attendee-configuration" }, { key: "tags" }, { key: "information-forms" }] },
  { title: "Program", entries: [{ key: "honors" }, { key: "program-assignments" }, { key: "meals" }] },
  { title: "Lodging and items", entries: [{ key: "lodging" }, { key: "lodging-assignments" }, { key: "lodging-requests" }, { key: "issued-assets" }] },
  { title: "Sales", entries: [{ key: "merchandise" }, { key: "promo-codes" }] },
  {
    title: "People and clubs",
    entries: [{ key: "staff" }, { key: "clubs-and-churches" }, { key: "clubs" }, { key: "club-assignments" }, { key: "club-forms" }, { key: "event-health" }, { key: "event-patches" }],
  },
];

/** The directory keys the Event setup page lists, in order. Every other directory card belongs to another tab. */
export const eventSetupCardKeys: readonly string[] = groupDefs.flatMap((group) => group.entries.map((entry) => entry.key));

export const eventFeaturesCardCopy = "Turn the features this event uses on or off, and see what each one changes. Turning one off never deletes its data.";
/** Promo codes are a Money page; the card is the same page, and says where it lives. */
export const promoCodesLivesInMoney = "Lives in Money.";

export function eventSetupIntro(eventName: string): string {
  return `Everything you set for ${eventName}, on one page. Each item opens its own page.`;
}

export function buildEventSetupView({
  eventName,
  eventQuery,
  permissions,
  view,
}: {
  eventName: string;
  /** `?event=<id>`, or `""` when no event is selected. */
  eventQuery: string;
  permissions: readonly EventPermission[];
  /** From `buildEventModulesView`: its enabled module cards and allowed tools are exactly what may be shown. */
  view: Pick<EventModulesView, "enabled" | "tools">;
}): HubBody {
  const available = new Map<string, MoreDirectoryCard>();
  for (const entry of view.enabled) available.set(entry.card.key, entry.card);
  for (const card of view.tools) available.set(card.key, card);

  const withEvent = (href: string) => (href.includes("event=") || !eventQuery ? href : `${href}${href.includes("?") ? "&" : "?"}${eventQuery.slice(1)}`);

  const toCard = (key: string): HubCard | null => {
    if (key === "event-features") {
      if (!matchesVisibility(eventFeaturesItem, new Set(permissions))) return null;
      return { href: withEvent(eventFeaturesItem.href), title: eventFeaturesItem.label, description: eventFeaturesCardCopy, status: null };
    }
    const card = available.get(key);
    if (!card) return null;
    const description = key === "promo-codes" ? `${card.description} ${promoCodesLivesInMoney}` : card.description;
    return { href: withEvent(card.href), title: card.title, description, status: null };
  };

  // Each card remembers the group it was drawn for, so a group that took in a lone card can say so in its heading.
  const gated = groupDefs
    .map((group) => ({ title: group.title, cards: group.entries.map((entry) => toCard(entry.key)).filter((card): card is HubCard => card !== null).map((card) => ({ card, from: group.title })) }))
    .filter((group) => group.cards.length > 0);
  const groups: HubGroup[] = mergeLoneCards(gated)
    .map((group) => {
      const origins = [...new Set(group.cards.map((entry) => entry.from))];
      return { title: origins.length > 1 ? origins.join(" / ") : group.title, cards: group.cards.map((entry) => entry.card) };
    })
    .flatMap((group) => splitGroup(group));
  return { key: "event-setup", description: eventSetupIntro(eventName), groups };
}
