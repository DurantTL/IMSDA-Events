"use client";

import { useId, useState, type InputHTMLAttributes } from "react";
import { FieldError, fieldErrorProps } from "@/components/field-error";
import { inlineFieldProblem, inputAttributesFor } from "@/lib/field-validation";

type EmailInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue" | "onChange" | "inputMode"> & {
  /** What the message calls the field, for example "Email". */
  label: string;
  /** The value saved on the record now. An address equal to it is an old one left alone and only warns. */
  stored?: string | null;
  /** Controlled use: pass `value` and `onValueChange`. Otherwise the input keeps its own value, so a plain form post still sees `name`. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** A message from the form's own check or the server, shown through the same field message when the input has none of its own. */
  error?: string;
  /** The id of the message, when something else (a summary) already points at one. */
  errorId?: string;
  /** Show the message now, not only after the person leaves the field (a failed save attempt). */
  showNow?: boolean;
};

/**
 * An email input with the one shared message (#1451), the counterpart of `PhoneInput`. A changed address that fails
 * the shared check shows `EMAIL_FIELD_MESSAGE` after the person leaves the field (or at once with `showNow`).
 * An old saved address left as it is only warns. The server decides again. The message never repeats the address.
 * Forms that use it set `noValidate`, so the browser's own bubble never competes with this message.
 */
export function EmailInput({ label, stored, value, defaultValue = "", onValueChange, showNow = false, error = "", errorId, ...rest }: EmailInputProps) {
  const [own, setOwn] = useState(defaultValue);
  const [left, setLeft] = useState(false);
  const generatedId = useId();
  const messageId = errorId ?? generatedId;
  const current = value ?? own;
  const problem = inlineFieldProblem(label, "email", current, stored, left || showNow);
  const attributes = inputAttributesFor("email");
  const blocking = problem.blocking && Boolean(problem.message);
  // The input's own message wins; otherwise one handed in from the form or the server.
  const outside = !blocking && Boolean(error);
  const shown = blocking ? problem.message : error;
  return (
    <>
      <input
        autoComplete={attributes.autoComplete}
        maxLength={160}
        {...rest}
        {...(blocking || outside
          ? fieldErrorProps(messageId, shown, rest["aria-describedby"])
          : { "aria-describedby": problem.message ? messageId : rest["aria-describedby"] })}
        inputMode={attributes.inputMode}
        onBlur={(event) => {
          setLeft(true);
          rest.onBlur?.(event);
        }}
        onChange={(event) => {
          setOwn(event.target.value);
          onValueChange?.(event.target.value);
        }}
        type={attributes.type}
        value={current}
      />
      {blocking || outside
        ? <FieldError className="field-error-message phone-input-message is-error" id={messageId}>{shown}</FieldError>
        : problem.message ? <small className="phone-input-message is-notice" id={messageId} role="status">{problem.message}</small> : null}
    </>
  );
}

/** The message a changed email would show on a failed submit, or "" when it passes (for the error summary). */
export function emailBlockingMessage(label: string, value: string, stored?: string | null) {
  const problem = inlineFieldProblem(label, "email", value, stored, true);
  return problem.blocking ? problem.message : "";
}
