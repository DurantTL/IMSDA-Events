import { describe, expect, it } from "vitest";
import { lodgingFormChanged, lodgingFormValuesFor } from "@/modules/lodging/preferences-dirty";
import { groupEditorChanged } from "@/modules/group-registrations/editor-dirty";

describe("lodging form dirty check (#1468, B6)", () => {
  const view = {
    nights: ["2026-07-01", "2026-07-02", "2026-07-03"],
    people: [{}, {}],
    request: { category: "ROOM", firstNight: null, lastNight: null, partySize: 2, roomCount: 1, bringsExtraBedding: false },
  };
  const saved = lodgingFormValuesFor(view);

  it("is clean at the loaded values and uses the defaults without a request", () => {
    expect(lodgingFormChanged({ ...saved }, saved)).toBe(false);
    expect(lodgingFormValuesFor({ ...view, request: null })).toMatchObject({ category: "", firstNight: "2026-07-01", lastNight: "2026-07-03", partySize: 2, roomCount: 1 });
  });

  it("counts a changed lodging type (radio) as dirty and a revert as clean", () => {
    expect(lodgingFormChanged({ ...saved, category: "CABIN" }, saved)).toBe(true);
    expect(lodgingFormChanged({ ...saved, category: "ROOM" }, saved)).toBe(false);
  });

  it("counts nights, party, rooms and bedding", () => {
    for (const change of [{ firstNight: "2026-07-02" }, { lastNight: "2026-07-02" }, { partySize: 1 }, { roomCount: 2 }, { bringsExtraBedding: true }]) {
      expect(lodgingFormChanged({ ...saved, ...change }, saved)).toBe(true);
    }
  });
});

describe("group editor dirty check (#1468, B6)", () => {
  const loaded = {
    attendees: [
      { attendeeId: "a1", clientId: "c1", responses: { firstName: "Ana", notes: "" } },
      { attendeeId: "a2", clientId: "c2", responses: { firstName: "Ben" } },
    ],
    locationId: "loc1",
  };
  const clean = { keptIds: ["a1", "a2"], newPersonCount: 0, locationId: "loc1", answers: {} };

  it("is clean as loaded, including answers the form reports back unchanged", () => {
    expect(groupEditorChanged(clean, loaded)).toBe(false);
    expect(groupEditorChanged({ ...clean, answers: { c1: { firstName: "Ana" }, c2: { firstName: "Ben", notes: null } } }, loaded)).toBe(false);
  });

  it("counts an untick, an added person, a location change and an edited answer", () => {
    expect(groupEditorChanged({ ...clean, keptIds: ["a1"] }, loaded)).toBe(true);
    expect(groupEditorChanged({ ...clean, newPersonCount: 1 }, loaded)).toBe(true);
    expect(groupEditorChanged({ ...clean, locationId: "loc2" }, loaded)).toBe(true);
    expect(groupEditorChanged({ ...clean, answers: { c2: { firstName: "Benny" } } }, loaded)).toBe(true);
  });

  it("is clean again after unticking and re-ticking", () => {
    expect(groupEditorChanged({ ...clean, keptIds: ["a2", "a1"] }, loaded)).toBe(false);
  });
});
