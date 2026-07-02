import { exists, loadRegistry, parseCli, printSummary, rel, runCommand } from './lib.ts';

async function main() {
  const opts = parseCli();
  const registry = await loadRegistry();
  const sources = registry.sources?.filter((source: any) => opts.source === 'all' || source.id.includes(opts.source)) || [];
  printSummary('import sources', sources.map((source: any) => ({ id: source.id, type: source.source_type })));
  const args = ['scripts/data/import_raw_records.py', '--source', opts.source];
  if (opts.limit) args.push('--limit', String(opts.limit));
  if (opts.force) args.push('--force');
  if (opts.dryRun) args.push('--dry-run');
  await runCommand('python3', args, { dryRun: false });
  await importGeospatialRecords(opts);
}

async function importGeospatialRecords(opts: ReturnType<typeof parseCli>) {
  if (!['all', 'usfs', 'usfs-edw', 'padus'].includes(opts.source)) return;
  const python = process.env.TRAILHEAD_DATA_PYTHON || '/home/sean/.venv-trailhead-data/bin/python';
  const hasPython = await exists(python);
  const hasUsfs = await exists(rel('data', 'raw', 'usfs', 'recreation-sites', 'source.gdb.zip'));
  const hasPadus = await exists(rel('data', 'raw', 'padus', 'PADUS4_1Geodatabase.zip'));
  if (!hasPython || (!hasUsfs && !hasPadus)) {
    console.log('geospatial raw import skipped: local data Python or source archives not available');
    return;
  }
  const args = ['scripts/data/import_geospatial_records.py', '--source', opts.source];
  if (opts.limit) args.push('--limit', String(opts.limit));
  if (opts.dryRun) args.push('--dry-run');
  await runCommand(python, args, { dryRun: false });
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
