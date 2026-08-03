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
  addTemplateLine,
  deleteTemplateLine,
  updateTemplateLine,
} from "@/lib/actions/budget-templates";

export type InteriorCodeOption = { code: string; name: string };

export type TemplateLine = {
  id: number;
  costCodeRef: string;
  pricingMethod: PricingMethod;
  unitPrice: string | null;
  defaultQuantity: string | null;
  notes: string | null;
};

const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50";

function TemplateLineForm({
  templateId,
  line,
  interiorCodes,
  onDone,
}: {
  templateId: number;
  line?: TemplateLine;
  interiorCodes: InteriorCodeOption[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState<PricingMethod>(line?.pricingMethod ?? "fixed");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const result = line ? await updateTemplateLine(fd) : await addTemplateLine(fd);
      if (!result.ok) return toast.error(result.error);
      toast.success(line ? "Budget line updated" : "Budget line added");
      onDone();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const codeOptions = [...interiorCodes];
  if (line?.costCodeRef && !codeOptions.some((c) => c.code === line.costCodeRef)) {
    codeOptions.unshift({ code: line.costCodeRef, name: "(current)" });
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <input type="hidden" name="templateId" value={templateId} />
      {line && <input type="hidden" name="id" value={line.id} />}

      <div className="space-y-1.5">
        <Label htmlFor="tl-code">Cost code</Label>
        <select
          id="tl-code"
          name="costCodeRef"
          required
          defaultValue={line?.costCodeRef ?? ""}
          className={selectClass}
        >
          <option value="" disabled>
            Select a cost code…
          </option>
          {codeOptions.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="tl-method">Pricing method</Label>
          <select
            id="tl-method"
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
          <Label htmlFor="tl-price">{method === "percent" ? "Percent (%)" : "Unit price ($)"}</Label>
          <Input
            id="tl-price"
            name="unitPrice"
            type="number"
            min="0"
            step="0.01"
            defaultValue={line?.unitPrice ?? ""}
            placeholder={method === "percent" ? "10" : "3.25"}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="tl-qty">Default quantity</Label>
        <Input
          id="tl-qty"
          name="defaultQuantity"
          type="number"
          min="0"
          step="0.01"
          defaultValue={line?.defaultQuantity ?? ""}
          placeholder="1"
        />
        <p className="text-[11px] text-muted-foreground">
          Fallback when the unit lacks the metadata for the pricing method.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="tl-notes">Notes</Label>
        <Textarea id="tl-notes" name="notes" rows={3} defaultValue={line?.notes ?? ""} placeholder="Scope descriptions, exclusions, etc." />
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : line ? "Save line" : "Add line"}
        </Button>
      </div>
    </form>
  );
}

export function AddTemplateLineDialog({
  templateId,
  interiorCodes,
}: {
  templateId: number;
  interiorCodes: InteriorCodeOption[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>Add budget line</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add budget line</DialogTitle>
          <DialogDescription>
            One line per cost code. Set the pricing method and default unit price.
          </DialogDescription>
        </DialogHeader>
        <TemplateLineForm
          templateId={templateId}
          interiorCodes={interiorCodes}
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

export function EditTemplateLineDialog({
  templateId,
  line,
  interiorCodes,
}: {
  templateId: number;
  line: TemplateLine;
  interiorCodes: InteriorCodeOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    setBusy(true);
    try {
      const result = await deleteTemplateLine({ id: line.id, templateId });
      if (!result.ok) return toast.error(result.error);
      toast.success("Budget line removed");
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
          <DialogTitle>Edit budget line</DialogTitle>
        </DialogHeader>
        <TemplateLineForm
          templateId={templateId}
          line={line}
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
