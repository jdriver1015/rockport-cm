"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/format";
import { TEMPLATE_PLACEHOLDERS } from "@/lib/contract-template-starter";
import {
  createContractTemplate,
  saveContractTemplate,
  setDefaultContractTemplate,
} from "@/lib/actions/contract-templates";

export type TemplateRow = {
  id: number;
  name: string;
  body: string;
  isDefault: boolean;
  version: number;
  updatedAt: string;
};

/**
 * The terms every contract is built from.
 *
 * A plain text area rather than a rich editor: the output is a PDF laid out by
 * the generator, so formatting typed here would be thrown away. Blank lines
 * separate paragraphs, and that is the whole format.
 */
export function ContractTemplateEditor({ templates }: { templates: TemplateRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState<number | null>(templates[0]?.id ?? null);

  const selected = templates.find((t) => t.id === selectedId) ?? null;
  // Keyed on id and version so picking another template — or a save landing —
  // reloads the fields instead of stranding the old draft in them.
  const editorKey = selected ? `${selected.id}:${selected.version}` : "none";

  function addTemplate() {
    startTransition(async () => {
      const res = await createContractTemplate({
        name: "Untitled template",
        body: "Terms go here.",
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setSelectedId(res.id);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-navy">Contract template</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            The terms every generated contract starts from. Editing this does not change contracts
            already generated — each one keeps a copy of the terms it was made with.
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={pending} onClick={addTemplate}>
          New template
        </Button>
      </div>

      {templates.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSelectedId(t.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-control border px-2.5 py-1.5 text-[12.5px]",
                t.id === selectedId
                  ? "border-navy/40 bg-navy/[0.04] font-medium text-navy"
                  : "border-border text-ink-500 hover:bg-track",
              )}
            >
              {t.isDefault && <CheckCircle2Icon className="size-3.5 text-positive" />}
              {t.name}
            </button>
          ))}
        </div>
      )}

      {selected ? (
        <TemplateForm key={editorKey} template={selected} />
      ) : (
        <p className="rounded-card border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          No contract template yet. Add one before generating a contract.
        </p>
      )}
    </div>
  );
}

function TemplateForm({ template }: { template: TemplateRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(template.name);
  const [body, setBody] = useState(template.body);

  const dirty = name !== template.name || body !== template.body;
  const unknown = [...body.matchAll(/\{\{(\w+)\}\}/g)]
    .map((m) => m[0])
    .filter((tok, i, all) => all.indexOf(tok) === i)
    .filter((tok) => !TEMPLATE_PLACEHOLDERS.some((p) => p.token === tok));

  function save() {
    startTransition(async () => {
      const res = await saveContractTemplate({
        id: template.id,
        name,
        body,
        version: template.version,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Template saved");
      router.refresh();
    });
  }

  function makeDefault() {
    startTransition(async () => {
      const res = await setDefaultContractTemplate({ id: template.id });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${template.name} is now the default`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          className="h-9 max-w-sm flex-1"
          value={name}
          disabled={pending}
          onChange={(e) => setName(e.target.value)}
          aria-label="Template name"
        />
        {template.isDefault ? (
          <span className="inline-flex items-center gap-1.5 rounded-control border border-positive/30 bg-positive-bg px-2.5 py-1.5 text-[12.5px] font-medium text-positive">
            <CheckCircle2Icon className="size-3.5" />
            Default
          </span>
        ) : (
          <Button variant="outline" size="sm" disabled={pending} onClick={makeDefault}>
            Make default
          </Button>
        )}
      </div>

      <textarea
        rows={22}
        value={body}
        disabled={pending}
        onChange={(e) => setBody(e.target.value)}
        aria-label="Template body"
        className="w-full rounded-control border border-input bg-card px-3 py-2 font-mono text-[12.5px] leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
      />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-300">
            Placeholders
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {TEMPLATE_PLACEHOLDERS.map((p) => (
              <span key={p.token} className="text-[11.5px] text-muted-foreground">
                <code className="text-ink-600">{p.token}</code> {p.describes}
              </span>
            ))}
          </div>
          {/*
            An unrecognised placeholder is left in the document as literal text
            rather than blanked, so it shows up in the draft. Saying so here is
            cheaper than someone finding {{retainage}} in a signed contract.
          */}
          {unknown.length > 0 && (
            <p className="text-[11.5px] text-alert">
              {unknown.join(", ")} {unknown.length === 1 ? "is not" : "are not"} filled in — they
              will appear in the contract exactly as written.
            </p>
          )}
          <p className="text-[11.5px] text-muted-foreground">
            Blank lines separate paragraphs. The scope table and the signature block are added by
            the generator.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[11.5px] text-muted-foreground">
            Saved {fmtDate(template.updatedAt)}
          </span>
          <Button disabled={pending || !dirty} onClick={save}>
            {pending ? "Saving…" : "Save template"}
          </Button>
        </div>
      </div>
    </div>
  );
}
