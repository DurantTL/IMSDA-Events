import type { Metadata } from "next";
import { BrandMark } from "@/components/brand-mark";
import { AttendeeVerifyByAddressForm } from "@/components/attendee-verify-by-address-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Verify your email",
  description: "Enter the code an administrator sent to verify your email address.",
  robots: { index: false, follow: false },
};

export default function VerifyEmailPage() {
  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand">
          <BrandMark />
          <span><strong>IMSDA</strong><small>Events</small></span>
        </div>
        <div className="auth-heading">
          <h1>Verify your email</h1>
          <p>An administrator changed your sign-in email and sent a six-digit code to the new address. Enter it here.</p>
        </div>
        <AttendeeVerifyByAddressForm />
      </section>
    </main>
  );
}
