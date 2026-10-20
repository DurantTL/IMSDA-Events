"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import { Fingerprint } from "lucide-react";
import { passkeyPromptMessage, postPasskeyJson } from "@/components/passkey-unlock-button";
import { takeAttendeeAuthReturnPath } from "@/modules/attendee-accounts/sign-up-prefill";

const DEFAULT_DESTINATION = "/overview";

/**
 * The one passkey button on the single sign-in page (#1085). The device offers
 * any of this site's passkeys; which kind it was is decided on the server and
 * never shown here, so the page can't hint whether someone is on the team.
 */
export function CombinedPasskeySignInButton({ next, label = "Sign in with a passkey" }: { next?: string; label?: string }) {
  const router = useRouter();
  const [supported, setSupported] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // Only known in the browser; assumed until then so server and client markup match.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(browserSupportsWebAuthn());
  }, []);

  async function signIn() {
    setBusy(true);
    setError("");
    try {
      const { options } = await postPasskeyJson("/api/sign-in/passkey/options");
      const response = await startAuthentication({ optionsJSON: options as Parameters<typeof startAuthentication>[0]["optionsJSON"] });
      const result = await postPasskeyJson("/api/sign-in/passkey", { response, next });
      const redirectTo = (result.redirectTo as string | undefined) ?? DEFAULT_DESTINATION;
      // An attendee sign-in goes back to where it was asked for, as the attendee button does.
      router.replace(result.attendee === true ? takeAttendeeAuthReturnPath() ?? redirectTo : redirectTo);
      router.refresh();
    } catch (caught) {
      setError(passkeyPromptMessage(caught, "That passkey didn't sign you in."));
      setBusy(false);
    }
  }

  if (!supported) return null;
  return (
    <div className="passkey-sign-in">
      <button className="secondary-button passkey-sign-in-button" disabled={busy} onClick={signIn} type="button">
        <Fingerprint aria-hidden="true" size={17} /> {busy ? "Waiting for your passkey…" : label}
      </button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
