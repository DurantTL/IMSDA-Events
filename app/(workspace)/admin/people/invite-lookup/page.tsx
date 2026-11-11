import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminPageHeader } from "@/components/admin-page-header";
import { PersonGrantPanel } from "@/components/person-grant-panel";
import styles from "@/components/people-directory.module.css";
import { resolvePeopleViewer } from "@/modules/system-admin/people-access";
import { listClubOptions } from "@/modules/system-admin/people-directory";
import { formatGrantParam, parseGrantParam, planGrantItems } from "@/modules/system-admin/people-directory-model";
import { findInviteLookupPerson, normalizeLookupEmail } from "@/modules/system-admin/people-invite-lookup";
import { deferredPersonHref } from "@/modules/system-admin/people-invite-href";

export const metadata: Metadata = { title: "Give a club role" };
export const dynamic = "force-dynamic";

/**
 * Give a first club role to an existing website account (#1804). A Clubs Administrator opens club people only, so a
 * person with no club role yet is found here by email, and only what is needed to give the role is shown. A club person,
 * and anyone for a system administrator, goes to the normal person page with the chosen access ready to save.
 */
export default async function InviteLookupPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string | string[]; grant?: string | string[] }>;
}) {
  const viewer = await resolvePeopleViewer();
  if (!viewer.user) redirect(await staffLoginRedirectPath());
  if (!viewer.scope) redirect("/no-access");
  const query = await searchParams;
  const email = normalizeLookupEmail(query.email);
  // Only the family items (Area Coordinator, club roles) can be given from here.
  const items = parseGrantParam(query.grant).filter((item) => item.type === "ac" || item.type === "club");
  const person = email ? await findInviteLookupPerson(email, viewer.scope) : null;

  if (person?.scope === "full") redirect(deferredPersonHref(person, items));
  if (person?.scope === "clubs" && person.clubPerson) redirect(deferredPersonHref({ staffId: null, accountId: person.accountId }, items));

  const clubOptions = person ? await listClubOptions() : [];
  const rows = person?.scope === "clubs" && !person.clubPerson
    ? planGrantItems(items, "clubs", {
      hasStaff: false,
      hasAccount: true,
      systemAdministrator: false,
      clubsAdministrator: false,
      areaCoordinator: false,
      activeEvents: [],
      clubRoles: [],
    })
    : [];

  return (
    <>
      <AdminPageHeader path="/admin/people/invite-lookup" back={{ href: "/admin/people", label: "Back to People & access" }} />
      <div className={styles.wrap}>
        <form action="/admin/people/invite-lookup" className={styles.box} method="get">
          <h2>Find the person by email</h2>
          <p className={styles.lead}>Use this to give a club role to someone who already has a website account but no club role yet.</p>
          <div className={styles.inline}>
            <label className={styles.field}>
              Email
              <input autoComplete="off" defaultValue={email} maxLength={254} name="email" required type="email" />
            </label>
            <button className="primary-button" type="submit">Look up</button>
          </div>
          {items.length > 0 ? <input name="grant" type="hidden" value={formatGrantParam(items)} /> : null}
        </form>

        {email && !person ? (
          <div className={styles.box}>
            <h2>No website account found</h2>
            <p>No website account uses {email}. Choose the club role in Invite a person instead; it sends them a club invite.</p>
          </div>
        ) : null}

        {person?.scope === "clubs" && !person.clubPerson ? (
          <div className={styles.wrap}>
            <div className={styles.box}>
              <div className={styles.who}>
                <strong>{person.displayName}</strong>
                <span>{email}</span>
              </div>
              <p className={styles.lead}>They have a website account and no club role yet.</p>
            </div>
            {rows.length > 0 ? (
              <PersonGrantPanel
                cleanHref={`/admin/people/account/${encodeURIComponent(person.accountId)}`}
                clubNames={Object.fromEntries(clubOptions.map((club) => [club.id, club.name]))}
                eventNames={{}}
                person={{ staffId: null, accountId: person.accountId, staffEmail: null, accountEmail: person.accountEmail, displayName: person.displayName }}
                rows={rows}
              />
            ) : (
              <p className={styles.note}>There is no club role to give yet. Choose the club role in Invite a person, then come back here.</p>
            )}
          </div>
        ) : null}
      </div>
    </>
  );
}
