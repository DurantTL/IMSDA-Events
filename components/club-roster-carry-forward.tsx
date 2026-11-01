"use client";

import { ExactValue } from "@/components/exact-value";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/post-json";
import { clubClassLevelLabels, clubClassLevels, clubRosterAttendeeTypeLabels } from "@/modules/club-rosters/domain";

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
  age: number | null;
  transferring?: boolean;
  transferWithStaff?: boolean;
};

type Choice = { ticked: boolean; attendeeType: AttendeeType; role: string; classLevel: string };

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
  const [choices, setChoices] = useState<Record<string, Choice>>(() => Object.fromEntries(
    rows.map((row) => [row.memberId, { ticked: !row.transferring, attendeeType: row.attendeeType, role: row.role, classLevel: row.classLevel ?? "" }]),
  ));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const ticked = useMemo(() => rows.filter((row) => choices[row.memberId]?.ticked), [rows, choices]);

  function change(memberId: string, patch: Partial<Choice>) {
    setChoices((current) => ({ ...current, [memberId]: { ...current[memberId]!, ...patch } }));
  }

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
      </div>
      <div className="report-table-wrap">
        <table className="report-table table-cards">
          <caption className="sr-only">{`People on the ${fromClubYear} roster`}</caption>
          <thead>
            <tr>
              <th scope="col">Carry forward</th>
              <th scope="col">Name</th>
              <th scope="col">Age</th>
              <th scope="col">{`${toClubYear} type`}</th>
              <th scope="col">Role</th>
              <th scope="col">Class</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const choice = choices[row.memberId]!;
              const fullName = `${row.firstName} ${row.lastName}`.trim();
              return (
                <tr key={row.memberId}>
                  <td data-label="Carry forward">
                    <input
                      aria-label={`Carry ${fullName} forward`}
                      checked={choice.ticked}
                      onChange={(event) => change(row.memberId, { ticked: event.target.checked })}
                      type="checkbox"
                    />
                  </td>
                  <th scope="row">
                    <ExactValue>{fullName}</ExactValue>
                    {row.transferring && <small> Transferring to another club</small>}
                    {row.transferWithStaff && <small> Transfer request is with conference staff</small>}
                  </th>
                  <td data-label="Age">{row.age ?? "—"}</td>
                  <td data-label={`${toClubYear} type`}>
                    <select
                      aria-label={`${fullName} type`}
                      disabled={!choice.ticked}
                      onChange={(event) => change(row.memberId, { attendeeType: event.target.value as AttendeeType })}
                      value={choice.attendeeType}
                    >
                      {Object.entries(clubRosterAttendeeTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </td>
                  <td data-label="Role">
                    <input
                      aria-label={`${fullName} role`}
                      disabled={!choice.ticked}
                      maxLength={60}
                      onChange={(event) => change(row.memberId, { role: event.target.value })}
                      value={choice.role}
                    />
                  </td>
                  <td data-label="Class">
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
