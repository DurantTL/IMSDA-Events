import Link from "next/link";
import { Activity } from "lucide-react";
import type { EmailHealth } from "@/modules/system-admin/email-health";
import { isSafeAttentionHref } from "@/modules/system-admin/attention-model";
import { SuppressedAddressesPanel } from "@/components/suppressed-addresses-panel";

/**
 * System management > Email > Email health (#1043). Reads what the bell (#1032) already computed. Three separate
 * statements: whether the provider is configured here, whether the central sender is set, and whether mail is
 * actually getting through (the problems list). One is never used as proof of another.
 */
export function EmailHealthSection({ health }: { health: EmailHealth }) {
  const { provider } = health;
  return (
    <section className="panel" id="email-health">
      <div className="section-heading">
        <div>
          <p className="eyebrow"><Activity aria-hidden="true" size={14} /> Email health</p>
          <h2>Is email getting through?</h2>
        </div>
      </div>
      <h3>Configuration in this environment</h3>
      <p className="field-help email-health-note">What the server has set. It does not prove mail is getting through; the problems list below does.</p>
      <ul className="notification-event-list" aria-label="Email setup in this environment">
        <li data-health="provider">
          <span>
            <strong>Email provider</strong>
            <small className="quiet-copy">
              {provider.configured ? "Configured in this environment." : "Not configured in this environment, so nothing can be sent."}
            </small>
          </span>
        </li>
        <li data-health="webhook">
          <span>
            <strong>Delivery reports</strong>
            <small className="quiet-copy">
              {provider.webhookConfigured ? "The provider reports bounces and complaints back." : "Not configured, so a bounce is never reported back."}
            </small>
          </span>
        </li>
        <li data-health="sender">
          <span>
            <strong>Central sender</strong>
            <small className="quiet-copy">
              {provider.centralSenderSet && provider.accountEmailConfigured
                ? "The sender address and the account email sender are set."
                : "The sender address or the account email sender is missing, so real email stays off."}
            </small>
          </span>
        </li>
      </ul>
      <SuppressedAddressesPanel initial={health.suppressions} />
      <h3>Live delivery health: problems in the last {health.windowDays} days</h3>
      {health.partial && (
        <p className="inline-notice error" role="status">Some checks could not be read, so this list may be missing items.</p>
      )}
      {health.problems.length === 0 ? (
        <p className="quiet-copy" data-health="none">
          {health.partial ? "No problems were found in the checks that could be read." : "No failed, bounced or stuck email, and the scheduled email sweep is running."}
        </p>
      ) : (
        <ul className="notification-event-list">
          {health.problems.map((item) => (
            <li data-health-item={item.key} key={item.key}>
              <span>
                <strong>{item.count}</strong> {item.label}
              </span>
              {isSafeAttentionHref(item.href) && <Link className="secondary-button" href={item.href}>Open</Link>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
