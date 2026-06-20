import { describe, expect, it } from 'vitest'
import {
  cfDeviceTypeToClass,
  resolveDeviceClass,
  slotAllowed,
  uaToDeviceClass,
  viewportDeviceClass,
} from '../src/device.ts'

describe('cfDeviceTypeToClass', () => {
  it('passes valid CF-Device-Type values through', () => {
    expect(cfDeviceTypeToClass('mobile')).toBe('mobile')
    expect(cfDeviceTypeToClass('tablet')).toBe('tablet')
    expect(cfDeviceTypeToClass('desktop')).toBe('desktop')
  })
  it('returns null for absent/invalid', () => {
    expect(cfDeviceTypeToClass(null)).toBeNull()
    expect(cfDeviceTypeToClass(undefined)).toBeNull()
    expect(cfDeviceTypeToClass('phone')).toBeNull()
  })
})

describe('uaToDeviceClass', () => {
  it('detects phones', () => {
    expect(uaToDeviceClass('Mozilla/5.0 (iPhone; CPU iPhone OS 18_5) Mobile/15E148')).toBe('mobile')
    expect(uaToDeviceClass('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari')).toBe('mobile')
  })
  it('detects tablets (classic iPad + Android-without-mobile)', () => {
    expect(uaToDeviceClass('Mozilla/5.0 (iPad; CPU OS 17_0) Safari')).toBe('tablet')
    expect(uaToDeviceClass('Mozilla/5.0 (Linux; Android 13; SM-X200) Safari')).toBe('tablet')
  })
  it('classifies legacy tablets via bowser (Kindle Fire/Silk + PlayBook = tablet)', () => {
    expect(uaToDeviceClass('Mozilla/5.0 (Linux; U; Android 4.4.3; KFTHWI) AppleWebKit Silk/3.13 Safari')).toBe('tablet')
    expect(uaToDeviceClass('Mozilla/5.0 (PlayBook; U; RIM Tablet OS 2.1.0) Safari')).toBe('tablet')
    // bowser maps the 2010 Kindle e-ink reader (UA says "Mobile", no tablet
    // platform) to mobile. This is the FALLBACK only — the CF header is
    // authoritative in production. bowser is the source of truth here.
    expect(uaToDeviceClass('Mozilla/5.0 (X11; U; Linux; en-us) Kindle/3.0 Mobile')).toBe('mobile')
  })
  it('classifies Windows Phone and android-with-mobile as phones (mobile)', () => {
    expect(uaToDeviceClass('Mozilla/5.0 (Windows Phone 10.0; Android 6.0.1; Lumia 950) Mobile Safari')).toBe('mobile')
    expect(uaToDeviceClass('Mozilla/5.0 (Linux; Android 14; Pixel 8 Mobile) Safari')).toBe('mobile')
  })
  it('defaults to desktop', () => {
    expect(uaToDeviceClass('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari')).toBe('desktop')
    expect(uaToDeviceClass('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('desktop')
  })
})

describe('resolveDeviceClass', () => {
  it('prefers the CF header over UA', () => {
    expect(resolveDeviceClass({ cfHeader: 'tablet', ua: 'iPhone Mobile' })).toBe('tablet')
  })
  it('falls back to UA when no header', () => {
    expect(resolveDeviceClass({ cfHeader: null, ua: 'iPhone Mobile' })).toBe('mobile')
  })
  it('defaults to desktop with no signals', () => {
    expect(resolveDeviceClass({})).toBe('desktop')
  })
})

describe('slotAllowed', () => {
  it('undefined/empty devices = all', () => {
    expect(slotAllowed(undefined, 'mobile')).toBe(true)
    expect(slotAllowed([], 'desktop')).toBe(true)
  })
  it('gates on membership', () => {
    expect(slotAllowed(['desktop'], 'mobile')).toBe(false)
    expect(slotAllowed(['mobile', 'tablet'], 'tablet')).toBe(true)
  })
})

describe('viewportDeviceClass', () => {
  it('maps widths to classes', () => {
    expect(viewportDeviceClass(360)).toBe('mobile')
    expect(viewportDeviceClass(767)).toBe('mobile')
    expect(viewportDeviceClass(768)).toBe('tablet')
    expect(viewportDeviceClass(979)).toBe('tablet')
    expect(viewportDeviceClass(980)).toBe('desktop')
    expect(viewportDeviceClass(1920)).toBe('desktop')
  })
})
