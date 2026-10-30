import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/communications",
  useSearchParams: () => new URLSearchParams(),
}));
import { CommunicationsWorkspace } from "@/components/communications-workspace";
import { CheckInPaymentDue } from "@/components/check-in-payment-due";
import { formatCents } from "@/modules/payments/format-cents";
import { inPersonCardQuote } from "@/modules/payments/in-person-card";
import { NotAvailableForEvent } from "@/components/not-available-for-event";
import { staffSubpageTitle } from "@/components/staff-navigation";
import { isSystemWorkspacePath, systemNavActiveItem } from "@/components/system-navigation";

// Issue #981 batch 3: row and card actions, the event-setup pages inside the staff shell, access messages,
// empty states and the check-in desk. Vitest has no layout engine, so the visual rules are checked in the
// stylesheet and the rendered check is scripts/verify-mobile-layout.ts.
const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const css = read("app/globals.css");

describe("event setup pages sit in the staff workspace (#981 batch 3)", () => {
  it("lives under app/(workspace), with the same URLs, and no longer renders its own page chrome", () => {
    for (const route of ["", "/from-template", "/copy"]) {
      const file = `app/(workspace)/event-setup${route}/page.tsx`;
      expect(existsSync(path.join(process.cwd(), file)), file).toBe(true);
      expect(existsSync(path.join(process.cwd(), `app/event-setup${route}/page.tsx`)), `old ${route}`).toBe(false);
      const source = read(file);
      expect(source).not.toContain("BrandMark");
      expect(source).not.toContain("<h1");
      // The permission checks and redirects are unchanged.
      expect(source).toContain('redirect(await staffLoginRedirectPath())');
      expect(source).toContain('user.globalRole !== "SYSTEM_ADMIN"');
      expect(source).toContain('redirect("/no-access")');
    }
  });

  it("names each page in the topbar and lights the system sidebar entry", () => {
    expect(staffSubpageTitle("/event-setup")).toBe("Create an event");
    expect(staffSubpageTitle("/event-setup/from-template")).toBe("Start from template");
    expect(staffSubpageTitle("/event-setup/copy")).toBe("Copy from a past event");
    for (const route of ["", "/from-template", "/copy"]) {
      const declared = /title: "([^"]+)"/.exec(read(`app/(workspace)/event-setup${route}/page.tsx`))?.[1];
      expect(staffSubpageTitle(`/event-setup${route}`)).toBe(declared);
    }
    expect(isSystemWorkspacePath("/event-setup/copy")).toBe(true);
    expect(isSystemWorkspacePath("/event-setupx")).toBe(false);
    expect(systemNavActiveItem("/event-setup")?.label).toBe("Create an event");
    expect(systemNavActiveItem("/event-setup/from-template")?.label).toBe("Create an event");
    expect(systemNavActiveItem("/event-setup/copy")?.label).toBe("Copy from a past event");
  });
});

