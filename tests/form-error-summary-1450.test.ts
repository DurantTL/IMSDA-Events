// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/account/profile",
}));

import { AttendeeProfileForm } from "@/components/attendee-profile-form";
import { ClubFormRosterAdd } from "@/components/club-form-roster-add";
import { ClubRosterWorkspace } from "@/components/club-roster-workspace";
import { InvitePerson } from "@/components/invite-person";
import { LoginForm } from "@/components/login-form";
import { NewClubApplicationForm } from "@/components/new-club-application-form";
import { errorSummaryHeading } from "@/components/form-error-summary";
import { PublicRegistrationForm } from "@/components/public-registration-form";
import { registrationFormDefinitionSchema } from "@/modules/forms/definition";
import { draftFromEvent, eventSettingsBadInputProblems, eventSettingsClientProblems } from "@/modules/events/settings-draft";
import { buttonByText, click, flush, mount, submitForm, typeInto, type Mounted } from "./helpers/dom-render";

/**
 * Rule 7 (#1450): after a failed submit every form shows one linked summary at the top, focus is on it, each item
 * links to a field that carries aria-invalid and points at its own message, and the browser's bubbles are off.
 * Synthetic values only.
 */

let mounted: Mounted | null = null;
afterEach(async () => { await mounted?.unmount(); mounted = null; });

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

