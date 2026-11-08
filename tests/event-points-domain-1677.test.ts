import { describe, expect, it } from "vitest";
import {
  attendancePointsActionSchema,
  basisText,
  evaluateClub,
  isDirectorRole,
  judgePeople,
  parsePointsText,
  type PointsPerson,
  type PointsRule,
} from "@/modules/event-points/domain";

/**
 * #1677: the rules the Area Coordinators voted on Nov 8, 2026, with synthetic people only.
 */

let counter = 0;
const person = (overrides: Partial<PointsPerson> = {}): PointsPerson => {
  counter += 1;
  return { id: `p${counter}`, name: `Sample ${counter}`, role: "Pathfinder", isDirector: false, age: 12, checkedIn: true, marked: false, ...overrides };
};
const registration: PointsRule = { basis: "REGISTRATION", requiresPathfinders: false, points: 1500 };
const checkIn: PointsRule = { basis: "CHECK_IN", requiresPathfinders: false, points: 1500 };
const camporee: PointsRule = { basis: "CHECK_IN", requiresPathfinders: true, points: 1500 };
const club = (people: PointsPerson[], override: { outcome: "AWARD" | "WITHHOLD"; reason: string } | null = null) => ({ people, override });

describe("directors and staff count whatever other role they hold", () => {
  it("counts a staff member and a director typed as something else", () => {
    const staff = person({ role: "Staff", age: 40 });
    const director = person({ role: "TLT", isDirector: true, age: 30 });
    const verdict = evaluateClub(registration, club([staff, director]));
    expect(verdict.leaders).toBe(2);
    expect(verdict.earns).toBe(true);
    expect(verdict.points).toBe(1500);
  });

  it("still counts a director who is also an Area Coordinator, even if marked as a coordinator's child", () => {
    const both = person({ role: "Staff", age: 45, marked: true });
    const judged = judgePeople([both], "REGISTRATION")[0]!;
    expect(judged).toMatchObject({ kind: "leader", counted: true });
    expect(judged.reason).toMatch(/whatever other role/);
  });
});

describe("TLTs count, with a supervising adult if under 18", () => {
  it("counts a TLT who is 18 or older on their own", () => {
    const verdict = evaluateClub(registration, club([person({ role: "TLT", age: 18 })]));
    expect(verdict.tlts).toBe(1);
    expect(verdict.earns).toBe(true);
  });

  it("counts a TLT under 18 only with a supervising adult present", () => {
    const withAdult = evaluateClub(registration, club([person({ role: "TLT", age: 16 }), person({ role: "Staff", age: 35 })]));
    expect(withAdult.tlts).toBe(1);
    expect(withAdult.people.find((entry) => entry.kind === "tlt")!.reason).toMatch(/supervising adult present/);
    const alone = evaluateClub(registration, club([person({ role: "TLT", age: 16 })]));
    expect(alone.tlts).toBe(0);
    expect(alone.earns).toBe(false);
    expect(alone.people[0]!.reason).toMatch(/no supervising adult/);
  });

  it("does not let a TLT supervise another TLT, and treats an unknown age as under 18", () => {
    const two = evaluateClub(registration, club([person({ role: "TLT", age: 17 }), person({ role: "TLT", age: null })]));
    expect(two.tlts).toBe(0);
    expect(two.people[1]!.reason).toMatch(/age not known/);
  });

  it("needs the supervising adult to be present on a check-in event", () => {
    const supervisorAbsent = evaluateClub(checkIn, club([person({ role: "TLT", age: 16 }), person({ role: "Staff", age: 35, checkedIn: false })]));
    expect(supervisorAbsent.tlts).toBe(0);
    expect(supervisorAbsent.earns).toBe(false);
  });
});

