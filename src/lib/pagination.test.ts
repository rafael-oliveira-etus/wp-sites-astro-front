import { describe, expect, it } from 'vitest';
import { paginationItems } from './pagination';

describe('paginationItems', () => {
  it('returns [] when there is one page or fewer', () => {
    expect(paginationItems(1, 1)).toEqual([]);
    expect(paginationItems(1, 0)).toEqual([]);
  });
  it('lists every page when small (no gaps)', () => {
    expect(paginationItems(1, 5)).toEqual([1, 2, 3, 4, 5]);
  });
  it('puts a gap between first/last and the window', () => {
    expect(paginationItems(5, 10, 1)).toEqual([1, 'gap', 4, 5, 6, 'gap', 10]);
  });
  it('keeps first pages contiguous (no leading gap)', () => {
    expect(paginationItems(2, 10, 1)).toEqual([1, 2, 3, 'gap', 10]);
  });
  it('keeps last pages contiguous (no trailing gap)', () => {
    expect(paginationItems(9, 10, 1)).toEqual([1, 'gap', 8, 9, 10]);
  });
  it('never emits a gap that hides a single page (uses the number instead)', () => {
    // window touches page 3..5; page 2 is the only hidden one before -> show it, no gap
    expect(paginationItems(4, 6, 1)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
