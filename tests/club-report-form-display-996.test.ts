import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * #996 bug 4: a submitted Monthly Record opened from the Area Coordinator view or the club's dialog shows the saved
 * answers, the total shown equals the stored totalPoints, "Includes N" uses the report's own on-time points, and a
 * read-only view is a plain summary rather than disabled inputs. All data is synthetic.
 */
vi.mock("server-only", () => ({}));

import { ClubReportForm } from "@/components/club-report-form";
import { ON_TIME_POINTS, pickedTotal, pointItems, type PickedPoints } from "@/modules/club-reports/domain";
import type { ClubReportRecord } from "@/modules/club-reports/repository";

const points: PickedPoints = {
  staffMeeting: 25, meetingsOutings: 50, ratio: 25, uniformMeetings: 20, uniformOutside: 40, devotions: 50,
  exercise: 0, outreach: 50, guest: 0, honors: 25, classLevel: 25, bonus: 0,
};

function submittedReport(overrides: Partial<ClubReportRecord> = {}): ClubReportRecord {
  const onTimePoints = overrides.onTimePoints ?? ON_TIME_POINTS;
  return {
    id: "report-1", organizationId: "club-1", clubYear: "2026-2027", reportMonth: "2026-09",
    meetingPlace: "Fellowship hall", meetingSchedule: "Saturdays", averageAttendance: 12, pathfinderCount: 12, tltCount: 1, staffCount: 3,
    investitureDate: null, classLevels: ["FRIEND"], points, honors: [{ name: "Camping Skills I", participants: 6 }],
    onTimePoints, totalPoints: onTimePoints + pickedTotal(points), signatureName: "Dana Synthetic", signedOn: "2026-10-01",
    status: "SUBMITTED", submittedAt: "2026-10-01T15:00:00.000Z", firstSubmittedAt: "2026-10-01T15:00:00.000Z", updatedAt: "2026-10-01T15:00:00.000Z",
    ...overrides,
  } as ClubReportRecord;
}

function render(report: ClubReportRecord, props: { readOnly: boolean; asDialog?: boolean }) {
  return renderToStaticMarkup(createElement(ClubReportForm, {
    endpoint: "/api/test",
    monthLabel: "September 2026",
    dueLabel: "October 10, 2026",
    initial: report,
    prefill: { meetingPlace: "", meetingSchedule: "", pathfinderCount: 0, tltCount: 0, staffCount: 0, averageAttendance: null, honors: [] },
    expectedOnTime: 0,
    ...props,
  }));
}

describe("a submitted Monthly Record (#996)", () => {
  it("shows a total equal to the stored totalPoints", () => {
    const report = submittedReport();
    expect(report.totalPoints).toBe(ON_TIME_POINTS + pickedTotal(points));
    for (const props of [{ readOnly: true }, { readOnly: false, asDialog: true }, { readOnly: false }]) {
      expect(render(report, props)).toContain(`<h2>${report.totalPoints} points</h2>`);
    }
  });

  it("says how many on-time points the report really earned, not the constant", () => {
    const html = render(submittedReport({ onTimePoints: 10 }), { readOnly: true });
    expect(html).toContain("Includes 10 for submitting by October 10, 2026.");
    expect(html).not.toContain(`Includes ${ON_TIME_POINTS} for submitting`);
    const late = render(submittedReport({ onTimePoints: 0 }), { readOnly: true });
    expect(late).toContain("Submitted after October 10, 2026, so no on-time points.");
  });

  it("lists the saved answer for every item in a read-only view, with no inputs", () => {
    const html = render(submittedReport(), { readOnly: true });
    expect(html).toContain('data-report-readonly=""');
    expect(html).not.toContain("<select");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<fieldset");
    expect(html).not.toContain("Choose");
    expect(html).not.toContain("Not answered");
    for (const item of pointItems) {
      expect(html).toContain(`<dt>${item.label}</dt><dd>${points[item.key]}</dd>`);
    }
    expect(html).toContain("Camping Skills I (6 participating)");
    expect(html).toContain("Fellowship hall");
    expect(html).toContain("Dana Synthetic");
  });

  it("loads the saved answers into the editable form too", () => {
    const html = render(submittedReport(), { readOnly: false });
    expect(html).not.toContain("Not answered");
    // The selects start on the saved values, not on "Choose".
    expect(html.match(/<option value="25" selected=""/g)?.length ?? 0).toBeGreaterThan(0);
    expect(html).toContain("<select");
  });
});
