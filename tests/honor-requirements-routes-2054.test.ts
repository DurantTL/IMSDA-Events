import { beforeEach, describe, expect, it, vi } from "vitest";

// #2054: the honor requirements template and import routes. Synthetic honors and text only.

const mocks = vi.hoisted(() => ({
  rejectCrossOriginRequest: vi.fn(),
  requireClubsAdministration: vi.fn(),
  listHonors: vi.fn(),
  listCurrentHonorRequirementSets: vi.fn(),
  applyRequirementImport: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/organizations/access", () => ({ requireClubsAdministration: mocks.requireClubsAdministration }));
vi.mock("@/modules/honors/repository", async () => {
  const actual = await vi.importActual<typeof import("@/modules/honors/repository")>("@/modules/honors/repository");
  return { ...actual, listHonors: mocks.listHonors };
});
vi.mock("@/modules/requirements/repository", async () => {
  const actual = await vi.importActual<typeof import("@/modules/requirements/repository")>("@/modules/requirements/repository");
  return { ...actual, listCurrentHonorRequirementSets: mocks.listCurrentHonorRequirementSets, applyRequirementImport: mocks.applyRequirementImport };
});

import { POST } from "@/app/api/admin/honors/requirements/import/route";
import { GET as GET_TEMPLATE } from "@/app/api/admin/honors/requirements/template/route";
import { AccessDeniedError } from "@/modules/access/authorization";
import { RequirementImportConflictError } from "@/modules/requirements/repository";
import { REQUIREMENT_CSV_HEADERS } from "@/modules/requirements/requirements-csv";
import { toCsv } from "@/modules/reporting/csv";

const WIKI = "https://wiki.pathfindersonline.org/w/AY_Honors/Sample_Knots/Requirements";
const csv = (text = "Tie three sample knots.") => toCsv([
  [...REQUIREMENT_CSV_HEADERS],
  ["SAMPLE-KNOTS", "Sample Knots", "en", "2026-11-27", WIKI, "CC BY-SA 3.0", "", "1", "", text],
  ["SAMPLE-STARS", "Sample Stars", "en", "2026-11-27", "https://example.com/stars", "CC BY-SA 3.0", "", "1", "", "Find a sample star."],
]);

function request(body: unknown) {
  return new Request("https://events.imsda.test/api/admin/honors/requirements/import", {
    method: "POST",
    headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.requireClubsAdministration.mockResolvedValue({ id: "admin-1" });
  mocks.listHonors.mockResolvedValue([
    { id: "h-knots", code: "SAMPLE-KNOTS", name: "Sample Knots" },
    { id: "h-stars", code: "SAMPLE-STARS", name: "Sample Stars" },
    { id: "h-other", code: "SAMPLE-OTHER", name: "Sample Other" },
  ]);
  mocks.listCurrentHonorRequirementSets.mockResolvedValue([]);
  mocks.applyRequirementImport.mockResolvedValue({ added: 1, replaced: 0 });
});

describe("honor requirements routes (#2054)", () => {
  it("lets only clubs administrators download the template or import", async () => {
    mocks.requireClubsAdministration.mockRejectedValue(new AccessDeniedError("No.", 403, "PERMISSION_DENIED"));
    expect((await GET_TEMPLATE(new Request("https://events.imsda.test/x"))).status).toBe(403);
    const response = await POST(request({ csv: csv(), confirm: true }));
    expect(response.status).toBe(403);
    expect(mocks.applyRequirementImport).not.toHaveBeenCalled();
  });

  it("refuses a request from another site", async () => {
    mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({ error: "CROSS_ORIGIN" }, { status: 403 }));
    expect((await POST(request({ csv: csv() }))).status).toBe(403);
    expect(mocks.requireClubsAdministration).not.toHaveBeenCalled();
  });

  it("previews without saving, and reads current text only for the honors in the file", async () => {
    const response = await POST(request({ csv: csv() }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.steps).toEqual([
      { line: 2, name: "Sample Knots (SAMPLE-KNOTS)", action: "ADD", message: "Will add 1 requirement." },
      { line: 3, name: "Sample Stars (SAMPLE-STARS)", action: "SKIP", message: expect.stringMatching(/source whose license is recorded/) },
    ]);
    expect(mocks.listCurrentHonorRequirementSets).toHaveBeenCalledWith(["h-knots", "h-stars"]);
    expect(mocks.applyRequirementImport).not.toHaveBeenCalled();
  });

  it("shows a new version of an honor's text as an update", async () => {
    mocks.listCurrentHonorRequirementSets.mockResolvedValue([
      { id: "set-1", honorId: "h-knots", language: "en", sourceUrl: WIKI, lines: [{ section: "", number: 1, label: "", text: "Tie two sample knots." }] },
    ]);
    const body = await (await POST(request({ csv: csv() }))).json();
    expect(body.steps[0]).toMatchObject({ action: "UPDATE", message: "Will replace the current text with 1 requirement. The old version is kept." });
  });

  it("saves on confirm with the planned steps and the signed-in administrator", async () => {
    const response = await POST(request({ csv: csv(), confirm: true }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ added: 1, replaced: 0 });
    expect(body.steps[0]).toMatchObject({ action: "ADD", message: "Added." });
    const [plan, actor] = mocks.applyRequirementImport.mock.calls[0]!;
    expect(actor).toBe("admin-1");
    expect(plan.map((step: { code: string; action: string }) => [step.code, step.action])).toEqual([["SAMPLE-KNOTS", "ADD"], ["SAMPLE-STARS", "SKIP"]]);
  });

  it("asks for a fresh preview when someone else imported at the same time", async () => {
    mocks.applyRequirementImport.mockRejectedValue(new RequirementImportConflictError());
    const response = await POST(request({ csv: csv(), confirm: true }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("REQUIREMENTS_CHANGED");
  });

  it("explains an unreadable file in plain words", async () => {
    const response = await POST(request({ csv: "Code,Text\nSAMPLE-KNOTS,Tie\n" }));
    expect(response.status).toBe(400);
    expect((await response.json()).message).toMatch(/column names from the template/);
    expect((await POST(request({ csv: csv(), extra: true }))).status).toBe(400);
  });
});
