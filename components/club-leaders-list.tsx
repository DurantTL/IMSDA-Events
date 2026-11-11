import Link from "next/link";
import { GetFilterForm } from "@/components/get-filter-form";
import { clubRoleText } from "@/modules/access/role-descriptions";
import { CLUB_ROLE_LABELS, CLUB_ROLE_VALUES } from "@/modules/system-admin/people-directory-model";
import { ListPager } from "@/components/list-pager";
import { sliceFromCount, type PageSlice } from "@/lib/pagination";
import { ClubInvitesWorkspace } from "@/components/club-invites-workspace";
import type { ClubInviteRecord } from "@/modules/club-imports/invites";
import { CLUB_LEADERS_PAGE_SIZE, CLUB_LEADER_STATUSES, CLUB_LEADER_STATUS_LABELS, clubLeadersHref, type ClubLeader, type ClubLeaderFilters } from "@/modules/system-admin/club-leaders-model";
import styles from "./people-directory.module.css";

/** The Club leaders list (#1277, #1589): status, club and role filters (a GET form), then one row per current role, or per invite on the Invited and Draft views. Names link to the person page only when the viewer may open it. */
export function ClubLeadersList({
  leaders,
  clubs,
  filters,
  canOpenPeople,
  slice,
  hrefFor,
  invites = [],
  emailConfigured = true,
  drafts = { all: 0, club: null },
}: {
  leaders: readonly ClubLeader[];
  /** The Invited and Draft views list these instead of `leaders`. */
  invites?: readonly ClubInviteRecord[];
  emailConfigured?: boolean;
  drafts?: { all: number; club: number | null };
  clubs: readonly { id: string; name: string }[];
  filters: ClubLeaderFilters;
  canOpenPeople: boolean;
  /** Where this page sits in the whole list; a list that fits on one page needs none. */
  slice?: Pick<PageSlice<unknown>, "from" | "page" | "pageCount" | "to" | "total">;
  hrefFor?: (page: number) => string;
}) {
  const status = filters.status ?? "current";
  const showingInvites = status !== "current";
  const rows: readonly unknown[] = showingInvites ? invites : leaders;
  const position = slice ?? sliceFromCount([...rows], 1, rows.length, CLUB_LEADERS_PAGE_SIZE);
  const filtered = Boolean(filters.clubId || filters.role);
  const noun = showingInvites ? (status === "invited" ? "sent invites" : "draft invites") : "current roles";
  const nounOne = showingInvites ? (status === "invited" ? "sent invite" : "draft invite") : "current role";
  const clubName = filters.clubId ? clubs.find((club) => club.id === filters.clubId)?.name ?? null : null;
  // Leaders are added on the club's own page (Club admins). With one club picked, go straight there.
  const addHref = filters.clubId ? `/admin/organizations/${encodeURIComponent(filters.clubId)}/directors` : "/admin/clubs";
  return (
    <div className={styles.wrap}>
      <p className={styles.count}>{introText(status, invites.some((invite) => invite.expired))}</p>
      <p className={styles.addLeader}>
        <Link className="secondary-button" href={addHref}>Add a leader</Link>
      </p>
      {/* Keyed by the address's filters: Clear filters or Back remounts the uncontrolled selects at what the address says. There is no text box here to lose. */}
      <GetFilterForm action="/admin/clubs/leaders" className={styles.search} key={`${filters.clubId ?? ""}|${filters.role ?? ""}|${status}`}>
        <label className={styles.searchField}>
          Status
          <select defaultValue={status} name="status">
            {CLUB_LEADER_STATUSES.map((value) => <option key={value} value={value}>{CLUB_LEADER_STATUS_LABELS[value]}</option>)}
          </select>
        </label>
        <label className={styles.searchField}>
          Club
          <select defaultValue={filters.clubId ?? ""} name="club">
            <option value="">All clubs</option>
            {clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}
          </select>
        </label>
        <label className={styles.searchField}>
          Role
          <select defaultValue={filters.role ? filters.role.toLowerCase() : ""} name="role">
            <option value="">All roles</option>
            {CLUB_ROLE_VALUES.map((role) => <option key={role} value={role.toLowerCase()}>{CLUB_ROLE_LABELS[role]}</option>)}
          </select>
        </label>
        <button className="primary-button" type="submit">Show</button>
        {filtered ? <Link className="secondary-button" href={clubLeadersHref({ clubId: null, role: null, status })}>Clear filters</Link> : null}
      </GetFilterForm>
      {/* On an empty Invited or Draft view the invites workspace says so itself, once. */}
      {rows.length === 0
        ? (showingInvites ? null : <p className={styles.count} role="status">No current club leaders found.</p>)
        : <ListPager hrefFor={hrefFor} label="Club leader pages" noun={noun} nounOne={nounOne} part="count" slice={position} />}
      {showingInvites ? (
        <ClubInvitesWorkspace club={clubName && filters.clubId ? { id: filters.clubId, name: clubName } : null} drafts={drafts} emailConfigured={emailConfigured} draftHref={clubLeadersHref({ clubId: filters.clubId, role: filters.role, status: "draft" })} emptyText={emptyText(status, filtered)} invites={[...invites]} status={status === "draft" ? "draft" : "invited"} />
      ) : rows.length === 0 ? (
        <p className={styles.empty}>{emptyText(status, filtered)}</p>
      ) : (
        <ul className={styles.list}>
          {leaders.map((leader) => {
            const who = (
              <>
                <strong translate="no">{leader.name || leader.email}</strong>
                <small translate="no">{leader.email}</small>
              </>
            );
            return (
              <li className={styles.row} key={leader.key}>
                {canOpenPeople ? (
                  <Link className={styles.rowLink} href={`/admin/people/account/${leader.accountId}`}>{who}</Link>
                ) : (
                  <div className={styles.rowLink}>{who}</div>
                )}
                <p className={styles.access}>
                  <span translate="no">{leader.clubName}</span> · {leader.roleLabel}{" "}
                  <span className={`status-chip ${leader.twoStepOn ? "green" : "gold"}`}>{leader.twoStepOn ? "Two-step on" : "Two-step not set up"}</span>
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {rows.length > 0 && <ListPager hrefFor={hrefFor} label="Club leader pages" noun={noun} nounOne={nounOne} part="pages" slice={position} />}
    </div>
  );
}

/** What an empty list says, by the status shown and whether a club or role narrows it. */
function emptyText(status: "current" | "invited" | "draft", filtered: boolean): string {
  if (status === "invited") return filtered ? "No sent invites match that club and role." : "No invites are waiting. Every invite that was sent has been accepted or cancelled.";
  if (status === "draft") return filtered ? "No draft invites match that club and role." : "No draft invites. Invites made by a club import wait here until you send them.";
  return filtered ? "Nobody currently holds that role." : "No club has a current Director, Deputy, Registrar or Reporter.";
}

const roleNames = `${clubRoleText.DIRECTOR.name}, ${clubRoleText.DEPUTY.name}, ${clubRoleText.REGISTRAR.name} or ${clubRoleText.REPORTER.name}`;

/** The one line under the page's title, by the status shown. */
function introText(status: "current" | "invited" | "draft", hasExpired = false): string {
  if (status === "invited") return `People invited as a club's Director, Deputy, Registrar or Reporter who have not accepted yet. Directors and deputies come from the club import; registrars and reporters are invited by their club's director.${hasExpired ? " Expired invites are not counted as waiting and need a Resend." : ""}`;
  if (status === "draft") return "Invites not sent yet. Nothing is emailed until you press Send. Most come from the club import.";
  return `Everyone who currently leads a club as ${roleNames}.`;
}
