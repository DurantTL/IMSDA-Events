// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }) }));

import { ClubStaffTraining } from "@/components/club-staff-training";
import { buttonByText, choose, click, flush, mount, submitForm, typeInto, type Mounted } from "./helpers/dom-render";

/** The staff training list (#1697): confirm before remove, linked error summary, unsaved guard. Synthetic data only. */

const people = [{
  personId: "person-1", firstName: "Ann", lastName: "Example", typeLabel: "Adult",
  records: [{ id: "record-1", kind: "CERTIFICATION" as const, label: "Counselor", certificationKey: "COUNSELOR" as const, workshopCode: null, workshopTitle: null, completedOn: "2026-01-15", signedOffBy: "Pat Example" }],
}];

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

describe("remove asks first", () => {
  it("opens a confirmation naming the record and person, and sends nothing until confirmed", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ deleted: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    mounted = await mount(createElement(ClubStaffTraining, { organizationId: "club-1", people }));
    await click(mounted.container.querySelector<HTMLElement>('button[aria-label="Remove Counselor for Ann Example"]')!);
    expect(fetchMock).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="dialog"], [role="alertdialog"], dialog');
    expect(dialog?.textContent).toContain("Remove Counselor for Ann Example?");
    await click(buttonByText(document.body, "Remove record"));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe("DELETE");
  });

  it("shows a failed remove inside the dialog", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "That record could not be found." }), { status: 404 })));
    mounted = await mount(createElement(ClubStaffTraining, { organizationId: "club-1", people }));
    await click(mounted.container.querySelector<HTMLElement>('button[aria-label^="Remove Counselor"]')!);
    await click(buttonByText(document.body, "Remove record"));
    await flush();
    expect(document.body.textContent).toContain("Not saved: That record could not be found.");
  });
});

describe("the add form", () => {
  it("has the browser's bubbles off and lists every empty required field in a linked summary", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mounted = await mount(createElement(ClubStaffTraining, { organizationId: "club-1", people }));
    const form = mounted.container.querySelector("form")!;
    expect(form.noValidate).toBe(true);
    await submitForm(form);
    const summary = mounted.container.querySelector<HTMLElement>('.form-error-summary[role="alert"]')!;
    expect(summary.textContent).toContain("2 things to fix before saving");
    expect(summary.textContent).toContain("Certification: Choose a certification.");
    expect(summary.textContent).toContain("Date completed: Enter the date completed.");
    const select = mounted.container.querySelector<HTMLSelectElement>("#staff-training-person-1-certificationKey")!;
    expect(select.getAttribute("aria-invalid")).toBe("true");
    expect(select.getAttribute("aria-describedby")).toBe("staff-training-person-1-certificationKey-error");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("names each select by its label alone", async () => {
    mounted = await mount(createElement(ClubStaffTraining, { organizationId: "club-1", people }));
    const label = mounted.container.querySelector<HTMLLabelElement>('label[for="staff-training-person-1-certificationKey"]')!;
    expect(label.textContent).toBe("Certification");
    expect(label.querySelector("select")).toBeNull();
  });

  it("maps a server problem to its field", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "The date can't be in the future.", issues: [{ path: ["completedOn"], message: "The date can't be in the future." }] }), { status: 400 })));
    mounted = await mount(createElement(ClubStaffTraining, { organizationId: "club-1", people }));
    const { container } = mounted;
    await choose(container.querySelector<HTMLSelectElement>("#staff-training-person-1-certificationKey")!, "COUNSELOR");
    await typeInto(container.querySelector<HTMLInputElement>("#staff-training-person-1-completedOn")!, "2026-11-01");
    await submitForm(container.querySelector("form")!);
    await flush();
    expect(container.querySelector("#staff-training-person-1-completedOn-error")?.textContent).toContain("can't be in the future");
    expect(container.querySelector('.form-error-summary[role="alert"]')?.textContent).toContain("Date completed:");
  });
});