describe("row and card actions (#981 batch 3)", () => {
  it("organization cards keep Edit and put the rest, with Delete last and destructive, in a menu", () => {
    const source = read("components/organization-directory-workspace.tsx");
    const actions = source.slice(source.indexOf("<div className={styles.actions}>"));
    expect(actions).toContain("<ActionsMenu");
    expect(actions.indexOf("Edit")).toBeLessThan(actions.indexOf("<ActionsMenu"));
    expect(actions.indexOf("Link provider")).toBeGreaterThan(actions.indexOf("<ActionsMenu"));
    expect(actions.indexOf("Delete")).toBeGreaterThan(actions.indexOf("Club admins"));
    expect(actions).toContain("actions-menu-danger");
    // Delete still opens the confirmation (the delete editor), never deletes directly.
    expect(actions).toContain("onClick={() => beginDelete(organization)}");
  });

  it("registration builder field rows keep one actions menu with Copy, Move up, Move down and Remove", () => {
    const source = read("components/registration-builder/builder-field-row.tsx");
    const row = source.slice(source.indexOf('className="field-actions-menu"'), source.indexOf("</ActionsMenu></div>}"));
    for (const label of ["Copy", "Move up", "Move down", "Remove"]) expect(row).toContain(label);
    // Up and Down stay real buttons with their own names, so they work from the keyboard.
    expect(row).toContain("aria-label={`Move ${field.label} up`}");
    expect(row).toContain("aria-label={`Move ${field.label} down`}");
    expect(row).toContain("openRemoveField(sectionIndex, fieldIndex)");
  });

  it("wraps the live preview step labels instead of cutting them off", () => {
    expect(css).toMatch(/\.preview-step-progress button small \{[^}]*white-space: normal;/);
    expect(css).toMatch(/\.preview-step-progress > div \{ grid-template-columns: repeat\(auto-fit, minmax\(5\.5rem, 1fr\)\)/);
  });

  it("makes the Sterling Volunteers import actions secondary buttons", () => {
    const source = read("components/background-check-import.tsx");
    expect(source).toContain('className="secondary-button" href="/api/admin/background-checks/template"');
    expect(source).toMatch(/className="secondary-button" onClick=\{\(\) => setOpen\(true\)\}[^>]*><Upload/);
    expect(source).not.toContain('className="text-button"');
  });

  it("announcements have one primary action and a menu, with no bare text links", () => {
    const source = read("components/communications-workspace.tsx");
    const cards = source.slice(source.indexOf('<section className="announcement-list">'), source.indexOf('{announcements.length === 0'));
    expect(cards).not.toContain("text-button");
    expect(cards.match(/<ActionsMenu/g)?.length).toBe(2);
    expect(cards).toContain("actions-menu-danger");
  });

  it("calendar entries keep Edit and move Hide, Reset and Remove into a menu", () => {
    const source = read("components/calendar-admin-workspace.tsx");
    const row = source.slice(source.indexOf('<div className="calendar-admin-actions">'), source.indexOf("<CalendarEntryRegistration"));
    expect(row.indexOf("Edit")).toBeLessThan(row.indexOf("<ActionsMenu"));
    expect(row.indexOf("Remove")).toBeGreaterThan(row.indexOf("<ActionsMenu"));
    expect(row).toContain("onClick={() => remove(entry)}");
  });

  it("styles a destructive menu item apart from the others", () => {
    expect(css).toMatch(/\.actions-menu-list \.actions-menu-danger \{ color: var\(--danger/);
  });
});

describe("access messages (#981 batch 3)", () => {
  it("says Not available for this event, without the Permission required eyebrow", () => {
    const html = renderToStaticMarkup(createElement(NotAvailableForEvent, { reason: "Clubs register for Pathfinder events only." }));
    expect(html).toContain("Not available for this event");
    expect(html).toContain("Clubs register for Pathfinder events only.");
    expect(html).not.toContain("Permission required");
  });

  it("uses it for a non-club event on /more/clubs and a closed health window, and keeps the permission state otherwise", () => {
    const clubs = read("app/(workspace)/more/clubs/page.tsx");
    expect(clubs).toContain("if (!allowed && !clubEvent)");
    expect(clubs).toContain("<NotAvailableForEvent");
    expect(clubs).toContain("<AccessRestricted");
    const health = read("app/(workspace)/more/event-health/page.tsx");
    expect(health).toContain('error.code === "WINDOW_CLOSED"');
    expect(health).toContain("Health information is restricted");
  });
});

describe("empty states and the check-in desk (#981 batch 3)", () => {
  it("collapses empty report sections into one line", () => {
    const source = read("app/(workspace)/more/reports/page.tsx");
    expect(source).toContain("emptyCountSections");
    for (const key of ["meals", "housing", "seminars", "childcare", "attendance"]) expect(source).toContain(`report.${key}.length > 0 &&`);
  });

  it("shows the balance as a badge on a roster row with the full wording visible, and in full elsewhere", () => {
    const compact = renderToStaticMarkup(createElement(CheckInPaymentDue, { balanceCents: 52_500, confirmationCode: "TEST-1002", partySize: 3, compact: true }));
    expect(compact).toContain("checkin-due-badge");
    expect(compact).toContain("$525.00");
    expect(compact).toContain("for all 3 people on");
    expect(compact).toContain("Card in Square app:");
    const quote = inPersonCardQuote(52_500)!;
    expect(compact).toContain(`${formatCents(quote.cardTotalCents)}</b>`);
    expect(compact).toContain(`${formatCents(quote.cardFeeCents)}</span> card fee`);
    expect(compact).toContain("Square note:");
    expect(compact).not.toContain("title=");
    expect(compact).not.toContain("Cash or check");
    const single = renderToStaticMarkup(createElement(CheckInPaymentDue, { balanceCents: 52_500, confirmationCode: "TEST-1003", partySize: 1, compact: true }));
    expect(single).not.toContain("people on");
    expect(single).toContain("Square note:");
    const full = renderToStaticMarkup(createElement(CheckInPaymentDue, { balanceCents: 52_500, confirmationCode: "TEST-1002", partySize: 3 }));
    expect(full).toContain("Cash or check");
    const workspace = read("components/check-in-workspace.tsx");
    expect(workspace).toMatch(/<CheckInPaymentDue\s+compact/);
  });

  it("offers one search on the check-in desk: the roster search, with the scanner button only scanning", () => {
    const scanner = read("components/check-in-scanner.tsx");
    expect(scanner).toContain("<strong>Scan an event pass</strong>");
    expect(scanner).not.toContain("Scan or enter");
  });
});

describe("review fixes (#981 batch 3)", () => {
  it("keeps Mark essential for a viewer who may only mark essential, without the manager actions", () => {
    const render = (canManage: boolean, canMarkEssential: boolean) => renderToStaticMarkup(createElement(CommunicationsWorkspace, {
      eventId: "e1",
      eventName: "Synthetic",
      initialAnnouncements: [{
        id: "a1", title: "Synthetic published", body: "Body", status: "PUBLISHED", priority: "NORMAL", publishedAt: "2026-01-01T00:00:00.000Z",
        isEssential: false, pinnedAt: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      }],
      initialView: "announcements",
      canManage,
      canMarkEssential,
    } as never));
    const essentialOnly = render(false, true);
    expect(essentialOnly).toContain("Mark essential");
    expect(essentialOnly).not.toContain("Email active registrations");
    expect(essentialOnly).not.toContain("Send a correction");
    expect(essentialOnly).not.toContain("Pin to timeline");
    const manager = render(true, false);
    expect(manager).toContain("Email active registrations");
    expect(manager).toContain("Send a correction");
    expect(manager).not.toContain("Mark essential");
    expect(render(true, true)).toContain("Mark essential");
  });

  it("opens the new event with a full navigation from both create-from flows", () => {
    const template = read("components/start-from-template.tsx");
    expect(template).toContain("window.location.assign(`/more/event-settings?event=");
    expect(template).not.toContain("router.push");
    const copy = read("components/copy-from-past-event.tsx");
    expect(copy).toContain("window.location.assign(`/more/event-settings?event=");
    expect(copy).not.toMatch(/<Link[^>]*event-settings/);
  });

  it("names each row menu after its row, and returns focus to the trigger after a choice", () => {
    const menu = read("components/actions-menu.tsx");
    expect(menu).toContain("aria-label={ariaLabel}");
    expect(menu).toContain('menu.querySelector("summary")?.focus()');
    expect(read("components/organization-directory-workspace.tsx")).toContain("ariaLabel={`More actions for ${organization.name}`}");
    expect(read("components/calendar-admin-workspace.tsx")).toContain("ariaLabel={`More actions for ${entry.title}`}");
    expect(read("components/communications-workspace.tsx")).toContain("ariaLabel={`More actions for ${announcement.title}`}");
    expect(read("components/registration-builder/builder-field-row.tsx")).toContain("ariaLabel={`Actions for ${field.label}`}");
  });

  it("labels the check-in manual field for what it does, and dims an inactive card without dimming its menu", () => {
    expect(read("components/check-in-scanner.tsx")).toContain("Name, pass or confirmation code");
    expect(read("components/organization-directory-workspace.module.css")).toMatch(/\.organizationCard\.inactive > :not\(\.actions\) \{\s*opacity: 0\.75;/);
  });

  it("gives the template editor no second h1 or main inside the shell", () => {
    const source = read("app/(workspace)/admin/event-templates/[templateId]/page.tsx");
    expect(source).not.toContain("<h1");
    expect(source).not.toContain("<main");
    expect(source).toContain("<StaffPageHeader");
  });
});
