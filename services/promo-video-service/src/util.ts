export function truncate(text: string, limit = 240): string {
  if (!text) return "";
  const flat = String(text).trim().replace(/\n/g, " ");
  if (flat.length <= limit) return flat;
  return `${flat.slice(0, limit - 3)}...`;
}

export function envOrThrow(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is required`);
  return v;
}

export function envOr(
  name: string,
  fallback: string | undefined = undefined,
): string | undefined {
  const v = process.env[name]?.trim();
  return v || fallback;
}
