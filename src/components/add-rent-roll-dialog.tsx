"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { RentRollUpload } from "@/components/rent-roll-upload";

export function AddRentRollDialog({ propertyId }: { propertyId: number }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>Add rent roll</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload a rent roll</DialogTitle>
          <DialogDescription>
            Drop a rent roll export (Excel, CSV, or PDF) from your property-management software.
            Columns are detected automatically, then you review the units and commit the snapshot.
          </DialogDescription>
        </DialogHeader>
        <RentRollUpload propertyId={propertyId} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
