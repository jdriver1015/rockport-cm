"use client";

import { PrinterIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Opens the browser's print dialog. Screen-only — hidden in the printed output. */
export function PrintButton() {
  return (
    <Button size="sm" onClick={() => window.print()}>
      <PrinterIcon className="size-3.5" />
      Print / save PDF
    </Button>
  );
}
