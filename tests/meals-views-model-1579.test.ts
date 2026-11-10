import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mealsViews, type MealsViewKey } from "@/modules/meals/meals-views-model";

const labels = (views: ReturnType<typeof mealsViews>) => views.map((view) => view.label);
const keys = (permissions: string[]) => mealsViews("e", permissions).map((view) => view.key);

describe("mealsViews (#1579)", () => {
  it("gives a viewer with every permission all five pages, in order, with ?event", () => {
    const views = mealsViews("ev 1", ["CONFIGURE_EVENT", "MANAGE_FINANCE", "VIEW_REPORTS", "MANAGE_KITCHEN_COUNTS"], "counts");
    expect(labels(views)).toEqual(["Meals", "Kitchen report", "Kitchen counts", "Scanner results", "Meal closeout"]);
    expect(views.map((view) => view.href)).toEqual([
      "/more/meals?event=ev%201",
      "/more/kitchen-report?event=ev%201",
      "/more/kitchen-report/counts?event=ev%201",
      "/more/kitchen-report/scanner-import?event=ev%201",
      "/more/kitchen-report/closeout?event=ev%201",
    ]);
    expect(views.filter((view) => view.current).map((view) => view.key)).toEqual(["counts"]);
  });

  it("gives a report viewer every page but the closeout", () => {
    expect(keys(["VIEW_REPORTS"])).toEqual(["meals", "kitchen-report", "counts", "scanner"]);
  });

  it("gives finance staff the meals page and the closeout only", () => {
    expect(keys(["MANAGE_FINANCE"])).toEqual(["meals", "closeout"]);
  });

  it("gives an event administrator only the meals page, which a strip renders as nothing", () => {
    expect(keys(["CONFIGURE_EVENT"])).toEqual(["meals"]);
  });

  it("gives kitchen-only staff just the counts page, so their focused entry has no strip", () => {
    expect(keys(["MANAGE_KITCHEN_COUNTS"])).toEqual(["counts"]);
  });

  it("gives other permissions nothing and marks no page current without one", () => {
    expect(keys(["VIEW_SENSITIVE_DATA", "VIEW_EVENT"])).toEqual([]);
    expect(mealsViews("e", ["VIEW_REPORTS"]).some((view) => view.current)).toBe(false);
  });

  it("never lists a page whose own server check the viewer fails", () => {
    // Each page's gate, read from its source, must accept every permission the model lists for it.
    const gates: Record<MealsViewKey, { file: string; permissions: string[] }> = {
      meals: { file: "more/meals/page.tsx", permissions: ["CONFIGURE_EVENT", "MANAGE_FINANCE", "VIEW_REPORTS"] },
      "kitchen-report": { file: "more/kitchen-report/page.tsx", permissions: ["VIEW_REPORTS"] },
      counts: { file: "more/kitchen-report/counts/page.tsx", permissions: ["MANAGE_KITCHEN_COUNTS", "VIEW_REPORTS"] },
      scanner: { file: "more/kitchen-report/scanner-import/page.tsx", permissions: ["VIEW_REPORTS"] },
      closeout: { file: "more/kitchen-report/closeout/page.tsx", permissions: ["MANAGE_FINANCE"] },
    };
    for (const [key, gate] of Object.entries(gates)) {
      const source = readFileSync(join(__dirname, "..", "app/(workspace)", gate.file), "utf8");
      for (const permission of gate.permissions) expect(source, `${key} checks ${permission}`).toContain(`"${permission}"`);
      // Every permission that opens this view is one the page names, and a permission the page never names opens nothing.
      for (const permission of ["CONFIGURE_EVENT", "MANAGE_FINANCE", "VIEW_REPORTS", "MANAGE_KITCHEN_COUNTS"]) {
        expect(keys([permission]).includes(key) === gate.permissions.includes(permission), `${key} for ${permission}`).toBe(true);
      }
    }
  });
});