function expectLinkedSummary(container: HTMLElement, expectedCount: number, heading: RegExp) {
  const summary = container.querySelector<HTMLElement>('.form-error-summary[role="alert"]');
  expect(summary, "summary shown").not.toBeNull();
  expect(summary!.getAttribute("tabindex")).toBe("-1");
  expect(document.activeElement).toBe(summary);
  expect(summary!.querySelector("strong")!.textContent!.trim()).toMatch(heading);
  const links = [...summary!.querySelectorAll<HTMLAnchorElement>("li a")];
  expect(links).toHaveLength(expectedCount);
  // One alert announces everything: the field messages are not alerts of their own.
  expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
  for (const link of links) {
    const id = link.getAttribute("href")!.slice(1);
    const target = document.getElementById(id);
    expect(target, `field #${id} exists`).not.toBeNull();
    // A group (radios, an access fieldset) carries the state on the linked control or on its enclosing fieldset.
    const carrier = [target!, target!.closest("fieldset")].find((node) => node?.getAttribute("aria-invalid") === "true") ?? target!;
    expect(carrier.getAttribute("aria-invalid")).toBe("true");
    const describedBy = (carrier.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
    const message = describedBy.map((ref) => document.getElementById(ref)).find((node) => node?.matches(".field-error-message"));
    expect(message, `field #${id} points at its message`).toBeTruthy();
    expect((message!.textContent ?? "").trim().length).toBeGreaterThan(0);
  }
  return { summary: summary!, links };
}

const summaryOf = (container: HTMLElement) => container.querySelector<HTMLElement>('.form-error-summary[role="alert"]');

function expectNoValidate(container: HTMLElement) {
  expect(container.querySelector("form")!.noValidate).toBe(true);
}

describe("summary heading", () => {
  it("counts the problems and names the action", () => {
    expect(errorSummaryHeading(1)).toBe("1 thing to fix before saving");
    expect(errorSummaryHeading(2, "submitting")).toBe("2 things to fix before submitting");
  });
});

describe("profile (/account/profile)", () => {
  it("replaces the second message under Save with the linked summary", async () => {
    const profile = {
      firstName: "Test", lastName: "Person", phone: "", mailingLine1: "", mailingLine2: "", mailingCity: "", mailingRegion: "",
      mailingPostalCode: "", mailingCountry: "", emergencyContactName: "", emergencyContactRelationship: "", emergencyContactPhone: "",
      shirtSize: "", dietaryNeeds: "", accessibilityNeeds: "",
    };
    mounted = await mount(createElement(AttendeeProfileForm, { initialProfile: profile as never }));
    const { container } = mounted;
    expectNoValidate(container);
    await typeInto(container.querySelector<HTMLInputElement>("#profile-phone")!, "123");
    await typeInto(container.querySelector<HTMLInputElement>("#profile-emergency-phone")!, "456");
    await submitForm(container.querySelector("form")!);
    const { summary } = expectLinkedSummary(container, 2, /^2 things to fix before saving$/);
    expect(summary.textContent).toContain("Phone: Enter a 10-digit US number");
    expect(summary.textContent).toContain("Emergency contact phone: Enter a 10-digit US number");
    // Nothing under the Save button repeats it.
    expect(container.querySelector(".public-manage-contact-actions .inline-notice")).toBeNull();
  });
});

describe("sign-in (/login)", () => {
  it("lists an empty email and password, and a bad email", async () => {
    mounted = await mount(createElement(LoginForm, { unified: true }));
    const { container } = mounted;
    expectNoValidate(container);
    await submitForm(container.querySelector("form")!);
    expectLinkedSummary(container, 2, /^2 things to fix before signing in$/);
    await typeInto(container.querySelector<HTMLInputElement>("#sign-in-email")!, "not-an-email");
    await typeInto(container.querySelector<HTMLInputElement>("#sign-in-password")!, "synthetic-password");
    await submitForm(container.querySelector("form")!);
    const { links } = expectLinkedSummary(container, 1, /^1 thing to fix before signing in$/);
    expect(links[0]!.getAttribute("href")).toBe("#sign-in-email");
  });
});

describe("a changed field drops its own message and summary item", () => {
  it("sign-in: items go one by one, the summary hides when empty, focus never moves", async () => {
    mounted = await mount(createElement(LoginForm, { unified: true }));
    const { container } = mounted;
    await submitForm(container.querySelector("form")!);
    const summary = expectLinkedSummary(container, 2, /^2 things to fix before signing in$/).summary;
    await typeInto(container.querySelector<HTMLInputElement>("#sign-in-email")!, "person@example.test");
    expect(summary.querySelectorAll("li a")).toHaveLength(1);
    expect(summary.querySelector("strong")!.textContent!.trim()).toBe("1 thing to fix before signing in");
    const email = container.querySelector<HTMLInputElement>("#sign-in-email")!;
    expect(email.getAttribute("aria-invalid")).toBeNull();
    expect(container.querySelector("#sign-in-email_error")).toBeNull();
    expect(document.activeElement).toBe(summary);
    await typeInto(container.querySelector<HTMLInputElement>("#sign-in-password")!, "synthetic-password");
    expect(summaryOf(container)).toBeNull();
  });

  it("club application: required stays on the controls, and fixing one field clears only that one", async () => {
    mounted = await mount(createElement(NewClubApplicationForm, { churches: [{ id: "church-1", name: "Synthetic Church", type: "CHURCH" }], todayLabel: "November 1, 2026" }));
    const { container } = mounted;
    expect(container.querySelectorAll("[required]")).toHaveLength(11);
    await submitForm(container.querySelector("form")!);
    // Eleven required answers, plus the director needing a home or work phone.
    expectLinkedSummary(container, 12, /^12 things to fix before submitting$/);
    await typeInto(container.querySelector<HTMLInputElement>("#club_clubName")!, "Synthetic Club");
    expect(summaryOf(container)!.querySelectorAll("li a")).toHaveLength(11);
    expect(container.querySelector("#club_clubName")!.getAttribute("aria-invalid")).toBeNull();
    expect(container.querySelector("#club_clubName_error")).toBeNull();
    expect(container.querySelector("#club_pastorName")!.getAttribute("aria-invalid")).toBe("true");
  });

  it("profile: fixing the phone drops its item", async () => {
    const profile = { firstName: "Test", lastName: "Person", phone: "", mailingLine1: "", mailingLine2: "", mailingCity: "", mailingRegion: "", mailingPostalCode: "", mailingCountry: "", emergencyContactName: "", emergencyContactRelationship: "", emergencyContactPhone: "", shirtSize: "", dietaryNeeds: "", accessibilityNeeds: "" };
    mounted = await mount(createElement(AttendeeProfileForm, { initialProfile: profile as never }));
    const { container } = mounted;
    await typeInto(container.querySelector<HTMLInputElement>("#profile-phone")!, "123");
    await submitForm(container.querySelector("form")!);
    expectLinkedSummary(container, 1, /^1 thing to fix before saving$/);
    await typeInto(container.querySelector<HTMLInputElement>("#profile-phone")!, "(515) 555-0100");
    expect(summaryOf(container)).toBeNull();
  });
});

describe("club application (/clubs/register)", () => {
  it("shows the app's own messages for what the browser used to enforce", async () => {
    mounted = await mount(createElement(NewClubApplicationForm, {
      churches: [{ id: "church-1", name: "Synthetic Church", type: "CHURCH" }],
      todayLabel: "November 1, 2026",
    }));
    const { container } = mounted;
    expectNoValidate(container);
    await typeInto(container.querySelector<HTMLInputElement>("#club_directorEmail")!, "nope");
    await submitForm(container.querySelector("form")!);
    const { summary, links } = expectLinkedSummary(container, 12, /^12 things to fix before submitting$/);
    expect(links[0]!.getAttribute("href")).toBe("#club_clubName");
    expect(summary.textContent).toContain("Director email: Enter a valid email address.");
  });
});

describe("invite a person", () => {
  it("gives one summary instead of an alert per field", async () => {
    mounted = await mount(createElement(InvitePerson, { scope: "clubs", eventOptions: [], clubOptions: [{ id: "club-1", name: "Synthetic Club" }] }));
    const { container } = mounted;
    await click(buttonByText(container, "Invite a person"));
    await flush(50); // the dialog's own first-focus frame has run
    expectNoValidate(document.body);
    await submitForm(document.querySelector("form")!);
    const { links } = expectLinkedSummary(document.body, 3, /^3 things to fix before saving$/);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["#invite-name", "#invite-email", "#invite-access"]);
  });
});

