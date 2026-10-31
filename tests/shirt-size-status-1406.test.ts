import { describe, expect, it } from "vitest";
import { shirtSizeStatus } from "@/modules/merchandise/shirt-size-status";

describe("shirt size status (#1406)", () => {
  it("shows the confirmation date when confirmed", () => {
    expect(shirtSizeStatus({ shirtSize: "M" as never, shirtSizeConfirmedAt: "2027-03-05T18:00:00.000Z" })).toEqual({ label: "Confirmed Mar 5, 2027", isConfirmed: true });
  });
  it("shows a size chosen on the form as chosen, styled as confirmed", () => {
    expect(shirtSizeStatus({ shirtSize: "L" as never, shirtSizeConfirmedAt: null })).toEqual({ label: "Chosen on the form", isConfirmed: true });
  });
  it("asks for confirmation when no size is chosen", () => {
    expect(shirtSizeStatus({ shirtSize: null, shirtSizeConfirmedAt: null })).toEqual({ label: "Needs confirmation", isConfirmed: false });
  });
});
