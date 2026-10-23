// "Withdraw this form": takes the live version off the public page. Shared by the phone layout and the editor shell.
import { FileClock } from "lucide-react";
import { DangerZone, DangerZoneItem } from "@/components/danger-zone";
import { useBuilder } from "./builder-context";

export function BuilderWithdrawZone() {
  const { selectedForm, publishedVersion, busy, setConfirmingUnpublish } = useBuilder();
  if (!publishedVersion || !selectedForm) return null;
  return (
    <DangerZone className="builder-danger-zone" heading="Withdraw this form">
      <DangerZoneItem title="Withdraw from public page">
        <p>The form disappears from the public event page and stops accepting new registrations. Registrations already taken keep the version they were submitted under. Publishing again later creates a new version.</p>
        <button className="secondary-button danger-outline-button" type="button" disabled={busy !== null} onClick={() => setConfirmingUnpublish(true)}><FileClock size={15} aria-hidden="true" /> Withdraw {selectedForm.name}…</button>
      </DangerZoneItem>
    </DangerZone>
  );
}
