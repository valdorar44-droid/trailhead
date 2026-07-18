import { readFileSync } from 'node:fs';
import { validateOriginalManifest } from '../lib/originals/manifest';
import {
  ORIGINAL_ROUTE_VALIDATION_SCENARIO_IDS,
  runOriginalRouteValidation,
  type OriginalRouteValidationScenarioId,
} from '../lib/originals/routeValidation';

type ValidatorInput = {
  schema_version: 1;
  manifest: unknown;
  options?: {
    scenario_ids?: OriginalRouteValidationScenarioId[];
    validator_source_sha256?: string;
  };
};

function main() {
  const input = JSON.parse(readFileSync(0, 'utf8')) as ValidatorInput;
  if (input?.schema_version !== 1) throw new Error('Unsupported validator input schema_version.');
  const validatorSourceSha256 = input.options?.validator_source_sha256;
  if (!validatorSourceSha256 || !/^[a-f0-9]{64}$/.test(validatorSourceSha256)) {
    throw new Error('A trusted validator_source_sha256 is required.');
  }
  const manifest = validateOriginalManifest(input.manifest);
  const scenarioIds = input.options?.scenario_ids ?? [...ORIGINAL_ROUTE_VALIDATION_SCENARIO_IDS];
  const report = runOriginalRouteValidation(manifest, { scenario_ids: scenarioIds });
  process.stdout.write(`${JSON.stringify({ ...report, validator_source_sha256: validatorSourceSha256 })}\n`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : 'Originals route validation failed.';
  process.stderr.write(`${JSON.stringify({ error: message })}\n`);
  process.exitCode = 1;
}
