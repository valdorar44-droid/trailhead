import { readFileSync, writeFileSync } from 'node:fs';

import {
  buildOriginalContinuousRouteFixture,
  verifyOriginalContinuousRouteFixture,
} from './original-route-fixture';

type CliOptions = {
  manifest: string;
  fixture: string;
  output: string;
  packId: string;
  version: number | null;
  verify: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  const result: CliOptions = {
    manifest: '',
    fixture: '',
    output: '-',
    packId: '',
    version: null,
    verify: false,
  };
  const args = [...argv];
  while (args.length) {
    const flag = args.shift();
    const take = () => {
      const value = args.shift();
      if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
      return value;
    };
    if (flag === '--manifest') result.manifest = take();
    else if (flag === '--fixture') result.fixture = take();
    else if (flag === '--output') result.output = take();
    else if (flag === '--pack-id') result.packId = take();
    else if (flag === '--version') result.version = Number(take());
    else if (flag === '--verify') result.verify = true;
    else throw new Error(`Unknown option: ${flag}`);
  }
  if (!result.manifest) throw new Error('--manifest is required. Use an immutable published manifest export.');
  if (result.verify) {
    if (!result.fixture) throw new Error('--fixture is required with --verify.');
  } else {
    if (!result.packId) throw new Error('--pack-id is required to pin the fixture.');
    if (!Number.isInteger(result.version) || (result.version ?? 0) < 1) throw new Error('--version must be a positive integer.');
  }
  return result;
}

function readJson(path: string) {
  return JSON.parse(path === '-' ? readFileSync(0, 'utf8') : readFileSync(path, 'utf8'));
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifest = readJson(options.manifest);
  if (options.verify) {
    const summary = verifyOriginalContinuousRouteFixture(readJson(options.fixture), manifest);
    process.stdout.write(`${JSON.stringify({ valid: true, ...summary })}\n`);
    return;
  }
  const fixture = buildOriginalContinuousRouteFixture(manifest, {
    pack_id: options.packId,
    version: options.version!,
  });
  const serialized = `${JSON.stringify(fixture, null, 2)}\n`;
  if (options.output === '-') process.stdout.write(serialized);
  else writeFileSync(options.output, serialized, { flag: 'wx' });
}

try {
  main();
} catch (error) {
  process.stderr.write(`Original route fixture failed: ${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
}
