"use client";

import { useState, type ReactNode } from "react";
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

export type PendingConfirm = ConfirmRequest & { resolve: (confirmed: boolean) => void };

/**
 * The state machine behind `useConfirm`, free of React so it can be tested
 * directly. One request is open at a time: asking again cancels the first
 * (resolves it false); `settle` resolves the open one and clears it.
 */
export function createConfirmController(onChange: (pending: PendingConfirm | null) => void) {
  let current: PendingConfirm | null = null;
  return {
    request(request: ConfirmRequest) {
      return new Promise<boolean>((resolve) => {
        current?.resolve(false);
        current = { ...request, resolve };
        onChange(current);
      });
    },
    settle(confirmed: boolean) {
      const open = current;
      current = null;
      onChange(null);
      open?.resolve(confirmed);
    },
  };
}

/**
 * A promise-shaped replacement for `window.confirm()`: `if (!(await confirm({...}))) return;`
 * resolves true on Confirm and false on Cancel, Escape or the backdrop. Render
 * `confirmDialog` once in the component's JSX. `window.confirm()` can silently
 * fail to show on iOS Safari (#466); the in-page dialog cannot.
 */
export function useConfirm() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [controller] = useState(() => createConfirmController(setPending));
  const confirm = controller.request;
  const settle = controller.settle;

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
