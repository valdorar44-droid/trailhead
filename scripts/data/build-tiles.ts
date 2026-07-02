import { exists, parseCli, readJson, rel, writeJsonAtomic } from './lib.ts';

async function main() {
  const opts = parseCli();
  const source = await catalogPath();
  if (opts.dryRun) {
    console.log(`DRY build visual GeoJSON from ${source}`);
    return;
  }
  const catalog = await readJson<any>(source);
  const places = Array.isArray(catalog?.places) ? catalog.places : [];
  const features = places.flatMap((place: any) => {
    const summary = place.summary || {};
    const lat = Number(summary.lat ?? place.lat);
    const lng = Number(summary.lng ?? place.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    return [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: {
        id: place.id,
        title: summary.title || place.name,
        category: summary.category || place.category,
        region: summary.region || place.region || '',
      },
    }];
  });
  await writeJsonAtomic(rel('data', 'processed', 'explore_places.geojson'), {
    type: 'FeatureCollection',
    generated_at: new Date().toISOString(),
    features,
  });
  console.log(`wrote ${features.length} features to data/processed/explore_places.geojson`);
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
