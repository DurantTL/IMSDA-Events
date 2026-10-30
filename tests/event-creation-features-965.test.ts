import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The "Which features does this event use?" step of event creation (#965): the
 * defaults from the audience and the template, what a copy carries, the request
 * the step sends, and the atomic, repeatable write of the chosen modules.
 * Synthetic data only.
 */
const mocks = vi.hoisted(() => ({
  rejectCrossOriginRequest: vi.fn(),
  getCurrentSession: vi.fn(),
  createEvent: vi.fn(),
  applyEventTemplate: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: unknown }) => createElement("a", { href }, children as never),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/events/repository", async () => {
  const actual = await vi.importActual<typeof import("@/modules/events/repository")>("@/modules/events/repository");
  return { ...actual, createEvent: mocks.createEvent, listEventsForUser: vi.fn() };
});

vi.mock("@/modules/event-templates/repository", async () => {
  const actual = await vi.importActual<typeof import("@/modules/event-templates/repository")>("@/modules/event-templates/repository");
  return { ...actual, applyEventTemplate: mocks.applyEventTemplate };
});

import { POST as CREATE } from "@/app/api/events/route";
import { POST as APPLY } from "@/app/api/event-templates/[templateId]/apply/route";
import { CreationFeaturesStep } from "@/components/creation-features-step";
import { StartFromTemplate } from "@/components/start-from-template";
import { applyEventTemplateInputSchema } from "@/modules/event-templates/domain";
import { templateFeatureDefaults } from "@/modules/event-templates/feature-defaults";
import type { EventTemplateRecord } from "@/modules/event-templates/repository";
import {
  chosenModulesAfter,
  cloneCreationFeatures,
  creationFeatureItems,
  creationFeaturesFor,
  creationFeaturesSchema,
  defaultCreationFeatures,
  featuresForAudience,
  withFlag,
  withModule,
} from "@/modules/event-features/creation";
import { creationModuleKeys, defaultModuleKeys } from "@/modules/event-modules/catalog";
import { writeCreationModules } from "@/modules/event-modules/defaults";

const admin = { user: { id: "admin-1", globalRole: "SYSTEM_ADMIN" } };
const settings = {
  name: "Synthetic Retreat",
  slug: "synthetic-retreat",
  startsOn: "2027-10-09",
  endsOn: "2027-10-11",
  timezone: "America/Chicago",
  location: "Camp Example",
  publicInfoUrl: null,
  supportContact: null,
  collectsShirtSizes: false,
  registrationOpensOn: null,
  registrationClosesOn: null,
  waitlistEnabled: false,
  autoPromoteWaitlist: false,
  capacity: null,
};
const post = (body: unknown) => new Request("https://events.imsda.test/api/events", {
  method: "POST",
  headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
  body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.getCurrentSession.mockResolvedValue(admin);
  mocks.createEvent.mockResolvedValue({ id: "event-1" });
  mocks.applyEventTemplate.mockResolvedValue({ event: { id: "event-1" }, alreadyApplied: false });
});

