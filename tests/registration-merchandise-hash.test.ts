import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => { throw new Error("not used"); } }));

import { submissionHash } from "@/modules/forms/public-repository";
import type { PublicRegistrationInput } from "@/modules/forms/public-domain";

const base: PublicRegistrationInput = { versionId: "version_1", idempotencyKey: "5f1f6f27-0f8f-4f9b-8b37-2b6b6d6f1a11", responses: { a: "b" } };

describe("submission hash with merchandise", () => {
  it("does not change when merchandise is absent or empty", () => {
    const withRoster = { ...base, attendees: [{ clientId: "c1", responses: { x: 1 } }] };
    expect(submissionHash({ ...base, merchandise: [] })).toBe(submissionHash(base));
    expect(submissionHash({ ...withRoster, merchandise: [] })).toBe(submissionHash(withRoster));
  });

  it("includes the shown price, so a different shown price is a different submission", () => {
    const line = { variantId: "v1", quantity: 1 };
    expect(submissionHash({ ...base, merchandise: [{ ...line, shownUnitPriceCents: 2500 }] })).not.toBe(submissionHash({ ...base, merchandise: [{ ...line, shownUnitPriceCents: 3000 }] }));
  });

  it("changes when merchandise is chosen, regardless of line order", () => {
    const a = { variantId: "v1", quantity: 1 };
    const b = { variantId: "v2", quantity: 2 };
    expect(submissionHash({ ...base, merchandise: [a] })).not.toBe(submissionHash(base));
    expect(submissionHash({ ...base, merchandise: [a, b] })).toBe(submissionHash({ ...base, merchandise: [b, a] }));
    expect(submissionHash({ ...base, merchandise: [a] })).not.toBe(submissionHash({ ...base, merchandise: [{ ...a, quantity: 2 }] }));
  });
});
