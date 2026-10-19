import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { CancellationRequestPanel } from "@/components/cancellation-request-panel";
import type { RegistrantRequestView } from "@/modules/cancellation-requests/views";

/**
 * #170: the migration is additive and the database itself refuses a decision without a named person and a reason;
 * nothing in the request workflow reaches money, registrations or capacity; the panel says nothing is cancelled. Static
 * checks over the files, because a real database is not part of this suite. Synthetic data only.
 */

const root = path.join(__dirname, "..");
const migrationsDir = path.join(root, "prisma", "migrations");
const folder = "20261109110000_cancellation_requests";
const migration = readFileSync(path.join(migrationsDir, folder, "migration.sql"), "utf8");
const slice1 = "20261108100000";

function read(relative: string) {
  return readFileSync(path.join(root, relative), "utf8");
}

describe("cancellation requests migration (#170)", () => {
  it("sorts after the latest earlier migration, in its own folder", () => {
    const names = readdirSync(migrationsDir).filter((name) => /^\d{14}_/.test(name)).sort();
    expect(names.at(-1)).toBe(folder);
    expect(folder > `${slice1}_`).toBe(true);
  });

  it("is additive: one enum, two tables, two enum values, and nothing that exists is changed", () => {
    expect(migration.match(/CREATE TABLE "/g)).toHaveLength(2);
    expect(migration.match(/CREATE TYPE "/g)).toHaveLength(1);
    expect(migration.match(/ALTER TYPE "MessageTemplateKey" ADD VALUE/g)).toHaveLength(2);
    expect(migration).not.toMatch(/DROP |TRUNCATE|DELETE FROM|UPDATE "/);
    expect(migration).not.toMatch(/ALTER TABLE "(?!CancellationRequest(?:Event)?")/);
    expect(migration).not.toMatch(/REFERENCES "(Registration|Payment|Refund|Person)"/);
  });

  it("makes the database refuse a decision without a named person, a time and a reason", () => {
    expect(migration).toContain('CONSTRAINT "CancellationRequest_decision_has_actor_and_reason"'.replace("CONSTRAINT ", "ADD CONSTRAINT "));
    expect(migration).toContain('"decidedByUserId" IS NOT NULL');
    expect(migration).toContain('"decidedAt" IS NOT NULL');
    expect(migration).toContain("length(btrim(coalesce(\"decisionReason\", ''))) > 0");
  });

  it("allows one open request per registration and scope, and keeps the timeline append-only", () => {
    expect(migration).toMatch(/CREATE UNIQUE INDEX "CancellationRequest_one_open_per_scope"[\s\S]*WHERE "status" IN \('REQUESTED', 'UNDER_REVIEW', 'INFORMATION_NEEDED'\)/);
    expect(migration).toContain('CREATE UNIQUE INDEX "CancellationRequest_registrationId_idempotencyKey_key"');
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "CancellationRequestEvent"');
    expect(migration).toContain('EXECUTE FUNCTION "reject_cancellation_policy_mutation"()');
  });

  it("is removed with its event, timeline first", () => {
    const source = read("modules/events/deletion-repository.ts");
    const timeline = source.indexOf("cancellationRequestEvent.deleteMany");
    const requests = source.indexOf("cancellationRequest.deleteMany");
    const calculations = source.indexOf("cancellationCalculation.deleteMany");
    expect(timeline).toBeGreaterThan(0);
    expect(timeline).toBeLessThan(requests);
    expect(requests).toBeLessThan(calculations);
  });
});

describe("the request workflow never reaches money, registrations or capacity (#170)", () => {
  const files = [
    "modules/cancellation-requests/domain.ts",
    "modules/cancellation-requests/repository.ts",
    "modules/cancellation-requests/api.ts",
    "modules/cancellation-requests/views.ts",
    "modules/cancellation-requests/fingerprint.ts",
  ];

  it("imports no payment, refund, registration-lifecycle, capacity, waitlist or credit module", () => {
    for (const file of files) {
      const source = read(file);
      const imports = [...source.matchAll(/from "(@\/[^"]+)"/g)].map((match) => match[1]);
      for (const specifier of imports) {
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(/payments|refund|credit|capacity|waitlist|lifecycle|registrations\/(?!$)|invoices|square/);
      }
    }
  });

  it("writes only its own tables, the calculation record, audit entries and queued email", () => {
    const source = read("modules/cancellation-requests/repository.ts");
    const writes = [...source.matchAll(/\b(?:tx|db)\.(\w+)\.(create|update|updateMany|upsert|delete|deleteMany)\(/g)].map((match) => `${match[1]}.${match[2]}`);
    expect(new Set(writes)).toEqual(new Set([
      "cancellationRequest.create",
      "cancellationRequest.updateMany",
      "cancellationRequestEvent.create",
    ]));
    expect(source).not.toMatch(/\.(payment|refund|registration|registrationAttendee|waitlistEntry)\.(create|update|updateMany|upsert|delete|deleteMany)\(/);
  });

  it("decides a request in exactly one place, which needs a named user and a reason", () => {
    const source = read("modules/cancellation-requests/repository.ts");
    expect(source.match(/decidedByUserId: user\.id/g)).toHaveLength(1);
    expect(source).toContain("export async function reviewCancellationRequest");
    // No scheduled job, worker or route other than the staff route calls it (the real-database harness in scripts/ is run by hand).
    const callers = ["app", "modules"].flatMap((dir) => walk(path.join(root, dir)))
      .filter((file) => /\.(ts|tsx)$/.test(file) && read(path.relative(root, file)).includes("reviewCancellationRequest("))
      .map((file) => path.relative(root, file).split(path.sep).join("/"));
    expect(callers.sort()).toEqual([
      "app/api/events/[eventId]/cancellation-requests/[requestId]/route.ts",
      "modules/cancellation-requests/repository.ts",
    ]);
  });

  it("sends no staff alert, so there is no switch to read inside a transaction", () => {
    const source = read("modules/cancellation-requests/repository.ts");
    expect(source).not.toContain("isNotificationEnabled");
    expect(read("modules/notifications/catalog.ts")).not.toContain("CANCELLATION_REQUEST");
  });
});

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === ".next") return [];
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

describe("the request panel (#170)", () => {
  const base: RegistrantRequestView = {
    available: true,
    unavailableReason: null,
    allowedScopes: ["FULL_REGISTRATION", "ATTENDEE"],
    attendees: [{ id: "att-1", name: "Avery Synthetic" }],
    components: [],
    requests: [],
    hasOpenRequest: false,
  };

  it("offers the allowed scopes and says sending a request cancels nothing", () => {
    const markup = renderToStaticMarkup(createElement(CancellationRequestPanel, { endpoint: "/api/test", initialView: base }));
    expect(markup).toContain("Ask to cancel");
    expect(markup).toContain("does not cancel anything, refund anything or");
    expect(markup).toContain("The whole registration");
    expect(markup).toContain("One or more attendees");
    expect(markup).not.toContain("Individual items");
    expect(markup).toContain("Show the proposed outcome");
    // Nothing to send until the registrant has seen the outcome.
    expect(markup).not.toContain("Send request for review");
  });

  it("shows an unavailable reason instead of a form", () => {
    const markup = renderToStaticMarkup(createElement(CancellationRequestPanel, { endpoint: "/api/test", initialView: { ...base, available: false, unavailableReason: "Cancellations go through the event team." } }));
    expect(markup).toContain("Cancellations go through the event team.");
    expect(markup).not.toContain("Show the proposed outcome");
  });

  it("lists a request with its status, what staff asked for, and a withdraw button only while it is open", () => {
    const request = {
      id: "req-1", status: "INFORMATION_NEEDED" as const, statusLabel: "Information needed", statusDetail: "The event team needs a little more information.",
      scope: "FULL_REGISTRATION" as const, attendeeNames: [], chargeLabels: [], proposedRefundCents: 15_000, policyVersion: 1,
      createdAt: "2026-05-01T15:00:00.000Z", updatedAt: "2026-05-02T15:00:00.000Z", registrantNote: "Please send the travel dates.", canWithdraw: true,
      timeline: [{ status: "REQUESTED" as const, label: "Requested", at: "2026-05-01T15:00:00.000Z" }],
    };
    const open = renderToStaticMarkup(createElement(CancellationRequestPanel, { endpoint: "/api/test", initialView: { ...base, requests: [request], hasOpenRequest: true } }));
    expect(open).toContain("Information needed");
    expect(open).toContain("Please send the travel dates.");
    expect(open).toContain("Withdraw this request");
    expect(open).toContain("This is not a decision");
    const closed = renderToStaticMarkup(createElement(CancellationRequestPanel, { endpoint: "/api/test", initialView: { ...base, requests: [{ ...request, status: "DECLINED", statusLabel: "Declined", canWithdraw: false, registrantNote: null }] } }));
    expect(closed).toContain("Declined");
    expect(closed).not.toContain("Withdraw this request");
  });
});
