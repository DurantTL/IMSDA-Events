import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AttendeeConfigurationWorkspace } from "@/components/attendee-configuration-workspace";
import { TagConfigurationWorkspace } from "@/components/tag-configuration-workspace";

const root = process.cwd();
const globalsCss = readFileSync(path.join(root, "app/globals.css"), "utf8");

const attendeeType = {
  id: "type_1", code: "ADULT", label: "Adult", description: "18 and over",
  sortOrder: 0, isActive: true, minimumAge: 18, maximumAge: null,
};
const classification = {
  id: "class_1", kind: "CATEGORY" as const, code: "WORSHIP", label: "Worship",
  description: "", sortOrder: 0, isActive: true,
};
const tag = { id: "tag_1", name: "VIP", color: "#4F46E5", description: "Priority seating", isActive: true };

describe("attendee configuration: readable table headers and where-this-shows-up (#474)", () => {
  it("renders a real header cell per column, not a single run-together string", () => {
    const markup = renderToStaticMarkup(createElement(AttendeeConfigurationWorkspace, {
      eventId: "event_1", eventName: "Fall Retreat", initialTypes: [attendeeType], initialClassifications: [classification],
    }));
    for (const heading of ["Code", "Label", "Description", "Sort order", "Age band", "Status", "Actions"]) {
      expect(markup).toContain(`<th role="columnheader" scope="col">${heading}</th>`);
    }
    for (const heading of ["Dimension", "Code", "Label", "Description", "Sort order", "Status", "Actions"]) {
      expect(markup).toContain(`<th role="columnheader" scope="col">${heading}</th>`);
    }
    // Column headers are distinct DOM cells, never concatenated into one string.
    expect(markup).not.toContain("CodeLabelDescription");
  });

  it("renders a per-field data-label on every record card cell, for the narrow-screen card layout", () => {
    const markup = renderToStaticMarkup(createElement(AttendeeConfigurationWorkspace, {
      eventId: "event_1", eventName: "Fall Retreat", initialTypes: [attendeeType], initialClassifications: [classification],
    }));
    for (const label of ["Label", "Description", "Sort order", "Age band", "Status"]) {
      expect(markup).toContain(`data-label="${label}"`);
    }
    expect(markup).toContain('data-label="Dimension"');
    // The code is the card's row header; the action cell is unlabelled and sits at the card's foot (#1457).
    expect(markup).toContain('<th role="rowheader" scope="row"><code>ADULT</code></th>');
    expect(markup).not.toContain('data-label="Actions"');
  });

  it("shows a visible Min and Max label tied to each age input (#1457)", () => {
    const markup = renderToStaticMarkup(createElement(AttendeeConfigurationWorkspace, {
      eventId: "event_1", eventName: "Fall Retreat", initialTypes: [attendeeType], initialClassifications: [classification],
    }));
    expect(markup).toMatch(/<label[^>]*><span>Min<\/span><input aria-label="Minimum age for ADULT"/);
    expect(markup).toMatch(/<label[^>]*><span>Max<\/span><input aria-label="Maximum age for ADULT"/);
  });

  it("renders headers even with an empty table (no rows yet)", () => {
    const markup = renderToStaticMarkup(createElement(AttendeeConfigurationWorkspace, {
      eventId: "event_1", eventName: "Fall Retreat", initialTypes: [], initialClassifications: [],
    }));
    expect(markup).toContain('<th role="columnheader" scope="col">Code</th><th role="columnheader" scope="col">Label</th>');
    expect(markup).toContain('<th role="columnheader" scope="col">Dimension</th><th role="columnheader" scope="col">Code</th>');
  });

  it("gives the editable table real desktop header styling and the shared table-cards layout (#1457)", () => {
    const markup = renderToStaticMarkup(createElement(AttendeeConfigurationWorkspace, {
      eventId: "event_1", eventName: "Fall Retreat", initialTypes: [attendeeType], initialClassifications: [classification],
    }));
    expect(markup.match(/class="editable-settings-table table-cards table-cards-xwide"/g)).toHaveLength(2);
    expect(markup).not.toContain("scroll-cue");
    expect(globalsCss).toMatch(/\.editable-settings-table\s*\{[^}]*width: 100%;[^}]*\}/);
    expect(globalsCss).toMatch(/\.editable-settings-table thead th\s*\{[^}]*text-transform: uppercase;[^}]*\}/);
    // The old third card system is gone: the shared table-cards rules draw the cards.
    expect(globalsCss).not.toContain(".editable-settings-table thead { display: none; }");
    expect(globalsCss).not.toMatch(/\.editable-settings-table td\[data-label\]::before/);
  });

  it("tells staff in plain language where attendee types and groupings show up, with links", () => {
    const markup = renderToStaticMarkup(createElement(AttendeeConfigurationWorkspace, {
      eventId: "event_42", eventName: "Fall Retreat", initialTypes: [attendeeType], initialClassifications: [classification],
    }));
    expect(markup).toContain("Where this shows up");
    expect(markup).toContain('href="/registration-builder?event=event_42"');
    expect(markup).toContain('href="/more/reports?event=event_42"');
    expect(markup).toContain('href="/check-in?event=event_42"');
  });

  it("replaces system wording ('orthogonal categories') with plain language", () => {
    const markup = renderToStaticMarkup(createElement(AttendeeConfigurationWorkspace, {
      eventId: "event_1", eventName: "Fall Retreat", initialTypes: [attendeeType], initialClassifications: [classification],
    }));
    expect(markup.toLowerCase()).not.toContain("orthogonal");
    expect(markup).toContain("an attendee can have several of each");
  });
});

