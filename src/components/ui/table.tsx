"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t border-border bg-band font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b border-hairline transition-colors hover:bg-hover has-aria-expanded:bg-hover data-[state=selected]:bg-hover",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-9 px-3 text-left align-middle text-[10.5px] font-semibold tracking-[0.09em] whitespace-nowrap text-ink-300 uppercase [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "px-3 py-2.5 align-middle text-[13.5px] whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

/**
 * Section header row — the one saturated gray band in a table. Sections read as
 * discrete blocks rather than one striped mass, so these don't react to hover.
 */
function TableGroupRow({
  label,
  count,
  colSpan,
}: {
  label: string;
  count?: number | string;
  colSpan: number;
}) {
  return (
    <tr data-slot="table-group-row" className="bg-band">
      <td
        colSpan={colSpan}
        className="px-3 py-2.5 text-[11.5px] font-bold tracking-[0.09em] text-ink-900 uppercase"
      >
        <div className="flex items-center justify-between">
          <span>{label}</span>
          {count != null ? <span className="text-ink-400">{count}</span> : null}
        </div>
      </td>
    </tr>
  )
}

/**
 * 14px of white air before a section band. This is what stops consecutive
 * sections from running together — use before every band except the first.
 */
function TableSpacerRow({ colSpan }: { colSpan: number }) {
  return (
    <tr data-slot="table-spacer-row" aria-hidden>
      <td colSpan={colSpan} className="h-3.5 p-0" />
    </tr>
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
  TableGroupRow,
  TableSpacerRow,
}
