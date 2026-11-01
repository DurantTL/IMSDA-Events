import type { EnvironmentStatus } from "@/modules/system-admin/environment-status";
import { ENVIRONMENT_SERVICE_SETUP, systemSetupFor } from "@/modules/setup-help/system-setup-steps";
import type { ServiceSetup } from "@/modules/setup-help/types";
import type { Signal } from "./model";

type EnvService = EnvironmentStatus["services"][number];

/** The setup help for each service that is not set up, found by the EnvironmentStatus service id (#1434). Fixed words and setting names only. */
export function serviceSetupFor(services: readonly EnvService[]): ServiceSetup[] {
  // A service with no entry gets no panel, never another service's steps. The guard test fails for any unmapped id.
  return services
    .filter((service) => service.status === "not-configured" && service.id in ENVIRONMENT_SERVICE_SETUP)
    .map((service) => ({ id: service.id, label: service.label, setup: systemSetupFor(ENVIRONMENT_SERVICE_SETUP[service.id]) }));
}

/** "Set up" is a configuration fact, never proof the service works: the labels are fixed names, never values. */
type ServiceSummary = Pick<Signal, "key" | "checkedAt" | "whenLabel" | "state" | "resultText" | "needsSetup" | "serviceSetup">;

export function summarizeServices(key: string, services: EnvService[], readAt: Date): ServiceSummary {
  const setUp = services.filter((service) => service.status === "configured").length;
  const notSet = services.filter((service) => service.status === "not-configured");
  const unknown = services.filter((service) => service.status === "unknown");
  const common = { key, checkedAt: readAt.toISOString() };
  const counted = `${setUp} of ${services.length} set up.`;
  if (notSet.length > 0) {
    return {
      ...common,
      whenLabel: "Checked",
      state: "watch" as const,
      resultText: `${counted} Not set up: ${notSet.map((service) => service.label).join(", ")}.`,
      needsSetup: true,
      serviceSetup: serviceSetupFor(services),
    };
  }
  if (unknown.length > 0) {
    return { ...common, whenLabel: "Tried", state: "unavailable" as const, resultText: `${counted} Could not be read: ${unknown.map((service) => service.label).join(", ")}.` };
  }
  return { ...common, whenLabel: "Checked", state: "ok" as const, resultText: `${counted} Set up does not prove a service works.` };
}
