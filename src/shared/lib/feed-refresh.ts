/** Bound background work to an average of four page reads/minute; refresh complete windows coherently. */
export function feedRefreshInterval(pages: number): number {
  return 15000 * Math.max(1, Number.isFinite(pages) ? Math.floor(pages) : 1);
}
