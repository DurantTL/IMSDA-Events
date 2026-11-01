"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import styles from "@/components/use-confirm.module.css";

/**
 * What one confirmation says (#743). `title` and `confirmLabel` name the exact
 * object and action ("Delete Spring Camporee 2027"), `body` states the
 * consequence. Never "OK".
 */
export type ConfirmInput = {
  label: string;
  defaultValue?: string;
  /** Confirm stays disabled (and Enter does nothing) while the trimmed value is empty. */
  required?: boolean;
  type?: "text" | "email" | "url";
  /** Read by screen readers with the field (aria-describedby) and shown under it. */
  hint?: string;
  maxLength?: number;
  /** Confirm stays disabled until the trimmed value is at least this long (the server's own minimum). */
  minLength?: number;
  multiline?: boolean;
};

export type ConfirmRequest = {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Deletes, removals, withdrawals and anything that can't be undone. */
  destructive?: boolean;
  /** Adds a text field to the dialog; answered through `ask`, which resolves the entered text. */
  input?: ConfirmInput;
};

export type AskRequest = ConfirmRequest & { input: ConfirmInput };

export type PendingConfirm = ConfirmRequest & { resolve: (confirmed: boolean, value?: string) => void };

/** Whether `value` satisfies the field's required and minLength rules (trimmed). */
export function inputIsValid(input: ConfirmInput, value: string) {
  const length = value.trim().length;
  if (input.required && length === 0) return false;
  return length >= (input.minLength ?? 0) || (!input.required && length === 0);
}

/**
 * The state machine behind `useConfirm`, free of React so it can be tested
 * directly. One request is open at a time: asking again cancels the first
 * (resolves it false); `settle` resolves the open one and clears it.
 */
export function createConfirmController(onChange: (pending: PendingConfirm | null) => void) {
  let current: PendingConfirm | null = null;
  function open(request: ConfirmRequest, resolve: PendingConfirm["resolve"]) {
    current?.resolve(false);
    current = { ...request, resolve };
    onChange(current);
  }
  return {
    request(request: ConfirmRequest) {
      return new Promise<boolean>((resolve) => open(request, (confirmed) => resolve(confirmed)));
    },
    /** Resolves the trimmed text on Confirm, null on Cancel, Escape or the backdrop. */
    ask(request: AskRequest) {
      return new Promise<string | null>((resolve) => open(request, (confirmed, value) => resolve(confirmed ? (value ?? "").trim() : null)));
    },
    settle(confirmed: boolean, value?: string) {
      const pending = current;
      // A required field can't be confirmed empty, whichever way Confirm was reached.
      if (confirmed && pending?.input && !inputIsValid(pending.input, value ?? "")) return;
      current = null;
      onChange(null);
      pending?.resolve(confirmed, value);
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
  const [value, setValue] = useState("");
  const [controller] = useState(() => createConfirmController(setPending));
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const hintId = useId();
  const confirm = controller.request;
  const ask = (request: AskRequest) => {
    setValue(request.input.defaultValue ?? "");
    return controller.ask(request);
  };
  const settle = controller.settle;
  const input = pending?.input;
  const valid = !input || inputIsValid(input, value);
  const submit = () => settle(true, input ? value : undefined);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (valid) submit();
  }

  const fieldProps = input ? {
    "aria-describedby": input.hint ? hintId : undefined,
    maxLength: input.maxLength,
    minLength: input.minLength,
    onChange: (event: { target: { value: string } }) => setValue(event.target.value),
    ref: inputRef,
    value,
  } : null;

  const confirmDialog = (
    <ConfirmDialog
      cancelLabel={pending?.cancelLabel}
      confirmDisabled={!valid}
      confirmLabel={pending?.confirmLabel ?? "Confirm"}
      destructive={pending?.destructive}
      initialFocus={input ? () => inputRef.current : undefined}
      onCancel={() => settle(false)}
      onConfirm={submit}
      open={pending !== null}
      title={pending?.title ?? ""}
    >
      {pending?.body}
      {input && fieldProps ? (
        <label className={styles.field}>
          {input.label}
          {input.multiline
            ? <textarea {...fieldProps} required={input.required} rows={3} />
            : <input {...fieldProps} onKeyDown={onKeyDown} required={input.required} type={input.type ?? "text"} />}
        </label>
      ) : null}
      {input?.hint ? <p className={styles.hint} id={hintId}>{input.hint}</p> : null}
    </ConfirmDialog>
  );

  return { confirm, ask, confirmDialog };
}
