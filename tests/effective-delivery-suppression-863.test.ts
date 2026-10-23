import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  findActiveAddressSuppressions,
  resolveRecipientDelivery,
  suppressionLabel,
} from "@/modules/communications/effective-delivery";

describe("the recipient decision (#863)", () => {
  it("is pure: an active suppression blocks, none allows", () => {
    expect(resolveRecipientDelivery(null)).toEqual({ deliverable: true });
    const blocked = resolveRecipientDelivery({ reason: "COMPLAINT", suppressedAt: new Date("2026-10-23T00:00:00Z") });
    expect(blocked).toMatchObject({ deliverable: false, reason: "ADDRESS_SUPPRESSED" });
  });

  it("words the warning the same everywhere", () => {
    expect(suppressionLabel("BOUNCE")).toBe("Not sending: bounced");
    expect(suppressionLabel("COMPLAINT")).toBe("Not sending: complaint");
  });

  it("looks up many addresses at once by their normalized form", async () => {
    const rows = [{ normalizedEmail: "a@example.test", reason: "BOUNCE", suppressedAt: new Date("2026-10-20T00:00:00Z") }];
    const client = { emailAddressSuppression: { findMany: vi.fn(async ({ where }: { where: { normalizedEmail: { in: string[] }; reenabledAt: null } }) => rows.filter((row) => where.normalizedEmail.in.includes(row.normalizedEmail))) } };
    const found = await findActiveAddressSuppressions(client as never, [" A@Example.test", "b@example.test", ""]);
    expect(client.emailAddressSuppression.findMany).toHaveBeenCalledTimes(1);
    expect([...found.keys()]).toEqual(["a@example.test"]);
    expect(found.get("a@example.test")).toMatchObject({ reason: "BOUNCE" });
  });
});
