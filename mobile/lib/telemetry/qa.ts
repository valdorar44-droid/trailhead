import * as Sentry from '@sentry/react-native';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';
import { useStore } from '../store';
import {
  requireTelemetryDelivery,
  TelemetryDeliveryError,
  telemetryQaDecision,
  type TelemetryQaCheck,
} from './qaPolicy';
import { QA_PERFORMANCE_TRANSACTION, spanWasSampled } from './sampling';

type TelemetryQaAuthorization = {
  nativeCrashAcknowledgement?: string;
};

const QA_ERROR_CODE: Record<TelemetryQaCheck, string> = {
  javascript_exception: 'qa_js_nonfatal',
  native_crash: 'qa_native_crash',
  performance_span: 'qa_performance',
};

function explicitQaFlagEnabled(): boolean {
  return /^(1|true|yes|on)$/i.test(String(process.env.EXPO_PUBLIC_TELEMETRY_QA_ENABLED || ''));
}

function isAndroidEmulator(): boolean {
  if (Platform.OS !== 'android') return false;
  const constants = (Platform.constants || {}) as Record<string, unknown>;
  const signature = [
    constants.Brand,
    constants.Fingerprint,
    constants.Manufacturer,
    constants.Model,
  ].map(value => String(value || '').toLowerCase()).join(' ');
  return /(generic|emulator|sdk_gphone|goldfish|ranchu|android sdk built for)/.test(signature);
}

export function telemetryQaSurfaceIsAvailable(isAdmin: boolean): boolean {
  return telemetryQaDecision('javascript_exception', {
    channel: Updates.channel,
    enabled: explicitQaFlagEnabled(),
    isAdmin,
    isAndroidEmulator: false,
    nativePrivacySanitizerVerified: false,
  }).allowed;
}

export function telemetryQaNativeCrashState(): 'emulator_required' | 'native_privacy_unverified' {
  return isAndroidEmulator() ? 'native_privacy_unverified' : 'emulator_required';
}

/**
 * Internal QA hook only. It is intentionally not mounted in ordinary UI.
 * The compile-time flag, preview channel, admin role, and native-crash
 * acknowledgement are independent fail-closed gates.
 */
export async function runTelemetryQaCheck(
  check: TelemetryQaCheck,
  authorization: TelemetryQaAuthorization = {},
): Promise<{ delivered: true; eventId?: string }> {
  const auth = useStore.getState();
  const decision = telemetryQaDecision(check, {
    channel: Updates.channel,
    enabled: explicitQaFlagEnabled(),
    isAdmin: Boolean(auth.token && auth.user?.is_admin),
    isAndroidEmulator: isAndroidEmulator(),
    // Native crashes leave JavaScript before beforeSend can apply Trailhead's
    // privacy allowlist. Keep this false until equivalent native filtering is
    // implemented and verified on both platforms.
    nativePrivacySanitizerVerified: false,
    nativeCrashAcknowledgement: authorization.nativeCrashAcknowledgement,
  });
  if (!decision.allowed) {
    throw new Error(`Telemetry QA check blocked: ${decision.reason}`);
  }

  let eventId: string | undefined;
  const sentryClient = Sentry.getClient();
  await requireTelemetryDelivery({
    enabled: Boolean(
      sentryClient
      && sentryClient.getOptions().enabled !== false
      && sentryClient.getTransport(),
    ),
    capture: () => {
      Sentry.withScope(scope => {
        scope.setTags({ error_code: QA_ERROR_CODE[check], qa_check: 'true' });
        if (check === 'javascript_exception') {
          const error = new Error('trailhead.qa.nonfatal');
          error.name = 'TrailheadQaError';
          eventId = Sentry.captureException(error);
          return;
        }
        const sampled = Sentry.startSpan(
          { forceTransaction: true, name: QA_PERFORMANCE_TRANSACTION, op: 'qa.telemetry' },
          span => spanWasSampled(span),
        );
        if (!sampled) throw new TelemetryDeliveryError('span_not_sampled');
      });
    },
    flush: () => Sentry.flush(),
  });
  return { delivered: true, ...(eventId ? { eventId } : {}) };
}
