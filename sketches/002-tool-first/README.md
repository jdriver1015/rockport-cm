## Variant B — Tool-First

### Design stance

Utilitarian and dense. Everything is visible without clicking around — a persistent sidebar anchors project context while the main area is a fast, keyboard-friendly workspace.

### Key choices

- **Left sidebar** — phase status with inline gate panel (expandable), milestones with variance, unit economics (rent lift/payback), budget vs actual mini-summary, open items, key details (unit/vendor/budget group). The sidebar stays as you navigate tabs.
- **KPI bar becomes a compact horizontal row** below the header — same data, tighter presentation.
- **Scope table retains inline editing** but tighter: inputs are borderless-on-idle, border-on-focus (looks read-only until you interact). Columns reduced: item, cost code (select), qty, unit cost (the three editable fields), total (derived), actual (read). Row delete via inline "✕" button.
- **Cost log** is a collapsible toggle ("⊕ 24 posted transactions") below the scope table — expand on demand rather than a separate tab or sidebar card.
- **Tabs** expanded: Scope table / Documents / Site Audits / Cost log / Activity. The cost log gets its own tab or toggle — either works.

### Trade-offs

- **Strong at:** power users who live in this screen, rapid data entry, seeing all context at once without tab-hopping
- **Weak at:** first-time users (more visual density), narrow viewports (sidebar collapses)

### Best for

Construction managers and site supervisors who spend hours in the app daily and want maximum information density with minimal navigation.