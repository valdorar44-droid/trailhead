export const ORIGINALS_LONG_FORM_CONTRACT_ID = 'originals_long_form_delivery_v1' as const;

export const ORIGINALS_LONG_FORM_CAPABILITIES = [
  'originals_capacity_scheduler_v1',
  'originals_manifest_v3',
  'originals_selectable_v1',
] as const;

export const ORIGINALS_CONSUMER_CONTRACT_HEADER =
  'X-Trailhead-Originals-Consumer-Contract' as const;
export const ORIGINALS_CAPABILITIES_HEADER =
  'X-Trailhead-Originals-Capabilities' as const;

/**
 * These headers describe executable JS behavior, not account authorization.
 * They must be attached by the request layer after caller-provided headers so
 * a stale or untrusted call site cannot claim a different consumer contract.
 */
export function originalConsumerCapabilityHeaders(): Record<string, string> {
  return {
    [ORIGINALS_CONSUMER_CONTRACT_HEADER]: ORIGINALS_LONG_FORM_CONTRACT_ID,
    [ORIGINALS_CAPABILITIES_HEADER]: ORIGINALS_LONG_FORM_CAPABILITIES.join(','),
  };
}
