/**
 * Reproducible benchmark for #920: simultaneous registration form submissions that order tickets for the same meal.
 *
 * For each size it runs the rounds below against a real local PostgreSQL database and reports how many submissions lost
 * a serialization conflict on their first try, how many exhausted every attempt (the family would see an error), and how
 * many attempts were needed in all, plus the serialization failures by statement.
 *
 *   npx tsx --require ./scripts/support/allow-server-only.cjs scripts/benchmark-meal-submit-contention.ts [sizes] [rounds] [mode]
 *   e.g. ... benchmark-meal-submit-contention.ts 10,20 25 same
 *
 * Modes:
 *   same        (default) every submission goes through the production public path, `submitPublicRegistration` (4 attempts,
 *               no extra retry), ordering the same meal (adult supper tickets).
 *   none        the same path with no meal tickets at all: the control that shows what is not the meals' fault.
 *   meal-layer  registrations that already exist each sync the same meal tickets (`syncFormMealSelections`) in a
 *               SERIALIZABLE transaction retried 4 times: the meal repository alone.
 *
 * BENCH_LOCKS=1 also samples pg_locks every few milliseconds and prints the most SIReadLock predicate locks seen per
 * relation (what SERIALIZABLE transactions read, so what another transaction's write can conflict with) and how many lock
 * requests were queued at once.
 *
 * The PostgreSQL log (`log_min_error_statement = error`, the default) has the failures' DETAIL ("Reason code: Canceled
 * on identification as a pivot ...") and the statement each one was cancelled on.
 */
import { createContentionHarness, prisma, sampleLocks, type ContentionRound } from "./support/meal-submit-contention";

const sizes = (process.argv[2] ?? "10,20").split(",").map(Number);
const rounds = Number(process.argv[3] ?? 25);
const mode = process.argv[4] ?? "same";
const sample = process.env.BENCH_LOCKS === "1";

async function main() {
  const harness = await createContentionHarness();
  await harness.setup();
  try {
    for (const size of sizes) {
      let submissions = 0; let firstTry = 0; let exhausted = 0; let attempts = 0; let cleanRounds = 0;
      const kinds = new Map<string, number>();
      const siRead = new Map<string, number>();
      let maxWaiting = 0;
      const started = Date.now();
      for (let round = 0; round < rounds; round += 1) {
        const run = (): Promise<ContentionRound> => mode === "meal-layer"
          ? harness.syncMealsSimultaneously(size)
          : harness.submitSimultaneously(size, mode === "none" ? {} : { supper_adult_qty: 2 });
        let result: ContentionRound;
        if (sample) {
          const sampled = await sampleLocks(run);
          result = sampled.result;
          maxWaiting = Math.max(maxWaiting, sampled.maxWaiting);
          for (const [key, count] of sampled.maxSiRead) siRead.set(key, Math.max(siRead.get(key) ?? 0, count));
        } else {
          result = await run();
        }
        submissions += result.submissions; firstTry += result.firstTryFailures; exhausted += result.exhausted; attempts += result.attempts;
        if (result.exhausted === 0) cleanRounds += 1;
        for (const outcome of result.outcomes) {
          for (const failure of outcome.failures) {
            const kind = (failure.match(/`(tx|client)\.(\w+\.\w+)\(\)`/)?.[2] ?? failure).replace(/\d+/g, "#").slice(0, 120);
            kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
          }
        }
      }
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`[${mode}] size ${size} x ${rounds} rounds: ${submissions} submissions, first-try failures ${firstTry} (${(100 * firstTry / submissions).toFixed(1)}%), exhausted all attempts ${exhausted} (${(100 * exhausted / submissions).toFixed(2)}%), rounds with no exhausted submission ${cleanRounds}/${rounds}, attempts per submission ${(attempts / submissions).toFixed(2)}, ${seconds}s`);
      for (const [kind, count] of [...kinds].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`   cancelled on ${kind}: ${count}`);
      if (sample) {
        console.log(`   most queued lock requests at once: ${maxWaiting}`);
        for (const [key, count] of [...siRead].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`   SIReadLock ${key}: up to ${count}`);
      }
    }
  } finally {
    await harness.cleanup().catch((error) => console.error("Cleanup failed", error));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
