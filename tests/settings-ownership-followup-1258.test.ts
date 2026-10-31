import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/more/event-settings",
}));
vi.mock("server-only", () => ({}));

import { EnvironmentStatusPanel } from "@/components/environment-status-panel";
import { EventSettingsWorkspace } from "@/components/event-settings-workspace";
import { createLinkNavigationListener } from "@/components/link-guard";
import { classifySettingsSaveFailure, permissionRevokedMessages, settingsSaveState } from "@/components/settings-save-state";
import { registerUnsavedChanges, guardedNavigate } from "@/components/unsaved-changes-registry";
import { switchEvent } from "@/components/shell-event-selection";
import { getEventPublishReadiness } from "@/modules/events/readiness";
import type { EventSettingsRecord } from "@/modules/events/repository";
import {
  attendeeEditPolicyOwnership,
  emailDisplayNameOwnership,
  emailReplyToOwnership,
  timezoneOwnership,
  type EventEmailSender,
} from "@/modules/events/settings-ownership";
import { buildEnvironmentStatus, getEnvironmentStatusForViewer } from "@/modules/system-admin/environment-status";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const defaults = { defaultTimezone: "America/Chicago", defaultAttendeeEditPolicy: "VERIFY_EVERY_EDIT" as const };

describe("event settings ownership labels (#1258)", () => {
  it("says only what can be checked: same as the platform default, or different from it", () => {
    expect(timezoneOwnership("America/Chicago", defaults)).toMatchObject({ source: "central", label: "Same as central" });
    expect(timezoneOwnership("America/Chicago", defaults).detail).toContain("Same as the platform default (America/Chicago)");
    expect(timezoneOwnership("America/Denver", defaults)).toMatchObject({ source: "override", label: "Event override" });
    expect(timezoneOwnership("America/Denver", defaults).detail).toContain("Differs from the platform default (America/Chicago)");
    expect(attendeeEditPolicyOwnership("VERIFY_EVERY_EDIT", defaults).source).toBe("central");
    expect(attendeeEditPolicyOwnership("TIERED", defaults).source).toBe("override");
    // No claim about when or how the value was set.
    for (const text of [timezoneOwnership("America/Denver", defaults).detail, timezoneOwnership("America/Chicago", defaults).detail]) {
      expect(text).not.toMatch(/copied|created|its own timezone/i);
    }
  });

  it("follows the platform default, so changing the default changes the label", () => {
    expect(timezoneOwnership("America/Chicago", { ...defaults, defaultTimezone: "America/Denver" }).source).toBe("override");
    expect(attendeeEditPolicyOwnership("TIERED", { ...defaults, defaultAttendeeEditPolicy: "TIERED" }).source).toBe("central");
  });

  it("labels the email display name and reply-to by comparison with the central sender", () => {
    const central: EventEmailSender["central"] = { name: "IMSDA Events", replyTo: "reply@example.test" };
    const inherit: EventEmailSender = { senderName: "IMSDA Events", replyToOverride: null, central };
    expect(emailDisplayNameOwnership(inherit).source).toBe("central");
    expect(emailReplyToOwnership(inherit)).toMatchObject({ source: "central" });
    expect(emailReplyToOwnership(inherit).detail).toContain("reply@example.test");
    const own: EventEmailSender = { senderName: "Synthetic Women's Retreat", replyToOverride: "retreat@example.test", central };
    expect(emailDisplayNameOwnership(own)).toMatchObject({ source: "override" });
    expect(emailDisplayNameOwnership(own).detail).toContain("Differs from the central sender name (IMSDA Events)");
    expect(emailReplyToOwnership(own)).toMatchObject({ source: "override" });
    expect(emailReplyToOwnership(own).detail).toContain("retreat@example.test");
    // A reply-to equal to the central one is not an override.
    expect(emailReplyToOwnership({ ...own, replyToOverride: "reply@example.test" }).source).toBe("central");
    // Renaming the central sender makes a stored copy differ; the wording claims only the difference.
    expect(emailDisplayNameOwnership({ ...inherit, central: { ...central, name: "Renamed Sender" } }).detail).not.toMatch(/overrid|chose|set/i);
  });

  it("says so when there is no reply-to anywhere", () => {
    const none: EventEmailSender = { senderName: "IMSDA Events", replyToOverride: "  ", central: { name: "IMSDA Events", replyTo: null } };
    expect(emailReplyToOwnership(none).detail).toContain("central From address");
  });

  const baseFields = {
    id: "event-1", name: "Synthetic Retreat", slug: "synthetic-retreat", startsOn: "2027-10-08", endsOn: "2027-10-10",
    timezone: "America/Denver", location: "Camp Heritage", capacity: 350, publicInfoUrl: null, supportContact: "registration@imsda.org",
    tagline: null, subtitle: null, helpEmail: null, hubTitle: null, hubIntro: null, refundPolicy: null,
    hotelName: null, hotelBookingUrl: null, hotelPhone: null, hotelGroupName: null, hotelRate: null, hotelInstructions: null,
    approvedPaymentInstructions: null, isPublished: false, archivedAt: null, showOnCalendar: true,
    registrationOpensOn: "2027-05-01", registrationClosesOn: "2027-10-01", paymentDueOn: null, waitlistEnabled: false,
    collectsShirtSizes: false, checksAdultBackgrounds: false, hostedPaymentLinkEnabled: false,
    attendeeEditPolicy: "VERIFY_EVERY_EDIT" as const, billingMode: "ATTENDEE_PAY" as const, audience: "GENERAL" as const,
    seminarPreferenceClosesOn: null, seminarPreferenceSelfServiceLocked: false, autoPromoteWaitlist: false,
    featured: false, featuredOrder: null, featureUntil: null, publishedFormCount: 0, publishedForms: [], attendeeTypesWithAgeRangeCount: 1, attendeeTypeNames: ["Adult"], centralSenderEmail: "events@example.test", hasCancellationPolicy: true,
    createdAt: "2027-01-01T00:00:00.000Z", updatedAt: "2027-01-01T00:00:00.000Z",
  };
  const event: EventSettingsRecord = { ...baseFields, readiness: getEventPublishReadiness(baseFields, 0), warnings: [] };

  it("renders each label from the event's real values beside the field", () => {
    const markup = renderToStaticMarkup(createElement(EventSettingsWorkspace, {
      mode: "edit",
      initialEvent: event,
      platformDefaults: defaults,
      emailSender: { senderName: "Synthetic Retreat Team", replyToOverride: null, central: { name: "IMSDA Events", replyTo: null } },
    }));
    // Timezone differs from the platform default (Chicago), edit verification matches it.
    expect(markup).toMatch(/data-ownership="override"[^>]*><strong>Event override\.<\/strong> Differs from the platform default/);
    expect(markup).toMatch(/data-ownership="central"[^>]*><strong>Same as central\.<\/strong> Same as the platform default/);
    expect(markup).toMatch(/Email display name<\/span>[\s\S]*?data-ownership="override"/);
    expect(markup).toMatch(/Reply-to<\/span>[\s\S]*?data-ownership="central"/);
  });

  it("shows no labels when the page has no data for them, and none while creating", () => {
    expect(renderToStaticMarkup(createElement(EventSettingsWorkspace, { mode: "edit", initialEvent: event }))).not.toContain("settings-ownership-note");
    expect(renderToStaticMarkup(createElement(EventSettingsWorkspace, { mode: "create", initialEvent: null, platformDefaults: defaults }))).not.toContain("settings-ownership-note");
  });
});

