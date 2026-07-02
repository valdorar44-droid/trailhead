import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { exists, loadRegistry, parseCli, readJson, rel, runCommand } from './lib.ts';

const forbiddenVisibleCopy = [
  /\bAI[- ]generated\b/i,
  /\bAI\b/,
  /\bAPI\b/,
  /\bdev(?:eloper)?\s+(mode|tools?|notes?|copy|screen|panel|debug)\b/i,
  /\bmap layer\b/i,
  /\bFeatureServer\b/i,
  /\bdatabase dump\b/i,
  /\bknowledge cutoff\b/i,
  /\bundefined\b/i,
  /\bnull\b/i,
  /\bN\/A\b/i,
  /\b0 results\b/i,
  /\bPOI\b/,
  /\bschema\b/i,
  /\bendpoint\b/i,
  /\bscrap(?:e|ed|ing)\s+(source|record|data|dump|site|page|content)\b/i,
  /\braw\s+(source|record|data|json|dump)\b/i,
  /\bimport(?:ed|ing)?\s+(source|record|data|dump)\b/i,
  /\bsync(?:ed|ing)?\s+(source|record|data|dump)\b/i,
  /\brig aware\b/i,
  /\boffline ready\b/i,
];

async function main() {
  const opts = parseCli();
  const registry = await loadRegistry();
  const failures: string[] = [];
  for (const source of registry.sources || []) {
    if (!source.id || !source.source_url && !source.api_base && !source.metadata_url) failures.push(`source missing URL: ${source.id || 'unknown'}`);
    if (!source.attribution_text) failures.push(`source missing attribution: ${source.id}`);
  }
  const catalogFile = await exists(rel('data', 'processed', 'explore_catalog_v3.candidate.json'))
    ? rel('data', 'processed', 'explore_catalog_v3.candidate.json')
    : rel('dashboard', 'explore_catalog_v3.json');
  for (const file of [
    catalogFile,
    rel('mobile', 'components', 'explore', 'ExploreDetailSheet.tsx'),
    rel('mobile', 'components', 'explore', 'exploreDisplay.ts'),
  ]) {
    if (!await exists(file)) {
      failures.push(`missing ${path.relative(rel(), file)}`);
      continue;
    }
    await readFile(file, 'utf8');
  }
  if (await exists(catalogFile)) {
    const catalog = await readJson<any>(catalogFile);
    const places = Array.isArray(catalog?.places) ? catalog.places : [];
    let missingSource = 0;
    let badThingsToDo = 0;
    const bookable = /\b(viator|tripadvisor|bookable|booking|checkout|reserve now|per adult|guided tour|private tour|day tour|half[- ]day tour|full[- ]day tour|tour operator|from\s+\$)\b/i;
    for (const place of places) {
      if (!Array.isArray(place?.sources) || !place.sources.length) missingSource += 1;
      for (const value of visibleCatalogValues(place)) {
        if (forbiddenVisibleCopy.some(pattern => pattern.test(value))) {
          failures.push(`forbidden visible copy in ${place?.id || 'catalog place'}: ${String(value).slice(0, 80)}`);
          break;
        }
      }
      const items = place?.source_pack?.things_to_do;
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        const text = [item?.title, item?.description, item?.kind, item?.category, item?.source, item?.source_label, item?.url].filter(Boolean).join(' ');
        if (bookable.test(text)) badThingsToDo += 1;
      }
    }
    if (missingSource) failures.push(`${missingSource} catalog places missing source attribution`);
    if (badThingsToDo) failures.push(`${badThingsToDo} bookable/guided items found under Things to Do`);
  }
  if (failures.length) {
    console.error('Data validation failed');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(`Data validation passed for ${registry.sources?.length || 0} registered sources.`);
  if (!opts.dryRun) {
    await runCommand('python3', ['scripts/qa_explore_content_quality.py'], { dryRun: false });
  }
}

function visibleCatalogValues(place: any): string[] {
  const out: string[] = [];
  const add = (value: unknown) => {
    const clean = String(value || '').trim();
    if (clean) out.push(clean);
  };
  const summary = place?.summary || {};
  const card = place?.card || {};
  const profile = place?.profile || {};
  add(summary.title);
  add(summary.category);
  add(summary.short_description);
  add(summary.hook);
  add(card.summary);
  add(card.highlight);
  add(profile.summary);
  add(profile.why_it_matters);
  add(profile.story);
  add(place?.audio_script);
  const pack = place?.source_pack || {};
  for (const key of ['things_to_do', 'things_to_see', 'visitor_centers', 'campgrounds', 'events', 'guided']) {
    for (const item of Array.isArray(pack[key]) ? pack[key] : []) {
      add(item?.title);
      add(item?.description);
      add(item?.category);
    }
  }
  return out;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
