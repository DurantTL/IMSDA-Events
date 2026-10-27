"use client";

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { clubYearSelectorModel } from "@/components/clubs-year-selector-model";

/**
 * The club year, kept in the Clubs sidebar under the search (#1245). A real GET form, so it works without scripts;
 * with scripts, choosing a year submits at once. The pages read `?year=` and nothing else here is stored.
 */
export function ClubsYearSelector() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [now] = useState(() => new Date());
  const model = clubYearSelectorModel(pathname, searchParams.get("year"), now);
  return (
    // Keyed by the selected year, so the select follows the URL after a navigation.
    <form className="clubs-year-form" method="get" action={model.action} key={model.selected}>
      <label htmlFor="clubs-year-select">Club year</label>
      <div className="clubs-year-controls">
        <select
          id="clubs-year-select"
          name="year"
          defaultValue={model.selected}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
        >
          {model.options.map((year) => <option key={year} value={year}>{year}</option>)}
        </select>
        <button type="submit">Show</button>
      </div>
    </form>
  );
}
