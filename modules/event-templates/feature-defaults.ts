import { eventTemplatePayloadSchema } from "@/modules/event-templates/domain";
import {
  defaultCreationFeatures,
  type CreationAudience,
  type CreationFeatures,
} from "@/modules/event-features/creation";

/**
 * What applying a published template starts the event with, for the "Which
 * features does this event use?" step (#965): the template's audience, so the
 * audience's modules, and the five flags it carries. Read from the published
 * version only (exactly what applying creates); `null` when there is none or it
 * no longer parses, which is also when applying is refused. Serializable, so a
 * server page can hand it to the picker.
 */
export type TemplateFeatureDefaults = { audience: CreationAudience; features: CreationFeatures; carriesGeneralLink: boolean; carriesTeams: boolean };

export function templateFeatureDefaults(template: { versions: ReadonlyArray<{ status: string; payload: unknown }> }): TemplateFeatureDefaults | null {
  const published = template.versions.find((version) => version.status === "PUBLISHED");
  if (!published) return null;
  const parsed = eventTemplatePayloadSchema.safeParse(published.payload);
  if (!parsed.success) return null;
  const payload = parsed.data;
  return {
    audience: payload.audience,
    features: defaultCreationFeatures(payload.audience, payload.moduleEnablement),
    carriesGeneralLink: payload.generalRegistrationLink === true,
    carriesTeams: payload.teamSettings !== undefined,
  };
}
