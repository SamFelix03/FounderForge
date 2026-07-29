import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CodedJobError } from "@founderforge/schemas";

/**
 * Lightweight guard: empty Reddit packs must throw before PDF compile.
 * Full planCycle is integration-heavy; this locks the error contract.
 */
describe("social-listening empty pack errors", () => {
  it("reddit_no_threads encodes for poll decode", () => {
    const err = new CodedJobError(
      "reddit_no_threads",
      'No matching Reddit threads found for "trackly.app"',
    );
    assert.equal(err.name, "CodedJobError");
    assert.equal(err.code, "reddit_no_threads");
    assert.match(err.message, /^\[reddit_no_threads\]/);
  });

  it("reddit_no_drafts encodes for poll decode", () => {
    const err = new CodedJobError(
      "reddit_no_drafts",
      "Found 2 Reddit thread(s) but none produced a usable suggested comment.",
    );
    assert.match(err.message, /^\[reddit_no_drafts\]/);
  });
});
