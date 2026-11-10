import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CommunicationsPage from "@/app/(workspace)/communications/page";
import ScheduledEmailsPage from "@/app/(workspace)/communications/scheduled/page";
import CommunityPage from "@/app/(workspace)/community/page";
import { pageOwnsHeader } from "@/components/page-header-routes";
import { staffPageTitles } from "@/components/staff-navigation";

// #1585: the communications pages are presentation-only redesigns. Synthetic data only; nothing here sends mail, and every
// request the pages could make is absent (the pages are only rendered, never clicked).
const session = vi.hoisted(() => ({ permissions: ["VIEW_EVENT", "MANAGE_COMMUNICATIONS"] as string[] }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ usePathname: () => "/communications", useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams(), redirect: vi.fn() }));
vi.mock("@/modules/events/selection", () => ({
  resolveEventContext: async () => ({
    event: { id: "evt_1", slug: "sample-event", name: "Sample Camp", timezone: "America/Chicago", billingMode: "PER_REGISTRATION" },
    permissions: session.permissions,
  }),
}));
vi.mock("@/components/admin-page-header", () => ({ AdminPageHeader: () => null }));
vi.mock("@/components/contextual-help-slot", () => ({ StaffContextualHelp: () => null }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({}) }));
vi.mock("@/modules/communications/email-layout-settings", () => ({ loadEmailLayoutSettings: async () => ({}) }));
vi.mock("@/modules/communications/messaging-repository", () => ({ getMessagingWorkspace: async () => null }));
vi.mock("@/modules/communications/email-preferences-repository", () => ({ listEventAnnouncementOptOuts: async () => [] }));
vi.mock("@/modules/communications/repository", () => ({ listAnnouncements: async () => [] }));
vi.mock("@/modules/communications/scheduled-email-repository", () => ({ listScheduledEmails: async () => [] }));
vi.mock("@/modules/community/repository", () => ({
  getStaffCommunity: async () => ({
    eventId: "evt_1",
    eventSlug: "sample-event",
    eventName: "Sample Camp",
    settings: { isEnabled: true, allowNewPosts: true, allowReplies: true, conductVersion: 1, conductText: "Be kind to one another at camp.", retentionDays: 30 },
    participantCount: 0,
    posts: [],
    nextPostCursor: null,
    reports: [],
  }),
}));

const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;
const root = join(__dirname, "..");
const read = (file: string) => readFileSync(join(root, file), "utf8");
const search = (params: Record<string, string> = {}) => Promise.resolve(params);

async function render(page: (props: { searchParams: Promise<Record<string, string>> }) => Promise<unknown>, params?: Record<string, string>) {
  return renderToStaticMarkup((await page({ searchParams: search(params) })) as never);
}

beforeEach(() => {
  session.permissions = ["VIEW_EVENT", "MANAGE_COMMUNICATIONS"];
});

describe("each page has one titled header and is registered (#1585)", () => {
  it("registers the three routes as pages that draw their own header", () => {
    for (const route of ["/communications", "/communications/scheduled", "/community"]) expect(pageOwnsHeader(route), route).toBe(true);
  });

  it("draws one h1 in the strip's words on /communications, with the filled New announcement beside it", async () => {
    const markup = await render(CommunicationsPage as never);
    expect(count(markup, /<h1\b/g)).toBe(1);
    expect(markup).toContain(`${staffPageTitles.emails}</h1>`);
    expect(markup).not.toContain("Messages &amp; announcements");
    expect(markup).not.toContain("Event communications");
    expect(markup).toMatch(/page-header-actions[^>]*>\s*<button class="primary-button"[^>]*>[\s\S]*?New announcement/);
    expect(count(markup, /primary-button/g)).toBe(1);
    expect(markup).toContain("Communication tools");
    // The empty state offers the same action, outlined, because the header holds the filled one.
    expect(markup).toMatch(/<button class="secondary-button"[^>]*>New announcement<\/button>/);
  });

  it("shows New announcement only on the announcements view, as before", async () => {
    // A non-announcements view is only reachable with MANAGE_COMMUNICATIONS and needs messaging data; the condition is in the source.
    expect(read("components/communications-workspace.tsx")).toContain('primary={canManage && view === "announcements" ? (');
  });

  it("draws one h1 on /communications/scheduled with New schedule as its one filled button", async () => {
    const markup = await render(ScheduledEmailsPage as never);
    expect(count(markup, /<h1\b/g)).toBe(1);
    expect(markup).toContain(`${staffPageTitles.scheduledEmails}</h1>`);
    expect(count(markup, /primary-button/g)).toBe(1);
    expect(markup).toMatch(/primary-button[^>]*>[\s\S]*?New schedule/);
    expect(markup).toMatch(/<button class="secondary-button"[^>]*>Schedule an email<\/button>/);
  });

  it("draws one h1 on /community, with Attendee preview outlined and no Messages button", async () => {
    const markup = await render(CommunityPage as never);
    expect(count(markup, /<h1\b/g)).toBe(1);
    expect(markup).toContain("Attendee community</h1>");
    expect(markup).not.toContain("Community moderation</h2>");
    expect(markup).not.toContain(">Messages<");
    expect(markup).toMatch(/<a class="secondary-button" href="\/account\/events\/sample-event\?preview=staff">[\s\S]*?Attendee preview/);
    expect(markup).not.toContain("Attendee experience");
    expect(markup).toContain("moderate");
  });
});

