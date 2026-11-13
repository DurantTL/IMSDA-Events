import { describe, expect, it } from "vitest";
import { eventPermissions, type EventPermission } from "@/modules/access/permissions";
import {
  allowedNextStates,
  closesRegistration,
  decideLifecycleTransition,
  effectiveLifecycleState,
  eventLifecycleStateLabel,
  eventLifecycleStates,
  eventLifecycleTransitions,
  isPublicState,
  legacyLifecycleState,
  normalizeLifecycleReason,
  type EventLifecycleStateName,
  rulePermissions,
} from "@/modules/events/lifecycle-state";

const started = { started: true, ended: false };
const ended = { started: true, ended: true };
const notStarted = { started: false, ended: false };
const ARCHIVED_AT = new Date("2026-06-01T00:00:00.000Z");

describe("lifecycle states (#156)", () => {
  it("labels every state in plain language", () => {
    expect(eventLifecycleStates.map(eventLifecycleStateLabel)).toEqual([
      "Draft", "Test", "Published", "Registration closed", "In progress", "Complete", "Financial reconciliation", "Closed", "Archived",
    ]);
  });

  it("makes exactly published through closed public; draft, test and archived are not", () => {
    const publicStates = eventLifecycleStates.filter(isPublicState);
    expect(publicStates).toEqual(["PUBLISHED", "REGISTRATION_CLOSED", "IN_PROGRESS", "COMPLETE", "FINANCIAL_RECONCILIATION", "CLOSED"]);
    expect(isPublicState("DRAFT")).toBe(false);
    expect(isPublicState("TEST")).toBe(false);
    expect(isPublicState("ARCHIVED")).toBe(false);
  });

  it("closes registration only in registration-closed, complete, financial reconciliation and closed", () => {
    expect(eventLifecycleStates.filter(closesRegistration)).toEqual(["REGISTRATION_CLOSED", "COMPLETE", "FINANCIAL_RECONCILIATION", "CLOSED"]);
    expect(closesRegistration("PUBLISHED")).toBe(false);
    expect(closesRegistration("IN_PROGRESS")).toBe(false);
  });
});

describe("effectiveLifecycleState reconciliation", () => {
  const stored = [null, ...eventLifecycleStates.filter((state) => state !== "ARCHIVED")] as const;

  it.each(stored.flatMap((state) => [true, false].flatMap((isPublished) => [null, ARCHIVED_AT].map((archivedAt) => ({ state, isPublished, archivedAt })))))(
    "stored $state, isPublished $isPublished, archivedAt $archivedAt",
    ({ state, isPublished, archivedAt }) => {
      const result = effectiveLifecycleState({ lifecycleState: state, isPublished, archivedAt });
      if (archivedAt) {
        expect(result).toBe("ARCHIVED");
      } else if (state === null) {
        expect(result).toBe(isPublished ? "PUBLISHED" : "DRAFT");
      } else if ((state === "DRAFT" || state === "TEST") && isPublished) {
        expect(result).toBe("PUBLISHED");
      } else if (isPublicState(state) && !isPublished) {
        expect(result).toBe("DRAFT");
      } else {
        expect(result).toBe(state);
      }
    },
  );

  it("never reads a public state when isPublished is false, and never a non-public state when it is true", () => {
    for (const state of stored) {
      expect(isPublicState(effectiveLifecycleState({ lifecycleState: state, isPublished: false, archivedAt: null }))).toBe(false);
      expect(isPublicState(effectiveLifecycleState({ lifecycleState: state, isPublished: true, archivedAt: null }))).toBe(true);
    }
  });

  it("maps legacy events the way the backfill does, archived ones from isPublished", () => {
    expect(legacyLifecycleState({ isPublished: true })).toBe("PUBLISHED");
    expect(legacyLifecycleState({ isPublished: false })).toBe("DRAFT");
    for (const isPublished of [true, false]) {
      expect(legacyLifecycleState({ isPublished })).toBe(effectiveLifecycleState({ lifecycleState: null, isPublished, archivedAt: null }));
    }
  });
});

const allowedTable: Array<[EventLifecycleStateName, EventLifecycleStateName, EventPermission]> = [
  ["DRAFT", "TEST", "CONFIGURE_EVENT"],
  ["DRAFT", "PUBLISHED", "CONFIGURE_EVENT"],
  ["TEST", "DRAFT", "CONFIGURE_EVENT"],
  ["TEST", "PUBLISHED", "CONFIGURE_EVENT"],
  ["PUBLISHED", "DRAFT", "CONFIGURE_EVENT"],
  ["PUBLISHED", "REGISTRATION_CLOSED", "CONFIGURE_EVENT"],
  ["PUBLISHED", "IN_PROGRESS", "CONFIGURE_EVENT"],
  ["PUBLISHED", "COMPLETE", "CONFIGURE_EVENT"],
  ["REGISTRATION_CLOSED", "PUBLISHED", "CONFIGURE_EVENT"],
  ["REGISTRATION_CLOSED", "DRAFT", "CONFIGURE_EVENT"],
  ["REGISTRATION_CLOSED", "IN_PROGRESS", "CONFIGURE_EVENT"],
  ["REGISTRATION_CLOSED", "COMPLETE", "CONFIGURE_EVENT"],
  ["IN_PROGRESS", "COMPLETE", "CONFIGURE_EVENT"],
  ["COMPLETE", "FINANCIAL_RECONCILIATION", "MANAGE_FINANCE"],
  ["FINANCIAL_RECONCILIATION", "CLOSED", "MANAGE_FINANCE"],
  ["CLOSED", "FINANCIAL_RECONCILIATION", "MANAGE_FINANCE"],
];

