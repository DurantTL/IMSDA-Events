// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));

import { AreaCoordinatorImport } from "@/components/area-coordinator-import";
import { PersonGrantPanel } from "@/components/person-grant-panel";
import { formatGrantParam, parseGrantParam } from "@/modules/system-admin/people-directory-model";
import { deferredPersonHref } from "@/modules/system-admin/people-invite-href";
import { buttonByText, click, flush, mount, type Mounted } from "./helpers/dom-render";

/** #843: the deferred Area Coordinator item carries its ministries to the grant panel, and the CSV dialog asks for one choice. Synthetic data only. */

let mounted: Mounted | null = null;
afterEach(async () => { await mounted?.unmount(); mounted = null; vi.unstubAllGlobals(); });

describe("the deferred Area Coordinator grant", () => {
  it("goes from the link, through the panel, to the route with its ministries", async () => {
    const href = deferredPersonHref({ staffId: null, accountId: "acct-1" }, [{ type: "ac", ministries: ["ADVENTURER"] }]);
    const grant = new URL(`https://events.imsda.test${href}`).searchParams.get("grant");
    const items = parseGrantParam(grant);
    expect(items).toEqual([{ type: "ac", ministries: ["ADVENTURER"] }]);
    expect(formatGrantParam(items)).toBe("ac:ADVENTURER");

    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    mounted = await mount(createElement(PersonGrantPanel, {
      rows: items.map((item) => ({ key: "ac", item, state: "save" as const })),
      person: { staffId: null, accountId: "acct-1", staffEmail: null, accountEmail: "pat@example.test", displayName: "Pat Example" },
      eventNames: {}, clubNames: {}, cleanHref: "/admin/people/account/acct-1",
    }));
    expect(mounted.container.textContent).toContain("Adventurer");
    await click(buttonByText(mounted.container, "Save this access"));
    await flush(0);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe("/api/admin/accounts/acct-1");
    expect(JSON.parse(init.body)).toEqual({ action: "area-coordinator", on: true, ministries: ["ADVENTURER"] });
  });
});

describe("the Area Coordinator CSV dialog", () => {
  const upload = () => document.querySelector<HTMLInputElement>('input[type="file"]')!;
  const boxes = () => [...document.querySelectorAll<HTMLInputElement>("fieldset input[type=checkbox]")];

  it("needs a ministry before a file can be chosen, and starts from Pathfinder each time it opens", async () => {
    mounted = await mount(createElement(AreaCoordinatorImport, { pendingCount: 0 }));
    await click(buttonByText(mounted.container, "Import Area Coordinators"));
    expect(boxes().map((box) => box.checked)).toEqual([true, false]);
    expect(upload().disabled).toBe(false);

    await click(boxes()[0]!);
    expect(upload().disabled).toBe(true);
    expect(document.body.textContent).toContain("Choose at least one ministry.");

    await click(boxes()[1]!);
    expect(upload().disabled).toBe(false);

    await click(document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!);
    await click(buttonByText(mounted.container, "Import Area Coordinators"));
    expect(boxes().map((box) => box.checked)).toEqual([true, false]);
  });
});
