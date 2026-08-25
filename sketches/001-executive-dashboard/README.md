## Variant A — Executive Dashboard

### Design stance

Calm, at-a-glance. Information hierarchy drives the layout: the most important thing (money status) comes first, then progression (phase), then the work (scope table). Click-to-edit dialogs keep the table clean for reading.

### Key choices

- **KPI bar across the top** — the 4-column financial model (Budgeted / Committed / Actual / Remaining) plus Trade-Out Lift for unit projects. This is the first thing you see. Green for remaining/positive, red for over budget.
- **Phase stepper** — visual done/active/todo pipeline with gate tooltips, plus an "Advance →" button that opens the gate-check dialog. StatusBadgeDropdown becomes secondary (still shows current phase in header).
- **Scope table** — read-only by default. Columns reduced from 8 to 6 (dropped Description/Material Quality as its own column merged into Item, dropped "Reconciled cost" since the KPI bar handles it at project level). Click any row to open an inline edit dialog.
- **Cost detail sidebar** — per-code committed vs actual summary alongside the scope table. "View 24 transactions" link expands.
- **Tabs remain** (Overview/Documents/Audits/Activity) but renamed "Activity" from "Log".

### Trade-offs

- **Strong at:** answering "are we on budget?" at a glance, onboarding new users, board/management reviews
- **Weak at:** power users who want to mass-edit scope lines quickly (click-to-edit adds a click per row)

### Best for

Project managers who need to quickly assess project health and drill into problems. CFOs/board reviewers who want the financial summary front and center.