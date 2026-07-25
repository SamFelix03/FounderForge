export interface SpreadItem<T> {
  item: T;
  scheduledAt: Date;
  index: number;
}

/**
 * Spread N items evenly across the next `windowHours` hours.
 * scheduled_at[i] = now + i * (windowMs / N)
 */
export function spreadAcrossWindow<T>(
  items: T[],
  windowHours = 24,
  now = new Date(),
): SpreadItem<T>[] {
  const N = items.length;
  if (N === 0) return [];
  const windowMs = windowHours * 60 * 60 * 1000;
  const interval = Math.floor(windowMs / N);
  return items.map((item, index) => ({
    item,
    index,
    scheduledAt: new Date(now.getTime() + index * interval),
  }));
}

export function formatInterval(windowHours: number, n: number): string {
  if (n <= 0) return "n/a";
  const minutes = Math.round((windowHours * 60) / n);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h <= 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
