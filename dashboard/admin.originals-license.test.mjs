import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./admin.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]).join('\n');

assert.ok(scripts, 'admin.html must contain inline JavaScript');
assert.doesNotThrow(() => new Function(scripts), 'inline admin JavaScript must parse');

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
assert.deepEqual(duplicateIds, [], 'admin.html must not contain duplicate ids');

for (const id of [
  'originals-narration-license-panel',
  'originals-narration-license-status',
  'originals-license-terms-id',
  'originals-license-terms-version',
  'originals-license-terms-url',
  'originals-license-reviewed-at',
  'originals-license-open-btn',
  'originals-license-attest-btn',
]) {
  assert.ok(ids.includes(id), `missing Studio license control: ${id}`);
}

assert.match(
  html,
  /onclick="openOriginalNarrationTerms\(\)"/,
  'the terms button must open the reviewed provider URL',
);
assert.match(
  scripts,
  /function openOriginalNarrationTerms\(\)/,
  'the terms URL handler must be defined',
);
assert.match(
  html,
  /onclick="attestOriginalNarrationLicense\(\)"/,
  'the license review button must call its inline handler',
);
assert.match(
  scripts,
  /async function attestOriginalNarrationLicense\(\)/,
  'the license attestation handler must be defined',
);

const handlerStart = scripts.indexOf('async function attestOriginalNarrationLicense()');
const handlerEnd = scripts.indexOf('\nfunction attachVerifiedOriginalAsset', handlerStart);
assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, 'could not isolate the license handler');
const handler = scripts.slice(handlerStart, handlerEnd);

assert.match(
  handler,
  /\/assets\/\$\{encodeURIComponent\(assetId\)\}\/license-attestation/,
  'the handler must call the server-owned asset attestation endpoint',
);
for (const field of ['terms_id', 'terms_url', 'terms_version', 'reviewed_at']) {
  assert.match(handler, new RegExp(`\\b${field}\\b`), `attestation request is missing ${field}`);
}
assert.doesNotMatch(
  handler,
  /attested_by_admin_user_id\s*:/,
  'the client must never provide the server-owned admin identity',
);
assert.doesNotMatch(
  handler,
  /attested_at\s*:/,
  'the client must never provide the server-owned attestation time',
);
assert.match(
  handler,
  /if \(!originalEditorDirty\) await validateOriginalDraft\(false\)/,
  'successful attestation must refresh readiness from the server',
);

const editBindingStart = scripts.indexOf('const handleEdit = event =>');
const editBindingEnd = scripts.indexOf("editor.dataset.dirtyBound = 'true'", editBindingStart);
const editBinding = scripts.slice(editBindingStart, editBindingEnd);
for (const id of [
  'originals-license-terms-id',
  'originals-license-terms-version',
  'originals-license-terms-url',
  'originals-license-reviewed-at',
]) {
  assert.match(editBinding, new RegExp(`['\"]${id}['\"]`), `${id} must not dirty the authored draft`);
}

const licenseMarkupStart = html.indexOf('id="originals-narration-license-panel"');
const licenseMarkupEnd = html.indexOf('id="originals-versions-card"', licenseMarkupStart);
const licenseMarkup = html.slice(licenseMarkupStart, licenseMarkupEnd);
assert.doesNotMatch(licenseMarkup, /\bAI\b/i, 'the narration license surface must not use an AI label');
assert.doesNotMatch(licenseMarkup, /green|#22c55e/i, 'the narration license surface must not use green styling');

console.log('Originals Studio narration license inline-handler tests passed.');
