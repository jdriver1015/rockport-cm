import { redirect } from "next/navigation";

// Renamed to /settings/renovation-types — one name for this concept across the
// app. Keep this route so old links and bookmarks still work.
export default function BudgetTemplatesRedirect() {
  redirect("/settings/renovation-types");
}
