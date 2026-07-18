import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const distPath = new URL('dist/', root);

function read(relativePath) {
  const url = new URL(relativePath, distPath);
  assert.ok(existsSync(url), `Missing built file: dist/${relativePath}`);
  return readFileSync(url, 'utf8');
}

function assertIncludes(value, expected, label = expected) {
  assert.ok(value.includes(expected), `Expected built preview to include ${label}`);
}

function collectFiles(directory, predicate, found = []) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      collectFiles(path, predicate, found);
    } else if (predicate(path)) {
      found.push(path);
    }
  }
  return found;
}

const html = read('originals/moab-canyons-to-the-sky/index.html');

assert.match(
  html,
  /<meta name="robots" content="noindex, nofollow, noarchive"\s*\/?>/,
  'Internal preview must remain noindex and noarchive',
);
assert.match(
  html,
  /<link rel="canonical" href="https:\/\/gettrailhead\.app\/originals\/moab-canyons-to-the-sky"\s*\/?>/,
  'Expected the built preview to include the canonical apex URL',
);

for (const requiredText of [
  'Internal preview',
  'Deterministic whole-route validation passed · Internal preview only',
  'Moab:',
  'Canyons to the Sky',
  'Moab → Island in the Sky',
  '4–6 hours',
  'Free',
  '11 GPS-triggered',
  'Route + audio',
  'Paved',
  'Park admission is separate',
  'How a story is triggered',
  'Schematic route · not for navigation',
  '$20',
  '$30',
  'July 17, 2026',
  'Upcoming access change',
  'July 27 through October 1, 2026',
  'automated whole-route validation',
  'Android and iPhone preview invitations are sent directly to approved testers after the paired builds are ready.',
]) {
  assertIncludes(html, requiredText);
}

for (const storyTitle of [
  'From River Town to High Desert',
  'The Road to the Sky',
  'Layers of Time',
  'The Neck and the Point',
  'Above the Colorado',
  'One Park, Four Districts',
  'Shafer Canyon: A Road Through Rock',
  'Mesa Arch: A Window in Stone',
  'Green River: What Shall We Find?',
  'Tracks in Buck Canyon',
  'Grand View: Water, Gravity, Time',
]) {
  assertIncludes(html, storyTitle, `story title: ${storyTitle}`);
}

assertIncludes(html, 'trailhead://originals/moab-canyons-to-the-sky', 'the Originals app deep link');
assertIncludes(html, '/app/index.html', 'the web app fallback');
assertIncludes(html, 'stateparks.utah.gov/parks/dead-horse/park-fees/', 'the Utah State Parks fee source');
assertIncludes(html, 'nps.gov/cany/planyourvisit/fees.htm', 'the Canyonlands fee source');
assertIncludes(html, 'nps.gov/cany/planyourvisit/driving.htm', 'the auto-touring source');
assertIncludes(html, 'nps.gov/cany/planyourvisit/road-conditions.htm', 'the current road-conditions source');
assertIncludes(html, 'nps.gov/cany/planyourvisit/basicinfo.htm', 'the basic visitor-information source');
assertIncludes(html, 'nps.gov/cany/planyourvisit/grand_view_point_construction.htm', 'the Grand View construction source');

const visibleText = html
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ');
assert.doesNotMatch(visibleText, /\bAI\b/i, 'The preview must not show an AI label');
assert.doesNotMatch(visibleText, /\b(?:iOS|Android) preview\b/i, 'Store links cannot imply preview-build availability');
assert.doesNotMatch(
  html,
  /<a[^>]+href="https:\/\/(?:apps\.apple\.com|play\.google\.com\/store\/apps)/i,
  'Internal preview cannot render production store badges',
);

const aasaRaw = read('.well-known/apple-app-site-association');
const aasa = JSON.parse(aasaRaw);
const appLink = aasa.applinks?.details?.[0];
assert.equal(appLink?.appID, '4FJKGBQA5X.com.trailhead.app');
assert.ok(appLink?.paths?.includes('/originals/*'), 'AASA paths must cover Originals');
assert.ok(
  appLink?.components?.some((component) => component['/'] === '/originals/*'),
  'AASA components must cover Originals',
);
assert.doesNotMatch(aasaRaw, /PLACEHOLDER|REPLACE_WITH/, 'AASA cannot ship placeholders');

const assetLinksRaw = read('.well-known/assetlinks.json');
const assetLinks = JSON.parse(assetLinksRaw);
const androidTarget = assetLinks[0]?.target;
assert.equal(androidTarget?.namespace, 'android_app');
assert.equal(androidTarget?.package_name, 'com.trailhead.app');
assert.ok(
  androidTarget?.sha256_cert_fingerprints?.includes(
    'DE:BB:4B:74:EF:C8:94:42:1B:00:B3:E0:92:45:86:77:DA:EB:A5:72:C7:82:74:76:61:AA:FC:93:89:CA:CB:C6',
  ),
  'Asset Links must include the current EAS internal signing certificate',
);
assert.doesNotMatch(assetLinksRaw, /PLACEHOLDER|REPLACE_WITH/, 'Asset Links cannot ship placeholders');

const sitemapFiles = collectFiles(fileURLToPath(distPath), (path) => /sitemap.*\.xml$/.test(path));
assert.ok(sitemapFiles.length > 0, 'Expected a generated sitemap');
const sitemap = sitemapFiles.map((path) => readFileSync(path, 'utf8')).join('\n');
assert.ok(
  !sitemap.includes('/originals/moab-canyons-to-the-sky'),
  'Internal preview cannot appear in the sitemap',
);

console.log('Originals preview contract passed.');
