import { logError } from "@/lib/logger";
import type { defineProvider, SignalProvider } from "./providers";
import { SELF_TEST_DEFINITIONS, runSelfTest, type SelfTestDefinition } from "./self-tests";

/**
 * The "Built-in self-tests" rows (#1381): one row per self-test. Built from `providers.ts`'s helpers, passed in so this
 * file never imports that one at run time (it appends this list, so importing it back would be a cycle). A row says
 * which self-test and how many examples; it never carries an example, a name or an amount.
 */
export type SelfTestKit = {
  defineProvider: typeof defineProvider;
  m: (key: string, name: string, description: string, fixHref?: string | null, fixLabel?: string | null) => Parameters<typeof defineProvider>[1][number];
  tried: (read: { ok: false; readAt: Date }, reason?: string) => { checkedAt: string; whenLabel: string; state: "unavailable"; resultText: string };
};

const examples = (count: number) => `${count} fixed ${count === 1 ? "example" : "examples"}`;

/** The row for one self-test: a pass, a difference, or "could not run" (never a pass). */
export function selfTestRow(kit: Pick<SelfTestKit, "tried">, definition: SelfTestDefinition, run: (definition: SelfTestDefinition) => ReturnType<typeof runSelfTest> = runSelfTest) {
  try {
    const result = run(definition);
    if (result.differing === 0 && result.total > 0) {
      return { key: definition.key, state: "ok" as const, resultText: result.total === 1 ? "The fixed example gives the known answer." : `All ${result.total} fixed examples give the known answer.` };
    }
    return {
      key: definition.key,
      state: "attention" as const,
      resultText: `${result.differing} of ${examples(result.total)} gave a different answer for ${definition.name.toLowerCase()}. A developer should check this calculation, or the server's time zone and language settings, before the next event.`,
    };
  } catch (error) {
    // The self-test's key only: the error can carry the example's own values.
    logError("A built-in self-test could not run", error instanceof Error ? new Error(error.name) : new Error("Unknown error"), { selfTest: definition.key });
    return { key: definition.key, ...kit.tried({ ok: false, readAt: new Date() }, "The self-test could not run. It is not shown as passing.") };
  }
}

export function buildSelfTestProviders(kit: SelfTestKit, definitions: readonly SelfTestDefinition[] = SELF_TEST_DEFINITIONS, run?: (definition: SelfTestDefinition) => ReturnType<typeof runSelfTest>): SignalProvider[] {
  return [
    kit.defineProvider(
      "self-tests",
      definitions.map((definition) => kit.m(definition.key, definition.name, definition.description, null, "Fixed on the server")),
      async () => definitions.map((definition) => selfTestRow(kit, definition, run)),
    ),
  ];
}
