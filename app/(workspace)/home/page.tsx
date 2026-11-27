import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ClubApplicationsModule, EventsFillingUpModule, LiveCheckInModule, MoneyThisSeasonModule, MonthlyRecordsModule, SeasonNumbersModule } from "@/components/home-modules";
import { ComingUpPage, NeedsYouPage } from "@/components/home-pages";
import { StaffHomeBoard } from "@/components/staff-home-board";
import { StaffInstallCard } from "@/components/staff-install-card";
import { StaffPageHeader } from "@/components/staff-page-header";
import { resolveAdminRoles } from "@/modules/access/admin-roles";
import { heldAdminRoles } from "@/modules/access/admin-roles-domain";
import { getCurrentSession } from "@/modules/access/current-session";
import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { buildNeedsView } from "@/modules/system-admin/home-needs-model";
import { loadComingUp } from "@/modules/system-admin/home-coming-up-repository";
import type { HomeModuleKey } from "@/modules/system-admin/home-layout-domain";
import { loadHomeLayout } from "@/modules/system-admin/home-layout-repository";
import { loadHomeExtraModules } from "@/modules/system-admin/home-extra-modules-repository";
import { loadHomeModules } from "@/modules/system-admin/home-modules-repository";
import { usableQuickLinks } from "@/modules/system-admin/home-quick-links-domain";
import { loadNeedsInput } from "@/modules/system-admin/home-needs-repository";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

/**
 * Home > Needs you (#1568). Any signed-in staff-workspace user may open it; it reads only what each role the person holds
 * already lets them see, and every item links to the page that does the work. Nothing here changes a record.
 * An admin also gets Arrange and Customize (#1705): their own saved set of modules, read only for the modules shown.
 */
export default async function HomeNeedsYouPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  const roles = await resolveAdminRoles(user);
  const held = heldAdminRoles(roles);
  const header = (
    <>
      <StaffPageHeader description="What needs you, and what is coming up." />
      <StaffInstallCard />
    </>
  );

  if (held.length === 0) {
    // No admin role: today's view, with no Arrange or Customize.
    const view = buildNeedsView(await loadNeedsInput(roles, held));
    const comingUp = view.allClear || view.noAdminRole ? await loadComingUp(user, async () => held) : null;
    return (
      <section className="page-stack">
        {header}
        <NeedsYouPage view={view} comingUp={comingUp} />
      </section>
    );
  }

  const layout = await loadHomeLayout(user.id, roles);
  const shown = new Set<HomeModuleKey>(layout.modules.filter((module) => module.shown).map((module) => module.key));
  const comingUpShown = shown.has("coming-up");
  // Coming up sits under the all-clear message (#1747) only when it is not its own card.
  // The module reads start first: a system administrator's every-event read then also serves Needs you's own events, so
  // each heavy read runs once per request (modules/system-admin/request-reads.ts).
  const modulesRead = loadHomeModules(roles, shown);
  const extraRead = loadHomeExtraModules(user.id, roles, shown);
  const view = buildNeedsView(await loadNeedsInput(roles, held));
  const comingUp = comingUpShown || view.allClear ? await loadComingUp(user, async () => held) : null;
  const bodies: Partial<Record<HomeModuleKey, ReactNode>> = {};
  if (shown.has("needs-you")) bodies["needs-you"] = <NeedsYouPage view={view} headingLevel={3} comingUp={comingUpShown ? null : comingUp} />;
  if (comingUpShown && comingUp) bodies["coming-up"] = <ComingUpPage events={comingUp.events} nextStep={comingUp.nextStep} />;
  // Only the modules turned on are read, each scoped to the person's own roles.
  const data = await modulesRead;
  if (shown.has("events-filling-up")) bodies["events-filling-up"] = <EventsFillingUpModule view={data["events-filling-up"] ?? null} />;
  if (shown.has("season-numbers")) bodies["season-numbers"] = <SeasonNumbersModule view={data["season-numbers"] ?? null} />;
  if (shown.has("monthly-records")) bodies["monthly-records"] = <MonthlyRecordsModule view={data["monthly-records"] ?? null} />;
  // Club applications, Money this season and Live check-in (#1893): each read only when shown and allowed.
  const extra = await extraRead;
  const resting: HomeModuleKey[] = [];
  if (shown.has("club-applications")) bodies["club-applications"] = <ClubApplicationsModule view={extra["club-applications"] ?? null} />;
  if (shown.has("money-this-season")) bodies["money-this-season"] = <MoneyThisSeasonModule view={extra["money-this-season"] ?? null} />;
  if (shown.has("live-check-in")) {
    const live = extra["live-check-in"];
    // Live check-in is on Home only while check-in is open at an event the person can check people in at.
    if (live && live.rows.length === 0) resting.push("live-check-in");
    else if (live !== undefined) bodies["live-check-in"] = <LiveCheckInModule view={live} />;
    else resting.push("live-check-in");
  }
  const quickLinkOptions = usableQuickLinks(roles).map(({ key, label, href }) => ({ key, label, href }));
  return (
    <section className="page-stack">
      {header}
      <StaffHomeBoard modules={layout.modules} bodies={bodies} resting={resting} quickLinkOptions={quickLinkOptions} />
    </section>
  );
}
