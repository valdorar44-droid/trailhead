import * as Sentry from '@sentry/react-native';
import * as Updates from 'expo-updates';
import { NativeModules, Platform, TurboModuleRegistry, type TurboModule } from 'react-native';
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

type NativeCrashModule = TurboModule & {
  crash: () => void;
};

type NativeCrashPrivacyOptions = {
  enableNative?: boolean;
  enableNativeCrashHandling?: boolean;
  maxBreadcrumbs?: number;
  sendDefaultPii?: boolean;
};

export type TelemetryQaNativeCrashState =
  | 'ready'
  | 'emulator_required'
  | 'native_module_unavailable'
  | 'privacy_boundary_unverified';

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
    constants.Device,
    constants.Fingerprint,
    constants.Hardware,
    constants.Manufacturer,
    constants.Model,
    constants.Product,
  ].map(value => String(value || '').toLowerCase()).join(' ');
  return /(generic|emulator|sdk_gphone|goldfish|ranchu|android sdk built for)/.test(signature);
}

function nativeCrashModule(): NativeCrashModule | null {
  const legacy = (NativeModules as Record<string, unknown>).RNSentry as NativeCrashModule | undefined;
  if (legacy && typeof legacy.crash === 'function') return legacy;
  const turbo = TurboModuleRegistry.get<NativeCrashModule>('RNSentry');
  return turbo && typeof turbo.crash === 'function' ? turbo : null;
}

/**
 * The intentional crash is never uploaded as a native envelope. Instead, a
 * fixed marker goes through Trailhead's JavaScript allowlist and is flushed
 * before the native bridge terminates the emulator process. This keeps the QA
 * proof useful without allowing native SDK defaults to attach device context.
 */
export function nativeCrashPrivacyBoundaryVerified(): boolean {
  const options = Sentry.getClient()?.getOptions() as NativeCrashPrivacyOptions | undefined;
  return Boolean(
    options
    && options.enableNative === false
    && options.enableNativeCrashHandling === false
    && options.sendDefaultPii === false
    && options.maxBreadcrumbs === 0,
  );
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

export function telemetryQaNativeCrashState(): TelemetryQaNativeCrashState {
  if (!isAndroidEmulator()) return 'emulator_required';
  if (!nativeCrashPrivacyBoundaryVerified()) return 'privacy_boundary_unverified';
  return nativeCrashModule() ? 'ready' : 'native_module_unavailable';
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
  const crashModule = check === 'native_crash' ? nativeCrashModule() : null;
  const decision = telemetryQaDecision(check, {
    channel: Updates.channel,
    enabled: explicitQaFlagEnabled(),
    isAdmin: Boolean(auth.token && auth.user?.is_admin),
    isAndroidEmulator: isAndroidEmulator(),
    // Native delivery remains disabled. The fixed marker is allowlisted and
    // flushed before the emulator-only bridge crash is triggered.
    nativePrivacySanitizerVerified: nativeCrashPrivacyBoundaryVerified(),
    nativeCrashAcknowledgement: authorization.nativeCrashAcknowledgement,
  });
  if (!decision.allowed) {
    throw new Error(`Telemetry QA check blocked: ${decision.reason}`);
  }
  if (check === 'native_crash' && !crashModule) {
    throw new Error('Telemetry QA check blocked: native_module_unavailable');
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
        if (check === 'javascript_exception' || check === 'native_crash') {
          const error = new Error(
            check === 'native_crash' ? 'trailhead.qa.native_crash' : 'trailhead.qa.nonfatal',
          );
          error.name = check === 'native_crash' ? 'TrailheadQaNativeCrashMarker' : 'TrailheadQaError';
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

  if (check === 'native_crash') {
    // The decision above has already verified preview channel, admin auth,
    // emulator identity, the exact acknowledgement, and the privacy boundary.
    // Do not expose this native bridge anywhere else in the application.
    crashModule?.crash();
  }
  return { delivered: true, ...(eventId ? { eventId } : {}) };
}
