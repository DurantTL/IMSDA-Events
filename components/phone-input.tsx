"use client";

import { useId, useState, type InputHTMLAttributes } from "react";
import { FieldError, fieldErrorProps } from "@/components/field-error";
import { inlinePhoneProblem, inputAttributesFor, validatePhone } from "@/lib/field-validation";

type PhoneInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue" | "onChange" | "inputMode"> & {
  /** What the message calls the field, for example "Phone". */
  label: string;
  /** The value saved on the record now. A number equal to it is an old one left alone and only warns (#871). */
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
 * A phone input with the shared inline message (#871). Drop it inside the existing label. A changed number that is
 * not a valid phone shows the fixable message after the person leaves the field; an old saved number left as it is
 * is flagged "needs correcting" but never blocks. The server decides again from the stored value. The message
 * describes the problem and never repeats the number.
 */
export function PhoneInput({ label, stored, value, defaultValue = "", onValueChange, showNow = false, error = "", errorId, ...rest }: PhoneInputProps) {
  const [own, setOwn] = useState(defaultValue);
  const [left, setLeft] = useState(false);
  const generatedId = useId();
  const messageId = errorId ?? generatedId;
  const current = value ?? own;
  const problem = inlinePhoneProblem(label, current, stored, left || showNow);
  const attributes = inputAttributesFor("phone");
  const blocking = problem.blocking && Boolean(problem.message);
  // The input's own message wins; otherwise one handed in from the form or the server.
  const outside = !blocking && Boolean(error);
  const shown = blocking ? problem.message : error;
  return (
    <>
      <input
        autoComplete={attributes.autoComplete}
        maxLength={40}
        {...rest}
        {...(blocking || outside
          ? fieldErrorProps(messageId, shown, rest["aria-describedby"])
          : { "aria-describedby": problem.message ? messageId : rest["aria-describedby"] })}
        inputMode={attributes.inputMode}
        onBlur={(event) => {
          setLeft(true);
          // Tidy a valid number on leaving the field (#1451): "5155550134" becomes "(515) 555-0134". A number that
          // does not pass, such as an old saved one, is left exactly as it is.
          const check = validatePhone(current);
          if (check.ok && check.value !== current) {
            setOwn(check.value);
            onValueChange?.(check.value);
          }
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

/** The message a changed phone would show on a failed submit, or "" when it passes (for the error summary). */
export function phoneBlockingMessage(label: string, value: string, stored?: string | null) {
  const problem = inlinePhoneProblem(label, value, stored, true);
  return problem.blocking ? problem.message : "";
}

/** True when a changed phone would fail the shared check, for a submit handler to stop on. */
export function phoneBlocks(label: string, value: string, stored?: string | null) {
  return inlinePhoneProblem(label, value, stored, true).blocking;
}
