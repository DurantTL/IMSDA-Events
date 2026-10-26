import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { NewClubsRegion, ClubApplicationApprove, ClubApplicationApproveView, postApproveDecision } from "@/components/club-application-approve";

/** #1226: Approve on the dashboard uses the applications page's own decision route, and only after the confirm step. */
const noop = () => undefined;
const view = (overrides: Partial<Parameters<typeof ClubApplicationApproveView>[0]> = {}) => renderToStaticMarkup(
  ClubApplicationApproveView({
    clubName: "Synthetic Club", directorEmail: "director@example.test", confirming: false, busy: false, error: null, success: null,
    onAsk: noop, onCancel: noop, onConfirm: noop, ...overrides,
  }),
);

describe("approve control", () => {
  it("starts as a single Approve button with no confirm text", () => {
    const html = renderToStaticMarkup(createElement(ClubApplicationApprove, { applicationId: "app-1", clubName: "Synthetic Club", directorEmail: "director@example.test" }));
    expect(html).toContain(">Approve<");
    expect(html).not.toContain("Approve and send invite");
  });

  it("shows the confirm step with the director's email, Cancel and the final button", () => {
    const html = view({ confirming: true });
    expect(html).toContain("Approving creates the club and emails <strong translate=\"no\">director@example.test</strong> the club director invite. It can&#x27;t be undone from here.");
    expect(html).toContain(">Cancel<");
    expect(html).toContain(">Approve and send invite<");
  });

  it("shows the route's error as an alert, and a status on success", () => {
    expect(view({ confirming: true, error: "Already decided." })).toMatch(/role="alert">Already decided\.</);
    expect(view({ success: "Approved." })).toContain(">Approved.<");
  });

  it("posts only { decision: \"approve\" } to the existing decision route", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    await postApproveDecision("app/1", fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/admin/club-applications/app%2F1/decision");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ decision: "approve" });
  });

  it("throws the route's message when the decision fails", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: "Choose a church." }), { status: 409 }));
    await expect(postApproveDecision("app-1", fetchImpl as unknown as typeof fetch)).rejects.toThrow("Choose a church.");
  });

  it("keeps a live status region outside the rows, for the message after a refresh", () => {
    const html = renderToStaticMarkup(createElement(NewClubsRegion, { headingId: "h" }, createElement("ul")));
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });

  it("does not post when only rendered", () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    view({ confirming: true });
    expect(fetchImpl).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
