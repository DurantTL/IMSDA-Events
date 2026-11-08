"use client";

import { ExactValue } from "@/components/exact-value";
import { formatPersonName } from "@/lib/person-name";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import { postJson } from "@/lib/post-json";
import { SortOrderNote, SortableHeader } from "@/components/list-sort";
import { useTableSort, type SortSpec } from "@/components/use-table-sort";
import { clubClassLevelLabels, clubClassLevels, clubRosterAttendeeTypeLabels, clubSchoolGradeLabels, clubSchoolGrades, nextSchoolGrade, schoolGradeOrder, type ClubSchoolGrade } from "@/modules/club-rosters/domain";

/**
 * The checklist for starting next year's roster (#414). Everyone from last
 * year's active roster is ticked; the director unticks leavers, changes a
 * type, role or class, and confirms once. It shows names, types, roles and an
 * age worked out on the server: no birth date is ever sent to this screen.
 */

type AttendeeType = keyof typeof clubRosterAttendeeTypeLabels;

export type CarryForwardRow = {
  memberId: string;
  firstName: string;
  lastName: string;
  attendeeType: AttendeeType;
  role: string;
  classLevel: string | null;
  schoolGrade?: string | null;
  age: number | null;
  transferring?: boolean;
  transferWithStaff?: boolean;
};

/** Sorts by what each person had last year, not by the choices being edited, so a row does not jump while the director types (#1458). */
const CARRY_FORWARD_SORT = {
  name: { label: "Name", value: (row) => formatPersonName(row, "sorted") },
  age: { label: "Age", kind: "number", value: (row) => row.age },
  type: { label: "Type", value: (row) => clubRosterAttendeeTypeLabels[row.attendeeType] },
  role: { label: "Role", value: (row) => row.role },
  class: { label: "Class", value: (row) => (row.classLevel ? clubClassLevelLabels[row.classLevel as keyof typeof clubClassLevelLabels] ?? row.classLevel : null) },
  grade: { label: "Grade", kind: "number", value: (row) => schoolGradeOrder(row.schoolGrade) },
} satisfies Record<string, SortSpec<CarryForwardRow>>;

type Choice = { ticked: boolean; attendeeType: AttendeeType; role: string; classLevel: string; schoolGrade: string };

