import "server-only";

import { getPrisma } from "@/lib/prisma";
import { publicClubFormTemplateKeys } from "@/modules/club-forms/public-index-domain";

/** Which of the page's club form templates are turned on: the key and the switch, nothing else. */
export async function listEnabledPublicClubFormKeys(): Promise<Set<string>> {
  const rows = await getPrisma().clubFormTemplate.findMany({
    where: { key: { in: [...publicClubFormTemplateKeys] }, enabled: true },
    select: { key: true },
  });
  return new Set(rows.map((row) => row.key));
}
