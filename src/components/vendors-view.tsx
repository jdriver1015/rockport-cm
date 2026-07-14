"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
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
import type { ActionResult } from "@/lib/action-result";
import {
  addContact,
  setContactActive,
  setContactPrimary,
  setVendorActive,
  updateContact,
  updateVendor,
} from "@/lib/actions/vendors";

export type VendorContactRow = {
  id: number;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  active: boolean;
};

export type VendorRow = {
  id: number;
  name: string;
  trade: string | null;
  active: boolean;
  notes: string | null;
  contacts: VendorContactRow[];
  bidCount: number;
  wonCount: number;
};

export function VendorsView({
  propertyId,
  vendors,
}: {
  propertyId: number;
  vendors: VendorRow[];
}) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // Derive from props so a router.refresh() keeps the open dialog current.
  const selected = vendors.find((v) => v.id === selectedId) ?? null;

  if (vendors.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No vendors yet — add the first with “Add Vendor”.
      </p>
    );
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Vendor</TableHead>
            <TableHead>Trade</TableHead>
            <TableHead>Primary contact</TableHead>
            <TableHead className="text-right">Bids</TableHead>
            <TableHead className="text-right">Won</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {vendors.map((v) => {
            const primary = v.contacts.find((c) => c.isPrimary && c.active);
            return (
              <TableRow
                key={v.id}
                className="cursor-pointer"
                onClick={() => setSelectedId(v.id)}
              >
                <TableCell className="font-medium text-navy">{v.name}</TableCell>
                <TableCell className="text-muted-foreground">{v.trade || "—"}</TableCell>
                <TableCell className="text-muted-foreground">
                  {primary ? (
                    <span>
                      {primary.name}
                      {primary.email ? ` · ${primary.email}` : ""}
                      {primary.phone ? ` · ${primary.phone}` : ""}
                    </span>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{v.bidCount || "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{v.wonCount || "—"}</TableCell>
                <TableCell>
                  <Badge variant={v.active ? "positive" : "secondary"}>
                    {v.active ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <Dialog open={selected !== null} onOpenChange={(next) => !next && setSelectedId(null)}>
        <DialogContent className="sm:max-w-lg">
          {selected && (
            <VendorDetail
              key={selected.id}
              propertyId={propertyId}
              vendor={selected}
              onClose={() => setSelectedId(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function VendorDetail({
  propertyId,
  vendor,
  onClose,
}: {
  propertyId: number;
  vendor: VendorRow;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [editingVendor, setEditingVendor] = useState(false);
  const [contactForm, setContactForm] = useState<"closed" | "add" | number>("closed");

  const run = (fn: () => Promise<ActionResult>, okMsg?: string) => {
    setBusy(true);
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
        setBusy(false);
      }
    })();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{vendor.name}</DialogTitle>
        <DialogDescription>
          {[vendor.trade, `${vendor.bidCount} bids · ${vendor.wonCount} won at this property`]
            .filter(Boolean)
            .join(" · ")}
        </DialogDescription>
      </DialogHeader>

      {editingVendor ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            run(
              () =>
                updateVendor({
                  id: vendor.id,
                  propertyId,
                  name: String(fd.get("name") ?? ""),
                  trade: String(fd.get("trade") ?? ""),
                  notes: String(fd.get("notes") ?? ""),
                }),
              "Vendor updated",
            );
            setEditingVendor(false);
          }}
        >
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-vendor-name">Name</Label>
              <Input id="edit-vendor-name" name="name" required defaultValue={vendor.name} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-vendor-trade">Trade</Label>
              <Input id="edit-vendor-trade" name="trade" defaultValue={vendor.trade ?? ""} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-vendor-notes">Notes</Label>
            <Input id="edit-vendor-notes" name="notes" defaultValue={vendor.notes ?? ""} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setEditingVendor(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Save
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          {vendor.notes && <p className="text-sm text-muted-foreground">{vendor.notes}</p>}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Contacts ({vendor.contacts.filter((c) => c.active).length})
              </h4>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setContactForm(contactForm === "add" ? "closed" : "add")}
              >
                Add contact
              </Button>
            </div>

            {vendor.contacts.filter((c) => c.active).length === 0 && contactForm !== "add" ? (
              <p className="text-sm text-muted-foreground">No contacts yet.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {vendor.contacts
                  .filter((c) => c.active)
                  .map((c) =>
                    contactForm === c.id ? (
                      <li key={c.id} className="p-3">
                        <ContactForm
                          propertyId={propertyId}
                          vendorId={vendor.id}
                          existing={c}
                          busy={busy}
                          onSubmit={(fields) => {
                            run(() => updateContact({ id: c.id, propertyId, ...fields }), "Contact updated");
                            setContactForm("closed");
                          }}
                          onCancel={() => setContactForm("closed")}
                        />
                      </li>
                    ) : (
                      <li key={c.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                        <div className="min-w-0 flex-1">
                          <span className="font-medium text-navy">{c.name}</span>
                          {c.title && <span className="text-muted-foreground"> · {c.title}</span>}
                          {c.isPrimary && (
                            <Badge variant="secondary" className="ml-2 border border-border">
                              Primary
                            </Badge>
                          )}
                          <div className="truncate text-xs text-muted-foreground">
                            {[c.email, c.phone].filter(Boolean).join(" · ") || "—"}
                          </div>
                        </div>
                        {!c.isPrimary && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => run(() => setContactPrimary({ id: c.id, propertyId }))}
                          >
                            Make primary
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setContactForm(c.id)}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            run(() => setContactActive({ id: c.id, propertyId, active: false }), "Contact removed")
                          }
                        >
                          Remove
                        </Button>
                      </li>
                    ),
                  )}
                {contactForm === "add" && (
                  <li className="p-3">
                    <ContactForm
                      propertyId={propertyId}
                      vendorId={vendor.id}
                      busy={busy}
                      onSubmit={(fields, fd) => {
                        run(() => addContact(fd), "Contact added");
                        setContactForm("closed");
                      }}
                      onCancel={() => setContactForm("closed")}
                    />
                  </li>
                )}
              </ul>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                run(
                  () => setVendorActive({ id: vendor.id, propertyId, active: !vendor.active }),
                  vendor.active ? "Vendor deactivated" : "Vendor reactivated",
                );
                onClose();
              }}
            >
              {vendor.active ? "Deactivate" : "Reactivate"}
            </Button>
            <Button disabled={busy} onClick={() => setEditingVendor(true)}>
              Edit
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function ContactForm({
  propertyId,
  vendorId,
  existing,
  busy,
  onSubmit,
  onCancel,
}: {
  propertyId: number;
  vendorId: number;
  existing?: VendorContactRow;
  busy: boolean;
  onSubmit: (
    fields: { name: string; title: string; email: string; phone: string },
    fd: FormData,
  ) => void;
  onCancel: () => void;
}) {
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        onSubmit(
          {
            name: String(fd.get("name") ?? ""),
            title: String(fd.get("title") ?? ""),
            email: String(fd.get("email") ?? ""),
            phone: String(fd.get("phone") ?? ""),
          },
          fd,
        );
      }}
    >
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="vendorId" value={vendorId} />
      <div className="grid grid-cols-2 gap-3">
        <Input name="name" required placeholder="Name" defaultValue={existing?.name} />
        <Input name="title" placeholder="Title" defaultValue={existing?.title ?? ""} />
        <Input name="email" type="email" placeholder="Email" defaultValue={existing?.email ?? ""} />
        <Input name="phone" placeholder="Phone" defaultValue={existing?.phone ?? ""} />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={busy}>
          {existing ? "Save" : "Add"}
        </Button>
      </div>
    </form>
  );
}
