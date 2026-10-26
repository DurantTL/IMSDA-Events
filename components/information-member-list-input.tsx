"use client";

import { Plus, Trash2 } from "lucide-react";
import type { RegistrationFormField } from "@/modules/forms/definition";

type Row = Record<string, string | number>;

/** Rows with every column empty are dropped before an answer is sent, so a spare blank line never counts as a member. */
export function withoutBlankMemberRows(value: unknown): Row[] {
  if (!Array.isArray(value)) return [];
  return (value as Row[]).filter((row) => Object.values(row ?? {}).some((cell) => String(cell ?? "").trim() !== ""));
}

/**
 * The repeating rows of a member list (#1222) on an information form's public page: one row per member, with only the
 * columns the form declares (name, age, level, working on). Add and remove are real buttons with a 44px target.
 */
export function InformationMemberListInput({ field, value, onChange, problem }: {
  field: RegistrationFormField;
  value: unknown;
  onChange: (rows: Row[]) => void;
  problem: string;
}) {
  const columns = field.memberColumns ?? [];
  const rows: Row[] = Array.isArray(value) && value.length > 0 ? (value as Row[]) : [{}];
  const update = (index: number, key: string, cell: string | number) => onChange(rows.map((row, at) => (at === index ? { ...row, [key]: cell } : row)));
  return (
    <fieldset className="club-form-choice club-form-field-wide information-member-list">
      <legend>{field.label}{field.required ? <span aria-hidden="true">{" *"}</span> : null}</legend>
      {field.helpText ? <small className="field-help information-member-help">{field.helpText}</small> : null}
      {rows.map((row, index) => (
        <div className="information-member-row" role="group" aria-label={`${field.label}, member ${index + 1}`} key={index}>
          <div className="form-grid two-column">
            {columns.map((column) => (
              <label key={column.key}>{column.label}{column.required ? <span aria-hidden="true">{" *"}</span> : null}
                {column.type === "SELECT" ? (
                  <select value={String(row[column.key] ?? "")} onChange={(event) => update(index, column.key, event.target.value)}>
                    <option value="">Choose…</option>
                    {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                ) : column.type === "NUMBER" ? (
                  <input inputMode="numeric" max={120} min={0} step={1} type="number" value={String(row[column.key] ?? "")} onChange={(event) => update(index, column.key, event.target.value === "" ? "" : Number(event.target.value))} />
                ) : (
                  <input autoComplete="off" maxLength={120} type="text" value={String(row[column.key] ?? "")} onChange={(event) => update(index, column.key, event.target.value)} />
                )}
              </label>
            ))}
          </div>
          {rows.length > 1 && (
            <button className="secondary-button information-member-remove" type="button" onClick={() => onChange(rows.filter((_, at) => at !== index))}>
              <Trash2 aria-hidden="true" size={16} /> Remove<span className="sr-only"> member {index + 1}</span>
            </button>
          )}
        </div>
      ))}
      {rows.length < 60 && (
        <button className="secondary-button information-member-add" type="button" onClick={() => onChange([...rows, {}])}>
          <Plus aria-hidden="true" size={16} /> Add another member
        </button>
      )}
      {problem ? <small className="field-error" role="alert">{problem}</small> : null}
    </fieldset>
  );
}
