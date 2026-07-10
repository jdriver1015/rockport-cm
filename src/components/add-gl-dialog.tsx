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
import { GlUpload } from "@/components/gl-upload";

export function AddGlDialog({ propertyId }: { propertyId: number }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>Add GL</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import a GL export</DialogTitle>
          <DialogDescription>
            Drop a GL export from your property-management software. Rows are auto-mapped to cost
            codes, then you review and post.
          </DialogDescription>
        </DialogHeader>
        <GlUpload propertyId={propertyId} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
