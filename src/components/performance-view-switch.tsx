"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { PerformanceViewKey } from "@/lib/performance-views";

const VIEWS: PerformanceViewKey[] = ["performance", "rent-rolls"];

/**
 * Drives the Performance tab's two views through a URL search param rather than
 * client state, so each view is server-rendered (only its own data crosses the
 * wire) and a particular view is linkable. Mirrors BudgetViewSwitch.
 */
export function PerformanceViewSwitch({ value }: { value: PerformanceViewKey }) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    for (const v of VIEWS) {
      if (v === value) continue;
      router.prefetch(v === "performance" ? pathname : `${pathname}?view=${v}`);
    }
  }, [router, pathname, value]);

  return (
    <SegmentedControl
      options={[
        { key: "performance", label: "Performance" },
        { key: "rent-rolls", label: "Rent Rolls" },
      ]}
      value={value}
      onChange={(next) =>
        router.replace(next === "performance" ? pathname : `${pathname}?view=${next}`, {
          scroll: false,
        })
      }
    />
  );
}
