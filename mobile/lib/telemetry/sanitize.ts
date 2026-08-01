const SAFE_MACHINE_VALUE = /^[a-z0-9][a-z0-9._:+-]{0,159}$/i;
const SAFE_RELEASE_VALUE = /^[a-z0-9][a-z0-9._:+@-]{0,159}$/i;
const SAFE_EXCEPTION_TYPE = /^[A-Za-z][A-Za-z0-9_.]{0,79}$/;
const SAFE_SYMBOL = /^[A-Za-z0-9_$<>.()[\] /:+-]{1,200}$/;
const SAFE_DEBUG_IDENTIFIER = /^[a-f0-9]{8,128}(?:-[a-f0-9]{1,64})*$/i;
const SAFE_IMAGE_ADDRESS = /^0x[a-f0-9]{1,32}$/i;

const SAFE_DEBUG_IMAGE_TYPES = new Set([
  'elf',
  'jvm',
  'macho',
  'pe',
  'pe_dotnet',
  'proguard',
  'sourcemap',
  'symbolic',
  'wasm',
]);

const SAFE_ARCHITECTURES = new Set([
  'arm',
  'arm64',
  'arm64e',
  'armv7',
  'armv7s',
  'x86',
  'x86_64',
]);

const FIXED_ERROR_CODES = new Set([
  'trailhead_error',
  'qa_js_nonfatal',
  'qa_native_crash',
  'qa_performance',
  'map_camp_selection_received',
  'map_camp_camera_handoff',
  'map_camp_sheet_identity',
  'map_camp_peek_render',
  'map_camp_detail_commit',
  'map_camp_full_render',
  'map_camp_unknown_phase',
]);

const STATIC_TRANSACTION_NAMES = new Set([
  'App Start',
  'Cold Start',
  'Warm Start',
  'Route Change',
  'trailhead.app',
  'trailhead.qa.performance',
]);

const SAFE_SPAN_OPERATIONS = new Set([
  'app.start',
  'navigation',
  'qa.telemetry',
  'ui.load',
]);

const SAFE_TAG_KEYS = new Map([
  ['app_build', 'app_build'],
  ['app_version', 'app_version'],
  ['error_code', 'error_code'],
  ['expo_is_embedded_update', 'expo_is_embedded_update'],
  ['expo_update_id', 'expo_update_id'],
  ['platform', 'platform'],
  ['qa_check', 'qa_check'],
  ['release_channel', 'release_channel'],
  ['runtime_version', 'runtime_version'],
]);

const SAFE_LEVELS = new Set(['debug', 'info', 'warning', 'error', 'fatal']);
const SAFE_PLATFORMS = new Set(['android', 'cocoa', 'javascript', 'node', 'other']);
const SAFE_ENVIRONMENTS = new Set(['development', 'preview', 'production']);
const SAFE_THREAD_NAMES = new Set(['main', 'javascript']);

type UnknownRecord = Record<string, any>;

function normalizedKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function safeMachineValue(value: unknown, fallback?: string): string | undefined {
  const candidate = String(value ?? '').trim();
  return SAFE_MACHINE_VALUE.test(candidate) ? candidate : fallback;
}

function safeReleaseValue(value: unknown): string | undefined {
  const candidate = String(value ?? '').trim();
  return SAFE_RELEASE_VALUE.test(candidate) ? candidate : undefined;
}

function safeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function safeBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function safeDebugIdentifier(value: unknown): string | undefined {
  const candidate = String(value ?? '').trim();
  return SAFE_DEBUG_IDENTIFIER.test(candidate) ? candidate : undefined;
}

function safeImageAddress(value: unknown): string | undefined {
  const candidate = String(value ?? '').trim();
  return SAFE_IMAGE_ADDRESS.test(candidate) ? candidate : undefined;
}

function safeImageSize(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function safeStackPath(value: unknown): string | undefined {
  const candidate = String(value ?? '').trim();
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    if (url.protocol === 'app:') {
      const segments = url.pathname.split('/').filter(Boolean);
      const basename = segments.at(-1);
      if (!basename || !SAFE_MACHINE_VALUE.test(basename)) return undefined;
      // Keep the canonical single-file app URI used by React Native bundles.
      // Nested paths and hosts can contain account names or install-specific
      // values, so they are reduced to the same basename used for debug images.
      return !url.host && segments.length === 1
        ? `app:///${basename}`
        : basename;
    }
    // Network and file paths can carry account names, tokens, query strings,
    // or attachment references. A basename keeps frames symbolication-friendly
    // without retaining those values.
    const basename = url.pathname.split('/').filter(Boolean).pop();
    return basename && SAFE_MACHINE_VALUE.test(basename) ? basename : undefined;
  } catch {
    const basename = candidate.replace(/\\/g, '/').split('/').filter(Boolean).pop();
    return basename && SAFE_MACHINE_VALUE.test(basename) ? basename : undefined;
  }
}