describe("settings save states (#1258)", () => {
  it("uses one vocabulary: Saving, Conflict, Failed, Saved, Unsaved, in that order of priority", () => {
    expect(settingsSaveState({ saving: true, dirty: true, outcome: "failed" })).toEqual({ state: "saving", label: "Saving…" });
    expect(settingsSaveState({ saving: false, dirty: true, outcome: "conflict" }).label).toBe("Conflict: not saved");
    expect(settingsSaveState({ saving: false, dirty: true, outcome: "failed" }).label).toBe("Failed: not saved");
    expect(settingsSaveState({ saving: false, dirty: false, outcome: "saved" }).label).toBe("Saved");
    // An edit after a save is Unsaved, not Saved.
    expect(settingsSaveState({ saving: false, dirty: true, outcome: "saved" }).label).toBe("Unsaved changes");
    expect(settingsSaveState({ saving: false, dirty: true, outcome: null }).label).toBe("Unsaved changes");
    expect(settingsSaveState({ saving: false, dirty: false, outcome: null, cleanLabel: "No unsaved changes" }).label).toBe("No unsaved changes");
    expect(settingsSaveState({ saving: false, dirty: false, outcome: null }).label).toBe("");
  });

  it("maps the Event route's 409 EVENT_CHANGED to Conflict and other failures to Failed, keeping the edits", () => {
    const conflict = classifySettingsSaveFailure({ scope: "event", status: 409, code: "EVENT_CHANGED", message: "Dates changed.", conflictCodes: ["EVENT_CHANGED"], fallback: "x" });
    expect(conflict.kind).toBe("conflict");
    expect(conflict.message).toContain("Your edits are still here");
    expect(classifySettingsSaveFailure({ scope: "event", status: 409, code: "EVENT_SLUG_TAKEN", message: "Taken.", conflictCodes: ["EVENT_CHANGED"], fallback: "x" }).kind).toBe("failed");
    expect(classifySettingsSaveFailure({ scope: "event", status: 500, message: undefined, fallback: "The event could not be saved." })).toEqual({ kind: "failed", message: "The event could not be saved." });
  });

  it("explains a permission revoked mid-edit (403) the same way on both pages, and the forms keep their edits", () => {
    for (const scope of ["event", "platform"] as const) {
      const failure = classifySettingsSaveFailure({ scope, status: 403, code: "FORBIDDEN", message: "Forbidden", fallback: "x" });
      expect(failure).toEqual({ kind: "permission", message: permissionRevokedMessages[scope] });
      expect(failure.message).toContain("Your edits are still here");
      expect(failure.message).toContain("nothing was saved");
    }
    // Structural: a failed save never resets the draft in either workspace.
    const event = read("components/event-settings-workspace.tsx");
    const failedBranch = event.slice(event.indexOf("classifySettingsSaveFailure({"), event.indexOf("if (mode === \"create\") {"));
    expect(failedBranch).toContain("return;");
    expect(failedBranch).not.toContain("setDraft(");
    const platform = read("components/platform-settings-workspace.tsx");
    const permissionBranch = platform.slice(platform.indexOf('failure.kind === "permission"'), platform.indexOf("const invalid:"));
    expect(permissionBranch).not.toContain("setDraft(");
  });

  it("wires both workspaces to the shared state and keeps Event's existing save contract", () => {
    expect(read("components/event-settings-workspace.tsx")).toContain("settingsSaveState({");
    expect(read("components/event-settings-workspace.tsx")).toContain('conflictCodes: eventConflictCodes');
    expect(read("components/platform-settings-workspace.tsx")).toContain("settingsSaveState({");
    // Labels compare the saved event, not the live draft.
    expect(read("components/event-settings-workspace.tsx")).toContain("timezoneOwnership(savedDraft.timezone");
    expect(read("components/event-settings-workspace.tsx")).toContain("attendeeEditPolicyOwnership(savedDraft.attendeeEditPolicy");
    expect(read("components/platform-settings-workspace.tsx")).toContain("<summary>Advanced settings</summary>");
    // The conflict code is the one the route really answers with.
    expect(read("modules/events/repository.ts")).toContain('"EVENT_CHANGED"');
    expect(read("app/api/events/[eventId]/route.ts")).toContain('error.code === "EVENT_NOT_FOUND" ? 404 : 409');
  });
});

