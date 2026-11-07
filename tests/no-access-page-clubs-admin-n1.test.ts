import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), clubsAdmin: vi.fn(), events: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: vi.fn(), cookies: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.session }));
vi.mock("@/modules/access/admin-roles", () => ({ isActiveClubsAdministrator: mocks.clubsAdmin }));
vi.mock("@/modules/events/repository", () => ({ listEventsForUser: mocks.events }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: vi.fn() }));
vi.mock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: vi.fn() }));
vi.mock("@/components/sign-out-button", () => ({ SignOutButton: () => null }));

import NoAccessPage from "@/app/no-access/page";

const render = async (from?: string) => renderToStaticMarkup(await NoAccessPage({ searchParams: Promise.resolve(from ? { from } : {}) }) as never);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ user: { id: "u1", email: "clubs@example.test", globalRole: null } });
  mocks.events.mockResolvedValue([]);
});

describe("/no-access for a Clubs Administrator (N1, B14)", () => {
  beforeEach(() => mocks.clubsAdmin.mockResolvedValue(true));

  it("says System management needs a system administrator only for from=system, with a link to Club administration", async () => {
    const html = await render("system");
    expect(html).toContain("System management needs a system administrator");
    expect(html).toContain("Ask an IMSDA system administrator if you need access.");
    expect(html).toContain('href="/admin/clubs"');
    expect(html).not.toContain("No events are assigned");
  });

  it("sends them home to Club administration for any other no-reason arrival", async () => {
    await expect(render()).rejects.toThrow("redirect:/admin/clubs");
    await expect(render("other")).rejects.toThrow("redirect:/admin/clubs");
  });

  it("keeps the event-creation reason", async () => {
    expect(await render("event-setup")).toContain("Creating events needs a system administrator");
  });
});

describe("/no-access for event staff is unchanged", () => {
  it("still says no events are assigned", async () => {
    mocks.clubsAdmin.mockResolvedValue(false);
    expect(await render()).toContain("No events are assigned");
    expect(await render("system")).toContain("No events are assigned");
  });
});

describe("system-only /admin pages send the reason", () => {
  it("adds ?from=system to the redirects in app/(workspace)/admin", async () => {
    const { execSync } = await import("node:child_process");
    const plain = execSync(`grep -rn 'globalRole !== "SYSTEM_ADMIN") redirect("/no-access")' "app/(workspace)/admin" || true`).toString();
    expect(plain).toBe("");
    for (const file of ["page.tsx", "email/page.tsx"]) {
      expect((await import("node:fs")).readFileSync(`app/(workspace)/admin/${file}`, "utf8")).toContain('redirect("/no-access?from=system")');
    }
  });
});
