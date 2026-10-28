import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { parseGrantParam, parsePeopleQuery, planGrantItems } from "@/modules/system-admin/people-directory-model";
import { PendingInvites } from "@/components/pending-invites";
import { PersonAccess } from "@/components/person-access";
import { PersonGrantPanel } from "@/components/person-grant-panel";
import { listPendingInvites } from "@/modules/system-admin/pending-invites";
import { AdminPageHeader } from "@/components/admin-page-header";
import styles from "@/components/people-directory.module.css";
import { resolvePeopleViewer } from "@/modules/system-admin/people-access";
import { isUnifiedSignInEnabled } from "@/modules/account-merge/account-link";
import { getPersonDetail, listClubOptions, listEventOptions } from "@/modules/system-admin/people-directory";

export const metadata: Metadata = { title: "People & access" };
export const dynamic = "force-dynamic";

export default async function PersonAccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string; id: string }>;
  searchParams: Promise<{ from?: string | string[]; grant?: string | string[] }>;
}) {
  const viewer = await resolvePeopleViewer();
  if (!viewer.user) redirect(await staffLoginRedirectPath());
  if (!viewer.scope) redirect("/no-access");
  const { kind, id } = await params;
  // The search this person was opened from, so Back returns to it (same parsing as the list).
  const query = await searchParams;
  const from = parsePeopleQuery(query.from);
  const grantItems = parseGrantParam(query.grant);
  if ((kind !== "staff" && kind !== "account") || id.length > 64) notFound();
  const person = await getPersonDetail(kind, id, viewer.scope);
  if (!person) notFound();
  const full = viewer.scope === "full";
  const [eventOptions, clubOptions, linkedEmailChangesTogether, pending] = await Promise.all([
    full ? listEventOptions() : [],
    listClubOptions(),
    full ? isUnifiedSignInEnabled() : false,
    // Invites addressed to this person's staff or website email (a Clubs Administrator never sees staff logins).
    listPendingInvites({ emails: [person.staffEmail, person.accountEmail].filter((email): email is string => Boolean(email)), scope: viewer.scope }),
  ]);
  const grantRows = planGrantItems(grantItems, viewer.scope, {
    hasStaff: person.staffId !== null,
    hasAccount: person.accountId !== null,
    systemAdministrator: person.systemAdministrator,
    clubsAdministrator: person.clubsAdministrator,
    areaCoordinator: person.areaCoordinator,
    activeEvents: (person.events ?? []).filter((event) => event.active).map((event) => ({ eventId: event.eventId, role: event.role })),
    clubRoles: person.clubs.filter((club) => club.status === "active" || club.status === "scheduled").map((club) => ({ organizationId: club.organizationId, role: club.role })),
  });
  const cleanHref = `/admin/people/${kind}/${encodeURIComponent(id)}${from ? `?from=${encodeURIComponent(from)}` : ""}`;
  return (
    <>
      <AdminPageHeader
        path={`/admin/people/${kind}/${id}`}
        back={{ href: from ? `/admin/people?q=${encodeURIComponent(from)}` : "/admin/people", label: "Back to People & access" }}
      />
      {grantRows.length > 0 || pending.invites.length > 0 ? (
        <div className={styles.wrap} style={{ marginBottom: 14 }}>
          {grantRows.length > 0 ? (
            <PersonGrantPanel
              cleanHref={cleanHref}
              clubNames={Object.fromEntries(clubOptions.map((club) => [club.id, club.name]))}
              eventNames={Object.fromEntries(eventOptions.map((event) => [event.id, event.name]))}
              person={{ staffId: person.staffId, accountId: person.accountId, staffEmail: person.staffEmail, accountEmail: person.accountEmail, displayName: person.staff?.displayName ?? person.name }}
              rows={grantRows}
            />
          ) : null}
          <PendingInvites emailConfigured={pending.emailConfigured} heading="Pending invites for this person" invites={pending.invites} />
        </div>
      ) : null}
      <PersonAccess
        clubOptions={clubOptions}
        eventOptions={eventOptions}
        linkedEmailChangesTogether={linkedEmailChangesTogether}
        person={person}
        scope={viewer.scope}
        viewerUserId={viewer.user.id}
      />
    </>
  );
}
