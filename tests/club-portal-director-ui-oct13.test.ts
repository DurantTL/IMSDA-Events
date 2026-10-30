import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { BACK_TO_TOP_HIDE_AT, BACK_TO_TOP_SHOW_AT, BackToTopButton, backToTopVisible } from "@/components/back-to-top-button";
import { ClubOrderWorkspace, orderSectionLinks, type ClubOrderWorkspaceData } from "@/components/club-order-workspace";
import { HonorCombobox } from "@/components/honor-combobox";
import { bottomBarTop } from "@/components/fixed-bottom-bars";
import { COMBOBOX_LIST_MAX_HEIGHT, COMBOBOX_LIST_MIN_HEIGHT, comboboxPopoverPlacement } from "@/modules/honors/honor-search";

/**
 * The club director portal's Oct 13 owner request: filter lists that float instead of
 * pushing the page, a written explanation for each Orders button, and Back to top.
 * Markup is the initial render (React renders without a DOM here); the browser side is
 * covered by scripts/verify-mobile-layout.ts. Synthetic data only.
 */

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

const empty: ClubOrderWorkspaceData = { helper: [], batches: [], unmatched: [], awardable: [], waiting: [], firstOrderAt: null };
const renderOrders = (readOnly: boolean, initial = empty) => renderToStaticMarkup(
  createElement(ClubOrderWorkspace, { organizationId: "club-1", initial, stock: [], printHref: "/p", readOnly }),
);

describe("Orders button descriptions", () => {
  it("gives every button a plain sentence, with the same four buttons as before", () => {
    const links = orderSectionLinks(false);
    expect(links.map((link) => link.label)).toEqual(["Order list", "Supplies", "Ready to hand out", "Uniforms"]);
    for (const link of links) {
      expect(link.description.length, link.label).toBeGreaterThan(40);
      expect(link.description.length, link.label).toBeLessThan(220);
      expect(link.description.endsWith("."), link.label).toBe(true);
    }
    expect(new Set(links.map((link) => link.description)).size).toBe(links.length);
  });

  it("describes what each part does today, without jargon", () => {
    const text = (label: string) => orderSectionLinks(true, false).find((link) => link.label === label)?.description ?? "";
    expect(text("Order list")).toMatch(/AdventSource/);
    expect(text("Order list")).toMatch(/export or print/);
    expect(text("Supplies")).toMatch(/already has on hand/);
    expect(text("Supplies")).toMatch(/come off what you need to order/);
    expect(text("Ready to hand out")).toBe("Members whose honor, award or uniform item is already in your supplies. When you give it to them, mark it handed out; it leaves this list and comes off your supplies.");
    expect(text("Uniforms")).toMatch(/who needs which uniform items/i);
    expect(text("Waiting to arrive")).toMatch(/Mark one received/);
    for (const readOnly of [false, true]) {
      for (const link of orderSectionLinks(true, readOnly)) expect(link.description, link.label).not.toMatch(/SKU|backorder|inventory|helper list|sync|CSV|API/i);
    }
  });

  it("describes rather than instructs for a view-only registrar or Area Coordinator", () => {
    const directors = orderSectionLinks(true, false);
    const viewers = orderSectionLinks(true, true);
    expect(viewers.map((link) => link.id)).toEqual(directors.map((link) => link.id));
    for (const link of viewers) {
      expect(link.description, link.label).not.toMatch(/\b(your|you|keep|change|add or remove|mark one|tick|hand it out)\b/i);
      expect(link.description.length, link.label).toBeLessThan(220);
    }
    const text = (label: string) => viewers.find((link) => link.label === label)?.description ?? "";
    expect(text("Ready to hand out")).toMatch(/Once it is given to them it is marked handed out/);
    expect(text("Uniforms")).toMatch(/^Who needs which uniform items\./);
  });

  it("shows each description inside its button, for a director and a view-only registrar", () => {
    for (const readOnly of [false, true]) {
      const html = renderOrders(readOnly);
      const nav = html.slice(html.indexOf('<nav aria-label="Jump to a part of this page"'), html.indexOf("</nav>"));
      for (const link of orderSectionLinks(false, readOnly)) {
        expect(nav).toContain(`href="#${link.id}"`);
        expect(nav).toContain(`<small class="`);
        expect(nav).toContain(link.description.replace(/'/g, "&#x27;"));
      }
      // The green helper notice stays.
      expect(html).toContain("This is a helper to build your list");
      expect(html).toContain('id="club-order-helper-notice"');
    }
  });

  it("lays the buttons out as cards that stack to one column on a phone", () => {
    const css = read("components/club-orders.module.css");
    expect(css).toMatch(/\.jumpNav \{ display: grid; grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 220px\), 1fr\)\)/);
    expect(css).toMatch(/\.jumpHint \{[^}]*overflow-wrap: anywhere/);
  });
});

