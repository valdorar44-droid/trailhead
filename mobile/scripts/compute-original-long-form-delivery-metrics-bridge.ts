import { readFileSync } from 'node:fs';

type BridgeInputV1 = {
  schema_version: 1;
  compiled: unknown;
};

async function importMetricsFunction() {
  // The existing validator is also a stdin CLI and currently invokes its CLI
  // entry point when imported. The bridge has already consumed stdin, so that
  // invocation fails closed on EOF. Suppress only that expected JSON error,
  // restore process state, and use the module's exported computation directly.
  const originalWrite = process.stderr.write;
  const originalExitCode = process.exitCode;
  let importStderr = '';
  process.stderr.write = ((chunk: unknown) => {
    importStderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  process.exitCode = 0;
  let imported: typeof import('./validate-original-long-form');
  try {
    imported = await import('./validate-original-long-form');
  } finally {
    process.stderr.write = originalWrite;
    process.exitCode = originalExitCode;
  }
  const lines = importStderr.trim().split('\n').filter(Boolean);
  if (lines.length !== 1) {
    throw new Error('Unexpected long-form validator import behavior.');
  }
  let importError: unknown;
  try {
    importError = JSON.parse(lines[0]);
  } catch {
    throw new Error('Unexpected long-form validator import output.');
  }
  const message = String(
    importError && typeof importError === 'object'
      ? (importError as { error?: unknown }).error ?? ''
      : '',
  );
  if (!/unexpected end/i.test(message)) {
    throw new Error('Long-form validator did not fail closed on consumed stdin.');
  }
  return imported.computeOriginalLongFormDeliveryMetrics;
}

async function main() {
  const input = JSON.parse(readFileSync(0, 'utf8')) as BridgeInputV1;
  if (input?.schema_version !== 1 || !input.compiled) {
    throw new Error('Unsupported delivery-metrics bridge input.');
  }
  const computeMetrics = await importMetricsFunction();
  const result = computeMetrics(input.compiled as never);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch(error => {
  const message = error instanceof Error
    ? error.message
    : 'Delivery-metrics bridge failed.';
  process.stderr.write(`${JSON.stringify({ error: message })}\n`);
  process.exitCode = 1;
});
