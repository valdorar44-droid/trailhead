import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./admin.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]).join('\n');

assert.ok(scripts, 'admin.html must contain inline JavaScript');
assert.doesNotThrow(() => new Function(scripts), 'inline admin JavaScript must parse');

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
for (const id of [
  'originals-preview-selection',
  'originals-preview-chapter',
  'originals-preview-variant',
  'originals-preview-expiry',
  'originals-preview-selection-status',
]) {
  assert.ok(ids.includes(id), `missing Studio V2 preview control: ${id}`);
}

assert.match(
  html,
  /id="originals-preview-expiry"[^>]*><option value="300">5 minutes<\/option>/,
  'private preview links must offer the shortest server-supported five-minute lifetime first',
);
assert.match(
  html,
  /<option value="900">15 minutes<\/option>/,
  'private preview links must offer a practical bounded download window',
);

function functionSource(name, nextName) {
  const start = scripts.indexOf(`function ${name}(`);
  const end = scripts.indexOf(`\nfunction ${nextName}(`, start);
  assert.ok(start >= 0 && end > start, `could not isolate ${name}`);
  return scripts.slice(start, end);
}

const optionsSource = functionSource(
  'originalDevicePreviewOptions',
  'resolveOriginalDevicePreviewSelection',
);
const selectionSource = functionSource(
  'resolveOriginalDevicePreviewSelection',
  'setOriginalPreviewSelectionStatus',
);
const helpers = new Function(
  `${optionsSource}\n${selectionSource}\nreturn { originalDevicePreviewOptions, resolveOriginalDevicePreviewSelection };`,
)();

const preview = helpers.originalDevicePreviewOptions({
  schema_version: 2,
  chapters: [
    {
      id: 'little_river_cades_cove', sequence: 2, title: 'Little River and Cades Cove',
      default_variant_id: 'counterclockwise',
      variants: [{
        id: 'counterclockwise', sequence: 1, title: 'Cades Cove Loop',
        route: { direction: 'one_way', distance_m: 17600, duration_s: 5400 },
      }],
    },
    {
      id: 'mountain_crossing', sequence: 1, title: 'Mountain Crossing',
      default_variant_id: 'eastbound',
      variants: [
        { id: 'westbound', sequence: 2, title: 'Cherokee to Sugarlands' },
        { id: 'eastbound', sequence: 1, title: 'Sugarlands to Cherokee' },
      ],
    },
  ],
});
assert.equal(preview.schemaVersion, 2);
assert.deepEqual(preview.chapters.map(chapter => chapter.id), [
  'mountain_crossing',
  'little_river_cades_cove',
]);
assert.deepEqual(preview.chapters[0].variants.map(variant => variant.id), [
  'eastbound',
  'westbound',
]);

const exact = helpers.resolveOriginalDevicePreviewSelection(
  preview,
  'mountain_crossing',
  'westbound',
);
assert.equal(exact.valid, true);
assert.equal(exact.chapter.id, 'mountain_crossing');
assert.equal(exact.variant.id, 'westbound');
assert.equal(
  helpers.resolveOriginalDevicePreviewSelection(preview, 'unknown', 'eastbound').valid,
  false,
  'a stale chapter may not silently select another route',
);
assert.equal(
  helpers.resolveOriginalDevicePreviewSelection(preview, 'mountain_crossing', 'unknown').valid,
  false,
  'a stale route may not silently select the default route',
);
assert.deepEqual(
  helpers.resolveOriginalDevicePreviewSelection({ schemaVersion: 1, chapters: [] }),
  { valid: true, schemaVersion: 1, chapter: null, variant: null },
  'V1 retains its selection-free device preview',
);

const v3Preview = helpers.originalDevicePreviewOptions({
  schema_version: 3,
  chapters: [{
    id: 'foothills_parkway', sequence: 1, title: 'Foothills Parkway',
    default_variant_id: 'eastbound',
    variants: [{
      id: 'eastbound', sequence: 1, title: 'Eastbound', direction: 'eastbound',
      distance_m: 25000, duration_s: 2700, story_count: 6, cue_count: 7,
    }],
  }],
});
assert.equal(v3Preview.schemaVersion, 3);
const v3Selection = helpers.resolveOriginalDevicePreviewSelection(
  v3Preview,
  'foothills_parkway',
  'eastbound',
);
assert.equal(v3Selection.valid, true);
assert.equal(v3Selection.chapter.id, 'foothills_parkway');
assert.equal(v3Selection.variant.id, 'eastbound');

const generateStart = scripts.indexOf('async function generateOriginalPreviewLink()');
const generateEnd = scripts.indexOf('\nasync function copyOriginalPreviewLink()', generateStart);
assert.ok(generateStart >= 0 && generateEnd > generateStart, 'could not isolate preview-link handler');
const generateHandler = scripts.slice(generateStart, generateEnd);
assert.match(generateHandler, /trailhead:\/\/originals\/preview\?\$\{query\.toString\(\)\}/);
assert.match(generateHandler, /chapter:\s*previewSelection\.chapter\.id/);
assert.match(generateHandler, /variant:\s*previewSelection\.variant\.id/);
assert.match(
  generateHandler,
  /previewSelection\.schemaVersion === 2 \|\| previewSelection\.schemaVersion === 3/,
  'V2 and V3 must both generate chapter-and-route preview links',
);
assert.match(
  generateHandler,
  /trailhead:\/\/originals\/\$\{encodeURIComponent\(selectedOriginalId\)\}\?originals_preview_token=/,
  'V1 must keep the existing app-link shape without route-selection parameters',
);

const previewMarkupStart = html.indexOf('id="originals-preview-selection"');
const previewMarkupEnd = html.indexOf('id="originals-preview-output"', previewMarkupStart);
assert.doesNotMatch(
  html.slice(previewMarkupStart, previewMarkupEnd),
  /\bAI\b/i,
  'the V2 route selector must not use an AI label',
);

console.log('Originals Studio V2 device-preview selection tests passed.');
