/**
 * The one identity this sandbox runs as.
 *
 * There is no sign-in: every request is this admin. The id is fixed so the
 * seed script can create the matching `profiles` row that stage events,
 * uploads and manager assignments reference by foreign key.
 */
export const SANDBOX_USER = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "sandbox@rockport.test",
  fullName: "Sandbox Admin",
  role: "admin" as const,
};
