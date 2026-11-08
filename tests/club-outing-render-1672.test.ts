import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

import { ClubFormFillIn } from "@/components/club-form-fill-in";
import { ClubOutingForm } from "@/components/club-outing-form";
import { ClubOutingsSection } from "@/components/club-outings-section";
import { clubFormTemplateSeeds } from "@/modules/club-forms/definitions";
import { definitionForLink } from "@/modules/club-forms/domain";
import { definitionForOutingFill, outingDetailRows, parseOutingInput } from "@/modules/club-forms/outing-domain";

/** The parent's page and the director's pages for an outing permission slip (#1672). Synthetic data only. */
const slip = clubFormTemplateSeeds.find((seed) => seed.key === "off_premises_permission_slip")!;
const input = parseOutingInput({
  details: { activity: "Canoe trip", startDate: "2026-11-21", endDate: "", departureTime: "08:30", returnTime: "", transportation: "Church van", cost: "$15", whatToBring: "", note: "" },
  questions: [{ label: "Can your child swim?", type: "YES_NO", required: true, options: [] }],
});

function parentPage() {
  return renderToStaticMarkup(createElement(ClubFormFillIn, {
    definition: definitionForOutingFill(definitionForLink(slip), input.questions, "Example Pathfinders"),
    sectionNotes: slip.sectionNotes,
    sensitiveFieldKeys: slip.sensitiveFieldKeys,
    mode: "link",
    token: "t",
    outing: { detailRows: outingDetailRows(input.details, slip.definition), sectionId: "sec_permission" },
  }));
}

describe("the parent's page for an outing slip (#1672)", () => {
  it("shows the preset details as read-only text, with no field to type them in", () => {
    const html = parentPage();
    const details = html.slice(html.indexOf('data-testid="outing-details"'));
    expect(details).toContain("Canoe trip");
    expect(details).toContain("November 21, 2026");
    expect(details).toContain("8:30 AM");
    expect(details).toContain("Church van");
    expect(details).toContain("On the date of");
    expect(details).toContain("I give my child permission to ride with");
    expect(html).not.toContain('id="club-form-f_activity"');
    expect(html).not.toContain('id="club-form-f_activity_date"');
    expect(html).not.toContain('id="club-form-f_ride_with"');
    expect(html).toContain("I hereby give my permission for my child to participate in the pre-planned activity named below, on the date given.");
  });

  it("keeps the slip's locked sections and asks the club's question in its own section", () => {
    const html = parentPage();
    for (const title of ["Child and family", "Parent or guardian", "Medical and emergency", "Questions from Example Pathfinders"]) expect(html, title).toContain(title);
    expect(html).toContain("Can your child swim?");
    expect(html.indexOf("Permission to participate")).toBeLessThan(html.indexOf("Questions from Example Pathfinders"));
    expect(html.indexOf("Questions from Example Pathfinders")).toBeLessThan(html.indexOf("Parent or guardian"));
  });

  it("shows no outing block on an ordinary link", () => {
    const html = renderToStaticMarkup(createElement(ClubFormFillIn, { definition: definitionForLink(slip), sectionNotes: slip.sectionNotes, sensitiveFieldKeys: [], mode: "link", token: "t" }));
    expect(html).not.toContain("outing-details");
    expect(html).toContain('id="club-form-f_activity"');
  });
});

describe("the director's outing pages (#1672)", () => {
  it("says who can turn the slip on, with no New button, when it is off", () => {
    const html = renderToStaticMarkup(createElement(ClubOutingsSection, { base: "/account/clubs/club-a/forms", outings: [], slipEnabled: false }));
    expect(html).toContain("not turned on yet");
    expect(html).toContain("system administrator");
    expect(html).not.toContain("New outing slip");
  });

  it("offers New outing slip when it is on, and says why the list is empty", () => {
    const html = renderToStaticMarkup(createElement(ClubOutingsSection, { base: "/account/clubs/club-a/forms", outings: [], slipEnabled: true }));
    expect(html).toContain('href="/account/clubs/club-a/forms/outings/new"');
    expect(html).toContain("No outing slips yet");
  });

  it("lists an outing with its signed, not yet and expired counts", () => {
    const html = renderToStaticMarkup(createElement(ClubOutingsSection, {
      base: "/account/clubs/club-a/forms",
      slipEnabled: true,
      outings: [{ id: "outing-1", activity: "Canoe trip", startDate: "2026-11-21", dateLabel: "November 21, 2026", clubYear: "2026-27", status: "OPEN", questionCount: 1, counts: { SIGNED: 3, NOT_YET: 4, EXPIRED: 1 } }],
    }));
    expect(html).toContain("Canoe trip");
    expect(html).toContain('href="/account/clubs/club-a/forms/outings/outing-1"');
    expect(html).toContain('class="report-table table-cards"');
  });

  it("the form says what questions can't ask, and pre-fills a copy without dates", () => {
    const html = renderToStaticMarkup(createElement(ClubOutingForm, {
      organizationId: "club-a",
      formsHref: "/account/clubs/club-a/forms",
      initial: { ...input, details: { ...input.details, startDate: "", endDate: "" } },
    }));
    expect(html).toContain("can&#x27;t ask for birth dates or medical details");
    expect(html).toContain('value="Canoe trip"');
    expect(html).toContain("Can your child swim?");
    expect(html).toContain("Add a question");
    expect(html).toContain("Save outing");
  });

  it("stops offering a sixth question", () => {
    const five = { ...input, questions: Array.from({ length: 5 }, (_, n) => ({ label: `Question ${n + 1}`, type: "TEXT" as const, required: false, options: [] })) };
    const html = renderToStaticMarkup(createElement(ClubOutingForm, { organizationId: "club-a", formsHref: "/x", initial: five }));
    expect(html).not.toContain("Add a question");
  });
});
