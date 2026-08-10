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
  'originals-license-card',
  'originals-narration-license-panel',
  'originals-narration-license-status',
  'originals-license-asset',
  'originals-license-assets',
  'originals-license-terms-id',
  'originals-license-terms-version',
  'originals-license-terms-url',
  'originals-license-reviewed-at',
  'originals-license-open-btn',
  'originals-license-attest-btn',
]) {
  assert.ok(ids.includes(id), `missing Studio license control: ${id}`);
}

const stopCardStart = html.indexOf('id="originals-stop-card"');
const licenseCardStart = html.indexOf('id="originals-license-card"');
const versionsCardStart = html.indexOf('id="originals-versions-card"');
assert.ok(stopCardStart >= 0, 'selected-story card must exist');
assert.ok(
  licenseCardStart > stopCardStart && versionsCardStart > licenseCardStart,
  'the narration license card must be standalone and follow the V1 selected-story card',
);
assert.doesNotMatch(
  html.slice(stopCardStart, licenseCardStart),
  /id="originals-narration-license-panel"/,
  'the license panel must remain visible when the V1 selected-story card is hidden',
);
assert.match(
  html,
  /id="originals-license-asset"[^>]+onchange="selectOriginalNarrationLicenseAsset\(this\.value\)"/,
  'the standalone panel must let the admin select an exact current narration',
);

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

const completionStart = scripts.indexOf('function originalNarrationLicenseAttestationComplete(');
const entriesStart = scripts.indexOf('function originalNarrationLicenseEntries()');
const entriesEnd = scripts.indexOf('\nfunction selectOriginalNarrationLicenseAsset', entriesStart);
assert.ok(completionStart >= 0 && entriesStart > completionStart && entriesEnd > entriesStart, 'could not isolate narration enumeration');
const entriesSource = scripts.slice(completionStart, entriesEnd);
assert.match(entriesSource, /Array\.isArray\(manifest\.stories\)/, 'V3 narration enumeration must use exact manifest.stories');
assert.match(entriesSource, /Array\.isArray\(manifest\.stops\)/, 'V1 narration enumeration must remain supported');
assert.match(entriesSource, /selectedOriginal\.uploaded_assets/, 'enumeration must bind saved manifest references to current uploaded records');
assert.match(entriesSource, /asset\.current !== false/, 'enumeration must exclude non-current uploaded records');
assert.match(entriesSource, /asset\.kind === 'narration'/, 'enumeration must include only narration records');
assert.doesNotMatch(entriesSource, /manifest\.chapters/, 'V3 narration enumeration must not drop selectable-only stories via chapter filtering');

const enumerateNarrations = new Function(
  'selectedOriginal',
  `'use strict'; ${entriesSource}; return originalNarrationLicenseEntries();`,
);
const fixtureStories = Array.from({ length: 13 }, (_, index) => ({
  id: `story_${String(index + 1).padStart(2, '0')}`,
  title: index < 5 ? `Hard cue ${index + 1}` : `Selectable ${index + 1}`,
  kind: index < 5 ? 'cue' : 'story',
  audio_asset_id: `audio_${String(index + 1).padStart(2, '0')}`,
}));
const fixtureAssets = fixtureStories.map((story, index) => ({
  id: story.audio_asset_id,
  kind: 'narration',
  sha256: (index + 1).toString(16).padStart(64, '0'),
}));
const fixtureRecords = fixtureAssets.map(asset => ({
  id: asset.id,
  kind: 'narration',
  current: true,
  sha256: asset.sha256,
  generator_metadata: { provider: 'elevenlabs', license_status: 'unverified' },
}));
fixtureRecords.push({
  id: 'unreferenced_current_audio', kind: 'narration', current: true,
  sha256: 'f'.repeat(64), generator_metadata: { provider: 'elevenlabs' },
});
fixtureRecords.push({
  ...fixtureRecords[0], current: false, sha256: 'e'.repeat(64),
});
const v3Entries = enumerateNarrations({
  original_manifest: {
    schema_version: 3,
    stories: fixtureStories,
    assets: fixtureAssets,
    chapters: [{ variants: [{
      auto_story_ids: fixtureStories.slice(0, 5).map(story => story.id),
      selectable_story_ids: fixtureStories.slice(5).map(story => story.id),
    }] }],
  },
  uploaded_assets: fixtureRecords,
});
assert.equal(v3Entries.length, 13, 'all five hard cues and eight selectable V3 stories must be enumerated');
assert.deepEqual(
  v3Entries.map(entry => entry.assetId),
  fixtureStories.map(story => story.audio_asset_id),
  'V3 narration order and identities must come from exact manifest.stories',
);
assert.ok(v3Entries.every(entry => entry.exact), 'each fixture narration must bind to its exact current SHA-256 record');

