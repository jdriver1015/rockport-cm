"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDate, moneyExact } from "@/lib/format";
import type { ActionResult } from "@/lib/action-result";
import { addBid, deleteBid, setBidWinner } from "@/lib/actions/bids";

export type BidRow = {
  id: number;
  vendorName: string;
  contactName: string | null;
  amount: string;
  receivedDate: string | null;
  approved: boolean;
  note: string | null;
};

export type BidderVendor = {
  id: number;
  name: string;
  contacts: { id: number; name: string }[];
};

export function BidsCard({
  propertyId,
  projectId,
  bids,
  vendors,
}: {
  propertyId: number;
  projectId: number;
  bids: BidRow[];
  vendors: BidderVendor[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const run = (fn: () => Promise<ActionResult>, okMsg?: string) => {
    setPending(true);
    void (async () => {
      try {
        const res = await fn();
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        if (okMsg) toast.success(okMsg);
        router.refresh();
      } finally {
        setPending(false);
      }
    })();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base text-navy">Bids</CardTitle>
        <AddBidDialog propertyId={propertyId} projectId={projectId} vendors={vendors} />
      </CardHeader>
      <CardContent>
        {bids.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No bids yet — add bidders with “Add bid”, then mark the winner to commit the cost.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Received</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {bids.map((b) => (
                <TableRow key={b.id} className={pending ? "opacity-60" : undefined}>
                  <TableCell className="font-medium text-navy">
                    {b.vendorName}
                    {b.approved && (
                      <Badge variant="positive" className="ml-2">
                        Winner
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{b.contactName || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{moneyExact(b.amount)}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtDate(b.receivedDate)}</TableCell>
                  <TableCell className="max-w-48 truncate text-muted-foreground">
                    {b.note || "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {!b.approved && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() =>
                            run(
                              () => setBidWinner({ id: b.id, propertyId, projectId }),
                              "Winner set — vendor assigned and cost committed",
                            )
                          }
                        >
                          Mark winner
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => {
                          if (window.confirm(`Delete the ${b.vendorName} bid?`)) {
                            run(() => deleteBid({ id: b.id, propertyId, projectId }), "Bid deleted");
                          }
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function AddBidDialog({
  propertyId,
  projectId,
  vendors,
}: {
  propertyId: number;
  projectId: number;
  vendors: BidderVendor[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [vendorId, setVendorId] = useState("");

  const contacts = vendors.find((v) => String(v.id) === vendorId)?.contacts ?? [];

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const fd = new FormData(e.currentTarget);
      const res = await addBid(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Bid added");
      setOpen(false);
      setVendorId("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setVendorId("");
      }}
    >
      <DialogTrigger render={<Button size="sm" />}>Add bid</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add bid</DialogTitle>
          <DialogDescription>
            Record a bid from a vendor. Mark the winner to assign the vendor and commit the cost.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <input type="hidden" name="propertyId" value={propertyId} />
          <input type="hidden" name="projectId" value={projectId} />

          <div className="space-y-1.5">
            <Label htmlFor="bid-vendor">Vendor</Label>
            <select
              id="bid-vendor"
              name="vendorId"
              required
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <option value="" disabled>
                Select a vendor…
              </option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            {vendors.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No active vendors yet — add one on the Vendors tab first.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bid-contact">Contact</Label>
            <select
              id="bid-contact"
              name="contactId"
              defaultValue=""
              disabled={contacts.length === 0}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
            >
              <option value="">
                {contacts.length === 0 ? "No contacts for this vendor" : "Optional"}
              </option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="bid-amount">Amount ($)</Label>
              <Input
                id="bid-amount"
                name="amount"
                type="number"
                step="0.01"
                min="0"
                required
                placeholder="24,500.00"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bid-received">Received</Label>
              <Input id="bid-received" name="receivedDate" type="date" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bid-note">Note</Label>
            <Input id="bid-note" name="note" placeholder="Optional" />
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={busy || vendors.length === 0}>
              {busy ? "Adding…" : "Add bid"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