describe("defaults come from the audience and the template", () => {
  it("starts a general event with public content only, every flag off and the calendar on", () => {
    expect(defaultCreationFeatures("GENERAL")).toEqual({
      modules: ["public-content"], showOnCalendar: true,
      waitlistEnabled: false, autoPromoteWaitlist: false, collectsShirtSizes: false, hostedPaymentLinkEnabled: false, checksAdultBackgrounds: false,
    });
  });

  it("starts a club event with the club modules too, exactly the server's defaults", () => {
    expect(defaultCreationFeatures("CLUB").modules).toEqual(defaultModuleKeys("CLUB"));
    expect(defaultModuleKeys("CLUB")).toEqual(expect.arrayContaining(["honors", "event-patches", "club-assignments", "public-content"]));
  });

  it("carries a template's flags, and never automatic promotion without the waitlist", () => {
    expect(defaultCreationFeatures("GENERAL", { waitlistEnabled: true, autoPromoteWaitlist: true, collectsShirtSizes: true })).toMatchObject({ waitlistEnabled: true, autoPromoteWaitlist: true, collectsShirtSizes: true });
    expect(defaultCreationFeatures("GENERAL", { waitlistEnabled: false, autoPromoteWaitlist: true }).autoPromoteWaitlist).toBe(false);
  });

  it("reads a published template's audience and flags, and nothing from a draft or a broken payload", () => {
    const payload = { audience: "CLUB", moduleEnablement: { waitlistEnabled: true, autoPromoteWaitlist: true, collectsShirtSizes: false, checksAdultBackgrounds: true, hostedPaymentLinkEnabled: false }, generalRegistrationLink: true };
    const defaults = templateFeatureDefaults({ versions: [{ status: "PUBLISHED", payload }] });
    expect(defaults).toMatchObject({ audience: "CLUB", carriesGeneralLink: true, carriesTeams: false });
    expect(defaults?.features).toMatchObject({ waitlistEnabled: true, autoPromoteWaitlist: true, checksAdultBackgrounds: true, modules: defaultModuleKeys("CLUB") });
    expect(templateFeatureDefaults({ versions: [{ status: "DRAFT", payload }] })).toBeNull();
    expect(templateFeatureDefaults({ versions: [{ status: "PUBLISHED", payload: { audience: "NOPE" } }] })).toBeNull();
  });

  it("shows a copy the settings it carries, following the What to copy choices", () => {
    const source = {
      audience: "CLUB" as const,
      sourceModules: ["honors" as const, "merchandise" as const],
      flags: { waitlistEnabled: true, autoPromoteWaitlist: true, collectsShirtSizes: true, hostedPaymentLinkEnabled: false, checksAdultBackgrounds: false },
      showOnCalendar: false,
    };
    const all = cloneCreationFeatures(source, { eventDetails: true, moduleToggles: true });
    expect(all.audience).toBe("CLUB");
    expect(all.features).toMatchObject({ modules: ["honors", "merchandise"], waitlistEnabled: true, autoPromoteWaitlist: true, collectsShirtSizes: true, showOnCalendar: false });
    // Without the event details the audience is general, the copy gets the defaults, and the calendar stays on.
    const noDetails = cloneCreationFeatures(source, { eventDetails: false, moduleToggles: true });
    expect(noDetails).toMatchObject({ audience: "GENERAL", features: { modules: ["public-content"], showOnCalendar: true, waitlistEnabled: true } });
    // Without the module toggles every flag is off.
    expect(cloneCreationFeatures(source, { eventDetails: true, moduleToggles: false }).features).toMatchObject({ waitlistEnabled: false, collectsShirtSizes: false, modules: ["honors", "merchandise"] });
    // A source with no module rows gets its audience's defaults, as the copy does.
    expect(cloneCreationFeatures({ ...source, sourceModules: [] }, { eventDetails: true, moduleToggles: true }).features.modules).toEqual(defaultModuleKeys("CLUB"));
  });
});

