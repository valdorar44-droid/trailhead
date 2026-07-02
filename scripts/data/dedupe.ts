import { parseCli, runCommand } from './lib.ts';

async function main() {
  const opts = parseCli();
  await runCommand('python3', ['scripts/qa_explore_catalog_matrix.py'], { dryRun: opts.dryRun });
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
