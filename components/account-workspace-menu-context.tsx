"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AccountNavItem } from "@/components/account-section-nav";

const AccountWorkspaceMenuItems = createContext<AccountNavItem[]>([]);

/**
 * The portal layout decides which account destinations this session may see (`workspaceMenuNavItems`, including the
 * staff act-as filtering) and hands that one list down here, so the club and coordinator mastheads show the "Your
 * account" drop-down in their own header row without working the list out again (#1555).
 */
export function AccountWorkspaceMenuProvider({ items, children }: { items: AccountNavItem[]; children: ReactNode }) {
  return <AccountWorkspaceMenuItems.Provider value={items}>{children}</AccountWorkspaceMenuItems.Provider>;
}

/** The destinations the layout allowed; empty outside the provider, where the menu renders nothing. */
export function useAccountWorkspaceItems() {
  return useContext(AccountWorkspaceMenuItems);
}
