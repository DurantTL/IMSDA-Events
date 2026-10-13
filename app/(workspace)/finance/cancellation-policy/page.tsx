import type { Metadata } from "next";
import { AccessRestricted } from "@/components/access-restricted";
import { CancellationPolicyWorkspace } from "@/components/cancellation-policy-workspace";
import { listPolicyVersions } from "@/modules/cancellation-policy/repository";
import { resolveEventContext } from "@/modules/events/selection";

export const metadata: Metadata = { title: "Cancellation rules" };

export default async function CancellationPolicyPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const { event: requested } = await searchParams;
  const { event, permissions } = await resolveEventContext(requested);
  if (!permissions.includes("MANAGE_FINANCE")) {
    return <AccessRestricted title="Finance is restricted" detail="Only event administrators and finance managers can view or change cancellation rules." />;
  }
  const { versions, inEffectVersionId } = await listPolicyVersions(event.id);
  return (
    <CancellationPolicyWorkspace
      eventId={event.id}
      eventName={event.name}
      inEffectVersionId={inEffectVersionId}
      timezone={event.timezone}
      versions={versions}
    />
  );
}
