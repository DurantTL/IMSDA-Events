import { ArrowLeft, CircleAlert } from "lucide-react";
import Link from "next/link";
import { BrandLink } from "@/components/brand-link";
import homeStyles from "@/components/public-home-page.module.css";
import styles from "./event-page.module.css";

export default function PublicEventNotFound() {
  return (
    <main className={`public-registration-page public-event-page ${homeStyles.page} ${styles.eventPage}`}>
      <header className="public-registration-header">
        <div className="public-registration-header-inner">
          <BrandLink className="public-registration-brand public-event-brand-link" label="IMAdventist calendar" wordmark />
        </div>
      </header>
      <section className="public-registration-not-found">
        <span><CircleAlert size={32} aria-hidden="true" /></span>
        <p className="public-registration-eyebrow">Event unavailable</p>
        <h1>This event page is not published</h1>
        <p>The link may be incorrect or event registration may not be available yet.</p>
        <Link className="public-event-not-found-link" href="/events">
          <ArrowLeft size={16} aria-hidden="true" /> Browse events
        </Link>
      </section>
    </main>
  );
}