describe("an Area Coordinator's child does not count", () => {
  it("leaves a marked Pathfinder out, so a club with only that child earns nothing", () => {
    const verdict = evaluateClub(registration, club([person({ marked: true })]));
    expect(verdict.pathfinders).toBe(0);
    expect(verdict.earns).toBe(false);
    expect(verdict.people[0]!.reason).toMatch(/Area Coordinator's child/);
    expect(verdict.computed.reason).toBe("No points: nobody counted as representing the club.");
  });

  it("leaves a marked TLT out too, and the rest of the club still counts", () => {
    const verdict = evaluateClub(registration, club([person({ role: "TLT", age: 19, marked: true }), person({ role: "Pathfinder" })]));
    expect(verdict.tlts).toBe(0);
    expect(verdict.pathfinders).toBe(1);
    expect(verdict.earns).toBe(true);
  });
});

describe("camporee points need Pathfinders present", () => {
  it("gives leaders alone no points when the event needs Pathfinders", () => {
    const verdict = evaluateClub(camporee, club([person({ role: "Staff", age: 40 }), person({ role: "TLT", age: 19 })]));
    expect(verdict.earns).toBe(false);
    expect(verdict.computed.reason).toBe("No points: this event needs Pathfinders present, and only leaders and TLTs counted.");
  });

  it("pays when a Pathfinder came, and pays leaders alone when the event doesn't need Pathfinders", () => {
    expect(evaluateClub(camporee, club([person({ role: "Staff", age: 40 }), person({ role: "Pathfinder" })])).earns).toBe(true);
    expect(evaluateClub({ ...camporee, requiresPathfinders: false }, club([person({ role: "Staff", age: 40 })])).earns).toBe(true);
  });

  it("does not count a marked Pathfinder as the Pathfinder who was present", () => {
    expect(evaluateClub(camporee, club([person({ role: "Staff", age: 40 }), person({ marked: true })])).earns).toBe(false);
  });

  it("does not count a child who is not a Pathfinder", () => {
    const verdict = evaluateClub(camporee, club([person({ role: "Staff", age: 40 }), person({ role: "Child", age: 6 })]));
    expect(verdict.earns).toBe(false);
    expect(verdict.people[1]!.reason).toBe("Child, not a Pathfinder.");
  });
});

describe("check-in against registration", () => {
  const people = () => [person({ role: "Staff", age: 40, checkedIn: true }), person({ role: "Pathfinder", checkedIn: false })];

  it("counts only people who checked in when the event used check-in", () => {
    const verdict = evaluateClub(checkIn, club(people()));
    expect(verdict.registered).toBe(2);
    expect(verdict.present).toBe(1);
    expect(verdict.leaders).toBe(1);
    expect(verdict.pathfinders).toBe(0);
    expect(verdict.people[1]!.reason).toBe("Registered but not checked in.");
  });

  it("counts everyone registered when the event did not use check-in", () => {
    const verdict = evaluateClub(registration, club(people().map((entry) => ({ ...entry, checkedIn: false }))));
    expect(verdict.present).toBe(2);
    expect(verdict.pathfinders).toBe(1);
  });

  it("says nobody checked in when a registered club has no check-ins", () => {
    const verdict = evaluateClub(checkIn, club(people().map((entry) => ({ ...entry, checkedIn: false }))));
    expect(verdict.earns).toBe(false);
    expect(verdict.computed.reason).toBe("No points: 2 people registered, nobody checked in.");
  });
});

describe("a person with no role", () => {
  it("is not counted, and the reason says why", () => {
    const verdict = evaluateClub(registration, club([person({ role: null })]));
    expect(verdict.earns).toBe(false);
    expect(verdict.people[0]!.reason).toBe("No role on the registration.");
  });
});

describe("staff override", () => {
  it("awards a club the rules refused, with the reason on the result", () => {
    const verdict = evaluateClub(camporee, club([person({ role: "Staff", age: 40 })], { outcome: "AWARD", reason: "Pathfinders arrived late." }));
    expect(verdict.computed.earns).toBe(false);
    expect(verdict.earns).toBe(true);
    expect(verdict.points).toBe(1500);
    expect(verdict.reason).toBe("Staff awarded the points: Pathfinders arrived late.");
  });

  it("withholds points from a club the rules paid", () => {
    const verdict = evaluateClub(registration, club([person()], { outcome: "WITHHOLD", reason: "Left before the program." }));
    expect(verdict.computed.earns).toBe(true);
    expect(verdict.earns).toBe(false);
    expect(verdict.points).toBe(0);
    expect(verdict.reason).toBe("Staff withheld the points: Left before the program.");
  });
});

describe("the points typed and sent", () => {
  it("reads 1,500 and plain numbers, and explains anything else", () => {
    expect(parsePointsText("1,500")).toEqual({ ok: true, points: 1500 });
    expect(parsePointsText(" 250 ")).toEqual({ ok: true, points: 250 });
    expect(parsePointsText("")).toMatchObject({ ok: false });
    expect(parsePointsText("12.5")).toMatchObject({ ok: false });
    expect(parsePointsText("0")).toMatchObject({ ok: false, message: "Points must be at least 1." });
    expect(parsePointsText("100001")).toMatchObject({ ok: false });
  });

  it("accepts only the tool's own actions and refuses extra fields", () => {
    expect(attendancePointsActionSchema.safeParse({ action: "saveSettings", points: 1500, requiresPathfinders: true }).success).toBe(true);
    expect(attendancePointsActionSchema.safeParse({ action: "saveSettings", points: 0, requiresPathfinders: true }).success).toBe(false);
    expect(attendancePointsActionSchema.safeParse({ action: "override", organizationId: "c1", outcome: null, reason: "" }).success).toBe(true);
    expect(attendancePointsActionSchema.safeParse({ action: "apply", organizationId: "c1" }).success).toBe(false);
    expect(attendancePointsActionSchema.safeParse({ action: "switch", enabled: true, moduleKey: "merchandise" }).success).toBe(false);
    expect(attendancePointsActionSchema.safeParse({ action: "publish" }).success).toBe(false);
  });
});

describe("director roles and the basis words", () => {
  it("matches only exact director roles on the roster, not any free text containing the word", () => {
    for (const role of ["Director", " club  director ", "Deputy Director", "deputy", "Associate Director", "assistant director", "Co-Director"]) expect(isDirectorRole(role), role).toBe(true);
    for (const role of ["Director of music", "Assistant to the director", "Directory", "", null, "Staff"]) expect(isDirectorRole(role), String(role)).toBe(false);
  });

  it("says how many check-ins were found on the check-in basis", () => {
    expect(basisText("CHECK_IN", 1234)).toBe("Based on check-in (1,234 checked in)");
    expect(basisText("REGISTRATION", 0)).toMatch(/registration/);
  });
});
