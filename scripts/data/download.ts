import path from 'node:path';
import {
  appendQuery,
  downloadFile,
  ensureDir,
  fetchAndSaveJson,
  fetchJson,
  loadRegistry,
  parseCli,
  rel,
  requireEnv,
  safePart,
  selectedRegistrySources,
  writeJsonAtomic,
  writeJsonlAtomic,
  type CliOptions,
} from './lib.ts';

const NPS_DEFAULT_ENDPOINTS = [
  'parks',
  'campgrounds',
  'visitorcenters',
  'thingstodo',
  'places',
  'activities',
  'alerts',
  'articles',
  'events',
  'newsreleases',
];

const RIDB_DEFAULT_ENDPOINTS = [
  'recareas',
  'facilities',
  'campsites',
  'activities',
  'organizations',
  'facilityaddresses',
  'facilitymedia',
  'facilitylinks',
  'facilityactivities',
  'recareaactivities',
  'recareamedia',
  'recarealinks',
];

async function main() {
  const opts = parseCli();
  const registry = await loadRegistry();
  const selected = selectedRegistrySources(registry, opts.source);
  if (!selected.length) throw new Error(`no source matched ${opts.source}`);
  for (const source of selected) {
    if (source.id === 'nps-api') await downloadNps(source, opts);
    else if (source.id === 'ridb') await downloadRidb(source, opts);
    else if (source.id === 'usfs-edw') await downloadUsfs(source, opts);
    else if (source.id === 'padus') await downloadPadus(source, opts);
    else if (source.id === 'nps-national-spatial') await downloadArcgisLayers(source, opts);
    else console.log(`skip ${source.id}: downloader not enabled in phase 1`);
  }
}

async function downloadNps(source: any, opts: CliOptions) {
  const apiKey = requireEnv('NPS_API_KEY', opts.dryRun);
  const pageLimit = opts.limit || 500;
  const budget = opts.budget || 750;
  const maxRecords = opts.maxRecords || 0;
  let requests = 0;
  const endpoints = (opts.endpoint?.length ? opts.endpoint : source.endpoints || NPS_DEFAULT_ENDPOINTS)
    .map((value: string) => value.trim().toLowerCase())
    .filter(Boolean);
  const endpointRows = new Map<string, any[]>();
  for (const endpoint of endpoints) {
    let start = 0;
    const rows: any[] = [];
    while (requests < budget) {
      const url = appendQuery(`${source.api_base}/${endpoint}`, {
        limit: pageLimit,
        start,
        stateCode: opts.state,
      });
      const out = rel('data', 'raw', 'nps', 'api', endpoint, `${String(start).padStart(8, '0')}.json`);
      const payload = await fetchAndSaveJson(url, out, {
        sourceId: source.id,
        dryRun: opts.dryRun,
        force: opts.force,
        skipExisting: opts.skipExisting,
        headers: { 'X-Api-Key': apiKey },
      });
      requests += 1;
      if (opts.dryRun) break;
      const pageRows = Array.isArray(payload?.data) ? payload.data : [];
      rows.push(...pageRows);
      const total = Number(payload?.total);
      if (!pageRows.length || pageRows.length < pageLimit) break;
      if (Number.isFinite(total) && rows.length >= total) break;
      if (maxRecords && rows.length >= maxRecords) break;
      start += pageRows.length;
    }
    if (!opts.dryRun) {
      const clipped = rows.slice(0, maxRecords || rows.length);
      endpointRows.set(endpoint, clipped);
      await writeJsonlAtomic(rel('data', 'raw', 'nps', 'api', `${endpoint}.jsonl`), clipped);
      await writeJsonAtomic(rel('data', 'raw', 'nps', 'api', `${endpoint}-source.json`), {
        source: 'nps',
        endpoint,
        total: clipped.length,
        data: clipped,
      });
      console.log(`nps ${endpoint}: ${clipped.length} records`);
    }
  }
  if (!opts.dryRun) {
    await writeNpsSourcePack(endpointRows);
  }
}

