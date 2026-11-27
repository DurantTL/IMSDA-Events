import { ClipboardList } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { HonorCategoryLabel } from "@/components/honor-category-label";
import styles from "@/components/honor-requirements.module.css";
import type { HonorCategory } from "@/modules/honors/domain";
import { formatRetrievedOn, type RequirementCredit, type RequirementSection } from "@/modules/requirements/domain";

/**
 * The credit line for licensed requirement text (#2054). It goes wherever the
 * text is shown: the source page and the license are linked, as CC BY-SA asks.
 */
export function RequirementCreditLine({ credit }: { credit: RequirementCredit }) {
  return (
    <p className={styles.credit} data-requirement-credit="">
      Requirement text from the <a href={credit.sourceUrl} rel="noopener noreferrer">{credit.sourceName}</a>, licensed
      under <a href={credit.licenseUrl} rel="license noopener noreferrer">{credit.license}</a>. Retrieved{" "}
      {formatRetrievedOn(credit.retrievedOn)}.
    </p>
  );
}

/**
 * An honor's (or, later, a class's) requirements as numbered items with their
 * lettered parts, followed by the credit line. The credit is part of this
 * component so the text can never be shown without it.
 */
export function RequirementList({ sections, credit, headingLevel = 3 }: {
  sections: readonly RequirementSection[];
  credit: RequirementCredit;
  /** The heading level for a section title, when the requirements have sections. */
  headingLevel?: 2 | 3 | 4;
}) {
  const Heading = `h${headingLevel}` as const;
  return (
    <div data-requirement-list="">
      {sections.map((section) => (
        <div key={section.title || "requirements"}>
          {section.title && <Heading className={styles.sectionTitle}>{section.title}</Heading>}
          <ol className={styles.list}>
            {section.items.map((item) => (
              <li key={item.number} value={item.number}>
                <p className={styles.text}>{item.text}</p>
                {item.parts.length > 0 && (
                  <ul className={styles.parts}>
                    {item.parts.map((part) => (
                      <li className={`${styles.part} ${part.depth === 2 ? styles.deep : ""}`} key={part.label}>
                        <span className={styles.marker}>{part.label.split(".").pop()}.</span>
                        <span className={styles.text}>{part.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </div>
      ))}
      <RequirementCreditLine credit={credit} />
    </div>
  );
}

/**
 * The two panels of an honor's page (#2054), the same for staff and club
 * leaders: what the honor is (code, category label, active or not), then its
 * requirements with their credit, or an empty state that says what to do.
 */
export function HonorRequirementPanels({ honor, requirements, emptyHint, headingLevel = 2 }: {
  honor: { code: string; category: HonorCategory | null; isActive: boolean };
  /** The panels' heading level: 2 on a staff page, 3 inside the club portal's card. */
  headingLevel?: 2 | 3;
  requirements: { sections: readonly RequirementSection[]; credit: RequirementCredit; requirementCount: number } | null;
  /** The empty state's next step, which differs for staff (import) and club leaders (ask the conference). */
  emptyHint: string;
}) {
  const Heading = `h${headingLevel}` as const;
  return (
    <>
      <section aria-labelledby="honor-summary-heading" className="panel">
        <Heading id="honor-summary-heading">About this honor</Heading>
        <ul className={styles.facts}>
          <li>Code: <code>{honor.code}</code></li>
          <li>Category: {honor.category ? <HonorCategoryLabel category={honor.category} /> : "Not set"}</li>
          <li>Status: <span className={`status-chip ${honor.isActive ? "green" : "gold"}`}>{honor.isActive ? "Active" : "Inactive"}</span></li>
        </ul>
      </section>
      <section aria-labelledby="honor-requirements-heading" className="panel">
        <div className="section-heading">
          <div><Heading id="honor-requirements-heading">Requirements</Heading></div>
          {requirements && <span className="count-badge">{requirements.requirementCount} {requirements.requirementCount === 1 ? "requirement" : "requirements"}</span>}
        </div>
        {requirements ? (
          <RequirementList credit={requirements.credit} headingLevel={headingLevel === 2 ? 3 : 4} sections={requirements.sections} />
        ) : (
          <EmptyState hint={emptyHint} icon={<ClipboardList aria-hidden="true" size={27} />} title="No requirements yet">
            This honor&apos;s requirement text hasn&apos;t been added yet.
          </EmptyState>
        )}
      </section>
    </>
  );
}
