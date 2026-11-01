"use client";

import { useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from "react";
import { resolveFormsHelpContact, telHref, type FormsHelpContact } from "@/modules/system-admin/forms-help-contact";
import styles from "./security-check.module.css";

/**
 * The one Cloudflare Turnstile widget every public form and sign-in uses (#1399). A server page passes
 * `config` ({ siteKey, nonce } from `securityCheckConfigForPage`) or null; null renders nothing and the form sends no
 * token, which is how the check stays off until keys are set. The component never decides whether a form may submit:
 * Submit is not disabled. The form asks the handle for the token, and the server has the final say.
 */

export const TURNSTILE_TOKEN_HEADER = "x-turnstile-token";
export const SECURITY_CHECK_LABEL = "Security check";
export const SECURITY_CHECK_FAILED_TEXT =
  "The security check didn't go through. Press Try again in the box. If it keeps failing, turn off a VPN or ad blocker, or contact the conference office.";

/** The words when the check's script is blocked or the check can't start (#1445): a blocker, VPN or privacy setting. */
export const SECURITY_CHECK_BLOCKED_TEXT =
  "The security check could not load. A browser privacy setting, ad blocker or VPN may be blocking it. Turn it off for this site, then press Try again. Your answers are still here.";
export const SECURITY_CHECK_RETRY_LABEL = "Try again";

/**
 * When the check cannot produce a token at all (#1480) the person is never stuck: sign-in, sign-up and password reset
 * offer an emailed code, and the other public forms send without a token so the server's strict limit applies. A token
 * that exists but is rejected is never worked around; that is the server's call and the box says "didn't go through".
 */
export const SECURITY_CHECK_EMAIL_CODE_LABEL = "Email me a code instead";
export const SECURITY_CHECK_CODE_FIELD_LABEL = "Code from your email";
export const SECURITY_CHECK_CODE_HEADER = "x-security-check-code";
export const SECURITY_CHECK_CODE_ENDPOINT = "/api/security-check/email-code";
const CODE_ACTIONS = new Set(["staff-sign-in", "attendee-sign-in", "attendee-sign-up", "forgot-password"]);
const NEED_EMAIL_TEXT = "Type your email address in the form first, then press Email me a code instead.";
const NEED_SEND_TEXT = "Press Email me a code instead, enter the code from your email, then submit again. Your answers are still here.";
const NEED_CODE_TEXT = "Enter the code from your email first. Press Email me a code instead if you need a new one.";
const CODE_USED_TEXT = "That code has been used. To try again, press Email me a code instead for a new one.";
const CODE_SEND_FAILED_TEXT = "We couldn't send a code. Try again, or contact the conference office.";
const CODE_REJECTED_TEXT = "That code didn't work. Check it, or press Email me a code instead to get a new one. Codes work once, for 10 minutes.";

/** The words under the box when Submit was pressed before a token existed. `buttonWord` is the form's own button. */
export function securityCheckMissingText(buttonWord: string) {
  return `Finish the security check above, then press ${buttonWord} again. Your answers are still here.`;
}

const SCRIPT_ID = "cf-turnstile-api";
const SCRIPT_TIMEOUT_MS = 15_000;
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** Any response body: only `code` and `error` are read. */
type SecurityCheckBody = object | null | undefined;

/** `contact` is the office contact shown when the check is blocked; the component falls back on the defaults without it. */
export type SecurityCheckConfig = { siteKey: string; nonce?: string; contact?: FormsHelpContact } | null;

export type SecurityCheckHandle = {
  /** The current single-use token, or null before one exists. */
  token: () => string | null;
  /** Headers to add to the submit request: the token header, or nothing when the check is off or has no token. */
  headers: () => Record<string, string>;
  /**
   * Call when the person presses the submit button. True means go ahead (the check is off, or a token exists). False
   * means no token yet: our message is shown under the box and the form must not send.
   */
  require: (buttonWord: string) => boolean;
  /** True when no token can be produced (script blocked or widget error), so the fallback applies (#1480). */
  unavailable: () => boolean;
  /**
   * Call after every submit attempt that stays on the page. Tokens are single-use, so the widget is reset. Pass the
   * response body: a `security_check_*` code shows the "didn't go through" message.
   */
  settle: (body?: SecurityCheckBody) => void;
  /** True when this response body is the server's security-check rejection. */
  isRejection: (body?: SecurityCheckBody) => boolean;
};

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

/** Loads Cloudflare's script once per page, whatever number of widgets mount. */
function loadTurnstile(nonce: string | undefined): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID);
    const script = existing ?? document.createElement("script");
    // Some blockers hold the request open instead of refusing it: give up after a while so the person sees the message.
    const giveUp = window.setTimeout(() => {
      if (window.turnstile) return;
      scriptPromise = null;
      script.remove();
      reject(new Error("Turnstile took too long to load"));
    }, SCRIPT_TIMEOUT_MS);
    const onLoad = () => {
      window.clearTimeout(giveUp);
      if (window.turnstile) resolve(window.turnstile);
      else {
        scriptPromise = null;
        reject(new Error("Turnstile did not load"));
      }
    };
    const onError = () => {
      window.clearTimeout(giveUp);
      scriptPromise = null;
      script.remove();
      reject(new Error("Turnstile could not be loaded"));
    };
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    if (!existing) {
      const element = script as HTMLScriptElement;
      element.id = SCRIPT_ID;
      element.src = SCRIPT_SRC;
      element.async = true;
      element.defer = true;
      if (nonce) element.nonce = nonce;
      document.head.appendChild(element);
    }
  });
  return scriptPromise;
}

