"use client";

import { useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DocumentsDialogButton, type DocumentRow } from "@/components/document-manager";
import { ActivityLogDialogButton } from "@/components/project-log-dialog";
import {
  ProjectEditDialog,
  type ProjectCostCodeOption,
  type ProjectEditData,
} from "@/components/project-edit-dialog";
import { ArchiveProjectDialog } from "@/components/archive-project-dialog";
import { RestoreProjectButton } from "@/components/restore-project-button";
import { AddAuditDialog } from "@/components/add-audit-dialog";
import { SiteAuditsTable, type SiteAuditRow } from "@/components/site-audits-table";

/**
 * Derived from the component rather than imported: project-log-dialog does not
 * export its row type, and reaching through ComponentProps keeps this in step
 * with it automatically.
 */
type ActivityLogRow = React.ComponentProps<typeof ActivityLogDialogButton>["entries"][number];

/** Which panel the menu has opened, if any. */
type Panel = "documents" | "log" | "audits" | "newAudit" | "edit" | "archive" | null;

/**
 * Every action on a project behind one menu.
 *
 * These were five buttons across the header, which pushed the project's name and
 * figures into the space left over. They are also all occasional: filing a
 * document, reading the log, correcting a date. Collapsing them leaves the header
 * to say what the project IS, and the actions one click away.
 *
 * The menu owns the dialogs rather than each button owning its own, which is why
 * the underlying components take an optional open/onOpenChange pair — see
 * src/lib/use-dialog-open.ts.
 */
export function ProjectManageMenu({
  propertyId,
  propertySlug,
  projectId,
  projectName,
  projectKind,
  archived,
  documents,
  activityLog,
  editData,
  costCodes,
  audits,
  findingsByAudit,
  auditProjects,
  defaultAuditor,
}: {
  propertyId: number;
  propertySlug: string;
  projectId: number;
  projectName: string;
  projectKind: string;
  archived: boolean;
  documents: DocumentRow[];
  activityLog: ActivityLogRow[];
  editData: ProjectEditData;
  /** Non-interior codes from this property's chart, for the edit dialog. */
  costCodes: ProjectCostCodeOption[];
  audits: SiteAuditRow[];
  findingsByAudit: Map<number, number>;
  auditProjects: { id: number; name: string }[];
  defaultAuditor: string | null;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const close = () => setPanel(null);

  const redirectTo =
    projectKind === "unit" ? `/properties/${propertySlug}/interiors` : `/properties/${propertySlug}`;

  return (
    <div className="flex items-center gap-2">
      {/* Restore stays a button: an archived project has exactly one useful
          action, and burying it would make the page look read-only. */}
      {archived && <RestoreProjectButton projectId={projectId} />}

      <DropdownMenu>
        <DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>
          Manage
          <ChevronDownIcon className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={() => setPanel("documents")}>
            Documents{documents.length > 0 ? ` (${documents.length})` : ""}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setPanel("log")}>Activity log</DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={() => setPanel("audits")}>
            Site audits{audits.length > 0 ? ` (${audits.length})` : ""}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setPanel("newAudit")}>New site audit</DropdownMenuItem>

          {!archived && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setPanel("edit")}>Edit project</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => setPanel("archive")}>
                Archive project
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Mounted only while open, so five dialogs' worth of state and effects
          aren't live on every project page view. */}
      {panel === "documents" && (
        <DocumentsDialogButton
          propertyId={propertyId}
          projectId={projectId}
          documents={documents}
          open
          onOpenChange={(o) => !o && close()}
        />
      )}
      {panel === "log" && (
        <ActivityLogDialogButton entries={activityLog} open onOpenChange={(o) => !o && close()} />
      )}
      {panel === "newAudit" && (
        <AddAuditDialog
          propertyId={propertyId}
          propertySlug={propertySlug}
          defaultAuditor={defaultAuditor}
          projects={auditProjects}
          defaultProjectId={projectId}
          open
          onOpenChange={(o) => !o && close()}
        />
      )}
      {panel === "edit" && (
        <ProjectEditDialog
          costCodes={costCodes} project={editData} open onOpenChange={(o) => !o && close()} />
      )}
      {panel === "archive" && (
        <ArchiveProjectDialog
          propertySlug={propertySlug}
          projectId={projectId}
          projectName={projectName}
          redirectTo={redirectTo}
          open
          onOpenChange={(o) => !o && close()}
        />
      )}

      {/* The audit list is read-only here and links out. Adding one is its own
          menu item rather than a button inside this dialog, because a dialog
          opening a second dialog is a reliable way to trap someone. */}
      <Dialog open={panel === "audits"} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Site audits</DialogTitle>
            <DialogDescription>
              Walks recorded against {projectName}. Open one to see its findings.
            </DialogDescription>
          </DialogHeader>
          <SiteAuditsTable
            propertySlug={propertySlug}
            audits={audits}
            findingsByAudit={findingsByAudit}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
