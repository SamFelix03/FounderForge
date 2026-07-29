import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ProductUrlError } from "@founderforge/schemas";
import { fetchSiteCorpus, htmlToText } from "./fetchPage.js";

describe("social-listening fetchPage", () => {
  it("htmlToText strips scripts", () => {
    const text = htmlToText(
      "<html><script>evil()</script><p>Hello product</p></html>",
    );
    assert.match(text, /Hello product/);
    assert.doesNotMatch(text, /evil/);
  });

  it("fetchSiteCorpus throws product_url_unreachable for dead hosts", async () => {
    await assert.rejects(
      () => fetchSiteCorpus("https://this-domain-should-not-exist-ff-test-9f3a1.invalid/"),
      (err: unknown) => {
        assert.ok(err instanceof ProductUrlError);
        assert.ok(
          err.code === "product_url_unreachable" ||
            err.code === "product_url_timeout" ||
            err.code === "product_url_no_content",
        );
        assert.match(err.message, /^\[product_url_/);
        return true;
      },
    );
  });
});
