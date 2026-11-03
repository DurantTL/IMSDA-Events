import { BrandLink } from "@/components/brand-link";
import Image from "next/image";
import { BRAND_SYMBOL_PATH } from "@/lib/brand";
import { EventLoadingTransition } from "@/components/event-loading-transition";
import homeStyles from "@/components/public-home-page.module.css";
import styles from "./event-page.module.css";

export default function PublicEventLoading() {
  return (
    <main className={`public-registration-page public-event-page ${homeStyles.page} ${styles.eventPage}`} aria-busy="true">
      <header className="public-registration-header">
        <div className="public-registration-header-inner">
          <BrandLink className="public-registration-brand" label="IMAdventist calendar" wordmark />
        </div>
      </header>
      <EventLoadingTransition>
      <section className="public-registration-loading" role="status" aria-live="polite">
        <span className="public-registration-loading-mark"><Image alt="" aria-hidden="true" height={48} src={BRAND_SYMBOL_PATH} width={48} /></span>
        <h1>Loading event details…</h1>
        <p>We’re checking registration dates, availability, and published forms.</p>
      </section>
      </EventLoadingTransition>
    </main>
  );
}
