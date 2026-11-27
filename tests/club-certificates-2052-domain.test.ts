import { describe, expect, it } from "vitest";
import {
  CERTIFICATE_CODE_ALPHABET,
  CERTIFICATE_NOT_FOUND_MESSAGE,
  certificateActiveKey,
  certificateCheckView,
  certificateRefId,
  formatCertificateCode,
  generateCertificateCode,
  normalizeCertificateCode,
} from "@/modules/club-certificates/domain";

/** Verification numbers and the public check view (#2052), pure. Synthetic data only. */

describe("generating a verification number", () => {
  it("is 8 characters, all from the alphabet without I, L, O and U", () => {
    expect(CERTIFICATE_CODE_ALPHABET).toHaveLength(32);
    for (const banned of "ILOU") expect(CERTIFICATE_CODE_ALPHABET).not.toContain(banned);
    const code = generateCertificateCode((max) => Math.floor(Math.random() * max));
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
  });
  it("uses every position of the alphabet the random source can give", () => {
    let next = 0;
    expect(generateCertificateCode(() => next++ % 32)).toBe("01234567");
    expect(generateCertificateCode(() => 31)).toBe("ZZZZZZZZ");
    expect(generateCertificateCode(() => 0)).toBe("00000000");
  });
});

describe("showing and reading a number", () => {
  it("displays XXXX-XXXX", () => {
    expect(formatCertificateCode("ABCD2345")).toBe("ABCD-2345");
  });
  it("normalizes dashes, spaces, case and look-alikes", () => {
    expect(normalizeCertificateCode("abcd-2345")).toBe("ABCD2345");
    expect(normalizeCertificateCode(" ab cd 23 45 ")).toBe("ABCD2345");
    expect(normalizeCertificateCode("O1Il-0000")).toBe("01110000");
    expect(normalizeCertificateCode("ABCD2345")).toBe("ABCD2345");
  });
  it("returns null for the wrong length, a letter outside the alphabet, junk and non-text", () => {
    for (const bad of ["", "ABCD234", "ABCD23456", "ABCU2345", "ABC!2345", "abcd/2345", "----", "x".repeat(500)]) expect(normalizeCertificateCode(bad)).toBeNull();
    expect(normalizeCertificateCode(undefined)).toBeNull();
    expect(normalizeCertificateCode(12345678)).toBeNull();
  });
  it("round-trips a display number", () => {
    expect(normalizeCertificateCode(formatCertificateCode("7K3M9PQ2"))).toBe("7K3M9PQ2");
  });
});

describe("the one-valid-certificate key", () => {
  it("joins club, person, kind, what and date", () => {
    expect(certificateActiveKey({ organizationId: "club-1", personId: "p1", kind: "HONOR", refId: "h1", completedOn: "2026-10-04" })).toBe("club-1|p1|HONOR|h1|2026-10-04");
  });
  it("reads the honor id or class level out of a candidate key", () => {
    expect(certificateRefId({ key: "h:m1:h1" })).toBe("h1");
    expect(certificateRefId({ key: "c:m1:EXPLORER" })).toBe("EXPLORER");
  });
});

describe("the check view", () => {
  const record = { kind: "HONOR" as const, title: "Archery", completedOn: "2026-10-04", clubName: "Test Pathfinders", voidedAt: null };
  it("gives a genuine certificate only the kind, title, long date and club", () => {
    const view = certificateCheckView(record);
    expect(view).toEqual({ status: "GENUINE", kindLabel: "Honor", title: "Archery", completedOn: "October 4, 2026", clubName: "Test Pathfinders" });
    expect(Object.keys(view).sort()).toEqual(["clubName", "completedOn", "kindLabel", "status", "title"]);
  });
  it("labels a class", () => {
    expect(certificateCheckView({ ...record, kind: "CLASS", title: "Explorer Class" })).toMatchObject({ kindLabel: "Class" });
  });
  it("shows no details for a withdrawn certificate", () => {
    expect(certificateCheckView({ ...record, voidedAt: new Date("2026-11-01T00:00:00Z") })).toEqual({ status: "WITHDRAWN" });
  });
  it("is one answer for a missing record", () => {
    expect(certificateCheckView(null)).toEqual({ status: "NOT_FOUND" });
    expect(CERTIFICATE_NOT_FOUND_MESSAGE).toBe("We couldn't find a certificate with that number. Check the number on the certificate and try again.");
  });
});
