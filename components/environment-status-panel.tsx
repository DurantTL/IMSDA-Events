import Link from "next/link";
import type { EnvironmentStatus, EnvironmentStatusValue } from "@/modules/system-admin/environment-status";

const statusText: Record<EnvironmentStatusValue, string> = {
  configured: "Configured",
  "not-configured": "Not configured",
  unknown: "Unknown",
};

/**
 * Environment-managed provider status (#1258): a read-only list of what the server environment has set. There is no
 * input here and no value: the server sends only a status and the names of blank variables. It is labelled as
 * configuration so it is not mistaken for live health or for manual readiness evidence.
 */
export function EnvironmentStatusPanel({ status }: { status: EnvironmentStatus }) {
  return (
    <section className="environment-status" aria-labelledby="environment-status-heading" data-kind="environment-configuration">
      <h3 id="environment-status-heading">Environment configuration</h3>
      <p className="field-help">
        These providers are set in the server environment (deployment settings), not on this page, so there is nothing to edit here and
        no key or secret is ever shown. &ldquo;Configured&rdquo; means a value is set; it does not prove the service is working.
      </p>
      <ul className="environment-status-list">
        {status.services.map((service) => (
          <li key={service.id} data-environment-service={service.id} data-status={service.status}>
            <span className="environment-status-name">{service.label}</span>
            <span className={`environment-status-badge is-${service.status}`}>{statusText[service.status]}</span>
            {service.status === "not-configured" && service.missing.length > 0 && (
              <small className="environment-status-missing">Blank: {service.missing.join(", ")}</small>
            )}
            {service.status === "unknown" && (
              <small className="environment-status-missing">It could not be read from here.</small>
            )}
          </li>
        ))}
      </ul>
      <p className="field-help">
        Two other things are kept apart from this list:{" "}
        <Link className="text-button" href="/admin#system-health">live service health</Link> (what is working right now) and{" "}
        <Link className="text-button" href="/admin/readiness">System readiness</Link> (evidence a person ticked off by hand).
      </p>
    </section>
  );
}
