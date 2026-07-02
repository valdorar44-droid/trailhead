import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const REGISTRY_PATH = path.join(ROOT, 'data-sources', 'registry.json');

export type CliOptions = {
  source: string;
  dryRun: boolean;
  force: boolean;
  promote: boolean;
  skipExisting: boolean;
  limit?: number;
  maxRecords?: number;
  bbox?: string;
  state?: string;
  budget?: number;
  endpoint?: string[];
};

export function parseCli(argv = process.argv.slice(2)): CliOptions {
  const opts: CliOptions = {
    source: 'all',
    dryRun: false,
    force: false,
    promote: false,
    skipExisting: false,
    endpoint: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--source') { opts.source = String(next || 'all'); i += 1; continue; }
    if (arg === '--limit') { opts.limit = positiveInt(next); i += 1; continue; }
    if (arg === '--max-records') { opts.maxRecords = positiveInt(next); i += 1; continue; }
    if (arg === '--budget') { opts.budget = positiveInt(next); i += 1; continue; }
    if (arg === '--bbox') { opts.bbox = String(next || ''); i += 1; continue; }
    if (arg === '--state') { opts.state = String(next || '').toUpperCase(); i += 1; continue; }
    if (arg === '--endpoint') { opts.endpoint?.push(String(next || '')); i += 1; continue; }
    if (arg === '--dry-run') { opts.dryRun = true; continue; }
    if (arg === '--force') { opts.force = true; continue; }
    if (arg === '--promote') { opts.promote = true; continue; }
    if (arg === '--skip-existing') { opts.skipExisting = true; continue; }
  }
  return opts;
}

function positiveInt(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

export async function readJson<T = any>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}

export async function loadRegistry(): Promise<any> {
  return readJson(REGISTRY_PATH);
}

export function selectedRegistrySources(registry: any, source: string): any[] {
  const sources = Array.isArray(registry?.sources) ? registry.sources : [];
  const normalized = normalizeSourceName(source);
  if (normalized === 'all') {
    return sources.filter((entry: any) => entry.enabled !== false);
  }
  return sources.filter((entry: any) => {
    const id = normalizeSourceName(entry.id);
    return id === normalized || id.startsWith(`${normalized}-`) || normalized.startsWith(`${id}-`);
  });
}

export function normalizeSourceName(value: string): string {
  const clean = String(value || '').trim().toLowerCase();
  if (clean === 'nps') return 'nps-api';
  if (clean === 'usfs') return 'usfs-edw';
  return clean || 'all';
}

export function rel(...parts: string[]): string {
  return path.join(ROOT, ...parts);
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export function safePart(value: string): string {
  return String(value || 'source')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'source';
}

export async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  hash.update(await readFile(filePath));
  return hash.digest('hex');
}

export async function writeJsonAtomic(filePath: string, data: any): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.tmp-${process.pid}`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`);
  await rename(tmp, filePath);
}

