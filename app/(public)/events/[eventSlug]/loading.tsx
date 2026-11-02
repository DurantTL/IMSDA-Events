import { BrandLink } from "@/components/brand-link";
import { BrandMark } from "@/components/brand-mark";
import { EventLoadingTransition } from "@/components/event-loading-transition";

export default function PublicEventLoading() {
  return (
    <main className="public-registration-page public-event-page" aria-busy="true">
      <header className="public-registration-header">
        <div className="public-registration-header-inner">
          <BrandLink className="public-registration-brand" wordmark />
        </div>
      </header>
      <EventLoadingTransition>
      <section className="public-registration-loading" role="status" aria-live="polite">
        <span className="public-registration-loading-mark"><BrandMark /></span>
        <h1>Loading event details…</h1>
        <p>We’re checking registration dates, availability, and published forms.</p>
      </section>
      </EventLoadingTransition>
    </main>
  );
}
