import { describe, expect, it } from "vitest";
import { isChurchTickMode, personPromoView, ticksToRewrite } from "@/modules/promo-codes/church-tick";

const sponsors = { CHURCH: "First Church" };

describe("church tick mode (#961)", () => {
  it("keeps text inputs for an ordinary code, so people can use different codes (#397)", () => {
    const tickMode = isChurchTickMode({ sharedCode: "EARLY", appliedCodes: ["EARLY"], sponsors: {} });
    expect(tickMode).toBe(false);
    for (const isHolder of [true, false]) {
      expect(personPromoView({ tickMode, isHolder, sharedCode: "EARLY", value: "late" })).toBe("INPUT");
    }
  });

  it("keeps text inputs before the code is applied, and while it is not the applied one", () => {
    expect(isChurchTickMode({ sharedCode: "CHURCH", appliedCodes: [], sponsors })).toBe(false);
    expect(isChurchTickMode({ sharedCode: "CHURC", appliedCodes: ["CHURCH"], sponsors })).toBe(false);
    expect(isChurchTickMode({ sharedCode: "", appliedCodes: [""], sponsors })).toBe(false);
  });

  it("gives everyone but the holder a tick for an applied church code", () => {
    const tickMode = isChurchTickMode({ sharedCode: "CHURCH", appliedCodes: ["CHURCH"], sponsors });
    expect(tickMode).toBe(true);
    expect(personPromoView({ tickMode, isHolder: true, sharedCode: "CHURCH", value: "CHURCH" })).toBe("INPUT");
    expect(personPromoView({ tickMode, isHolder: false, sharedCode: "CHURCH", value: "" })).toBe("TICK");
    expect(personPromoView({ tickMode, isHolder: false, sharedCode: "CHURCH", value: " church " })).toBe("TICK");
  });

  it("shows the text input, with the conflict, for someone who carries a different code", () => {
    expect(personPromoView({ tickMode: true, isHolder: false, sharedCode: "CHURCH", value: "EARLY" })).toBe("CONFLICT");
  });

  it("rewrites ticked people when the holder changes or removes the code", () => {
    const values = ["CHURCH", "", "church", "OTHER"];
    expect(ticksToRewrite({ values, holderIndex: 0, nextCode: "NEWCODE" })).toEqual({ indexes: [2, 3], code: "NEWCODE" });
    expect(ticksToRewrite({ values, holderIndex: 0, nextCode: "" })).toEqual({ indexes: [2, 3], code: "" });
    // Nothing to rewrite when everyone already matches, and never the holder or an untouched blank.
    expect(ticksToRewrite({ values: ["CHURCH", "", "CHURCH"], holderIndex: 0, nextCode: "church" })).toEqual({ indexes: [], code: "CHURCH" });
  });
});
