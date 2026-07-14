"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
import { createVendor } from "@/lib/actions/vendors";

export function AddVendorDialog({ propertyId }: { propertyId: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const fd = new FormData(e.currentTarget);
      const res = await createVendor(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Vendor added");
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>Add Vendor</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add vendor</DialogTitle>
          <DialogDescription>
            Vendors are shared across the portfolio — add once, bid anywhere.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <input type="hidden" name="propertyId" value={propertyId} />
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="vendor-name">Name</Label>
              <Input id="vendor-name" name="name" required placeholder="Apex Roofing" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vendor-trade">Trade</Label>
              <Input id="vendor-trade" name="trade" placeholder="Roofing" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vendor-notes">Notes</Label>
            <Input id="vendor-notes" name="notes" placeholder="Optional" />
          </div>

          <p className="pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Primary contact (optional)
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="vendor-contact-name">Contact name</Label>
              <Input id="vendor-contact-name" name="contactName" placeholder="Jane Doe" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vendor-contact-title">Title</Label>
              <Input id="vendor-contact-title" name="contactTitle" placeholder="Estimator" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vendor-contact-email">Email</Label>
              <Input
                id="vendor-contact-email"
                name="contactEmail"
                type="email"
                placeholder="jane@apexroofing.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vendor-contact-phone">Phone</Label>
              <Input id="vendor-contact-phone" name="contactPhone" placeholder="(713) 555-0100" />
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={busy}>
              {busy ? "Adding…" : "Add Vendor"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
