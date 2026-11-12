// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }) }));

import { ClubLetters } from "@/components/club-letters";
import { buttonByText, choose, click, flush, mount, submitForm, typeInto, type Mounted } from "./helpers/dom-render";

/** The letters page (#1708): placeholder help, confirm before delete, linked errors, the print step, escaped text. Synthetic data only. */

const letters = [
  { id: "letter-1", kind: "LETTER" as const, title: "Welcome", body: "Dear {first_name},", updatedAt: "2026-11-12T12:00:00.000Z" },
  { id: "cert-1", kind: "CERTIFICATE" as const, title: "Thanks", body: "{full_name}", updatedAt: "2026-11-10T12:00:00.000Z" },
];
const people = [
  { personId: "p1", firstName: "Ann", lastName: "Example", typeLabel: "Youth" },
  { personId: "p2", firstName: "Zed", lastName: "Sample", typeLabel: "Staff" },
];

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

describe("the page", () => {
  it("lists every placeholder and says nothing is emailed, with no send control", async () => {
    mounted = await mount(createElement(ClubLetters, { organizationId: "club-1", letters, people }));
    const text = mounted.container.textContent!;
    for (const name of ["first_name", "last_name", "full_name", "club_name", "club_year", "date"]) expect(text).toContain(`{${name}}`);
    expect(text).toContain("Nothing is emailed");
    expect(text).not.toMatch(/\b(send|email it|mail)\b.*button/i);
    expect([...mounted.container.querySelectorAll("button, a")].map((el) => el.textContent).join("|")).not.toMatch(/send|email/i);
  });

  it("shows an empty state with no templates", async () => {
    mounted = await mount(createElement(ClubLetters, { organizationId: "club-1", letters: [], people }));
    expect(mounted.container.textContent).toContain("Nothing written yet.");
    expect(mounted.container.textContent).toContain("Add a letter or certificate above");
  });
});

describe("delete asks first", () => {
  it("opens a confirmation naming the template, and sends nothing until confirmed", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ deleted: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    mounted = await mount(createElement(ClubLetters, { organizationId: "club-1", letters, people }));
    const del = [...mounted.container.querySelectorAll<HTMLElement>("button")].find((el) => el.textContent?.includes("Delete Welcome"))!;
    await click(del);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"], [role="alertdialog"], dialog')?.textContent).toContain("Delete Welcome?");
    await click(buttonByText(document.body, "Delete letter"));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/attendee/clubs/club-1/letters/letter-1");
    expect(init.method).toBe("DELETE");
  });

  it("shows a failed delete inside the dialog", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "That letter could not be found." }), { status: 404 })));
    mounted = await mount(createElement(ClubLetters, { organizationId: "club-1", letters, people }));
    await click([...mounted.container.querySelectorAll<HTMLElement>("button")].find((el) => el.textContent?.includes("Delete Welcome"))!);
    await click(buttonByText(document.body, "Delete letter"));
    await flush();
    expect(document.body.textContent).toContain("Not saved: That letter could not be found.");
  });
});

describe("the add form", () => {
  it("has the browser's bubbles off and names the unknown placeholder before sending", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mounted = await mount(createElement(ClubLetters, { organizationId: "club-1", letters: [], people }));
    const form = mounted.container.querySelector("form")!;
    expect(form.noValidate).toBe(true);
    await submitForm(form);
    expect(mounted.container.querySelector("#letter-new-title-error")?.textContent).toContain("Enter a title.");
    await typeInto(mounted.container.querySelector<HTMLInputElement>("#letter-new-title")!, "Hello");
    await typeInto(mounted.container.querySelector<HTMLTextAreaElement>("#letter-new-body")!, "Born {birth_date}");
    await submitForm(form);
    const error = mounted.container.querySelector("#letter-new-body-error")!;
    expect(error.textContent).toContain("{birth_date}");
    expect(mounted.container.querySelector("#letter-new-body")!.getAttribute("aria-invalid")).toBe("true");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts a good template as JSON", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ letter: { id: "x" } }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    mounted = await mount(createElement(ClubLetters, { organizationId: "club-1", letters: [], people }));
    await choose(mounted.container.querySelector<HTMLSelectElement>("#letter-new-kind")!, "CERTIFICATE");
    await typeInto(mounted.container.querySelector<HTMLInputElement>("#letter-new-title")!, "Thanks");
    await typeInto(mounted.container.querySelector<HTMLTextAreaElement>("#letter-new-body")!, "Thank you {full_name}");
    await submitForm(mounted.container.querySelector("form")!);
    await flush();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/attendee/clubs/club-1/letters");
    expect(JSON.parse(init.body as string)).toEqual({ kind: "CERTIFICATE", title: "Thanks", body: "Thank you {full_name}" });
  });
});

describe("the unsaved guard and error summary", () => {
  it("shows a linked summary on a failed submit", async () => {
    vi.stubGlobal("fetch", vi.fn());
    mounted = await mount(createElement(ClubLetters, { organizationId: "club-1", letters: [], people }));
    await submitForm(mounted.container.querySelector("form")!);
    const summary = mounted.container.querySelector<HTMLElement>('.form-error-summary[role="alert"]')!;
    expect(summary.textContent).toContain("Title: Enter a title.");
    expect(summary.textContent).toContain("Text: Enter the text of the letter.");
  });

  it("tells people apart by roster type in the checklist", async () => {
    mounted = await mount(createElement(ClubLetters, { organizationId: "club-1", letters, people }));
    expect(mounted.container.textContent).toContain("Ann Example · Youth");
  });
});

describe("the print step", () => {
  const openLink = (container: HTMLElement) => [...container.querySelectorAll<HTMLAnchorElement>("a")].find((el) => el.textContent?.includes("Open print view"));

  it("has no way to open the print view until someone is ticked, then links with their ids", async () => {
    mounted = await mount(createElement(ClubLetters, { organizationId: "club-1", letters, people }));
    expect(openLink(mounted.container)).toBeUndefined();
    await click(mounted.container.querySelector<HTMLElement>("#letters-person-p2")!);
    expect(openLink(mounted.container)?.getAttribute("href")).toBe("/account/clubs/club-1/letters/letter-1/print?people=p2");
    await choose(mounted.container.querySelector<HTMLSelectElement>("#letters-print-template")!, "cert-1");
    expect(openLink(mounted.container)?.getAttribute("href")).toBe("/account/clubs/club-1/letters/cert-1/print?people=p2");
  });

  it("selects all and none", async () => {
    mounted = await mount(createElement(ClubLetters, { organizationId: "club-1", letters, people }));
    await click(buttonByText(mounted.container, "Select all"));
    expect(mounted.container.textContent).toContain("2 selected");
    expect(openLink(mounted.container)?.getAttribute("href")).toContain("people=p1,p2");
    await click(buttonByText(mounted.container, "Select none"));
    expect(mounted.container.textContent).toContain("0 selected");
    expect(openLink(mounted.container)).toBeUndefined();
  });
});
