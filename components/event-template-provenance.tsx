import type { EventTemplateRecord } from "@/modules/event-templates/repository";
import styles from "./event-template-provenance.module.css";

type Provenance = {
  forms?: Array<{ versionNumber?: number }>;
  messageTemplates?: Array<{ key?: string; versionNumber?: number }>;
};

function sourceVersions(provenance: unknown) {
  const value = (provenance && typeof provenance === "object" ? provenance : {}) as Provenance;
  const forms = Array.isArray(value.forms) ? value.forms.length : 0;
  const messages = Array.isArray(value.messageTemplates) ? value.messageTemplates.length : 0;
  return { forms, messages, value };
}

/** Provenance of the versions that were saved from an event (#154): the source, who saved it, when, and why. Renders nothing otherwise. */
export function EventTemplateProvenance({ template }: { template: EventTemplateRecord }) {
  const saved = template.versions.filter((version) => version.source !== null);
  if (saved.length === 0) return null;
  return (
    <section className="panel form-stack event-settings-panel">
      <h2 className={styles.heading}>Where versions came from</h2>
      <ul className={styles.list}>
        {saved.map((version) => {
          const source = version.source!;
          const { forms, messages, value } = sourceVersions(source.provenance);
          const formVersions = (value.forms ?? []).map((form) => `v${form.versionNumber ?? "?"}`).join(", ");
          const messageVersions = (value.messageTemplates ?? []).map((entry) => `${entry.key ?? "message"} v${entry.versionNumber ?? "?"}`).join(", ");
          return (
            <li key={version.id} className={styles.entry}>
              <p className={styles.line}><strong>Version {version.versionNumber}</strong> saved from {source.sourceEventId ? source.sourceEventName : `${source.sourceEventName} (deleted event)`}</p>
              <p className={styles.line}>Saved by {source.savedBy} on {new Date(source.savedAt).toLocaleDateString("en-US", { timeZone: "America/Chicago" })}.</p>
              <p className={styles.line}>Release note: {source.releaseNote}</p>
              <p className={styles.line}>Copied from {forms} published {forms === 1 ? "form" : "forms"}{formVersions ? ` (${formVersions})` : ""} and {messages} message {messages === 1 ? "template" : "templates"}{messageVersions ? ` (${messageVersions})` : ""}.</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
