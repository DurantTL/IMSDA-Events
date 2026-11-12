import navStyles from "@/components/staff-records-nav.module.css";
import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { StaffPageHeader } from "@/components/staff-page-header";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ClubRecordsToReview } from "@/components/club-records-to-review";
import { ClubReportsConference } from "@/components/club-reports-conference";
import { hasClubsAdministration } from "@/modules/access/admin-roles";
import { getCurrentSession } from "@/modules/access/current-session";
import { calendarDateIn } from "@/modules/calendar/domain";
import { chooseReportMonth } from "@/modules/club-reports/clubs-admin-home-model";
import { clubYearMonths } from "@/modules/club-reports/domain";
import { getAreaClubsSummary } from "@/modules/club-reports/area-summary-repository";
import { listClubReportsForYear } from "@/modules/club-reports/repository";
import { REVIEW_FILTER, recordsToReview } from "@/modules/club-reports/review-domain";
import { clubYearFor } from "@/modules/club-rosters/domain";
import { AdminPageHeader } from "@/components/admin-page-header";
import { MonthlyRecordReminders } from "@/components/monthly-record-reminders";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";
import { getMonthlyRecordReminderOverview } from "@/modules/club-reports/monthly-reminders";
import {
  REMINDER_LOG_DEFAULT_SORT,
  REMINDER_LOG_PREFIX,
  REMINDER_LOG_SORT_COLUMNS,
} from "@/modules/club-reports/monthly-reminders-domain";
import { isAccountEmailConfigured } from "@/modules/communications/account-email";
import { serverSort, sortParamNames } from "@/lib/list-sort";

export const metadata: Metadata = { title: "Review monthly records" };
export const dynamic = "force-dynamic";

export default async function ClubReportsAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (!(await hasClubsAdministration(user))) redirect("/no-access");
  const search = await searchParams;
  const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);
  const year = one(search.year);
  const monthParam = one(search.month);
  const review = one(search.review);
  const now = new Date();
  const current = clubYearFor(now);
  const clubYear = year && /^\d{4}-\d{2}$/.test(year) ? year : current;
  const start = Number(clubYear.slice(0, 4));
  const label = (value: number) => `${value}-${String((value + 1) % 100).padStart(2, "0")}`;
  // "To review" (#1246): the same rows the dashboard card counts, for the same club year and month.
  const reviewMonth = monthParam && clubYearMonths(clubYear).includes(monthParam) ? monthParam : chooseReportMonth(clubYear, now);
  const toReviewRows = review === REVIEW_FILTER
    ? recordsToReview(await getAreaClubsSummary(clubYear, now, { backgroundChecks: false }), reviewMonth)
    : null;
  const reminderSorting = serverSort("/admin/clubs/reports", search, REMINDER_LOG_SORT_COLUMNS, REMINDER_LOG_DEFAULT_SORT, {
    prefix: REMINDER_LOG_PREFIX,
    hash: "#monthly-record-reminders",
    firstDirection: (column) => (column === "sent" || column === "month" ? "desc" : "asc"),
  });
  const reminders = await getMonthlyRecordReminderOverview(now, {
    sort: reminderSorting.order,
    page: Number(one(search[sortParamNames(REMINDER_LOG_PREFIX).page]) ?? 1) || 1,
  });
  const reminderPageHref = (page: number) => {
    const params = new URLSearchParams();
    for (const [name, value] of Object.entries(search)) if (typeof value === "string") params.set(name, value);
    params.set(sortParamNames(REMINDER_LOG_PREFIX).page, String(page));
    return `/admin/clubs/reports?${params.toString()}#monthly-record-reminders`;
  };
  // Moving to another year keeps the filter the person is on (#1588); the month follows the chosen year.
  const yearLinkTail = toReviewRows ? `&review=${REVIEW_FILTER}` : "";
  return (
    <>
      <AdminPageHeader path="/admin/clubs/reports" year={clubYear} />
      <StaffPageHeader
        extra={(
          <>
            <Link className={`secondary-button ${navStyles.target}`} href={`/admin/clubs/reports?year=${label(start - 1)}${yearLinkTail}`}>← {label(start - 1)}</Link>
            {clubYear !== current && <Link className={`secondary-button ${navStyles.target}`} href={`/admin/clubs/reports?year=${label(start + 1)}${yearLinkTail}`}>{label(start + 1)} →</Link>}
          </>
        )}
        primary={<Link className={`secondary-button ${navStyles.target}`} href="/admin/clubs/reports/year-end">Year-End Reports</Link>}
      />
      {toReviewRows ? (
        <ClubRecordsToReview clubYear={clubYear} month={reviewMonth} rows={toReviewRows} />
      ) : (
        <ClubReportsConference clubYear={clubYear} initialClubs={await listClubReportsForYear(clubYear)} key={clubYear} now={calendarDateIn(now)} />
      )}
      <MonthlyRecordReminders
        clubYear={reminders.clubYear}
        emailConfigured={isAccountEmailConfigured()}
        enabled={reminders.enabled}
        pageHref={reminderPageHref}
        sentAtLabels={Object.fromEntries(reminders.slice.items.map((row) => [row.id, formatInConferenceTime(row.sentAt, { dateStyle: "medium", timeStyle: "short" })]))}
        slice={reminders.slice}
        isSystemAdmin={user.globalRole === "SYSTEM_ADMIN"}
        sorting={reminderSorting}
      />
    </>
  );
}
