// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { InvitePerson } from "@/components/invite-person";
import { buttonByText, click, flush, mount, submitForm, typeInto, type Mounted } from "./helpers/dom-render";

/** #843: the Invite a person dialog asks which ministries a new Area Coordinator sees. Synthetic data only. */

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

async function openDialog() {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ created: { staffLogin: false, invitationEmailed: true, clubInviteIds: [], areaCoordinatorInviteId: "ac-1" }, deferred: null }), { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);
  mounted = await mount(createElement(InvitePerson, { scope: "clubs", eventOptions: [], clubOptions: [] }));
  await click(buttonByText(mounted.container, "Invite a person"));
  await flush(50);
  const form = document.querySelector("form")!;
  await typeInto(form.querySelector<HTMLInputElement>("#invite-name")!, "Test Person");
  await typeInto(form.querySelector<HTMLInputElement>("#invite-email")!, "person@example.test");
  return { form, fetchMock };
}

const boxes = (form: HTMLFormElement) => [...form.querySelectorAll<HTMLInputElement>("#invite-ministries input[type=checkbox]")];
const areaBox = (form: HTMLFormElement) => form.querySelector<HTMLInputElement>("#invite-access input[type=checkbox]")!;
const sentBody = (fetchMock: ReturnType<typeof vi.fn>) => JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);

describe("invite a person: Area Coordinator ministries", () => {
  it("shows the ministries only while Area Coordinator is ticked, with Pathfinder ticked", async () => {
    const { form } = await openDialog();
    expect(boxes(form)).toHaveLength(0);
    await click(areaBox(form));
    expect(boxes(form).map((box) => box.checked)).toEqual([true, false]);
    expect(form.querySelector("#invite-ministries")!.textContent).toContain("Adventurer clubs");
    await click(areaBox(form));
    expect(boxes(form)).toHaveLength(0);
  });

  it("sends the chosen ministries", async () => {
    const { form, fetchMock } = await openDialog();
    await click(areaBox(form));
    await click(boxes(form)[1]!);
    await click(boxes(form)[0]!);
    await submitForm(form);
    await flush(0);
    expect(sentBody(fetchMock).access).toMatchObject({ areaCoordinator: true, areaCoordinatorMinistries: ["ADVENTURER"] });
  });

  it("refuses an empty choice inline, sending nothing", async () => {
    const { form, fetchMock } = await openDialog();
    await click(areaBox(form));
    await click(boxes(form)[0]!);
    await submitForm(form);
    await flush(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector("#invite-ministries-error")?.textContent).toContain("Choose at least one ministry");
    expect(document.querySelector("#invite-ministries")!.getAttribute("aria-invalid")).toBe("true");
  });
});
