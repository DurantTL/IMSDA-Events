"use client";

import { useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from "react";
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

/** The words under the box when Submit was pressed before a token existed. `buttonWord` is the form's own button. */
export function securityCheckMissingText(buttonWord: string) {
  return `Finish the security check above, then press ${buttonWord} again. Your answers are still here.`;
}

const SCRIPT_ID = "cf-turnstile-api";
const SCRIPT_TIMEOUT_MS = 15_000;
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** Any response body: only `code` and `error` are read. */
type SecurityCheckBody = object | null | undefined;

export type SecurityCheckConfig = { siteKey: string; nonce?: string } | null;

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
}: {
  config: SecurityCheckConfig;
  /** The action name the server expects for this form (modules/security/turnstile.ts). */
  action: string;
  handleRef: Ref<SecurityCheckHandle>;
}) {
  const labelId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const [message, setMessage] = useState("");
  // Bumped by Try again: the effect below tears the widget down and loads the script and the box again.
  const [attempt, setAttempt] = useState(0);
  const siteKey = config?.siteKey ?? null;
  const nonce = config?.nonce;

  useImperativeHandle(handleRef, () => ({
    token: () => tokenRef.current,
    headers: (): Record<string, string> => (tokenRef.current ? { [TURNSTILE_TOKEN_HEADER]: tokenRef.current } : {}),
    require: (buttonWord: string) => {
      if (!siteKey || tokenRef.current) return true;
      setMessage(securityCheckMissingText(buttonWord));
      // A sticky Submit can sit away from the box on a phone: bring the box and its message into view.
      groupRef.current?.scrollIntoView({ block: "center" });
      return false;
    },
    settle: (body) => {
      if (!siteKey) return;
      tokenRef.current = null;
      if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
      setMessage(isSecurityCheckRejection(body) ? SECURITY_CHECK_FAILED_TEXT : "");
    },
    isRejection: isSecurityCheckRejection,
  }), [siteKey]);

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
          setMessage("");
        },
        "error-callback": () => {
          tokenRef.current = null;
          setMessage(SECURITY_CHECK_FAILED_TEXT);
        },
        "unsupported-callback": () => {
          tokenRef.current = null;
          setMessage(SECURITY_CHECK_BLOCKED_TEXT);
        },
        "expired-callback": () => {
          tokenRef.current = null;
        },
        "timeout-callback": () => {
          tokenRef.current = null;
        },
      });
    }).catch(() => {
      if (!cancelled) setMessage(SECURITY_CHECK_BLOCKED_TEXT);
    });
    return () => {
      cancelled = true;
      tokenRef.current = null;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey, nonce, action, attempt]);

  if (!siteKey) return null;

  const failed = message === SECURITY_CHECK_FAILED_TEXT || message === SECURITY_CHECK_BLOCKED_TEXT;

  return (
    <section className={styles.securityCheck} ref={groupRef} role="group" aria-labelledby={labelId} data-testid="security-check">
      <p className={styles.label} id={labelId}>{SECURITY_CHECK_LABEL}</p>
      <div className={styles.box} ref={containerRef} />
      <div className={styles.message} role="alert">{message}</div>
      {failed && (
        <button
          className={`secondary-button ${styles.retry}`}
          data-testid="security-check-retry"
          onClick={() => {
            setMessage("");
            setAttempt((current) => current + 1);
          }}
          type="button"
        >
          {SECURITY_CHECK_RETRY_LABEL}
        </button>
      )}
    </section>
  );
}
