/**
 * Page-number sequence for a numbered pagination control. Always shows page 1 and
 * `total`, plus a window of `window` pages on each side of `current`. Runs of hidden
 * pages collapse to a single 'gap'; a gap that would hide only one page is replaced by
 * that page number (a "…" for one page wastes space).
 */
export function paginationItems(
  current: number,
  total: number,
  window = 2,
): Array<number | 'gap'> {
  if (total <= 1) return [];
  const pages = new Set<number>([1, total]);
  for (let p = current - window; p <= current + window; p++) {
    if (p >= 1 && p <= total) pages.add(p);
  }
  const sorted = [...pages].sort((a, b) => a - b);
  const out: Array<number | 'gap'> = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev) {
      if (p - prev === 2) out.push(prev + 1); // single hidden page -> show it
      else if (p - prev > 2) out.push('gap');
    }
    out.push(p);
    prev = p;
  }
  return out;
}
