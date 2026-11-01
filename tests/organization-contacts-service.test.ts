import { readFileSync, readdirSync } from "node:fs";
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #977: a church's pastor contact (non-billing), against an in-memory stand-in for the few Prisma
 * calls the service makes. The database constraints (partial unique index, no delete, no rewrite)
 * are asserted on the migration text and proved by CI's migrate. Synthetic data only.
 */
vi.mock("server-only", () => ({}));

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  contacts: [] as Row[],
  billing: [] as Row[],
  audits: [] as Row[],
  organizations: [] as Row[],
  barrier: null as null | { arrive: () => Promise<void> },
}));

const matches = (row: Row, where: Row) => Object.entries(where).every(([key, value]) => row[key] === value);

const fakeDb = {
  organization: {
    findFirst: vi.fn(async ({ where }: { where: Row }) => state.organizations.find((row) => matches(row, where)) ?? null),
  },
  organizationContact: {
    updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      if (state.barrier) await state.barrier.arrive();
      const hit = state.contacts.filter((row) => matches(row, where));
      hit.forEach((row) => Object.assign(row, data));
      return { count: hit.length };
    }),
    create: vi.fn(async ({ data }: { data: Row }) => {
      if (state.contacts.some((row) => row.organizationId === data.organizationId && row.kind === data.kind && row.effectiveTo === null)) {
        throw new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test" });
      }
      const row = { id: `pastor-${state.contacts.length + 1}`, effectiveTo: null, ...data };
      state.contacts.push(row);
      return { id: row.id };
    }),
    findFirst: vi.fn(async ({ where }: { where: Row }) => state.contacts.find((row) => matches(row, where)) ?? null),
    findMany: vi.fn(async ({ where }: { where: { organizationId: string | { in: string[] }; effectiveTo?: null } }) =>
      state.contacts
        .filter((row) => (typeof where.organizationId === "string" ? row.organizationId === where.organizationId : where.organizationId.in.includes(row.organizationId as string)))
        .filter((row) => where.effectiveTo === undefined || row.effectiveTo === null)
        .map((row) => ({ effectiveFrom: new Date("2026-10-01T00:00:00Z"), ...row, createdBy: null, endedBy: null }))),
  },
  organizationBillingContact: {
    findMany: vi.fn(async () => state.billing),
    create: vi.fn(),
    updateMany: vi.fn(),
  },
  auditLog: { create: vi.fn(async ({ data }: { data: Row }) => { state.audits.push({ ...data }); }) },
  $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(fakeDb)),
};
vi.mock("@/lib/prisma", () => ({ getPrisma: () => fakeDb }));

import { AccessDeniedError } from "@/modules/access/authorization";
import { buildRecipientCandidates } from "@/modules/invoices/delivery-domain";
import {
  OrganizationContactError,
  endPastorContact,
  getChurchPastorContactView,
  listDirectoryContacts,
  setPastorContact,
} from "@/modules/organizations/contacts-repository";
import { organizationContactActionSchema, pastorContactInputSchema } from "@/modules/organizations/contacts-schemas";

const admin = { id: "admin-1", globalRole: "SYSTEM_ADMIN" };
const pastor = pastorContactInputSchema.parse({ name: "Pat Pastor", email: "Pastor@Example.test", phone: "(515) 555-0100" });

beforeEach(() => {
  vi.clearAllMocks();
  state.contacts = [];
  state.billing = [];
  state.audits = [];
  state.barrier = null;
  state.organizations = [
    { id: "church-1", type: "CHURCH" },
    { id: "church-2", type: "CHURCH" },
    { id: "company-1", type: "COMPANY" },
  ];
});

describe("pastor contact input", () => {
  it("requires a name, lower-cases and validates email, and keeps email and phone optional", () => {
    expect(pastor).toEqual({ name: "Pat Pastor", email: "pastor@example.test", phone: "(515) 555-0100" });
    expect(pastorContactInputSchema.parse({ name: "Pat" })).toEqual({ name: "Pat", email: null, phone: null });
    expect(pastorContactInputSchema.parse({ name: "Pat", email: "" }).email).toBeNull();
    expect(() => pastorContactInputSchema.parse({ name: "   " })).toThrow();
    expect(() => pastorContactInputSchema.parse({ name: "Pat", email: "not-an-email" })).toThrow();
    expect(() => organizationContactActionSchema.parse({ action: "delete", contactId: "x" })).toThrow();
  });
});

