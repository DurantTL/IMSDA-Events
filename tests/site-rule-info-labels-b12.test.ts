import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APPROVED_STATUS_WORDS, HEALTH_LABELS, infoLabelKind, isShortStatusChipWord, requiredHealthColor } from "../scripts/support/site-rule-checks";
import { closeoutStateWords } from "@/modules/events/closeout-domain";
import { versionStateChips } from "@/components/registration-builder/version-state";
import { STATE_LABEL } from "@/modules/system-admin/system-report/model";

const rules = readFileSync(join(__dirname, "..", "docs", "SITE-RULES.md"), "utf8");
const b12 = rules.split("\n").find((line) => line.startsWith("| B12 |")) ?? "";

describe("B12 status words and info labels (Caleb, Nov 7, 2026)", () => {
  it("keeps the eight status words unchanged in the checker", () => {
    expect(APPROVED_STATUS_WORDS).toEqual(["Draft", "Submitted", "Pending payment", "Pending approval", "Confirmed", "Waitlisted", "Cancelled", "Refunded"]);
  });

  it("accepts the info labels", () => {
    for (const chip of ["$350 due", "$1,250.50 due", "Paid in full", "No charge"]) expect(infoLabelKind(chip), chip).toBe("money");
    for (const chip of ["Staff login", "Website account", "Two-step on", "Two-step not set up"]) expect(infoLabelKind(chip), chip).toBe("account");
    for (const chip of ["Published", "Published Nov 6, 2026, 3:36 PM CST", "Published by Sam Example Nov 6, 2026, 3:36 PM CDT", "Active", "Inactive", "No unpublished changes"]) expect(infoLabelKind(chip), chip).toBe("publishing");
    for (const chip of ["OK", "Check soon", "Needs attention", "48 OK", "8 check soon", "3 need attention"]) expect(infoLabelKind(chip), chip).toBe("health");
    for (const chip of ["Unavailable", "Count only", "Not run yet", "9 unavailable", "20 count only"]) expect(infoLabelKind(chip), chip).toBe("reading");
    for (const chip of ["0 of 11 ticked", "11 of 13 ticked"]) expect(infoLabelKind(chip), chip).toBe("progress");
  });

  it("still rejects words that are neither a status word nor an info label", () => {
    for (const chip of ["Pending", "Healthy", "Warning", "Good", "Error", "Okay", "Check later", "Needs attention soon", "Due", "$350", "Paid", "Admin login", "Live", "Disabled", "Staff"]) {
      expect(infoLabelKind(chip), chip).toBeNull();
    }
  });

  it("matches the real casing only", () => {
    for (const chip of ["ok", "check soon", "NEEDS ATTENTION", "staff login", "paid in full", "$350 DUE", "active", "inactive", "unavailable", "count only", "not run yet", "3 Need Attention", "8 OK soon"]) {
      expect(infoLabelKind(chip), chip).toBeNull();
    }
  });

  it("accepts Published only bare or with the date the pages print", () => {
    for (const chip of ["Published soon", "Published anything", "Published Nov 6, 2026", "Published by Nov 6, 2026, 3:36 PM CST extra", "Published 3:36 PM CST", "Published Nov 6, 2026, 3:36 PM UTC"]) {
      expect(infoLabelKind(chip), chip).toBeNull();
    }
  });

  it("checks each part of a chip with a detail after the dot", () => {
    expect(infoLabelKind("Active · 2 chosen")).toBe("publishing");
    expect(infoLabelKind("Active · Not run yet")).toBe("publishing");
    expect(infoLabelKind("Active · Healthy")).toBeNull();
    expect(infoLabelKind("Active · whatever you like")).toBeNull();
    expect(infoLabelKind("Active · OK · Fine")).toBeNull();
  });

  it("requires green, amber (gold) and red (coral) for the three health words, in order of severity", () => {
    expect(HEALTH_LABELS.map((label) => [label.word, label.color])).toEqual([["OK", "green"], ["Check soon", "gold"], ["Needs attention", "coral"]]);
    expect(requiredHealthColor("OK")).toBe("green");
    expect(requiredHealthColor("Check soon")).toBe("gold");
    expect(requiredHealthColor("Needs attention")).toBe("coral");
    expect(requiredHealthColor("48 OK")).toBe("green");
    expect(requiredHealthColor("8 check soon")).toBe("gold");
    expect(requiredHealthColor("3 need attention")).toBe("coral");
    for (const chip of ["Unavailable", "Count only", "Not run yet", "9 unavailable", "20 count only"]) expect(requiredHealthColor(chip), chip).toBe("neutral");
    expect(requiredHealthColor("Confirmed")).toBeNull();
    expect(requiredHealthColor("0 of 11 ticked")).toBeNull();
    expect(requiredHealthColor("Active")).toBeNull();
  });

  it("makes the System report chips use the three health words", () => {
    expect(STATE_LABEL.ok).toBe("OK");
    expect(STATE_LABEL.watch).toBe("Check soon");
    expect(STATE_LABEL.attention).toBe("Needs attention");
  });

  it("uses the same health words in the readiness page and the testers", () => {
    const readiness = readFileSync(join(__dirname, "..", "components", "system-readiness-workspace.tsx"), "utf8");
    expect(readiness).toContain('ok: "OK",');
    expect(readiness).not.toContain("Checked: OK");
    for (const file of ["email-tester-card.tsx", "square-tester-card.tsx"]) {
      const source = readFileSync(join(__dirname, "..", "app", "(workspace)", "admin", "system-report", file), "utf8");
      expect(source, file).toContain('color: "coral", label: "Needs attention"');
      expect(source, file).toContain('color: "gold", label: "Check soon"');
    }
  });

  it("records the split and the ruling in SITE-RULES.md", () => {
    expect(b12).toContain("**Status words:**");
    expect(b12).toContain("**Info labels**");
    for (const text of ['"$350 due"', '"Paid in full"', '"No charge"', '"Staff login"', '"Website account"', '"Two-step on"', '"Two-step not set up"', '"Published"', '"Inactive"', '"No unpublished changes"', '"Unavailable", "Count only", "Not run yet"', '"N of M ticked"', '"N OK", "N check soon", "N need attention", "N unavailable", "N count only"', '"OK", "Check soon", "Needs attention"', "green, amber, red", "Caleb, Nov 7, 2026"]) {
      expect(b12, text).toContain(text);
    }
  });

  it("shows Setup guide as a plain link of at least 44px and the empty homepage state as plain text", () => {
    const dir = join(__dirname, "..", "app", "(workspace)", "admin", "system-report");
    const view = readFileSync(join(dir, "system-report-view.tsx"), "utf8");
    expect(view).toContain('className={`text-link ${styles.guideLink}`}');
    expect(readFileSync(join(dir, "page.module.css"), "utf8")).toMatch(/\.guideLink \{[^}]*min-height: 44px/);
    const site = readFileSync(join(__dirname, "..", "components", "site-content-workspace.tsx"), "utf8");
    expect(site).not.toMatch(/status-chip[^>]*>Nothing published yet/);
    expect(site).toContain("<span>Nothing published yet: visitors see the standard homepage</span>");
  });
});

