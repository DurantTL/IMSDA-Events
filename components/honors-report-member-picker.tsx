"use client";

import { useEffect, useRef, useState } from "react";
import { HonorCombobox } from "@/components/honor-combobox";

export type HonorsReportMemberOption = { memberId: string; label: string };

/**
 * The one-person choice on the printable honors report (#1553): the shared
 * search-as-you-type box (the same one the honor pickers use) in place of a long
 * member drop-down. It posts the chosen member id as `member` and, once scripts
 * run, shows that member's report as soon as a choice is made.
 */
export function HonorsReportMemberPicker({ members, memberId }: { members: readonly HonorsReportMemberOption[]; memberId: string }) {
  const [value, setValue] = useState(memberId);
  const holder = useRef<HTMLDivElement>(null);
  const settled = useRef(memberId);
  useEffect(() => {
    if (value === settled.current) return;
    settled.current = value;
    holder.current?.closest("form")?.requestSubmit();
  }, [value]);
  return (
    <div ref={holder}>
      <HonorCombobox
        label="Member"
        name="member"
        noun="member"
        nounPlural="members"
        onChange={setValue}
        options={members.map((member) => ({ id: member.memberId, name: member.label }))}
        placeholder="Search members by name"
        value={value}
      />
    </div>
  );
}