describe("setPastorContact", () => {
  it("adds a pastor, then replaces it keeping the ended row and its actor", async () => {
    await expect(setPastorContact({ organizationId: "church-1", contact: pastor, actor: admin })).resolves.toEqual({ id: "pastor-1", replaced: false });
    const replaced = await setPastorContact({ organizationId: "church-1", contact: { ...pastor, name: "New Pastor" }, actor: { id: "admin-2", globalRole: "SYSTEM_ADMIN" } });
    expect(replaced).toEqual({ id: "pastor-2", replaced: true });
    expect(state.contacts).toHaveLength(2);
    expect(state.contacts.filter((row) => row.effectiveTo === null)).toHaveLength(1);
    expect(state.contacts[0]).toMatchObject({ endedByUserId: "admin-2", endReason: "Replaced by a new pastor contact" });
    expect(state.contacts[1]).toMatchObject({ kind: "PASTOR", createdByUserId: "admin-2" });
    expect(state.audits.map((row) => row.action)).toEqual(["PASTOR_CONTACT_ADDED", "PASTOR_CONTACT_REPLACED"]);
  });

  it("keeps names, emails and phones out of the audit trail", async () => {
    await setPastorContact({ organizationId: "church-1", contact: pastor, actor: admin });
    const text = JSON.stringify(state.audits);
    expect(text).not.toContain("Pat Pastor");
    expect(text).not.toContain("example.test");
    // The phone itself, formatted or as digits: a bare "555" also matches a random correlation UUID.
    expect(text).not.toContain("555-0100");
    expect(text).not.toContain("5155550100");
  });

  it("scopes the previous contact to the organization being changed", async () => {
    await setPastorContact({ organizationId: "church-1", contact: pastor, actor: admin });
    await setPastorContact({ organizationId: "church-2", contact: pastor, actor: admin });
    expect(state.contacts.filter((row) => row.effectiveTo === null).map((row) => row.organizationId)).toEqual(["church-1", "church-2"]);
  });

  it("refuses an organization that is not a church, or does not exist", async () => {
    for (const organizationId of ["company-1", "missing"]) {
      await expect(setPastorContact({ organizationId, contact: pastor, actor: admin })).rejects.toMatchObject({ code: "ORGANIZATION_NOT_ELIGIBLE" });
    }
    expect(state.contacts).toHaveLength(0);
  });

  it("lets exactly one of two concurrent first-time creates win and tells the other to retry", async () => {
    let arrived = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    state.barrier = { arrive: async () => { arrived += 1; if (arrived >= 2) release(); await gate; } };
    const results = await Promise.allSettled([
      setPastorContact({ organizationId: "church-1", contact: pastor, actor: admin }),
      setPastorContact({ organizationId: "church-1", contact: { ...pastor, name: "Other Pastor" }, actor: { id: "admin-2", globalRole: "SYSTEM_ADMIN" } }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(OrganizationContactError);
    expect(lost.reason).toMatchObject({ code: "CONCURRENT_CHANGE" });
    expect(state.contacts.filter((row) => row.effectiveTo === null)).toHaveLength(1);
  });

  it("treats a retry of the same details as already saved: no new row, no end, no audit", async () => {
    await setPastorContact({ organizationId: "church-1", contact: pastor, actor: admin });
    await expect(setPastorContact({ organizationId: "church-1", contact: pastor, actor: admin })).resolves.toEqual({ id: "pastor-1", replaced: false });
    expect(state.contacts).toHaveLength(1);
    expect(state.contacts[0].effectiveTo).toBeNull();
    expect(state.audits).toHaveLength(1);
    await expect(setPastorContact({ organizationId: "church-1", contact: { ...pastor, phone: null }, actor: admin })).resolves.toMatchObject({ replaced: true });
    expect(state.contacts).toHaveLength(2);
  });
});

describe("endPastorContact", () => {
  it("ends the active contact, keeps the row, and refuses a second end", async () => {
    await setPastorContact({ organizationId: "church-1", contact: pastor, actor: admin });
    await endPastorContact({ organizationId: "church-1", contactId: "pastor-1", reason: "Retired.", actor: admin });
    expect(state.contacts).toHaveLength(1);
    expect(state.contacts[0]).toMatchObject({ endedByUserId: "admin-1", endReason: "Retired." });
    expect(state.contacts[0].effectiveTo).toBeInstanceOf(Date);
    expect(state.audits.at(-1)).toMatchObject({ action: "PASTOR_CONTACT_ENDED" });
    await expect(endPastorContact({ organizationId: "church-1", contactId: "pastor-1", actor: admin })).rejects.toMatchObject({ code: "CONTACT_NOT_FOUND" });
  });

  it("will not end another church's contact", async () => {
    await setPastorContact({ organizationId: "church-1", contact: pastor, actor: admin });
    await expect(endPastorContact({ organizationId: "church-2", contactId: "pastor-1", actor: admin })).rejects.toMatchObject({ code: "CONTACT_NOT_FOUND" });
    expect(state.contacts[0].effectiveTo).toBeNull();
  });
});

describe("permissions", () => {
  it("refuses everyone but a system administrator, and changes nothing", async () => {
    await setPastorContact({ organizationId: "church-1", contact: pastor, actor: admin });
    const before = JSON.stringify(state.contacts);
    for (const actor of [{ id: "u" }, { id: "u", globalRole: null }, { id: "u", globalRole: "STAFF" }, { id: "u", globalRole: "FINANCE_MANAGER" }]) {
      await expect(setPastorContact({ organizationId: "church-1", contact: pastor, actor })).rejects.toBeInstanceOf(AccessDeniedError);
      await expect(endPastorContact({ organizationId: "church-1", contactId: "pastor-1", actor })).rejects.toBeInstanceOf(AccessDeniedError);
      await expect(getChurchPastorContactView("church-1", actor)).rejects.toBeInstanceOf(AccessDeniedError);
      await expect(listDirectoryContacts(["church-1"], actor)).rejects.toBeInstanceOf(AccessDeniedError);
    }
    expect(JSON.stringify(state.contacts)).toBe(before);
    expect(state.audits).toHaveLength(1);
  });
});

describe("directory reads", () => {
  it("shows the pastor and the billing contact separately, and the billing path is never written", async () => {
    await setPastorContact({ organizationId: "church-1", contact: pastor, actor: admin });
    state.billing = [{ organizationId: "church-1", name: "Terry Treasurer", roleLabel: "Treasurer", email: "treasurer@example.test" }];
    const contacts = await listDirectoryContacts(["church-1", "church-2"], admin);
    expect(contacts.get("church-1")).toEqual({
      pastor: { name: "Pat Pastor", email: "pastor@example.test", phone: "(515) 555-0100" },
      billing: { name: "Terry Treasurer", roleLabel: "Treasurer", email: "treasurer@example.test" },
    });
    expect(contacts.get("church-2")).toEqual({ pastor: null, billing: null });
    expect(fakeDb.organizationBillingContact.create).not.toHaveBeenCalled();
    expect(fakeDb.organizationBillingContact.updateMany).not.toHaveBeenCalled();
  });

  it("returns the church's pastor history with the active one marked, and nothing for a non-church", async () => {
    await setPastorContact({ organizationId: "church-1", contact: pastor, actor: admin });
    await setPastorContact({ organizationId: "church-1", contact: { ...pastor, name: "Second Pastor" }, actor: admin });
    const view = await getChurchPastorContactView("church-1", admin);
    expect(view?.history).toHaveLength(2);
    expect(view?.active?.name).toBe("Second Pastor");
    expect(await getChurchPastorContactView("company-1", admin)).toBeNull();
  });
});

describe("pastor contact migration (#977)", () => {
  const sql = readFileSync(new URL("../prisma/migrations/20261125100000_organization_contacts/migration.sql", import.meta.url), "utf8")
    .split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n");

  it("allows one active contact per organization and kind, never deletes, and never rewrites", () => {
    expect(sql).toContain('CREATE UNIQUE INDEX "OrganizationContact_one_active_per_organization_kind" ON "OrganizationContact"("organizationId", "kind") WHERE "effectiveTo" IS NULL');
    expect(sql).toContain('BEFORE DELETE ON "OrganizationContact"');
    expect(sql).toContain('BEFORE UPDATE ON "OrganizationContact"');
    expect(sql).toContain("OrganizationContact_text_present");
  });

  it("is additive and leaves the billing contact alone", () => {
    for (const statement of sql.split(/;\s*\n/).map((part) => part.trim()).filter(Boolean)) {
      expect(statement).not.toMatch(/^(DELETE|UPDATE|TRUNCATE|DROP)\b/i);
      if (/^ALTER TABLE/.test(statement)) expect(statement).toMatch(/^ALTER TABLE "OrganizationContact"/);
    }
    expect(sql).not.toContain('"OrganizationBillingContact"');
  });
});

describe("invoice recipients stay billing-only (#977)", () => {
  it("addresses the billing contact for a church that also has a pastor, and never the pastor", async () => {
    await setPastorContact({ organizationId: "church-1", contact: pastor, actor: admin });
    state.billing = [{ organizationId: "church-1", name: "Terry Treasurer", roleLabel: "Treasurer", email: "treasurer@example.test" }];
    const { billing } = (await listDirectoryContacts(["church-1"], admin)).get("church-1")!;
    const candidates = buildRecipientCandidates({ billingContact: billing && { ...billing, verified: true }, directors: [] });
    expect(candidates.map((candidate) => candidate.email)).toEqual(["treasurer@example.test"]);
    expect(candidates[0].kind).toBe("BILLING_CONTACT");
    expect(JSON.stringify(candidates)).not.toContain("pastor@example.test");
    expect(JSON.stringify(candidates)).not.toContain("Pat Pastor");
  });

  it("is not read by any invoice, promo-code, billing-responsibility or communications code", () => {
    const roots = ["invoices", "promo-codes", "billing-responsibility", "communications"];
    for (const root of roots) {
      const dir = new URL(`../modules/${root}/`, import.meta.url);
      for (const file of readdirSync(dir).filter((name) => name.endsWith(".ts"))) {
        expect(readFileSync(new URL(file, dir), "utf8"), `${root}/${file}`).not.toMatch(/\.organizationContact\.|organizations\/contacts-repository|OrganizationContactKind/);
      }
    }
  });
});
