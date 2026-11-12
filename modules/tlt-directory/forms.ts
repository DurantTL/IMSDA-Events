import "server-only";

import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { TLT_FORM_TEMPLATE_KEYS, isTltFormTemplateKey, type ClubFormsViewer, type TltFormTemplateKey } from "@/modules/club-forms/domain";
import { pageSubmissionsForViewer } from "@/modules/club-forms/submissions";
import { ALL_CLUB_KINDS } from "@/modules/organizations/area-coordinator-ministries-domain";
import { listClubsForArea } from "@/modules/organizations/area-coordinators";
import { TLT_FORMS_PAGE_SIZE, tltFormsFilterKeys, type TltFormsFilters } from "@/modules/tlt-directory/forms-domain";

/**
 * The TLT forms inbox (#1686): every submitted TLT Application, TLT Program Recommendation and TLT of the Year from
 * every club, for the TLT director only (`currentTltFormsViewer`). The list reads labels and ids, never an answer; the
 * form itself opens through `getSubmissionForViewer`, which reveals the sensitive answers to this viewer and writes
 * one `TLT_FORM_SUBMISSION_VIEWED` row per view. Nothing here reads any other form: the viewer's scope is fixed to the
 * three template keys inside the shared query.
 */

type TltViewer = Extract<ClubFormsViewer, { kind: "TLT_DIRECTOR" }>;

function assertTltViewer(viewer: ClubFormsViewer): asserts viewer is TltViewer {
  if (viewer.kind !== "TLT_DIRECTOR") throw new Error("The TLT forms inbox is for the TLT director.");
}

/** The inbox page: newest submitted first, 25 to a page, with the true count. */
export async function readTltFormsInbox(viewer: ClubFormsViewer, filters: TltFormsFilters, page: number) {
  assertTltViewer(viewer);
  const [templates, clubs, list] = await Promise.all([
    getPrisma().clubFormTemplate.findMany({ where: { key: { in: [...TLT_FORM_TEMPLATE_KEYS] } }, select: { key: true, name: true }, orderBy: { sortOrder: "asc" } }),
    listClubsForArea(ALL_CLUB_KINDS), // conference-wide: the TLT director sees every ministry (#843)
    pageSubmissionsForViewer(
      viewer,
      { templateKey: filters.form || undefined, organizationId: filters.clubId || undefined, subjectSearch: filters.q || undefined, personId: filters.personId || undefined },
      { sort: { key: "submitted", dir: "desc" }, page, pageSize: TLT_FORMS_PAGE_SIZE },
    ),
  ]);
  return { ...list, forms: templates, clubs: clubs.map((club) => ({ id: club.organizationId, name: club.name })) };
}

/** One audit row for opening the inbox: which filters were used, counts and the form key only, never the search text or a name. */
export async function recordTltFormsInboxView(
  viewer: ClubFormsViewer,
  view: { filters: TltFormsFilters; shown: number; matching: number; page: number },
) {
  assertTltViewer(viewer);
  await writeAuditLog({
    action: "TLT_FORM_INBOX_VIEWED",
    entityType: "ClubFormSubmission",
    summary: "The TLT director opened the TLT forms inbox.",
    metadata: {
      viewerKind: viewer.kind,
      actorAttendeeAccountId: viewer.accountId,
      rowsShown: view.shown,
      rowsMatching: view.matching,
      page: view.page,
      filters: tltFormsFilterKeys(view.filters),
      formKey: isTltFormTemplateKey(view.filters.form) ? view.filters.form : null,
      organizationId: view.filters.clubId || null,
    },
  });
}

export type TltFormLinks = { application: number; recommendation: number; ofTheYear: number };

const linkField: Record<TltFormTemplateKey, keyof TltFormLinks> = {
  club_tlt_application: "application",
  tlt_program_recommendation: "recommendation",
  club_tlt_of_the_year: "ofTheYear",
};

/**
 * How many submitted TLT forms are tied to each TLT, for the directory rows. A submission is tied to a person only by an
 * id: the roster member it was filled in for (`rosterMemberId`), or the roster member it was added to or linked to
 * (`rosterActionMemberId`), and that member's `personId`. A name typed on a form never links, so an open application, a
 * recommendation sent without choosing a member, or a nomination for someone not picked from the roster has no link
 * and is found in the inbox only. Counts only; no label and no answer is read.
 */
export async function countTltFormsByPerson(viewer: ClubFormsViewer, personIds: readonly string[]): Promise<Map<string, TltFormLinks>> {
  assertTltViewer(viewer);
  const counts = new Map<string, TltFormLinks>();
  if (personIds.length === 0) return counts;
  const rows = await getPrisma().clubFormSubmission.findMany({
    where: {
      status: "SUBMITTED",
      template: { key: { in: [...TLT_FORM_TEMPLATE_KEYS] } },
      OR: [{ rosterMember: { personId: { in: [...personIds] } } }, { rosterActionMember: { personId: { in: [...personIds] } } }],
    },
    select: { id: true, template: { select: { key: true } }, rosterMember: { select: { personId: true } }, rosterActionMember: { select: { personId: true } } },
  });
  const wanted = new Set(personIds);
  for (const row of rows) {
    if (!isTltFormTemplateKey(row.template.key)) continue;
    const people = new Set([row.rosterMember?.personId, row.rosterActionMember?.personId].filter((id): id is string => Boolean(id) && wanted.has(id as string)));
    for (const personId of people) {
      const entry = counts.get(personId) ?? { application: 0, recommendation: 0, ofTheYear: 0 };
      entry[linkField[row.template.key]] += 1;
      counts.set(personId, entry);
    }
  }
  return counts;
}
