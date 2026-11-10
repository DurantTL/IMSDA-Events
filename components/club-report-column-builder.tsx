"use client";

import { useId, useState } from "react";
import { DisabledHint, disabledHintId } from "@/components/disabled-hint";
import { CoordinatorClubPicker } from "@/components/coordinator-club-picker";
import { useConfirm } from "@/components/use-confirm";
import { CLUB_REPORT_ROLE_OPTIONS } from "@/modules/reporting/club-report-filters";
import { conferenceDateFormat } from "@/modules/calendar/conference-format";
import { fileNameFromDisposition } from "@/components/export-link";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import styles from "@/components/club-report-column-builder.module.css";

export type ClubReportColumnOption = { key: string; header: string };
export type ClubReportLayoutOption = { id: string; name: string; columns: string[]; filters?: { roles?: string[]; clubIds?: string[] } };
export type ClubReportClubOption = { id: string; name: string };
export type ClubReportLocationOption = { id: string; name: string };

type Table = { headers: string[]; rows: string[][]; totalRows: number; clubNames?: string[] };
type ApiError = { message?: string; error?: string };

/**
 * The club report column chooser (#1671), shared by staff and Area Coordinators: tick and order columns, preview a few
 * rows, print (one page per club or one list) or download a CSV, and save the choice as a named layout. Only the
 * columns the server offered this viewer are shown, and the server checks them again on every request. The club, role
 * and location filters (#1762) narrow the preview, print and CSV alike, and the server applies them. Saved layouts
 * hold column keys and the role and club filters, never data and never a location.
 */
