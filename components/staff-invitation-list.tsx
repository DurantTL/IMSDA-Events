import Link from "next/link";
import { ColumnHeader } from "@/components/column-header";
import { EmptyState, NoMatchesState } from "@/components/empty-state";
import { InvitationRowActions, InvitationRowSelect, InvitationSelectionBar, InvitationSelectionProvider } from "@/components/staff-invitation-actions";
import { ListPager } from "@/components/list-pager";
import { SortOrderNote } from "@/components/list-sort";
import { SearchAsYouTypeForm, SearchResultStatus } from "@/components/search-as-you-type";
import {
  INVITATION_STATUSES,
  INVITATION_STATUS_LABEL,
  STAFF_INVITATION_GROUPS,
  STAFF_INVITATION_GROUP_LABEL,
  type InvitationStatus,
} from "@/modules/staff-invitations/domain";
import {
  INVITATION_DEFAULT_SORT,
  INVITATION_SORT_COLUMNS,
  invitationListHref,
  type InvitationListQuery,
  type InvitationSortColumn,
} from "@/modules/staff-invitations/list-query";
import type { InvitationListRow } from "@/modules/staff-invitations/repository";
import { serverSort, sortOrderText } from "@/lib/list-sort";
import { sliceFromCount } from "@/lib/pagination";
import { formatPersonName } from "@/lib/person-name";

type Props = {
  eventId: string;
  rows: InvitationListRow[];
  counts: Record<InvitationStatus, number>;
  /** What the address asked for: the filters, the order and the page. The server filtered, ordered and paged the rows (#1492). */
  query: InvitationListQuery;
  /** Invitations matching the filters, across every page. */
  total: number;
  /** Every invitation of the event, whatever the filters. */
  totalAll: number;
  /** The page the rows are, after the server clamped it to the real total. */
  page: number;
  pageSize: number;
  /** MANAGE_COMMUNICATIONS: sending is a bulk communication and needs it. */
  canSend: boolean;
};

const LIST_PATH = "/people/staff-invitations";

// The sortable columns. The keys are the whitelist the server reads from the address (INVITATION_SORT_COLUMNS).
const SORT_LABELS: Record<InvitationSortColumn, { label: string; kind: "text" | "group" | "state" }> = {
  person: { label: "Person", kind: "text" },
  group: { label: "Group", kind: "group" },
  status: { label: "Status", kind: "state" },
};

function tone(status: InvitationStatus) {
  switch (status) {
    case "APPROVED":
    case "SENT":
      return "green";
    case "REGISTERED":
    case "NOT_SENT":
      return "gold";
    case "DELIVERY_FAILED":
    case "DECLINED":
      return "coral";
    default:
      return "neutral";
  }
}

/**
 * The invite list (#804): each person's status, filters, select-all, and the actions on the selection. Revoke is for links nobody
 * has used. Sending is a person's explicit action: Send opens a preview of the exact email and how many go, and nothing is
 * queued until that is confirmed. The emails are queued in the event's outbox; this never delivers anything itself.
 * The list is searched, filtered, ordered and paged in the database from the address (#1492); the ticks and actions are in
 * `staff-invitation-actions.tsx`.
 */