export function isSecurityCheckRejection(body?: SecurityCheckBody) {
  const fields = (body ?? {}) as { code?: unknown; error?: unknown };
  const code = typeof fields.code === "string" ? fields.code : typeof fields.error === "string" ? fields.error : "";
  return code === "security_check_failed" || code === "security_check_missing";
}

export function SecurityCheck({
  config,
  action,
  handleRef,
  emailCode,
}: {
  config: SecurityCheckConfig;
  /** The action name the server expects for this form (modules/security/turnstile.ts). */
  action: string;
  handleRef: Ref<SecurityCheckHandle>;
  /**
   * Sign-in, sign-up and password reset forms pass this so a blocked check offers "Email me a code instead". It reads
   * the form's current email address when the button is pressed. Other forms leave it out.
   */
  emailCode?: { getEmail: () => string };
}) {
  const labelId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const [message, setMessage] = useState("");
  // The script was blocked or the check cannot start. Kept apart from `message` so that pressing Submit cannot replace the
  // blocked text and its Try again button with "Finish the security check" (a dead end). Cleared by Try again or a token.
  const [blocked, setBlockedState] = useState(false);
  const blockedRef = useRef(false);
  const setBlocked = (value: boolean) => {
    blockedRef.current = value;
    setBlockedState(value);
  };
  // The widget itself reported an error, so no token can be produced either (#1480). Not the same as the server saying a
  // token was invalid: that never counts as unavailable.
  const widgetErrorRef = useRef(false);
  const [widgetError, setWidgetErrorState] = useState(false);
  const setWidgetError = (value: boolean) => {
    widgetErrorRef.current = value;
    setWidgetErrorState(value);
  };
  // The emailed code (sign-in, sign-up and reset forms only).
  const codeRef = useRef("");
  const [codeValue, setCodeValue] = useState("");
  const [codeStage, setCodeStage] = useState<"idle" | "sending" | "sent">("idle");
  const [codeNotice, setCodeNotice] = useState("");
  const [codeError, setCodeError] = useState("");
  const codeInputRef = useRef<HTMLInputElement>(null);
  const codeKind = CODE_ACTIONS.has(action);
  const hasEmailCode = Boolean(emailCode);
  // Bumped by Try again: the effect below tears the widget down and loads the script and the box again.
  const [attempt, setAttempt] = useState(0);
  const siteKey = config?.siteKey ?? null;
  const nonce = config?.nonce;

  useImperativeHandle(handleRef, () => ({
    token: () => tokenRef.current,
    headers: (): Record<string, string> => {
      if (tokenRef.current) return { [TURNSTILE_TOKEN_HEADER]: tokenRef.current };
      // Only without a token, and only a code the person typed: a token is never sent beside it.
      const code = codeRef.current.trim();
      return codeKind && code && (blockedRef.current || widgetErrorRef.current) ? { [SECURITY_CHECK_CODE_HEADER]: code } : {};
    },
    unavailable: () => Boolean(siteKey) && !tokenRef.current && (blockedRef.current || widgetErrorRef.current),
    require: (buttonWord: string) => {
      if (!siteKey || tokenRef.current) return true;
      if (blockedRef.current || widgetErrorRef.current) {
        // A public form goes on without a token and the server applies its strict limit. Sign-in, sign-up and reset
        // need the emailed code first.
        if (!codeKind) return true;
        if (codeRef.current.trim()) return true;
        setCodeError(codeStage === "sent" || !hasEmailCode ? NEED_CODE_TEXT : NEED_SEND_TEXT);
        groupRef.current?.scrollIntoView({ block: "center" });
        return false;
      }
      if (!blockedRef.current) setMessage(securityCheckMissingText(buttonWord));
      // A sticky Submit can sit away from the box on a phone: bring the box and its message into view.
      groupRef.current?.scrollIntoView({ block: "center" });
      return false;
    },
    settle: (body) => {
      if (!siteKey) return;
      const hadToken = Boolean(tokenRef.current);
      const usedCode = !hadToken && codeKind && Boolean(codeRef.current.trim());
      tokenRef.current = null;
      if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
      if (usedCode) {
        // A code works once. Whatever the answer was, it is spent: clear it and say how to get another.
        codeRef.current = "";
        setCodeValue("");
        setCodeStage("idle");
        setCodeNotice("");
        setCodeError(isSecurityCheckRejection(body) ? CODE_REJECTED_TEXT : CODE_USED_TEXT);
        setMessage("");
        return;
      }
      setMessage(isSecurityCheckRejection(body) ? SECURITY_CHECK_FAILED_TEXT : "");
    },
    isRejection: isSecurityCheckRejection,
  }), [siteKey, codeKind, codeStage, hasEmailCode]);

  useEffect(() => {
    if (!siteKey || !containerRef.current) return;
    let cancelled = false;
    const container = containerRef.current;
    loadTurnstile(nonce).then((turnstile) => {
      if (cancelled) return;
      widgetId.current = turnstile.render(container, {
        sitekey: siteKey,
        action,
        theme: "light",
        callback: (token: string) => {
          tokenRef.current = token;
          setBlocked(false);
          setWidgetError(false);
          setMessage("");
        },
        "error-callback": () => {
          tokenRef.current = null;
          setWidgetError(true);
          setMessage(SECURITY_CHECK_FAILED_TEXT);
        },
        "unsupported-callback": () => {
          tokenRef.current = null;
          setBlocked(true);
        },
        "expired-callback": () => {
          tokenRef.current = null;
        },
        "timeout-callback": () => {
          tokenRef.current = null;
        },
      });
    }).catch(() => {
      if (!cancelled) setBlocked(true);
    });
    return () => {
      cancelled = true;
      tokenRef.current = null;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey, nonce, action, attempt]);

  if (!siteKey) return null;

  const shown = blocked ? SECURITY_CHECK_BLOCKED_TEXT : message;
  const failed = blocked || message === SECURITY_CHECK_FAILED_TEXT;
  const unavailable = blocked || widgetError;
  const contact = resolveFormsHelpContact(config?.contact ?? {});

  async function sendCode() {
    const email = emailCode?.getEmail().trim() ?? "";
    if (!email) {
      setCodeError(NEED_EMAIL_TEXT);
      return;
    }
    setCodeStage("sending");
    setCodeError("");
    setCodeNotice("");
    try {
      const response = await fetch(SECURITY_CHECK_CODE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, email }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string; developmentCode?: string };
      if (response.status === 202) {
        // The server's own words, the same for every address. A development server may add the code itself.
        setCodeNotice(`${body.message ?? ""}${body.developmentCode && process.env.NODE_ENV !== "production" ? ` Development code: ${body.developmentCode}` : ""}`.trim());
        setCodeStage("sent");
        window.setTimeout(() => codeInputRef.current?.focus(), 0);
        return;
      }
      setCodeStage("idle");
      setCodeError(response.status === 429 || response.status === 400 ? body.message ?? CODE_SEND_FAILED_TEXT : CODE_SEND_FAILED_TEXT);
    } catch {
      setCodeStage("idle");
      setCodeError(CODE_SEND_FAILED_TEXT);
    }
  }

  return (
    <section className={styles.securityCheck} ref={groupRef} role="group" aria-labelledby={labelId} data-testid="security-check">
      <p className={styles.label} id={labelId}>{SECURITY_CHECK_LABEL}</p>
      <div className={styles.box} ref={containerRef} />
      <div className={styles.message} role="alert">{shown}</div>
      {failed && (
        <button
          className={`secondary-button ${styles.retry}`}
          data-testid="security-check-retry"
          onClick={() => {
            setBlocked(false);
            setMessage("");
            setAttempt((current) => current + 1);
          }}
          type="button"
        >
          {SECURITY_CHECK_RETRY_LABEL}
        </button>
      )}
      {unavailable && (
        <p className={styles.contact} data-testid="security-check-contact">
          Need help? Email{" "}
          <a href={`mailto:${contact.email}`} translate="no">{contact.email}</a>
          {" "}or call{" "}
          <a href={telHref(contact.phone)} translate="no">{contact.phone}</a>.
        </p>
      )}
      {unavailable && codeKind && emailCode && (
        <div className={styles.codeBlock} data-testid="security-check-email-code">
          <button
            className={`secondary-button ${styles.emailCodeButton}`}
            data-testid="security-check-email-code-button"
            disabled={codeStage === "sending"}
            onClick={sendCode}
            type="button"
          >
            {codeStage === "sending" ? "Sending…" : SECURITY_CHECK_EMAIL_CODE_LABEL}
          </button>
          <div className={styles.codeStatus} role="status">{codeNotice}</div>
          {codeStage === "sent" && (
            <label className={styles.codeField}>
              {SECURITY_CHECK_CODE_FIELD_LABEL}
              <input
                autoComplete="one-time-code"
                data-testid="security-check-code-input"
                inputMode="numeric"
                maxLength={16}
                name="security-check-code"
                onChange={(event) => {
                  codeRef.current = event.target.value;
                  setCodeValue(event.target.value);
                  setCodeError("");
                }}
                ref={codeInputRef}
                type="text"
                value={codeValue}
              />
            </label>
          )}
          <div className={styles.codeError} role="alert">{codeError}</div>
        </div>
      )}
    </section>
  );
}