describe("the switches the step offers", () => {
  it("offers club modules only to a club event, and always lists public content as locked on", () => {
    const general = creationFeatureItems("GENERAL", defaultCreationFeatures("GENERAL"));
    expect(general.filter((item) => item.kind === "module").map((item) => item.key)).toEqual(["seminar-assignments", "merchandise", "attendee-community", "public-content", "emergency-plans"]);
    expect(general.find((item) => item.key === "public-content")).toMatchObject({ on: true, locked: true });
    const club = creationFeatureItems("CLUB", defaultCreationFeatures("CLUB"));
    expect(club.filter((item) => item.kind === "module").map((item) => item.key)).toEqual(expect.arrayContaining(["honors", "event-patches", "club-assignments"]));
  });

  it("changes a module without losing the always-on one, and keeps the catalog's order", () => {
    const withMerch = withModule(defaultCreationFeatures("GENERAL"), "merchandise", true);
    expect(withMerch.modules).toEqual(["merchandise", "public-content"]);
    expect(withModule(withMerch, "public-content", false).modules).toEqual(["merchandise", "public-content"]);
    expect(withModule(withMerch, "merchandise", false).modules).toEqual(["public-content"]);
  });

  it("turns automatic promotion off with the waitlist, and locks it until the waitlist is on", () => {
    const waitlist = withFlag(defaultCreationFeatures("GENERAL"), "waitlistEnabled", true);
    const promoted = withFlag(waitlist, "autoPromoteWaitlist", true);
    expect(withFlag(promoted, "waitlistEnabled", false)).toMatchObject({ waitlistEnabled: false, autoPromoteWaitlist: false });
    expect(creationFeatureItems("GENERAL", defaultCreationFeatures("GENERAL")).find((item) => item.key === "autoPromoteWaitlist")?.locked).toBe(true);
    expect(creationFeatureItems("GENERAL", waitlist).find((item) => item.key === "autoPromoteWaitlist")?.locked).toBe(false);
  });

  it("follows a change of audience before the step is touched", () => {
    expect(featuresForAudience(defaultCreationFeatures("GENERAL", { collectsShirtSizes: true }), "CLUB")).toMatchObject({ modules: defaultModuleKeys("CLUB"), collectsShirtSizes: true });
  });

  it("renders as a skippable, collapsed step on the blank form, and read only on a copy", () => {
    const features = defaultCreationFeatures("CLUB");
    const collapsed = renderToStaticMarkup(createElement(CreationFeaturesStep, { audience: "CLUB", features, collapsible: true, onChange: () => undefined }));
    expect(collapsed).toMatch(/<details class="panel creation-features-step"(?! open)/);
    expect(collapsed).toContain("Which features does this event use?");
    expect(collapsed).toContain("Leave this step as it is to use these defaults");
    expect(collapsed).toContain("General registration link");
    const readOnly = renderToStaticMarkup(createElement(CreationFeaturesStep, { audience: "GENERAL", features: defaultCreationFeatures("GENERAL"), readOnly: true }));
    expect(readOnly).not.toMatch(/<input(?![^>]*disabled)[^>]*type="checkbox"/);
    expect(readOnly).not.toContain("General registration link");
  });

  it("shows a template's own settings in the template flow", () => {
    const template = {
      id: "tpl-1", name: "Synthetic Template", description: "", audience: "GENERAL", status: "PUBLISHED", canApply: true,
      createdBy: "Synthetic Admin", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
      versions: [],
    } as unknown as EventTemplateRecord;
    const features = defaultCreationFeatures("GENERAL", { waitlistEnabled: true, collectsShirtSizes: true });
    const markup = renderToStaticMarkup(createElement(StartFromTemplate, {
      templates: [template],
      featureDefaults: { "tpl-1": { audience: "GENERAL", features, carriesGeneralLink: false, carriesTeams: false } },
    }));
    expect(markup).toContain("Which features does this event use?");
    expect(markup).toContain("These are the settings Synthetic Template carries");
    expect(markup).toMatch(/id="creation-feature-flag-waitlistEnabled"[^>]*checked/);
    expect(markup).toMatch(/id="creation-feature-flag-collectsShirtSizes"[^>]*checked/);
    expect(markup).not.toMatch(/id="creation-feature-flag-hostedPaymentLinkEnabled"[^>]*checked/);
  });
});

describe("POST /api/events with the features step", () => {
  it("passes the chosen modules and calendar choice to the creation", async () => {
    const response = await CREATE(post({ ...settings, features: { modules: ["merchandise", "public-content"], showOnCalendar: false } }));
    expect(response.status).toBe(201);
    expect(mocks.createEvent).toHaveBeenCalledWith(expect.objectContaining({ name: "Synthetic Retreat" }), "admin-1", { modules: ["merchandise", "public-content"], showOnCalendar: false });
  });

  it("keeps the calendar item and the features together", async () => {
    await CREATE(post({ ...settings, calendarEntryId: "entry-1", features: { modules: ["merchandise"] } }));
    expect(mocks.createEvent).toHaveBeenCalledWith(expect.anything(), "admin-1", { calendarEntryId: "entry-1", modules: ["merchandise"] });
  });

  it("is unchanged when the step is skipped", async () => {
    await CREATE(post(settings));
    expect(mocks.createEvent).toHaveBeenCalledWith(expect.anything(), "admin-1");
  });

  it("refuses an unknown module or an unknown key, creating nothing", async () => {
    const unknownModule = await CREATE(post({ ...settings, features: { modules: ["not-a-module"] } }));
    expect(unknownModule.status).toBe(400);
    const unknownKey = await CREATE(post({ ...settings, features: { modules: [], isAdmin: true } }));
    expect(unknownKey.status).toBe(400);
    expect(mocks.createEvent).not.toHaveBeenCalled();
  });

  it("is refused to anyone who is not a system administrator, so the step never widens who can turn modules on", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "staff-1", globalRole: null } });
    expect((await CREATE(post({ ...settings, features: { modules: ["merchandise"] } }))).status).toBe(403);
    expect(mocks.createEvent).not.toHaveBeenCalled();
  });

  it("validates the schema the form and the route share", () => {
    expect(creationFeaturesSchema.parse({})).toEqual({});
    expect(creationFeaturesSchema.safeParse({ modules: ["honors"], showOnCalendar: true }).success).toBe(true);
    expect(creationFeaturesSchema.safeParse({ modules: "honors" }).success).toBe(false);
  });
});

