import { SafeMarkdown } from "@/components/safe-markdown";
import type { RegistrationFormField } from "@/modules/forms/definition";
import styles from "./information-block.module.css";

/**
 * The Information block (#284) as people see it: the heading (the field's label), the text and an optional highlighted note.
 * Used by the public form, the embed (same form), the builder preview and the review step. Text and note go through the
 * site's constrained Markdown, so there is no HTML, image or video. Nothing here is an input; it never has an answer.
 */
export function InformationBlock({ field }: { field: Pick<RegistrationFormField, "id" | "label" | "information"> }) {
  const information = field.information;
  return (
    <div className={styles.block} data-information-block={field.id}>
      <h3 className={styles.heading}>{field.label}</h3>
      {information?.text ? <SafeMarkdown source={information.text} className={styles.text} headingTags={["h4", "h5"]} /> : null}
      {information?.note ? <SafeMarkdown source={information.note} className={styles.note} headingTags={["h4", "h5"]} /> : null}
    </div>
  );
}
