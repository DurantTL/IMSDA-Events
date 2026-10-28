import "server-only";

import { after } from "next/server";
import { optedOutByHeaders, type PublicMetricName } from "@/modules/public-metrics/domain";
import { recordPublicMetric } from "@/modules/public-metrics/repository";

/**
 * The one way a route counts a public metric (#111). It does nothing when the request carries Global Privacy Control
 * or Do Not Track, runs the count after the response is sent (`after`, like the other routes), and can never throw or
 * change the response: a failure is swallowed. Outside a request (a test, a script) it still runs, unawaited.
 */
export function countPublicMetric(request: Request, metric: PublicMetricName, dimension: string): void {
  if (optedOutByHeaders(request.headers)) return;
  const run = async () => {
    try {
      await recordPublicMetric(metric, dimension);
    } catch {
      // A metric must never matter to the caller.
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}
