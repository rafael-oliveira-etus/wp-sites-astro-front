import { describe, expect, it } from 'vitest'
import {
  bootAnchorScript,
  bootDisplayScript,
  bootGptScript,
  bootInterstitialScript,
  bootPpidScript,
  bootRuntimeScript,
  bootSideRailScript,
  bootSlotScript,
} from '../src/emit.ts'
import type { AdsSiteConfig } from '../src/types.ts'

const cfg: AdsSiteConfig = { networkCode: '21842055933', lazyLoad: { mobileScaling: 2 } }

describe('bootGptScript', () => {
  const s = bootGptScript(cfg)
  it('uses the modern setConfig API + forces SafeFrame; enableServices is NOT here (moved to the display pass)', () => {
    expect(s).toContain('googletag.setConfig(')
    expect(s).toContain('"singleRequest":true')
    expect(s).toContain('"forceSafeFrame":true')
    expect(s).toContain('mobileScaling')
    // SRA define-all-then-display: enableServices runs once in bootDisplayScript.
    expect(s).not.toContain('enableServices()')
  })
  it('queues via cmd.push so it is ready before gpt.js drains it', () => {
    expect(s).toContain('googletag.cmd.push')
  })
  it('does NOT contain any deprecated/phantom GPT calls', () => {
    for (const bad of [
      'enableSingleRequest',
      'enableLazyLoad',
      'enableAsyncRendering',
      'disableInitialLoad',
      'collapseEmptyDivs',
      'setTargeting',
    ]) {
      expect(s).not.toContain(bad)
    }
  })
})

describe('bootDisplayScript (single SRA display pass)', () => {
  const s = bootDisplayScript()
  it('enables services then displays every registered slot once', () => {
    expect(s).toContain('googletag.cmd.push')
    expect(s).toContain('enableServices()')
    expect(s).toContain('__etusGptSlots')
    expect(s).toContain('googletag.display(id)')
  })
})

describe('bootSlotScript', () => {
  it('defines + size-maps + REGISTERS the slot inline (no inline display — SRA batches)', () => {
    const s = bootSlotScript('123', {
      adUnit: 'post/top',
      sizes: { 0: [[300, 250]], 768: [[728, 90]] },
      reserve: { 0: 280 },
      id: 'ad-x',
    })
    expect(s).toContain('defineSlot("/123/post/top"')
    expect(s).toContain('sizeMapping()')
    expect(s).toContain('addSize([768,0]')
    expect(s).not.toContain('display(')
    expect(s).toContain('__etusGptSlots')
    expect(s).toContain('push("ad-x")')
  })
  it('registers refresh only when requested', () => {
    const off = bootSlotScript('123', {
      adUnit: 'x',
      sizes: { 0: [[300, 250]] },
      reserve: { 0: 280 },
      id: 'y',
    })
    expect(off).not.toContain('__etusAdRefresh')
    const on = bootSlotScript('123', {
      adUnit: 'x',
      sizes: { 0: [[300, 250]] },
      reserve: { 0: 280 },
      id: 'y',
      refresh: { intervalSec: 45 },
    })
    expect(on).toContain('__etusAdRefresh')
    expect(on).toContain('45')
  })
  it('emits slot targeting via modern setConfig({targeting}), not deprecated setTargeting', () => {
    const s = bootSlotScript('123', {
      adUnit: 'post/top',
      sizes: { 0: [[300, 250]] },
      reserve: { 0: 280 },
      id: 'ad-x',
      targeting: { section: 'finance', pos: 'atf' },
    })
    expect(s).toContain('setConfig({targeting:')
    expect(s).not.toContain('setTargeting')
  })
})

describe('OOP + runtime + ppid', () => {
  it('interstitial uses the INTERSTITIAL format + triggers', () => {
    const s = bootInterstitialScript('123', 'interstitial', {
      unhideWindow: true,
      endOfArticle: true,
      navBar: false,
      inactivity: false,
      backward: false,
    })
    expect(s).toContain('OutOfPageFormat.INTERSTITIAL')
    expect(s).toContain('interstitial')
  })
  it('runtime wires observability + the 30s refresh floor + modern refresh tag', () => {
    const s = bootRuntimeScript()
    expect(s).toContain('impressionViewable')
    expect(s).toContain('etus:ad')
    expect(s).toContain('30')
    expect(s).toContain("setConfig({targeting:{refresh:'1'}})")
    expect(s).not.toContain('setTargeting')
  })
  it('ppid mint stores under the key', () => {
    expect(bootPpidScript()).toContain('etus_ppid')
  })
})

describe('inline-script escaping (no </script> breakout)', () => {
  it('escapes a hostile adUnit / id / targeting so it cannot close the script', () => {
    const s = bootSlotScript('123', {
      adUnit: 'evil</script><img src=x onerror=alert(1)>',
      sizes: { 0: [[300, 250]] },
      reserve: { 0: 280 },
      id: 'slot</script>',
      targeting: { k: '</script><script>alert(1)</script>' },
    })
    expect(s).not.toContain('</script>')
    expect(s).toContain('\\u003c') // the escaped form is what lands
  })

  it('escapes hostile pps keys/values in the page bootstrap', () => {
    const s = bootGptScript({
      networkCode: '123',
      pps: { taxonomies: { 'evil</script>': { values: ['</script>'] } } },
    })
    expect(s).not.toContain('</script>')
  })

  it('preserves ordinary spaces in values (does not over-escape)', () => {
    const s = bootSlotScript('123', {
      adUnit: 'home/top',
      sizes: { 0: [[300, 250]] },
      reserve: { 0: 280 },
      id: 'ad-1',
      targeting: { section: 'home page' },
    })
    expect(s).toContain('home page')
  })

  it('drops an out-of-enum tagForAgeTreatment instead of interpolating it raw', () => {
    const s = bootGptScript({
      networkCode: '123',
      // @ts-expect-error — exercising a CMS value that violates the union type
      tagForAgeTreatment: 'TEEN});alert(1);//',
    })
    expect(s).not.toContain('alert(1)')
    expect(s).not.toContain('TagForAgeTreatment.TEEN})')
  })
})

describe('no deprecated GPT API in any emitter', () => {
  it('no emitter uses a deprecated call or a global no-arg refresh', () => {
    const all = [
      bootGptScript(cfg),
      bootSlotScript('123', {
        adUnit: 'x',
        sizes: { 0: [[300, 250]] },
        reserve: { 0: 280 },
        id: 'y',
        refresh: { intervalSec: 45 },
      }),
      bootAnchorScript('123', 'anchor', 'top'),
      bootSideRailScript('123', 'rail', 'left'),
      bootInterstitialScript('123', 'interstitial', {}),
      bootRuntimeScript(),
      bootDisplayScript(),
    ].join('\n')
    for (const bad of [
      'enableSingleRequest',
      'enableLazyLoad',
      'enableAsyncRendering',
      'disableInitialLoad',
      'collapseEmptyDivs',
      'setTargeting',
    ]) {
      expect(all).not.toContain(bad)
    }
    // a per-slot refresh([slot], …) is correct; a global no-arg refresh() would defeat lazyLoad
    expect(all).not.toMatch(/refresh\(\s*\)/)
  })
})
