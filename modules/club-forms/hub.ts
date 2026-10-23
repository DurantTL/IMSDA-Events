import "server-only";

import { getPrisma } from "@/lib/prisma";
import type { FormsHubRow } from "@/modules/forms-hub/rows";

/**
 * Club form templates for the All forms hub (#1151): the name, on/off, and the submitted-form count and latest
 * submission time from one groupBy (drafts are not responses). No answers are read.
 */
export async function listClubFormsForHub(): Promise<FormsHubRow[]> {
  const prisma = getPrisma();
  const [templates, grouped] = await Promise.all([
    prisma.clubFormTemplate.findMany({ select: { id: true, key: true, name: true, enabled: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.clubFormSubmission.groupBy({ by: ["templateId"], where: { status: "SUBMITTED" }, _count: { _all: true }, _max: { submittedAt: true } }),
  ]);
  const byTemplate = new Map(grouped.map((group) => [group.templateId, group]));
  return templates.map((template) => {
    const group = byTemplate.get(template.id);
    const key = encodeURIComponent(template.key);
    return {
      id: `club:${template.id}`,
      kind: "CLUB" as const,
      name: template.name,
      eventName: null,
      status: template.enabled ? "OPEN" as const : "NOT_OPEN" as const,
      statusLabel: template.enabled ? "On" : "Off",
      responseCount: group?._count._all ?? 0,
      lastResponseAt: group?._max.submittedAt?.toISOString() ?? null,
      editHref: `/admin/club-forms/${key}`,
      responsesHref: `/more/club-forms?form=${key}`,
    };
  });
}
