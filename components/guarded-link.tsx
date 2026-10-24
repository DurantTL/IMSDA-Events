"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";
import { isPlainClick } from "@/components/more-launcher-model";
import { guardedNavigate } from "@/components/unsaved-changes-registry";

/**
 * A link that runs the existing unsaved-changes guard (#647) before it changes
 * the URL (#1180). A plain click goes through `guardedNavigate`: nothing dirty
 * navigates at once; a dirty form asks first, and Cancel changes nothing, not
 * even `onNavigate` (which closes a menu or records local context). A modified
 * click (new tab) keeps the link's normal behavior, and without scripts it is
 * still an ordinary link.
 */
export function GuardedLink({
  href,
  onClick,
  onNavigate,
  ...rest
}: Omit<ComponentProps<typeof Link>, "href"> & {
  href: string;
  /** Runs once navigation is going ahead (after any confirmation), just before the URL changes. */
  onNavigate?: () => void;
}) {
  const router = useRouter();
  return (
    <Link
      {...rest}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || !isPlainClick(event.nativeEvent)) return;
        event.preventDefault();
        guardedNavigate(() => {
          onNavigate?.();
          router.push(href);
        });
      }}
    />
  );
}
