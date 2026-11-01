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
import { ClubRosterWorkspace } from "@/components/club-roster-workspace";
import { InvitePerson } from "@/components/invite-person";
import { LoginForm } from "@/components/login-form";
import { NewClubApplicationForm } from "@/components/new-club-application-form";
import { errorSummaryHeading } from "@/components/form-error-summary";
import { eventSettingsClientProblems } from "@/modules/events/settings-draft";
import { draftFromEvent } from "@/modules/events/settings-draft";
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
    expect(target!.getAttribute("aria-invalid")).toBe("true");
    const describedBy = (target!.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
    const message = describedBy.map((ref) => document.getElementById(ref)).find((node) => node?.matches(".field-error-message"));
    expect(message, `field #${id} points at its message`).toBeTruthy();
    expect((message!.textContent ?? "").trim().length).toBeGreaterThan(0);
  }
  return { summary: summary!, links };
}

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
    expect(summary.textContent).toContain("Phone");
    // Nothing under the Save button repeats it.
    expect(container.querySelector(".public-manage-contact-actions p")!.textContent).toBe("");
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
    const { summary, links } = expectLinkedSummary(container, 11, /^11 things to fix before submitting$/);
    expect(links[0]!.getAttribute("href")).toBe("#club_clubName");
    expect(summary.textContent).toContain("Director email: Enter the director's email address.");
  });
});

describe("invite a person", () => {
  it("gives one summary instead of an alert per field", async () => {
    mounted = await mount(createElement(InvitePerson, { scope: "clubs", eventOptions: [], clubOptions: [{ id: "club-1", name: "Synthetic Club" }] }));
    const { container } = mounted;
    await click(buttonByText(container, "Invite a person"));
    expectNoValidate(document.body);
    await submitForm(document.querySelector("form")!);
    const { links } = expectLinkedSummary(document.body, 3, /^3 things to fix before saving$/);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["#invite-name", "#invite-email", "#invite-access"]);
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

  it("turns the browser bubbles off and keeps the summary", () => {
    const source = read("components/event-settings-workspace.tsx");
    expect(source).toMatch(/<form className="event-settings-layout" noValidate/);
    expect(source).toContain("eventSettingsClientProblems(draft, mode)");
    expect(source).toContain("<FormErrorSummary");
    expect(source).toContain("onFollow=");
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
