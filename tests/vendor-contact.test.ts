/**
 * Pure-function tests for choosing who at a vendor gets an invitation.
 *
 * This was answered three different ways before `pickContact` existed: the
 * vendor step took min(email) and min(name) as independent aggregates, the
 * preview took the first active contact whether or not it had an address, and
 * the send took the first that did. So the list could show one person's name
 * beside another's email, and the draft that was approved could greet somebody
 * other than the person who received it.
 *
 * Branches covered:
 *  - the first contact holding an address wins, even when an earlier one does not
 *  - a vendor whose contacts have no address still yields a NAME, so the request
 *    can be reported as un-mailable rather than as belonging to nobody
 *  - whitespace is not an address
 *  - no contacts at all is null, which is a different thing from no address
 */
import { describe, expect, test } from "vitest";
import { pickContact } from "../src/lib/vendor-contact";

describe("pickContact", () => {
  test("takes the first contact that can actually be written to", () => {
    expect(
      pickContact([
        { name: "Front Desk", email: null },
        { name: "Estimating", email: "est@sub.com" },
        { name: "Owner", email: "owner@sub.com" },
      ]),
    ).toEqual({ name: "Estimating", email: "est@sub.com" });
  });

  test("keeps the pair together", () => {
    // The aggregate version could return {name: "Estimating", email: "a@b.com"}
    // from two different rows. Whatever comes back here is one person.
    const picked = pickContact([
      { name: "Zeb", email: "zeb@sub.com" },
      { name: "Abe", email: "abe@sub.com" },
    ]);
    expect(picked).toEqual({ name: "Zeb", email: "zeb@sub.com" });
  });

  test("names the vendor's contact even when nobody has an address", () => {
    expect(pickContact([{ name: "Front Desk", email: null }])).toEqual({
      name: "Front Desk",
      email: null,
    });
  });

  test("blank is not an address", () => {
    expect(pickContact([{ name: "Front Desk", email: "   " }])).toEqual({
      name: "Front Desk",
      email: null,
    });
  });

  test("no contacts is null, not a nameless contact", () => {
    expect(pickContact([])).toBeNull();
  });
});
