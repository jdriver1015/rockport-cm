"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { parseBatch } from "@/lib/actions/rent-rolls";

/**
 * Kicks off (or resumes) the heavy parse for a batch that's in `parsing`, then
 * refreshes the page to reveal the review sheet. The parse runs as a server
 * action; the bar climbs while we await it so the wait doesn't feel dead.
 */
export function RentRollParseRunner({ batchId }: { batchId: number }) {
  const router = useRouter();
  const started = useRef(false);
  const [pct, setPct] = useState(15);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const timer = setInterval(() => {
      setPct((p) => (p < 90 ? p + Math.max(1, Math.round((90 - p) / 12)) : p));
    }, 700);

    void (async () => {
      const res = await parseBatch(batchId);
      clearInterval(timer);
      setPct(100);
      if (!res.ok) toast.error(res.error);
      router.refresh();
    })();

    return () => clearInterval(timer);
  }, [batchId, router]);

  return (
    <div className="space-y-3 py-6">
      <p className="text-sm text-muted-foreground">
        Detecting columns and extracting units — this can take up to a minute for large or PDF rent
        rolls.
      </p>
      <Progress value={pct} />
    </div>
  );
}
