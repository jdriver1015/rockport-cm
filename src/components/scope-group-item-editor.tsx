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
import { addGroupItem, deleteGroupItem, updateGroupItem } from "@/lib/actions/scope-groups";

export type ChartCodeOption = { id: number; code: string; name: string };

export type GroupItem = {
  id: number;
  name: string;
  category: string | null;
  pricingMethod: PricingMethod;
  unitPrice: string | null;
  defaultQuantity: string | null;
  quantityFormula: string | null;
  costCodeId: number | null;
  laborAssumptions: string | null;
  materialAssumptions: string | null;
  notes: string | null;
};

const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50";

function GroupItemForm({
  propertyId,
  scopeGroupId,
  interiorCodes,
  item,
  onDone,
}: {
  propertyId: number;
  scopeGroupId: number;
  interiorCodes: ChartCodeOption[];
  item?: GroupItem;
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
      const result = item ? await updateGroupItem(fd) : await addGroupItem(fd);
      if (!result.ok) return toast.error(result.error);
      toast.success(item ? "Item updated" : "Item added");
      onDone();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="scopeGroupId" value={scopeGroupId} />
      {item && <input type="hidden" name="id" value={item.id} />}

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="gi-name">Item name</Label>
          <Input id="gi-name" name="name" required defaultValue={item?.name ?? ""} placeholder="Flooring" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gi-category">Category</Label>
          <Input id="gi-category" name="category" defaultValue={item?.category ?? ""} placeholder="Flooring" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gi-code">4000-series code</Label>
          <select id="gi-code" name="costCodeId" defaultValue={item?.costCodeId ?? ""} className={selectClass}>
            <option value="">—</option>
            {interiorCodes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="gi-method">Pricing method</Label>
          <select
            id="gi-method"
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
          <Label htmlFor="gi-price">{method === "percent" ? "Percent (%)" : "Unit price ($)"}</Label>
          <Input
            id="gi-price"
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
          <Label htmlFor="gi-qty">Default quantity</Label>
          <Input
            id="gi-qty"
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
        {method === "formula" ? (
          <div className="space-y-1.5">
            <Label htmlFor="gi-formula">Quantity formula</Label>
            <Input
              id="gi-formula"
              name="quantityFormula"
              defaultValue={item?.quantityFormula ?? ""}
              placeholder="sqft * 0.1"
            />
            <p className="text-[11px] text-muted-foreground">Variables: sqft, beds, baths, windows, cabinets.</p>
          </div>
        ) : (
          <input type="hidden" name="quantityFormula" value={item?.quantityFormula ?? ""} />
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="gi-labor">Labor assumptions</Label>
          <Input id="gi-labor" name="laborAssumptions" defaultValue={item?.laborAssumptions ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gi-material">Material assumptions</Label>
          <Input id="gi-material" name="materialAssumptions" defaultValue={item?.materialAssumptions ?? ""} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="gi-notes">Notes</Label>
        <Textarea id="gi-notes" name="notes" rows={2} defaultValue={item?.notes ?? ""} />
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : item ? "Save item" : "Add item"}
        </Button>
      </div>
    </form>
  );
}

export function AddGroupItemDialog({
  propertyId,
  scopeGroupId,
  interiorCodes,
}: {
  propertyId: number;
  scopeGroupId: number;
  interiorCodes: ChartCodeOption[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>Add item</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add scope item</DialogTitle>
          <DialogDescription>Define one line of this renovation package.</DialogDescription>
        </DialogHeader>
        <GroupItemForm
          propertyId={propertyId}
          scopeGroupId={scopeGroupId}
          interiorCodes={interiorCodes}
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

export function EditGroupItemDialog({
  propertyId,
  scopeGroupId,
  interiorCodes,
  item,
}: {
  propertyId: number;
  scopeGroupId: number;
  interiorCodes: ChartCodeOption[];
  item: GroupItem;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    setBusy(true);
    try {
      const result = await deleteGroupItem({ id: item.id, propertyId });
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
        <GroupItemForm
          propertyId={propertyId}
          scopeGroupId={scopeGroupId}
          interiorCodes={interiorCodes}
          item={item}
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