describe("the template apply accepts the step's choices", () => {
  const body = { name: "Synthetic Retreat", slug: "synthetic-retreat", startsOn: "2027-10-09", endsOn: "2027-10-11", requestKey: "request-key-0001" };

  it("takes optional modules, calendar choice and flag overrides, and nothing else", () => {
    expect(applyEventTemplateInputSchema.parse(body).features).toBeUndefined();
    const parsed = applyEventTemplateInputSchema.parse({ ...body, features: { modules: ["merchandise"], showOnCalendar: false, waitlistEnabled: true } });
    expect(parsed.features).toEqual({ modules: ["merchandise"], showOnCalendar: false, waitlistEnabled: true });
    expect(applyEventTemplateInputSchema.safeParse({ ...body, features: { modules: ["nope"] } }).success).toBe(false);
    expect(applyEventTemplateInputSchema.safeParse({ ...body, features: { isPublished: true } }).success).toBe(false);
  });
});

describe("the blank form's module choice", () => {
  const readSource = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

  /** The form's state: what the person chose (null = follows the audience) and the flags in the draft. */
  function form(audience: "GENERAL" | "CLUB", chosen: ReturnType<typeof defaultCreationFeatures>["modules"] | null, carried = {}) {
    return creationFeaturesFor(audience, chosen, defaultCreationFeatures(audience, carried));
  }

  it("shows the audience's defaults with the step open and nothing touched", () => {
    expect(form("GENERAL", null).modules).toEqual(["public-content"]);
    expect(form("CLUB", null).modules).toEqual(defaultModuleKeys("CLUB"));
  });

  it("a flag change does not pin the modules, so the club defaults still follow a later switch to CLUB", () => {
    const general = form("GENERAL", null);
    const afterFlag = withFlag(general, "collectsShirtSizes", true);
    // Opening the step and ticking a flag leaves the choice unset ...
    let chosen = chosenModulesAfter(null, general, afterFlag);
    expect(chosen).toBeNull();
    // ... and so does the calendar choice.
    chosen = chosenModulesAfter(chosen, afterFlag, { ...afterFlag, showOnCalendar: false });
    expect(chosen).toBeNull();
    // Switching the audience to CLUB: the club defaults are present, and the flag the person set stays.
    const club = form("CLUB", chosen, { collectsShirtSizes: true });
    expect(club.modules).toEqual(defaultModuleKeys("CLUB"));
    expect(club.modules).toEqual(expect.arrayContaining(["honors", "event-patches", "club-assignments"]));
    expect(club.collectsShirtSizes).toBe(true);
  });

  it("a module checkbox pins the choice, and a switch of audience puts the new audience's defaults back", () => {
    const general = form("GENERAL", null);
    const withMerch = withModule(general, "merchandise", true);
    const chosen = chosenModulesAfter(null, general, withMerch);
    expect(chosen).toEqual(["merchandise", "public-content"]);
    expect(form("GENERAL", chosen).modules).toEqual(["merchandise", "public-content"]);
    // The form resets the choice when the audience changes, so the club defaults follow (featuresForAudience).
    expect(form("CLUB", null).modules).toEqual(defaultModuleKeys("CLUB"));
    expect(featuresForAudience(withMerch, "CLUB").modules).toEqual(defaultModuleKeys("CLUB"));
  });

  it("is wired into the form: choices only from a module checkbox, audience change resets", () => {
    const source = readSource("components/event-settings-workspace.tsx");
    expect(source).toContain("chosenModulesAfter(chosenModules, creationFeatures, next)");
    expect(source).toContain("creationFeaturesFor(");
    expect(source).toMatch(/update\("audience", value as EventSettingsInput\["audience"\]\);[\s\S]{0,260}setChosenModules\(null\)/);
  });
});