export function ClubReportColumnBuilder({ endpoint, eventName, options, defaultKeys, initialLayouts, locationId = null, canSaveLayouts = true, clubs = [], locations = [] }: {
  endpoint: string;
  /** Named in the print window title and headings. */
  eventName: string;
  /** False for view-only access: layouts can be loaded but not saved or deleted. */
  canSaveLayouts?: boolean;
  options: ClubReportColumnOption[];
  defaultKeys: string[];
  initialLayouts: ClubReportLayoutOption[];
  /** The location the page already narrowed to, if any; it starts the location filter. */
  locationId?: string | null;
  /** Only the clubs registered to this event. */
  clubs?: ClubReportClubOption[];
  /** The event's locations; empty for an event without locations, which hides the location filter. */
  locations?: ClubReportLocationOption[];
}) {
  const ids = useId();
  const [chosen, setChosen] = useState<string[]>(defaultKeys);
  const [layouts, setLayouts] = useState(initialLayouts);
  const [layoutName, setLayoutName] = useState("");
  const [perClub, setPerClub] = useState(true);
  const [allClubs, setAllClubs] = useState(true);
  const [clubIds, setClubIds] = useState<string[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const pageLocation = locationId && locations.some((entry) => entry.id === locationId) ? locationId : "";
  const [location, setLocation] = useState(pageLocation);
  const [preview, setPreview] = useState<Table | null>(null);
  // The staff page's own location filter can change while this stays mounted (a layout name may be half typed), so the
  // builder follows it instead of being remounted.
  const [seenPageLocation, setSeenPageLocation] = useState(pageLocation);
  if (seenPageLocation !== pageLocation) {
    setSeenPageLocation(pageLocation);
    setLocation(pageLocation);
    setPreview(null);
  }
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState<"preview" | "csv" | "print" | "save" | null>(null);
  const [nameError, setNameError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // Only a layout being named is saved work; column picks and the preview just shape a download.
  useUnsavedChangesGuard(layoutName.trim() !== "", "You typed a layout name but have not saved it. Leave this page and discard it?");
  const { confirm, confirmDialog } = useConfirm();
  const headerOf = (key: string) => options.find((option) => option.key === key)?.header ?? key;

  function toggle(key: string) {
    setPreview(null);
    setChosen((current) => (current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]));
  }

  function move(index: number, delta: -1 | 1) {
    setPreview(null);
    setChosen((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = current.slice();
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  const clubFilter = allClubs ? [] : clubIds;
  const filtersActive = clubFilter.length > 0 || roles.length > 0 || location !== "" || (!allClubs && clubs.length > 0);
  // Roles and clubs only: this is what a saved layout keeps. A location belongs to one event and is never saved.
  const layoutFilters = { ...(roles.length ? { roles } : {}), ...(clubFilter.length ? { clubIds: clubFilter } : {}) };

  function toggleRole(role: string) {
    setPreview(null);
    setRoles((current) => (current.includes(role) ? current.filter((entry) => entry !== role) : [...current, role]));
  }

  function clearFilters() {
    setPreview(null);
    setAllClubs(true);
    setClubIds([]);
    setRoles([]);
    setLocation("");
  }

  async function post(body: Record<string, unknown>) {
    return fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }

  async function failure(response: Response, fallback: string) {
    const result = await response.json().catch(() => ({})) as ApiError;
    return Object.assign(new Error(result.message ?? fallback), { code: result.error });
  }

  async function run(action: "preview" | "csv" | "print") {
    setError("");
    setNotice("");
    setBusy(true);
    setWorking(action);
    // A pop-up must open straight from the click, before the request, or the browser blocks it.
    const printWindow = action === "print" ? window.open("", "_blank") : null;
    try {
      if (action === "print" && !printWindow) throw new Error("Allow pop-ups for this site to print, then try again.");
      const response = await post({ action, columns: chosen, filters: { ...layoutFilters, ...(location ? { locationId: location } : {}) } });
      if (!response.ok) throw await failure(response, "The report could not be built.");
      if (action === "csv") {
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement("a");
        link.href = url;
        link.download = fileNameFromDisposition(response.headers.get("Content-Disposition")) ?? "club-attendee-report.csv";
        link.click();
        URL.revokeObjectURL(url);
        setNotice("Downloaded the report.");
      } else if (action === "print") {
        writePrintWindow(printWindow!, await response.json() as Table, perClub, eventName);
      } else {
        setPreview(await response.json() as Table);
      }
    } catch (caught) {
      printWindow?.close();
      setError(caught instanceof Error ? caught.message : "The report could not be built.");
    } finally {
      setBusy(false);
      setWorking(null);
    }
  }

  async function saveLayout(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = layoutName.trim();
    if (!name || chosen.length === 0) return;
    setError("");
    setNotice("");
    setNameError("");
    setBusy(true);
    setWorking("save");
    try {
      const response = await post({ action: "save-layout", name, columns: chosen, ...(Object.keys(layoutFilters).length ? { filters: layoutFilters } : {}) });
      if (!response.ok) throw await failure(response, "The layout could not be saved.");
      setLayouts(((await response.json()) as { layouts: ClubReportLayoutOption[] }).layouts);
      setLayoutName("");
      setNotice(`Saved "${name}".`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "The layout could not be saved.";
      // A taken name belongs next to the name field; anything else goes in the shared alert.
      if (caught instanceof Error && (caught as { code?: string }).code === "LAYOUT_NAME_TAKEN") setNameError(message);
      else setError(message);
    } finally {
      setBusy(false);
      setWorking(null);
    }
  }

  async function deleteLayout(layout: ClubReportLayoutOption) {
    if (!(await confirm({
      title: `Delete ${layout.name}?`,
      body: <p>The saved layout is removed for everyone who builds this report. The report itself is not changed.</p>,
      confirmLabel: `Delete ${layout.name}`,
      destructive: true,
    }))) return;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const response = await post({ action: "delete-layout", layoutId: layout.id });
      if (!response.ok) throw await failure(response, "The layout could not be deleted.");
      setLayouts(((await response.json()) as { layouts: ClubReportLayoutOption[] }).layouts);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The layout could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  function applyLayout(layout: ClubReportLayoutOption) {
    // Only keys this viewer was offered come in, whatever the layout holds.
    setChosen(layout.columns.filter((key) => options.some((option) => option.key === key)));
    // Club ids not registered to this event are ignored; a layout with no filters clears the role and club choice.
    const layoutClubs = (layout.filters?.clubIds ?? []).filter((id) => clubs.some((club) => club.id === id));
    setClubIds(layoutClubs);
    setAllClubs(layoutClubs.length === 0);
    setRoles((layout.filters?.roles ?? []).filter((role) => CLUB_REPORT_ROLE_OPTIONS.includes(role)));
    setPreview(null);
    setError("");
    setNotice(`Loaded "${layout.name}".`);
  }

  const noClubTicked = !allClubs && clubIds.length === 0;
  const none = chosen.length === 0 || noClubTicked;
  const clubHint = noClubTicked ? "Tick at least one club, or choose All clubs." : null;

  return (
    <div className={styles.builder}>
      {confirmDialog}
      <h3 className={styles.heading}>Choose columns</h3>
      <p className={`field-help ${styles.sub}`}>Tick the columns you need and put them in order. Nothing else is included. The default is club, name and role.</p>

      {layouts.length > 0 && (
        <div className={styles.group}>
          <p className={styles.groupTitle}>Saved layouts</p>
          <ul className={styles.layouts}>
            {layouts.map((layout) => (
              <li className={styles.layoutItem} key={layout.id}>
                <button className="secondary-button" disabled={busy} onClick={() => applyLayout(layout)} type="button">{layout.name}</button>
                {canSaveLayouts && <button aria-label={`Delete saved layout "${layout.name}"`} className={`text-button ${styles.small}`} disabled={busy} onClick={() => deleteLayout(layout)} type="button">Delete</button>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <fieldset className={styles.group}>
        <legend className={styles.groupTitle}>Columns to include</legend>
        <ul className={styles.choices}>
          {options.map((option) => (
            <li key={option.key}>
              <label className={styles.choice}>
                <input checked={chosen.includes(option.key)} onChange={() => toggle(option.key)} type="checkbox" />
                {option.header}
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      {chosen.length === 0 ? <p className={styles.message}>Choose at least one column.</p> : (
        <div className={styles.group}>
          <p className={styles.groupTitle} id={`${ids}-order`}>Order</p>
          <ol aria-labelledby={`${ids}-order`} className={styles.order}>
            {chosen.map((key, index) => (
              <li className={styles.orderRow} key={key}>
                <span className={styles.orderName}>{headerOf(key)}</span>
                <button aria-label={`Move ${headerOf(key)} up`} className={`text-button ${styles.small}`} disabled={index === 0} onClick={() => move(index, -1)} type="button">Up</button>
                <button aria-label={`Move ${headerOf(key)} down`} className={`text-button ${styles.small}`} disabled={index === chosen.length - 1} onClick={() => move(index, 1)} type="button">Down</button>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className={styles.group}>
        <p className={styles.groupTitle}>Who to include</p>
        <p className={`field-help ${styles.sub}`}>Leave a filter alone to include everyone. Filters apply to the preview, the printout and the download.</p>
        {clubs.length > 0 && (
          <CoordinatorClubPicker
            allClubs={allClubs}
            clubs={clubs}
            onChange={(next) => { setPreview(null); setAllClubs(next.all); setClubIds(next.ids); }}
            selectedIds={clubIds}
          />
        )}
        <fieldset className={styles.group}>
          <legend className={styles.groupTitle}>Role</legend>
          <ul className={styles.choices}>
            {CLUB_REPORT_ROLE_OPTIONS.map((role) => (
              <li key={role}>
                <label className={styles.choice}>
                  <input checked={roles.includes(role)} onChange={() => toggleRole(role)} type="checkbox" />
                  {role}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        {locations.length > 0 && (
          <label className={styles.locationField}>
            Location
            <select onChange={(event) => { setPreview(null); setLocation(event.target.value); }} value={location}>
              <option value="">All locations</option>
              {locations.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select>
          </label>
        )}
        {filtersActive && <div><button className="text-button" onClick={clearFilters} type="button">Clear filters</button></div>}
      </div>

      <fieldset className={`${styles.group} ${styles.printChoice}`}>
        <legend className={styles.groupTitle}>When printing</legend>
        <label className={styles.choice}><input checked={perClub} name={`${ids}-print`} onChange={() => setPerClub(true)} type="radio" />One page per club</label>
        <label className={styles.choice}><input checked={!perClub} name={`${ids}-print`} onChange={() => setPerClub(false)} type="radio" />One list</label>
      </fieldset>

      {error && <p className={`status-chip coral ${styles.message}`} role="alert">{error}</p>}
      {notice && <p className={`status-chip green ${styles.message}`} role="status">{notice}</p>}

      <DisabledHint id={`${ids}-club-hint`} reason={clubHint} />
      <div className={styles.actions}>
        <button className="secondary-button" aria-describedby={disabledHintId(clubHint, `${ids}-club-hint`)} disabled={busy || none} onClick={() => run("preview")} type="button">{working === "preview" ? "Working…" : "Preview"}</button>
        <button className="secondary-button" aria-describedby={disabledHintId(clubHint, `${ids}-club-hint`)} disabled={busy || none} onClick={() => run("print")} type="button">{working === "print" ? "Working…" : "Print"}</button>
        <button className="primary-button" aria-describedby={disabledHintId(clubHint, `${ids}-club-hint`)} disabled={busy || none} onClick={() => run("csv")} type="button">{working === "csv" ? "Downloading…" : "Download CSV"}</button>
      </div>
      <p className={`field-help ${styles.excelHelp}`}>The CSV opens in Excel with names and accents intact.</p>

      {preview && (
        <div className={styles.group}>
          <p className={styles.groupTitle}>Preview{preview.totalRows > preview.rows.length ? ` (first ${preview.rows.length} of ${preview.totalRows})` : ` (${preview.totalRows})`}</p>
          {preview.rows.length === 0 ? <p className={styles.message}>{filtersActive ? "No one matches these filters." : "No people are registered yet."}</p> : (
            <div className={styles.previewWrap}>
              <table className={`report-table ${styles.previewTable}`}>
                <caption className="sr-only">Preview of the club report</caption>
                <thead><tr>{preview.headers.map((header, index) => <th key={index} scope="col">{header}</th>)}</tr></thead>
                <tbody>{preview.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {canSaveLayouts && (
        <form className={styles.saveRow} onSubmit={saveLayout}>
          <label>
            Save these columns and filters as a layout
            <input aria-describedby={nameError ? `${ids}-name-error` : undefined} aria-invalid={nameError ? true : undefined} maxLength={80} onChange={(event) => { setLayoutName(event.target.value); setNameError(""); }} placeholder="e.g. Spring Camporee check-in" type="text" value={layoutName} />
            {nameError && <span className={`${styles.fieldError} ${styles.message}`} id={`${ids}-name-error`}>{nameError}</span>}
          </label>
          <button className="secondary-button" disabled={busy || none || !layoutName.trim()} type="submit">{working === "save" ? "Saving…" : "Save layout"}</button>
        </form>
      )}
    </div>
  );
}

/** Writes the print document with DOM calls only (text, never markup), so a name can't inject anything. */
function writePrintWindow(target: Window, table: Table, perClub: boolean, eventName: string) {
  const doc = target.document;
  const printedOn = conferenceDateFormat({ month: "long", day: "numeric", year: "numeric" }).format(new Date());
  const title = `${eventName} club report, ${printedOn}`;
  doc.title = title;
  const style = doc.createElement("style");
  style.textContent = "body{font-family:system-ui,sans-serif;margin:24px;color:#111}table{border-collapse:collapse;width:100%;margin-bottom:24px}th,td{border:1px solid #888;padding:6px 8px;text-align:left;font-size:14px}h1{font-size:18px}.club{break-after:page}.club:last-child{break-after:auto}";
  doc.head.append(style);
  const heading = (text: string) => {
    const h = doc.createElement("h1");
    h.textContent = text;
    return h;
  };
  const buildTable = (rows: string[][]) => {
    const element = doc.createElement("table");
    const head = element.createTHead().insertRow();
    for (const header of table.headers) {
      const th = doc.createElement("th");
      th.scope = "col";
      th.textContent = header;
      head.append(th);
    }
    const body = element.createTBody();
    for (const row of rows) {
      const tr = body.insertRow();
      for (const value of row) tr.insertCell().textContent = value;
    }
    return element;
  };
  const clubNames = table.clubNames ?? [];
  if (!perClub || clubNames.length === 0) {
    doc.body.append(heading(title), buildTable(table.rows));
  } else {
    const order = [...new Set(clubNames)];
    for (const club of order) {
      const section = doc.createElement("section");
      section.className = "club";
      section.append(heading(`${club}: ${title}`), buildTable(table.rows.filter((_, index) => clubNames[index] === club)));
      doc.body.append(section);
    }
  }
  target.focus();
  target.print();
}
