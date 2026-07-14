"use client"

import { Combobox } from "@base-ui/react/combobox"
import { CheckIcon, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

export type ComboboxSelectOption = {
  value: number
  label: string
}

/**
 * A type-ahead single-select: click/type to filter a list of options by
 * label, pick one. Value is `null` for "no selection" (mirrors a native
 * <select> with a blank option). Options must have unique `value`s —
 * compared by value, not object identity, so a freshly-mapped options
 * array each render doesn't break the current selection.
 */
export function ComboboxSelect({
  options,
  value,
  onValueChange,
  placeholder = "Search…",
  emptyMessage = "No matches",
  disabled,
  className,
}: {
  options: ComboboxSelectOption[]
  value: number | null
  onValueChange: (value: number | null) => void
  placeholder?: string
  emptyMessage?: string
  disabled?: boolean
  className?: string
}) {
  const selected = options.find((o) => o.value === value) ?? null

  return (
    <Combobox.Root
      items={options}
      value={selected}
      onValueChange={(item) => onValueChange(item ? (item as ComboboxSelectOption).value : null)}
      isItemEqualToValue={(a: ComboboxSelectOption, b: ComboboxSelectOption) => a.value === b.value}
      disabled={disabled}
    >
      <Combobox.InputGroup
        className={cn(
          "flex h-8 items-center rounded-md border border-input bg-transparent pr-1 pl-2 text-xs transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
          disabled && "pointer-events-none opacity-50",
          className,
        )}
      >
        <Combobox.Input
          placeholder={placeholder}
          className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-xs outline-none placeholder:text-muted-foreground"
        />
        <Combobox.Clear
          className="flex size-5 shrink-0 items-center justify-center border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground"
          aria-label="Clear"
        >
          <XIcon className="size-3.5" />
        </Combobox.Clear>
      </Combobox.InputGroup>

      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4} className="z-50 outline-none">
          <Combobox.Popup className="max-h-(--available-height) w-(--anchor-width) max-w-(--available-width) overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
            <Combobox.Empty className="px-2 py-2 text-xs text-muted-foreground">
              {emptyMessage}
            </Combobox.Empty>
            <Combobox.List>
              {(item: ComboboxSelectOption) => (
                <Combobox.Item
                  key={item.value}
                  value={item}
                  className="grid cursor-default grid-cols-[14px_1fr] items-center gap-1.5 rounded px-2 py-1.5 text-xs outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                >
                  <Combobox.ItemIndicator className="col-start-1 text-gold-link">
                    <CheckIcon className="size-3.5" />
                  </Combobox.ItemIndicator>
                  <span className="col-start-2 truncate">{item.label}</span>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}
