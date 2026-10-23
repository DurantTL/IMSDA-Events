import "server-only";

import { getPrisma } from "@/lib/prisma";
import type { FormsHubRow, FormsHubStatus } from "@/modules/forms-hub/rows";

const statusMap: Record<"DRAFT" | "OPEN" | "CLOSED", { status: FormsHubStatus; label: string }> = {
  DRAFT: { status: "NOT_OPEN", label: "Not open yet" },
  OPEN: { status: "OPEN", label: "Open" },
  CLOSED: { status: "CLOSED", label: "Closed" },
};

/**
 * Every information form, general and event, for the All forms hub (#1151): two queries (the forms with their event
 * name, and one response groupBy for counts and latest times). No answers are read.
 */
export async function listInformationFormsForHub(): Promise<FormsHubRow[]> {
  const prisma = getPrisma();
  const [forms, grouped] = await Promise.all([
    prisma.informationForm.findMany({
      select: { id: true, scope: true, eventId: true, name: true, status: true, event: { select: { name: true } } },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    }),
    prisma.informationFormResponse.groupBy({ by: ["formId"], _count: { _all: true }, _max: { submittedAt: true } }),
  ]);
  const byForm = new Map(grouped.map((group) => [group.formId, group]));
  return forms.map((form) => {
    const group = byForm.get(form.id);
    const id = encodeURIComponent(form.id);
    const event = form.scope === "EVENT" && form.eventId ? encodeURIComponent(form.eventId) : null;
    const mapped = statusMap[form.status];
    return {
      id: `information:${form.id}`,
      kind: event ? "EVENT" as const : "GENERAL" as const,
      name: form.name,
      eventName: event ? form.event?.name ?? null : null,
      status: mapped.status,
      statusLabel: mapped.label,
      responseCount: group?._count._all ?? 0,
      lastResponseAt: group?._max.submittedAt?.toISOString() ?? null,
      editHref: event ? `/information-forms?event=${event}&form=${id}` : `/admin/information-forms/${id}`,
      responsesHref: event ? `/information-forms/responses?event=${event}&form=${id}` : `/admin/information-forms/${id}/responses`,
    };
  });
}
