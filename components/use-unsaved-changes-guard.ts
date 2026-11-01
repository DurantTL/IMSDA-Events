"use client";

import { useCallback, useEffect, useRef } from "react";
import { createLinkNavigationListener } from "@/components/link-guard";
import { confirmLeave, hasNavigationPass, registerUnsavedChanges } from "@/components/unsaved-changes-registry";

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
      if (allowNavigationRef.current || hasNavigationPass()) return;
      event.preventDefault();
      event.returnValue = "";
    }

    // One question per click, in the in-page dialog (#1452). On "Leave" the link is followed again
    // with a one-shot pass, so neither this listener nor `GuardedLink` asks twice (#1180).
    const beforeLinkNavigation = createLinkNavigationListener({
      message,
      confirm: confirmLeave,
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