function safeSymbol(value: unknown): string | undefined {
  const candidate = String(value ?? '').trim();
  return SAFE_SYMBOL.test(candidate) ? candidate : undefined;
}

function sanitizeStackFrame(frame: UnknownRecord): UnknownRecord {
  return removeUndefined({
    abs_path: safeStackPath(frame.abs_path),
    colno: safeNumber(frame.colno),
    filename: safeStackPath(frame.filename),
    function: safeSymbol(frame.function),
    image_addr: safeMachineValue(frame.image_addr),
    in_app: safeBoolean(frame.in_app),
    instruction_addr: safeMachineValue(frame.instruction_addr),
    lineno: safeNumber(frame.lineno),
    module: safeSymbol(frame.module),
    package: safeStackPath(frame.package),
    platform: safeMachineValue(frame.platform),
    symbol_addr: safeMachineValue(frame.symbol_addr),
  });
}

function sanitizeStacktrace(stacktrace: unknown): UnknownRecord | undefined {
  if (!stacktrace || typeof stacktrace !== 'object') return undefined;
  const frames = Array.isArray((stacktrace as UnknownRecord).frames)
    ? (stacktrace as UnknownRecord).frames
        .slice(0, 200)
        .filter((frame: unknown): frame is UnknownRecord => Boolean(frame) && typeof frame === 'object')
        .map(sanitizeStackFrame)
    : undefined;
  return frames?.length ? { frames } : undefined;
}

function sanitizeDebugImage(image: UnknownRecord): UnknownRecord | undefined {
  const type = String(image.type ?? '').trim();
  if (!SAFE_DEBUG_IMAGE_TYPES.has(type)) return undefined;

  const debugId = safeDebugIdentifier(image.debug_id);
  const uuid = safeDebugIdentifier(image.uuid);
  const codeId = safeDebugIdentifier(image.code_id);
  const codeFile = safeStackPath(image.code_file);

  // Sentry associates uploaded source maps through the debug ID and matches
  // the image to frames through code_file. Native images use debug_id or the
  // legacy uuid identity. Images without either identity cannot symbolicate.
  if (type === 'sourcemap') {
    if (!debugId || !codeFile) return undefined;
  } else if (!debugId && !uuid) {
    return undefined;
  }

  return removeUndefined({
    arch: SAFE_ARCHITECTURES.has(String(image.arch ?? '')) ? image.arch : undefined,
    code_file: codeFile,
    code_id: codeId,
    debug_file: safeStackPath(image.debug_file),
    debug_id: debugId,
    image_addr: safeImageAddress(image.image_addr),
    image_size: safeImageSize(image.image_size),
    image_vmaddr: safeImageAddress(image.image_vmaddr),
    name: safeStackPath(image.name),
    type,
    uuid,
  });
}

function sanitizeDebugMeta(debugMeta: unknown): UnknownRecord | undefined {
  if (!debugMeta || typeof debugMeta !== 'object') return undefined;
  const sourceImages = (debugMeta as UnknownRecord).images;
  if (!Array.isArray(sourceImages)) return undefined;

  const images = sourceImages
    .slice(0, 512)
    .filter((image: unknown): image is UnknownRecord => Boolean(image) && typeof image === 'object')
    .map(sanitizeDebugImage)
    .filter((image): image is UnknownRecord => Boolean(image));

  return images.length ? { images } : undefined;
}

function sanitizeTraceContext(trace: unknown): UnknownRecord | undefined {
  if (!trace || typeof trace !== 'object') return undefined;
  const value = trace as UnknownRecord;
  return removeUndefined({
    op: SAFE_SPAN_OPERATIONS.has(String(value.op || '')) ? value.op : undefined,
    parent_span_id: safeMachineValue(value.parent_span_id),
    span_id: safeMachineValue(value.span_id),
    status: safeMachineValue(value.status),
    trace_id: safeMachineValue(value.trace_id),
  });
}

function removeUndefined(value: UnknownRecord): UnknownRecord {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined));
}

export function allowlistedTelemetryTags(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const output: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(value as UnknownRecord)) {
    const key = SAFE_TAG_KEYS.get(normalizedKey(rawKey));
    if (!key) continue;
    const candidate = safeMachineValue(rawValue);
    if (!candidate) continue;
    if (key === 'error_code' && !FIXED_ERROR_CODES.has(candidate)) continue;
    output[key] = candidate;
  }
  return Object.keys(output).length ? output : undefined;
}

