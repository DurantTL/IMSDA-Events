import { describe, expect, it, vi } from "vitest";
import {
  eventInformationConfig, generalInformationConfig, publishInformationDraftRequest, saveInformationDraftRequest,
  saveInformationSettingsRequest, setInformationStatusRequest, type InformationBuilderConfig,
} from "@/components/registration-builder/information-mode";
import { blankInformationFormDefinition } from "@/modules/information-forms/definition";
// Only the exported method names matter here, so the routes load without their server dependencies.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/information-forms/access", () => ({ authorizeGeneralInformationForms: vi.fn(), authorizeEventInformationForms: vi.fn() }));
vi.mock("@/modules/information-forms/api", () => ({ informationFormHandlers: () => new Proxy({}, { get: () => vi.fn() }) }));

import * as adminForm from "@/app/api/admin/information-forms/[formId]/route";
import * as adminPublish from "@/app/api/admin/information-forms/[formId]/publish/route";
import * as adminSettings from "@/app/api/admin/information-forms/[formId]/settings/route";
import * as adminStatus from "@/app/api/admin/information-forms/[formId]/status/route";
import * as eventForm from "@/app/api/events/[eventId]/information-forms/[formId]/route";
import * as eventPublish from "@/app/api/events/[eventId]/information-forms/[formId]/publish/route";
import * as eventSettings from "@/app/api/events/[eventId]/information-forms/[formId]/settings/route";
import * as eventStatus from "@/app/api/events/[eventId]/information-forms/[formId]/status/route";

// "Open for answers" sent POST to a PATCH-only status route, so Next answered 405 with no body and the builder showed
// only "The request could not be completed." Every builder request must use a method its route actually exports.
const routes: Record<"GENERAL" | "EVENT", Record<string, Record<string, unknown>>> = {
  GENERAL: { "": adminForm, "/publish": adminPublish, "/settings": adminSettings, "/status": adminStatus },
  EVENT: { "": eventForm, "/publish": eventPublish, "/settings": eventSettings, "/status": eventStatus },
};

const configs: [string, InformationBuilderConfig][] = [
  ["general", generalInformationConfig()],
  ["event", eventInformationConfig({ id: "evt_1", slug: "synthetic", name: "Synthetic event" })],
];

describe("information builder requests match their routes", () => {
  it.each(configs)("%s forms: every request uses a method the route exports", async (_, config) => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: "stop" }), { status: 400 }));
    const f = fetchImpl as unknown as typeof fetch;
    await saveInformationDraftRequest(config, "form_1", blankInformationFormDefinition("Synthetic survey"), "x", f);
    await publishInformationDraftRequest(config, "form_1", "x", f);
    await saveInformationSettingsRequest(config, "form_1", { fillAccess: "SIGNED_IN" }, f);
    await setInformationStatusRequest(config, "form_1", "OPEN", f);
    await setInformationStatusRequest(config, "form_1", "CLOSED", f);
    const base = config.scope === "EVENT" ? "/api/events/evt_1/information-forms/form_1" : "/api/admin/information-forms/form_1";
    const calls = (fetchImpl.mock.calls as unknown as [string, RequestInit][]).map(([url, init]) => [url, init.method] as const);
    expect(calls).toHaveLength(5);
    for (const [url, method] of calls) {
      expect(url.startsWith(base)).toBe(true);
      const route = routes[config.scope][url.slice(base.length)];
      expect(route, url).toBeDefined();
      expect(typeof route![method!], `${method} ${url}`).toBe("function");
    }
  });

  it("says more than the bare fallback when the answer is not the app's JSON", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 405 }));
    const result = await setInformationStatusRequest(generalInformationConfig(), "form_1", "OPEN", fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.message).toContain("(405)");
  });
});
