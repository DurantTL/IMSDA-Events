import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { clubYearFor } from "@/modules/club-rosters/domain";
import { definitionForLink, deriveSubjectName, effectiveClubFormFillMode, parseClubFormTemplate } from "@/modules/club-forms/domain";
import { ClubFormError } from "@/modules/club-forms/errors";
import {
  NOT_LISTED_CLUB,
  OPEN_APPLICATION_CLOSED_MESSAGE,
  OPEN_APPLICATION_OFF_MESSAGE,
  openApplicationState,
  withChosenClubAnswers,
  withoutClubDirectoryFields,
  type OpenApplicationSubmitInput,
} from "@/modules/club-forms/open-applications-domain";
import { prepareFillerAnswers, sealFillerAnswers } from "@/modules/club-forms/public-fill";
import { sendClubFormSubmittedAlert } from "@/modules/club-forms/submission-alert";
import { assertClubFormTemplateCurrent } from "@/modules/club-forms/template-lock";
import { withLiveDirectory } from "@/modules/club-forms/templates";
import { todayDateValue } from "@/modules/forms/definition";
import { isNotificationEnabled } from "@/modules/notifications/settings";
import { listClubDirectoryNames } from "@/modules/organizations/directory-options";
import { normalizeOrganizationName } from "@/modules/organizations/domain";

/**
 * Open applications (#1229): one public link per form and club year that anyone can fill in with no account. The
 * applicant picks their club from the directory (names only) or types one that is "Not listed". A chosen club's
 * director, its Area Coordinators and conference staff read it like any other club form; a "Not listed" one has no
 * club and is conference staff's alone. The confirmation shows nothing but the form's own message.
 */

const templateSelect = {
  id: true, key: true, name: true, description: true, version: true, definition: true, sectionNotes: true,
  sensitiveFieldKeys: true, birthDateFieldKeys: true, staffOnlyFieldKeys: true, hiddenFieldKeys: true,
  printLayout: true, rosterMapping: true, fillMode: true, enabled: true, customizedAt: true,
} satisfies Prisma.ClubFormTemplateSelect;

type Client = Prisma.TransactionClient | ReturnType<typeof getPrisma>;

async function isClosed(client: Client, templateId: string, clubYear: string) {
  const row = await client.clubFormOpenLinkYear.findUnique({
    where: { templateId_clubYear: { templateId, clubYear } },
    select: { closedAt: true },
  });
  return Boolean(row?.closedAt);
}

