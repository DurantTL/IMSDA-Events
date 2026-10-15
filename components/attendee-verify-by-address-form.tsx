"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { OneTimeCodeInput } from "@/components/one-time-code-input";

/** Verify an address with the code an administrator's "Send verification email" mailed. */
export function AttendeeVerifyByAddressForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/attendee/verify-email/by-address", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), code: form.get("code") }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "That could not be verified.");
      router.replace("/account");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That could not be verified.");
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>
        Email address
        <input name="email" type="email" autoComplete="username" required maxLength={254} />
      </label>
      <OneTimeCodeInput label="Six-digit code from the email" />
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary-button full-button" type="submit" disabled={busy}>
        <ShieldCheck aria-hidden="true" size={17} /> {busy ? "Checking…" : "Verify email"}
      </button>
    </form>
  );
}
