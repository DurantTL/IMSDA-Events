import { Mail, MailX } from "lucide-react";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";

/**
 * The page behind an unsubscribe link that does not work (#1005). The page still answers 404 (it calls `notFound()`); this
 * is only what that 404 shows. The words are the same whatever the reason (a mistyped, cut-off, old or replaced link), so
 * they never say whether an address or a subscription exists.
 */
export default function UnsubscribeNotFound() {
  return (
    <main className="public-registration-page">
      <header className="public-registration-header">
        <div className="public-registration-header-inner">
          <Link className="public-registration-brand public-event-brand-link" href="/">
            <BrandMark />
            <span><strong>IMSDA</strong><small>Events</small></span>
          </Link>
        </div>
      </header>
      <section className="public-registration-not-found" data-testid="unsubscribe-link-unavailable">
        <span><MailX size={32} aria-hidden="true" /></span>
        <p className="public-registration-eyebrow">Email preferences</p>
        <h1>This unsubscribe link didn&apos;t work</h1>
        <p>
          The link may be cut off, out of date, or no longer valid. Nothing was changed.
        </p>
        <p>
          To stop announcements, open the unsubscribe link in the most recent announcement email from IMSDA Events. If that
          link does not work either, contact IMSDA and we will help.
        </p>
        <a className="primary-button" href="https://imsda.org/contact/" rel="noreferrer">
          <Mail size={16} aria-hidden="true" /> Contact IMSDA
        </a>
      </section>
    </main>
  );
}
