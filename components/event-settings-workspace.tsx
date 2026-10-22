"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Code2,
  Copy,
  ExternalLink,
  MapPin,
  Save,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { RadioCardGroup } from "@/components/radio-card-group";
import { EventLocationsPanel } from "@/components/event-locations-panel";
import type { ActiveAreaCoordinator, EventLocationRecord } from "@/modules/event-locations/repository";
import type { EventSettingsRecord } from "@/modules/events/repository";
import {
  eventKindFromAudience,
  resolveSectionPlacement,
  sectionsWithNonDefaultValues,
  type EventSettingsSectionId,
} from "@/modules/events/settings-sections";
import { getEventPublishReadiness, getEventPublishWarnings } from "@/modules/events/readiness";
import { draftFromEvent, eventSettingsRequestBody } from "@/modules/events/settings-draft";
import { CreationFeaturesStep } from "@/components/creation-features-step";
import type { EventModuleKey } from "@/modules/event-modules/catalog";
import {
  chosenModulesAfter,
  creationFeaturesFor,
  creationFlagKeys,
  defaultCreationFeatures,
  type CreationFeatures,
} from "@/modules/event-features/creation";
import {
  eventTimeZones,
  type EventSettingsInput,
} from "@/modules/events/schemas";
import {
  SAVED_SHARE_ADDRESS_NOTE,
  copySavedEmbedCode,
  embedPath,
  isCopiedFor,
  publicEventPath,
  shareAddressDiffers,
} from "@/modules/events/share-links";
import { setEventSettingsDirty } from "@/components/event-settings-dirty";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import { usePinAfterScroll } from "@/components/use-pin-after-scroll";
import { PublishEventDialog } from "@/components/publish-event-dialog";
import { DangerZone, DangerZoneItem } from "@/components/danger-zone";
import { ArchiveEventDialog } from "@/components/archive-event-dialog";
import { DeleteEventDialog } from "@/components/delete-event-dialog";
import { SubmitButton } from "@/components/submit-button";
import { UnpublishEventDialog } from "@/components/unpublish-event-dialog";
import { DraftCreatedGuideBanner } from "@/components/draft-created-guide-banner";
import { FieldError, fieldErrorProps } from "@/components/field-error";
import { FormErrorSummary } from "@/components/form-error-summary";
import { SettingsBlock } from "@/components/settings-block";
import {
  blockForControlId,
  blockSummary,
  fieldErrorsFromIssues,
  firstFieldWithError,
  saveStatusLabel,
  settingsBlockDomId,
  settingsBlockIds,
  effectiveBlockForField,
  optionFieldSection,
  takePendingFocus,
  settingsBlockJumpLabels,
  settingsBlockTitles,
  settingsFieldBlock,
  settingsFieldDomId,
  settingsFieldErrorId,
  type SettingsBlockId,
  type SettingsFieldIssue,
} from "@/modules/events/settings-layout";

type EventSettingsWorkspaceProps = {
  mode: "create" | "edit";
  initialEvent: EventSettingsRecord | null;
  /** The event's locations (#413), edited in their own panel below the form. */
  initialLocations?: EventLocationRecord[];
  areaCoordinators?: ActiveAreaCoordinator[];
  /** Whether to offer Delete event: system administrators only. The server decides again. */
  canDeleteEvent?: boolean;
  /** Create mode, opened from a calendar item (#445): what the form starts with. The item's id travels with the save. */
  calendarPrefill?: CalendarPrefill;
  /** Whether to offer Archive / Unarchive: system administrators and the event's Event Admin (#635). The server decides again. */
  canArchiveEvent?: boolean;
};

export type CalendarPrefill = { entryId: string; title: string; startsOn: string; endsOn: string; location: string };

type PublishBlocker = { text: string; actionLabel?: string; targetId?: string; href?: string };

type EventApiResult = {
  event?: EventSettingsRecord;
  message?: string;
  issues?: SettingsFieldIssue[];
  warnings?: string[];
};

const timeZoneLabels: Record<(typeof eventTimeZones)[number], string> = {
  "America/New_York": "Eastern Time",
  "America/Chicago": "Central Time",
  "America/Denver": "Mountain Time",
  "America/Phoenix": "Arizona Time",
  "America/Los_Angeles": "Pacific Time",
  "America/Anchorage": "Alaska Time",
  "Pacific/Honolulu": "Hawaii Time",
};