/** Active clubs as `{ id, name }` and nothing else about them. */
export async function listOpenApplicationClubs(client: Client = getPrisma()) {
  return client.organization.findMany({
    where: { type: "CLUB", isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

async function loadOpenApplication(key: string, now: Date) {
  const prisma = getPrisma();
  const row = await prisma.clubFormTemplate.findUnique({ where: { key }, select: templateSelect });
  const clubYear = clubYearFor(now);
  // Unknown, and a form that is not an open application, are the same answer.
  if (!row || effectiveClubFormFillMode(row.fillMode, row.key) !== "OPEN_APPLICATION") {
    throw new ClubFormError("TEMPLATE_NOT_FOUND", "That form isn't available.");
  }
  const state = openApplicationState({
    fillMode: "OPEN_APPLICATION",
    enabled: row.enabled,
    closed: row.enabled ? await isClosed(prisma, row.id, clubYear) : false,
  });
  return { row, clubYear, state };
}

/**
 * What the public application page shows. `OFF` and `CLOSED` carry no form. Unknown keys and forms that are not open
 * applications throw TEMPLATE_NOT_FOUND (a 404).
 */
export async function resolveOpenApplication(key: string, now = new Date()) {
  const { row, clubYear, state } = await loadOpenApplication(key, now);
  if (state === "OFF") return { status: "OFF" as const, message: OPEN_APPLICATION_OFF_MESSAGE };
  if (state === "CLOSED") return { status: "CLOSED" as const, message: OPEN_APPLICATION_CLOSED_MESSAGE };
  const template = parseClubFormTemplate(row);
  assertClubFormTemplateCurrent(template);
  const prisma = getPrisma();
  // Staff-only (office use) and hidden fields are not the applicant's to see, as on a private link.
  const definition = await withLiveDirectory(withoutClubDirectoryFields(definitionForLink(template)), prisma);
  const sectionIds = new Set(definition.sections.map((section) => section.id));
  return {
    status: "OPEN" as const,
    clubYear,
    today: todayDateValue(now),
    clubs: await listOpenApplicationClubs(prisma),
    form: {
      key: template.key,
      name: template.name,
      definition,
      sectionNotes: Object.fromEntries(Object.entries(template.sectionNotes).filter(([id]) => sectionIds.has(id))),
      sensitiveFieldKeys: template.sensitiveFieldKeys,
    },
  };
}

function isIdempotencyConflict(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const target = error.meta?.target;
  return Array.isArray(target) ? target.includes("idempotencyKey") : String(target ?? "").includes("idempotencyKey");
}

async function replayedResult(idempotencyKey: string, templateId: string, confirmationMessage: string) {
  const first = await getPrisma().clubFormSubmission.findUnique({ where: { idempotencyKey }, select: { id: true, templateId: true } });
  if (!first || first.templateId !== templateId) throw new ClubFormError("VALIDATION_FAILED", "This request key was already used. Reload the page and try again.");
  return { submissionId: first.id, confirmationMessage, replayed: true as const };
}

/**
 * Submits one open application. Many submissions work from the one link; the same idempotency key twice returns the
 * first result and writes nothing more. An id that is not an active club is refused and nothing is saved.
 */
export async function submitOpenApplication(key: string, input: OpenApplicationSubmitInput, now = new Date()) {
  const { row, clubYear, state } = await loadOpenApplication(key, now);
  if (state === "OFF") throw new ClubFormError("APPLICATION_OFF", OPEN_APPLICATION_OFF_MESSAGE);
  if (state === "CLOSED") throw new ClubFormError("APPLICATION_CLOSED", OPEN_APPLICATION_CLOSED_MESSAGE);
  const template = parseClubFormTemplate(row);
  assertClubFormTemplateCurrent(template);
  const prisma = getPrisma();
  const confirmationMessage = template.definition.confirmationMessage;

  // A replay answers before anything is validated or written.
  const earlier = await prisma.clubFormSubmission.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true, templateId: true } });
  if (earlier) return replayedResult(input.idempotencyKey, template.id, confirmationMessage);

  let organizationId: string | null = null;
  let unlistedClubName: string | null = null;
  let clubName: string | null = null;
  if (input.organizationId === NOT_LISTED_CLUB) {
    unlistedClubName = (input.unlistedClubName ?? "").trim().slice(0, 120);
    if (!unlistedClubName) throw new ClubFormError("VALIDATION_FAILED", "Type your club's name.", [{ key: "unlistedClubName", message: "Type your club's name." }]);
  } else {
    const club = await prisma.organization.findFirst({ where: { id: input.organizationId, type: "CLUB", isActive: true }, select: { id: true, name: true, normalizedName: true } });
    if (!club) throw new ClubFormError("VALIDATION_FAILED", "Choose your club from the list.", [{ key: "organizationId", message: "Choose your club from the list." }]);
    organizationId = club.id;
    // The form's hidden club field takes the directory's own entry for this club (trimmed, one per normalized name), so it
    // always passes the option check even when two clubs share a normalized name.
    const key = club.normalizedName || normalizeOrganizationName(club.name.trim());
    clubName = (await listClubDirectoryNames(prisma)).find((name) => normalizeOrganizationName(name) === key) ?? club.name.trim();
  }

  const answers = await prepareFillerAnswers(template, withChosenClubAnswers(template.definition, input.answers, clubName !== null ? { name: clubName } : { unlistedName: unlistedClubName ?? "" }), now);
  const submissionId = randomUUID();
  // Read before the transaction opens (#1016): a read inside one would need a second pool connection.
  const alertEnabled = await isNotificationEnabled("CLUB_FORM_SUBMITTED");

  try {
    await prisma.$transaction(async (tx) => {
      const { plain, sealed, hasSensitive } = await sealFillerAnswers(tx, template, submissionId, answers);
      // Closed or switched off since the page was read: nothing is written.
      const fresh = await tx.clubFormTemplate.findUnique({ where: { id: template.id }, select: { enabled: true } });
      if (!fresh?.enabled) throw new ClubFormError("APPLICATION_OFF", OPEN_APPLICATION_OFF_MESSAGE);
      if (await isClosed(tx, template.id, clubYear)) throw new ClubFormError("APPLICATION_CLOSED", OPEN_APPLICATION_CLOSED_MESSAGE);
      await tx.clubFormSubmission.create({
        data: {
          id: submissionId,
          templateId: template.id,
          organizationId,
          unlistedClubName,
          idempotencyKey: input.idempotencyKey,
          clubYear,
          rosterMemberId: null,
          subjectName: deriveSubjectName(answers),
          status: "SUBMITTED",
          answers: plain as Prisma.InputJsonValue,
          sealedSensitiveAnswers: sealed,
          hasSensitiveAnswers: hasSensitive,
          templateVersion: template.version,
          enteredVia: "OPEN_APPLICATION",
          linkId: null,
          submittedAt: now,
        },
      });
      // No answers, no email, and not the typed club name: who and what, never the content.
      await writeAuditLog({
        action: "CLUB_FORM_APPLICATION_SUBMITTED",
        entityType: "ClubFormSubmission",
        entityId: submissionId,
        summary: "An open club form application was submitted.",
        metadata: { organizationId, listed: organizationId !== null, templateKey: template.key, hasSensitiveAnswers: hasSensitive },
      }, tx);
    });
  } catch (error) {
    // Two requests with the same key racing: the loser finds the first one's row.
    if (isIdempotencyConflict(error)) return replayedResult(input.idempotencyKey, template.id, confirmationMessage);
    throw error;
  }
  // After the commit, and never throwing: the application is saved whatever happens to the alert (#1017).
  await sendClubFormSubmittedAlert({
    submissionId,
    templateId: template.id,
    organizationId,
    unlistedClubName,
    openApplication: true,
    actor: null,
    submittedAt: now,
  }, alertEnabled);
  return { submissionId, confirmationMessage, replayed: false as const };
}

/**
 * Staff close or reopen the open link for the current club year (#1229). System administrators only; the caller has
 * checked. A reopen keeps the row with `closedAt` cleared. Audited.
 */
export async function setOpenApplicationClosed(key: string, closed: boolean, actorUserId: string, now = new Date()) {
  const clubYear = clubYearFor(now);
  return getPrisma().$transaction(async (tx) => {
    const template = await tx.clubFormTemplate.findUnique({ where: { key }, select: { id: true, fillMode: true } });
    if (!template || effectiveClubFormFillMode(template.fillMode, key) !== "OPEN_APPLICATION") {
      throw new ClubFormError("TEMPLATE_NOT_FOUND", "That form could not be found.");
    }
    const existing = await tx.clubFormOpenLinkYear.findUnique({
      where: { templateId_clubYear: { templateId: template.id, clubYear } },
      select: { closedAt: true },
    });
    const wasClosed = Boolean(existing?.closedAt);
    if (wasClosed !== closed) {
      await tx.clubFormOpenLinkYear.upsert({
        where: { templateId_clubYear: { templateId: template.id, clubYear } },
        create: { templateId: template.id, clubYear, closedAt: closed ? now : null, closedByUserId: closed ? actorUserId : null },
        update: { closedAt: closed ? now : null, closedByUserId: closed ? actorUserId : null },
      });
      await writeAuditLog({
        actorUserId,
        action: closed ? "CLUB_FORM_OPEN_LINK_CLOSED" : "CLUB_FORM_OPEN_LINK_REOPENED",
        entityType: "ClubFormTemplate",
        entityId: template.id,
        summary: closed ? "Closed an open club form application for the club year." : "Reopened an open club form application for the club year.",
        metadata: { templateKey: key, clubYear },
      }, tx);
    }
    return { key, clubYear, closed };
  });
}

/** For the admin page: which open-application forms are closed for the current club year. */
export async function listClosedOpenApplicationKeys(now = new Date()) {
  const rows = await getPrisma().clubFormOpenLinkYear.findMany({
    where: { clubYear: clubYearFor(now), closedAt: { not: null } },
    select: { template: { select: { key: true } } },
  });
  return new Set(rows.map((row) => row.template.key));
}
