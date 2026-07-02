import { parseCli } from './lib.ts';

async function main() {
  const opts = parseCli();
  console.log(opts.dryRun ? 'DRY dynamic refresh queued for NPS alerts, NWS alerts, and fire sources.' : 'Dynamic refresh is staged; use NPS/RIDB download plus existing weather/fire runtime caches for now.');
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
