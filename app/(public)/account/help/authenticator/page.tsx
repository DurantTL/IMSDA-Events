import type { Metadata } from "next";
import Link from "next/link";
import { BrandLink } from "@/components/brand-link";

export const metadata: Metadata = {
  title: "Setting up an authenticator app",
  description: "How to install and use an authenticator app for IMAdventist two-step sign-in.",
  robots: { index: false, follow: false },
};

/**
 * A short, static help page for the authenticator option in two-step
 * sign-in. Linked from the sign-up and account-security screens; it needs no
 * account and no server data, so it is a plain page.
 */
export default function AuthenticatorHelpPage() {
  return (
    <main className="auth-page">
      <section className="auth-card">
        <BrandLink className="auth-brand" wordmark />
        <div className="auth-heading">
          <p className="eyebrow">Two-step sign-in</p>
          <h1>Setting up an authenticator app</h1>
          <p>
            An authenticator app shows a new six-digit code every thirty seconds. When this account
            asks for a second step, you type the code the app shows. The app keeps working without
            an internet connection once it is set up.
          </p>
        </div>
        <div className="auth-form">
          <p>
            <strong>1. Install an app on your phone.</strong> Any of these works. Pick one you
            already have:
          </p>
          <ul className="password-requirements" aria-label="Authenticator apps">
            <li data-met="true"><span>Google Authenticator (iOS and Android)</span></li>
            <li data-met="true"><span>Microsoft Authenticator (iOS and Android)</span></li>
            <li data-met="true"><span>Apple Passwords (built in to iPhone and iPad)</span></li>
            <li data-met="true"><span>1Password (if you already use it for other passwords)</span></li>
          </ul>
          <p>
            <strong>2. Get the key.</strong> On the two-step sign-in setup screen, choose An
            authenticator app, then Continue. Then choose &quot;Set up an authenticator.&quot; A
            text key appears on the page. Copy it, or type it into your app, to add this account.
          </p>
          <p>
            <strong>3. Confirm with a code.</strong> The app now shows a six-digit code for this
            account. Type it into Code from your authenticator, then choose Confirm and turn on.
            Save the recovery codes you are shown. They appear only once.
          </p>
          <p className="field-help">
            Prefer not to use an app? A passkey uses your phone or computer&apos;s own fingerprint,
            face or screen lock. It works just as well. You only need one of the two.
          </p>
          <p className="field-help">
            <Link href="/account">Back to your account</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