describe("invite: a server problem with a field", () => {
  it("goes through the summary with focus, like a client problem", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "Check the form.", issues: [{ path: ["email"], message: "That address cannot be invited." }] }), { status: 400 })));
    try {
      mounted = await mount(createElement(InvitePerson, { scope: "clubs", eventOptions: [], clubOptions: [] }));
      await click(buttonByText(mounted.container, "Invite a person"));
      await flush(50);
      const form = document.querySelector("form")!;
      await typeInto(form.querySelector<HTMLInputElement>("#invite-name")!, "Test Person");
      await typeInto(form.querySelector<HTMLInputElement>("#invite-email")!, "person@example.test");
      await click(form.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
      await submitForm(form);
      await flush(0);
      const { links } = expectLinkedSummary(document.body, 1, /^1 thing to fix before saving$/);
      expect(links[0]!.getAttribute("href")).toBe("#invite-email");
      expect(document.body.textContent).toContain("That address cannot be invited.");
      // And fixing the field drops it.
      await typeInto(form.querySelector<HTMLInputElement>("#invite-email")!, "other@example.test");
      expect(summaryOf(document.body)).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("roster add review (club form)", () => {
  it("uses the same summary pattern", async () => {
    const review = {
      organizationId: "club-1", submissionId: "sub-1", formName: "Synthetic form", clubYear: "2026-2027", canAdd: true, duplicates: [],
      prefill: { firstName: "", lastName: "", birthDate: "", attendeeType: "YOUTH", role: "", classLevel: null, gender: null, guardians: [{ name: "", relationship: "", email: "", phone: "" }, { name: "", relationship: "", email: "", phone: "" }] },
    };
    mounted = await mount(createElement(ClubFormRosterAdd, { review: review as never, formHref: "/forms" }));
    const form = mounted.container.querySelector("form")!;
    expect(form.noValidate).toBe(true);
    await submitForm(form);
    const { links } = expectLinkedSummary(mounted.container, 4, /^4 things to fix before saving$/);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["#roster-firstName", "#roster-lastName", "#birthDate-input", "#roster-gender"]);
  });
});

describe("roster member form", () => {
  it("links the member problems from a summary and takes focus there", async () => {
    mounted = await mount(createElement(ClubRosterWorkspace, {
      canSeeBirthDates: true,
      clubYear: "2026-2027",
      initialMembers: [],
      organizationId: "club-1",
    } as never));
    const { container } = mounted;
    const add = [...container.querySelectorAll("button")].find((button) => /^Add to roster$/.test(button.textContent?.trim() ?? ""));
    expect(add, "an add button").toBeTruthy();
    await click(add!);
    await flush(50); // the dialog's own first-focus frame has run, as it has by the time a person submits
    const form = document.querySelector<HTMLFormElement>(".roster-dialog form")!;
    expect(form.noValidate).toBe(true);
    await submitForm(form);
    const { links } = expectLinkedSummary(document.body, 4, /^4 things to fix before saving$/);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["#roster-firstName", "#roster-lastName", "#birthDate-input", "#roster-gender"]);
  });
});

