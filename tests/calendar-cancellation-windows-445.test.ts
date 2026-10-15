import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ getPrisma: vi.fn() }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));

import { cancellationWindowsOf } from "@/modules/calendar/event-links";

describe("cancellation windows read for the Update preview (#445)", () => {
  it("reads each window's label and last day from the current policy's rules", () => {
    const rules = {
      schema: 1,
      windows: [
        { id: "full", label: "Full refund", endsOn: "2026-10-01", terms: {} },
        { id: "half", label: "Half refund", endsOn: "2026-10-20", terms: {} },
      ],
      afterWindows: { label: "No refund", terms: {} },
    };
    expect(cancellationWindowsOf(rules)).toEqual([
      { label: "Full refund", endsOn: "2026-10-01" },
      { label: "Half refund", endsOn: "2026-10-20" },
    ]);
  });

  it("never fails on a policy it can't read: nothing, a window without a date, or the wrong shape", () => {
    expect(cancellationWindowsOf(null)).toEqual([]);
    expect(cancellationWindowsOf({})).toEqual([]);
    expect(cancellationWindowsOf({ windows: "soon" })).toEqual([]);
    expect(cancellationWindowsOf({ windows: [null, { label: "No date" }, { label: "Bad", endsOn: "10/01/2026" }, { endsOn: "2026-10-05" }] }))
      .toEqual([{ label: "Window", endsOn: "2026-10-05" }]);
  });
});