describe("restricted roles get one h1 and no manage controls (#1585)", () => {
  it("shows a viewer without VIEW_EVENT a titled restricted state", async () => {
    session.permissions = [];
    const markup = await render(CommunicationsPage as never);
    expect(count(markup, /<h1\b/g)).toBe(1);
    expect(markup).toContain("Emails are restricted");
    expect(markup).not.toContain("New announcement");
  });

  it("shows VIEW_EVENT without MANAGE_COMMUNICATIONS the announcements list with one h1 and no manage controls", async () => {
    session.permissions = ["VIEW_EVENT"];
    const markup = await render(CommunicationsPage as never);
    expect(count(markup, /<h1\b/g)).toBe(1);
    expect(markup).not.toContain("primary-button");
    expect(markup).not.toContain("New announcement");
    expect(markup).not.toContain("Communication tools");
  });

  it("titles the restricted state on the other two pages", async () => {
    session.permissions = ["VIEW_EVENT"];
    for (const [page, title] of [[ScheduledEmailsPage, staffPageTitles.scheduledEmails], [CommunityPage, "Attendee community"]] as const) {
      const markup = await render(page as never);
      expect(count(markup, /<h1\b/g), title).toBe(1);
      expect(markup, title).toContain(`${title}</h1>`);
      expect(markup, title).toContain("restricted");
      expect(markup, title).not.toContain("primary-button");
    }
  });
});

describe("decorative eyebrows are gone and the review steps stay (#1585)", () => {
  const workspace = read("components/communications-workspace.tsx");
  it("removes the eyebrows that only repeat a heading", () => {
    for (const text of ["Feed & email", "Future messages", "Transactional outbox", "Event-level configuration", "Attendee event feed", "Immutable history", "Test the workflow", "Attempt history", "Delivery readiness</p>"]) {
      expect(workspace, text).not.toContain(`eyebrow">${text}`);
    }
    const community = read("components/community-moderation-workspace.tsx");
    for (const text of ["Safety and availability", "Private moderation queue", "Discussion review"]) expect(community, text).not.toContain(text);
  });

  it("keeps both review step labels in the reminder and shirt-size views", () => {
    expect((workspace.match(/Step 1 · review only/g) ?? []).length).toBe(2);
    expect((workspace.match(/Step 2 · explicit action/g) ?? []).length).toBe(2);
  });

  it("no longer links to Scheduled emails from the page (the views strip does)", () => {
    expect(workspace).not.toContain("/communications/scheduled");
    expect(read("components/staff-event-tabs.ts")).toContain("/communications/scheduled");
  });
});

describe("send, schedule and approve code is untouched (#1585)", () => {
  it("keeps every request and confirm step in the workspaces", () => {
    const workspace = read("components/communications-workspace.tsx");
    const scheduled = read("components/scheduled-emails-workspace.tsx");
    for (const needle of ["confirmRetryFailed", "createTestCapture", "resendConfirmation", "broadcastAnnouncement", "processQueue"]) expect(workspace, needle).toContain(needle);
    for (const needle of ["void approve()", "void save()", "void review()", "newScheduleRef"]) expect(scheduled, needle).toContain(needle);
    expect(scheduled).not.toContain("StaffPageHeader");
  });
});
