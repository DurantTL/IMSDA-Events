import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ getPrisma: vi.fn() }));

import { assertProtectedFieldsUnchanged } from "@/modules/registrations/amendments-repository";

const definition = { sections: [] } as never;

function check(promoCode: unknown) {
  const responses = promoCode === undefined ? { first_name: "Ann" } : { first_name: "Ann", promo_code: promoCode };
  return () => assertProtectedFieldsUnchanged(
    definition,
    {},
    { responses: {}, attendees: [{ clientId: "new-1", responses }] } as never,
    [],
    {} as never,
  );
}

describe("a person added in an amendment takes no promo code (#961)", () => {
  it("refuses a code and points to Payments", () => {
    expect(check("CHURCH")).toThrowError("Use Adjust amount owed in Payments");
  });

  it("allows a missing or blank code", () => {
    expect(check(undefined)).not.toThrow();
    expect(check("  ")).not.toThrow();
  });
});
