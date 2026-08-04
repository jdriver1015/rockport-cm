"use client";

import { usePathname, useRouter } from "next/navigation";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { BudgetViewKey } from "@/lib/budget-views";

/**
 * Drives the Budget tab's three views through a URL search param rather than
 * client state, so each view is server-rendered (only its own data crosses the
 * wire) and a particular view is linkable.
 */
export function BudgetViewSwitch({ value }: { value: BudgetViewKey }) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <SegmentedControl
      options={[
        { key: "consolidated", label: "Consolidated" },
        { key: "exterior", label: "Exterior" },
        { key: "interior", label: "Interior" },
      ]}
      value={value}
      onChange={(next) =>
        router.replace(next === "consolidated" ? pathname : `${pathname}?view=${next}`, {
          scroll: false,
        })
      }
    />
  );
}