describe("a template applied with features by someone who is not a system administrator", () => {
  const body = { name: "Synthetic Retreat", slug: "synthetic-retreat", startsOn: "2027-10-09", endsOn: "2027-10-11", requestKey: "request-key-0001", features: { modules: ["merchandise"], showOnCalendar: false } };
  const apply = (session: unknown) => {
    mocks.getCurrentSession.mockResolvedValue(session);
    return APPLY(post(body), { params: Promise.resolve({ templateId: "template-1" }) });
  };

  it("gets 403 and nothing is applied", async () => {
    expect((await apply({ user: { id: "staff-1", globalRole: null } })).status).toBe(403);
    expect((await apply({ user: { id: "staff-2", globalRole: "STAFF" } })).status).toBe(403);
    expect((await apply({ user: null })).status).toBeGreaterThanOrEqual(401);
    expect(mocks.applyEventTemplate).not.toHaveBeenCalled();
  });

  it("is applied for a system administrator, with the features passed through", async () => {
    expect((await apply(admin)).status).toBe(201);
    expect(mocks.applyEventTemplate).toHaveBeenCalledWith("template-1", "admin-1", expect.objectContaining({ features: { modules: ["merchandise"], showOnCalendar: false } }));
  });
});

describe("the chosen modules are written in the creating transaction", () => {
  function fakeTx() {
    const rows: Array<{ eventId: string; moduleKey: string }> = [];
    const createMany = vi.fn(async ({ data, skipDuplicates }: { data: Array<{ eventId: string; moduleKey: string }>; skipDuplicates?: boolean }) => {
      let count = 0;
      for (const row of data) {
        if (skipDuplicates && rows.some((existing) => existing.eventId === row.eventId && existing.moduleKey === row.moduleKey)) continue;
        rows.push(row);
        count += 1;
      }
      return { count };
    });
    return { rows, createMany, tx: { eventModule: { createMany } } as never };
  }

  it("writes the audience's defaults when the step was skipped", async () => {
    const { rows, tx } = fakeTx();
    await writeCreationModules(tx, "event-1", "CLUB", undefined);
    expect(rows.map((row) => row.moduleKey).sort()).toEqual([...defaultModuleKeys("CLUB")].sort());
  });

  it("writes exactly the chosen modules plus the always-on one", async () => {
    const { rows, tx } = fakeTx();
    await writeCreationModules(tx, "event-1", "GENERAL", ["merchandise", "attendee-community"]);
    expect(rows.map((row) => row.moduleKey).sort()).toEqual(["attendee-community", "merchandise", "public-content"]);
  });

  it("drops a club module asked for on a general event instead of storing a row nothing reads", () => {
    expect(creationModuleKeys("GENERAL", ["honors", "event-patches", "merchandise"])).toEqual(["merchandise", "public-content"]);
    expect(creationModuleKeys("CLUB", ["honors"])).toEqual(["honors", "public-content"]);
  });

  it("is safe to repeat: a second write changes nothing", async () => {
    const { rows, createMany, tx } = fakeTx();
    await writeCreationModules(tx, "event-1", "GENERAL", ["merchandise"]);
    const first = rows.length;
    await writeCreationModules(tx, "event-1", "GENERAL", ["merchandise"]);
    expect(rows).toHaveLength(first);
    expect(createMany).toHaveBeenLastCalledWith(expect.objectContaining({ skipDuplicates: true }));
  });

  it("collapses duplicates in the request", () => {
    expect(creationModuleKeys("GENERAL", ["merchandise", "merchandise"])).toEqual(["merchandise", "public-content"]);
  });
});
