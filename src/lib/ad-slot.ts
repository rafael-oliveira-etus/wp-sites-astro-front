import type { DeviceClass } from '@etus/ads';

/**
 * Map the internal device class to the external ad worker's `data-device`
 * contract. The worker only distinguishes mobile vs not — tablet renders the
 * desktop treatment, matching the old top-ad placement rule (`device !== 'mobile'`).
 */
export function adDeviceAttr(device: DeviceClass): 'mob' | 'desk' {
  return device === 'mobile' ? 'mob' : 'desk';
}
