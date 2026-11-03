"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
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
export function HelpReturnTracker() {
  const pathname = usePathname();
  useEffect(() => {
    const here = clubHelpReturnPath(`${pathname}${window.location.search}`) ?? clubHelpReturnPath(pathname);
    if (!here) return;
    try {
      window.sessionStorage.setItem(HELP_RETURN_STORAGE_KEY, here);
    } catch {
      // Storage can be blocked; Help's Back then uses its fixed page.
    }
  }, [pathname]);
  return null;
}

const subscribeNever = () => () => {};

/**
 * The Back link on Help pages (#1553): the club page the director came from (`from`, already checked on the server,
 * else the one this tab remembered), else the fixed Help page. The server render always shows the fixed page.
 */
export function HelpBackLink({ from, fallbackHref, fallbackLabel, hideWithoutTarget = false }: { from: string | null; fallbackHref: string; fallbackLabel: string; /** On the Help index there is no fixed parent: show the link only when a club page is known. */ hideWithoutTarget?: boolean }) {
  const stored = useSyncExternalStore(subscribeNever, readStored, () => null);
  const target = clubHelpReturnPath(from) ?? stored;
  if (!target && hideWithoutTarget) return null;
  return target
    ? <BackLink href={target}>Back to where you were</BackLink>
    : <BackLink href={fallbackHref}>{fallbackLabel}</BackLink>;
}
