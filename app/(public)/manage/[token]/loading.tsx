import { BrandLink } from "@/components/brand-link";
import { BrandMark } from "@/components/brand-mark";

export default function PublicManageLoading() {
  return (
    <main className="public-registration-page public-manage-page">
      <header className="public-registration-header">
        <div className="public-registration-header-inner">
          <BrandLink className="public-registration-brand" wordmark />
        </div>
      </header>
      <section className="public-registration-loading" aria-live="polite">
        <span className="public-registration-loading-mark">
          <BrandMark />
        </span>
        <p className="public-registration-eyebrow">Private registration</p>
        <h1>Loading your registration…</h1>
        <p>Checking this private link and preparing the latest details.</p>
      </section>
    </main>
  );
}