describe("environment-managed provider status (#1258)", () => {
  const secrets = {
    RESEND_API_KEY: "re_SECRET_VALUE_1", SQUARE_ACCESS_TOKEN: "sq-SECRET-TOKEN-2", SQUARE_APPLICATION_ID: "sandbox-sq-app-3",
    SQUARE_LOCATION_ID: "LOC-4", SQUARE_WEBHOOK_SIGNATURE_KEY: "sig-SECRET-5", GOOGLE_OAUTH_CLIENT_SECRET: "g-SECRET-6",
    GOOGLE_OAUTH_CLIENT_ID: "g-id-7", ALERT_WEBHOOK_URL: "https://hooks.example.test/SECRET8", OUTBOX_SWEEP_TOKEN: "sweep-SECRET-9",
    ACCOUNT_EMAIL_SENDER_ADDRESS: "accounts@example.test",
  };
  const readers = { emailAvailability: () => ({ deliveryConfigured: true, webhookConfigured: false }), encryptionKey: () => ({ configured: true }) };

  it("reports configured, not configured and unknown without any value", () => {
    const status = buildEnvironmentStatus(secrets, readers);
    const byId = Object.fromEntries(status.services.map((service) => [service.id, service]));
    expect(byId["email-provider"].status).toBe("configured");
    expect(byId["email-reports"].status).toBe("not-configured");
    expect(byId.payments.status).toBe("configured");
    // APP_BASE_URL is not set here, so the app's own reader derives the localhost URL: the webhook URL is not "blank".
    expect(byId["payment-webhook"]).toMatchObject({ status: "configured", missing: [] });
    expect(byId["google-sign-in"].status).toBe("configured");
    expect(byId["encryption-key"].status).toBe("configured");
    const unreadable = buildEnvironmentStatus({}, { emailAvailability: () => { throw new Error("boom"); }, encryptionKey: () => { throw new Error("boom"); } });
    expect(unreadable.services.find((service) => service.id === "email-provider")?.status).toBe("unknown");
    expect(unreadable.services.find((service) => service.id === "encryption-key")?.status).toBe("unknown");
    expect(buildEnvironmentStatus({ EMAIL_PROVIDER: "sendgrid" }, readers).services[0].status).toBe("unknown");
  });

  it("never contains a secret value, only fixed keys, labels, statuses and variable names", () => {
    const status = buildEnvironmentStatus(secrets, readers);
    const json = JSON.stringify(status) + renderToStaticMarkup(createElement(EnvironmentStatusPanel, { status }));
    for (const value of Object.values(secrets)) expect(json).not.toContain(value);
    for (const service of status.services) expect(Object.keys(service).sort()).toEqual(["id", "label", "missing", "note", "status"]);
    // Blank variables are named so an administrator knows what to set, but nothing here is editable.
    const empty = renderToStaticMarkup(createElement(EnvironmentStatusPanel, { status: buildEnvironmentStatus({}, { ...readers, emailAvailability: () => ({ deliveryConfigured: false, webhookConfigured: false }) }) }));
    expect(empty).toContain("SQUARE_ACCESS_TOKEN");
    expect(empty).not.toMatch(/<input|<textarea|<select/);
  });

  it("judges Square by the payment module's rules: webhook secret alias, derived URL, production unlock", () => {
    const square = (extra: Record<string, string>) => {
      const status = buildEnvironmentStatus({ SQUARE_APPLICATION_ID: "sandbox-sq0idb-x", SQUARE_ACCESS_TOKEN: "tok", SQUARE_LOCATION_ID: "L1", ...extra }, readers);
      return { payments: status.services.find((s) => s.id === "payments")!, webhook: status.services.find((s) => s.id === "payment-webhook")! };
    };
    // No signature key under either name: not configured, and the alias is named.
    expect(square({}).webhook).toMatchObject({ status: "not-configured", missing: ["SQUARE_WEBHOOK_SIGNATURE_KEY (or SQUARE_WEBHOOK_SECRET)"] });
    // The SQUARE_WEBHOOK_SECRET alias counts, and the URL is derived from APP_BASE_URL.
    expect(square({ SQUARE_WEBHOOK_SECRET: "alias", APP_BASE_URL: "https://events.example.test" }).webhook).toMatchObject({ status: "configured", missing: [] });
    // An explicit URL is not required.
    expect(square({ SQUARE_WEBHOOK_SIGNATURE_KEY: "k" }).webhook.status).toBe("configured");
    // Production without the unlock is not configured, and says why without a value.
    const production = square({ SQUARE_ENVIRONMENT: "production", SQUARE_APPLICATION_ID: "sq0idp-x", SQUARE_WEBHOOK_SIGNATURE_KEY: "k" });
    expect(production.payments).toMatchObject({ status: "not-configured", missing: [], note: "Production is selected but not unlocked." });
    // Scenario B: a webhook key is set but Production is not unlocked, so the app refuses webhooks: not "configured".
    expect(production.webhook).toMatchObject({ status: "not-configured", missing: [], note: "Production is selected but not unlocked." });
    // Scenario A: credentials set, no webhook key: the app treats Square as off, so payments is not configured either.
    const noWebhook = square({});
    expect(noWebhook.payments).toMatchObject({ status: "not-configured", missing: [], note: "Card payments stay off until the Square webhook is set." });
    expect(noWebhook.webhook.status).toBe("not-configured");
    // A malformed address is "not valid", not "blank".
    const badUrl = square({ SQUARE_WEBHOOK_SIGNATURE_KEY: "k", SQUARE_WEBHOOK_NOTIFICATION_URL: "", APP_BASE_URL: "not a url" });
    expect(badUrl.webhook).toMatchObject({ status: "not-configured", missing: [] });
    expect(badUrl.webhook.note).toContain("not valid");
    expect(square({ SQUARE_ENVIRONMENT: "production", SQUARE_APPLICATION_ID: "sq0idp-x", SQUARE_ENABLE_PRODUCTION: "true", SQUARE_WEBHOOK_SIGNATURE_KEY: "k" }).payments.status).toBe("configured");
    // Blank credentials are named.
    const blank = buildEnvironmentStatus({}, readers).services.find((s) => s.id === "payments")!;
    expect(blank.missing).toEqual(["SQUARE_APPLICATION_ID", "SQUARE_ACCESS_TOKEN", "SQUARE_LOCATION_ID"]);
    expect(blank.status).toBe("not-configured");
  });

  it("is only computed for a system administrator", () => {
    expect(getEnvironmentStatusForViewer({ globalRole: "SYSTEM_ADMIN" })?.services.length).toBeGreaterThan(0);
    for (const role of ["EVENT_ADMIN", "STAFF", null, undefined]) expect(getEnvironmentStatusForViewer({ globalRole: role })).toBeNull();
    expect(getEnvironmentStatusForViewer(null)).toBeNull();
    const page = read("app/(workspace)/admin/settings/page.tsx");
    expect(page).toContain('user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access")');
    expect(page).toContain("getEnvironmentStatusForViewer(user)");
  });

  it("keeps configuration apart from live health and manual readiness evidence", () => {
    const markup = renderToStaticMarkup(createElement(EnvironmentStatusPanel, { status: buildEnvironmentStatus({}, readers) }));
    expect(markup).toContain("Environment configuration");
    expect(markup).toContain('href="/admin#system-health"');
    expect(markup).toContain('href="/admin/readiness"');
    expect(markup).toContain("does not prove the service is working");
    expect(read("components/email-health-section.tsx")).toContain("Configuration in this environment");
    expect(read("components/email-health-section.tsx")).toContain("Live delivery health");
  });
});

