import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  orgCount: vi.fn(),
  orgFindMany: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/lib/prisma", () => {
  const client = { organization: { count: mocks.orgCount, findMany: mocks.orgFindMany } };
  return { getPrisma: () => client };
});

import { RESPONSIBLE_ORGANIZATION_TYPES } from "@/modules/billing-responsibility/domain";
import { ORGANIZATION_PICKER_PAGE_SIZE, searchResponsibleOrganizations } from "@/modules/billing-responsibility/repository";
import { DESK_PEOPLE_PAGE_SIZE, searchDeskPeople } from "@/modules/issued-assets/view";
import { activeRegistrationStatuses } from "@/modules/events/lifecycle";
import { parsePageParam, sliceFromCount } from "@/lib/pagination";

describe("empty billing organization search (#1348)", () => {
  beforeEach(() => {
    mocks.orgCount.mockReset();
    mocks.orgFindMany.mockReset();
    mocks.orgFindMany.mockResolvedValue([]);
  });

  it("lists matching organizations by name, one page at a time, with a total", async () => {
    mocks.orgCount.mockResolvedValue(23);
    const result = await searchResponsibleOrganizations("  ", 2);
    expect(result).toMatchObject({ page: 2, pageCount: 3, total: 23 });
    const args = mocks.orgFindMany.mock.calls[0]![0];
    expect(args.skip).toBe(ORGANIZATION_PICKER_PAGE_SIZE);
    expect(args.take).toBe(ORGANIZATION_PICKER_PAGE_SIZE);
    expect(args.orderBy).toEqual([{ name: "asc" }, { id: "asc" }]);
    expect(args.select).toEqual({ id: true, name: true, type: true, city: true });
  });

  it("keeps the scoping: active organizations of the responsible types only, for both the count and the page", async () => {
    mocks.orgCount.mockResolvedValue(1);
    await searchResponsibleOrganizations("", 1);
    const expectedScope = { isActive: true, type: { in: [...RESPONSIBLE_ORGANIZATION_TYPES] } };
    expect(mocks.orgCount.mock.calls[0]![0].where).toMatchObject(expectedScope);
    expect(mocks.orgFindMany.mock.calls[0]![0].where).toMatchObject(expectedScope);
    expect(mocks.orgFindMany.mock.calls[0]![0].where.AND).toEqual([]);
  });

  it("still narrows when a name is typed, and clamps a page past the end", async () => {
    mocks.orgCount.mockResolvedValue(4);
    const result = await searchResponsibleOrganizations("grace church", 99);
    expect(result.page).toBe(1);
    const args = mocks.orgFindMany.mock.calls[0]![0];
    expect(args.skip).toBe(0);
    expect(args.where.AND).toHaveLength(2);
  });

  it("returns an empty first page when nothing matches", async () => {
    mocks.orgCount.mockResolvedValue(0);
    expect(await searchResponsibleOrganizations("", -7)).toEqual({ items: [], page: 1, pageCount: 1, total: 0, from: 0, to: 0 });
  });
});

describe("empty asset desk person lookup (#1348)", () => {
  function fakeClient(total: number) {
    const count = vi.fn().mockResolvedValue(total);
    const findMany = vi.fn().mockResolvedValue([
      { id: "att-1", profileSnapshot: {}, person: { firstName: "Ann", lastName: "Lee" }, registration: { confirmationCode: "ABC123" } },
    ]);
    return { client: { registrationAttendee: { count, findMany } } as never, count, findMany };
  }

  it("lists this event's active-registration attendees by last then first name, paged with a total", async () => {
    const { client, count, findMany } = fakeClient(40);
    const result = await searchDeskPeople("event-1", "  ", client, 3);
    expect(result).toMatchObject({ page: 3, pageCount: 3, total: 40, items: [{ attendeeId: "att-1", name: "Ann Lee", confirmationCode: "ABC123" }] });
    const scope = { eventId: "event-1", registration: { status: { in: [...activeRegistrationStatuses] } } };
    expect(count.mock.calls[0]![0].where).toEqual(scope);
    const args = findMany.mock.calls[0]![0];
    expect(args.where).toEqual(scope);
    expect(args.skip).toBe(2 * DESK_PEOPLE_PAGE_SIZE);
    expect(args.take).toBe(DESK_PEOPLE_PAGE_SIZE);
    expect(args.orderBy).toEqual([{ person: { lastName: "asc" } }, { person: { firstName: "asc" } }, { id: "asc" }]);
  });

  it("returns only the id, name and confirmation code, as before", async () => {
    const { client } = fakeClient(1);
    const result = await searchDeskPeople("event-1", "", client);
    expect(Object.keys(result.items[0]!).sort()).toEqual(["attendeeId", "confirmationCode", "name"]);
  });

  it("still narrows by name or confirmation code and keeps the same scoping", async () => {
    const { client, findMany } = fakeClient(1);
    await searchDeskPeople("event-1", "lee", client);
    const where = findMany.mock.calls[0]![0].where;
    expect(where.eventId).toBe("event-1");
    expect(where.registration).toEqual({ status: { in: [...activeRegistrationStatuses] } });
    expect(where.OR).toHaveLength(3);
  });

  it("clamps a bad page", async () => {
    const { client, findMany } = fakeClient(5);
    const result = await searchDeskPeople("event-1", "", client, 500);
    expect(result.page).toBe(1);
    expect(findMany.mock.calls[0]![0].skip).toBe(0);
  });
});

describe("page helpers", () => {
  it("parses a page parameter into a valid page", () => {
    expect(parsePageParam(null)).toBe(1);
    expect(parsePageParam("")).toBe(1);
    expect(parsePageParam("abc")).toBe(1);
    expect(parsePageParam("-4")).toBe(1);
    expect(parsePageParam("0")).toBe(1);
    expect(parsePageParam("2.5")).toBe(1);
    expect(parsePageParam("3")).toBe(3);
    expect(parsePageParam("999999999")).toBe(100_000);
    expect(parsePageParam("99999999999999999999")).toBe(1);
  });

  it("builds a slice for a list paged on the server", () => {
    expect(sliceFromCount(["a", "b"], 3, 22, 10)).toEqual({ items: ["a", "b"], page: 3, pageCount: 3, total: 22, from: 21, to: 22 });
    expect(sliceFromCount([], 1, 0, 10)).toMatchObject({ pageCount: 1, from: 0, to: 0 });
  });
});
