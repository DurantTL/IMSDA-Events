import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

/** A tiny DOM render harness for component tests (jsdom environment): mount, type, click, unmount. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export type Mounted = { container: HTMLElement; root: Root; unmount: () => Promise<void> };

export async function mount(element: ReactElement): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  return {
    container,
    root,
    unmount: async () => {
      await act(async () => { root.unmount(); });
      container.remove();
    },
  };
}

export async function typeInto(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export async function click(element: Element) {
  await act(async () => { (element as HTMLElement).click(); });
}

export async function flush(ms = 0) {
  await act(async () => { await Promise.resolve(); if (ms) await new Promise((resolve) => setTimeout(resolve, ms)); });
}

export function buttonByText(container: HTMLElement, text: string) {
  const match = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === text);
  if (!match) throw new Error(`No button "${text}"`);
  return match as HTMLButtonElement;
}

export async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

export async function submitForm(form: HTMLFormElement) {
  await act(async () => { form.requestSubmit(); });
}
