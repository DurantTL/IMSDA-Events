import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** #1685: a Youth Admin with no events lands on the Youth directory instead of "no access". Synthetic data only. */
const mocks = vi.hoisted(() => ({ session: vi.fn(), clubsAdmin: vi.fn(), youthAdmin: vi.fn(), events: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: vi.fn(), cookies: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.session }));
vi.mock("@/modules/access/admin-roles", () => ({ isActiveClubsAdministrator: mocks.clubsAdmin, isActiveYouthAdministrator: mocks.youthAdmin }));
vi.mock("@/modules/events/repository", () => ({ listEventsForUser: mocks.events }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: vi.fn() }));
vi.mock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: vi.fn() }));
vi.mock("@/components/sign-out-button", () => ({ SignOutButton: () => null }));

import NoAccessPage from "@/app/no-access/page";

const render = async (from?: string) => renderToStaticMarkup(await NoAccessPage({ searchParams: Promise.resolve(from ? { from } : {}) }) as never);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ user: { id: "u1", email: "youth@example.test", globalRole: null } });
  mocks.events.mockResolvedValue([]);
  mocks.clubsAdmin.mockResolvedValue(false);
  mocks.youthAdmin.mockResolvedValue(true);
});

describe("/no-access for a Youth Admin (#1685)", () => {
  it("sends them to the Youth directory when no reason is given", async () => {
    await expect(render()).rejects.toThrow("redirect:/admin/youth");
  });

  it("keeps the normal page for a refusal reason, and for someone who is not a Youth Admin", async () => {
    expect(await render("system")).toContain("No events are assigned");
    mocks.youthAdmin.mockResolvedValue(false);
    expect(await render()).toContain("No events are assigned");
  });

  it("does not redirect a Youth Admin who is on an event team: they have an event to work in", async () => {
    mocks.events.mockResolvedValue([{ id: "event-1" }]);
    expect(await render()).not.toContain("redirect");
  });
});
