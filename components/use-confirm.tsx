"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";

/**
 * What one confirmation says (#743). `title` and `confirmLabel` name the exact
 * object and action ("Delete Spring Camporee 2027"), `body` states the
 * consequence. Never "OK".
 */
export type ConfirmRequest = {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Deletes, removals, withdrawals and anything that can't be undone. */
  destructive?: boolean;
};

type Pending = ConfirmRequest & { resolve: (confirmed: boolean) => void };

/**
 * A promise-shaped replacement for `window.confirm()`: `if (!(await confirm({...}))) return;`
 * resolves true on Confirm and false on Cancel, Escape or the backdrop. Render
 * `confirmDialog` once in the component's JSX. `window.confirm()` can silently
 * fail to show on iOS Safari (#466); the in-page dialog cannot.
 */
export function useConfirm() {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);

  const settle = useCallback((confirmed: boolean) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    current?.resolve(confirmed);
  }, []);

  const confirm = useCallback((request: ConfirmRequest) => new Promise<boolean>((resolve) => {
    // A second request while one is open cancels the first.
    pendingRef.current?.resolve(false);
    const next = { ...request, resolve };
    pendingRef.current = next;
    setPending(next);
  }), []);

  const confirmDialog = (
    <ConfirmDialog
      cancelLabel={pending?.cancelLabel}
      confirmLabel={pending?.confirmLabel ?? "Confirm"}
      destructive={pending?.destructive}
      onCancel={() => settle(false)}
      onConfirm={() => settle(true)}
      open={pending !== null}
      title={pending?.title ?? ""}
    >
      {pending?.body}
    </ConfirmDialog>
  );

  return { confirm, confirmDialog };
}