const roaringForkManifest = JSON.parse(readFileSync(
  new URL('../originals/smokies/roaring_fork_private_manifest_v3.json', import.meta.url),
  'utf8',
));
const roaringForkNarrationAssets = roaringForkManifest.assets.filter(asset => asset.kind === 'narration');
const roaringForkEntries = enumerateNarrations({
  original_manifest: roaringForkManifest,
  uploaded_assets: roaringForkNarrationAssets.map(asset => ({
    ...asset,
    current: true,
    generator_metadata: { provider: 'elevenlabs', license_status: 'unverified' },
  })),
});
assert.equal(roaringForkManifest.stories.length, 13, 'the exact Roaring Fork private manifest must retain 13 stories');
assert.equal(roaringForkNarrationAssets.length, 13, 'the exact Roaring Fork private manifest must retain 13 narration assets');
assert.deepEqual(
  roaringForkEntries.map(entry => entry.assetId),
  roaringForkManifest.stories.map(story => story.audio_asset_id),
  'the Studio review set must exactly match every Roaring Fork V3 story narration',
);
assert.ok(roaringForkEntries.every(entry => entry.exact), 'all 13 Roaring Fork narration records must bind by exact manifest SHA-256');

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
for (const field of ['expected_sha256', 'expected_draft_revision']) {
  assert.match(handler, new RegExp(`\\b${field}\\b`), `attestation request is missing stale-write binding ${field}`);
}
assert.match(handler, /entry\.exact/, 'the handler must reject a current asset that does not match the saved manifest SHA-256');
assert.match(handler, /Number\(selectedOriginal\.draft_revision\)/, 'the handler must bind the saved draft revision');
assert.match(
  handler,
  /const refreshed = await api\(`\/api\/admin\/originals\/\$\{encodeURIComponent\(selectedOriginalId\)\}`\)/,
  'the handler must read the saved draft and current assets back from the server',
);
assert.match(handler, /!readBack\.complete/, 'the handler must reject an incomplete exact-asset read-back');
for (const [field, submitted] of [
  ['terms_id', 'termsId'],
  ['terms_url', 'termsUrl'],
  ['terms_version', 'termsVersion'],
]) {
  assert.match(
    handler,
    new RegExp(`readBackAttestation\\.${field} !== ${submitted}`),
    `the handler must verify the read-back ${field} exactly matches the signed-in admin submission`,
  );
}
assert.match(
  handler,
  /String\(readBackAttestation\.reviewed_at \|\| ''\)\.slice\(0, 10\) !== reviewedAt/,
  'the handler must verify the read-back review date exactly matches the signed-in admin submission',
);
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
for (const phrase of [
  'signed-in Trailhead administrator',
  'applicable ElevenLabs Terms of Service',
  'Voice Library Addendum',
  'Prohibited Use Policy',
  'paid plan',
  'not a Beta Service',
  'Beta Services Addendum',
  'input rights',
  'voice-specific',
  'attribution',
  'This does not approve preview or publication',
]) {
  assert.ok(handler.includes(phrase), `confirmation is missing required personal-review reminder: ${phrase}`);
}
assert.match(
  handler,
  /if \(!originalEditorDirty\) await validateOriginalDraft\(false\)/,
  'successful attestation must refresh readiness from the server',
);

const renderStart = scripts.indexOf('function renderOriginalNarrationLicense(');
const renderEnd = scripts.indexOf('\nfunction fillOriginalStopEditor', renderStart);
assert.ok(renderStart >= 0 && renderEnd > renderStart, 'could not isolate narration license rendering');
const render = scripts.slice(renderStart, renderEnd);
assert.match(
  render,
  /allExpectedReadBackComplete = entries\.length > 0\s*&& entries\.every\(entry => entry\.exact && entry\.complete\)/,
  'overall COMPLETE must require every expected exact-SHA asset to read back complete',
);
assert.match(render, /&& !originalEditorDirty/, 'overall COMPLETE must refer to a saved, server-readable draft revision');
assert.match(render, /status\.textContent = `COMPLETE ·/, 'the complete state must be explicit');
assert.match(render, /field\.value = ''/, 'legal review fields must remain blank until the signed-in admin enters them');
assert.doesNotMatch(render, /metadata\.license\s*\|\|/, 'provider metadata must not prefill the legal terms id');

for (const id of [
  'originals-license-terms-id',
  'originals-license-terms-version',
  'originals-license-terms-url',
  'originals-license-reviewed-at',
]) {
  const input = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`));
  assert.ok(input, `missing legal field markup: ${id}`);
  assert.doesNotMatch(input[0], /\bvalue=/, `${id} must not have a prefilled legal value`);
}

const editBindingStart = scripts.indexOf('const handleEdit = event =>');
const editBindingEnd = scripts.indexOf("editor.dataset.dirtyBound = 'true'", editBindingStart);
const editBinding = scripts.slice(editBindingStart, editBindingEnd);
for (const id of [
  'originals-license-asset',
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
for (const officialUrl of [
  'https://elevenlabs.io/terms-of-use',
  'https://elevenlabs.io/terms-of-use-eu',
  'https://elevenlabs.io/vla',
  'https://elevenlabs.io/use-policy',
  'https://elevenlabs.io/bsa',
]) {
  assert.ok(licenseMarkup.includes(`href="${officialUrl}"`), `missing official review link: ${officialUrl}`);
}
assert.match(
  licenseMarkup,
  /actual residence\/account agreements, never from timezone or server location/,
  'the review surface must not infer the applicable legal contract from technical geography',
);
assert.doesNotMatch(licenseMarkup, /\bAI\b/i, 'the narration license surface must not use an AI label');
assert.doesNotMatch(licenseMarkup, /green|#22c55e/i, 'the narration license surface must not use green styling');

console.log('Originals Studio narration license inline-handler tests passed.');
