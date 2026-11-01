"use client";

import Link from "next/link";
import { AccountComingSoonNotice } from "@/components/account-coming-soon-notice";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, LogIn, UserPlus } from "lucide-react";
import { SecurityCheck, type SecurityCheckConfig, type SecurityCheckHandle } from "@/components/security-check/security-check";
import { attendeeReturnDestination, signInCodePathFor } from "@/modules/attendee-accounts/return-destination";
import {
  attendeeAuthReturnPathFromHash,
  attendeeSignUpEmailPrefill,
  removeAttendeeAuthFragment,
  takeAttendeeAuthReturnPath,
} from "@/modules/attendee-accounts/sign-up-prefill";

/** Password sign-in for a registrant. Staff sign in at `/login` instead. */
export function AttendeeSignInForm({ next, securityCheck = null }: { next?: string; securityCheck?: SecurityCheckConfig }) {
  const check = useRef<SecurityCheckHandle>(null);
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!window.location.hash) return;
    attendeeAuthReturnPathFromHash(window.location.hash);
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const email = attendeeSignUpEmailPrefill(fragment.get("email") ?? undefined);
    if (email && emailRef.current) emailRef.current.value = email;
    removeAttendeeAuthFragment();
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!check.current?.require("Sign in")) return;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/attendee/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...check.current?.headers() },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      const result = await response.json();
      check.current?.settle(result);
      if (!response.ok && check.current?.isRejection(result)) {
        setBusy(false);
        return;
      }
      if (!response.ok) throw new Error(result.message ?? "Unable to sign in.");
      const destination = takeAttendeeAuthReturnPath() ?? attendeeReturnDestination(next, "/account");
      // Step 2 of 2: a club role without two-step sign-in enters the code just emailed to them (#1410).
      router.replace(result.signInCode?.required ? signInCodePathFor(destination) : destination);
      router.refresh();
    } catch (caught) {
      check.current?.settle();
      setError(caught instanceof Error ? caught.message : "Unable to sign in.");
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>
        Email address
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          maxLength={254}
          ref={emailRef}
        />
      </label>
      <label>
        Password
        <span className="password-field">
          <input
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            maxLength={128}
          />
          <button
            type="button"
            aria-label={showPassword ? "Hide password" : "Show password"}
            onClick={() => setShowPassword((value) => !value)}
          >
            {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </span>
      </label>
      <div className="auth-form-row">
        <span />
        <Link href="/account/forgot-password">Forgot password?</Link>
      </div>
      <SecurityCheck config={securityCheck} action="attendee-sign-in" handleRef={check} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary-button full-button" type="submit" disabled={busy}>
        <LogIn aria-hidden="true" size={17} /> {busy ? "Signing in…" : "Sign in"}
      </button>
      <div className="auth-alternate">
        <strong>New to IMSDA Events?</strong>
        <span>Want one place to manage future registrations? Create an optional account — registration itself never requires one.</span>
        <AccountComingSoonNotice />
        <Link className="secondary-button full-button" href="/account/sign-up">
          <UserPlus aria-hidden="true" size={17} /> Create an account
        </Link>
      </div>
      <p className="field-help">
        <Link href="/recover-registration">Manage my registration without an account</Link>.
      </p>
    </form>
  );
}

export function AttendeeAuthReturn() {
  const router = useRouter();

  useEffect(() => {
    if (window.location.hash) {
      attendeeAuthReturnPathFromHash(window.location.hash);
      removeAttendeeAuthFragment();
    }
    const returnTo = takeAttendeeAuthReturnPath();
    if (returnTo) router.replace(returnTo);
  }, [router]);

  return null;
}