async function downloadRidb(source: any, opts: CliOptions) {
  const apiKey = requireEnv('RIDB_API_KEY', opts.dryRun);
  const pageLimit = opts.limit || 500;
  const maxRecords = opts.maxRecords || 0;
  const endpoints = (opts.endpoint?.length ? opts.endpoint : source.endpoints || RIDB_DEFAULT_ENDPOINTS)
    .map((value: string) => value.trim().toLowerCase())
    .filter(Boolean);
  for (const endpoint of endpoints) {
    let offset = 0;
    const rows: any[] = [];
    let skipped = false;
    while (true) {
      const url = appendQuery(`${source.api_base}/${endpoint}`, {
        limit: pageLimit,
        offset,
        state: opts.state,
      });
      const out = rel('data', 'raw', 'ridb', 'api', endpoint, `${String(offset).padStart(8, '0')}.json`);
      let payload: any;
      try {
        payload = await fetchAndSaveJson(url, out, {
          sourceId: source.id,
          dryRun: opts.dryRun,
          force: opts.force,
          skipExisting: opts.skipExisting,
          headers: { apikey: apiKey },
        });
      } catch (error) {
        if (offset === 0 && isNotFoundError(error)) {
          console.log(`ridb ${endpoint}: skipped`);
          skipped = true;
          break;
        }
        throw error;
      }
      if (opts.dryRun) break;
      const pageRows = Array.isArray(payload?.RECDATA) ? payload.RECDATA : Array.isArray(payload?.data) ? payload.data : [];
      rows.push(...pageRows);
      if (!pageRows.length || pageRows.length < pageLimit) break;
      if (maxRecords && rows.length >= maxRecords) break;
      offset += pageRows.length;
    }
    if (skipped) continue;
    if (!opts.dryRun) {
      const clipped = rows.slice(0, maxRecords || rows.length);
      await writeJsonlAtomic(rel('data', 'raw', 'ridb', 'api', `${endpoint}.jsonl`), clipped);
      await writeJsonAtomic(rel('data', 'raw', 'ridb', 'api', `${endpoint}-source.json`), {
        source: 'ridb',
        endpoint,
        total: clipped.length,
        RECDATA: clipped,
      });
      if (endpoint === 'facilities') {
        await writeJsonAtomic(rel('data', 'raw', 'ridb', 'api', 'facilities-source.json'), {
          source: 'ridb',
          endpoint,
          total: clipped.length,
          RECDATA: clipped,
        });
      }
      console.log(`ridb ${endpoint}: ${clipped.length} records`);
    }
  }
}

function isNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /\b404\b/.test(message);
}

async function writeNpsSourcePack(endpointRows: Map<string, any[]>) {
  const parks = endpointRows.get('parks') || [];
  if (!parks.length) return;
  const related: Record<string, Record<string, any[]>> = {};
  for (const park of parks) {
    const parkCode = String(park?.parkCode || park?.id || '').trim().toLowerCase();
    if (parkCode) related[parkCode] = {};
  }
  for (const [endpoint, rows] of endpointRows.entries()) {
    if (endpoint === 'parks') continue;
    for (const item of rows) {
      for (const parkCode of parkCodesForNpsItem(item)) {
        if (!related[parkCode]) related[parkCode] = {};
        if (!related[parkCode][endpoint]) related[parkCode][endpoint] = [];
        related[parkCode][endpoint].push(item);
      }
    }
  }
  await writeJsonAtomic(rel('data', 'raw', 'nps', 'api', 'source-pack.json'), {
    source: 'nps',
    endpoint: 'source_pack',
    fetched_at: new Date().toISOString(),
    count: parks.length,
    related_endpoints: Array.from(endpointRows.keys()).filter(endpoint => endpoint !== 'parks'),
    data: parks,
    related,
  });
  console.log(`nps source-pack: ${parks.length} parks`);
}

function parkCodesForNpsItem(item: any): string[] {
  const values: string[] = [];
  const add = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const child of value) add(child);
      return;
    }
    if (value && typeof value === 'object') {
      add((value as any).parkCode || (value as any).parkcode || (value as any).code);
      return;
    }
    for (const part of String(value || '').split(',')) {
      const clean = part.trim().toLowerCase();
      if (clean) values.push(clean);
    }
  };
  add(item?.parkCode);
  add(item?.parkCodes);
  add(item?.relatedParks);
  return Array.from(new Set(values));
}

async function downloadUsfs(source: any, opts: CliOptions) {
  const datasets = Array.isArray(source.datasets) ? source.datasets : [];
  for (const dataset of datasets) {
    const baseDir = rel('data', 'raw', 'usfs', safePart(dataset.id));
    try {
      await downloadFile(dataset.download_url, path.join(baseDir, 'source.gdb.zip'), {
        dryRun: opts.dryRun,
        force: opts.force,
        skipExisting: opts.skipExisting,
        sourceId: `${source.id}:${dataset.id}`,
      });
    } catch (error) {
      if (!dataset.fallback_url) throw error;
      console.log(`usfs ${dataset.id}: primary download failed, trying fallback`);
      await downloadFile(dataset.fallback_url, path.join(baseDir, 'source.shp.zip'), {
        dryRun: opts.dryRun,
        force: opts.force,
        skipExisting: opts.skipExisting,
        sourceId: `${source.id}:${dataset.id}:fallback`,
      });
    }
  }
}

