import type { ReactNode } from "react";
import { emergencyProcedureKindLabels } from "@/modules/emergency-plans/domain";
import { emergencyReferenceFooterPrefix, type EmergencyReferenceSheet } from "@/modules/reporting/emergency-reference";
import { EmergencyPrintFooter } from "@/components/emergency-print-footer";
import styles from "@/components/emergency-reference-sheet.module.css";

/**
 * The printed emergency reference (#114): plain text on paper, no links,
 * buttons or inputs. Reads only the sheet model built from a snapshot.
 * The footer sits in a table footer group so it repeats on every printed page.
 */
export function EmergencyReferenceSheetView({ sheet, generatedAtIso, actions }: { sheet: EmergencyReferenceSheet; generatedAtIso: string; actions?: ReactNode }) {
  const locationList = (locations: EmergencyReferenceSheet["assemblyLocations"], empty: string) => locations.length === 0 ? (
    <p className={styles.empty}>{empty}</p>
  ) : (
    <ol className={styles.cards}>
      {locations.map((location, index) => (
        <li className={styles.card} key={`${location.name}-${index}`}>
          <h4>{location.name}</h4>
          {location.description && <p>{location.description}</p>}
          <dl className={styles.facts}>
            {location.capacityNote && <><dt>Capacity</dt><dd>{location.capacityNote}</dd></>}
            {location.directions && <><dt>Directions</dt><dd>{location.directions}</dd></>}
            {location.mapReference && <><dt>Map</dt><dd>{location.mapReference}</dd></>}
          </dl>
        </li>
      ))}
    </ol>
  );

  return (
    <article className={styles.sheet} data-draft={sheet.isDraft ? "true" : "false"}>
      {actions && <div className={styles.screenOnly}>{actions}</div>}
      <div className={styles.frame}>
        <div className={styles.frameBody}>
          <div>
              {sheet.banner && <p className={styles.draftBanner} role="status">{sheet.banner}</p>}
              <header className={styles.header}>
                <p className={styles.eyebrow}>Emergency reference</p>
                <h2 className={styles.title}>{sheet.eventName}</h2>
                <p className={styles.dates}>{sheet.dates}</p>
              </header>

              <section className={styles.section}>
                <h3>Contacts, in escalation order</h3>
                {sheet.contacts.length === 0 ? <p className={styles.empty}>No contacts listed.</p> : (
                  <table className={styles.printTable}>
                    <thead><tr><th scope="col">Order</th><th scope="col">Role</th><th scope="col">Name</th><th scope="col">Phone</th></tr></thead>
                    <tbody>
                      {sheet.contacts.map((contact) => (
                        <tr key={`${contact.escalationOrder}-${contact.name}`}>
                          <td>{contact.escalationOrder}</td><td>{contact.role}</td><td>{contact.name}</td><td>{contact.phone}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <section className={styles.section}><h3>Assembly locations</h3>{locationList(sheet.assemblyLocations, "No assembly locations listed.")}</section>
              <section className={styles.section}><h3>Shelters</h3>{locationList(sheet.shelters, "No shelters listed.")}</section>

              <section className={styles.section}>
                <h3>Procedures</h3>
                {sheet.procedures.length === 0 ? <p className={styles.empty}>No procedures listed.</p> : sheet.procedures.map((procedure, index) => (
                  <div className={styles.procedure} key={`${procedure.title}-${index}`}>
                    <h4>{procedure.title} <span className={styles.kind}>({emergencyProcedureKindLabels[procedure.kind]})</span></h4>
                    {procedure.body.split(/\n{2,}/).filter(Boolean).map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>)}
                    {procedure.items.length > 0 && (
                      <ol className={styles.steps}>
                        {procedure.items.map((item, itemIndex) => (
                          <li key={itemIndex}><strong>{item.title}</strong>{item.text ? <> {item.text}</> : null}</li>
                        ))}
                      </ol>
                    )}
                  </div>
                ))}
              </section>
          </div>
        </div>
        <div className={styles.frameFoot}>
          <div><EmergencyPrintFooter initialPrintedAt={generatedAtIso} timezone={sheet.timezone} prefix={emergencyReferenceFooterPrefix(sheet)} /></div>
        </div>
      </div>
    </article>
  );
}
