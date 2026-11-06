import type { Metadata } from "next";
import { AccountPageBanner } from "@/components/account-page-banner";
import { NavigationLink as Link } from "@/components/navigation-link";

export const metadata: Metadata = { title: "Page not found", robots: { index: false, follow: false, nocache: true } };

/** A missing page inside the signed-in account keeps the account header and tabs (#1555): the banner draws the tabs. */
export default function AccountNotFound() {
  return (
    <>
      <AccountPageBanner title="We couldn't find that page" />
      <div className="account-page-body">
        <section className="public-manage-card">
          <p>The link may be out of date, or the address may have been typed incorrectly.</p>
          <p><Link className="secondary-button" href="/account">Back to your account</Link></p>
        </section>
      </div>
    </>
  );
}
