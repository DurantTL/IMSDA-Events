"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition, type ComponentProps } from "react";
import { handleGuardedLinkClick } from "@/components/link-guard";
import { NavigationPending } from "@/components/navigation-link";

/**
 * A link that runs the existing unsaved-changes guard (#647) before it changes
 * the URL (#1180). A plain click goes through `guardedNavigate`: nothing dirty
 * navigates at once; a dirty form asks first, and Cancel changes nothing, not
 * even `onNavigate` (which closes a menu or records local context). A form that
 * uses `useUnsavedChangesGuard` has already asked on the same click, so the link
 * does not ask twice. A modified click, a link with a target window, or a
 * download keeps the browser's normal behavior, and without scripts it is still
 * an ordinary link. `replace` and `scroll` are passed on to the router.
 */
export function GuardedLink({
  href,
  children,
  onClick,
  onNavigate,
  replace,
  scroll,
  ...rest
}: Omit<ComponentProps<typeof Link>, "href"> & {
  href: string;
  /** Runs once navigation is going ahead (after any confirmation), just before the URL changes. */
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const [pending, startNavigation] = useTransition();
  return (
    <Link
      {...rest}
      href={href}
      replace={replace}
      scroll={scroll}
      onClick={(event) => {
        onClick?.(event);
        handleGuardedLinkClick({
          event,
          target: rest.target,
          download: (rest as { download?: unknown }).download,
          run: () => {
            onNavigate?.();
            startNavigation(() => {
              if (replace) router.replace(href, { scroll });
              else router.push(href, { scroll });
            });
          },
        });
      }}
    >
      {children}
      <NavigationPending pending={pending} />
    </Link>
  );
}
