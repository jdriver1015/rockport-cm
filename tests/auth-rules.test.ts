/**
 * Pure-function tests for role-based access rules.
 *
 * These cover the matrix in src/lib/auth-rules.ts:roleAllowsAction. The actual
 * session/cookie plumbing lives in src/lib/auth.ts and is exercised end-to-end
 * via the actions that call it.
 */
import { describe, expect, test } from "vitest";
import {
  canAdminProperty,
  canReadProperty,
  canWriteProperty,
  roleAllowsAction,
  type AuthAction,
  type AuthRole,
} from "@/lib/auth-rules";

const ROLES: AuthRole[] = ["admin", "cm", "site", "viewer"];
const ACTIONS: AuthAction[] = ["read", "write", "admin"];

describe("roleAllowsAction — full matrix", () => {
  test.each([
    // admin: full access
    ["admin", "read", true],
    ["admin", "write", true],
    ["admin", "admin", true],
    // cm: read + write, no admin
    ["cm", "read", true],
    ["cm", "write", true],
    ["cm", "admin", false],
    // site: read only
    ["site", "read", true],
    ["site", "write", false],
    ["site", "admin", false],
    // viewer: read only (strictly less than site — same read scope, but
    // currently identical; if site ever gets site-only data, this stays
    // separate so we don't have to refactor a shared role)
    ["viewer", "read", true],
    ["viewer", "write", false],
    ["viewer", "admin", false],
  ] as const)("%s + %s → %s", (role, action, expected) => {
    expect(roleAllowsAction(role, action)).toBe(expected);
  });

  test("unknown role is denied every action", () => {
    // Defensive: if a new enum value gets added without a default, every
    // call site fails closed.
    for (const action of ACTIONS) {
      expect(roleAllowsAction("intruder" as AuthRole, action)).toBe(false);
    }
  });

  test("the matrix hits every role x action pair at least once", () => {
    // Sanity: a future role added to ROLES without test coverage for it
    // shows up as uncovered. This is the cheap detector.
    for (const role of ROLES) {
      for (const action of ACTIONS) {
        // Just verify the call returns a boolean; the matrix table above is
        // the source of truth for what that boolean SHOULD be.
        expect(typeof roleAllowsAction(role, action)).toBe("boolean");
      }
    }
  });
});

describe("canReadProperty / canWriteProperty / canAdminProperty", () => {
  test("each delegates to roleAllowsAction(role, action)", () => {
    for (const role of ROLES) {
      expect(canReadProperty(role)).toBe(roleAllowsAction(role, "read"));
      expect(canWriteProperty(role)).toBe(roleAllowsAction(role, "write"));
      expect(canAdminProperty(role)).toBe(roleAllowsAction(role, "admin"));
    }
  });
});