describe("event settings", () => {
  const base = draftFromEvent(null);
  it("finds everything the HTML attributes used to enforce", () => {
    const problems = eventSettingsClientProblems({ ...base, name: "ab", slug: "Bad Slug", startsOn: "", endsOn: "" }, "create");
    expect(Object.keys(problems)).toEqual(expect.arrayContaining(["name", "slug", "startsOn", "endsOn", "startTime", "endTime"]));
    const range = eventSettingsClientProblems({ ...base, name: "Synthetic Retreat", slug: "synthetic-retreat", startsOn: "2027-10-10", endsOn: "2027-10-08", capacity: 0 }, "edit");
    expect(range.endsOn).toBeTruthy();
    expect(range.capacity).toBeTruthy();
    expect(eventSettingsClientProblems({ ...base, name: "Synthetic Retreat", slug: "synthetic-retreat", startsOn: "2027-10-08", endsOn: "2027-10-10", hotelBookingUrl: "not a url" }, "edit")).toHaveProperty("hotelBookingUrl");
    expect(eventSettingsClientProblems({ ...base, name: "Synthetic Retreat", slug: "synthetic-retreat", startsOn: "2027-10-08", endsOn: "2027-10-10" }, "edit")).toEqual({});
  });

  it("names a half-typed number, date or time instead of saving it as blank", () => {
    const control = (id: string, type: string, badInput: boolean) => ({ id, type, validity: { badInput } });
    expect(eventSettingsBadInputProblems([
      control("event-field-capacity", "number", true),
      control("event-field-registration-closes-on", "date", true),
      control("event-field-starts-on", "date", false),
      control("not-a-settings-field", "date", true),
    ])).toEqual({ capacity: "Enter a whole number.", registrationClosesOn: "Enter a full date." });
  });

  it("turns the browser bubbles off and keeps the summary", () => {
    const source = read("components/event-settings-workspace.tsx");
    expect(source).toMatch(/<form className="event-settings-layout" noValidate/);
    expect(source).toContain("eventSettingsClientProblems(draft, mode)");
    expect(source).toContain("eventSettingsBadInputProblems(");
    expect(source).not.toContain("onInvalidCapture");
    expect(source).toContain("<FormErrorSummary");
    expect(source).toContain("onFollow=");
    // Rule 7: focus goes to the summary after a failed save.
    expect(source).toContain("if (targetId) errorSummaryRef.current?.focus();");
  });
});

describe("every converted form file", () => {
  it.each([
    "components/attendee-profile-form.tsx",
    "components/new-club-application-form.tsx",
    "components/login-form.tsx",
    "components/club-roster-workspace.tsx",
    "components/public-registration-form.tsx",
    "components/invite-person.tsx",
    "components/event-settings-workspace.tsx",
    "components/club-form-roster-add.tsx",
  ])("%s has noValidate and the linked summary, and no per-field alert", (file) => {
    const source = read(file);
    expect(source).toMatch(/noValidate/);
    expect(source).toContain("<FormErrorSummary");
    expect(source).not.toContain("roster-field-error");
  });
});

describe("public registration form (rendered)", () => {
  const base = { helpText: "", options: [] as string[], scope: "REGISTRATION", required: false };
  const definition = registrationFormDefinitionSchema.parse({
    title: "Synthetic form", description: "Synthetic.", confirmationMessage: "Received.",
    sections: [{ id: "details", title: "Details", description: "", fields: [
      { ...base, id: "contact_field", key: "contact_name", label: "Contact name", type: "TEXT", required: true },
      { ...base, id: "email_field", key: "email", label: "Email", type: "EMAIL", required: true },
    ] }],
  });
  const props = {
    event: { name: "Synthetic Retreat", slug: "synthetic-retreat", startsAt: "2026-10-09T00:00:00.000Z", endsAt: "2026-10-11T00:00:00.000Z", timezone: "America/Chicago", location: null, capacity: null, billingMode: "ATTENDEE_PAY" },
    form: { slug: "main", versionId: "version-1", versionNumber: 1, definition },
    choiceUsage: {},
    pricingDate: "2026-09-29",
    lifecycle: { phase: "OPEN" as const, capacityDecision: "REGISTER" as const, remainingSpots: null, waitingRegistrations: 0 },
  };

  it("lists each missing answer as a link and focuses the summary", async () => {
    window.localStorage.clear();
    vi.stubGlobal("scrollTo", vi.fn());
    try {
      mounted = await mount(createElement(PublicRegistrationForm, props as never));
      const { container } = mounted;
      expect(container.querySelector("form")!.noValidate).toBe(true);
      await click(container.querySelector<HTMLButtonElement>("button.is-continue, button[type='submit']")!);
      await flush(100);
      const summary = container.querySelector<HTMLElement>('.form-error-summary[role="alert"]');
      expect(summary, "summary shown").not.toBeNull();
      expect(summary!.querySelector("strong")!.textContent!.trim()).toMatch(/^2 things to fix before (submitting|continuing)$/);
      expect(document.activeElement).toBe(summary);
      const links = [...summary!.querySelectorAll<HTMLAnchorElement>("li a")];
      expect(links).toHaveLength(2);
      for (const link of links) {
        const target = document.getElementById(link.getAttribute("href")!.slice(1));
        expect(target?.getAttribute("aria-invalid")).toBe("true");
        expect(target?.getAttribute("aria-describedby")).toBeTruthy();
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("public registration form", () => {
  it("shows the linked summary, not a text count", () => {
    const source = read("components/public-registration-form.tsx");
    expect(source).toMatch(/<form className="public-registration-layout" noValidate/);
    expect(source).toContain("<FormErrorSummary");
    expect(source).not.toContain("public-registration-error-count");
    expect(source).toContain('<FieldError className="public-registration-field-error"');
  });
});
