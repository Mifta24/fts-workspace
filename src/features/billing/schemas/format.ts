const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** 1536 → "1.5 KB". Plain decimals so every locale shows the same figure. */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 || value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${UNITS[unit]}`;
}

/** Share of a limit that is used, 0..100, for a progress bar. Null limit: nothing to measure. */
export function percentUsed(used: number, limit: number | null): number | null {
  if (limit === null) return null;
  if (limit <= 0) return 100;
  return Math.min(100, Math.round((used / limit) * 100));
}
