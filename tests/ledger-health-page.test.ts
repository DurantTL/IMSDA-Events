import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveEventContext: vi.fn(),
  reconcile: vi.fn(),
  getPrisma: vi.fn(() => ({ marker: "prisma" })),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/events/selection", () => ({ resolveEventContext: mocks.resolveEventContext }));
vi.mock("@/modules/ledger/reconciliation", () => ({ reconcileRegistrationLedger: mocks.reconcile }));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/components/access-restricted", () => ({ AccessRestricted: (props: { title: string }) => ({ restricted: props.title }) }));

import LedgerCheckPage, { metadata } from "@/app/(workspace)/more/ledger-health/page";

type Node = { type?: unknown; props?: { children?: unknown } & Record<string, unknown> };
function text(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  const element = node as Node;
  if (typeof element.type === "function") {
    try { return text((element.type as (props: unknown) => unknown)(element.props ?? {})); } catch { return text(element.props?.children); }
  }
  return text(element.props?.children);
}

function hrefs(node: unknown): string[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(hrefs);
  const element = node as Node;
  const own = typeof element.props?.href === "string" ? [element.props.href] : [];
  return [...own, ...hrefs(element.props?.children)];
}

const props = (query: Record<string, string> = {}) => ({ searchParams: Promise.resolve(query) });
const event = { id: "event-1", name: "Synthetic Retreat" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reconcile.mockResolvedValue({ checked: 0, failing: [] });
});

describe("Ledger check page (shadow)", () => {
  it("has the staff page title", () => {
    expect(String(metadata.title)).toBe("Ledger check (shadow)");
  });

  it("shows the restricted notice and reads no ledger data without finance access", async () => {
    for (const permissions of [[], ["VIEW_EVENT"], ["MANAGE_REGISTRATION", "VIEW_SENSITIVE_DATA", "CONFIGURE_EVENT", "MANAGE_FORMS"]]) {
      mocks.resolveEventContext.mockResolvedValue({ event, permissions });
      const result = await LedgerCheckPage(props({ event: "event-1" })) as unknown as { props: { title: string } };
      expect(result.props.title).toBe("Ledger check is restricted");
    }
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("reads only the resolved event for someone with finance access, whatever the query asks", async () => {
    mocks.resolveEventContext.mockResolvedValue({ event, permissions: ["MANAGE_FINANCE"] });
    await LedgerCheckPage(props({ event: "event-2" }));
    expect(mocks.resolveEventContext).toHaveBeenCalledWith("event-2");
    expect(mocks.reconcile).toHaveBeenCalledTimes(1);
    expect(mocks.reconcile).toHaveBeenCalledWith(expect.anything(), { eventId: "event-1" });
  });

  it("says plainly that it changes nothing, and shows a clear empty state", async () => {
    mocks.resolveEventContext.mockResolvedValue({ event, permissions: ["MANAGE_FINANCE"] });
    mocks.reconcile.mockResolvedValue({ checked: 12, failing: [] });
    const copy = text(await LedgerCheckPage(props()));
    expect(copy).toContain("Ledger check (shadow)");
    expect(copy).toContain("changes nothing");
    expect(copy).toContain("The ledger matches every registration.");
    expect(copy).toContain("12 registrations were checked and none differ.");
  });

  it("lists each difference with the confirmation code, dollars and a link to the registration", async () => {
    mocks.resolveEventContext.mockResolvedValue({ event, permissions: ["MANAGE_FINANCE"] });
    mocks.reconcile.mockResolvedValue({
      checked: 3,
      failing: [
        { registrationId: "reg-1", confirmationCode: "REG-AAA", status: "CONFIRMED", expectedCents: 13_000, ledgerCents: 12_345, differenceCents: 655, entryCount: 1, hasNoEntries: false },
        { registrationId: "reg-2", confirmationCode: "REG-BBB", status: "SUBMITTED", expectedCents: 17_500, ledgerCents: 0, differenceCents: 17_500, entryCount: 0, hasNoEntries: true },
      ],
    });
    const page = await LedgerCheckPage(props());
    const copy = text(page);
    expect(copy).toContain("REG-AAA");
    expect(copy).toContain("Current total $130.00");
    expect(copy).toContain("Ledger $123.45");
    expect(copy).toContain("Difference $6.55");
    expect(copy).toContain("No ledger entries");
    expect(copy).toContain("2 of 3 registrations checked");
    expect(hrefs(page)).toContain("/finance?event=event-1&registration=reg-1");
  });

  it("never writes: the page and the check hold no create, update, delete or raw write", () => {
    const root = path.join(__dirname, "..");
    for (const file of ["app/(workspace)/more/ledger-health/page.tsx", "modules/ledger/reconciliation.ts"]) {
      const source = readFileSync(path.join(root, file), "utf8");
      expect(source, file).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(|\$executeRaw|\$transaction|\$queryRawUnsafe/);
    }
  });
});