describe("tags: readable table headers and where-this-shows-up (#474)", () => {
  it("renders a real header cell per column, not a single run-together string", () => {
    const markup = renderToStaticMarkup(createElement(TagConfigurationWorkspace, {
      eventId: "event_1", eventName: "Fall Retreat", initialTags: [tag],
    }));
    for (const heading of ["Tag", "Color", "Name", "Description", "Status", "Actions"]) {
      expect(markup).toContain(`<th role="columnheader" scope="col">${heading}</th>`);
    }
    expect(markup).not.toContain("ColorNameDescription");
  });

  it("renders a per-field data-label on every tag card cell, for the narrow-screen card layout", () => {
    const markup = renderToStaticMarkup(createElement(TagConfigurationWorkspace, {
      eventId: "event_1", eventName: "Fall Retreat", initialTags: [tag],
    }));
    for (const label of ["Color", "Name", "Description", "Status"]) {
      expect(markup).toContain(`data-label="${label}"`);
    }
    expect(markup).not.toContain('data-label="Actions"');
    expect(markup).toContain('class="editable-settings-table table-cards table-cards-xwide"');
  });

  it("renders headers with a tag, and explains an empty list instead of showing a bare table (#743)", () => {
    const withTag = renderToStaticMarkup(createElement(TagConfigurationWorkspace, {
      eventId: "event_1", eventName: "Fall Retreat",
      initialTags: [{ id: "t1", name: "Fixture", color: "#4F46E5", description: "", isActive: true }],
    }));
    expect(withTag).toContain('<th role="columnheader" scope="col">Tag</th><th role="columnheader" scope="col">Color</th><th role="columnheader" scope="col">Name</th><th role="columnheader" scope="col">Description</th><th role="columnheader" scope="col">Status</th><th role="columnheader" scope="col">Actions</th>');
    const empty = renderToStaticMarkup(createElement(TagConfigurationWorkspace, {
      eventId: "event_1", eventName: "Fall Retreat", initialTags: [],
    }));
    expect(empty).toContain("No tags yet");
    expect(empty).not.toContain(">Color</th>");
  });

  it("renders a tag card whose row header names the tag, first in the row, with the editable fields labelled (#1457)", () => {
    const markup = renderToStaticMarkup(createElement(TagConfigurationWorkspace, {
      eventId: "event_1", eventName: "Fall Retreat", initialTags: [tag, { id: "tag_2", name: "Needs ride", color: "#0F766E", description: "", isActive: false }],
    }));
    const rows = markup.match(/<tr[^>]*role="row"[^>]*>.*?<\/tr>/g) ?? [];
    const bodyRows = rows.filter((row) => row.includes("<td"));
    expect(bodyRows).toHaveLength(2);
    expect(bodyRows[0]).toMatch(/^<tr[^>]*><th role="rowheader" scope="row"><strong translate="no">VIP<\/strong><\/th><td [^>]*data-label="Color"/);
    expect(bodyRows[1]).toMatch(/^<tr[^>]*><th role="rowheader" scope="row"><strong translate="no">Needs ride<\/strong><\/th>/);
    // The editable Name stays a labelled cell with its own accessible name.
    expect(bodyRows[0]).toContain('data-label="Name"');
    expect(bodyRows[0]).toContain('aria-label="Name for VIP"');
    expect(bodyRows[0]).toContain('aria-label="Color for VIP"');
  });

  it("tells staff in plain language where tags show up, with a link, and only claims wiring that exists", () => {
    const markup = renderToStaticMarkup(createElement(TagConfigurationWorkspace, {
      eventId: "event_9", eventName: "Fall Retreat", initialTags: [tag],
    }));
    expect(markup).toContain("Where this shows up");
    expect(markup).toContain('href="/people?event=event_9"');
  });
});
