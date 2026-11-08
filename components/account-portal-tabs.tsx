"use client";

import { createContext, useContext, type ReactNode } from "react";
import { ClubPortalNav } from "@/components/club-portal-nav";
import type { AccountNavItem } from "@/components/account-section-nav";

const AccountTabItems = createContext<AccountNavItem[]>([]);

/**
 * The portal layout works out the attendee tabs once (`accountPortalNavItems`, with its act-as filtering) and hands the
 * list down here. `AccountPageBanner` draws the row right under its navy band, as the club portal does (#1555).
 */
export function AccountPortalTabsProvider({ items, children }: { items: AccountNavItem[]; children: ReactNode }) {
  return <AccountTabItems.Provider value={items}>{children}</AccountTabItems.Provider>;
}

/** The club portal's underline tab row for the attendee account; nothing outside the provider. */
export function AccountPortalTabs() {
  const items = useContext(AccountTabItems);
  if (items.length === 0) return null;
  return <div className="account-portal-tabs"><ClubPortalNav items={items} label="Your account" menuLabel="Account menu" /></div>;
}