export function allowlistedTransactionName(value: unknown): string {
  const candidate = String(value ?? '').trim();
  return STATIC_TRANSACTION_NAMES.has(candidate) ? candidate : 'trailhead.app';
}

export function sanitizeTelemetryBreadcrumb(): null {
  // Breadcrumb messages, navigation targets, request URLs, and input events can
  // all carry private content. Trailhead does not need them for crash triage.
  return null;
}

/**
 * Construct a new event from a narrow allowlist. Do not spread the source
 * object: SDK additions must remain private until explicitly reviewed here.
 */
export function sanitizeTelemetryEvent<T extends UnknownRecord>(event: T): T {
  const tags = allowlistedTelemetryTags(event.tags);
  const debugMeta = sanitizeDebugMeta(event.debug_meta);
  const errorCode = tags?.error_code || 'trailhead_error';
  const exceptions = Array.isArray(event.exception?.values)
    ? event.exception.values.slice(0, 20).map((value: UnknownRecord) => removeUndefined({
        mechanism: value.mechanism && typeof value.mechanism === 'object'
          ? removeUndefined({
              handled: safeBoolean(value.mechanism.handled),
              type: safeMachineValue(value.mechanism.type),
            })
          : undefined,
        stacktrace: sanitizeStacktrace(value.stacktrace),
        type: SAFE_EXCEPTION_TYPE.test(String(value.type || '')) ? value.type : 'Error',
        value: errorCode,
      }))
    : undefined;
  const threads = Array.isArray(event.threads?.values)
    ? event.threads.values.slice(0, 20).map((thread: UnknownRecord) => removeUndefined({
        crashed: safeBoolean(thread.crashed),
        current: safeBoolean(thread.current),
        id: typeof thread.id === 'number' ? thread.id : undefined,
        name: SAFE_THREAD_NAMES.has(String(thread.name || '')) ? thread.name : undefined,
        stacktrace: sanitizeStacktrace(thread.stacktrace),
      }))
    : undefined;
  const spans = Array.isArray(event.spans)
    ? event.spans.slice(0, 200).map((span: UnknownRecord) => removeUndefined({
        op: SAFE_SPAN_OPERATIONS.has(String(span.op || '')) ? span.op : undefined,
        parent_span_id: safeMachineValue(span.parent_span_id),
        span_id: safeMachineValue(span.span_id),
        start_timestamp: safeNumber(span.start_timestamp),
        status: safeMachineValue(span.status),
        timestamp: safeNumber(span.timestamp),
        trace_id: safeMachineValue(span.trace_id),
      }))
    : undefined;
  const appContext = event.contexts?.app && typeof event.contexts.app === 'object'
    ? removeUndefined({
        app_build: safeMachineValue(event.contexts.app.app_build),
        app_version: safeMachineValue(event.contexts.app.app_version),
      })
    : undefined;
  const traceContext = sanitizeTraceContext(event.contexts?.trace);

  return removeUndefined({
    contexts: appContext || traceContext
      ? removeUndefined({ app: appContext, trace: traceContext })
      : undefined,
    debug_meta: debugMeta,
    dist: safeMachineValue(event.dist),
    environment: SAFE_ENVIRONMENTS.has(String(event.environment || ''))
      ? event.environment
      : undefined,
    event_id: safeMachineValue(event.event_id),
    exception: exceptions?.length ? { values: exceptions } : undefined,
    level: SAFE_LEVELS.has(String(event.level || '')) ? event.level : undefined,
    platform: SAFE_PLATFORMS.has(String(event.platform || '')) ? event.platform : undefined,
    release: safeReleaseValue(event.release),
    spans: spans?.length ? spans : undefined,
    start_timestamp: safeNumber(event.start_timestamp),
    tags,
    threads: threads?.length ? { values: threads } : undefined,
    timestamp: safeNumber(event.timestamp),
    transaction: event.type === 'transaction'
      ? allowlistedTransactionName(event.transaction)
      : undefined,
    type: event.type === 'transaction' ? 'transaction' : undefined,
  }) as T;
}

// Kept as a deliberately lossy helper for any legacy call sites. Free-form
// strings are never safe telemetry and are replaced rather than scrubbed.
export function scrubTelemetryString(_value: string): string {
  return '[Filtered]';
}

export function scrubTelemetryValue(_value: unknown, _key = '', _depth = 0): undefined {
  return undefined;
}
