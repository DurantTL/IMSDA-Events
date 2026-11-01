"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { useEffect, useRef } from "react";
import { focusSearchInput, SearchClearButton } from "@/components/search-clear-button";

/**
 * The events directory search box (#1347): the shared field, with a clear button. It is uncontrolled so the form's
 * search-as-you-type sync (#1431) can follow Back; clearing empties the box and applies the empty search at once.
 */
export function EventsSearchField({ defaultValue }: { defaultValue: string }) {
  const [text, setText] = useState(defaultValue);
  const input = useRef<HTMLInputElement>(null);
  // After Back or a link the form shows the URL's text (its effect runs after this one), so read the box once that settles.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setText(input.current?.value ?? ""));
    return () => cancelAnimationFrame(frame);
  }, [defaultValue]);
  return (
    <span className="search-field" onMouseDown={focusSearchInput}>
      <Search aria-hidden="true" size={16} />
      <input defaultValue={defaultValue} id="events-q" maxLength={100} name="q" onChange={(event) => setText(event.target.value)} ref={input} type="search" />
      <SearchClearButton
        onClear={() => {
          if (input.current) input.current.value = "";
          setText("");
          input.current?.form?.requestSubmit();
        }}
        visible={text !== ""}
      />
    </span>
  );
}