export async function writeJsonlAtomic(filePath: string, rows: any[]): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.tmp-${process.pid}`;
  await writeFile(tmp, rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));
  await rename(tmp, filePath);
}

export async function readJsonl<T = any>(filePath: string): Promise<T[]> {
  const text = await readFile(filePath, 'utf8');
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line) as T);
}

export async function listFilesRecursive(dir: string, predicate: (filePath: string) => boolean = () => true): Promise<string[]> {
  if (!await exists(dir)) return [];
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await listFilesRecursive(full, predicate));
    } else if (entry.isFile() && predicate(full)) {
      out.push(full);
    }
  }
  return out;
}

export async function writeMetadata(filePath: string, metadata: Record<string, any>): Promise<void> {
  const info = await stat(filePath);
  await writeJsonAtomic(`${filePath}.metadata.json`, {
    ...metadata,
    downloaded_at: metadata.downloaded_at || new Date().toISOString(),
    size_bytes: info.size,
    sha256: await sha256File(filePath),
  });
}

export async function downloadFile(url: string, outPath: string, opts: { dryRun?: boolean; force?: boolean; skipExisting?: boolean; headers?: Record<string, string>; sourceId?: string; expectedExtension?: string; minBytes?: number } = {}) {
  if (opts.dryRun) {
    console.log(`DRY download ${redactUrl(url)} -> ${path.relative(ROOT, outPath)}`);
    return { skipped: true, path: outPath };
  }
  if (!opts.force && opts.skipExisting && await exists(outPath)) {
    console.log(`skip existing ${path.relative(ROOT, outPath)}`);
    return { skipped: true, path: outPath };
  }
  await ensureDir(path.dirname(outPath));
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Trailhead/1.0',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok || !res.body) throw new Error(`download failed ${res.status} ${redactUrl(url)}`);
  const tmp = `${outPath}.tmp-${process.pid}`;
  await pipeline(res.body as any, createWriteStream(tmp));
  const info = await stat(tmp);
  if (info.size <= 0) {
    await unlink(tmp).catch(() => {});
    throw new Error(`download returned empty file: ${redactUrl(url)}`);
  }
  if (opts.minBytes && info.size < opts.minBytes) {
    await unlink(tmp).catch(() => {});
    throw new Error(`download returned a smaller file than expected: ${redactUrl(url)}`);
  }
  const contentType = res.headers.get('content-type') || '';
  if (opts.expectedExtension === '.zip' && /html/i.test(contentType)) {
    await unlink(tmp).catch(() => {});
    throw new Error(`download returned HTML instead of a zip file: ${redactUrl(url)}`);
  }
  await rename(tmp, outPath);
  await writeMetadata(outPath, {
    url: redactUrl(url),
    source_id: opts.sourceId || '',
    content_type: res.headers.get('content-type') || '',
    etag: res.headers.get('etag') || '',
    last_modified: res.headers.get('last-modified') || '',
  });
  console.log(`downloaded ${path.relative(ROOT, outPath)} (${info.size} bytes)`);
  return { skipped: false, path: outPath };
}

export async function fetchJson(url: string, opts: { headers?: Record<string, string>; dryRun?: boolean } = {}) {
  if (opts.dryRun) {
    console.log(`DRY fetch ${redactUrl(url)}`);
    return {};
  }
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Trailhead/1.0',
      'Accept': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`fetch failed ${res.status} ${redactUrl(url)}: ${text.slice(0, 240)}`);
  return JSON.parse(text);
}

export async function saveRawJson(filePath: string, url: string, payload: any, sourceId: string, headers: Headers | null = null): Promise<void> {
  await writeJsonAtomic(filePath, payload);
  await writeMetadata(filePath, {
    url: redactUrl(url),
    source_id: sourceId,
    content_type: headers?.get('content-type') || 'application/json',
    etag: headers?.get('etag') || '',
    last_modified: headers?.get('last-modified') || '',
  });
}

export async function fetchAndSaveJson(url: string, filePath: string, opts: { headers?: Record<string, string>; sourceId: string; dryRun?: boolean; force?: boolean; skipExisting?: boolean }){
  if (opts.dryRun) {
    console.log(`DRY fetch ${redactUrl(url)} -> ${path.relative(ROOT, filePath)}`);
    return null;
  }
  if (!opts.force && opts.skipExisting && await exists(filePath)) {
    console.log(`skip existing ${path.relative(ROOT, filePath)}`);
    return await readJson(filePath);
  }
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Trailhead/1.0',
      'Accept': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`fetch failed ${res.status} ${redactUrl(url)}: ${text.slice(0, 240)}`);
  const payload = JSON.parse(text);
  await saveRawJson(filePath, url, payload, opts.sourceId, res.headers);
  return payload;
}

export function appendQuery(baseUrl: string, params: Record<string, any>): string {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) continue;
    url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  return url.toString();
}

export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const key of ['api_key', 'apikey', 'key', 'token', 'access_token']) {
      if (url.searchParams.has(key)) url.searchParams.set(key, 'REDACTED');
    }
    return url.toString();
  } catch {
    return String(value || '').replace(/(api[_-]?key|apikey|token|access_token)=([^&\s]+)/gi, '$1=REDACTED');
  }
}

export function requireEnv(name: string, dryRun: boolean): string {
  const value = String(process.env[name] || '').trim();
  if (!value && !dryRun) throw new Error(`${name} is required`);
  return value || `DRY_${name}`;
}

export async function runCommand(command: string, args: string[], opts: { dryRun?: boolean; cwd?: string } = {}): Promise<void> {
  const pretty = [command, ...args].join(' ');
  if (opts.dryRun) {
    console.log(`DRY run ${pretty}`);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd: opts.cwd || ROOT, stdio: 'inherit' });
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${pretty} exited ${code}`)));
    child.on('error', reject);
  });
}

export function printSummary(label: string, rows: Array<Record<string, any>>): void {
  console.log(`${label}: ${rows.length}`);
  for (const row of rows.slice(0, 20)) console.log(JSON.stringify(row));
}
