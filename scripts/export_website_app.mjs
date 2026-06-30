import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), '..');
const mobileDir = join(repoRoot, 'mobile');
const publicDir = join(repoRoot, 'dashboard', 'site', 'public');
const targetDir = join(publicDir, 'app');
const expoBin = join(mobileDir, 'node_modules', '.bin', 'expo');
const existingEntry = join(targetDir, 'index.html');
const appRoutes = ['guide', 'map', 'plan', 'route-builder', 'report', 'profile', 'extreme-explorer'];

function log(message) {
  process.stdout.write(`[website-app] ${message}\n`);
}

function copyIfExists(from, to) {
  if (!existsSync(from)) return false;
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true, force: true });
  return true;
}

function rewriteFile(file) {
  const ext = extname(file);
  if (!['.html', '.js', '.json', '.css'].includes(ext)) return;
  let next = readFileSync(file, 'utf8');
  const original = next;
  next = next
    .replaceAll('/_expo/', '/app/_expo/')
    .replaceAll('/assets/assets/', '/app/assets/app/')
    .replaceAll('/assets/node_modules/', '/app/assets/vendor/');

  if (ext === '.js') {
    next = next
      .replace(/appendBaseUrl=function\((\w+),(\w+)=""\)\{if\(\2\)return/g, 'appendBaseUrl=function($1,$2="app"){if($2)return')
      .replace(/getUrlWithReactNavigationConcessions=function\((\w+),(\w+)=""\)\{/g, 'getUrlWithReactNavigationConcessions=function($1,$2="app"){')
      .replace(/function (\w+)\((\w+),(\w+)=""\)\{return \3\?\2\.replace/g, 'function $1($2,$3="app"){return $3?$2.replace');
  }

  if (ext === '.html' && !next.includes('rel="icon"')) {
    next = next.replace(
      '<title>Trailhead</title>',
      '<title>Trailhead</title>\n    <link rel="icon" type="image/png" href="/assets/app-icon.png" />',
    );
  }

  if (next !== original) writeFileSync(file, next);
}

function walk(dir, visit) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(path, visit);
    } else {
      visit(path);
    }
  }
}

if (!existsSync(expoBin)) {
  if (existsSync(existingEntry)) {
    log('mobile dependencies are not installed; keeping the existing static /app export.');
    process.exit(0);
  }
  process.stderr.write('[website-app] mobile dependencies are missing and no static /app export exists.\n');
  process.stderr.write('[website-app] run npm install in mobile, then npm run export:webapp from the repo root.\n');
  process.exit(1);
}

const rawDir = join(tmpdir(), `trailhead-website-app-${Date.now()}`);
log('exporting Expo web app');

const result = spawnSync(
  'npx',
  ['expo', 'export', '--platform', 'web', '--output-dir', rawDir],
  {
    cwd: mobileDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      EXPO_BASE_URL: 'app',
    },
  },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

rmSync(targetDir, { recursive: true, force: true });
mkdirSync(targetDir, { recursive: true });

copyIfExists(join(rawDir, 'index.html'), join(targetDir, 'index.html'));
copyIfExists(join(rawDir, 'metadata.json'), join(targetDir, 'metadata.json'));
copyIfExists(join(rawDir, '_expo'), join(targetDir, '_expo'));
copyIfExists(join(rawDir, 'assets', 'assets'), join(targetDir, 'assets', 'app'));
copyIfExists(join(rawDir, 'assets', 'node_modules'), join(targetDir, 'assets', 'vendor'));

walk(targetDir, rewriteFile);

for (const route of appRoutes) {
  const routeEntry = join(targetDir, route, 'index.html');
  mkdirSync(dirname(routeEntry), { recursive: true });
  cpSync(existingEntry, routeEntry, { force: true });
}

rmSync(rawDir, { recursive: true, force: true });

log('wrote dashboard/site/public/app');