function slugFromName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** A new event set up from a calendar item (#445) starts with the item's title, dates and location. */
function startingDraft(event: EventSettingsRecord | null, prefill: CalendarPrefill | undefined): EventSettingsInput {
  const base = draftFromEvent(event);
  if (event || !prefill) return base;
  return {
    ...base,
    name: prefill.title,
    slug: slugFromName(prefill.title),
    startsOn: prefill.startsOn,
    endsOn: prefill.endsOn,
    location: prefill.location || null,
  };
}

export function EventSettingsWorkspace({
  mode,
  initialEvent,
  initialLocations,
  areaCoordinators,
  canDeleteEvent = false,
  calendarPrefill,
  canArchiveEvent = false,
}: EventSettingsWorkspaceProps) {
  const [draft, setDraft] = useState<EventSettingsInput>(() => startingDraft(initialEvent, calendarPrefill));
  const [savedDraft, setSavedDraft] = useState<EventSettingsInput>(() => startingDraft(initialEvent, calendarPrefill));
  // The dates this form was loaded with (or last saved as). A save sends them back, and the server refuses it if the
  // stored dates differ (they were updated from the calendar banner meanwhile), so a stale form can never write the
  // old dates over the new ones. Only dates are guarded: other writes to the event never cause a conflict.
  const [loadedDates, setLoadedDates] = useState<{ startsOn: string; endsOn: string } | null>(
    initialEvent ? { startsOn: initialEvent.startsOn, endsOn: initialEvent.endsOn } : null,
  );
  // The "Which features does this event use?" step of creation (#965). The five flags live in `draft`, like the rest of
  // the form; the modules and the calendar choice live here. Untouched (null) means the step was skipped: the modules
  // follow the audience's defaults and nothing extra is sent, so the server applies the same defaults.
  const [chosenModules, setChosenModules] = useState<EventModuleKey[] | null>(null);
  const [showOnCalendar, setShowOnCalendar] = useState(true);
  const [setupWarnings, setSetupWarnings] = useState(initialEvent?.warnings ?? []);
  const [publishedFormCount, setPublishedFormCount] = useState(initialEvent?.publishedFormCount ?? 0);
  // Publishing and unpublishing are their own actions (#471), never a side
  // effect of saving this form: tracked separately from `draft` so nothing
  // in the settings save can change it, and updated only by `publish()` and
  // `unpublish()` below.
  const [published, setPublished] = useState(initialEvent?.isPublished ?? false);
  const [publishing, setPublishing] = useState(false);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [unpublishDialogOpen, setUnpublishDialogOpen] = useState(false);
  const [unpublishing, setUnpublishing] = useState(false);
  const [unpublishError, setUnpublishError] = useState("");
  const [slugWasEdited, setSlugWasEdited] = useState(mode === "edit");
  const [saving, setSaving] = useState(false);
  // Save and Publish report separately: this is the Save result, shown in the sticky bar.
  const [saveMessage, setSaveMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState<{ eventSlug: string; formSlug: string } | null>(null);
  // Which blocks are open (#743). Only the first is open on load; closing a
  // block hides it (a native <details>) and never unmounts its fields, so typed
  // values and validation survive.
  const [openBlocks, setOpenBlocks] = useState<Record<string, boolean>>({ basics: true });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const pendingFocusRef = useRef<string | null>(null);
  // Readiness reflects the saved event (#471), not unsaved edits: that is
  // what the server checks when Publish is clicked, so the checklist and the
  // button never promise something a save hasn't made true yet.
  const readiness = useMemo(
    () => getEventPublishReadiness(savedDraft, publishedFormCount),
    [savedDraft, publishedFormCount],
  );
  const publishWarnings = useMemo(
    () => getEventPublishWarnings(savedDraft),
    [savedDraft],
  );
  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(savedDraft),
    [draft, savedDraft],
  );
  // The save bar stays after the form until the page is scrolled or something is edited, so it never covers the first sections (#996).
  const scrolledPastTop = usePinAfterScroll(null);
  const savebarPinned = scrolledPastTop || dirty;
  // Tell the calendar banner beside this form whether answering it would discard unsaved changes (#445).
  useEffect(() => {
    if (mode !== "edit") return undefined;
    setEventSettingsDirty(dirty);
    return () => setEventSettingsDirty(false);
  }, [mode, dirty]);
  // The modules the step shows and sends: the person's choice, else the live audience's defaults.
  const creationFeatures: CreationFeatures = creationFeaturesFor(
    draft.audience ?? "GENERAL",
    chosenModules,
    { ...defaultCreationFeatures(draft.audience ?? "GENERAL", draft), showOnCalendar },
  );
  const effectiveModules = creationFeatures.modules;
  function changeCreationFeatures(next: CreationFeatures) {
    // Only a module checkbox pins the modules; a flag or the calendar choice leaves them following the audience.
    setChosenModules(chosenModulesAfter(chosenModules, creationFeatures, next));
    setShowOnCalendar(next.showOnCalendar);
    for (const key of creationFlagKeys) {
      if (next[key] !== draft[key]) update(key, next[key]);
    }
  }
  const publishBlockedBySave = dirty || saving;
  const canPublish = readiness.ready && !publishBlockedBySave && !publishing;
  const allowNextNavigation = useUnsavedChangesGuard(
    dirty,
    "These event settings have not been saved. Leave and discard the changes?",
  );

  function clearFieldError(key: string) {
    setFieldErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function setBlockOpen(id: SettingsBlockId, open: boolean) {
    setOpenBlocks((current) => (current[id] === open ? current : { ...current, [id]: open }));
  }

  const fieldAria = (key: string) => fieldErrorProps(settingsFieldErrorId(key), fieldErrors[key]);
  const fieldNote = (key: string) => <FieldError id={settingsFieldErrorId(key)}>{fieldErrors[key]}</FieldError>;
  const blockHasError = (id: SettingsBlockId) => Object.keys(fieldErrors).some((key) => (
    effectiveBlockForField(key, {
      optionsInMore: (field) => placementOf(optionFieldSection[field as keyof typeof optionFieldSection]) === "more",
      lodgingInMore: placementOf("lodging") === "more",
    }) === id
  ));

  function update<K extends keyof EventSettingsInput>(key: K, value: EventSettingsInput[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    clearFieldError(key);
    setError("");
    setNotice("");
    setSaveMessage(null);
  }

  function updateName(name: string) {
    setDraft((current) => ({
      ...current,
      name,
      slug: slugWasEdited ? current.slug : slugFromName(name),
    }));
    clearFieldError("name");
    setError("");
    setNotice("");
    setSaveMessage(null);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setSaveMessage(null);
    setFieldErrors({});
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        mode === "create" ? "/api/events" : `/api/events/${initialEvent!.id}`,
        {
          method: mode === "create" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...eventSettingsRequestBody(draft),
            ...(mode === "create" && calendarPrefill ? { calendarEntryId: calendarPrefill.entryId } : {}),
            ...(mode === "edit" && loadedDates ? { expectedStartsOn: loadedDates.startsOn, expectedEndsOn: loadedDates.endsOn } : {}),
            // Only a step the person opened sends its choices; skipped, the server applies the audience's defaults (#965).
            ...(mode === "create" && (chosenModules !== null || !showOnCalendar)
              ? { features: { modules: effectiveModules, showOnCalendar } }
              : {}),
          }),
        },
      );
      const result = await response.json().catch(() => ({})) as EventApiResult;
      if (!response.ok || !result.event) {
        const errors = fieldErrorsFromIssues(result.issues);
        if (Object.keys(errors).length > 0) showFieldErrors(errors);
        throw new Error(
          result.message
          ?? result.issues?.[0]?.message
          ?? "The event could not be saved.",
        );
      }
      if (mode === "create") {
        allowNextNavigation();
        // A full load on purpose: the staff header's event switcher is rendered
        // on the server and has to pick up the event that was just created.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign(`/more/event-settings?event=${encodeURIComponent(result.event.id)}&created=1`);
        return;
      }
      const nextDraft = draftFromEvent(result.event);
      setDraft(nextDraft);
      setSavedDraft(nextDraft);
      setPublishedFormCount(result.event.publishedFormCount);
      setPublished(result.event.isPublished);
      setLoadedDates({ startsOn: result.event.startsOn, endsOn: result.event.endsOn });
      setSetupWarnings(result.event.warnings ?? []);
      const nextReadiness = getEventPublishReadiness(nextDraft, result.event.publishedFormCount);
      const nextStep = result.event.isPublished
        ? "Public registration stays on."
        : nextReadiness.items.find((item) => !item.complete)
          ? `Next: ${nextReadiness.items.find((item) => !item.complete)!.label.toLowerCase()} before you publish.`
          : "Next: publish the event when you are ready.";
      setSaveMessage({ kind: "success", text: `Event settings saved. ${nextStep}` });
    } catch (caught) {
      setSaveMessage({ kind: "error", text: caught instanceof Error ? caught.message : "The event could not be saved." });
    } finally {
      setSaving(false);
    }
  }

  // A failed save: open the block holding the first problem, focus that field,
  // and let the summary link to the rest. The answers stay where they are.
  function showFieldErrors(errors: Record<string, string>) {
    setFieldErrors(errors);
    const first = firstFieldWithError(errors);
    if (!first) return;
    setBlockOpen(first.block, true);
    pendingFocusRef.current = settingsFieldDomId(first.key);
  }

  // The first thing standing between this event and Publish (#742): unsaved
  // edits first (Publish checks what is saved), then the first unmet checklist
  // item, each with the control that fixes it.
  const publishBlocker = useMemo<PublishBlocker | null>(() => {
    if (publishBlockedBySave) {
      // While saving there is nothing to go to: the save bar already says "Saving…".
      return saving
        ? { text: "Saving your changes…" }
        : { text: "You have unsaved changes. Save event settings first; Publish checks the saved settings.", actionLabel: "Go to Save event settings", targetId: "event-save-button" };
    }
    const missing = readiness.items.find((item) => !item.complete);
    if (!missing) return null;
    if (missing.id === "registration-form") {
      return { text: "Can't publish yet: a published registration form is missing.", actionLabel: "Open registration form", href: `/registration-builder?event=${initialEvent?.id ?? ""}` };
    }
    if (missing.id === "basics") {
      const first = ([
        ["name", "event-field-name", "Event name"],
        ["slug", "event-field-slug", "Short web address"],
        ["startsOn", "event-field-starts-on", "Starts on"],
        ["endsOn", "event-field-ends-on", "Ends on"],
        ["timezone", "event-field-timezone", "Event timezone"],
      ] as const).find(([key]) => !String(savedDraft[key] ?? "").trim());
      const [, targetId, controlLabel] = first ?? ["name", "event-field-name", "Event name"];
      return { text: `Can't publish yet: ${controlLabel} is missing.`, actionLabel: `Go to ${controlLabel}`, targetId };
    }
    if (missing.id === "location") return { text: "Can't publish yet: the event location is missing.", actionLabel: "Go to Location", targetId: "event-field-location" };
    if (missing.id === "support") return { text: "Can't publish yet: the registration support contact is missing.", actionLabel: "Go to Registration support contact", targetId: "event-field-support-contact" };
    return { text: "Can't publish yet: club registration needs church billing.", actionLabel: "Go to Billing mode", targetId: "event-field-billing-mode" };
  }, [publishBlockedBySave, saving, readiness, savedDraft, initialEvent?.id]);

  // Open the block that holds a control (a "Go to ..." link, an error, a jump
  // link), then scroll to it and focus it. The block is opened in the DOM at
  // once, so focus works now, and in state, so React keeps it open.
  function goToControl(targetId: string) {
    const blockId = blockForControlId(targetId);
    if (blockId) setBlockOpen(blockId, true);
    const target = document.getElementById(targetId);
    if (!target) return;
    for (let node = target.closest("details"); node; node = node.parentElement?.closest("details") ?? null) {
      if (!node.open) node.open = true;
    }
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.focus({ preventScroll: true });
  }

  function jumpToBlock(id: SettingsBlockId) {
    setBlockOpen(id, true);
    const block = document.getElementById(settingsBlockDomId(id)) as HTMLDetailsElement | null;
    if (!block) return;
    block.open = true;
    block.scrollIntoView({ behavior: "smooth", block: "start" });
    block.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
  }

  // After a failed save the first invalid field takes focus, once. goToControl
  // opens every closed <details> around it, "More settings" included. Later
  // changes to the errors (one clearing as someone types) never move focus.
  useEffect(() => {
    const targetId = takePendingFocus(pendingFocusRef);
    if (targetId) goToControl(targetId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldErrors]);

  function openPublishDialog() {
    if (publishBlocker) {
      if (publishBlocker.targetId) goToControl(publishBlocker.targetId);
      return;
    }
    if (!canPublish) return;
    setPublishError("");
    setPublishDialogOpen(true);
  }

  function cancelPublish() {
    if (publishing) return;
    setPublishDialogOpen(false);
    setPublishError("");
  }

  async function publish() {
    if (!canPublish) return;
    setPublishing(true);
    setPublishError("");
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/events/${initialEvent!.id}/publish`, { method: "POST" });
      const result = await response.json().catch(() => ({})) as EventApiResult;
      if (!response.ok || !result.event) {
        throw new Error(result.message ?? "The event could not be published.");
      }
      setPublished(result.event.isPublished);
      setLoadedDates({ startsOn: result.event.startsOn, endsOn: result.event.endsOn });
      setSetupWarnings(result.event.warnings ?? []);
      setPublishDialogOpen(false);
      const warnings = result.warnings ?? [];
      setNotice(
        warnings.length > 0
          ? `Event published. ${warnings.join(" ")}`
          : "Event published. Public registration is available during the registration window.",
      );
    } catch (caught) {
      setPublishError(caught instanceof Error ? caught.message : "The event could not be published.");
    } finally {
      setPublishing(false);
    }
  }

  function openUnpublishDialog() {
    setUnpublishError("");
    setUnpublishDialogOpen(true);
  }

  function cancelUnpublish() {
    setUnpublishDialogOpen(false);
    setUnpublishError("");
  }

  async function unpublish() {
    if (unpublishing) return;
    setUnpublishing(true);
    setUnpublishError("");
    try {
      const response = await fetch(`/api/events/${initialEvent!.id}/unpublish`, { method: "POST" });
      const result = await response.json().catch(() => ({})) as EventApiResult;
      if (!response.ok || !result.event) {
        throw new Error(result.message ?? "The event could not be unpublished.");
      }
      setPublished(result.event.isPublished);
      setLoadedDates({ startsOn: result.event.startsOn, endsOn: result.event.endsOn });
      setSetupWarnings(result.event.warnings ?? []);
      setUnpublishDialogOpen(false);
      setNotice("Event unpublished. Every public registration form is now closed.");
    } catch (caught) {
      setUnpublishError(caught instanceof Error ? caught.message : "The event could not be unpublished.");
    } finally {
      setUnpublishing(false);
    }
  }

  async function copyEmbedCode(formSlug: string) {
    // Copied code identifies the last saved event, never unsaved edits.
    const result = await copySavedEmbedCode({
      origin: window.location.origin,
      saved: savedDraft,
      formSlug,
      writeText: (text) => navigator.clipboard.writeText(text),
    });
    if (result.ok) {
      setCopied(result.copied);
      setNotice("Auto-sizing embed code copied. Paste the full block into the website’s Custom HTML area.");
      setError("");
    } else {
      setCopied(null);
      setError("The embed code could not be copied. Open the embedded form and copy its address instead.");
    }
  }

  const attendeeEditField = (
    <RadioCardGroup
      legend="Attendee edit verification"
      id={settingsFieldDomId("attendeeEditPolicy")}
      idOn="selected"
      name="attendeeEditPolicy"
      {...fieldAria("attendeeEditPolicy")}
      value={draft.attendeeEditPolicy}
      onChange={(value) => update("attendeeEditPolicy", value as EventSettingsInput["attendeeEditPolicy"])}
      options={[
        { value: "VERIFY_EVERY_EDIT", label: "Email a code for every edit" },
        { value: "TIERED", label: "Allow low-risk answers without a code" },
      ]}
      help={<><small>
        Contact changes, cancellations, and transfers always require a fresh emailed
        code. Medical and club data always require an authenticator.
      </small>{fieldNote("attendeeEditPolicy")}</>}
    />
  );
  const paymentInstructionsField = (
    <label>
      Approved payment instructions
      <textarea id={settingsFieldDomId("approvedPaymentInstructions")} {...fieldAria("approvedPaymentInstructions")}
        value={draft.approvedPaymentInstructions ?? ""}
        maxLength={2_000}
        rows={5}
        placeholder="Tell registrants how to pay this event's approved balance."
        onChange={(event) => update("approvedPaymentInstructions", event.target.value || null)}
      />
      <small>
        Versioned event guidance appears only on applicable unpaid messages. Amounts, payment
        state, waitlist, complimentary, and organization-billed wording remain server-derived.
      </small>
    {fieldNote("approvedPaymentInstructions")}</label>
  );
  const seminarField = (
    <div className="form-grid two-column">
      <label>
        Seminar preference deadline
        <input id={settingsFieldDomId("seminarPreferenceClosesOn")} {...fieldAria("seminarPreferenceClosesOn")}
          type="date"
          value={draft.seminarPreferenceClosesOn ?? ""}
          onChange={(event) => update(
            "seminarPreferenceClosesOn",
            event.target.value || null,
          )}
        />
        <small>Holders can update ranked seminar preferences through this date in the event timezone.</small>
      {fieldNote("seminarPreferenceClosesOn")}</label>
      <label className="event-setting-toggle">
        <input id={settingsFieldDomId("seminarPreferenceSelfServiceLocked")} {...fieldAria("seminarPreferenceSelfServiceLocked")}
          type="checkbox"
          checked={draft.seminarPreferenceSelfServiceLocked}
          onChange={(event) => update(
            "seminarPreferenceSelfServiceLocked",
            event.target.checked,
          )}
        />
        <span><strong>Lock seminar preference self-service</strong><small>Current preferences remain visible; staff can still make a documented override.</small>{fieldNote("seminarPreferenceSelfServiceLocked")}</span>
      </label>
    </div>
  );
  const shirtField = (
    <label className="event-setting-toggle">
      <input id={settingsFieldDomId("collectsShirtSizes")} {...fieldAria("collectsShirtSizes")}
        type="checkbox"
        checked={draft.collectsShirtSizes}
        onChange={(event) => update("collectsShirtSizes", event.target.checked)}
      />
      <span>
        <strong>Collect a shirt size for each attendee</strong>
        <small>
          Registrants choose a size on their private page, and staff can send a reviewed
          request to everyone still missing one. Turning this off hides the question and
          stops the request being sent.
        </small>
      {fieldNote("collectsShirtSizes")}</span>
    </label>
  );
  const hostedPaymentLinkField = (
    <label className="event-setting-toggle">
      <input id={settingsFieldDomId("hostedPaymentLinkEnabled")} {...fieldAria("hostedPaymentLinkEnabled")}
        type="checkbox"
        checked={draft.hostedPaymentLinkEnabled}
        onChange={(event) => update("hostedPaymentLinkEnabled", event.target.checked)}
      />
      <span>
        <strong>Offer &ldquo;Pay on Square&rdquo; as a backup</strong>
        <small>
          Adds a secondary button beside the card form that opens Square&rsquo;s own payment page for the
          same balance, with the same card fee. A payment counts only after Square confirms it, and the
          first payment recorded wins. Meant for events where attendees pay online.
        </small>
      {fieldNote("hostedPaymentLinkEnabled")}</span>
    </label>
  );
  const backgroundField = (
    <label className="event-setting-toggle">
      <input id={settingsFieldDomId("checksAdultBackgrounds")} {...fieldAria("checksAdultBackgrounds")}
        type="checkbox"
        checked={draft.checksAdultBackgrounds}
        onChange={(event) => update("checksAdultBackgrounds", event.target.checked)}
      />
      <span>
        <strong>Youth or children&apos;s event: check adults&apos; Sterling Volunteers</strong>
        <small>
          For events where parents aren&apos;t normally there. Every adult registered, club
          staff or not, is flagged until they are in compliance with Sterling Volunteers.
          Registration is never blocked. At check-in, adults and staff who are not current are held unless staff
          type a reason to override.
        </small>
      {fieldNote("checksAdultBackgrounds")}</span>
    </label>
  );
  const lodgingPanel = (
    <SettingsBlock
      eyebrow="Optional"
      hasError={Object.keys(fieldErrors).some((key) => settingsFieldBlock[key] === "lodging")}
      blockId="lodging"
      onOpenChange={(open) => setBlockOpen("lodging", open)}
      open={openBlocks.lodging ?? false}
      summary={blockSummary("lodging", draft)}
      title={settingsBlockTitles.lodging}
    >
      <p className="settings-block-intro">
        Rooms held for this event. Registration messages that use the hotel token show
        these details, and leave the section out entirely when the hotel name is blank —
        so an event with no room block never carries another event&rsquo;s hotel.
      </p>
      <label>
        Hotel name
        <input id={settingsFieldDomId("hotelName")} {...fieldAria("hotelName")} value={draft.hotelName ?? ""} maxLength={200} placeholder="Holiday Inn Des Moines – Airport Conference Center" onChange={(event) => update("hotelName", event.target.value || null)} />
        <small>Leave blank for an event with no room block. Everything below is then unused.</small>
      {fieldNote("hotelName")}</label>
      <label>
        Reservation link
        <input id={settingsFieldDomId("hotelBookingUrl")} {...fieldAria("hotelBookingUrl")} type="url" value={draft.hotelBookingUrl ?? ""} maxLength={500} placeholder="https://…" onChange={(event) => update("hotelBookingUrl", event.target.value || null)} />
      {fieldNote("hotelBookingUrl")}</label>
      <label>
        Reservation phone
        <input id={settingsFieldDomId("hotelPhone")} {...fieldAria("hotelPhone")} value={draft.hotelPhone ?? ""} maxLength={60} placeholder="(515) 287-2400" onChange={(event) => update("hotelPhone", event.target.value || null)} />
      {fieldNote("hotelPhone")}</label>
      <label>
        Group name to ask for
        <input id={settingsFieldDomId("hotelGroupName")} {...fieldAria("hotelGroupName")} value={draft.hotelGroupName ?? ""} maxLength={200} placeholder="IA-MO Conference of Seventh-day Adventists Women’s Retreat" onChange={(event) => update("hotelGroupName", event.target.value || null)} />
      {fieldNote("hotelGroupName")}</label>
      <label>
        Group rate
        <input id={settingsFieldDomId("hotelRate")} {...fieldAria("hotelRate")} value={draft.hotelRate ?? ""} maxLength={120} placeholder="$120 per night plus tax" onChange={(event) => update("hotelRate", event.target.value || null)} />
      {fieldNote("hotelRate")}</label>
      <label>
        Additional lodging notes
        <textarea id={settingsFieldDomId("hotelInstructions")} {...fieldAria("hotelInstructions")} value={draft.hotelInstructions ?? ""} rows={3} maxLength={1000} placeholder="Pro tip: share a room with a friend and split the cost." onChange={(event) => update("hotelInstructions", event.target.value || null)} />
        <small>Shown under the reservation details in every message that includes lodging.</small>
      {fieldNote("hotelInstructions")}</label>
    </SettingsBlock>
  );

  const eventKind = eventKindFromAudience(draft.audience);
  // Placement follows the live audience and billing mode, so changing either
  // moves sections at once. Whether a section holds a non-default value is read
  // from what was last saved, so typing into a section in "More settings"
  // never moves it out from under the cursor.
  const nonDefaultSections = sectionsWithNonDefaultValues(savedDraft);
  const placementOf = (id: EventSettingsSectionId) =>
    resolveSectionPlacement(id, { kind: eventKind, billingMode: draft.billingMode }, nonDefaultSections);

  const optionFields: Array<{ id: EventSettingsSectionId; node: React.ReactNode }> = [
    { id: "attendee-edit-policy", node: attendeeEditField },
    { id: "payment-instructions", node: paymentInstructionsField },
    { id: "seminar-preferences", node: seminarField },
    { id: "shirt-sizes", node: shirtField },
    { id: "adult-background-checks", node: backgroundField },
    { id: "hosted-payment-link", node: hostedPaymentLinkField },
  ];
  const optionalFields = {
    primary: optionFields.filter((field) => placementOf(field.id) === "primary"),
    more: optionFields.filter((field) => placementOf(field.id) === "more"),
  };
  const lodgingInMore = placementOf("lodging") === "more";
  const visibleBlocks = settingsBlockIds.filter((id) => (
    id === "options" ? optionalFields.primary.length > 0
      : id === "lodging" ? !lodgingInMore
        : id === "more" ? optionalFields.more.length > 0 || lodgingInMore
          : true
  ));
  const saveStatus = saveStatusLabel({ saving, dirty });
  const errorItems = Object.entries(fieldErrors)
    .filter(([key]) => key in settingsFieldBlock)
    .sort(([left], [right]) => settingsBlockIds.indexOf(settingsFieldBlock[left]) - settingsBlockIds.indexOf(settingsFieldBlock[right]))
    .map(([key, message]) => ({ targetId: settingsFieldDomId(key), message }));

  // A field inside a closed block can fail native validation (a bad URL, say).
  // The browser cannot show a message on a hidden field, so Save would do
  // nothing; open the block and focus the field instead.
  function openBlockForInvalidField(event: React.FormEvent<HTMLFormElement>) {
    const target = event.target as HTMLElement;
    let opened = false;
    for (let node = target.closest("details"); node; node = node.parentElement?.closest("details") ?? null) {
      if (!node.open) {
        node.open = true;
        opened = true;
      }
      const id = node.dataset.settingsBlock as SettingsBlockId | undefined;
      if (id) setBlockOpen(id, true);
    }
    if (opened) target.focus();
  }

  return (
    <section className="page-stack event-settings-workspace">
      {mode === "edit" && initialEvent && (
        <DraftCreatedGuideBanner eventId={initialEvent.id} />
      )}
      <div className="page-intro">
        <div>
          <p className="eyebrow">{mode === "create" ? "New event setup" : "Event setup"}</p>
          {/* In edit mode the staff header already carries the page's one H1, "Event settings" (#742). */}
          {mode === "create" && <h2>Create an event draft</h2>}
          <p>
            {mode === "create"
              ? "Start with the information attendees and staff need. The event stays private until its registration form and publish checklist are ready."
              : `Update the public details, registration dates, capacity, and publishing status for ${initialEvent?.name}.`}
          </p>
        </div>
        <span className={`count-badge ${published ? "green" : ""}`}>
          <ShieldCheck size={16} aria-hidden="true" />
          {published ? "Published" : "Private draft"}
        </span>
      </div>

      {error && <div className="inline-notice error" role="alert"><AlertTriangle size={17} aria-hidden="true" /> {error}</div>}
      {notice && <div className="inline-notice success" role="status"><CheckCircle2 size={17} aria-hidden="true" /> {notice}</div>}

      <nav aria-label="Jump to a settings section" className="settings-jump-bar">
        <span aria-live="polite" className={`settings-save-status ${dirty ? "is-dirty" : "is-clean"}`} role="status">
          {dirty ? <AlertTriangle aria-hidden="true" size={14} /> : <CheckCircle2 aria-hidden="true" size={14} />}
          <strong>{saveStatus}</strong>
        </span>
        <ul>
          {visibleBlocks.map((id) => (
            <li key={id}><a href={`#${settingsBlockDomId(id)}`} onClick={(event) => { event.preventDefault(); jumpToBlock(id); }}>{settingsBlockJumpLabels[id]}</a></li>
          ))}
        </ul>
      </nav>

      <form className="event-settings-layout" onSubmit={save} onInvalidCapture={openBlockForInvalidField}>
        <div className="event-settings-main">
          {errorItems.length > 0 && (
            <FormErrorSummary
              items={errorItems}
              onFollow={(event, item) => { event.preventDefault(); if (item.targetId) goToControl(item.targetId); }}
              ref={errorSummaryRef}
            />
          )}
          <SettingsBlock
            eyebrow="Step 1"
            hasError={blockHasError("basics")}
            blockId="basics"
            onOpenChange={(open) => setBlockOpen("basics", open)}
            open={openBlocks["basics"] ?? false}
            summary={blockSummary("basics", draft)}
            title={settingsBlockTitles["basics"]}
          >
            <p className="settings-block-intro">Use the public event name and the dates attendees will recognize.</p>
            <label>
              Event name
              <input {...fieldAria("name")}
                id="event-field-name"
                value={draft.name}
                minLength={3}
                maxLength={120}
                required
                autoComplete="off"
                placeholder="Women’s Retreat 2027"
                onChange={(event) => updateName(event.target.value)}
              />
            {fieldNote("name")}</label>
            <label>
              Short web address
              <span className="event-slug-input"><b>/register/</b><input {...fieldAria("slug")}
                id="event-field-slug"
                value={draft.slug}
                minLength={3}
                maxLength={80}
                required
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                placeholder="womens-retreat-2027"
                onChange={(event) => {
                  setSlugWasEdited(true);
                  update("slug", event.target.value.toLowerCase());
                }}
              /></span>
              <small>Lowercase letters, numbers, and hyphens. Changing this later changes registration links.</small>
            {fieldNote("slug")}</label>
            <div className="form-grid two-column">
              <label>Starts on<input {...fieldAria("startsOn")} id="event-field-starts-on" type="date" required value={draft.startsOn} onChange={(event) => update("startsOn", event.target.value)} />{fieldNote("startsOn")}</label>
              <label>Ends on<input {...fieldAria("endsOn")} id="event-field-ends-on" type="date" required min={draft.startsOn || undefined} value={draft.endsOn} onChange={(event) => update("endsOn", event.target.value)} />{fieldNote("endsOn")}</label>
            </div>
            <label>
              Event timezone
              <select {...fieldAria("timezone")} id="event-field-timezone" value={draft.timezone} onChange={(event) => update("timezone", event.target.value as EventSettingsInput["timezone"])}>
                {eventTimeZones.map((zone) => <option value={zone} key={zone}>{timeZoneLabels[zone]} ({zone})</option>)}
              </select>
              <small>Registration opening, closing, and late-price dates use this timezone.</small>
            {fieldNote("timezone")}</label>
            <div className="form-grid two-column">
              <label>
                Location
                <span className="input-with-icon"><MapPin size={16} aria-hidden="true" /><input {...fieldAria("location")} id="event-field-location" value={draft.location ?? ""} maxLength={200} placeholder="Camp Heritage, Clarksburg, MO" onChange={(event) => update("location", event.target.value || null)} /></span>
              {fieldNote("location")}</label>
              <label>
                Overall attendee limit
                <span className="input-with-icon"><UsersRound size={16} aria-hidden="true" /><input {...fieldAria("capacity")} id="event-field-capacity" type="number" min={1} max={100000} value={draft.capacity ?? ""} placeholder="No overall limit" onChange={(event) => update("capacity", event.target.value ? Number(event.target.value) : null)} /></span>
              {fieldNote("capacity")}</label>
            </div>
          </SettingsBlock>

          {mode === "create" && (
            <CreationFeaturesStep
              audience={draft.audience ?? "GENERAL"}
              collapsible
              features={creationFeatures}
              onChange={changeCreationFeatures}
            />
          )}

          <SettingsBlock
            eyebrow="Step 2"
            hasError={blockHasError("timing")}
            blockId="timing"
            onOpenChange={(open) => setBlockOpen("timing", open)}
            open={openBlocks["timing"] ?? false}
            summary={blockSummary("timing", draft)}
            title={settingsBlockTitles["timing"]}
          >
            <p className="settings-block-intro">Leave either date blank when registration should remain open-ended.</p>
            <div className="form-grid two-column">
              <label>Registration opens<input id={settingsFieldDomId("registrationOpensOn")} {...fieldAria("registrationOpensOn")} type="date" value={draft.registrationOpensOn ?? ""} onChange={(event) => update("registrationOpensOn", event.target.value || null)} />{fieldNote("registrationOpensOn")}</label>
              <label>Registration closes<input id={settingsFieldDomId("registrationClosesOn")} {...fieldAria("registrationClosesOn")} type="date" min={draft.registrationOpensOn || undefined} value={draft.registrationClosesOn ?? ""} onChange={(event) => update("registrationClosesOn", event.target.value || null)} />{fieldNote("registrationClosesOn")}</label>
            </div>
            <div className="form-grid two-column">
              <label>Payment due by<input id={settingsFieldDomId("paymentDueOn")} {...fieldAria("paymentDueOn")} type="date" value={draft.paymentDueOn ?? ""} onChange={(event) => update("paymentDueOn", event.target.value || null)} /><small>Optional. Only a date that &quot;days before payment due&quot; scheduled emails count back from, and that the confirmation and balance reminder may mention. It adds no late fee and blocks nothing; people can still pay at the event. Changing or clearing it pauses any approved schedule that uses it.</small>{fieldNote("paymentDueOn")}</label>
            </div>
            <label className="event-setting-toggle">
              <input id={settingsFieldDomId("waitlistEnabled")} {...fieldAria("waitlistEnabled")}
                type="checkbox"
                checked={draft.waitlistEnabled}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  setDraft((current) => ({
                    ...current,
                    waitlistEnabled: enabled,
                    autoPromoteWaitlist: enabled ? current.autoPromoteWaitlist : false,
                  }));
                }}
              />
              <span><strong>Offer a waitlist when the event is full</strong><small>People can submit without taking a confirmed event spot.</small>{fieldNote("waitlistEnabled")}</span>
            </label>
            <RadioCardGroup
              id={settingsFieldDomId("audience")}
              idOn="selected"
              legend="Audience"
              name="audience"
              {...fieldAria("audience")}
              value={draft.audience ?? "GENERAL"}
              onChange={(value) => {
                update("audience", value as EventSettingsInput["audience"]);
                // The modules follow the audience's defaults again (a club event gets the club modules); a choice made for
                // the other audience would otherwise carry over.
                if (mode === "create") setChosenModules(null);
              }}
              options={[
                { value: "GENERAL", label: "General event" },
                { value: "CLUB", label: "Club or church event" },
              ]}
              help={<><small>
                Controls Clubs and churches navigation, club oversight, and club reports —
                Club registration uses church billing. For an event where individuals pay
                (for example Man Camp), choose General.
              </small>{fieldNote("audience")}</>}
            />
            <RadioCardGroup
              id={settingsFieldDomId("billingMode")}
              idOn="selected"
              legend="Billing mode"
              name="billingMode"
              {...fieldAria("billingMode")}
              value={draft.billingMode}
              onChange={(value) => update("billingMode", value as EventSettingsInput["billingMode"])}
              options={[
                { value: "ATTENDEE_PAY", label: "Attendees pay online" },
                { value: "DEFERRED_ORGANIZATION_INVOICE", label: "Bill the responsible organization later" },
              ]}
              help={<><small>
                Club/church group events such as Spring Camporee: registration shows informational
                rates only, no attendee balance or online payment is created, and the responsible
                organization is billed later based on final attendance.
              </small>{fieldNote("billingMode")}</>}
            />
            <label className="event-setting-toggle nested">
              <input id={settingsFieldDomId("autoPromoteWaitlist")} {...fieldAria("autoPromoteWaitlist")}
                type="checkbox"
                disabled={!draft.waitlistEnabled}
                checked={draft.autoPromoteWaitlist}
                onChange={(event) => update("autoPromoteWaitlist", event.target.checked)}
              />
              <span><strong>Automatically promote the next eligible registration</strong><small>Use the saved queue order when capacity becomes available.</small>{fieldNote("autoPromoteWaitlist")}</span>
            </label>
          </SettingsBlock>

          {optionalFields.primary.length > 0 && <SettingsBlock
            eyebrow="Options"
            hasError={blockHasError("options")}
            blockId="options"
            onOpenChange={(open) => setBlockOpen("options", open)}
            open={openBlocks.options ?? false}
            summary={blockSummary("options", draft, { count: optionalFields.primary.length })}
            title={settingsBlockTitles.options}
          >
            <p className="settings-block-intro">Settings that apply to this kind of event.</p>
            {optionalFields.primary.map((field) => <div className="event-settings-option" key={field.id}>{field.node}</div>)}
          </SettingsBlock>}


          <SettingsBlock
            eyebrow="Step 3"
            hasError={blockHasError("public-info")}
            blockId="public-info"
            onOpenChange={(open) => setBlockOpen("public-info", open)}
            open={openBlocks["public-info"] ?? false}
            summary={blockSummary("public-info", draft)}
            title={settingsBlockTitles["public-info"]}
          >
            <p className="settings-block-intro">Event information lives on IMSDA Events. Link an IMSDA.org page too only if one still exists for this event.</p>
            <label>
              IMSDA.org event page (optional)
              <input id={settingsFieldDomId("publicInfoUrl")} {...fieldAria("publicInfoUrl")} type="url" value={draft.publicInfoUrl ?? ""} maxLength={500} placeholder="https://imsda.org/event/your-event/" onChange={(event) => update("publicInfoUrl", event.target.value || null)} />
              <small>Not required to publish. Leave blank when schedules, speakers, and event details live only on this event&rsquo;s IMSDA Events page.</small>
            {fieldNote("publicInfoUrl")}</label>
            <label>
              Registration support contact
              <input {...fieldAria("supportContact")} id="event-field-support-contact" value={draft.supportContact ?? ""} maxLength={200} placeholder="registration@imsda.org or conference office phone" onChange={(event) => update("supportContact", event.target.value || null)} />
              <small>Enter the email, phone number, or office name attendees should use for help.</small>
            {fieldNote("supportContact")}</label>
            <label>
              Event theme or tagline (optional)
              <input id={settingsFieldDomId("tagline")} {...fieldAria("tagline")} value={draft.tagline ?? ""} maxLength={120} placeholder="Lest We Forget" onChange={(event) => update("tagline", event.target.value || null)} />
              <small>Shown under the event title on the public page of a club event. Plain text only.</small>
            {fieldNote("tagline")}</label>
            <label>
              Header subtitle (optional)
              <input id={settingsFieldDomId("subtitle")} {...fieldAria("subtitle")} value={draft.subtitle ?? ""} maxLength={200} placeholder="Register all of your club's attendees using only one form" onChange={(event) => update("subtitle", event.target.value || null)} />
              <small>One line under the dates. Plain text only.</small>
            {fieldNote("subtitle")}</label>
            <label>
              Help email (optional)
              <input id={settingsFieldDomId("helpEmail")} {...fieldAria("helpEmail")} type="email" value={draft.helpEmail ?? ""} maxLength={200} placeholder="youth@imsda.org" onChange={(event) => update("helpEmail", event.target.value || null)} />
              <small>Used by the help card on a club event&rsquo;s public page. Club events fall back to youth@imsda.org.</small>
            {fieldNote("helpEmail")}</label>
            <label>
              Attendee hub title (optional)
              <input id={settingsFieldDomId("hubTitle")} {...fieldAria("hubTitle")} value={draft.hubTitle ?? ""} maxLength={80} placeholder="Event hub" onChange={(event) => update("hubTitle", event.target.value || null)} />
              <small>The heading label and page title on the signed-in attendee hub. Plain text. Leave empty for &ldquo;Event hub&rdquo;.</small>
            {fieldNote("hubTitle")}</label>
            <label>
              Attendee hub intro (optional)
              <textarea id={settingsFieldDomId("hubIntro")} {...fieldAria("hubIntro")} value={draft.hubIntro ?? ""} rows={3} maxLength={600} placeholder="Schedule, updates, resources, passes and assigned sessions in one signed-in place." onChange={(event) => update("hubIntro", event.target.value || null)} />
              <small>The sentence under the event name on the attendee hub. Plain text. Leave empty for the standard sentence.</small>
            {fieldNote("hubIntro")}</label>
            <label>
              Refund policy (optional)
              <textarea id={settingsFieldDomId("refundPolicy")} {...fieldAria("refundPolicy")} value={draft.refundPolicy ?? ""} rows={5} maxLength={4000} placeholder="Refunds are available until two weeks before the event." onChange={(event) => update("refundPolicy", event.target.value || null)} />
              <small>Shown to registrants on the event page, before they submit a registration, and on their confirmation. Plain text; leave a blank line between paragraphs. Leave empty to show nothing. This only displays the policy; refunds are still handled by staff.</small>
            {fieldNote("refundPolicy")}</label>
            {draft.publicInfoUrl && (
              <a className="secondary-button event-info-preview" href={draft.publicInfoUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={15} aria-hidden="true" /> Open IMSDA.org page
              </a>
            )}
          </SettingsBlock>


          {!lodgingInMore && lodgingPanel}

          {(optionalFields.more.length > 0 || lodgingInMore) && (
            <SettingsBlock
              className="panel event-more-settings"
              hasError={blockHasError("more")}
              blockId="more"
              onOpenChange={(open) => setBlockOpen("more", open)}
              open={openBlocks.more ?? false}
              summary="Settings that do not apply to this kind of event. They are kept, not removed."
              title={settingsBlockTitles.more}
            >
              {optionalFields.more.map((field) => <div className="event-settings-option" key={field.id}>{field.node}</div>)}
              {lodgingInMore && lodgingPanel}
            </SettingsBlock>
          )}
        </div>

        <aside className="event-settings-side">
          <section className="panel event-readiness-panel" id="event-readiness-panel">
            <p className="eyebrow">Publish readiness</p>
            <h2>{readiness.ready ? "Ready to publish" : `${readiness.completedCount} of ${readiness.items.length} ready`}</h2>
            <p>Publishing turns on the event’s public registration links. Form versions and registration dates still control what attendees can submit.</p>
            {mode === "edit" && dirty && <p className="field-help">This checklist reflects the saved settings. Save your changes to update it.</p>}
            <ul className="event-readiness-list">
              {readiness.items.map((item) => (
                <li className={item.complete ? "complete" : ""} key={item.id}>
                  {item.complete ? <CheckCircle2 size={18} aria-hidden="true" /> : <span aria-hidden="true" />}
                  <span><strong>{item.label}</strong><small>{item.detail}</small></span>
                </li>
              ))}
            </ul>
            {/* Never blocks publish (#575): a warning only. */}
            {!published && publishWarnings.map((warning) => (
              <div className="inline-notice clone-warning" key={warning} role="status"><AlertTriangle size={17} aria-hidden="true" /> {warning}</div>
            ))}
            {/* Never blocks publish (#593): dates and fees staff still need to set. */}
            {setupWarnings.map((warning) => (
              <div className="inline-notice clone-warning" key={warning.id} role="status"><AlertTriangle size={17} aria-hidden="true" /> <span><strong>{warning.label}.</strong> {warning.detail}{warning.href ? <>{" "}<Link href={warning.href}>{warning.href.includes("&field=") ? "Go to the fee field" : "Open the registration form"}</Link></> : null}</span></div>
            ))}
            {/* Never blocks publish (#467): shown for visibility only. */}
            <p className="event-readiness-optional-heading">Optional</p>
            <ul className="event-readiness-list event-readiness-optional">
              {readiness.optionalItems.map((item) => (
                <li className={item.complete ? "complete" : ""} key={item.id}>
                  {item.complete ? <CheckCircle2 size={18} aria-hidden="true" /> : <span aria-hidden="true" />}
                  <span><strong>{item.label}</strong><small>{item.detail}</small></span>
                </li>
              ))}
            </ul>
            {!readiness.items.find((item) => item.id === "registration-form")?.complete && (
              mode === "edit"
                ? <a className="secondary-button full-button" href={`/registration-builder?event=${initialEvent?.id}`}>Open registration form</a>
                : <div className="inline-notice">Create this draft first. Then build, test, and publish its registration form.</div>
            )}
            {mode === "edit" && (
              // Publishing and unpublishing are their own actions (#471), each
              // its own request the instant it's clicked — never folded into
              // the settings save below, so unpublishing can't happen as a
              // side effect of an unrelated save.
              <div className={`event-publish-toggle ${readiness.ready && !publishBlocker ? "ready" : ""}`}>
                <span>
                  <strong>{published ? "Public registration is on" : "Publish this event"}</strong>
                  <small>
                    {published
                      ? "To close every public form immediately, use Unpublish in the Danger zone below."
                      : publishBlocker
                        ? "Publishing is separate from saving. It needs one thing first:"
                        : "Every checklist item is complete. Publishing turns on public registration."}
                  </small>
                </span>
                {!published && publishBlocker && (
                  <p className="event-publish-blocker" id="event-publish-blocker">
                    <AlertTriangle size={15} aria-hidden="true" /> {publishBlocker.text}{" "}
                    {!publishBlocker.actionLabel
                      ? null
                      : publishBlocker.href
                      ? <Link href={publishBlocker.href}>{publishBlocker.actionLabel}</Link>
                      : <button className="text-button" onClick={() => publishBlocker.targetId && goToControl(publishBlocker.targetId)} type="button">{publishBlocker.actionLabel}</button>}
                  </p>
                )}
                {published ? null : (
                  <button aria-describedby={publishBlocker ? "event-publish-blocker" : undefined} aria-disabled={Boolean(publishBlocker) || publishing} className="secondary-button outline-action full-button event-publish-button" onClick={openPublishDialog} type="button">
                    {publishing ? "Publishing…" : "Publish event"}
                  </button>
                )}
              </div>
            )}
          </section>

          {mode === "edit" && (
            <section className="panel event-sharing-panel">
              <p className="eyebrow">Website sharing</p>
              <h2>Public registration</h2>
              {published && initialEvent?.publishedForms.length ? (
                <>
                  <p>Link to the event page from IMSDA.org, or embed a specific form in a Custom HTML block.</p>
                  <a
                    className="secondary-button full-button"
                    href={publicEventPath(savedDraft)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={15} aria-hidden="true" /> Open public event page
                  </a>
                  {shareAddressDiffers(draft, savedDraft) && (
                    <p className="event-share-saved-note" role="status">{SAVED_SHARE_ADDRESS_NOTE}</p>
                  )}
                  <div className="event-share-form-list">
                    {initialEvent.publishedForms.map((form) => (
                      <article key={form.id}>
                        <span><strong>{form.name}</strong><small>{embedPath(savedDraft, form.slug)}</small></span>
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => copyEmbedCode(form.slug)}
                        >
                          {isCopiedFor(copied, savedDraft, form.slug)
                            ? <CheckCircle2 size={15} aria-hidden="true" />
                            : <Copy size={15} aria-hidden="true" />}
                          {isCopiedFor(copied, savedDraft, form.slug) ? "Copied" : "Copy embed code"}
                        </button>
                      </article>
                    ))}
                  </div>
                  <small className="event-embed-note"><Code2 size={14} aria-hidden="true" /> The full block includes automatic height and scroll handling. It works only on domains allowed by the deployment’s embed policy.</small>
                </>
              ) : (
                <p>Publish the event and at least one registration form to unlock its public link and website embed code.</p>
              )}
            </section>
          )}

          {mode === "edit" && initialEvent && (published || canDeleteEvent || canArchiveEvent) && (
            <DangerZone className="event-delete-panel" heading="Unpublish, archive or delete this event">
              {published && (
                <DangerZoneItem title="Unpublish this event">
                  <p className="danger-zone-consequence">Closes public registration now. You can publish again later.</p>
                  <details className="danger-zone-details">
                    <summary>More detail</summary>
                    <p>Closes every public registration form for {initialEvent.name} immediately. Registrations already taken are kept, and you can publish again later.</p>
                  </details>
                  <button className="secondary-button full-button" disabled={unpublishing} onClick={openUnpublishDialog} type="button">
                    {unpublishing ? "Unpublishing…" : "Unpublish event…"}
                  </button>
                </DangerZoneItem>
              )}
              {canArchiveEvent && (
                <DangerZoneItem title={initialEvent.archivedAt ? "Unarchive this event" : "Archive this event"}>
                  <p className="danger-zone-consequence">
                    {initialEvent.archivedAt
                      ? "Restores the event to pickers and the public site."
                      : "Hides the event and closes registration. Nothing is deleted."}
                  </p>
                  <details className="danger-zone-details">
                    <summary>More detail</summary>
                    <p>
                      {initialEvent.archivedAt
                        ? "This event is archived: hidden from pickers and the public site, with registration closed. Unarchiving restores it exactly."
                        : "Hides this event from pickers and the public site and closes registration, without deleting anything. Reports and exports still work from the Archived events list, and you can unarchive it later."}
                    </p>
                  </details>
                  <button className="secondary-button danger-outline-button full-button" onClick={() => setArchiveDialogOpen(true)} type="button">
                    {initialEvent.archivedAt ? "Unarchive event…" : "Archive event…"}
                  </button>
                </DangerZoneItem>
              )}
              {canDeleteEvent && (
                <DangerZoneItem title="Delete this event">
                  <p className="danger-zone-consequence">Permanent. Only possible while the event has no registrations or other records.</p>
                  <details className="danger-zone-details">
                    <summary>More detail</summary>
                    <p>Only a system administrator can delete an event, and only one with no registrations, payments, imports, form submissions or other records attached. Otherwise the dialog explains why, and unpublishing is the way to retire it.</p>
                  </details>
                  <button className="secondary-button danger-outline-button danger-outline-strong full-button" onClick={() => setDeleteDialogOpen(true)} type="button">
                    Delete event…
                  </button>
                </DangerZoneItem>
              )}
            </DangerZone>
          )}

        </aside>
        <div className={`event-savebar${savebarPinned ? " is-pinned" : ""}`} role="region" aria-label="Save event settings">
          <p className="event-savebar-status" aria-live={saveMessage?.kind === "error" ? "assertive" : "polite"}>
            {saveMessage
              ? <span className={saveMessage.kind === "error" ? "event-savebar-error" : "event-savebar-ok"} >{saveMessage.text}</span>
              : saving
                ? "Saving…"
                : dirty
                  ? <span className="unsaved-dot">Changes not saved</span>
                  : mode === "create"
                    ? "No unsaved changes. Nothing is public when this draft is created."
                    : published ? "No unsaved changes. Saving never changes whether this event is published." : "No unsaved changes. Saving never publishes the event."}
          </p>
          <SubmitButton
            disabled={!dirty}
            icon={<Save size={16} aria-hidden="true" />}
            iconSize={16}
            id="event-save-button"
            label={mode === "create" ? "Create event draft" : "Save event settings"}
            submitting={saving}
            submittingLabel="Saving…"
          />
        </div>
      </form>
      {mode === "edit" && initialEvent && (
        <EventLocationsPanel eventId={initialEvent.id} initialLocations={initialLocations ?? []} areaCoordinators={areaCoordinators ?? []} />
      )}
      {mode === "edit" && (
        <PublishEventDialog
          busy={publishing}
          eventName={initialEvent?.name ?? draft.name}
          error={publishError}
          warnings={publishWarnings}
          onCancel={cancelPublish}
          onConfirm={() => void publish()}
          open={publishDialogOpen}
        />
      )}
      {mode === "edit" && initialEvent && canArchiveEvent && (
        <ArchiveEventDialog
          archived={Boolean(initialEvent.archivedAt)}
          eventId={initialEvent.id}
          eventName={initialEvent.name}
          onCancel={() => setArchiveDialogOpen(false)}
          open={archiveDialogOpen}
        />
      )}
      {mode === "edit" && initialEvent && canDeleteEvent && (
        <DeleteEventDialog
          eventId={initialEvent.id}
          onCancel={() => setDeleteDialogOpen(false)}
          open={deleteDialogOpen}
        />
      )}
      {mode === "edit" && (
        <UnpublishEventDialog
          busy={unpublishing}
          eventName={initialEvent?.name ?? draft.name}
          error={unpublishError}
          onCancel={cancelUnpublish}
          onConfirm={() => void unpublish()}
          open={unpublishDialogOpen}
        />
      )}
    </section>
  );
}
