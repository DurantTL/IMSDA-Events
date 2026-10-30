import "server-only";

import { logError } from "@/lib/logger";
import { getReleaseIdentity } from "@/lib/release";
import { buildSystemReport, unavailableSignal, type Signal, type SystemReport } from "./model";
import { createReportContext, systemReportProviders, type SignalProvider } from "./providers";

/**
 * Runs every provider and builds the report. Providers run side by side and share one set of reads; a provider that
 * somehow throws still shows each of its declared rows as unavailable, so one failing source never breaks the page.
 */
export async function loadSystemReport(now = new Date(), providers: readonly SignalProvider[] = systemReportProviders): Promise<SystemReport> {
  const ctx = createReportContext(now);
  const loaded = await Promise.all(
    providers.map(async (provider): Promise<Signal[]> => {
      try {
        return await provider.load(now, ctx);
      } catch (error) {
        logError("System report provider failed", error, { section: provider.section });
        const triedAt = new Date();
        return provider.signals.map((meta) => unavailableSignal(meta, provider.section, triedAt));
      }
    }),
  );
  let releaseSha: string | null = null;
  try {
    releaseSha = getReleaseIdentity().sha;
  } catch {
    releaseSha = null;
  }
  return buildSystemReport(loaded.flat(), now, releaseSha);
}
