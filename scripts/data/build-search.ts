import { readJson, writeJsonAtomic, exists, parseCli, rel } from './lib.ts';

async function main() {
  const opts = parseCli();
  const source = await catalogPath();
  if (opts.dryRun) {
    console.log(`DRY build search from ${source}`);
    return;
  }
  const catalog = await readJson<any>(source);
  const places = Array.isArray(catalog?.places) ? catalog.places : [];
  const index = places.map((place: any) => {
    const summary = place.summary || {};
    const pack = place.source_pack || {};
    return {
      id: place.id,
      title: summary.title || place.name,
      category: summary.category || place.category,
      region: summary.region || place.region || place.country,
      lat: summary.lat ?? place.lat,
      lng: summary.lng ?? place.lng,
      terms: [
        summary.title || place.name,
        summary.category || place.category,
        summary.region || place.region,
        ...(place.subcategories || []),
        ...(place.tags || []),
        ...(pack.activities || []),
        ...(pack.topics || []),
      ].filter(Boolean).join(' ').toLowerCase(),
    };
  }).filter((entry: any) => entry.id && entry.title);
  await writeJsonAtomic(rel('data', 'processed', 'explore_search_index.json'), {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    source: source.replace(rel(), '').replace(/^\//, ''),
    count: index.length,
    index,
  });
  console.log(`wrote ${index.length} search rows to data/processed/explore_search_index.json`);
}

async function catalogPath() {
  const candidate = rel('data', 'processed', 'explore_catalog_v3.candidate.json');
  if (await exists(candidate)) return candidate;
  return rel('dashboard', 'explore_catalog_v3.json');
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
