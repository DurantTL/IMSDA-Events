import { clubYearMonths, isLockedForClub, monthNotDueForClub } from "@/modules/club-reports/domain";
import type { CardStatus } from "@/modules/system-admin/admin-hubs-model";

/**
 * Plain numbers behind the "This club" card statuses (#1587): pure, no database access. `null` means the read failed
 * (the card then says "Unavailable"); `undefined` means no read was made for it, so the card shows no status.
 */
export type ClubCardCounts = {
  admins?: number | null;
  honors?: number | null;
  records?: { missing: number; submitted: number } | null;
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function adminsStatus(count: number): CardStatus {
  return count > 0 ? { tone: "ok", text: plural(count, "admin", "admins") } : { tone: "warn", text: "No admins" };
}

export function profileStatus(club: { isActive: boolean; hasChurch: boolean }): CardStatus {
  if (!club.isActive) return { tone: "draft", text: "Inactive" };
  return club.hasChurch ? { tone: "ok", text: "Church listed" } : { tone: "warn", text: "No church listed" };
}

export function honorsStatus(count: number): CardStatus {
  return count > 0 ? { tone: "ok", text: plural(count, "honor", "honors") } : { tone: "draft", text: "None this year" };
}

export function recordsStatus(records: { missing: number; submitted: number }): CardStatus {
  if (records.missing > 0) return { tone: "warn", text: `${records.missing} missing` };
  return records.submitted > 0 ? { tone: "ok", text: `${records.submitted} submitted` } : { tone: "draft", text: "None due yet" };
}

/**
 * Months past due with no submitted report, by the rules the Monthly Records grid uses: a month is missing when it is
 * locked (past its due date), has no submitted report, and is not before the club joined.
 */
export function clubRecordsCounts(input: { clubYear: string; submittedMonths: readonly string[]; joinedOn: string | null; now: Date }) {
  const submitted = new Set(input.submittedMonths);
  const months = clubYearMonths(input.clubYear);
  return {
    submitted: months.filter((month) => submitted.has(month)).length,
    missing: months.filter((month) => !submitted.has(month) && !monthNotDueForClub(month, input.joinedOn, false) && isLockedForClub(month, input.now)).length,
  };
}

/**
 * Honors the Honors page lists as earned: per member and honor, the latest entry that is not voided, counted when it is
 * completed. Entries arrive newest first, as the page reads them.
 */
export function completedHonorsCount(entries: readonly { personId: string; honorId: string; status: string; voided: boolean }[]) {
  const seen = new Set<string>();
  let completed = 0;
  for (const entry of entries) {
    if (entry.voided) continue;
    const key = `${entry.personId}:${entry.honorId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (entry.status === "COMPLETED") completed += 1;
  }
  return completed;
}
