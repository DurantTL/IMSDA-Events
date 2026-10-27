import { describe, expect, it } from "vitest";
import {
  PEOPLE_PAGE_SIZE,
  mergePeopleCandidates,
  pagePeople,
  parsePeoplePage,
  parsePeopleQuery,
  personPath,
  summarizePeopleAccess,
  type PeopleCandidate,
} from "@/modules/system-admin/people-directory-model";

const staff = (id: string, name: string, linkedId: string | null = null): PeopleCandidate => ({ kind: "staff", id, name, email: `${id}@example.test`, linkedId });
const account = (id: string, name: string, linkedId: string | null = null): PeopleCandidate => ({ kind: "account", id, name, email: `${id}@example.test`, linkedId });

describe("merging staff logins and website accounts (#1275)", () => {
  it("shows a linked pair as one row when both sides match", () => {
    const people = mergePeopleCandidates([staff("u1", "Sam Rivera", "a1")], [account("a1", "Sam R.", "u1")]);
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ staffId: "u1", accountId: "a1", name: "Sam Rivera" });
  });

  it("still shows one row when only the account matched the search", () => {
    const people = mergePeopleCandidates([], [account("a1", "Sam R.", "u1")]);
    expect(people).toEqual([expect.objectContaining({ staffId: "u1", accountId: "a1", key: "u1" })]);
  });

  it("still shows one row when only the staff login matched the search", () => {
    const people = mergePeopleCandidates([staff("u1", "Sam", "a1")], []);
    expect(people).toEqual([expect.objectContaining({ staffId: "u1", accountId: "a1" })]);
  });

  it("keeps unlinked logins and accounts separate, sorted by name then email", () => {
    const people = mergePeopleCandidates(
      [staff("u2", "bea"), staff("u1", "Zed")],
      [account("a2", "Ann"), account("a1", "ann")],
    );
    expect(people.map((person) => person.key)).toEqual(["a1", "a2", "u2", "u1"]);
  });

  it("does not repeat a person listed twice", () => {
    expect(mergePeopleCandidates([staff("u1", "Sam"), staff("u1", "Sam")], [])).toHaveLength(1);
  });

  it("opens the same person from either address", () => {
    const [person] = mergePeopleCandidates([], [account("a1", "Sam", "u1")]);
    expect(personPath(person)).toBe("/admin/people/staff/u1");
    expect(personPath({ staffId: null, accountId: "a9" })).toBe("/admin/people/account/a9");
  });
});

describe("paging (#1275)", () => {
  const items = Array.from({ length: 60 }, (_, index) => index);

  it("has no result cap: every page is reachable", () => {
    const first = pagePeople(items, 1);
    expect(first).toMatchObject({ page: 1, pageCount: 3, total: 60, pageSize: PEOPLE_PAGE_SIZE });
    expect(first.items).toHaveLength(25);
    expect(pagePeople(items, 3).items).toEqual(items.slice(50));
    expect(pagePeople(Array.from({ length: 5000 }, (_, i) => i), 200).items[0]).toBe(4975);
  });

  it("clamps an out-of-range or odd page and handles an empty list", () => {
    expect(pagePeople(items, 99).page).toBe(3);
    expect(pagePeople(items, 0).page).toBe(1);
    expect(pagePeople(items, Number.NaN).page).toBe(1);
    expect(pagePeople([], 4)).toMatchObject({ page: 1, pageCount: 1, total: 0, items: [] });
  });

  it("reads the URL state defensively", () => {
    expect(parsePeoplePage("3")).toBe(3);
    expect(parsePeoplePage("-1")).toBe(1);
    expect(parsePeoplePage("abc")).toBe(1);
    expect(parsePeoplePage(undefined)).toBe(1);
    expect(parsePeopleQuery("  sam  ")).toBe("sam");
    expect(parsePeopleQuery(["a", "b"])).toBe("a");
    expect(parsePeopleQuery("x".repeat(300))).toHaveLength(120);
    expect(parsePeopleQuery(5)).toBe("");
  });
});

describe("access summary (#1275)", () => {
  const none = { systemAdministrator: false, clubsAdministrator: false, areaCoordinator: false, activeEventCount: 0, activeClubRoleCount: 0 };

  it("names system roles and counts events and club roles", () => {
    expect(summarizePeopleAccess({ ...none, systemAdministrator: true, activeEventCount: 3, activeClubRoleCount: 2 }))
      .toEqual(["System administrator", "3 events", "2 club roles"]);
    expect(summarizePeopleAccess({ ...none, clubsAdministrator: true, areaCoordinator: true, activeEventCount: 1, activeClubRoleCount: 1 }))
      .toEqual(["Clubs Administrator", "Area Coordinator", "1 event", "1 club role"]);
  });

  it("is empty when the person has no access", () => {
    expect(summarizePeopleAccess(none)).toEqual([]);
  });
});
