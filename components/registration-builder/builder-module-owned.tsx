// A setting another module owns (#1139), shown read-only: its current value, the
// words "Set in <module>" and a link to that module's page when it has one.
// There is deliberately no input, so nothing suggests an independent value.
import Link from "next/link";
import type { ModuleOwnedSetting } from "./module-owned-settings";

export function ModuleOwnedSettingRow({ setting, value }: { setting: ModuleOwnedSetting; value: string }) {
  return (
    <div className="field-full fb-owned-setting" data-testid={`owned-${setting.setting}`}>
      <p className="fb-owned-label">{setting.label}</p>
      <p className="fb-owned-value"><strong>{value}</strong> <span className="fb-chip">Set in {setting.owner}</span></p>
      <small>{setting.owner} sets this, so it cannot be changed here.{setting.href ? <> <Link href={setting.href}>Open {setting.owner}</Link></> : null}</small>
    </div>
  );
}
