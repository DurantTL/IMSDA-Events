// The phone builder's Move screen (#1071): Move up and Move down, and Move to step, with no dragging. It moves the
// question in the draft only, keeps it selected, and refuses (in words) a move that would put a question in front of the
// question its show-when rule depends on. The status line is read out after every move.
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { isPublicReviewSection } from "@/modules/forms/public-registration-steps";
import { useLoadedBuilder } from "./builder-context";
import { PhoneSheet } from "./builder-phone-sheet";
import { locateField } from "./canvas-rows";
import { positionStatus } from "./phone-move";

export function PhoneMoveSheet({ fieldId, onClose, onMoved }: { fieldId: string; onClose: () => void; onMoved: (sectionId: string) => void }) {
  const { definition, allFields, moveFieldBy, moveFieldToStep } = useLoadedBuilder();
  const location = locateField(definition.sections, fieldId);
  const [targetStep, setTargetStep] = useState(location?.sectionIndex ?? 0);
  // A repeated refusal is announced again: the alert is keyed on how many refusals there have been.
  const [refusalState, setRefusalState] = useState({ text: "", count: 0 });
  const refusal = refusalState.text;
  const setRefusal = (text: string) => setRefusalState((current) => ({ ...current, text }));
  const refuse = (text: string) => setRefusalState((current) => ({ text, count: current.count + 1 }));

  // The question can disappear under the screen (undo, a removal); there is then nothing to move.
  useEffect(() => { if (!location) onClose(); });
  if (!location) return null;

  const { sectionIndex, fieldIndex, field } = location;
  const section = definition.sections[sectionIndex]!;
  const first = fieldIndex === 0;
  const last = fieldIndex === section.fields.length - 1;
  const dependsOn = field.conditional ? allFields.find((candidate) => candidate.key === field.conditional?.fieldKey) : undefined;
  const optionalOn = field.optionalWhen ? allFields.find((candidate) => candidate.key === field.optionalWhen?.fieldKey) : undefined;
  const dependents = allFields.filter((candidate) => candidate.id !== field.id && (candidate.conditional?.fieldKey === field.key || candidate.optionalWhen?.fieldKey === field.key));

  function step(direction: -1 | 1) {
    const result = moveFieldBy(fieldId, direction);
    if (result.ok) setRefusal(""); else refuse(result.message);
  }

  function moveToStep() {
    if (targetStep === sectionIndex) return;
    const result = moveFieldToStep(fieldId, targetStep);
    if (result.ok) setRefusal(""); else refuse(result.message);
    const target = definition.sections[targetStep];
    if (result.ok && target) onMoved(target.id);
  }

  return (
    <PhoneSheet title={`Move “${field.label || "Untitled question"}”`} closeLabel="Done" onClose={onClose}>
      <p className="fb-phone-status" role="status">{positionStatus(definition.sections, fieldId)}</p>
      {refusal && <p className="fb-phone-refusal" role="alert" key={refusalState.count}>{refusal}</p>}
      <div className="fb-phone-move-buttons">
        {/* aria-disabled, not disabled: pressing Move up until the top keeps focus on the button. */}
        <button type="button" className="fb-btn outline" data-autofocus aria-disabled={first ? "true" : undefined} onClick={() => { if (!first) step(-1); }}><ArrowUp size={16} aria-hidden="true" /> Move up</button>
        <button type="button" className="fb-btn outline" aria-disabled={last ? "true" : undefined} onClick={() => { if (!last) step(1); }}><ArrowDown size={16} aria-hidden="true" /> Move down</button>
      </div>
      <fieldset className="fb-phone-steps">
        <legend>Move to step</legend>
        {definition.sections.map((candidate, index) => (
          <label className="fb-phone-step-option" key={candidate.id}>
            <input type="radio" name="builder-rb-move-step" value={candidate.id} checked={targetStep === index} onChange={() => setTargetStep(index)} />
            <span>{index + 1} · {candidate.title || "Untitled step"}{isPublicReviewSection(definition, candidate) ? " (final review)" : ""}{index === sectionIndex ? " (here now)" : ""}</span>
          </label>
        ))}
        <button type="button" className="fb-btn outline" aria-disabled={targetStep === sectionIndex ? "true" : undefined} onClick={moveToStep}>Move to this step</button>
        <p className="fb-hint">It goes to the end of that step. The final review step stays last.</p>
      </fieldset>
      {dependsOn && <p className="fb-hint">This question is shown only when “{dependsOn.label}” is answered. It stays after that question wherever you move it; moving it before that question is refused.</p>}
      {optionalOn && optionalOn.id !== field.id && <p className="fb-hint">This question becomes optional when “{optionalOn.label}” is answered. Between steps it stays after that question; moving it to an earlier step is refused.</p>}
      {dependents.length > 0 && <p className="fb-hint">{dependents.length === 1 ? `“${dependents[0]!.label}” is shown based on this question, so this question stays before it.` : `${dependents.length} other questions are shown based on this one, so it stays before all of them.`}</p>}
    </PhoneSheet>
  );
}
