"use client";

import { useCallback, useEffect, useRef } from "react";
import { createLinkNavigationListener } from "@/components/link-guard";
import { registerUnsavedChanges } from "@/components/unsaved-changes-registry";

const defaultMessage = "You have unsaved changes. Leave this page and discard them?";

export function useUnsavedChangesGuard(
  hasUnsavedChanges: boolean,
  message = defaultMessage,
) {
  const allowNavigationRef = useRef(false);

  // Expose the dirty state to programmatic navigation (#647).
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    return registerUnsavedChanges(message);
  }, [hasUnsavedChanges, message]);

  useEffect(() => {
    if (!hasUnsavedChanges) {
      allowNavigationRef.current = false;
      return;
    }

    function beforeUnload(event: BeforeUnloadEvent) {
      if (allowNavigationRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    }

    // One confirm per click: a yes marks the click so `GuardedLink` does not ask again (#1180).
    const beforeLinkNavigation = createLinkNavigationListener({
      message,
      confirm: (text) => window.confirm(text),
      currentHref: () => window.location.href,
      isAllowed: () => allowNavigationRef.current,
    });

    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", beforeLinkNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", beforeLinkNavigation, true);
    };
  }, [hasUnsavedChanges, message]);

  return useCallback(() => {
    allowNavigationRef.current = true;
  }, []);
}