export function ClubRosterCarryForward({
  organizationId,
  fromClubYear,
  toClubYear,
  rows,
}: {
  organizationId: string;
  fromClubYear: string;
  toClubYear: string;
  rows: CarryForwardRow[];
}) {
  const router = useRouter();
  const sorted = useTableSort(rows, CARRY_FORWARD_SORT, "carry");
  const [choices, setChoices] = useState<Record<string, Choice>>(() => Object.fromEntries(
    rows.map((row) => [row.memberId, { ticked: !row.transferring, attendeeType: row.attendeeType, role: row.role, classLevel: row.classLevel ?? "", schoolGrade: row.schoolGrade ?? "" }]),
  ));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  // Ticks are a selection, not typed work; a changed type, role or class is (#1468). Started rosters are done.
  const edited = rows.some((row) => {
    const choice = choices[row.memberId];
    return Boolean(choice) && (choice!.attendeeType !== row.attendeeType || choice!.role !== row.role || choice!.classLevel !== (row.classLevel ?? "") || choice!.schoolGrade !== (row.schoolGrade ?? ""));
  });
  useUnsavedChangesGuard(edited && !done, "You have changed the new year's roster choices but not started it. Leave this page and discard them?");
  const ticked = useMemo(() => rows.filter((row) => choices[row.memberId]?.ticked), [rows, choices]);

  function change(memberId: string, patch: Partial<Choice>) {
    setChoices((current) => ({ ...current, [memberId]: { ...current[memberId]!, ...patch } }));
  }

  /**
   * The reviewed "Move everyone up one grade" step (#1664): fills in each ticked Pathfinder's next grade in the table, where the
   * director can check and change every one before confirming. Nothing is saved by this button. 12th grade stays 12th and is
   * flagged below for review; Not in school and a blank grade stay as they are.
   */
  function moveEveryoneUp() {
    // From last year's grade, not the current choice, so pressing it twice never moves anyone up twice.
    const lastYear = new Map(rows.map((row) => [row.memberId, (row.schoolGrade ?? null) as ClubSchoolGrade | null]));
    setChoices((current) => Object.fromEntries(Object.entries(current).map(([id, choice]) => [
      id,
      choice.ticked && choice.attendeeType === "YOUTH" ? { ...choice, schoolGrade: nextSchoolGrade(lastYear.get(id) ?? null) ?? "" } : choice,
    ])));
  }

  const graduating = ticked.filter((row) => choices[row.memberId]!.attendeeType === "YOUTH" && choices[row.memberId]!.schoolGrade === "GRADE_12");

  function setAll(value: boolean) {
    setChoices((current) => Object.fromEntries(Object.entries(current).map(([id, choice]) => [id, { ...choice, ticked: value }])));
  }

  async function confirm() {
    setBusy(true);
    setError("");
    const people = ticked.map((row) => {
      const choice = choices[row.memberId]!;
      return {
        memberId: row.memberId,
        attendeeType: choice.attendeeType,
        // Only what the director changed is sent, so an untouched role follows a change of type as it does on the roster.
        ...(choice.role !== row.role ? { role: choice.role } : {}),
        ...(choice.classLevel !== (row.classLevel ?? "") ? { classLevel: choice.classLevel || null } : {}),
        ...(choice.attendeeType === "YOUTH" && choice.schoolGrade !== (row.schoolGrade ?? "") ? { schoolGrade: choice.schoolGrade || null } : {}),
      };
    });
    const result = await postJson(
      `/api/attendee/clubs/${encodeURIComponent(organizationId)}/roster/next-year`,
      { confirm: true, people },
      "The new year's roster could not be started.",
    );
    setBusy(false);
    if (!result.ok) {
      setError(String(result.body.message ?? "The new year's roster could not be started."));
      return;
    }
    const copied = Number(result.body.guardiansCopied ?? 0);
    setDone(`Started the ${toClubYear} roster with ${String(result.body.carried)} ${result.body.carried === 1 ? "person" : "people"}${copied > 0 ? `, ${String(copied)} emergency ${copied === 1 ? "contact" : "contacts"} copied` : ""}.`);
    router.refresh();
  }

  if (done) {
    return (
      <div className="inline-notice success" role="status">
        {done} <a href={`/account/clubs/${organizationId}/roster?year=${encodeURIComponent(toClubYear)}`}>{`Open the ${toClubYear} roster`}</a>.
      </div>
    );
  }

  return (
    <form
      className="page-stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (ticked.length > 0 && !busy) void confirm();
      }}
    >
      <p className="field-help">
        Everyone on the {fromClubYear} roster is ticked, except anyone with a pending transfer to another club. Untick anyone who is leaving, and change a type, role or class
        for anyone moving up. People you carry keep their record, birth date and emergency contacts; the {fromClubYear} roster stays as it was.
      </p>
      <div className="intro-actions">
        <button className="secondary-button" onClick={() => setAll(true)} type="button">Tick everyone</button>
        <button className="secondary-button" onClick={() => setAll(false)} type="button">Untick everyone</button>
        <button className="secondary-button" onClick={moveEveryoneUp} type="button">Move everyone up one grade</button>
      </div>
      <p className="field-help">
        Move everyone up one grade fills in the Grade column for the people ticked. Check each grade and change any that are wrong before you start the year; nothing is moved
        until then. 12th grade stays 12th grade.
      </p>
      {graduating.length > 0 && (
        <p className="inline-notice" role="status">
          {graduating.length === 1 ? "1 person is" : `${graduating.length} people are`} still in 12th grade. Check whether they have graduated: untick anyone leaving the club, or choose a different grade or Not in school.
        </p>
      )}
      <div className="report-table-wrap">
        {sorted.noteText && <SortOrderNote>{sorted.noteText}</SortOrderNote>}
        <table className="report-table table-cards" role="table">
          <caption className="sr-only">{`People on the ${fromClubYear} roster`}</caption>
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader" scope="col">Carry forward</th>
              <SortableHeader {...sorted.headerProps("name")} />
              <SortableHeader {...sorted.headerProps("age")} />
              <SortableHeader {...sorted.headerProps("type", { label: `${toClubYear} type` })} />
              <SortableHeader {...sorted.headerProps("role")} />
              <SortableHeader {...sorted.headerProps("class")} />
              <SortableHeader {...sorted.headerProps("grade", { label: `${toClubYear} grade` })} />
            </tr>
          </thead>
          <tbody role="rowgroup">
            {sorted.rows.map((row) => {
              const choice = choices[row.memberId]!;
              const fullName = `${row.firstName} ${row.lastName}`.trim();
              return (
                <tr key={row.memberId} role="row">
                  <td data-label="Carry forward" role="cell">
                    <input
                      aria-label={`Carry ${fullName} forward`}
                      checked={choice.ticked}
                      onChange={(event) => change(row.memberId, { ticked: event.target.checked })}
                      type="checkbox"
                    />
                  </td>
                  <th role="rowheader" scope="row">
                    <ExactValue>{fullName}</ExactValue>
                    {row.transferring && <small> Transferring to another club</small>}
                    {row.transferWithStaff && <small> Transfer request is with conference staff</small>}
                  </th>
                  <td data-label="Age" role="cell">{row.age ?? "—"}</td>
                  <td data-label={`${toClubYear} type`} role="cell">
                    <select
                      aria-label={`${fullName} type`}
                      disabled={!choice.ticked}
                      onChange={(event) => change(row.memberId, { attendeeType: event.target.value as AttendeeType })}
                      value={choice.attendeeType}
                    >
                      {Object.entries(clubRosterAttendeeTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </td>
                  <td data-label="Role" role="cell">
                    <input
                      aria-label={`${fullName} role`}
                      disabled={!choice.ticked}
                      maxLength={60}
                      onChange={(event) => change(row.memberId, { role: event.target.value })}
                      value={choice.role}
                    />
                  </td>
                  <td data-label="Class" role="cell">
                    <select
                      aria-label={`${fullName} class`}
                      disabled={!choice.ticked || choice.attendeeType !== "YOUTH"}
                      onChange={(event) => change(row.memberId, { classLevel: event.target.value })}
                      value={choice.attendeeType === "YOUTH" ? choice.classLevel : ""}
                    >
                      <option value="">None</option>
                      {clubClassLevels.map((level) => <option key={level} value={level}>{clubClassLevelLabels[level]}</option>)}
                    </select>
                  </td>
                  <td data-label={`${toClubYear} grade`} role="cell">
                    <select
                      aria-label={`${fullName} grade`}
                      disabled={!choice.ticked || choice.attendeeType !== "YOUTH"}
                      onChange={(event) => change(row.memberId, { schoolGrade: event.target.value })}
                      value={choice.attendeeType === "YOUTH" ? choice.schoolGrade : ""}
                    >
                      <option value="">Not given</option>
                      {clubSchoolGrades.map((grade) => <option key={grade} value={grade}>{clubSchoolGradeLabels[grade]}</option>)}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {error && <div className="inline-notice error" role="alert">{error}</div>}
      <div className="intro-actions">
        <button className="primary-button" disabled={busy || ticked.length === 0} type="submit">
          {busy ? "Starting…" : `Start the ${toClubYear} roster with ${ticked.length} ${ticked.length === 1 ? "person" : "people"}`}
        </button>
      </div>
    </form>
  );
}