async function downloadPadus(source: any, opts: CliOptions) {
  const metadataPath = rel('data', 'raw', 'padus', 'sciencebase.json');
  const metadata = await fetchAndSaveJson(source.metadata_url, metadataPath, {
    sourceId: source.id,
    dryRun: opts.dryRun,
    force: opts.force,
    skipExisting: opts.skipExisting,
  }) || (opts.dryRun ? {} : await fetchJson(source.metadata_url));
  if (opts.dryRun) return;
  const files = Array.isArray(metadata?.files) ? metadata.files : [];
  const target = files.find((file: any) => String(file?.name || '').toLowerCase() === String(source.target_file).toLowerCase())
    || files.find((file: any) => String(file?.name || '').toLowerCase().includes('geodatabase'));
  const publicUrl = target?.name
    ? appendQuery(`https://www.sciencebase.gov/catalog/file/get/${metadata?.id || '652d4fc5d34e44db0e2ee45e'}`, { name: target.name })
    : '';
  const url = publicUrl || target?.downloadUri || target?.url;
  if (!url) throw new Error(`PAD-US target file not found in ScienceBase metadata: ${source.target_file}`);
  await downloadFile(url, rel('data', 'raw', 'padus', source.target_file), {
    dryRun: opts.dryRun,
    force: opts.force,
    skipExisting: opts.skipExisting,
    sourceId: source.id,
    expectedExtension: '.zip',
    minBytes: Number(target?.size || 0) ? Math.max(1024 * 1024, Math.floor(Number(target.size) * 0.95)) : 1024 * 1024,
  });
}

async function downloadArcgisLayers(source: any, opts: CliOptions) {
  const layers = Array.isArray(source.layers) ? source.layers : [];
  for (const layer of layers) {
    const layerDir = rel('data', 'raw', 'nps', 'spatial', safePart(layer.id));
    await ensureDir(layerDir);
    const metadataUrl = appendQuery(layer.url, { f: 'json' });
    const metadata = await fetchAndSaveJson(metadataUrl, path.join(layerDir, 'metadata.json'), {
      sourceId: `${source.id}:${layer.id}`,
      dryRun: opts.dryRun,
      force: opts.force,
      skipExisting: opts.skipExisting,
    });
    if (opts.dryRun) continue;
    const idField = metadata?.objectIdField || 'OBJECTID';
    const idsUrl = appendQuery(`${layer.url}/query`, { where: '1=1', returnIdsOnly: 'true', f: 'json' });
    const idsPayload = await fetchAndSaveJson(idsUrl, path.join(layerDir, 'ids.json'), {
      sourceId: `${source.id}:${layer.id}`,
      dryRun: opts.dryRun,
      force: opts.force,
      skipExisting: opts.skipExisting,
    });
    const ids = Array.isArray(idsPayload?.objectIds) ? idsPayload.objectIds : [];
    const chunkSize = Math.max(1, Math.min(Number(metadata?.maxRecordCount) || 1000, opts.limit || 1000));
    let chunkIndex = 0;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const objectIds = ids.slice(i, i + chunkSize);
      const url = appendQuery(`${layer.url}/query`, {
        objectIds: objectIds.join(','),
        outFields: '*',
        returnGeometry: 'true',
        outSR: '4326',
        f: 'json',
      });
      await fetchAndSaveJson(url, path.join(layerDir, `features-${String(chunkIndex).padStart(5, '0')}.json`), {
        sourceId: `${source.id}:${layer.id}`,
        dryRun: opts.dryRun,
        force: opts.force,
        skipExisting: opts.skipExisting,
      });
      chunkIndex += 1;
      if (opts.maxRecords && i + objectIds.length >= opts.maxRecords) break;
    }
    await writeJsonAtomic(path.join(layerDir, 'import-hint.json'), { idField, chunkSize, feature_chunks: chunkIndex });
    console.log(`nps spatial ${layer.id}: ${Math.min(ids.length, opts.maxRecords || ids.length)} ids`);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
