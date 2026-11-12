/* eslint-disable @typescript-eslint/no-explicit-any -- the fake database receives loosely typed Prisma arguments */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #835: a visiting guest club sees and registers for only its own event, and a conference club is unchanged. The fake
 * database answers only the two reads the guest rule makes. Synthetic data only.
 */

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ getPrisma: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));

import { CLUB_EVENT_GATE } from "@/modules/club-registrations/event-gate";
import {
  ClubRegistrationError,
  amendClubRegistration,
  getClubEventWorkspace,
  listClubEvents,
  requireClubEventForClub,
  saveClubRegistrationDraft,
  submitClubRegistration,
} from "@/modules/club-registrations/repository";

const NOW = new Date("2027-03-01T12:00:00Z");
const eventRow = (id: string) => ({
  id, slug: id, name: `Synthetic ${id}`, startsAt: new Date("2027-04-10T15:00:00Z"), endsAt: new Date("2027-04-12T15:00:00Z"), timezone: "America/Chicago",
  location: null, isPublished: true, archivedAt: null, lifecycleState: "OPEN", registrationOpensOn: null, registrationClosesOn: null,
  waitlistEnabled: false, billingMode: "DEFERRED_ORGANIZATION_INVOICE", supportContact: null,
  clubRegistrations: [], clubRegistrationDrafts: [], locations: [], teamSettings: null,
});

let eventsFound: Array<{ id: string }>;
let lastEventWhere: any;
const clubs: Record<string, { guestEventId: string | null }> = {
  guest: { guestEventId: "event-guest" },
  conference: { guestEventId: null },
};

beforeEach(() => {
  eventsFound = [];
  lastEventWhere = null;
  mocks.getPrisma.mockReturnValue({
    organization: { findUnique: vi.fn(async ({ where }: any) => clubs[where.id] ?? null) },
    event: {
      findMany: vi.fn(async ({ where }: any) => { lastEventWhere = where; return eventsFound.filter((event) => !where.id || event.id === where.id).map((event) => eventRow(event.id)); }),
      findFirst: vi.fn(async ({ where }: any) => (where.id === "event-guest" || where.id === "event-other" ? eventRow(where.id) : null)),
    },
    clubRegistrationForm: { findFirst: vi.fn(async () => null) },
    registrationForm: { findFirst: vi.fn(async () => null) },
  });
});

describe("the one gate", () => {
  it("is the published, unarchived, CLUB audience, church-billed event", () => {
    expect(CLUB_EVENT_GATE).toEqual({ isPublished: true, archivedAt: null, audience: "CLUB", billingMode: "DEFERRED_ORGANIZATION_INVOICE" });
  });
});

describe("a guest club's event list (#835)", () => {
  it("asks only for its own event", async () => {
    eventsFound = [{ id: "event-guest" }, { id: "event-other" }];
    await listClubEvents("guest", NOW);
    expect(lastEventWhere).toMatchObject({ ...CLUB_EVENT_GATE, id: "event-guest" });
  });

  it("leaves a conference club's list as it was: every club event, no id filter", async () => {
    await listClubEvents("conference", NOW);
    expect(lastEventWhere).toMatchObject(CLUB_EVENT_GATE);
    expect(lastEventWhere.id).toBeUndefined();
  });
});

describe("a guest club on another event (#835)", () => {
  it("is refused as not found, exactly as a missing event is", async () => {
    await expect(requireClubEventForClub("guest", "event-other")).rejects.toMatchObject({ code: "EVENT_NOT_FOUND" });
    await expect(requireClubEventForClub("guest", "event-other")).rejects.toBeInstanceOf(ClubRegistrationError);
  });

  it("may use its own event, and a conference club may use any club event", async () => {
    await expect(requireClubEventForClub("guest", "event-guest")).resolves.toMatchObject({ id: "event-guest" });
    await expect(requireClubEventForClub("conference", "event-other")).resolves.toMatchObject({ id: "event-other" });
  });

  it("is refused on the workspace, the draft, the registration and the amendment", async () => {
    await expect(getClubEventWorkspace("guest", "event-other", NOW)).rejects.toMatchObject({ code: "EVENT_NOT_FOUND" });
    await expect(saveClubRegistrationDraft("guest", "event-other", { kind: "ACCOUNT", accountId: "acct-1" } as any, { selectedMemberIds: [], guests: [] } as any)).rejects.toMatchObject({ code: "EVENT_NOT_FOUND" });
    await expect(submitClubRegistration("guest", "event-other", { kind: "ACCOUNT", accountId: "acct-1" } as any, {} as any, NOW)).rejects.toMatchObject({ code: "EVENT_NOT_FOUND" });
    await expect(amendClubRegistration("guest", "event-other", { kind: "ACCOUNT", accountId: "acct-1" } as any, {} as any, NOW)).rejects.toMatchObject({ code: "EVENT_NOT_FOUND" });
  });
});
