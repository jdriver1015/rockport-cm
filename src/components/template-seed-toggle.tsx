"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setTemplateSeedDefault } from "@/lib/actions/interior-defaults";

/**
 * Whether a new property arrives with this renovation type pre-checked.
 *
 * Saves on change rather than behind a Save button: it is one boolean with no
 * companion fields, and it only affects properties created later, so there is
 * nothing to review before committing it.
 */
export function TemplateSeedToggle({
  templateId,
  name,
  seedByDefault,
}: {
  templateId: number;
  name: string;
  seedByDefault: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <label
      className="flex shrink-0 cursor-pointer items-center gap-1.5"
      title={`Pre-check ${name} when a property is created`}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        type="checkbox"
        checked={seedByDefault}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.checked;
          startTransition(async () => {
            const res = await setTemplateSeedDefault({ templateId, seedByDefault: next });
            if (!res.ok) {
              toast.error(res.error);
              return;
            }
            router.refresh();
          });
        }}
        className="size-3.5 accent-navy"
      />
      <span className="hidden text-[11px] text-muted-foreground sm:inline">Default</span>
    </label>
  );
}
