import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({ resolveEventContext: vi.fn(), loadReviewQueueMetrics: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ usePathname: () => "/people/review-queues", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/modules/events/selection", () => ({ resolveEventContext: dependencies.resolveEventContext }));
vi.mock("@/modules/registrations/review-queues-repository", () => ({ loadReviewQueueMetrics: dependencies.loadReviewQueueMetrics }));

import ReviewQueuesPage from "@/app/(workspace)/people/review-queues/page";

const render = async () => renderToStaticMarkup(await ReviewQueuesPage({ searchParams: Promise.resolve({ event: "evt_1" }) }));
const event = { id: "evt_1", name: "Event", audience: "GENERAL" };

beforeEach(() => {
  vi.clearAllMocks();
  dependencies.loadReviewQueueMetrics.mockResolvedValue({ responsibleAdults: 2, directoryEntries: 0, pendingTeams: 1, approvalsWaiting: 3 });
});

describe("Review queues page access (#1574)", () => {
  it("shows the no-access page, and reads no numbers, when the viewer can open no queue", async () => {
    dependencies.resolveEventContext.mockResolvedValue({ event, permissions: ["VIEW_EVENT", "MANAGE_CHECK_IN"] });
    const html = await render();
    expect(html).toContain("Review queues are restricted");
    expect(html).not.toContain("People and families");
    expect(dependencies.loadReviewQueueMetrics).not.toHaveBeenCalled();
  });

  it("shows the six cards with the event on every link and a status in words", async () => {
    dependencies.resolveEventContext.mockResolvedValue({ event, permissions: ["MANAGE_REGISTRATION", "VIEW_SENSITIVE_DATA"] });
    const html = await render();
    expect(dependencies.resolveEventContext).toHaveBeenCalledWith("evt_1");
    expect(dependencies.loadReviewQueueMetrics).toHaveBeenCalledWith({ permissions: ["MANAGE_REGISTRATION", "VIEW_SENSITIVE_DATA"], audience: "GENERAL" }, "evt_1");
    for (const heading of ["People and families", "Teams and staff sign-ups"]) expect(html).toContain(heading);
    expect(html.match(/data-testid="hub-card"/g)).toHaveLength(6);
    expect(html.match(/href="[^"]*\?event=evt_1"/g)).toHaveLength(6);
    expect(html).toContain("2 to review");
    expect(html).toContain("1 team waiting");
    expect(html).toContain("3 waiting for approval");
    expect(html).not.toContain("/people/matches");
  });

  it("shows only the cards a sensitive-data viewer can open", async () => {
    dependencies.resolveEventContext.mockResolvedValue({ event, permissions: ["VIEW_SENSITIVE_DATA"] });
    const html = await render();
    expect(html.match(/data-testid="hub-card"/g)).toHaveLength(2);
    expect(html).not.toContain("Teams and staff sign-ups");
  });

  it("shows Unavailable for a number that could not be read", async () => {
    dependencies.resolveEventContext.mockResolvedValue({ event, permissions: ["MANAGE_REGISTRATION", "VIEW_SENSITIVE_DATA"] });
    dependencies.loadReviewQueueMetrics.mockResolvedValue({ pendingTeams: null });
    const html = await render();
    expect(html).toContain("Unavailable");
    expect(html).not.toContain("Nothing waiting");
  });
});
