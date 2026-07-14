"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDownIcon, ChevronRightIcon, PlusIcon, TrashIcon } from "lucide-react";
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
import { moneyExact, num } from "@/lib/format";
import type { ActionResult } from "@/lib/action-result";
import { addBid, deleteBid, editBid, restoreBid, setBidWinner } from "@/lib/actions/bids";

export type BidLineRow = {
  id: number;
  scopeItemId: number | null;
  description: string;
  amount: string;
};

export type BidRow = {
  id: number;
  vendorName: string;
  contactName: string | null;
  total: number;
  receivedDate: string | null;
  approved: boolean;
  note: string | null;
  lines: BidLineRow[];
};

export type BidderVendor = {
  id: number;
  name: string;
  contacts: { id: number; name: string }[];
};

export type ScopeLite = { id: number; item: string };

export function BidsCard({
  propertyId,
  projectId,
  bids,
  vendors,
  scopeItems,
}: {
  propertyId: number;
  projectId: number;
  bids: BidRow[];
  vendors: BidderVendor[];
  scopeItems: ScopeLite[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

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
        <BidFormDialog
          propertyId={propertyId}
          projectId={projectId}
          vendors={vendors}
          scopeItems={scopeItems}
        />
      </CardHeader>
      <CardContent>
        {bids.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No bids yet — add a bidder with “Add bid”, price the scope, then mark the winner to
            commit the cost.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Vendor</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {bids.map((b) => {
                const open = expanded === b.id;
                return (
                  <Fragment key={b.id}>
                    <TableRow className={pending ? "opacity-60" : undefined}>
                      <TableCell>
                        <button
                          type="button"
                          aria-label={open ? "Collapse" : "Expand"}
                          onClick={() => setExpanded(open ? null : b.id)}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          {open ? (
                            <ChevronDownIcon className="size-4" />
                          ) : (
                            <ChevronRightIcon className="size-4" />
                          )}
                        </button>
                      </TableCell>
                      <TableCell className="font-medium text-navy">
                        {b.vendorName}
                        {b.approved && (
                          <Badge variant="positive" className="ml-2">
                            Winner
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{b.contactName || "—"}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums text-navy">
                        {moneyExact(b.total)}
                      </TableCell>
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
                          <BidFormDialog
                            propertyId={propertyId}
                            projectId={projectId}
                            vendors={vendors}
                            scopeItems={scopeItems}
                            existing={b}
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={pending}
                            onClick={() => {
                              setPending(true);
                              void (async () => {
                                try {
                                  const res = await deleteBid({ id: b.id, propertyId, projectId });
                                  if (!res.ok) {
                                    toast.error(res.error);
                                    return;
                                  }
                                  toast.success("Bid deleted", {
                                    action: {
                                      label: "Undo",
                                      onClick: () => {
                                        void (async () => {
                                          const undo = await restoreBid({
                                            id: b.id,
                                            propertyId,
                                            projectId,
                                          });
                                          if (!undo.ok) toast.error(undo.error);
                                          router.refresh();
                                        })();
                                      },
                                    },
                                  });
                                  router.refresh();
                                } finally {
                                  setPending(false);
                                }
                              })();
                            }}
                          >
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {open && (
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableCell />
                        <TableCell colSpan={5} className="py-3">
                          <BidLineDetail lines={b.lines} total={b.total} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function BidLineDetail({ lines, total }: { lines: BidLineRow[]; total: number }) {
  if (lines.length === 0) {
    return <p className="text-sm text-muted-foreground">No line items on this bid.</p>;
  }
  return (
    <div className="max-w-md space-y-1">
      {lines.map((l) => (
        <div key={l.id} className="flex justify-between gap-4 text-sm">
          <span className="text-muted-foreground">
            {l.description}
            {l.scopeItemId === null && (
              <span className="ml-1.5 text-xs uppercase tracking-wide text-muted-foreground/70">
                manual
              </span>
            )}
          </span>
          <span className="tabular-nums text-navy">{moneyExact(l.amount)}</span>
        </div>
      ))}
      <div className="mt-1 flex justify-between gap-4 border-t pt-1 text-sm font-semibold">
        <span className="text-navy">Total</span>
        <span className="tabular-nums text-navy">{moneyExact(total)}</span>
      </div>
    </div>
  );
}

// Working line in the form: scope lines are locked (description = scope item,
// not removable) and manual lines are free-form and removable.
type FormLine = {
  key: string;
  scopeItemId: number | null;
  description: string;
  amount: string;
  locked: boolean;
};

function buildInitialLines(scopeItems: ScopeLite[], existing?: BidRow): FormLine[] {
  const byScope = new Map<number, BidLineRow>();
  const manual: BidLineRow[] = [];
  for (const l of existing?.lines ?? []) {
    if (l.scopeItemId !== null && scopeItems.some((s) => s.id === l.scopeItemId)) {
      byScope.set(l.scopeItemId, l);
    } else {
      manual.push(l);
    }
  }

  const scopeLines: FormLine[] = scopeItems.map((s) => {
    const line = byScope.get(s.id);
    return {
      key: `scope-${s.id}`,
      scopeItemId: s.id,
      description: s.item,
      amount: line ? line.amount : "",
      locked: true,
    };
  });

  const manualLines: FormLine[] = manual.map((l, i) => ({
    key: `manual-${l.id}-${i}`,
    scopeItemId: null,
    description: l.description,
    amount: l.amount,
    locked: false,
  }));

  return [...scopeLines, ...manualLines];
}

function BidFormDialog({
  propertyId,
  projectId,
  vendors,
  scopeItems,
  existing,
}: {
  propertyId: number;
  projectId: number;
  vendors: BidderVendor[];
  scopeItems: ScopeLite[];
  existing?: BidRow;
}) {
  const router = useRouter();
  const editing = !!existing;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Seed vendor from the existing bid by matching the vendor name.
  const existingVendorId = useMemo(
    () => (existing ? vendors.find((v) => v.name === existing.vendorName)?.id : undefined),
    [existing, vendors],
  );
  const [vendorId, setVendorId] = useState(existingVendorId ? String(existingVendorId) : "");
  const [contactId, setContactId] = useState("");
  const [receivedDate, setReceivedDate] = useState(existing?.receivedDate ?? "");
  const [note, setNote] = useState(existing?.note ?? "");
  const [lines, setLines] = useState<FormLine[]>(() => buildInitialLines(scopeItems, existing));
  let manualCounter = 0;

  function reset() {
    setVendorId(existingVendorId ? String(existingVendorId) : "");
    setContactId("");
    setReceivedDate(existing?.receivedDate ?? "");
    setNote(existing?.note ?? "");
    setLines(buildInitialLines(scopeItems, existing));
  }

  const contacts = vendors.find((v) => String(v.id) === vendorId)?.contacts ?? [];
  const total = lines.reduce((s, l) => s + num(l.amount), 0);

  function updateLine(key: string, patch: Partial<FormLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function addManualLine() {
    setLines((prev) => [
      ...prev,
      {
        key: `new-${prev.length}-${manualCounter++}`,
        scopeItemId: null,
        description: "",
        amount: "",
        locked: false,
      },
    ]);
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    // Scope lines only count when priced; manual lines need a description + amount.
    const payloadLines: { scopeItemId: number | null; description: string; amount: number }[] = [];
    for (const l of lines) {
      const hasAmount = l.amount.trim() !== "" && !Number.isNaN(Number(l.amount));
      if (l.locked) {
        if (hasAmount) {
          payloadLines.push({
            scopeItemId: l.scopeItemId,
            description: l.description,
            amount: num(l.amount),
          });
        }
      } else {
        const hasDesc = l.description.trim() !== "";
        if (!hasDesc && !hasAmount) continue; // ignore blank manual rows
        if (!hasDesc) {
          toast.error("Each manual line needs a description");
          return;
        }
        if (!hasAmount) {
          toast.error(`Enter an amount for “${l.description.trim()}”`);
          return;
        }
        payloadLines.push({
          scopeItemId: null,
          description: l.description.trim(),
          amount: num(l.amount),
        });
      }
    }

    if (!vendorId) {
      toast.error("Choose a vendor");
      return;
    }
    if (payloadLines.length === 0) {
      toast.error("Price at least one scope item or add a manual line");
      return;
    }

    setBusy(true);
    try {
      const base = {
        propertyId,
        projectId,
        vendorId: Number(vendorId),
        contactId: contactId ? Number(contactId) : null,
        receivedDate: receivedDate || undefined,
        note: note.trim() || undefined,
        lines: payloadLines,
      };
      const res = editing ? await editBid({ id: existing!.id, ...base }) : await addBid(base);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(editing ? "Bid updated" : "Bid added");
      setOpen(false);
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
        if (next) reset();
      }}
    >
      <DialogTrigger render={<Button size="sm" variant={editing ? "ghost" : "default"} />}>
        {editing ? "Edit" : "Add bid"}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit bid" : "Add bid"}</DialogTitle>
          <DialogDescription>
            Price each scope item and add any labor or manual lines. The total is the sum of the
            lines.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="bid-vendor">Vendor</Label>
              <select
                id="bid-vendor"
                required
                value={vendorId}
                onChange={(e) => {
                  setVendorId(e.target.value);
                  setContactId("");
                }}
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
                  No active vendors yet — add one on the Vendors page first.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bid-contact">Contact</Label>
              <select
                id="bid-contact"
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
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
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Priced lines</Label>
              <Button type="button" size="sm" variant="ghost" onClick={addManualLine}>
                <PlusIcon className="size-4" /> Add line
              </Button>
            </div>

            {lines.length === 0 ? (
              <p className="rounded-md border border-dashed py-4 text-center text-xs text-muted-foreground">
                No scope items yet. Add scope items to the project, or add manual lines here.
              </p>
            ) : (
              <div className="space-y-1.5">
                {lines.map((l) => (
                  <div key={l.key} className="flex items-center gap-2">
                    {l.locked ? (
                      <span className="flex-1 truncate text-sm text-navy" title={l.description}>
                        {l.description}
                      </span>
                    ) : (
                      <Input
                        aria-label="Line description"
                        placeholder="Labor, mobilization, …"
                        value={l.description}
                        onChange={(e) => updateLine(l.key, { description: e.target.value })}
                        className="flex-1"
                      />
                    )}
                    <Input
                      aria-label="Amount"
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={l.amount}
                      onChange={(e) => updateLine(l.key, { amount: e.target.value })}
                      className="w-32 text-right"
                    />
                    {l.locked ? (
                      <span className="w-8" />
                    ) : (
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Remove line"
                        onClick={() => removeLine(l.key)}
                      >
                        <TrashIcon className="size-4" />
                      </Button>
                    )}
                  </div>
                ))}
                <div className="flex items-center justify-between border-t pt-2 text-sm font-semibold">
                  <span className="text-navy">Total</span>
                  <span className="w-32 pr-10 text-right tabular-nums text-navy">
                    {moneyExact(total)}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="bid-received">Received</Label>
              <Input
                id="bid-received"
                type="date"
                value={receivedDate}
                onChange={(e) => setReceivedDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bid-note">Note</Label>
              <Input
                id="bid-note"
                placeholder="Optional"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={busy || vendors.length === 0}>
              {busy ? "Saving…" : editing ? "Save bid" : "Add bid"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
