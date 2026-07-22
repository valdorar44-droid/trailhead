export type TelemetryQaCheck = 'javascript_exception' | 'performance_span' | 'native_crash';

export const NATIVE_CRASH_ACKNOWLEDGEMENT = 'CRASH PREVIEW EMULATOR';

export type TelemetryQaFacts = {
  channel: string | null | undefined;
  enabled: boolean;
  isAdmin: boolean;
  isAndroidEmulator: boolean;
  nativePrivacySanitizerVerified: boolean;
  nativeCrashAcknowledgement?: string;
};

export type TelemetryQaDecision =
  | { allowed: true }
  | { allowed: false; reason: 'disabled' | 'not_preview' | 'not_admin' | 'not_emulator' | 'not_acknowledged' | 'native_privacy_unverified' };

export function telemetryQaDecision(
  check: TelemetryQaCheck,
  facts: TelemetryQaFacts,
): TelemetryQaDecision {
  if (!facts.enabled) return { allowed: false, reason: 'disabled' };
  if (facts.channel !== 'preview') return { allowed: false, reason: 'not_preview' };
  if (!facts.isAdmin) return { allowed: false, reason: 'not_admin' };
  if (check === 'native_crash') {
    if (!facts.isAndroidEmulator) return { allowed: false, reason: 'not_emulator' };
    if (facts.nativeCrashAcknowledgement !== NATIVE_CRASH_ACKNOWLEDGEMENT) {
      return { allowed: false, reason: 'not_acknowledged' };
    }
    if (!facts.nativePrivacySanitizerVerified) {
      return { allowed: false, reason: 'native_privacy_unverified' };
    }
  }
  return { allowed: true };
}

export type TelemetryDeliveryFailure = 'sentry_disabled' | 'flush_failed' | 'span_not_sampled';

export class TelemetryDeliveryError extends Error {
  readonly reason: TelemetryDeliveryFailure;

  constructor(reason: TelemetryDeliveryFailure) {
    super(`Telemetry delivery blocked: ${reason}`);
    this.name = 'TelemetryDeliveryError';
    this.reason = reason;
  }
}

/** Require an enabled transport and a drained queue before claiming delivery. */
export async function requireTelemetryDelivery<T>(input: {
  enabled: boolean;
  capture: () => T;
  flush: () => Promise<boolean>;
}): Promise<T> {
  if (!input.enabled) throw new TelemetryDeliveryError('sentry_disabled');
  const result = input.capture();
  if (!await input.flush()) throw new TelemetryDeliveryError('flush_failed');
  return result;
}
