import { describe, expect, it } from 'vitest';
import { adDeviceAttr } from './ad-slot';

describe('adDeviceAttr', () => {
  it('maps mobile to "mob"', () => {
    expect(adDeviceAttr('mobile')).toBe('mob');
  });

  it('maps tablet and desktop to "desk" (tablet behaves as desktop)', () => {
    expect(adDeviceAttr('tablet')).toBe('desk');
    expect(adDeviceAttr('desktop')).toBe('desk');
  });
});
