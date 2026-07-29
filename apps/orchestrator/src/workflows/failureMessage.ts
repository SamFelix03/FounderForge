/**
 * Prefer the root ApplicationFailure / encoded product_url error over Temporal's
 * generic "Activity task failed" wrapper so jobs.error keeps `[code] message`.
 */
export function workflowFailureMessage(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let depth = 0; cur && depth < 10; depth++) {
    if (cur instanceof Error) {
      if (cur.message?.trim()) parts.push(cur.message.trim());
      const withType = cur as Error & { type?: string; cause?: unknown };
      if (
        typeof withType.type === "string" &&
        /^product_url_[a-z0-9_]+$/i.test(withType.type) &&
        cur.message &&
        !/^\[product_url_/i.test(cur.message)
      ) {
        parts.push(`[${withType.type}] ${cur.message}`);
      }
      cur = withType.cause;
      continue;
    }
    if (cur && typeof cur === "object" && "message" in cur) {
      const msg = String((cur as { message: unknown }).message ?? "");
      if (msg.trim()) parts.push(msg.trim());
      cur = "cause" in cur ? (cur as { cause?: unknown }).cause : undefined;
      continue;
    }
    parts.push(String(cur));
    break;
  }

  const encoded = parts.find((p) => /^\[[a-z0-9_]+\]/i.test(p));
  if (encoded) return encoded;

  const useful = parts.find(
    (p) =>
      p.length > 0 &&
      !/^Activity task failed/i.test(p) &&
      !/^Workflow (execution|task) failed/i.test(p) &&
      !/^Child Workflow execution failed/i.test(p),
  );
  return useful ?? parts[0] ?? String(err);
}
