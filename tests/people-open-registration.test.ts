import { describe, expect, it } from "vitest";
import type { RegistrationRecord } from "@/modules/registrations/repository";
import { findRegistrationToOpen } from "@/modules/registrations/search";

const record = (id: string) => ({ id }) as RegistrationRecord;

describe("opening a registration by link from a page of search results", () => {
  const rows = [record("on-page-1"), record("on-page-2")];
  const offPage = record("off-page");

  it("opens a row of the list as before", () => {
    expect(findRegistrationToOpen(rows, null, "on-page-2")).toBe(rows[1]);
    expect(findRegistrationToOpen(rows, offPage, "on-page-1")).toBe(rows[0]);
  });

  it("opens the separately loaded off-page record without adding it to the list", () => {
    const before = [...rows];
    expect(findRegistrationToOpen(rows, offPage, "off-page")).toBe(offPage);
    // The list (its rows, its count, Select all) is exactly what it was.
    expect(rows).toEqual(before);
    expect(rows).toHaveLength(2);
    expect(rows).not.toContain(offPage);
  });

  it("opens nothing for another id, or no id", () => {
    expect(findRegistrationToOpen(rows, offPage, "someone-else")).toBeNull();
    expect(findRegistrationToOpen(rows, offPage, undefined)).toBeNull();
    expect(findRegistrationToOpen(rows, null, "off-page")).toBeNull();
  });
});
