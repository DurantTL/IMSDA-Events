import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The public file route and the registration look's logo and banner (#283): a published or archived look's picture is served
 * for a published event, a draft look's is not, and every refusal is the same 404. The database is an in-memory stand-in
 * that evaluates the lookup's `where` for the look branches; the route and the lookup are real. Synthetic data only.
 */
const mocks = vi.hoisted(() => ({ getPrisma: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/modules/events/asset-image-variants", () => ({
  eventAssetVariantResponse: vi.fn(async (asset: { displayName: string }) => new Response(`bytes of ${asset.displayName}`, { status: 200 })),
}));

import { GET } from "@/app/api/public/events/[eventSlug]/assets/[assetId]/route";

type LookStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
type Look = { status: LookStatus; slug: string; sent?: boolean };
type Stored = { id: string; event: { slug: string; isPublished: boolean; archivedAt: Date | null }; logoOf: Look[]; heroOf: Look[] };
type Access = { event: { slug: string }; OR: ({ status: LookStatus; messages?: unknown })[] };
type Clause = Record<string, { some: Access }>;

function database(assets: Stored[]) {
  const matches = (list: Look[], some: Access) => list.some((look) => look.slug === some.event.slug && some.OR.some((arm) => arm.status === look.status && (!arm.messages || look.sent === true)));
  mocks.getPrisma.mockReturnValue({
    eventAsset: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; event: { slug: string; isPublished: boolean; archivedAt: null }; OR: Clause[] } }) => {
        const asset = assets.find((entry) => entry.id === where.id);
        if (!asset || asset.event.slug !== where.event.slug || asset.event.isPublished !== where.event.isPublished || asset.event.archivedAt !== where.event.archivedAt) return null;
        const reachable = where.OR.some((clause) => (clause.themeLogoVersions && matches(asset.logoOf, clause.themeLogoVersions.some)) || (clause.themeHeroVersions && matches(asset.heroOf, clause.themeHeroVersions.some)));
        return reachable ? { displayName: "picture.png", contentType: "image/png", storageKey: `${asset.id}.png` } : null;
      }),
    },
  });
}

const live = { slug: "synthetic-camp", isPublished: true, archivedAt: null };
const get = (slug: string, assetId: string) => GET(new Request(`https://events.imsda.test/api/public/events/${slug}/assets/${assetId}`), { params: Promise.resolve({ eventSlug: slug, assetId }) });

beforeEach(() => vi.clearAllMocks());

describe("public file access for a registration look's logo and banner", () => {
  it.each([
    ["logo of the published look", { logoOf: [{ status: "PUBLISHED" as const, slug: "synthetic-camp" }], heroOf: [] }],
    ["banner of the published look", { logoOf: [], heroOf: [{ status: "PUBLISHED" as const, slug: "synthetic-camp" }] }],
    ["logo of an archived look that a sent message used", { logoOf: [{ status: "ARCHIVED" as const, slug: "synthetic-camp", sent: true }], heroOf: [] }],
    ["banner of an archived look that a sent message used", { logoOf: [], heroOf: [{ status: "ARCHIVED" as const, slug: "synthetic-camp", sent: true }] }],
  ])("serves the %s", async (_name, look) => {
    database([{ id: "asset-1", event: live, ...look }]);
    const response = await get("synthetic-camp", "asset-1");
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("bytes of picture.png");
  });

  it("answers the same 404 for a draft look, an archived look no message used, an unused upload, another event's page and an unpublished or archived event", async () => {
    database([
      { id: "draft", event: live, logoOf: [{ status: "DRAFT", slug: "synthetic-camp" }], heroOf: [] },
      { id: "archived-unsent", event: live, logoOf: [{ status: "ARCHIVED", slug: "synthetic-camp" }], heroOf: [] },
      { id: "unused", event: live, logoOf: [], heroOf: [] },
      { id: "elsewhere", event: live, logoOf: [{ status: "PUBLISHED", slug: "other-camp" }], heroOf: [] },
      { id: "unpublished", event: { ...live, slug: "hidden-camp", isPublished: false }, logoOf: [{ status: "PUBLISHED", slug: "hidden-camp" }], heroOf: [] },
      { id: "archived-event", event: { ...live, slug: "old-camp", archivedAt: new Date("2026-01-01T00:00:00Z") }, logoOf: [{ status: "PUBLISHED", slug: "old-camp" }], heroOf: [] },
    ]);
    const answers = await Promise.all([
      get("synthetic-camp", "draft"), get("synthetic-camp", "archived-unsent"), get("synthetic-camp", "unused"), get("synthetic-camp", "elsewhere"), get("synthetic-camp", "missing"),
      get("hidden-camp", "unpublished"), get("old-camp", "archived-event"),
    ]);
    for (const response of answers) {
      expect(response.status).toBe(404);
      await expect(response.text()).resolves.toBe("Not found");
    }
  });
});
