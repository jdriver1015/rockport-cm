"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  archiveChart,
  cloneChart,
  createChart,
  createChartFromRows,
  parseChartWorkbook,
  setDefaultChart,
  updateChart,
  type ChartParsePreview,
} from "@/lib/actions/charts";
import {
  COLUMN_ROLES,
  type ChartColumnMapping,
  type ColumnRole,
  rowsFromGrid,
} from "@/lib/chart-import";

type ChartOption = { id: number; name: string };

const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50";

export function AddChartDialog({ charts }: { charts: ChartOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Upload state
  const [preview, setPreview] = useState<ChartParsePreview | null>(null);
  const [mapping, setMapping] = useState<ChartColumnMapping | null>(null);

  const importRows = useMemo(
    () => (preview && mapping ? rowsFromGrid(preview.body, mapping) : []),
    [preview, mapping],
  );

  function reset() {
    setPreview(null);
    setMapping(null);
    setBusy(false);
  }

  function done(chartId: number) {
    toast.success("Chart created");
    setOpen(false);
    reset();
    router.push(`/settings/chart-of-accounts/${chartId}`);
    router.refresh();
  }

  async function handleBlank(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const result = await createChart({
        name: String(fd.get("name") ?? ""),
        description: String(fd.get("description") ?? "") || undefined,
      });
      if (!result.ok) return toast.error(result.error);
      done(result.chartId);
    } finally {
      setBusy(false);
    }
  }

  async function handleClone(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const sourceChartId = Number(fd.get("sourceChartId"));
    if (!sourceChartId) return toast.error("Pick a chart to copy");
    setBusy(true);
    try {
      const result = await cloneChart({
        sourceChartId,
        name: String(fd.get("name") ?? ""),
        description: String(fd.get("description") ?? "") || undefined,
      });
      if (!result.ok) return toast.error(result.error);
      done(result.chartId);
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    setBusy(true);
    try {
      const result = await parseChartWorkbook(fd);
      if (!result.ok) {
        toast.error(result.error);
        setPreview(null);
        setMapping(null);
        return;
      }
      setPreview(result);
      setMapping(result.mapping);
    } finally {
      setBusy(false);
    }
  }

  async function handleUploadCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!preview || !mapping) return;
    if (mapping.code < 0) return toast.error("Map the Cost code column first");
    if (importRows.length === 0) return toast.error("No cost codes detected — check the column mapping");
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const result = await createChartFromRows({
        name: String(fd.get("name") ?? ""),
        description: String(fd.get("description") ?? "") || undefined,
        rows: importRows,
      });
      if (!result.ok) return toast.error(result.error);
      done(result.chartId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger render={<Button size="sm" />}>Add chart</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add chart of accounts</DialogTitle>
          <DialogDescription>Start blank, copy an existing chart, or import a spreadsheet.</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="blank">
          <TabsList className="w-full">
            <TabsTrigger value="blank">Blank</TabsTrigger>
            <TabsTrigger value="clone" disabled={charts.length === 0}>
              Copy existing
            </TabsTrigger>
            <TabsTrigger value="upload">Upload</TabsTrigger>
          </TabsList>

          {/* Blank */}
          <TabsContent value="blank">
            <form className="space-y-4" onSubmit={handleBlank}>
              <NameFields />
              <div className="flex justify-end">
                <Button type="submit" disabled={busy}>
                  {busy ? "Creating…" : "Create blank chart"}
                </Button>
              </div>
            </form>
          </TabsContent>

          {/* Clone */}
          <TabsContent value="clone">
            <form className="space-y-4" onSubmit={handleClone}>
              <div className="space-y-1.5">
                <Label htmlFor="clone-source">Copy from</Label>
                <select id="clone-source" name="sourceChartId" required defaultValue="" className={selectClass}>
                  <option value="" disabled>
                    Select a chart…
                  </option>
                  {charts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <NameFields />
              <div className="flex justify-end">
                <Button type="submit" disabled={busy}>
                  {busy ? "Copying…" : "Create from copy"}
                </Button>
              </div>
            </form>
          </TabsContent>

          {/* Upload */}
          <TabsContent value="upload">
            <form className="space-y-4" onSubmit={handleUploadCreate}>
              <div className="space-y-1.5">
                <Label htmlFor="chart-file">Spreadsheet (.xlsx / .xls / .csv)</Label>
                <Input
                  id="chart-file"
                  type="file"
                  accept=".xlsx,.xlsm,.xls,.csv"
                  onChange={handleFile}
                  disabled={busy}
                />
                <p className="text-xs text-muted-foreground">
                  Needs at least a cost-code column. Category and interior columns are optional.
                </p>
              </div>

              {preview && mapping && (
                <div className="space-y-3 rounded-md border bg-paper/50 p-3">
                  <p className="text-xs font-medium text-navy">Match columns</p>
                  <div className="grid grid-cols-2 gap-2">
                    {COLUMN_ROLES.map((role) => (
                      <div key={role.key} className="space-y-1">
                        <Label className="text-xs text-muted-foreground">
                          {role.label}
                          {role.required && " *"}
                        </Label>
                        <select
                          className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring"
                          value={mapping[role.key as ColumnRole]}
                          onChange={(ev) =>
                            setMapping({ ...mapping, [role.key]: Number(ev.target.value) })
                          }
                        >
                          <option value={-1}>—</option>
                          {preview.headers.map((h, i) => (
                            <option key={i} value={i}>
                              {h || `Column ${i + 1}`}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {importRows.length} cost code{importRows.length === 1 ? "" : "s"} across{" "}
                    {new Set(importRows.map((r) => r.categoryCode)).size} categor
                    {new Set(importRows.map((r) => r.categoryCode)).size === 1 ? "y" : "ies"} detected.
                  </p>
                </div>
              )}

              <NameFields />
              <div className="flex justify-end">
                <Button type="submit" disabled={busy || !preview}>
                  {busy ? "Importing…" : "Create from file"}
                </Button>
              </div>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function NameFields() {
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="chart-name">Chart name</Label>
        <Input id="chart-name" name="name" required placeholder="e.g. Value-Add Standard" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="chart-desc">Description</Label>
        <Textarea id="chart-desc" name="description" rows={2} placeholder="Optional" />
      </div>
    </>
  );
}

export function ChartRowActions({
  id,
  name,
  description,
  isDefault,
  propertyCount,
}: {
  id: number;
  name: string;
  description: string | null;
  isDefault: boolean;
  propertyCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    setBusy(true);
    try {
      const result = await fn();
      if (!result.ok) return toast.error(result.error ?? "Something went wrong");
      toast.success(ok);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const result = await updateChart({
        id,
        name: String(fd.get("name") ?? ""),
        description: String(fd.get("description") ?? "") || undefined,
      });
      if (!result.ok) return toast.error(result.error);
      toast.success("Chart updated");
      setEditOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" disabled={busy} />}>
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEditOpen(true)}>Rename / edit</DropdownMenuItem>
          {!isDefault && (
            <DropdownMenuItem onClick={() => run(() => setDefaultChart(id), "Set as default")}>
              Set as default
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={isDefault || propertyCount > 0}
            onClick={() => run(() => archiveChart(id), "Chart archived")}
          >
            Archive
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit chart</DialogTitle>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleEdit}>
            <div className="space-y-1.5">
              <Label htmlFor={`edit-chart-name-${id}`}>Name</Label>
              <Input id={`edit-chart-name-${id}`} name="name" defaultValue={name} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`edit-chart-desc-${id}`}>Description</Label>
              <Textarea
                id={`edit-chart-desc-${id}`}
                name="description"
                rows={2}
                defaultValue={description ?? ""}
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={busy}>
                Save
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
