"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { clubSummaryAnchors, type ClubSummaryView } from "@/modules/club-reports/club-directory-domain";

/** Keep existing #points / #club-events bookmarks working after the reports became separate views. */
export function clubSummaryLegacyUrl(href: string): string | null {
  const url = new URL(href);
  const view = (Object.entries(clubSummaryAnchors) as [ClubSummaryView, string][]).find(([, anchor]) => url.hash === `#${anchor}`)?.[0];
  if (!view || (url.searchParams.get("view") ?? "directory") === view) return null;
  url.searchParams.set("view", view);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function ClubSummaryLegacyAnchor() {
  const router = useRouter();
  useEffect(() => {
    const restoreView = () => {
      const target = clubSummaryLegacyUrl(window.location.href);
      if (target) router.replace(target, { scroll: false });
    };
    restoreView();
    window.addEventListener("hashchange", restoreView);
    return () => window.removeEventListener("hashchange", restoreView);
  }, [router]);
  return null;
}
