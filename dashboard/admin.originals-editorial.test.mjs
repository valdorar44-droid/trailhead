import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./admin.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]).join('\n');

assert.ok(scripts, 'admin.html must contain inline JavaScript');
assert.doesNotThrow(() => new Function(scripts), 'inline admin JavaScript must parse');

for (const id of [
  'smokies-editorial-card',
  'smokies-editorial-load',
  'smokies-editorial-summary',
  'smokies-editorial-content',
]) {
  assert.match(html, new RegExp(`id="${id}"`), `missing Smokies editorial control: ${id}`);
}

const loaderStart = scripts.indexOf('async function loadSmokiesEditorialPacket()');
const loaderEnd = scripts.indexOf('\nfunction originalStarterTemplate(', loaderStart);
assert.ok(loaderStart >= 0 && loaderEnd > loaderStart, 'could not isolate Smokies editorial loader');
const loader = scripts.slice(loaderStart, loaderEnd);
assert.match(loader, /\/api\/admin\/originals-editorial\/smokies/);
assert.match(loader, /selectedSmokiesEditorialId = null/);
assert.match(loader, /renderSmokiesEditorialPacket\(\)/);

const panelStart = html.indexOf('id="smokies-editorial-card"');
const panelEnd = html.indexOf('id="originals-editor-empty"', panelStart);
const panel = html.slice(panelStart, panelEnd);
assert.doesNotMatch(panel, /\bAI\b/i, 'the editorial review surface must not use an AI label');
assert.doesNotMatch(panel, /Cartesia|ElevenLabs/i, 'provider wording does not belong in script review');

console.log('Originals Studio source-locked editorial tests passed.');