export function StaffInvitationList({ eventId, rows, counts, query, total, totalAll, page, pageSize, canSend }: Props) {
  const { filters, sort } = query;
  const filtersSet = filters.status !== "ALL" || filters.group !== "ALL" || filters.search !== "";
  const slice = sliceFromCount(rows, page, total, pageSize);
  const bareHref = `${LIST_PATH}?event=${encodeURIComponent(eventId)}`;
  const pageHref = (target: number) => invitationListHref(LIST_PATH, eventId, { ...query, page: target });
  // The header links keep the filters and the event, flip the direction on the active column and drop the page.
  const address = Object.fromEntries(new URLSearchParams(invitationListHref(LIST_PATH, eventId, { ...query, page: 1 }).split("?")[1]));
  const sorting = serverSort<InvitationSortColumn>(LIST_PATH, address, INVITATION_SORT_COLUMNS, INVITATION_DEFAULT_SORT);
  // The filters alone (no sort, no page), which "Select all N matching" asks the server to run again.
  const matchingQuery = invitationListHref("", eventId, { ...query, sort: INVITATION_DEFAULT_SORT, page: 1 }).split("?")[1]!.split("&").filter((part) => !part.startsWith("event=")).join("&");

  return (
    <section className="panel form-stack" aria-labelledby="staff-invite-list-title">
      <div className="section-heading">
        <div>
          <h3 id="staff-invite-list-title">Invite list</h3>
          <p className="field-help">
            {INVITATION_STATUSES.filter((entry) => counts[entry] > 0).map((entry) => `${counts[entry]} ${INVITATION_STATUS_LABEL[entry].toLowerCase()}`).join(" · ") || "Nobody invited yet."}
          </p>
        </div>
      </div>
      {/* Never keyed (#1431): the shared form follows the address after Back or a link. The server filters, so a change goes to the address. */}
      <SearchAsYouTypeForm action={LIST_PATH} aria-label="Filter invitations" className="staff-invite-filters">
        <input name="event" type="hidden" value={eventId} />
        {sort.key && <input name="sort" type="hidden" value={sort.key} />}
        {sort.key && <input name="dir" type="hidden" value={sort.dir} />}
        <label>
          Status
          <select data-default-value="ALL" defaultValue={filters.status} name="status">
            <option value="ALL">All statuses</option>
            {INVITATION_STATUSES.map((entry) => <option key={entry} value={entry}>{INVITATION_STATUS_LABEL[entry]} ({counts[entry]})</option>)}
          </select>
        </label>
        <label>
          Group
          <select data-default-value="ALL" defaultValue={filters.group} name="group">
            <option value="ALL">All groups</option>
            {STAFF_INVITATION_GROUPS.map((entry) => <option key={entry} value={entry}>{STAFF_INVITATION_GROUP_LABEL[entry]}</option>)}
          </select>
        </label>
        <label>
          Search
          <input defaultValue={filters.search} name="q" placeholder="Name or email" type="search" />
        </label>
        {filtersSet && <Link className="text-button" href={bareHref}>Clear filters</Link>}
      </SearchAsYouTypeForm>
      <SearchResultStatus message={filters.search === "" ? "" : `${total} ${total === 1 ? "invitation matches" : "invitations match"}.`} />

      <InvitationSelectionProvider canSend={canSend} eventId={eventId} matchingQuery={matchingQuery} pageIds={rows.map((row) => row.id)} total={total}>
        <InvitationSelectionBar />

        {rows.length === 0 ? (
          totalAll === 0
            ? (
              <EmptyState
                action={{ label: "Import a CSV", href: "#staff-invite-import-title" }}
                actionClass="secondary-button"
                canCreate
                className="empty-state"
                title="Nobody is invited yet"
              >
                Import a CSV of email addresses above to create the first personal links.
              </EmptyState>
            )
            : (
              <NoMatchesState
                className="empty-state"
                clear={{ href: bareHref }}
                known={`This list has ${totalAll} ${totalAll === 1 ? "invitation" : "invitations"}.`}
                noun="invitations"
                query={filters.search}
              />
            )
        ) : (
          <div className="report-table-wrap card-box">
            {sort.key && <SortOrderNote>{sortOrderText(SORT_LABELS[sort.key].label.toLowerCase(), sort.dir, SORT_LABELS[sort.key].kind)}</SortOrderNote>}
            <table className="report-table staff-invite-table">
              <thead>
                <tr>
                  <th scope="col"><span className="sr-only">Select</span></th>
                  <ColumnHeader column="person" label="Person" sorting={sorting} />
                  <ColumnHeader column="group" label="Group" sorting={sorting} />
                  <ColumnHeader column="status" label="Status" sorting={sorting} />
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td><InvitationRowSelect email={row.email} id={row.id} /></td>
                    <td data-label="Person">
                      <strong>{formatPersonName(row) || row.email}</strong>
                      {(row.firstName || row.lastName) && <><br /><span className="field-help">{row.email}</span></>}
                    </td>
                    <td data-label="Group">{STAFF_INVITATION_GROUP_LABEL[row.group]}</td>
                    <td data-label="Status">
                      <span className={`status-chip ${tone(row.status)}`}>{INVITATION_STATUS_LABEL[row.status]}</span>
                      {row.sentAt && row.status !== "REGISTERED" && row.status !== "APPROVED" && row.status !== "DECLINED" && (
                        <><br /><span className="field-help">Sent {row.sendCount > 1 ? `${row.sendCount} times, last ` : ""}{row.sentAt.slice(0, 16).replace("T", " ")} UTC</span></>
                      )}
                      {row.deliveryNote && <><br /><span className="field-help">{row.deliveryNote}</span></>}
                      {row.confirmationCode && <><br /><span className="field-help">{row.confirmationCode}</span></>}
                    </td>
                    <td data-label="Actions">
                      <InvitationRowActions id={row.id} reinvitable={row.reinvitable} reissuable={row.reissuable} usable={row.usable} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </InvitationSelectionProvider>
      <ListPager hrefFor={pageHref} label="Invitation pages" noun="invitations" nounOne="invitation" slice={slice} />
    </section>
  );
}
