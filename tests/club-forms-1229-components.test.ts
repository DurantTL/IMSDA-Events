import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ClubFormFillIn } from "@/components/club-form-fill-in";
import { ClubFormFillMode } from "@/components/club-form-fill-mode";
import { CopyApplicationLink } from "@/components/copy-application-link";
import type { RegistrationFormDefinition } from "@/modules/forms/definition";

/** #1229: the pieces of the open application and the admin control, rendered. Synthetic data only. */
const definition: RegistrationFormDefinition = {
  title: "Sample application",
  description: "",
  confirmationMessage: "Thanks",
  sections: [{ id: "sec_a", title: "Applicant", description: "", fields: [
    { id: "f_name", key: "full_name", label: "Full name", helpText: "", type: "TEXT", scope: "REGISTRATION", required: true, options: [] },
  ] }],
};

describe("the open application form (#1229)", () => {
  const html = renderToStaticMarkup(createElement(ClubFormFillIn, {
    definition, sectionNotes: {}, sensitiveFieldKeys: [], mode: "open", templateKey: "club_tlt_application",
    clubs: [{ id: "club-a", name: "Example Pathfinders" }, { id: "club-b", name: "Sample Valley" }],
  }));

  it("offers the clubs by id and name, then Not listed", () => {
    expect(html).toContain('<option value="club-a">Example Pathfinders</option>');
    expect(html).toContain('<option value="club-b">Sample Valley</option>');
    expect(html.indexOf("Sample Valley")).toBeLessThan(html.indexOf('value="NOT_LISTED"'));
    expect(html).toContain("Not listed");
  });

  it("does not say the link works once, and has no draft button or roster picker", () => {
    expect(html).not.toContain("Save draft");
    expect(html).not.toContain("Roster member");
    expect(html).toContain("Submit form");
  });
});

describe("the copyable application link (#1229)", () => {
  it("shows the address as text beside the button, so it can be copied by hand", () => {
    const html = renderToStaticMarkup(createElement(CopyApplicationLink, { url: "https://events.imsda.test/clubs/forms/apply/club_tlt_application" }));
    expect(html).toContain("Copy application link");
    expect(html).toContain("<code>https://events.imsda.test/clubs/forms/apply/club_tlt_application</code>");
  });
});

describe("Who fills it in, in Admin (#1229)", () => {
  const props = { templateKey: "club_tlt_application", name: "TLT Application", applicationUrl: "https://events.imsda.test/clubs/forms/apply/club_tlt_application", clubYear: "2026-27" };

  it("has the three choices, and for an open application the address and a Close control", () => {
    const html = renderToStaticMarkup(createElement(ClubFormFillMode, { ...props, fillMode: "OPEN_APPLICATION", closed: false }));
    for (const label of ["Families and individuals", "Club forms", "Open application"]) expect(html).toContain(label);
    expect(html).toContain("Close for 2026-27");
    expect(html).toContain("apply/club_tlt_application</code>");
  });

  it("offers Reopen when the year is closed", () => {
    expect(renderToStaticMarkup(createElement(ClubFormFillMode, { ...props, fillMode: "OPEN_APPLICATION", closed: true }))).toContain("Reopen");
  });

  it("shows no address or close control for the other two", () => {
    const html = renderToStaticMarkup(createElement(ClubFormFillMode, { ...props, fillMode: "CLUB", closed: false }));
    expect(html).not.toContain("Close for");
    expect(html).not.toContain("<code>");
  });
});
