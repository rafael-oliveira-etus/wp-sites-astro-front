import { describe, expect, it } from 'vitest'
import { parseDevices, reserveHeightStyle, reserveMediaCss } from '../src/serialize.ts'

describe('parseDevices', () => {
  it('parses a CSV to a device list; empty/undefined → undefined', () => {
    expect(parseDevices('mobile, desktop')).toEqual(['mobile', 'desktop'])
    expect(parseDevices(undefined)).toBeUndefined()
    expect(parseDevices('')).toBeUndefined()
  })
})

describe('reserve height', () => {
  it('inline style uses the smallest breakpoint', () => {
    expect(reserveHeightStyle({ 0: 280, 768: 90 })).toBe('min-height:280px;')
  })
  it('media CSS emits ascending non-zero breakpoints scoped to the id', () => {
    expect(reserveMediaCss('ad-x', { 0: 280, 768: 90, 1024: 250 })).toBe(
      '@media(min-width:768px){#ad-x{min-height:90px}}@media(min-width:1024px){#ad-x{min-height:250px}}',
    )
  })
})
