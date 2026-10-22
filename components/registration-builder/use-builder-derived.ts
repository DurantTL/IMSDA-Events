// Values computed from the builder state: the preview plan, pricing, and
// what the current version allows (edit, test, publish).
import { useMemo } from "react";
import {  } from "lucide-react";
import { useAcknowledgmentPolicyVersions } from "@/components/acknowledgment-field-settings";
import { calculateFormTotal, calculateRosterTotal, getAttendeeRosterConfig, isChoiceFieldType, isFieldVisible } from "@/modules/forms/definition";
import { builderFieldModules } from "@/modules/forms/builder-modules";
import { getPublicRegistrationStepPlan } from "@/modules/forms/public-registration-steps";
import { slugMatchesTitle } from "@/modules/forms/slug";
import type { BuilderState } from "./use-builder-state";

export function useBuilderDerived(eventId: string, state: BuilderState) {
  const { selectedForm, selectedVersion, definition, responses, previewAttendees, dirty, moduleQuery, moduleCategory, pricingPreviewDate, previewStepId } = state;
  const totalFields = useMemo(() => definition?.sections.reduce((count, section) => count + section.fields.length, 0) ?? 0, [definition]);
  const allFields = useMemo(() => definition?.sections.flatMap((section) => section.fields) ?? [], [definition]);
  // The policy versions an acknowledgment can point at (#150): fetched once, and only when the form has an acknowledgment.
  const policyVersions = useAcknowledgmentPolicyVersions(eventId, allFields.some((candidate) => candidate.type === "ACKNOWLEDGMENT"));
  const visibleFieldModules = useMemo(() => {
    const query = moduleQuery.trim().toLocaleLowerCase();
    return builderFieldModules.filter((module) => (
      (moduleCategory === "All" || module.category === moduleCategory)
      && (
        !query
        || `${module.name} ${module.description} ${module.category}`
          .toLocaleLowerCase()
          .includes(query)
      )
    ));
  }, [moduleCategory, moduleQuery]);
  const attendeeFields = allFields.filter((field) => field.scope === "ATTENDEE");
  const hasAttendeeNameFields = (
    attendeeFields.some((field) => field.key === "first_name")
    && attendeeFields.some((field) => field.key === "last_name")
  ) || attendeeFields.some((field) => ["full_name", "name", "attendee_name", "guest_name"].includes(field.key));
  const roster = useMemo(() => definition ? getAttendeeRosterConfig(definition) : null, [definition]);
  const calculation = useMemo(() => {
    if (!definition) return null;
    return roster?.enabled
      ? calculateRosterTotal(definition, responses, previewAttendees.map((attendee) => attendee.responses), pricingPreviewDate)
      : calculateFormTotal(definition, responses, pricingPreviewDate);
  }, [definition, pricingPreviewDate, previewAttendees, responses, roster?.enabled]);
  const previewVisibleFieldKeys = useMemo(() => {
    const visible = new Set<string>();
    if (!definition) return visible;
    for (const field of allFields) {
      if (!roster?.enabled) {
        if (isFieldVisible(field, responses)) visible.add(field.key);
        continue;
      }
      if (field.scope === "REGISTRATION" && isFieldVisible(field, responses)) {
        visible.add(field.key);
      }
      if (
        field.scope === "ATTENDEE"
        && previewAttendees.some((attendee) => (
          isFieldVisible(field, { ...responses, ...attendee.responses })
        ))
      ) {
        visible.add(field.key);
      }
    }
    return visible;
  }, [allFields, definition, previewAttendees, responses, roster?.enabled]);
  const previewSteps = useMemo(
    () => definition
      ? getPublicRegistrationStepPlan(definition, previewVisibleFieldKeys)
      : [],
    [definition, previewVisibleFieldKeys],
  );
  const previewStepIndex = Math.max(
    previewSteps.findIndex((step) => step.id === previewStepId),
    0,
  );
  const previewStep = previewSteps[previewStepIndex] ?? null;
  const paymentMethodFields = allFields.filter((field) => field.scope === "REGISTRATION" && isChoiceFieldType(field.type));
  const scheduledPriceFields = allFields.filter((field) => field.latePricing);
  const publishedVersion = selectedForm?.versions.find((version) => version.status === "PUBLISHED") ?? null;
  const isHistorical = Boolean(selectedVersion && selectedForm && selectedVersion.id !== selectedForm.activeVersion.id);
  // The current version is always editable. When it is live or withdrawn, the
  // first save creates a new draft version (#564); the live version is never
  // changed in place. Only superseded historical versions are read-only.
  const canEdit = Boolean(selectedVersion && !isHistorical);
  const editsCreateDraft = Boolean(selectedVersion && selectedVersion.status !== "DRAFT");
  const hasValidTest = Boolean(selectedVersion?.testSubmissions.some((submission) => submission.isValid));
  // A valid test submission is required only before a form's first publish
  // (#564, #1061). After that a test is optional; the server enforces the same.
  const hasEverPublished = Boolean(selectedForm?.versions.some((version) => version.publishedAt));
  const testRequired = !hasEverPublished;
  const publishBlockedReason = dirty
    ? "Save your changes as a draft before publishing."
    : testRequired && !hasValidTest
      ? "Run a test submission first: open the last step of the preview and choose Run test submission."
      : "";
  // A form copied from a template can keep the template's web address after
  // its title changes. Before a form's first publish only, offer to sync the
  // slug to the current title — after that, shared links depend on the slug
  // never changing on its own (#476).
  // A `title-N` slug that creation added counts as matching. The server
  // makes the final call and picks a free address to offer.
  const slugMayNeedSync = Boolean(
    selectedForm && definition && !hasEverPublished && definition.title.trim() && !slugMatchesTitle(selectedForm.slug, definition.title),
  );
  return { totalFields, allFields, policyVersions, visibleFieldModules, attendeeFields, hasAttendeeNameFields, roster, calculation, previewSteps, previewStepIndex, previewStep, paymentMethodFields, scheduledPriceFields, publishedVersion, isHistorical, canEdit, editsCreateDraft, hasValidTest, hasEverPublished, testRequired, publishBlockedReason, slugMayNeedSync };
}

export type BuilderDerived = ReturnType<typeof useBuilderDerived>;