describe("B12 summary labels and record-status words (#2025 follow-up)", () => {
  it("accepts the summary and info chips in exactly their shapes", () => {
    for (const chip of ["For information"]) expect(infoLabelKind(chip), chip).toBe("reading");
    for (const chip of ["Ticked", "Not ticked"]) expect(infoLabelKind(chip), chip).toBe("progress");
    for (const chip of ["Configured", "Not configured", "3 forms on", "1 form on", "All published", "Nothing paused", "2 of 5 paused", "Nearly full", "Full", "Clash", "Needs grade", "Needs gender, current class"]) expect(infoLabelKind(chip), chip).toBe("summary");
    for (const chip of ["Version 2", "Published (version 3)"]) expect(infoLabelKind(chip), chip).toBe("publishing");
    expect(requiredHealthColor("For information")).toBe("neutral");
  });

  it("still rejects near misses and the old words", () => {
    for (const chip of ["Live (version 1)", "Ready", "Warning", "Blocking", "Disabled", "Enabled", "active", "Could not check", "Could not read ticks", "account disabled", "Needs", "Needs nothing", "Needs grade extra", "Version", "Version two", "forms on", "3 forms off", "ticked", "configured", "not configured", "full", "Clash today", "All published soon"]) {
      expect(infoLabelKind(chip), chip).toBeNull();
    }
  });

  it("uses the agreed words for record statuses on the pages", () => {
    expect(closeoutStateWords).toEqual({ ready: "OK", warning: "Check soon", blocking: "Needs attention" });
    const live = { status: "PUBLISHED", versionNumber: 3 } as never;
    expect(versionStateChips({ versions: [live], selected: live, isHistorical: false, dirty: false }).map((chip) => infoLabelKind(chip.text))).toEqual(["publishing"]);
    const staff = readFileSync(join(__dirname, "..", "components", "staff-workspace.tsx"), "utf8");
    expect(staff).not.toContain("membership.status.toLowerCase()");
    const community = readFileSync(join(__dirname, "..", "components", "community-moderation-workspace.tsx"), "utf8");
    expect(community).toContain('isEnabled ? "Active" : "Inactive"');
  });

  it("records the summary labels and the word changes in SITE-RULES.md", () => {
    for (const text of ['"Configured", "Not configured"', '"For information"', '"Ticked", "Not ticked"', '"Nearly full", "Full", "Clash"', '"All published"', '"Nothing paused"', '"Published (version 2)"', "#2025"]) {
      expect(b12, text).toContain(text);
    }
  });
});

describe("H3 skips the L4 short status word in the shared chip (Caleb, Nov 2026)", () => {
  it("skips a chip that is only the short word", () => {
    for (const text of ["Missing", "missing", "Missing 1 earlier month", "Missing  2 records", "Incomplete"]) expect(isShortStatusChipWord(text), text).toBe(true);
  });

  it("does not skip a real not-set-up sentence", () => {
    for (const text of ["Payments are not set up", "Not configured", "Missing: the billing address has not been entered yet by anyone", "The roster is missing", "Square is not set up yet", "Incomplete setup, ask the office to finish the form now"]) expect(isShortStatusChipWord(text), text).toBe(false);
  });

  it("applies the skip only inside .status-chip, and records it in SITE-RULES.md", () => {
    const checker = readFileSync(join(__dirname, "..", "scripts", "support", "site-rule-checks.ts"), "utf8");
    expect(checker).toContain('element.closest(".status-chip")');
    const h3 = rules.split("\n").find((line) => line.startsWith("| H3 |")) ?? "";
    expect(h3).toContain("short status word");
    expect(h3).toContain("status-chip");
  });
});
