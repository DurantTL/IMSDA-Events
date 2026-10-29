import type { AccountNavItem } from "@/components/account-section-nav";

export function isAccountNavItemActive(pathname: string, item: AccountNavItem) {
  if (pathname === item.href) return true;
  if (item.alsoMatchPrefix && pathname.startsWith(item.alsoMatchPrefix)) return true;
  return Boolean(item.matchChildren) && pathname.startsWith(`${item.href}/`);
}
