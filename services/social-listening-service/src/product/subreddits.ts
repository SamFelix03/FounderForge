const FALLBACK_SUBS = [
  "SaaS",
  "startups",
  "Entrepreneur",
  "smallbusiness",
  "productivity",
  "webdev",
  "devops",
  "artificial",
  "MachineLearning",
  "nocode",
  "indiehackers",
  "SideProject",
];

/** Normalize to bare subreddit name (no r/) and keep Reddit-safe names. */
export function sanitizeSubreddits(raw: unknown, max = 6): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (typeof item !== "string") continue;
    const name = item
      .trim()
      .replace(/^\/?r\//i, "")
      .replace(/\/+$/, "");
    if (!/^[A-Za-z0-9_]{2,21}$/.test(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= max) break;
  }
  if (out.length === 0) {
    return FALLBACK_SUBS.slice(0, Math.min(4, max));
  }
  return out;
}
