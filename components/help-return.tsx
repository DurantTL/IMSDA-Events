"use client";

import { Suspense, useEffect, useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { clubHelpReturnPath, HELP_RETURN_STORAGE_KEY } from "@/lib/help-return";

function readStored(): string | null {
  try {
    return clubHelpReturnPath(window.sessionStorage.getItem(HELP_RETURN_STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * Remembers the last club page in this tab (#1553), so Help's Back can return to it from any club page. It renders
 * nothing and stores only an internal club path, never anything about a person.
 */
function Tracker() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    const here = clubHelpReturnPath(search ? `${pathname}?${search}` : pathname);
    try {
      if (here) window.sessionStorage.setItem(HELP_RETURN_STORAGE_KEY, here);
      // Help pages keep what was remembered; any other portal page that is not a club page forgets it, so Back is never stale.
      else if (!pathname.startsWith("/account/help")) window.sessionStorage.removeItem(HELP_RETURN_STORAGE_KEY);
    } catch {
      // Storage can be blocked; Help's Back then uses its fixed page.
    }
  }, [pathname, search]);
  return null;
}

export function HelpReturnTracker() {
  return <Suspense fallback={null}><Tracker /></Suspense>;
}

const subscribeNever = () => () => {};

/**
 * The Back link on Help pages (#1553): the club page the director came from (`from`, already checked on the server;
 * the Help index also falls back on the one this tab remembered), else the fixed Help page. The server render always shows the fixed page.
 */
export function HelpBackLink({ from, fallbackHref, fallbackLabel, hideWithoutTarget = false, useRemembered = false }: { from: string | null; fallbackHref: string; fallbackLabel: string; /** On the Help index there is no fixed parent: show the link only when a club page is known. */ hideWithoutTarget?: boolean; /** Only the Help index may fall back on the remembered club page; a guide uses its own `from`. */ useRemembered?: boolean }) {
  const stored = useSyncExternalStore(subscribeNever, readStored, () => null);
  const target = clubHelpReturnPath(from) ?? (useRemembered ? stored : null);
  if (!target && hideWithoutTarget) return null;
  return target
    ? <BackLink href={target}>Back to where you were</BackLink>
    : <BackLink href={fallbackHref}>{fallbackLabel}</BackLink>;
}
