import Link from "next/link";
import styles from "./template-libraries-guide.module.css";

export type TemplateLibraryKey = "event" | "form" | "question";

/**
 * What each library holds, in one sentence each. The wording follows the real contracts: a new event starts as a copy of
 * a template's published version (`applyEventTemplate`); a form made from a form template keeps the version it was
 * created with, and staff pull a later version into a draft only by choosing "Update draft from a template"; a saved
 * question is added to a form as an independent copy.
 */
export const templateLibraries: ReadonlyArray<{ key: TemplateLibraryKey; name: string; href: string; what: string }> = [
  { key: "event", name: "Event templates", href: "/admin/event-templates", what: "A whole event: its settings, forms and message wording. Used by Create event, Start from a template." },
  { key: "form", name: "Form templates", href: "/admin/form-templates", what: "One registration form. Used when event staff create a form in the form builder." },
  { key: "question", name: "Question library", href: "/admin/question-library", what: "Single saved questions. Added to a form from the form builder." },
];

/**
 * The shared line on the three library pages (#1593): which library is which, plain links to the other two, and what a
 * copy does. All three pages are for system administrators only, so every link here opens for the viewer.
 */
export function TemplateLibrariesGuide({ current }: { current: TemplateLibraryKey }) {
  return (
    <section className={`panel ${styles.guide}`} aria-label="The three template libraries" data-testid="template-libraries-guide">
      <ul className={styles.list}>
        {templateLibraries.map((library) => (
          <li className={`${styles.item} ${library.key === current ? styles.current : ""}`} key={library.key}>
            {library.key === current ? (
              <p className={styles.name}>{library.name}<span className={styles.here}>(this page)</span></p>
            ) : (
              <Link className={styles.name} href={library.href}>{library.name}</Link>
            )}
            <p className={styles.what}>{library.what}</p>
          </li>
        ))}
      </ul>
      <p className={styles.copyNote}>Using a template or saved question makes a copy. Editing one later does not change events or forms already made from it.</p>
    </section>
  );
}
