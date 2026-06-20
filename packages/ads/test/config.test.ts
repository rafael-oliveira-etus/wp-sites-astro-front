import { describe, expect, it } from 'vitest'
import {
  TEST_NETWORK_CODE,
  effectiveNetworkCode,
  fullAdUnit,
  sortedBreakpoints,
  withDefaults,
} from '../src/config.ts'
import type { AdsSiteConfig } from '../src/types.ts'

describe('effectiveNetworkCode', () => {
  const cfg = { networkCode: '21842055933', testNetworkCode: '6355419' }
  it('live → the real network', () => {
    expect(effectiveNetworkCode(cfg, 'live')).toBe('21842055933')
  })
  it('test → the sample/test network', () => {
    expect(effectiveNetworkCode(cfg, 'test')).toBe('6355419')
  })
  it('test falls back to Google sample network when none set', () => {
    expect(effectiveNetworkCode({ networkCode: '123' }, 'test')).toBe(TEST_NETWORK_CODE)
    expect(TEST_NETWORK_CODE).toBe('6355419')
  })
  it('off → the real network (the component gates rendering, not the path)', () => {
    expect(effectiveNetworkCode(cfg, 'off')).toBe('21842055933')
  })
})

describe('withDefaults', () => {
  it('applies sensible defaults', () => {
    const r = withDefaults({ networkCode: '123' })
    expect(r.singleRequest).toBe(true)
    expect(r.enablePpid).toBe(true)
    expect(r.forceNpa).toBe(false)
    expect(r.lazyLoad).toEqual({ fetchMarginPercent: 500, renderMarginPercent: 200, mobileScaling: 2 })
    expect(r.secureSignalProviders).toEqual([])
  })

  it('does not attach optional fields when absent (clean JSON blob)', () => {
    const r = withDefaults({ networkCode: '123' })
    expect('collapseDiv' in r).toBe(false)
    expect('pps' in r).toBe(false)
    expect('tagForAgeTreatment' in r).toBe(false)
    expect('mcmManagerDomain' in r).toBe(false)
  })

  it('respects overrides', () => {
    const cfg: AdsSiteConfig = {
      networkCode: '21842055933',
      singleRequest: false,
      collapseDiv: 'ON_NO_FILL',
      lazyLoad: { mobileScaling: 1.5 },
      tagForAgeTreatment: 'CHILD',
      mcmManagerDomain: 'brius.com.br',
    }
    const r = withDefaults(cfg)
    expect(r.singleRequest).toBe(false)
    expect(r.collapseDiv).toBe('ON_NO_FILL')
    expect(r.lazyLoad.mobileScaling).toBe(1.5)
    expect(r.lazyLoad.fetchMarginPercent).toBe(500) // still defaulted (Google sample example)
    expect(r.tagForAgeTreatment).toBe('CHILD')
    expect(r.mcmManagerDomain).toBe('brius.com.br')
  })
})

describe('fullAdUnit', () => {
  it('joins network + unit, trimming slashes', () => {
    expect(fullAdUnit('123', 'post/top')).toBe('/123/post/top')
    expect(fullAdUnit('123', '/post/top/')).toBe('/123/post/top')
    expect(fullAdUnit('123', 'anchor')).toBe('/123/anchor')
  })
})

describe('sortedBreakpoints', () => {
  it('sorts descending so the largest match wins', () => {
    expect(sortedBreakpoints({ 0: 1, 768: 1, 1024: 1 })).toEqual([1024, 768, 0])
  })
})
