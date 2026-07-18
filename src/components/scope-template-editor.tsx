"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SCOPE_SECTIONS } from "@/lib/scope-sections";
import {
  addTemplateItem,
  deleteTemplateItem,
  updateTemplateItem,
} from "@/lib/actions/scope-group-templates";

export type InteriorCodeOption = { code: string; name: string };

export type TemplateItem = {
  id: number;
  name: string;
  category: string | null;
  isAlternate: boolean;
  location: string | null;
  productLink: string | null;
  costCodeRef: string | null;
  materialAssumptions: string | null;
  notes: string | null;
};

const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50";

/** Shared add/edit form. `item` present = edit mode. */
function TemplateItemForm({
  templateId,
  item,
  interiorCodes,
  onDone,
}: {
  templateId: number;
  item?: TemplateItem;
  interiorCodes: InteriorCodeOption[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const result = item ? await updateTemplateItem(fd) : await addTemplateItem(fd);
      if (!result.ok) return toast.error(result.error);
      toast.success(item ? "Scope line updated" : "Scope line added");
      onDone();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // costCodeRef may reference a code not in the suggestion list — keep it selectable.
  const codeOptions = [...interiorCodes];
  if (item?.costCodeRef && !codeOptions.some((c) => c.code === item.costCodeRef)) {
    codeOptions.unshift({ code: item.costCodeRef, name: "(current)" });
  }

  // A stored section may not be in the standard list (freeform legacy value).
  const sectionOptions: string[] = [...SCOPE_SECTIONS];
  if (item?.category && !sectionOptions.includes(item.category)) {
    sectionOptions.unshift(item.category);
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <input type="hidden" name="templateId" value={templateId} />
      {item && <input type="hidden" name="id" value={item.id} />}

      <div className="space-y-1.5">
        <Label htmlFor="ti-name">Work description</Label>
        <Textarea
          id="ti-name"
          name="name"
          required
          rows={2}
          defaultValue={item?.name ?? ""}
          placeholder="R&R kitchen faucet."
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="ti-category">Trade section</Label>
          <select
            id="ti-category"
            name="category"
            defaultValue={item?.category ?? ""}
            className={selectClass}
          >
            <option value="">—</option>
            {sectionOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ti-location">Location</Label>
          <Input
            id="ti-location"
            name="location"
            defaultValue={item?.location ?? ""}
            placeholder="Kitchen / Bath / Throughout"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ti-material">Standard material / spec</Label>
        <Textarea
          id="ti-material"
          name="materialAssumptions"
          rows={2}
          defaultValue={item?.materialAssumptions ?? ""}
          placeholder="Kwikset Halifax Square Matte Black passage lever, or similar"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="ti-link">Product link</Label>
          <Input
            id="ti-link"
            name="productLink"
            type="url"
            defaultValue={item?.productLink ?? ""}
            placeholder="https://…"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ti-code">4000-series code</Label>
          <select
            id="ti-code"
            name="costCodeRef"
            defaultValue={item?.costCodeRef ?? ""}
            className={selectClass}
          >
            <option value="">—</option>
            {codeOptions.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ti-notes">Notes / exclusions</Label>
        <Textarea
          id="ti-notes"
          name="notes"
          rows={2}
          defaultValue={item?.notes ?? ""}
          placeholder="Excludes angle stops."
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isAlternate"
          defaultChecked={item?.isAlternate ?? false}
          className="size-4 accent-navy"
        />
        Add/Deduct Alternative — optional line, priced separately per project
      </label>

      <div className="flex justify-end">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : item ? "Save line" : "Add line"}
        </Button>
      </div>
    </form>
  );
}

export function AddTemplateItemDialog({
  templateId,
  interiorCodes,
}: {
  templateId: number;
  interiorCodes: InteriorCodeOption[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>Add scope line</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add scope line</DialogTitle>
          <DialogDescription>
            Describe the work and the standard material. Pricing happens per project when bids come
            in.
          </DialogDescription>
        </DialogHeader>
        <TemplateItemForm
          templateId={templateId}
          interiorCodes={interiorCodes}
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

export function EditTemplateItemDialog({
  templateId,
  item,
  interiorCodes,
}: {
  templateId: number;
  item: TemplateItem;
  interiorCodes: InteriorCodeOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    setBusy(true);
    try {
      const result = await deleteTemplateItem({ id: item.id, templateId });
      if (!result.ok) return toast.error(result.error);
      toast.success("Scope line removed");
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="ghost" />}>Edit</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit scope line</DialogTitle>
        </DialogHeader>
        <TemplateItemForm
          templateId={templateId}
          item={item}
          interiorCodes={interiorCodes}
          onDone={() => setOpen(false)}
        />
        <DialogFooter className="border-t pt-3">
          <Button type="button" variant="outline" size="sm" onClick={handleDelete} disabled={busy}>
            Remove line
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
