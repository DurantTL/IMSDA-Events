"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { SecurityCheck, type SecurityCheckConfig, type SecurityCheckHandle } from "@/components/security-check/security-check";
import { ArrowLeft, KeyRound } from "lucide-react";

export function PasswordResetRequestForm({ securityCheck = null }: { securityCheck?: SecurityCheckConfig }) {
  const check = useRef<SecurityCheckHandle>(null);
  const [message, setMessage] = useState("");
  const [resetUrl, setResetUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!check.current?.require("Prepare reset instructions")) return;
    setBusy(true);
    setError("");
    setResetUrl("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...check.current?.headers() },
        body: JSON.stringify({ email: form.get("email") }),
      });
      const result = await response.json();
      check.current?.settle(result);
      if (!response.ok && check.current?.isRejection(result)) return;
      if (!response.ok) throw new Error(result.message ?? "Unable to prepare a reset link.");
      setMessage(result.message);
      setResetUrl(result.resetUrl ?? "");
    } catch (caught) {
      check.current?.settle();
      setError(caught instanceof Error ? caught.message : "Unable to prepare a reset link.");
    } finally {
      setBusy(false);
    }
  }

  return <form className="auth-form" onSubmit={submit}><label>Email address<input name="email" type="email" autoComplete="email" required /></label><SecurityCheck config={securityCheck} action="forgot-password" handleRef={check} />{error && <p className="form-error" role="alert">{error}</p>}{message && <div className="auth-success" role="status"><strong>Request received</strong><p>{message}</p>{resetUrl && <Link className="primary-button" href={resetUrl}><KeyRound size={16} /> Open local reset link</Link>}</div>}<button className="primary-button full-button" type="submit" disabled={busy}><KeyRound size={17} /> {busy ? "Preparing…" : "Prepare reset instructions"}</button><Link className="auth-back-link" href="/login"><ArrowLeft size={15} /> Back to sign in</Link></form>;
}
