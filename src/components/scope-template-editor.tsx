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
import { PRICING_METHODS, PRICING_METHOD_LABELS, type PricingMethod } from "@/lib/pricing";
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
  pricingMethod: PricingMethod;
  unitPrice: string | null;
  defaultQuantity: string | null;
  quantityFormula: string | null;
  costCodeRef: string | null;
  laborAssumptions: string | null;
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
  const [method, setMethod] = useState<PricingMethod>(item?.pricingMethod ?? "fixed");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const result = item ? await updateTemplateItem(fd) : await addTemplateItem(fd);
      if (!result.ok) return toast.error(result.error);
      toast.success(item ? "Item updated" : "Item added");
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

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <input type="hidden" name="templateId" value={templateId} />
      {item && <input type="hidden" name="id" value={item.id} />}

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="ti-name">Item name</Label>
          <Input id="ti-name" name="name" required defaultValue={item?.name ?? ""} placeholder="Flooring" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ti-category">Category</Label>
          <Input id="ti-category" name="category" defaultValue={item?.category ?? ""} placeholder="Flooring" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ti-code">4000-series code</Label>
          <select id="ti-code" name="costCodeRef" defaultValue={item?.costCodeRef ?? ""} className={selectClass}>
            <option value="">—</option>
            {codeOptions.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="ti-method">Pricing method</Label>
          <select
            id="ti-method"
            name="pricingMethod"
            value={method}
            onChange={(e) => setMethod(e.target.value as PricingMethod)}
            className={selectClass}
          >
            {PRICING_METHODS.map((m) => (
              <option key={m} value={m}>
                {PRICING_METHOD_LABELS[m]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ti-price">{method === "percent" ? "Percent (%)" : "Unit price ($)"}</Label>
          <Input
            id="ti-price"
            name="unitPrice"
            type="number"
            min="0"
            step="0.01"
            defaultValue={item?.unitPrice ?? ""}
            placeholder={method === "percent" ? "10" : "3.25"}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="ti-qty">Default quantity</Label>
          <Input
            id="ti-qty"
            name="defaultQuantity"
            type="number"
            min="0"
            step="0.01"
            defaultValue={item?.defaultQuantity ?? ""}
            placeholder="1"
          />
          <p className="text-[11px] text-muted-foreground">
            Fallback when the unit lacks the metadata (e.g. windows, cabinets).
          </p>
        </div>
        {method === "formula" && (
          <div className="space-y-1.5">
            <Label htmlFor="ti-formula">Quantity formula</Label>
            <Input
              id="ti-formula"
              name="quantityFormula"
              defaultValue={item?.quantityFormula ?? ""}
              placeholder="sqft * 0.1"
            />
            <p className="text-[11px] text-muted-foreground">Variables: sqft, beds, baths, windows, cabinets.</p>
          </div>
        )}
        {method !== "formula" && (
          <input type="hidden" name="quantityFormula" value={item?.quantityFormula ?? ""} />
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="ti-labor">Labor assumptions</Label>
          <Input id="ti-labor" name="laborAssumptions" defaultValue={item?.laborAssumptions ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ti-material">Material assumptions</Label>
          <Input id="ti-material" name="materialAssumptions" defaultValue={item?.materialAssumptions ?? ""} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ti-notes">Notes</Label>
        <Textarea id="ti-notes" name="notes" rows={2} defaultValue={item?.notes ?? ""} />
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : item ? "Save item" : "Add item"}
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
      <DialogTrigger render={<Button size="sm" />}>Add item</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add scope item</DialogTitle>
          <DialogDescription>Define one line of the renovation package.</DialogDescription>
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
      toast.success("Item removed");
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
          <DialogTitle>Edit scope item</DialogTitle>
        </DialogHeader>
        <TemplateItemForm
          templateId={templateId}
          item={item}
          interiorCodes={interiorCodes}
          onDone={() => setOpen(false)}
        />
        <DialogFooter className="border-t pt-3">
          <Button type="button" variant="outline" size="sm" onClick={handleDelete} disabled={busy}>
            Remove item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
