"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { createBackGuard } from "@/components/link-guard";
import {
  confirmLeave,
  setLeaveConfirmer,
  subscribeUnsavedChanges,
  unsavedChangesMessage,
} from "@/components/unsaved-changes-registry";

/**
 * The one in-page "Leave without saving?" dialog (#1452), mounted once in the
 * root layout so every page, public ones included, gets it. It installs itself
 * as the registry's leave confirmer, so links, guarded router navigation and
 * browser Back all ask in the shared `ConfirmDialog` instead of the browser's own box.
 * It also runs the Back guard, which lives here because this component outlives
 * page changes. Reload and closing the tab can only use the browser's own
 * prompt (`beforeunload`, in `useUnsavedChangesGuard`).
 */
export function UnsavedChangesDialogHost() {
  const [message, setMessage] = useState<string | null>(null);
  const resolver = useRef<((leave: boolean) => void) | null>(null);

  const settle = useCallback((leave: boolean) => {
    const resolve = resolver.current;
    resolver.current = null;
    setMessage(null);
    resolve?.(leave);
  }, []);

  useEffect(() => {
    const removeConfirmer = setLeaveConfirmer((text) => {
      // A second question while one is open answers the first with "keep editing".
      resolver.current?.(false);
      return new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setMessage(text);
      });
    });
    const backGuard = createBackGuard({
      history: window.history,
      href: () => window.location.href,
      message: unsavedChangesMessage,
      ask: confirmLeave,
    });
    const unsubscribe = subscribeUnsavedChanges(backGuard.onDirtyChange);
    const onPopState = (event: PopStateEvent) => backGuard.onPopState(event);
    window.addEventListener("popstate", onPopState);
    backGuard.onDirtyChange();
    return () => {
      removeConfirmer();
      unsubscribe();
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  return (
    <ConfirmDialog
      cancelLabel="Keep editing"
      confirmLabel="Leave without saving"
      destructive
      onCancel={() => settle(false)}
      onConfirm={() => settle(true)}
      open={message !== null}
      title="Leave without saving?"
    >
      <p>{message}</p>
    </ConfirmDialog>
  );
}
