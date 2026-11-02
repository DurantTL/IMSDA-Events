import { ArrowLeft, CircleAlert } from "lucide-react";
import { BrandLink } from "@/components/brand-link";

export default function PublicEventNotFound() {
  return (
    <main className="public-registration-page public-event-page">
      <header className="public-registration-header">
        <div className="public-registration-header-inner">
          <BrandLink className="public-registration-brand public-event-brand-link" wordmark />
        </div>
      </header>
      <section className="public-registration-not-found">
        <span><CircleAlert size={32} aria-hidden="true" /></span>
        <p className="public-registration-eyebrow">Event unavailable</p>
        <h1>This event page is not published</h1>
        <p>The link may be incorrect or event registration may not be available yet.</p>
        <a className="public-event-not-found-link" href="https://imsda.org/events/">
          <ArrowLeft size={16} aria-hidden="true" /> Browse events on imsda.org
        </a>
      </section>
    </main>
  );
}
