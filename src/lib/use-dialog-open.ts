"use client";

import { useState } from "react";

/**
 * Lets a self-contained dialog component also be driven from outside.
 *
 * These dialogs each owned their own open state and rendered their own trigger
 * button, which is right when they sit in a toolbar. Consolidating a screen's
 * actions into one menu means the menu has to open them instead — so each
 * accepts an optional `open`/`onOpenChange` pair and, when given one, renders no
 * trigger of its own.
 *
 * Returns `hasTrigger` rather than making the caller re-derive it, because
 * forgetting to hide the trigger leaves an orphan button next to the menu.
 */
export type ControllableDialog = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function useDialogOpen({ open, onOpenChange }: ControllableDialog) {
  const [selfOpen, setSelfOpen] = useState(false);
  const controlled = open !== undefined;
  return {
    open: controlled ? open : selfOpen,
    setOpen: controlled ? (onOpenChange ?? (() => {})) : setSelfOpen,
    /** False when a parent is driving this dialog from its own menu. */
    hasTrigger: !controlled,
  };
}
