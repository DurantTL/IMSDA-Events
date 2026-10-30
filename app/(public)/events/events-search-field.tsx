"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { focusSearchInput, SearchClearButton } from "@/components/search-clear-button";

/** The events directory search box (#1347): the shared field, with a clear button. Clearing only empties the box; the form still submits as before. */
export function EventsSearchField({ defaultValue }: { defaultValue: string }) {
  const [text, setText] = useState(defaultValue);
  return (
    <span className="search-field" onMouseDown={focusSearchInput}>
      <Search aria-hidden="true" size={16} />
      <input id="events-q" maxLength={100} name="q" onChange={(event) => setText(event.target.value)} type="search" value={text} />
      <SearchClearButton onClear={() => setText("")} visible={text !== ""} />
    </span>
  );
}
