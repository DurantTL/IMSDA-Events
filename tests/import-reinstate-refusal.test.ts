import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { importReinstateRefusal, importWouldReinstate } from "@/modules/imports/repository";

describe("an import never brings a registration back to life (#880)", () => {
  it("refuses a cancelled or waitlisted registration becoming submitted or confirmed", () => {
    for (const current of ["CANCELLED", "WAITLISTED"]) {
      for (const next of ["SUBMITTED", "CONFIRMED"]) expect(importWouldReinstate(current, next)).toBe(true);
    }
  });

  it("leaves every other status change to the import", () => {
    expect(importWouldReinstate("SUBMITTED", "CONFIRMED")).toBe(false);
    expect(importWouldReinstate("CONFIRMED", "CANCELLED")).toBe(false);
    expect(importWouldReinstate("CANCELLED", "CANCELLED")).toBe(false);
    expect(importWouldReinstate("CANCELLED", "WAITLISTED")).toBe(false);
    expect(importWouldReinstate("DRAFT", "SUBMITTED")).toBe(false);
  });

  it("says why, and where to do it instead", () => {
    const message = importReinstateRefusal("REG-1", "CANCELLED");
    expect(message).toMatch(/REG-1 is cancelled/);
    expect(message).toMatch(/Reactivate or promote it from the registration/);
  });
});
