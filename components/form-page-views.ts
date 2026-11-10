import type { RowView } from "@/components/staff-tab-row-model";
import { informationBuilderHref, informationResponsesHref, type InformationBuilderConfig } from "@/components/registration-builder/information-mode";

/** The two places inside the builder's one page that the form-page links open: the Form settings tab and the preview panel. */
export const BUILDER_SETTINGS_HASH = "#builder-settings";
export const LIVE_PREVIEW_HASH = "#live-form-preview";

export type InformationFormPageKey = "editor" | "preview" | "responses" | "settings";

/**
 * The pages of one selected information form (#1572), in the words the builder's top bar uses. Every link opens a page or
 * place that already exists; the strip only makes them reachable from the responses page too. `current` marks one key.
 */
export function informationFormPageViews(config: InformationBuilderConfig, formId: string, current?: InformationFormPageKey): RowView[] {
  const builder = informationBuilderHref(config, formId);
  const views: RowView[] = [
    { key: "editor", label: "Editor", href: builder },
    { key: "preview", label: "Preview", href: `${builder}${LIVE_PREVIEW_HASH}` },
    { key: "responses", label: "Responses", href: informationResponsesHref(config, formId) },
    { key: "settings", label: "Form settings", href: `${builder}${BUILDER_SETTINGS_HASH}` },
  ];
  return views.map((view) => (view.key === current ? { ...view, current: true } : view));
}
