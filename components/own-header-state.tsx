"use client";

import { usePathname } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { pageOwnsHeader } from "@/components/page-header-routes";
import { staffShellPageTitle } from "@/components/staff-navigation";

/**
 * The page's one h1 for the states that replace a page (#1772): not found, an error, and loading. On a route in
 * `components/page-header-routes.ts` the shell draws no title, and the page that would have drawn it is not on screen, so
 * this draws it, in the words the shell would have used. On every other route it draws nothing, because the shell's own
 * title is there.
 */
export function OwnHeaderState() {
  const pathname = usePathname() ?? "";
  if (!pageOwnsHeader(pathname)) return null;
  return <PageHeader title={staffShellPageTitle(pathname)} />;
}