// The closeout moves (#1515) accept either finance permission: every permission a rule lets through.
const closeoutAnyOf: Array<EventPermission> = ["MANAGE_FINANCE", "FINALIZE_INVOICES"];
const permissionsFor = (rule: { from: EventLifecycleStateName; to: EventLifecycleStateName; permission: EventPermission }) =>
  rule.from === "FINANCIAL_RECONCILIATION" || rule.from === "CLOSED" ? closeoutAnyOf : [rule.permission];

describe("declared transitions", () => {
  it("declares exactly the agreed table", () => {
    expect(eventLifecycleTransitions.map((rule) => [rule.from, rule.to, rule.permission])).toEqual(allowedTable);
  });

  it.each(allowedTable)("%s -> %s needs %s", (from, to, permission) => {
    const accepted = permissionsFor({ from, to, permission });
    for (const held of accepted) expect(decideLifecycleTransition({ from, to, permissions: [held], time: ended, readinessComplete: true }).allowed, held).toBe(true);
    const others = eventPermissions.filter((candidate) => !accepted.includes(candidate));
    const denied = decideLifecycleTransition({ from, to, permissions: others, time: ended, readinessComplete: true });
    expect(denied).toMatchObject({ allowed: false, refusal: { code: "PERMISSION_DENIED", permission } });
    expect(decideLifecycleTransition({ from, to, permissions: [], time: ended, readinessComplete: true }).allowed).toBe(false);
  });

  it("lets either finance permission close out or reopen an event, and nobody else (#1515)", () => {
    for (const [from, to] of [["FINANCIAL_RECONCILIATION", "CLOSED"], ["CLOSED", "FINANCIAL_RECONCILIATION"]] as const) {
      const rule = eventLifecycleTransitions.find((candidate) => candidate.from === from && candidate.to === to)!;
      expect(rulePermissions(rule)).toEqual(["MANAGE_FINANCE", "FINALIZE_INVOICES"]);
      expect(rule.closeoutAction).toBe(from === "CLOSED" ? "REOPEN" : "SIGN_OFF");
      for (const permission of ["MANAGE_FINANCE", "FINALIZE_INVOICES"] as const) {
        expect(decideLifecycleTransition({ from, to, permissions: [permission], time: ended }).allowed, `${from} -> ${to} ${permission}`).toBe(true);
      }
      expect(decideLifecycleTransition({ from, to, permissions: ["CONFIGURE_EVENT", "VIEW_REPORTS", "MANAGE_REGISTRATION"], time: ended })).toMatchObject({ allowed: false, refusal: { code: "PERMISSION_DENIED", permission: "MANAGE_FINANCE" } });
    }
  });

  it("keeps every other rule on its single permission, with no closeout action", () => {
    for (const rule of eventLifecycleTransitions.filter((candidate) => candidate.from !== "FINANCIAL_RECONCILIATION" && candidate.from !== "CLOSED")) {
      expect(rule.anyOf, `${rule.from} -> ${rule.to}`).toBeUndefined();
      expect(rule.closeoutAction, `${rule.from} -> ${rule.to}`).toBeUndefined();
      expect(rulePermissions(rule)).toEqual([rule.permission]);
    }
  });

  it("does not offer the closeout moves as generic next states", () => {
    expect(allowedNextStates({ from: "FINANCIAL_RECONCILIATION", permissions: ["MANAGE_FINANCE", "FINALIZE_INVOICES"], time: ended })).toEqual([]);
    expect(allowedNextStates({ from: "CLOSED", permissions: ["MANAGE_FINANCE", "FINALIZE_INVOICES"], time: ended })).toEqual([]);
  });

  it("refuses every move that is not declared, with UNKNOWN_TRANSITION", () => {
    const declared = new Set(allowedTable.map(([from, to]) => `${from}>${to}`));
    for (const from of eventLifecycleStates) {
      for (const to of eventLifecycleStates) {
        if (declared.has(`${from}>${to}`)) continue;
        const decision = decideLifecycleTransition({ from, to, permissions: [...eventPermissions], time: ended, readinessComplete: true });
        expect(decision, `${from} -> ${to}`).toMatchObject({ allowed: false, refusal: { code: "UNKNOWN_TRANSITION" } });
      }
    }
  });

  it("never reaches ARCHIVED, and closing registration never implies complete or financial closeout", () => {
    expect(eventLifecycleTransitions.some((rule) => rule.to === "ARCHIVED" || rule.from === "ARCHIVED")).toBe(false);
    expect(decideLifecycleTransition({ from: "PUBLISHED", to: "ARCHIVED", permissions: [...eventPermissions], time: ended }).allowed).toBe(false);
    expect(allowedNextStates({ from: "REGISTRATION_CLOSED", permissions: ["CONFIGURE_EVENT"], time: notStarted })).toEqual(["PUBLISHED", "DRAFT"]);
    expect(decideLifecycleTransition({ from: "REGISTRATION_CLOSED", to: "CLOSED", permissions: [...eventPermissions], time: ended }).allowed).toBe(false);
    expect(decideLifecycleTransition({ from: "REGISTRATION_CLOSED", to: "FINANCIAL_RECONCILIATION", permissions: [...eventPermissions], time: ended }).allowed).toBe(false);
  });

  it("explains why a finished event cannot be unpublished", () => {
    for (const from of ["COMPLETE", "FINANCIAL_RECONCILIATION", "CLOSED", "IN_PROGRESS"] as const) {
      const decision = decideLifecycleTransition({ from, to: "DRAFT", permissions: [...eventPermissions], time: ended });
      expect(decision).toMatchObject({ allowed: false, refusal: { code: "UNKNOWN_TRANSITION" } });
    }
  });

  it("holds start and end conditions to the event's own days", () => {
    for (const from of ["PUBLISHED", "REGISTRATION_CLOSED"] as const) {
      expect(decideLifecycleTransition({ from, to: "IN_PROGRESS", permissions: ["CONFIGURE_EVENT"], time: notStarted })).toMatchObject({ allowed: false, refusal: { code: "CONDITION_UNMET", condition: "STARTED" } });
      expect(decideLifecycleTransition({ from, to: "IN_PROGRESS", permissions: ["CONFIGURE_EVENT"], time: started }).allowed).toBe(true);
      expect(decideLifecycleTransition({ from, to: "COMPLETE", permissions: ["CONFIGURE_EVENT"], time: started })).toMatchObject({ allowed: false, refusal: { code: "CONDITION_UNMET", condition: "ENDED" } });
      expect(decideLifecycleTransition({ from, to: "COMPLETE", permissions: ["CONFIGURE_EVENT"], time: ended }).allowed).toBe(true);
    }
    expect(decideLifecycleTransition({ from: "IN_PROGRESS", to: "COMPLETE", permissions: ["CONFIGURE_EVENT"], time: started }).allowed).toBe(false);
    expect(decideLifecycleTransition({ from: "IN_PROGRESS", to: "COMPLETE", permissions: ["CONFIGURE_EVENT"], time: ended }).allowed).toBe(true);
  });

  it("needs the publish checklist for either way into PUBLISHED, but not for reopening registration", () => {
    for (const from of ["DRAFT", "TEST"] as const) {
      expect(decideLifecycleTransition({ from, to: "PUBLISHED", permissions: ["CONFIGURE_EVENT"], time: started, readinessComplete: false })).toMatchObject({ allowed: false, refusal: { code: "READINESS_INCOMPLETE" } });
      expect(decideLifecycleTransition({ from, to: "PUBLISHED", permissions: ["CONFIGURE_EVENT"], time: started, readinessComplete: true }).allowed).toBe(true);
    }
    expect(decideLifecycleTransition({ from: "REGISTRATION_CLOSED", to: "PUBLISHED", permissions: ["CONFIGURE_EVENT"], time: started, readinessComplete: false }).allowed).toBe(true);
  });

  it("lists the next states this actor may take right now", () => {
    expect(allowedNextStates({ from: "DRAFT", permissions: ["CONFIGURE_EVENT"], time: notStarted })).toEqual(["TEST", "PUBLISHED"]);
    expect(allowedNextStates({ from: "DRAFT", permissions: ["VIEW_EVENT"], time: notStarted })).toEqual([]);
    expect(allowedNextStates({ from: "PUBLISHED", permissions: ["CONFIGURE_EVENT"], time: notStarted })).toEqual(["DRAFT", "REGISTRATION_CLOSED"]);
    expect(allowedNextStates({ from: "PUBLISHED", permissions: ["CONFIGURE_EVENT"], time: ended })).toEqual(["DRAFT", "REGISTRATION_CLOSED", "IN_PROGRESS", "COMPLETE"]);
    expect(allowedNextStates({ from: "COMPLETE", permissions: ["CONFIGURE_EVENT"], time: ended })).toEqual([]);
    expect(allowedNextStates({ from: "COMPLETE", permissions: ["MANAGE_FINANCE"], time: ended })).toEqual(["FINANCIAL_RECONCILIATION"]);
    expect(allowedNextStates({ from: "CLOSED", permissions: [...eventPermissions], time: ended })).toEqual([]);
  });

  it("trims the reason and treats blank as none", () => {
    expect(normalizeLifecycleReason("  Rain plan  ")).toBe("Rain plan");
    expect(normalizeLifecycleReason("   ")).toBeNull();
    expect(normalizeLifecycleReason(undefined)).toBeNull();
    expect(normalizeLifecycleReason(null)).toBeNull();
  });
});
