import type { RegistrationFormDefinition } from "@/modules/forms/definition";
import campMeeting from "../../prisma/seed-data/form-templates/camp-meeting.json";
import clubCamporee from "../../prisma/seed-data/form-templates/club-camporee.json";
import womensRetreat from "../../prisma/seed-data/form-templates/womens-retreat.json";

/**
 * Seeded form templates (#153): the shared form templates whose content is
 * data, not source. Each JSON file under `prisma/seed-data/form-templates/`
 * carries one template and its `version`; `npm run form-templates:sync` brings
 * the `SeededFormTemplate` table up to those versions the same way
 * `club-forms:sync` and `lodging:sync` do for theirs. This module only types
 * and lists the files: it holds no event content itself. Raise a file's
 * `version` (and `tests/fixtures/legacy-form-templates-153.json` is then
 * deliberately out of date for it) to ship a revision; forms already created
 * from an earlier version keep the definition they were created with.
 */
export type SeededFormTemplateSeed = {
  key: string;
  version: number;
  name: string;
  description: string;
  audience: string;
  definition: RegistrationFormDefinition;
};

/** In the order the templates appear among the built-in form templates. */
export const bundledSeededFormTemplates: readonly SeededFormTemplateSeed[] = [
  womensRetreat,
  clubCamporee,
  campMeeting,
] as unknown as SeededFormTemplateSeed[];

export const seededFormTemplateKeys: readonly string[] = bundledSeededFormTemplates.map((seed) => seed.key);
