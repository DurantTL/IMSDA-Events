import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageOwnsHeader } from "@/components/page-header-routes";
import { formTemplates } from "@/modules/forms/definition";

// #1574: the attendee list has one titled header (one h1), a Registrations link, the CSV as the header's outlined button,
// and the shared cards. Synthetic data only.
const dependencies = vi.hoisted(() => ({
  resolveEventContext: vi.fn(),
  listRegistrations: vi.fn(),
  isClubAudienceEvent: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/navigation")>()), useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/modules/events/selection", () => ({ resolveEventContext: dependencies.resolveEventContext }));
vi.mock("@/modules/events/repository", () => ({ isClubAudienceEvent: dependencies.isClubAudienceEvent }));
vi.mock("@/modules/registrations/repository", () => ({ listRegistrations: dependencies.listRegistrations }));

import AttendeeListingPage from "@/app/(workspace)/people/attendees/page";

const root = join(__dirname, "..");
const read = (file: string) => readFileSync(join(root, file), "utf8");
const definition = formTemplates.find((template) => template.key === "womens_retreat_export")!.definition;

function registration(id: string) {
  return {
    id,
    confirmationCode: `WR26-${id}`,
    status: "CONFIRMED",
    accountHolder: { id: `p-${id}`, firstName: "Holder", lastName: id, email: "", phone: "" },
    attendees: [{ id: `at-${id}`, firstName: "Guest", lastName: id, email: "", phone: "", attendeeType: "Adult", responses: { meal_preference: "Vegan", dietary_needs: "synthetic: no peanuts" } }],
    publicSubmission: { definition, responses: {}, attendeeResponses: [] },
  };
}

const render = async (query: Record<string, string> = { event: "evt" }) => renderToStaticMarkup(await AttendeeListingPage({ searchParams: Promise.resolve(query) }));
const context = (permissions: string[]) => ({ event: { id: "evt", name: "Synthetic Retreat" }, permissions });

beforeEach(() => {
  vi.clearAllMocks();
  dependencies.isClubAudienceEvent.mockResolvedValue(false);
  dependencies.listRegistrations.mockResolvedValue([registration("R1")]);
});

describe("attendee list header (#1574)", () => {
  it("draws exactly one h1 from a titled PageHeader, and the shell skips its own", async () => {
    dependencies.resolveEventContext.mockResolvedValue(context(["VIEW_REPORTS", "VIEW_SENSITIVE_DATA"]));
    const html = await render();
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*>Attendee list<\/h1>/);
    expect(html).not.toMatch(/<h2[^>]*>Attendee list/);
    expect(pageOwnsHeader("/people/attendees")).toBe(true);
    expect(read("app/(workspace)/people/attendees/page.tsx")).toContain("<PageHeader title={staffPageTitles.attendeeList}");
  });

  it("has no eyebrow with the event name", async () => {
    dependencies.resolveEventContext.mockResolvedValue(context(["VIEW_REPORTS", "VIEW_SENSITIVE_DATA"]));
    const html = await render();
    expect(html).not.toContain("Synthetic Retreat");
    expect(html).not.toContain('class="eyebrow');
    expect(html).not.toContain("page-intro");
  });

  it("describes the list and links to Registrations for whole sign-ups", async () => {
    dependencies.resolveEventContext.mockResolvedValue(context(["VIEW_REPORTS", "VIEW_SENSITIVE_DATA"]));
    const html = await render();
    expect(html).toContain("One row per person on a registration, with meal, dietary, childcare and volunteer answers.");
    expect(html).toMatch(/<a [^>]*href="\/people\?event=evt"[^>]*>Registrations<\/a>/);
    const other = await render({ event: "evt", view: "contacts" });
    expect(other).toContain("One row per person on a registration.");
    expect(other).not.toContain("with meal, dietary");
    expect(other).toMatch(/This is the .+ view\./);
  });

  it("shows the CSV as the header's outlined button only with VIEW_REPORTS", async () => {
    dependencies.resolveEventContext.mockResolvedValue(context(["VIEW_REPORTS", "VIEW_SENSITIVE_DATA"]));
    const withReports = await render();
    expect(withReports).toMatch(/<a [^>]*class="secondary-button"[^>]*href="\/api\/events\/evt\/exports\/attendees[^"]*"[^>]*>[\s\S]*Download CSV \(all columns\)/);
    expect(withReports).not.toContain("primary-button");
    dependencies.resolveEventContext.mockResolvedValue(context(["VIEW_SENSITIVE_DATA"]));
    expect(await render()).not.toContain("Download CSV");
  });

  it("keeps the selectors the event journeys use", async () => {
    dependencies.resolveEventContext.mockResolvedValue(context(["VIEW_REPORTS", "VIEW_SENSITIVE_DATA"]));
    const html = await render();
    expect(html).toContain('data-col="name"');
    expect(html).toMatch(/<td[^>]*data-col="confirmationCode"[^>]*><a /);
    expect(html).toMatch(/<th[^>]*data-col="name"[^>]*><a [^>]*href="[^"]*sort=name/);
    expect(html).toMatch(/Sort by\s*<select name="sort"/);
    expect(html).toMatch(/Direction\s*<select name="dir"/);
    expect(html).toMatch(/<input type="search"[^>]*name="q"/);
    expect(html).toContain("Meal totals");
    expect(html).toContain('data-default-value="asc"');
  });
});

describe("attendee list styles (#1574)", () => {
  const css = read("app/(workspace)/people/attendees/attendee-list.module.css");

  it("hides the card-mode sort chip row only at 600px and under", () => {
    const rule = "thead:has(:global(.table-sort-button)) { display: none; }";
    expect(css).toContain(rule);
    const before = css.slice(0, css.indexOf(rule));
    expect(before.lastIndexOf("@media screen and (max-width: 600px)")).toBeGreaterThan(before.lastIndexOf("@container"));
    // Nothing outside that media query touches the sort chip row.
    expect(css.split(".table-sort-button").length - 1).toBe(1);
  });

  it("lays the cards out as a title, a code and status line, and a grid of pairs", () => {
    expect(css).toContain("repeat(auto-fill, minmax(14rem, 1fr))");
    expect(css).toMatch(/th\[scope="row"\] \{[^}]*grid-column: 1 \/ -1;[^}]*font-weight: 700;/);
    expect(css).toContain('td[data-col="confirmationCode"]');
    expect(css).toContain('td[data-col="status"]');
    expect(css).toMatch(/td:empty \{ display: none; \}/);
  });
});
