import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { attendeeSessionCookie, staffSessionCookie } from "@/modules/security/session-cookies";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({}) }));

type Call = [string, string, Record<string, unknown>];

function writer() {
  const calls: Call[] = [];
  return { calls, set: (name: string, value: string, options?: Record<string, unknown>) => { calls.push([name, value, options ?? {}]); } };
}
const reader = (entries: Record<string, string>) => ({ get: (name: string) => (name in entries ? { value: entries[name] } : undefined) });

afterEach(() => vi.unstubAllEnvs());

describe("session cookie names (#1402)", () => {
  it("writes the __Host- name in production: Secure, Path=/, no Domain", () => {
    vi.stubEnv("NODE_ENV", "production");
    const store = writer();
    const expires = new Date("2030-01-01T00:00:00Z");
    staffSessionCookie.set(store, "tok", { expires, maxAge: 60 });
    const [name, value, options] = store.calls[0];
    expect([name, value]).toEqual(["__Host-imsda_session", "tok"]);
    expect(options).toMatchObject({ secure: true, path: "/", httpOnly: true, sameSite: "lax", expires, maxAge: 60 });
    expect(options).not.toHaveProperty("domain");
    // The leftover plain cookie is expired in the same response.
    expect(store.calls[1]).toEqual(["imsda_session", "", expect.objectContaining({ maxAge: 0, path: "/" })]);
    const attendee = writer();
    attendeeSessionCookie.set(attendee, "tok", { maxAge: 60 });
    expect(attendee.calls[0][0]).toBe("__Host-imsda_attendee_session");
  });

  it("keeps the plain names outside production, with no __Host- clear-out", () => {
    vi.stubEnv("NODE_ENV", "development");
    const store = writer();
    staffSessionCookie.set(store, "tok", { maxAge: 60 });
    attendeeSessionCookie.set(store, "tok2", { maxAge: 60 });
    expect(store.calls.map(([name]) => name)).toEqual(["imsda_session", "imsda_attendee_session"]);
    expect(store.calls[0][2]).toMatchObject({ secure: false });
    expect(staffSessionCookie.read(reader({ imsda_session: "a", "__Host-imsda_session": "b" }))).toBe("a");
    expect(staffSessionCookie.read(reader({ "__Host-imsda_session": "b" }))).toBeUndefined();
  });

  it("reads the new name first, then the legacy name, in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(staffSessionCookie.read(reader({ "__Host-imsda_session": "new", imsda_session: "old" }))).toBe("new");
    expect(staffSessionCookie.read(reader({ imsda_session: "old" }))).toBe("old");
    expect(attendeeSessionCookie.read(reader({ imsda_attendee_session: "old" }))).toBe("old");
    expect(staffSessionCookie.read(reader({}))).toBeUndefined();
  });

  it("clears both names", () => {
    for (const env of ["production", "development"]) {
      vi.stubEnv("NODE_ENV", env);
      const store = writer();
      attendeeSessionCookie.clear(store);
      expect(store.calls.map(([name]) => name).sort()).toEqual(["__Host-imsda_attendee_session", "imsda_attendee_session"]);
      for (const [, value, options] of store.calls) expect([value, options.maxAge, options.path]).toEqual(["", 0, "/"]);
    }
  });
});

describe("proxy legacy cookie migration (#1402)", () => {
  const run = (cookie: string) => proxy(new NextRequest("https://events.imsda.test/overview", { headers: { cookie } }));
  const setCookies = (response: Response) => response.headers.getSetCookie();

  it("never promotes a legacy-only cookie to the __Host- name (session fixation)", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(setCookies(run("imsda_session=planted; imsda_attendee_session=planted"))).toEqual([]);
  });

  it("only expires the legacy cookie when the new one is already present", () => {
    vi.stubEnv("NODE_ENV", "production");
    const lines = setCookies(run("__Host-imsda_session=new; imsda_session=old"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^imsda_session=;/);
    expect(lines[0]).toMatch(/Max-Age=0/i);
  });

  it("does nothing outside production or without a legacy cookie", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(setCookies(run("imsda_session=legacy-token"))).toEqual([]);
    vi.stubEnv("NODE_ENV", "production");
    expect(setCookies(run("__Host-imsda_session=new"))).toEqual([]);
  });
});
