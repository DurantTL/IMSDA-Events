import { describe, expect, it, vi } from "vitest";

/**
 * #150 reads the declared responsible adult through `findActiveDeclaredAuthority`. The stand-in client below has only
 * the two models the function may touch; asking it about a household, an account link or anything else throws, so a
 * function that let any of those stand in for a declaration would fail here. Synthetic data only.
 */
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => { throw new Error("no database in this test"); } }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));

import { findActiveDeclaredAuthority } from "@/modules/guardian-authority/repository";

type Authority = { id: string; registrationId: string; adultPersonId: string | null };
type Registration = { status: string; attendeeIds: string[] };

function client(options: { authority: Authority | null; registrations: Record<string, Registration> }) {
  const seen: unknown[] = [];
  const stand = {
    guardianAuthority: {
      findFirst: vi.fn(async (query: { where: { registrationId?: string } }) => {
        seen.push(query);
        return options.authority && query.where.registrationId === options.authority.registrationId ? options.authority : null;
      }),
    },
    registration: {
      findUnique: vi.fn(async ({ where, select }: { where: { id: string }; select: { attendees: { where: { personId: string } } } }) => {
        const registration = options.registrations[where.id];
        if (!registration) return null;
        const personId = select.attendees.where.personId;
        return { status: registration.status, attendees: registration.attendeeIds.includes(personId) ? [{ id: `att-${personId}` }] : [] };
      }),
    },
  };
  // Anything else (household, account, person lookups) is a stand-in for a declaration and is refused.
  const guarded = new Proxy(stand, { get: (target, name: string) => { if (!(name in target)) throw new Error(`The authority read must not touch ${name}`); return target[name as keyof typeof target]; } });
  return { guarded: guarded as never, stand, seen };
}

const live = { reg1: { status: "SUBMITTED", attendeeIds: ["kid", "dad"] } };

describe("the declared responsible adult who may act for a minor (#150)", () => {
  it("returns the ACTIVE declaration's adult when the registration is live and both people are still on it", async () => {
    const { guarded, seen } = client({ authority: { id: "auth-1", registrationId: "reg1", adultPersonId: "dad" }, registrations: live });
    await expect(findActiveDeclaredAuthority(guarded, "event-1", "kid", "reg1")).resolves.toEqual({ id: "auth-1", adultPersonId: "dad" });
    expect(seen[0]).toMatchObject({ where: { eventId: "event-1", registrationId: "reg1", minorPersonId: "kid", state: "ACTIVE" } });
  });

  it("returns nobody for a declaration made on a different registration (a split family)", async () => {
    const { guarded } = client({ authority: { id: "auth-1", registrationId: "reg1", adultPersonId: "dad" }, registrations: { ...live, reg2: { status: "SUBMITTED", attendeeIds: ["kid", "dad"] } } });
    expect(await findActiveDeclaredAuthority(guarded, "event-1", "kid", "reg2")).toBeNull();
  });

  it("returns nobody when nobody is declared, or the registrant chose None of us", async () => {
    expect(await findActiveDeclaredAuthority(client({ authority: null, registrations: live }).guarded, "event-1", "kid", "reg1")).toBeNull();
    expect(await findActiveDeclaredAuthority(client({ authority: { id: "auth-1", registrationId: "reg1", adultPersonId: null }, registrations: live }).guarded, "event-1", "kid", "reg1")).toBeNull();
  });

  it.each([
    ["the registration was cancelled", { reg1: { status: "CANCELLED", attendeeIds: ["kid", "dad"] } }],
    ["the minor was removed from it", { reg1: { status: "SUBMITTED", attendeeIds: ["dad"] } }],
    ["the declared adult was removed from it", { reg1: { status: "SUBMITTED", attendeeIds: ["kid"] } }],
    ["the registration is gone", {}],
  ])("returns nobody once %s: a stale declaration is not authority", async (_label, registrations) => {
    const { guarded } = client({ authority: { id: "auth-1", registrationId: "reg1", adultPersonId: "dad" }, registrations });
    expect(await findActiveDeclaredAuthority(guarded, "event-1", "kid", "reg1")).toBeNull();
  });

  it("counts a waitlisted registration, which is still on the roster", async () => {
    const { guarded } = client({ authority: { id: "auth-1", registrationId: "reg1", adultPersonId: "dad" }, registrations: { reg1: { status: "WAITLISTED", attendeeIds: ["kid", "dad"] } } });
    expect(await findActiveDeclaredAuthority(guarded, "event-1", "kid", "reg1")).toEqual({ id: "auth-1", adultPersonId: "dad" });
  });
});
