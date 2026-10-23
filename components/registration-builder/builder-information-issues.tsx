// The server's refusal of an information form (#1149), shown beside the section or question it is about. The messages
// come from the server unchanged (with the matched word added, see information-mode.ts), so the builder never words
// its own rules. They are replaced on every save or publish attempt.
import { useBuilder } from "./builder-context";

function IssueList({ messages, label }: { messages: string[]; label: string }) {
  if (messages.length === 0) return null;
  return (
    <div className="fb-info-issues" data-testid="information-issues">
      <p className="fb-info-issues-title">{label}</p>
      <ul>{messages.map((message) => <li key={message}>{message}</li>)}</ul>
    </div>
  );
}

/** Refusals about the form as a whole, such as its description. */
export function InformationFormIssues() {
  const { information, informationIssues } = useBuilder();
  if (!information) return null;
  return <IssueList messages={informationIssues.form} label="The server refused this form" />;
}

/** Refusals about one section (its title, description or progress label). */
export function InformationSectionIssues({ sectionId }: { sectionId: string }) {
  const { information, informationIssues } = useBuilder();
  if (!information) return null;
  return <IssueList messages={informationIssues.sections[sectionId] ?? []} label="The server refused this section" />;
}

/** Refusals about one question. */
export function InformationFieldIssues({ fieldId }: { fieldId: string }) {
  const { information, informationIssues } = useBuilder();
  if (!information) return null;
  return <IssueList messages={informationIssues.fields[fieldId] ?? []} label="The server refused this question" />;
}
