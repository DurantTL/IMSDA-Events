import type { AccountNavItem } from "@/components/account-section-nav";

export function isAccountNavItemActive(pathname: string, item: AccountNavItem) {
  if (pathname === item.href) return true;
  const prefixes = item.alsoMatchPrefix === undefined ? [] : typeof item.alsoMatchPrefix === "string" ? [item.alsoMatchPrefix] : item.alsoMatchPrefix;
  if (prefixes.some((prefix) => prefix !== "" && pathname.startsWith(prefix))) return true;
  return Boolean(item.matchChildren) && pathname.startsWith(`${item.href}/`);
}