describe("floating honor and class lists", () => {
  const room = { anchorTop: 300, anchorBottom: 344, boundsTop: 0, boundsBottom: 900 };

  it("opens below the field when the whole list fits there", () => {
    expect(comboboxPopoverPlacement({ ...room, contentHeight: 150 })).toEqual({ side: "below", maxHeight: COMBOBOX_LIST_MAX_HEIGHT });
  });

  it("caps the list at 14rem and lets it scroll inside itself", () => {
    expect(comboboxPopoverPlacement({ ...room, contentHeight: 5000 }).maxHeight).toBe(COMBOBOX_LIST_MAX_HEIGHT);
    expect(COMBOBOX_LIST_MAX_HEIGHT).toBe(224);
  });

  it("flips above the field near the bottom of the screen, and stays on the screen", () => {
    const near = { anchorTop: 700, anchorBottom: 744, boundsTop: 0, boundsBottom: 844 };
    const placed = comboboxPopoverPlacement({ ...near, contentHeight: 600 });
    expect(placed.side).toBe("above");
    // 700px above the field, less the gap and the edge margin, capped at the list's maximum.
    expect(placed.maxHeight).toBe(COMBOBOX_LIST_MAX_HEIGHT);
  });

  it("shrinks to the room left on a small phone, but never below a few rows", () => {
    // A short screen with the field near the top: 420-224-12 = 184 below, 180-12 = 168 above, so it stays below and shrinks.
    const small = comboboxPopoverPlacement({ anchorTop: 180, anchorBottom: 224, boundsTop: 0, boundsBottom: 420, contentHeight: 600 });
    expect(small.side).toBe("below");
    expect(small.maxHeight).toBe(184);
    const cramped = comboboxPopoverPlacement({ anchorTop: 40, anchorBottom: 84, boundsTop: 0, boundsBottom: 130, contentHeight: 600 });
    expect(cramped.maxHeight).toBe(COMBOBOX_LIST_MIN_HEIGHT);
  });

  it("keeps a list inside a dialog by using the dialog's edges as the bounds", () => {
    // The dialog ends at 500px; the field is at 420-464: only 24px below, 400px above.
    const placed = comboboxPopoverPlacement({ anchorTop: 420, anchorBottom: 464, boundsTop: 100, boundsBottom: 500, contentHeight: 300 });
    expect(placed.side).toBe("above");
    expect(placed.maxHeight).toBe(COMBOBOX_LIST_MAX_HEIGHT);
  });

  it("keeps the combobox markup: roles, aria and the listbox, closed, with the placement hook", () => {
    const html = renderToStaticMarkup(createElement(HonorCombobox, {
      allLabel: "All honors", label: "Honor", onChange: () => {}, options: [{ id: "h1", name: "Fixture Honor" }], value: "",
    }));
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('data-placement="below"');
    expect(html).toContain("hidden");
  });

  it("styles the list as an absolute popover over the page, as wide as the field", () => {
    const css = read("app/globals.css");
    expect(css).toMatch(/\.honor-combobox \{ position: relative;/);
    const list = css.match(/^\.honor-combobox-list \{([^}]*)\}/m)?.[1] ?? "";
    expect(list).toContain("position: absolute");
    expect(list).toMatch(/top: 100%/);
    expect(list).toMatch(/right: 0/);
    expect(list).toMatch(/left: 0/);
    expect(list).toMatch(/z-index: 35/);
    expect(list).toContain("overflow-y: auto");
    expect(list).toContain("max-height: 14rem");
    // Below the phone tab bar (z-index 40) and the dialogs (100).
    expect(Number(list.match(/z-index: (\d+)/)?.[1])).toBeLessThan(40);
  });

  it("puts the filter fields of a row on one baseline", () => {
    expect(read("app/globals.css")).toMatch(/\.club-roster-tools:has\(\.honor-combobox\) \{ align-items: flex-end;/);
  });

  it("keeps the honor combobox on the shared 44px search field and the #738 touch-target block", () => {
    const css = read("app/globals.css");
    expect(css).toMatch(/\.honor-combobox \.search-field input \{ font-size:/);
    expect(css).toMatch(/\.search-field \{[^}]*min-height: var\(--touch-target, 44px\)/);
    expect(read("components/honor-combobox.tsx")).toContain('className="search-field"');
    expect(css).toContain("Touch and click targets (#738)");
  });
});

describe("Back to top", () => {
  it("appears after about a screen and a half of scrolling and hides near the top", () => {
    const h = 800;
    expect(BACK_TO_TOP_SHOW_AT).toBe(1.5);
    expect(backToTopVisible(0, h, false)).toBe(false);
    expect(backToTopVisible(h * 1.5, h, false)).toBe(false);
    expect(backToTopVisible(h * 1.5 + 1, h, false)).toBe(true);
    // Once showing, it stays until the person is back within one screen of the top.
    expect(backToTopVisible(h * 1.2, h, true)).toBe(true);
    expect(BACK_TO_TOP_HIDE_AT).toBe(1);
    expect(backToTopVisible(h * 0.9, h, true)).toBe(false);
    expect(backToTopVisible(0, h, true)).toBe(false);
  });

  it("never shows without a measurable screen", () => {
    expect(backToTopVisible(5000, 0, false)).toBe(false);
    expect(backToTopVisible(5000, Number.NaN, true)).toBe(false);
  });

  it("renders nothing until the page has been scrolled (server render, and the top of the page)", () => {
    expect(renderToStaticMarkup(createElement(BackToTopButton))).toBe("");
  });

  it("is a named, 44px, reduced-motion-aware control in the club portal layout", () => {
    const source = read("components/back-to-top-button.tsx");
    expect(source).toContain('aria-label="Back to top"');
    expect(source).toContain('type="button"');
    expect(source).toContain("prefers-reduced-motion: reduce");
    expect(source).toMatch(/behavior: reduced \? "auto" : "smooth"/);
    expect(source).toContain('querySelector<HTMLElement>("main")');
    expect(source).toContain("preventScroll: true");
    const css = read("app/globals.css");
    const rule = css.match(/^\.back-to-top-button \{([^}]*)\}/m)?.[1] ?? "";
    expect(rule).toContain("position: fixed");
    expect(rule).toMatch(/width: 44px/);
    expect(rule).toMatch(/height: 44px/);
    expect(rule).toContain("safe-area-inset-bottom");
    expect(Number(rule.match(/z-index: (\d+)/)?.[1])).toBeLessThan(40);
    expect(css).toMatch(/@media print \{ \.back-to-top-button \{ display: none !important; \} \}/);
    const layout = read("app/(public)/account/(portal)/clubs/[organizationId]/layout.tsx");
    expect(layout).toContain('import { BackToTopButton } from "@/components/back-to-top-button"');
    expect(layout).toContain("<BackToTopButton />");
  });
});

describe("floating controls stay clear of bottom bars", () => {
  const phone = { h: 844, w: 390 };

  it("finds a stuck sticky bar or a fixed tab bar along the bottom, and the highest one", () => {
    // The 67px staff tab bar, and a taller sticky Save classes bar that also reaches the bottom.
    expect(bottomBarTop([{ top: 777, bottom: 844, width: 390 }], phone.h, phone.w)).toBe(777);
    expect(bottomBarTop([{ top: 777, bottom: 844, width: 390 }, { top: 713, bottom: 844, width: 390 }], phone.h, phone.w)).toBe(713);
    expect(bottomBarTop([{ top: 780, bottom: 844, width: 390 }, { top: 700, bottom: 844, width: 390 }], phone.h, phone.w)).toBe(700);
  });

  it("lets a floating control also clear a sticky bar resting just above the bottom edge", () => {
    // Not stuck yet: it ends at 729 of 768, inside the 72px corner the button would sit in.
    const resting = [{ top: 665, bottom: 729, width: 1024 }];
    expect(bottomBarTop(resting, 768, 1024)).toBeNull();
    expect(bottomBarTop(resting, 768, 1024, 768 - 72)).toBe(665);
    // One that ends well above the corner is left alone.
    expect(bottomBarTop([{ top: 600, bottom: 660, width: 1024 }], 768, 1024, 768 - 72)).toBeNull();
  });

  it("ignores things that are not a bottom bar", () => {
    expect(bottomBarTop([], phone.h, phone.w)).toBeNull();
    // A sticky bar that is not stuck (it still sits mid-page), a header, a narrow chip, a full-screen backdrop, and one scrolled off.
    expect(bottomBarTop([
      { top: 500, bottom: 560, width: 390 },
      { top: 0, bottom: 60, width: 390 },
      { top: 790, bottom: 844, width: 120 },
      { top: 0, bottom: 844, width: 390 },
      { top: 844, bottom: 900, width: 390 },
    ], phone.h, phone.w)).toBeNull();
  });

  it("is used by Back to top and by the honor list", () => {
    const back = read("components/back-to-top-button.tsx");
    expect(back).toContain("bottomBarTopOf");
    expect(back).toContain("style={lift > 0 ? { bottom: lift } : undefined}");
    const combo = read("components/honor-combobox.tsx");
    expect(combo).toContain("visibleBottomBarTop()");
    expect(combo).toContain("requestAnimationFrame");
    expect(combo).toContain("event.target === listRef.current");
    expect(combo).toContain('visualViewport?.addEventListener("scroll"');
  });
});
