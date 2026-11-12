// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PeopleWorkspace, submittedCardText } from "@/components/people-workspace";
import { pageOwnsHeader } from "@/components/page-header-routes";
import type { RegistrationRecord } from "@/modules/registrations/repository";

// #1574: the Registrations list header and cards. Synthetic data only.
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/people",
  useSearchParams: () => new URLSearchParams(),
}));

function registration(index: number, extra: Partial<RegistrationRecord> = {}): RegistrationRecord {
  return {
    id: `registration-${index}`,
    confirmationCode: `TEST-${String(1000 + index)}`,
    status: "CONFIRMED",
    accountHolder: { firstName: "Pat", lastName: `Example${index}`, email: `pat${index}@example.test` },
    attendees: [
      { id: `a-${index}-1`, firstName: "Casey", lastName: "Sample", attendeeType: "ATTENDEE", checkedIn: false, checkedInAt: null, responses: {} },
      { id: `a-${index}-2`, firstName: "Robin", lastName: "Sample", attendeeType: "ATTENDEE", checkedIn: false, checkedInAt: null, responses: {} },
      { id: `a-${index}-3`, firstName: "Jules", lastName: "Sample", attendeeType: "ATTENDEE", checkedIn: false, checkedInAt: null, responses: {} },
    ],
    payments: [],
    totalAmountCents: 0,
    balanceCents: 0,
    attendeeCount: 3,
    checkedInCount: 0,
    messages: [],
    adjustments: [],
    submittedAt: "2028-03-04T18:00:00.000Z",
    location: { id: "loc-1", name: "Synthetic Lodge" },
    ...extra,
  } as unknown as RegistrationRecord;
}

const base = {
  eventId: "event-1",
  eventSlug: "synthetic-event",
  eventTimezone: "America/Chicago",
  waitlistEnabled: false,
  canEdit: true,
  canEmail: true,
};
const records = [registration(1), registration(2, { submittedAt: null, status: "DRAFT" } as Partial<RegistrationRecord>)];
const render = (props: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(PeopleWorkspace, { ...base, initialRegistrations: records, ...props } as never));

describe("Registrations header (#1574)", () => {
  // The titled header is drawn by the page, because the page-title guard reads the title from the page file.
  const page = readFileSync("app/(workspace)/people/page.tsx", "utf8");
  const header = page.slice(page.indexOf("<PageHeader"), page.indexOf("<PeopleWorkspace"));

  it("draws one titled header above the list, and the list draws no h1 or duplicate title", () => {
    expect(page).toContain("title={staffPageTitles.registrations}");
    expect(page.match(/<PageHeader\b/g)).toHaveLength(1);
    const html = render();
    expect(html).not.toContain("<h1");
    expect(html).not.toContain("duplicate-page-title");
    expect(pageOwnsHeader("/people")).toBe(true);
    // The "/people" entry matches that page only: a sub-page without its own header still gets the shell's title.
    expect(pageOwnsHeader("/people/review-queues")).toBe(false);
    // The Attendee list draws its own header too (#1574, second PR).
    expect(pageOwnsHeader("/people/attendees")).toBe(true);
  });

  it("says what a registration is and links to the Attendee list for the event", () => {
    expect(header).toContain("A registration is one sign-up with everyone it covers.");
    expect(header).toContain("href={`/people/attendees?event=${encodeURIComponent(event.id)}`}>Attendee list</a>");
  });

  it("shows Start registration only to someone who can manage registrations, in a new tab, and keeps the Actions gates", () => {
    expect(header).toMatch(/primary=\{canEdit \? <a className="primary-button" href=\{`\/events\/\$\{event\.slug\}`\} target="_blank" rel="noreferrer">/);
    expect(page).toContain('const canEdit = permissions.includes("MANAGE_REGISTRATION")');
    expect(header).toContain('permissions.includes("MANAGE_IMPORTS") && ');
    expect(header).toContain("canReviewPeopleMatches && ");
    expect(header).toContain("Download CSV");
    // Bulk email needs the ticked rows, so it lives in the list's selection bar only.
    expect(header).not.toContain("Email selected");
    expect(readFileSync("components/people-workspace.tsx", "utf8")).toContain("Email selected");
    expect(render({ canEdit: false, canEmail: false })).not.toContain("Start registration");
  });
});

describe("Registration cards (#1574)", () => {
  it("labels the date, and says so when nothing was submitted", () => {
    expect(submittedCardText(null, "America/Chicago")).toBe("Not submitted yet");
    expect(submittedCardText("2028-03-04T18:00:00.000Z", "America/Chicago")).toMatch(/^Submitted Mar 4, 2028/);
    const html = render();
    expect(html).toMatch(/Submitted Mar 4, 2028/);
    expect(html).toContain("Not submitted yet");
  });

  it("shows the name, then code, people and location, then attendees, with a chevron and the bulk-email box outside the button", () => {
    const html = render();
    expect(html).not.toContain("record-grid");
    const shell = html.slice(html.indexOf('<div class="record-card-shell"'));
    const card = shell.slice(shell.indexOf('<button'), shell.indexOf('</button>'));
    const order = ["Pat Example1", "TEST-1001", "3 people", "Synthetic Lodge", "Casey Sample, Robin Sample +1 more", "Submitted"].map((text) => card.indexOf(text));
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(card).toContain("lucide-chevron-right");
    expect(card).not.toContain('type="checkbox"');
    expect(shell).toContain('type="checkbox"');
  });
});

describe("Registration detail on a phone (#1574)", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    // jsdom has no layout, so no scrollIntoView.
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => document.body.replaceChildren());

  it("Back to results closes the dialog through the same path as the X, and the head carries the code and status", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(PeopleWorkspace, { ...base, initialRegistrations: records } as never)));
    const open = () => act(async () => { (host.querySelector("button.interactive-record") as HTMLButtonElement).click(); });

    await open();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    const head = dialog.querySelector(".modal-head")!;
    expect(head.textContent).toContain("Pat Example1");
    expect(head.textContent).toContain("TEST-1001");
    expect(head.querySelector(".status-chip")).not.toBeNull();
    const back = [...head.querySelectorAll("button")].find((button) => button.textContent?.includes("Back to results"))!;
    expect(back).toBeDefined();
    await act(async () => { back.click(); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    await open();
    await act(async () => { (document.querySelector('[aria-label="Close dialog"]') as HTMLButtonElement).click(); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => root.unmount());
  });

  it("wires Back to results to closeModal, as the X is, and styles the phone dialog full screen", () => {
    const source = readFileSync("components/people-workspace.tsx", "utf8");
    expect(source).toMatch(/<button className=\{`secondary-button \$\{listStyles\.backButton\}`\} type="button" onClick=\{closeModal\}>/);
    expect(source).toMatch(/modal-close-button \$\{listStyles\.closeX\}`\} type="button" onClick=\{closeModal\}/);
    const css = readFileSync("components/people-list.module.css", "utf8");
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*border-radius: 0;/);
    expect(css).toMatch(/100dvh/);
    expect(css).toMatch(/position: sticky;/);
  });
});
