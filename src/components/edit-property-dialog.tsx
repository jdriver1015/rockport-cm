"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateProperty } from "@/lib/actions/properties";

export type EditablePropertyData = {
  id: number;
  name: string;
  entity: string | null;
  city: string | null;
  state: string | null;
  unitCount: number | null;
  pmSystem: string | null;
};

export function EditPropertyDialog({ property }: { property: EditablePropertyData }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await updateProperty(new FormData(e.currentTarget));
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Property updated");
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <Pencil className="mr-1.5 size-3.5" />
        Edit
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit property</DialogTitle>
          <DialogDescription>
            Update the basic details for {property.name}. Chart of accounts is changed separately.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="hidden" name="id" value={property.id} />
          <div className="space-y-1.5">
            <Label htmlFor="edit-name">Property name</Label>
            <Input id="edit-name" name="name" required defaultValue={property.name} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-entity">Entity</Label>
            <Input id="edit-entity" name="entity" defaultValue={property.entity ?? ""} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-city">City</Label>
              <Input id="edit-city" name="city" defaultValue={property.city ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-state">State</Label>
              <Input id="edit-state" name="state" defaultValue={property.state ?? ""} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-unitCount">Unit count</Label>
              <Input
                id="edit-unitCount"
                name="unitCount"
                type="number"
                min="1"
                defaultValue={property.unitCount ?? ""}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-pmSystem">PM system</Label>
              <Input id="edit-pmSystem" name="pmSystem" defaultValue={property.pmSystem ?? ""} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
