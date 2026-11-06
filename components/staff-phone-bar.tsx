"use client";

import type { ReactNode } from "react";
import { CalendarDays, CheckCircle2, Home, MoreHorizontal, Tent } from "lucide-react";
import { GuardedLink } from "@/components/guarded-link";
import { MoreLauncher, type LauncherSection } from "@/components/more-launcher";
import type { SearchDestination } from "@/components/destination-search-model";
import type { MoreDirectoryCard } from "@/components/staff-navigation";
import type { ModuleDestinationEntry } from "@/components/module-destination-states";
import { phoneBarCurrent, type PhoneBarItem, type PhoneBarKey } from "@/components/staff-phone-bar-model";
import type { StaffPlace } from "@/components/staff-areas";
import type { EventTabKey } from "@/components/staff-event-tabs";

const icons: Record<PhoneBarKey, typeof Home> = { home: Home, events: CalendarDays, "check-in": CheckCircle2, clubs: Tent, more: MoreHorizontal };

/**
 * The phone's bottom bar (#1565). Plain links, so it stays a navigation bar and never an action bar; More opens the sheet
 * with "This event" first, then the other areas and the event's tools. The current item has the gold top bar.
 */
export function StaffPhoneBar({
  items,
  place,
  eventTab,
  firstEventTab = null,
  launcher,
}: {
  items: readonly PhoneBarItem[];
  place: Pick<StaffPlace, "area" | "inEvent">;
  eventTab: EventTabKey | null;
  firstEventTab?: EventTabKey | null;
  launcher: {
    cards: readonly MoreDirectoryCard[];
    sections: readonly LauncherSection[];
    moduleStates: readonly ModuleDestinationEntry[];
    destinations: readonly SearchDestination[];
    isSystemAdmin: boolean;
    canRequestFeature: boolean;
    eventQuery: string;
    eventId?: string;
    removableModules?: readonly string[];
    userId: string;
  };
}) {
  if (items.length === 0) return null;
  const current = phoneBarCurrent(items, place, eventTab, firstEventTab);
  return (
    <nav className="mobile-nav" aria-label="Mobile navigation">
      {items.map((item): ReactNode => {
        const Icon = icons[item.key];
        const isActive = current === item.key;
        if (item.key === "more") {
          return (
            <MoreLauncher
              key={item.key}
              variant="tab"
              className={isActive ? "active" : undefined}
              href={item.href}
              isActive={isActive}
              cards={launcher.cards}
              sections={launcher.sections}
              moduleStates={launcher.moduleStates}
              destinations={launcher.destinations}
              isSystemAdmin={launcher.isSystemAdmin}
              canRequestFeature={launcher.canRequestFeature}
              eventQuery={launcher.eventQuery}
              eventId={launcher.eventId}
              removableModules={launcher.removableModules}
              userId={launcher.userId}
            >
              <Icon aria-hidden="true" size={22} /><span>{item.label}</span>
            </MoreLauncher>
          );
        }
        return (
          <GuardedLink className={isActive ? "active" : undefined} href={item.href} key={item.key} aria-current={isActive ? "page" : undefined}>
            <Icon aria-hidden="true" size={22} /><span>{item.label}</span>
          </GuardedLink>
        );
      })}
    </nav>
  );
}