describe("the Platform settings unsaved guard covers the event switcher and context switches (#1258)", () => {
  const message = "These platform settings have not been saved. Leave and discard the changes?";
  let unregister = () => {};
  afterEach(() => unregister());

  function run(confirmAnswer: boolean) {
    unregister = registerUnsavedChanges(message);
    const asked: string[] = [];
    const commit = vi.fn();
    const push = vi.fn();
    const navigated = switchEvent({
      eventId: "event-2", pathname: "/admin/settings", currentSearch: "event=event-1",
      guard: (go) => guardedNavigate(go, (text) => { asked.push(text); return confirmAnswer; }),
      commit, push,
    });
    return { asked, commit, push, navigated };
  }

  it("asks once with the platform message, and on Cancel keeps the event and the edits", () => {
    const result = run(false);
    expect(result.asked).toEqual([message]);
    expect(result.navigated).toBe(false);
    expect(result.commit).not.toHaveBeenCalled();
    expect(result.push).not.toHaveBeenCalled();
  });

  it("switches only after the person confirms", () => {
    const result = run(true);
    expect(result.commit).toHaveBeenCalledWith("event-2");
    expect(result.push).toHaveBeenCalledWith("/admin/settings?event=event-2");
  });

  it("stops a context or role switch link on Cancel, and lets it through on Yes", () => {
    const click = (answer: boolean) => {
      const preventDefault = vi.fn();
      const stopPropagation = vi.fn();
      const link = { target: "", href: "/admin-role/CLUBS", hasAttribute: () => false, getAttribute: () => "/admin-role/CLUBS" };
      createLinkNavigationListener({ message, confirm: () => answer, currentHref: () => "https://events.example.test/admin/settings", isAllowed: () => false })({
        button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false,
        target: { closest: () => link }, preventDefault, stopPropagation,
      });
      return preventDefault.mock.calls.length;
    };
    expect(click(false)).toBe(1);
    expect(click(true)).toBe(0);
  });

  it("is wired: the Platform form registers the guard and the shell's pickers and context links go through it", () => {
    expect(read("components/platform-settings-workspace.tsx")).toMatch(/useUnsavedChangesGuard\(dirty, "These platform settings have not been saved/);
    const shell = read("components/app-shell.tsx");
    expect(shell).toContain("guard: guardedNavigate");
    expect(shell.match(/onChange=\{\(event\) => selectEvent\(event\.target\.value\)\}/g)).toHaveLength(2);
    expect(shell).toContain('<GuardedLink className="work-context-return"');
    // The admin role pills are plain anchors, so the form hook's document-level click listener is what covers them.
    expect(read("components/admin-role-switcher.tsx")).toContain("<a");
    expect(read("components/use-unsaved-changes-guard.ts")).toContain('document.addEventListener("click", beforeLinkNavigation, true)');
  });
});

describe("Platform settings task grouping and Advanced section (#1258)", () => {
  const source = read("components/platform-settings-workspace.tsx");
  it("groups by task, with the technical passkey domain and environment status under an explicit Advanced disclosure", () => {
    for (const heading of ["Who this platform belongs to", "What a new event starts from", "Homepage help contact", "Invoice PDF header", "Technical settings"]) {
      expect(source).toContain(heading);
    }
    const advanced = source.slice(source.indexOf('className="panel platform-advanced"'));
    expect(advanced).toContain("<details");
    expect(advanced).toContain("Passkey domain");
    expect(advanced).toContain("<EnvironmentStatusPanel");
    // The passkey field is no longer in a top-level section.
    expect(source.slice(0, source.indexOf('className="panel platform-advanced"'))).not.toContain("Passkey domain\n");
  });

  it("opens Advanced by itself when its field is edited, fails or collides, so a problem is never hidden", () => {
    expect(source).toContain('if (key === "passkeyRpId") setAdvancedOpen(true);');
    expect(source).toContain('if (keys.includes("passkeyRpId")) setAdvancedOpen(true);');
    expect(source).toContain('result.fields.includes("passkeyRpId")');
  });
});

describe("risky one-click settings actions confirm first (#1258)", () => {
  it("asks before turning one sign-in off, and before the general registration link changes either way", () => {
    const platform = read("components/platform-settings-workspace.tsx");
    expect(platform).toContain('title: "Turn off one sign-in"');
    const link = read("components/event-general-link-panel.tsx");
    expect(link).toContain("await askConfirm(");
    expect(link.indexOf("await askConfirm(")).toBeLessThan(link.indexOf("setBusy(true)"));
    expect(link).toContain("{confirmDialog}");
  });
});

describe("styles (#1258)", () => {
  it("places the new rules before the builder blocks and adds no :hover after the #1139 marker", () => {
    const css = read("app/globals.css");
    const rules = css.indexOf("Settings ownership follow-up (#1258)");
    expect(rules).toBeGreaterThan(0);
    expect(rules).toBeLessThan(css.indexOf("/* Registration form builder editor shell (#1132)"));
    expect(css.slice(css.indexOf("/* Form settings tab")).match(/#1258/g)).toBeNull();
    const block = css.slice(rules, css.indexOf("/* Registration form builder editor shell (#1132)"));
    expect(block).not.toContain(":hover");
  });
});
