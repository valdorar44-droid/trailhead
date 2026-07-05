import path from 'node:path';
import { exists, listFilesRecursive, parseCli, rel, runCommand } from './lib.ts';

async function main() {
  const opts = parseCli();
  await normalizeOfficialCache(opts);
  const args = ['scripts/build_explore_catalog_v3.py'];
  const npsFixtures = await fixturePaths([
    rel('data', 'raw', 'nps', 'api', 'source-pack.json'),
    ...(await listFilesRecursive(rel('data', 'explore', 'source_cache', 'nps'), file => /source-pack.*\.json$/i.test(file))),
  ]);
  const ridbFixtures = await fixturePaths([
    rel('data', 'raw', 'ridb', 'api', 'facilities-source.json'),
    ...(await listFilesRecursive(rel('data', 'explore', 'source_cache', 'ridb'), file => /\.json$/i.test(file))),
  ]);
  const wikidataFixtures = await fixturePaths(
    await listFilesRecursive(rel('data', 'explore', 'source_cache', 'wikidata'), file => /\.json$/i.test(file)),
  );
  for (const file of npsFixtures) args.push('--nps-fixture', path.relative(rel(), file));
  for (const file of ridbFixtures) args.push('--ridb-fixture', path.relative(rel(), file));
  for (const file of wikidataFixtures) args.push('--wikidata-fixture', path.relative(rel(), file));
  args.push('--pakistan-gov-seed');
  args.push('--imports-out', opts.promote ? 'data/explore/imports' : 'data/processed/explore/imports');
  args.push('--out', opts.promote ? 'dashboard/explore_catalog_v3.json' : 'data/processed/explore_catalog_v3.candidate.json');
  args.push('--trails-out', opts.promote ? 'dashboard/explore_trail_geometries_v1.json' : 'data/processed/explore_trail_geometries_v1.candidate.json');
  args.push('--source-records-out', opts.promote ? 'dashboard/explore_source_records_sample.jsonl' : 'data/processed/explore_source_records_sample.candidate.jsonl');
  if (!npsFixtures.length && !ridbFixtures.length && !wikidataFixtures.length) {
    console.log('No cached official source packs found yet. Run data:download first.');
    return;
  }
  await runCommand('python3', args, { dryRun: opts.dryRun });
}

async function normalizeOfficialCache(opts: ReturnType<typeof parseCli>) {
  const args = ['scripts/data/normalize_official_cache.py', '--source', opts.source];
  if (opts.limit) args.push('--limit', String(opts.limit));
  if (opts.searchOnly) args.push('--search-only');
  if (opts.dryRun) args.push('--dry-run');
  await runCommand('python3', args, { dryRun: opts.dryRun });
}

async function fixturePaths(files: string[]): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    if (!file || seen.has(file)) continue;
    seen.add(file);
    if (await exists(file)) out.push(file);
  }
  return out;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
