// The Rule summary tab (#1072): every question that only shows sometimes, on one page, each with an Edit rule link.
// A rule that depends on a removed question is flagged "Needs a fix" with a Fix rule link. Read-only: the links
// select the question and take the person to its "Show this question when" section.
import { useLoadedBuilder } from "./builder-context";
import { ruleSummary } from "./rule-editor";

export function BuilderRuleSummary({ onEditRule }: { onEditRule: (fieldId: string, sectionIndex: number) => void }) {
  const { definition } = useLoadedBuilder();
  const entries = ruleSummary(definition);
  const fixes = entries.filter((entry) => entry.needsFix).length;
  return (
    <section className="fb-rule-summary" aria-labelledby="fb-rule-summary-heading">
      <h2 id="fb-rule-summary-heading" className="fb-rule-summary-heading">Rule summary</h2>
      <p className="fb-hint">Every question that only shows sometimes, on one page.</p>
      {entries.length === 0
        ? <p className="fb-empty">No question has a rule. Every question shows to everyone.</p>
        : (
          <>
            {fixes > 0 && <p className="fb-rule-problem" role="status">{fixes === 1 ? "1 rule needs a fix." : `${fixes} rules need a fix.`}</p>}
            <ul className="fb-rule-list">
              {entries.map((entry) => (
                <li className="fb-rule-item" key={entry.fieldId} data-needs-fix={entry.needsFix ? "true" : undefined}>
                  <span className="fb-rule-item-title">{entry.label}</span>
                  <span className="fb-hint">Step {entry.sectionIndex + 1} · {entry.stepTitle}</span>
                  {entry.needsFix && <strong className="fb-rule-fix-badge">Needs a fix</strong>}
                  <span className="fb-rule-item-text">
                    {entry.needsFix && entry.fixMessage
                      ? entry.fixMessage
                      : entry.phrases.length === 1
                        ? `Shown when: ${entry.phrases[0]}.`
                        : `Shown when ${entry.match === "ANY" ? "any of these" : "all of these"}: ${entry.phrases.join("; ")}.`}
                  </span>
                  {entry.needsFix && entry.phrases.length > 1 && <span className="fb-hint">{entry.match === "ANY" ? "Any of these" : "All of these"}: {entry.phrases.join("; ")}.</span>}
                  {entry.notes.map((note) => <span className="fb-hint" key={note}>{note}</span>)}
                  <a className="fb-rule-link" href={`#${`fb-rule-heading-${entry.fieldId}`}`} aria-label={`${entry.needsFix ? "Fix" : "Edit"} rule for ${entry.label}`} onClick={(event) => { event.preventDefault(); onEditRule(entry.fieldId, entry.sectionIndex); }}>{entry.needsFix ? "Fix rule" : "Edit rule"}</a>
                </li>
              ))}
            </ul>
          </>
        )}
      <p className="fb-hint">Forms already published keep their single “Show this field only when…” rules exactly as they are; they open here as an “All” rule with one condition.</p>
    </section>
  );
}
