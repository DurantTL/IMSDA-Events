"use client";

import { Printer } from "lucide-react";

/** Prints the directory as it is filtered (#1686); the print stylesheet drops the controls. */
export function TltPrintButton() {
  return (
    <button className="secondary-button" onClick={() => window.print()} type="button">
      <Printer aria-hidden="true" size={15} /> Print
    </button>
  );
}
