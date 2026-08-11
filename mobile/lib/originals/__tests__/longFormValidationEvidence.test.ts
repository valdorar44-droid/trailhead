import assert from 'node:assert/strict';

import {
  buildOriginalLongFormEvidenceRegistry,
  checkedOriginalLongFormEvidence,
  ORIGINAL_LONG_FORM_EVIDENCE_ROWS,
  ORIGINAL_LONG_FORM_EXPECTED_SELECTION_KEYS,
  ORIGINAL_LONG_FORM_IMMUTABLE_EVIDENCE,
} from '../longFormValidationEvidence';

const registry = buildOriginalLongFormEvidenceRegistry();
assert.deepEqual(
  [...registry.keys()].sort(),
  [...ORIGINAL_LONG_FORM_EXPECTED_SELECTION_KEYS].sort(),
  'the mobile validator registers all six exact product/chapter/variant keys',
);
assert.equal(registry.size, 6);
assert.equal(ORIGINAL_LONG_FORM_IMMUTABLE_EVIDENCE.length, 15);
assert.equal(
  new Set(ORIGINAL_LONG_FORM_IMMUTABLE_EVIDENCE.map(row => row.path)).size,
  15,
  'the immutable RF history plus five readiness/target pairs has no duplicate path',
);
for (const key of ORIGINAL_LONG_FORM_EXPECTED_SELECTION_KEYS) {
  const [productId, chapterId, variantId] = key.split(':');
  assert.equal(
    checkedOriginalLongFormEvidence(productId, chapterId, variantId).key,
    key,
  );
}

assert.throws(
  () => checkedOriginalLongFormEvidence(
    'great_smoky_mountains_ridges_rivers_living_memory',
    'unknown_chapter',
    'unknown_variant',
  ),
  /No checked long-form delivery evidence/,
);
assert.throws(
  () => buildOriginalLongFormEvidenceRegistry(
    ORIGINAL_LONG_FORM_EVIDENCE_ROWS.slice(1),
  ),
  /incomplete or duplicated/,
);
assert.throws(
  () => buildOriginalLongFormEvidenceRegistry([
    ...ORIGINAL_LONG_FORM_EVIDENCE_ROWS,
    ORIGINAL_LONG_FORM_EVIDENCE_ROWS[0],
  ]),
  /incomplete or duplicated/,
);
assert.throws(
  () => buildOriginalLongFormEvidenceRegistry([
    ...ORIGINAL_LONG_FORM_EVIDENCE_ROWS.slice(0, 1),
    {
      ...ORIGINAL_LONG_FORM_EVIDENCE_ROWS[1],
      readiness_path: ORIGINAL_LONG_FORM_EVIDENCE_ROWS[0].readiness_path,
    },
    ...ORIGINAL_LONG_FORM_EVIDENCE_ROWS.slice(2),
  ]),
  /incomplete or duplicated/,
);
assert.throws(
  () => buildOriginalLongFormEvidenceRegistry([
    ...ORIGINAL_LONG_FORM_EVIDENCE_ROWS.slice(0, 1),
    {
      ...ORIGINAL_LONG_FORM_EVIDENCE_ROWS[1],
      readiness_path: ORIGINAL_LONG_FORM_EVIDENCE_ROWS[0].target_path,
    },
    ...ORIGINAL_LONG_FORM_EVIDENCE_ROWS.slice(2),
  ]),
  /incomplete or duplicated/,
);

console.log('originals complete long-form validation evidence tests passed');
