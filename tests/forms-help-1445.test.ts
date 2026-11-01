// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

import { ClubPortalMastheadView, clubMastheadModel } from "@/components/club-portal-masthead-view";
import { FormsHelp, FormsHelpSections } from "@/components/forms-help";
import { click, flush, mount, type Mounted } from "./helpers/dom-render";

/** The small "Forms help" link and popup (#1445). Synthetic contact data only. */

const contact = { email: "help@example.test", phone: "(515) 555-0100" };
let mounted: Mounted | null = null;

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetParent", { configurable: true, get() {
    // jsdom has no layout: say everything takes up room. Like Chromium, content inside a closed <details> still has an
    // offsetParent, so the hook itself must skip it (#1445 review).
    return this.parentNode;
  } });
  HTMLElement.prototype.getClientRects = function getClientRects() { return [{}] as unknown as DOMRectList; };
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

describe("Forms help content", () => {
  const html = renderToStaticMarkup(createElement(FormsHelpSections, { contact }));
  it("has three sections, all collapsed", () => {
    expect(html.match(/<details/g)).toHaveLength(3);
    expect(html).not.toMatch(/<details[^>]* open/);
    for (const title of ["Having form issues?", "Need translation?", "Need more help?"]) expect(html).toContain(title);
  });
  it("marks Spanish and gives both languages", () => {
    expect(html).toContain('<span lang="es"> / ¿Necesita traducción?</span>');
    expect(html).toContain('lang="es"');
    expect(html).toContain("Safari en iPhone");
    expect(html).toContain("Safari on iPhone:</strong> tap aA, then Translate.");
  });
  it("wraps the contact links in translate=no", () => {
    expect(html).toMatch(/translate="no"[^>]*><p><a href="mailto:help@example.test">/);
    expect(html).toContain('href="tel:+15155550100"');
  });
});

describe("Forms help dialog", () => {
  it("opens from a button, closes on Escape, and returns focus", async () => {
    mounted = await mount(createElement(FormsHelp, { contact }));
    const trigger = document.querySelector<HTMLButtonElement>("[data-forms-help-trigger]")!;
    expect(trigger.type).toBe("button");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    trigger.focus();
    await click(trigger);
    await flush(40);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flush(40);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it("Tab and Shift+Tab wrap inside the collapsed dialog (summaries are focusable)", async () => {
    mounted = await mount(createElement(FormsHelp, { contact }));
    await click(document.querySelector("[data-forms-help-trigger]")!);
    await flush(40);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const stops = Array.from(dialog.querySelectorAll<HTMLElement>("button, summary"));
    expect(stops.map((el) => el.tagName)).toEqual(["BUTTON", "SUMMARY", "SUMMARY", "SUMMARY"]);
    stops[stops.length - 1]!.focus();
    const forward = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    stops[stops.length - 1]!.dispatchEvent(forward);
    await flush(40);
    expect(document.activeElement).toBe(stops[0]);
    const back = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
    stops[0]!.dispatchEvent(back);
    await flush(40);
    expect(document.activeElement).toBe(stops[stops.length - 1]);
  });
  it("close button uses the shared style", () => {
    expect(readFileSync("components/forms-help.tsx", "utf8")).toContain("modal-close-button");
  });
  it("uses the shared dialog hook", () => {
    expect(readFileSync("components/forms-help.tsx", "utf8")).toContain("useAccessibleDialog");
  });
});

describe("Forms help placements", () => {
  it("renders in the club masthead only when given a contact", () => {
    const model = clubMastheadModel({ account: { displayName: "Test Director" }, secondStepPending: false, actingAs: false, clubCount: 1, signOut: "attendee" as never });
    expect(renderToStaticMarkup(createElement(ClubPortalMastheadView, { model, role: "DIRECTOR", formsHelpContact: contact }))).toContain("Forms help");
    expect(renderToStaticMarkup(createElement(ClubPortalMastheadView, { model, role: "DIRECTOR" }))).not.toContain("Forms help");
  });
  it("is wired into the registration page, form, sign-in and login", () => {
    expect(readFileSync("app/(public)/register/[eventSlug]/[formSlug]/page.tsx", "utf8")).toContain("formsHelpContact={formsHelpContact}");
    expect(readFileSync("components/public-registration-form.tsx", "utf8").match(/<FormsHelpRow/g)).toHaveLength(2);
    // The link under Submit sits after the navy submit card, not inside it: navy text on navy is unreadable, and the card
    // hides its own direct-child buttons on phones (#1445 review).
    expect(readFileSync("components/public-registration-form.tsx", "utf8")).toMatch(/<\/section>\s*\{formsHelpContact && <FormsHelpRow contact=\{formsHelpContact\} \/>\}/);
    expect(readFileSync("app/sign-in/page.tsx", "utf8")).toContain("<FormsHelp");
    expect(readFileSync("app/login/page.tsx", "utf8")).toContain("<FormsHelp");
  });
});
